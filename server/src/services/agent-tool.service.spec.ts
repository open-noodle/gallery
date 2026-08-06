import { BadRequestException } from '@nestjs/common';
import { AgentSession, AgentToolCall } from 'src/database';
import {
  AgentResolveAssetSearchFiltersToolRequestDto,
  AgentSearchAssetsToolRequestDto,
  AgentToolApprovalDto,
} from 'src/dtos/agent-tool.dto';
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  AssetOrder,
  AssetType,
  AssetVisibility,
} from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AgentSelectionHandleRepository } from 'src/repositories/agent-selection-handle.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DuplicateRepository } from 'src/repositories/duplicate.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { MapRepository } from 'src/repositories/map.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { AgentAssetSearchFilterResolverService } from 'src/services/agent-asset-search-filter-resolver.service';
import { AgentMcpRecoverableToolError } from 'src/services/agent-mcp-recoverable-tool-error';
import { AgentRunnerService } from 'src/services/agent-runner.service';
import { AgentToolService } from 'src/services/agent-tool.service';
import type { TripCandidate, TripCandidateAlbumSelection } from 'src/services/trip-candidate.service';
import { UserService } from 'src/services/user.service';
import { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
import {
  AgentAlbumDetail,
  AgentAlbumSummary,
  AgentAssetMediaReference,
  AgentAssetMetadata,
  AgentSpaceDetail,
  AgentSpaceSummary,
  AgentUserLookupResult,
} from 'src/types/agent-tool.types';
import { clearConfigCache } from 'src/utils/config';
import { AuthFactory } from 'test/factories/auth.factory';
import { newAccessRepositoryMock } from 'test/repositories/access.repository.mock';
import { newAssetRepositoryMock } from 'test/repositories/asset.repository.mock';
import { newUuid } from 'test/small.factory';
import { automock } from 'test/utils';

const now = new Date('2026-05-14T12:00:00.000Z');
const completedAt = new Date('2026-05-14T12:01:00.000Z');
const flushAsync = () => new Promise<void>((resolve) => setImmediate(resolve));
const emptyResultSize = () => ({
  returnedItems: 0,
  hasMore: false,
  nextPage: null,
  estimatedBytes: null,
  truncated: false,
  omittedFields: [],
});

const permissionPlanSnapshot: AgentPermissionPlanSnapshot = {
  read: { metadata: true, previews: false, originals: false },
  providerExposure: {
    metadata: true,
    previews: false,
    originals: false,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: false, locked: false },
  writeScope: {
    createAlbum: true,
    addAssets: true,
    updateDetails: true,
    setCover: true,
    addMembersToSpaces: false,
    removeMembersFromSpaces: false,
    updateSpaceMemberRoles: false,
  },
  limits: {
    maxAssetsPerToolCall: 100,
    maxAssetsPerSession: 1000,
    maxPreviewsPerToolCall: 0,
    maxOriginalsPerToolCall: 0,
    expiresInMinutes: 60,
  },
};

const makePlan = (overrides: Partial<AgentPermissionPlanSnapshot> = {}): AgentPermissionPlanSnapshot => ({
  ...permissionPlanSnapshot,
  ...overrides,
  read: { ...permissionPlanSnapshot.read, ...overrides.read },
  providerExposure: { ...permissionPlanSnapshot.providerExposure, ...overrides.providerExposure },
  assetScope: { ...permissionPlanSnapshot.assetScope, ...overrides.assetScope },
  writeScope: { ...permissionPlanSnapshot.writeScope, ...overrides.writeScope },
  limits: { ...permissionPlanSnapshot.limits, ...overrides.limits },
});

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

const makeToolCall = (overrides: Partial<AgentToolCall> = {}): AgentToolCall => {
  const sessionId = newUuid();
  const assetIds = [newUuid()];

  return {
    id: newUuid(),
    sessionId,
    toolName: AgentToolName.ReadAssetMetadata,
    status: AgentToolCallStatus.PendingApproval,
    approvalDecision: null,
    requestSummary: `Read metadata for ${assetIds.length} asset(s)`,
    responseSummary: null,
    redactedRequestMetadata: { assetIds },
    redactedResponseMetadata: null,
    dataClass: AgentToolDataClass.Metadata,
    assetCount: assetIds.length,
    albumCount: 0,
    providerSnapshot: {
      providerCredentialId: newUuid(),
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-5.1',
    },
    startedAt: now,
    completedAt: null,
    error: null,
    ...overrides,
  };
};

const makeMetadata = (
  id: string,
  overrides: Partial<AgentAssetMetadata> & { leaked?: string } = {},
): AgentAssetMetadata & { leaked?: string } => ({
  id,
  ownerId: newUuid(),
  type: AssetType.Image,
  originalFileName: `${id}.jpg`,
  localDateTime: now,
  fileCreatedAt: now,
  fileModifiedAt: now,
  isFavorite: false,
  visibility: AssetVisibility.Timeline,
  exifInfo: {
    dateTimeOriginal: now,
    city: 'Berlin',
    state: 'Berlin',
    country: 'Germany',
    make: 'Nikon',
    model: 'Zf',
    lensModel: '40mm',
    latitude: 52.52,
    longitude: 13.405,
    rating: 5,
  },
  tags: [{ id: newUuid(), value: 'travel', color: null }],
  qualityInfo: null,
  ...overrides,
});

const makeCurateHandle = (session: AgentSession, userId: string, assetIds: string[], overrides = {}) => ({
  id: newUuid(),
  sessionId: session.id,
  userId,
  sourceToolCallId: newUuid(),
  assetIds,
  assetCount: assetIds.length,
  sampleAssetIds: assetIds.slice(0, 25),
  expiresAt: new Date(now.getTime() + 60 * 60_000),
  createdAt: now,
  updateId: newUuid(),
  ...overrides,
});

const makeTripCandidate = (overrides: Partial<TripCandidate> = {}): TripCandidate => ({
  dedupeKey: 'trip:usa:new-york:2026-04-15:2026-04-16',
  title: 'Recent trip to New York, USA',
  subtitle: '8 photos over 2 days',
  countries: ['USA'],
  states: ['New York'],
  cities: ['New York'],
  takenAfter: new Date('2026-04-15T09:00:00.000Z'),
  takenBefore: new Date('2026-04-16T17:00:00.000Z'),
  assetCount: 8,
  albumAssetCount: 6,
  excludedDuplicateCount: 1,
  excludedStackChildCount: 1,
  dayCount: 2,
  score: 68,
  confidence: 'high',
  placeKey: 'usa:new-york',
  placeLabel: 'New York, USA',
  source: {
    kind: 'tripCandidate',
    dedupeKey: 'trip:usa:new-york:2026-04-15:2026-04-16',
    takenAfter: new Date('2026-04-15T09:00:00.000Z'),
    takenBefore: new Date('2026-04-16T17:00:00.000Z'),
    places: [{ country: 'USA', state: 'New York', city: 'New York' }],
    placeLabels: ['New York, USA'],
  },
  ...overrides,
});

const makeTripSelection = (
  assetIds: string[],
  overrides: Partial<TripCandidateAlbumSelection> = {},
): TripCandidateAlbumSelection => ({
  assetIds,
  assetCount: assetIds.length,
  albumAssetCount: assetIds.length,
  excludedDuplicateCount: 0,
  excludedStackChildCount: 0,
  hydrated: true,
  ...overrides,
});

const makeMediaReference = (
  assetId: string,
  overrides: Partial<AgentAssetMediaReference> = {},
): AgentAssetMediaReference => ({
  assetId,
  mediaUrl: `/api/assets/${assetId}/thumbnail?size=preview`,
  mimeType: 'image/jpeg',
  fileName: `${assetId}.jpg`,
  width: 1024,
  height: 768,
  ...overrides,
});

const makeAlbumSummary = (overrides: Partial<AgentAlbumSummary> = {}): AgentAlbumSummary => ({
  id: newUuid(),
  albumName: 'Trip',
  description: 'Summer trip',
  ownerId: newUuid(),
  assetCount: 1,
  startDate: now,
  endDate: now,
  albumThumbnailAssetId: null,
  ...overrides,
});

const makeAlbumDetail = (overrides: Partial<AgentAlbumDetail> = {}): AgentAlbumDetail => {
  const assetIds = overrides.assetIds ?? [newUuid()];
  return {
    ...makeAlbumSummary({ assetCount: assetIds.length, ...overrides }),
    assetIds,
    albumUsers: overrides.albumUsers ?? [],
  };
};

const makeSpaceRow = (overrides: Partial<AgentSpaceSummary> = {}) => ({
  id: newUuid(),
  name: 'Family',
  description: null,
  color: 'primary',
  createdById: newUuid(),
  assetCount: 0,
  memberCount: 0,
  thumbnailAssetId: null,
  thumbnailCropY: null,
  faceRecognitionEnabled: true,
  petsEnabled: true,
  lastActivityAt: null,
  recentAssetIds: [],
  createdAt: now,
  updatedAt: now,
  createId: newUuid(),
  updateId: newUuid(),
  ...overrides,
});

const makeSpaceMember = (overrides: Record<string, unknown> = {}) => ({
  spaceId: newUuid(),
  userId: newUuid(),
  role: 'viewer',
  joinedAt: now,
  showInTimeline: true,
  sharePersonMetadata: true,
  lastViewedAt: null,
  name: 'Sam',
  email: 'sam@example.com',
  profileImagePath: '',
  profileChangedAt: now,
  avatarColor: null,
  ...overrides,
});

const makeUserResult = (overrides: Partial<AgentUserLookupResult> = {}): AgentUserLookupResult => ({
  userId: newUuid(),
  name: 'Sam Example',
  email: 'sam@example.com',
  avatarColor: null,
  profileImagePath: null,
  ...overrides,
});

const makeUserResponse = (overrides: Record<string, unknown> = {}) => ({
  id: newUuid(),
  name: 'Sam Example',
  email: 'sam@example.com',
  avatarColor: null,
  profileImagePath: '',
  profileChangedAt: '2026-05-14T12:00:00.000Z',
  ...overrides,
});

describe(AgentToolService.name, () => {
  let sut: AgentToolService;
  let accessRepository: ReturnType<typeof newAccessRepositoryMock>;
  let assetRepository: ReturnType<typeof newAssetRepositoryMock>;
  let searchRepository: ReturnType<typeof automock<SearchRepository>>;
  let loggingRepository: ReturnType<typeof automock<LoggingRepository>>;
  let configRepository: ReturnType<typeof automock<ConfigRepository>>;
  let machineLearningRepository: ReturnType<typeof automock<MachineLearningRepository>>;
  let systemMetadataRepository: ReturnType<typeof automock<SystemMetadataRepository>>;
  let albumRepository: ReturnType<typeof automock<AlbumRepository>>;
  let sharedSpaceRepository: ReturnType<typeof automock<SharedSpaceRepository>>;
  let duplicateRepository: ReturnType<typeof automock<DuplicateRepository>>;
  let sessionRepository: ReturnType<typeof automock<AgentSessionRepository>>;
  let selectionHandleRepository: ReturnType<typeof automock<AgentSelectionHandleRepository>>;
  let toolCallRepository: ReturnType<typeof automock<AgentToolCallRepository>>;
  let agentRunnerService: ReturnType<typeof automock<AgentRunnerService>>;
  let assetSearchFilterResolverService: AgentAssetSearchFilterResolverService;
  let mapRepository: ReturnType<typeof automock<MapRepository>>;
  let personRepository: ReturnType<typeof automock<PersonRepository>>;
  let userService: { search: ReturnType<typeof vi.fn> };
  let tripCandidateService: {
    findRecentTripCandidates: ReturnType<typeof vi.fn>;
    materializeAlbumReadySelection: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    clearConfigCache();
    accessRepository = newAccessRepositoryMock();
    assetRepository = newAssetRepositoryMock();
    searchRepository = automock(SearchRepository, { args: [{} as never] });
    loggingRepository = automock(LoggingRepository, { args: [undefined, undefined], strict: false });
    configRepository = automock(ConfigRepository, { args: [] as never });
    machineLearningRepository = automock(MachineLearningRepository, { args: [loggingRepository] });
    systemMetadataRepository = automock(SystemMetadataRepository, { args: [{} as never] });
    albumRepository = automock(AlbumRepository, { args: [{} as never] });
    sharedSpaceRepository = automock(SharedSpaceRepository, { args: [{} as never] });
    duplicateRepository = automock(DuplicateRepository, { args: [{} as never] });
    sessionRepository = automock(AgentSessionRepository, { args: [{} as never] });
    selectionHandleRepository = automock(AgentSelectionHandleRepository, { args: [{} as never] });
    toolCallRepository = automock(AgentToolCallRepository, { args: [{} as never] });
    agentRunnerService = automock(AgentRunnerService, { args: [] as never });
    mapRepository = automock(MapRepository, { args: [undefined, undefined, { setContext: () => {} }, undefined] });
    personRepository = automock(PersonRepository, { args: [{} as never], strict: false });
    assetSearchFilterResolverService = new AgentAssetSearchFilterResolverService(
      searchRepository,
      albumRepository,
      sharedSpaceRepository,
    );
    userService = { search: vi.fn() };
    tripCandidateService = {
      findRecentTripCandidates: vi.fn(),
      materializeAlbumReadySelection: vi.fn(),
    };
    sut = new AgentToolService(
      accessRepository as unknown as AccessRepository,
      assetRepository as unknown as AssetRepository,
      searchRepository,
      loggingRepository,
      configRepository,
      machineLearningRepository,
      systemMetadataRepository,
      albumRepository,
      sharedSpaceRepository,
      duplicateRepository as unknown as DuplicateRepository,
      sessionRepository,
      selectionHandleRepository,
      toolCallRepository,
      agentRunnerService,
      userService as unknown as UserService,
      assetSearchFilterResolverService,
      mapRepository,
      personRepository,
    );
    (sut as unknown as { tripCandidateService: typeof tripCandidateService }).tripCandidateService =
      tripCandidateService;

    sessionRepository.update.mockImplementation((_userId, _id, dto) =>
      Promise.resolve(makeSession(dto as Partial<AgentSession>)),
    );
    toolCallRepository.create.mockImplementation((dto) =>
      Promise.resolve(
        makeToolCall({
          ...(dto as Partial<AgentToolCall>),
          id: newUuid(),
          startedAt: now,
          completedAt: (dto.completedAt as Date | null | undefined) ?? null,
        }),
      ),
    );
    toolCallRepository.transition.mockImplementation((_sessionId, _id, _expectedStatus, dto) =>
      Promise.resolve(makeToolCall({ ...(dto as Partial<AgentToolCall>), id: _id, sessionId: _sessionId })),
    );
    toolCallRepository.createWithSessionLimit.mockImplementation((dto) =>
      Promise.resolve({
        status: 'created',
        toolCall: makeToolCall({
          ...(dto as Partial<AgentToolCall>),
          id: newUuid(),
          startedAt: now,
          completedAt: (dto.completedAt as Date | null | undefined) ?? null,
        }),
      }),
    );
    toolCallRepository.transitionWithSessionLimit.mockImplementation((_sessionId, _id, _expectedStatus, dto) =>
      Promise.resolve({
        status: 'transitioned',
        toolCall: makeToolCall({ ...(dto as Partial<AgentToolCall>), id: _id, sessionId: _sessionId }),
      }),
    );
    toolCallRepository.getBySessionId.mockResolvedValue([]);
    toolCallRepository.getCountedAssetCountBySession.mockResolvedValue(0);
    toolCallRepository.getCountedAssetCountBySessionAndDataClass.mockResolvedValue(0);
    albumRepository.getAgentAlbums.mockResolvedValue([]);
    albumRepository.getAgentAlbumById.mockResolvedValue(null);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });
    searchRepository.getCameraModels.mockResolvedValue([]);
    searchRepository.getCameraLensModels.mockResolvedValue([]);
    searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });
    searchRepository.searchSmart.mockResolvedValue({ items: [], hasNextPage: false });
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
    configRepository.getEnv.mockReturnValue({ configFile: undefined } as never);
    systemMetadataRepository.get.mockResolvedValue(null);
    machineLearningRepository.encodeText.mockResolvedValue('[1, 2, 3]');
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([]);
    sharedSpaceRepository.getById.mockImplementation(() => Promise.resolve(void 0));
    sharedSpaceRepository.getMember.mockImplementation(() => Promise.resolve(void 0));
    sharedSpaceRepository.getMembers.mockResolvedValue([]);
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
    sharedSpaceRepository.getAssetCount.mockResolvedValue(0);
    sharedSpaceRepository.getRecentAssets.mockResolvedValue([]);
    sharedSpaceRepository.getAssetIdsInSpacePage.mockResolvedValue([]);
    agentRunnerService.resumeAfterToolApproval.mockResolvedValue();
    mapRepository.searchPlaces.mockResolvedValue([]);
    userService.search.mockResolvedValue([]);
  });

  it('findTripCandidates returns compact candidate summaries and same-session selection handles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid(), newUuid(), newUuid(), newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const candidate = makeTripCandidate();

    sessionRepository.getById.mockResolvedValue(session);
    tripCandidateService.findRecentTripCandidates.mockResolvedValue([candidate]);
    tripCandidateService.materializeAlbumReadySelection.mockResolvedValue(makeTripSelection(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));

    const result = await sut.findTripCandidates(auth, session.id, {
      placeHint: 'USA',
      lookbackDays: 180,
      maxCandidates: 3,
    });

    expect(tripCandidateService.findRecentTripCandidates).toHaveBeenCalledWith({
      ownerId: auth.user.id,
      placeHint: 'USA',
      lookbackDays: 180,
      maxCandidates: 3,
      targetDate: undefined,
    });
    expect(tripCandidateService.materializeAlbumReadySelection).toHaveBeenCalledWith(auth.user.id, candidate.source);
    expect(selectionHandleRepository.create).toHaveBeenCalledWith({
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: expect.any(String),
      assetIds,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.summary).toBe('Found 1 trip candidate matching "USA".');
    expect(result.recommendation).toEqual({
      action: 'use_top_candidate',
      candidateDedupeKey: candidate.dedupeKey,
      reason: 'The only readable trip candidate is high confidence.',
    });
    expect(result.candidates).toEqual([
      expect.objectContaining({
        dedupeKey: candidate.dedupeKey,
        title: candidate.title,
        assetCount: 8,
        albumAssetCount: 6,
        excludedDuplicateCount: 1,
        excludedStackChildCount: 1,
        placeLabels: ['New York, USA'],
        selectionHandle: expect.objectContaining({
          assetCount: 6,
          sourceRef: expect.stringMatching(/^asset-source:search:/),
        }),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(assetIds[0]);
    expect(result.candidates[0].selectionHandle).not.toHaveProperty('sampleAssetIds');
    vi.useRealTimers();
  });

  it('does not deny findTripCandidates when a candidate exceeds the per-tool asset limit (handle-based discovery)', async () => {
    // A real trip routinely has more photos than maxAssetsPerToolCall. Because it is
    // returned as a selection handle (compact summary, not raw assets to the model),
    // the per-call asset limit must not block discovery — otherwise large trips, the
    // common case, become impossible to album.
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const auth = AuthFactory.create();
    // 150 > fixture maxAssetsPerToolCall (100), but < maxAssetsPerSession (1000).
    const bigAssetIds = Array.from({ length: 150 }, () => newUuid());
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const candidate = makeTripCandidate();

    sessionRepository.getById.mockResolvedValue(session);
    tripCandidateService.findRecentTripCandidates.mockResolvedValue([candidate]);
    tripCandidateService.materializeAlbumReadySelection.mockResolvedValue(makeTripSelection(bigAssetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(bigAssetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(bigAssetIds));

    const result = await sut.findTripCandidates(auth, session.id, {
      placeHint: 'New York',
      lookbackDays: 180,
      maxCandidates: 3,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].selectionHandle.assetCount).toBe(150);
    // Still handle-based: no raw asset ids leak into the model-facing result.
    expect(JSON.stringify(result)).not.toContain(bigAssetIds[0]);
    vi.useRealTimers();
  });

  it('findTripCandidates returns empty success without creating handles when no candidate matches', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    tripCandidateService.findRecentTripCandidates.mockResolvedValue([]);

    const result = await sut.findTripCandidates(auth, session.id, {
      placeHint: 'Atlantis',
      lookbackDays: 180,
      maxCandidates: 3,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        summary: 'No trip candidates found matching "Atlantis".',
        candidates: [],
      }),
    );
    expect(selectionHandleRepository.create).not.toHaveBeenCalled();
  });

  it('findTripCandidates recommends the clear high-confidence top candidate after materialization', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const top = makeTripCandidate({ score: 80, confidence: 'high' });
    const runnerUp = makeTripCandidate({
      dedupeKey: 'trip:usa:boston:2026-04-20:2026-04-22',
      title: 'Recent trip to Boston, USA',
      score: 60,
      confidence: 'high',
    });

    sessionRepository.getById.mockResolvedValue(session);
    tripCandidateService.findRecentTripCandidates.mockResolvedValue([top, runnerUp]);
    tripCandidateService.materializeAlbumReadySelection.mockResolvedValue(makeTripSelection(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));

    const result = await sut.findTripCandidates(auth, session.id, {
      placeHint: 'USA',
      lookbackDays: 180,
      maxCandidates: 3,
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.recommendation).toEqual({
        action: 'use_top_candidate',
        candidateDedupeKey: top.dedupeKey,
        reason: 'The top trip candidate is high confidence and clearly ahead of the runner-up.',
      });
    }
  });

  it('findTripCandidates asks the user when candidates are close or not high confidence and returns none for empty results', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    tripCandidateService.materializeAlbumReadySelection.mockResolvedValue(makeTripSelection(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));

    tripCandidateService.findRecentTripCandidates.mockResolvedValueOnce([
      makeTripCandidate({ score: 80, confidence: 'high' }),
      makeTripCandidate({ dedupeKey: 'trip:usa:close', score: 70, confidence: 'high' }),
    ]);
    const closeResult = await sut.findTripCandidates(auth, session.id, {
      placeHint: 'USA',
      lookbackDays: 180,
      maxCandidates: 3,
    });
    expect(closeResult.status).toBe('success');
    if (closeResult.status === 'success') {
      expect(closeResult.recommendation).toMatchObject({ action: 'ask_user' });
    }

    tripCandidateService.findRecentTripCandidates.mockResolvedValueOnce([
      makeTripCandidate({ score: 90, confidence: 'medium' }),
    ]);
    const mediumResult = await sut.findTripCandidates(auth, session.id, { lookbackDays: 180, maxCandidates: 3 });
    expect(mediumResult.status).toBe('success');
    if (mediumResult.status === 'success') {
      expect(mediumResult.recommendation).toMatchObject({ action: 'ask_user' });
    }

    tripCandidateService.findRecentTripCandidates.mockResolvedValueOnce([]);
    const noneResult = await sut.findTripCandidates(auth, session.id, { lookbackDays: 180, maxCandidates: 3 });
    expect(noneResult.status).toBe('success');
    if (noneResult.status === 'success') {
      expect(noneResult.recommendation).toEqual({
        action: 'none',
        reason: 'No readable trip candidates matched the request.',
      });
    }
  });

  it('findTripCandidates drops fully unreadable materialized candidates before reserving counts or returning metadata', async () => {
    const auth = AuthFactory.create();
    const unreadableAssetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    tripCandidateService.findRecentTripCandidates.mockResolvedValue([
      makeTripCandidate({
        title: 'Hidden City',
        placeLabel: 'Hidden City, USA',
        source: {
          ...makeTripCandidate().source,
          placeLabels: ['Hidden City, USA'],
        },
      }),
    ]);
    tripCandidateService.materializeAlbumReadySelection.mockResolvedValue(makeTripSelection([unreadableAssetId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set());

    const result = await sut.findTripCandidates(auth, session.id, {
      placeHint: 'USA',
      lookbackDays: 180,
      maxCandidates: 3,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        summary: 'No trip candidates found matching "USA".',
        candidates: [],
      }),
    );
    expect(JSON.stringify(result)).not.toContain('Hidden City');
    expect(toolCallRepository.transitionWithSessionLimit).not.toHaveBeenCalled();
    expect(selectionHandleRepository.create).not.toHaveBeenCalled();
  });

  it('findTripCandidates filters unreadable materialized assets and aligns albumAssetCount with the handle count', async () => {
    const auth = AuthFactory.create();
    const readableAssetId = newUuid();
    const unreadableAssetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    tripCandidateService.findRecentTripCandidates.mockResolvedValue([makeTripCandidate({ albumAssetCount: 2 })]);
    tripCandidateService.materializeAlbumReadySelection.mockResolvedValue(
      makeTripSelection([readableAssetId, unreadableAssetId]),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([readableAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([readableAssetId]));

    const result = await sut.findTripCandidates(auth, session.id, { lookbackDays: 180, maxCandidates: 3 });

    expect(selectionHandleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: [readableAssetId] }),
    );
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.candidates[0]).toMatchObject({
        albumAssetCount: 1,
        selectionHandle: expect.objectContaining({ assetCount: 1 }),
      });
    }
  });

  it('findTripCandidates reserves the filtered asset count before creating handles and denies session overflow', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const deniedToolCall = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.FindTripCandidates,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      error: 'Reading these assets would exceed the session limit of 1000 asset(s)',
      assetCount: 2,
    });

    sessionRepository.getById.mockResolvedValue(session);
    tripCandidateService.findRecentTripCandidates.mockResolvedValue([makeTripCandidate()]);
    tripCandidateService.materializeAlbumReadySelection.mockResolvedValue(makeTripSelection(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    toolCallRepository.transitionWithSessionLimit.mockResolvedValue({
      status: 'limit-exceeded',
      toolCall: deniedToolCall,
    });

    const result = await sut.findTripCandidates(auth, session.id, { lookbackDays: 180, maxCandidates: 1 });

    expect(toolCallRepository.transitionWithSessionLimit).toHaveBeenCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Executing,
        assetCount: 2,
        albumCount: 0,
      }),
      AgentToolDataClass.Metadata,
      session.permissionPlanSnapshot.limits.maxAssetsPerSession,
    );
    expect(selectionHandleRepository.create).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: 'denied',
        reason: 'Session policy allows at most 1000 assets per session',
      }),
    );
  });

  it('findTripCandidates materializes multi-place trip candidate sources without converting them to search filters', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const source = {
      kind: 'tripCandidate' as const,
      dedupeKey: 'trip:france:paris+italy:rome:2026-04-15:2026-04-17',
      takenAfter: new Date('2026-04-15T00:00:00.000Z'),
      takenBefore: new Date('2026-04-17T23:59:59.000Z'),
      places: [
        { country: 'France', city: 'Paris' },
        { country: 'Italy', city: 'Rome' },
      ],
      placeLabels: ['Paris, France', 'Rome, Italy'],
    };
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    tripCandidateService.findRecentTripCandidates.mockResolvedValue([
      makeTripCandidate({ source, countries: ['France', 'Italy'], cities: ['Paris', 'Rome'] }),
    ]);
    tripCandidateService.materializeAlbumReadySelection.mockResolvedValue(makeTripSelection(assetIds));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));

    await sut.findTripCandidates(auth, session.id, { lookbackDays: 180, maxCandidates: 3 });

    expect(tripCandidateService.materializeAlbumReadySelection).toHaveBeenCalledWith(auth.user.id, source);
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('returns approval-required and creates a pending audit row for strict metadata reads', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id });
    const pending = makeToolCall({
      sessionId: session.id,
      requestSummary: 'Read basic metadata for 2 asset(s)',
      redactedRequestMetadata: { assetIds, detail: 'basic' },
      assetCount: 2,
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    toolCallRepository.createWithSessionLimit.mockResolvedValue({
      status: 'created',
      toolCall: pending,
    });

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'approval-required',
      toolCall: expect.objectContaining({
        id: pending.id,
        sessionId: session.id,
        status: AgentToolCallStatus.PendingApproval,
        approvalDecision: null,
        requestSummary: 'Read basic metadata for 2 asset(s)',
        responseSummary: null,
        dataClass: AgentToolDataClass.Metadata,
        assetCount: 2,
        albumCount: 0,
        completedAt: null,
        error: null,
      }),
    });
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.PendingApproval,
        approvalDecision: null,
        requestSummary: 'Read basic metadata for 2 asset(s)',
        responseSummary: null,
        redactedRequestMetadata: { assetIds, detail: 'basic' },
        redactedResponseMetadata: { resultSize: emptyResultSize() },
        dataClass: AgentToolDataClass.Metadata,
        assetCount: 2,
        albumCount: 0,
        providerSnapshot: {
          providerCredentialId: session.credentialSnapshot.id,
          providerType: AgentProviderType.OpenAI,
          label: 'OpenAI personal',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-5.1',
        },
        completedAt: null,
        error: null,
      }),
      expect.objectContaining({
        sessionId: session.id,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        redactedRequestMetadata: { assetIds, detail: 'basic' },
        redactedResponseMetadata: { resultSize: emptyResultSize() },
        error: 'Session policy allows at most 1000 assets per session',
      }),
      AgentToolDataClass.Metadata,
      session.permissionPlanSnapshot.limits.maxAssetsPerSession,
    );
    expect(toolCallRepository.create).not.toHaveBeenCalled();
    expect(toolCallRepository.getCountedAssetCountBySession).not.toHaveBeenCalled();
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.WaitingForToolApproval,
    });
  });

  it('accepts metadata reads while the session is waiting for plan review', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result.status).toBe('approval-required');
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        status: AgentToolCallStatus.PendingApproval,
        redactedRequestMetadata: { assetIds, detail: 'basic' },
        redactedResponseMetadata: { resultSize: emptyResultSize() },
      }),
      expect.objectContaining({
        sessionId: session.id,
        status: AgentToolCallStatus.Denied,
        redactedRequestMetadata: { assetIds, detail: 'basic' },
        redactedResponseMetadata: { resultSize: emptyResultSize() },
        error: 'Session policy allows at most 1000 assets per session',
      }),
      AgentToolDataClass.Metadata,
      session.permissionPlanSnapshot.limits.maxAssetsPerSession,
    );
    expect(toolCallRepository.create).not.toHaveBeenCalled();
  });

  it('creates a denied audit row when read.metadata is disabled', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({ read: { metadata: false, previews: false, originals: false } }),
    });
    const denied = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      error: 'Agent permission policy does not allow metadata reads',
      completedAt,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValue(denied);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Agent permission policy does not allow metadata reads',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied, error: denied.error }),
    });
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        redactedRequestMetadata: { assetIds, detail: 'basic' },
        completedAt: expect.any(Date),
        error: 'Agent permission policy does not allow metadata reads',
      }),
    );
    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
  });

  it('creates a denied audit row when providerExposure.metadata is disabled', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({
        providerExposure: {
          metadata: false,
          previews: false,
          originals: false,
          allowOriginalsForExternalProviders: false,
        },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({
        sessionId: session.id,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Agent provider exposure policy does not allow metadata reads',
        completedAt,
      }),
    );

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Agent provider exposure policy does not allow metadata reads',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
  });

  it('executes metadata reads immediately when approval mode is plan-only', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const asset = makeMetadata(assetIds[0]);

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([asset] as never);
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        redactedRequestMetadata: { assetIds },
        assetCount: 1,
      }),
    );

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
        assets: [expect.objectContaining({ id: assetIds[0] })],
      }),
    );
    expect(assetRepository.getAgentMetadataByIds).toHaveBeenCalledWith(assetIds);
  });

  it('returns and persists result-size telemetry for metadata reads', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);
    toolCallRepository.createWithSessionLimit.mockResolvedValue({
      status: 'created',
      toolCall: makeToolCall({ id: 'tool-call-1', sessionId: session.id, status: AgentToolCallStatus.Executing }),
    });
    toolCallRepository.transition.mockImplementation((_sessionId, _id, _expected, update) =>
      Promise.resolve(
        makeToolCall({
          id: 'tool-call-1',
          status: update.status,
          approvalDecision: update.approvalDecision,
          responseSummary: update.responseSummary,
          redactedResponseMetadata: update.redactedResponseMetadata,
          assetCount: update.assetCount ?? 1,
          completedAt: update.completedAt instanceof Date ? update.completedAt : null,
        }),
      ),
    );

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], fields: ['filename'] });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(result.resultSize).toMatchObject({
      returnedItems: 1,
      hasMore: false,
      nextPage: null,
      truncated: false,
      omittedFields: [],
    });
    expect(result.resultSize.estimatedBytes).toBeGreaterThan(0);
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      'tool-call-1',
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        redactedResponseMetadata: expect.objectContaining({
          assetIds: [assetId],
          resultSize: result.resultSize,
        }),
      }),
    );
  });

  it('stores empty result-size telemetry for approval-required read calls', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.Strict });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result.status).toBe('approval-required');
    expect(result.toolCall.resultSize).toEqual(emptyResultSize());
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        redactedResponseMetadata: { resultSize: emptyResultSize() },
      }),
      expect.any(Object),
      AgentToolDataClass.Metadata,
      expect.any(Number),
    );
  });

  it('persists a null result-size estimate when response size cannot be measured', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);
    vi.spyOn(
      sut as unknown as { estimateJsonBytes: (value: unknown) => number | null },
      'estimateJsonBytes',
    ).mockReturnValue(null);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], detail: 'basic' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(result.resultSize).toMatchObject({
      returnedItems: 1,
      estimatedBytes: null,
      truncated: false,
    });
    expect(toolCallRepository.transition).toHaveBeenLastCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        redactedResponseMetadata: expect.objectContaining({
          resultSize: expect.objectContaining({
            returnedItems: 1,
            estimatedBytes: null,
            truncated: false,
          }),
        }),
      }),
    );
  });

  it('estimates read-tool response size from the returned success envelope', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);
    const estimateSpy = vi.spyOn(
      sut as unknown as { estimateJsonBytes: (value: unknown) => number | null },
      'estimateJsonBytes',
    );

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], detail: 'basic' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(estimateSpy).toHaveBeenCalled();
    expect(estimateSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'success',
      toolCall: expect.objectContaining({
        id: expect.any(String),
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Returned basic metadata for 1 asset',
        resultSize: expect.objectContaining({
          returnedItems: 1,
          estimatedBytes: expect.any(Number),
          truncated: false,
        }),
      }),
      resultSize: expect.objectContaining({
        returnedItems: 1,
        estimatedBytes: expect.any(Number),
        truncated: false,
      }),
      summary: 'Returned basic metadata for 1 asset',
      assets: [expect.objectContaining({ id: assetId })],
    });
    const finalEstimatePayload = estimateSpy.mock.calls.at(-1)?.[0] as {
      resultSize: { estimatedBytes: number };
      toolCall: { resultSize: { estimatedBytes: number } };
    };
    expect(finalEstimatePayload.toolCall.resultSize.estimatedBytes).toBe(
      finalEstimatePayload.resultSize.estimatedBytes,
    );
  });

  it('returns basic metadata by default without filename, tags, location, or camera fields', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], detail: 'basic' });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        summary: 'Returned basic metadata for 1 asset',
        detail: 'basic',
        fields: ['type', 'dates'],
        assets: [
          expect.objectContaining({
            id: assetId,
            type: AssetType.Image,
            localDateTime: now,
            fileCreatedAt: now,
            fileModifiedAt: now,
            exifInfo: { dateTimeOriginal: now },
          }),
        ],
        toolCall: expect.objectContaining({ responseSummary: 'Returned basic metadata for 1 asset' }),
      }),
    );
    expect(result.status === 'success' ? result.assets[0] : undefined).not.toHaveProperty('originalFileName');
    expect(result.status === 'success' ? result.assets[0] : undefined).not.toHaveProperty('tags');
    expect(result.status === 'success' ? result.assets[0].exifInfo : undefined).not.toHaveProperty('city');
    expect(result.status === 'success' ? result.assets[0].exifInfo : undefined).not.toHaveProperty('make');
  });

  it('omits metadata row payloads when nested selected fields still exceed the budget', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);
    vi.spyOn(
      sut as unknown as { getReadToolResponseBudgetBytes: () => number },
      'getReadToolResponseBudgetBytes',
    ).mockReturnValue(64);
    vi.spyOn(sut as unknown as { estimateJsonBytes: (value: unknown) => number | null }, 'estimateJsonBytes')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(900)
      .mockReturnValueOnce(40);

    const result = await sut.readAssetMetadata(auth, session.id, {
      assetIds: [assetId],
      detail: 'allSafe',
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(result.assets).toEqual([]);
    expect(result.summary).toBe('Returned allSafe metadata for 0 assets; response was truncated by budget');
    expect(result.toolCall.responseSummary).toBe(
      'Returned allSafe metadata for 0 assets; response was truncated by budget',
    );
    expect(result.resultSize).toMatchObject({
      returnedItems: 0,
      hasMore: true,
      truncated: true,
      omittedFields: ['assets'],
    });
  });

  it('runs permission checks before truncating and never returns inaccessible search assets', async () => {
    const auth = AuthFactory.create();
    const visibleAssetId = newUuid();
    const hiddenAssetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({
      items: [{ id: visibleAssetId }, { id: hiddenAssetId }] as never,
      hasNextPage: false,
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([visibleAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([visibleAssetId]));

    const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 2, detail: 'ids' });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'denied',
        reason: 'One or more assets are not accessible',
      }),
    );
    if (result.status === 'success') {
      expect(JSON.stringify(result)).not.toContain(hiddenAssetId);
    }
  });

  it.each([
    ['type', { type: AssetType.Image }, ['originalFileName']],
    ['filename', { originalFileName: expect.any(String) }, ['tags']],
    ['favorite', { isFavorite: false }, ['visibility']],
    ['visibility', { visibility: AssetVisibility.Timeline }, ['isFavorite']],
    ['tags', { tags: [expect.objectContaining({ value: 'travel' })] }, ['originalFileName']],
    ['rating', { exifInfo: { rating: 5 } }, ['tags']],
    ['location', { exifInfo: expect.objectContaining({ city: 'Berlin', latitude: 52.52 }) }, ['originalFileName']],
    ['camera', { exifInfo: expect.objectContaining({ make: 'Nikon', model: 'Zf', lensModel: '40mm' }) }, ['tags']],
  ] as const)('returns only requested metadata field group %s', async (field, expectedFields, omittedFields) => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], fields: [field] });

    if (result.status !== 'success') {
      throw new Error(`Expected success response, got ${result.status}`);
    }

    expect(result.detail).toBeUndefined();
    expect(result.fields).toEqual([field]);
    expect(result.assets[0]).toEqual(expect.objectContaining({ id: assetId, ...expectedFields }));
    for (const omittedField of omittedFields) {
      expect(result.assets[0]).not.toHaveProperty(omittedField);
    }
  });

  it('merges overlapping exif field groups and preserves null metadata values', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(assetId, {
        exifInfo: {
          dateTimeOriginal: null,
          city: null,
          state: null,
          country: null,
          make: null,
          model: null,
          lensModel: null,
          latitude: null,
          longitude: null,
          rating: null,
        },
        tags: [],
      }),
    ] as never);

    const result = await sut.readAssetMetadata(auth, session.id, {
      assetIds: [assetId],
      fields: ['dates', 'location', 'camera', 'rating', 'tags'],
    });

    if (result.status !== 'success') {
      throw new Error(`Expected success response, got ${result.status}`);
    }

    expect(result.assets[0].exifInfo).toEqual({
      dateTimeOriginal: null,
      city: null,
      state: null,
      country: null,
      latitude: null,
      longitude: null,
      make: null,
      model: null,
      lensModel: null,
      rating: null,
    });
    expect(result.assets[0].tags).toEqual([]);
  });

  it.each([
    ['basic', ['type', 'dates']],
    ['descriptive', ['type', 'dates', 'filename', 'favorite', 'rating', 'tags', 'location']],
    ['technical', ['type', 'dates', 'filename', 'camera', 'rating', 'visibility', 'quality']],
    [
      'allSafe',
      ['type', 'dates', 'location', 'camera', 'tags', 'rating', 'filename', 'favorite', 'visibility', 'quality'],
    ],
  ] as const)('applies the %s metadata detail preset', async (detail, expectedFields) => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId, { leaked: 'ignore me' })] as never);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], detail });

    if (result.status !== 'success') {
      throw new Error(`Expected success response, got ${result.status}`);
    }

    expect(result.detail).toBe(detail);
    expect(result.fields).toEqual(expectedFields);
    expect(result.summary).toBe(`Returned ${detail} metadata for 1 asset`);
    expect(result.assets[0]).not.toHaveProperty('leaked');
  });

  it('returns every supported metadata field but no owner identity for allSafe detail', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const metadata = makeMetadata(assetId);
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([metadata] as never);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], detail: 'allSafe' });

    if (result.status !== 'success') {
      throw new Error(`Expected success response, got ${result.status}`);
    }

    expect(result.assets[0]).toEqual({
      id: assetId,
      type: metadata.type,
      originalFileName: metadata.originalFileName,
      localDateTime: metadata.localDateTime,
      fileCreatedAt: metadata.fileCreatedAt,
      fileModifiedAt: metadata.fileModifiedAt,
      isFavorite: metadata.isFavorite,
      visibility: metadata.visibility,
      exifInfo: metadata.exifInfo,
      tags: metadata.tags,
      qualityInfo: null,
    });
    expect(result.assets[0]).not.toHaveProperty('ownerId');
  });

  it('readAssetMetadata returns qualityInfo when fields includes quality and asset has a quality row', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(assetId, {
        qualityInfo: { sharpness: 82, exposure: 65, brightness: 70, quality: 75 },
      } as never),
    ] as never);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], fields: ['quality'] });

    if (result.status !== 'success') {
      throw new Error(`Expected success, got ${result.status}`);
    }

    expect(result.fields).toEqual(['quality']);
    expect(result.assets[0]).toEqual({
      id: assetId,
      qualityInfo: { sharpness: 82, exposure: 65, brightness: 70, quality: 75 },
    });
    expect(result.assets[0]).not.toHaveProperty('exifInfo');
    expect(result.assets[0]).not.toHaveProperty('tags');
    expect(result.assets[0]).not.toHaveProperty('originalFileName');
  });

  it('readAssetMetadata returns qualityInfo null when asset has no quality row', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(assetId, { qualityInfo: null } as never),
    ] as never);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], fields: ['quality'] });

    if (result.status !== 'success') {
      throw new Error(`Expected success, got ${result.status}`);
    }

    expect(result.assets[0]).toEqual({ id: assetId, qualityInfo: null });
  });

  it('readAssetMetadata includes qualityInfo in technical and allSafe presets', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(assetId, {
        qualityInfo: { sharpness: 90, exposure: 55, brightness: 60, quality: 80 },
      } as never),
    ] as never);

    for (const detail of ['technical', 'allSafe'] as const) {
      const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], detail });

      if (result.status !== 'success') {
        throw new Error(`Expected success for detail=${detail}, got ${result.status}`);
      }

      expect(result.assets[0]).toHaveProperty('qualityInfo');
      expect(result.assets[0].qualityInfo).toEqual({ sharpness: 90, exposure: 55, brightness: 60, quality: 80 });
    }
  });

  it('rejects large metadata reads before repository hydration when they exceed the per-tool limit', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1 } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds, detail: 'basic' });

    expect(result).toEqual({
      status: 'denied',
      reason:
        'Requested 2 assets, but this session allows 1 per metadata read. Request fewer asset IDs or split the metadata read into smaller batches.',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('denies mixed accessible and inaccessible metadata assets before returning partial rows', async () => {
    const auth = AuthFactory.create();
    const accessibleAssetId = newUuid();
    const inaccessibleAssetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([accessibleAssetId]));

    const result = await sut.readAssetMetadata(auth, session.id, {
      assetIds: [accessibleAssetId, inaccessibleAssetId],
      fields: ['filename'],
    });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more assets are not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('records failed compact metadata hydration instead of returning partial assets when rows are missing', async () => {
    const auth = AuthFactory.create();
    const firstAssetId = newUuid();
    const secondAssetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([firstAssetId, secondAssetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(firstAssetId)] as never);

    const result = await sut.readAssetMetadata(auth, session.id, {
      assetIds: [firstAssetId, secondAssetId],
      fields: ['filename'],
    });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more assets were not found during metadata read',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Failed }),
    });
    expect(result).not.toHaveProperty('assets');
  });

  it('allows shared-space metadata only when shared spaces are enabled', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], fields: ['filename'] });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        assets: [{ id: assetId, originalFileName: `${assetId}.jpg` }],
      }),
    );
    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
  });

  it('denies locked metadata unless permission plan and elevated auth both allow locked assets', async () => {
    const assetId = newUuid();
    const auth = AuthFactory.from().session({ hasElevatedPermission: false }).build();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: true } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], detail: 'basic' });

    expect(result).toEqual(
      expect.objectContaining({ status: 'denied', reason: 'One or more assets are not accessible' }),
    );
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([assetId]), false);
  });

  it('readAssetMetadata returns a recoverable wrong-domain error when assetIds contains a readable person id', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut
      .readAssetMetadata(auth, session.id, { assetIds: [personId], detail: 'basic' })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    expect((thrown as AgentMcpRecoverableToolError).content).toMatchObject({
      status: 'error',
      error: 'That value is a person ID, not an asset ID.',
      toolName: AgentToolName.ReadAssetMetadata,
      retryable: true,
      hint: 'Use exact asset IDs from a small inspected asset set. For search-backed writes, use assetSource.search or previousSearch.sourceRef instead of assetIds.',
      recovery: {
        kind: 'wrong_id_domain',
        field: 'assetIds',
        expectedDomain: 'asset',
        receivedDomain: 'person',
        instruction:
          'Use exact asset IDs from a small inspected asset set. For search-backed writes, use assetSource.search or previousSearch.sourceRef instead of assetIds.',
      },
    });
    expect(JSON.stringify((thrown as AgentMcpRecoverableToolError).content.recovery)).not.toContain(personId);
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('readAssetMetadata keeps unknown and cross-user assetIds on the generic inaccessible path', async () => {
    const auth = AuthFactory.create();
    const unknownOrCrossUserId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

    const result = await sut.readAssetMetadata(auth, session.id, {
      assetIds: [unknownOrCrossUserId],
      detail: 'basic',
    });

    expect(result).toEqual(
      expect.objectContaining({ status: 'denied', reason: 'One or more assets are not accessible' }),
    );
    expect(JSON.stringify(result)).not.toContain('wrong_id_domain');
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('denies tag metadata reads before repository hydration when metadata reads are disabled', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ read: { metadata: false, previews: false, originals: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], fields: ['tags'] });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Agent permission policy does not allow metadata reads',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'Strict + searchAssets',
      approvalMode: AgentApprovalMode.Strict,
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string) =>
        sut.searchAssets(auth, sessionId, { filters: {}, limit: 1 }),
      expectedStatus: 'approval-required',
    },
    {
      name: 'Strict + readAssetPreviews',
      approvalMode: AgentApprovalMode.Strict,
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetPreviews(auth, sessionId, { assetIds }),
      expectedStatus: 'approval-required',
    },
    {
      name: 'AskOnEscalation + searchAssets',
      approvalMode: AgentApprovalMode.AskOnEscalation,
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string) =>
        sut.searchAssets(auth, sessionId, { filters: {}, limit: 1 }),
      expectedStatus: 'success',
    },
    {
      name: 'AskOnEscalation + readAssetPreviews',
      approvalMode: AgentApprovalMode.AskOnEscalation,
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetPreviews(auth, sessionId, { assetIds }),
      expectedStatus: 'approval-required',
    },
    {
      name: 'PlanOnly + searchAssets',
      approvalMode: AgentApprovalMode.PlanOnly,
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string) =>
        sut.searchAssets(auth, sessionId, { filters: {}, limit: 1 }),
      expectedStatus: 'success',
    },
    {
      name: 'PlanOnly + readAssetPreviews',
      approvalMode: AgentApprovalMode.PlanOnly,
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetPreviews(auth, sessionId, { assetIds }),
      expectedStatus: 'success',
    },
  ])('$name follows the read-tool approval matrix', async ({ approvalMode, call, expectedStatus }) => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode,
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: false },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: false,
          allowOriginalsForExternalProviders: false,
        },
        limits: { ...permissionPlanSnapshot.limits, maxPreviewsPerToolCall: 5 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.searchAgentMetadata.mockResolvedValue({ assets: [makeMetadata(assetIds[0])], nextPage: null });
    assetRepository.getAgentPreviewReferencesByIds.mockResolvedValue([makeMediaReference(assetIds[0])]);

    const result = await call(auth, session.id, assetIds);

    expect(result.status).toBe(expectedStatus);
  });

  it('denies YOLO original reads for external providers unless explicitly allowed and skips access checks', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: true },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: true,
          allowOriginalsForExternalProviders: false,
        },
        limits: { ...permissionPlanSnapshot.limits, maxOriginalsPerToolCall: 5 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.readAssetOriginals(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Agent provider exposure policy only allows originals for local or self-hosted providers',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
    expect(assetRepository.getAgentOriginalReferencesByIds).not.toHaveBeenCalled();
  });

  it('allows original reads for OpenAICompatible credentials when policy allows originals and plan-only mode', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      credentialSnapshot: {
        id: newUuid(),
        providerType: AgentProviderType.OpenAICompatible,
        label: 'Local compatible',
        baseUrl: 'http://localhost:11434/v1',
        models: ['local-model'],
        defaultModel: 'local-model',
      },
      modelSnapshot: { providerCredentialId: newUuid(), model: 'local-model' },
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: true },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: true,
          allowOriginalsForExternalProviders: false,
        },
        limits: { ...permissionPlanSnapshot.limits, maxOriginalsPerToolCall: 5, maxOriginalsPerSession: 5 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentOriginalReferencesByIds.mockResolvedValue([makeMediaReference(assetIds[0])]);

    const result = await sut.readAssetOriginals(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      originals: [expect.objectContaining({ assetId: assetIds[0] })],
    });
  });

  it('auto-executes YOLO metadata reads with an executing audit row and completed transition', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: true },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: true,
          allowOriginalsForExternalProviders: true,
        },
        limits: { ...permissionPlanSnapshot.limits, maxPreviewsPerToolCall: 5, maxOriginalsPerToolCall: 5 },
      }),
    });
    const executing = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ReadAssetMetadata,
      status: AgentToolCallStatus.Executing,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds },
      dataClass: AgentToolDataClass.Metadata,
      assetCount: 1,
    });
    const completed = makeToolCall({
      ...executing,
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Returned metadata for 1 asset',
      redactedResponseMetadata: expect.objectContaining({ assetIds, resultSize: expect.any(Object) }),
      completedAt,
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetIds[0])] as never);
    toolCallRepository.createWithSessionLimit.mockResolvedValue({ status: 'created', toolCall: executing });
    toolCallRepository.transition.mockResolvedValue(completed);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        toolCall: expect.objectContaining({
          id: executing.id,
          status: AgentToolCallStatus.Completed,
          approvalDecision: AgentToolApprovalDecision.Approved,
          dataClass: AgentToolDataClass.Metadata,
          assetCount: 1,
          albumCount: 0,
        }),
        assets: [expect.objectContaining({ id: assetIds[0] })],
      }),
    );
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        redactedRequestMetadata: { assetIds, detail: 'basic' },
        dataClass: AgentToolDataClass.Metadata,
        assetCount: 1,
        albumCount: 0,
      }),
      expect.objectContaining({
        sessionId: session.id,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        redactedRequestMetadata: { assetIds, detail: 'basic' },
        error: 'Session policy allows at most 1000 assets per session',
      }),
      AgentToolDataClass.Metadata,
      session.permissionPlanSnapshot.limits.maxAssetsPerSession,
    );
    expect(toolCallRepository.create).not.toHaveBeenCalled();
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executing.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Returned basic metadata for 1 asset',
        redactedResponseMetadata: expect.objectContaining({ assetIds, resultSize: expect.any(Object) }),
        assetCount: 1,
        albumCount: 0,
      }),
    );
    expect(sessionRepository.update).not.toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.WaitingForToolApproval,
    });
  });

  it.each([
    {
      name: 'searchAssets',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, _assetId: string) =>
        sut.searchAssets(auth, sessionId, { filters: {}, limit: 1 }),
      arrange: (assetId: string) => {
        searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
        accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      },
      resultKey: 'selectionHandle',
      dataClass: AgentToolDataClass.Metadata,
      assetCount: 1,
      albumCount: 0,
    },
    {
      name: 'readAssetMetadata',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetId: string) =>
        sut.readAssetMetadata(auth, sessionId, { assetIds: [assetId] }),
      arrange: (assetId: string) => {
        assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);
        accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      },
      resultKey: 'assets',
      dataClass: AgentToolDataClass.Metadata,
      assetCount: 1,
      albumCount: 0,
    },
    {
      name: 'readAssetPreviews',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetId: string) =>
        sut.readAssetPreviews(auth, sessionId, { assetIds: [assetId] }),
      arrange: (assetId: string) => {
        assetRepository.getAgentPreviewReferencesByIds.mockResolvedValue([makeMediaReference(assetId)]);
        accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      },
      resultKey: 'previews',
      dataClass: AgentToolDataClass.Previews,
      assetCount: 1,
      albumCount: 0,
    },
    {
      name: 'readAssetOriginals',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetId: string) =>
        sut.readAssetOriginals(auth, sessionId, { assetIds: [assetId] }),
      arrange: (assetId: string) => {
        assetRepository.getAgentOriginalReferencesByIds.mockResolvedValue([makeMediaReference(assetId)]);
        accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
      },
      resultKey: 'originals',
      dataClass: AgentToolDataClass.Originals,
      assetCount: 1,
      albumCount: 0,
    },
    {
      name: 'listAlbums',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string) =>
        sut.listAlbums(auth, sessionId, {}),
      arrange: (_assetId: string, auth: ReturnType<typeof AuthFactory.create>) => {
        albumRepository.getAgentAlbums.mockResolvedValue([makeAlbumSummary({ ownerId: auth.user.id })]);
      },
      resultKey: 'albums',
      dataClass: AgentToolDataClass.Metadata,
      assetCount: 0,
      albumCount: 1,
    },
    {
      name: 'readAlbum',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetId: string, albumId: string) =>
        sut.readAlbum(auth, sessionId, { albumId }),
      arrange: (assetId: string, _auth: ReturnType<typeof AuthFactory.create>, albumId: string) => {
        accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
        albumRepository.getAgentAlbumById.mockResolvedValue(makeAlbumDetail({ id: albumId, assetIds: [assetId] }));
      },
      resultKey: 'album',
      dataClass: AgentToolDataClass.Metadata,
      assetCount: 1,
      albumCount: 1,
    },
  ])(
    '$name auto-executes in YOLO when policy allows without creating a pending approval row',
    async ({ call, arrange, resultKey, dataClass, assetCount, albumCount }) => {
      const auth = AuthFactory.create();
      const assetId = newUuid();
      const albumId = newUuid();
      const session = makeSession({
        userId: auth.user.id,
        approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
        credentialSnapshot: {
          id: newUuid(),
          providerType: AgentProviderType.OpenAICompatible,
          label: 'Local compatible',
          baseUrl: 'http://localhost:11434/v1',
          models: ['local-model'],
          defaultModel: 'local-model',
        },
        permissionPlanSnapshot: makePlan({
          read: { metadata: true, previews: true, originals: true },
          providerExposure: {
            metadata: true,
            previews: true,
            originals: true,
            allowOriginalsForExternalProviders: false,
          },
          limits: { ...permissionPlanSnapshot.limits, maxPreviewsPerToolCall: 5, maxOriginalsPerToolCall: 5 },
        }),
      });

      sessionRepository.getById.mockResolvedValue(session);
      arrange(assetId, auth, albumId);
      toolCallRepository.transition.mockImplementation((_sessionId, _id, _expectedStatus, dto) =>
        Promise.resolve(
          makeToolCall({
            ...(dto as Partial<AgentToolCall>),
            id: _id,
            sessionId: _sessionId,
            dataClass,
            assetCount,
            albumCount,
          }),
        ),
      );

      const result = await call(auth, session.id, assetId, albumId);

      expect(result.status).toBe('success');
      expect(result.toolCall).toEqual(
        expect.objectContaining({
          status: AgentToolCallStatus.Completed,
          approvalDecision: AgentToolApprovalDecision.Approved,
          dataClass,
          assetCount,
          albumCount,
        }),
      );
      expect(result).toHaveProperty(resultKey);
      expect(toolCallRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: AgentToolCallStatus.PendingApproval }),
      );
      expect(toolCallRepository.createWithSessionLimit).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: AgentToolCallStatus.PendingApproval }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(sessionRepository.update).not.toHaveBeenCalledWith(auth.user.id, session.id, {
        status: AgentSessionStatus.WaitingForToolApproval,
      });
    },
  );

  it.each([
    {
      name: 'metadata read disabled',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetMetadata(auth, sessionId, { assetIds }),
      permissionPlanSnapshot: makePlan({ read: { metadata: false, previews: true, originals: true } }),
      reason: 'Agent permission policy does not allow metadata reads',
      repositoryRead: () => assetRepository.getAgentMetadataByIds,
    },
    {
      name: 'metadata provider exposure disabled',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetMetadata(auth, sessionId, { assetIds }),
      permissionPlanSnapshot: makePlan({
        providerExposure: {
          metadata: false,
          previews: true,
          originals: true,
          allowOriginalsForExternalProviders: true,
        },
      }),
      reason: 'Agent provider exposure policy does not allow metadata reads',
      repositoryRead: () => assetRepository.getAgentMetadataByIds,
    },
    {
      name: 'preview read disabled',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetPreviews(auth, sessionId, { assetIds }),
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: false, originals: true },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: true,
          allowOriginalsForExternalProviders: true,
        },
      }),
      reason: 'Agent permission policy does not allow preview reads',
      repositoryRead: () => assetRepository.getAgentPreviewReferencesByIds,
    },
    {
      name: 'preview provider exposure disabled',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetPreviews(auth, sessionId, { assetIds }),
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: true },
        providerExposure: {
          metadata: true,
          previews: false,
          originals: true,
          allowOriginalsForExternalProviders: true,
        },
      }),
      reason: 'Agent provider exposure policy does not allow preview reads',
      repositoryRead: () => assetRepository.getAgentPreviewReferencesByIds,
    },
    {
      name: 'original read disabled',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetOriginals(auth, sessionId, { assetIds }),
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: false },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: true,
          allowOriginalsForExternalProviders: true,
        },
      }),
      reason: 'Agent permission policy does not allow original reads',
      repositoryRead: () => assetRepository.getAgentOriginalReferencesByIds,
    },
    {
      name: 'original provider exposure disabled',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetOriginals(auth, sessionId, { assetIds }),
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: true },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: false,
          allowOriginalsForExternalProviders: true,
        },
      }),
      reason: 'Agent provider exposure policy does not allow original reads',
      repositoryRead: () => assetRepository.getAgentOriginalReferencesByIds,
    },
  ])(
    'YOLO still denies policy/provider-exposure case: $name',
    async ({ call, permissionPlanSnapshot, reason, repositoryRead }) => {
      const auth = AuthFactory.create();
      const assetIds = [newUuid()];
      const session = makeSession({
        userId: auth.user.id,
        approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
        permissionPlanSnapshot,
      });

      sessionRepository.getById.mockResolvedValue(session);

      const result = await call(auth, session.id, assetIds);

      expect(result).toEqual({
        status: 'denied',
        reason,
        toolCall: expect.objectContaining({
          status: AgentToolCallStatus.Denied,
          approvalDecision: AgentToolApprovalDecision.Denied,
          error: reason,
        }),
      });
      expect(toolCallRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: AgentToolCallStatus.Denied,
          approvalDecision: AgentToolApprovalDecision.Denied,
          error: reason,
        }),
      );
      expect(repositoryRead()).not.toHaveBeenCalled();
    },
  );

  it('denies YOLO inaccessible assets before execution', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.DangerouslySkipPermissions });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetIds[0]]));

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more assets are not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(sessionRepository.update).not.toHaveBeenCalled();
  });

  it('denies YOLO per-tool asset limit before access checks', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      permissionPlanSnapshot: makePlan({ limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1 } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'denied',
      reason:
        'Requested 2 assets, but this session allows 1 per metadata read. Request fewer asset IDs or split the metadata read into smaller batches.',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
  });

  it('denies YOLO per-session asset limit through atomic executing creation after access checks', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      permissionPlanSnapshot: makePlan({ limits: { ...permissionPlanSnapshot.limits, maxAssetsPerSession: 2 } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    toolCallRepository.createWithSessionLimit.mockResolvedValue({
      status: 'limit-exceeded',
      toolCall: makeToolCall({
        sessionId: session.id,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        redactedRequestMetadata: { assetIds, detail: 'basic' },
        error: 'Session policy allows at most 2 assets per session',
        completedAt,
      }),
    });

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Session policy allows at most 2 assets per session',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set(assetIds), false);
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        redactedRequestMetadata: { assetIds, detail: 'basic' },
      }),
      expect.objectContaining({
        sessionId: session.id,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        redactedRequestMetadata: { assetIds, detail: 'basic' },
        error: 'Session policy allows at most 2 assets per session',
      }),
      AgentToolDataClass.Metadata,
      2,
    );
    expect(toolCallRepository.create).not.toHaveBeenCalled();
    expect(toolCallRepository.getCountedAssetCountBySession).not.toHaveBeenCalled();
  });

  it('uses atomic pending creation for strict preview reads with requested assets', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: false },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: false,
          allowOriginalsForExternalProviders: false,
        },
        limits: {
          ...permissionPlanSnapshot.limits,
          maxPreviewsPerToolCall: 5,
          maxPreviewsPerSession: 3,
        },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));

    const result = await sut.readAssetPreviews(auth, session.id, { assetIds });

    expect(result.status).toBe('approval-required');
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetPreviews,
        status: AgentToolCallStatus.PendingApproval,
        redactedRequestMetadata: { assetIds },
        dataClass: AgentToolDataClass.Previews,
        assetCount: assetIds.length,
      }),
      expect.objectContaining({
        sessionId: session.id,
        status: AgentToolCallStatus.Denied,
        redactedRequestMetadata: { assetIds },
        error: 'Session policy allows at most 3 assets per session',
      }),
      AgentToolDataClass.Previews,
      3,
    );
    expect(toolCallRepository.getCountedAssetCountBySessionAndDataClass).not.toHaveBeenCalled();
    expect(toolCallRepository.create).not.toHaveBeenCalled();
  });

  it('backfills legacy preview session limits to the preview per-tool limit during execution', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const legacyLimits = { ...permissionPlanSnapshot.limits, maxPreviewsPerToolCall: 5 };
    delete legacyLimits.maxPreviewsPerSession;
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: false },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: false,
          allowOriginalsForExternalProviders: false,
        },
        limits: legacyLimits,
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));

    await sut.readAssetPreviews(auth, session.id, { assetIds });

    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ error: 'Session policy allows at most 5 assets per session' }),
      AgentToolDataClass.Previews,
      5,
    );
  });

  it('backfills legacy original session limits to the original per-tool limit during execution', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const legacyLimits = { ...permissionPlanSnapshot.limits, maxOriginalsPerToolCall: 5 };
    delete legacyLimits.maxOriginalsPerSession;
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      credentialSnapshot: {
        id: newUuid(),
        providerType: AgentProviderType.OpenAICompatible,
        label: 'Local compatible',
        baseUrl: 'http://localhost:11434/v1',
        models: ['local-model'],
        defaultModel: 'local-model',
      },
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: true },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: true,
          allowOriginalsForExternalProviders: false,
        },
        limits: legacyLimits,
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));

    await sut.readAssetOriginals(auth, session.id, { assetIds });

    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ error: 'Session policy allows at most 5 assets per session' }),
      AgentToolDataClass.Originals,
      5,
    );
  });

  it('denies immediate preview execution through atomic creation without repository reads when the session limit is exceeded', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: false },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: false,
          allowOriginalsForExternalProviders: false,
        },
        limits: {
          ...permissionPlanSnapshot.limits,
          maxPreviewsPerToolCall: 5,
          maxPreviewsPerSession: 1,
        },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    toolCallRepository.createWithSessionLimit.mockResolvedValue({
      status: 'limit-exceeded',
      toolCall: makeToolCall({
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetPreviews,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        redactedRequestMetadata: { assetIds },
        dataClass: AgentToolDataClass.Previews,
        assetCount: assetIds.length,
        error: 'Session policy allows at most 1 assets per session',
        completedAt,
      }),
    });

    const result = await sut.readAssetPreviews(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Session policy allows at most 1 assets per session',
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        error: 'Session policy allows at most 1 assets per session',
      }),
    });
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        redactedRequestMetadata: { assetIds },
        dataClass: AgentToolDataClass.Previews,
        assetCount: assetIds.length,
      }),
      expect.objectContaining({
        sessionId: session.id,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        redactedRequestMetadata: { assetIds },
        error: 'Session policy allows at most 1 assets per session',
      }),
      AgentToolDataClass.Previews,
      1,
    );
    expect(toolCallRepository.getCountedAssetCountBySessionAndDataClass).not.toHaveBeenCalled();
    expect(assetRepository.getAgentPreviewReferencesByIds).not.toHaveBeenCalled();
  });

  it('shared-space-only scope checks space access, avoids album/partner checks, and filters locked ids when not elevated', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentLockedIds.mockResolvedValue(new Set());

    await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
    expect(accessRepository.asset.checkSpaceAccess).toHaveBeenCalledWith(auth.user.id, new Set(assetIds));
    expect(accessRepository.asset.checkAlbumAccess).not.toHaveBeenCalled();
    expect(accessRepository.asset.checkPartnerAccess).not.toHaveBeenCalled();
    expect(assetRepository.getAgentLockedIds).toHaveBeenCalledWith(new Set(assetIds));
  });

  it('denies YOLO locked shared-space assets without elevated locked access', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentLockedIds.mockResolvedValue(new Set(assetIds));

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more assets are not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
  });

  it('denies agent-hidden assets even when generic access checks allow the ids', async () => {
    const auth = AuthFactory.create();
    const visibleId = newUuid();
    const hiddenId = newUuid();
    const assetIds = [visibleId, hiddenId];
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([visibleId]));

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more assets are not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
  });

  it('allows locked shared-space assets when assetScope.locked is true and auth is elevated', async () => {
    const auth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: true } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set(assetIds));

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result.status).toBe('approval-required');
    expect(assetRepository.getAgentLockedIds).not.toHaveBeenCalled();
  });

  it('passes elevated flag for owned locked access only when policy and auth allow it', async () => {
    const elevatedAuth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
    const plainAuth = AuthFactory.create({ id: elevatedAuth.user.id });
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: elevatedAuth.user.id,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: true } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));

    await sut.readAssetMetadata(elevatedAuth, session.id, { assetIds });
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenLastCalledWith(
      elevatedAuth.user.id,
      new Set(assetIds),
      true,
    );

    await sut.readAssetMetadata(plainAuth, session.id, { assetIds });
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenLastCalledWith(
      elevatedAuth.user.id,
      new Set(assetIds),
      false,
    );
  });

  it('denies YOLO owned locked assets without elevated locked access', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: true } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());

    const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more assets are not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set(assetIds), false);
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('passes shared-space and locked scope to search only when permission plan and elevated auth allow it', async () => {
    const elevatedAuth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
    const runnerAuth = AuthFactory.from({ id: elevatedAuth.user.id }).session({ hasElevatedPermission: false }).build();
    const session = makeSession({
      userId: elevatedAuth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: true } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    await sut.searchAssets(elevatedAuth, session.id, { filters: {}, limit: 1 });
    expect(searchRepository.searchMetadata).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ userIds: [elevatedAuth.user.id] }),
    );

    await sut.searchAssets(runnerAuth, session.id, { filters: {}, limit: 1 });
    expect(searchRepository.searchMetadata).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ userIds: [elevatedAuth.user.id] }),
    );
  });

  it('returns shared-space search assets only when permission plan allows shared spaces', async () => {
    const auth = AuthFactory.create();
    const sharedAssetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([sharedAssetId]));
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: newUuid() }]);
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: sharedAssetId }] as never, hasNextPage: false });
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(sharedAssetId)] as never);

    const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 1 });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      summary: 'Created a selection handle for 1 asset',
      detail: 'handle',
      selectionHandle: expect.objectContaining({ assetCount: 1 }),
      returnedCount: 1,
      hasMore: false,
      nextPage: null,
    });
    expect(result).not.toHaveProperty('assetIds');
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ userIds: [], timelineSpaceIds: expect.any(Array) }),
    );
  });

  it('returns search page metadata and stores defaulted request metadata without absent query', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 10_000, maxAssetsPerSession: 10_000 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: true });
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

    const result = await sut.searchAssets(auth, session.id, {
      filters: { isFavorite: true },
      limit: 1,
    });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      summary: 'Created a selection handle for 1 asset; more results available on page 2',
      detail: 'handle',
      selectionHandle: expect.objectContaining({ assetCount: 1 }),
      returnedCount: 1,
      hasMore: true,
      nextPage: '2',
    });
    expect(result).not.toHaveProperty('assetIds');
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSummary: 'Search metadata assets (limit 1, handle)',
        redactedRequestMetadata: expect.not.objectContaining({
          query: expect.anything(),
        }),
      }),
      expect.any(Object),
      AgentToolDataClass.Metadata,
      expect.any(Number),
    );
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        redactedRequestMetadata: {
          mode: 'metadata',
          filters: { isFavorite: true },
          limit: 1,
          page: 1,
          order: 'desc',
          detail: 'handle',
          fields: [],
        },
      }),
      expect.any(Object),
      AgentToolDataClass.Metadata,
      expect.any(Number),
    );
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Completed,
        redactedResponseMetadata: expect.objectContaining({
          selectionHandleIds: [expect.any(String)],
          sourceRefs: [expect.stringMatching(/^asset-source:search:/)],
          selectionHandleAssetCount: 1,
          resultSize: expect.any(Object),
        }),
        assetCount: 1,
      }),
    );
    expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
  });

  it('executes later metadata search pages and makes continuation visible', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 10_000, maxAssetsPerSession: 10_000 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: true,
    });
    assetRepository.getAgentMetadataByIds.mockResolvedValue(assetIds.map((id) => makeMetadata(id)) as never);

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { isFavorite: true },
      limit: 2,
      page: 2,
      order: 'desc',
    });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Created a selection handle for 2 assets; more results available on page 3',
      }),
      summary: 'Created a selection handle for 2 assets; more results available on page 3',
      detail: 'handle',
      selectionHandle: expect.objectContaining({ assetCount: 2 }),
      returnedCount: 2,
      hasMore: true,
      nextPage: '3',
    });
    expect(result).not.toHaveProperty('assetIds');
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 2, size: 2 },
      expect.objectContaining({ isFavorite: true, orderDirection: AssetOrder.Desc, userIds: [auth.user.id] }),
    );
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        redactedRequestMetadata: {
          mode: 'metadata',
          filters: { isFavorite: true },
          limit: 2,
          page: 2,
          order: 'desc',
          detail: 'handle',
          fields: [],
        },
      }),
      expect.any(Object),
      AgentToolDataClass.Metadata,
      expect.any(Number),
    );
  });

  it('returns terminal search pages without continuation text', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

    const result = await sut.searchAssets(auth, session.id, {
      filters: { isNotInAlbum: true },
      limit: 50,
      page: 3,
      order: 'desc',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        returnedCount: 1,
        hasMore: false,
        nextPage: null,
        toolCall: expect.objectContaining({ responseSummary: 'Created a selection handle for 1 asset' }),
      }),
    );
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith({ page: 3, size: 50 }, expect.any(Object));
  });

  it('searchAssets passes withDeleted to the search repository when isTrashed is true', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });

    await sut.searchAssets(auth, session.id, { filters: { isTrashed: true }, limit: 10 });

    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ withDeleted: true }),
    );
  });

  it('searchAssets does not pass withDeleted to the search repository when isTrashed is false', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });

    await sut.searchAssets(auth, session.id, { filters: { isTrashed: false }, limit: 10 });

    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      expect.any(Object),
      expect.not.objectContaining({ withDeleted: expect.anything() }),
    );
  });

  it('searchAssets does not pass withDeleted to the search repository when isTrashed is absent (regression: default excludes trashed)', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });

    await sut.searchAssets(auth, session.id, { filters: {}, limit: 10 });

    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      expect.any(Object),
      expect.not.objectContaining({ withDeleted: expect.anything() }),
    );
  });

  it('uses contract defaults for empty service-level search requests', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 10_000, maxAssetsPerSession: 10_000 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.searchAssets(auth, session.id, {});

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      summary: 'Created a selection handle for 0 assets',
      detail: 'handle',
      selectionHandle: expect.objectContaining({ assetCount: 0 }),
      returnedCount: 0,
      hasMore: false,
      nextPage: null,
    });
    expect(result).not.toHaveProperty('assetIds');
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSummary: 'Search metadata assets (limit 100, handle)',
        redactedRequestMetadata: {
          mode: 'metadata',
          filters: {},
          limit: 100,
          page: 1,
          order: 'desc',
          detail: 'handle',
          fields: [],
        },
        assetCount: 100,
      }),
      expect.any(Object),
      AgentToolDataClass.Metadata,
      expect.any(Number),
    );
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith({ page: 1, size: 100 }, expect.any(Object));
    expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
  });

  it('searchAssets creates a handle by default without metadata hydration', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: true,
    });
    selectionHandleRepository.create.mockResolvedValue({
      id: newUuid(),
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds.slice(0, 25),
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updateId: newUuid(),
    });

    const result = await sut.searchAssets(auth, session.id, {});

    expect(selectionHandleRepository.create).toHaveBeenCalledWith({
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: expect.any(String),
      assetIds,
      expiresAt: expect.any(Date),
    });
    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        summary: 'Created a selection handle for 2 assets; more results available on page 2',
        detail: 'handle',
        returnedCount: 2,
        hasMore: true,
        nextPage: '2',
        selectionHandle: expect.objectContaining({ assetCount: 2 }),
      }),
    );
    expect(result).not.toHaveProperty('assetIds');
    expect(result).not.toHaveProperty('assets');
    expect(result).not.toHaveProperty('sample');
    expect(JSON.stringify(result)).not.toContain(assetIds[0]);
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith({ page: 1, size: 100 }, expect.any(Object));
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('searchAssets supports 1000-result handle-only pages without prompt-sized payloads', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const auth = AuthFactory.create();
    const assetIds = Array.from({ length: 1000 }, () => newUuid());
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1000, maxAssetsPerSession: 1000 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: false,
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
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

    const result = await sut.searchAssets(auth, session.id, { filters: { country: 'USA' }, limit: 1000 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith({ page: 1, size: 1000 }, expect.any(Object));
    expect(result.detail).toBe('handle');
    expect(result.selectionHandle.assetCount).toBe(1000);
    expect(result).not.toHaveProperty('assetIds');
    expect(result).not.toHaveProperty('assets');
    expect(result).not.toHaveProperty('sample');
    expect(JSON.stringify(result)).not.toContain(assetIds[0]);
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('searchAssets still rejects handle pages above the session per-tool limit', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1000, maxAssetsPerSession: 1000 },
      }),
    });
    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.searchAssets(auth, session.id, { filters: { country: 'USA' }, limit: 1001 });

    expect(result.status).toBe('denied');
    if (result.status !== 'denied') {
      return;
    }
    expect(result.reason).toBe('Requested asset count exceeds per-tool limit');
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('searchAssets ignores createSelectionHandle false and still returns a handle', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const handle = {
      id: newUuid(),
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds: [assetId],
      assetCount: 1,
      sampleAssetIds: [assetId],
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updateId: newUuid(),
    };
    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    selectionHandleRepository.create.mockResolvedValue(handle);

    const result = await sut.searchAssets(auth, session.id, {
      filters: {},
      limit: 1,
      detail: 'ids',
      createSelectionHandle: false,
    });

    expect(selectionHandleRepository.create).toHaveBeenCalled();
    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(result.detail).toBe('handle');
    expect(result.selectionHandle.id).toBe(handle.id);
    expect(result).not.toHaveProperty('assetIds');
    expect(JSON.stringify(result)).not.toContain(assetId);
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSummary: 'Search metadata assets (limit 1, ids)',
        redactedRequestMetadata: expect.objectContaining({ detail: 'ids' }),
      }),
      expect.any(Object),
      AgentToolDataClass.Metadata,
      expect.any(Number),
    );
    const completedMetadata = toolCallRepository.transition.mock.calls.find(
      ([_sessionId, _toolCallId, fromStatus]) => fromStatus === AgentToolCallStatus.Executing,
    )?.[3]?.redactedResponseMetadata;
    expect(completedMetadata).toEqual(
      expect.objectContaining({
        selectionHandleIds: [handle.id],
        sourceRefs: [`asset-source:search:${handle.id}`],
        selectionHandleAssetCount: 1,
      }),
    );
    expect(completedMetadata).not.toHaveProperty('assetIds');
  });

  it('searchAssets creates handles for zero-result searches', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const handle = {
      id: newUuid(),
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds: [],
      assetCount: 0,
      sampleAssetIds: [],
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updateId: newUuid(),
    };
    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });
    selectionHandleRepository.create.mockResolvedValue(handle);

    const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 10 });

    expect(selectionHandleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: [], sessionId: session.id, userId: auth.user.id }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        summary: 'Created a selection handle for 0 assets',
        detail: 'handle',
        returnedCount: 0,
        selectionHandle: expect.objectContaining({ assetCount: 0 }),
      }),
    );
  });

  it('does not truncate when the estimated result is exactly at the read-tool budget', async () => {
    const auth = AuthFactory.create();
    const firstAssetId = newUuid();
    const secondAssetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({
      items: [firstAssetId, secondAssetId].map((id) => ({ id })) as never,
      hasNextPage: false,
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([firstAssetId, secondAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([firstAssetId, secondAssetId]));
    vi.spyOn(
      sut as unknown as { getReadToolResponseBudgetBytes: () => number },
      'getReadToolResponseBudgetBytes',
    ).mockReturnValue(128);
    vi.spyOn(
      sut as unknown as { estimateJsonBytes: (value: unknown) => number | null },
      'estimateJsonBytes',
    ).mockReturnValue(128);

    const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 2, detail: 'ids' });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.resultSize.truncated).toBe(false);
      expect(result.selectionHandle.assetCount).toBe(2);
      expect(result).not.toHaveProperty('assetIds');
    }
  });

  it('truncates search asset IDs after paging while preserving returned order when one item exceeds the budget', async () => {
    const auth = AuthFactory.create();
    const firstAssetId = newUuid();
    const secondAssetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({
      items: [firstAssetId, secondAssetId].map((id) => ({ id })) as never,
      hasNextPage: false,
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([firstAssetId, secondAssetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([firstAssetId, secondAssetId]));
    vi.spyOn(
      sut as unknown as { getReadToolResponseBudgetBytes: () => number },
      'getReadToolResponseBudgetBytes',
    ).mockReturnValue(120);
    vi.spyOn(sut as unknown as { estimateJsonBytes: (value: unknown) => number | null }, 'estimateJsonBytes')
      .mockReturnValueOnce(121)
      .mockReturnValue(100);

    const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 2, page: 1, detail: 'ids' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(result).not.toHaveProperty('assetIds');
    expect(result.returnedCount).toBe(2);
    expect(result.resultSize).toMatchObject({
      returnedItems: 2,
      truncated: false,
      omittedFields: [],
    });
    expect(result.summary).toBe('Created a selection handle for 2 assets');
    expect(result.toolCall.responseSummary).toBe('Created a selection handle for 2 assets');
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(
      auth.user.id,
      new Set([firstAssetId, secondAssetId]),
      false,
    );
  });

  it('searchAssets creates a selection handle and returns only compact sample ids when requested', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const auth = AuthFactory.create();
    const assetIds = Array.from({ length: 60 }, () => newUuid());
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1000, maxAssetsPerSession: 1000 },
      }),
    });
    const handle = {
      id: newUuid(),
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds.slice(0, 25),
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updateId: newUuid(),
    };
    const sourceRef = `asset-source:search:${handle.id}` as const;
    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: false,
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    selectionHandleRepository.create.mockResolvedValue(handle);
    toolCallRepository.createWithSessionLimit.mockResolvedValue({
      status: 'created',
      toolCall: makeToolCall({
        id: handle.sourceToolCallId!,
        sessionId: session.id,
        toolName: AgentToolName.SearchAssets,
      }),
    });
    toolCallRepository.transitionWithSessionLimit.mockResolvedValue({
      status: 'transitioned',
      toolCall: makeToolCall({
        id: handle.sourceToolCallId!,
        sessionId: session.id,
        toolName: AgentToolName.SearchAssets,
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Created a selection handle for 60 assets; returned 5 sample asset ids',
        completedAt,
        redactedResponseMetadata: {
          selectionHandleIds: [handle.id],
          sourceRefs: [sourceRef],
          selectionHandleAssetCount: 60,
          resultSize: expect.any(Object),
        },
      }),
    });

    const result = await sut.searchAssets(auth, session.id, {
      filters: {},
      limit: 60,
      createSelectionHandle: true,
      sampleSize: 5,
    });

    expect(selectionHandleRepository.create).toHaveBeenCalledWith({
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: handle.sourceToolCallId,
      assetIds,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.selectionHandle).toMatchObject({
        id: handle.id,
        sourceRef,
        assetCount: 60,
        sourceToolCallId: handle.sourceToolCallId,
        expiresAt: handle.expiresAt,
      });
      expect(result.selectionHandle).not.toHaveProperty('sampleAssetIds');
      expect(result.selectionHandle?.sourceRef).not.toBe(handle.id);
      expect(result.selectionHandle?.sourceRef).toMatch(/^asset-source:search:/);
      expect(toolCallRepository.transition).toHaveBeenCalledWith(
        session.id,
        handle.sourceToolCallId,
        AgentToolCallStatus.Executing,
        expect.objectContaining({
          redactedResponseMetadata: expect.objectContaining({
            selectionHandleIds: [handle.id],
            sourceRefs: [sourceRef],
            selectionHandleAssetCount: 60,
          }),
        }),
      );
      const completedMetadata = toolCallRepository.transition.mock.calls.find(
        ([_sessionId, _toolCallId, fromStatus]) => fromStatus === AgentToolCallStatus.Executing,
      )?.[3]?.redactedResponseMetadata;
      expect(completedMetadata).not.toHaveProperty('assetIds');
      expect(completedMetadata).not.toHaveProperty('selectionHandleSampleAssetIds');
      expect(JSON.stringify(completedMetadata)).not.toContain(assetIds[0]);
      expect(result).not.toHaveProperty('assetIds');
      expect(JSON.stringify(result)).not.toContain(assetIds[0]);
    }
    vi.useRealTimers();
  });

  it('searchAssets rejects broad searches when the previous resolver returned people filters that were omitted', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const otherPersonId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1000, maxAssetsPerSession: 1000 },
      }),
    });
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getBySessionId.mockResolvedValue([
      makeToolCall({
        sessionId: session.id,
        toolName: AgentToolName.ResolveAssetSearchFilters,
        status: AgentToolCallStatus.Completed,
        redactedRequestMetadata: { people: ['Pierre', 'Aurelia'] },
        redactedResponseMetadata: {
          personIds: [personId, otherPersonId],
          resultSize: expect.any(Object),
        },
        completedAt,
      }),
    ]);

    const result = await sut.searchAssets(auth, session.id, {
      filters: {
        country: 'South Africa',
        takenAfter: new Date('2026-01-01T00:00:00.000Z'),
        takenBefore: new Date('2026-01-31T23:59:59.999Z'),
      },
      detail: 'ids',
      limit: 50,
      createSelectionHandle: true,
    });

    expect(result.status).toBe('denied');
    if (result.status !== 'denied') {
      throw new Error('Expected searchAssets to reject omitted resolved people filters');
    }
    expect(result.reason).toContain('resolved people filters');
    expect(result.reason).toContain('personIds');
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('searchAssets accepts searches that copy the previous resolver people filters', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const otherPersonId = newUuid();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1000, maxAssetsPerSession: 1000 },
      }),
    });
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getBySessionId.mockResolvedValue([
      makeToolCall({
        sessionId: session.id,
        toolName: AgentToolName.ResolveAssetSearchFilters,
        status: AgentToolCallStatus.Completed,
        redactedResponseMetadata: { personIds: [personId, otherPersonId] },
        completedAt,
      }),
    ]);
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId, otherPersonId]));
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

    const result = await sut.searchAssets(auth, session.id, {
      filters: { personIds: [personId, otherPersonId] },
      detail: 'ids',
      limit: 50,
    });

    expect(result.status).toBe('success');
    expect(searchRepository.searchMetadata).toHaveBeenCalled();
  });

  it('searchAssets does not apply an old resolver guard after a successful search', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1000, maxAssetsPerSession: 1000 },
      }),
    });
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getBySessionId.mockResolvedValue([
      makeToolCall({
        sessionId: session.id,
        toolName: AgentToolName.SearchAssets,
        status: AgentToolCallStatus.Completed,
        completedAt,
      }),
      makeToolCall({
        sessionId: session.id,
        toolName: AgentToolName.ResolveAssetSearchFilters,
        status: AgentToolCallStatus.Completed,
        redactedResponseMetadata: { personIds: [personId] },
        completedAt,
      }),
    ]);
    searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });

    const result = await sut.searchAssets(auth, session.id, {
      filters: { country: 'South Africa' },
      detail: 'ids',
      limit: 50,
    });

    expect(result.status).toBe('success');
    expect(searchRepository.searchMetadata).toHaveBeenCalled();
  });

  it('searchAssets creates handles from budget-truncated search output without truncating handle counts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const auth = AuthFactory.create();
    const assetIds = Array.from({ length: 500 }, () => newUuid());
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1000, maxAssetsPerSession: 1000 },
      }),
    });
    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: true,
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
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
    vi.spyOn(
      sut as unknown as { getReadToolResponseBudgetBytes: () => number },
      'getReadToolResponseBudgetBytes',
    ).mockReturnValue(900);

    const result = await sut.searchAssets(auth, session.id, {
      filters: {},
      limit: 500,
      createSelectionHandle: true,
      sampleSize: 25,
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.selectionHandle.assetCount).toBe(500);
      const returnedHandle = result.selectionHandle;
      expect(returnedHandle.sourceRef).toBe(`asset-source:search:${returnedHandle.id}`);
      expect(result.resultSize.truncated).toBe(false);
      expect(result.resultSize.omittedFields).toEqual([]);
      expect(result).not.toHaveProperty('assetIds');
      expect(JSON.stringify(result)).not.toContain(assetIds[0]);
    }
    vi.useRealTimers();
  });

  it('searchAssets with a selection handle only hydrates metadata for compact samples', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const auth = AuthFactory.create();
    const assetIds = Array.from({ length: 60 }, () => newUuid());
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1000, maxAssetsPerSession: 1000 },
      }),
    });
    const handle = {
      id: newUuid(),
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds.slice(0, 25),
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updateId: newUuid(),
    };
    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: false,
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    selectionHandleRepository.create.mockResolvedValue(handle);
    assetRepository.getAgentMetadataByIds.mockResolvedValue(
      assetIds
        .slice(0, 3)
        .map((id, index) => makeMetadata(id, { originalFileName: `sample-${index + 1}.jpg` })) as never,
    );
    toolCallRepository.createWithSessionLimit.mockResolvedValue({
      status: 'created',
      toolCall: makeToolCall({
        id: handle.sourceToolCallId!,
        sessionId: session.id,
        toolName: AgentToolName.SearchAssets,
      }),
    });
    toolCallRepository.transitionWithSessionLimit.mockResolvedValue({
      status: 'transitioned',
      toolCall: makeToolCall({
        id: handle.sourceToolCallId!,
        sessionId: session.id,
        toolName: AgentToolName.SearchAssets,
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Created a selection handle for 60 assets; returned 3 sample asset ids',
        completedAt,
      }),
    });

    const result = await sut.searchAssets(auth, session.id, {
      filters: {},
      limit: 60,
      detail: 'metadata',
      createSelectionHandle: true,
      sampleSize: 3,
    });

    expect(assetRepository.getAgentMetadataByIds).toHaveBeenCalledWith(assetIds.slice(0, 3));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.selectionHandle?.assetCount).toBe(60);
      expect(result.selectionHandle?.sourceRef).toBe(`asset-source:search:${handle.id}`);
      expect(result.selectionHandle?.expiresAt).toEqual(handle.expiresAt);
      expect(result).not.toHaveProperty('assetIds');
      expect(result).not.toHaveProperty('assets');
      expect(result.sample?.items.map((asset) => asset.itemRef)).toEqual(['item:001', 'item:002', 'item:003']);
      expect(JSON.stringify(result)).not.toContain(assetIds[0]);
    }
    vi.useRealTimers();
  });

  it('searchAssets summary detail preserves sourceRef when a selection handle is created', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const auth = AuthFactory.create();
    const assetIds = Array.from({ length: 4 }, () => newUuid());
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const handle = {
      id: newUuid(),
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: newUuid(),
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds.slice(0, 4),
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updateId: newUuid(),
    };
    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: false,
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
    selectionHandleRepository.create.mockResolvedValue(handle);
    assetRepository.getAgentMetadataByIds.mockResolvedValue(
      assetIds.slice(0, 2).map((id) => makeMetadata(id)) as never,
    );

    const result = await sut.searchAssets(auth, session.id, {
      filters: {},
      detail: 'summary',
      limit: 4,
      createSelectionHandle: true,
      sampleSize: 2,
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.selectionHandle?.sourceRef).toBe(`asset-source:search:${handle.id}`);
      expect(result.selectionHandle?.assetCount).toBe(4);
      expect(result).not.toHaveProperty('assetIds');
      expect(result.sample?.items.map((asset) => asset.itemRef)).toEqual(['item:001', 'item:002']);
      expect(JSON.stringify(result)).not.toContain(assetIds[0]);
    }
    vi.useRealTimers();
  });

  it('searchAssets returns sourceRef even when no selection handle is requested', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: false,
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));

    const result = await sut.searchAssets(auth, session.id, { filters: {}, detail: 'ids', limit: 2 });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.selectionHandle.sourceRef).toMatch(/^asset-source:search:/);
      expect(result).not.toHaveProperty('assetIds');
    }
  });

  it('returns field-selected summary samples and caps sampleSize to returned ids', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: false,
    });
    assetRepository.getAgentMetadataByIds.mockResolvedValue(assetIds.map((id) => makeMetadata(id)) as never);

    const result = await sut.searchAssets(auth, session.id, {
      filters: {},
      limit: 2,
      detail: 'summary',
      fields: ['dates', 'location'],
      sampleSize: 5,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        summary: 'Created a selection handle for 2 assets with 2 samples',
        detail: 'summary',
        returnedCount: 2,
        sample: {
          sampleSize: 2,
          items: [
            expect.objectContaining({
              itemRef: 'item:001',
              localDateTime: now,
              exifInfo: expect.objectContaining({ city: 'Berlin', state: 'Berlin', country: 'Germany' }),
            }),
            expect.objectContaining({ itemRef: 'item:002' }),
          ],
        },
      }),
    );
    expect(result.status === 'success' ? result.sample?.items[0] : undefined).not.toHaveProperty('id');
    expect(JSON.stringify(result)).not.toContain(assetIds[0]);
    expect(assetRepository.getAgentMetadataByIds).toHaveBeenCalledWith(assetIds);
  });

  it('omits summary samples when sampleSize is zero', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: false,
    });

    const result = await sut.searchAssets(auth, session.id, {
      filters: {},
      limit: 2,
      detail: 'summary',
      sampleSize: 0,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        summary: 'Created a selection handle for 2 assets',
        detail: 'summary',
        returnedCount: 2,
      }),
    );
    expect(result).not.toHaveProperty('sample');
    expect(JSON.stringify(result)).not.toContain(assetIds[0]);
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('keeps summary samples handle-local itemRef only when no fields are requested', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: false,
    });
    assetRepository.getAgentMetadataByIds.mockResolvedValue(assetIds.map((id) => makeMetadata(id)) as never);

    const result = await sut.searchAssets(auth, session.id, {
      filters: {},
      limit: 1,
      detail: 'summary',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        summary: 'Created a selection handle for 1 asset with 1 sample',
        detail: 'summary',
        sample: { sampleSize: 1, items: [{ itemRef: 'item:001' }] },
      }),
    );
    expect(JSON.stringify(result)).not.toContain(assetIds[0]);
  });

  it('returns full metadata rows only when metadata detail is requested without fields', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const metadata = makeMetadata(assetId, { originalFileName: 'berlin.jpg' });
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
    assetRepository.getAgentMetadataByIds.mockResolvedValue([metadata] as never);

    const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 1, detail: 'metadata' });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        summary: 'Created a selection handle for 1 asset with 1 sample',
        detail: 'metadata',
        sample: {
          sampleSize: 1,
          items: [expect.objectContaining({ itemRef: 'item:001', originalFileName: 'berlin.jpg' })],
        },
      }),
    );
    expect(result).not.toHaveProperty('assets');
    expect(JSON.stringify(result)).not.toContain(assetId);
  });

  it('returns field-selected metadata rows and omits unrequested fields', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(assetId, { originalFileName: 'berlin.jpg' }),
    ] as never);

    const result = await sut.searchAssets(auth, session.id, {
      filters: {},
      limit: 1,
      detail: 'metadata',
      fields: ['filename', 'favorite'],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        detail: 'metadata',
        sample: {
          sampleSize: 1,
          items: [{ itemRef: 'item:001', originalFileName: 'berlin.jpg', isFavorite: false }],
        },
      }),
    );
    expect(result.status === 'success' ? result.sample?.items[0] : undefined).not.toHaveProperty('id');
    expect(result.status === 'success' ? result.sample?.items[0] : undefined).not.toHaveProperty('exifInfo');
    expect(result.status === 'success' ? result.sample?.items[0] : undefined).not.toHaveProperty('tags');
  });

  it('denies inaccessible compact search results before hydration or sampling', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });

    const result = await sut.searchAssets(auth, session.id, { detail: 'summary', fields: ['location'] });

    expect(result).toEqual(
      expect.objectContaining({ status: 'denied', reason: 'One or more assets are not accessible' }),
    );
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('denies field-selected metadata searches when metadata reads are disabled', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ read: { metadata: false, previews: false, originals: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.searchAssets(auth, session.id, {
      filters: {},
      detail: 'metadata',
      fields: ['filename'],
    });

    expect(result).toEqual(
      expect.objectContaining({ status: 'denied', reason: 'Agent permission policy does not allow metadata reads' }),
    );
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('keeps broad all-assets requests bounded and exposes hasMore guidance', async () => {
    const auth = AuthFactory.create();
    const assetIds = Array.from({ length: 3 }, () => newUuid());
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 10_000, maxAssetsPerSession: 10_000 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    searchRepository.searchMetadata.mockResolvedValue({
      items: assetIds.map((id) => ({ id })) as never,
      hasNextPage: true,
    });
    assetRepository.getAgentMetadataByIds.mockResolvedValue(assetIds.map((id) => makeMetadata(id)) as never);

    const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 3 });

    expect(result).toEqual(
      expect.objectContaining({
        returnedCount: 3,
        hasMore: true,
        nextPage: '2',
        toolCall: expect.objectContaining({
          responseSummary: 'Created a selection handle for 3 assets; more results available on page 2',
        }),
      }),
    );
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith({ page: 1, size: 3 }, expect.any(Object));
  });

  it.each([
    ['description', 'birthday', { description: 'birthday' }],
    ['ocr', 'invoice', { ocr: 'invoice' }],
    ['filename', 'IMG_2026', { originalFileName: 'IMG_2026' }],
  ] satisfies Array<[AgentSearchAssetsToolRequestDto['mode'], string, Record<string, string>]>)(
    'executes %s text search through its distinct metadata field',
    async (mode, query, expectedTextOption) => {
      const auth = AuthFactory.create();
      const session = makeSession({
        userId: auth.user.id,
        approvalMode: AgentApprovalMode.PlanOnly,
        permissionPlanSnapshot: makePlan(),
      });

      sessionRepository.getById.mockResolvedValue(session);

      const result = await sut.searchAssets(auth, session.id, {
        mode,
        query,
        filters: {},
        limit: 5,
        page: 1,
        order: 'desc',
      });

      expect(result).toEqual(expect.objectContaining({ status: 'success', returnedCount: 0, hasMore: false }));
      expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
        { page: 1, size: 5 },
        expect.objectContaining(expectedTextOption),
      );
      expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
        expect.any(Object),
        expect.not.objectContaining({
          ...(mode === 'description' ? {} : { description: expect.anything() }),
          ...(mode === 'ocr' ? {} : { ocr: expect.anything() }),
          ...(mode === 'filename' ? {} : { originalFileName: expect.anything() }),
        }),
      );
      expect(searchRepository.searchSmart).not.toHaveBeenCalled();
    },
  );

  it('returns an empty successful OCR search without hydrating metadata', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan(),
    });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'ocr',
      query: 'invoice',
      filters: {},
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'success', returnedCount: 0, hasMore: false }));
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('executes smart search with ML embedding and relevance ordering omitted', async () => {
    const auth = AuthFactory.create();
    const tagId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan(),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.tag.checkOwnerAccess.mockResolvedValue(new Set([tagId]));
    systemMetadataRepository.get.mockResolvedValue({
      machineLearning: { clip: { modelName: 'ViT-Test', maxDistance: 0.42 } },
    } as never);
    machineLearningRepository.encodeText.mockResolvedValue('[1, 2, 3]');

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'smart',
      query: 'beach sunset',
      filters: { tagIds: [tagId] },
      limit: 5,
      page: 1,
    });

    expect(result).toEqual(expect.objectContaining({ status: 'success' }));
    expect(machineLearningRepository.encodeText).toHaveBeenCalledWith('beach sunset', {
      modelName: 'ViT-Test',
      language: undefined,
    });
    expect(searchRepository.searchSmart).toHaveBeenCalledWith(
      { page: 1, size: 5 },
      expect.objectContaining({
        query: 'beach sunset',
        embedding: '[1, 2, 3]',
        maxDistance: 0.42,
        tagIds: [tagId],
        userIds: [auth.user.id],
      }),
    );
    expect(searchRepository.searchSmart).toHaveBeenCalledWith(
      expect.any(Object),
      expect.not.objectContaining({ orderDirection: expect.anything() }),
    );
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('executes later smart search pages while preserving relevance ordering', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    systemMetadataRepository.get.mockResolvedValue({
      machineLearning: { clip: { modelName: 'ViT-Test', maxDistance: 0.42 } },
    } as never);
    machineLearningRepository.encodeText.mockResolvedValue('[1, 2, 3]');
    searchRepository.searchSmart.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: true });
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'smart',
      query: 'beach sunset',
      filters: { isFavorite: true },
      limit: 25,
      page: 2,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        returnedCount: 1,
        hasMore: true,
        nextPage: '3',
        toolCall: expect.objectContaining({
          responseSummary: 'Created a selection handle for 1 asset; more results available on page 3',
        }),
      }),
    );
    expect(searchRepository.searchSmart).toHaveBeenCalledWith(
      { page: 2, size: 25 },
      expect.objectContaining({
        query: 'beach sunset',
        embedding: '[1, 2, 3]',
        isFavorite: true,
        userIds: [auth.user.id],
      }),
    );
    expect(searchRepository.searchSmart).toHaveBeenCalledWith(
      expect.any(Object),
      expect.not.objectContaining({ orderDirection: expect.anything() }),
    );
  });

  it('includes timeline space ids in shared-space smart search scope', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
    systemMetadataRepository.get.mockResolvedValue({
      machineLearning: { clip: { modelName: 'ViT-Test', maxDistance: 0.42 } },
    } as never);

    await sut.searchAssets(auth, session.id, {
      mode: 'smart',
      query: 'beach sunset',
      filters: { withSharedSpaces: true },
      limit: 5,
      page: 1,
    });

    expect(searchRepository.searchSmart).toHaveBeenCalledWith(
      { page: 1, size: 5 },
      expect.objectContaining({ userIds: [auth.user.id], timelineSpaceIds: [spaceId] }),
    );
  });

  it.each([
    [
      { mode: 'metadata', query: 'beach', filters: {}, limit: 5, page: 1, order: 'desc' },
      'query is only supported for smart, description, ocr, and filename search modes',
    ],
    [{ mode: 'metadata', filters: {}, limit: 5, page: 1, order: 'asc' }, 'asc order search is not available yet'],
    [
      { mode: 'metadata', filters: {}, limit: 5, page: 1, order: 'relevance' },
      'relevance order search is not available yet',
    ],
    [
      { mode: 'smart', query: 'beach', filters: {}, limit: 5, page: 1, order: 'asc' },
      'asc order search is not available yet',
    ],
  ] satisfies Array<[AgentSearchAssetsToolRequestDto, string]>)(
    'denies future search contract fields before repository execution: %#',
    async (request, reason) => {
      const auth = AuthFactory.create();
      const session = makeSession({
        userId: auth.user.id,
        approvalMode: AgentApprovalMode.PlanOnly,
        permissionPlanSnapshot: makePlan(),
      });

      sessionRepository.getById.mockResolvedValue(session);

      const result = await sut.searchAssets(auth, session.id, request);

      expect(result).toEqual({
        status: 'denied',
        reason,
        toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied, error: reason }),
      });
      expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
    },
  );

  it('denies spacePersonIds without spaceId before repository execution', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { spacePersonIds: [newUuid()] },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(result).toEqual({
      status: 'denied',
      reason: 'spacePersonIds requires spaceId',
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        error: 'spacePersonIds requires spaceId',
      }),
    });
    expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
  });

  it('denies conflicting spaceId and withSharedSpaces before repository execution', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { spaceId: newUuid(), withSharedSpaces: true },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Cannot use both spaceId and withSharedSpaces',
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        error: 'Cannot use both spaceId and withSharedSpaces',
      }),
    });
    expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
  });

  it('denies withSharedSpaces in owned-only permission plans before repository execution', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { withSharedSpaces: true },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Shared spaces are not accessible for this session',
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        error: 'Shared spaces are not accessible for this session',
      }),
    });
    expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
  });

  it('denies stale spaceId withSharedSpaces filters generically after checking membership before repository execution', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getMember.mockImplementation(() => Promise.resolve(void 0));

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { spaceId },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(sharedSpaceRepository.getMember).toHaveBeenCalledWith(spaceId, auth.user.id);
    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more search filters are not accessible',
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        error: 'One or more search filters are not accessible',
      }),
    });
    expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
  });

  it('denies locked visibility unless permission plan and auth both allow locked assets before repository execution', async () => {
    const cases = [
      {
        plan: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
        auth: AuthFactory.from().session({ hasElevatedPermission: true }).build(),
      },
      {
        plan: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: true } }),
        auth: AuthFactory.from().session({ hasElevatedPermission: false }).build(),
      },
    ];

    for (const testCase of cases) {
      vi.clearAllMocks();
      toolCallRepository.create.mockImplementation((dto) =>
        Promise.resolve(
          makeToolCall({
            ...(dto as Partial<AgentToolCall>),
            id: newUuid(),
            startedAt: now,
            completedAt: (dto.completedAt as Date | null | undefined) ?? null,
          }),
        ),
      );
      const session = makeSession({
        userId: testCase.auth.user.id,
        approvalMode: AgentApprovalMode.PlanOnly,
        permissionPlanSnapshot: testCase.plan,
      });

      sessionRepository.getById.mockResolvedValue(session);

      const result = await sut.searchAssets(testCase.auth, session.id, {
        mode: 'metadata',
        filters: { visibility: AssetVisibility.Locked },
        limit: 5,
        page: 1,
        order: 'desc',
      });

      expect(result).toEqual({
        status: 'denied',
        reason: 'Locked photos require elevated permission',
        toolCall: expect.objectContaining({
          status: AgentToolCallStatus.Denied,
          error: 'Locked photos require elevated permission',
        }),
      });
      expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
    }
  });

  it('allows locked visibility when permission plan and auth both allow locked assets', async () => {
    const auth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: true } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { visibility: AssetVisibility.Locked },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'success' }));
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ visibility: AssetVisibility.Locked }),
    );
  });

  it('Gallery search semantics route metadata filters through searchMetadata and hydrate in search order', async () => {
    const auth = AuthFactory.create();
    const firstAssetId = newUuid();
    const secondAssetId = newUuid();
    const tagId = newUuid();
    const albumId = newUuid();
    const personId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        assetScope: { owned: true, sharedSpaces: false, locked: false },
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 10, maxAssetsPerSession: 10 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
    accessRepository.tag.checkOwnerAccess.mockResolvedValue(new Set([tagId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([firstAssetId, secondAssetId]));
    searchRepository.searchMetadata.mockResolvedValue({
      items: [{ id: secondAssetId }, { id: firstAssetId }] as never,
      hasNextPage: true,
    });
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(firstAssetId),
      makeMetadata(secondAssetId),
    ] as never);

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: {
        createdAfter: new Date('2026-05-01T00:00:00.000Z'),
        createdBefore: new Date('2026-05-31T23:59:59.999Z'),
        rating: null,
        tagIds: [tagId],
        albumIds: [albumId],
        personIds: [personId],
      },
      limit: 2,
      page: 1,
      order: 'desc',
      detail: 'metadata',
    });

    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: 2 },
      expect.objectContaining({
        userIds: [auth.user.id],
        createdAfter: new Date('2026-05-01T00:00:00.000Z'),
        createdBefore: new Date('2026-05-31T23:59:59.999Z'),
        rating: null,
        tagIds: [tagId],
        albumIds: [albumId],
        personIds: [personId],
      }),
    );
    expect(assetRepository.getAgentMetadataByIds).toHaveBeenCalledWith([secondAssetId, firstAssetId]);
    expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        returnedCount: 2,
        hasMore: true,
        nextPage: '2',
        sample: {
          sampleSize: 2,
          items: [expect.objectContaining({ itemRef: 'item:001' }), expect.objectContaining({ itemRef: 'item:002' })],
        },
      }),
    );
    expect(result).not.toHaveProperty('assets');
    expect(result).not.toHaveProperty('assetIds');
    expect(JSON.stringify(result)).not.toContain(secondAssetId);
    expect(JSON.stringify(result)).not.toContain(firstAssetId);
  });

  it('records failed search hydration instead of returning partial assets when metadata rows are missing', async () => {
    const auth = AuthFactory.create();
    const firstAssetId = newUuid();
    const secondAssetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({
      items: [{ id: firstAssetId }, { id: secondAssetId }] as never,
      hasNextPage: false,
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([firstAssetId, secondAssetId]));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(firstAssetId)] as never);

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: {},
      limit: 2,
      detail: 'metadata',
    });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more search result assets were not found during metadata hydration',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Failed }),
    });
    expect(result).not.toHaveProperty('assets');
    expect(toolCallRepository.transition).toHaveBeenLastCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Failed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: null,
        redactedResponseMetadata: { assetIds: [firstAssetId] },
        completedAt: expect.any(Date),
        error: 'One or more search result assets were not found during metadata hydration',
      },
    );
  });

  it('shared-space-only search uses empty user IDs and timeline space IDs from shared spaces', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);

    await sut.searchAssets(auth, session.id, { mode: 'metadata', filters: {}, limit: 5, page: 1, order: 'desc' });

    expect(sharedSpaceRepository.getSpaceIdsForTimeline).toHaveBeenCalledWith(auth.user.id);
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: 5 },
      expect.objectContaining({ userIds: [], timelineSpaceIds: [spaceId] }),
    );
  });

  it('favorites with shared-space search includes owned user ID, timeline space IDs, and favorite filter', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);

    await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { withSharedSpaces: true, isFavorite: true },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: 5 },
      expect.objectContaining({ userIds: [auth.user.id], timelineSpaceIds: [spaceId], isFavorite: true }),
    );
  });

  it('accessible people filters reach Gallery search', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

    await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { personIds: [personId] },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: 5 },
      expect.objectContaining({ personIds: [personId] }),
    );
  });

  it('searchAssets sends multiple global people with tag and date filters to Gallery search', async () => {
    const auth = AuthFactory.create();
    const firstPersonId = newUuid();
    const secondPersonId = newUuid();
    const tagId = newUuid();
    const takenAfter = new Date('2026-05-01T00:00:00.000Z');
    const takenBefore = new Date('2026-05-31T23:59:59.999Z');
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([firstPersonId, secondPersonId]));
    accessRepository.tag.checkOwnerAccess.mockResolvedValue(new Set([tagId]));

    await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: {
        personIds: [firstPersonId, secondPersonId],
        tagIds: [tagId],
        takenAfter,
        takenBefore,
      },
      limit: 25,
    });

    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: 25 },
      expect.objectContaining({
        userIds: [auth.user.id],
        personIds: [firstPersonId, secondPersonId],
        tagIds: [tagId],
        takenAfter,
        takenBefore,
      }),
    );
  });

  it('searchAssets returns an empty success page when a resolved person has no matching assets', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
    searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false });

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { personIds: [personId] },
      limit: 25,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        returnedCount: 0,
        hasMore: false,
        detail: 'handle',
        selectionHandle: expect.objectContaining({ assetCount: 0 }),
      }),
    );
    expect(result).not.toHaveProperty('assetIds');
  });

  it('space person filters use explicit space scope without broad timeline IDs', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const spacePersonId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getMember.mockResolvedValue(makeSpaceMember({ spaceId, userId: auth.user.id }));

    await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { spaceId, spacePersonIds: [spacePersonId] },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(sharedSpaceRepository.getSpaceIdsForTimeline).not.toHaveBeenCalled();
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: 5 },
      expect.objectContaining({ spaceId, spacePersonIds: [spacePersonId] }),
    );
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      expect.any(Object),
      expect.not.objectContaining({ timelineSpaceIds: expect.anything() }),
    );
  });

  it('album filters include timeline shared spaces when permission plan allows shared spaces', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const spaceId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);

    await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { albumIds: [albumId] },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: 5 },
      expect.objectContaining({ userIds: [auth.user.id], timelineSpaceIds: [spaceId], albumIds: [albumId] }),
    );
  });

  it('locked visibility search calls returned-asset owner access with elevated locked access after validation allows it', async () => {
    const auth = AuthFactory.from().session({ hasElevatedPermission: true }).build();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: true } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { visibility: AssetVisibility.Locked },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(result.status).toBe('success');
    expect(searchRepository.searchMetadata).toHaveBeenCalledWith(
      { page: 1, size: 5 },
      expect.objectContaining({ visibility: AssetVisibility.Locked }),
    );
    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([assetId]), true);
  });

  it('denies inaccessible people filters before repository execution', async () => {
    const auth = AuthFactory.create();
    const accessiblePersonId = newUuid();
    const inaccessiblePersonId = newUuid();
    const personIds = [accessiblePersonId, inaccessiblePersonId];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([accessiblePersonId]));
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { personIds },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(accessRepository.person.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set(personIds));
    expect(accessRepository.person.checkSharedSpaceAccess).toHaveBeenCalledWith(auth.user.id, new Set(personIds));
    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more search filters are not accessible',
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        error: 'One or more search filters are not accessible',
      }),
    });
    expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
  });

  it('searchAssets returns a recoverable wrong-domain error when personIds contains a readable asset id', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut
      .searchAssets(auth, session.id, {
        mode: 'metadata',
        filters: { personIds: [assetId] },
        limit: 5,
        page: 1,
        order: 'desc',
      })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    expect((thrown as AgentMcpRecoverableToolError).content).toMatchObject({
      status: 'error',
      error: 'That value is an asset ID, not a person ID.',
      toolName: AgentToolName.SearchAssets,
      retryable: true,
      hint: 'Use person IDs returned by resolveAssetSearchFilters, not asset IDs from searchAssets.',
      recovery: {
        kind: 'wrong_id_domain',
        field: 'filters.personIds',
        expectedDomain: 'person',
        receivedDomain: 'asset',
        instruction: 'Use person IDs returned by resolveAssetSearchFilters, not asset IDs from searchAssets.',
      },
    });
    expect(JSON.stringify((thrown as AgentMcpRecoverableToolError).content.recovery)).not.toContain(assetId);
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('searchAssets keeps unknown and cross-user personIds on the generic inaccessible filter path', async () => {
    const auth = AuthFactory.create();
    const unknownOrCrossUserPersonId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());

    const result = await sut.searchAssets(auth, session.id, {
      mode: 'metadata',
      filters: { personIds: [unknownOrCrossUserPersonId] },
      limit: 5,
      page: 1,
      order: 'desc',
    });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more search filters are not accessible',
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        error: 'One or more search filters are not accessible',
      }),
    });
    expect(JSON.stringify(result)).not.toContain('wrong_id_domain');
    expect(searchRepository.searchMetadata).not.toHaveBeenCalled();
  });

  it('listAlbums filters out owned albums when assetScope.owned is false', async () => {
    const auth = AuthFactory.create();
    const ownedAlbum = makeAlbumSummary({ ownerId: auth.user.id });
    const sharedAlbum = makeAlbumSummary({ ownerId: newUuid() });
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    albumRepository.getAgentAlbums.mockResolvedValue([ownedAlbum, sharedAlbum]);

    const result = await sut.listAlbums(auth, session.id, {});

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      albums: [sharedAlbum],
    });
  });

  it('readSelectionMetadata returns aggregate counts and itemRef samples without asset ids', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid(), newUuid()];
    const selectionHandleId = newUuid();
    const sourceToolCallId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId,
      assetIds,
      assetCount: assetIds.length,
      sampleAssetIds: assetIds,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updateId: newUuid(),
    });
    assetRepository.getAgentMetadataByIds.mockResolvedValue(
      assetIds.map((id, index) =>
        makeMetadata(id, {
          originalFileName: index === 0 ? `${id}.jpg` : `photo-${index}.jpg`,
        }),
      ) as never,
    );

    const result = await sut.readSelectionMetadata(auth, session.id, {
      selectionHandleId,
      fields: ['dates', 'camera', 'rating', 'filename'],
      sampleSize: 2,
    });

    expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      now: expect.any(Date),
    });
    expect(assetRepository.getAgentMetadataByIds).toHaveBeenCalledWith(assetIds.slice(0, 2));
    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(result.summary).toBe('Read selection metadata for 3 assets with 2 samples');
    expect(result.selectionHandle).toMatchObject({
      id: selectionHandleId,
      sourceRef: `asset-source:search:${selectionHandleId}`,
      assetCount: 3,
      sourceToolCallId,
    });
    expect(result.counts).toEqual({ assets: 3, sampled: 2 });
    expect(result.sample?.items.map((item) => item.itemRef)).toEqual(['item:001', 'item:002']);
    expect(result.sample?.items[0]).not.toHaveProperty('id');
    expect(result.sample?.items[0]).not.toHaveProperty('assetId');
    expect(result.sample?.items[0]).not.toHaveProperty('ownerId');
    expect(JSON.stringify(result)).not.toContain(assetIds[0]);
    expect(result.resultSize).toMatchObject({ returnedItems: 2, hasMore: false, nextPage: null });
  });

  it('readSelectionMetadata supports aggregate-only sampleSize zero without metadata hydration', async () => {
    const auth = AuthFactory.create();
    const selectionHandleId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: null,
      assetIds: [newUuid()],
      assetCount: 1,
      sampleAssetIds: [newUuid()],
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updateId: newUuid(),
    });

    const result = await sut.readSelectionMetadata(auth, session.id, { selectionHandleId, sampleSize: 0 });

    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.counts).toEqual({ assets: 1, sampled: 0 });
      expect(result).not.toHaveProperty('sample');
    }
  });

  it('readSelectionMetadata skips missing sample metadata without leaking handle asset ids', async () => {
    const auth = AuthFactory.create();
    const missingAssetId = newUuid();
    const visibleAssetId = newUuid();
    const selectionHandleId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: null,
      assetIds: [missingAssetId, visibleAssetId],
      assetCount: 2,
      sampleAssetIds: [missingAssetId, visibleAssetId],
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updateId: newUuid(),
    });
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(visibleAssetId, { originalFileName: 'visible.jpg' }),
    ] as never);

    const result = await sut.readSelectionMetadata(auth, session.id, { selectionHandleId, sampleSize: 2 });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.counts).toEqual({ assets: 2, sampled: 1 });
      expect(result.sample?.items).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(missingAssetId);
      expect(JSON.stringify(result)).not.toContain(visibleAssetId);
    }
  });

  it('curateSelection creates a derived handle with deterministic metadata highlights and no response ids', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid(), newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const sourceHandle = makeCurateHandle(session, auth.user.id, assetIds);
    const derivedHandle = makeCurateHandle(session, auth.user.id, [assetIds[1], assetIds[2]], {
      sourceToolCallId: newUuid(),
    });

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(assetIds[0], { exifInfo: { ...makeMetadata(assetIds[0]).exifInfo!, rating: 2 } }),
      makeMetadata(assetIds[1], { isFavorite: true, originalFileName: 'favorite.jpg' }),
      makeMetadata(assetIds[2], { exifInfo: { ...makeMetadata(assetIds[2]).exifInfo!, rating: 5, city: 'Paris' } }),
      makeMetadata(assetIds[3], { exifInfo: { ...makeMetadata(assetIds[3]).exifInfo!, rating: null, city: null } }),
    ] as never);
    selectionHandleRepository.create.mockResolvedValue(derivedHandle);

    const result = await sut.curateSelection(auth, session.id, {
      selectionHandleId: sourceHandle.id,
      targetCount: 2,
      strategy: 'metadata-highlights',
      constraints: { diversifyBy: ['location'] },
      sampleSize: 2,
    });

    expect(selectionHandleRepository.create).toHaveBeenCalledWith({
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: expect.any(String),
      assetIds: [assetIds[1], assetIds[2]],
      expiresAt: expect.any(Date),
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.selectionHandle).toMatchObject({ id: derivedHandle.id, assetCount: 2 });
    expect(result.sourceAssetCount).toBe(4);
    expect(result.selectedAssetCount).toBe(2);
    expect(result.criteriaSummary.join(' ')).toMatch(/metadata-only/i);
    expect(result.criteriaSummary.join(' ')).not.toMatch(/quality scoring|preview inspected/i);
    expect(result.sample?.items.map((item) => item.itemRef)).toEqual(['item:001', 'item:002']);
    expect(JSON.stringify(result)).not.toContain(assetIds[1]);
    expect(JSON.stringify(result)).not.toContain('"assetIds"');
    expect(JSON.stringify(result)).not.toContain('"sampleAssetIds"');
  });

  it('curateSelection spreads dates deterministically and warns when target exceeds eligible assets', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const sourceHandle = makeCurateHandle(session, auth.user.id, assetIds);
    const derivedHandle = makeCurateHandle(session, auth.user.id, assetIds);

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(assetIds[0], { localDateTime: new Date('2026-05-01T10:00:00.000Z') }),
      makeMetadata(assetIds[1], { localDateTime: new Date('2026-05-02T10:00:00.000Z') }),
      makeMetadata(assetIds[2], { localDateTime: new Date('2026-05-01T11:00:00.000Z') }),
    ] as never);
    selectionHandleRepository.create.mockResolvedValue(derivedHandle);

    const result = await sut.curateSelection(auth, session.id, {
      selectionHandleId: sourceHandle.id,
      targetCount: 5,
      strategy: 'date-spread',
    });

    expect(selectionHandleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: [assetIds[1], assetIds[2], assetIds[0]] }),
    );
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.warnings).toContain('Requested 5 assets but only 3 eligible assets were available.');
      expect(result.criteriaSummary.join(' ')).toMatch(/date-spread/i);
    }
  });

  it('curateSelection keeps ranked order when target exceeds eligible assets', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const sourceHandle = makeCurateHandle(session, auth.user.id, assetIds);
    const derivedHandle = makeCurateHandle(session, auth.user.id, [assetIds[1], assetIds[2], assetIds[0]]);

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(assetIds[0], { isFavorite: false, exifInfo: { ...makeMetadata(assetIds[0]).exifInfo!, rating: 1 } }),
      makeMetadata(assetIds[1], { isFavorite: true, exifInfo: { ...makeMetadata(assetIds[1]).exifInfo!, rating: 2 } }),
      makeMetadata(assetIds[2], { isFavorite: false, exifInfo: { ...makeMetadata(assetIds[2]).exifInfo!, rating: 5 } }),
    ] as never);
    selectionHandleRepository.create.mockResolvedValue(derivedHandle);

    const result = await sut.curateSelection(auth, session.id, {
      selectionHandleId: sourceHandle.id,
      targetCount: 5,
      strategy: 'favorites-first',
    });

    expect(selectionHandleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: [assetIds[1], assetIds[2], assetIds[0]] }),
    );
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.warnings).toContain('Requested 5 assets but only 3 eligible assets were available.');
    }
  });

  it('curateSelection can derive a low-quality subset from a bounded source handle', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid(), newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const sourceHandle = makeCurateHandle(session, auth.user.id, assetIds);
    const derivedHandle = makeCurateHandle(session, auth.user.id, [assetIds[1], assetIds[3]]);

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(assetIds[0], { qualityInfo: { sharpness: 45, exposure: 70, brightness: 70, quality: 80 } }),
      makeMetadata(assetIds[1], { qualityInfo: { sharpness: 12, exposure: 70, brightness: 70, quality: 80 } }),
      makeMetadata(assetIds[2], { qualityInfo: null }),
      makeMetadata(assetIds[3], { qualityInfo: { sharpness: 20, exposure: 70, brightness: 70, quality: 80 } }),
    ] as never);
    selectionHandleRepository.create.mockResolvedValue(derivedHandle);

    const result = await sut.curateSelection(auth, session.id, {
      selectionHandleId: sourceHandle.id,
      targetCount: 4,
      constraints: { types: ['IMAGE'], maxSharpness: 20 },
      sampleSize: 0,
    });

    expect(selectionHandleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: [assetIds[1], assetIds[3]] }),
    );
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.selectionHandle).toMatchObject({ id: derivedHandle.id, assetCount: 2 });
      expect(result.criteriaSummary.join(' ')).toMatch(/objective image quality/i);
    }
  });

  it('curateSelection date-spread starts with newest date group before older high-score groups', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const sourceHandle = makeCurateHandle(session, auth.user.id, assetIds);
    const derivedHandle = makeCurateHandle(session, auth.user.id, [assetIds[1], assetIds[0], assetIds[2]]);

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(assetIds[0], {
        isFavorite: true,
        localDateTime: new Date('2026-05-01T10:00:00.000Z'),
        exifInfo: { ...makeMetadata(assetIds[0]).exifInfo!, rating: 5 },
      }),
      makeMetadata(assetIds[1], {
        isFavorite: false,
        localDateTime: new Date('2026-05-03T10:00:00.000Z'),
        exifInfo: { ...makeMetadata(assetIds[1]).exifInfo!, rating: 1 },
      }),
      makeMetadata(assetIds[2], {
        isFavorite: false,
        localDateTime: new Date('2026-05-01T11:00:00.000Z'),
        exifInfo: { ...makeMetadata(assetIds[2]).exifInfo!, rating: 4 },
      }),
    ] as never);
    selectionHandleRepository.create.mockResolvedValue(derivedHandle);

    await sut.curateSelection(auth, session.id, {
      selectionHandleId: sourceHandle.id,
      targetCount: 3,
      strategy: 'date-spread',
    });

    expect(selectionHandleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: [assetIds[1], assetIds[0], assetIds[2]] }),
    );
  });

  it('curateSelection supports cover-candidate constraints and sampleSize zero', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const sourceHandle = makeCurateHandle(session, auth.user.id, assetIds);
    const derivedHandle = makeCurateHandle(session, auth.user.id, [assetIds[2]]);

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      makeMetadata(assetIds[0], { type: AssetType.Video }),
      makeMetadata(assetIds[1], {
        type: AssetType.Image,
        exifInfo: { ...makeMetadata(assetIds[1]).exifInfo!, rating: 3 },
      }),
      makeMetadata(assetIds[2], {
        type: AssetType.Image,
        isFavorite: true,
        exifInfo: { ...makeMetadata(assetIds[2]).exifInfo!, rating: 5 },
      }),
    ] as never);
    selectionHandleRepository.create.mockResolvedValue(derivedHandle);

    const result = await sut.curateSelection(auth, session.id, {
      selectionHandleId: sourceHandle.id,
      targetCount: 1,
      strategy: 'cover-candidate',
      constraints: { excludeVideos: true },
      sampleSize: 0,
    });

    expect(selectionHandleRepository.create).toHaveBeenCalledWith(expect.objectContaining({ assetIds: [assetIds[2]] }));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.sample).toBeUndefined();
      expect(result.criteriaSummary.join(' ')).toMatch(/cover-candidate/i);
    }
  });

  it('curateSelection skips missing metadata rows and creates an empty handle when none are eligible', async () => {
    const auth = AuthFactory.create();
    const missingAssetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const sourceHandle = makeCurateHandle(session, auth.user.id, [missingAssetId]);
    const derivedHandle = makeCurateHandle(session, auth.user.id, []);

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);
    assetRepository.getAgentMetadataByIds.mockResolvedValue([] as never);
    selectionHandleRepository.create.mockResolvedValue(derivedHandle);

    const result = await sut.curateSelection(auth, session.id, {
      selectionHandleId: sourceHandle.id,
      targetCount: 1,
    });

    expect(selectionHandleRepository.create).toHaveBeenCalledWith(expect.objectContaining({ assetIds: [] }));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.selectedAssetCount).toBe(0);
      expect(result.warnings).toContain('No eligible metadata rows were available for this curation request.');
      expect(JSON.stringify(result)).not.toContain(missingAssetId);
    }
  });

  it('curateSelection asks for narrowing when the source handle is over the metadata curation cap', async () => {
    const auth = AuthFactory.create();
    const assetIds = Array.from({ length: 101 }, () => newUuid());
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 100 } }),
    });
    const sourceHandle = makeCurateHandle(session, auth.user.id, assetIds);

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(sourceHandle);

    const thrown = await sut
      .curateSelection(auth, session.id, { selectionHandleId: sourceHandle.id, targetCount: 10 })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    expect((thrown as AgentMcpRecoverableToolError).content.recovery).toMatchObject({
      kind: 'selection-too-large',
      sourceAssetCount: 101,
      maxSourceAssetCount: 100,
    });
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
    expect(JSON.stringify((thrown as AgentMcpRecoverableToolError).content)).not.toContain(assetIds[0]);
  });

  it('readSelectionMetadata stores replayable request metadata and handle asset count for approval retry', async () => {
    const auth = AuthFactory.create();
    const selectionHandleId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.Strict });
    const pending = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ReadSelectionMetadata,
      requestSummary: `Read selection metadata for handle ${selectionHandleId} (2 sample(s))`,
      redactedRequestMetadata: { selectionHandleId, fields: ['dates'], sampleSize: 2 },
      assetCount: 100,
    });

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue({
      id: selectionHandleId,
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: null,
      assetIds: [newUuid(), newUuid()],
      assetCount: 100,
      sampleAssetIds: [newUuid(), newUuid()],
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updateId: newUuid(),
    });
    toolCallRepository.createWithSessionLimit.mockResolvedValue({ status: 'created', toolCall: pending });

    const result = await sut.readSelectionMetadata(auth, session.id, {
      selectionHandleId,
      fields: ['dates'],
      sampleSize: 2,
    });

    expect(result.status).toBe('approval-required');
    expect(toolCallRepository.createWithSessionLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        redactedRequestMetadata: { selectionHandleId, fields: ['dates'], sampleSize: 2 },
        assetCount: 100,
      }),
      expect.any(Object),
      AgentToolDataClass.Metadata,
      expect.any(Number),
    );
  });

  it('readSelectionMetadata returns recoverable invalid-selection-handle for expired or unavailable handles', async () => {
    const auth = AuthFactory.create();
    const selectionHandleId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
    const expiredHandle = {
      id: selectionHandleId,
      assetCount: 12,
      sourceToolCallId: newUuid(),
      createdAt: new Date('2026-05-27T08:00:00.000Z'),
      expiresAt: new Date('2026-05-27T09:00:00.000Z'),
    };

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.getForRecovery.mockResolvedValue(expiredHandle);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set());
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut
      .readSelectionMetadata(auth, session.id, { selectionHandleId, sampleSize: 5 })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error.content).toMatchObject({
      status: 'error',
      toolName: AgentToolName.ReadSelectionMetadata,
      retryable: true,
      recovery: {
        kind: 'invalid-selection-handle',
        attemptedSelectionHandleId: selectionHandleId,
        expiredSelectionHandle: expect.objectContaining({ id: selectionHandleId, assetCount: 12 }),
      },
    });
    expect(JSON.stringify(error.content)).not.toContain('assetIds');
    expect(JSON.stringify(error.content)).not.toContain('sampleAssetIds');
  });

  it('readSelectionMetadata treats cross-session handles as unavailable without recovery leaks', async () => {
    const auth = AuthFactory.create();
    const foreignHandleId = newUuid();
    const availableHandle = {
      id: newUuid(),
      assetCount: 4,
      sourceToolCallId: newUuid(),
      createdAt: new Date('2026-05-27T08:00:00.000Z'),
      expiresAt: new Date('2026-05-27T10:00:00.000Z'),
    };
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([availableHandle]);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set());
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut
      .readSelectionMetadata(auth, session.id, { selectionHandleId: foreignHandleId })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    const error = thrown as AgentMcpRecoverableToolError;
    expect(error.content.recovery).toMatchObject({
      kind: 'invalid-selection-handle',
      attemptedSelectionHandleId: foreignHandleId,
      availableSelectionHandles: [expect.objectContaining({ id: availableHandle.id, assetCount: 4 })],
    });
    expect(JSON.stringify(error.content.recovery)).not.toContain('assetIds');
    expect(JSON.stringify(error.content.recovery)).not.toContain('sampleAssetIds');
    expect(JSON.stringify(error.content.recovery)).not.toContain('foreign-owner');
  });

  it('readSelectionMetadata returns wrong-domain recovery for readable asset IDs', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut
      .readSelectionMetadata(auth, session.id, { selectionHandleId: assetId })
      .catch((error) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    expect((thrown as AgentMcpRecoverableToolError).content).toMatchObject({
      error: 'That value is an asset ID, not a selection handle ID.',
      recovery: {
        kind: 'wrong_id_domain',
        field: 'selectionHandleId',
        expectedDomain: 'selectionHandle',
        receivedDomain: 'asset',
      },
    });
    expect(JSON.stringify((thrown as AgentMcpRecoverableToolError).content.recovery)).not.toContain(assetId);
  });

  it('readSelectionMetadata returns wrong-domain recovery for readable person IDs', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set());
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut
      .readSelectionMetadata(auth, session.id, { selectionHandleId: personId })
      .catch((error) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    expect((thrown as AgentMcpRecoverableToolError).content).toMatchObject({
      error: 'That value is a person ID, not a selection handle ID.',
      recovery: {
        kind: 'wrong_id_domain',
        field: 'selectionHandleId',
        expectedDomain: 'selectionHandle',
        receivedDomain: 'person',
      },
    });
    expect(JSON.stringify((thrown as AgentMcpRecoverableToolError).content.recovery)).not.toContain(personId);
  });

  it('readSelectionMetadata denies metadata policy before resolving selection handles', async () => {
    const auth = AuthFactory.create();
    const selectionHandleId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ read: { metadata: false, previews: false, originals: false } }),
    });
    const denied = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ReadSelectionMetadata,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      redactedRequestMetadata: { selectionHandleId, fields: ['dates'], sampleSize: 2 },
      error: 'Agent permission policy does not allow metadata reads',
      completedAt,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValue(denied);

    const result = await sut.readSelectionMetadata(auth, session.id, {
      selectionHandleId,
      fields: ['dates'],
      sampleSize: 2,
    });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Agent permission policy does not allow metadata reads',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied, error: denied.error }),
    });
    expect(selectionHandleRepository.getValidForPlanning).not.toHaveBeenCalled();
  });

  it('approved readSelectionMetadata retry records denied when the stored handle is unavailable', async () => {
    const auth = AuthFactory.create();
    const selectionHandleId = newUuid();
    const session = makeSession({ userId: auth.user.id });
    const approved = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ReadSelectionMetadata,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { selectionHandleId, fields: ['dates'], sampleSize: 2 },
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
    );
    selectionHandleRepository.getValidForPlanning.mockResolvedValue(void 0);
    selectionHandleRepository.getForRecovery.mockResolvedValue(void 0);
    selectionHandleRepository.listValidForRecovery.mockResolvedValue([]);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set());
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut
      .readSelectionMetadata(auth, session.id, { toolCallId: approved.id })
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      1,
      session.id,
      approved.id,
      AgentToolCallStatus.Approved,
      expect.objectContaining({ status: AgentToolCallStatus.Executing }),
    );
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      2,
      session.id,
      approved.id,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        responseSummary: null,
        redactedResponseMetadata: { resultSize: emptyResultSize() },
        completedAt: expect.any(Date),
        error: 'Selection handle is expired or not available for this session',
      },
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
    });
  });

  it('listAlbums filters out shared albums when assetScope.sharedSpaces is false', async () => {
    const auth = AuthFactory.create();
    const ownedAlbum = makeAlbumSummary({ ownerId: auth.user.id });
    const sharedAlbum = makeAlbumSummary({ ownerId: newUuid() });
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    albumRepository.getAgentAlbums.mockResolvedValue([ownedAlbum, sharedAlbum]);

    const result = await sut.listAlbums(auth, session.id, {});

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      albums: [ownedAlbum],
    });
  });

  it.each([
    {
      name: 'readAssetMetadata',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetMetadata(auth, sessionId, { assetIds }),
      repositoryRead: () => assetRepository.getAgentMetadataByIds,
    },
    {
      name: 'readAssetPreviews',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetPreviews(auth, sessionId, { assetIds }),
      repositoryRead: () => assetRepository.getAgentPreviewReferencesByIds,
    },
    {
      name: 'readAssetOriginals',
      call: async (auth: ReturnType<typeof AuthFactory.create>, sessionId: string, assetIds: string[]) =>
        sut.readAssetOriginals(auth, sessionId, { assetIds }),
      repositoryRead: () => assetRepository.getAgentOriginalReferencesByIds,
    },
  ])('$name denies inaccessible asset ids before returning data', async ({ call, repositoryRead }) => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      credentialSnapshot: {
        id: newUuid(),
        providerType: AgentProviderType.OpenAICompatible,
        label: 'Local compatible',
        baseUrl: 'http://localhost:11434/v1',
        models: ['local-model'],
        defaultModel: 'local-model',
      },
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: true },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: true,
          allowOriginalsForExternalProviders: false,
        },
        limits: { ...permissionPlanSnapshot.limits, maxPreviewsPerToolCall: 5, maxOriginalsPerToolCall: 5 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());

    const result = await call(auth, session.id, assetIds);

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more assets are not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(repositoryRead()).not.toHaveBeenCalled();
  });

  it('denies inaccessible search result asset ids before returning data', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });

    const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 1 });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more assets are not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
  });

  it('YOLO readAlbum denies an owned album when assetScope.owned is false', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
    albumRepository.getAgentAlbumById.mockResolvedValue(makeAlbumDetail({ id: albumId, ownerId: auth.user.id }));

    const result = await sut.readAlbum(auth, session.id, { albumId });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Album is not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(albumRepository.getAgentAlbumById).not.toHaveBeenCalled();
  });

  it('YOLO readAlbum denies a shared album when assetScope.sharedSpaces is false', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));

    const result = await sut.readAlbum(auth, session.id, { albumId });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Album is not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(albumRepository.getAgentAlbumById).not.toHaveBeenCalled();
  });

  it('YOLO readAlbum allows an owned album even when its album id is not an asset id', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const album = makeAlbumDetail({ id: albumId, ownerId: auth.user.id, assetIds: [newUuid()] });
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    assetRepository.getAgentReadableIds.mockResolvedValue(new Set());
    albumRepository.getAgentAlbumById.mockResolvedValue(album);

    const result = await sut.readAlbum(auth, session.id, { albumId });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      album,
    });
    expect(assetRepository.getAgentReadableIds).not.toHaveBeenCalledWith(new Set([albumId]));
  });

  it('counts per-session limits by data class and excludes the current approved strict call during re-execution', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: false },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: false,
          allowOriginalsForExternalProviders: false,
        },
        limits: {
          ...permissionPlanSnapshot.limits,
          maxPreviewsPerToolCall: 5,
          maxPreviewsPerSession: 3,
        },
      }),
    });
    const approved = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ReadAssetPreviews,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds },
      dataClass: AgentToolDataClass.Previews,
      assetCount: assetIds.length,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
    );
    toolCallRepository.getCountedAssetCountBySessionAndDataClass.mockResolvedValue(1);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentPreviewReferencesByIds.mockResolvedValue(assetIds.map((id) => makeMediaReference(id)));

    await sut.readAssetPreviews(auth, session.id, { toolCallId: approved.id });

    expect(toolCallRepository.getCountedAssetCountBySessionAndDataClass).toHaveBeenCalledWith(
      session.id,
      AgentToolDataClass.Previews,
      approved.id,
    );
  });

  it('YOLO visibility-constrains album and tag search filters without leaking inaccessible ids through errors', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
    accessRepository.tag.checkOwnerAccess.mockResolvedValue(new Set());

    const result = await sut.searchAssets(auth, session.id, {
      filters: { albumIds: [newUuid()], tagIds: [newUuid()] },
      limit: 1,
    });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more search filters are not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    if (result.status !== 'denied') {
      throw new Error(`Expected denied response, got ${result.status}`);
    }
    expect(result.reason).not.toContain('album');
    expect(result.reason).not.toContain('tag');
    expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
  });

  it('returns only available preview references and audits the returned count', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const returnedPreview = makeMediaReference(assetIds[0]);
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: false },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: false,
          allowOriginalsForExternalProviders: false,
        },
        limits: { ...permissionPlanSnapshot.limits, maxPreviewsPerToolCall: 5 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentPreviewReferencesByIds.mockResolvedValue([returnedPreview]);

    const result = await sut.readAssetPreviews(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      previews: [returnedPreview],
    });
    expect(toolCallRepository.transition).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        assetCount: 1,
        redactedResponseMetadata: expect.objectContaining({ assetIds: [assetIds[0]], resultSize: expect.any(Object) }),
      }),
    );
  });

  it('returns only available original references and audits the returned count', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const returnedOriginal = makeMediaReference(assetIds[1]);
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      credentialSnapshot: {
        id: newUuid(),
        providerType: AgentProviderType.OpenAICompatible,
        label: 'Local compatible',
        baseUrl: 'http://localhost:11434/v1',
        models: ['local-model'],
        defaultModel: 'local-model',
      },
      permissionPlanSnapshot: makePlan({
        read: { metadata: true, previews: true, originals: true },
        providerExposure: {
          metadata: true,
          previews: true,
          originals: true,
          allowOriginalsForExternalProviders: false,
        },
        limits: { ...permissionPlanSnapshot.limits, maxOriginalsPerToolCall: 5 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentOriginalReferencesByIds.mockResolvedValue([returnedOriginal]);

    const result = await sut.readAssetOriginals(auth, session.id, { assetIds });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      originals: [returnedOriginal],
    });
    expect(toolCallRepository.transition).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        assetCount: 1,
        redactedResponseMetadata: expect.objectContaining({ assetIds: [assetIds[1]], resultSize: expect.any(Object) }),
      }),
    );
  });

  it('readAlbum denies albums whose asset count exceeds maxAssetsPerToolCall', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1 } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    albumRepository.getAgentAlbumById.mockResolvedValue(
      makeAlbumDetail({ id: albumId, assetIds: [newUuid(), newUuid()] }),
    );

    const result = await sut.readAlbum(auth, session.id, { albumId });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Requested asset count exceeds per-tool limit',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
  });

  it('readAlbum denies plan-only execution when album assets exceed remaining metadata session limit', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const album = makeAlbumDetail({ id: albumId, assetIds: [newUuid(), newUuid(), newUuid()] });
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ limits: { ...permissionPlanSnapshot.limits, maxAssetsPerSession: 5 } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    albumRepository.getAgentAlbumById.mockResolvedValue(album);
    toolCallRepository.transitionWithSessionLimit.mockResolvedValue({
      status: 'limit-exceeded',
      toolCall: makeToolCall({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Session policy allows at most 5 assets per session',
      }),
    });

    const result = await sut.readAlbum(auth, session.id, { albumId });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Session policy allows at most 5 assets per session',
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        error: 'Session policy allows at most 5 assets per session',
      }),
    });
    expect(toolCallRepository.transitionWithSessionLimit).toHaveBeenCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        assetCount: album.assetCount,
        albumCount: 1,
      }),
      AgentToolDataClass.Metadata,
      5,
    );
    expect(toolCallRepository.transition).not.toHaveBeenCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({ status: AgentToolCallStatus.Completed }),
    );
  });

  it('readAlbum reserves the loaded asset count before completing plan-only execution', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const album = makeAlbumDetail({ id: albumId, assetIds: [newUuid(), newUuid()] });
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ limits: { ...permissionPlanSnapshot.limits, maxAssetsPerSession: 5 } }),
    });
    const executing = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ReadAlbum,
      status: AgentToolCallStatus.Executing,
      approvalDecision: AgentToolApprovalDecision.Approved,
      requestSummary: `Read album ${albumId}`,
      redactedRequestMetadata: { albumId },
      assetCount: 0,
      albumCount: 1,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValueOnce(executing);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    albumRepository.getAgentAlbumById.mockResolvedValue(album);

    const result = await sut.readAlbum(auth, session.id, { albumId });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      album,
    });
    expect(toolCallRepository.transitionWithSessionLimit).toHaveBeenCalledWith(
      session.id,
      executing.id,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Tool call execution started',
        redactedResponseMetadata: null,
        assetCount: album.assetCount,
        albumCount: 1,
        completedAt: null,
        error: null,
      },
      AgentToolDataClass.Metadata,
      5,
    );
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      executing.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Completed,
        assetCount: album.assetCount,
        albumCount: 1,
      }),
    );
  });

  it('readAlbum excludes the current approved tool call when checking loaded album session limits', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const album = makeAlbumDetail({ id: albumId, assetIds: [newUuid(), newUuid()] });
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.Strict,
      permissionPlanSnapshot: makePlan({ limits: { ...permissionPlanSnapshot.limits, maxAssetsPerSession: 3 } }),
    });
    const approved = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ReadAlbum,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      requestSummary: `Read album ${albumId}`,
      redactedRequestMetadata: { albumId },
      assetCount: album.assetCount,
      albumCount: 1,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
    );
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    albumRepository.getAgentAlbumById.mockResolvedValue(album);

    const result = await sut.readAlbum(auth, session.id, { toolCallId: approved.id });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      album,
    });
    expect(toolCallRepository.transitionWithSessionLimit).toHaveBeenCalledWith(
      session.id,
      approved.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Executing,
        assetCount: album.assetCount,
        albumCount: 1,
      }),
      AgentToolDataClass.Metadata,
      3,
    );
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      2,
      session.id,
      approved.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Completed,
        assetCount: album.assetCount,
        albumCount: 1,
      }),
    );
  });

  it('listSpaces returns visible space summaries without full asset ids', async () => {
    const auth = AuthFactory.create();
    const first = makeSpaceRow({ name: 'Family', description: 'People', color: 'blue' });
    const second = makeSpaceRow({ name: 'Family!', description: 'Emoji ✨', color: 'green' });
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([first, second]);
    sharedSpaceRepository.getMembers
      .mockResolvedValueOnce([makeSpaceMember()])
      .mockResolvedValueOnce([makeSpaceMember(), makeSpaceMember()]);
    sharedSpaceRepository.getAssetCount.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    sharedSpaceRepository.getRecentAssets
      .mockResolvedValueOnce([{ id: newUuid(), thumbhash: null }])
      .mockResolvedValueOnce([]);

    const result = await sut.listSpaces(auth, session.id, {});

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Returned 2 space(s)',
        albumCount: 0,
        assetCount: 0,
      }),
      spaces: [
        expect.objectContaining({ id: first.id, name: 'Family', assetCount: 2, memberCount: 1 }),
        expect.objectContaining({ id: second.id, name: 'Family!', assetCount: 0, memberCount: 2 }),
      ],
    });
    if (result.status === 'success') {
      expect(result.spaces[0]).not.toHaveProperty('assetIds');
    }
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        redactedResponseMetadata: expect.objectContaining({
          spaceIds: [first.id, second.id],
          resultSize: expect.any(Object),
        }),
        albumCount: 0,
        assetCount: 0,
      }),
    );
  });

  it('listSpaces returns an empty list for zero visible spaces', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.listSpaces(auth, session.id, {});

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({ responseSummary: 'Returned 0 space(s)' }),
      spaces: [],
    });
  });

  it('listSpaces denies when shared spaces are disabled for the session', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.listSpaces(auth, session.id, {});

    expect(result).toEqual({
      status: 'denied',
      reason: 'Shared spaces are not accessible for this session',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(sharedSpaceRepository.getAllByUserId).not.toHaveBeenCalled();
  });

  it('readAlbum returns albumUsers with userId and role for a shared album', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const sharedUserId = newUuid();
    const album = makeAlbumDetail({
      id: albumId,
      assetIds: [newUuid()],
      albumUsers: [{ userId: sharedUserId, role: 'editor' }],
    });
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    albumRepository.getAgentAlbumById.mockResolvedValue(album);

    const result = await sut.readAlbum(auth, session.id, { albumId });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.album.albumUsers).toEqual([{ userId: sharedUserId, role: 'editor' }]);
    }
  });

  it('readSpace returns redacted members and bounded asset ids for a visible space', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const space = makeSpaceRow({ id: newUuid(), name: 'Family', thumbnailAssetId: assetIds[0] });
    const member = makeSpaceMember({
      spaceId: space.id,
      userId: auth.user.id,
      name: 'Pierre',
      email: 'pierre@example.com',
      avatarColor: 'blue',
      profileImagePath: '/profile.jpg',
    });
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getMember.mockResolvedValue(member);
    sharedSpaceRepository.getById.mockResolvedValue(space);
    sharedSpaceRepository.getMembers.mockResolvedValue([member]);
    sharedSpaceRepository.getAssetCount.mockResolvedValue(assetIds.length);
    sharedSpaceRepository.getRecentAssets.mockResolvedValue([{ id: assetIds[0], thumbhash: null }]);
    sharedSpaceRepository.getAssetIdsInSpacePage.mockResolvedValue(assetIds.map((assetId) => ({ assetId })));

    const result = await sut.readSpace(auth, session.id, { spaceId: space.id });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Returned space with 2 asset id(s)',
        assetCount: 2,
        albumCount: 0,
      }),
      space: expect.objectContaining({
        id: space.id,
        assetCount: 2,
        assetIds,
        assetIdsReturned: 2,
        assetIdsTruncated: false,
        members: [
          {
            userId: auth.user.id,
            name: 'Pierre',
            role: 'viewer',
            avatarColor: 'blue',
            profileImagePath: '/profile.jpg',
          },
        ],
      } satisfies Partial<AgentSpaceDetail>),
    });
    if (result.status === 'success') {
      expect(result.space.members[0]).not.toHaveProperty('email');
    }
    expect(sharedSpaceRepository.getAssetIdsInSpacePage).toHaveBeenCalledWith(space.id, { limit: 10_001 });
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        redactedResponseMetadata: expect.objectContaining({
          spaceIds: [space.id],
          assetIds,
          resultSize: expect.any(Object),
        }),
        albumCount: 0,
        assetCount: 2,
      }),
    );
  });

  it('readSpace rejects inaccessible or removed-membership spaces', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getMember.mockImplementation(() => Promise.resolve(void 0));

    const result = await sut.readSpace(auth, session.id, { spaceId });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Space is not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(sharedSpaceRepository.getById).not.toHaveBeenCalled();
  });

  it('readSpace truncates many asset ids at 10000 without denying on total asset count', async () => {
    const auth = AuthFactory.create();
    const space = makeSpaceRow({ id: newUuid() });
    const member = makeSpaceMember({ spaceId: space.id, userId: auth.user.id });
    const returnedRows = Array.from({ length: 10_001 }, () => ({ assetId: newUuid() }));
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        assetScope: { owned: false, sharedSpaces: true, locked: false },
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1, maxAssetsPerSession: 20_000 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getMember.mockResolvedValue(member);
    sharedSpaceRepository.getById.mockResolvedValue(space);
    sharedSpaceRepository.getMembers.mockResolvedValue([member]);
    sharedSpaceRepository.getAssetCount.mockResolvedValue(10_005);
    sharedSpaceRepository.getAssetIdsInSpacePage.mockResolvedValue(returnedRows);

    const result = await sut.readSpace(auth, session.id, { spaceId: space.id });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({
        responseSummary: 'Returned space with 10000 of 10005 asset id(s)',
        assetCount: 10_000,
      }),
      space: expect.objectContaining({
        assetIds: returnedRows.slice(0, 10_000).map((row) => row.assetId),
        assetIdsReturned: 10_000,
        assetIdsTruncated: true,
        assetCount: 10_005,
      }),
    });
  });

  it('readSpace denies when returned asset ids exceed the remaining metadata session limit', async () => {
    const auth = AuthFactory.create();
    const space = makeSpaceRow({ id: newUuid() });
    const member = makeSpaceMember({ spaceId: space.id, userId: auth.user.id });
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({
        assetScope: { owned: false, sharedSpaces: true, locked: false },
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerSession: 1 },
      }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getMember.mockResolvedValue(member);
    sharedSpaceRepository.getById.mockResolvedValue(space);
    sharedSpaceRepository.getMembers.mockResolvedValue([member]);
    sharedSpaceRepository.getAssetCount.mockResolvedValue(assetIds.length);
    sharedSpaceRepository.getAssetIdsInSpacePage.mockResolvedValue(assetIds.map((assetId) => ({ assetId })));
    toolCallRepository.transitionWithSessionLimit.mockResolvedValue({
      status: 'limit-exceeded',
      toolCall: makeToolCall({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Session policy allows at most 1 assets per session',
      }),
    });

    const result = await sut.readSpace(auth, session.id, { spaceId: space.id });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Session policy allows at most 1 assets per session',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(toolCallRepository.transitionWithSessionLimit).toHaveBeenCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({ assetCount: 2, albumCount: 0 }),
      AgentToolDataClass.Metadata,
      1,
    );
  });

  it('strict listSpaces creates pending approval and approved retry resumes stored empty metadata', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });
    const pending = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ListSpaces,
      status: AgentToolCallStatus.PendingApproval,
      redactedRequestMetadata: {},
      assetCount: 0,
      albumCount: 0,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValueOnce(pending);

    const pendingResult = await sut.listSpaces(auth, session.id, {});

    expect(pendingResult.status).toBe('approval-required');
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: AgentToolName.ListSpaces, redactedRequestMetadata: {} }),
    );

    toolCallRepository.getByIdForSession.mockResolvedValue({ ...pending, status: AgentToolCallStatus.Approved });
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...pending, status: AgentToolCallStatus.Executing }),
    );

    const resumed = await sut.listSpaces(auth, session.id, { toolCallId: pending.id });

    expect(resumed.status).toBe('success');
    expect(sharedSpaceRepository.getAllByUserId).toHaveBeenCalledWith(auth.user.id);
  });

  it('strict readSpace approved retry revalidates membership and excludes the current tool call from session accounting', async () => {
    const auth = AuthFactory.create();
    const space = makeSpaceRow({ id: newUuid() });
    const member = makeSpaceMember({ spaceId: space.id, userId: auth.user.id });
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({
        assetScope: { owned: false, sharedSpaces: true, locked: false },
        limits: { ...permissionPlanSnapshot.limits, maxAssetsPerSession: 1 },
      }),
    });
    const approved = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ReadSpace,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      requestSummary: `Read space ${space.id}`,
      redactedRequestMetadata: { spaceId: space.id },
      assetCount: 0,
      albumCount: 0,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
    );
    sharedSpaceRepository.getMember.mockResolvedValue(member);
    sharedSpaceRepository.getById.mockResolvedValue(space);
    sharedSpaceRepository.getMembers.mockResolvedValue([member]);
    sharedSpaceRepository.getAssetCount.mockResolvedValue(1);
    sharedSpaceRepository.getAssetIdsInSpacePage.mockResolvedValue([{ assetId }]);

    const result = await sut.readSpace(auth, session.id, { toolCallId: approved.id });

    expect(result.status).toBe('success');
    expect(sharedSpaceRepository.getMember).toHaveBeenCalledWith(space.id, auth.user.id);
    expect(toolCallRepository.transitionWithSessionLimit).toHaveBeenCalledWith(
      session.id,
      approved.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({ assetCount: 1 }),
      AgentToolDataClass.Metadata,
      1,
    );
  });

  it('resolveAssetSearchFilters resolves exact visible names into canonical filters with shared timeline scope', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const tagId = newUuid();
    const albumId = newUuid();
    const spaceId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: 'timeline-space' }]);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: ['FUJIFILM'],
      tags: [{ id: tagId, value: 'Travel' }],
      people: [{ id: personId, name: 'Pierre' }],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });
    searchRepository.getCameraModels.mockResolvedValue(['X100VI', 'X-T5']);
    searchRepository.getCameraLensModels.mockResolvedValue(['23mm f/2']);
    albumRepository.getAgentAlbums.mockResolvedValue([
      makeAlbumSummary({ id: albumId, albumName: 'Berlin', ownerId: auth.user.id }),
    ]);
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([makeSpaceRow({ id: spaceId, name: 'Family' })]);
    toolCallRepository.transition.mockImplementation((_sessionId, _id, _expectedStatus, dto) =>
      Promise.resolve(
        makeToolCall({
          ...(dto as Partial<AgentToolCall>),
          id: _id,
          sessionId: _sessionId,
          toolName: AgentToolName.ResolveAssetSearchFilters,
          dataClass: AgentToolDataClass.Metadata,
        }),
      ),
    );

    const result = await sut.resolveAssetSearchFilters(auth, session.id, {
      people: ['pierre'],
      tags: ['travel'],
      albums: ['berlin'],
      spaces: ['family'],
      cameraMakes: ['fujifilm'],
      cameraModels: ['x100vi'],
      lensModels: ['23mm f/2'],
      scope: { withSharedSpaces: true },
    });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({
        toolName: AgentToolName.ResolveAssetSearchFilters,
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Resolved 7 search filter(s)',
        assetCount: 0,
        albumCount: 0,
      }),
      resolvedFilters: {
        tagIds: [tagId],
        albumIds: [albumId],
        spaceId,
        spacePersonIds: [personId],
        make: 'FUJIFILM',
        model: 'X100VI',
        lensModel: '23mm f/2',
      },
      results: expect.arrayContaining([
        expect.objectContaining({ kind: 'person', status: 'matched', id: personId }),
        expect.objectContaining({ kind: 'tag', status: 'matched', id: tagId }),
        expect.objectContaining({ kind: 'album', status: 'matched', id: albumId }),
        expect.objectContaining({ kind: 'space', status: 'matched', id: spaceId }),
        expect.objectContaining({
          kind: 'cameraMake',
          status: 'matched',
          value: 'FUJIFILM',
          choices: expect.arrayContaining([
            expect.objectContaining({ value: 'X100VI', searchFilter: { make: 'FUJIFILM', model: 'X100VI' } }),
          ]),
        }),
        expect.objectContaining({ kind: 'cameraModel', status: 'matched', value: 'X100VI' }),
        expect.objectContaining({ kind: 'lensModel', status: 'matched', value: '23mm f/2' }),
      ]),
    });
    expect(searchRepository.getFilterSuggestions).toHaveBeenCalledWith(
      [auth.user.id],
      expect.objectContaining({ spaceId }),
    );
    expect(searchRepository.getFilterSuggestions).toHaveBeenCalledWith(
      [auth.user.id],
      expect.not.objectContaining({ withSharedSpaces: true }),
    );
    expect(searchRepository.getFilterSuggestions).toHaveBeenCalledWith(
      [auth.user.id],
      expect.not.objectContaining({ timelineSpaceIds: expect.anything() }),
    );
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        redactedResponseMetadata: expect.objectContaining({
          albumIds: [albumId],
          spaceIds: [spaceId],
          resultSize: expect.any(Object),
        }),
      }),
    );
  });

  it('resolveAssetSearchFilters resolves people in a named shared space to spacePersonIds', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const spacePersonId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([makeSpaceRow({ id: spaceId, name: 'Family' })]);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [
        {
          id: spacePersonId,
          name: 'Alex',
          primaryProfile: { type: 'space-person', id: spacePersonId, spaceId },
        },
      ],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });

    const result = await sut.resolveAssetSearchFilters(auth, session.id, {
      people: ['Alex'],
      spaces: ['Family'],
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.resolvedFilters).toEqual({ spaceId, spacePersonIds: [spacePersonId] });
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'space', status: 'matched', id: spaceId }),
          expect.objectContaining({
            kind: 'person',
            status: 'matched',
            id: spacePersonId,
            searchFilter: { spaceId, spacePersonIds: [spacePersonId] },
          }),
        ]),
      );
    }
    expect(searchRepository.getFilterSuggestions).toHaveBeenCalledWith(
      [auth.user.id],
      expect.objectContaining({ spaceId }),
    );
  });

  it('resolveAssetSearchFilters uses explicit shared-space scope for people before global personIds', async () => {
    const auth = AuthFactory.create();
    const spaceId = newUuid();
    const spacePersonId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getMember.mockResolvedValue(makeSpaceMember({ spaceId, userId: auth.user.id }));
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [
        {
          id: spacePersonId,
          name: 'Alex',
          primaryProfile: { type: 'space-person', id: spacePersonId, spaceId },
        },
      ],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });

    const result = await sut.resolveAssetSearchFilters(auth, session.id, {
      people: ['Alex'],
      scope: { spaceId },
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.resolvedFilters).toEqual({ spaceId, spacePersonIds: [spacePersonId] });
    }
    expect(searchRepository.getFilterSuggestions).toHaveBeenCalledWith(
      [auth.user.id],
      expect.objectContaining({ spaceId }),
    );
  });

  it('resolveAssetSearchFilters returns choices for same-name global and shared people without a unique space', async () => {
    const auth = AuthFactory.create();
    const globalPersonId = newUuid();
    const spaceId = newUuid();
    const spacePersonId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId }]);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [
        {
          id: globalPersonId,
          name: 'Alex',
          primaryProfile: { type: 'user-person', id: globalPersonId },
        },
        {
          id: `space-person:${spacePersonId}`,
          name: 'Alex',
          primaryProfile: { type: 'space-person', id: spacePersonId, spaceId },
        },
      ],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });

    const result = await sut.resolveAssetSearchFilters(auth, session.id, {
      people: ['Alex'],
      scope: { withSharedSpaces: true },
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.resolvedFilters).toEqual({});
      expect(result.results).toEqual([
        expect.objectContaining({
          kind: 'person',
          status: 'ambiguous',
          choices: expect.arrayContaining([
            expect.objectContaining({ searchFilter: { personIds: [globalPersonId] } }),
            expect.objectContaining({ searchFilter: { spaceId, spacePersonIds: [spacePersonId] } }),
          ]),
        }),
      ]);
    }
  });

  it('resolveAssetSearchFilters does not leak hidden or inaccessible people as resolved filters', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });

    const result = await sut.resolveAssetSearchFilters(auth, session.id, { people: ['Hidden Person'] });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.resolvedFilters).toEqual({});
      expect(result.results).toEqual([
        expect.objectContaining({
          kind: 'person',
          query: 'Hidden Person',
          status: 'not_found',
          choices: [],
        }),
      ]);
    }
  });

  it('resolveAssetSearchFilters creates pending approval with the resolver term count in the request summary', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.resolveAssetSearchFilters(auth, session.id, {
      people: ['Pierre', 'Sam'],
      tags: ['Travel'],
      albums: ['Berlin'],
      cameraMakes: ['FUJIFILM'],
      scope: { takenAfter: now },
    });

    expect(result.status).toBe('approval-required');
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ResolveAssetSearchFilters,
        requestSummary: 'Resolve asset search filters (5 term(s))',
      }),
    );
  });

  it('resolveAssetSearchFilters returns ambiguous choices for duplicate exact visible album names', async () => {
    const auth = AuthFactory.create();
    const firstId = newUuid();
    const secondId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    albumRepository.getAgentAlbums.mockResolvedValue([
      makeAlbumSummary({ id: firstId, albumName: 'Trip', ownerId: auth.user.id }),
      makeAlbumSummary({ id: secondId, albumName: 'trip', ownerId: auth.user.id }),
    ]);

    const result = await sut.resolveAssetSearchFilters(auth, session.id, { albums: ['TRIP'] });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.resolvedFilters.albumIds).toBeUndefined();
      expect(result.results).toEqual([
        expect.objectContaining({
          kind: 'album',
          status: 'ambiguous',
          choices: [
            expect.objectContaining({ id: firstId, value: 'Trip' }),
            expect.objectContaining({ id: secondId, value: 'trip' }),
          ],
        }),
      ]);
    }
  });

  it('resolveAssetSearchFilters returns visible suggestions for missing tags and albums without leaking hidden names', async () => {
    const auth = AuthFactory.create();
    const visibleTagId = newUuid();
    const visibleAlbumId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [{ id: visibleTagId, value: 'Visible' }],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });
    albumRepository.getAgentAlbums.mockResolvedValue([
      makeAlbumSummary({ id: visibleAlbumId, albumName: 'Public', ownerId: auth.user.id }),
    ]);

    const result = await sut.resolveAssetSearchFilters(auth, session.id, {
      tags: ['Hidden'],
      albums: ['Secret'],
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.resolvedFilters).toEqual({});
      expect(result.results).toEqual([
        expect.objectContaining({
          kind: 'tag',
          status: 'not_found',
          choices: [expect.objectContaining({ id: visibleTagId, value: 'Visible' })],
        }),
        expect.objectContaining({
          kind: 'album',
          status: 'not_found',
          choices: [expect.objectContaining({ id: visibleAlbumId, value: 'Public' })],
        }),
      ]);
      expect(result.results.flatMap((item) => item.choices.map((choice) => choice.value))).not.toContain('Secret');
    }
  });

  it('resolveAssetSearchFilters prefers related not_found suggestions beyond the first five visible candidates', async () => {
    const auth = AuthFactory.create();
    const relevantTagId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [
        { id: newUuid(), value: 'Alpha' },
        { id: newUuid(), value: 'Bravo' },
        { id: newUuid(), value: 'Charlie' },
        { id: newUuid(), value: 'Delta' },
        { id: newUuid(), value: 'Echo' },
        { id: relevantTagId, value: 'Berlin travel' },
      ],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });

    const result = await sut.resolveAssetSearchFilters(auth, session.id, { tags: ['Berlin'] });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.results).toEqual([
        expect.objectContaining({
          kind: 'tag',
          status: 'not_found',
          choices: [expect.objectContaining({ id: relevantTagId, value: 'Berlin travel' })],
        }),
      ]);
    }
  });

  it('resolveAssetSearchFilters does not leak owned tag suggestions for shared-only sessions', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: newUuid() }]);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [{ id: newUuid(), value: 'OwnedTag' }],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });

    const result = await sut.resolveAssetSearchFilters(auth, session.id, { tags: ['OwnedTag'] });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.resolvedFilters).toEqual({});
      expect(result.results).toEqual([
        expect.objectContaining({
          kind: 'tag',
          query: 'OwnedTag',
          status: 'not_found',
          choices: [],
        }),
      ]);
    }
    expect(sharedSpaceRepository.getSpaceIdsForTimeline).toHaveBeenCalledWith(auth.user.id);
    expect(searchRepository.getFilterSuggestions).not.toHaveBeenCalled();
  });

  it('resolveAssetSearchFilters does not leak owned camera model suggestions for shared-only sessions', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([{ spaceId: newUuid() }]);
    searchRepository.getCameraModels.mockResolvedValue(['OwnedCam']);

    const result = await sut.resolveAssetSearchFilters(auth, session.id, { cameraModels: ['OwnedCam'] });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.resolvedFilters).toEqual({});
      expect(result.results).toEqual([
        expect.objectContaining({
          kind: 'cameraModel',
          query: 'OwnedCam',
          status: 'not_found',
          choices: [],
        }),
      ]);
    }
    expect(sharedSpaceRepository.getSpaceIdsForTimeline).toHaveBeenCalledWith(auth.user.id);
    expect(searchRepository.getCameraModels).not.toHaveBeenCalled();
  });

  it('resolveAssetSearchFilters denies shared-space scope when session cannot access shared spaces', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.resolveAssetSearchFilters(auth, session.id, {
      spaces: ['Family'],
      scope: { withSharedSpaces: true },
    });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Shared spaces are not accessible for this session',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(searchRepository.getFilterSuggestions).not.toHaveBeenCalled();
    expect(sharedSpaceRepository.getAllByUserId).not.toHaveBeenCalled();
    expect(sharedSpaceRepository.getSpaceIdsForTimeline).not.toHaveBeenCalled();
  });

  it('resolveAssetSearchFilters approved retry uses stored redacted metadata', async () => {
    const auth = AuthFactory.create();
    const tagId = newUuid();
    const session = makeSession({ userId: auth.user.id });
    const approved = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ResolveAssetSearchFilters,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      requestSummary: 'Resolve asset search filters',
      redactedRequestMetadata: { tags: ['Travel'] } satisfies AgentResolveAssetSearchFiltersToolRequestDto,
      assetCount: 0,
      albumCount: 0,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
    );
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [{ id: tagId, value: 'Travel' }],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });

    const result = await sut.resolveAssetSearchFilters(auth, session.id, { toolCallId: approved.id });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.resolvedFilters).toEqual({ tagIds: [tagId] });
    }
    expect(searchRepository.getFilterSuggestions).toHaveBeenCalledWith([auth.user.id], expect.any(Object));
  });

  it('resolveAssetSearchFilters treats case-only duplicate tags and duplicate people as ambiguous', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    searchRepository.getFilterSuggestions.mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [
        { id: newUuid(), value: 'Travel' },
        { id: newUuid(), value: 'travel' },
      ],
      people: [
        { id: newUuid(), name: 'Sam' },
        { id: newUuid(), name: 'sam' },
      ],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    });

    const result = await sut.resolveAssetSearchFilters(auth, session.id, {
      tags: ['TRAVEL'],
      people: ['SAM'],
    });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.resolvedFilters).toEqual({});
      expect(result.results).toEqual([
        expect.objectContaining({ kind: 'person', status: 'ambiguous', choices: expect.any(Array) }),
        expect.objectContaining({ kind: 'tag', status: 'ambiguous', choices: expect.any(Array) }),
      ]);
    }
  });

  it('searchUsers returns visible users filtered by name or email without asset accounting', async () => {
    const auth = AuthFactory.create();
    const pierreId = newUuid();
    const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

    sessionRepository.getById.mockResolvedValue(session);
    userService.search.mockResolvedValue([
      makeUserResponse({ id: pierreId, name: 'Pierre Marais', email: 'pierre@example.com', avatarColor: 'blue' }),
      makeUserResponse({ name: 'Sam Example', email: 'sam@example.com' }),
    ] as never);
    toolCallRepository.transition.mockImplementation((_sessionId, _id, _expectedStatus, dto) =>
      Promise.resolve(
        makeToolCall({
          ...(dto as Partial<AgentToolCall>),
          id: _id,
          sessionId: _sessionId,
          toolName: AgentToolName.SearchUsers,
          dataClass: AgentToolDataClass.Metadata,
        }),
      ),
    );

    const result = await sut.searchUsers(auth, session.id, { query: 'pierre', limit: 10 });

    expect(result).toEqual({
      status: 'success',
      resultSize: expect.any(Object),
      toolCall: expect.objectContaining({
        toolName: AgentToolName.SearchUsers,
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Returned 1 user(s)',
        assetCount: 0,
        albumCount: 0,
      }),
      users: [
        makeUserResult({
          userId: pierreId,
          name: 'Pierre Marais',
          email: 'pierre@example.com',
          avatarColor: 'blue',
          profileImagePath: null,
        }),
      ],
    });
    expect(userService.search).toHaveBeenCalledWith(auth);
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        redactedRequestMetadata: { query: 'pierre', limit: 10 },
        assetCount: 0,
        albumCount: 0,
      }),
    );
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      expect.any(String),
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        redactedResponseMetadata: expect.objectContaining({ userIds: [pierreId], resultSize: expect.any(Object) }),
        assetCount: 0,
        albumCount: 0,
      }),
    );
  });

  it('searchUsers creates a pending approval in strict mode and resumes from stored request', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const pending = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.SearchUsers,
      status: AgentToolCallStatus.PendingApproval,
      redactedRequestMetadata: { query: 'sam', limit: 2 },
      assetCount: 0,
      albumCount: 0,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValueOnce(pending);

    const pendingResult = await sut.searchUsers(auth, session.id, { query: 'sam', limit: 2 });

    expect(pendingResult.status).toBe('approval-required');
    expect(userService.search).not.toHaveBeenCalled();

    toolCallRepository.getByIdForSession.mockResolvedValue({ ...pending, status: AgentToolCallStatus.Approved });
    userService.search.mockResolvedValue([
      makeUserResponse({ name: 'Sam Example', email: 'sam@example.com' }),
    ] as never);

    const resumed = await sut.searchUsers(auth, session.id, { toolCallId: pending.id });

    expect(resumed.status).toBe('success');
    expect(userService.search).toHaveBeenCalledWith(auth);
  });

  it('lists historical tool calls after completed session', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Completed });
    const toolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Completed, completedAt });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getBySessionId.mockResolvedValue([toolCall]);

    const result = await sut.getToolCalls(auth, session.id);

    expect(result).toEqual([expect.objectContaining({ id: toolCall.id, status: AgentToolCallStatus.Completed })]);
    expect(toolCallRepository.getBySessionId).toHaveBeenCalledWith(session.id);
  });

  it.each([
    {
      decision: AgentToolApprovalDecision.Approved,
      expectedStatus: AgentToolCallStatus.Approved,
      responseSummary: 'Tool call approved by user',
      redactedResponseMetadata: null,
      error: null,
      completedAt: null,
    },
    {
      decision: AgentToolApprovalDecision.Denied,
      reason: 'No thanks',
      expectedStatus: AgentToolCallStatus.Denied,
      responseSummary: null,
      redactedResponseMetadata: null,
      error: 'No thanks',
      completedAt,
    },
  ])('records $decision approval decision and restores session running', async (caseData) => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForToolApproval });
    const pending = makeToolCall({ sessionId: session.id });
    const transitioned = makeToolCall({
      ...pending,
      status: caseData.expectedStatus,
      approvalDecision: caseData.decision,
      responseSummary: caseData.responseSummary,
      completedAt: caseData.completedAt,
      error: caseData.error,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(pending);
    toolCallRepository.transition.mockResolvedValue(transitioned);

    const result = await sut.approveToolCall(auth, session.id, pending.id, {
      decision: caseData.decision,
      reason: caseData.reason,
    } as AgentToolApprovalDto);

    expect(result).toEqual(expect.objectContaining({ status: caseData.expectedStatus, error: caseData.error }));
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      session.id,
      pending.id,
      AgentToolCallStatus.PendingApproval,
      {
        status: caseData.expectedStatus,
        approvalDecision: caseData.decision,
        responseSummary: caseData.responseSummary,
        redactedResponseMetadata: null,
        completedAt: caseData.completedAt === null ? null : expect.any(Date),
        error: caseData.error,
      },
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
    });
  });

  it('keeps empty result-size telemetry when a pending read call is denied by the user', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForToolApproval });
    const pending = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.PendingApproval,
      redactedResponseMetadata: { resultSize: emptyResultSize() },
    });
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(pending);
    toolCallRepository.transition.mockResolvedValue(
      makeToolCall({
        ...pending,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        redactedResponseMetadata: { resultSize: emptyResultSize() },
      }),
    );

    const result = await sut.approveToolCall(auth, pending.sessionId, pending.id, {
      decision: AgentToolApprovalDecision.Denied,
      reason: 'Too broad',
    });

    expect(result.resultSize).toEqual(emptyResultSize());
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      pending.sessionId,
      pending.id,
      AgentToolCallStatus.PendingApproval,
      expect.objectContaining({
        redactedResponseMetadata: { resultSize: emptyResultSize() },
      }),
    );
  });

  it('resumes a runner-backed session after a denied approval decision', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForToolApproval,
      runnerSessionId: 'runner-session-1',
    });
    const pending = makeToolCall({ sessionId: session.id });
    const denied = makeToolCall({
      ...pending,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      responseSummary: null,
      error: 'Use fewer photos',
      completedAt,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(pending);
    toolCallRepository.transition.mockResolvedValue(denied);

    const result = await sut.approveToolCall(auth, session.id, pending.id, {
      decision: AgentToolApprovalDecision.Denied,
      reason: 'Use fewer photos',
    });
    await flushAsync();

    expect(result).toEqual(
      expect.objectContaining({
        id: pending.id,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Use fewer photos',
      }),
    );
    expect(agentRunnerService.resumeAfterToolApproval).toHaveBeenCalledTimes(1);
    expect(agentRunnerService.resumeAfterToolApproval).toHaveBeenCalledWith({
      userId: auth.user.id,
      sessionId: session.id,
      runnerSessionId: 'runner-session-1',
      toolCallId: pending.id,
      approvalDecision: AgentToolApprovalDecision.Denied,
      toolResult: undefined,
    });
  });

  it('executes an approved read tool before resuming a runner-backed session', async () => {
    const auth = AuthFactory.create();
    const album = makeAlbumSummary({ ownerId: auth.user.id });
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForToolApproval,
      runnerSessionId: 'runner-session-1',
    });
    const pending = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ListAlbums,
      requestSummary: 'List albums',
      redactedRequestMetadata: {},
      assetCount: 0,
      albumCount: 0,
    });
    const transitioned = makeToolCall({
      ...pending,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Tool call approved by user',
    });
    const executing = makeToolCall({ ...transitioned, status: AgentToolCallStatus.Executing });
    const completed = makeToolCall({
      ...transitioned,
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Returned 1 album(s)',
      redactedResponseMetadata: { albumIds: [album.id] },
      albumCount: 1,
      completedAt,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValueOnce(pending).mockResolvedValueOnce(transitioned);
    toolCallRepository.transition
      .mockResolvedValueOnce(transitioned)
      .mockResolvedValueOnce(executing)
      .mockResolvedValueOnce(completed);
    albumRepository.getAgentAlbums.mockResolvedValue([album]);

    await sut.approveToolCall(auth, session.id, pending.id, { decision: AgentToolApprovalDecision.Approved });
    await flushAsync();
    await flushAsync();

    expect(agentRunnerService.resumeAfterToolApproval).toHaveBeenCalledWith({
      userId: auth.user.id,
      sessionId: session.id,
      runnerSessionId: 'runner-session-1',
      toolCallId: pending.id,
      approvalDecision: AgentToolApprovalDecision.Approved,
      toolResult: expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        albums: [album],
        toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
      }),
    });
  });

  it('resumes the runner with an error tool result when an approved read tool fails', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForToolApproval,
      runnerSessionId: 'runner-session-1',
    });
    const pending = makeToolCall({
      sessionId: session.id,
      toolName: AgentToolName.ReadAssetMetadata,
      redactedRequestMetadata: { assetIds: [newUuid()] },
      assetCount: 1,
    });
    const approved = makeToolCall({
      ...pending,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Tool call approved by user',
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValueOnce(pending).mockResolvedValueOnce(approved);
    toolCallRepository.transition.mockResolvedValueOnce(approved).mockRejectedValueOnce(new Error('asset read failed'));

    await sut.approveToolCall(auth, session.id, pending.id, { decision: AgentToolApprovalDecision.Approved });
    await flushAsync();
    await flushAsync();

    expect(agentRunnerService.resumeAfterToolApproval).toHaveBeenCalledTimes(1);
    expect(agentRunnerService.resumeAfterToolApproval).toHaveBeenCalledWith({
      userId: auth.user.id,
      sessionId: session.id,
      runnerSessionId: 'runner-session-1',
      toolCallId: pending.id,
      approvalDecision: AgentToolApprovalDecision.Approved,
      toolResult: {
        status: 'error',
        message: 'Approved tool call failed before returning a result.',
      },
    });
  });

  it('marks the session interrupted when runner continuation fails after approval', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForToolApproval,
      runnerSessionId: 'runner-session-1',
    });
    const pending = makeToolCall({ sessionId: session.id });
    const approved = makeToolCall({
      ...pending,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Tool call approved by user',
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(pending);
    toolCallRepository.transition.mockResolvedValue(approved);
    sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);
    agentRunnerService.resumeAfterToolApproval.mockRejectedValue(
      new Error('Agent session already has a message in progress'),
    );

    await sut.approveToolCall(auth, session.id, pending.id, { decision: AgentToolApprovalDecision.Approved });
    await flushAsync();
    await flushAsync();

    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
    });
    expect(sessionRepository.markInterruptedFromActive).toHaveBeenCalledWith(auth.user.id, session.id);
  });

  it('does not try to resume a runner when approving a session without a runner session id', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      status: AgentSessionStatus.WaitingForToolApproval,
      runnerSessionId: null,
    });
    const pending = makeToolCall({ sessionId: session.id });
    const transitioned = makeToolCall({
      ...pending,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Tool call approved by user',
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(pending);
    toolCallRepository.transition.mockResolvedValue(transitioned);

    await sut.approveToolCall(auth, session.id, pending.id, { decision: AgentToolApprovalDecision.Approved });

    expect(agentRunnerService.resumeAfterToolApproval).not.toHaveBeenCalled();
  });

  it('rejects non-pending approval without transition, session update, or runner continuation', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      runnerSessionId: 'runner-session-1',
    });
    const toolCall = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Completed, completedAt });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(toolCall);

    await expect(
      sut.approveToolCall(auth, session.id, toolCall.id, { decision: AgentToolApprovalDecision.Approved }),
    ).rejects.toThrow('Agent tool call is not pending approval');

    expect(toolCallRepository.transition).not.toHaveBeenCalled();
    expect(sessionRepository.update).not.toHaveBeenCalled();
    expect(agentRunnerService.resumeAfterToolApproval).not.toHaveBeenCalled();
  });

  it('returns denied without transition or asset read when executing an already-denied tool call', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const denied = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      error: null,
      completedAt,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(denied);

    const result = await sut.readAssetMetadata(auth, session.id, { toolCallId: denied.id });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Tool call was denied',
      toolCall: expect.objectContaining({ id: denied.id, status: AgentToolCallStatus.Denied }),
    });
    expect(toolCallRepository.transition).not.toHaveBeenCalled();
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('throws without transition or asset read when executing a non-approved and non-denied tool call', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const pending = makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.PendingApproval });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(pending);

    await expect(sut.readAssetMetadata(auth, session.id, { toolCallId: pending.id })).rejects.toThrow(
      'Agent tool call has not been approved',
    );
    expect(toolCallRepository.transition).not.toHaveBeenCalled();
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('executes approved metadata reads by claiming, revalidating, reading, completing audit, and returning ordered assets', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id });
    const approved = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds },
      assetCount: 1,
    });
    const executing = makeToolCall({ ...approved, status: AgentToolCallStatus.Executing });
    const asset = makeMetadata(assetIds[0], { leaked: 'ignore me' });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition
      .mockResolvedValueOnce(executing)
      .mockResolvedValueOnce(makeToolCall({ ...approved, status: AgentToolCallStatus.Completed, completedAt }));
    toolCallRepository.getCountedAssetCountBySession.mockResolvedValue(0);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([asset] as never);

    const result = await sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id });

    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      1,
      session.id,
      approved.id,
      AgentToolCallStatus.Approved,
      {
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Tool call execution started',
        redactedResponseMetadata: null,
        completedAt: null,
        error: null,
      },
    );
    expect(toolCallRepository.getCountedAssetCountBySession).toHaveBeenCalledWith(session.id, approved.id);
    expect(assetRepository.getAgentMetadataByIds).toHaveBeenCalledWith(assetIds);
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      2,
      session.id,
      approved.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Returned basic metadata for 1 asset',
        redactedResponseMetadata: expect.objectContaining({ assetIds, resultSize: expect.any(Object) }),
        assetCount: 1,
        albumCount: 0,
        completedAt: expect.any(Date),
        error: null,
      }),
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
    });
    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        toolCall: expect.objectContaining({ status: AgentToolCallStatus.Completed }),
        assets: [expect.objectContaining({ id: assetIds[0] })],
      }),
    );
    if (result.status !== 'success') {
      throw new Error(`Expected success response, got ${result.status}`);
    }
    expect(result.assets[0]).not.toHaveProperty('leaked');
  });

  it('defaults approved legacy metadata reads with only assetIds to basic detail', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id });
    const approved = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds },
      assetCount: 1,
    });
    const executing = makeToolCall({ ...approved, status: AgentToolCallStatus.Executing });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition
      .mockResolvedValueOnce(executing)
      .mockResolvedValueOnce(makeToolCall({ ...approved, status: AgentToolCallStatus.Completed, completedAt }));
    toolCallRepository.getCountedAssetCountBySession.mockResolvedValue(0);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetIds[0])] as never);

    const result = await sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id });

    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      2,
      session.id,
      approved.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        responseSummary: 'Returned basic metadata for 1 asset',
        redactedResponseMetadata: expect.objectContaining({ assetIds, resultSize: expect.any(Object) }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        resultSize: expect.any(Object),
        summary: 'Returned basic metadata for 1 asset',
        detail: 'basic',
        fields: ['type', 'dates'],
      }),
    );
  });

  it('approved metadata read retry with wrong-domain stored person id denies and rethrows recoverable error', async () => {
    const auth = AuthFactory.create();
    const personId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: true, locked: false } }),
    });
    const approved = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds: [personId], detail: 'basic' },
      assetCount: 1,
    });
    const executing = makeToolCall({ ...approved, status: AgentToolCallStatus.Executing });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition
      .mockResolvedValueOnce(executing)
      .mockResolvedValueOnce(makeToolCall({ ...approved, status: AgentToolCallStatus.Denied }));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    accessRepository.person.checkOwnerAccess.mockResolvedValue(new Set([personId]));
    accessRepository.person.checkSharedSpaceAccess.mockResolvedValue(new Set());

    const thrown = await sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id }).catch((error) => error);

    expect(thrown).toBeInstanceOf(AgentMcpRecoverableToolError);
    expect((thrown as AgentMcpRecoverableToolError).content).toMatchObject({
      status: 'error',
      error: 'That value is a person ID, not an asset ID.',
      recovery: {
        kind: 'wrong_id_domain',
        field: 'assetIds',
        expectedDomain: 'asset',
        receivedDomain: 'person',
      },
    });
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      2,
      session.id,
      approved.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        responseSummary: null,
        redactedResponseMetadata: expect.objectContaining({ resultSize: emptyResultSize() }),
        completedAt: expect.any(Date),
        error: 'That value is a person ID, not an asset ID.',
      }),
    );
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('prevents asset read when execution claim loses a race', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id });
    const approved = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds },
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockImplementation(() =>
      Promise.resolve(null as unknown as AgentToolCall | undefined),
    );

    await expect(sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id })).rejects.toThrow(
      'Agent tool call is already executing or completed',
    );
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('throws without repository reads when the session is inactive after execution claim', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id });
    const inactiveSession = makeSession({
      ...session,
      status: AgentSessionStatus.Completed,
      endedAt: completedAt,
    });
    const approved = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds },
    });

    sessionRepository.getById.mockResolvedValueOnce(session).mockResolvedValueOnce(inactiveSession);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
    );

    await expect(sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id })).rejects.toThrow(
      'Agent session not found',
    );
    expect(sessionRepository.getById).toHaveBeenCalledTimes(2);
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      2,
      session.id,
      approved.id,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Failed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: null,
        redactedResponseMetadata: null,
        completedAt: expect.any(Date),
        error: 'Agent session not found',
      },
    );
    expect(toolCallRepository.getCountedAssetCountBySession).not.toHaveBeenCalled();
    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('records denied and restores session when access drifts after approval', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id });
    const approved = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds },
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());

    const result = await sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more assets are not accessible',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(toolCallRepository.transition).toHaveBeenLastCalledWith(
      session.id,
      approved.id,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        responseSummary: null,
        redactedResponseMetadata: { resultSize: emptyResultSize() },
        completedAt: expect.any(Date),
        error: 'One or more assets are not accessible',
      },
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
    });
  });

  it('records denied using the refreshed permission plan after execution claim', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id });
    const refreshedSession = makeSession({
      ...session,
      permissionPlanSnapshot: makePlan({ read: { metadata: false, previews: false, originals: false } }),
    });
    const approved = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds },
    });

    sessionRepository.getById.mockResolvedValueOnce(session).mockResolvedValueOnce(refreshedSession);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
    );

    const result = await sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Agent permission policy does not allow metadata reads',
      toolCall: expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        error: 'Agent permission policy does not allow metadata reads',
      }),
    });
    expect(toolCallRepository.transition).toHaveBeenLastCalledWith(
      refreshedSession.id,
      approved.id,
      AgentToolCallStatus.Executing,
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        error: 'Agent permission policy does not allow metadata reads',
      }),
    );
    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('records denied and restores session when per-session limit drifts after approval', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: makePlan({ limits: { ...permissionPlanSnapshot.limits, maxAssetsPerSession: 2 } }),
    });
    const approved = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds },
      assetCount: 2,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
    );
    toolCallRepository.getCountedAssetCountBySession.mockResolvedValue(1);

    const result = await sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id });

    expect(result).toEqual({
      status: 'denied',
      reason: 'Session policy allows at most 2 assets per session',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
    });
    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
    expect(toolCallRepository.getCountedAssetCountBySession).toHaveBeenCalledWith(session.id, approved.id);
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
    });
  });

  it.each([
    {
      name: 'read.metadata disabled',
      sessionOverrides: {
        permissionPlanSnapshot: makePlan({ read: { metadata: false, previews: false, originals: false } }),
      },
      reason: 'Agent permission policy does not allow metadata reads',
    },
    {
      name: 'providerExposure.metadata disabled',
      sessionOverrides: {
        permissionPlanSnapshot: makePlan({
          providerExposure: {
            metadata: false,
            previews: false,
            originals: false,
            allowOriginalsForExternalProviders: false,
          },
        }),
      },
      reason: 'Agent provider exposure policy does not allow metadata reads',
    },
  ])(
    'records denied and restores session when approval-time policy drifts: $name',
    async ({ sessionOverrides, reason }) => {
      const auth = AuthFactory.create();
      const assetIds = [newUuid()];
      const session = makeSession({ userId: auth.user.id, ...sessionOverrides });
      const approved = makeToolCall({
        sessionId: session.id,
        status: AgentToolCallStatus.Approved,
        approvalDecision: AgentToolApprovalDecision.Approved,
        redactedRequestMetadata: { assetIds },
      });

      sessionRepository.getById.mockResolvedValue(session);
      toolCallRepository.getByIdForSession.mockResolvedValue(approved);
      toolCallRepository.transition.mockResolvedValueOnce(
        makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
      );

      const result = await sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id });

      expect(result).toEqual({
        status: 'denied',
        reason,
        toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied, error: reason }),
      });
      expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
        1,
        session.id,
        approved.id,
        AgentToolCallStatus.Approved,
        {
          status: AgentToolCallStatus.Executing,
          approvalDecision: AgentToolApprovalDecision.Approved,
          responseSummary: 'Tool call execution started',
          redactedResponseMetadata: null,
          completedAt: null,
          error: null,
        },
      );
      expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
        2,
        session.id,
        approved.id,
        AgentToolCallStatus.Executing,
        {
          status: AgentToolCallStatus.Denied,
          approvalDecision: AgentToolApprovalDecision.Denied,
          responseSummary: null,
          redactedResponseMetadata: { resultSize: emptyResultSize() },
          completedAt: expect.any(Date),
          error: reason,
        },
      );
      expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
        status: AgentSessionStatus.Running,
      });
      expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
    },
  );

  it('records failed and restores session when an asset disappears after revalidation', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid(), newUuid()];
    const session = makeSession({ userId: auth.user.id });
    const approved = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds },
      assetCount: 2,
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetIds[0])] as never);

    const result = await sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id });

    expect(result).toEqual({
      status: 'denied',
      reason: 'One or more assets were not found during metadata read',
      toolCall: expect.objectContaining({ status: AgentToolCallStatus.Failed }),
    });
    expect(toolCallRepository.transition).toHaveBeenLastCalledWith(
      session.id,
      approved.id,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Failed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: null,
        redactedResponseMetadata: { assetIds: [assetIds[0]] },
        completedAt: expect.any(Date),
        error: 'One or more assets were not found during metadata read',
      },
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
    });
  });

  it('records failed, restores session, and rethrows when metadata repository throws', async () => {
    const auth = AuthFactory.create();
    const assetIds = [newUuid()];
    const session = makeSession({ userId: auth.user.id });
    const approved = makeToolCall({
      sessionId: session.id,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedRequestMetadata: { assetIds },
    });

    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.getByIdForSession.mockResolvedValue(approved);
    toolCallRepository.transition.mockResolvedValueOnce(
      makeToolCall({ ...approved, status: AgentToolCallStatus.Executing }),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
    assetRepository.getAgentMetadataByIds.mockRejectedValue(new Error('database unavailable'));

    await expect(sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id })).rejects.toThrow(
      'database unavailable',
    );
    expect(toolCallRepository.transition).toHaveBeenLastCalledWith(
      session.id,
      approved.id,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Failed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: null,
        redactedResponseMetadata: null,
        completedAt: expect.any(Date),
        error: 'Metadata read failed',
      },
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Running,
    });
  });

  it('rejects YOLO reads for inactive sessions without creating audit rows', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.DangerouslySkipPermissions,
      status: AgentSessionStatus.Completed,
      endedAt: completedAt,
    });

    sessionRepository.getById.mockResolvedValue(session);

    await expect(sut.readAssetMetadata(auth, session.id, { assetIds: [newUuid()] })).rejects.toThrow(
      'Agent session not found',
    );
    expect(toolCallRepository.create).not.toHaveBeenCalled();
    expect(toolCallRepository.createWithSessionLimit).not.toHaveBeenCalled();
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when the session is missing', async () => {
    const auth = AuthFactory.create();

    sessionRepository.getById.mockImplementation(() => Promise.resolve(null as unknown as AgentSession | undefined));

    await expect(sut.readAssetMetadata(auth, newUuid(), { assetIds: [newUuid()] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // --- listDuplicateGroups ---

  it('listDuplicateGroups returns scrubbed groups — only keep-rule fields, no EXIF dump, no URLs', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });
    const duplicateId = newUuid();
    const assetId1 = newUuid();
    const assetId2 = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    duplicateRepository.getAll.mockResolvedValue([
      {
        duplicateId,
        assets: [
          {
            id: assetId1,
            originalFileName: 'photo1.jpg',
            fileCreatedAt: now,
            isFavorite: true,
            width: 1920,
            height: 1080,
            exifInfo: {
              rating: 4,
              exifImageWidth: 1920,
              exifImageHeight: 1080,
              // extra fields that MUST NOT leak into agent output
              latitude: 52.52,
              longitude: 13.405,
              city: 'Berlin',
              state: 'Berlin',
              country: 'Germany',
              make: 'Nikon',
              model: 'Zf',
              lensModel: '40mm',
              dateTimeOriginal: now,
            },
          } as never,
          {
            id: assetId2,
            originalFileName: 'photo2.jpg',
            fileCreatedAt: now,
            isFavorite: false,
            width: null,
            height: null,
            exifInfo: null,
          } as never,
        ],
      },
    ] as never);

    const result = await sut.listDuplicateGroups(auth, session.id, {});

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    expect(result.groups).toHaveLength(1);
    const group = result.groups[0];
    expect(group.duplicateId).toBe(duplicateId);
    expect(group.assets).toHaveLength(2);

    const first = group.assets[0];
    // Required keep-rule fields present
    expect(first.id).toBe(assetId1);
    expect(first.originalFileName).toBe('photo1.jpg');
    expect(first.isFavorite).toBe(true);
    expect(first.rating).toBe(4);
    expect(first.width).toBe(1920);
    expect(first.height).toBe(1080);
    // sharpness present (null — no mock for quality lookup in this test)
    expect(first).toHaveProperty('sharpness');
    // EXIF dump must NOT leak
    expect(first).not.toHaveProperty('latitude');
    expect(first).not.toHaveProperty('longitude');
    expect(first).not.toHaveProperty('city');
    expect(first).not.toHaveProperty('country');
    expect(first).not.toHaveProperty('make');
    expect(first).not.toHaveProperty('model');
    expect(first).not.toHaveProperty('exifInfo');
    // Other quality fields must NOT leak
    expect(first).not.toHaveProperty('exposure');
    expect(first).not.toHaveProperty('brightness');
    expect(first).not.toHaveProperty('quality');
    // Media URLs must NOT be present
    expect(first).not.toHaveProperty('thumbhash');
    expect(first).not.toHaveProperty('originalPath');
    expect(first).not.toHaveProperty('previewUrl');

    const second = group.assets[1];
    expect(second.rating).toBeNull();
    expect(second.width).toBeNull();
    expect(second.height).toBeNull();
    // sharpness must be present (null for unscored, no other quality fields)
    expect(second).toHaveProperty('sharpness');
    expect(second).not.toHaveProperty('exposure');
    expect(second).not.toHaveProperty('brightness');
    expect(second).not.toHaveProperty('quality');
  });

  it('listDuplicateGroups includes per-asset sharpness from quality lookup', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });
    const duplicateId = newUuid();
    const assetId1 = newUuid();
    const assetId2 = newUuid();
    const assetId3 = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    duplicateRepository.getAll.mockResolvedValue([
      {
        duplicateId,
        assets: [
          {
            id: assetId1,
            originalFileName: 'a.jpg',
            fileCreatedAt: now,
            isFavorite: false,
            width: null,
            height: null,
            exifInfo: null,
          },
          {
            id: assetId2,
            originalFileName: 'b.jpg',
            fileCreatedAt: now,
            isFavorite: false,
            width: null,
            height: null,
            exifInfo: null,
          },
          {
            id: assetId3,
            originalFileName: 'c.jpg',
            fileCreatedAt: now,
            isFavorite: false,
            width: null,
            height: null,
            exifInfo: null,
          },
        ],
      },
    ] as never);
    assetRepository.getAssetQualityByIds.mockResolvedValue([
      { assetId: assetId1, sharpness: 91 },
      { assetId: assetId2, sharpness: 55 },
      // assetId3 has no quality row → sharpness should be null
    ] as never);

    const result = await sut.listDuplicateGroups(auth, session.id, {});

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }

    const assets = result.groups[0].assets;
    expect(assets[0].sharpness).toBe(91);
    expect(assets[1].sharpness).toBe(55);
    expect(assets[2].sharpness).toBeNull();
    // No other quality fields should leak
    for (const asset of assets) {
      expect(asset).not.toHaveProperty('exposure');
      expect(asset).not.toHaveProperty('brightness');
      expect(asset).not.toHaveProperty('quality');
    }
  });

  it('listDuplicateGroups caps to maxGroups', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    duplicateRepository.getAll.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        duplicateId: newUuid(),
        assets: [
          {
            id: newUuid(),
            originalFileName: `a${i}.jpg`,
            fileCreatedAt: now,
            isFavorite: false,
            width: null,
            height: null,
            exifInfo: null,
          },
          {
            id: newUuid(),
            originalFileName: `b${i}.jpg`,
            fileCreatedAt: now,
            isFavorite: false,
            width: null,
            height: null,
            exifInfo: null,
          },
        ],
      })) as never,
    );

    const result = await sut.listDuplicateGroups(auth, session.id, { maxGroups: 3 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.groups).toHaveLength(3);
  });

  it('listDuplicateGroups returns empty groups when no duplicates exist', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
      permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: false } }),
    });

    sessionRepository.getById.mockResolvedValue(session);
    duplicateRepository.getAll.mockResolvedValue([] as never);

    const result = await sut.listDuplicateGroups(auth, session.id, {});

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.groups).toHaveLength(0);
  });

  it('resolveLocation returns matched when a single strong row is returned', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    sessionRepository.getById.mockResolvedValue(session);
    mapRepository.searchPlaces.mockResolvedValue([
      {
        name: 'Paris',
        admin1Name: 'Île-de-France',
        admin2Name: null,
        countryCode: 'FR',
        latitude: 48.8566,
        longitude: 2.3522,
        similarity: 1,
      },
    ]);

    const result = await sut.resolveLocation(auth, session.id, { query: 'Paris' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.location).toEqual({
      status: 'matched',
      latitude: 48.8566,
      longitude: 2.3522,
      label: 'Paris, Île-de-France, FR',
    });
  });

  it('resolveLocation returns ambiguous when two top places have near-equal similarity', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    sessionRepository.getById.mockResolvedValue(session);
    mapRepository.searchPlaces.mockResolvedValue([
      {
        name: 'Paris',
        admin1Name: 'Île-de-France',
        admin2Name: null,
        countryCode: 'FR',
        latitude: 48.8566,
        longitude: 2.3522,
        similarity: 0.95,
      },
      {
        name: 'Paris',
        admin1Name: 'Texas',
        admin2Name: null,
        countryCode: 'US',
        latitude: 33.6609,
        longitude: -95.5555,
        similarity: 0.9,
      },
    ]);

    const result = await sut.resolveLocation(auth, session.id, { query: 'Paris' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.location.status).toBe('ambiguous');
    if (result.location.status !== 'ambiguous') {
      return;
    }
    expect(result.location.choices).toHaveLength(2);
    expect(result.location.choices![0]).toMatchObject({
      latitude: 48.8566,
      longitude: 2.3522,
      label: 'Paris, Île-de-France, FR',
      countryCode: 'FR',
    });
    expect(result.location.choices![1]).toMatchObject({
      latitude: 33.6609,
      longitude: -95.5555,
      label: 'Paris, Texas, US',
      countryCode: 'US',
    });
  });

  it('resolveLocation returns not_found when repo returns empty array', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    sessionRepository.getById.mockResolvedValue(session);
    mapRepository.searchPlaces.mockResolvedValue([]);

    const result = await sut.resolveLocation(auth, session.id, { query: 'zzzqqq' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.location).toEqual({ status: 'not_found' });
  });

  it('resolveLocation returns matched for fuzzy query "Pariss" when repo returns Paris', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    sessionRepository.getById.mockResolvedValue(session);
    mapRepository.searchPlaces.mockResolvedValue([
      {
        name: 'Paris',
        admin1Name: 'Île-de-France',
        admin2Name: null,
        countryCode: 'FR',
        latitude: 48.8566,
        longitude: 2.3522,
        similarity: 0.75,
      },
    ]);

    const result = await sut.resolveLocation(auth, session.id, { query: 'Pariss' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.location.status).toBe('matched');
  });

  it('resolveLocation returns not_found when best similarity is below 0.30 floor', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    sessionRepository.getById.mockResolvedValue(session);
    mapRepository.searchPlaces.mockResolvedValue([
      {
        name: 'Parma',
        admin1Name: 'Emilia-Romagna',
        admin2Name: null,
        countryCode: 'IT',
        latitude: 44.8015,
        longitude: 10.3279,
        similarity: 0.2,
      },
    ]);

    const result = await sut.resolveLocation(auth, session.id, { query: 'xyz' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.location).toEqual({ status: 'not_found' });
  });

  it('resolveLocation gap rule: top 0.95 vs second 0.50 resolves as matched', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    sessionRepository.getById.mockResolvedValue(session);
    mapRepository.searchPlaces.mockResolvedValue([
      {
        name: 'Tokyo',
        admin1Name: 'Tokyo',
        admin2Name: null,
        countryCode: 'JP',
        latitude: 35.6762,
        longitude: 139.6503,
        similarity: 0.95,
      },
      {
        name: 'Tokyu',
        admin1Name: null,
        admin2Name: null,
        countryCode: 'JP',
        latitude: 35.66,
        longitude: 139.7,
        similarity: 0.5,
      },
    ]);

    const result = await sut.resolveLocation(auth, session.id, { query: 'Tokyo' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.location.status).toBe('matched');
    if (result.location.status !== 'matched') {
      return;
    }
    expect(result.location.label).toBe('Tokyo, Tokyo, JP');
  });

  it('resolveLocation gap rule: two exact homonyms with equal similarity resolves as ambiguous', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    sessionRepository.getById.mockResolvedValue(session);
    mapRepository.searchPlaces.mockResolvedValue([
      {
        name: 'Paris',
        admin1Name: 'Île-de-France',
        admin2Name: null,
        countryCode: 'FR',
        latitude: 48.8566,
        longitude: 2.3522,
        similarity: 1,
      },
      {
        name: 'Paris',
        admin1Name: 'Texas',
        admin2Name: null,
        countryCode: 'US',
        latitude: 33.6609,
        longitude: -95.5555,
        similarity: 1,
      },
    ]);

    const result = await sut.resolveLocation(auth, session.id, { query: 'Paris' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.location.status).toBe('ambiguous');
  });

  it('resolveLocation limits ambiguous choices to 5', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    sessionRepository.getById.mockResolvedValue(session);
    mapRepository.searchPlaces.mockResolvedValue([
      {
        name: 'Springfield',
        admin1Name: 'Illinois',
        admin2Name: null,
        countryCode: 'US',
        latitude: 39.7817,
        longitude: -89.6501,
        similarity: 0.9,
      },
      {
        name: 'Springfield',
        admin1Name: 'Missouri',
        admin2Name: null,
        countryCode: 'US',
        latitude: 37.2153,
        longitude: -93.2982,
        similarity: 0.85,
      },
      {
        name: 'Springfield',
        admin1Name: 'Oregon',
        admin2Name: null,
        countryCode: 'US',
        latitude: 44.0462,
        longitude: -123.022,
        similarity: 0.82,
      },
      {
        name: 'Springfield',
        admin1Name: 'Massachusetts',
        admin2Name: null,
        countryCode: 'US',
        latitude: 42.1015,
        longitude: -72.5898,
        similarity: 0.8,
      },
      {
        name: 'Springfield',
        admin1Name: 'Ohio',
        admin2Name: null,
        countryCode: 'US',
        latitude: 39.9242,
        longitude: -83.8088,
        similarity: 0.78,
      },
      {
        name: 'Springfield',
        admin1Name: 'Tennessee',
        admin2Name: null,
        countryCode: 'US',
        latitude: 36.509,
        longitude: -86.8853,
        similarity: 0.75,
      },
    ]);

    const result = await sut.resolveLocation(auth, session.id, { query: 'Springfield' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.location.status).toBe('ambiguous');
    if (result.location.status !== 'ambiguous') {
      return;
    }
    expect(result.location.choices!.length).toBeLessThanOrEqual(5);
  });

  it('resolveLocation creates pending approval in strict mode', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.resolveLocation(auth, session.id, { query: 'Paris' });

    expect(result.status).toBe('approval-required');
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.ResolveLocation,
        requestSummary: 'Resolve location: Paris',
      }),
    );
  });

  it('searchPeople returns matched when a single exact-name row is returned', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });
    const personId = newUuid();
    const assetId = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    personRepository.getByName.mockResolvedValue([
      { id: personId, name: 'Alice', faceAssetId: assetId, ownerId: auth.user.id } as never,
    ]);

    const result = await sut.searchPeople(auth, session.id, { name: 'Alice' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.people).toEqual({
      status: 'matched',
      personId,
      name: 'Alice',
      thumbnailAssetId: assetId,
    });
  });

  it('searchPeople returns ambiguous when two rows share the same exact name', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });
    const id1 = newUuid();
    const id2 = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    personRepository.getByName.mockResolvedValue([
      { id: id1, name: 'John', faceAssetId: null, ownerId: auth.user.id } as never,
      { id: id2, name: 'John', faceAssetId: null, ownerId: auth.user.id } as never,
    ]);

    const result = await sut.searchPeople(auth, session.id, { name: 'John' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.people.status).toBe('ambiguous');
    if (result.people.status !== 'ambiguous') {
      return;
    }
    expect(result.people.choices).toHaveLength(2);
    expect(result.people.choices[0]).toMatchObject({ personId: id1, name: 'John', thumbnailAssetId: null });
    expect(result.people.choices[1]).toMatchObject({ personId: id2, name: 'John', thumbnailAssetId: null });
  });

  it('searchPeople returns ambiguous when rows are only fuzzy matches (no exact)', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });
    const id1 = newUuid();
    const id2 = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    personRepository.getByName.mockResolvedValue([
      { id: id1, name: 'Alexandra', faceAssetId: null, ownerId: auth.user.id } as never,
      { id: id2, name: 'Alex', faceAssetId: null, ownerId: auth.user.id } as never,
    ]);

    const result = await sut.searchPeople(auth, session.id, { name: 'Alexia' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.people.status).toBe('ambiguous');
    if (result.people.status !== 'ambiguous') {
      return;
    }
    expect(result.people.choices).toHaveLength(2);
  });

  it('searchPeople returns not_found when getByName returns empty array', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    sessionRepository.getById.mockResolvedValue(session);
    personRepository.getByName.mockResolvedValue([]);

    const result = await sut.searchPeople(auth, session.id, { name: 'Zzzqqq' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.people).toEqual({ status: 'not_found' });
  });

  it('searchPeople uses case-insensitive comparison for exact-match detection', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });
    const personId = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    personRepository.getByName.mockResolvedValue([
      { id: personId, name: 'alice', faceAssetId: null, ownerId: auth.user.id } as never,
    ]);

    const result = await sut.searchPeople(auth, session.id, { name: 'Alice' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.people).toEqual({ status: 'matched', personId, name: 'alice', thumbnailAssetId: null });
  });

  it('searchPeople result contains only personId, name, and thumbnailAssetId (no thumbnailPath or embedding)', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });
    const personId = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    personRepository.getByName.mockResolvedValue([
      {
        id: personId,
        name: 'Bob',
        faceAssetId: null,
        thumbnailPath: '/thumbs/secret.jpg',
        embedding: new Float32Array(512),
        ownerId: auth.user.id,
      } as never,
    ]);

    const result = await sut.searchPeople(auth, session.id, { name: 'Bob' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.people).toEqual({ status: 'matched', personId, name: 'Bob', thumbnailAssetId: null });
    expect(JSON.stringify(result.people)).not.toContain('thumbnailPath');
    expect(JSON.stringify(result.people)).not.toContain('embedding');
  });

  it('searchPeople limits ambiguous choices to 5', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    sessionRepository.getById.mockResolvedValue(session);
    personRepository.getByName.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: newUuid(),
        name: `Alex${i}`,
        faceAssetId: null,
        ownerId: auth.user.id,
      })) as never,
    );

    const result = await sut.searchPeople(auth, session.id, { name: 'Alexxx' });

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      return;
    }
    expect(result.people.status).toBe('ambiguous');
    if (result.people.status !== 'ambiguous') {
      return;
    }
    expect(result.people.choices!.length).toBeLessThanOrEqual(5);
  });

  it('searchPeople creates pending approval in strict mode', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });

    sessionRepository.getById.mockResolvedValue(session);

    const result = await sut.searchPeople(auth, session.id, { name: 'Alice' });

    expect(result.status).toBe('approval-required');
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: AgentToolName.SearchPeople,
        requestSummary: 'Search people: Alice',
      }),
    );
  });

  it('searchPeople passes includeHidden:true to getByName when set', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });
    const personId = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    personRepository.getByName.mockResolvedValue([
      { id: personId, name: 'Alex', faceAssetId: null, ownerId: auth.user.id } as never,
    ]);

    await sut.searchPeople(auth, session.id, { name: 'Alex', includeHidden: true });

    expect(personRepository.getByName).toHaveBeenCalledWith(auth.user.id, 'Alex', { withHidden: true });
  });

  it('searchPeople defaults withHidden to false when includeHidden is omitted', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      approvalMode: AgentApprovalMode.PlanOnly,
    });
    const personId = newUuid();

    sessionRepository.getById.mockResolvedValue(session);
    personRepository.getByName.mockResolvedValue([
      { id: personId, name: 'Alex', faceAssetId: null, ownerId: auth.user.id } as never,
    ]);

    await sut.searchPeople(auth, session.id, { name: 'Alex' });

    expect(personRepository.getByName).toHaveBeenCalledWith(auth.user.id, 'Alex', { withHidden: false });
  });
});
