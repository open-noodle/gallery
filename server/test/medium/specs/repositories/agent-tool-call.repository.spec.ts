import { Insertable, Kysely } from 'kysely';
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
} from 'src/enum';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { AgentToolCallTable } from 'src/schema/tables/agent-tool-call.table';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
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

const providerSnapshot = {
  providerCredentialId: null,
  providerType: AgentProviderType.OpenAI,
  label: 'OpenAI personal',
  baseUrl: null,
  model: 'gpt-5.1',
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
    sut: new AgentToolCallRepository(database),
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

const createToolCall = (
  sut: AgentToolCallRepository,
  sessionId: string,
  overrides: Partial<Insertable<AgentToolCallTable>> = {},
) =>
  sut.create({
    sessionId,
    toolName: AgentToolName.ReadAssetMetadata,
    status: AgentToolCallStatus.PendingApproval,
    approvalDecision: null,
    requestSummary: 'Read selected metadata.',
    responseSummary: null,
    redactedRequestMetadata: { assetIds: [factory.uuid()] },
    redactedResponseMetadata: null,
    dataClass: AgentToolDataClass.Metadata,
    assetCount: 1,
    albumCount: 0,
    providerSnapshot,
    ...overrides,
  });

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AgentToolCallRepository.name, () => {
  it('creates, lists, gets, and transitions tool calls for a session', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const older = await createToolCall(sut, session.id, { startedAt: new Date('2026-05-14T12:00:00.000Z') });
    const newer = await createToolCall(sut, session.id, { startedAt: new Date('2026-05-14T12:00:01.000Z') });
    const olderRequestMetadata = older.redactedRequestMetadata;

    if (!('assetIds' in olderRequestMetadata)) {
      throw new Error('Expected read asset metadata fixture request metadata');
    }

    await expect(sut.getBySessionId(session.id)).resolves.toMatchObject([{ id: newer.id }, { id: older.id }]);
    await expect(sut.getByIdForSession(session.id, older.id)).resolves.toMatchObject({
      id: older.id,
      sessionId: session.id,
      toolName: AgentToolName.ReadAssetMetadata,
      status: AgentToolCallStatus.PendingApproval,
      approvalDecision: null,
      requestSummary: 'Read selected metadata.',
      responseSummary: null,
      redactedRequestMetadata: olderRequestMetadata,
      redactedResponseMetadata: null,
      dataClass: AgentToolDataClass.Metadata,
      assetCount: 1,
      albumCount: 0,
      providerSnapshot,
      completedAt: null,
      error: null,
    });

    const completedAt = new Date('2026-05-14T12:00:02.000Z');
    const transitioned = await sut.transition(session.id, older.id, AgentToolCallStatus.PendingApproval, {
      status: AgentToolCallStatus.Completed,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Returned one asset.',
      redactedResponseMetadata: { assetIds: olderRequestMetadata.assetIds },
      completedAt,
      error: null,
    });

    expect(transitioned).toMatchObject({
      id: older.id,
      status: AgentToolCallStatus.Completed,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Returned one asset.',
      redactedResponseMetadata: { assetIds: olderRequestMetadata.assetIds },
      completedAt,
      error: null,
    });
  });

  it('transitions only when the expected status matches and returns undefined for stale status', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const toolCall = await createToolCall(sut, session.id, { status: AgentToolCallStatus.Approved });

    await expect(
      sut.transition(session.id, toolCall.id, AgentToolCallStatus.PendingApproval, {
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        responseSummary: null,
        redactedResponseMetadata: null,
        completedAt: new Date('2026-05-14T12:00:00.000Z'),
        error: null,
      }),
    ).resolves.toBeUndefined();
    await expect(sut.getByIdForSession(session.id, toolCall.id)).resolves.toMatchObject({
      id: toolCall.id,
      status: AgentToolCallStatus.Approved,
      approvalDecision: null,
      completedAt: null,
    });
  });

  it('counts only active and completed asset counts for a session and can exclude the current tool call', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const { session: otherSession } = await createSession(ctx, credentialRepository, sessionRepository);
    const current = await createToolCall(sut, session.id, {
      status: AgentToolCallStatus.PendingApproval,
      assetCount: 2,
    });
    await createToolCall(sut, session.id, { status: AgentToolCallStatus.Approved, assetCount: 3 });
    await createToolCall(sut, session.id, { status: AgentToolCallStatus.Executing, assetCount: 5 });
    await createToolCall(sut, session.id, { status: AgentToolCallStatus.Completed, assetCount: 7 });
    await createToolCall(sut, session.id, { status: AgentToolCallStatus.Denied, assetCount: 11 });
    await createToolCall(sut, session.id, { status: AgentToolCallStatus.Failed, assetCount: 13 });
    await createToolCall(sut, otherSession.id, { status: AgentToolCallStatus.Completed, assetCount: 17 });

    await expect(sut.getCountedAssetCountBySession(session.id)).resolves.toBe(17);
    await expect(sut.getCountedAssetCountBySession(session.id, current.id)).resolves.toBe(15);
  });

  it('counts active and completed exposures by session and data class', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const { session: otherSession } = await createSession(ctx, credentialRepository, sessionRepository);
    const current = await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetMetadata,
      dataClass: AgentToolDataClass.Metadata,
      status: AgentToolCallStatus.PendingApproval,
      assetCount: 2,
    });
    await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetMetadata,
      dataClass: AgentToolDataClass.Metadata,
      status: AgentToolCallStatus.Completed,
      assetCount: 10,
    });
    await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetPreviews,
      dataClass: AgentToolDataClass.Previews,
      status: AgentToolCallStatus.Completed,
      assetCount: 3,
    });
    await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetOriginals,
      dataClass: AgentToolDataClass.Originals,
      status: AgentToolCallStatus.Denied,
      assetCount: 5,
    });
    await createToolCall(sut, otherSession.id, {
      toolName: AgentToolName.ReadAssetMetadata,
      dataClass: AgentToolDataClass.Metadata,
      status: AgentToolCallStatus.Completed,
      assetCount: 17,
    });

    await expect(sut.getCountedAssetCountBySessionAndDataClass(session.id, AgentToolDataClass.Metadata)).resolves.toBe(
      12,
    );
    await expect(
      sut.getCountedAssetCountBySessionAndDataClass(session.id, AgentToolDataClass.Metadata, current.id),
    ).resolves.toBe(10);
    await expect(sut.getCountedAssetCountBySessionAndDataClass(session.id, AgentToolDataClass.Previews)).resolves.toBe(
      3,
    );
    await expect(sut.getCountedAssetCountBySessionAndDataClass(session.id, AgentToolDataClass.Originals)).resolves.toBe(
      0,
    );
  });

  it('updates asset and album counts only during guarded transitions', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const toolCall = await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAlbum,
      status: AgentToolCallStatus.Executing,
      assetCount: 0,
      albumCount: 0,
    });

    const updated = await sut.transition(session.id, toolCall.id, AgentToolCallStatus.Executing, {
      status: AgentToolCallStatus.Completed,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Returned one album with two assets.',
      redactedResponseMetadata: { albumIds: [factory.uuid()], assetIds: [factory.uuid(), factory.uuid()] },
      assetCount: 2,
      albumCount: 1,
      completedAt: new Date('2026-05-14T12:00:00.000Z'),
      error: null,
    });

    expect(updated).toMatchObject({
      id: toolCall.id,
      status: AgentToolCallStatus.Completed,
      assetCount: 2,
      albumCount: 1,
    });
  });

  it('atomically creates a pending metadata tool call when the session asset limit allows it', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    await createToolCall(sut, session.id, { status: AgentToolCallStatus.Completed, assetCount: 2 });
    await createToolCall(sut, session.id, { status: AgentToolCallStatus.Denied, assetCount: 100 });
    await createToolCall(sut, session.id, { status: AgentToolCallStatus.Failed, assetCount: 100 });
    const assetIds = [factory.uuid(), factory.uuid(), factory.uuid()];

    const result = await sut.createPendingReadAssetMetadataWithSessionLimit(
      {
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.PendingApproval,
        approvalDecision: null,
        requestSummary: 'Read selected metadata.',
        responseSummary: null,
        redactedRequestMetadata: { assetIds },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Metadata,
        assetCount: assetIds.length,
        albumCount: 0,
        providerSnapshot,
        completedAt: null,
        error: null,
      },
      {
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        requestSummary: 'Read selected metadata.',
        responseSummary: null,
        redactedRequestMetadata: { assetIds },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Metadata,
        assetCount: assetIds.length,
        albumCount: 0,
        providerSnapshot,
        completedAt: new Date('2026-05-14T12:00:00.000Z'),
        error: 'Session policy allows at most 5 assets per session',
      },
      5,
    );

    expect(result).toMatchObject({
      status: 'created',
      toolCall: {
        sessionId: session.id,
        status: AgentToolCallStatus.PendingApproval,
        redactedRequestMetadata: { assetIds },
        assetCount: 3,
      },
    });
    await expect(sut.getCountedAssetCountBySession(session.id)).resolves.toBe(5);
  });

  it('atomically ignores counted preview and original rows when enforcing the metadata session asset limit', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetMetadata,
      dataClass: AgentToolDataClass.Metadata,
      status: AgentToolCallStatus.Completed,
      assetCount: 1,
    });
    await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetPreviews,
      dataClass: AgentToolDataClass.Previews,
      status: AgentToolCallStatus.Completed,
      assetCount: 100,
    });
    await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetOriginals,
      dataClass: AgentToolDataClass.Originals,
      status: AgentToolCallStatus.Approved,
      assetCount: 100,
    });
    const assetIds = [factory.uuid(), factory.uuid()];

    const result = await sut.createPendingReadAssetMetadataWithSessionLimit(
      {
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.PendingApproval,
        approvalDecision: null,
        requestSummary: 'Read selected metadata.',
        responseSummary: null,
        redactedRequestMetadata: { assetIds },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Metadata,
        assetCount: assetIds.length,
        albumCount: 0,
        providerSnapshot,
        completedAt: null,
        error: null,
      },
      {
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        requestSummary: 'Read selected metadata.',
        responseSummary: null,
        redactedRequestMetadata: { assetIds },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Metadata,
        assetCount: assetIds.length,
        albumCount: 0,
        providerSnapshot,
        completedAt: new Date('2026-05-14T12:00:00.000Z'),
        error: 'Session policy allows at most 3 metadata assets per session',
      },
      3,
    );

    expect(result).toMatchObject({
      status: 'created',
      toolCall: {
        sessionId: session.id,
        status: AgentToolCallStatus.PendingApproval,
        redactedRequestMetadata: { assetIds },
        assetCount: 2,
      },
    });
    await expect(sut.getCountedAssetCountBySessionAndDataClass(session.id, AgentToolDataClass.Metadata)).resolves.toBe(
      3,
    );
  });

  it('atomically denies pending metadata creation when counted statuses exceed the session asset limit', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    await createToolCall(sut, session.id, { status: AgentToolCallStatus.PendingApproval, assetCount: 2 });
    await createToolCall(sut, session.id, { status: AgentToolCallStatus.Denied, assetCount: 100 });
    const assetIds = [factory.uuid(), factory.uuid()];

    const result = await sut.createPendingReadAssetMetadataWithSessionLimit(
      {
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.PendingApproval,
        approvalDecision: null,
        requestSummary: 'Read selected metadata.',
        responseSummary: null,
        redactedRequestMetadata: { assetIds },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Metadata,
        assetCount: assetIds.length,
        albumCount: 0,
        providerSnapshot,
        completedAt: null,
        error: null,
      },
      {
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        requestSummary: 'Read selected metadata.',
        responseSummary: null,
        redactedRequestMetadata: { assetIds },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Metadata,
        assetCount: assetIds.length,
        albumCount: 0,
        providerSnapshot,
        completedAt: new Date('2026-05-14T12:00:00.000Z'),
        error: 'Session policy allows at most 3 assets per session',
      },
      3,
    );

    expect(result).toMatchObject({
      status: 'limit-exceeded',
      toolCall: {
        sessionId: session.id,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        redactedRequestMetadata: { assetIds },
        error: 'Session policy allows at most 3 assets per session',
      },
    });
    await expect(sut.getBySessionId(session.id)).resolves.toHaveLength(3);
    await expect(sut.getCountedAssetCountBySession(session.id)).resolves.toBe(2);
  });

  it('atomically creates or denies preview tool calls using only counted preview rows', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetMetadata,
      dataClass: AgentToolDataClass.Metadata,
      status: AgentToolCallStatus.Completed,
      assetCount: 100,
    });
    await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetPreviews,
      dataClass: AgentToolDataClass.Previews,
      status: AgentToolCallStatus.Completed,
      assetCount: 2,
    });
    await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetOriginals,
      dataClass: AgentToolDataClass.Originals,
      status: AgentToolCallStatus.Completed,
      assetCount: 100,
    });
    const executingAssetIds = [factory.uuid()];
    const pendingAssetIds = [factory.uuid()];

    const executingResult = await sut.createWithSessionLimit(
      {
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetPreviews,
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        requestSummary: 'Read selected previews.',
        responseSummary: 'Tool call execution started',
        redactedRequestMetadata: { assetIds: executingAssetIds },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Previews,
        assetCount: executingAssetIds.length,
        albumCount: 0,
        providerSnapshot,
        completedAt: null,
        error: null,
      },
      {
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetPreviews,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        requestSummary: 'Read selected previews.',
        responseSummary: null,
        redactedRequestMetadata: { assetIds: executingAssetIds },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Previews,
        assetCount: executingAssetIds.length,
        albumCount: 0,
        providerSnapshot,
        completedAt: new Date('2026-05-14T12:00:00.000Z'),
        error: 'Session policy allows at most 3 assets per session',
      },
      AgentToolDataClass.Previews,
      3,
    );
    const pendingResult = await sut.createWithSessionLimit(
      {
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetPreviews,
        status: AgentToolCallStatus.PendingApproval,
        approvalDecision: null,
        requestSummary: 'Read selected previews.',
        responseSummary: null,
        redactedRequestMetadata: { assetIds: pendingAssetIds },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Previews,
        assetCount: pendingAssetIds.length,
        albumCount: 0,
        providerSnapshot,
        completedAt: null,
        error: null,
      },
      {
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetPreviews,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        requestSummary: 'Read selected previews.',
        responseSummary: null,
        redactedRequestMetadata: { assetIds: pendingAssetIds },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Previews,
        assetCount: pendingAssetIds.length,
        albumCount: 0,
        providerSnapshot,
        completedAt: new Date('2026-05-14T12:00:00.000Z'),
        error: 'Session policy allows at most 3 assets per session',
      },
      AgentToolDataClass.Previews,
      3,
    );

    expect(executingResult).toMatchObject({
      status: 'created',
      toolCall: {
        status: AgentToolCallStatus.Executing,
        dataClass: AgentToolDataClass.Previews,
        assetCount: 1,
      },
    });
    expect(pendingResult).toMatchObject({
      status: 'limit-exceeded',
      toolCall: {
        status: AgentToolCallStatus.Denied,
        dataClass: AgentToolDataClass.Previews,
        error: 'Session policy allows at most 3 assets per session',
      },
    });
    await expect(sut.getCountedAssetCountBySessionAndDataClass(session.id, AgentToolDataClass.Previews)).resolves.toBe(
      3,
    );
  });

  it('atomically reserves transition asset counts by data class while excluding the current tool call', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetMetadata,
      dataClass: AgentToolDataClass.Metadata,
      status: AgentToolCallStatus.Completed,
      assetCount: 1,
    });
    await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAssetPreviews,
      dataClass: AgentToolDataClass.Previews,
      status: AgentToolCallStatus.Completed,
      assetCount: 100,
    });
    const current = await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAlbum,
      dataClass: AgentToolDataClass.Metadata,
      status: AgentToolCallStatus.Executing,
      assetCount: 2,
      albumCount: 1,
    });

    const reserved = await sut.transitionWithSessionLimit(
      session.id,
      current.id,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Tool call execution started',
        redactedResponseMetadata: null,
        assetCount: 2,
        albumCount: 1,
        completedAt: null,
        error: null,
      },
      AgentToolDataClass.Metadata,
      3,
    );
    const second = await createToolCall(sut, session.id, {
      toolName: AgentToolName.ReadAlbum,
      dataClass: AgentToolDataClass.Metadata,
      status: AgentToolCallStatus.Executing,
      assetCount: 0,
      albumCount: 1,
    });
    const denied = await sut.transitionWithSessionLimit(
      session.id,
      second.id,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Tool call execution started',
        redactedResponseMetadata: null,
        assetCount: 1,
        albumCount: 1,
        completedAt: null,
        error: null,
      },
      AgentToolDataClass.Metadata,
      3,
    );

    expect(reserved).toMatchObject({
      status: 'transitioned',
      toolCall: {
        id: current.id,
        status: AgentToolCallStatus.Executing,
        assetCount: 2,
      },
    });
    expect(denied).toMatchObject({
      status: 'limit-exceeded',
      toolCall: {
        id: second.id,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        assetCount: 0,
        error: 'Session policy allows at most 3 assets per session',
      },
    });
  });

  it('does not allow cross-session access through getByIdForSession', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const { session: otherSession } = await createSession(ctx, credentialRepository, sessionRepository);
    const toolCall = await createToolCall(sut, session.id);

    await expect(sut.getByIdForSession(otherSession.id, toolCall.id)).resolves.toBeUndefined();
  });

  it('cascades deletes when the owning session is deleted', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const toolCall = await createToolCall(sut, session.id);

    await defaultDatabase.deleteFrom('agent_session').where('id', '=', session.id).execute();

    await expect(sut.getByIdForSession(session.id, toolCall.id)).resolves.toBeUndefined();
    await expect(sut.getBySessionId(session.id)).resolves.toEqual([]);
  });
});
