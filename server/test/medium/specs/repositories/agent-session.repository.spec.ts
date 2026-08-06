import { Kysely } from 'kysely';
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType, AgentSessionStatus } from 'src/enum';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const credentialSnapshot = {
  id: '00000000-0000-4000-8000-000000000001',
  providerType: AgentProviderType.OpenAI,
  label: 'OpenAI personal',
  baseUrl: null,
  models: ['gpt-5.1'],
  defaultModel: 'gpt-5.1',
};

const modelSnapshot = {
  providerCredentialId: credentialSnapshot.id,
  model: 'gpt-5.1',
};

const permissionPlanSnapshot = {
  read: {
    metadata: true,
    previews: true,
    originals: false,
  },
  providerExposure: {
    metadata: true,
    previews: true,
    originals: false,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: {
    owned: true,
    sharedSpaces: false,
    locked: false,
  },
  writeScope: {
    createAlbum: true,
    addAssets: true,
    updateDetails: false,
    setCover: false,
  },
  limits: {
    maxAssetsPerToolCall: 100,
    maxAssetsPerSession: 1000,
    maxPreviewsPerToolCall: 50,
    maxOriginalsPerToolCall: 0,
    expiresInMinutes: 60,
  },
};

const runnerCapabilitiesSnapshot = {
  protocol: 'pi-agent-v1',
  tools: ['album.create', 'asset.search'],
};

const initialContextSnapshot = {
  prompt: 'Find the best mountain photos',
  filters: { rating: 5 },
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
    sut: new AgentSessionRepository(database),
  };
};

const assertUpdateType = (sut: AgentSessionRepository) => {
  void sut.update('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', {
    status: AgentSessionStatus.Completed,
    endedAt: new Date('2026-05-14T13:00:00Z'),
    runnerEndpoint: 'http://localhost:3001',
    runnerSessionId: 'runner-session-2',
    runnerCapabilitiesSnapshot: { protocol: 'pi-agent-v1', finished: true },
  });

  void sut.update('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', {
    // @ts-expect-error ownership must be immutable
    userId: '00000000-0000-4000-8000-000000000003',
  });
  void sut.update('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', {
    // @ts-expect-error provider linkage must be immutable
    providerCredentialId: '00000000-0000-4000-8000-000000000004',
  });
  void sut.update('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', {
    // @ts-expect-error credential snapshot must be immutable
    credentialSnapshot,
  });
  void sut.update('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', {
    // @ts-expect-error model snapshot must be immutable
    modelSnapshot,
  });
  void sut.update('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', {
    // @ts-expect-error permission preset must be immutable
    permissionPreset: AgentPermissionPreset.Custom,
  });
  void sut.update('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', {
    // @ts-expect-error permission plan snapshot must be immutable
    permissionPlanSnapshot,
  });
  void sut.update('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', {
    // @ts-expect-error approval mode must be immutable
    approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
  });
  void sut.update('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', {
    // @ts-expect-error initial context snapshot must be immutable
    initialContextSnapshot,
  });
  void sut.update('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', {
    // @ts-expect-error created timestamp must be immutable
    createdAt: new Date('2026-05-14T13:00:00Z'),
  });
};

