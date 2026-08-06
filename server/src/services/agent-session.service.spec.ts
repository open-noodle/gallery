import { BadRequestException } from '@nestjs/common';
import { AgentSession } from 'src/database';
import { AgentSessionCreateDto, AgentSessionUpdateDto } from 'src/dtos/agent-session.dto';
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionActivityEventStatus,
  AgentSessionStatus,
} from 'src/enum';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
import { AgentRunnerService } from 'src/services/agent-runner.service';
import { AgentSessionActivityEventService } from 'src/services/agent-session-activity-event.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import {
  AgentInitialContextSnapshot,
  AgentNormalizedPermissionPlanSnapshot,
  AgentPermissionPlanSnapshot,
} from 'src/types/agent-session.types';
import { AuthFactory } from 'test/factories/auth.factory';
import { newUuid } from 'test/small.factory';
import { automock } from 'test/utils';

const now = new Date('2026-05-14T12:00:00.000Z');
const carefulWriteScope = {
  createAlbum: true,
  addAssets: true,
  updateDetails: true,
  setCover: true,
  removeAssets: false,
  createSpace: true,
  addAssetsToSpaces: true,
  addMembersToSpaces: false,
  removeAssetsFromSpaces: false,
  removeMembersFromSpaces: false,
  updateSpaceDetails: true,
  updateSpaceMemberRoles: false,
  editAssets: false,
  favoriteAssets: true,
  archiveAssets: false,
  tagAssets: true,
  updateAssetMetadata: false,
  trashAssets: false,
  createSharedLinks: false,
  shareAlbums: false,
  lockAssets: false,
  deleteContainers: false,
  manageStacks: false,
  managePeople: false,
};
const expandedWriteScope = {
  createAlbum: true,
  addAssets: true,
  updateDetails: true,
  setCover: true,
  removeAssets: true,
  createSpace: true,
  addAssetsToSpaces: true,
  addMembersToSpaces: true,
  removeAssetsFromSpaces: true,
  removeMembersFromSpaces: true,
  updateSpaceDetails: true,
  updateSpaceMemberRoles: true,
  editAssets: true,
  favoriteAssets: true,
  archiveAssets: true,
  tagAssets: true,
  updateAssetMetadata: true,
  trashAssets: true,
  createSharedLinks: false,
  shareAlbums: true,
  lockAssets: false,
  deleteContainers: false,
  manageStacks: true,
  managePeople: true,
};

const carefulPermissionPlan: AgentNormalizedPermissionPlanSnapshot = {
  read: { metadata: true, previews: false, originals: false },
  providerExposure: {
    metadata: true,
    previews: false,
    originals: false,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: false, locked: false },
  writeScope: carefulWriteScope,
  limits: {
    maxAssetsPerToolCall: 1000,
    maxAssetsPerSession: 10_000,
    maxPreviewsPerToolCall: 0,
    maxPreviewsPerSession: 0,
    maxOriginalsPerToolCall: 0,
    maxOriginalsPerSession: 0,
    expiresInMinutes: 120,
  },
};

const visualOrganizerPermissionPlan: AgentNormalizedPermissionPlanSnapshot = {
  read: { metadata: true, previews: true, originals: false },
  providerExposure: {
    metadata: true,
    previews: true,
    originals: false,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: true, locked: false },
  writeScope: expandedWriteScope,
  limits: {
    maxAssetsPerToolCall: 2000,
    maxAssetsPerSession: 20_000,
    maxPreviewsPerToolCall: 100,
    maxPreviewsPerSession: 500,
    maxOriginalsPerToolCall: 0,
    maxOriginalsPerSession: 0,
    expiresInMinutes: 120,
  },
};

const localPowerUserPermissionPlan: AgentNormalizedPermissionPlanSnapshot = {
  read: { metadata: true, previews: true, originals: true },
  providerExposure: {
    metadata: true,
    previews: true,
    originals: true,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: true, locked: false },
  writeScope: expandedWriteScope,
  limits: {
    maxAssetsPerToolCall: 5000,
    maxAssetsPerSession: 50_000,
    maxPreviewsPerToolCall: 100,
    maxPreviewsPerSession: 500,
    maxOriginalsPerToolCall: 25,
    maxOriginalsPerSession: 50,
    expiresInMinutes: 120,
  },
};

const makeCredential = (overrides: Partial<Awaited<ReturnType<AgentProviderCredentialService['getById']>>> = {}) => ({
  id: newUuid(),
  providerType: AgentProviderType.OpenAI,
  label: 'OpenAI personal',
  baseUrl: null,
  models: ['gpt-5.1', 'gpt-5.1-mini'],
  defaultModel: 'gpt-5.1',
  createdAt: now,
  updatedAt: now,
  lastUsedAt: null,
  ...overrides,
});

const makeCreateDto = (overrides: Partial<AgentSessionCreateDto> = {}): AgentSessionCreateDto => ({
  providerCredentialId: newUuid(),
  model: 'gpt-5.1',
  permissionPreset: AgentPermissionPreset.Careful,
  approvalMode: AgentApprovalMode.Strict,
  ...overrides,
});

