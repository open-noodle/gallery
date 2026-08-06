import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgentSession, AgentToolCall } from 'src/database';
import { AgentProposeAlbumOperationsDto } from 'src/dtos/agent-operation.dto';
import { BulkIdErrorReason } from 'src/dtos/asset-ids.response.dto';
import { AssetEditAction } from 'src/dtos/editing.dto';
import {
  AgentApprovalMode,
  AgentOperationApplyStatus,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionActivityEventKind,
  AgentSessionActivityEventStatus,
  AgentSessionStatus,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  AlbumUserRole,
  AssetType,
  AssetVisibility,
  SharedLinkType,
  SharedSpaceRole,
  UserAvatarColor,
} from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import {
  AgentOperationApplyUpdate,
  AgentOperationPlanRepository,
  AgentOperationPlanWithOperations,
} from 'src/repositories/agent-operation-plan.repository';
import { AgentSelectionHandleRepository } from 'src/repositories/agent-selection-handle.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { WebsocketRepository } from 'src/repositories/websocket.repository';
import { AgentAssetSearchFilterResolverService } from 'src/services/agent-asset-search-filter-resolver.service';
import { AgentMcpRecoverableToolError } from 'src/services/agent-mcp-recoverable-tool-error';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
import { AgentSessionActivityEventService } from 'src/services/agent-session-activity-event.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { AlbumService } from 'src/services/album.service';
import { AssetService } from 'src/services/asset.service';
import { PersonService } from 'src/services/person.service';
import { SharedLinkService } from 'src/services/shared-link.service';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { StackService } from 'src/services/stack.service';
import { TagService } from 'src/services/tag.service';
import { TrashService } from 'src/services/trash.service';
import { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
import { AgentToolOperationPlanRequestMetadata } from 'src/types/agent-tool.types';
import { AuthFactory } from 'test/factories/auth.factory';
import { newAccessRepositoryMock } from 'test/repositories/access.repository.mock';
import { newAssetRepositoryMock } from 'test/repositories/asset.repository.mock';
import { newUuid } from 'test/small.factory';
import { automock, mockBaseService } from 'test/utils';

const now = new Date('2026-05-15T12:00:00.000Z');

const permissionPlanSnapshot: AgentPermissionPlanSnapshot = {
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

const expandedWriteScope = {
  ...permissionPlanSnapshot.writeScope,
  removeAssets: true,
  createSpace: true,
  addAssetsToSpaces: true,
  removeAssetsFromSpaces: true,
  updateSpaceDetails: true,
  addMembersToSpaces: true,
  removeMembersFromSpaces: true,
  updateSpaceMemberRoles: true,
  editAssets: true,
  favoriteAssets: true,
  archiveAssets: true,
  tagAssets: true,
  updateAssetMetadata: true,
  trashAssets: true,
  createSharedLinks: true,
  manageStacks: true,
  managePeople: true,
  shareAlbums: true,
  lockAssets: true,
  deleteContainers: true,
};

const expandedPermissionPlanSnapshot: AgentPermissionPlanSnapshot = {
  ...permissionPlanSnapshot,
  assetScope: { owned: true, sharedSpaces: true, locked: false },
  writeScope: expandedWriteScope,
};

const makeSession = (overrides: Partial<AgentSession> = {}): AgentSession => {
  const providerCredentialId = newUuid();
  return {
    id: newUuid(),
    userId: newUuid(),
    providerCredentialId,
    credentialSnapshot: {
      id: providerCredentialId,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: 'https://api.example.com/v1',
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { providerCredentialId, model: 'gpt-5.1' },
    permissionPreset: AgentPermissionPreset.Careful,
    permissionPlanSnapshot,
    approvalMode: AgentApprovalMode.Strict,
    runnerEndpoint: null,
    runnerSessionId: null,
    runnerCapabilitiesSnapshot: null,
    workflowState: null,
    status: AgentSessionStatus.Running,
    initialContextSnapshot: {},
    title: null,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    updateId: newUuid(),
    ...overrides,
  };
};

const makeOperation = (
  overrides: Partial<AgentOperationPlanWithOperations['operations'][number]> = {},
): AgentOperationPlanWithOperations['operations'][number] => ({
  id: newUuid(),
  planId: overrides.planId ?? newUuid(),
  position: overrides.position ?? 0,
  type: AgentOperationType.AlbumCreate,
  summary: 'Create Portugal.',
  targetKind: AgentOperationTargetKind.NewAlbum,
  targetId: null,
  temporaryTargetId: 'tmp-portugal',
  assetIds: [],
  payload: { albumName: 'Portugal' },
  dependencyIds: [],
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
  status: AgentOperationStatus.Proposed,
  result: null,
  error: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const makePlan = (
  overrides: Partial<AgentOperationPlanWithOperations> & {
    operations?: AgentOperationPlanWithOperations['operations'];
  } = {},
): AgentOperationPlanWithOperations => {
  const plan: AgentOperationPlanWithOperations = {
    id: newUuid(),
    sessionId: newUuid(),
    revision: 1,
    status: AgentOperationPlanStatus.Proposed,
    summary: 'Portugal plan.',
    createdAt: now,
    updatedAt: now,
    operations: overrides.operations ?? [],
    ...overrides,
  };

  return { ...plan, operations: overrides.operations ?? [makeOperation({ planId: plan.id })] };
};

const applyUpdatesToPlan = (
  plan: AgentOperationPlanWithOperations,
  updates: AgentOperationApplyUpdate[],
): AgentOperationPlanWithOperations => ({
  ...plan,
  status: AgentOperationPlanStatus.Applied,
  operations: plan.operations.map((operation) => {
    const update = updates.find((candidate) => candidate.id === operation.id);
    return update ? { ...operation, ...update } : operation;
  }),
});

const makeAddAssetsPlan = (auth: ReturnType<typeof AuthFactory.create>, assetIds: string[]) => {
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const albumId = newUuid();
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AlbumAddAssets,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    temporaryTargetId: null,
    assetIds,
    payload: {},
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

  return { session, albumId, operation, plan };
};

const makeToolCall = (overrides: Partial<AgentToolCall> = {}): AgentToolCall => ({
  id: newUuid(),
  sessionId: newUuid(),
  toolName: AgentToolName.ProposeAlbumOperations,
  status: AgentToolCallStatus.Completed,
  approvalDecision: AgentToolApprovalDecision.Approved,
  requestSummary: 'Store 1 proposed album operation(s)',
  responseSummary: 'Plan revision 1.',
  redactedRequestMetadata: {},
  redactedResponseMetadata: {},
  dataClass: AgentToolDataClass.Plan,
  assetCount: 0,
  albumCount: 0,
  providerSnapshot: {
    providerCredentialId: newUuid(),
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-5.1',
  },
  startedAt: now,
  completedAt: now,
  error: null,
  ...overrides,
});

const makeMetadataReviewRow = (
  id: string,
  exifInfo: {
    description?: string | null;
    rating?: number | null;
    dateTimeOriginal?: Date | null;
    timeZone?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null,
) => ({
  id,
  exifInfo:
    exifInfo === null
      ? null
      : {
          description: exifInfo.description ?? null,
          rating: exifInfo.rating ?? null,
          dateTimeOriginal: exifInfo.dateTimeOriginal ?? null,
          timeZone: exifInfo.timeZone ?? null,
          latitude: exifInfo.latitude ?? null,
          longitude: exifInfo.longitude ?? null,
        },
});

describe(AgentOperationPlanService.name, () => {
  let sut: AgentOperationPlanService;
  let accessRepository: ReturnType<typeof newAccessRepositoryMock>;
  let assetRepository: ReturnType<typeof newAssetRepositoryMock>;
  let albumRepository: ReturnType<typeof automock<AlbumRepository>>;
  let albumService: ReturnType<typeof automock<AlbumService>>;
  let sharedSpaceService: ReturnType<typeof automock<SharedSpaceService>>;
  let assetService: ReturnType<typeof automock<AssetService>>;
  let stackService: ReturnType<typeof mockBaseService<StackService>>;
  let tagService: ReturnType<typeof automock<TagService>>;
  let trashService: ReturnType<typeof automock<TrashService>>;
  let sharedLinkService: ReturnType<typeof mockBaseService<SharedLinkService>>;
  let personService: ReturnType<typeof mockBaseService<PersonService>>;
  let sessionRepository: ReturnType<typeof automock<AgentSessionRepository>>;
  let selectionHandleRepository: ReturnType<typeof automock<AgentSelectionHandleRepository>>;
  let planRepository: ReturnType<typeof automock<AgentOperationPlanRepository>>;
  let toolCallRepository: ReturnType<typeof automock<AgentToolCallRepository>>;
  let websocketRepository: ReturnType<typeof automock<WebsocketRepository>>;
  let searchRepository: ReturnType<typeof automock<SearchRepository>>;
  let sharedSpaceRepository: ReturnType<typeof automock<SharedSpaceRepository>>;
  let assetSearchFilterResolverService: ReturnType<typeof automock<AgentAssetSearchFilterResolverService>>;
  let activityEventService: Pick<AgentSessionActivityEventService, 'createSystemEvent'>;

  beforeEach(() => {
    accessRepository = newAccessRepositoryMock();
    assetRepository = newAssetRepositoryMock();
    albumRepository = automock(AlbumRepository, { args: [{} as never] });
    albumService = mockBaseService(AlbumService);
    sharedSpaceService = mockBaseService(SharedSpaceService);
    assetService = mockBaseService(AssetService);
    stackService = mockBaseService(StackService);
    tagService = mockBaseService(TagService);
    trashService = mockBaseService(TrashService);
    sharedLinkService = mockBaseService(SharedLinkService);
    personService = mockBaseService(PersonService);
    sessionRepository = automock(AgentSessionRepository, { args: [{} as never] });
    selectionHandleRepository = automock(AgentSelectionHandleRepository, { args: [{} as never] });
    planRepository = automock(AgentOperationPlanRepository, { args: [{} as never] });
    toolCallRepository = automock(AgentToolCallRepository, { args: [{} as never] });
    websocketRepository = automock(WebsocketRepository, { args: [{} as never, { setContext: () => {} } as never] });
    searchRepository = automock(SearchRepository, { args: [{} as never] });
    sharedSpaceRepository = automock(SharedSpaceRepository, { args: [{} as never] });
    assetSearchFilterResolverService = automock(AgentAssetSearchFilterResolverService, { args: [] as never });
    activityEventService = {
      createSystemEvent: vi.fn(() => Promise.resolve(null)),
    };
    sessionRepository.update.mockResolvedValue({} as never);
    websocketRepository.clientSend.mockImplementation(() => {});
    toolCallRepository.create.mockImplementation((dto) => Promise.resolve(makeToolCall(dto as Partial<AgentToolCall>)));
    toolCallRepository.transition.mockImplementation((_sessionId, _id, _expectedStatus, dto) =>
      Promise.resolve(
        makeToolCall({
          ...dto,
          completedAt: dto.completedAt instanceof Date || dto.completedAt === null ? dto.completedAt : undefined,
        }),
      ),
    );
    sut = new (AgentOperationPlanService as unknown as new (...args: unknown[]) => AgentOperationPlanService)(
      accessRepository as unknown as AccessRepository,
      assetRepository as unknown as AssetRepository,
      albumService,
      sessionRepository,
      selectionHandleRepository,
      searchRepository,
      sharedSpaceRepository,
      assetSearchFilterResolverService,
      albumRepository,
      planRepository,
      toolCallRepository,
      websocketRepository,
      sharedSpaceService,
      assetService,
      stackService,
      tagService,
      trashService,
      sharedLinkService,
      personService,
      activityEventService,
    );
  });

  it('stores a proposed plan, marks the session waiting for review, audits completion, and notifies clients', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id });
    const plan = makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({ id: newUuid(), planId: 'plan-id', position: 0 }),
        makeOperation({
          id: newUuid(),
          planId: 'plan-id',
          position: 1,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add beach photo.',
          temporaryTargetId: 'tmp-portugal',
          assetIds: [assetId],
          payload: {},
        }),
      ],
    });
    const executingToolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing });
    const completedToolCall = makeToolCall({ sessionId: session.id });
    sessionRepository.getById.mockResolvedValue(session);
    sessionRepository.update.mockResolvedValue({ ...session, status: AgentSessionStatus.WaitingForPlanReview });
    planRepository.createReplacementRevision.mockResolvedValue(plan);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    toolCallRepository.create.mockResolvedValue(executingToolCall);
    toolCallRepository.transition.mockResolvedValue(completedToolCall);

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Portugal plan.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal',
          payload: { albumName: 'Portugal', description: '' },
          enabled: true,
          riskLevel: AgentOperationRiskLevel.Low,
        },
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add beach photo.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal',
          assetIds: [assetId],
          payload: {},
          enabled: true,
          riskLevel: AgentOperationRiskLevel.Low,
        },
      ],
    });

    expect(result.status).toBe('success');
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(session.id, {
      plan: { sessionId: session.id, status: AgentOperationPlanStatus.Proposed, summary: 'Portugal plan.' },
      operations: [
        expect.objectContaining({
          type: AgentOperationType.AlbumCreate,
          temporaryTargetId: 'tmp-portugal',
          dependencyIds: [],
        }),
        expect.objectContaining({
          type: AgentOperationType.AlbumAddAssets,
          temporaryTargetId: 'tmp-portugal',
          dependencyIds: [],
        }),
      ],
    });
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.WaitingForPlanReview,
    });
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        toolName: AgentToolName.ProposeAlbumOperations,
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        dataClass: AgentToolDataClass.Plan,
        assetCount: 1,
        albumCount: 0,
        redactedResponseMetadata: null,
        completedAt: null,
        error: null,
        providerSnapshot: {
          providerCredentialId: session.credentialSnapshot.id,
          providerType: AgentProviderType.OpenAI,
          label: 'OpenAI personal',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-5.1',
        },
      }),
    );
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executingToolCall.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        redactedResponseMetadata: { planId: plan.id, operationIds: plan.operations.map((operation) => operation.id) },
        error: null,
      }),
    );
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', auth.user.id, {
      type: 'operation-plan-ready',
      sessionId: session.id,
      planId: plan.id,
      revision: plan.revision,
    });
  });

  it('proposeAlbumFromSearch creates a reviewable create-album plus add-assets plan from a search source', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const assetIds = [newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: { country: 'South Africa' },
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    const createdPlan = makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AlbumCreate,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-album-from-search',
          payload: { albumName: 'South Africa', description: 'January trip.' },
        }),
        makeOperation({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-album-from-search',
          assetIds,
          payload: {},
        }),
      ],
    });
    planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

    await sut.proposeAlbumFromSearch(auth, session.id, {
      summary: 'Create South Africa album.',
      albumName: 'South Africa',
      description: 'January trip.',
      assetSource: {
        kind: 'search',
        filters: { country: 'South Africa' },
        materialization: 'all-matches-with-limit',
      },
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        plan: expect.objectContaining({ summary: 'Create South Africa album.' }),
        operations: [
          expect.objectContaining({
            type: AgentOperationType.AlbumCreate,
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-album-from-search',
            payload: { albumName: 'South Africa', description: 'January trip.' },
          }),
          expect.objectContaining({
            type: AgentOperationType.AlbumAddAssets,
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-album-from-search',
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
          }),
        ],
      }),
    );
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: AgentToolName.ProposeAlbumFromSearch }),
    );
    expect(albumService.create).not.toHaveBeenCalled();
    expect(albumService.addAssets).not.toHaveBeenCalled();
  });

  it('proposeAddAssetsToAlbumFromSearch creates only an add-assets operation for a target album id', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const albumId = newUuid();
    const assetIds = [newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AlbumAddAssets,
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            temporaryTargetId: null,
            assetIds,
            payload: {},
          }),
        ],
      }),
    );

    await sut.proposeAddAssetsToAlbumFromSearch(auth, session.id, {
      summary: 'Add matching photos.',
      albumId,
      assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            type: AgentOperationType.AlbumAddAssets,
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            temporaryTargetId: undefined,
            assetIds,
          }),
        ],
      }),
    );
    expect(planRepository.createReplacementRevision.mock.calls[0]?.[1].operations).toHaveLength(1);
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: AgentToolName.ProposeAddAssetsToAlbumFromSearch }),
    );
  });

  it('records completed plan activity with materialized asset counts', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const assetIds = [newUuid(), newUuid(), newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: { country: 'South Africa' },
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AlbumCreate,
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-album-from-search',
            payload: { albumName: 'South Africa', description: 'January trip.' },
          }),
          makeOperation({
            type: AgentOperationType.AlbumAddAssets,
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-album-from-search',
            assetIds,
            payload: {},
          }),
        ],
      }),
    );

    await sut.proposeAlbumFromSearch(auth, session.id, {
      summary: 'Create South Africa album.',
      albumName: 'South Africa',
      description: 'January trip.',
      assetSource: {
        kind: 'search',
        filters: { country: 'South Africa' },
        materialization: 'all-matches-with-limit',
      },
    });

    expect(activityEventService.createSystemEvent).toHaveBeenCalledWith(auth.user.id, session.id, {
      kind: AgentSessionActivityEventKind.PlanComposing,
      status: AgentSessionActivityEventStatus.Completed,
      summary: 'Prepared plan',
      counts: { total: assetIds.length },
    });
    for (const call of vi.mocked(activityEventService.createSystemEvent).mock.calls) {
      const event = call[2];
      expect(event).not.toHaveProperty('operationIds');
      expect(event).not.toHaveProperty('assetIds');
    }
  });

  it('proposeAddAssetsToAlbumFromSearch resolves a unique visible album name before planning', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const albumId = newUuid();
    const assetIds = [newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    albumRepository.getAgentAlbums.mockResolvedValue([
      { id: albumId, albumName: 'South Africa', ownerId: auth.user.id },
    ] as never);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

    await sut.proposeAddAssetsToAlbumFromSearch(auth, session.id, {
      albumName: ' south africa ',
      assetSource: { kind: 'search', filters: {} },
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [expect.objectContaining({ targetId: albumId })],
      }),
    );
  });

  it('proposeAddAssetsToAlbumFromSearch returns clarification choices for duplicate visible album names', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const firstAlbumId = newUuid();
    const secondAlbumId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    albumRepository.getAgentAlbums.mockResolvedValue([
      { id: firstAlbumId, albumName: 'South Africa', ownerId: auth.user.id, assetCount: 10 },
      { id: secondAlbumId, albumName: 'south africa', ownerId: auth.user.id, assetCount: 4 },
    ] as never);

    await expect(
      sut.proposeAddAssetsToAlbumFromSearch(auth, session.id, {
        albumName: 'South Africa',
        assetSource: { kind: 'search', filters: {} },
      }),
    ).rejects.toMatchObject({
      content: expect.objectContaining({
        status: 'error',
        retryable: true,
        recovery: expect.objectContaining({
          kind: 'album_target_needs_clarification',
          choices: expect.arrayContaining([
            expect.objectContaining({ albumId: firstAlbumId, albumName: 'South Africa' }),
            expect.objectContaining({ albumId: secondAlbumId, albumName: 'south africa' }),
          ]),
        }),
      }),
    });

    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: expect.stringContaining('Multiple visible albums named'),
      }),
    );
    expect(activityEventService.createSystemEvent).not.toHaveBeenCalled();
  });

  it('proposeAddAssetsToAlbumFromSearch returns recoverable guidance when an album name has no visible match', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    albumRepository.getAgentAlbums.mockResolvedValue([]);

    await expect(
      sut.proposeAddAssetsToAlbumFromSearch(auth, session.id, {
        albumName: 'South Africa',
        assetSource: { kind: 'search', filters: {} },
      }),
    ).rejects.toMatchObject({
      content: expect.objectContaining({
        status: 'error',
        retryable: true,
        hint: expect.stringContaining('listAlbums'),
        recovery: expect.objectContaining({
          kind: 'album_target_needs_clarification',
          albumName: 'South Africa',
          choices: [],
        }),
      }),
    });

    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: expect.stringContaining('No visible album named'),
      }),
    );
  });

  it('proposeSpaceFromSearch creates a reviewable create-space plus add-assets plan from a search source', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const assetIds = [newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: { country: 'South Africa' },
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.SpaceCreate,
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-space-from-search',
            payload: { spaceName: 'Family South Africa', description: 'January trip.', color: UserAvatarColor.Blue },
          }),
          makeOperation({
            type: AgentOperationType.SpaceAddAssets,
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-space-from-search',
            assetIds,
            payload: {},
          }),
        ],
      }),
    );

    await sut.proposeSpaceFromSearch(auth, session.id, {
      summary: 'Create family space.',
      spaceName: 'Family South Africa',
      description: 'January trip.',
      color: UserAvatarColor.Blue,
      assetSource: {
        kind: 'search',
        filters: { country: 'South Africa' },
        materialization: 'all-matches-with-limit',
      },
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        plan: expect.objectContaining({ summary: 'Create family space.' }),
        operations: [
          expect.objectContaining({
            type: AgentOperationType.SpaceCreate,
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-space-from-search',
            payload: { spaceName: 'Family South Africa', description: 'January trip.', color: UserAvatarColor.Blue },
          }),
          expect.objectContaining({
            type: AgentOperationType.SpaceAddAssets,
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-space-from-search',
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
          }),
        ],
      }),
    );
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: AgentToolName.ProposeSpaceFromSearch }),
    );
    expect(sharedSpaceService.create).not.toHaveBeenCalled();
    expect(sharedSpaceService.addAssets).not.toHaveBeenCalled();
  });

  it('proposeSpaceFromSearch materializes a previous search source without rerunning search', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const selectionHandleId = newUuid();
    const sourceRef = `asset-source:search:${selectionHandleId}` as const;
    const assetIds = [newUuid(), newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds.slice(0, 25),
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.SpaceCreate,
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-space-from-search',
            payload: { spaceName: 'Family South Africa' },
          }),
          makeOperation({
            type: AgentOperationType.SpaceAddAssets,
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-space-from-search',
            assetIds,
            payload: {},
          }),
        ],
      }),
    );

    await sut.proposeSpaceFromSearch(auth, session.id, {
      spaceName: 'Family South Africa',
      assetSource: { kind: 'previousSearch', sourceRef },
    });

    expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
    });
    expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({ type: AgentOperationType.SpaceCreate }),
          expect.objectContaining({
            type: AgentOperationType.SpaceAddAssets,
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
          }),
        ],
      }),
    );
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ProposeSpaceFromSearch,
        assetCount: assetIds.length,
        redactedRequestMetadata: expect.objectContaining({
          selectionHandles: [
            expect.objectContaining({
              id: selectionHandleId,
              sourceKind: 'previousSearch',
              sourceRef,
            }),
          ],
        }),
      }),
    );
  });

  it('proposeAddAssetsToSpaceFromSearch creates only an add-assets operation for a target space id', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const spaceId = newUuid();
    const assetIds = [newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

    await sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
      summary: 'Add matching photos.',
      spaceId,
      assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            type: AgentOperationType.SpaceAddAssets,
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: spaceId,
            temporaryTargetId: undefined,
            assetIds,
          }),
        ],
      }),
    );
    expect(planRepository.createReplacementRevision.mock.calls[0]?.[1].operations).toHaveLength(1);
    expect(accessRepository.sharedSpace.checkRoleAccess).toHaveBeenCalledWith(
      auth.user.id,
      new Set([spaceId]),
      SharedSpaceRole.Editor,
    );
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch }),
    );
  });

  it('proposeAddAssetsToSpaceFromSearch materializes a previous search source without rerunning search', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const spaceId = newUuid();
    const selectionHandleId = newUuid();
    const sourceRef = `asset-source:search:${selectionHandleId}` as const;
    const assetIds = [newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds.slice(0, 25),
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.SpaceAddAssets,
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: spaceId,
            temporaryTargetId: null,
            assetIds,
            payload: {},
          }),
        ],
      }),
    );

    await sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
      spaceId,
      assetSource: { kind: 'previousSearch', sourceRef },
    });

    expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
    });
    expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            type: AgentOperationType.SpaceAddAssets,
            targetId: spaceId,
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
          }),
        ],
      }),
    );
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
        assetCount: assetIds.length,
        redactedRequestMetadata: expect.objectContaining({
          selectionHandles: [
            expect.objectContaining({
              id: selectionHandleId,
              sourceKind: 'previousSearch',
              sourceRef,
            }),
          ],
        }),
      }),
    );
  });

  it('proposeAddAssetsToSpaceFromSearch resolves a unique visible space name before planning', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const spaceId = newUuid();
    const assetIds = [newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([
      {
        id: spaceId,
        name: 'Family South Africa',
        description: null,
        color: UserAvatarColor.Blue,
        createdById: auth.user.id,
      },
    ] as never);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

    await sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
      spaceName: ' family south africa ',
      assetSource: { kind: 'search', filters: {} },
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [expect.objectContaining({ targetId: spaceId, temporaryTargetId: undefined })],
      }),
    );
  });

  it('proposeAddAssetsToSpaceFromSearch denies space-name lookup when shared spaces are not readable', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        assetScope: { ...expandedPermissionPlanSnapshot.assetScope, sharedSpaces: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
        spaceName: 'Family',
        assetSource: { kind: 'search', filters: {} },
      }),
    ).rejects.toThrow('Shared spaces are not accessible for this session');

    expect(sharedSpaceRepository.getAllByUserId).not.toHaveBeenCalled();
    expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Shared spaces are not accessible for this session',
      }),
    );
  });

  it('proposeAddAssetsToSpaceFromSearch returns clarification choices for duplicate visible space names', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const firstSpaceId = newUuid();
    const secondSpaceId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([
      {
        id: firstSpaceId,
        name: 'Family',
        description: 'Owned',
        color: UserAvatarColor.Blue,
        createdById: auth.user.id,
      },
      {
        id: secondSpaceId,
        name: 'family',
        description: 'Shared',
        color: UserAvatarColor.Green,
        createdById: newUuid(),
      },
    ] as never);

    await expect(
      sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
        spaceName: 'Family',
        assetSource: { kind: 'search', filters: {} },
      }),
    ).rejects.toMatchObject({
      content: expect.objectContaining({
        status: 'error',
        retryable: true,
        recovery: expect.objectContaining({
          kind: 'space_target_needs_clarification',
          choices: expect.arrayContaining([
            expect.objectContaining({ spaceId: firstSpaceId, spaceName: 'Family' }),
            expect.objectContaining({ spaceId: secondSpaceId, spaceName: 'family' }),
          ]),
        }),
      }),
    });

    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: expect.stringContaining('Multiple visible spaces named'),
      }),
    );
  });

  it('proposeAddAssetsToSpaceFromSearch returns recoverable guidance when a space name has no visible match', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([]);

    await expect(
      sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
        spaceName: 'Family',
        assetSource: { kind: 'search', filters: {} },
      }),
    ).rejects.toMatchObject({
      content: expect.objectContaining({
        status: 'error',
        retryable: true,
        hint: expect.stringContaining('listSpaces'),
        recovery: expect.objectContaining({
          kind: 'space_target_needs_clarification',
          spaceName: 'Family',
          choices: [],
        }),
      }),
    });

    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: expect.stringContaining('No visible space named'),
      }),
    );
  });

  it.each([
    ['createSpace', { createSpace: false }, 'Agent permission policy does not allow creating spaces'],
    [
      'addAssetsToSpaces',
      { addAssetsToSpaces: false },
      'Agent permission policy does not allow adding assets to spaces',
    ],
  ])(
    'proposeSpaceFromSearch enforces %s write scope through existing planning validation',
    async (_field, writeScopeOverride, expectedError) => {
      const auth = AuthFactory.create();
      const session = makeSession({
        userId: auth.user.id,
        permissionPlanSnapshot: {
          ...expandedPermissionPlanSnapshot,
          writeScope: { ...expandedPermissionPlanSnapshot.writeScope, ...writeScopeOverride },
        },
      });
      sessionRepository.getById.mockResolvedValue(session);

      await expect(
        sut.proposeSpaceFromSearch(auth, session.id, {
          spaceName: 'Family',
          assetSource: { kind: 'search', filters: {} },
        }),
      ).rejects.toThrow(expectedError);

      expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
      expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    },
  );

  it('proposeAddAssetsToSpaceFromSearch enforces add-assets-to-space scope and editor access', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, addAssetsToSpaces: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
        spaceId,
        assetSource: { kind: 'search', filters: {} },
      }),
    ).rejects.toThrow('Agent permission policy does not allow adding assets to spaces');

    expect(accessRepository.sharedSpace.checkRoleAccess).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();

    const allowedSession = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    sessionRepository.getById.mockResolvedValue(allowedSession);
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set());
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: newUuid() }], hasNextPage: false } as never);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set());

    await expect(
      sut.proposeAddAssetsToSpaceFromSearch(auth, allowedSession.id, {
        spaceId,
        assetSource: { kind: 'search', filters: {} },
      }),
    ).rejects.toThrow('One or more target spaces are not accessible');

    expect(accessRepository.sharedSpace.checkRoleAccess).toHaveBeenCalledWith(
      auth.user.id,
      new Set([spaceId]),
      SharedSpaceRole.Editor,
    );
  });

  it('proposeAddAssetsToSpaceFromSearch denies a space name before resolving visible spaces when write scope is disabled', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, addAssetsToSpaces: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
        spaceName: 'Family',
        assetSource: { kind: 'search', filters: {} },
      }),
    ).rejects.toThrow('Agent permission policy does not allow adding assets to spaces');

    expect(sharedSpaceRepository.getAllByUserId).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Agent permission policy does not allow adding assets to spaces',
      }),
    );
  });

  it('proposeAddAssetsToSpaceFromSearch denies inaccessible space ids before materializing a search source', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set());

    await expect(
      sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
        spaceId,
        assetSource: { kind: 'search', filters: { country: 'South Africa' } },
      }),
    ).rejects.toThrow('One or more target spaces are not accessible');

    expect(accessRepository.sharedSpace.checkRoleAccess).toHaveBeenCalledWith(
      auth.user.id,
      new Set([spaceId]),
      SharedSpaceRole.Editor,
    );
    expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'favorite',
      action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
      expectedType: AgentOperationType.AssetSetFavorite,
      expectedTargetKind: AgentOperationTargetKind.AssetBatch,
      expectedPayload: { favorite: true },
      expectedRiskLevel: AgentOperationRiskLevel.Low,
      expectedSummary: 'Mark matching photos as favorites',
    },
    {
      label: 'archive',
      action: { type: AgentOperationType.AssetSetArchive, archived: true },
      expectedType: AgentOperationType.AssetSetArchive,
      expectedTargetKind: AgentOperationTargetKind.AssetBatch,
      expectedPayload: { archived: true },
      expectedRiskLevel: AgentOperationRiskLevel.High,
      expectedSummary: 'Archive matching photos',
    },
    {
      label: 'unarchive',
      action: { type: AgentOperationType.AssetSetArchive, archived: false },
      expectedType: AgentOperationType.AssetSetArchive,
      expectedTargetKind: AgentOperationTargetKind.AssetBatch,
      expectedPayload: { archived: false },
      expectedRiskLevel: AgentOperationRiskLevel.High,
      expectedSummary: 'Move matching photos back to timeline',
    },
    {
      label: 'lock',
      action: { type: AgentOperationType.AssetSetVisibility, visibility: AssetVisibility.Locked },
      expectedType: AgentOperationType.AssetSetVisibility,
      expectedTargetKind: AgentOperationTargetKind.AssetBatch,
      expectedPayload: { visibility: AssetVisibility.Locked },
      expectedRiskLevel: AgentOperationRiskLevel.High,
      expectedSummary: 'Move matching photos to the Locked folder',
    },
    {
      label: 'tag by name',
      action: { type: AgentOperationType.AssetAddTag, tagName: 'Receipts' },
      expectedType: AgentOperationType.AssetAddTag,
      expectedTargetKind: AgentOperationTargetKind.AssetBatch,
      expectedPayload: { tagName: 'Receipts' },
      expectedRiskLevel: AgentOperationRiskLevel.Medium,
      expectedSummary: 'Add tag "Receipts" to matching photos',
    },
    (() => {
      const tagId = newUuid();
      return {
        label: 'tag by id',
        action: { type: AgentOperationType.AssetAddTag, tagId },
        expectedType: AgentOperationType.AssetAddTag,
        expectedTargetKind: AgentOperationTargetKind.AssetBatch,
        expectedPayload: { tagId },
        expectedRiskLevel: AgentOperationRiskLevel.Medium,
        expectedSummary: 'Add selected tag to matching photos',
      };
    })(),
    {
      label: 'rotate',
      action: { type: AgentOperationType.AssetRotate, angle: 90 },
      expectedType: AgentOperationType.AssetRotate,
      expectedTargetKind: AgentOperationTargetKind.ImageEditBatch,
      expectedPayload: { angle: 90 },
      expectedRiskLevel: AgentOperationRiskLevel.Medium,
      expectedSummary: 'Rotate matching photos 90 degrees',
    },
    {
      label: 'metadata',
      action: {
        type: AgentOperationType.AssetUpdateMetadata,
        description: 'Berlin weekend',
        timeZone: 'Europe/Berlin',
      },
      expectedType: AgentOperationType.AssetUpdateMetadata,
      expectedTargetKind: AgentOperationTargetKind.AssetBatch,
      expectedPayload: { description: 'Berlin weekend', timeZone: 'Europe/Berlin' },
      expectedRiskLevel: AgentOperationRiskLevel.Medium,
      expectedSummary: 'Update matching photo metadata',
    },
  ])(
    'proposeAssetBatchFromSearch creates a reviewable $label plan from a search source',
    async ({ action, expectedType, expectedTargetKind, expectedPayload, expectedRiskLevel, expectedSummary }) => {
      const auth = AuthFactory.create();
      const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
      const assetIds = [newUuid(), newUuid()];
      sessionRepository.getById.mockResolvedValue(session);
      assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
        status: 'success',
        filters: {},
        results: [],
      });
      sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
      searchRepository.searchMetadata.mockResolvedValue({
        items: assetIds.map((id) => ({ id })),
        hasNextPage: false,
      } as never);
      accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
      accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
      if ('tagId' in action && action.tagId) {
        accessRepository.tag.checkOwnerAccess.mockResolvedValue(new Set([action.tagId]));
      }
      assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
      planRepository.createReplacementRevision.mockResolvedValue(
        makePlan({
          sessionId: session.id,
          operations: [
            makeOperation({
              type: expectedType,
              targetKind: expectedTargetKind,
              targetId: null,
              temporaryTargetId: null,
              assetIds,
              payload: expectedPayload,
              riskLevel: expectedRiskLevel,
            }),
          ],
        }),
      );

      await (sut as any).proposeAssetBatchFromSearch(auth, session.id, {
        action,
        assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
      });

      expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
        session.id,
        expect.objectContaining({
          plan: expect.objectContaining({ summary: expectedSummary }),
          operations: [
            expect.objectContaining({
              type: expectedType,
              summary: expectedSummary,
              targetKind: expectedTargetKind,
              targetId: undefined,
              temporaryTargetId: undefined,
              assetIds,
              assetSource: undefined,
              payload: expectedPayload,
              riskLevel: expectedRiskLevel,
              enabled: true,
            }),
          ],
        }),
      );
      expect(assetService.updateAll).not.toHaveBeenCalled();
      expect(tagService.addAssets).not.toHaveBeenCalled();
      expect(assetService.editAsset).not.toHaveBeenCalled();
      expect(toolCallRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: AgentToolName.ProposeAssetBatchFromSearch }),
      );
    },
  );

  it('creates a reviewable asset.updateMetadata plan for explicit asset ids', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const assetIds = [newUuid(), newUuid()];
    const payload = { description: 'Berlin weekend', rating: 5 as const };
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AssetUpdateMetadata,
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds,
            payload,
          }),
        ],
      }),
    );

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Update selected photo metadata.',
      operations: [
        {
          type: AgentOperationType.AssetUpdateMetadata,
          summary: 'Set description and rating.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          payload,
          enabled: true,
          riskLevel: AgentOperationRiskLevel.Medium,
        },
      ],
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            type: AgentOperationType.AssetUpdateMetadata,
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
            payload,
          }),
        ],
      }),
    );
    expect(assetService.updateAll).not.toHaveBeenCalled();
  });

  it('audits metadata planning with metadata wording without exposing review metadata to tool responses', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const assetIds = [newUuid(), newUuid()];
    const plannedOperation = makeOperation({
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds,
      payload: { description: 'Berlin weekend' },
    });
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({ sessionId: session.id, operations: [plannedOperation] }),
    );

    const result = await (sut as any).proposeAssetBatchFromSearch(auth, session.id, {
      action: { type: AgentOperationType.AssetUpdateMetadata, description: 'Berlin weekend' },
      assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
    });

    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ProposeAssetBatchFromSearch,
        requestSummary: 'Store 1 proposed metadata operation(s)',
      }),
    );
    expect((result.plan.operations[0] as any).reviewMetadata).toBeUndefined();
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        responseSummary: 'Plan revision 1: 1 metadata update operation(s).',
      }),
    );
  });

  it('proposeAssetBatchFromSearch materializes previousSearch without rerunning search', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const selectionHandleId = newUuid();
    const sourceRef = `asset-source:search:${selectionHandleId}` as const;
    const assetIds = [newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds,
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

    await (sut as any).proposeAssetBatchFromSearch(auth, session.id, {
      action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
      assetSource: { kind: 'previousSearch', sourceRef },
    });

    expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
    });
    expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [expect.objectContaining({ assetIds, assetSource: undefined, assetSelectionHandleId: undefined })],
      }),
    );
  });

  it('materializes asset.updateMetadata previousSearch before storing the plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const selectionHandleId = newUuid();
    const sourceRef = `asset-source:search:${selectionHandleId}` as const;
    const assetIds = [newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds,
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

    await (sut as any).proposeAssetBatchFromSearch(auth, session.id, {
      action: { type: AgentOperationType.AssetUpdateMetadata, rating: null },
      assetSource: { kind: 'previousSearch', sourceRef },
    });

    expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
    });
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            type: AgentOperationType.AssetUpdateMetadata,
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
            payload: { rating: null },
          }),
        ],
      }),
    );
  });

  it.each([
    ['favoriteAssets', AgentOperationType.AssetSetFavorite, { favoriteAssets: false }],
    ['archiveAssets', AgentOperationType.AssetSetArchive, { archiveAssets: false }],
    ['tagAssets', AgentOperationType.AssetAddTag, { tagAssets: false }],
    ['editAssets', AgentOperationType.AssetRotate, { editAssets: false }],
    ['lockAssets', AgentOperationType.AssetSetVisibility, { lockAssets: false }],
  ])(
    'proposeAssetBatchFromSearch denies missing %s write scope before materializing',
    async (_field, type, override) => {
      const auth = AuthFactory.create();
      const session = makeSession({
        userId: auth.user.id,
        permissionPlanSnapshot: {
          ...expandedPermissionPlanSnapshot,
          writeScope: { ...expandedPermissionPlanSnapshot.writeScope, ...override },
        },
      });
      const action =
        type === AgentOperationType.AssetSetFavorite
          ? { type, favorite: true }
          : type === AgentOperationType.AssetSetArchive
            ? { type, archived: true }
            : type === AgentOperationType.AssetAddTag
              ? { type, tagName: 'Receipts' }
              : type === AgentOperationType.AssetSetVisibility
                ? { type, visibility: AssetVisibility.Locked }
                : { type, angle: 90 };
      sessionRepository.getById.mockResolvedValue(session);

      await expect(
        (sut as any).proposeAssetBatchFromSearch(auth, session.id, {
          action,
          assetSource: { kind: 'search', filters: {} },
        }),
      ).rejects.toThrow('Agent permission policy does not allow');

      expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
      expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    },
  );

  it('denies asset.updateMetadata planning when metadata write scope is disabled before materializing search', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, updateAssetMetadata: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      (sut as any).proposeAssetBatchFromSearch(auth, session.id, {
        action: { type: AgentOperationType.AssetUpdateMetadata, description: 'Berlin weekend' },
        assetSource: { kind: 'search', filters: {} },
      }),
    ).rejects.toThrow('This session is not allowed to update asset metadata');

    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('rejects asset.updateMetadata when selected assets are outside writable access', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const assetIds = [newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set());
    assetRepository.getAgentLockedIds.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Update inaccessible metadata.',
        operations: [
          {
            type: AgentOperationType.AssetUpdateMetadata,
            summary: 'Set description.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds,
            payload: { description: 'Hidden' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Medium,
          },
        ],
      }),
    ).rejects.toThrow('One or more assets are not editable');

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('materializes asset.updateMetadata selection handles before storing the plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const selectionHandleId = newUuid();
    const assetIds = [newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds,
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Clear selected ratings.',
      operations: [
        {
          type: AgentOperationType.AssetUpdateMetadata,
          summary: 'Clear ratings.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetSelectionHandleId: selectionHandleId,
          payload: { rating: null },
          enabled: true,
          riskLevel: AgentOperationRiskLevel.Medium,
        },
      ],
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
            payload: { rating: null },
          }),
        ],
      }),
    );
  });

  it('proposeAssetBatchFromSearch rejects empty and over-broad search sources before persistence', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValueOnce({ items: [], hasNextPage: false } as never);

    await expect(
      (sut as any).proposeAssetBatchFromSearch(auth, session.id, {
        action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
        assetSource: { kind: 'search', filters: {} },
      }),
    ).rejects.toThrow('Search source did not match any assets');

    const tooManyIds = Array.from({ length: AgentOperationPlanService.maxAssetSelectionHandleAssets + 1 }, () =>
      newUuid(),
    );
    searchRepository.searchMetadata.mockResolvedValueOnce({
      items: tooManyIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);

    await expect(
      (sut as any).proposeAssetBatchFromSearch(auth, session.id, {
        action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
        assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
      }),
    ).rejects.toThrow(`Search matched more than ${AgentOperationPlanService.maxAssetSelectionHandleAssets} assets`);

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('proposeAddAssetsToSpaceFromSearch keeps existing membership semantics by preserving the full materialized asset set', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const spaceId = newUuid();
    const existingAssetId = newUuid();
    const newAssetId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: [existingAssetId, newAssetId].map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([existingAssetId, newAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([existingAssetId, newAssetId]));
    planRepository.createReplacementRevision.mockResolvedValue(makePlan({ sessionId: session.id, operations: [] }));

    await sut.proposeAddAssetsToSpaceFromSearch(auth, session.id, {
      spaceId,
      assetSource: { kind: 'search', filters: {} },
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [expect.objectContaining({ assetIds: [existingAssetId, newAssetId] })],
      }),
    );
  });

  it('materializes assetSelectionHandleId server-side before storing and reviewing a plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const selectionHandleId = newUuid();
    const assetIds = Array.from({ length: 150 }, () => newUuid());
    const albumId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds.slice(0, 25),
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    const createdPlan = makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          temporaryTargetId: null,
          assetIds,
          payload: {},
        }),
      ],
    });
    planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Add selected photos',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetSelectionHandleId: selectionHandleId,
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    });

    expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
    });
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            assetIds,
            assetSelectionHandleId: undefined,
          }),
        ],
      }),
    );
    expect(result.plan?.operations[0].assetIds).toHaveLength(150);
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assetCount: 150,
        redactedRequestMetadata: expect.objectContaining({
          assetCount: 150,
          assetIds: assetIds.slice(0, 25),
          selectionHandles: [{ id: selectionHandleId, assetCount: 150, sampleAssetIds: assetIds.slice(0, 25) }],
        }),
      }),
    );
  });

  it('materializes previousSearch source refs through the backing selection handle before storing a plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const selectionHandleId = newUuid();
    const sourceRef = `asset-source:search:${selectionHandleId}` as const;
    const assetIds = Array.from({ length: 30 }, () => newUuid());
    const albumId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds.slice(0, 25),
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    const createdPlan = makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          temporaryTargetId: null,
          assetIds,
          payload: {},
        }),
      ],
    });
    planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Add previous search photos',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetSource: { kind: 'previousSearch', sourceRef },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    });

    expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
    });
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
          }),
        ],
      }),
    );
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assetCount: assetIds.length,
        redactedRequestMetadata: expect.objectContaining({
          assetCount: assetIds.length,
          assetIds: assetIds.slice(0, 25),
          assetIdsSample: assetIds.slice(0, 25),
          selectionHandles: [
            {
              id: selectionHandleId,
              assetCount: assetIds.length,
              sampleAssetIds: assetIds.slice(0, 25),
              sourceKind: 'previousSearch',
              sourceRef,
            },
          ],
        }),
      }),
    );
  });

  it('materializes assetSource.selectionHandle server-side before storing a plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const selectionHandleId = newUuid();
    const albumId = newUuid();
    const assetIds = [newUuid(), newUuid()];

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds,
      expiresAt: new Date('2026-05-27T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    const createdPlan = makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          temporaryTargetId: null,
          assetIds,
          payload: {},
        }),
      ],
    });
    planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Add handle assets.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add handle assets.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetSource: { kind: 'selectionHandle', selectionHandleId },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    });

    expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
    });
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [expect.objectContaining({ assetIds, assetSource: undefined, assetSelectionHandleId: undefined })],
      }),
    );
    expect(result.plan?.operations[0].assetIds).toEqual(assetIds);
  });

  it('proposeAlbumFromSelection materializes a curated handle into an album create plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const selectionHandleId = newUuid();
    const assetIds = [newUuid(), newUuid()];

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds,
      expiresAt: new Date('2026-05-27T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    const createdPlan = makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AlbumCreate,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-album-from-selection',
          payload: { albumName: 'Curated album', description: 'Selected photos.' },
        }),
        makeOperation({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-album-from-selection',
          assetIds,
          payload: {},
        }),
      ],
    });
    planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

    const result = await sut.proposeAlbumFromSelection(auth, session.id, {
      summary: 'Create curated album.',
      albumName: 'Curated album',
      description: 'Selected photos.',
      selectionHandleId,
    });

    expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
    });
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            type: AgentOperationType.AlbumCreate,
            assetIds: [],
            assetSource: undefined,
            assetSelectionHandleId: undefined,
          }),
          expect.objectContaining({
            type: AgentOperationType.AlbumAddAssets,
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
          }),
        ],
      }),
    );
    expect(result.plan?.operations[1].assetIds).toEqual(assetIds);
  });

  it('proposeAssetBatchFromSelection materializes a curated handle into an asset batch plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const selectionHandleId = newUuid();
    const assetIds = [newUuid(), newUuid()];

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds,
      expiresAt: new Date('2026-05-27T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    const createdPlan = makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AssetSetFavorite,
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          payload: { favorite: true },
        }),
      ],
    });
    planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

    const result = await sut.proposeAssetBatchFromSelection(auth, session.id, {
      summary: 'Favorite selected photos.',
      action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
      selectionHandleId,
    });

    expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
    });
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            type: AgentOperationType.AssetSetFavorite,
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
          }),
        ],
      }),
    );
    expect(result.plan?.operations[0].assetIds).toEqual(assetIds);
  });

  it('re-checks assetSource.selectionHandle assets against current permissions and deleted assets', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const selectionHandleId = newUuid();
    const allowedAssetId = newUuid();
    const deletedOrDeniedAssetId = newUuid();
    const albumId = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds: [allowedAssetId, deletedOrDeniedAssetId],
      assetCount: 2,
      sampleAssetIds: [allowedAssetId, deletedOrDeniedAssetId],
      expiresAt: new Date('2026-05-27T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([allowedAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([allowedAssetId]));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Add stale handle assets.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add stale handle assets.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetSource: { kind: 'selectionHandle', selectionHandleId },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('One or more assets are not accessible');

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('materializes assetSource.search server-side before storing a plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const albumId = newUuid();
    const pierreId = newUuid();
    const aureliaId = newUuid();
    const assetIds = [newUuid(), newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {
        country: 'South Africa',
        takenAfter: new Date('2026-01-01T00:00:00.000Z'),
        takenBefore: new Date('2026-02-01T00:00:00.000Z'),
        personIds: [pierreId, aureliaId],
        personMatchAny: true,
      },
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    selectionHandleRepository.create.mockImplementation((dto) =>
      Promise.resolve({
        id: newUuid(),
        sessionId: dto.sessionId,
        userId: dto.userId,
        sourceToolCallId: dto.sourceToolCallId,
        assetIds: dto.assetIds,
        assetCount: dto.assetIds.length,
        sampleAssetIds: dto.assetIds.slice(0, 25),
        expiresAt: dto.expiresAt,
        createdAt: now,
        updateId: newUuid(),
      }),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AlbumAddAssets,
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            temporaryTargetId: null,
            assetIds,
            payload: {},
          }),
        ],
      }),
    );

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Create South Africa people album',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add January South Africa photos with Pierre or Aurelia',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetSource: {
            kind: 'search',
            mode: 'metadata',
            filters: {
              country: 'South Africa',
              takenAfter: '2026-01-01T00:00:00.000Z',
              takenBefore: '2026-02-01T00:00:00.000Z',
              people: { match: 'any', names: ['Pierre', 'Aurelia'] },
            },
            materialization: 'all-matches-with-limit',
          },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    });

    expect(assetSearchFilterResolverService.resolveDeclarativeFilters.mock.calls[0]?.[0]).toBe(auth);
    expect(assetSearchFilterResolverService.resolveDeclarativeFilters.mock.calls[0]?.[1]).toMatchObject({
      id: session.id,
    });
    expect(assetSearchFilterResolverService.resolveDeclarativeFilters.mock.calls[0]?.[2]).toMatchObject({
      country: 'South Africa',
      people: { match: 'any', names: ['Pierre', 'Aurelia'] },
    });
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: AgentOperationPlanService.maxAssetSelectionHandleAssets + 1 },
      expect.objectContaining({
        userIds: [auth.user.id],
        country: 'South Africa',
        personIds: [pierreId, aureliaId],
        personMatchAny: true,
      }),
    );
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            assetIds,
            assetSource: undefined,
            assetSelectionHandleId: undefined,
          }),
        ],
      }),
    );
    expect(selectionHandleRepository.create).not.toHaveBeenCalled();
    const auditMetadata = toolCallRepository.create.mock.calls[0]?.[0]
      .redactedRequestMetadata as AgentToolOperationPlanRequestMetadata;
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        assetCount: assetIds.length,
        redactedRequestMetadata: expect.objectContaining({
          assetCount: assetIds.length,
          assetIds: assetIds.slice(0, 25),
          assetIdsSample: assetIds.slice(0, 25),
          selectionHandles: [
            expect.objectContaining({
              assetCount: assetIds.length,
              sampleAssetIds: assetIds.slice(0, 25),
              sourceKind: 'search',
              declarativeFilters: expect.objectContaining({
                country: 'South Africa',
                people: { match: 'any', names: ['Pierre', 'Aurelia'] },
              }),
              resolvedFilters: expect.objectContaining({
                country: 'South Africa',
                personIds: [pierreId, aureliaId],
                personMatchAny: true,
              }),
            }),
          ],
        }),
      }),
    );
    expect(auditMetadata?.sourceSummaries).toEqual([
      {
        sourceKind: 'search',
        assetCount: assetIds.length,
        sampleAssetCount: assetIds.length,
        filterKeys: ['country', 'people', 'takenAfter', 'takenBefore'],
        resolvedFilterKeys: ['country', 'personIds', 'personMatchAny', 'takenAfter', 'takenBefore'],
      },
    ]);
    expect(JSON.stringify(auditMetadata?.sourceSummaries)).not.toContain(assetIds[0]);
  });

  it('does not create a search-source audit handle when later access validation denies the plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const albumId = newUuid();
    const assetIds = [newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    selectionHandleRepository.create.mockImplementation((dto) =>
      Promise.resolve({
        id: newUuid(),
        sessionId: dto.sessionId,
        userId: dto.userId,
        sourceToolCallId: dto.sourceToolCallId,
        assetIds: dto.assetIds,
        assetCount: dto.assetIds.length,
        sampleAssetIds: dto.assetIds.slice(0, 25),
        expiresAt: dto.expiresAt,
        createdAt: now,
        updateId: newUuid(),
      }),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set());

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Denied source-backed plan',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add searched photos to inaccessible album',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('One or more target albums are not accessible');

    expect(searchRepository.searchMetadata).toHaveBeenCalled();
    expect(selectionHandleRepository.create).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('does not create a plan when assetSource.search resolves to no assets', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false } as never);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Empty search',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add nothing',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'search', filters: { country: 'Nowhere' } },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Search source did not match any assets');

    expect(selectionHandleRepository.create).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('records failed plan activity when source resolution is unrecovered', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false } as never);

    await expect(
      sut.proposeAlbumFromSearch(auth, session.id, {
        summary: 'Create empty album.',
        albumName: 'Empty',
        description: '',
        assetSource: { kind: 'search', filters: { country: 'Nowhere' } },
      }),
    ).rejects.toThrow('Search source did not match any assets');

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(activityEventService.createSystemEvent).toHaveBeenCalledWith(auth.user.id, session.id, {
      kind: AgentSessionActivityEventKind.PlanComposing,
      status: AgentSessionActivityEventStatus.Failed,
      summary: 'Plan preparation failed',
    });
  });

  it('does not create a plan when assetSource.search needs clarification', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'needs_clarification',
      filters: {},
      results: [],
      message: 'Multiple visible person matches found',
    });

    const thrown = await sut
      .proposeAlbumOperations(auth, session.id, {
        summary: 'Ambiguous search',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add ambiguous photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'search', filters: { people: { match: 'any', names: ['Pierre'] } } },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    expect(thrown).toMatchObject({
      content: {
        status: 'error',
        retryable: true,
        error: 'Multiple visible person matches found',
        recovery: expect.objectContaining({
          kind: 'asset_search_filters_need_clarification',
          filterKeys: ['people'],
        }),
      },
    });
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(activityEventService.createSystemEvent).not.toHaveBeenCalled();
  });

  it('does not create a plan when assetSource.search filter resolution is denied', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'denied',
      filters: {},
      results: [],
      reason: 'Shared space is not available to this session',
    });

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Denied search',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add denied photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'search', filters: { space: { name: 'Private' } } },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Shared space is not available to this session');

    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('does not create a plan when assetSource.search is over the planning cap', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const assetIds = Array.from({ length: AgentOperationPlanService.maxAssetSelectionHandleAssets + 1 }, () =>
      newUuid(),
    );
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Too broad search',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add too many photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow(`Search matched more than ${AgentOperationPlanService.maxAssetSelectionHandleAssets} assets`);

    expect(selectionHandleRepository.create).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('forces all-matches assetSource.search materialization to the first page', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const albumId = newUuid();
    const assetIds = [newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AlbumAddAssets,
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            temporaryTargetId: null,
            assetIds,
            payload: {},
          }),
        ],
      }),
    );

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'All matches source',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add all matches',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit', page: 2 },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    });

    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: AgentOperationPlanService.maxAssetSelectionHandleAssets + 1 },
      expect.any(Object),
    );
  });

  it('does not create a cover plan or handle when assetSource.search exceeds the cover cap', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const albumId = newUuid();
    const assetIds = Array.from({ length: AgentOperationPlanService.maxCoverSelectionHandleAssets + 1 }, () =>
      newUuid(),
    );
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: false,
    } as never);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Too many cover candidates',
        operations: [
          {
            type: AgentOperationType.AlbumSetCover,
            summary: 'Set cover from too many photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow(`Search matched more than ${AgentOperationPlanService.maxCoverSelectionHandleAssets} assets`);

    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: AgentOperationPlanService.maxCoverSelectionHandleAssets + 1 },
      expect.any(Object),
    );
    expect(selectionHandleRepository.create).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('enforces cover-selection limits for assetSource.selectionHandle', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const albumId = newUuid();
    const selectionHandleId = newUuid();
    const assetIds = Array.from({ length: AgentOperationPlanService.maxCoverSelectionHandleAssets + 1 }, () =>
      newUuid(),
    );
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds.slice(0, 25),
      expiresAt: new Date('2026-05-27T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Too many cover candidates',
        operations: [
          {
            type: AgentOperationType.AlbumSetCover,
            summary: 'Set cover from too many photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetSource: { kind: 'selectionHandle', selectionHandleId },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Selection handle contains too many cover candidates');

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('rejects smart assetSource.search mode with a clear planning error', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Smart source',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add smart matches',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'search', mode: 'smart', query: 'beach' },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('assetSource.search smart mode is not supported for operation planning yet');

    expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('rejects text assetSource.search modes without a query before broad search', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Description source without query',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add description matches',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'search', mode: 'description', filters: { country: 'South Africa' } },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('assetSource.search description mode requires query');

    expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('rejects metadata assetSource.search with a query before broad search', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Metadata query source',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add query matches',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'search', mode: 'metadata', query: 'beach' },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('query is only supported for smart, description, ocr, and filename search modes');

    expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('rejects unsupported assetSource.search ordering before broad search', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Unsupported order source',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add ordered matches',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'search', filters: {}, order: 'relevance' },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('relevance order search is not available yet');

    expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('rejects locked visibility search sources without elevated locked access before broad search', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Locked source',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add locked photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: {
              kind: 'search',
              filters: { visibility: AssetVisibility.Locked },
              materialization: 'all-matches-with-limit',
            },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Locked photos require elevated permission');

    expect(assetSearchFilterResolverService.resolveDeclarativeFilters).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('allows bounded-page assetSource.search materialization even when more pages exist', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const albumId = newUuid();
    const assetIds = [newUuid(), newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
      status: 'success',
      filters: {},
      results: [],
    });
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })),
      hasNextPage: true,
    } as never);
    selectionHandleRepository.create.mockImplementation((dto) =>
      Promise.resolve({
        id: newUuid(),
        sessionId: dto.sessionId,
        userId: dto.userId,
        sourceToolCallId: null,
        assetIds: dto.assetIds,
        assetCount: dto.assetIds.length,
        sampleAssetIds: dto.assetIds.slice(0, 25),
        expiresAt: dto.expiresAt,
        createdAt: now,
        updateId: newUuid(),
      }),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AlbumAddAssets,
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            temporaryTargetId: null,
            assetIds,
            payload: {},
          }),
        ],
      }),
    );

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Bounded source',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add first page',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetSource: { kind: 'search', materialization: 'bounded-page', limit: 2, page: 3 },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    });

    expect(searchRepository.searchMetadata).toHaveBeenCalledWith({ page: 3, size: 2 }, expect.any(Object));
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({ operations: [expect.objectContaining({ assetIds })] }),
    );
  });

  it('applies a plan created from assetSource.search without reading the source handle again', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const { session, albumId, operation, plan } = makeAddAssetsPlan(auth, assetIds);
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession = vi.fn();
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue(plan);
    planRepository.completeApply.mockImplementation((_planId, updates) =>
      Promise.resolve(applyUpdatesToPlan(plan, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    albumService.addAssets.mockResolvedValue(assetIds.map((id) => ({ id, success: true })) as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      planRevision: plan.revision,
    });

    expect(selectionHandleRepository.getValidForPlanning).not.toHaveBeenCalled();
    expect(albumService.addAssets).toHaveBeenCalledWith(auth, albumId, { ids: assetIds });
  });

  it('rejects mixed source mechanisms before plan persistence', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Add invalid mixed photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'previousSearch', sourceRef: `asset-source:search:${newUuid()}` },
            assetIds: [newUuid()],
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Provide exactly one of assetSource, assetIds, or assetSelectionHandleId');

    expect(selectionHandleRepository.getValidForPlanning).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('rejects source mechanisms on non-asset operations before plan persistence', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    const dtoWithBypassedValidation = {
      summary: 'Create album with invalid source metadata',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal',
          assetSource: { kind: 'previousSearch', sourceRef: `asset-source:search:${newUuid()}` },
          payload: { albumName: 'Portugal', description: '' },
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    } as unknown as AgentProposeAlbumOperationsDto;

    await expect(sut.proposeAlbumOperations(auth, session.id, dtoWithBypassedValidation)).rejects.toThrow(
      'Omit assetSource, assetIds, and assetSelectionHandleId for operations that do not operate on assets',
    );

    expect(selectionHandleRepository.getValidForPlanning).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('rejects malformed previousSearch source refs before repository lookup', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const sourceRef = 'asset-source:search:not-a-uuid';
    sessionRepository.getById.mockResolvedValue(session);

    const thrown = await sut
      .proposeAlbumOperations(auth, session.id, {
        summary: 'Add malformed source photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'previousSearch', sourceRef },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error.content.recovery).toEqual({
      kind: 'invalid-source-ref',
      attemptedSourceRef: sourceRef,
      expectedSourceKind: 'search',
      instruction: 'Rerun searchAssets, then retry with the returned selectionHandle.sourceRef.',
    });
    expect(selectionHandleRepository.getValidForPlanning).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('returns reviseProposedOperations recovery for malformed previousSearch source refs during revision', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const plan = makePlan({ sessionId: session.id });
    const sourceRef = 'asset-source:search:not-a-uuid';
    sessionRepository.getById.mockResolvedValue(session);

    const thrown = await sut
      .reviseProposedOperations(auth, session.id, plan.id, {
        feedback: 'Use the latest search.',
        summary: 'Revise source photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'previousSearch', sourceRef },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error.content).toMatchObject({
      toolName: AgentToolName.ReviseProposedOperations,
      recovery: {
        kind: 'invalid-source-ref',
        attemptedSourceRef: sourceRef,
        expectedSourceKind: 'search',
        instruction: 'Rerun searchAssets, then retry with the returned selectionHandle.sourceRef.',
      },
    });
    expect(error.content.hint).not.toContain('proposeAlbumOperations');
    expect(selectionHandleRepository.getValidForPlanning).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ReviseProposedOperations,
        status: AgentToolCallStatus.Denied,
        redactedResponseMetadata: {
          sourceRefRecovery: error.content.recovery,
        },
      }),
    );
  });

  it('returns invalid-source-ref recovery for expired previousSearch source refs without leaking asset samples', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const selectionHandleId = newUuid();
    const sourceRef = `asset-source:search:${selectionHandleId}` as const;
    const expiredHandle = {
      id: selectionHandleId,
      assetCount: 12,
      sourceToolCallId: null,
      createdAt: new Date('2026-05-21T06:00:00.000Z'),
      expiresAt: new Date('2026-05-21T07:00:00.000Z'),
    };
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.getForRecovery.mockResolvedValue(expiredHandle);

    const thrown = await sut
      .proposeAlbumOperations(auth, session.id, {
        summary: 'Add expired source photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'previousSearch', sourceRef },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error.content.recovery).toMatchObject({
      kind: 'invalid-source-ref',
      attemptedSourceRef: sourceRef,
      expectedSourceKind: 'search',
      expiredSourceRef: sourceRef,
    });
    expect(JSON.stringify(error.content.recovery)).not.toContain('assetIds');
    expect(JSON.stringify(error.content.recovery)).not.toContain('sampleAssetIds');
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('denies cross-session previousSearch source refs without leaking recovery metadata', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const selectionHandleId = newUuid();
    const sourceRef = `asset-source:search:${selectionHandleId}` as const;
    const leakMarkers = [
      newUuid(),
      newUuid(),
      'foreign-sample-id',
      'foreign-album-name',
      'foreign-owner@example.com',
      'foreign-owner-id',
    ];
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);

    const thrown = await sut
      .proposeAlbumOperations(auth, session.id, {
        summary: 'Add cross-session source photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'previousSearch', sourceRef },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
    });
    expect(selectionHandleRepository.getForRecovery).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
    });
    expect(error.content.recovery).toEqual({
      kind: 'invalid-source-ref',
      attemptedSourceRef: sourceRef,
      expectedSourceKind: 'search',
      instruction: 'Rerun searchAssets, then retry with the returned selectionHandle.sourceRef.',
    });
    const serialized = JSON.stringify(error.content);
    expect(serialized).not.toContain('expiredSourceRef');
    expect(serialized).not.toContain('assetIds');
    expect(serialized).not.toContain('sampleAssetIds');
    for (const marker of leakMarkers) {
      expect(serialized).not.toContain(marker);
    }
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('sanitizes invalid source ref recovery metadata before persisting planning audit details', () => {
    const sourceRef = `asset-source:search:${newUuid()}`;
    const metadata = (
      sut as unknown as {
        recoverablePlanningResponseMetadata: (recovery: Record<string, unknown>) => unknown;
      }
    ).recoverablePlanningResponseMetadata({
      kind: 'invalid-source-ref',
      attemptedSourceRef: sourceRef,
      expectedSourceKind: 'search',
      instruction: 'Rerun searchAssets.',
      expiredSourceRef: sourceRef,
      assetIds: [newUuid()],
      sampleAssetIds: [newUuid()],
      ownerEmail: 'foreign-owner@example.com',
    });

    expect(metadata).toEqual({
      sourceRefRecovery: {
        kind: 'invalid-source-ref',
        attemptedSourceRef: sourceRef,
        expectedSourceKind: 'search',
        instruction: 'Rerun searchAssets.',
        expiredSourceRef: sourceRef,
      },
    });
    expect(JSON.stringify(metadata)).not.toContain('assetIds');
    expect(JSON.stringify(metadata)).not.toContain('sampleAssetIds');
    expect(JSON.stringify(metadata)).not.toContain('foreign-owner@example.com');
  });

  it('rejects expired or cross-session selection handles before plan persistence', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const selectionHandleId = newUuid();
    const executingToolCall = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      error: 'Selection handle is expired or not available for this session',
    });
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);
    toolCallRepository.create.mockResolvedValue(executingToolCall);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Add expired handle photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSelectionHandleId: selectionHandleId,
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Selection handle is expired or not available for this session');

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Selection handle is expired or not available for this session',
        redactedRequestMetadata: expect.objectContaining({
          operationCount: 1,
          operationTypes: [AgentOperationType.AlbumAddAssets],
          attemptedSelectionHandleIds: [selectionHandleId],
        }),
      }),
    );
  });

  it('denies generated-example selection handles with recoverable metadata and no plan persistence', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const attemptedSelectionHandleId = '00000000-0000-4000-8000-000000000333';
    const validHandle = {
      id: newUuid(),
      assetCount: 250,
      sourceToolCallId: newUuid(),
      createdAt: new Date('2026-05-22T07:00:00.000Z'),
      expiresAt: new Date('2026-05-22T08:00:00.000Z'),
    };
    const expectedValidHandle = {
      ...validHandle,
      createdAt: validHandle.createdAt.toISOString(),
      expiresAt: validHandle.expiresAt.toISOString(),
    };
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([validHandle]);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);

    let thrown: unknown;
    try {
      await sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Add selected photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSelectionHandleId: attemptedSelectionHandleId,
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error.content).toEqual(
      expect.objectContaining({
        status: 'error',
        error: 'Selection handle is expired or not available for this session',
        retryable: true,
        hint: expect.stringContaining(`Retry proposeAlbumOperations with the exact handle ${validHandle.id}`),
        recovery: expect.objectContaining({
          kind: 'invalid-selection-handle',
          attemptedSelectionHandleId,
          looksLikeExamplePlaceholder: true,
          availableSelectionHandles: [expectedValidHandle],
        }),
      }),
    );
    expect(JSON.stringify(error.content.recovery)).not.toContain('assetIds');
    expect(JSON.stringify(error.content.recovery)).not.toContain('sampleAssetIds');
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Selection handle is expired or not available for this session',
        redactedResponseMetadata: {
          selectionHandleRecovery: error.content.recovery,
        },
      }),
    );
  });

  it('returns wrong-domain recovery and audit metadata when assetSelectionHandleId is a readable asset id', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const assetId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut
      .proposeAlbumOperations(auth, session.id, {
        summary: 'Add selected photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSelectionHandleId: assetId,
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error.content).toMatchObject({
      status: 'error',
      error: 'That value is an asset ID, not a selection handle ID.',
      toolName: AgentToolName.ProposeAlbumOperations,
      retryable: true,
      hint: 'Use a same-session selectionHandle.id returned by searchAssets, or use assetSource.search once available.',
      recovery: {
        kind: 'wrong_id_domain',
        field: 'operations[].assetSelectionHandleId',
        expectedDomain: 'selectionHandle',
        receivedDomain: 'asset',
        instruction:
          'Use a same-session selectionHandle.id returned by searchAssets, or use assetSource.search once available.',
      },
    });
    expect(JSON.stringify(error.content.recovery)).not.toContain(assetId);
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'That value is an asset ID, not a selection handle ID.',
        redactedResponseMetadata: {
          wrongIdDomainRecovery: {
            kind: 'wrong_id_domain',
            field: 'operations[].assetSelectionHandleId',
            expectedDomain: 'selectionHandle',
            receivedDomain: 'asset',
            instruction:
              'Use a same-session selectionHandle.id returned by searchAssets, or use assetSource.search once available.',
          },
        },
      }),
    );
    expect(selectionHandleRepository.listValidForRecovery).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('returns tool-aware wrong-domain recovery for workflow assetSource.selectionHandle', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const assetId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut
      .proposeAssetBatchFromSearch(auth, session.id, {
        action: { type: AgentOperationType.AssetSetFavorite, favorite: true },
        assetSource: { kind: 'selectionHandle', selectionHandleId: assetId },
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error.content).toMatchObject({
      status: 'error',
      toolName: AgentToolName.ProposeAssetBatchFromSearch,
      error: 'That value is an asset ID, not a selection handle ID.',
      retryable: true,
      hint: expect.stringContaining('proposeAssetBatchFromSearch'),
      recovery: {
        kind: 'wrong_id_domain',
        field: 'assetSource.selectionHandleId',
        expectedDomain: 'selectionHandle',
        receivedDomain: 'asset',
        instruction: expect.stringContaining('proposeAssetBatchFromSearch'),
      },
    });
    expect(error.content.recovery).not.toMatchObject({ field: 'operations[].assetSelectionHandleId' });
    expect(JSON.stringify(error.content.recovery)).not.toContain(assetId);
    expect(selectionHandleRepository.listValidForRecovery).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('returns operation assetSource field recovery when assetSource.selectionHandle is a readable asset id', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const assetId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut
      .proposeAlbumOperations(auth, session.id, {
        summary: 'Add selected photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSource: { kind: 'selectionHandle', selectionHandleId: assetId },
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error.content.recovery).toMatchObject({
      kind: 'wrong_id_domain',
      field: 'operations[].assetSource.selectionHandleId',
      expectedDomain: 'selectionHandle',
      receivedDomain: 'asset',
    });
    expect(error.content.recovery).not.toMatchObject({ field: 'operations[].assetSelectionHandleId' });
    expect(JSON.stringify(error.content.recovery)).not.toContain(assetId);
    expect(selectionHandleRepository.listValidForRecovery).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('returns wrong-domain recovery when assetSelectionHandleId is a readable person id', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const personId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut
      .proposeAlbumOperations(auth, session.id, {
        summary: 'Add selected photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSelectionHandleId: personId,
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error.content.recovery).toMatchObject({
      kind: 'wrong_id_domain',
      field: 'operations[].assetSelectionHandleId',
      expectedDomain: 'selectionHandle',
      receivedDomain: 'person',
    });
    expect(error.content.error).toBe('That value is a person ID, not a selection handle ID.');
    expect(JSON.stringify(error.content.recovery)).not.toContain(personId);
    expect(selectionHandleRepository.listValidForRecovery).not.toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('keeps inaccessible UUID-shaped assetSelectionHandleId values on invalid-selection-handle recovery', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const inaccessibleAssetId = newUuid();
    const leakMarkers = [
      'wrong_id_domain',
      'receivedDomain',
      'expectedDomain',
      'other-user-asset-name-leak',
      'other-user-person-name-leak',
      'other-user-owner-leak',
      'originalFileName',
      'exifInfo',
      'localDateTime',
      'birthDate',
    ];
    const availableHandle = {
      id: newUuid(),
      assetCount: 7,
      sourceToolCallId: newUuid(),
      createdAt: new Date('2026-05-22T07:00:00.000Z'),
      expiresAt: new Date('2026-05-22T08:00:00.000Z'),
    };
    const expectedAvailableHandle = {
      ...availableHandle,
      createdAt: availableHandle.createdAt.toISOString(),
      expiresAt: availableHandle.expiresAt.toISOString(),
    };
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([availableHandle]);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set());

    const thrown = await sut
      .proposeAlbumOperations(auth, session.id, {
        summary: 'Add selected photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSelectionHandleId: inaccessibleAssetId,
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error.content.recovery).toEqual({
      kind: 'invalid-selection-handle',
      attemptedSelectionHandleId: inaccessibleAssetId,
      looksLikeExamplePlaceholder: false,
      availableSelectionHandles: [expectedAvailableHandle],
      instruction: 'Retry proposeAlbumOperations with a valid same-session selection handle, or rerun searchAssets.',
    });
    const serializedContent = JSON.stringify(error.content);
    const serializedRecovery = JSON.stringify(error.content.recovery);
    for (const marker of leakMarkers) {
      expect(serializedContent).not.toContain(marker);
      expect(serializedRecovery).not.toContain(marker);
    }
    expect(serializedRecovery).not.toContain('assetIds');
    expect(serializedRecovery).not.toContain('sampleAssetIds');
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        redactedResponseMetadata: {
          selectionHandleRecovery: error.content.recovery,
        },
      }),
    );
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('lists multiple valid same-session handles without choosing one', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const attemptedSelectionHandleId = newUuid();
    const handles = [
      {
        id: newUuid(),
        assetCount: 20,
        sourceToolCallId: null,
        createdAt: new Date('2026-05-22T07:05:00.000Z'),
        expiresAt: new Date('2026-05-22T08:05:00.000Z'),
      },
      {
        id: newUuid(),
        assetCount: 10,
        sourceToolCallId: null,
        createdAt: new Date('2026-05-22T07:00:00.000Z'),
        expiresAt: new Date('2026-05-22T08:00:00.000Z'),
      },
    ];
    const expectedHandles = handles.map((handle) => ({
      ...handle,
      createdAt: handle.createdAt.toISOString(),
      expiresAt: handle.expiresAt.toISOString(),
    }));
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue(handles);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);

    const thrown = await sut
      .proposeAlbumOperations(auth, session.id, {
        summary: 'Add selected photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSelectionHandleId: attemptedSelectionHandleId,
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const recoverableError = thrown as AgentMcpRecoverableToolError;
    expect(recoverableError).toMatchObject({
      content: {
        hint: expect.stringContaining('Choose the intended same-session handle'),
        recovery: expect.objectContaining({ availableSelectionHandles: expectedHandles }),
      },
    });

    const responseMetadata = toolCallRepository.create.mock.calls.at(-1)?.[0].redactedResponseMetadata;
    expect(responseMetadata).toEqual({
      selectionHandleRecovery: expect.objectContaining({ availableSelectionHandles: expectedHandles }),
    });
    if (!responseMetadata || !('selectionHandleRecovery' in responseMetadata)) {
      throw new Error('Expected selection handle recovery response metadata');
    }
    expect(responseMetadata.selectionHandleRecovery.availableSelectionHandles).toEqual(expectedHandles);
    expect(recoverableError.content.hint).not.toContain(
      `Retry proposeAlbumOperations with the exact handle ${handles[0].id}`,
    );
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('instructs the model to rerun searchAssets when no valid handles are available', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Add selected photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSelectionHandleId: newUuid(),
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toMatchObject({
      content: {
        hint: expect.stringContaining('Rerun searchAssets'),
        recovery: expect.objectContaining({ availableSelectionHandles: [] }),
      },
    });
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('reports an attempted same-session expired handle without suggesting it as usable', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const attemptedSelectionHandleId = newUuid();
    const expiredHandle = {
      id: attemptedSelectionHandleId,
      assetCount: 12,
      sourceToolCallId: null,
      createdAt: new Date('2026-05-21T06:00:00.000Z'),
      expiresAt: new Date('2026-05-21T07:00:00.000Z'),
    };
    const expectedExpiredHandle = {
      ...expiredHandle,
      createdAt: expiredHandle.createdAt.toISOString(),
      expiresAt: expiredHandle.expiresAt.toISOString(),
    };
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
    selectionHandleRepository.getForRecovery.mockResolvedValue(expiredHandle);

    const thrown = await sut
      .proposeAlbumOperations(auth, session.id, {
        summary: 'Add selected photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSelectionHandleId: attemptedSelectionHandleId,
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error).toMatchObject({
      content: {
        hint: expect.stringContaining('expired'),
        recovery: expect.objectContaining({
          availableSelectionHandles: [],
          expiredSelectionHandle: expectedExpiredHandle,
        }),
      },
    });
    expect(error.content.hint).toContain('Rerun searchAssets');
    expect(error.content.hint).not.toContain(`Retry proposeAlbumOperations with the exact handle ${expiredHandle.id}`);
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('does not expose cross-session handles in recovery metadata', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const attemptedSelectionHandleId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Add selected photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSelectionHandleId: attemptedSelectionHandleId,
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toMatchObject({
      content: {
        recovery: expect.objectContaining({ availableSelectionHandles: [] }),
      },
    });
    expect(selectionHandleRepository.listValidForRecovery).toHaveBeenCalledWith({
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
      limit: 5,
    });
    expect(selectionHandleRepository.getForRecovery).toHaveBeenCalledWith({
      id: attemptedSelectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
    });
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('rejects empty selection handles before plan persistence', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const selectionHandleId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds: [],
      assetCount: 0,
      sampleAssetIds: [],
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({
        sessionId: session.id,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Selection handle did not contain any assets',
      }),
    );

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Add empty handle photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSelectionHandleId: selectionHandleId,
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Selection handle did not contain any assets');

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Selection handle did not contain any assets',
        redactedRequestMetadata: expect.objectContaining({
          attemptedSelectionHandleIds: [selectionHandleId],
        }),
      }),
    );
  });

  it('rejects set-cover selection handles above the cover candidate limit', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const selectionHandleId = newUuid();
    const assetIds = Array.from({ length: 501 }, () => newUuid());
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds.slice(0, 25),
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({
        sessionId: session.id,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Selection handle contains too many cover candidates',
      }),
    );

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Set cover from too many candidates',
        operations: [
          {
            type: AgentOperationType.AlbumSetCover,
            summary: 'Set cover',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            assetSelectionHandleId: selectionHandleId,
            payload: {},
            riskLevel: AgentOperationRiskLevel.Low,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Selection handle contains too many cover candidates');

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Selection handle contains too many cover candidates',
        redactedRequestMetadata: expect.objectContaining({
          attemptedSelectionHandleIds: [selectionHandleId],
        }),
      }),
    );
  });

  it('re-checks handle assets against current permissions and deleted assets', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const allowedAssetId = newUuid();
    const deletedOrDeniedAssetId = newUuid();
    const albumId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: newUuid(),
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds: [allowedAssetId, deletedOrDeniedAssetId],
      assetCount: 2,
      sampleAssetIds: [allowedAssetId, deletedOrDeniedAssetId],
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([allowedAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([allowedAssetId]));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Add stale handle photos',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetSelectionHandleId: newUuid(),
            payload: {},
            riskLevel: AgentOperationRiskLevel.Medium,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('One or more assets are not accessible');
  });

  it('keeps sparse item selection deterministic after applying a handle-derived plan', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid(), newUuid(), newUuid()];
    const { session, albumId, operation, plan } = makeAddAssetsPlan(auth, assetIds);
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue(plan);
    planRepository.completeApply.mockImplementation((_planId, updates) =>
      Promise.resolve(applyUpdatesToPlan(plan, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    albumService.addAssets.mockResolvedValue([
      { id: assetIds[0], success: true },
      { id: assetIds[2], success: true },
    ] as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {
        [operation.id]: { itemKind: 'asset', mode: 'only', itemIds: [assetIds[0], assetIds[2]] },
      },
      planRevision: plan.revision,
    });

    expect(albumService.addAssets).toHaveBeenCalledWith(auth, albumId, { ids: [assetIds[0], assetIds[2]] });
  });

  it('rejects a new-album target without a matching album.create and does not persist', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    const executingToolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing });
    toolCallRepository.create.mockResolvedValue(executingToolCall);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Broken plan.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add to missing new album.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-missing',
            assetIds: [assetId],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('No album.create operation found for temporaryTargetId: tmp-missing');
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('does not persist when creating the executing audit row fails', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockRejectedValue(new Error('audit insert failed'));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Portugal plan.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create Portugal.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-portugal',
            payload: { albumName: 'Portugal', description: '' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('audit insert failed');
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
    expect(sessionRepository.update).not.toHaveBeenCalled();
  });

  it('transitions the executing audit row to failed when repository persistence fails', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const executingToolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing });
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValue(executingToolCall);
    planRepository.createReplacementRevision.mockRejectedValue(new Error('database unavailable'));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Portugal plan.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create Portugal.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-portugal',
            payload: { albumName: 'Portugal', description: '' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('database unavailable');
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executingToolCall.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Failed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: null,
        redactedResponseMetadata: null,
        error: 'database unavailable',
      }),
    );
    expect(sessionRepository.update).not.toHaveBeenCalled();
  });

  it('audits denied for inaccessible existing album targets', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set());
    const executingToolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing });
    toolCallRepository.create.mockResolvedValue(executingToolCall);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Denied plan.',
        operations: [
          {
            type: AgentOperationType.AlbumUpdateDetails,
            summary: 'Rename inaccessible album.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            payload: { albumName: 'Private album' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('One or more target albums are not accessible');
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executingToolCall.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'One or more target albums are not accessible',
      }),
    );
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('audits denied for inaccessible asset ids', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    const executingToolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing });
    toolCallRepository.create.mockResolvedValue(executingToolCall);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Denied plan.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add inaccessible asset.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetIds: [assetId],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('One or more assets are not accessible');
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executingToolCall.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'One or more assets are not accessible',
      }),
    );
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('rejects duplicate create temporary target ids', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Denied }),
    );

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Broken plan.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create one.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-dup',
            payload: { albumName: 'One', description: '' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create two.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-dup',
            payload: { albumName: 'Two', description: '' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('rejects a write-scope disabled operation type', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        writeScope: { ...permissionPlanSnapshot.writeScope, addAssets: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Denied }),
    );

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Denied plan.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add to existing album.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetIds: [assetId],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow adding assets to albums');
  });

  it('normalizes missing expanded write-scope keys to false before operation permission checks', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const assetId = newUuid();
    const legacyPermissionPlan: AgentPermissionPlanSnapshot = {
      ...permissionPlanSnapshot,
      writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
    };
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: legacyPermissionPlan });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Denied }),
    );

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Denied plan.',
        operations: [
          {
            type: AgentOperationType.AlbumRemoveAssets,
            summary: 'Remove from existing album.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetIds: [assetId],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow removing assets from albums');
    expect((sut as any).normalizePermissionPlanSnapshot(legacyPermissionPlan).writeScope).toMatchObject({
      removeAssets: false,
      addMembersToSpaces: false,
      removeMembersFromSpaces: false,
      updateSpaceMemberRoles: false,
      updateAssetMetadata: false,
    });
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it.each([
    {
      field: 'createSpace',
      operation: {
        type: AgentOperationType.SpaceCreate,
        summary: 'Create space.',
        targetKind: AgentOperationTargetKind.NewSpace,
        temporaryTargetId: 'tmp-space',
        payload: { spaceName: 'Trip' },
      },
      error: 'Agent permission policy does not allow creating spaces',
    },
    {
      field: 'addAssetsToSpaces',
      operation: {
        type: AgentOperationType.SpaceAddAssets,
        summary: 'Add to space.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: newUuid(),
        assetIds: [newUuid()],
        payload: {},
      },
      error: 'Agent permission policy does not allow adding assets to spaces',
    },
    {
      field: 'removeAssetsFromSpaces',
      operation: {
        type: AgentOperationType.SpaceRemoveAssets,
        summary: 'Remove from space.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: newUuid(),
        assetIds: [newUuid()],
        payload: {},
      },
      error: 'Agent permission policy does not allow removing assets from spaces',
    },
    {
      field: 'updateSpaceDetails',
      operation: {
        type: AgentOperationType.SpaceUpdateDetails,
        summary: 'Rename space.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: newUuid(),
        payload: { spaceName: 'Trip' },
      },
      error: 'Agent permission policy does not allow updating space details',
    },
    {
      field: 'editAssets',
      operation: {
        type: AgentOperationType.AssetRotate,
        summary: 'Rotate.',
        targetKind: AgentOperationTargetKind.ImageEditBatch,
        assetIds: [newUuid()],
        payload: { angle: 90 },
      },
      error: 'Agent permission policy does not allow editing assets',
    },
    {
      field: 'favoriteAssets',
      operation: {
        type: AgentOperationType.AssetSetFavorite,
        summary: 'Favorite.',
        targetKind: AgentOperationTargetKind.AssetBatch,
        assetIds: [newUuid()],
        payload: { favorite: true },
      },
      error: 'Agent permission policy does not allow changing asset favorites',
    },
    {
      field: 'archiveAssets',
      operation: {
        type: AgentOperationType.AssetSetArchive,
        summary: 'Archive.',
        targetKind: AgentOperationTargetKind.AssetBatch,
        assetIds: [newUuid()],
        payload: { archived: true },
      },
      error: 'Agent permission policy does not allow archiving assets',
    },
    {
      field: 'lockAssets',
      operation: {
        type: AgentOperationType.AssetSetVisibility,
        summary: 'Move to Locked folder.',
        targetKind: AgentOperationTargetKind.AssetBatch,
        assetIds: [newUuid()],
        payload: { visibility: AssetVisibility.Locked },
      },
      error: 'Agent permission policy does not allow moving photos to the Locked folder',
    },
    {
      field: 'tagAssets',
      operation: {
        type: AgentOperationType.AssetAddTag,
        summary: 'Tag.',
        targetKind: AgentOperationTargetKind.AssetBatch,
        assetIds: [newUuid()],
        payload: { tagName: 'Receipts' },
      },
      error: 'Agent permission policy does not allow tagging assets',
    },
    {
      field: 'shareAlbums',
      operation: {
        type: AgentOperationType.AlbumAddUsers,
        summary: 'Share album.',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: newUuid(),
        payload: { albumUsers: [{ userId: newUuid(), role: AlbumUserRole.Viewer }] },
      },
      error: 'Agent permission policy does not allow sharing albums',
    },
    {
      field: 'shareAlbums',
      operation: {
        type: AgentOperationType.AlbumRemoveUsers,
        summary: 'Remove from album.',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: newUuid(),
        payload: { userIds: [newUuid()] },
      },
      error: 'Agent permission policy does not allow sharing albums',
    },
    {
      field: 'shareAlbums',
      operation: {
        type: AgentOperationType.AlbumUpdateUserRole,
        summary: 'Update album role.',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: newUuid(),
        payload: { userId: newUuid(), role: AlbumUserRole.Editor },
      },
      error: 'Agent permission policy does not allow sharing albums',
    },
    {
      field: 'deleteContainers',
      operation: {
        type: AgentOperationType.AlbumDelete,
        summary: 'Delete the Test album (photos are kept in your library).',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: newUuid(),
        payload: {},
      },
      error: 'Agent permission policy does not allow deleting albums',
    },
    {
      field: 'deleteContainers',
      operation: {
        type: AgentOperationType.SpaceDelete,
        summary: "Delete the Family space (photos stay in members' libraries).",
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: newUuid(),
        payload: {},
      },
      error: 'Agent permission policy does not allow deleting spaces',
    },
  ])('rejects %s write-scope disabled operation type', async ({ field, operation, error }) => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedWriteScope, [field]: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Denied }),
    );

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Denied plan.',
        operations: [{ ...operation, enabled: true, riskLevel: AgentOperationRiskLevel.Low } as never],
      }),
    ).rejects.toThrow(error);

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('revises only a proposed current plan owned by the session and stores a replacement revision', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const oldPlan = makePlan({ sessionId: session.id });
    const newPlan = makePlan({ sessionId: session.id, revision: 2 });
    sessionRepository.getById.mockResolvedValue(session);
    sessionRepository.update.mockResolvedValue({ ...session, status: AgentSessionStatus.WaitingForPlanReview });
    planRepository.getByIdForSession.mockResolvedValue(oldPlan);
    planRepository.getCurrentBySessionId.mockResolvedValue(oldPlan);
    planRepository.createReplacementRevision.mockResolvedValue(newPlan);
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({ sessionId: session.id, toolName: AgentToolName.ReviseProposedOperations }),
    );

    await expect(
      sut.reviseProposedOperations(auth, session.id, oldPlan.id, {
        feedback: 'Rename it.',
        summary: 'Revised plan.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create Portugal renamed.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-portugal',
            payload: { albumName: 'Portugal highlights', description: '' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).resolves.toMatchObject({ status: 'success', plan: { id: newPlan.id, revision: 2 } });
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        plan: { sessionId: session.id, status: AgentOperationPlanStatus.Proposed, summary: 'Revised plan.' },
      }),
    );
  });

  it('audits denied with plan metadata when revising a superseded plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const supersededPlan = makePlan({ sessionId: session.id, status: AgentOperationPlanStatus.Superseded });
    const executingToolCall = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ReviseProposedOperations,
      status: AgentToolCallStatus.Executing,
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(supersededPlan);
    planRepository.getCurrentBySessionId.mockResolvedValue(supersededPlan);
    toolCallRepository.create.mockResolvedValue(executingToolCall);

    await expect(
      sut.reviseProposedOperations(auth, session.id, supersededPlan.id, {
        summary: 'Invalid revision.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create duplicate revision.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-invalid',
            payload: { albumName: 'Invalid', description: '' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ReviseProposedOperations,
        status: AgentToolCallStatus.Executing,
        redactedRequestMetadata: expect.objectContaining({ planId: supersededPlan.id }),
      }),
    );
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executingToolCall.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Agent operation plan not found',
      }),
    );
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('accepts shared editor albums when shared-space scope is enabled', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { ...permissionPlanSnapshot.assetScope, owned: false, sharedSpaces: true },
      },
    });
    const plan = makePlan({ sessionId: session.id });
    sessionRepository.getById.mockResolvedValue(session);
    sessionRepository.update.mockResolvedValue({ ...session, status: AgentSessionStatus.WaitingForPlanReview });
    accessRepository.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
    planRepository.createReplacementRevision.mockResolvedValue(plan);
    toolCallRepository.create.mockResolvedValue(makeToolCall({ sessionId: session.id }));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Shared plan.',
        operations: [
          {
            type: AgentOperationType.AlbumUpdateDetails,
            summary: 'Rename shared album.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            payload: { albumName: 'Shared album' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).resolves.toMatchObject({ status: 'success' });
    expect(accessRepository.album.checkSharedAlbumAccess).toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).toHaveBeenCalled();
  });

  it('accepts shared assets when shared-space scope is enabled', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { ...permissionPlanSnapshot.assetScope, sharedSpaces: true },
      },
    });
    const plan = makePlan({ sessionId: session.id });
    sessionRepository.getById.mockResolvedValue(session);
    sessionRepository.update.mockResolvedValue({ ...session, status: AgentSessionStatus.WaitingForPlanReview });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentLockedIds.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    planRepository.createReplacementRevision.mockResolvedValue(plan);
    toolCallRepository.create.mockResolvedValue(makeToolCall({ sessionId: session.id }));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Shared asset plan.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add shared asset.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetIds: [assetId],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).resolves.toMatchObject({ status: 'success' });
    expect(accessRepository.asset.checkSpaceAccess).toHaveBeenCalled();
    expect(planRepository.createReplacementRevision).toHaveBeenCalled();
  });

  it('rejects proposed operations when the session stops accepting revisions after validation', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id });
    const executingToolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentLockedIds.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    planRepository.createReplacementRevision.mockResolvedValue(null as unknown as AgentOperationPlanWithOperations);
    toolCallRepository.create.mockResolvedValue(executingToolCall);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Late plan.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add late asset.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetIds: [assetId],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('Agent session is not accepting plan revisions');
    expect(sessionRepository.update).not.toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.WaitingForPlanReview,
    });
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executingToolCall.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    );
  });

  it('denies locked assets without locked scope and elevated permission', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { owned: true, sharedSpaces: true, locked: false },
      },
    });
    const executingToolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentLockedIds.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set());
    toolCallRepository.create.mockResolvedValue(executingToolCall);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Locked asset plan.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add locked asset.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetIds: [assetId],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('One or more assets are not accessible');
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([assetId]), false);
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executingToolCall.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    );
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('allows locked assets with locked scope and elevated permission', async () => {
    const auth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
    const albumId = newUuid();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { owned: true, sharedSpaces: false, locked: true },
      },
    });
    const plan = makePlan({ sessionId: session.id });
    sessionRepository.getById.mockResolvedValue(session);
    sessionRepository.update.mockResolvedValue({ ...session, status: AgentSessionStatus.WaitingForPlanReview });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    planRepository.createReplacementRevision.mockResolvedValue(plan);
    toolCallRepository.create.mockResolvedValue(makeToolCall({ sessionId: session.id }));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Locked asset plan.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add locked asset.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetIds: [assetId],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).resolves.toMatchObject({ status: 'success' });
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([assetId]), true);
    expect(planRepository.createReplacementRevision).toHaveBeenCalled();
  });

  it('returns null when no current plan exists', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getCurrentBySessionId.mockImplementation(() => Promise.resolve(void 0));

    await expect(sut.getCurrentPlan(auth, session.id)).resolves.toBeNull();
  });

  it('enriches current asset.updateMetadata plans with representative before and proposed metadata', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const firstAssetId = newUuid();
    const secondAssetId = newUuid();
    const operation = makeOperation({
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds: [firstAssetId, secondAssetId],
      payload: {
        description: '',
        rating: null,
        dateTimeOriginal: '1998-06-01T12:00:00.000Z',
        timeZone: 'Europe/Berlin',
        latitude: 52.52,
        longitude: 13.405,
      },
    });
    const plan = makePlan({ sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    (assetRepository as any).getAgentMetadataReviewByIds = vi.fn().mockResolvedValue([
      makeMetadataReviewRow(firstAssetId, {
        description: 'Old caption',
        rating: 4,
        dateTimeOriginal: new Date('1997-01-01T08:00:00.000Z'),
        timeZone: 'UTC',
        latitude: 48.8566,
        longitude: 2.3522,
      }),
      makeMetadataReviewRow(secondAssetId, null),
    ]);

    const result = await sut.getCurrentPlan(auth, session.id);
    const reviewMetadata = (result?.operations[0] as any).reviewMetadata.assetMetadata;

    expect((assetRepository as any).getAgentMetadataReviewByIds).toHaveBeenCalledWith([firstAssetId, secondAssetId]);
    expect(reviewMetadata.sampleAssetIds).toEqual([firstAssetId, secondAssetId]);
    expect(reviewMetadata.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'description',
          label: 'Description',
          proposedValue: null,
          proposedValueKind: 'clear',
          previousValues: [
            { assetId: firstAssetId, value: 'Old caption', valueKind: 'known' },
            { assetId: secondAssetId, value: null, valueKind: 'unknown' },
          ],
        }),
        expect.objectContaining({
          key: 'rating',
          label: 'Rating',
          proposedValue: null,
          proposedValueKind: 'clear',
          previousValues: [
            { assetId: firstAssetId, value: '4', valueKind: 'known' },
            { assetId: secondAssetId, value: null, valueKind: 'unknown' },
          ],
        }),
        expect.objectContaining({
          key: 'dateTimeOriginal',
          label: 'Date taken',
          proposedValue: '1998-06-01T12:00:00.000Z',
          proposedValueKind: 'known',
          previousValues: [
            { assetId: firstAssetId, value: '1997-01-01T08:00:00.000Z', valueKind: 'known' },
            { assetId: secondAssetId, value: null, valueKind: 'unknown' },
          ],
        }),
        expect.objectContaining({
          key: 'timeZone',
          label: 'Time zone',
          proposedValue: 'Europe/Berlin',
          proposedValueKind: 'known',
        }),
        expect.objectContaining({
          key: 'location',
          label: 'Location',
          proposedValue: '52.52, 13.405',
          proposedValueKind: 'known',
          previousValues: [
            { assetId: firstAssetId, value: '48.8566, 2.3522', valueKind: 'known' },
            { assetId: secondAssetId, value: null, valueKind: 'unknown' },
          ],
        }),
      ]),
    );
  });

  it('represents relative date shifts as metadata review fields', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const assetId = newUuid();
    const operation = makeOperation({
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: { dateTimeRelative: 90 },
    });
    const plan = makePlan({ sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    (assetRepository as any).getAgentMetadataReviewByIds = vi.fn().mockResolvedValue([
      makeMetadataReviewRow(assetId, {
        dateTimeOriginal: new Date('1997-01-01T08:00:00.000Z'),
      }),
    ]);

    const result = await sut.getCurrentPlan(auth, session.id);

    expect((result?.operations[0] as any).reviewMetadata.assetMetadata.fields).toEqual([
      expect.objectContaining({
        key: 'dateTimeRelative',
        label: 'Date shift',
        previousValues: [{ assetId, value: '1997-01-01T08:00:00.000Z', valueKind: 'known' }],
        proposedValue: '90',
        proposedValueKind: 'relative',
      }),
    ]);
  });

  it('ignores unsupported fields on already-stored asset.updateMetadata operations during review enrichment', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const assetId = newUuid();
    const operation = makeOperation({
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: { placeName: 'Paris' },
    } as any);
    const plan = makePlan({ sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    (assetRepository as any).getAgentMetadataReviewByIds = vi
      .fn()
      .mockResolvedValue([makeMetadataReviewRow(assetId, { description: 'Current caption' })]);

    const result = await sut.getCurrentPlan(auth, session.id);

    expect(result?.operations[0].type).toBe(AgentOperationType.AssetUpdateMetadata);
    expect((result?.operations[0] as any).reviewMetadata).toBeUndefined();
  });

  it('returns applied plans through history while current plan remains proposed-only', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Running });
    const appliedPlan = makePlan({
      sessionId: session.id,
      status: AgentOperationPlanStatus.Applied,
      operations: [makeOperation({ status: AgentOperationStatus.Applied, result: { albumId: newUuid() } })],
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getCurrentBySessionId.mockResolvedValue(void 0);
    planRepository.getAppliedBySessionId.mockResolvedValue([appliedPlan]);

    await expect(sut.getCurrentPlan(auth, session.id)).resolves.toBeNull();
    await expect(sut.getAppliedPlans(auth, session.id)).resolves.toEqual([
      expect.objectContaining({ id: appliedPlan.id, status: AgentOperationPlanStatus.Applied }),
    ]);
  });

  it('hydrates applied asset.updateMetadata history from the persisted pre-apply review snapshot', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Running });
    const assetId = newUuid();
    const reviewMetadata = {
      assetMetadata: {
        fields: [
          {
            key: 'description',
            label: 'Description',
            previousValues: [{ assetId, value: 'Before apply', valueKind: 'known' }],
            proposedValue: 'After apply',
            proposedValueKind: 'known',
          },
        ],
        sampleAssetIds: [assetId],
        warnings: [],
      },
    };
    const appliedPlan = makePlan({
      sessionId: session.id,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        makeOperation({
          type: AgentOperationType.AssetUpdateMetadata,
          targetKind: AgentOperationTargetKind.AssetBatch,
          targetId: null,
          temporaryTargetId: null,
          assetIds: [assetId],
          payload: { description: 'After apply' },
          status: AgentOperationStatus.Applied,
          result: { assetIds: [assetId], reviewMetadata } as any,
        }),
      ],
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getAppliedBySessionId.mockResolvedValue([appliedPlan]);
    (assetRepository as any).getAgentMetadataReviewByIds = vi
      .fn()
      .mockResolvedValue([makeMetadataReviewRow(assetId, { description: 'Current value' })]);

    const result = await sut.getAppliedPlans(auth, session.id);

    expect((result[0].operations[0] as any).reviewMetadata).toEqual(reviewMetadata);
    expect((assetRepository as any).getAgentMetadataReviewByIds).not.toHaveBeenCalled();
  });

  it('throws not found for sessions not owned by the user', async () => {
    const auth = AuthFactory.create();
    sessionRepository.getById.mockImplementation(() => Promise.resolve(void 0));

    await expect(sut.getCurrentPlan(auth, newUuid())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects proposal writes for terminal sessions', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Completed });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Late plan.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create too late.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-late',
            payload: { albumName: 'Too late', description: '' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('Agent session is not active');
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('proposes another plan after an applied plan without hiding applied history', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Running });
    const appliedPlan = makePlan({ sessionId: session.id, status: AgentOperationPlanStatus.Applied, revision: 1 });
    const proposedPlan = makePlan({ sessionId: session.id, status: AgentOperationPlanStatus.Proposed, revision: 2 });
    const executingToolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing });
    const completedToolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Completed });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.createReplacementRevision.mockResolvedValue(proposedPlan);
    planRepository.getAppliedBySessionId.mockResolvedValue([appliedPlan]);
    toolCallRepository.create.mockResolvedValue(executingToolCall);
    toolCallRepository.transition.mockResolvedValue(completedToolCall);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Follow-up plan.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create the next album.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-next',
            payload: { albumName: 'Next album', description: '' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).resolves.toMatchObject({
      status: 'success',
      plan: { id: proposedPlan.id, status: AgentOperationPlanStatus.Proposed, revision: 2 },
    });
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.WaitingForPlanReview,
    });
    await expect(sut.getAppliedPlans(auth, session.id)).resolves.toEqual([
      expect.objectContaining({ id: appliedPlan.id, status: AgentOperationPlanStatus.Applied }),
    ]);
  });

  it('rejects revisions for superseded plans', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const supersededPlan = makePlan({ sessionId: session.id, status: AgentOperationPlanStatus.Superseded });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(supersededPlan);
    planRepository.getCurrentBySessionId.mockResolvedValue(supersededPlan);
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({
        sessionId: session.id,
        toolName: AgentToolName.ReviseProposedOperations,
        status: AgentToolCallStatus.Executing,
      }),
    );

    await expect(
      sut.reviseProposedOperations(auth, session.id, supersededPlan.id, {
        summary: 'Invalid revision.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create duplicate revision.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-invalid',
            payload: { albumName: 'Invalid', description: '' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('audits denied with plan metadata when summarizing a missing or non-current plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const requestedPlanId = newUuid();
    const currentPlan = makePlan({ sessionId: session.id });
    const executingToolCall = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.SummarizePlan,
      status: AgentToolCallStatus.Executing,
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(void 0);
    planRepository.getCurrentBySessionId.mockResolvedValue(currentPlan);
    toolCallRepository.create.mockResolvedValue(executingToolCall);

    await expect(sut.summarizePlan(auth, session.id, requestedPlanId, { focus: 'risk' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.SummarizePlan,
        status: AgentToolCallStatus.Executing,
        redactedRequestMetadata: expect.objectContaining({ planId: requestedPlanId }),
      }),
    );
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executingToolCall.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Agent operation plan not found',
      }),
    );
  });

  it('summarizes the current plan and writes a completed planning audit row', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const plan = makePlan({ sessionId: session.id });
    const executingToolCall = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.SummarizePlan,
      status: AgentToolCallStatus.Executing,
    });
    const completedToolCall = makeToolCall({ sessionId: session.id, toolName: AgentToolName.SummarizePlan });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    toolCallRepository.create.mockResolvedValue(executingToolCall);
    toolCallRepository.transition.mockResolvedValue(completedToolCall);

    const result = await sut.summarizePlan(auth, session.id, plan.id, { focus: 'risk' });

    expect(result).toMatchObject({ status: 'success', plan: { id: plan.id }, toolCall: { id: completedToolCall.id } });
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        toolName: AgentToolName.SummarizePlan,
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        dataClass: AgentToolDataClass.Plan,
        redactedRequestMetadata: { planId: plan.id, operationCount: 0, operationTypes: [], albumIds: [], assetIds: [] },
        redactedResponseMetadata: null,
      }),
    );
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executingToolCall.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        redactedResponseMetadata: { planId: plan.id, operationIds: plan.operations.map((operation) => operation.id) },
        error: null,
      }),
    );
    expect(activityEventService.createSystemEvent).not.toHaveBeenCalled();
  });

  it('summarizes an already-applied current plan and writes a completed planning audit row', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Completed });
    const plan = makePlan({ sessionId: session.id, status: AgentOperationPlanStatus.Applied });
    const executingToolCall = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.SummarizePlan,
      status: AgentToolCallStatus.Executing,
    });
    const completedToolCall = makeToolCall({ sessionId: session.id, toolName: AgentToolName.SummarizePlan });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    toolCallRepository.create.mockResolvedValue(executingToolCall);
    toolCallRepository.transition.mockResolvedValue(completedToolCall);

    const result = await sut.summarizePlan(auth, session.id, plan.id, { focus: 'applied operations' });

    expect(result).toMatchObject({
      status: 'success',
      plan: { id: plan.id, status: AgentOperationPlanStatus.Applied },
      toolCall: { id: completedToolCall.id },
    });
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        toolName: AgentToolName.SummarizePlan,
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        dataClass: AgentToolDataClass.Plan,
        redactedRequestMetadata: { planId: plan.id, operationCount: 0, operationTypes: [], albumIds: [], assetIds: [] },
        redactedResponseMetadata: null,
      }),
    );
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executingToolCall.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        redactedResponseMetadata: { planId: plan.id, operationIds: plan.operations.map((operation) => operation.id) },
        error: null,
      }),
    );
  });

  it('rejects stale plan revisions before claiming the plan', async () => {
    const auth = AuthFactory.create();
    const { session, operation, plan } = makeAddAssetsPlan(auth, [newUuid()]);
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [operation.id],
        planRevision: plan.revision + 1,
      }),
    ).rejects.toThrow('Agent operation plan revision is stale');

    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
    expect(albumService.addAssets).not.toHaveBeenCalled();
  });

  it('rejects sparse selections for operation ids outside the selected operation set', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const { session, operation, plan } = makeAddAssetsPlan(auth, [assetId]);
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [operation.id],
        itemSelections: {
          [newUuid()]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetId] },
        },
      }),
    ).rejects.toThrow('One or more item selection operation ids are not selected');

    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  });

  it('rejects field overrides for operation ids outside the current plan before selected-set validation', async () => {
    const auth = AuthFactory.create();
    const { session, operation, plan } = makeAddAssetsPlan(auth, [newUuid()]);
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [operation.id],
        fieldOverrides: {
          [newUuid()]: { albumName: 'Portugal highlights' },
        },
      }),
    ).rejects.toThrow('One or more field override operation ids are not in the current plan');

    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  });

  it('rejects field overrides for operation ids outside the selected operation set', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const selectedOperation = makeOperation({ id: newUuid(), planId: 'plan-id' });
    const unselectedOperation = makeOperation({ id: newUuid(), planId: 'plan-id', position: 1 });
    const plan = makePlan({
      id: 'plan-id',
      sessionId: session.id,
      operations: [selectedOperation, unselectedOperation],
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [selectedOperation.id],
        fieldOverrides: {
          [unselectedOperation.id]: { albumName: 'Portugal highlights' },
        },
      }),
    ).rejects.toThrow('One or more field override operation ids are not selected');

    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  });

  it('rejects sparse selections containing asset ids outside the operation affected set', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const { session, operation, plan } = makeAddAssetsPlan(auth, [assetId]);
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [operation.id],
        itemSelections: {
          [operation.id]: { itemKind: 'asset', mode: 'only', itemIds: [newUuid()] },
        },
      }),
    ).rejects.toThrow('One or more selected item ids are not affected by the operation');

    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  });

  it('rejects sparse selections for operations without affected assets', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const createOperation = makeOperation({ id: newUuid(), planId: 'plan-id', temporaryTargetId: 'tmp-portugal' });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [createOperation.id],
        itemSelections: {
          [createOperation.id]: { itemKind: 'asset', mode: 'only', itemIds: [newUuid()] },
        },
      }),
    ).rejects.toThrow('Item selection is not supported for one or more operations');

    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  });

  it('applies add-assets operations with filtered allExcept asset ids', async () => {
    const auth = AuthFactory.create();
    const keptAssetId = newUuid();
    const excludedAssetId = newUuid();
    const { session, albumId, operation, plan } = makeAddAssetsPlan(auth, [keptAssetId, excludedAssetId]);
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        {
          ...operation,
          status: AgentOperationStatus.Applied,
          result: { albumId, assetIds: [keptAssetId], assetResults: [{ id: keptAssetId, success: true }] },
        },
      ],
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([keptAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([keptAssetId]));
    albumService.addAssets.mockResolvedValue([{ id: keptAssetId, success: true }]);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {
        [operation.id]: { itemKind: 'asset', mode: 'allExcept', itemIds: [excludedAssetId] },
      },
      planRevision: plan.revision,
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([keptAssetId]), false);
    expect(albumService.addAssets).toHaveBeenCalledWith(auth, albumId, { ids: [keptAssetId] });
  });

  it('applies a large add-assets plan with sparse exclusions and records bulk partial failures', async () => {
    const auth = AuthFactory.create();
    const assetIds = Array.from({ length: 10_000 }, () => newUuid());
    const excludedAssetIds = [assetIds[17], assetIds[2500], assetIds[9999]];
    const failedAssetId = assetIds[4000];
    const selectedAssetIds = assetIds.filter((id) => !excludedAssetIds.includes(id));
    const successfulAssetIds = selectedAssetIds.filter((id) => id !== failedAssetId);
    const { session, albumId, operation, plan } = makeAddAssetsPlan(auth, assetIds);
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(selectedAssetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(selectedAssetIds));
    albumService.addAssets.mockResolvedValue(
      selectedAssetIds.map((id) =>
        id === failedAssetId ? { id, success: false, error: BulkIdErrorReason.DUPLICATE } : { id, success: true },
      ),
    );

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {
        [operation.id]: { itemKind: 'asset', mode: 'allExcept', itemIds: excludedAssetIds },
      },
      planRevision: plan.revision,
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.failedOperationIds).toEqual([operation.id]);
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(
      auth.user.id,
      new Set(selectedAssetIds),
      false,
    );
    expect(albumService.addAssets).toHaveBeenCalledWith(auth, albumId, { ids: selectedAssetIds });
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Failed,
        result: {
          albumId,
          assetIds: successfulAssetIds,
          assetResults: selectedAssetIds.map((id) =>
            id === failedAssetId ? { id, success: false, error: BulkIdErrorReason.DUPLICATE } : { id, success: true },
          ),
        },
        error: 'Failed to add 1 asset(s)',
      }),
    ]);
  });

  it('fails safely without mutating when a large search page becomes stale before apply', async () => {
    const auth = AuthFactory.create();
    const assetIds = Array.from({ length: 10_000 }, () => newUuid());
    const staleAssetId = assetIds[7010];
    const readableAssetIds = assetIds.filter((id) => id !== staleAssetId);
    const { session, albumId, operation, plan } = makeAddAssetsPlan(auth, assetIds);
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(readableAssetIds));

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {
        [operation.id]: { itemKind: 'asset', mode: 'allExcept', itemIds: [] },
      },
      planRevision: plan.revision,
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.failedOperationIds).toEqual([operation.id]);
    expect(albumService.addAssets).not.toHaveBeenCalled();
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Failed,
        error: 'One or more assets are not accessible',
      }),
    ]);
  });

  it('skips an asset operation when sparse selection leaves no selected assets', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const { session, operation, plan } = makeAddAssetsPlan(auth, [assetId]);
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        {
          ...operation,
          status: AgentOperationStatus.Skipped,
          result: { skippedReason: 'No selected items for operation' },
        },
      ],
    });

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {
        [operation.id]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetId] },
      },
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.skippedOperationIds).toEqual([operation.id]);
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'No selected items for operation' },
      }),
    ]);
    expect(albumService.addAssets).not.toHaveBeenCalled();
  });

  it('skips a cover operation when its cover asset is excluded', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const albumId = newUuid();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const coverOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumSetCover,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [coverOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        {
          ...coverOperation,
          status: AgentOperationStatus.Skipped,
          result: { skippedReason: 'No selected items for operation' },
        },
      ],
    });

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [coverOperation.id],
      itemSelections: {
        [coverOperation.id]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetId] },
      },
    });

    expect(result.skippedOperationIds).toEqual([coverOperation.id]);
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: coverOperation.id,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'No selected items for operation' },
      }),
    ]);
    expect(albumService.update).not.toHaveBeenCalled();
  });

  it('skips a dependent operation when its dependency has no selected items', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const addOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumAddAssets,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: newUuid(),
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: {},
    });
    const coverOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      position: 1,
      type: AgentOperationType.AlbumSetCover,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: addOperation.targetId,
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: {},
      dependencyIds: [addOperation.id],
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [addOperation, coverOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        {
          ...addOperation,
          status: AgentOperationStatus.Skipped,
          result: { skippedReason: 'No selected items for operation' },
        },
        {
          ...coverOperation,
          status: AgentOperationStatus.Skipped,
          result: { skippedReason: 'Dependency was not applied' },
        },
      ],
    });

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [addOperation.id, coverOperation.id],
      itemSelections: {
        [addOperation.id]: { itemKind: 'asset', mode: 'none' },
      },
    });

    expect(result.skippedOperationIds).toEqual([addOperation.id, coverOperation.id]);
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: addOperation.id,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'No selected items for operation' },
      }),
      expect.objectContaining({
        id: coverOperation.id,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'Dependency was not applied' },
      }),
    ]);
    expect(albumService.addAssets).not.toHaveBeenCalled();
    expect(albumService.update).not.toHaveBeenCalled();
  });

  it('applies selected album operations in stored order and returns the session to running', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const albumId = newUuid();
    const assetId = newUuid();
    const createOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      position: 0,
      type: AgentOperationType.AlbumCreate,
      temporaryTargetId: 'tmp-portugal',
      payload: { albumName: 'Portugal', description: 'Lisbon and Porto' },
    });
    const addOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      position: 1,
      type: AgentOperationType.AlbumAddAssets,
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'tmp-portugal',
      assetIds: [assetId],
      payload: {},
      dependencyIds: [createOperation.id],
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation, addOperation] });
    const appliedPlan = makePlan({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        { ...createOperation, status: AgentOperationStatus.Applied, result: { albumId } },
        { ...addOperation, status: AgentOperationStatus.Applied, result: { albumId, assetIds: [assetId] } },
      ],
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue(appliedPlan);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    albumService.create.mockResolvedValue({ id: albumId } as never);
    albumService.addAssets.mockResolvedValue([{ id: assetId, success: true }]);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [createOperation.id, addOperation.id],
    });

    expect(result).toMatchObject({
      status: AgentOperationApplyStatus.Applied,
      appliedOperationIds: [createOperation.id, addOperation.id],
      skippedOperationIds: [],
      failedOperationIds: [],
      plan: { id: plan.id, status: AgentOperationPlanStatus.Applied },
    });
    expect(albumService.create).toHaveBeenCalledWith(auth, {
      albumName: 'Portugal',
      description: 'Lisbon and Porto',
      assetIds: [],
    });
    expect(albumService.addAssets).toHaveBeenCalledWith(auth, albumId, { ids: [assetId] });
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({ id: createOperation.id, status: AgentOperationStatus.Applied }),
      expect.objectContaining({ id: addOperation.id, status: AgentOperationStatus.Applied }),
    ]);
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
      endedAt: null,
    });
    expect(sessionRepository.update).not.toHaveBeenCalledWith(
      auth.user.id,
      session.id,
      expect.objectContaining({ status: AgentSessionStatus.Completed }),
    );
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', auth.user.id, {
      type: 'operation-plan-applied',
      sessionId: session.id,
      planId: plan.id,
      status: AgentOperationApplyStatus.Applied,
      appliedCount: 2,
      skippedCount: 0,
      failedCount: 0,
    });
  });

  it.each([
    AgentOperationType.AlbumAddAssets,
    AgentOperationType.SpaceAddAssets,
    AgentOperationType.AssetAddTag,
    AgentOperationType.AssetSetFavorite,
    AgentOperationType.AssetSetArchive,
    AgentOperationType.AssetSetVisibility,
    AgentOperationType.AssetRotate,
  ])('treats people-search asset ids as normal %s plan assets and keeps the session running', async (type) => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const assetIds = [newUuid(), newUuid()];
    const albumId = newUuid();
    const spaceId = newUuid();
    const tagId = newUuid();
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type,
      targetKind:
        type === AgentOperationType.AlbumAddAssets
          ? AgentOperationTargetKind.ExistingAlbum
          : type === AgentOperationType.SpaceAddAssets
            ? AgentOperationTargetKind.ExistingSpace
            : type === AgentOperationType.AssetRotate
              ? AgentOperationTargetKind.ImageEditBatch
              : AgentOperationTargetKind.AssetBatch,
      targetId:
        type === AgentOperationType.AlbumAddAssets
          ? albumId
          : type === AgentOperationType.SpaceAddAssets
            ? spaceId
            : null,
      temporaryTargetId: null,
      assetIds,
      payload:
        type === AgentOperationType.AssetAddTag
          ? { tagId }
          : type === AgentOperationType.AssetSetFavorite
            ? { favorite: true }
            : type === AgentOperationType.AssetSetArchive
              ? { archived: true }
              : type === AgentOperationType.AssetSetVisibility
                ? { visibility: AssetVisibility.Locked }
                : type === AgentOperationType.AssetRotate
                  ? { angle: 90 }
                  : {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    accessRepository.tag.checkOwnerAccess.mockResolvedValue(new Set([tagId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    albumService.addAssets.mockResolvedValue(assetIds.map((id) => ({ id, success: true })));
    sharedSpaceService.addAssets.mockResolvedValue(undefined as never);
    tagService.addAssets.mockResolvedValue(assetIds.map((id) => ({ id, success: true })));
    assetService.updateAll.mockResolvedValue(undefined as never);
    assetRepository.getForEdit.mockResolvedValue({
      type: AssetType.Image,
      livePhotoVideoId: null,
      originalPath: '/photos/image.jpg',
      originalFileName: 'image.jpg',
      duration: null,
      exifImageWidth: 400,
      exifImageHeight: 300,
      orientation: null,
      projectionType: null,
    });
    assetService.getAssetEdits.mockResolvedValue({ assetId: assetIds[0], edits: [] } as never);
    assetService.editAsset.mockResolvedValue({ assetId: assetIds[0], edits: [] } as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(result.appliedOperationIds).toEqual([operation.id]);
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Applied,
        result: expect.objectContaining({ assetIds }),
      }),
    ]);
    switch (type) {
      case AgentOperationType.AlbumAddAssets: {
        expect(albumService.addAssets).toHaveBeenCalledWith(auth, albumId, { ids: assetIds });
        break;
      }
      case AgentOperationType.SpaceAddAssets: {
        expect(sharedSpaceService.addAssets).toHaveBeenCalledWith(auth, spaceId, { assetIds });
        break;
      }
      case AgentOperationType.AssetAddTag: {
        expect(tagService.addAssets).toHaveBeenCalledWith(auth, tagId, { ids: assetIds });
        break;
      }
      case AgentOperationType.AssetSetFavorite: {
        expect(assetService.updateAll).toHaveBeenCalledWith(auth, { ids: assetIds, isFavorite: true });
        break;
      }
      case AgentOperationType.AssetSetArchive: {
        expect(assetService.updateAll).toHaveBeenCalledWith(auth, {
          ids: assetIds,
          visibility: AssetVisibility.Archive,
        });
        break;
      }
      case AgentOperationType.AssetSetVisibility: {
        expect(assetService.updateAll).toHaveBeenCalledWith(auth, {
          ids: assetIds,
          visibility: AssetVisibility.Locked,
        });
        break;
      }
      case AgentOperationType.AssetRotate: {
        expect(assetService.editAsset).toHaveBeenCalledTimes(assetIds.length);
        for (const assetId of assetIds) {
          expect(assetService.getAssetEdits).toHaveBeenCalledWith(auth, assetId);
          expect(assetService.editAsset).toHaveBeenCalledWith(auth, assetId, {
            edits: [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }],
          });
        }
        break;
      }
      default: {
        throw new Error(`Unhandled operation type in apply-batch assertion: ${type}`);
      }
    }
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
      endedAt: null,
    });
    expect(sessionRepository.update).not.toHaveBeenCalledWith(
      auth.user.id,
      session.id,
      expect.objectContaining({ status: AgentSessionStatus.Completed }),
    );
  });

  it('applies asset.updateMetadata through AssetService.updateAll', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const assetIds = [newUuid(), newUuid()];
    const payload = {
      description: 'Berlin weekend',
      rating: 5,
      dateTimeOriginal: '1998-06-01T12:00:00.000Z',
      timeZone: 'Europe/Berlin',
      latitude: 52.52,
      longitude: 13.405,
    };
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds,
      payload,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    assetService.updateAll.mockResolvedValue(undefined as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(result.appliedOperationIds).toEqual([operation.id]);
    expect(assetService.updateAll).toHaveBeenCalledWith(auth, {
      ids: assetIds,
      description: 'Berlin weekend',
      rating: 5,
      dateTimeOriginal: '1998-06-01T12:00:00.000Z',
      timeZone: 'Europe/Berlin',
      latitude: 52.52,
      longitude: 13.405,
    });
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Applied,
        result: expect.objectContaining({ assetIds }),
        error: null,
      }),
    ]);
  });

  it('returns and persists pre-apply metadata review snapshots when applying metadata updates', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const assetId = newUuid();
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: { description: 'After apply' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    assetService.updateAll.mockResolvedValue(undefined as never);
    (assetRepository as any).getAgentMetadataReviewByIds = vi.fn().mockImplementation(() =>
      Promise.resolve([
        makeMetadataReviewRow(assetId, {
          description: assetService.updateAll.mock.calls.length > 0 ? 'After apply' : 'Before apply',
        }),
      ]),
    );

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });
    const reviewMetadata = (result.plan.operations[0] as any).reviewMetadata;

    expect(reviewMetadata.assetMetadata.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'description',
          previousValues: [{ assetId, value: 'Before apply', valueKind: 'known' }],
          proposedValue: 'After apply',
          proposedValueKind: 'known',
        }),
      ]),
    );
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        result: expect.objectContaining({
          assetIds: [assetId],
          reviewMetadata,
        }),
      }),
    ]);
    expect((assetRepository as any).getAgentMetadataReviewByIds).toHaveBeenCalledTimes(1);
  });

  it('applies asset.updateMetadata clear values without dropping them', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const assetIds = [newUuid()];
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds,
      payload: { description: '', rating: null },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    assetService.updateAll.mockResolvedValue(undefined as never);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] }),
    ).resolves.toMatchObject({ status: AgentOperationApplyStatus.Applied });

    expect(assetService.updateAll).toHaveBeenCalledWith(auth, {
      ids: assetIds,
      description: '',
      rating: null,
    });
  });

  it('fails asset.updateMetadata with an invalid stored payload before calling AssetService.updateAll', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const assetId = newUuid();
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: { dateTimeOriginal: '1998-06-01T12:00:00.000Z', dateTimeRelative: 60 },
      summary: 'Set description.',
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(assetService.updateAll).not.toHaveBeenCalled();
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Failed,
        error: 'Invalid asset metadata payload for Set description.',
      }),
    ]);
  });

  it('fails asset.updateMetadata with an invalid stored ISO date before calling AssetService.updateAll', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const assetId = newUuid();
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: { dateTimeOriginal: 'June 1st, 1998' },
      summary: 'Set capture date.',
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(assetService.updateAll).not.toHaveBeenCalled();
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Failed,
        error: 'Invalid asset metadata payload for Set capture date.',
      }),
    ]);
  });

  it('applies asset.updateMetadata only to selected assets', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const keptAssetId = newUuid();
    const removedAssetId = newUuid();
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds: [keptAssetId, removedAssetId],
      payload: { description: 'Kept only' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([keptAssetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([keptAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([keptAssetId]));
    assetService.updateAll.mockResolvedValue(undefined as never);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [operation.id],
        itemSelections: {
          [operation.id]: { itemKind: 'asset', mode: 'only', itemIds: [keptAssetId] },
        },
      }),
    ).resolves.toMatchObject({ status: AgentOperationApplyStatus.Applied });

    expect(assetService.updateAll).toHaveBeenCalledWith(auth, { ids: [keptAssetId], description: 'Kept only' });
  });

  it('fails asset.updateMetadata when apply-time asset access no longer passes', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const assetId = newUuid();
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: { rating: 4 },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.failedOperationIds).toEqual([operation.id]);
    expect(assetService.updateAll).not.toHaveBeenCalled();
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Failed,
        error: 'One or more assets are not editable',
      }),
    ]);
  });

  it('marks asset.updateMetadata failed when the bulk metadata update path throws', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const assetIds = [newUuid()];
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds,
      payload: { latitude: 52.52, longitude: 13.405 },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    assetService.updateAll.mockRejectedValue(new Error('reverse geocode failed'));

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Failed,
        result: expect.objectContaining({ reviewMetadata: expect.any(Object) }),
        error: 'reverse geocode failed',
      }),
    ]);
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
      endedAt: null,
    });
  });

  it('continues applying sibling operations after asset.updateMetadata fails', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const metadataAssetId = newUuid();
    const favoriteAssetId = newUuid();
    const metadataOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      position: 0,
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds: [metadataAssetId],
      payload: { description: 'Needs sidecar' },
    });
    const favoriteOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      position: 1,
      type: AgentOperationType.AssetSetFavorite,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds: [favoriteAssetId],
      payload: { favorite: true },
    });
    const plan = makePlan({
      id: 'plan-id',
      sessionId: session.id,
      operations: [metadataOperation, favoriteOperation],
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([metadataAssetId, favoriteAssetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([metadataAssetId, favoriteAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([metadataAssetId, favoriteAssetId]));
    assetService.updateAll
      .mockRejectedValueOnce(new Error('sidecar write failed'))
      .mockResolvedValueOnce(undefined as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [metadataOperation.id, favoriteOperation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.PartiallyApplied);
    expect(result.failedOperationIds).toEqual([metadataOperation.id]);
    expect(result.appliedOperationIds).toEqual([favoriteOperation.id]);
    expect(assetService.updateAll).toHaveBeenNthCalledWith(1, auth, {
      ids: [metadataAssetId],
      description: 'Needs sidecar',
    });
    expect(assetService.updateAll).toHaveBeenNthCalledWith(2, auth, {
      ids: [favoriteAssetId],
      isFavorite: true,
    });
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: metadataOperation.id,
        status: AgentOperationStatus.Failed,
        result: expect.objectContaining({ reviewMetadata: expect.any(Object) }),
        error: 'sidecar write failed',
      }),
      expect.objectContaining({
        id: favoriteOperation.id,
        status: AgentOperationStatus.Applied,
        result: { assetIds: [favoriteAssetId] },
        error: null,
      }),
    ]);
  });

  it('emits aggregate apply progress activity events without exposing operation or asset ids', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const assetId = newUuid();
    const albumId = newUuid();
    const createOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      payload: { albumName: 'Portugal' },
    });
    const addOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumAddAssets,
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'tmp-portugal',
      assetIds: [assetId],
      payload: {},
      dependencyIds: [createOperation.id],
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation, addOperation] });
    const appliedPlan = applyUpdatesToPlan(plan, [
      { id: createOperation.id, status: AgentOperationStatus.Applied, result: { albumId }, error: null },
      {
        id: addOperation.id,
        status: AgentOperationStatus.Applied,
        result: { albumId, assetIds: [assetId] },
        error: null,
      },
    ]);
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue(appliedPlan);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    albumService.create.mockResolvedValue({ id: albumId } as never);
    albumService.addAssets.mockResolvedValue([{ id: assetId, success: true }]);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [createOperation.id, addOperation.id],
    });

    expect(activityEventService.createSystemEvent).toHaveBeenCalledWith(auth.user.id, session.id, {
      kind: AgentSessionActivityEventKind.ApplyProgress,
      status: AgentSessionActivityEventStatus.Running,
      counts: { total: 2, applied: 0, skipped: 0, failed: 0 },
    });
    expect(activityEventService.createSystemEvent).toHaveBeenCalledWith(auth.user.id, session.id, {
      kind: AgentSessionActivityEventKind.ApplyProgress,
      status: AgentSessionActivityEventStatus.Completed,
      counts: { total: 2, applied: 2, skipped: 0, failed: 0 },
    });
    expect(activityEventService.createSystemEvent).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        operationIds: expect.anything(),
        assetIds: expect.anything(),
      }),
    );
  });

  it('applies normalized album create field overrides before calling AlbumService.create', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const albumId = newUuid();
    const createOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      payload: { albumName: 'Portugal', description: 'Original description' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [{ ...createOperation, status: AgentOperationStatus.Applied, result: { albumId } }],
    });
    albumService.create.mockResolvedValue({ id: albumId } as never);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [createOperation.id],
        fieldOverrides: {
          [createOperation.id]: { albumName: '  Portugal highlights  ', description: '  Lisbon and Porto  ' },
        },
      }),
    ).resolves.toMatchObject({ status: AgentOperationApplyStatus.Applied });

    expect(albumService.create).toHaveBeenCalledWith(auth, {
      albumName: 'Portugal highlights',
      description: 'Lisbon and Porto',
      assetIds: [],
    });
  });

  it('applies normalized album update detail field overrides before calling AlbumService.update', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const albumId = newUuid();
    const updateOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumUpdateDetails,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      payload: { albumName: 'Portugal', description: 'Original description' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [updateOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [{ ...updateOperation, status: AgentOperationStatus.Applied, result: { albumId } }],
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    albumService.update.mockResolvedValue({ id: albumId } as never);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [updateOperation.id],
        fieldOverrides: {
          [updateOperation.id]: { albumName: '  Portugal highlights  ', description: '' },
        },
      }),
    ).resolves.toMatchObject({ status: AgentOperationApplyStatus.Applied });

    expect(albumService.update).toHaveBeenCalledWith(auth, albumId, {
      albumName: 'Portugal highlights',
      description: '',
    });
  });

  it('applies album update target and text overrides together', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const originalAlbumId = newUuid();
    const overrideAlbumId = newUuid();
    const updateOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumUpdateDetails,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: originalAlbumId,
      temporaryTargetId: null,
      payload: { albumName: 'Original album', description: 'Original description' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [updateOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([overrideAlbumId]));
    albumService.update.mockResolvedValue({ id: overrideAlbumId } as never);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [updateOperation.id],
        fieldOverrides: {
          [updateOperation.id]: {
            targetAlbumId: overrideAlbumId,
            albumName: '  Portugal highlights  ',
            description: '  Lisbon and Porto  ',
          },
        },
      }),
    ).resolves.toMatchObject({ status: AgentOperationApplyStatus.Applied });

    expect(albumService.update).toHaveBeenCalledWith(auth, overrideAlbumId, {
      albumName: 'Portugal highlights',
      description: 'Lisbon and Porto',
    });
  });

  it('applies set-cover field overrides after sparse item selections and uses the override for access checks', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const albumId = newUuid();
    const firstCandidateId = newUuid();
    const overrideCandidateId = newUuid();
    const coverOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumSetCover,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      assetIds: [firstCandidateId, overrideCandidateId],
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [coverOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        {
          ...coverOperation,
          status: AgentOperationStatus.Applied,
          result: { albumId, assetIds: [overrideCandidateId] },
        },
      ],
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([overrideCandidateId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([overrideCandidateId]));
    albumService.update.mockResolvedValue({ id: albumId } as never);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [coverOperation.id],
        itemSelections: {
          [coverOperation.id]: { itemKind: 'asset', mode: 'allExcept', itemIds: [firstCandidateId] },
        },
        fieldOverrides: {
          [coverOperation.id]: { albumThumbnailAssetId: overrideCandidateId },
        },
      }),
    ).resolves.toMatchObject({ status: AgentOperationApplyStatus.Applied });

    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(
      auth.user.id,
      new Set([overrideCandidateId]),
      false,
    );
    expect(albumService.update).toHaveBeenCalledWith(auth, albumId, { albumThumbnailAssetId: overrideCandidateId });
  });

  it('rejects invalid field overrides before claiming the plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const createOperation = makeOperation({ id: newUuid(), planId: 'plan-id' });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [createOperation.id],
        fieldOverrides: {
          [createOperation.id]: { albumName: ' '.repeat(3) },
        },
      }),
    ).rejects.toThrow('albumName must be 1-200 characters');

    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
    expect(albumService.create).not.toHaveBeenCalled();
  });

  it('rejects set-cover overrides that are not selected cover candidates before claiming the plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const albumId = newUuid();
    const selectedCandidateId = newUuid();
    const excludedCandidateId = newUuid();
    const coverOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumSetCover,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      assetIds: [selectedCandidateId, excludedCandidateId],
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [coverOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [coverOperation.id],
        itemSelections: {
          [coverOperation.id]: { itemKind: 'asset', mode: 'only', itemIds: [selectedCandidateId] },
        },
        fieldOverrides: {
          [coverOperation.id]: { albumThumbnailAssetId: excludedCandidateId },
        },
      }),
    ).rejects.toThrow('albumThumbnailAssetId must be one of the selected cover candidates');

    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
    expect(albumService.update).not.toHaveBeenCalled();
  });

  it('skips unselected operations and selected dependents whose dependency was not applied', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const createOperation = makeOperation({ id: newUuid(), planId: 'plan-id', temporaryTargetId: 'tmp-portugal' });
    const addOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      position: 1,
      type: AgentOperationType.AlbumAddAssets,
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'tmp-portugal',
      assetIds: [newUuid()],
      payload: {},
      dependencyIds: [createOperation.id],
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation, addOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        {
          ...createOperation,
          status: AgentOperationStatus.Skipped,
          result: { skippedReason: 'Operation was not selected for apply' },
        },
        {
          ...addOperation,
          status: AgentOperationStatus.Skipped,
          result: { skippedReason: 'Dependency was not applied' },
        },
      ],
    });

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [addOperation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.appliedOperationIds).toEqual([]);
    expect(result.skippedOperationIds).toEqual([createOperation.id, addOperation.id]);
    expect(albumService.create).not.toHaveBeenCalled();
    expect(albumService.addAssets).not.toHaveBeenCalled();
  });

  it('keeps the overall apply status applied when only unselected operations are skipped', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const selectedOperation = makeOperation({ id: newUuid(), planId: 'plan-id', temporaryTargetId: 'tmp-selected' });
    const unselectedOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      position: 1,
      temporaryTargetId: 'tmp-unselected',
    });
    const albumId = newUuid();
    const plan = makePlan({
      id: 'plan-id',
      sessionId: session.id,
      operations: [selectedOperation, unselectedOperation],
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        { ...selectedOperation, status: AgentOperationStatus.Applied, result: { albumId } },
        {
          ...unselectedOperation,
          status: AgentOperationStatus.Skipped,
          result: { skippedReason: 'Operation was not selected for apply' },
        },
      ],
    });
    albumService.create.mockResolvedValue({ id: albumId } as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [selectedOperation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(result.appliedOperationIds).toEqual([selectedOperation.id]);
    expect(result.skippedOperationIds).toEqual([unselectedOperation.id]);
    expect(result.failedOperationIds).toEqual([]);
  });

  it('marks the session failed and rethrows when completing a claimed apply crashes', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const operation = makeOperation({ id: newUuid(), planId: 'plan-id', temporaryTargetId: 'tmp-portugal' });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    const error = new Error('complete apply failed');
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockRejectedValue(error);
    albumService.create.mockResolvedValue({ id: newUuid() } as never);

    await expect(sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] })).rejects.toBe(
      error,
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Failed,
      endedAt: expect.any(Date),
    });
    expect(websocketRepository.clientSend).not.toHaveBeenCalledWith(
      'on_agent_session_event',
      auth.user.id,
      expect.objectContaining({ type: 'operation-plan-applied' }),
    );
  });

  it('rejects unknown operation ids before claiming the plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const plan = makePlan({ sessionId: session.id });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [newUuid()] })).rejects.toThrow(
      'One or more operation ids are not in the current plan',
    );
    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
    expect(albumService.create).not.toHaveBeenCalled();
  });

  it('rejects non-current plans before claiming the plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const staleOperation = makeOperation();
    const stalePlan = makePlan({ id: newUuid(), sessionId: session.id, operations: [staleOperation] });
    const currentPlan = makePlan({ id: newUuid(), sessionId: session.id, revision: 2 });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(stalePlan);
    planRepository.getCurrentBySessionId.mockResolvedValue(currentPlan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, stalePlan.id, { operationIds: [staleOperation.id] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
    expect(albumService.create).not.toHaveBeenCalled();
  });

  it('rejects stored-disabled operation ids before claiming the plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const disabledOperation = makeOperation({ enabled: false });
    const plan = makePlan({ sessionId: session.id, operations: [disabledOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [disabledOperation.id] }),
    ).rejects.toThrow('One or more operation ids are disabled in the current plan');
    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
    expect(albumService.create).not.toHaveBeenCalled();
  });

  it('rejects apply requests unless the session is waiting for plan review', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Running });
    const operation = makeOperation();
    const plan = makePlan({ sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] }),
    ).rejects.toThrow('Agent session is not waiting for plan review');
    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
    expect(albumService.create).not.toHaveBeenCalled();
  });

  it('does not mutate albums when the apply claim loses a race after validation', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const operation = makeOperation();
    const plan = makePlan({ sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue(void 0);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(sessionRepository.update).not.toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Applying,
    });
    expect(albumService.create).not.toHaveBeenCalled();
    expect(planRepository.completeApply).not.toHaveBeenCalled();
  });

  it('applies existing-album detail and cover operations through AlbumService.update', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const albumId = newUuid();
    const coverAssetId = newUuid();
    const updateOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumUpdateDetails,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      payload: { albumName: 'Portugal highlights', description: 'Edited description' },
    });
    const coverOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      position: 1,
      type: AgentOperationType.AlbumSetCover,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      assetIds: [coverAssetId],
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [updateOperation, coverOperation] });
    const appliedPlan = makePlan({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        { ...updateOperation, status: AgentOperationStatus.Applied, result: { albumId } },
        { ...coverOperation, status: AgentOperationStatus.Applied, result: { albumId, assetIds: [coverAssetId] } },
      ],
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue(appliedPlan);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([coverAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([coverAssetId]));
    albumService.update.mockResolvedValue({ id: albumId } as never);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [updateOperation.id, coverOperation.id],
      }),
    ).resolves.toMatchObject({ status: AgentOperationApplyStatus.Applied });
    expect(albumService.update).toHaveBeenNthCalledWith(1, auth, albumId, {
      albumName: 'Portugal highlights',
      description: 'Edited description',
    });
    expect(albumService.update).toHaveBeenNthCalledWith(2, auth, albumId, { albumThumbnailAssetId: coverAssetId });
  });

  it('reports partial success when one independent selected operation applies and another fails', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const albumId = newUuid();
    const createOperation = makeOperation({ id: newUuid(), planId: 'plan-id', temporaryTargetId: 'tmp-portugal' });
    const updateOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      position: 1,
      type: AgentOperationType.AlbumUpdateDetails,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      payload: { albumName: 'Existing renamed' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation, updateOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        { ...createOperation, status: AgentOperationStatus.Applied, result: { albumId: newUuid() } },
        { ...updateOperation, status: AgentOperationStatus.Failed, error: 'album update failed' },
      ],
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    albumService.create.mockResolvedValue({ id: newUuid() } as never);
    albumService.update.mockRejectedValue(new Error('album update failed'));

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [createOperation.id, updateOperation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.PartiallyApplied);
    expect(result.appliedOperationIds).toEqual([createOperation.id]);
    expect(result.failedOperationIds).toEqual([updateOperation.id]);
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
      endedAt: null,
    });
  });

  it('records album add-asset bulk failures without treating failed assets as applied', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const albumId = newUuid();
    const successfulAssetId = newUuid();
    const failedAssetId = newUuid();
    const addOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumAddAssets,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      assetIds: [successfulAssetId, failedAssetId],
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [addOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        {
          ...addOperation,
          status: AgentOperationStatus.Failed,
          result: {
            albumId,
            assetIds: [successfulAssetId],
            assetResults: [
              { id: successfulAssetId, success: true },
              { id: failedAssetId, success: false, error: BulkIdErrorReason.DUPLICATE },
            ],
          },
          error: 'Failed to add 1 asset(s)',
        },
      ],
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([successfulAssetId, failedAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([successfulAssetId, failedAssetId]));
    albumService.addAssets.mockResolvedValue([
      { id: successfulAssetId, success: true },
      { id: failedAssetId, success: false, error: BulkIdErrorReason.DUPLICATE },
    ]);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [addOperation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.failedOperationIds).toEqual([addOperation.id]);
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
      endedAt: null,
    });
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: addOperation.id,
        status: AgentOperationStatus.Failed,
        result: expect.objectContaining({ assetIds: [successfulAssetId] }),
        error: 'Failed to add 1 asset(s)',
      }),
    ]);
  });

  it('persists a partial failure and skips dependents when an album mutation fails', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const createOperation = makeOperation({ id: newUuid(), planId: 'plan-id', temporaryTargetId: 'tmp-portugal' });
    const addOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      position: 1,
      type: AgentOperationType.AlbumAddAssets,
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'tmp-portugal',
      assetIds: [newUuid()],
      payload: {},
      dependencyIds: [createOperation.id],
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation, addOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        { ...createOperation, status: AgentOperationStatus.Failed, error: 'album create failed' },
        {
          ...addOperation,
          status: AgentOperationStatus.Skipped,
          result: { skippedReason: 'Dependency was not applied' },
        },
      ],
    });
    albumService.create.mockRejectedValue(new Error('album create failed'));

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [createOperation.id, addOperation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.failedOperationIds).toEqual([createOperation.id]);
    expect(result.skippedOperationIds).toEqual([addOperation.id]);
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: createOperation.id,
        status: AgentOperationStatus.Failed,
        error: 'album create failed',
      }),
      expect.objectContaining({ id: addOperation.id, status: AgentOperationStatus.Skipped }),
    ]);
  });

  it('fails only the drifted operation when apply-time asset access no longer passes', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const assetId = newUuid();
    const albumId = newUuid();
    const addOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumAddAssets,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      assetIds: [assetId],
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [addOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        { ...addOperation, status: AgentOperationStatus.Failed, error: 'One or more assets are not accessible' },
      ],
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [addOperation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(albumService.addAssets).not.toHaveBeenCalled();
  });

  it('fails an apply-time asset check when a shared-space asset is locked by current policy', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { owned: false, sharedSpaces: true, locked: false },
      },
    });
    const assetId = newUuid();
    const albumId = newUuid();
    const addOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumAddAssets,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      assetIds: [assetId],
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [addOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        { ...addOperation, status: AgentOperationStatus.Failed, error: 'One or more assets are not accessible' },
      ],
    });
    accessRepository.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentLockedIds.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set());

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [addOperation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(albumService.addAssets).not.toHaveBeenCalled();
  });

  it('fails an existing-album operation when apply-time album access no longer passes', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
    const albumId = newUuid();
    const updateOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumUpdateDetails,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      payload: { description: 'Should not apply' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [updateOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockResolvedValue({
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        {
          ...updateOperation,
          status: AgentOperationStatus.Failed,
          error: 'One or more target albums are not accessible',
        },
      ],
    });
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set());

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [updateOperation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(albumService.update).not.toHaveBeenCalled();
  });

  it('rejects duplicate space temporary ids and missing new-space dependencies before persisting', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValue(makeToolCall({ sessionId: session.id }));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Broken spaces.',
        operations: [
          {
            type: AgentOperationType.SpaceCreate,
            summary: 'Create one.',
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-space',
            payload: { spaceName: 'One' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
          {
            type: AgentOperationType.SpaceCreate,
            summary: 'Create two.',
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-space',
            payload: { spaceName: 'Two' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('Duplicate space.create temporaryTargetId: tmp-space');

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Missing space.',
        operations: [
          {
            type: AgentOperationType.SpaceAddAssets,
            summary: 'Add to missing space.',
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-missing',
            assetIds: [newUuid()],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('No space.create operation found for temporaryTargetId: tmp-missing');

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('rejects new-space references before the corresponding create operation', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValue(makeToolCall({ sessionId: session.id }));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Out of order space plan.',
        operations: [
          {
            type: AgentOperationType.SpaceAddAssets,
            summary: 'Add too early.',
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-space',
            assetIds: [assetId],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
          {
            type: AgentOperationType.SpaceCreate,
            summary: 'Create later.',
            targetKind: AgentOperationTargetKind.NewSpace,
            temporaryTargetId: 'tmp-space',
            payload: { spaceName: 'Later' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('space.addAssets references temporaryTargetId before its space.create operation');

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('validates existing spaces, tag ids, editable assets, and redacts expanded audit metadata', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const tagId = newUuid();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const plan = makePlan({ sessionId: session.id });
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));

    sessionRepository.getById.mockResolvedValue(session);
    sessionRepository.update.mockResolvedValue({ ...session, status: AgentSessionStatus.WaitingForPlanReview });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.tag.checkOwnerAccess.mockResolvedValue(new Set([tagId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    planRepository.createReplacementRevision.mockResolvedValue(plan);
    toolCallRepository.create.mockResolvedValue(makeToolCall({ sessionId: session.id }));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Space and tag plan.',
        operations: [
          {
            type: AgentOperationType.SpaceUpdateDetails,
            summary: 'Rename space.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: spaceId,
            payload: { spaceName: 'Private trip', description: 'Do not leak me' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
          {
            type: AgentOperationType.AssetRemoveTag,
            summary: 'Remove tag.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [assetId],
            payload: { tagId },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
          {
            type: AgentOperationType.AssetRotate,
            summary: 'Rotate.',
            targetKind: AgentOperationTargetKind.ImageEditBatch,
            assetIds: [assetId],
            payload: { angle: 90 },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).resolves.toMatchObject({ status: 'success' });

    expect(accessRepository.sharedSpace.checkRoleAccess).toHaveBeenCalledWith(
      auth.user.id,
      new Set([spaceId]),
      SharedSpaceRole.Owner,
    );
    expect(accessRepository.asset.checkSpaceEditAccess).toHaveBeenCalledWith(auth.user.id, new Set([assetId]));
    expect(accessRepository.tag.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([tagId]));
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        redactedRequestMetadata: expect.objectContaining({
          spaceIds: [spaceId],
          tagIds: [tagId],
          assetIds: [assetId],
        }),
      }),
    );
    expect(toolCallRepository.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        redactedRequestMetadata: expect.objectContaining({ payload: expect.anything() }),
      }),
    );
  });

  it('denies existing space operations without editor or owner access', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set());

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing }),
    );

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Denied space.',
        operations: [
          {
            type: AgentOperationType.SpaceRemoveAssets,
            summary: 'Remove from inaccessible space.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: spaceId,
            assetIds: [newUuid()],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('One or more target spaces are not accessible');

    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('requires owner access when changing existing space details', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set());
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValue(makeToolCall({ sessionId: session.id }));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Rename space.',
        operations: [
          {
            type: AgentOperationType.SpaceUpdateDetails,
            summary: 'Rename.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: spaceId,
            payload: { spaceName: 'Owners only' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('One or more target spaces are not accessible');

    expect(accessRepository.sharedSpace.checkRoleAccess).toHaveBeenCalledWith(
      auth.user.id,
      new Set([spaceId]),
      SharedSpaceRole.Owner,
    );
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('applies existing-space add/remove operations with only selected asset ids', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const spaceId = newUuid();
    const keepAssetId = newUuid();
    const excludedAssetId = newUuid();
    const removeAssetId = newUuid();
    const removeExcludedAssetId = newUuid();

    accessRepository.asset.checkOwnerAccess.mockResolvedValue(
      new Set([keepAssetId, excludedAssetId, removeAssetId, removeExcludedAssetId]),
    );
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(
      new Set([keepAssetId, excludedAssetId, removeAssetId, removeExcludedAssetId]),
    );
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));

    const addOperation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.SpaceAddAssets,
      summary: 'Add selected photos to Family.',
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      assetIds: [keepAssetId, excludedAssetId],
      payload: {},
    });
    const removeOperation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.SpaceRemoveAssets,
      summary: 'Remove selected photos from Family.',
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      assetIds: [removeAssetId, removeExcludedAssetId],
      payload: {},
      position: 1,
    });
    const plan = makePlan({ sessionId: session.id, operations: [addOperation, removeOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    sharedSpaceService.addAssets.mockResolvedValue(undefined as never);
    sharedSpaceService.removeAssets.mockResolvedValue(undefined as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [addOperation.id, removeOperation.id],
      itemSelections: {
        [addOperation.id]: { itemKind: 'asset', mode: 'only', itemIds: [keepAssetId] },
        [removeOperation.id]: {
          itemKind: 'asset',
          mode: 'allExcept',
          itemIds: [removeExcludedAssetId],
        },
      },
    });

    expect(sharedSpaceService.addAssets).toHaveBeenCalledWith(auth, spaceId, { assetIds: [keepAssetId] });
    expect(sharedSpaceService.removeAssets).toHaveBeenCalledWith(auth, spaceId, { assetIds: [removeAssetId] });
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
      endedAt: null,
    });
    expect(sessionRepository.update).not.toHaveBeenCalledWith(
      auth.user.id,
      session.id,
      expect.objectContaining({ status: AgentSessionStatus.Completed }),
    );
  });

  it('does not call shared-space mutation services for disabled or unselected existing-space operations', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const selectedId = newUuid();
    const disabledId = newUuid();
    const unselectedId = newUuid();
    const spaceId = newUuid();
    const assetId = newUuid();

    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));

    const selected = makeOperation({
      id: selectedId,
      type: AgentOperationType.SpaceAddAssets,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: {},
    });
    const disabled = makeOperation({
      id: disabledId,
      type: AgentOperationType.SpaceRemoveAssets,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: {},
      enabled: false,
      position: 1,
    });
    const unselected = makeOperation({
      id: unselectedId,
      type: AgentOperationType.SpaceRemoveAssets,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      assetIds: [assetId],
      payload: {},
      position: 2,
    });
    const plan = makePlan({ sessionId: session.id, operations: [selected, disabled, unselected] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    sharedSpaceService.addAssets.mockResolvedValue(undefined as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [selected.id] });

    expect(sharedSpaceService.addAssets).toHaveBeenCalledTimes(1);
    expect(sharedSpaceService.removeAssets).not.toHaveBeenCalled();
  });

  it.each([AgentOperationType.SpaceAddAssets, AgentOperationType.SpaceRemoveAssets] as const)(
    'denies %s when the user cannot edit the existing space',
    async (operationType) => {
      const auth = AuthFactory.create();
      const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
      const spaceId = newUuid();
      const assetId = newUuid();
      sessionRepository.getById.mockResolvedValue(session);
      toolCallRepository.create.mockResolvedValue(
        makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing }),
      );
      accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
      accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set());

      await expect(
        sut.proposeAlbumOperations(auth, session.id, {
          summary: 'Change Family space.',
          operations: [
            {
              type: operationType,
              summary: 'Change Family space.',
              targetKind: AgentOperationTargetKind.ExistingSpace,
              targetId: spaceId,
              assetIds: [assetId],
              payload: {},
              enabled: true,
              riskLevel: AgentOperationRiskLevel.Low,
            },
          ],
        }),
      ).rejects.toThrow(/space/i);
    },
  );

  it('reports partial success when one existing-space operation applies and another becomes inaccessible', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const spaceId = newUuid();
    const allowedAssetId = newUuid();
    const staleAssetId = newUuid();

    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([allowedAssetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([allowedAssetId]));
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));

    const addOperation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.SpaceAddAssets,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      assetIds: [allowedAssetId],
      payload: {},
    });
    const removeOperation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.SpaceRemoveAssets,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      assetIds: [staleAssetId],
      payload: {},
      position: 1,
    });
    const plan = makePlan({ sessionId: session.id, operations: [addOperation, removeOperation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    sharedSpaceService.addAssets.mockResolvedValue(undefined as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [addOperation.id, removeOperation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.PartiallyApplied);
    expect(result.appliedOperationIds).toEqual([addOperation.id]);
    expect(result.failedOperationIds).toEqual([removeOperation.id]);
    expect(sharedSpaceService.addAssets).toHaveBeenCalledWith(auth, spaceId, { assetIds: [allowedAssetId] });
    expect(sharedSpaceService.removeAssets).not.toHaveBeenCalled();
  });

  it('validates owner access and redacts user ids for shared-space member plans', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const userId = newUuid();
    const otherUserId = newUuid();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const plan = makePlan({ sessionId: session.id });

    sessionRepository.getById.mockResolvedValue(session);
    sessionRepository.update.mockResolvedValue({ ...session, status: AgentSessionStatus.WaitingForPlanReview });
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    planRepository.createReplacementRevision.mockResolvedValue(plan);
    toolCallRepository.create.mockResolvedValue(makeToolCall({ sessionId: session.id }));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Manage Family members.',
        operations: [
          {
            type: AgentOperationType.SpaceAddMembers,
            summary: 'Add Alex as editor.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: spaceId,
            payload: { members: [{ userId, role: SharedSpaceRole.Editor }] },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
          {
            type: AgentOperationType.SpaceRemoveMembers,
            summary: 'Remove Chris.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: spaceId,
            payload: { userIds: [otherUserId] },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Medium,
          },
        ],
      }),
    ).resolves.toMatchObject({ status: 'success' });

    expect(accessRepository.sharedSpace.checkRoleAccess).toHaveBeenCalledWith(
      auth.user.id,
      new Set([spaceId]),
      SharedSpaceRole.Owner,
    );
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        redactedRequestMetadata: expect.objectContaining({
          spaceIds: [spaceId],
          userIds: [userId, otherUserId],
        }),
      }),
    );
  });

  it('applies shared-space member operations with selected person ids and skipped no-op results', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const spaceId = newUuid();
    const addUserId = newUuid();
    const excludedAddUserId = newUuid();
    const existingUserId = newUuid();
    const missingUserId = newUuid();
    const roleUserId = newUuid();
    const sameRoleUserId = newUuid();
    const addOperation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.SpaceAddMembers,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      payload: {
        members: [
          { userId: addUserId, role: SharedSpaceRole.Editor },
          { userId: excludedAddUserId, role: SharedSpaceRole.Viewer },
          { userId: existingUserId, role: SharedSpaceRole.Viewer },
        ],
      },
    });
    const removeOperation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.SpaceRemoveMembers,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      payload: { userIds: [existingUserId, missingUserId] },
      position: 1,
    });
    const roleOperation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.SpaceUpdateMemberRole,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      payload: { userIds: [roleUserId, sameRoleUserId], role: SharedSpaceRole.Editor },
      position: 2,
    });
    const plan = makePlan({ sessionId: session.id, operations: [addOperation, removeOperation, roleOperation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    sharedSpaceService.getMembers
      .mockResolvedValueOnce([
        { userId: existingUserId, role: SharedSpaceRole.Viewer },
        { userId: roleUserId, role: SharedSpaceRole.Viewer },
        { userId: sameRoleUserId, role: SharedSpaceRole.Editor },
      ] as never)
      .mockResolvedValueOnce([
        { userId: existingUserId, role: SharedSpaceRole.Viewer },
        { userId: roleUserId, role: SharedSpaceRole.Viewer },
        { userId: sameRoleUserId, role: SharedSpaceRole.Editor },
      ] as never)
      .mockResolvedValueOnce([
        { userId: roleUserId, role: SharedSpaceRole.Viewer },
        { userId: sameRoleUserId, role: SharedSpaceRole.Editor },
      ] as never);
    sharedSpaceService.addMember.mockResolvedValue({} as never);
    sharedSpaceService.removeMember.mockResolvedValue(undefined as never);
    sharedSpaceService.updateMember.mockResolvedValue({} as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [addOperation.id, removeOperation.id, roleOperation.id],
      itemSelections: {
        [addOperation.id]: { itemKind: 'person', mode: 'only', itemIds: [addUserId, existingUserId] },
        [removeOperation.id]: { itemKind: 'person', mode: 'allExcept', itemIds: [missingUserId] },
      },
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(sharedSpaceService.addMember).toHaveBeenCalledWith(auth, spaceId, {
      userId: addUserId,
      role: SharedSpaceRole.Editor,
    });
    expect(sharedSpaceService.addMember).not.toHaveBeenCalledWith(
      auth,
      spaceId,
      expect.objectContaining({ userId: excludedAddUserId }),
    );
    expect(sharedSpaceService.removeMember).toHaveBeenCalledWith(auth, spaceId, existingUserId);
    expect(sharedSpaceService.updateMember).toHaveBeenCalledWith(auth, spaceId, roleUserId, {
      role: SharedSpaceRole.Editor,
    });
    expect(sharedSpaceService.updateMember).not.toHaveBeenCalledWith(auth, spaceId, sameRoleUserId, expect.anything());
    expect(planRepository.completeApply).toHaveBeenCalledWith(
      plan.id,
      expect.arrayContaining([
        expect.objectContaining({
          id: addOperation.id,
          result: expect.objectContaining({ userIds: [addUserId], skippedUserIds: [existingUserId] }),
        }),
        expect.objectContaining({
          id: removeOperation.id,
          result: expect.objectContaining({ userIds: [existingUserId], skippedUserIds: [] }),
        }),
        expect.objectContaining({
          id: roleOperation.id,
          result: expect.objectContaining({ userIds: [roleUserId], skippedUserIds: [sameRoleUserId] }),
        }),
      ]),
    );
  });

  it('rejects current-user member changes and owner role assignments before mutating', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const spaceId = newUuid();
    const ownerRoleOperation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.SpaceUpdateMemberRole,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      payload: { userIds: [auth.user.id], role: SharedSpaceRole.Owner },
    });
    const plan = makePlan({ sessionId: session.id, operations: [ownerRoleOperation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    sharedSpaceService.getMembers.mockResolvedValue([
      { userId: auth.user.id, role: SharedSpaceRole.Owner },
      { userId: newUuid(), role: SharedSpaceRole.Owner },
    ] as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [ownerRoleOperation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(sharedSpaceService.removeMember).not.toHaveBeenCalled();
    expect(sharedSpaceService.updateMember).not.toHaveBeenCalled();
  });

  it('applies expanded album, space, asset, and tag operations with sparse selections and target overrides', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const existingAlbumId = newUuid();
    const overrideAlbumId = newUuid();
    const createdSpaceId = newUuid();
    const existingSpaceId = newUuid();
    const overrideSpaceId = newUuid();
    const tagId = newUuid();
    const upsertedTagId = newUuid();
    const assetA = newUuid();
    const assetB = newUuid();
    const assetC = newUuid();
    const operations = [
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        type: AgentOperationType.AlbumRemoveAssets,
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: existingAlbumId,
        assetIds: [assetA, assetB],
        payload: {},
      }),
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        position: 1,
        type: AgentOperationType.SpaceCreate,
        targetKind: AgentOperationTargetKind.NewSpace,
        temporaryTargetId: 'tmp-space',
        payload: { spaceName: 'Original', description: 'Old' },
      }),
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        position: 2,
        type: AgentOperationType.SpaceAddAssets,
        targetKind: AgentOperationTargetKind.NewSpace,
        temporaryTargetId: 'tmp-space',
        assetIds: [assetA, assetB],
        payload: {},
        dependencyIds: [],
      }),
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        position: 3,
        type: AgentOperationType.SpaceRemoveAssets,
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: existingSpaceId,
        assetIds: [assetA],
        payload: {},
      }),
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        position: 4,
        type: AgentOperationType.SpaceUpdateDetails,
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: existingSpaceId,
        payload: { spaceName: 'Original space' },
      }),
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        position: 5,
        type: AgentOperationType.AssetSetFavorite,
        targetKind: AgentOperationTargetKind.AssetBatch,
        targetId: null,
        assetIds: [assetA],
        payload: { favorite: true },
      }),
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        position: 6,
        type: AgentOperationType.AssetSetArchive,
        targetKind: AgentOperationTargetKind.AssetBatch,
        targetId: null,
        assetIds: [assetB],
        payload: { archived: true },
      }),
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        position: 7,
        type: AgentOperationType.AssetAddTag,
        targetKind: AgentOperationTargetKind.AssetBatch,
        targetId: null,
        assetIds: [assetA],
        payload: { tagName: 'Receipts' },
      }),
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        position: 8,
        type: AgentOperationType.AssetAddTag,
        targetKind: AgentOperationTargetKind.AssetBatch,
        targetId: null,
        assetIds: [assetB],
        payload: { tagId },
      }),
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        position: 9,
        type: AgentOperationType.AssetRemoveTag,
        targetKind: AgentOperationTargetKind.AssetBatch,
        targetId: null,
        assetIds: [assetC],
        payload: { tagId },
      }),
    ];
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations });
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([existingSpaceId, overrideSpaceId]));

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([existingAlbumId, overrideAlbumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetA, assetB, assetC]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetA, assetB, assetC]));
    accessRepository.tag.checkOwnerAccess.mockResolvedValue(new Set([tagId]));
    assetRepository.getAgentReadableIds.mockImplementation((ids: Set<string>) => Promise.resolve(new Set(ids)));
    albumService.removeAssets.mockResolvedValue([{ id: assetB, success: true }]);
    sharedSpaceService.create.mockResolvedValue({ id: createdSpaceId } as never);
    sharedSpaceService.addAssets.mockResolvedValue(undefined as never);
    sharedSpaceService.removeAssets.mockResolvedValue(undefined as never);
    sharedSpaceService.update.mockResolvedValue({ id: overrideSpaceId } as never);
    assetService.updateAll.mockResolvedValue(undefined as never);
    tagService.upsert.mockResolvedValue([{ id: upsertedTagId }] as never);
    tagService.addAssets.mockResolvedValue([{ id: assetA, success: true }] as never);
    tagService.removeAssets.mockResolvedValue([{ id: assetC, success: true }] as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: operations.map((operation) => operation.id),
      itemSelections: {
        [operations[0].id]: { itemKind: 'asset', mode: 'only', itemIds: [assetB] },
        [operations[2].id]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
      },
      fieldOverrides: {
        [operations[0].id]: { targetAlbumId: overrideAlbumId },
        [operations[1].id]: { spaceName: '  New space  ', description: '  Fresh  ' },
        [operations[4].id]: {
          targetSpaceId: overrideSpaceId,
          description: 'Updated description',
          color: UserAvatarColor.Blue,
        },
      },
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(albumService.removeAssets).toHaveBeenCalledWith(auth, overrideAlbumId, { ids: [assetB] });
    expect(sharedSpaceService.create).toHaveBeenCalledWith(auth, { name: 'New space', description: 'Fresh' });
    expect(sharedSpaceService.addAssets).toHaveBeenCalledWith(auth, createdSpaceId, { assetIds: [assetA] });
    expect(sharedSpaceService.removeAssets).toHaveBeenCalledWith(auth, existingSpaceId, { assetIds: [assetA] });
    expect(sharedSpaceService.update).toHaveBeenCalledWith(auth, overrideSpaceId, {
      name: 'Original space',
      description: 'Updated description',
      color: UserAvatarColor.Blue,
    });
    expect(assetService.updateAll).toHaveBeenNthCalledWith(1, auth, { ids: [assetA], isFavorite: true });
    expect(assetService.updateAll).toHaveBeenNthCalledWith(2, auth, {
      ids: [assetB],
      visibility: AssetVisibility.Archive,
    });
    expect(tagService.upsert).toHaveBeenCalledWith(auth, { tags: ['Receipts'] });
    expect(tagService.addAssets).toHaveBeenNthCalledWith(1, auth, upsertedTagId, { ids: [assetA] });
    expect(tagService.addAssets).toHaveBeenNthCalledWith(2, auth, tagId, { ids: [assetB] });
    expect(tagService.removeAssets).toHaveBeenCalledWith(auth, tagId, { ids: [assetC] });
  });

  it('applies existing-space detail updates using only shared-space update fields and preserving description clears', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const spaceId = newUuid();
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.SpaceUpdateDetails,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      payload: {
        spaceName: ' Family 2026 ',
        description: '',
        color: UserAvatarColor.Blue,
      },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    sharedSpaceService.update.mockResolvedValue({ id: spaceId } as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

    expect(sharedSpaceService.update).toHaveBeenCalledWith(auth, spaceId, {
      name: 'Family 2026',
      description: '',
      color: UserAvatarColor.Blue,
    });
  });

  it.each(['thumbnailAssetId', 'petsEnabled', 'faceRecognitionEnabled', 'linkedLibraryIds', 'delete'])(
    'fails existing-space detail apply when persisted payload includes unsupported field %s',
    async (field) => {
      const auth = AuthFactory.create();
      const session = makeSession({
        userId: auth.user.id,
        status: AgentSessionStatus.WaitingForPlanReview,
        permissionPlanSnapshot: expandedPermissionPlanSnapshot,
      });
      const spaceId = newUuid();
      const operation = makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        type: AgentOperationType.SpaceUpdateDetails,
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: spaceId,
        temporaryTargetId: null,
        payload: { spaceName: 'Family 2026', [field]: field === 'linkedLibraryIds' ? [newUuid()] : true },
      });
      const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
      sessionRepository.getById.mockResolvedValue(session);
      planRepository.getByIdForSession.mockResolvedValue(plan);
      planRepository.getCurrentBySessionId.mockResolvedValue(plan);
      planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
      planRepository.completeApply.mockImplementation((planId, updates) =>
        Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
      );
      accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));

      const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

      expect(result.status).toBe(AgentOperationApplyStatus.Failed);
      expect(result.failedOperationIds).toEqual([operation.id]);
      expect(sharedSpaceService.update).not.toHaveBeenCalled();
    },
  );

  it('merges sparse existing-space field overrides into the shared-space update payload', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const spaceId = newUuid();
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.SpaceUpdateDetails,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      payload: { spaceName: 'Original', color: UserAvatarColor.Gray },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    sharedSpaceService.update.mockResolvedValue({ id: spaceId } as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      fieldOverrides: { [operation.id]: { description: '' } },
    });

    expect(sharedSpaceService.update).toHaveBeenCalledWith(auth, spaceId, {
      name: 'Original',
      description: '',
      color: UserAvatarColor.Gray,
    });
  });

  it.each(['thumbnailAssetId', 'petsEnabled', 'faceRecognitionEnabled', 'linkedLibraryIds', 'delete'])(
    'rejects unsupported existing-space field override %s before claiming the plan',
    async (field) => {
      const auth = AuthFactory.create();
      const session = makeSession({
        userId: auth.user.id,
        status: AgentSessionStatus.WaitingForPlanReview,
        permissionPlanSnapshot: expandedPermissionPlanSnapshot,
      });
      const operation = makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        type: AgentOperationType.SpaceUpdateDetails,
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: newUuid(),
        payload: { spaceName: 'Original' },
      });
      const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
      sessionRepository.getById.mockResolvedValue(session);
      planRepository.getByIdForSession.mockResolvedValue(plan);
      planRepository.getCurrentBySessionId.mockResolvedValue(plan);

      await expect(
        sut.applyApprovedOperations(auth, session.id, plan.id, {
          operationIds: [operation.id],
          fieldOverrides: { [operation.id]: { [field]: 'unsupported' } },
        }),
      ).rejects.toThrow('Unsupported field override for operation type');

      expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
    },
  );

  it('fails existing-space detail apply when the permission policy no longer allows updates', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, updateSpaceDetails: false },
      },
    });
    const spaceId = newUuid();
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.SpaceUpdateDetails,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      payload: { spaceName: 'Blocked' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.failedOperationIds).toEqual([operation.id]);
    expect(sharedSpaceService.update).not.toHaveBeenCalled();
  });

  it('fails existing-space detail apply when owner access is lost before the update', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const spaceId = newUuid();
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.SpaceUpdateDetails,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      payload: { spaceName: 'Stale' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set());

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.failedOperationIds).toEqual([operation.id]);
    expect(sharedSpaceService.update).not.toHaveBeenCalled();
  });

  it('rejects invalid space field overrides before claiming the plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.SpaceUpdateDetails,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: newUuid(),
      payload: { spaceName: 'Original' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [operation.id],
        fieldOverrides: { [operation.id]: { spaceName: 'x'.repeat(101) } },
      }),
    ).rejects.toThrow('spaceName must be 1-100 characters');

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [operation.id],
        fieldOverrides: { [operation.id]: { description: 'x'.repeat(501) } },
      }),
    ).rejects.toThrow('description must be 500 characters or fewer');

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [operation.id],
        fieldOverrides: { [operation.id]: { color: '#80c7ff' } },
      }),
    ).rejects.toThrow('color must be a valid space color');

    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  });

  it('rejects unsupported new operation field overrides before claiming the plan', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetRotate,
      targetKind: AgentOperationTargetKind.ImageEditBatch,
      targetId: null,
      assetIds: [newUuid()],
      payload: { angle: 90 },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [operation.id],
        fieldOverrides: { [operation.id]: { targetAlbumId: newUuid() } },
      }),
    ).rejects.toThrow('Unsupported field override for operation type');

    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  });

  it.each([
    {
      type: AgentOperationType.AlbumCreate,
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'tmp-album',
      payload: { albumName: 'Trip' },
      fields: { targetAlbumId: newUuid() },
    },
    {
      type: AgentOperationType.SpaceCreate,
      targetKind: AgentOperationTargetKind.NewSpace,
      temporaryTargetId: 'tmp-space',
      payload: { spaceName: 'Trip' },
      fields: { targetSpaceId: newUuid() },
    },
  ])('rejects target overrides for create operations before claiming the plan', async (operationInput) => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      ...operationInput,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);

    await expect(
      sut.applyApprovedOperations(auth, session.id, plan.id, {
        operationIds: [operation.id],
        fieldOverrides: { [operation.id]: operationInput.fields as unknown as Record<string, string> },
      }),
    ).rejects.toThrow('Target overrides are not supported for create operations');

    expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
    expect(albumService.create).not.toHaveBeenCalled();
    expect(sharedSpaceService.create).not.toHaveBeenCalled();
  });

  it('keeps non-target dependencies when overriding a target', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const dependencyOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumAddAssets,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: newUuid(),
      assetIds: [newUuid()],
      payload: {},
    });
    const targetOperation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      position: 1,
      type: AgentOperationType.AlbumAddAssets,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: newUuid(),
      assetIds: [newUuid()],
      payload: {},
      dependencyIds: [dependencyOperation.id],
    });
    const plan = makePlan({
      id: 'plan-id',
      sessionId: session.id,
      operations: [dependencyOperation, targetOperation],
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [dependencyOperation.id, targetOperation.id],
      itemSelections: {
        [dependencyOperation.id]: { itemKind: 'asset', mode: 'only', itemIds: [] },
      },
      fieldOverrides: { [targetOperation.id]: { targetAlbumId: newUuid() } },
    });

    expect(result.skippedOperationIds).toEqual([dependencyOperation.id, targetOperation.id]);
    expect(albumService.addAssets).not.toHaveBeenCalled();
  });

  it('fails stale expanded apply targets before calling downstream services', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const spaceId = newUuid();
    const tagId = newUuid();
    const staleAssetId = newUuid();
    const inaccessibleAssetId = newUuid();
    const operations = [
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        type: AgentOperationType.SpaceUpdateDetails,
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: spaceId,
        payload: { spaceName: 'Stale' },
      }),
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        position: 1,
        type: AgentOperationType.AssetAddTag,
        targetKind: AgentOperationTargetKind.AssetBatch,
        targetId: null,
        assetIds: [inaccessibleAssetId],
        payload: { tagId },
      }),
      makeOperation({
        id: newUuid(),
        planId: 'plan-id',
        position: 2,
        type: AgentOperationType.AssetSetFavorite,
        targetKind: AgentOperationTargetKind.AssetBatch,
        targetId: null,
        assetIds: [staleAssetId],
        payload: { favorite: true },
      }),
    ];
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([inaccessibleAssetId, staleAssetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([inaccessibleAssetId, staleAssetId]));
    accessRepository.tag.checkOwnerAccess.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockImplementation((ids: Set<string>) =>
      Promise.resolve(new Set([...ids].filter((id) => id !== staleAssetId))),
    );

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: operations.map((operation) => operation.id),
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.failedOperationIds).toEqual(operations.map((operation) => operation.id));
    expect(sharedSpaceService.update).not.toHaveBeenCalled();
    expect(tagService.addAssets).not.toHaveBeenCalled();
    expect(assetService.updateAll).not.toHaveBeenCalled();
  });

  it('rotates selected editable images by merging existing spatial edits and reporting per-asset failures', async () => {
    const auth = AuthFactory.create();
    const editableAssetId = newUuid();
    const netZeroAssetId = newUuid();
    const videoAssetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetRotate,
      targetKind: AgentOperationTargetKind.ImageEditBatch,
      targetId: null,
      assetIds: [editableAssetId, netZeroAssetId, videoAssetId],
      payload: { angle: 90 },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([editableAssetId, netZeroAssetId, videoAssetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(
      new Set([editableAssetId, netZeroAssetId, videoAssetId]),
    );
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([editableAssetId, netZeroAssetId, videoAssetId]));
    assetRepository.getForEdit.mockImplementation((id: string) =>
      Promise.resolve({
        type: id === videoAssetId ? AssetType.Video : AssetType.Image,
        livePhotoVideoId: null,
        originalPath: '/photos/image.jpg',
        originalFileName: 'image.jpg',
        duration: null,
        exifImageWidth: 400,
        exifImageHeight: 300,
        orientation: null,
        projectionType: null,
      }),
    );
    assetService.getAssetEdits.mockImplementation((_: typeof auth, id: string) =>
      Promise.resolve({
        assetId: id,
        edits:
          id === editableAssetId
            ? [
                { id: newUuid(), action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 200, height: 200 } },
                { id: newUuid(), action: AssetEditAction.Rotate, parameters: { angle: 90 } },
                { id: newUuid(), action: AssetEditAction.Mirror, parameters: { axis: 'horizontal' } },
              ]
            : [{ id: newUuid(), action: AssetEditAction.Rotate, parameters: { angle: 180 } }],
      } as never),
    );
    assetService.editAsset.mockResolvedValue({ assetId: editableAssetId, edits: [] } as never);
    assetService.removeAssetEdits.mockResolvedValue(undefined as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      fieldOverrides: { [operation.id]: { rotationAngle: '180' } },
      itemSelections: { [operation.id]: { itemKind: 'asset', mode: 'all', itemIds: [] } },
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(assetService.editAsset).toHaveBeenCalledWith(auth, editableAssetId, {
      edits: [
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 200, height: 200 } },
        { action: AssetEditAction.Rotate, parameters: { angle: 270 } },
        { action: AssetEditAction.Mirror, parameters: { axis: 'horizontal' } },
      ],
    });
    expect(assetService.removeAssetEdits).toHaveBeenCalledWith(auth, netZeroAssetId);
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Failed,
        result: expect.objectContaining({
          assetIds: [editableAssetId, netZeroAssetId],
          assetResults: expect.arrayContaining([
            expect.objectContaining({ id: editableAssetId, success: true }),
            expect.objectContaining({ id: netZeroAssetId, success: true }),
            expect.objectContaining({ id: videoAssetId, success: false, errorMessage: 'Only images can be edited' }),
          ]),
        }),
        error: 'Failed to rotate 1 asset(s)',
      }),
    ]);
  });

  it('does not expose an apply path to the runner planning tools', () => {
    expect(Object.values(AgentToolName)).not.toContain('applyAlbumOperations');
  });

  // ── asset.trash write-scope gate ────────────────────────────────────────────

  it('validateWriteScope throws for asset.trash when trashAssets is false', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, trashAssets: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Trash matching photos.',
        operations: [
          {
            type: AgentOperationType.AssetTrash,
            summary: 'Move matching photos to Trash.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [newUuid()],
            riskLevel: AgentOperationRiskLevel.High,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow moving assets to trash');
  });

  it('validateWriteScope passes for asset.trash when trashAssets is true', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, trashAssets: true },
      },
    });
    const assetIds = [newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AssetTrash,
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds,
          }),
        ],
      }),
    );

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Trash matching photos.',
      operations: [
        {
          type: AgentOperationType.AssetTrash,
          summary: 'Move matching photos to Trash.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          riskLevel: AgentOperationRiskLevel.High,
          enabled: true,
        },
      ],
    });

    expect(result.status).not.toBe('error');
  });

  // ── preset grants ────────────────────────────────────────────────────────────

  it('VisualOrganizer preset grants trashAssets', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer].writeScope.trashAssets).toBe(
      true,
    );
  });

  it('LocalPowerUser preset grants trashAssets', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser].writeScope.trashAssets).toBe(
      true,
    );
  });

  it('Careful preset does NOT grant trashAssets', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.Careful].writeScope.trashAssets).toBe(false);
  });

  // ── apply: reversible (force: false) ─────────────────────────────────────────

  it('applying asset.trash calls assetService.deleteAll with force: false', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.AssetTrash,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: undefined,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    assetService.deleteAll.mockResolvedValue(undefined as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(assetService.deleteAll).toHaveBeenCalledWith(auth, { ids: assetIds, force: false });
    // SAFETY guard: force must never be true from this path
    expect(assetService.deleteAll).not.toHaveBeenCalledWith(auth, expect.objectContaining({ force: true }));
  });

  it('applying asset.trash returns an applied result with the asset ids', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.AssetTrash,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: undefined,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    assetService.deleteAll.mockResolvedValue(undefined as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(planRepository.completeApply).toHaveBeenCalledWith(
      plan.id,
      expect.arrayContaining([
        expect.objectContaining({
          id: operation.id,
          status: AgentOperationStatus.Applied,
          result: expect.objectContaining({ assetIds }),
        }),
      ]),
    );
  });

  it('asset.trash riskLevel is High when explicitly set', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, trashAssets: true },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AssetTrash,
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds,
            riskLevel: AgentOperationRiskLevel.High,
          }),
        ],
      }),
    );

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Trash matching photos.',
      operations: [
        {
          type: AgentOperationType.AssetTrash,
          summary: 'Move matching photos to Trash.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          riskLevel: AgentOperationRiskLevel.High,
          enabled: true,
        },
      ],
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: expect.arrayContaining([
          expect.objectContaining({
            type: AgentOperationType.AssetTrash,
            riskLevel: AgentOperationRiskLevel.High,
          }),
        ]),
      }),
    );
  });

  // ── asset.restore write-scope gate ───────────────────────────────────────────

  it('validateWriteScope throws for asset.restore when trashAssets is false', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, trashAssets: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Restore matching photos from Trash.',
        operations: [
          {
            type: AgentOperationType.AssetRestore,
            summary: 'Restore matching photos from Trash.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [newUuid()],
            riskLevel: AgentOperationRiskLevel.Low,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow moving assets to trash');
  });

  it('validateWriteScope passes for asset.restore when trashAssets is true', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, trashAssets: true },
      },
    });
    const assetIds = [newUuid()];
    sessionRepository.getById.mockResolvedValue(session);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AssetRestore,
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds,
          }),
        ],
      }),
    );

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Restore matching photos from Trash.',
      operations: [
        {
          type: AgentOperationType.AssetRestore,
          summary: 'Restore matching photos from Trash.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    });

    expect(result.status).not.toBe('error');
  });

  // ── requiresWritableAssets: restore included ─────────────────────────────────

  it('asset.restore requires writable asset access (write-only access rejected, not just read)', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, trashAssets: true },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    // Both owner and space-edit access granted → should succeed (writable)
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AssetRestore,
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds,
          }),
        ],
      }),
    );

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Restore matching photos from Trash.',
      operations: [
        {
          type: AgentOperationType.AssetRestore,
          summary: 'Restore matching photos from Trash.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    });
    // Both owner+space-edit access → propose succeeds
    expect(result.status).not.toBe('error');
    // Write-access repositories were called (confirming requiresWritableAssets path was taken)
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalled();
  });

  // ── apply: asset.restore calls trashService.restoreAssets ────────────────────

  it('applying asset.restore calls trashService.restoreAssets with the resolved ids', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.AssetRestore,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: undefined,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    trashService.restoreAssets.mockResolvedValue({ count: assetIds.length });

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(trashService.restoreAssets).toHaveBeenCalledWith(auth, { ids: assetIds });
  });

  it('applying asset.restore returns an applied result with the asset ids', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.AssetRestore,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: undefined,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    trashService.restoreAssets.mockResolvedValue({ count: assetIds.length });

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(planRepository.completeApply).toHaveBeenCalledWith(
      plan.id,
      expect.arrayContaining([
        expect.objectContaining({
          id: operation.id,
          status: AgentOperationStatus.Applied,
          result: expect.objectContaining({ assetIds }),
        }),
      ]),
    );
  });

  it('asset.restore riskLevel is Low by default', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, trashAssets: true },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AssetRestore,
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds,
            riskLevel: AgentOperationRiskLevel.Low,
          }),
        ],
      }),
    );

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Restore matching photos from Trash.',
      operations: [
        {
          type: AgentOperationType.AssetRestore,
          summary: 'Restore matching photos from Trash.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: expect.arrayContaining([
          expect.objectContaining({
            type: AgentOperationType.AssetRestore,
            riskLevel: AgentOperationRiskLevel.Low,
          }),
        ]),
      }),
    );
  });

  // ── asset.crop ────────────────────────────────────────────────────────────────

  it('validateWriteScope throws for asset.crop when editAssets is false', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, editAssets: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Crop image.',
        operations: [
          {
            type: AgentOperationType.AssetCrop,
            summary: 'Crop to region.',
            targetKind: AgentOperationTargetKind.ImageEditBatch,
            assetIds: [newUuid()],
            payload: { x: 10, y: 20, width: 400, height: 300 },
            riskLevel: AgentOperationRiskLevel.Low,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow editing assets');
  });

  it('asset.crop requires writable asset access (requiresWritableAssets includes crop)', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    sessionRepository.getById.mockResolvedValue(session);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AssetCrop,
            targetKind: AgentOperationTargetKind.ImageEditBatch,
            assetIds,
          }),
        ],
      }),
    );

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Crop image.',
      operations: [
        {
          type: AgentOperationType.AssetCrop,
          summary: 'Crop to region.',
          targetKind: AgentOperationTargetKind.ImageEditBatch,
          assetIds,
          payload: { x: 10, y: 20, width: 400, height: 300 },
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    });

    expect(result.status).not.toBe('error');
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalled();
  });

  it('asset.crop riskLevel is Low by default', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    sessionRepository.getById.mockResolvedValue(session);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AssetCrop,
            targetKind: AgentOperationTargetKind.ImageEditBatch,
            assetIds,
            riskLevel: AgentOperationRiskLevel.Low,
          }),
        ],
      }),
    );

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Crop image.',
      operations: [
        {
          type: AgentOperationType.AssetCrop,
          summary: 'Crop to region.',
          targetKind: AgentOperationTargetKind.ImageEditBatch,
          assetIds,
          payload: { x: 10, y: 20, width: 400, height: 300 },
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: expect.arrayContaining([
          expect.objectContaining({
            type: AgentOperationType.AssetCrop,
            riskLevel: AgentOperationRiskLevel.Low,
          }),
        ]),
      }),
    );
  });

  it('crops selected editable images placing Crop edit first and reporting per-asset failures', async () => {
    const auth = AuthFactory.create();
    const editableAssetId = newUuid();
    const videoAssetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const cropPayload = { x: 10, y: 20, width: 400, height: 300 };
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetCrop,
      targetKind: AgentOperationTargetKind.ImageEditBatch,
      targetId: null,
      assetIds: [editableAssetId, videoAssetId],
      payload: cropPayload,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([editableAssetId, videoAssetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([editableAssetId, videoAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([editableAssetId, videoAssetId]));
    assetRepository.getForEdit.mockImplementation((id: string) =>
      Promise.resolve({
        type: id === videoAssetId ? AssetType.Video : AssetType.Image,
        livePhotoVideoId: null,
        originalPath: '/photos/image.jpg',
        originalFileName: 'image.jpg',
        duration: null,
        exifImageWidth: 800,
        exifImageHeight: 600,
        orientation: null,
        projectionType: null,
      }),
    );
    // editableAssetId already has a Rotate edit; crop must come FIRST in merged list
    assetService.getAssetEdits.mockImplementation((_: typeof auth, id: string) =>
      Promise.resolve({
        assetId: id,
        edits:
          id === editableAssetId ? [{ id: newUuid(), action: AssetEditAction.Rotate, parameters: { angle: 90 } }] : [],
      } as never),
    );
    assetService.editAsset.mockResolvedValue({ assetId: editableAssetId, edits: [] } as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(assetService.editAsset).toHaveBeenCalledWith(auth, editableAssetId, {
      edits: [
        // Crop MUST be first
        { action: AssetEditAction.Crop, parameters: cropPayload },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ],
    });
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Failed,
        result: expect.objectContaining({
          assetIds: [editableAssetId],
          assetResults: expect.arrayContaining([
            expect.objectContaining({ id: editableAssetId, success: true }),
            expect.objectContaining({ id: videoAssetId, success: false, errorMessage: 'Only images can be edited' }),
          ]),
        }),
        error: 'Failed to crop 1 asset(s)',
      }),
    ]);
  });

  it('crop on asset with existing crop replaces the crop edit (crop-first)', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const newCropPayload = { x: 5, y: 5, width: 200, height: 150 };
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetCrop,
      targetKind: AgentOperationTargetKind.ImageEditBatch,
      targetId: null,
      assetIds: [assetId],
      payload: newCropPayload,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    assetRepository.getForEdit.mockResolvedValue({
      type: AssetType.Image,
      livePhotoVideoId: null,
      originalPath: '/photos/image.jpg',
      originalFileName: 'image.jpg',
      duration: null,
      exifImageWidth: 800,
      exifImageHeight: 600,
      orientation: null,
      projectionType: null,
    });
    // Asset already has a Crop edit followed by a Rotate edit
    assetService.getAssetEdits.mockResolvedValue({
      assetId,
      edits: [
        { id: newUuid(), action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 100, height: 100 } },
        { id: newUuid(), action: AssetEditAction.Rotate, parameters: { angle: 180 } },
      ],
    } as never);
    assetService.editAsset.mockResolvedValue({ assetId, edits: [] } as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(assetService.editAsset).toHaveBeenCalledWith(auth, assetId, {
      edits: [
        // New crop replaces old, still first
        { action: AssetEditAction.Crop, parameters: newCropPayload },
        { action: AssetEditAction.Rotate, parameters: { angle: 180 } },
      ],
    });
  });

  // ── shareLink.create ─────────────────────────────────────────────────────────

  it('validateWriteScope throws for shareLink.create when createSharedLinks is false', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, createSharedLinks: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Create a share link.',
        operations: [
          {
            type: AgentOperationType.ShareLinkCreate,
            summary: 'Share selected photos.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [newUuid()],
            riskLevel: AgentOperationRiskLevel.High,
            enabled: true,
            payload: {},
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow creating shared links');
  });

  it('validateWriteScope passes for shareLink.create when createSharedLinks is true', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, createSharedLinks: true },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.ShareLinkCreate,
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds,
            payload: {},
          }),
        ],
      }),
    );

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Create a share link.',
      operations: [
        {
          type: AgentOperationType.ShareLinkCreate,
          summary: 'Share selected photos.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          riskLevel: AgentOperationRiskLevel.High,
          enabled: true,
          payload: {},
        },
      ],
    });

    expect(result.status).not.toBe('error');
  });

  // ── preset: createSharedLinks granted ONLY in LocalPowerUser (outward-facing) ─

  it('Careful preset does NOT grant createSharedLinks', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.Careful].writeScope.createSharedLinks).toBe(
      false,
    );
  });

  it('VisualOrganizer preset does NOT grant createSharedLinks', () => {
    expect(
      AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer].writeScope.createSharedLinks,
    ).toBe(false);
  });

  it('LocalPowerUser preset grants createSharedLinks (the only preset that does)', () => {
    expect(
      AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser].writeScope.createSharedLinks,
    ).toBe(true);
  });

  // ── apply: shareLink.create calls sharedLinkService.create ───────────────────

  it('applying shareLink.create calls sharedLinkService.create with type Individual and resolved assetIds', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.ShareLinkCreate,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: { password: 'secret', showMetadata: false, allowDownload: false },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    sharedLinkService.create.mockResolvedValue({ id: newUuid() } as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(sharedLinkService.create).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({
        type: SharedLinkType.Individual,
        assetIds,
        password: 'secret',
        showMetadata: false,
        allowDownload: false,
      }),
    );
  });

  it('applying shareLink.create with minimal payload uses defaults', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.ShareLinkCreate,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    sharedLinkService.create.mockResolvedValue({ id: newUuid() } as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(sharedLinkService.create).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({
        type: SharedLinkType.Individual,
        assetIds,
      }),
    );
  });

  it('shareLink.create riskLevel is High by default', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, createSharedLinks: true },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.ShareLinkCreate,
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds,
            payload: {},
          }),
        ],
      }),
    );

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Create a share link.',
      operations: [
        {
          type: AgentOperationType.ShareLinkCreate,
          summary: 'Share selected photos.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          riskLevel: AgentOperationRiskLevel.High,
          enabled: true,
          payload: {},
        },
      ],
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: expect.arrayContaining([
          expect.objectContaining({
            type: AgentOperationType.ShareLinkCreate,
            riskLevel: AgentOperationRiskLevel.High,
          }),
        ]),
      }),
    );
  });

  // ── shareLink.createAlbum ─────────────────────────────────────────────────────

  it('validateWriteScope throws for shareLink.createAlbum when createSharedLinks is false', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, createSharedLinks: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Create a share link for the album.',
        operations: [
          {
            type: AgentOperationType.ShareLinkCreateAlbum,
            summary: 'Create an album share link.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            riskLevel: AgentOperationRiskLevel.High,
            enabled: true,
            payload: {},
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow creating shared links');
  });

  it('validateWriteScope passes for shareLink.createAlbum when createSharedLinks is true', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, createSharedLinks: true },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.ShareLinkCreateAlbum,
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetIds: [],
            payload: {},
          }),
        ],
      }),
    );

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Create a share link for the album.',
      operations: [
        {
          type: AgentOperationType.ShareLinkCreateAlbum,
          summary: 'Create an album share link.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          riskLevel: AgentOperationRiskLevel.High,
          enabled: true,
          payload: {},
        },
      ],
    });

    expect(result.status).not.toBe('error');
  });

  it('applying shareLink.createAlbum calls sharedLinkService.create with type Album and albumId', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.ShareLinkCreateAlbum,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      assetIds: [],
      payload: { password: 'secret', showMetadata: false, allowDownload: false },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    sharedLinkService.create.mockResolvedValue({ id: newUuid() } as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(sharedLinkService.create).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({
        type: SharedLinkType.Album,
        albumId,
        password: 'secret',
        showMetadata: false,
        allowDownload: false,
      }),
    );
  });

  it('applying shareLink.createAlbum with minimal payload omits optional fields', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.ShareLinkCreateAlbum,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      assetIds: [],
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    sharedLinkService.create.mockResolvedValue({ id: newUuid() } as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(sharedLinkService.create).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({
        type: SharedLinkType.Album,
        albumId,
      }),
    );
  });

  it('applying shareLink.create (individual) path is unchanged (regression)', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.ShareLinkCreate,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    sharedLinkService.create.mockResolvedValue({ id: newUuid() } as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(sharedLinkService.create).toHaveBeenCalledWith(
      auth,
      expect.objectContaining({
        type: SharedLinkType.Individual,
        assetIds,
      }),
    );
  });

  // ── asset.stack ───────────────────────────────────────────────────────────────

  it('validateWriteScope throws for asset.stack when manageStacks is false', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, manageStacks: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Stack matching photos.',
        operations: [
          {
            type: AgentOperationType.AssetStack,
            summary: 'Stack matching photos.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [newUuid()],
            riskLevel: AgentOperationRiskLevel.Low,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow stacking assets');
  });

  it('validateWriteScope throws for asset.unstack when manageStacks is false', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, manageStacks: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Unstack matching photos.',
        operations: [
          {
            type: AgentOperationType.AssetUnstack,
            summary: 'Unstack matching photos.',
            targetKind: AgentOperationTargetKind.AssetBatch,
            assetIds: [newUuid()],
            riskLevel: AgentOperationRiskLevel.Low,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow stacking assets');
  });

  it('VisualOrganizer preset grants manageStacks', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer].writeScope.manageStacks).toBe(
      true,
    );
  });

  it('LocalPowerUser preset grants manageStacks', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser].writeScope.manageStacks).toBe(
      true,
    );
  });

  it('Careful preset does NOT grant manageStacks', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.Careful].writeScope.manageStacks).toBe(false);
  });

  it('proposeAssetBatchFromSelection maps asset.stack → summary / AssetBatch / payload {} / Low', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const selectionHandleId = newUuid();
    const assetIds = [newUuid(), newUuid()];

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds,
      expiresAt: new Date('2026-06-05T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    const createdPlan = makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AssetStack,
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          payload: {},
          riskLevel: AgentOperationRiskLevel.Low,
        }),
      ],
    });
    planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

    const result = await sut.proposeAssetBatchFromSelection(auth, session.id, {
      summary: 'Stack matching photos.',
      action: { type: AgentOperationType.AssetStack },
      selectionHandleId,
    });

    expect(result.plan?.operations[0]).toMatchObject({
      type: AgentOperationType.AssetStack,
      targetKind: AgentOperationTargetKind.AssetBatch,
      riskLevel: AgentOperationRiskLevel.Low,
    });
  });

  it('proposeAssetBatchFromSelection maps asset.unstack → summary / AssetBatch / payload {} / Low', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const selectionHandleId = newUuid();
    const assetIds = [newUuid(), newUuid()];

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds,
      expiresAt: new Date('2026-06-05T12:30:00.000Z'),
      createdAt: now,
      updateId: newUuid(),
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    const createdPlan = makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AssetUnstack,
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds,
          payload: {},
          riskLevel: AgentOperationRiskLevel.Low,
        }),
      ],
    });
    planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

    const result = await sut.proposeAssetBatchFromSelection(auth, session.id, {
      summary: 'Unstack matching photos.',
      action: { type: AgentOperationType.AssetUnstack },
      selectionHandleId,
    });

    expect(result.plan?.operations[0]).toMatchObject({
      type: AgentOperationType.AssetUnstack,
      targetKind: AgentOperationTargetKind.AssetBatch,
      riskLevel: AgentOperationRiskLevel.Low,
    });
  });

  it('applying asset.stack selects primary by favorite > rating > newest, calls stackService.create', async () => {
    const auth = AuthFactory.create();
    const newestId = newUuid();
    const favId = newUuid();
    const highRatingId = newUuid();
    const assetIds = [newestId, favId, highRatingId];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.AssetStack,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: undefined,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    // Favorite wins over rating and newest
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      { id: newestId, isFavorite: false, fileCreatedAt: new Date('2026-06-05'), exifInfo: { rating: null } },
      { id: favId, isFavorite: true, fileCreatedAt: new Date('2026-01-01'), exifInfo: { rating: null } },
      { id: highRatingId, isFavorite: false, fileCreatedAt: new Date('2026-01-01'), exifInfo: { rating: 5 } },
    ] as never);
    stackService.create.mockResolvedValue({ id: 'stack-1' } as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(stackService.create).toHaveBeenCalledWith(auth, { assetIds: [favId, highRatingId, newestId] });
  });

  it('applying asset.stack: rating tie-break selects higher rating before newer', async () => {
    const auth = AuthFactory.create();
    const lowRatingId = newUuid();
    const highRatingId = newUuid();
    const assetIds = [lowRatingId, highRatingId];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.AssetStack,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: undefined,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      { id: lowRatingId, isFavorite: false, fileCreatedAt: new Date('2026-06-05'), exifInfo: { rating: 2 } },
      { id: highRatingId, isFavorite: false, fileCreatedAt: new Date('2026-01-01'), exifInfo: { rating: 5 } },
    ] as never);
    stackService.create.mockResolvedValue({ id: 'stack-1' } as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    // highRatingId (5) wins over lowRatingId (2) despite lowRatingId being newer
    expect(stackService.create).toHaveBeenCalledWith(auth, { assetIds: [highRatingId, lowRatingId] });
  });

  it('applying asset.stack: newest tie-break selects newer fileCreatedAt when no favorite/rating', async () => {
    const auth = AuthFactory.create();
    const olderId = newUuid();
    const newerId = newUuid();
    const assetIds = [olderId, newerId];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.AssetStack,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: undefined,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      { id: olderId, isFavorite: false, fileCreatedAt: new Date('2025-01-01'), exifInfo: { rating: null } },
      { id: newerId, isFavorite: false, fileCreatedAt: new Date('2026-06-05'), exifInfo: { rating: null } },
    ] as never);
    stackService.create.mockResolvedValue({ id: 'stack-1' } as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    // newerId wins as primary
    expect(stackService.create).toHaveBeenCalledWith(auth, { assetIds: [newerId, olderId] });
  });

  it('applying asset.unstack calls stackService.deleteAll with distinct stackIds', async () => {
    const auth = AuthFactory.create();
    const assetId1 = newUuid();
    const assetId2 = newUuid();
    const assetId3 = newUuid();
    const assetIds = [assetId1, assetId2, assetId3];
    const stackId = 'stack-42';
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.AssetUnstack,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: undefined,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    // Two assets share the same stack, one has no stack
    assetRepository.getByIds.mockResolvedValue([
      { id: assetId1, stackId },
      { id: assetId2, stackId },
      { id: assetId3, stackId: null },
    ] as never);
    stackService.deleteAll.mockResolvedValue(undefined as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    // Distinct stackIds only (assetId3 has no stack → skipped)
    expect(stackService.deleteAll).toHaveBeenCalledWith(auth, { ids: [stackId] });
  });

  it('applying asset.unstack with no stacked assets is a no-op (returns applied)', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.AssetUnstack,
      targetKind: AgentOperationTargetKind.AssetBatch,
      assetIds,
      payload: undefined,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    assetRepository.getByIds.mockResolvedValue([{ id: assetIds[0], stackId: null }] as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(stackService.deleteAll).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
  });

  // ── person.update ─────────────────────────────────────────────────────────────

  it('validateWriteScope throws for person.update when managePeople is false', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, managePeople: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Rename person Alex.',
        operations: [
          {
            type: AgentOperationType.PersonUpdate,
            summary: 'Rename person Alex to Alexander.',
            targetKind: AgentOperationTargetKind.Person,
            targetId: personId,
            riskLevel: AgentOperationRiskLevel.Low,
            enabled: true,
            payload: { name: 'Alexander' },
          },
        ],
      }),
    ).rejects.toThrow(/managing people/);
  });

  it('validateWriteScope passes for person.update when managePeople is true', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, managePeople: true },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.PersonUpdate,
            targetKind: AgentOperationTargetKind.Person,
            targetId: personId,
            assetIds: [],
            payload: { name: 'Alexander' },
          }),
        ],
      }),
    );

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Rename person Alex.',
      operations: [
        {
          type: AgentOperationType.PersonUpdate,
          summary: 'Rename person Alex to Alexander.',
          targetKind: AgentOperationTargetKind.Person,
          targetId: personId,
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
          payload: { name: 'Alexander' },
        },
      ],
    });

    expect(result.status).not.toBe('error');
  });

  it('applying person.update (name) calls personService.update with the correct shape', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.PersonUpdate,
      targetKind: AgentOperationTargetKind.Person,
      targetId: personId,
      assetIds: [],
      payload: { name: 'Alexander' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    personService.update.mockResolvedValue({ id: personId } as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(personService.update).toHaveBeenCalledWith(auth, personId, {
      name: 'Alexander',
      birthDate: undefined,
      isHidden: undefined,
    });
  });

  it('applying person.update (birthDate) calls personService.update with the correct shape', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.PersonUpdate,
      targetKind: AgentOperationTargetKind.Person,
      targetId: personId,
      assetIds: [],
      payload: { birthDate: '1990-05-01' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    personService.update.mockResolvedValue({ id: personId } as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(personService.update).toHaveBeenCalledWith(auth, personId, {
      name: undefined,
      birthDate: '1990-05-01',
      isHidden: undefined,
    });
  });

  it('applying person.update (isHidden) calls personService.update with the correct shape', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.PersonUpdate,
      targetKind: AgentOperationTargetKind.Person,
      targetId: personId,
      assetIds: [],
      payload: { isHidden: true },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    personService.update.mockResolvedValue({ id: personId } as never);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(personService.update).toHaveBeenCalledWith(auth, personId, {
      name: undefined,
      birthDate: undefined,
      isHidden: true,
    });
  });

  it('VisualOrganizer preset grants managePeople', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer].writeScope.managePeople).toBe(
      true,
    );
  });

  it('LocalPowerUser preset grants managePeople', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser].writeScope.managePeople).toBe(
      true,
    );
  });

  it('Careful preset does NOT grant managePeople', () => {
    expect(AgentSessionService.permissionPresets[AgentPermissionPreset.Careful].writeScope.managePeople).toBe(false);
  });

  // ── person.merge ──────────────────────────────────────────────────────────────

  it('validateWriteScope throws for person.merge when managePeople is false', async () => {
    const auth = AuthFactory.create();
    const keepPersonId = newUuid();
    const sourcePersonId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, managePeople: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Merge Alejandra into Karina.',
        operations: [
          {
            type: AgentOperationType.PersonMerge,
            summary: 'Merge Alejandra into Karina (irreversible).',
            targetKind: AgentOperationTargetKind.Person,
            targetId: keepPersonId,
            riskLevel: AgentOperationRiskLevel.High,
            enabled: true,
            payload: { sourcePersonIds: [sourcePersonId] },
          },
        ],
      }),
    ).rejects.toThrow(/managing people/);
  });

  it('validateWriteScope passes for person.merge when managePeople is true', async () => {
    const auth = AuthFactory.create();
    const keepPersonId = newUuid();
    const sourcePersonId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.Running,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, managePeople: true },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.PersonMerge,
            targetKind: AgentOperationTargetKind.Person,
            targetId: keepPersonId,
            assetIds: [],
            payload: { sourcePersonIds: [sourcePersonId] },
          }),
        ],
      }),
    );

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Merge Alejandra into Karina.',
      operations: [
        {
          type: AgentOperationType.PersonMerge,
          summary: 'Merge Alejandra into Karina (irreversible).',
          targetKind: AgentOperationTargetKind.Person,
          targetId: keepPersonId,
          riskLevel: AgentOperationRiskLevel.High,
          enabled: true,
          payload: { sourcePersonIds: [sourcePersonId] },
        },
      ],
    });

    expect(result.status).not.toBe('error');
  });

  it('applying person.merge calls personService.mergePerson with the correct shape', async () => {
    const auth = AuthFactory.create();
    const keepPersonId = newUuid();
    const sourcePersonId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      type: AgentOperationType.PersonMerge,
      targetKind: AgentOperationTargetKind.Person,
      targetId: keepPersonId,
      assetIds: [],
      payload: { sourcePersonIds: [sourcePersonId] },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    personService.mergePerson.mockResolvedValue([]);

    await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {},
      fieldOverrides: {},
    });

    expect(personService.mergePerson).toHaveBeenCalledWith(auth, keepPersonId, {
      ids: [sourcePersonId],
    });
  });

  // ── asset.adjust ─────────────────────────────────────────────────────────────

  it('validateWriteScope throws for asset.adjust when editAssets is false', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, editAssets: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Adjust photos.',
        operations: [
          {
            type: AgentOperationType.AssetAdjust,
            summary: 'Adjust photos brighter.',
            targetKind: AgentOperationTargetKind.ImageEditBatch,
            assetIds: [newUuid()],
            payload: { brightness: 'moderate_increase' },
            riskLevel: AgentOperationRiskLevel.Low,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow editing assets');
  });

  it('asset.adjust riskLevel is Low and target is ImageEditBatch', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    sessionRepository.getById.mockResolvedValue(session);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AssetAdjust,
            targetKind: AgentOperationTargetKind.ImageEditBatch,
            assetIds,
            riskLevel: AgentOperationRiskLevel.Low,
          }),
        ],
      }),
    );

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Adjust photos.',
      operations: [
        {
          type: AgentOperationType.AssetAdjust,
          summary: 'Adjust photos brighter.',
          targetKind: AgentOperationTargetKind.ImageEditBatch,
          assetIds,
          payload: { brightness: 'moderate_increase' },
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: expect.arrayContaining([
          expect.objectContaining({
            type: AgentOperationType.AssetAdjust,
            riskLevel: AgentOperationRiskLevel.Low,
          }),
        ]),
      }),
    );
  });

  it('applies adjust edit merging with existing edits and reports per-asset failures', async () => {
    const auth = AuthFactory.create();
    const editableAssetId = newUuid();
    const videoAssetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const adjustPayload = { brightness: 'moderate_increase' };
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetAdjust,
      targetKind: AgentOperationTargetKind.ImageEditBatch,
      targetId: null,
      assetIds: [editableAssetId, videoAssetId],
      payload: adjustPayload,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([editableAssetId, videoAssetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([editableAssetId, videoAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([editableAssetId, videoAssetId]));
    assetRepository.getForEdit.mockImplementation((id: string) =>
      Promise.resolve({
        type: id === videoAssetId ? AssetType.Video : AssetType.Image,
        livePhotoVideoId: null,
        originalPath: '/photos/image.jpg',
        originalFileName: 'image.jpg',
        duration: null,
        exifImageWidth: 800,
        exifImageHeight: 600,
        orientation: null,
        projectionType: null,
      }),
    );
    // editableAssetId already has a crop edit; the new adjust should be appended
    assetService.getAssetEdits.mockImplementation((_: typeof auth, id: string) =>
      Promise.resolve({
        assetId: id,
        edits:
          id === editableAssetId
            ? [{ id: newUuid(), action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 200, height: 200 } }]
            : [],
      } as never),
    );
    assetService.editAsset.mockResolvedValue({ assetId: editableAssetId, edits: [] } as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(assetService.editAsset).toHaveBeenCalledWith(auth, editableAssetId, {
      edits: [
        // Crop stays first; adjust appended
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 200, height: 200 } },
        { action: AssetEditAction.Adjust, parameters: { brightness: 'moderate_increase' } },
      ],
    });
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Failed,
        result: expect.objectContaining({
          assetIds: [editableAssetId],
          assetResults: expect.arrayContaining([
            expect.objectContaining({ id: editableAssetId, success: true }),
            expect.objectContaining({ id: videoAssetId, success: false, errorMessage: 'Only images can be edited' }),
          ]),
        }),
        error: 'Failed to adjust 1 asset(s)',
      }),
    ]);
  });

  it('adjust on asset with existing adjust replaces the adjust edit', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const newAdjustPayload = { contrast: 'strong_increase' };
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetAdjust,
      targetKind: AgentOperationTargetKind.ImageEditBatch,
      targetId: null,
      assetIds: [assetId],
      payload: newAdjustPayload,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    assetRepository.getForEdit.mockResolvedValue({
      type: AssetType.Image,
      livePhotoVideoId: null,
      originalPath: '/photos/image.jpg',
      originalFileName: 'image.jpg',
      duration: null,
      exifImageWidth: 800,
      exifImageHeight: 600,
      orientation: null,
      projectionType: null,
    });
    // Asset already has an adjust edit; the new one should replace it
    assetService.getAssetEdits.mockResolvedValue({
      assetId,
      edits: [{ id: newUuid(), action: AssetEditAction.Adjust, parameters: { brightness: 'slight_increase' } }],
    } as never);
    assetService.editAsset.mockResolvedValue({ assetId, edits: [] } as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(assetService.editAsset).toHaveBeenCalledWith(auth, assetId, {
      edits: [
        // Old adjust replaced by new
        { action: AssetEditAction.Adjust, parameters: { contrast: 'strong_increase' } },
      ],
    });
  });

  // ── asset.flip ────────────────────────────────────────────────────────────────

  it('validateWriteScope throws for asset.flip when editAssets is false', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedPermissionPlanSnapshot.writeScope, editAssets: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Flip photos.',
        operations: [
          {
            type: AgentOperationType.AssetFlip,
            summary: 'Flip photos horizontally.',
            targetKind: AgentOperationTargetKind.ImageEditBatch,
            assetIds: [newUuid()],
            payload: { axis: 'horizontal' },
            riskLevel: AgentOperationRiskLevel.Low,
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow editing assets');
  });

  it('asset.flip riskLevel is Low and target is ImageEditBatch', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    sessionRepository.getById.mockResolvedValue(session);
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    planRepository.createReplacementRevision.mockResolvedValue(
      makePlan({
        id: newUuid(),
        sessionId: session.id,
        operations: [
          makeOperation({
            type: AgentOperationType.AssetFlip,
            targetKind: AgentOperationTargetKind.ImageEditBatch,
            assetIds,
            riskLevel: AgentOperationRiskLevel.Low,
          }),
        ],
      }),
    );

    await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Flip photos.',
      operations: [
        {
          type: AgentOperationType.AssetFlip,
          summary: 'Flip photos horizontally.',
          targetKind: AgentOperationTargetKind.ImageEditBatch,
          assetIds,
          payload: { axis: 'horizontal' },
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    });

    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: expect.arrayContaining([
          expect.objectContaining({
            type: AgentOperationType.AssetFlip,
            riskLevel: AgentOperationRiskLevel.Low,
          }),
        ]),
      }),
    );
  });

  it('applies flip (mirror) edit and skips non-image assets', async () => {
    const auth = AuthFactory.create();
    const editableAssetId = newUuid();
    const videoAssetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const flipPayload = { axis: 'horizontal' };
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetFlip,
      targetKind: AgentOperationTargetKind.ImageEditBatch,
      targetId: null,
      assetIds: [editableAssetId, videoAssetId],
      payload: flipPayload,
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([editableAssetId, videoAssetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([editableAssetId, videoAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([editableAssetId, videoAssetId]));
    assetRepository.getForEdit.mockImplementation((id: string) =>
      Promise.resolve({
        type: id === videoAssetId ? AssetType.Video : AssetType.Image,
        livePhotoVideoId: null,
        originalPath: '/photos/image.jpg',
        originalFileName: 'image.jpg',
        duration: null,
        exifImageWidth: 800,
        exifImageHeight: 600,
        orientation: null,
        projectionType: null,
      }),
    );
    assetService.getAssetEdits.mockResolvedValue({
      assetId: editableAssetId,
      edits: [],
    } as never);
    assetService.editAsset.mockResolvedValue({ assetId: editableAssetId, edits: [] } as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(assetService.editAsset).toHaveBeenCalledWith(auth, editableAssetId, {
      edits: [{ action: AssetEditAction.Mirror, parameters: { axis: 'horizontal' } }],
    });
    expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
      expect.objectContaining({
        id: operation.id,
        status: AgentOperationStatus.Failed,
        result: expect.objectContaining({
          assetIds: [editableAssetId],
          assetResults: expect.arrayContaining([
            expect.objectContaining({ id: editableAssetId, success: true }),
            expect.objectContaining({ id: videoAssetId, success: false, errorMessage: 'Only images can be edited' }),
          ]),
        }),
        error: 'Failed to flip 1 asset(s)',
      }),
    ]);
  });

  it('flip idempotent on same axis (one mirror per axis)', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AssetFlip,
      targetKind: AgentOperationTargetKind.ImageEditBatch,
      targetId: null,
      assetIds: [assetId],
      payload: { axis: 'horizontal' },
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    assetRepository.getForEdit.mockResolvedValue({
      type: AssetType.Image,
      livePhotoVideoId: null,
      originalPath: '/photos/image.jpg',
      originalFileName: 'image.jpg',
      duration: null,
      exifImageWidth: 800,
      exifImageHeight: 600,
      orientation: null,
      projectionType: null,
    });
    // Already has a horizontal mirror; applying again should keep only one
    assetService.getAssetEdits.mockResolvedValue({
      assetId,
      edits: [{ id: newUuid(), action: AssetEditAction.Mirror, parameters: { axis: 'horizontal' } }],
    } as never);
    assetService.editAsset.mockResolvedValue({ assetId, edits: [] } as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(assetService.editAsset).toHaveBeenCalledWith(auth, assetId, {
      edits: [{ action: AssetEditAction.Mirror, parameters: { axis: 'horizontal' } }],
    });
  });

  it('applies album.addUsers operation by calling albumService.addUsers with the resolved albumId and albumUsers payload', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const userId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.AlbumAddUsers,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      payload: { albumUsers: [{ userId, role: AlbumUserRole.Viewer }] },
    });
    const plan = makePlan({ sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    albumService.addUsers.mockResolvedValue({} as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(albumService.addUsers).toHaveBeenCalledWith(auth, albumId, {
      albumUsers: [{ userId, role: AlbumUserRole.Viewer }],
    });
  });

  it('applies album.removeUsers operation by calling albumService.removeUser once per userId', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const userId1 = newUuid();
    const userId2 = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.AlbumRemoveUsers,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      payload: { userIds: [userId1, userId2] },
    });
    const plan = makePlan({ sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    albumService.removeUser.mockResolvedValue(void 0 as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(albumService.removeUser).toHaveBeenCalledWith(auth, albumId, userId1);
    expect(albumService.removeUser).toHaveBeenCalledWith(auth, albumId, userId2);
    expect(albumService.removeUser).toHaveBeenCalledTimes(2);
  });

  it('applies album.updateUserRole operation by calling albumService.updateUser with the resolved albumId and role payload', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const userId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.AlbumUpdateUserRole,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      payload: { userId, role: AlbumUserRole.Editor },
    });
    const plan = makePlan({ sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    albumService.updateUser.mockResolvedValue(void 0 as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(albumService.updateUser).toHaveBeenCalledWith(auth, albumId, userId, { role: AlbumUserRole.Editor });
  });

  it('applies asset.setVisibility operation by calling assetService.updateAll with visibility=locked', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: expandedPermissionPlanSnapshot,
    });
    const operation = makeOperation({
      id: newUuid(),
      type: AgentOperationType.AssetSetVisibility,
      targetKind: AgentOperationTargetKind.AssetBatch,
      targetId: null,
      temporaryTargetId: null,
      assetIds,
      payload: { visibility: AssetVisibility.Locked },
    });
    const plan = makePlan({ sessionId: session.id, operations: [operation] });

    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    assetService.updateAll.mockResolvedValue(undefined as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(assetService.updateAll).toHaveBeenCalledWith(auth, { ids: assetIds, visibility: AssetVisibility.Locked });
  });

  // ── album.delete + space.delete (Slice 3.2) ─────────────────────────────────

  it('proposes album.delete with High risk and photos-preserved summary', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedWriteScope, deleteContainers: true },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    const plan = makePlan({ sessionId: session.id });
    planRepository.createReplacementRevision.mockResolvedValue(plan);
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing }),
    );
    planRepository.getCurrentBySessionId.mockResolvedValue(void 0);

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Delete the Test album.',
      operations: [
        {
          type: AgentOperationType.AlbumDelete,
          summary: 'Delete the "Test" album (photos are kept in your library).',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          payload: {},
          enabled: true,
          riskLevel: AgentOperationRiskLevel.High,
        },
      ],
    });

    expect(result.status).toBe('success');
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: expect.arrayContaining([
          expect.objectContaining({
            type: AgentOperationType.AlbumDelete,
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            riskLevel: AgentOperationRiskLevel.High,
          }),
        ]),
      }),
    );
  });

  it('proposes space.delete with High risk and photos-preserved summary', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedWriteScope, deleteContainers: true },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    const plan = makePlan({ sessionId: session.id });
    planRepository.createReplacementRevision.mockResolvedValue(plan);
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing }),
    );
    planRepository.getCurrentBySessionId.mockResolvedValue(void 0);

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Delete the Family space.',
      operations: [
        {
          type: AgentOperationType.SpaceDelete,
          summary: 'Delete the "Family" space (photos stay in members\' libraries).',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          payload: {},
          enabled: true,
          riskLevel: AgentOperationRiskLevel.High,
        },
      ],
    });

    expect(result.status).toBe('success');
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        operations: expect.arrayContaining([
          expect.objectContaining({
            type: AgentOperationType.SpaceDelete,
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: spaceId,
            riskLevel: AgentOperationRiskLevel.High,
          }),
        ]),
      }),
    );
  });

  it('applies album.delete by calling albumService.delete with the resolved albumId', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedWriteScope, deleteContainers: true },
      },
    });
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumDelete,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    albumService.delete.mockResolvedValue(undefined as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(albumService.delete).toHaveBeenCalledWith(auth, albumId);
  });

  it('applies space.delete by calling sharedSpaceService.remove with the resolved spaceId', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedWriteScope, deleteContainers: true },
      },
    });
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.SpaceDelete,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
    sharedSpaceService.remove.mockResolvedValue(undefined as never);

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
    });

    expect(result.status).toBe(AgentOperationApplyStatus.Applied);
    expect(sharedSpaceService.remove).toHaveBeenCalledWith(auth, spaceId);
  });

  it('fails album.delete apply when deleteContainers scope is revoked before apply', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedWriteScope, deleteContainers: false },
      },
    });
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.AlbumDelete,
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: albumId,
      temporaryTargetId: null,
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.failedOperationIds).toEqual([operation.id]);
    expect(albumService.delete).not.toHaveBeenCalled();
  });

  it('fails space.delete apply when deleteContainers scope is revoked before apply', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForPlanReview,
      permissionPlanSnapshot: {
        ...expandedPermissionPlanSnapshot,
        writeScope: { ...expandedWriteScope, deleteContainers: false },
      },
    });
    const operation = makeOperation({
      id: newUuid(),
      planId: 'plan-id',
      type: AgentOperationType.SpaceDelete,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: spaceId,
      temporaryTargetId: null,
      payload: {},
    });
    const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(plan);
    planRepository.getCurrentBySessionId.mockResolvedValue(plan);
    planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
    planRepository.completeApply.mockImplementation((planId, updates) =>
      Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
    );
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));

    const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

    expect(result.status).toBe(AgentOperationApplyStatus.Failed);
    expect(result.failedOperationIds).toEqual([operation.id]);
    expect(sharedSpaceService.remove).not.toHaveBeenCalled();
  });
});
