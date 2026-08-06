import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentSession, AgentToolCall } from 'src/database';
import { buildAgentSourceRef } from 'src/dtos/agent-asset-source.dto';
import {
  AgentCurateSelectionToolRequestDto,
  AgentCurateSelectionToolResponseDto,
  AgentFindTripCandidatesToolRequestDto,
  AgentFindTripCandidatesToolResponseDto,
  AgentListAlbumsToolRequestDto,
  AgentListAlbumsToolResponseDto,
  AgentListDuplicateGroupsToolRequestDto,
  AgentListDuplicateGroupsToolResponseDto,
  AgentListSpacesToolRequestDto,
  AgentListSpacesToolResponseDto,
  AgentReadAlbumToolRequestDto,
  AgentReadAlbumToolResponseDto,
  AgentReadAssetMetadataToolRequestDto,
  AgentReadAssetMetadataToolResponseDto,
  AgentReadAssetOriginalsToolRequestDto,
  AgentReadAssetOriginalsToolResponseDto,
  AgentReadAssetPreviewsToolRequestDto,
  AgentReadAssetPreviewsToolResponseDto,
  AgentReadSelectionMetadataToolRequestDto,
  AgentReadSelectionMetadataToolResponseDto,
  AgentReadSpaceToolRequestDto,
  AgentReadSpaceToolResponseDto,
  AgentResolveAssetSearchFiltersToolRequestDto,
  AgentResolveAssetSearchFiltersToolResponseDto,
  AgentResolveLocationToolRequestDto,
  AgentResolveLocationToolResponseDto,
  AgentSearchAssetsToolRequestDto,
  AgentSearchAssetsToolResponseDto,
  AgentSearchPeopleToolRequestDto,
  AgentSearchPeopleToolResponseDto,
  AgentSearchUsersToolRequestDto,
  AgentSearchUsersToolResponseDto,
  AgentToolApprovalDto,
  AgentToolCallResponseDto,
} from 'src/dtos/agent-tool.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AgentApprovalMode,
  AgentProviderType,
  AgentSessionStatus,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  AlbumUserRole,
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
import {
  invalidSelectionHandleError,
  isAgentMcpRecoverableToolError,
  selectionTooLargeError,
  wrongIdDomainError,
} from 'src/services/agent-mcp-recoverable-tool-error';
import { AgentRunnerService } from 'src/services/agent-runner.service';
import { buildAgentSearch } from 'src/services/agent-search-filter-mapper';
import type { TripCandidate } from 'src/services/trip-candidate.service';
import { TripCandidateService } from 'src/services/trip-candidate.service';
import { UserService } from 'src/services/user.service';
import { AgentIdDomain, AgentSearchSourceRef } from 'src/types/agent-asset-source.types';
import { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
import {
  AgentAlbumDetail,
  AgentAlbumSummary,
  AgentAssetMediaReference,
  AgentAssetMetadata,
  AgentAssetMetadataDetail,
  AgentAssetMetadataField,
  AgentAssetMetadataResult,
  AgentCurateSelectionConstraints,
  AgentCurateSelectionDiversifyBy,
  AgentCurateSelectionStrategy,
  AgentDuplicateAsset,
  AgentDuplicateGroup,
  AgentReadSelectionMetadataCounts,
  AgentResolvedAssetSearchFilterResult,
  AgentResolveLocationResult,
  AgentSearchAssetResult,
  AgentSearchAssetsDetail,
  AgentSearchAssetsFilters,
  AgentSearchAssetsMode,
  AgentSearchAssetsOrder,
  AgentSearchAssetsRequestDetail,
  AgentSearchAssetsSample,
  AgentSearchAssetsSampleItem,
  AgentSearchAssetsSelectionHandle,
  AgentSearchAssetsSelectionHandleResult,
  AgentSearchPeopleResult,
  AgentSpaceDetail,
  AgentSpaceMemberSummary,
  AgentSpaceSummary,
  AgentToolCurateSelectionRequestMetadata,
  AgentToolFindTripCandidatesRequestMetadata,
  AgentToolListAlbumsRequestMetadata,
  AgentToolListDuplicateGroupsRequestMetadata,
  AgentToolListSpacesRequestMetadata,
  AgentToolReadAssetIdsRequestMetadata,
  AgentToolReadAssetMetadataRequestMetadata,
  AgentToolReadSelectionMetadataRequestMetadata,
  AgentToolReadSpaceRequestMetadata,
  AgentToolResolveAssetSearchFiltersRequestMetadata,
  AgentToolResponseIdsMetadata,
  AgentToolResponseMetadata,
  AgentToolResultSize,
  AgentToolSearchAssetsRequestMetadata,
  AgentToolSearchUsersRequestMetadata,
  AgentUserLookupResult,
} from 'src/types/agent-tool.types';
import { getConfig } from 'src/utils/config';
import { isSmartSearchEnabled } from 'src/utils/misc';

type AgentReadToolResponse<TResult extends Record<string, unknown>> =
  | { status: 'approval-required'; toolCall: AgentToolCallResponseDto }
  | { status: 'denied'; reason: string; toolCall: AgentToolCallResponseDto }
  | ({ status: 'success'; toolCall: AgentToolCallResponseDto; resultSize: AgentToolResultSize } & TResult);

type ToolCallCreate = Parameters<AgentToolCallRepository['create']>[0];

type AgentReadToolDescriptor<TRequest, TResult extends Record<string, unknown>> = {
  toolName: AgentToolName;
  dataClass: AgentToolDataClass;
  prepareRequest?: (auth: AuthDto, session: AgentSession, request: TRequest) => Promise<TRequest>;
  requestSummary: (request: TRequest) => string;
  requestMetadata: (request: TRequest) => AgentToolCall['redactedRequestMetadata'];
  requestedAssetCount: (request: TRequest) => number;
  requestedAlbumCount: (request: TRequest) => number;
  perToolLimit: (plan: AgentPermissionPlanSnapshot) => number;
  perToolLimitDenialReason?: (request: TRequest, limit: number) => string;
  perSessionLimit: (plan: AgentPermissionPlanSnapshot) => number;
  validateAccess: (
    auth: AuthDto,
    session: AgentSession,
    request: TRequest,
    excludedToolCallId?: string,
  ) => Promise<string | null>;
  execute: (auth: AuthDto, session: AgentSession, request: TRequest, toolCallId: string) => Promise<TResult>;
  responseSummary: (result: TResult) => string;
  responseMetadata: (result: TResult) => AgentToolCall['redactedResponseMetadata'];
  resultAssetCount: (result: TResult) => number;
  resultAlbumCount: (result: TResult) => number;
  resultSize: (result: TResult) => Pick<AgentToolResultSize, 'returnedItems' | 'hasMore' | 'nextPage'>;
  truncateForBudget?: (result: TResult, budgetBytes: number) => { result: TResult; omittedFields: string[] };
  failedReason: string;
};

class AgentToolDeniedError extends Error {}

class AgentToolRecordedDeniedError extends Error {
  constructor(
    message: string,
    readonly toolCall: AgentToolCall,
  ) {
    super(message);
  }
}

class AgentToolFailedError extends Error {}

const isReadAssetIdsRequestMetadata = (
  metadata: AgentToolCall['redactedRequestMetadata'],
): metadata is AgentToolReadAssetIdsRequestMetadata =>
  'assetIds' in metadata && Array.isArray(metadata.assetIds) && metadata.assetIds.every((id) => typeof id === 'string');

const maxAgentSpaceAssetIds = 10_000;
const selectionMetadataRecoveryLimit = 5;
const maxMetadataCurationSourceAssets = 1000;
const knownExampleSelectionHandleIds = new Set(['00000000-0000-4000-8000-000000000333']);

type PreparedSelectionMetadataRequest = AgentReadSelectionMetadataToolRequestDto & {
  resolvedSelectionHandleAssetCount?: number;
};

type PreparedCurateSelectionRequest = AgentCurateSelectionToolRequestDto & {
  resolvedSourceAssetCount?: number;
};

type CurateCandidate = {
  asset: AgentAssetMetadata;
  order: number;
  score: number;
};

type AgentCurateSelectionAssetType = 'IMAGE' | 'VIDEO';

type TripCandidateToolService = Pick<
  TripCandidateService,
  'findRecentTripCandidates' | 'materializeAlbumReadySelection'
>;

type AgentTripCandidateToolResult = {
  dedupeKey: string;
  title: string;
  subtitle: string;
  countries: string[];
  states: string[];
  cities: string[];
  takenAfter: Date;
  takenBefore: Date;
  assetCount: number;
  albumAssetCount: number;
  excludedDuplicateCount: number;
  excludedStackChildCount: number;
  dayCount: number;
  score: number;
  confidence: TripCandidate['confidence'];
  placeLabels: string[];
  selectionHandle: AgentSearchAssetsSelectionHandleResult;
};

type AgentTripCandidateRecommendation =
  | { action: 'use_top_candidate'; candidateDedupeKey: string; reason: string }
  | { action: 'ask_user' | 'none'; reason: string };

type MaterializedAgentTripCandidate = Omit<AgentTripCandidateToolResult, 'selectionHandle'> & {
  assetIds: string[];
};

const normName = (s: string) => s.trim().toLowerCase();

@Injectable()
export class AgentToolService {
  private static readonly activeStatuses = [
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ];

  private readonly tripCandidateService: TripCandidateToolService;

  constructor(
    private readonly accessRepository: AccessRepository,
    private readonly assetRepository: AssetRepository,
    private readonly searchRepository: SearchRepository,
    private readonly logger: LoggingRepository,
    private readonly configRepository: ConfigRepository,
    private readonly machineLearningRepository: MachineLearningRepository,
    private readonly systemMetadataRepository: SystemMetadataRepository,
    private readonly albumRepository: AlbumRepository,
    private readonly sharedSpaceRepository: SharedSpaceRepository,
    private readonly duplicateRepository: DuplicateRepository,
    private readonly sessionRepository: AgentSessionRepository,
    private readonly selectionHandleRepository: AgentSelectionHandleRepository,
    private readonly toolCallRepository: AgentToolCallRepository,
    private readonly agentRunnerService: AgentRunnerService,
    private readonly userService: UserService,
    private readonly assetSearchFilterResolverService: AgentAssetSearchFilterResolverService,
    private readonly mapRepository: MapRepository,
    private readonly personRepository: PersonRepository,
  ) {
    this.tripCandidateService = new TripCandidateService(assetRepository);
  }

  async searchAssets(
    auth: AuthDto,
    sessionId: string,
    dto: AgentSearchAssetsToolRequestDto,
  ): Promise<AgentSearchAssetsToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.searchAssetsDescriptor());
  }

  async findTripCandidates(
    auth: AuthDto,
    sessionId: string,
    dto: AgentFindTripCandidatesToolRequestDto,
  ): Promise<AgentFindTripCandidatesToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.findTripCandidatesDescriptor());
  }

  async readSelectionMetadata(
    auth: AuthDto,
    sessionId: string,
    dto: AgentReadSelectionMetadataToolRequestDto,
  ): Promise<AgentReadSelectionMetadataToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.readSelectionMetadataDescriptor());
  }

  async curateSelection(
    auth: AuthDto,
    sessionId: string,
    dto: AgentCurateSelectionToolRequestDto,
  ): Promise<AgentCurateSelectionToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.curateSelectionDescriptor());
  }

  async resolveAssetSearchFilters(
    auth: AuthDto,
    sessionId: string,
    dto: AgentResolveAssetSearchFiltersToolRequestDto,
  ): Promise<AgentResolveAssetSearchFiltersToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.resolveAssetSearchFiltersDescriptor());
  }

  async resolveLocation(
    auth: AuthDto,
    sessionId: string,
    dto: AgentResolveLocationToolRequestDto,
  ): Promise<AgentResolveLocationToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.resolveLocationDescriptor());
  }

  async searchPeople(
    auth: AuthDto,
    sessionId: string,
    dto: AgentSearchPeopleToolRequestDto,
  ): Promise<AgentSearchPeopleToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.searchPeopleDescriptor());
  }

  async readAssetMetadata(
    auth: AuthDto,
    sessionId: string,
    dto: AgentReadAssetMetadataToolRequestDto,
  ): Promise<AgentReadAssetMetadataToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.readAssetMetadataDescriptor());
  }

  async readAssetPreviews(
    auth: AuthDto,
    sessionId: string,
    dto: AgentReadAssetPreviewsToolRequestDto,
  ): Promise<AgentReadAssetPreviewsToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.readAssetPreviewsDescriptor());
  }

  async readAssetOriginals(
    auth: AuthDto,
    sessionId: string,
    dto: AgentReadAssetOriginalsToolRequestDto,
  ): Promise<AgentReadAssetOriginalsToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.readAssetOriginalsDescriptor());
  }

  async listAlbums(
    auth: AuthDto,
    sessionId: string,
    dto: AgentListAlbumsToolRequestDto,
  ): Promise<AgentListAlbumsToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.listAlbumsDescriptor());
  }

  async readAlbum(
    auth: AuthDto,
    sessionId: string,
    dto: AgentReadAlbumToolRequestDto,
  ): Promise<AgentReadAlbumToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.readAlbumDescriptor());
  }

  async listSpaces(
    auth: AuthDto,
    sessionId: string,
    dto: AgentListSpacesToolRequestDto,
  ): Promise<AgentListSpacesToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.listSpacesDescriptor());
  }

  async listDuplicateGroups(
    auth: AuthDto,
    sessionId: string,
    dto: AgentListDuplicateGroupsToolRequestDto,
  ): Promise<AgentListDuplicateGroupsToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.listDuplicateGroupsDescriptor());
  }

  async readSpace(
    auth: AuthDto,
    sessionId: string,
    dto: AgentReadSpaceToolRequestDto,
  ): Promise<AgentReadSpaceToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.readSpaceDescriptor());
  }

  async searchUsers(
    auth: AuthDto,
    sessionId: string,
    dto: AgentSearchUsersToolRequestDto,
  ): Promise<AgentSearchUsersToolResponseDto> {
    return this.runReadTool(auth, sessionId, dto, this.searchUsersDescriptor());
  }

  async approveToolCall(
    auth: AuthDto,
    sessionId: string,
    toolCallId: string,
    dto: AgentToolApprovalDto,
  ): Promise<AgentToolCallResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });
    const toolCall = await this.getToolCallForSession(session.id, toolCallId);

    if (toolCall.status !== AgentToolCallStatus.PendingApproval) {
      throw new BadRequestException('Agent tool call is not pending approval');
    }

    const update =
      dto.decision === AgentToolApprovalDecision.Approved
        ? {
            status: AgentToolCallStatus.Approved,
            approvalDecision: AgentToolApprovalDecision.Approved,
            responseSummary: 'Tool call approved by user',
            redactedResponseMetadata: toolCall.redactedResponseMetadata,
            completedAt: null,
            error: null,
          }
        : {
            status: AgentToolCallStatus.Denied,
            approvalDecision: AgentToolApprovalDecision.Denied,
            responseSummary: null,
            redactedResponseMetadata: toolCall.redactedResponseMetadata,
            completedAt: new Date(),
            error: dto.reason ?? 'Denied by user',
          };

    const transitioned = await this.toolCallRepository.transition(
      session.id,
      toolCall.id,
      AgentToolCallStatus.PendingApproval,
      update,
    );

    if (!transitioned) {
      throw new BadRequestException('Agent tool call is not pending approval');
    }

    await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });
    if (session.runnerSessionId) {
      void this.resumeRunnerAfterApprovalDecision(auth, session, transitioned, dto.decision).catch(() =>
        this.sessionRepository.markInterruptedFromActive(auth.user.id, session.id).catch(() => {}),
      );
    }

    return this.mapToolCall(transitioned);
  }

  private async resumeRunnerAfterApprovalDecision(
    auth: AuthDto,
    session: AgentSession,
    toolCall: AgentToolCall,
    approvalDecision: AgentToolApprovalDecision,
  ) {
    const toolResult =
      approvalDecision === AgentToolApprovalDecision.Approved
        ? await this.executeApprovedToolCallForRunner(auth, session, toolCall)
        : undefined;

    await this.agentRunnerService.resumeAfterToolApproval({
      userId: auth.user.id,
      sessionId: session.id,
      runnerSessionId: session.runnerSessionId!,
      toolCallId: toolCall.id,
      approvalDecision,
      toolResult,
    });
  }

  private async executeApprovedToolCallForRunner(
    auth: AuthDto,
    session: AgentSession,
    toolCall: AgentToolCall,
  ): Promise<unknown> {
    try {
      return await this.executeApprovedToolCall(auth, session, toolCall);
    } catch {
      return {
        status: 'error',
        message: 'Approved tool call failed before returning a result.',
      };
    }
  }

  private executeApprovedToolCall(auth: AuthDto, session: AgentSession, toolCall: AgentToolCall): Promise<unknown> {
    switch (toolCall.toolName) {
      case AgentToolName.SearchAssets: {
        return this.searchAssets(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.FindTripCandidates: {
        return this.findTripCandidates(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.ReadSelectionMetadata: {
        return this.readSelectionMetadata(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.CurateSelection: {
        return this.curateSelection(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.ResolveAssetSearchFilters: {
        return this.resolveAssetSearchFilters(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.ResolveLocation: {
        return this.resolveLocation(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.SearchPeople: {
        return this.searchPeople(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.ReadAssetMetadata: {
        return this.readAssetMetadata(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.ReadAssetPreviews: {
        return this.readAssetPreviews(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.ReadAssetOriginals: {
        return this.readAssetOriginals(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.ListAlbums: {
        return this.listAlbums(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.ReadAlbum: {
        return this.readAlbum(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.ListSpaces: {
        return this.listSpaces(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.ReadSpace: {
        return this.readSpace(auth, session.id, { toolCallId: toolCall.id });
      }
      case AgentToolName.SearchUsers: {
        return this.searchUsers(auth, session.id, { toolCallId: toolCall.id });
      }
      default: {
        return Promise.resolve();
      }
    }
  }

  async getToolCalls(auth: AuthDto, sessionId: string): Promise<AgentToolCallResponseDto[]> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: false });
    const toolCalls = await this.toolCallRepository.getBySessionId(session.id);
    return toolCalls.map((toolCall) => this.mapToolCall(toolCall));
  }

  private async runReadTool<TRequest extends { toolCallId?: string }, TResult extends Record<string, unknown>>(
    auth: AuthDto,
    sessionId: string,
    dto: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
  ): Promise<AgentReadToolResponse<TResult>> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });

    if (dto.toolCallId) {
      return this.executeApprovedRead(auth, session, dto.toolCallId, descriptor);
    }

    return this.createOrExecuteRead(auth, session, dto, descriptor);
  }

  private async createOrExecuteRead<TRequest, TResult extends Record<string, unknown>>(
    auth: AuthDto,
    session: AgentSession,
    rawRequest: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
  ): Promise<AgentReadToolResponse<TResult>> {
    const policyDenial = this.getPolicyDenial(session, descriptor.dataClass);
    if (policyDenial) {
      const toolCall = await this.createDeniedAudit(session, rawRequest, descriptor, policyDenial);
      return { status: 'denied', reason: policyDenial, toolCall: this.mapToolCall(toolCall) };
    }

    const request = await this.prepareReadRequest(auth, session, rawRequest, descriptor);

    if (this.requiresApproval(session, descriptor.dataClass)) {
      const shouldUseAtomicSessionLimit = this.shouldUseAtomicSessionLimit(session, request, descriptor);
      const denialReason = await this.validateReadRequest(auth, session, request, descriptor, undefined, {
        validateSessionLimit: !shouldUseAtomicSessionLimit,
      });

      if (denialReason) {
        const toolCall = await this.createDeniedAudit(session, request, descriptor, denialReason);
        return { status: 'denied', reason: denialReason, toolCall: this.mapToolCall(toolCall) };
      }

      const result = await this.createPendingAudit(session, request, descriptor);
      if (result.status === 'limit-exceeded') {
        return { status: 'denied', reason: result.reason, toolCall: this.mapToolCall(result.toolCall) };
      }

      await this.sessionRepository.update(session.userId, session.id, {
        status: AgentSessionStatus.WaitingForToolApproval,
      });

      return { status: 'approval-required', toolCall: this.mapToolCall(result.toolCall) };
    }

    const shouldUseAtomicSessionLimit = this.shouldUseAtomicSessionLimit(session, request, descriptor);
    const denialReason = await this.validateReadRequest(auth, session, request, descriptor, undefined, {
      validateSessionLimit: !shouldUseAtomicSessionLimit,
    });
    if (denialReason) {
      const toolCall = await this.createDeniedAudit(session, request, descriptor, denialReason);
      return { status: 'denied', reason: denialReason, toolCall: this.mapToolCall(toolCall) };
    }

    const executingDto: ToolCallCreate = {
      ...this.baseToolCall(session, request, descriptor),
      status: AgentToolCallStatus.Executing,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Tool call execution started',
      redactedResponseMetadata: null,
      completedAt: null,
      error: null,
    };
    const executing = shouldUseAtomicSessionLimit
      ? await this.createExecutingAuditWithSessionLimit(session, request, descriptor, executingDto)
      : await this.toolCallRepository.create(executingDto);

    if ('reason' in executing) {
      return { status: 'denied', reason: executing.reason, toolCall: this.mapToolCall(executing.toolCall) };
    }

    return this.executeClaimedRead(auth, session, executing.id, request, descriptor);
  }

  private async executeApprovedRead<TRequest, TResult extends Record<string, unknown>>(
    auth: AuthDto,
    session: AgentSession,
    toolCallId: string,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
  ): Promise<AgentReadToolResponse<TResult>> {
    const toolCall = await this.getToolCallForSession(session.id, toolCallId);

    if (toolCall.status === AgentToolCallStatus.Denied) {
      return {
        status: 'denied',
        reason: toolCall.error ?? 'Tool call was denied',
        toolCall: this.mapToolCall(toolCall),
      };
    }

    if (toolCall.status !== AgentToolCallStatus.Approved) {
      throw new BadRequestException('Agent tool call has not been approved');
    }

    const storedRequest = this.getStoredRequest(toolCall, descriptor);

    const executing = await this.toolCallRepository.transition(session.id, toolCall.id, AgentToolCallStatus.Approved, {
      status: AgentToolCallStatus.Executing,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Tool call execution started',
      redactedResponseMetadata: null,
      completedAt: null,
      error: null,
    });

    if (!executing) {
      throw new BadRequestException('Agent tool call is already executing or completed');
    }

    let refreshedSession: AgentSession;
    try {
      refreshedSession = await this.getOwnedSession(auth, session.id, { requireActive: true });
    } catch (error) {
      await this.toolCallRepository.transition(session.id, toolCall.id, AgentToolCallStatus.Executing, {
        status: AgentToolCallStatus.Failed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: null,
        redactedResponseMetadata: null,
        completedAt: new Date(),
        error: 'Agent session not found',
      });
      throw error;
    }
    let request: TRequest | undefined;
    let denialReason: string | null;
    try {
      denialReason = this.getPolicyDenial(refreshedSession, descriptor.dataClass);
      if (!denialReason) {
        request = await this.prepareReadRequest(auth, refreshedSession, storedRequest, descriptor);
        denialReason = await this.validateReadRequest(auth, refreshedSession, request, descriptor, toolCall.id);
      }
    } catch (error) {
      if (isAgentMcpRecoverableToolError(error)) {
        await this.transitionExecuting(auth, refreshedSession, toolCall.id, {
          status: AgentToolCallStatus.Denied,
          approvalDecision: AgentToolApprovalDecision.Denied,
          responseSummary: null,
          redactedResponseMetadata: this.withResultSizeMetadata(null, this.emptyResultSize()),
          completedAt: new Date(),
          error: error.content.error,
        });
      }
      throw error;
    }
    if (denialReason) {
      const denied = await this.transitionExecuting(auth, refreshedSession, toolCall.id, {
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        responseSummary: null,
        redactedResponseMetadata: this.withResultSizeMetadata(null, this.emptyResultSize()),
        completedAt: new Date(),
        error: denialReason,
      });
      return { status: 'denied', reason: denialReason, toolCall: this.mapToolCall(denied) };
    }

    return this.executeClaimedRead(auth, refreshedSession, toolCall.id, request!, descriptor);
  }

  private async executeClaimedRead<TRequest, TResult extends Record<string, unknown>>(
    auth: AuthDto,
    session: AgentSession,
    toolCallId: string,
    request: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
  ): Promise<AgentReadToolResponse<TResult>> {
    try {
      const rawResult = await descriptor.execute(auth, session, request, toolCallId);
      const result = this.withResultSize(rawResult, descriptor, (candidateResult, resultSize) =>
        this.buildReadToolCallEstimate(session.id, toolCallId, request, descriptor, candidateResult, resultSize),
      );
      const completed = await this.transitionExecuting(auth, session, toolCallId, {
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: descriptor.responseSummary(result),
        redactedResponseMetadata: this.withResultSizeMetadata(descriptor.responseMetadata(result), result.resultSize),
        assetCount: descriptor.resultAssetCount(result),
        albumCount: descriptor.resultAlbumCount(result),
        completedAt: new Date(),
        error: null,
      });

      return { status: 'success', toolCall: this.mapToolCall(completed), ...result };
    } catch (error) {
      if (error instanceof AgentToolDeniedError) {
        const denied = await this.transitionExecuting(auth, session, toolCallId, {
          status: AgentToolCallStatus.Denied,
          approvalDecision: AgentToolApprovalDecision.Denied,
          responseSummary: null,
          redactedResponseMetadata: this.withResultSizeMetadata(null, this.emptyResultSize()),
          completedAt: new Date(),
          error: error.message,
        });
        return { status: 'denied', reason: error.message, toolCall: this.mapToolCall(denied) };
      }

      if (error instanceof AgentToolRecordedDeniedError) {
        return { status: 'denied', reason: error.message, toolCall: this.mapToolCall(error.toolCall) };
      }

      if (!(error instanceof AgentToolFailedError)) {
        await this.tryRecordUnexpectedReadFailure(auth, session, toolCallId, descriptor.failedReason);
        throw error;
      }

      const reason = error.message;
      const failed = await this.transitionExecuting(auth, session, toolCallId, {
        status: AgentToolCallStatus.Failed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: null,
        redactedResponseMetadata: 'metadata' in error ? (error.metadata as AgentToolResponseMetadata) : null,
        completedAt: new Date(),
        error: reason,
      });
      return { status: 'denied', reason, toolCall: this.mapToolCall(failed) };
    }
  }

  private prepareReadRequest<TRequest, TResult extends Record<string, unknown>>(
    auth: AuthDto,
    session: AgentSession,
    request: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
  ): Promise<TRequest> {
    return descriptor.prepareRequest ? descriptor.prepareRequest(auth, session, request) : Promise.resolve(request);
  }

  private findTripCandidatesDescriptor(): AgentReadToolDescriptor<
    AgentFindTripCandidatesToolRequestDto,
    {
      summary: string;
      recommendation: AgentTripCandidateRecommendation;
      candidates: AgentTripCandidateToolResult[];
    }
  > {
    return {
      toolName: AgentToolName.FindTripCandidates,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: (request) =>
        `Find trip candidates${request.placeHint ? ` matching ${request.placeHint}` : ''} (lookback ${request.lookbackDays ?? 180} days, max ${request.maxCandidates ?? 3})`,
      requestMetadata: (request) =>
        ({
          ...(request.placeHint ? { placeHint: request.placeHint } : {}),
          ...(request.targetDate ? { targetDate: request.targetDate } : {}),
          lookbackDays: request.lookbackDays ?? 180,
          maxCandidates: request.maxCandidates ?? 3,
        }) as AgentToolFindTripCandidatesRequestMetadata,
      requestedAssetCount: () => 0,
      requestedAlbumCount: () => 0,
      perToolLimit: (plan) => plan.limits.maxAssetsPerToolCall,
      perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
      validateAccess: () => Promise.resolve(null),
      execute: async (auth, session, request, toolCallId) => {
        const candidates = await this.tripCandidateService.findRecentTripCandidates({
          ownerId: auth.user.id,
          placeHint: request.placeHint,
          targetDate: request.targetDate,
          lookbackDays: request.lookbackDays,
          maxCandidates: request.maxCandidates,
        });
        const materializedCandidates: MaterializedAgentTripCandidate[] = [];

        for (const candidate of candidates) {
          const materializedCandidate = await this.materializeTripCandidateForTool(auth, session, candidate);
          if (materializedCandidate.assetIds.length > 0) {
            materializedCandidates.push(materializedCandidate);
          }
        }

        // Trip candidates are returned as compact summaries + selection handles, not
        // as raw asset ids in the model's context, so the per-tool-call asset limit
        // (which bounds model-facing payloads) must NOT gate discovery — otherwise a
        // legitimate large trip (the common case) is undiscoverable. The handle bounds
        // the asset set; the per-session limit below and plan creation enforce the
        // real cumulative/blast-radius bounds.
        const assetCount = materializedCandidates.reduce((total, candidate) => total + candidate.assetIds.length, 0);

        if (materializedCandidates.length > 0) {
          const reservation = await this.toolCallRepository.transitionWithSessionLimit(
            session.id,
            toolCallId,
            AgentToolCallStatus.Executing,
            {
              status: AgentToolCallStatus.Executing,
              approvalDecision: AgentToolApprovalDecision.Approved,
              responseSummary: 'Tool call execution started',
              redactedResponseMetadata: null,
              assetCount,
              albumCount: 0,
              completedAt: null,
              error: null,
            },
            AgentToolDataClass.Metadata,
            session.permissionPlanSnapshot.limits.maxAssetsPerSession,
          );

          await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });

          if (reservation.status === 'stale') {
            throw new BadRequestException('Agent tool call is already executing or completed');
          }

          if (reservation.status === 'limit-exceeded') {
            throw new AgentToolRecordedDeniedError(
              this.getSessionLimitReason(session.permissionPlanSnapshot.limits.maxAssetsPerSession),
              reservation.toolCall,
            );
          }
        }

        const mappedCandidates: AgentTripCandidateToolResult[] = [];
        for (const candidate of materializedCandidates) {
          mappedCandidates.push(await this.createTripCandidateHandle(auth, session, toolCallId, candidate));
        }

        return {
          summary: this.getFindTripCandidatesSummary(mappedCandidates.length, request.placeHint),
          recommendation: this.buildTripCandidateRecommendation(mappedCandidates),
          candidates: mappedCandidates,
        };
      },
      responseSummary: (result) => result.summary,
      responseMetadata: (result) => ({
        selectionHandleIds: result.candidates.map((candidate) => candidate.selectionHandle.id),
        sourceRefs: result.candidates.map((candidate) => candidate.selectionHandle.sourceRef),
        selectionHandleAssetCount: result.candidates.reduce(
          (total, candidate) => total + candidate.selectionHandle.assetCount,
          0,
        ),
      }),
      resultAssetCount: (result) =>
        result.candidates.reduce((total, candidate) => total + candidate.selectionHandle.assetCount, 0),
      resultAlbumCount: () => 0,
      resultSize: (result) => ({
        returnedItems: result.candidates.length,
        hasMore: false,
        nextPage: null,
      }),
      failedReason: 'Trip candidate lookup failed',
    };
  }

  private async materializeTripCandidateForTool(
    auth: AuthDto,
    session: AgentSession,
    candidate: TripCandidate,
  ): Promise<MaterializedAgentTripCandidate> {
    const selection = await this.tripCandidateService.materializeAlbumReadySelection(auth.user.id, candidate.source);
    const readableIds = await this.getReadableAssetIds(auth, session.permissionPlanSnapshot, selection.assetIds);
    const assetIds = selection.assetIds.filter((assetId) => readableIds.has(assetId));

    return {
      dedupeKey: candidate.dedupeKey,
      title: candidate.title,
      subtitle: candidate.subtitle,
      countries: candidate.countries,
      states: candidate.states,
      cities: candidate.cities,
      takenAfter: candidate.takenAfter,
      takenBefore: candidate.takenBefore,
      assetCount: candidate.assetCount,
      albumAssetCount: assetIds.length,
      excludedDuplicateCount: candidate.excludedDuplicateCount,
      excludedStackChildCount: candidate.excludedStackChildCount,
      dayCount: candidate.dayCount,
      score: candidate.score,
      confidence: candidate.confidence,
      placeLabels: candidate.source.placeLabels,
      assetIds,
    };
  }

  private async createTripCandidateHandle(
    auth: AuthDto,
    session: AgentSession,
    toolCallId: string,
    candidate: MaterializedAgentTripCandidate,
  ): Promise<AgentTripCandidateToolResult> {
    const handle = await this.selectionHandleRepository.create({
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: toolCallId,
      assetIds: candidate.assetIds,
      expiresAt: this.getSelectionHandleExpiresAt(session),
    });
    const { assetIds: _assetIds, ...result } = candidate;

    return {
      ...result,
      albumAssetCount: handle.assetCount,
      selectionHandle: this.mapSearchSelectionHandle(handle),
    };
  }

  private getFindTripCandidatesSummary(candidateCount: number, placeHint?: string) {
    const suffix = placeHint ? ` matching "${placeHint}"` : '';
    if (candidateCount === 0) {
      return `No trip candidates found${suffix}.`;
    }

    return `Found ${candidateCount} trip candidate${candidateCount === 1 ? '' : 's'}${suffix}.`;
  }

  private buildTripCandidateRecommendation(
    candidates: AgentTripCandidateToolResult[],
  ): AgentTripCandidateRecommendation {
    const [top, runnerUp] = candidates;
    if (!top) {
      return { action: 'none', reason: 'No readable trip candidates matched the request.' };
    }

    if (top.confidence !== 'high') {
      return { action: 'ask_user', reason: 'The best matching trip candidate is not high confidence.' };
    }

    if (!runnerUp) {
      return {
        action: 'use_top_candidate',
        candidateDedupeKey: top.dedupeKey,
        reason: 'The only readable trip candidate is high confidence.',
      };
    }

    const scoreDelta = top.score - runnerUp.score;
    const clearsRelativeGap = runnerUp.score <= 0 ? scoreDelta > 0 : top.score >= runnerUp.score * 1.2;
    if (scoreDelta >= 15 || clearsRelativeGap) {
      return {
        action: 'use_top_candidate',
        candidateDedupeKey: top.dedupeKey,
        reason: 'The top trip candidate is high confidence and clearly ahead of the runner-up.',
      };
    }

    return { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' };
  }

  private searchAssetsDescriptor(): AgentReadToolDescriptor<
    AgentSearchAssetsToolRequestDto,
    {
      summary: string;
      detail: AgentSearchAssetsDetail;
      selectionHandle: AgentSearchAssetsSelectionHandleResult;
      sample?: AgentSearchAssetsSample;
      returnedCount: number;
      hasMore: boolean;
      nextPage: string | null;
      totalCount?: number;
      approximateTotal?: number;
    }
  > {
    return {
      toolName: AgentToolName.SearchAssets,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: (request) =>
        `Search ${request.mode ?? 'metadata'} assets (limit ${this.getSearchLimit(request)}, ${request.detail ?? 'handle'})`,
      requestMetadata: (request) => {
        const mode = request.mode ?? 'metadata';
        return {
          mode,
          filters: request.filters ?? {},
          limit: this.getSearchLimit(request),
          page: request.page ?? 1,
          detail: request.detail ?? 'handle',
          fields: request.fields ?? [],
          ...(request.createSelectionHandle ? { createSelectionHandle: true } : {}),
          ...(request.sampleSize === undefined ? {} : { sampleSize: request.sampleSize }),
          ...(mode === 'smart' && request.order === undefined ? {} : { order: request.order ?? 'desc' }),
          ...(request.query === undefined ? {} : { query: request.query }),
        } as AgentToolSearchAssetsRequestMetadata;
      },
      requestedAssetCount: (request) => this.getSearchLimit(request),
      requestedAlbumCount: () => 0,
      perToolLimit: (plan) => plan.limits.maxAssetsPerToolCall,
      perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
      validateAccess: (auth, session, request, excludedToolCallId) =>
        this.validateSearchRequest(auth, session, request, excludedToolCallId),
      execute: async (auth, session, request, toolCallId) => {
        const normalizedRequest = {
          ...request,
          mode: request.mode ?? 'metadata',
          filters: request.filters ?? {},
          limit: this.getSearchLimit(request),
          page: request.page ?? 1,
          detail: request.detail ?? 'handle',
          fields: request.fields ?? [],
        };
        const timelineSpaceIds = await this.getSearchTimelineSpaceIds(auth, session, request.filters ?? {});
        const smartConfig = normalizedRequest.mode === 'smart' ? await this.getSmartSearchConfig() : undefined;
        const smartEmbedding =
          normalizedRequest.mode === 'smart'
            ? await this.machineLearningRepository.encodeText(normalizedRequest.query!, {
                modelName: smartConfig!.modelName,
                language: undefined,
              })
            : undefined;
        const search = buildAgentSearch({
          userId: auth.user.id,
          request: normalizedRequest,
          scope: {
            ...this.getRepositoryScope(auth, session.permissionPlanSnapshot),
            timelineSpaceIds,
          },
          smartEmbedding,
          smartMaxDistance: smartConfig?.maxDistance,
        });
        const result =
          search.kind === 'smart'
            ? await this.searchRepository.searchSmart(search.pagination, search.options)
            : await this.searchRepository.searchMetadata(search.pagination, search.options);
        const assetIds = result.items.map((asset) => asset.id);
        await this.assertReturnedAssetsAreAccessible(auth, session, assetIds);
        const responseDetail = this.normalizeSearchResponseDetail(normalizedRequest.detail);
        const fields = normalizedRequest.fields;
        const selectionHandle = await this.selectionHandleRepository.create({
          sessionId: session.id,
          userId: auth.user.id,
          sourceToolCallId: toolCallId,
          assetIds,
          expiresAt: this.getSelectionHandleExpiresAt(session),
        });
        const responseHandle = this.mapSearchSelectionHandle(selectionHandle);
        const pageResult = {
          detail: responseDetail,
          selectionHandle: responseHandle,
          returnedCount: selectionHandle.assetCount,
          hasMore: result.hasNextPage,
          nextPage: result.hasNextPage ? String(normalizedRequest.page + 1) : null,
        };

        if (responseDetail === 'handle') {
          const summary = this.getSearchAssetsResponseSummary(pageResult);
          return { ...pageResult, summary };
        }

        if (responseDetail === 'summary') {
          const sampleSize = request.sampleSize ?? 10;
          const sampleAssetIds = assetIds.slice(0, sampleSize);
          const sampleAssets = await this.getOrderedAgentMetadata(sampleAssetIds);
          const sample = this.buildSearchSample(
            sampleAssets.map((asset) => this.mapSelectedAssetMetadata(asset, fields)),
          );
          const summary = this.getSearchAssetsResponseSummary({
            ...pageResult,
            sampleCount: sample?.items.length ?? 0,
          });
          return {
            ...pageResult,
            summary,
            ...(sample ? { sample } : {}),
          };
        }

        const sampleSize = request.sampleSize ?? 10;
        const metadataAssetIds = assetIds.slice(0, sampleSize);
        const assets = await this.getOrderedAgentMetadata(metadataAssetIds);
        const sample = this.buildSearchSample(
          fields.length === 0 ? assets : assets.map((asset) => this.mapSelectedAssetMetadata(asset, fields)),
        );
        const summary = this.getSearchAssetsResponseSummary({ ...pageResult, sampleCount: sample?.items.length ?? 0 });
        return {
          ...pageResult,
          summary,
          ...(sample ? { sample } : {}),
        };
      },
      responseSummary: (result) => result.summary,
      responseMetadata: (result) => ({
        selectionHandleIds: [result.selectionHandle.id],
        sourceRefs: [result.selectionHandle.sourceRef],
        selectionHandleAssetCount: result.selectionHandle.assetCount,
      }),
      resultAssetCount: (result) => result.selectionHandle.assetCount,
      resultAlbumCount: () => 0,
      resultSize: (result) => ({
        returnedItems: result.selectionHandle.assetCount,
        hasMore: result.hasMore,
        nextPage: result.nextPage,
      }),
      truncateForBudget: (result, budgetBytes) => this.truncateSearchAssetsResult(result, budgetBytes),
      failedReason: 'Asset search failed',
    };
  }

  private getSearchLimit(request: AgentSearchAssetsToolRequestDto): number {
    return request.limit ?? 100;
  }

  private getSelectionHandleExpiresAt(session: AgentSession) {
    const minutes = session.permissionPlanSnapshot.limits.expiresInMinutes ?? 60;
    return new Date(Date.now() + minutes * 60_000);
  }

  private buildSearchSourceRef(selectionHandleId: string): AgentSearchSourceRef {
    return buildAgentSourceRef('search', selectionHandleId) as AgentSearchSourceRef;
  }

  private normalizeSearchResponseDetail(detail: AgentSearchAssetsRequestDetail): AgentSearchAssetsDetail {
    return detail === 'ids' ? 'handle' : detail;
  }

  private mapSearchSelectionHandle(handle: AgentSearchAssetsSelectionHandle): AgentSearchAssetsSelectionHandleResult {
    return {
      id: handle.id,
      sourceRef: this.buildSearchSourceRef(handle.id),
      assetCount: handle.assetCount,
      sourceToolCallId: handle.sourceToolCallId,
      expiresAt: handle.expiresAt,
    };
  }

  private async getValidSelectionMetadataHandle(auth: AuthDto, session: AgentSession, id: string) {
    const handle = await this.selectionHandleRepository.getValidForPlanning({
      id,
      sessionId: session.id,
      userId: auth.user.id,
      now: new Date(),
    });

    if (!handle) {
      throw await this.createInvalidSelectionMetadataHandleError(auth, session, id);
    }

    return handle;
  }

  private async createInvalidSelectionMetadataHandleError(auth: AuthDto, session: AgentSession, id: string) {
    const [readableAssetIds, readablePersonIds] = await Promise.all([
      this.getReadableAssetIds(auth, session.permissionPlanSnapshot, [id]),
      this.getReadablePersonIds(auth, session.permissionPlanSnapshot, new Set([id])),
    ]);
    const receivedDomain = readableAssetIds.has(id) ? 'asset' : readablePersonIds.has(id) ? 'person' : null;
    if (receivedDomain) {
      return wrongIdDomainError({
        toolName: AgentToolName.ReadSelectionMetadata,
        field: 'selectionHandleId',
        expectedDomain: 'selectionHandle',
        receivedDomain,
        instruction: 'Use the selectionHandle.id returned by searchAssets, not an asset or person ID.',
      });
    }

    const now = new Date();
    const [availableSelectionHandles, attemptedHandle] = await Promise.all([
      this.selectionHandleRepository.listValidForRecovery({
        sessionId: session.id,
        userId: auth.user.id,
        now,
        limit: selectionMetadataRecoveryLimit,
      }),
      this.selectionHandleRepository.getForRecovery({ id, sessionId: session.id, userId: auth.user.id }),
    ]);
    const expiredSelectionHandle =
      attemptedHandle && attemptedHandle.expiresAt <= now
        ? this.toSelectionMetadataHandleRecoveryHint(attemptedHandle)
        : undefined;
    const available = availableSelectionHandles.map((handle) => this.toSelectionMetadataHandleRecoveryHint(handle));
    const recovery = {
      kind: 'invalid-selection-handle',
      attemptedSelectionHandleId: id,
      looksLikeExamplePlaceholder: knownExampleSelectionHandleIds.has(id),
      availableSelectionHandles: available,
      ...(expiredSelectionHandle ? { expiredSelectionHandle } : {}),
      instruction: 'Retry readSelectionMetadata with a valid same-session selectionHandle.id, or rerun searchAssets.',
    };

    return invalidSelectionHandleError({
      toolName: AgentToolName.ReadSelectionMetadata,
      error: 'Selection handle is expired or not available for this session',
      hint: expiredSelectionHandle
        ? 'The attempted selection handle is expired. Rerun searchAssets, then retry readSelectionMetadata with the returned selectionHandle.id.'
        : available.length === 1
          ? `Retry readSelectionMetadata with the exact handle ${available[0].id} if that is the intended search selection.`
          : available.length > 1
            ? 'Choose the intended same-session handle from availableSelectionHandles and retry readSelectionMetadata with that exact id.'
            : 'Rerun searchAssets, then retry readSelectionMetadata with the returned selectionHandle.id.',
      recovery,
    });
  }

  private toSelectionMetadataHandleRecoveryHint(handle: {
    id: string;
    assetCount: number;
    sourceToolCallId: string | null;
    createdAt: Date;
    expiresAt: Date;
  }) {
    return {
      id: handle.id,
      assetCount: handle.assetCount,
      sourceToolCallId: handle.sourceToolCallId,
      createdAt: handle.createdAt.toISOString(),
      expiresAt: handle.expiresAt.toISOString(),
    };
  }

  private buildSearchSample(assets: AgentSearchAssetResult[]): AgentSearchAssetsSample | undefined {
    const items = assets.map((asset, index) => this.mapSearchSampleItem(asset, index));
    return items.length === 0 ? undefined : { sampleSize: items.length, items };
  }

  private mapSearchSampleItem(asset: AgentSearchAssetResult, index: number): AgentSearchAssetsSampleItem {
    const { id: _id, ownerId: _ownerId, originalFileName, tags, ...rest } = asset;
    return {
      itemRef: `item:${String(index + 1).padStart(3, '0')}`,
      ...rest,
      ...(originalFileName && !this.containsUuidLikeValue(originalFileName) ? { originalFileName } : {}),
      ...(tags ? { tags: tags.map(({ value, color }) => ({ value, color })) } : {}),
    };
  }

  private containsUuidLikeValue(value: string): boolean {
    return /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(value);
  }

  private getSearchAssetsResponseSummary(result: {
    detail: AgentSearchAssetsDetail;
    selectionHandle: AgentSearchAssetsSelectionHandleResult;
    hasMore: boolean;
    nextPage: string | null;
    sampleCount?: number;
  }) {
    const assetCount = result.selectionHandle.assetCount;
    const sampleCount = result.sampleCount ?? 0;
    const summary =
      (result.detail === 'summary' || result.detail === 'metadata') && sampleCount > 0
        ? `Created a selection handle for ${assetCount} ${assetCount === 1 ? 'asset' : 'assets'} with ${sampleCount} ${
            sampleCount === 1 ? 'sample' : 'samples'
          }`
        : `Created a selection handle for ${assetCount} ${assetCount === 1 ? 'asset' : 'assets'}`;
    return result.hasMore && result.nextPage
      ? `${summary}; more results available on page ${result.nextPage}`
      : summary;
  }

  private getReadSelectionMetadataResponseSummary(assetCount: number, sampleCount: number, truncated = false) {
    const summary = `Read selection metadata for ${assetCount} ${assetCount === 1 ? 'asset' : 'assets'} with ${sampleCount} ${
      sampleCount === 1 ? 'sample' : 'samples'
    }`;
    return truncated ? this.appendTruncatedResponseSummary(summary) : summary;
  }

  private curateMetadataSelection(input: {
    assets: AgentAssetMetadata[];
    targetCount: number;
    strategy: AgentCurateSelectionStrategy;
    constraints: AgentCurateSelectionConstraints;
    criteria?: string;
  }) {
    const warnings: string[] = [];
    const eligible = this.applyCurateSelectionConstraints(input.assets, input.constraints, input.strategy);
    const candidates = eligible.map((asset, order) => ({
      asset,
      order,
      score: this.getCurateCandidateScore(asset, input.strategy),
    }));
    const ranked = this.rankCurateCandidates(candidates, input.strategy, input.constraints);
    const selectedCandidates = ranked.slice(0, Math.min(input.targetCount, ranked.length));
    const selected = selectedCandidates.map((candidate) => candidate.asset);
    if (input.targetCount > ranked.length) {
      warnings.push(`Requested ${input.targetCount} assets but only ${ranked.length} eligible assets were available.`);
    }
    if (ranked.length === 0) {
      warnings.push('No eligible metadata rows were available for this curation request.');
    }

    const criteriaSummary = [
      `Metadata-only ${input.strategy} curation used favorites, ratings, dates, tags, and location; no visual inspection or objective image analysis was used.`,
      `Selected ${selected.length} of ${input.assets.length} hydrated metadata rows from the source selection.`,
    ];
    if (
      input.constraints.maxSharpness !== undefined ||
      input.constraints.maxBrightness !== undefined ||
      input.constraints.maxQuality !== undefined
    ) {
      criteriaSummary[0] = `Metadata-only ${input.strategy} curation used stored objective image quality scores, favorites, ratings, dates, tags, and location; no preview inspection was used.`;
    }
    if (input.criteria) {
      criteriaSummary.push(`User criteria: ${input.criteria}`);
    }
    if (input.constraints.diversifyBy?.includes('people')) {
      criteriaSummary.push(
        'People diversity was requested but is not available from metadata-only rows in this version.',
      );
    }

    return { selectedAssets: selected, criteriaSummary, warnings };
  }

  private applyCurateSelectionConstraints(
    assets: AgentAssetMetadata[],
    constraints: AgentCurateSelectionConstraints,
    strategy: AgentCurateSelectionStrategy,
  ): AgentAssetMetadata[] {
    const requestedTypes = constraints.types ?? (strategy === 'cover-candidate' ? ['IMAGE'] : ['IMAGE', 'VIDEO']);
    let eligible = assets.filter((asset) => requestedTypes.includes(asset.type as AgentCurateSelectionAssetType));

    if (strategy === 'cover-candidate') {
      eligible = eligible.filter((asset) => asset.type === AssetType.Image);
    }
    if (constraints.excludeVideos) {
      eligible = eligible.filter((asset) => asset.type !== AssetType.Video);
    }
    if (constraints.includeFavorites === false) {
      eligible = eligible.filter((asset) => !asset.isFavorite);
    }
    if (constraints.minRating !== undefined) {
      eligible = eligible.filter((asset) => (asset.exifInfo?.rating ?? 0) >= constraints.minRating!);
    }
    if (constraints.maxSharpness !== undefined) {
      eligible = eligible.filter((asset) => {
        const value = asset.qualityInfo?.sharpness;
        return typeof value === 'number' && value <= constraints.maxSharpness!;
      });
    }
    if (constraints.maxBrightness !== undefined) {
      eligible = eligible.filter((asset) => {
        const value = asset.qualityInfo?.brightness;
        return typeof value === 'number' && value <= constraints.maxBrightness!;
      });
    }
    if (constraints.maxQuality !== undefined) {
      eligible = eligible.filter((asset) => {
        const value = asset.qualityInfo?.quality;
        return typeof value === 'number' && value <= constraints.maxQuality!;
      });
    }

    return eligible;
  }

  private getCurateCandidateScore(asset: AgentAssetMetadata, strategy: AgentCurateSelectionStrategy): number {
    return (
      (asset.isFavorite ? 100 : 0) +
      (asset.exifInfo?.rating ?? 0) * 10 +
      (this.hasCurateLocation(asset) ? 3 : 0) +
      (asset.localDateTime ? 2 : 0) +
      Math.min(asset.tags.length, 3) +
      (strategy === 'cover-candidate' && asset.type === AssetType.Image ? 1 : 0)
    );
  }

  private rankCurateCandidates(
    candidates: CurateCandidate[],
    strategy: AgentCurateSelectionStrategy,
    constraints: AgentCurateSelectionConstraints,
  ): CurateCandidate[] {
    const sorted = this.sortCurateCandidates(candidates);

    if (strategy === 'favorites-first') {
      return sorted.toSorted((left, right) => {
        const favoriteDelta = Number(right.asset.isFavorite) - Number(left.asset.isFavorite);
        return favoriteDelta || this.compareCurateCandidates(left, right);
      });
    }

    if (strategy === 'date-spread') {
      return this.roundRobinCurateGroups(sorted, 'date', 'key-desc');
    }

    const supportedDiversifiers = constraints.diversifyBy?.filter((value) => value !== 'people') ?? [];
    let ranked = sorted;
    for (const diversifyBy of supportedDiversifiers) {
      ranked = this.roundRobinCurateGroups(ranked, diversifyBy);
    }

    return ranked;
  }

  private sortCurateCandidates(candidates: CurateCandidate[]): CurateCandidate[] {
    return candidates.toSorted((left, right) => this.compareCurateCandidates(left, right));
  }

  private compareCurateCandidates(left: CurateCandidate, right: CurateCandidate): number {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const dateDelta = right.asset.localDateTime.getTime() - left.asset.localDateTime.getTime();
    if (dateDelta !== 0) {
      return dateDelta;
    }

    return left.order - right.order || left.asset.id.localeCompare(right.asset.id);
  }

  private roundRobinCurateGroups(
    candidates: CurateCandidate[],
    diversifyBy: AgentCurateSelectionDiversifyBy,
    groupOrder: 'base-rank' | 'key-desc' = 'base-rank',
  ): CurateCandidate[] {
    const groups = new Map<string, CurateCandidate[]>();
    for (const candidate of candidates) {
      const key = this.getCurateGroupKey(candidate.asset, diversifyBy);
      groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }

    const groupQueues = [...groups.entries()]
      .map(([key, group]) => ({ key, group: this.sortCurateCandidates(group) }))
      .toSorted((left, right) => {
        if (groupOrder === 'key-desc') {
          return right.key.localeCompare(left.key);
        }
        const topCandidateDelta = this.compareCurateCandidates(left.group[0], right.group[0]);
        return topCandidateDelta || left.key.localeCompare(right.key);
      })
      .map(({ group }) => group);
    const ranked: CurateCandidate[] = [];

    while (groupQueues.some((group) => group.length > 0)) {
      for (const group of groupQueues) {
        const next = group.shift();
        if (next) {
          ranked.push(next);
        }
      }
    }

    return ranked;
  }

  private getCurateGroupKey(asset: AgentAssetMetadata, diversifyBy: AgentCurateSelectionDiversifyBy): string {
    switch (diversifyBy) {
      case 'date': {
        return asset.localDateTime.toISOString().slice(0, 10);
      }
      case 'location': {
        const location = [asset.exifInfo?.city, asset.exifInfo?.state, asset.exifInfo?.country]
          .filter(Boolean)
          .join('|');
        return location || 'location:missing';
      }
      case 'tags': {
        return (
          asset.tags
            .map((tag) => tag.value)
            .toSorted((left, right) => left.localeCompare(right))
            .join('|') || 'tags:missing'
        );
      }
      case 'people': {
        return 'people:unavailable';
      }
    }
  }

  private hasCurateLocation(asset: AgentAssetMetadata): boolean {
    return Boolean(asset.exifInfo?.city || asset.exifInfo?.state || asset.exifInfo?.country);
  }

  private resolveAssetSearchFiltersDescriptor(): AgentReadToolDescriptor<
    AgentResolveAssetSearchFiltersToolRequestDto,
    {
      resolvedFilters: AgentSearchAssetsFilters;
      results: AgentResolvedAssetSearchFilterResult[];
    }
  > {
    return {
      toolName: AgentToolName.ResolveAssetSearchFilters,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: (request) => `Resolve asset search filters (${this.getResolverTermCount(request)} term(s))`,
      requestMetadata: (request) =>
        ({
          ...(request.people === undefined ? {} : { people: request.people }),
          ...(request.tags === undefined ? {} : { tags: request.tags }),
          ...(request.albums === undefined ? {} : { albums: request.albums }),
          ...(request.spaces === undefined ? {} : { spaces: request.spaces }),
          ...(request.cameraMakes === undefined ? {} : { cameraMakes: request.cameraMakes }),
          ...(request.cameraModels === undefined ? {} : { cameraModels: request.cameraModels }),
          ...(request.lensModels === undefined ? {} : { lensModels: request.lensModels }),
          ...(request.scope === undefined ? {} : { scope: request.scope }),
        }) as AgentToolResolveAssetSearchFiltersRequestMetadata,
      requestedAssetCount: () => 0,
      requestedAlbumCount: () => 0,
      perToolLimit: () => Number.MAX_SAFE_INTEGER,
      perSessionLimit: () => Number.MAX_SAFE_INTEGER,
      validateAccess: (auth, session, request) =>
        this.assetSearchFilterResolverService.validateToolAccess(auth, session, request),
      execute: (auth, session, request) =>
        this.assetSearchFilterResolverService.resolveToolFilters(auth, session, request),
      responseSummary: (result) =>
        `Resolved ${result.results.filter((item) => item.status === 'matched').length} search filter(s)`,
      responseMetadata: (result) => ({
        ...(result.resolvedFilters.tagIds?.length ? { tagIds: result.resolvedFilters.tagIds } : {}),
        ...(result.resolvedFilters.albumIds?.length ? { albumIds: result.resolvedFilters.albumIds } : {}),
        ...(result.resolvedFilters.spaceId ? { spaceIds: [result.resolvedFilters.spaceId] } : {}),
        ...(result.resolvedFilters.personIds?.length ? { personIds: result.resolvedFilters.personIds } : {}),
        ...(result.resolvedFilters.spacePersonIds?.length
          ? { spacePersonIds: result.resolvedFilters.spacePersonIds }
          : {}),
      }),
      resultAssetCount: () => 0,
      resultAlbumCount: () => 0,
      resultSize: (result) => ({
        returnedItems: result.results.length,
        hasMore: false,
        nextPage: null,
      }),
      failedReason: 'Search filter resolution failed',
    };
  }

  private resolveLocationDescriptor(): AgentReadToolDescriptor<
    AgentResolveLocationToolRequestDto,
    { location: AgentResolveLocationResult }
  > {
    return {
      toolName: AgentToolName.ResolveLocation,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: (request) => `Resolve location: ${request.query ?? '(retry)'}`,
      requestMetadata: (request) => ({ query: request.query ?? '' }) as AgentToolCall['redactedRequestMetadata'],
      requestedAssetCount: () => 0,
      requestedAlbumCount: () => 0,
      perToolLimit: () => Number.MAX_SAFE_INTEGER,
      perSessionLimit: () => Number.MAX_SAFE_INTEGER,
      validateAccess: () => Promise.resolve(null),
      execute: async (_auth, _session, request) => {
        const query = request.query ?? '';
        if (!query) {
          return { location: { status: 'not_found' } };
        }
        const rows = await this.mapRepository.searchPlaces(query);
        return { location: this.decideLocation(rows) };
      },
      responseSummary: (result) => {
        const loc = result.location;
        if (loc.status === 'matched') {
          return `Resolved location: ${loc.label}`;
        }
        if (loc.status === 'ambiguous') {
          return `Ambiguous location — ${loc.choices?.length ?? 0} choice(s)`;
        }
        return 'Location not found';
      },
      responseMetadata: (result) =>
        ({ locationStatus: result.location.status }) as AgentToolCall['redactedResponseMetadata'],
      resultAssetCount: () => 0,
      resultAlbumCount: () => 0,
      resultSize: () => ({ returnedItems: 1, hasMore: false, nextPage: null }),
      failedReason: 'Location resolution failed',
    };
  }

  private decideLocation(rows: Awaited<ReturnType<MapRepository['searchPlaces']>>): AgentResolveLocationResult {
    if (rows.length === 0) {
      return { status: 'not_found' };
    }

    // Dedupe to distinct (name, admin1Name, countryCode)
    const seen = new Map<string, (typeof rows)[0]>();
    for (const row of rows) {
      const key = `${row.name}|${row.admin1Name ?? ''}|${row.countryCode}`;
      if (!seen.has(key)) {
        seen.set(key, row);
      }
    }
    const distinct = [...seen.values()];

    const best = distinct[0];
    if (best.similarity < 0.3) {
      return { status: 'not_found' };
    }

    const isMatched =
      distinct.length === 1 || (distinct.length > 1 && best.similarity - distinct[1].similarity >= 0.15);

    if (isMatched) {
      const label = this.buildLocationLabel(best.name, best.admin1Name, best.countryCode);
      return { status: 'matched', latitude: best.latitude, longitude: best.longitude, label };
    }

    const choices = distinct.slice(0, 5).map((row) => ({
      latitude: row.latitude,
      longitude: row.longitude,
      label: this.buildLocationLabel(row.name, row.admin1Name, row.countryCode),
      countryCode: row.countryCode,
    }));
    return { status: 'ambiguous', choices };
  }

  private buildLocationLabel(name: string, admin1Name: string | null, countryCode: string): string {
    return admin1Name ? `${name}, ${admin1Name}, ${countryCode}` : `${name}, ${countryCode}`;
  }

  private searchPeopleDescriptor(): AgentReadToolDescriptor<
    AgentSearchPeopleToolRequestDto,
    { people: AgentSearchPeopleResult }
  > {
    return {
      toolName: AgentToolName.SearchPeople,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: (request) => `Search people: ${request.name ?? '(retry)'}`,
      requestMetadata: (request) => ({ name: request.name ?? '' }) as AgentToolCall['redactedRequestMetadata'],
      requestedAssetCount: () => 0,
      requestedAlbumCount: () => 0,
      perToolLimit: () => Number.MAX_SAFE_INTEGER,
      perSessionLimit: () => Number.MAX_SAFE_INTEGER,
      validateAccess: () => Promise.resolve(null),
      execute: async (auth, _session, request) => {
        const name = request.name ?? '';
        if (!name) {
          return { people: { status: 'not_found' } };
        }
        const rows = await this.personRepository.getByName(auth.user.id, name, {
          withHidden: request.includeHidden ?? false,
        });
        return { people: this.decidePeople(rows, name) };
      },
      responseSummary: (result) => {
        const p = result.people;
        if (p.status === 'matched') {
          return `Resolved person: ${p.name}`;
        }
        if (p.status === 'ambiguous') {
          return `Ambiguous person — ${p.choices?.length ?? 0} choice(s)`;
        }
        return 'Person not found';
      },
      responseMetadata: (result) =>
        ({ peopleStatus: result.people.status }) as AgentToolCall['redactedResponseMetadata'],
      resultAssetCount: () => 0,
      resultAlbumCount: () => 0,
      resultSize: () => ({ returnedItems: 1, hasMore: false, nextPage: null }),
      failedReason: 'People search failed',
    };
  }

  private decidePeople(
    rows: Awaited<ReturnType<PersonRepository['getByName']>>,
    query: string,
  ): AgentSearchPeopleResult {
    if (rows.length === 0) {
      return { status: 'not_found' };
    }

    const exact = rows.filter((r) => normName(r.name) === normName(query));

    const ambiguous = (list: typeof rows) => ({
      status: 'ambiguous' as const,
      choices: list.slice(0, 5).map((r) => ({ personId: r.id, name: r.name, thumbnailAssetId: r.faceAssetId })),
    });

    if (exact.length === 1) {
      return { status: 'matched', personId: exact[0].id, name: exact[0].name, thumbnailAssetId: exact[0].faceAssetId };
    }
    if (exact.length > 1) {
      return ambiguous(exact);
    }
    return ambiguous(rows);
  }

  private getResolverTermCount(request: AgentResolveAssetSearchFiltersToolRequestDto): number {
    return [
      request.people,
      request.tags,
      request.albums,
      request.spaces,
      request.cameraMakes,
      request.cameraModels,
      request.lensModels,
    ].reduce((total, terms) => total + (terms?.length ?? 0), 0);
  }

  private curateSelectionDescriptor(): AgentReadToolDescriptor<
    AgentCurateSelectionToolRequestDto,
    {
      summary: string;
      strategy: AgentCurateSelectionStrategy;
      selectionHandle: AgentSearchAssetsSelectionHandleResult;
      sourceAssetCount: number;
      selectedAssetCount: number;
      criteriaSummary: string[];
      warnings?: string[];
      sample?: AgentSearchAssetsSample;
    }
  > {
    const selectionTooLargeInstruction =
      'Rerun searchAssets with narrower filters or page the result, then retry curateSelection with a smaller same-session selectionHandle.id.';

    return {
      toolName: AgentToolName.CurateSelection,
      dataClass: AgentToolDataClass.Metadata,
      prepareRequest: async (auth, session, request) => {
        const handle = await this.getValidSelectionMetadataHandle(auth, session, request.selectionHandleId ?? '');
        const sourceLimit = Math.min(
          session.permissionPlanSnapshot.limits.maxAssetsPerToolCall,
          maxMetadataCurationSourceAssets,
        );
        if (handle.assetCount > sourceLimit) {
          throw selectionTooLargeError({
            toolName: AgentToolName.CurateSelection,
            sourceAssetCount: handle.assetCount,
            maxSourceAssetCount: sourceLimit,
            instruction: selectionTooLargeInstruction,
          });
        }
        return { ...request, resolvedSourceAssetCount: handle.assetCount };
      },
      requestSummary: (request) =>
        `Curate ${request.targetCount ?? 0} ${request.strategy ?? 'metadata-highlights'} asset(s) from handle ${request.selectionHandleId}`,
      requestMetadata: (request) =>
        ({
          selectionHandleId: request.selectionHandleId ?? '',
          targetCount: request.targetCount ?? 0,
          strategy: request.strategy ?? 'metadata-highlights',
          ...(request.criteria ? { criteria: request.criteria } : {}),
          constraints: request.constraints ?? {},
          sampleSize: request.sampleSize ?? 10,
        }) as AgentToolCurateSelectionRequestMetadata,
      requestedAssetCount: (request) =>
        (request as PreparedCurateSelectionRequest).resolvedSourceAssetCount ?? request.targetCount ?? 0,
      requestedAlbumCount: () => 0,
      perToolLimit: (plan) => Math.min(plan.limits.maxAssetsPerToolCall, maxMetadataCurationSourceAssets),
      perToolLimitDenialReason: (request, limit) =>
        `Selection has ${(request as PreparedCurateSelectionRequest).resolvedSourceAssetCount ?? 0} assets, but metadata-only curation allows ${limit}. Narrow the search before curation.`,
      perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
      validateAccess: async (auth, session, request) => {
        const handle = await this.getValidSelectionMetadataHandle(auth, session, request.selectionHandleId ?? '');
        const sourceLimit = Math.min(
          session.permissionPlanSnapshot.limits.maxAssetsPerToolCall,
          maxMetadataCurationSourceAssets,
        );
        if (handle.assetCount > sourceLimit) {
          throw selectionTooLargeError({
            toolName: AgentToolName.CurateSelection,
            sourceAssetCount: handle.assetCount,
            maxSourceAssetCount: sourceLimit,
            instruction: selectionTooLargeInstruction,
          });
        }
        return null;
      },
      execute: async (auth, session, request, toolCallId) => {
        const handle = await this.getValidSelectionMetadataHandle(auth, session, request.selectionHandleId ?? '');
        const sourceLimit = Math.min(
          session.permissionPlanSnapshot.limits.maxAssetsPerToolCall,
          maxMetadataCurationSourceAssets,
        );
        if (handle.assetCount > sourceLimit) {
          throw selectionTooLargeError({
            toolName: AgentToolName.CurateSelection,
            sourceAssetCount: handle.assetCount,
            maxSourceAssetCount: sourceLimit,
            instruction: selectionTooLargeInstruction,
          });
        }

        const unorderedAssets =
          handle.assetIds.length > 0 ? await this.assetRepository.getAgentMetadataByIds(handle.assetIds) : [];
        const assetsById = new Map(unorderedAssets.map((asset) => [asset.id, asset as AgentAssetMetadata]));
        const orderedAssets = handle.assetIds.flatMap((id) => {
          const asset = assetsById.get(id);
          return asset ? [asset] : [];
        });
        const { selectedAssets, criteriaSummary, warnings } = this.curateMetadataSelection({
          assets: orderedAssets,
          targetCount: request.targetCount ?? 0,
          strategy: request.strategy ?? 'metadata-highlights',
          constraints: request.constraints ?? {},
          criteria: request.criteria,
        });
        const selectedIds = selectedAssets.map((asset) => asset.id);
        const derived = await this.selectionHandleRepository.create({
          sessionId: session.id,
          userId: auth.user.id,
          sourceToolCallId: toolCallId,
          assetIds: selectedIds,
          expiresAt: this.getSelectionHandleExpiresAt(session),
        });
        const sampleSize = request.sampleSize ?? 10;
        const sampleAssets = sampleSize > 0 ? selectedAssets.slice(0, sampleSize) : [];
        const sample = this.buildSearchSample(
          sampleAssets.map((asset) =>
            this.mapSelectedAssetMetadata(this.mapAssetMetadata(asset), [
              'type',
              'dates',
              'location',
              'tags',
              'rating',
              'filename',
              'favorite',
            ]),
          ),
        );

        return {
          summary: `Curated ${selectedIds.length} metadata-only ${request.strategy ?? 'metadata-highlights'} asset${selectedIds.length === 1 ? '' : 's'} from ${handle.assetCount} source asset${handle.assetCount === 1 ? '' : 's'}.`,
          strategy: request.strategy ?? 'metadata-highlights',
          selectionHandle: this.mapSearchSelectionHandle(derived),
          sourceAssetCount: handle.assetCount,
          selectedAssetCount: selectedIds.length,
          criteriaSummary,
          ...(warnings.length > 0 ? { warnings } : {}),
          ...(sample ? { sample } : {}),
        };
      },
      responseSummary: (result) => result.summary,
      responseMetadata: (result) => ({
        selectionHandleIds: [result.selectionHandle.id],
        sourceRefs: [result.selectionHandle.sourceRef],
        selectionHandleAssetCount: result.selectionHandle.assetCount,
      }),
      resultAssetCount: (result) => result.sourceAssetCount,
      resultAlbumCount: () => 0,
      resultSize: (result) => ({ returnedItems: result.selectedAssetCount, hasMore: false, nextPage: null }),
      truncateForBudget: (result, budgetBytes) => this.truncateCurateSelectionResult(result, budgetBytes),
      failedReason: 'Selection curation failed',
    };
  }

  private readSelectionMetadataDescriptor(): AgentReadToolDescriptor<
    AgentReadSelectionMetadataToolRequestDto,
    {
      summary: string;
      selectionHandle: AgentSearchAssetsSelectionHandleResult;
      fields: AgentAssetMetadataField[];
      counts: AgentReadSelectionMetadataCounts;
      sample?: AgentSearchAssetsSample;
    }
  > {
    return {
      toolName: AgentToolName.ReadSelectionMetadata,
      dataClass: AgentToolDataClass.Metadata,
      prepareRequest: async (auth, session, request) => {
        const handle = await this.getValidSelectionMetadataHandle(auth, session, request.selectionHandleId ?? '');
        return { ...request, resolvedSelectionHandleAssetCount: handle.assetCount };
      },
      requestSummary: (request) =>
        `Read selection metadata for handle ${request.selectionHandleId} (${request.sampleSize ?? 10} sample(s))`,
      requestMetadata: (request) =>
        ({
          selectionHandleId: request.selectionHandleId ?? '',
          fields: request.fields ?? [],
          sampleSize: request.sampleSize ?? 10,
        }) as AgentToolReadSelectionMetadataRequestMetadata,
      requestedAssetCount: (request) =>
        (request as PreparedSelectionMetadataRequest).resolvedSelectionHandleAssetCount ?? request.sampleSize ?? 10,
      requestedAlbumCount: () => 0,
      perToolLimit: (plan) => plan.limits.maxAssetsPerToolCall,
      perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
      validateAccess: async (auth, session, request) => {
        await this.getValidSelectionMetadataHandle(auth, session, request.selectionHandleId ?? '');
        return null;
      },
      execute: async (auth, session, request) => {
        const handle = await this.getValidSelectionMetadataHandle(auth, session, request.selectionHandleId ?? '');
        const fields = request.fields ?? [];
        const sampleAssetIds = handle.sampleAssetIds.slice(0, request.sampleSize ?? 10);
        const unorderedAssets =
          sampleAssetIds.length > 0 ? await this.assetRepository.getAgentMetadataByIds(sampleAssetIds) : [];
        const assetsById = new Map(
          unorderedAssets.map((asset) => [asset.id, this.mapAssetMetadata(asset as AgentAssetMetadata)]),
        );
        const sampleAssets = sampleAssetIds.flatMap((id) => {
          const asset = assetsById.get(id);
          return asset ? [asset] : [];
        });
        const sample = this.buildSearchSample(
          sampleAssets.map((asset) => this.mapSelectedAssetMetadata(asset, fields)),
        );
        const sampled = sample?.items.length ?? 0;

        return {
          summary: this.getReadSelectionMetadataResponseSummary(handle.assetCount, sampled),
          selectionHandle: this.mapSearchSelectionHandle(handle),
          fields,
          counts: { assets: handle.assetCount, sampled },
          ...(sample ? { sample } : {}),
        };
      },
      responseSummary: (result) => result.summary,
      responseMetadata: (result) => ({
        selectionHandleIds: [result.selectionHandle.id],
        sourceRefs: [result.selectionHandle.sourceRef],
        selectionHandleAssetCount: result.selectionHandle.assetCount,
      }),
      resultAssetCount: (result) => result.counts.sampled,
      resultAlbumCount: () => 0,
      resultSize: (result) => ({
        returnedItems: result.counts.sampled,
        hasMore: false,
        nextPage: null,
      }),
      truncateForBudget: (result, budgetBytes) => this.truncateSelectionMetadataResult(result, budgetBytes),
      failedReason: 'Selection metadata read failed',
    };
  }

  private readAssetMetadataDescriptor(): AgentReadToolDescriptor<
    AgentReadAssetMetadataToolRequestDto,
    {
      summary: string;
      detail?: AgentAssetMetadataDetail;
      fields: AgentAssetMetadataField[];
      assets: AgentAssetMetadataResult[];
    }
  > {
    return {
      toolName: AgentToolName.ReadAssetMetadata,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: (request) =>
        `Read ${this.getReadAssetMetadataSelectionLabel(request)} metadata for ${(request.assetIds ?? []).length} asset(s)`,
      requestMetadata: (request) =>
        ({
          assetIds: request.assetIds ?? [],
          ...(request.fields ? { fields: request.fields } : { detail: request.detail ?? 'basic' }),
        }) as AgentToolReadAssetMetadataRequestMetadata,
      requestedAssetCount: (request) => (request.assetIds ?? []).length,
      requestedAlbumCount: () => 0,
      perToolLimit: (plan) => plan.limits.maxAssetsPerToolCall,
      perToolLimitDenialReason: (request, limit) =>
        `Requested ${(request.assetIds ?? []).length} assets, but this session allows ${limit} per metadata read. Request fewer asset IDs or split the metadata read into smaller batches.`,
      perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
      validateAccess: (auth, session, request) =>
        this.validateAssetAccess(auth, session, request.assetIds ?? [], AgentToolName.ReadAssetMetadata),
      execute: async (_auth, _session, request) => {
        const assetIds = request.assetIds ?? [];
        const detail = request.fields ? undefined : (request.detail ?? 'basic');
        const fields = request.fields ?? this.getReadAssetMetadataPresetFields(detail);
        const unorderedAssets = await this.assetRepository.getAgentMetadataByIds(assetIds);
        const assetsById = new Map(
          unorderedAssets.map((asset) => [asset.id, this.mapAssetMetadata(asset as AgentAssetMetadata)]),
        );
        const assets = assetIds.flatMap((id) => {
          const asset = assetsById.get(id);
          return asset ? [asset] : [];
        });

        if (assets.length !== assetIds.length) {
          throw this.getAgentMetadataHydrationError(
            assets.map((asset) => asset.id),
            'One or more assets were not found during metadata read',
          );
        }

        return {
          summary: this.getReadAssetMetadataResponseSummary(detail ?? 'custom', assets.length),
          ...(detail ? { detail } : {}),
          fields,
          assets: assets.map((asset) => this.mapSelectedAssetMetadata(asset, fields)),
        };
      },
      responseSummary: (result) => result.summary,
      responseMetadata: (result) => ({ assetIds: result.assets.map((asset) => asset.id) }),
      resultAssetCount: (result) => result.assets.length,
      resultAlbumCount: () => 0,
      resultSize: (result) => ({
        returnedItems: result.assets.length,
        hasMore: false,
        nextPage: null,
      }),
      truncateForBudget: (result, budgetBytes) => this.truncateAssetMetadataResult(result, budgetBytes),
      failedReason: 'Metadata read failed',
    };
  }

  private readAssetPreviewsDescriptor(): AgentReadToolDescriptor<
    AgentReadAssetPreviewsToolRequestDto,
    { previews: AgentAssetMediaReference[] }
  > {
    return this.assetReferenceDescriptor({
      toolName: AgentToolName.ReadAssetPreviews,
      dataClass: AgentToolDataClass.Previews,
      requestSummary: (count) => `Read previews for ${count} asset(s)`,
      responseSummary: (count) => `Returned previews for ${count} asset(s)`,
      perToolLimit: (plan) => plan.limits.maxPreviewsPerToolCall,
      perSessionLimit: (plan) => plan.limits.maxPreviewsPerSession ?? plan.limits.maxPreviewsPerToolCall ?? 0,
      execute: (ids) => this.assetRepository.getAgentPreviewReferencesByIds(ids),
      resultKey: 'previews',
      failedReason: 'Preview read failed',
    });
  }

  private readAssetOriginalsDescriptor(): AgentReadToolDescriptor<
    AgentReadAssetOriginalsToolRequestDto,
    { originals: AgentAssetMediaReference[] }
  > {
    return this.assetReferenceDescriptor({
      toolName: AgentToolName.ReadAssetOriginals,
      dataClass: AgentToolDataClass.Originals,
      requestSummary: (count) => `Read originals for ${count} asset(s)`,
      responseSummary: (count) => `Returned originals for ${count} asset(s)`,
      perToolLimit: (plan) => plan.limits.maxOriginalsPerToolCall,
      perSessionLimit: (plan) => plan.limits.maxOriginalsPerSession ?? plan.limits.maxOriginalsPerToolCall ?? 0,
      execute: (ids) => this.assetRepository.getAgentOriginalReferencesByIds(ids),
      resultKey: 'originals',
      failedReason: 'Original read failed',
    });
  }

  private assetReferenceDescriptor<TKey extends 'previews' | 'originals'>(options: {
    toolName: AgentToolName;
    dataClass: AgentToolDataClass;
    requestSummary: (count: number) => string;
    responseSummary: (count: number) => string;
    perToolLimit: (plan: AgentPermissionPlanSnapshot) => number;
    perSessionLimit: (plan: AgentPermissionPlanSnapshot) => number;
    execute: (assetIds: string[]) => Promise<AgentAssetMediaReference[]>;
    resultKey: TKey;
    failedReason: string;
  }): AgentReadToolDescriptor<
    { assetIds?: string[]; toolCallId?: string },
    TKey extends 'previews' ? { previews: AgentAssetMediaReference[] } : { originals: AgentAssetMediaReference[] }
  > {
    type Result = TKey extends 'previews'
      ? { previews: AgentAssetMediaReference[] }
      : { originals: AgentAssetMediaReference[] };

    return {
      toolName: options.toolName,
      dataClass: options.dataClass,
      requestSummary: (request) => options.requestSummary((request.assetIds ?? []).length),
      requestMetadata: (request) => ({ assetIds: request.assetIds ?? [] }),
      requestedAssetCount: (request) => (request.assetIds ?? []).length,
      requestedAlbumCount: () => 0,
      perToolLimit: options.perToolLimit,
      perSessionLimit: options.perSessionLimit,
      validateAccess: (auth, session, request) =>
        this.validateAssetAccess(auth, session, request.assetIds ?? [], options.toolName),
      execute: async (_auth, _session, request) => {
        const refs = await options.execute(request.assetIds ?? []);
        return { [options.resultKey]: refs } as Result;
      },
      responseSummary: (result) => options.responseSummary(this.getMediaReferences(result, options.resultKey).length),
      responseMetadata: (result) => ({
        assetIds: this.getMediaReferences(result, options.resultKey).map((reference) => reference.assetId),
      }),
      resultAssetCount: (result) => this.getMediaReferences(result, options.resultKey).length,
      resultAlbumCount: () => 0,
      resultSize: (result) => ({
        returnedItems: this.getMediaReferences(result, options.resultKey).length,
        hasMore: false,
        nextPage: null,
      }),
      failedReason: options.failedReason,
    };
  }

  private listAlbumsDescriptor(): AgentReadToolDescriptor<
    AgentListAlbumsToolRequestDto,
    { albums: AgentAlbumSummary[] }
  > {
    return {
      toolName: AgentToolName.ListAlbums,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: () => 'List albums',
      requestMetadata: () => ({}) as AgentToolListAlbumsRequestMetadata,
      requestedAssetCount: () => 0,
      requestedAlbumCount: () => 0,
      perToolLimit: () => Number.MAX_SAFE_INTEGER,
      perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
      validateAccess: () => Promise.resolve(null),
      execute: async (auth, session) => {
        const albums = await this.albumRepository.getAgentAlbums(auth.user.id);
        return {
          albums: albums.filter((album) => {
            const isOwned = album.ownerId === auth.user.id;
            return isOwned
              ? session.permissionPlanSnapshot.assetScope.owned
              : session.permissionPlanSnapshot.assetScope.sharedSpaces;
          }),
        };
      },
      responseSummary: (result) => `Returned ${result.albums.length} album(s)`,
      responseMetadata: (result) => ({ albumIds: result.albums.map((album) => album.id) }),
      resultAssetCount: () => 0,
      resultAlbumCount: (result) => result.albums.length,
      resultSize: (result) => ({
        returnedItems: result.albums.length,
        hasMore: false,
        nextPage: null,
      }),
      failedReason: 'Album list failed',
    };
  }

  private readAlbumDescriptor(): AgentReadToolDescriptor<AgentReadAlbumToolRequestDto, { album: AgentAlbumDetail }> {
    return {
      toolName: AgentToolName.ReadAlbum,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: (request) => `Read album ${request.albumId}`,
      requestMetadata: (request) => ({ albumId: request.albumId ?? '' }),
      requestedAssetCount: () => 0,
      requestedAlbumCount: () => 1,
      perToolLimit: () => Number.MAX_SAFE_INTEGER,
      perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
      validateAccess: (auth, session, request) => this.validateAlbumAccess(auth, session, request.albumId ?? ''),
      execute: async (auth, session, request, toolCallId) => {
        const album = await this.albumRepository.getAgentAlbumById(auth.user.id, request.albumId ?? '');
        if (!album) {
          throw new AgentToolDeniedError('Album is not accessible');
        }

        if (album.assetCount > session.permissionPlanSnapshot.limits.maxAssetsPerToolCall) {
          throw new AgentToolDeniedError('Requested asset count exceeds per-tool limit');
        }

        const reservation = await this.toolCallRepository.transitionWithSessionLimit(
          session.id,
          toolCallId,
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
          session.permissionPlanSnapshot.limits.maxAssetsPerSession,
        );

        await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });

        if (reservation.status === 'stale') {
          throw new BadRequestException('Agent tool call is already executing or completed');
        }

        if (reservation.status === 'limit-exceeded') {
          throw new AgentToolRecordedDeniedError(
            this.getSessionLimitReason(session.permissionPlanSnapshot.limits.maxAssetsPerSession),
            reservation.toolCall,
          );
        }

        return { album };
      },
      responseSummary: (result) => `Returned album with ${result.album.assetCount} asset(s)`,
      responseMetadata: (result) => ({ albumIds: [result.album.id], assetIds: result.album.assetIds }),
      resultAssetCount: (result) => result.album.assetCount,
      resultAlbumCount: () => 1,
      resultSize: () => ({
        returnedItems: 1,
        hasMore: false,
        nextPage: null,
      }),
      failedReason: 'Album read failed',
    };
  }

  private listSpacesDescriptor(): AgentReadToolDescriptor<
    AgentListSpacesToolRequestDto,
    { spaces: AgentSpaceSummary[] }
  > {
    return {
      toolName: AgentToolName.ListSpaces,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: () => 'List spaces',
      requestMetadata: () => ({}) as AgentToolListSpacesRequestMetadata,
      requestedAssetCount: () => 0,
      requestedAlbumCount: () => 0,
      perToolLimit: () => Number.MAX_SAFE_INTEGER,
      perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
      validateAccess: (_auth, session) =>
        Promise.resolve(
          session.permissionPlanSnapshot.assetScope.sharedSpaces
            ? null
            : 'Shared spaces are not accessible for this session',
        ),
      execute: async (auth) => {
        const spaces = await this.sharedSpaceRepository.getAllByUserId(auth.user.id);
        const summaries: AgentSpaceSummary[] = [];

        for (const space of spaces) {
          summaries.push(await this.mapAgentSpaceSummary(space));
        }

        return { spaces: summaries };
      },
      responseSummary: (result) => `Returned ${result.spaces.length} space(s)`,
      responseMetadata: (result) => ({ spaceIds: result.spaces.map((space) => space.id) }),
      resultAssetCount: () => 0,
      resultAlbumCount: () => 0,
      resultSize: (result) => ({
        returnedItems: result.spaces.length,
        hasMore: false,
        nextPage: null,
      }),
      failedReason: 'Space list failed',
    };
  }

  private listDuplicateGroupsDescriptor(): AgentReadToolDescriptor<
    AgentListDuplicateGroupsToolRequestDto,
    { groups: AgentDuplicateGroup[] }
  > {
    return {
      toolName: AgentToolName.ListDuplicateGroups,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: (request) => `List duplicate groups (max ${request.maxGroups ?? 50})`,
      requestMetadata: () => ({}) as AgentToolListDuplicateGroupsRequestMetadata,
      requestedAssetCount: () => 0,
      requestedAlbumCount: () => 0,
      perToolLimit: () => Number.MAX_SAFE_INTEGER,
      perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
      validateAccess: () => Promise.resolve(null),
      execute: async (auth, _session, request) => {
        const maxGroups = request.maxGroups ?? 50;
        const rows = await this.duplicateRepository.getAll(auth.user.id);
        const slicedRows = rows.slice(0, maxGroups);
        const allAssetIds = slicedRows.flatMap(({ assets }) => assets.map((a) => a.id));
        const qualityRows = await this.assetRepository.getAssetQualityByIds(allAssetIds);
        const sharpnessById = new Map(qualityRows.map((r) => [r.assetId, r.sharpness]));
        const groups: AgentDuplicateGroup[] = slicedRows.map(({ duplicateId, assets }) => ({
          duplicateId,
          assets: assets.map(
            (asset): AgentDuplicateAsset => ({
              id: asset.id,
              originalFileName: asset.originalFileName,
              fileCreatedAt: asset.fileCreatedAt,
              isFavorite: asset.isFavorite,
              rating: asset.exifInfo?.rating ?? null,
              width: asset.exifInfo?.exifImageWidth ?? null,
              height: asset.exifInfo?.exifImageHeight ?? null,
              sharpness: sharpnessById.get(asset.id) ?? null,
            }),
          ),
        }));
        return { groups };
      },
      responseSummary: (result) => `Returned ${result.groups.length} duplicate group(s)`,
      responseMetadata: () => ({}),
      resultAssetCount: () => 0,
      resultAlbumCount: () => 0,
      resultSize: (result) => ({
        returnedItems: result.groups.length,
        hasMore: false,
        nextPage: null,
      }),
      failedReason: 'Duplicate group list failed',
    };
  }

  private readSpaceDescriptor(): AgentReadToolDescriptor<AgentReadSpaceToolRequestDto, { space: AgentSpaceDetail }> {
    return {
      toolName: AgentToolName.ReadSpace,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: (request) => `Read space ${request.spaceId}`,
      requestMetadata: (request) => ({ spaceId: request.spaceId ?? '' }) as AgentToolReadSpaceRequestMetadata,
      requestedAssetCount: () => 0,
      requestedAlbumCount: () => 0,
      perToolLimit: () => Number.MAX_SAFE_INTEGER,
      perSessionLimit: (plan) => plan.limits.maxAssetsPerSession,
      validateAccess: (auth, session, request) => this.validateSharedSpaceAccess(auth, session, request.spaceId ?? ''),
      execute: async (auth, session, request, toolCallId) => {
        const spaceId = request.spaceId ?? '';
        const denialReason = await this.validateSharedSpaceAccess(auth, session, spaceId);
        if (denialReason) {
          throw new AgentToolDeniedError(denialReason);
        }

        const spaceRow = await this.sharedSpaceRepository.getById(spaceId);
        if (!spaceRow) {
          throw new AgentToolDeniedError('Space is not accessible');
        }

        const members = await this.sharedSpaceRepository.getMembers(spaceId);
        const assetCount = await this.sharedSpaceRepository.getAssetCount(spaceId);
        const recentAssets = await this.sharedSpaceRepository.getRecentAssets(spaceId);
        const assetRows = await this.sharedSpaceRepository.getAssetIdsInSpacePage(spaceId, {
          limit: maxAgentSpaceAssetIds + 1,
        });
        const assetIds = assetRows.slice(0, maxAgentSpaceAssetIds).map((row) => row.assetId);
        const assetIdsTruncated = assetRows.length > maxAgentSpaceAssetIds || assetCount > maxAgentSpaceAssetIds;

        const reservation = await this.toolCallRepository.transitionWithSessionLimit(
          session.id,
          toolCallId,
          AgentToolCallStatus.Executing,
          {
            status: AgentToolCallStatus.Executing,
            approvalDecision: AgentToolApprovalDecision.Approved,
            responseSummary: 'Tool call execution started',
            redactedResponseMetadata: null,
            assetCount: assetIds.length,
            albumCount: 0,
            completedAt: null,
            error: null,
          },
          AgentToolDataClass.Metadata,
          session.permissionPlanSnapshot.limits.maxAssetsPerSession,
        );

        await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });

        if (reservation.status === 'stale') {
          throw new BadRequestException('Agent tool call is already executing or completed');
        }

        if (reservation.status === 'limit-exceeded') {
          throw new AgentToolRecordedDeniedError(
            this.getSessionLimitReason(session.permissionPlanSnapshot.limits.maxAssetsPerSession),
            reservation.toolCall,
          );
        }

        return {
          space: {
            ...this.mapAgentSpaceSummaryFromParts(spaceRow, members.length, assetCount, recentAssets),
            members: members.map((member) => this.mapAgentSpaceMember(member)),
            assetIds,
            assetIdsReturned: assetIds.length,
            assetIdsTruncated,
          },
        };
      },
      responseSummary: (result) =>
        result.space.assetIdsTruncated
          ? `Returned space with ${result.space.assetIdsReturned} of ${result.space.assetCount} asset id(s)`
          : `Returned space with ${result.space.assetIdsReturned} asset id(s)`,
      responseMetadata: (result) => ({ spaceIds: [result.space.id], assetIds: result.space.assetIds }),
      resultAssetCount: (result) => result.space.assetIds.length,
      resultAlbumCount: () => 0,
      resultSize: () => ({
        returnedItems: 1,
        hasMore: false,
        nextPage: null,
      }),
      failedReason: 'Space read failed',
    };
  }

  private searchUsersDescriptor(): AgentReadToolDescriptor<
    AgentSearchUsersToolRequestDto,
    { users: AgentUserLookupResult[] }
  > {
    return {
      toolName: AgentToolName.SearchUsers,
      dataClass: AgentToolDataClass.Metadata,
      requestSummary: (request) => (request.query ? `Search users matching "${request.query}"` : 'Search users'),
      requestMetadata: (request) =>
        ({ query: request.query ?? '', limit: request.limit ?? 20 }) as AgentToolSearchUsersRequestMetadata,
      requestedAssetCount: () => 0,
      requestedAlbumCount: () => 0,
      perToolLimit: () => Number.MAX_SAFE_INTEGER,
      perSessionLimit: () => Number.MAX_SAFE_INTEGER,
      validateAccess: () => Promise.resolve(null),
      execute: async (auth, _session, request) => {
        const query = (request.query ?? '').toLocaleLowerCase();
        const visibleUsers = await this.userService.search(auth);
        const users = visibleUsers
          .filter((user) => {
            if (!query) {
              return true;
            }

            return user.name.toLocaleLowerCase().includes(query) || user.email.toLocaleLowerCase().includes(query);
          })
          .slice(0, request.limit ?? 20)
          .map((user) => ({
            userId: user.id,
            name: user.name,
            email: user.email ?? null,
            avatarColor: user.avatarColor ?? null,
            profileImagePath: user.profileImagePath || null,
          }));

        return { users };
      },
      responseSummary: (result) => `Returned ${result.users.length} user(s)`,
      responseMetadata: (result) => ({ userIds: result.users.map((user) => user.userId) }),
      resultAssetCount: () => 0,
      resultAlbumCount: () => 0,
      resultSize: (result) => ({
        returnedItems: result.users.length,
        hasMore: false,
        nextPage: null,
      }),
      failedReason: 'User search failed',
    };
  }

  private async createExecutingAuditWithSessionLimit<TRequest, TResult extends Record<string, unknown>>(
    session: AgentSession,
    request: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
    executingDto: ToolCallCreate,
  ): Promise<AgentToolCall | { status: 'limit-exceeded'; toolCall: AgentToolCall; reason: string }> {
    const maxAssetsPerSession = descriptor.perSessionLimit(session.permissionPlanSnapshot);
    const reason = this.getSessionLimitReason(maxAssetsPerSession);
    const deniedDto: ToolCallCreate = {
      ...this.baseToolCall(session, request, descriptor),
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      responseSummary: null,
      redactedResponseMetadata: this.withResultSizeMetadata(null, this.emptyResultSize()),
      completedAt: new Date(),
      error: reason,
    };
    const result = await this.toolCallRepository.createWithSessionLimit(
      executingDto,
      deniedDto,
      descriptor.dataClass,
      maxAssetsPerSession,
    );
    return result.status === 'limit-exceeded'
      ? { status: 'limit-exceeded', toolCall: result.toolCall, reason }
      : result.toolCall;
  }

  private shouldUseAtomicSessionLimit<TRequest, TResult extends Record<string, unknown>>(
    session: AgentSession,
    request: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
  ): boolean {
    const requestedAssetCount = descriptor.requestedAssetCount(request);
    const maxAssetsPerSession = descriptor.perSessionLimit(session.permissionPlanSnapshot);
    return requestedAssetCount > 0 && maxAssetsPerSession !== Number.MAX_SAFE_INTEGER;
  }

  private getPolicyDenial(session: AgentSession, dataClass: AgentToolDataClass): string | null {
    const { read, providerExposure } = session.permissionPlanSnapshot;

    if (dataClass === AgentToolDataClass.Metadata && !read.metadata) {
      return 'Agent permission policy does not allow metadata reads';
    }
    if (dataClass === AgentToolDataClass.Previews && !read.previews) {
      return 'Agent permission policy does not allow preview reads';
    }
    if (dataClass === AgentToolDataClass.Originals && !read.originals) {
      return 'Agent permission policy does not allow original reads';
    }

    if (dataClass === AgentToolDataClass.Metadata && !providerExposure.metadata) {
      return 'Agent provider exposure policy does not allow metadata reads';
    }
    if (dataClass === AgentToolDataClass.Previews && !providerExposure.previews) {
      return 'Agent provider exposure policy does not allow preview reads';
    }
    if (dataClass === AgentToolDataClass.Originals && !providerExposure.originals) {
      return 'Agent provider exposure policy does not allow original reads';
    }

    if (
      dataClass === AgentToolDataClass.Originals &&
      !providerExposure.allowOriginalsForExternalProviders &&
      session.credentialSnapshot.providerType !== AgentProviderType.OpenAICompatible
    ) {
      return 'Agent provider exposure policy only allows originals for local or self-hosted providers';
    }

    return null;
  }

  private async validateReadRequest<TRequest, TResult extends Record<string, unknown>>(
    auth: AuthDto,
    session: AgentSession,
    request: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
    excludedToolCallId?: string,
    options?: { validateSessionLimit: boolean },
  ): Promise<string | null> {
    const plan = session.permissionPlanSnapshot;
    const policyDenial = this.getPolicyDenial(session, descriptor.dataClass);
    if (policyDenial) {
      return policyDenial;
    }

    const requestedAssetCount = descriptor.requestedAssetCount(request);
    const perToolLimit = descriptor.perToolLimit(plan);
    if (requestedAssetCount > perToolLimit) {
      return (
        descriptor.perToolLimitDenialReason?.(request, perToolLimit) ?? 'Requested asset count exceeds per-tool limit'
      );
    }

    if (options?.validateSessionLimit ?? true) {
      const sessionLimitDenial = await this.getSessionLimitDenialReason(
        session,
        request,
        descriptor,
        excludedToolCallId,
      );
      if (sessionLimitDenial) {
        return sessionLimitDenial;
      }
    }

    return descriptor.validateAccess(auth, session, request, excludedToolCallId);
  }

  private requiresApproval(session: AgentSession, dataClass: AgentToolDataClass): boolean {
    switch (session.approvalMode) {
      case AgentApprovalMode.Strict: {
        return true;
      }
      case AgentApprovalMode.AskOnEscalation: {
        return dataClass !== AgentToolDataClass.Metadata;
      }
      case AgentApprovalMode.PlanOnly: {
        return false;
      }
      case AgentApprovalMode.DangerouslySkipPermissions: {
        return false;
      }
      default: {
        return true;
      }
    }
  }

  private async createPendingAudit<TRequest, TResult extends Record<string, unknown>>(
    session: AgentSession,
    request: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
  ): Promise<
    | { status: 'created'; toolCall: AgentToolCall }
    | { status: 'limit-exceeded'; toolCall: AgentToolCall; reason: string }
  > {
    const pendingDto: ToolCallCreate = {
      ...this.baseToolCall(session, request, descriptor),
      status: AgentToolCallStatus.PendingApproval,
      approvalDecision: null,
      responseSummary: null,
      redactedResponseMetadata: this.withResultSizeMetadata(null, this.emptyResultSize()),
      completedAt: null,
      error: null,
    };
    const reason = this.getSessionLimitReason(descriptor.perSessionLimit(session.permissionPlanSnapshot));
    const deniedDto: ToolCallCreate = {
      ...this.baseToolCall(session, request, descriptor),
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      responseSummary: null,
      redactedResponseMetadata: this.withResultSizeMetadata(null, this.emptyResultSize()),
      completedAt: new Date(),
      error: reason,
    };

    if (this.shouldUseAtomicSessionLimit(session, request, descriptor)) {
      const result = await this.toolCallRepository.createWithSessionLimit(
        pendingDto,
        deniedDto,
        descriptor.dataClass,
        descriptor.perSessionLimit(session.permissionPlanSnapshot),
      );
      return result.status === 'limit-exceeded'
        ? { status: 'limit-exceeded', toolCall: result.toolCall, reason }
        : { status: 'created', toolCall: result.toolCall };
    }

    const limitReason = await this.getSessionLimitDenialReason(session, request, descriptor);
    if (limitReason) {
      const toolCall = await this.toolCallRepository.create({ ...deniedDto, error: limitReason });
      return { status: 'limit-exceeded', toolCall, reason: limitReason };
    }

    return { status: 'created', toolCall: await this.toolCallRepository.create(pendingDto) };
  }

  private async getSessionLimitDenialReason<TRequest, TResult extends Record<string, unknown>>(
    session: AgentSession,
    request: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
    excludedToolCallId?: string,
  ): Promise<string | null> {
    const maxCount = descriptor.perSessionLimit(session.permissionPlanSnapshot);
    const requestedCount = descriptor.requestedAssetCount(request);
    return this.getSessionLimitDenialReasonForCount(
      session,
      descriptor.dataClass,
      maxCount,
      requestedCount,
      excludedToolCallId,
    );
  }

  private async getSessionLimitDenialReasonForCount(
    session: AgentSession,
    dataClass: AgentToolDataClass,
    maxCount: number,
    requestedCount: number,
    excludedToolCallId?: string,
  ): Promise<string | null> {
    if (requestedCount === 0 || maxCount === Number.MAX_SAFE_INTEGER) {
      return null;
    }

    const countedAssetCount = await this.getCountedAssetCount(session, dataClass, excludedToolCallId);
    return countedAssetCount + requestedCount > maxCount ? this.getSessionLimitReason(maxCount) : null;
  }

  private getCountedAssetCount(
    session: AgentSession,
    dataClass: AgentToolDataClass,
    excludedToolCallId?: string,
  ): Promise<number> {
    return dataClass === AgentToolDataClass.Metadata
      ? this.toolCallRepository.getCountedAssetCountBySession(session.id, excludedToolCallId)
      : this.toolCallRepository.getCountedAssetCountBySessionAndDataClass(session.id, dataClass, excludedToolCallId);
  }

  private async validateAssetAccess(
    auth: AuthDto,
    session: AgentSession,
    assetIds: string[],
    toolName: AgentToolName,
  ): Promise<string | null> {
    const readableIds = await this.getReadableAssetIds(auth, session.permissionPlanSnapshot, assetIds);
    const requestedIds = new Set(assetIds);
    if (readableIds.size === requestedIds.size) {
      return null;
    }

    const wrongDomain = await this.getReadableWrongIdDomain(auth, session, [...requestedIds], ['person']);
    if (wrongDomain === 'person') {
      throw wrongIdDomainError({
        toolName,
        field: 'assetIds',
        expectedDomain: 'asset',
        receivedDomain: 'person',
        instruction:
          'Use exact asset IDs from a small inspected asset set. For search-backed writes, use assetSource.search or previousSearch.sourceRef instead of assetIds.',
      });
    }

    return 'One or more assets are not accessible';
  }

  private async validateAlbumAccess(auth: AuthDto, session: AgentSession, albumId: string): Promise<string | null> {
    const albumIds = albumId ? new Set([albumId]) : new Set<string>();
    const readableIds = await this.getReadableAlbumIds(auth, session.permissionPlanSnapshot, albumIds);
    return readableIds.size === 1 ? null : 'Album is not accessible';
  }

  private async validateSharedSpaceAccess(
    auth: AuthDto,
    session: AgentSession,
    spaceId: string,
  ): Promise<string | null> {
    if (!session.permissionPlanSnapshot.assetScope.sharedSpaces) {
      return 'Shared spaces are not accessible for this session';
    }

    if (!spaceId) {
      return 'Space is not accessible';
    }

    const member = await this.sharedSpaceRepository.getMember(spaceId, auth.user.id);
    return member ? null : 'Space is not accessible';
  }

  private async getSmartSearchConfig(): Promise<{ modelName: string; maxDistance: number }> {
    const { machineLearning } = await getConfig(
      {
        configRepo: this.configRepository,
        metadataRepo: this.systemMetadataRepository,
        logger: this.logger,
      },
      { withCache: true },
    );

    if (!isSmartSearchEnabled(machineLearning)) {
      throw new AgentToolDeniedError('Smart search is not enabled');
    }

    return {
      modelName: machineLearning.clip.modelName,
      maxDistance: machineLearning.clip.maxDistance,
    };
  }

  private getUnsupportedSearchModeReason(mode: AgentSearchAssetsMode): string | null {
    return ['metadata', 'smart', 'description', 'ocr', 'filename'].includes(mode)
      ? null
      : `${mode} search is not available yet`;
  }

  private getUnsupportedSearchPagingReason(
    _page: number,
    order: AgentSearchAssetsOrder,
    mode: AgentSearchAssetsMode,
  ): string | null {
    if (mode === 'smart') {
      return order === 'asc' ? 'asc order search is not available yet' : null;
    }

    if (order !== 'desc') {
      return `${order} order search is not available yet`;
    }

    return null;
  }

  private getUnsupportedSearchFilterReason(_filters: AgentSearchAssetsFilters): string | null {
    return null;
  }

  private async validateSearchRequest(
    auth: AuthDto,
    session: AgentSession,
    request: AgentSearchAssetsToolRequestDto,
    excludedToolCallId?: string,
  ): Promise<string | null> {
    const mode = request.mode ?? 'metadata';
    const page = request.page ?? 1;
    const order = request.order ?? 'desc';

    if (mode === 'metadata' && request.query !== undefined) {
      return 'query is only supported for smart, description, ocr, and filename search modes';
    }

    const modeReason = this.getUnsupportedSearchModeReason(mode);
    if (modeReason) {
      return modeReason;
    }

    const pagingReason = this.getUnsupportedSearchPagingReason(page, order, mode);
    if (pagingReason) {
      return pagingReason;
    }

    if (mode === 'smart') {
      try {
        await this.getSmartSearchConfig();
      } catch (error) {
        if (error instanceof AgentToolDeniedError) {
          return error.message;
        }
        throw error;
      }
    }

    const filterReason = this.getUnsupportedSearchFilterReason(request.filters ?? {});
    if (filterReason) {
      return filterReason;
    }

    const filters = request.filters ?? {};
    const droppedResolvedFiltersReason = await this.getDroppedResolvedSearchFilterReason(
      session.id,
      filters,
      excludedToolCallId,
    );
    if (droppedResolvedFiltersReason) {
      return droppedResolvedFiltersReason;
    }

    const spacePersonIds = filters.spacePersonIds ? new Set(filters.spacePersonIds) : new Set<string>();
    const hasSpacePersonIds = spacePersonIds.size > 0;
    if (hasSpacePersonIds && !filters.spaceId) {
      return 'spacePersonIds requires spaceId';
    }

    if (filters.spaceId && filters.withSharedSpaces === true) {
      return 'Cannot use both spaceId and withSharedSpaces';
    }

    const usesSharedFilters = filters.withSharedSpaces === true || Boolean(filters.spaceId) || hasSpacePersonIds;
    if (usesSharedFilters && !session.permissionPlanSnapshot.assetScope.sharedSpaces) {
      return 'Shared spaces are not accessible for this session';
    }

    const allowLockedAssets =
      session.permissionPlanSnapshot.assetScope.locked && auth.session?.hasElevatedPermission === true;
    if (filters.visibility === AssetVisibility.Locked && !allowLockedAssets) {
      return 'Locked photos require elevated permission';
    }

    if (filters.spaceId) {
      const member = await this.sharedSpaceRepository.getMember(filters.spaceId, auth.user.id);
      if (!member) {
        return 'One or more search filters are not accessible';
      }
    }

    const albumIds = filters.albumIds ? new Set(filters.albumIds) : new Set<string>();
    if (albumIds.size > 0) {
      const readableAlbumIds = await this.getReadableAlbumIds(auth, session.permissionPlanSnapshot, albumIds);
      if (readableAlbumIds.size !== albumIds.size) {
        return 'One or more search filters are not accessible';
      }
    }

    const tagIds = filters.tagIds ? new Set(filters.tagIds) : new Set<string>();
    if (tagIds.size > 0) {
      const readableTagIds = await this.accessRepository.tag.checkOwnerAccess(auth.user.id, tagIds);
      if (readableTagIds.size !== tagIds.size) {
        return 'One or more search filters are not accessible';
      }
    }

    const personIds = filters.personIds ? new Set(filters.personIds) : new Set<string>();
    if (personIds.size > 0) {
      const readablePersonIds = await this.getReadablePersonIds(auth, session.permissionPlanSnapshot, personIds);
      if (readablePersonIds.size !== personIds.size) {
        const wrongDomain = await this.getReadableWrongIdDomain(auth, session, [...personIds], ['asset']);
        if (wrongDomain === 'asset') {
          throw wrongIdDomainError({
            toolName: AgentToolName.SearchAssets,
            field: 'filters.personIds',
            expectedDomain: 'person',
            receivedDomain: 'asset',
            instruction: 'Use person IDs returned by resolveAssetSearchFilters, not asset IDs from searchAssets.',
          });
        }
        return 'One or more search filters are not accessible';
      }
    }

    return null;
  }

  private async getDroppedResolvedSearchFilterReason(
    sessionId: string,
    filters: AgentSearchAssetsFilters,
    excludedToolCallId?: string,
  ): Promise<string | null> {
    const resolvedFilters = await this.getLatestResolvedSearchFiltersSinceSuccessfulSearch(
      sessionId,
      excludedToolCallId,
    );
    if (!resolvedFilters) {
      return null;
    }

    const missingParts = [
      this.getMissingResolvedIdsReason('people', 'personIds', resolvedFilters.personIds, filters.personIds),
      this.getMissingResolvedIdsReason('tags', 'tagIds', resolvedFilters.tagIds, filters.tagIds),
      this.getMissingResolvedIdsReason('albums', 'albumIds', resolvedFilters.albumIds, filters.albumIds),
      this.getMissingResolvedIdsReason(
        'shared-space people',
        'spacePersonIds',
        resolvedFilters.spacePersonIds,
        filters.spacePersonIds,
      ),
    ].filter((part): part is string => part !== null);

    if (resolvedFilters.spaceIds?.[0] && filters.spaceId !== resolvedFilters.spaceIds[0]) {
      missingParts.push(`space filter (spaceId=${resolvedFilters.spaceIds[0]})`);
    }

    if (missingParts.length === 0) {
      return null;
    }

    return `The previous resolveAssetSearchFilters call returned resolved ${missingParts.join(
      ', ',
    )} that were omitted from searchAssets.filters. Retry searchAssets with the resolvedFilters copied into filters, or ask a clarifying question instead of running a broad search.`;
  }

  private async getLatestResolvedSearchFiltersSinceSuccessfulSearch(
    sessionId: string,
    excludedToolCallId?: string,
  ): Promise<AgentToolResponseIdsMetadata | null> {
    const toolCalls = await this.toolCallRepository.getBySessionId(sessionId);

    for (const toolCall of toolCalls ?? []) {
      if (excludedToolCallId && toolCall.id === excludedToolCallId) {
        continue;
      }

      if (toolCall.toolName === AgentToolName.SearchAssets && toolCall.status === AgentToolCallStatus.Completed) {
        return null;
      }

      if (
        toolCall.toolName === AgentToolName.ResolveAssetSearchFilters &&
        toolCall.status === AgentToolCallStatus.Completed &&
        toolCall.redactedResponseMetadata
      ) {
        return toolCall.redactedResponseMetadata as AgentToolResponseIdsMetadata;
      }
    }

    return null;
  }

  private getMissingResolvedIdsReason(
    label: string,
    key: keyof Pick<AgentSearchAssetsFilters, 'albumIds' | 'personIds' | 'spacePersonIds' | 'tagIds'>,
    resolvedIds: string[] | undefined,
    searchIds: string[] | undefined,
  ) {
    if (!resolvedIds?.length) {
      return null;
    }

    const searchIdSet = new Set(searchIds);
    const missingIds = resolvedIds.filter((id) => !searchIdSet.has(id));

    return missingIds.length > 0 ? `${label} filters (${key}=[${missingIds.join(',')}])` : null;
  }

  private async assertReturnedAssetsAreAccessible(
    auth: AuthDto,
    session: AgentSession,
    assetIds: string[],
  ): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    const reason = await this.validateAssetAccess(auth, session, assetIds, AgentToolName.SearchAssets);
    if (reason) {
      throw new AgentToolDeniedError(reason);
    }
  }

  private async getReadableWrongIdDomain(
    auth: AuthDto,
    session: AgentSession,
    ids: string[],
    candidateDomains: AgentIdDomain[],
  ): Promise<AgentIdDomain | null> {
    if (ids.length === 0) {
      return null;
    }

    const requestedIds = new Set(ids);
    for (const domain of candidateDomains) {
      const readableIds = await this.getReadableIdsForDomain(auth, session, domain, ids);
      if (readableIds.size === requestedIds.size) {
        return domain;
      }
    }

    return null;
  }

  private getReadableIdsForDomain(
    auth: AuthDto,
    session: AgentSession,
    domain: AgentIdDomain,
    ids: string[],
  ): Promise<Set<string>> {
    switch (domain) {
      case 'asset': {
        return this.getReadableAssetIds(auth, session.permissionPlanSnapshot, ids);
      }
      case 'person': {
        return this.getReadablePersonIds(auth, session.permissionPlanSnapshot, new Set(ids));
      }
      default: {
        return Promise.resolve(new Set());
      }
    }
  }

  private async getReadableAlbumIds(
    auth: AuthDto,
    plan: AgentPermissionPlanSnapshot,
    albumIds: Set<string>,
  ): Promise<Set<string>> {
    const readableIds = new Set<string>();
    if (plan.assetScope.owned) {
      const ownerIds = await this.accessRepository.album.checkOwnerAccess(auth.user.id, albumIds);
      for (const id of ownerIds) {
        readableIds.add(id);
      }
    }

    if (plan.assetScope.sharedSpaces) {
      const sharedIds = await this.accessRepository.album.checkSharedAlbumAccess(
        auth.user.id,
        albumIds,
        AlbumUserRole.Viewer,
      );
      for (const id of sharedIds) {
        readableIds.add(id);
      }
    }

    return readableIds;
  }

  private async getReadablePersonIds(
    auth: AuthDto,
    plan: AgentPermissionPlanSnapshot,
    personIds: Set<string>,
  ): Promise<Set<string>> {
    const readableIds = new Set<string>();

    if (plan.assetScope.owned) {
      const ownerIds = await this.accessRepository.person.checkOwnerAccess(auth.user.id, personIds);
      for (const id of ownerIds) {
        readableIds.add(id);
      }
    }

    if (plan.assetScope.sharedSpaces) {
      const sharedIds = await this.accessRepository.person.checkSharedSpaceAccess(auth.user.id, personIds);
      for (const id of sharedIds) {
        readableIds.add(id);
      }
    }

    return readableIds;
  }

  private async getReadableAssetIds(
    auth: AuthDto,
    plan: AgentPermissionPlanSnapshot,
    assetIds: string[],
  ): Promise<Set<string>> {
    const requestedIds = new Set(assetIds);
    const readableIds = new Set<string>();
    const allowLockedAssets = plan.assetScope.locked && auth.session?.hasElevatedPermission === true;

    if (plan.assetScope.owned) {
      const ownerIds = await this.accessRepository.asset.checkOwnerAccess(
        auth.user.id,
        requestedIds,
        allowLockedAssets,
      );
      for (const id of ownerIds) {
        readableIds.add(id);
      }
    }

    if (plan.assetScope.sharedSpaces) {
      const spaceIds = await this.accessRepository.asset.checkSpaceAccess(auth.user.id, requestedIds);
      for (const id of spaceIds) {
        readableIds.add(id);
      }

      if (!allowLockedAssets) {
        const lockedIds = await this.assetRepository.getAgentLockedIds(readableIds);
        for (const id of lockedIds) {
          readableIds.delete(id);
        }
      }
    }

    const agentReadableIds = await this.assetRepository.getAgentReadableIds(readableIds);
    for (const id of readableIds) {
      if (!agentReadableIds.has(id)) {
        readableIds.delete(id);
      }
    }

    return readableIds;
  }

  private getRepositoryScope(auth: AuthDto, plan: AgentPermissionPlanSnapshot) {
    return {
      owned: plan.assetScope.owned,
      sharedSpaces: plan.assetScope.sharedSpaces,
      locked: plan.assetScope.locked && auth.session?.hasElevatedPermission === true,
    };
  }

  private async getSearchTimelineSpaceIds(
    auth: AuthDto,
    session: AgentSession,
    filters: AgentSearchAssetsFilters,
  ): Promise<string[]> {
    const plan = session.permissionPlanSnapshot;
    const hasAlbumFilter = (filters.albumIds?.length ?? 0) > 0;
    const shouldLoadTimelineSpaceIds =
      !filters.spaceId &&
      plan.assetScope.sharedSpaces &&
      (filters.withSharedSpaces === true || !plan.assetScope.owned || hasAlbumFilter);

    if (!shouldLoadTimelineSpaceIds) {
      return [];
    }

    const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
    return spaceRows.map((row) => row.spaceId);
  }

  private async getOrderedAgentMetadata(assetIds: string[]): Promise<AgentAssetMetadata[]> {
    if (assetIds.length === 0) {
      return [];
    }

    const unorderedAssets = await this.assetRepository.getAgentMetadataByIds(assetIds);
    const assetsById = new Map(
      unorderedAssets.map((asset) => [asset.id, this.mapAssetMetadata(asset as AgentAssetMetadata)]),
    );
    const assets = assetIds.flatMap((id) => {
      const asset = assetsById.get(id);
      return asset ? [asset] : [];
    });

    if (assets.length !== assetIds.length) {
      throw this.getAgentMetadataHydrationError(
        assets.map((asset) => asset.id),
        'One or more search result assets were not found during metadata hydration',
      );
    }

    return assets;
  }

  private getAgentMetadataHydrationError(hydratedAssetIds: string[], message: string): AgentToolFailedError {
    const error = new AgentToolFailedError(message);
    (error as AgentToolFailedError & { metadata: AgentToolResponseMetadata }).metadata = {
      assetIds: hydratedAssetIds,
    };
    return error;
  }

  private async createDeniedAudit<TRequest, TResult extends Record<string, unknown>>(
    session: AgentSession,
    request: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
    reason: string,
  ): Promise<AgentToolCall> {
    return this.toolCallRepository.create({
      ...this.baseToolCall(session, request, descriptor),
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      responseSummary: null,
      redactedResponseMetadata: this.withResultSizeMetadata(null, this.emptyResultSize()),
      completedAt: new Date(),
      error: reason,
    });
  }

  private baseToolCall<TRequest, TResult extends Record<string, unknown>>(
    session: AgentSession,
    request: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
  ): Omit<
    ToolCallCreate,
    'status' | 'approvalDecision' | 'responseSummary' | 'redactedResponseMetadata' | 'completedAt' | 'error'
  > {
    return {
      sessionId: session.id,
      toolName: descriptor.toolName,
      requestSummary: descriptor.requestSummary(request),
      redactedRequestMetadata: descriptor.requestMetadata(request),
      dataClass: descriptor.dataClass,
      assetCount: descriptor.requestedAssetCount(request),
      albumCount: descriptor.requestedAlbumCount(request),
      providerSnapshot: {
        providerCredentialId: session.credentialSnapshot.id,
        providerType: session.credentialSnapshot.providerType,
        label: session.credentialSnapshot.label,
        baseUrl: session.credentialSnapshot.baseUrl,
        model: session.modelSnapshot.model,
      },
    };
  }

  private async transitionExecuting(
    auth: AuthDto,
    session: AgentSession,
    toolCallId: string,
    update: Parameters<AgentToolCallRepository['transition']>[3],
  ): Promise<AgentToolCall> {
    const transitioned = await this.toolCallRepository.transition(
      session.id,
      toolCallId,
      AgentToolCallStatus.Executing,
      update,
    );

    await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });

    if (!transitioned) {
      throw new BadRequestException('Agent tool call is already executing or completed');
    }

    return transitioned;
  }

  private async tryRecordUnexpectedReadFailure(
    auth: AuthDto,
    session: AgentSession,
    toolCallId: string,
    failedReason: string,
  ): Promise<void> {
    try {
      await this.toolCallRepository.transition(session.id, toolCallId, AgentToolCallStatus.Executing, {
        status: AgentToolCallStatus.Failed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: null,
        redactedResponseMetadata: null,
        completedAt: new Date(),
        error: failedReason,
      });
    } catch {
      // Preserve the original unexpected error.
    }

    try {
      await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });
    } catch {
      // Preserve the original unexpected error.
    }
  }

  private getStoredRequest<TRequest, TResult extends Record<string, unknown>>(
    toolCall: AgentToolCall,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
  ): TRequest {
    if (toolCall.toolName !== descriptor.toolName) {
      throw new BadRequestException(`Agent tool call is not a ${descriptor.toolName} request`);
    }

    if (
      [AgentToolName.ReadAssetMetadata, AgentToolName.ReadAssetPreviews, AgentToolName.ReadAssetOriginals].includes(
        descriptor.toolName,
      ) &&
      !isReadAssetIdsRequestMetadata(toolCall.redactedRequestMetadata)
    ) {
      throw new BadRequestException(`Agent tool call is not a ${descriptor.toolName} request`);
    }

    return toolCall.redactedRequestMetadata as TRequest;
  }

  private getReturnedMetadataSummary(assetCount: number): string {
    return `Returned metadata for ${assetCount} ${assetCount === 1 ? 'asset' : 'assets'}`;
  }

  private getReadAssetMetadataResponseSummary(
    selection: AgentAssetMetadataDetail | 'custom',
    assetCount: number,
    truncated = false,
  ): string {
    const summary = `Returned ${selection} metadata for ${assetCount} ${assetCount === 1 ? 'asset' : 'assets'}`;
    return truncated ? this.appendTruncatedResponseSummary(summary) : summary;
  }

  private appendTruncatedResponseSummary(summary: string): string {
    return `${summary}; response was truncated by budget`;
  }

  private getReadToolResponseBudgetBytes(): number {
    return 64_000;
  }

  private emptyResultSize(): AgentToolResultSize {
    return {
      returnedItems: 0,
      hasMore: false,
      nextPage: null,
      estimatedBytes: null,
      truncated: false,
      omittedFields: [],
    };
  }

  private estimateJsonBytes(value: unknown): number | null {
    try {
      return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
      return null;
    }
  }

  private withResultSize<TRequest, TResult extends Record<string, unknown>>(
    result: TResult,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
    toolCallEstimate: (result: TResult, resultSize: AgentToolResultSize) => AgentToolCallResponseDto,
  ): TResult & { resultSize: AgentToolResultSize } {
    const budgetBytes = this.getReadToolResponseBudgetBytes();
    let nextResult = result;
    let omittedFields: string[] = [];
    const initialBytes = this.estimateJsonBytes(nextResult);

    if (descriptor.truncateForBudget && initialBytes !== null && initialBytes > budgetBytes) {
      const truncated = descriptor.truncateForBudget(nextResult, budgetBytes);
      nextResult = truncated.result;
      omittedFields = truncated.omittedFields;
    }

    let resultSize = this.estimateReadToolSuccessResultSize(descriptor, nextResult, omittedFields, toolCallEstimate);
    let finalBytes = resultSize.estimatedBytes;

    while (descriptor.truncateForBudget && finalBytes !== null && finalBytes > budgetBytes) {
      const before = this.estimateJsonBytes(nextResult);
      const truncated = descriptor.truncateForBudget(nextResult, budgetBytes);
      const after = this.estimateJsonBytes(truncated.result);

      nextResult = truncated.result;
      omittedFields = [...new Set([...omittedFields, ...truncated.omittedFields])];
      resultSize = this.estimateReadToolSuccessResultSize(descriptor, nextResult, omittedFields, toolCallEstimate);
      finalBytes = resultSize.estimatedBytes;

      if (before === after) {
        break;
      }
    }

    return {
      ...nextResult,
      resultSize,
    };
  }

  private estimateReadToolSuccessResultSize<TRequest, TResult extends Record<string, unknown>>(
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
    result: TResult,
    omittedFields: string[],
    toolCallEstimate: (result: TResult, resultSize: AgentToolResultSize) => AgentToolCallResponseDto,
  ): AgentToolResultSize {
    let resultSize = this.buildResultSize(descriptor, result, omittedFields, null);

    // The payload contains resultSize twice: top-level and inside toolCall. Re-measure until the numeric
    // estimatedBytes value is part of the measured shape.
    for (let i = 0; i < 8; i++) {
      const estimatedBytes = this.estimateJsonBytes(
        this.buildReadToolSuccessEstimatePayload(result, resultSize, toolCallEstimate),
      );
      if (estimatedBytes === null || estimatedBytes === resultSize.estimatedBytes) {
        return resultSize;
      }

      resultSize = this.buildResultSize(descriptor, result, omittedFields, estimatedBytes);
    }

    return resultSize;
  }

  private buildResultSize<TRequest, TResult extends Record<string, unknown>>(
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
    result: TResult,
    omittedFields: string[],
    estimatedBytes: number | null,
  ): AgentToolResultSize {
    const base = descriptor.resultSize(result);
    const truncated = omittedFields.length > 0;

    return {
      returnedItems: base.returnedItems,
      hasMore: base.hasMore || truncated,
      nextPage: base.nextPage,
      estimatedBytes,
      truncated,
      omittedFields,
    };
  }

  private buildReadToolSuccessEstimatePayload<TResult extends Record<string, unknown>>(
    result: TResult,
    resultSize: AgentToolResultSize,
    toolCallEstimate: (result: TResult, resultSize: AgentToolResultSize) => AgentToolCallResponseDto,
  ) {
    return {
      status: 'success' as const,
      toolCall: toolCallEstimate(result, resultSize),
      ...result,
      resultSize,
    };
  }

  private buildReadToolCallEstimate<TRequest, TResult extends Record<string, unknown>>(
    sessionId: string,
    toolCallId: string,
    request: TRequest,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
    result: TResult,
    resultSize: AgentToolResultSize,
  ): AgentToolCallResponseDto {
    return {
      id: toolCallId,
      sessionId,
      toolName: descriptor.toolName,
      status: AgentToolCallStatus.Completed,
      approvalDecision: AgentToolApprovalDecision.Approved,
      requestSummary: descriptor.requestSummary(request),
      responseSummary: descriptor.responseSummary(result),
      dataClass: descriptor.dataClass,
      assetCount: descriptor.resultAssetCount(result),
      albumCount: descriptor.resultAlbumCount(result),
      startedAt: new Date(0),
      completedAt: new Date(0),
      error: null,
      resultSize,
    };
  }

  private withResultSizeMetadata(
    metadata: AgentToolResponseMetadata | null,
    resultSize: AgentToolResultSize,
  ): AgentToolResponseMetadata {
    return metadata ? { ...metadata, resultSize } : { resultSize };
  }

  private truncateSearchAssetsResult<
    TResult extends {
      summary: string;
      detail: AgentSearchAssetsDetail;
      selectionHandle: AgentSearchAssetsSelectionHandleResult;
      sample?: AgentSearchAssetsSample;
      returnedCount: number;
      hasMore: boolean;
      nextPage: string | null;
    },
  >(result: TResult, budgetBytes: number): { result: TResult; omittedFields: string[] } {
    const omittedFields = new Set<string>();
    let nextResult = {
      ...result,
      sample: result.sample ? { ...result.sample, items: [...result.sample.items] } : undefined,
    };

    while (
      nextResult.sample &&
      nextResult.sample.items.length > 0 &&
      (this.estimateJsonBytes(nextResult) ?? 0) > budgetBytes
    ) {
      nextResult = {
        ...nextResult,
        sample: {
          sampleSize: nextResult.sample.items.length - 1,
          items: nextResult.sample.items.slice(0, -1),
        },
      };
      omittedFields.add('sample');
    }

    if (nextResult.sample?.items.length === 0) {
      const { sample: _sample, ...withoutSample } = nextResult;
      nextResult = withoutSample as typeof nextResult;
    }

    if (omittedFields.size === 0 && nextResult.sample && (this.estimateJsonBytes(nextResult) ?? 0) > budgetBytes) {
      const { sample: _sample, ...withoutSample } = nextResult;
      nextResult = withoutSample as typeof nextResult;
      omittedFields.add('sample');
    }

    const summary = this.getSearchAssetsResponseSummary({
      ...nextResult,
      sampleCount: nextResult.sample?.items.length,
    });

    return {
      result: {
        ...nextResult,
        summary: omittedFields.size > 0 ? this.appendTruncatedResponseSummary(summary) : summary,
      },
      omittedFields: [...omittedFields],
    };
  }

  private truncateSelectionMetadataResult<
    TResult extends {
      summary: string;
      selectionHandle: AgentSearchAssetsSelectionHandleResult;
      counts: AgentReadSelectionMetadataCounts;
      sample?: AgentSearchAssetsSample;
    },
  >(result: TResult, budgetBytes: number): { result: TResult; omittedFields: string[] } {
    const omittedFields = new Set<string>();
    let nextResult = {
      ...result,
      sample: result.sample ? { ...result.sample, items: [...result.sample.items] } : undefined,
    };

    while (
      nextResult.sample &&
      nextResult.sample.items.length > 0 &&
      (this.estimateJsonBytes(nextResult) ?? 0) > budgetBytes
    ) {
      const sampled = nextResult.sample.items.length - 1;
      nextResult = {
        ...nextResult,
        sample: {
          sampleSize: sampled,
          items: nextResult.sample.items.slice(0, -1),
        },
        counts: { ...nextResult.counts, sampled },
      };
      omittedFields.add('sample');
    }

    if (nextResult.sample?.items.length === 0) {
      const { sample: _sample, ...withoutSample } = nextResult;
      nextResult = { ...withoutSample, counts: { ...withoutSample.counts, sampled: 0 } } as typeof nextResult;
    }

    return {
      result: {
        ...nextResult,
        summary: this.getReadSelectionMetadataResponseSummary(
          nextResult.selectionHandle.assetCount,
          nextResult.counts.sampled,
          omittedFields.size > 0,
        ),
      },
      omittedFields: [...omittedFields],
    };
  }

  private truncateCurateSelectionResult<
    TResult extends {
      summary: string;
      sample?: AgentSearchAssetsSample;
    },
  >(result: TResult, budgetBytes: number): { result: TResult; omittedFields: string[] } {
    const omittedFields = new Set<string>();
    let nextResult = {
      ...result,
      sample: result.sample ? { ...result.sample, items: [...result.sample.items] } : undefined,
    };

    while (
      nextResult.sample &&
      nextResult.sample.items.length > 0 &&
      (this.estimateJsonBytes(nextResult) ?? 0) > budgetBytes
    ) {
      nextResult = {
        ...nextResult,
        sample: {
          sampleSize: nextResult.sample.items.length - 1,
          items: nextResult.sample.items.slice(0, -1),
        },
      };
      omittedFields.add('sample');
    }

    if (nextResult.sample?.items.length === 0) {
      const { sample: _sample, ...withoutSample } = nextResult;
      nextResult = withoutSample as typeof nextResult;
      omittedFields.add('sample');
    }

    return {
      result: {
        ...nextResult,
        summary: omittedFields.size > 0 ? this.appendTruncatedResponseSummary(nextResult.summary) : nextResult.summary,
      },
      omittedFields: [...omittedFields],
    };
  }

  private truncateAssetMetadataResult<
    TResult extends {
      summary: string;
      detail?: AgentAssetMetadataDetail;
      assets: AgentAssetMetadataResult[];
    },
  >(result: TResult, budgetBytes: number): { result: TResult; omittedFields: string[] } {
    let nextResult = { ...result, assets: result.assets };

    while ((this.estimateJsonBytes(nextResult) ?? 0) > budgetBytes && nextResult.assets.length > 0) {
      nextResult = { ...nextResult, assets: nextResult.assets.slice(0, -1) };
    }

    if ((this.estimateJsonBytes(nextResult) ?? 0) > budgetBytes) {
      nextResult = { ...nextResult, assets: [] };
    }

    return {
      result: {
        ...nextResult,
        summary: this.getReadAssetMetadataResponseSummary(
          nextResult.detail ?? 'custom',
          nextResult.assets.length,
          true,
        ),
      },
      omittedFields: ['assets'],
    };
  }

  private getSessionLimitReason(maxAssetsPerSession: number): string {
    return `Session policy allows at most ${maxAssetsPerSession} assets per session`;
  }

  private getMediaReferences<TResult extends Record<string, unknown>>(
    result: TResult,
    key: 'previews' | 'originals',
  ): AgentAssetMediaReference[] {
    return result[key] as AgentAssetMediaReference[];
  }

  private async getOwnedSession(
    auth: AuthDto,
    sessionId: string,
    options: { requireActive: boolean },
  ): Promise<AgentSession> {
    const session = await this.sessionRepository.getById(auth.user.id, sessionId);

    if (!session || (options.requireActive && !AgentToolService.activeStatuses.includes(session.status))) {
      throw new BadRequestException('Agent session not found');
    }

    return {
      ...session,
      permissionPlanSnapshot: this.normalizePermissionPlanSnapshot(session.permissionPlanSnapshot),
    };
  }

  private normalizePermissionPlanSnapshot(plan: AgentPermissionPlanSnapshot): AgentPermissionPlanSnapshot {
    return {
      ...plan,
      limits: {
        ...plan.limits,
        maxPreviewsPerSession: plan.limits.maxPreviewsPerSession ?? plan.limits.maxPreviewsPerToolCall ?? 0,
        maxOriginalsPerSession: plan.limits.maxOriginalsPerSession ?? plan.limits.maxOriginalsPerToolCall ?? 0,
      },
    };
  }

  private async getToolCallForSession(sessionId: string, toolCallId: string): Promise<AgentToolCall> {
    const toolCall = await this.toolCallRepository.getByIdForSession(sessionId, toolCallId);
    if (!toolCall) {
      throw new BadRequestException('Agent tool call not found');
    }

    return toolCall;
  }

  private mapToolCall(toolCall: AgentToolCall): AgentToolCallResponseDto {
    const resultSize =
      toolCall.redactedResponseMetadata &&
      'resultSize' in toolCall.redactedResponseMetadata &&
      toolCall.redactedResponseMetadata.resultSize
        ? toolCall.redactedResponseMetadata.resultSize
        : undefined;

    return {
      id: toolCall.id,
      sessionId: toolCall.sessionId,
      toolName: toolCall.toolName,
      status: toolCall.status,
      approvalDecision: toolCall.approvalDecision,
      requestSummary: toolCall.requestSummary,
      responseSummary: toolCall.responseSummary,
      dataClass: toolCall.dataClass,
      assetCount: toolCall.assetCount,
      albumCount: toolCall.albumCount,
      startedAt: toolCall.startedAt,
      completedAt: toolCall.completedAt,
      error: toolCall.error,
      ...(resultSize ? { resultSize } : {}),
    };
  }

  private getReadAssetMetadataSelectionLabel(request: AgentReadAssetMetadataToolRequestDto): string {
    return request.fields ? 'custom' : (request.detail ?? 'basic');
  }

  private getReadAssetMetadataPresetFields(detail: AgentAssetMetadataDetail = 'basic'): AgentAssetMetadataField[] {
    switch (detail) {
      case 'basic': {
        return ['type', 'dates'];
      }
      case 'descriptive': {
        return ['type', 'dates', 'filename', 'favorite', 'rating', 'tags', 'location'];
      }
      case 'technical': {
        return ['type', 'dates', 'filename', 'camera', 'rating', 'visibility', 'quality'];
      }
      case 'allSafe': {
        return [
          'type',
          'dates',
          'location',
          'camera',
          'tags',
          'rating',
          'filename',
          'favorite',
          'visibility',
          'quality',
        ];
      }
    }
  }

  private mapSelectedAssetMetadata(
    asset: AgentAssetMetadata,
    fields: AgentAssetMetadataField[],
  ): AgentAssetMetadataResult {
    const result: AgentAssetMetadataResult = { id: asset.id };
    const exifInfo: NonNullable<AgentAssetMetadataResult['exifInfo']> = {};
    let requestedExifInfo = false;

    for (const field of fields) {
      switch (field) {
        case 'type': {
          result.type = asset.type;
          break;
        }
        case 'dates': {
          result.localDateTime = asset.localDateTime;
          result.fileCreatedAt = asset.fileCreatedAt;
          result.fileModifiedAt = asset.fileModifiedAt;
          requestedExifInfo = true;
          if (asset.exifInfo) {
            exifInfo.dateTimeOriginal = asset.exifInfo.dateTimeOriginal;
          }
          break;
        }
        case 'location': {
          requestedExifInfo = true;
          if (asset.exifInfo) {
            exifInfo.city = asset.exifInfo.city;
            exifInfo.state = asset.exifInfo.state;
            exifInfo.country = asset.exifInfo.country;
            exifInfo.latitude = asset.exifInfo.latitude;
            exifInfo.longitude = asset.exifInfo.longitude;
          }
          break;
        }
        case 'camera': {
          requestedExifInfo = true;
          if (asset.exifInfo) {
            exifInfo.make = asset.exifInfo.make;
            exifInfo.model = asset.exifInfo.model;
            exifInfo.lensModel = asset.exifInfo.lensModel;
          }
          break;
        }
        case 'tags': {
          result.tags = asset.tags.map((tag) => ({ id: tag.id, value: tag.value, color: tag.color }));
          break;
        }
        case 'rating': {
          requestedExifInfo = true;
          if (asset.exifInfo) {
            exifInfo.rating = asset.exifInfo.rating;
          }
          break;
        }
        case 'filename': {
          result.originalFileName = asset.originalFileName;
          break;
        }
        case 'favorite': {
          result.isFavorite = asset.isFavorite;
          break;
        }
        case 'visibility': {
          result.visibility = asset.visibility;
          break;
        }
        case 'quality': {
          result.qualityInfo = asset.qualityInfo ?? null;
          break;
        }
      }
    }

    if (requestedExifInfo) {
      result.exifInfo = asset.exifInfo ? exifInfo : null;
    }

    return result;
  }

  private mapAssetMetadata(asset: AgentAssetMetadata): AgentAssetMetadata {
    return {
      id: asset.id,
      ownerId: asset.ownerId,
      type: asset.type,
      originalFileName: asset.originalFileName,
      localDateTime: asset.localDateTime,
      fileCreatedAt: asset.fileCreatedAt,
      fileModifiedAt: asset.fileModifiedAt,
      isFavorite: asset.isFavorite,
      visibility: asset.visibility,
      exifInfo: asset.exifInfo
        ? {
            dateTimeOriginal: asset.exifInfo.dateTimeOriginal,
            city: asset.exifInfo.city,
            state: asset.exifInfo.state,
            country: asset.exifInfo.country,
            make: asset.exifInfo.make,
            model: asset.exifInfo.model,
            lensModel: asset.exifInfo.lensModel,
            latitude: asset.exifInfo.latitude,
            longitude: asset.exifInfo.longitude,
            rating: asset.exifInfo.rating,
          }
        : null,
      tags: asset.tags.map((tag) => ({ id: tag.id, value: tag.value, color: tag.color })),
      qualityInfo: asset.qualityInfo ?? null,
    };
  }

  private async mapAgentSpaceSummary(space: {
    id: string;
    name: string;
    description: string | null;
    color?: string | null;
    createdById: string;
    thumbnailAssetId?: string | null;
  }): Promise<AgentSpaceSummary> {
    const members = await this.sharedSpaceRepository.getMembers(space.id);
    const assetCount = await this.sharedSpaceRepository.getAssetCount(space.id);
    const recentAssets = await this.sharedSpaceRepository.getRecentAssets(space.id);
    return this.mapAgentSpaceSummaryFromParts(space, members.length, assetCount, recentAssets);
  }

  private mapAgentSpaceSummaryFromParts(
    space: {
      id: string;
      name: string;
      description: string | null;
      color?: string | null;
      createdById: string;
      thumbnailAssetId?: string | null;
    },
    memberCount: number,
    assetCount: number,
    recentAssets: Array<{ id: string }>,
  ): AgentSpaceSummary {
    return {
      id: space.id,
      name: space.name,
      description: space.description,
      color: space.color ?? 'primary',
      createdById: space.createdById,
      assetCount,
      memberCount,
      thumbnailAssetId: space.thumbnailAssetId ?? null,
      recentAssetIds: recentAssets.map((asset) => asset.id),
    };
  }

  private mapAgentSpaceMember(member: {
    userId: string;
    name: string;
    role: string;
    avatarColor: string | null;
    profileImagePath: string | null;
  }): AgentSpaceMemberSummary {
    return {
      userId: member.userId,
      name: member.name,
      role: member.role,
      avatarColor: member.avatarColor ?? null,
      profileImagePath: member.profileImagePath ?? null,
    };
  }
}
