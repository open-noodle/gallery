import { Kysely } from 'kysely';
import { AgentApprovalMode, AgentMessageRole, AgentPermissionPreset, AgentProviderType } from 'src/enum';
import { AgentMessageRepository } from 'src/repositories/agent-message.repository';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import type { AgentMessageContent } from 'src/types/agent-message.types';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const permissionPlanSnapshot = {
  read: { metadata: true, previews: false, originals: false },
  providerExposure: {
    metadata: true,
    previews: false,
    originals: false,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: false, locked: false },
  writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
  limits: {
    maxAssetsPerToolCall: 100,
    maxAssetsPerSession: 1000,
    maxPreviewsPerToolCall: 0,
    maxOriginalsPerToolCall: 0,
    expiresInMinutes: 60,
  },
};

const setup = (db?: Kysely<DB>) => {
  const database = db || defaultDatabase;
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [],
    mock: [LoggingRepository],
  });

  return {
    ctx,
    credentialRepository: new AgentProviderCredentialRepository(database),
    sessionRepository: new AgentSessionRepository(database),
    sut: new AgentMessageRepository(database),
  };
};

const createSession = async (
  ctx: ReturnType<typeof setup>['ctx'],
  credentialRepository: AgentProviderCredentialRepository,
  sessionRepository: AgentSessionRepository,
) => {
  const { user } = await ctx.newUser();
  const credential = await credentialRepository.create({
    userId: user.id,
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: null,
    encryptedSecret: 'v1:encrypted',
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  });

  const session = await sessionRepository.create({
    userId: user.id,
    providerCredentialId: credential.id,
    credentialSnapshot: {
      id: credential.id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { providerCredentialId: credential.id, model: 'gpt-5.1' },
    permissionPreset: AgentPermissionPreset.Careful,
    permissionPlanSnapshot,
    approvalMode: AgentApprovalMode.Strict,
    runnerEndpoint: null,
    runnerSessionId: null,
    runnerCapabilitiesSnapshot: null,
    initialContextSnapshot: {},
  });

  return { user, session };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AgentMessageRepository.name, () => {
  it('appends messages and lists them in chronological order for a session', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    const first = await sut.create({
      sessionId: session.id,
      role: AgentMessageRole.User,
      content: { blocks: [{ type: 'text', text: 'Start organizing.' }] },
      providerMessageId: null,
      toolCallId: null,
      createdAt: new Date('2026-05-14T12:00:00.000Z'),
    });
    const second = await sut.create({
      sessionId: session.id,
      role: AgentMessageRole.Assistant,
      content: { blocks: [{ type: 'text', text: 'I can help with that.' }] },
      providerMessageId: 'provider-message-1',
      toolCallId: null,
      createdAt: new Date('2026-05-14T12:00:01.000Z'),
    });

    await expect(sut.getBySessionId(session.id)).resolves.toMatchObject([
      { id: first.id, role: AgentMessageRole.User },
      { id: second.id, role: AgentMessageRole.Assistant, providerMessageId: 'provider-message-1' },
    ]);
  });

  it('uses id as a deterministic tie-breaker when createdAt values match', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const createdAt = new Date('2026-05-14T12:00:00.000Z');
    const firstId = '00000000-0000-4000-8000-000000000001';
    const secondId = '00000000-0000-4000-8000-000000000002';

    await sut.create({
      id: secondId,
      sessionId: session.id,
      role: AgentMessageRole.Assistant,
      content: { blocks: [{ type: 'text', text: 'Second by id.' }] },
      providerMessageId: null,
      toolCallId: null,
      createdAt,
    });
    await sut.create({
      id: firstId,
      sessionId: session.id,
      role: AgentMessageRole.User,
      content: { blocks: [{ type: 'text', text: 'First by id.' }] },
      providerMessageId: null,
      toolCallId: null,
      createdAt,
    });

    await expect(sut.getBySessionId(session.id)).resolves.toMatchObject([{ id: firstId }, { id: secondId }]);
  });

  it('persists structured response-capable content blocks', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const toolCallId = '00000000-0000-4000-8000-000000000101';
    const content: AgentMessageContent = {
      blocks: [
        { type: 'text', text: 'I found matching photos.' },
        { type: 'tool-call', toolCallId, summary: 'Read candidate metadata.' },
        { type: 'asset', assetId: '00000000-0000-4000-8000-000000000102', label: 'IMG_0001.jpg' },
        { type: 'plan', planId: '00000000-0000-4000-8000-000000000103', label: 'Portugal album plan' },
      ],
    };

    const saved = await sut.create({
      sessionId: session.id,
      role: AgentMessageRole.Assistant,
      content,
      providerMessageId: 'provider-message-1',
      toolCallId,
    });

    await expect(sut.getBySessionId(session.id)).resolves.toMatchObject([
      {
        id: saved.id,
        role: AgentMessageRole.Assistant,
        content,
        providerMessageId: 'provider-message-1',
        toolCallId,
      },
    ]);
  });

  it('returns no messages for another session and cascades when the session is deleted', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const { session: otherSession } = await createSession(ctx, credentialRepository, sessionRepository);

    await sut.create({
      sessionId: session.id,
      role: AgentMessageRole.User,
      content: { blocks: [{ type: 'text', text: 'Only in my session.' }] },
      providerMessageId: null,
      toolCallId: null,
    });

    await expect(sut.getBySessionId(otherSession.id)).resolves.toEqual([]);

    await defaultDatabase.deleteFrom('agent_session').where('id', '=', session.id).execute();

    await expect(sut.getBySessionId(session.id)).resolves.toEqual([]);
  });

  it('rejects messages for missing sessions through the foreign key', async () => {
    const { sut } = setup();

    await expect(
      sut.create({
        sessionId: '00000000-0000-4000-8000-000000000001',
        role: AgentMessageRole.User,
        content: { blocks: [{ type: 'text', text: 'Missing session.' }] },
        providerMessageId: null,
        toolCallId: null,
      }),
    ).rejects.toThrow();
  });
});