void assertUpdateType;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AgentSessionRepository.name, () => {
  it('persists snapshots and scopes reads, lists, and updates by user', async () => {
    const { ctx, credentialRepository, sut } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const credential = await credentialRepository.create({
      userId: user.id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      encryptedSecret: 'v1:encrypted',
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    });

    const created = await sut.create({
      userId: user.id,
      providerCredentialId: credential.id,
      credentialSnapshot: { ...credentialSnapshot, id: credential.id },
      modelSnapshot: { ...modelSnapshot, providerCredentialId: credential.id },
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.AskOnEscalation,
      runnerEndpoint: 'http://localhost:3001',
      runnerSessionId: 'runner-session-1',
      runnerCapabilitiesSnapshot,
      status: AgentSessionStatus.Running,
      initialContextSnapshot,
      createdAt: new Date('2026-05-14T11:00:00Z'),
    });

    expect(created).toMatchObject({
      userId: user.id,
      providerCredentialId: credential.id,
      credentialSnapshot: { ...credentialSnapshot, id: credential.id },
      modelSnapshot: { ...modelSnapshot, providerCredentialId: credential.id },
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.AskOnEscalation,
      runnerEndpoint: 'http://localhost:3001',
      runnerSessionId: 'runner-session-1',
      runnerCapabilitiesSnapshot,
      status: AgentSessionStatus.Running,
      initialContextSnapshot,
      endedAt: null,
    });
    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeDefined();
    expect(created.updatedAt).toBeDefined();
    expect(created.updateId).toBeDefined();

    const newer = await sut.create({
      userId: user.id,
      providerCredentialId: credential.id,
      credentialSnapshot: { ...credentialSnapshot, id: credential.id },
      modelSnapshot: { ...modelSnapshot, providerCredentialId: credential.id, model: 'gpt-5.1-mini' },
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: {},
      createdAt: new Date('2026-05-14T12:00:00Z'),
    });

    await expect(sut.getById(user.id, created.id)).resolves.toMatchObject({ id: created.id });
    await expect(sut.getById(otherUser.id, created.id)).resolves.toBeUndefined();
    await expect(sut.getByUserId(otherUser.id)).resolves.toEqual([]);
    await expect(sut.getByUserId(user.id)).resolves.toMatchObject([{ id: newer.id }, { id: created.id }]);

    const endedAt = new Date('2026-05-14T13:00:00Z');
    const updated = await sut.update(user.id, created.id, {
      status: AgentSessionStatus.Completed,
      endedAt,
      runnerSessionId: 'runner-session-2',
      runnerCapabilitiesSnapshot: { protocol: 'pi-agent-v1', finished: true },
    });

    expect(updated).toMatchObject({
      id: created.id,
      status: AgentSessionStatus.Completed,
      endedAt,
      runnerSessionId: 'runner-session-2',
      runnerCapabilitiesSnapshot: { protocol: 'pi-agent-v1', finished: true },
    });

    await expect(sut.update(otherUser.id, created.id, { status: AgentSessionStatus.Failed })).rejects.toThrow();
    await expect(sut.getById(user.id, created.id)).resolves.toMatchObject({
      id: created.id,
      status: AgentSessionStatus.Completed,
    });
  });

  it('sets providerCredentialId null when a credential is deleted while preserving snapshots', async () => {
    const { ctx, credentialRepository, sut } = setup();
    const { user } = await ctx.newUser();
    const credential = await credentialRepository.create({
      userId: user.id,
      providerType: AgentProviderType.Anthropic,
      label: 'Anthropic work',
      baseUrl: null,
      encryptedSecret: 'v1:encrypted',
      models: ['claude-sonnet-4.5'],
      defaultModel: 'claude-sonnet-4.5',
    });
    const savedCredentialSnapshot = {
      id: credential.id,
      providerType: AgentProviderType.Anthropic,
      label: 'Anthropic work',
      baseUrl: null,
      models: ['claude-sonnet-4.5'],
      defaultModel: 'claude-sonnet-4.5',
    };
    const savedModelSnapshot = {
      providerCredentialId: credential.id,
      model: 'claude-sonnet-4.5',
    };
    const session = await sut.create({
      userId: user.id,
      providerCredentialId: credential.id,
      credentialSnapshot: savedCredentialSnapshot,
      modelSnapshot: savedModelSnapshot,
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot,
    });

    await credentialRepository.delete(user.id, credential.id);

    await expect(sut.getById(user.id, session.id)).resolves.toMatchObject({
      id: session.id,
      providerCredentialId: null,
      credentialSnapshot: savedCredentialSnapshot,
      modelSnapshot: savedModelSnapshot,
      permissionPlanSnapshot,
      initialContextSnapshot,
    });
  });

  it('updates title metadata by owner without mutating immutable snapshots', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const session = await sut.create({
      userId: user.id,
      providerCredentialId: null,
      credentialSnapshot,
      modelSnapshot,
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot,
    });

    await expect(sut.updateMetadata(otherUser.id, session.id, { title: 'Wrong owner' })).rejects.toThrow();

    const renamed = await sut.updateMetadata(user.id, session.id, { title: 'Album cleanup' });

    expect(renamed).toMatchObject({
      id: session.id,
      title: 'Album cleanup',
      credentialSnapshot,
      modelSnapshot,
      permissionPlanSnapshot,
      initialContextSnapshot,
      status: session.status,
    });

    const cleared = await sut.updateMetadata(user.id, session.id, { title: null });

    expect(cleared).toMatchObject({ id: session.id, title: null });
  });

  it('round-trips workflow state by owner and clears it with null', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const session = await sut.create({
      userId: user.id,
      providerCredentialId: null,
      credentialSnapshot,
      modelSnapshot,
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot,
    });

    await expect(sut.getById(user.id, session.id)).resolves.toMatchObject({ id: session.id, workflowState: null });

    const workflowState = {
      workflowKind: 'create_recent_trip_album',
      kind: 'selection',
      continuation: {
        kind: 'create_recent_trip_album_candidate_selection',
        createdAtMs: 1_747_216_800_000,
        candidates: [{ index: 1, dedupeKey: 'trip:usa', label: 'Recent trip to USA' }],
      },
    };

    const stored = await sut.setWorkflowState(user.id, session.id, workflowState);
    expect(stored).toMatchObject({ id: session.id, workflowState });
    expect(stored.updateId).not.toBe(session.updateId);

    await expect(sut.getById(user.id, session.id)).resolves.toMatchObject({ id: session.id, workflowState });

    // Ownership is enforced: another user cannot mutate workflow state.
    await expect(sut.setWorkflowState(otherUser.id, session.id, null)).rejects.toThrow();
    await expect(sut.getById(user.id, session.id)).resolves.toMatchObject({ id: session.id, workflowState });

    const cleared = await sut.setWorkflowState(user.id, session.id, null);
    expect(cleared).toMatchObject({ id: session.id, workflowState: null });
    await expect(sut.getById(user.id, session.id)).resolves.toMatchObject({ id: session.id, workflowState: null });
  });

  it('deletes sessions by owner and reports whether a row was removed', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const session = await sut.create({
      userId: user.id,
      providerCredentialId: null,
      credentialSnapshot,
      modelSnapshot,
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot,
    });

    await expect(sut.delete(otherUser.id, session.id)).resolves.toBe(false);
    await expect(sut.getById(user.id, session.id)).resolves.toMatchObject({ id: session.id });

    await expect(sut.delete(user.id, session.id)).resolves.toBe(true);
    await expect(sut.getById(user.id, session.id)).resolves.toBeUndefined();
    await expect(sut.delete(user.id, session.id)).resolves.toBe(false);
  });

  it('conditionally cancels only when current status is cancellable', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const activeEndedAt = new Date('2026-05-14T14:00:00Z');
    const terminalEndedAt = new Date('2026-05-14T15:00:00Z');

    const activeSession = await sut.create({
      userId: user.id,
      providerCredentialId: null,
      credentialSnapshot,
      modelSnapshot,
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      status: AgentSessionStatus.Running,
      initialContextSnapshot,
    });
    const terminalSession = await sut.create({
      userId: user.id,
      providerCredentialId: null,
      credentialSnapshot,
      modelSnapshot,
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      status: AgentSessionStatus.Completed,
      endedAt: terminalEndedAt,
      initialContextSnapshot,
    });

    await expect(sut.cancel(user.id, terminalSession.id, activeEndedAt)).resolves.toBeUndefined();
    await expect(sut.getById(user.id, terminalSession.id)).resolves.toMatchObject({
      id: terminalSession.id,
      status: AgentSessionStatus.Completed,
      endedAt: terminalEndedAt,
    });

    const cancelled = await sut.cancel(user.id, activeSession.id, activeEndedAt);

    expect(cancelled).toMatchObject({
      id: activeSession.id,
      status: AgentSessionStatus.Cancelled,
      endedAt: activeEndedAt,
    });
  });

  it('cascades sessions when the owning user is deleted', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const session = await sut.create({
      userId: user.id,
      providerCredentialId: null,
      credentialSnapshot,
      modelSnapshot,
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot,
    });

    await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();

    await expect(sut.getById(user.id, session.id)).resolves.toBeUndefined();
  });
});