const makeSession = (overrides: Partial<AgentSession> = {}): AgentSession => {
  const providerCredentialId = newUuid();
  const initialContextSnapshot: AgentInitialContextSnapshot = { source: 'manual-test' };

  return {
    id: newUuid(),
    userId: newUuid(),
    providerCredentialId,
    credentialSnapshot: {
      id: providerCredentialId,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1', 'gpt-5.1-mini'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { providerCredentialId, model: 'gpt-5.1' },
    permissionPreset: AgentPermissionPreset.Careful,
    permissionPlanSnapshot: carefulPermissionPlan,
    approvalMode: AgentApprovalMode.Strict,
    runnerEndpoint: 'https://runner.example.com/sessions',
    runnerSessionId: 'runner-session-id',
    runnerCapabilitiesSnapshot: { tools: ['album.create'] },
    workflowState: null,
    status: AgentSessionStatus.Created,
    initialContextSnapshot,
    title: null,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    updateId: newUuid(),
    ...overrides,
  };
};

describe(AgentSessionService.name, () => {
  let sut: AgentSessionService;
  let repository: ReturnType<typeof automock<AgentSessionRepository>>;
  let credentialService: ReturnType<typeof automock<AgentProviderCredentialService>>;
  let agentRunnerService: ReturnType<typeof automock<AgentRunnerService>>;
  let activityEventService: ReturnType<typeof automock<AgentSessionActivityEventService>>;

  beforeEach(() => {
    repository = automock(AgentSessionRepository, { args: [{} as never] });
    credentialService = automock(AgentProviderCredentialService, { args: [{} as never, {} as never] });
    agentRunnerService = automock(AgentRunnerService);
    activityEventService = automock(AgentSessionActivityEventService, {
      args: [{} as never, {} as never, {} as never],
    });
    credentialService.getSecret.mockResolvedValue('sk-session-secret');
    sut = new AgentSessionService(repository, credentialService, agentRunnerService, activityEventService);
  });

  const mockSuccessfulRunnerHandoff = (session: AgentSession) => {
    const runnerSession = {
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: `stub-${session.id}`,
      runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
    };
    const runningSession = makeSession({
      ...session,
      status: AgentSessionStatus.Running,
      runnerEndpoint: runnerSession.runnerEndpoint,
      runnerSessionId: runnerSession.runnerSessionId,
      runnerCapabilitiesSnapshot: runnerSession.runnerCapabilitiesSnapshot,
    });

    agentRunnerService.createSession.mockResolvedValue(runnerSession);
    repository.markRunningFromCreated.mockResolvedValue(runningSession);

    return { runnerSession, runningSession };
  };

  it('creates a session with credential, model, permission, approval, and initial context snapshots', async () => {
    const auth = AuthFactory.create();
    const providerCredentialId = newUuid();
    const credential = makeCredential({ id: providerCredentialId, baseUrl: 'https://api.example.com/v1' });
    const dto = makeCreateDto({
      providerCredentialId,
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.PlanOnly,
      runnerEndpoint: 'https://runner.example.com/sessions',
      initialContext: { albumId: newUuid(), selectedAssets: [newUuid()] },
    });
    const createdSession = makeSession({
      userId: auth.user.id,
      providerCredentialId,
      credentialSnapshot: {
        id: credential.id,
        providerType: credential.providerType,
        label: credential.label,
        baseUrl: credential.baseUrl,
        models: credential.models,
        defaultModel: credential.defaultModel,
      },
      modelSnapshot: { providerCredentialId, model: dto.model },
      permissionPreset: dto.permissionPreset,
      permissionPlanSnapshot: visualOrganizerPermissionPlan,
      approvalMode: dto.approvalMode,
      runnerEndpoint: dto.runnerEndpoint,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: dto.initialContext,
      title: null,
    });

    credentialService.getById.mockResolvedValue(credential);
    repository.create.mockResolvedValue(createdSession);
    const { runnerSession, runningSession } = mockSuccessfulRunnerHandoff(createdSession);

    const result = await sut.create(auth, dto);

    expect(credentialService.getById).toHaveBeenCalledWith(auth, providerCredentialId);
    expect(repository.create).toHaveBeenCalledWith({
      userId: auth.user.id,
      providerCredentialId,
      credentialSnapshot: {
        id: credential.id,
        providerType: credential.providerType,
        label: credential.label,
        baseUrl: credential.baseUrl,
        models: credential.models,
        defaultModel: credential.defaultModel,
      },
      modelSnapshot: { providerCredentialId, model: dto.model },
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      permissionPlanSnapshot: visualOrganizerPermissionPlan,
      approvalMode: AgentApprovalMode.PlanOnly,
      status: AgentSessionStatus.Created,
      runnerEndpoint: 'https://runner.example.com/sessions',
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: dto.initialContext,
      title: null,
    });
    expect(agentRunnerService.createSession).toHaveBeenCalledWith({
      userId: auth.user.id,
      gallerySessionId: createdSession.id,
      credential: { ...createdSession.credentialSnapshot, secret: 'sk-session-secret' },
      model: dto.model,
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      permissionPlan: createdSession.permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.PlanOnly,
      initialContext: createdSession.initialContextSnapshot,
    });
    expect(repository.markRunningFromCreated).toHaveBeenCalledWith(auth.user.id, createdSession.id, {
      status: AgentSessionStatus.Running,
      runnerEndpoint: runnerSession.runnerEndpoint,
      runnerSessionId: runnerSession.runnerSessionId,
      runnerCapabilitiesSnapshot: runnerSession.runnerCapabilitiesSnapshot,
    });
    expect(result).toEqual({
      id: runningSession.id,
      status: AgentSessionStatus.Running,
      title: runningSession.title,
      providerCredentialId,
      credentialSnapshot: runningSession.credentialSnapshot,
      modelSnapshot: runningSession.modelSnapshot,
      permissionPreset: runningSession.permissionPreset,
      permissionPlanSnapshot: runningSession.permissionPlanSnapshot,
      approvalMode: runningSession.approvalMode,
      runnerEndpoint: runnerSession.runnerEndpoint,
      runnerSessionId: runnerSession.runnerSessionId,
      runnerCapabilitiesSnapshot: runnerSession.runnerCapabilitiesSnapshot,
      initialContextSnapshot: runningSession.initialContextSnapshot,
      createdAt: runningSession.createdAt,
      updatedAt: runningSession.updatedAt,
      endedAt: runningSession.endedAt,
    });
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('updateId');
  });

  it('custom session requires and stores a full custom permission plan', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential();
    const dto = makeCreateDto({
      providerCredentialId: credential.id,
      permissionPreset: AgentPermissionPreset.Custom,
      permissionPlan: localPowerUserPermissionPlan,
    });
    const createdSession = makeSession({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      permissionPreset: AgentPermissionPreset.Custom,
      permissionPlanSnapshot: localPowerUserPermissionPlan,
    });

    credentialService.getById.mockResolvedValue(credential);
    repository.create.mockResolvedValue(createdSession);
    const { runnerSession } = mockSuccessfulRunnerHandoff(createdSession);

    const result = await sut.create(auth, dto);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionPreset: AgentPermissionPreset.Custom,
        permissionPlanSnapshot: localPowerUserPermissionPlan,
      }),
    );
    expect(result).toMatchObject({
      status: AgentSessionStatus.Running,
      runnerEndpoint: runnerSession.runnerEndpoint,
      runnerSessionId: runnerSession.runnerSessionId,
      runnerCapabilitiesSnapshot: runnerSession.runnerCapabilitiesSnapshot,
    });
  });

  it('preset permission snapshots include the expanded write-scope decisions', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.Careful].writeScope).toEqual(carefulWriteScope);
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.Careful].writeScope.updateAssetMetadata).toBe(
      false,
    );
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer].writeScope).toEqual(
      expandedWriteScope,
    );
    expect(
      AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer].writeScope.updateAssetMetadata,
    ).toBe(true);
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser].writeScope).toEqual({
      ...expandedWriteScope,
      // LocalPowerUser is the only preset that grants the outward-facing share scope.
      createSharedLinks: true,
      // LocalPowerUser is the only preset that grants the lock-assets scope.
      lockAssets: true,
      // LocalPowerUser is the only preset that grants the delete-containers scope.
      deleteContainers: true,
    });
    expect(
      AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser].writeScope.updateAssetMetadata,
    ).toBe(true);
    expect(
      AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser].writeScope.createSharedLinks,
    ).toBe(true);
  });

  it('shareAlbums write-scope is false for Careful, true for VisualOrganizer, true for LocalPowerUser', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.Careful].writeScope.shareAlbums).toBe(false);
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer].writeScope.shareAlbums).toBe(
      true,
    );
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser].writeScope.shareAlbums).toBe(
      true,
    );
  });

  it('lockAssets write-scope is false for Careful, false for VisualOrganizer, true for LocalPowerUser', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.Careful].writeScope.lockAssets).toBe(false);
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer].writeScope.lockAssets).toBe(
      false,
    );
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser].writeScope.lockAssets).toBe(
      true,
    );
  });

  it('deleteContainers write-scope is false for Careful, false for VisualOrganizer, true for LocalPowerUser', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.Careful].writeScope.deleteContainers).toBe(
      false,
    );
    expect(
      AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer].writeScope.deleteContainers,
    ).toBe(false);
    expect(
      AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser].writeScope.deleteContainers,
    ).toBe(true);
  });

  it('dangerously-skip-permissions approval mode is accepted and forwarded to the runner', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential();
    const dto = makeCreateDto({
      providerCredentialId: credential.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
    });
    const createdSession = makeSession({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
    });

    credentialService.getById.mockResolvedValue(credential);
    repository.create.mockResolvedValue(createdSession);
    mockSuccessfulRunnerHandoff(createdSession);

    await expect(sut.create(auth, dto)).resolves.toMatchObject({
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
    });
    expect(agentRunnerService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
        permissionPlan: carefulPermissionPlan,
      }),
    );
  });

  it('backfills missing preview and original session limits for legacy custom permission plans', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential();
    const legacyPermissionPlan = structuredClone(localPowerUserPermissionPlan);
    delete legacyPermissionPlan.limits.maxPreviewsPerSession;
    delete legacyPermissionPlan.limits.maxOriginalsPerSession;
    const expectedPermissionPlan: AgentNormalizedPermissionPlanSnapshot = {
      ...legacyPermissionPlan,
      limits: {
        ...legacyPermissionPlan.limits,
        maxPreviewsPerSession: legacyPermissionPlan.limits.maxPreviewsPerToolCall,
        maxOriginalsPerSession: legacyPermissionPlan.limits.maxOriginalsPerToolCall,
      },
    };
    const dto = makeCreateDto({
      providerCredentialId: credential.id,
      permissionPreset: AgentPermissionPreset.Custom,
      permissionPlan: legacyPermissionPlan,
    });
    const createdSession = makeSession({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      permissionPreset: AgentPermissionPreset.Custom,
      permissionPlanSnapshot: expectedPermissionPlan,
    });

    credentialService.getById.mockResolvedValue(credential);
    repository.create.mockResolvedValue(createdSession);
    mockSuccessfulRunnerHandoff(createdSession);

    await sut.create(auth, dto);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionPlanSnapshot: expectedPermissionPlan,
      }),
    );
    expect(agentRunnerService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: auth.user.id,
        permissionPlan: expectedPermissionPlan,
      }),
    );
  });

  it('normalizes missing expanded write-scope keys to false for legacy custom permission plans before runner handoff', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential();
    const legacyPermissionPlan: AgentPermissionPlanSnapshot = structuredClone(localPowerUserPermissionPlan);
    legacyPermissionPlan.writeScope = {
      createAlbum: true,
      addAssets: true,
      updateDetails: true,
      setCover: true,
    } as AgentPermissionPlanSnapshot['writeScope'];
    const expectedPermissionPlan: AgentNormalizedPermissionPlanSnapshot = {
      ...legacyPermissionPlan,
      writeScope: {
        createAlbum: true,
        addAssets: true,
        updateDetails: true,
        setCover: true,
        removeAssets: false,
        createSpace: false,
        addAssetsToSpaces: false,
        addMembersToSpaces: false,
        removeAssetsFromSpaces: false,
        removeMembersFromSpaces: false,
        updateSpaceDetails: false,
        updateSpaceMemberRoles: false,
        editAssets: false,
        favoriteAssets: false,
        archiveAssets: false,
        tagAssets: false,
        updateAssetMetadata: false,
        trashAssets: false,
        createSharedLinks: false,
        shareAlbums: false,
        lockAssets: false,
        deleteContainers: false,
        manageStacks: false,
        managePeople: false,
      },
    };
    const dto = makeCreateDto({
      providerCredentialId: credential.id,
      permissionPreset: AgentPermissionPreset.Custom,
      permissionPlan: legacyPermissionPlan as AgentSessionCreateDto['permissionPlan'],
    });
    const createdSession = makeSession({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      permissionPreset: AgentPermissionPreset.Custom,
      permissionPlanSnapshot: expectedPermissionPlan,
    });

    credentialService.getById.mockResolvedValue(credential);
    repository.create.mockResolvedValue(createdSession);
    mockSuccessfulRunnerHandoff(createdSession);

    await sut.create(auth, dto);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionPlanSnapshot: expectedPermissionPlan,
      }),
    );
    expect(agentRunnerService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: auth.user.id,
        permissionPlan: expectedPermissionPlan,
      }),
    );
  });

  it('rejects custom session without permissionPlan before credential lookup/repo create', async () => {
    const auth = AuthFactory.create();

    await expect(
      sut.create(auth, makeCreateDto({ permissionPreset: AgentPermissionPreset.Custom }) as AgentSessionCreateDto),
    ).rejects.toThrow('permissionPlan is required when permissionPreset is custom');

    expect(credentialService.getById).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(agentRunnerService.createSession).not.toHaveBeenCalled();
  });

  it('rejects non-custom session with permissionPlan before credential lookup/repo create', async () => {
    const auth = AuthFactory.create();

    await expect(
      sut.create(
        auth,
        makeCreateDto({
          permissionPreset: AgentPermissionPreset.Careful,
          permissionPlan: localPowerUserPermissionPlan,
        }),
      ),
    ).rejects.toThrow('permissionPlan is only accepted when permissionPreset is custom');

    expect(credentialService.getById).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(agentRunnerService.createSession).not.toHaveBeenCalled();
  });

  it('defaults runnerEndpoint to null, runnerCapabilitiesSnapshot to null, initialContextSnapshot to {}', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential();
    const createdSession = makeSession({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: {},
    });

    credentialService.getById.mockResolvedValue(credential);
    repository.create.mockResolvedValue(createdSession);
    const { runnerSession } = mockSuccessfulRunnerHandoff(createdSession);

    const result = await sut.create(auth, makeCreateDto({ providerCredentialId: credential.id }));

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerEndpoint: null,
        runnerCapabilitiesSnapshot: null,
        initialContextSnapshot: {},
      }),
    );
    expect(repository.markRunningFromCreated).toHaveBeenCalledWith(
      auth.user.id,
      createdSession.id,
      expect.objectContaining({
        status: AgentSessionStatus.Running,
        runnerEndpoint: 'http://agent-runner:4477',
      }),
    );
    expect(result).toMatchObject({
      status: AgentSessionStatus.Running,
      runnerEndpoint: runnerSession.runnerEndpoint,
      runnerSessionId: runnerSession.runnerSessionId,
      runnerCapabilitiesSnapshot: runnerSession.runnerCapabilitiesSnapshot,
    });
  });

  it('starts a configured runner session and returns a running Gallery session', async () => {
    const auth = AuthFactory.create();
    const credentialId = '00000000-0000-4000-8000-000000000001';
    const credentialResponse = makeCredential({
      id: credentialId,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    });
    const createdSession = makeSession({
      id: '00000000-0000-4000-8000-000000000100',
      userId: auth.user.id,
      providerCredentialId: credentialId,
      status: AgentSessionStatus.Created,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: {},
    });
    const runningSession = makeSession({
      ...createdSession,
      status: AgentSessionStatus.Running,
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
    });

    credentialService.getById.mockResolvedValue(credentialResponse);
    repository.create.mockResolvedValue(createdSession);
    repository.markRunningFromCreated.mockResolvedValue(runningSession);
    agentRunnerService.createSession.mockResolvedValue({
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
    });

    await expect(
      sut.create(auth, {
        providerCredentialId: credentialId,
        model: 'gpt-5.1',
        permissionPreset: AgentPermissionPreset.Careful,
        approvalMode: AgentApprovalMode.Strict,
      }),
    ).resolves.toMatchObject({
      id: createdSession.id,
      status: AgentSessionStatus.Running,
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
    });
    expect(agentRunnerService.createSession).toHaveBeenCalledWith({
      userId: auth.user.id,
      gallerySessionId: createdSession.id,
      credential: { ...createdSession.credentialSnapshot, secret: 'sk-session-secret' },
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlan: createdSession.permissionPlanSnapshot,
      approvalMode: AgentApprovalMode.Strict,
      initialContext: {},
    });
    expect(repository.markRunningFromCreated).toHaveBeenCalledWith(auth.user.id, createdSession.id, {
      status: AgentSessionStatus.Running,
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
    });
  });

  it('passes decrypted provider secret to the runner without storing it in session snapshots', async () => {
    const auth = AuthFactory.create();
    const providerCredentialId = newUuid();
    const credential = makeCredential({
      id: providerCredentialId,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    });
    const dto: AgentSessionCreateDto = {
      providerCredentialId,
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.Careful,
      approvalMode: AgentApprovalMode.Strict,
    };
    const created = makeSession({
      userId: auth.user.id,
      providerCredentialId,
      credentialSnapshot: {
        id: providerCredentialId,
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
        baseUrl: null,
        models: ['gpt-5.1'],
        defaultModel: 'gpt-5.1',
      },
      modelSnapshot: { providerCredentialId, model: 'gpt-5.1' },
    });
    const running = makeSession({
      ...created,
      status: AgentSessionStatus.Running,
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'pi-session-1',
      runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: [], models: ['gpt-5.1'] },
    });

    credentialService.getById.mockResolvedValue(credential);
    credentialService.getSecret.mockResolvedValue('sk-session-secret');
    repository.create.mockResolvedValue(created);
    agentRunnerService.createSession.mockResolvedValue({
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'pi-session-1',
      runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: [], models: ['gpt-5.1'] },
    });
    repository.markRunningFromCreated.mockResolvedValue(running);

    await expect(sut.create(auth, dto)).resolves.toMatchObject({
      id: running.id,
      credentialSnapshot: expect.not.objectContaining({ secret: expect.anything() }),
      runnerSessionId: 'pi-session-1',
    });

    expect(credentialService.getSecret).toHaveBeenCalledWith(auth, providerCredentialId);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialSnapshot: expect.not.objectContaining({ secret: expect.anything() }),
      }),
    );
    expect(agentRunnerService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: auth.user.id,
        credential: {
          id: providerCredentialId,
          providerType: AgentProviderType.OpenAI,
          label: 'OpenAI personal',
          baseUrl: null,
          models: ['gpt-5.1'],
          defaultModel: 'gpt-5.1',
          secret: 'sk-session-secret',
        },
      }),
    );
  });

  it('does not create a Gallery session when provider secret decryption fails', async () => {
    const auth = AuthFactory.create();
    const providerCredentialId = newUuid();
    const credential = makeCredential({ id: providerCredentialId, models: ['gpt-5.1'] });
    const dto: AgentSessionCreateDto = {
      providerCredentialId,
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.Careful,
      approvalMode: AgentApprovalMode.Strict,
    };
    const error = new Error('decrypt failed');

    credentialService.getById.mockResolvedValue(credential);
    credentialService.getSecret.mockRejectedValue(error);

    await expect(sut.create(auth, dto)).rejects.toBe(error);

    expect(repository.create).not.toHaveBeenCalled();
    expect(agentRunnerService.createSession).not.toHaveBeenCalled();
    expect(repository.markFailedFromCreated).not.toHaveBeenCalled();
  });

  it('marks the created session failed when runner start fails', async () => {
    const auth = AuthFactory.create();
    const credentialId = '00000000-0000-4000-8000-000000000001';
    const credentialResponse = makeCredential({
      id: credentialId,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    });
    const createdSession = makeSession({
      id: '00000000-0000-4000-8000-000000000100',
      userId: auth.user.id,
      providerCredentialId: credentialId,
      status: AgentSessionStatus.Created,
    });

    credentialService.getById.mockResolvedValue(credentialResponse);
    repository.create.mockResolvedValue(createdSession);
    repository.markFailedFromCreated.mockResolvedValue(
      makeSession({ ...createdSession, status: AgentSessionStatus.Failed, endedAt: now }),
    );
    agentRunnerService.createSession.mockRejectedValue(new BadRequestException('Agent runner is not configured'));

    await expect(
      sut.create(auth, {
        providerCredentialId: credentialId,
        model: 'gpt-5.1',
        permissionPreset: AgentPermissionPreset.Careful,
        approvalMode: AgentApprovalMode.Strict,
      }),
    ).rejects.toThrow('Agent runner is not configured');
    expect(repository.markFailedFromCreated).toHaveBeenCalledWith(auth.user.id, createdSession.id, expect.any(Date));
  });

  it('returns the current session when a concurrent cancel wins before the running transition', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential();
    const createdSession = makeSession({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      status: AgentSessionStatus.Created,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
    });
    const cancelledSession = makeSession({
      ...createdSession,
      status: AgentSessionStatus.Cancelled,
      endedAt: now,
    });
    const runnerSession = {
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
    };

    credentialService.getById.mockResolvedValue(credential);
    repository.create.mockResolvedValue(createdSession);
    agentRunnerService.createSession.mockResolvedValue(runnerSession);
    repository.markRunningFromCreated.mockResolvedValue(
      void 0 as Awaited<ReturnType<typeof repository.markRunningFromCreated>>,
    );
    repository.getById.mockResolvedValue(cancelledSession);

    await expect(sut.create(auth, makeCreateDto({ providerCredentialId: credential.id }))).resolves.toMatchObject({
      id: createdSession.id,
      status: AgentSessionStatus.Cancelled,
    });
    expect(repository.markRunningFromCreated).toHaveBeenCalledWith(auth.user.id, createdSession.id, {
      status: AgentSessionStatus.Running,
      runnerEndpoint: runnerSession.runnerEndpoint,
      runnerSessionId: runnerSession.runnerSessionId,
      runnerCapabilitiesSnapshot: runnerSession.runnerCapabilitiesSnapshot,
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('propagates a running transition failure without marking the session failed', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential();
    const createdSession = makeSession({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      status: AgentSessionStatus.Created,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
    });
    const runnerSession = {
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'stub-00000000-0000-4000-8000-000000000100',
      runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: ['echo'], models: [] },
    };
    const updateError = new Error('failed to mark session running');

    credentialService.getById.mockResolvedValue(credential);
    repository.create.mockResolvedValue(createdSession);
    agentRunnerService.createSession.mockResolvedValue(runnerSession);
    repository.markRunningFromCreated.mockRejectedValueOnce(updateError).mockResolvedValueOnce(
      makeSession({
        ...createdSession,
        status: AgentSessionStatus.Failed,
        endedAt: now,
      }),
    );

    await expect(sut.create(auth, makeCreateDto({ providerCredentialId: credential.id }))).rejects.toBe(updateError);
    expect(repository.markRunningFromCreated).toHaveBeenCalledTimes(1);
    expect(repository.markRunningFromCreated).toHaveBeenCalledWith(auth.user.id, createdSession.id, {
      status: AgentSessionStatus.Running,
      runnerEndpoint: runnerSession.runnerEndpoint,
      runnerSessionId: runnerSession.runnerSessionId,
      runnerCapabilitiesSnapshot: runnerSession.runnerCapabilitiesSnapshot,
    });
    expect(repository.markFailedFromCreated).not.toHaveBeenCalled();
  });

  it('does not mark failed when a concurrent cancel wins before runner failure handling', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential();
    const createdSession = makeSession({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      status: AgentSessionStatus.Created,
    });
    const runnerError = new BadRequestException('Agent runner is not configured');

    credentialService.getById.mockResolvedValue(credential);
    repository.create.mockResolvedValue(createdSession);
    agentRunnerService.createSession.mockRejectedValue(runnerError);
    repository.markFailedFromCreated.mockResolvedValue(
      void 0 as Awaited<ReturnType<typeof repository.markFailedFromCreated>>,
    );

    await expect(sut.create(auth, makeCreateDto({ providerCredentialId: credential.id }))).rejects.toBe(runnerError);
    expect(repository.markFailedFromCreated).toHaveBeenCalledWith(auth.user.id, createdSession.id, expect.any(Date));
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('preserves the runner error when marking failed throws', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential();
    const createdSession = makeSession({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      status: AgentSessionStatus.Created,
    });
    const runnerError = new BadRequestException('Agent runner is not configured');

    credentialService.getById.mockResolvedValue(credential);
    repository.create.mockResolvedValue(createdSession);
    agentRunnerService.createSession.mockRejectedValue(runnerError);
    repository.markFailedFromCreated.mockRejectedValue(new Error('failed to mark session failed'));

    await expect(sut.create(auth, makeCreateDto({ providerCredentialId: credential.id }))).rejects.toBe(runnerError);
    expect(repository.markFailedFromCreated).toHaveBeenCalledWith(auth.user.id, createdSession.id, expect.any(Date));
  });

  it('does not create when credential lookup fails', async () => {
    const auth = AuthFactory.create();
    const error = new BadRequestException('Agent provider credential not found');

    credentialService.getById.mockRejectedValue(error);

    await expect(sut.create(auth, makeCreateDto())).rejects.toBe(error);

    expect(repository.create).not.toHaveBeenCalled();
    expect(agentRunnerService.createSession).not.toHaveBeenCalled();
  });

  it('rejects selected model not listed on credential when credential.models has constraints', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({ models: ['gpt-5.1-mini'] });

    credentialService.getById.mockResolvedValue(credential);

    await expect(
      sut.create(auth, makeCreateDto({ providerCredentialId: credential.id, model: 'gpt-5.1' })),
    ).rejects.toThrow('Model is not listed for the selected credential');
    expect(repository.create).not.toHaveBeenCalled();
    expect(agentRunnerService.createSession).not.toHaveBeenCalled();
  });

  it('allows any model when credential.models is empty', async () => {
    const auth = AuthFactory.create();
    const credential = makeCredential({ models: [] });
    const createdSession = makeSession({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      modelSnapshot: { providerCredentialId: credential.id, model: 'custom-model' },
    });

    credentialService.getById.mockResolvedValue(credential);
    repository.create.mockResolvedValue(createdSession);
    const { runnerSession } = mockSuccessfulRunnerHandoff(createdSession);

    const result = await sut.create(
      auth,
      makeCreateDto({ providerCredentialId: credential.id, model: 'custom-model' }),
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSnapshot: { providerCredentialId: credential.id, model: 'custom-model' },
      }),
    );
    expect(result).toMatchObject({
      status: AgentSessionStatus.Running,
      runnerEndpoint: runnerSession.runnerEndpoint,
      runnerSessionId: runnerSession.runnerSessionId,
      runnerCapabilitiesSnapshot: runnerSession.runnerCapabilitiesSnapshot,
    });
  });

  it('lists sessions for authenticated user without re-reading credentials', async () => {
    const auth = AuthFactory.create();
    const sessions = [makeSession({ userId: auth.user.id }), makeSession({ userId: auth.user.id })];

    repository.getByUserId.mockResolvedValue(sessions);

    const result = await sut.getAll(auth);

    expect(repository.getByUserId).toHaveBeenCalledWith(auth.user.id);
    expect(credentialService.getById).not.toHaveBeenCalled();
    expect(result).toEqual(
      sessions.map(({ userId: _userId, updateId: _updateId, workflowState: _workflowState, ...session }) => session),
    );
  });

  it('gets owned session preserving stored snapshots without consulting current credential metadata', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      credentialSnapshot: {
        id: newUuid(),
        providerType: AgentProviderType.OpenAICompatible,
        label: 'Archived gateway label',
        baseUrl: 'https://old-gateway.example.com/v1',
        models: ['archived-model'],
        defaultModel: 'archived-model',
      },
      permissionPlanSnapshot: localPowerUserPermissionPlan,
      initialContextSnapshot: { originalPrompt: 'organize favorites' },
      title: 'Renamed chat',
    });

    repository.getById.mockResolvedValue(session);

    const result = await sut.getById(auth, session.id);

    expect(repository.getById).toHaveBeenCalledWith(auth.user.id, session.id);
    expect(credentialService.getById).not.toHaveBeenCalled();
    expect(result.credentialSnapshot).toEqual(session.credentialSnapshot);
    expect(result.permissionPlanSnapshot).toEqual(localPowerUserPermissionPlan);
    expect(result.initialContextSnapshot).toEqual({ originalPrompt: 'organize favorites' });
    expect(result.title).toBe('Renamed chat');
  });

  it('normalizes missing expanded write-scope keys to false when returning legacy stored sessions', async () => {
    const auth = AuthFactory.create();
    const legacyPermissionPlan: AgentPermissionPlanSnapshot = structuredClone(localPowerUserPermissionPlan);
    legacyPermissionPlan.writeScope = {
      createAlbum: true,
      addAssets: true,
      updateDetails: true,
      setCover: true,
    } as AgentPermissionPlanSnapshot['writeScope'];
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: legacyPermissionPlan });

    repository.getById.mockResolvedValue(session);

    const result = await sut.getById(auth, session.id);

    expect(result.permissionPlanSnapshot.writeScope).toEqual({
      createAlbum: true,
      addAssets: true,
      updateDetails: true,
      setCover: true,
      removeAssets: false,
      createSpace: false,
      addAssetsToSpaces: false,
      addMembersToSpaces: false,
      removeAssetsFromSpaces: false,
      removeMembersFromSpaces: false,
      updateSpaceDetails: false,
      updateSpaceMemberRoles: false,
      editAssets: false,
      favoriteAssets: false,
      archiveAssets: false,
      tagAssets: false,
      updateAssetMetadata: false,
      trashAssets: false,
      createSharedLinks: false,
      shareAlbums: false,
      lockAssets: false,
      deleteContainers: false,
      manageStacks: false,
      managePeople: false,
    });
  });

  it('renames an owned session with trimmed title metadata', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const updatedSession = makeSession({ ...session, title: 'Album cleanup' });
    const dto: AgentSessionUpdateDto = { title: '  Album cleanup  ' };

    repository.getById.mockResolvedValue(session);
    repository.updateMetadata.mockResolvedValue(updatedSession);

    const result = await sut.update(auth, session.id, dto);

    expect(repository.getById).toHaveBeenCalledWith(auth.user.id, session.id);
    expect(repository.updateMetadata).toHaveBeenCalledWith(auth.user.id, session.id, { title: 'Album cleanup' });
    expect(result.title).toBe('Album cleanup');
  });

  it('clears an owned session title when update title is null', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, title: 'Existing title' });
    const updatedSession = makeSession({ ...session, title: null });

    repository.getById.mockResolvedValue(session);
    repository.updateMetadata.mockResolvedValue(updatedSession);

    const result = await sut.update(auth, session.id, { title: null });

    expect(repository.updateMetadata).toHaveBeenCalledWith(auth.user.id, session.id, { title: null });
    expect(result.title).toBeNull();
  });

  it('deletes an owned session', async () => {
    const auth = AuthFactory.create();
    const id = newUuid();

    repository.delete.mockResolvedValue(true);

    await expect(sut.delete(auth, id)).resolves.toBeUndefined();

    expect(repository.delete).toHaveBeenCalledWith(auth.user.id, id);
  });

  it('throws when deleting a missing or cross-user session', async () => {
    const auth = AuthFactory.create();
    const id = newUuid();

    repository.delete.mockResolvedValue(false);

    await expect(sut.delete(auth, id)).rejects.toThrow('Agent session not found');
  });

  it("throws BadRequestException('Agent session not found') for missing session", async () => {
    const auth = AuthFactory.create();
    const id = newUuid();

    repository.getById.mockResolvedValue(void 0);

    await expect(sut.getById(auth, id)).rejects.toThrow(BadRequestException);
    await expect(sut.getById(auth, id)).rejects.toThrow('Agent session not found');
  });

  it.each([
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ])('cancels active %s sessions and sets endedAt', async (status) => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status });
    const cancelled = makeSession({ ...session, status: AgentSessionStatus.Cancelled, endedAt: now });

    repository.getById.mockResolvedValue(session);
    repository.cancel.mockResolvedValue(cancelled);

    const result = await sut.cancel(auth, session.id);

    expect(repository.cancel).toHaveBeenCalledWith(auth.user.id, session.id, expect.any(Date));
    expect(repository.update).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentSessionStatus.Cancelled);
    expect(result.endedAt).toEqual(now);
  });

  it('cancels the active runner session after the database session is cancelled', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'runner-session-1',
    });
    const cancelled = makeSession({ ...session, status: AgentSessionStatus.Cancelled, endedAt: now });

    repository.getById.mockResolvedValue(session);
    repository.cancel.mockResolvedValue(cancelled);

    await sut.cancel(auth, session.id);

    expect(agentRunnerService.cancelSession).toHaveBeenCalledWith({
      runnerEndpoint: 'http://agent-runner:4477',
      runnerSessionId: 'runner-session-1',
    });
  });

  it('returns cancelled session when a concurrent duplicate cancel wins the update race', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Running });
    const cancelled = makeSession({ ...session, status: AgentSessionStatus.Cancelled, endedAt: now });

    repository.getById.mockResolvedValueOnce(session).mockResolvedValueOnce(cancelled);
    repository.cancel.mockResolvedValue(void 0);

    const result = await sut.cancel(auth, session.id);

    expect(repository.cancel).toHaveBeenCalledWith(auth.user.id, session.id, expect.any(Date));
    expect(repository.getById).toHaveBeenCalledTimes(2);
    expect(repository.update).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentSessionStatus.Cancelled);
    expect(result.endedAt).toEqual(now);
  });

  it.each([AgentSessionStatus.Applying, AgentSessionStatus.Completed, AgentSessionStatus.Failed])(
    'rejects cancelling when the conditional update loses a race to %s',
    async (status) => {
      const auth = AuthFactory.create();
      const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Running });
      const terminalSession = makeSession({ ...session, status });

      repository.getById.mockResolvedValueOnce(session).mockResolvedValueOnce(terminalSession);
      repository.cancel.mockResolvedValue(void 0);

      await expect(sut.cancel(auth, session.id)).rejects.toThrow(
        'Agent session cannot be cancelled in its current state',
      );
      expect(repository.cancel).toHaveBeenCalledWith(auth.user.id, session.id, expect.any(Date));
      expect(repository.getById).toHaveBeenCalledTimes(2);
      expect(repository.update).not.toHaveBeenCalled();
    },
  );

  it('returns already-cancelled session without updating again', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Cancelled, endedAt: now });

    repository.getById.mockResolvedValue(session);

    const result = await sut.cancel(auth, session.id);

    expect(repository.cancel).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentSessionStatus.Cancelled);
    expect(result.endedAt).toEqual(now);
  });

  it.each([AgentSessionStatus.Applying, AgentSessionStatus.Completed, AgentSessionStatus.Failed])(
    'rejects cancelling %s with current-state error',
    async (status) => {
      const auth = AuthFactory.create();
      const session = makeSession({ userId: auth.user.id, status });

      repository.getById.mockResolvedValue(session);

      await expect(sut.cancel(auth, session.id)).rejects.toThrow(
        'Agent session cannot be cancelled in its current state',
      );
      expect(repository.cancel).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    },
  );

  it('marks open lifecycle events skipped on cancel', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Running });
    const cancelled = makeSession({ ...session, status: AgentSessionStatus.Cancelled, endedAt: now });

    repository.getById.mockResolvedValue(session);
    repository.cancel.mockResolvedValue(cancelled);

    await sut.cancel(auth, session.id);

    expect(activityEventService.closeOpenLifecycleEvents).toHaveBeenCalledWith(
      auth.user.id,
      session.id,
      AgentSessionActivityEventStatus.Skipped,
    );
  });

  it('cancel succeeds even when closing activity events fails', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Running });
    const cancelled = makeSession({ ...session, status: AgentSessionStatus.Cancelled, endedAt: now });

    activityEventService.closeOpenLifecycleEvents.mockRejectedValue(new Error('boom'));
    repository.getById.mockResolvedValue(session);
    repository.cancel.mockResolvedValue(cancelled);

    await expect(sut.cancel(auth, session.id)).resolves.toBeDefined();
  });

  it('does not close lifecycle events when the session is already cancelled', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Cancelled, endedAt: now });

    repository.getById.mockResolvedValue(session);

    await sut.cancel(auth, session.id);

    expect(activityEventService.closeOpenLifecycleEvents).not.toHaveBeenCalled();
  });
});
