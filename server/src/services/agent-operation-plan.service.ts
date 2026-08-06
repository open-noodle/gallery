import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AgentSession, AgentToolCall } from 'src/database';
import {
  AgentOperationPlanApplyRequestDto,
  AgentOperationPlanApplyResponseDto,
  AgentOperationPlanResponseDto,
  AgentOperationPlanSummaryRequestDto,
  AgentOperationPlanToolResponseDto,
  AgentProposeAddAssetsToAlbumFromSearchToolRequestDto,
  AgentProposeAddAssetsToSpaceFromSearchToolRequestDto,
  AgentProposeAlbumFromSearchToolRequestDto,
  AgentProposeAlbumFromSelectionToolRequestDto,
  AgentProposeAlbumOperationsDto,
  AgentProposeAssetBatchFromSearchToolRequestDto,
  AgentProposeAssetBatchFromSelectionToolRequestDto,
  AgentProposeSpaceFromSearchToolRequestDto,
  AgentReviseAlbumOperationsDto,
} from 'src/dtos/agent-operation.dto';
import { BulkIdResponseDto } from 'src/dtos/asset-ids.response.dto';
import type { AssetBulkUpdateDto } from 'src/dtos/asset.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AdjustParameters,
  AssetEditAction,
  AssetEditActionItem,
  CropParameters,
  MirrorAxis,
} from 'src/dtos/editing.dto';
import {
  AgentOperationApplyStatus,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
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
import { AssetRepository, type AgentAssetMetadataReviewRow } from 'src/repositories/asset.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { WebsocketRepository } from 'src/repositories/websocket.repository';
import { AgentAssetSearchFilterResolverService } from 'src/services/agent-asset-search-filter-resolver.service';
import {
  AgentMcpRecoverableToolError,
  invalidSelectionHandleError,
  invalidSourceRefError,
  isAgentMcpRecoverableToolError,
  wrongIdDomainError,
} from 'src/services/agent-mcp-recoverable-tool-error';
import { buildAgentSearch } from 'src/services/agent-search-filter-mapper';
import { AgentSessionActivityEventService } from 'src/services/agent-session-activity-event.service';
import { AlbumService } from 'src/services/album.service';
import { AssetService } from 'src/services/asset.service';
import { PersonService } from 'src/services/person.service';
import { SharedLinkService } from 'src/services/shared-link.service';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { StackService } from 'src/services/stack.service';
import { TagService } from 'src/services/tag.service';
import { TrashService } from 'src/services/trash.service';
import type {
  AgentAssetSourceInput,
  AgentDeclarativeAssetFilters,
  AgentIdDomain,
  AgentSearchSourceRef,
} from 'src/types/agent-asset-source.types';
import {
  validateAgentAssetSourceMechanismCount,
  validateNoAgentAssetSourceMechanisms,
} from 'src/types/agent-asset-source.types';
import type {
  AgentAlbumOperationInput,
  AgentOperationResult,
  AgentOperationReviewMetadata,
  AgentOperationReviewMetadataValueKind,
} from 'src/types/agent-operation.types';
import type {
  AgentSearchAssetsFilters,
  AgentSearchAssetsMode,
  AgentSearchAssetsOrder,
  AgentSelectionHandleRecoveryHint,
  AgentSelectionHandleRecoveryMetadata,
  AgentSourceRefRecoveryMetadata,
  AgentToolOperationPlanRequestMetadata,
  AgentToolOperationPlanResponseMetadata,
  AgentWrongIdDomainRecoveryMetadata,
} from 'src/types/agent-tool.types';
import { mergeEdits } from 'src/utils/asset-edit';
import z from 'zod';

const selectionHandleRecoveryLimit = 5;
const metadataReviewSampleLimit = 5;
const searchSourceRefPrefix = 'asset-source:search:';
const assetUpdateMetadataWorkflowPayloadKeys = [
  'description',
  'rating',
  'dateTimeOriginal',
  'dateTimeRelative',
  'timeZone',
  'latitude',
  'longitude',
] as const;
type AssetUpdateMetadataApplyPayload = Pick<
  AssetBulkUpdateDto,
  'description' | 'rating' | 'dateTimeOriginal' | 'dateTimeRelative' | 'timeZone' | 'latitude' | 'longitude'
>;
type AgentPlanOperation = AgentOperationPlanWithOperations['operations'][number];
const assetUpdateMetadataApplyPayloadKeys = [
  'description',
  'rating',
  'dateTimeOriginal',
  'dateTimeRelative',
  'timeZone',
  'latitude',
  'longitude',
] as const satisfies readonly (keyof AssetUpdateMetadataApplyPayload)[];
const assetUpdateMetadataDateTimeOriginal = z.iso.datetime();
const knownExampleSelectionHandleIds = new Set(['00000000-0000-4000-8000-000000000333']);
const knownAgentIdDomains = new Set<AgentIdDomain>([
  'asset',
  'person',
  'album',
  'space',
  'tag',
  'selectionHandle',
  'sourceRef',
  'unknown',
]);

type PlanningRequest = {
  summary?: string;
  operations?: AgentAlbumOperationInput[];
  planId?: string;
  focus?: string;
  selectionHandles?: PlanningSelectionAudit;
};

type PlanningSelectionAudit = Array<{
  id?: string;
  assetCount: number;
  sampleAssetIds: string[];
  sourceKind?: 'selectionHandle' | 'previousSearch' | 'search';
  sourceRef?: AgentSearchSourceRef;
  declarativeFilters?: AgentDeclarativeAssetFilters;
  resolvedFilters?: AgentSearchAssetsFilters;
}>;

type SelectionHandleRecoveryRow = {
  id: string;
  assetCount: number;
  sourceToolCallId: string | null;
  createdAt: Date;
  expiresAt: Date;
};

type SelectionHandleResolutionContext = {
  toolName: AgentToolName;
  field: string;
};

type PlanningAuditResult = {
  status: AgentToolCallStatus.Completed | AgentToolCallStatus.Denied | AgentToolCallStatus.Failed;
  approvalDecision: AgentToolApprovalDecision;
  responseSummary: string | null;
  redactedResponseMetadata: AgentToolOperationPlanResponseMetadata | null;
  error: string | null;
};

type PlanningAuditCreate = {
  status: AgentToolCallStatus.Executing;
  approvalDecision: AgentToolApprovalDecision.Approved;
  responseSummary: null;
  redactedResponseMetadata: null;
  error: null;
};

type SparseItemSelection = NonNullable<AgentOperationPlanApplyRequestDto['itemSelections']>[string];

type ApplySelection = {
  selectedOperationIds: Set<string>;
  selectedAssetIdsByOperationId: Map<string, string[]>;
  selectedItemIdsByOperationId: Map<string, string[]>;
  fieldOverridesByOperationId: Map<string, AgentOperationFieldOverride>;
};

type AgentOperationFieldOverride = {
  payload?: {
    albumName?: string;
    spaceName?: string;
    description?: string;
    color?: UserAvatarColor;
    angle?: 90 | 180 | 270;
  };
  albumThumbnailAssetId?: string;
  targetAlbumId?: string;
  targetSpaceId?: string;
};

@Injectable()
export class AgentOperationPlanService {
  private static readonly legacyWriteScopeDefaults = {
    removeAssets: false,
    createSpace: false,
    addAssetsToSpaces: false,
    removeAssetsFromSpaces: false,
    updateSpaceDetails: false,
    addMembersToSpaces: false,
    removeMembersFromSpaces: false,
    updateSpaceMemberRoles: false,
    editAssets: false,
    favoriteAssets: false,
    archiveAssets: false,
    tagAssets: false,
    updateAssetMetadata: false,
    shareAlbums: false,
    lockAssets: false,
    deleteContainers: false,
    manageStacks: false,
    managePeople: false,
  };

  private static readonly activeStatuses = [
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ];

  static readonly maxAssetSelectionHandleAssets = 10_000;
  static readonly maxCoverSelectionHandleAssets = 500;

  constructor(
    private readonly accessRepository: AccessRepository,
    private readonly assetRepository: AssetRepository,
    private readonly albumService: AlbumService,
    private readonly sessionRepository: AgentSessionRepository,
    private readonly selectionHandleRepository: AgentSelectionHandleRepository,
    private readonly searchRepository: SearchRepository,
    private readonly sharedSpaceRepository: SharedSpaceRepository,
    private readonly assetSearchFilterResolverService: AgentAssetSearchFilterResolverService,
    private readonly albumRepository: AlbumRepository,
    private readonly planRepository: AgentOperationPlanRepository,
    private readonly toolCallRepository: AgentToolCallRepository,
    private readonly websocketRepository: WebsocketRepository,
    private readonly sharedSpaceService: SharedSpaceService,
    private readonly assetService: AssetService,
    private readonly stackService: StackService,
    private readonly tagService: TagService,
    private readonly trashService: TrashService,
    private readonly sharedLinkService: SharedLinkService,
    private readonly personService: PersonService,
    @Optional()
    @Inject(AgentSessionActivityEventService)
    private readonly activityEventService?: Pick<AgentSessionActivityEventService, 'createSystemEvent'>,
  ) {}

  async getCurrentPlan(auth: AuthDto, sessionId: string): Promise<AgentOperationPlanResponseDto | null> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: false });
    const plan = await this.planRepository.getCurrentBySessionId(session.id);

    return plan ? this.mapPlanForUserReview(plan) : null;
  }

  async getAppliedPlans(auth: AuthDto, sessionId: string): Promise<AgentOperationPlanResponseDto[]> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: false });
    const plans = await this.planRepository.getAppliedBySessionId(session.id);

    return Promise.all(plans.map((plan) => this.mapPlanForUserReview(plan)));
  }

  async proposeAlbumOperations(
    auth: AuthDto,
    sessionId: string,
    dto: AgentProposeAlbumOperationsDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    return this.proposeOperations(auth, sessionId, AgentToolName.ProposeAlbumOperations, dto);
  }

  async proposeAlbumFromSearch(
    auth: AuthDto,
    sessionId: string,
    dto: AgentProposeAlbumFromSearchToolRequestDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const temporaryTargetId = 'tmp-album-from-search';
    const summary = dto.summary ?? `Create album "${dto.albumName}" from matching photos.`;

    return this.proposeOperations(auth, sessionId, AgentToolName.ProposeAlbumFromSearch, {
      summary,
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: `Create album "${dto.albumName}"`,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId,
          payload: { albumName: dto.albumName, description: dto.description ?? '' },
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: `Add matching photos to "${dto.albumName}"`,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId,
          assetSource: dto.assetSource,
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    });
  }

  async proposeAlbumFromSelection(
    auth: AuthDto,
    sessionId: string,
    dto: AgentProposeAlbumFromSelectionToolRequestDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const temporaryTargetId = 'tmp-album-from-selection';
    const summary = dto.summary ?? `Create album "${dto.albumName}" from selected photos.`;

    return this.proposeOperations(auth, sessionId, AgentToolName.ProposeAlbumFromSelection, {
      summary,
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: `Create album "${dto.albumName}"`,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId,
          payload: { albumName: dto.albumName, description: dto.description ?? '' },
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: `Add selected photos to "${dto.albumName}"`,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId,
          assetSource: { kind: 'selectionHandle', selectionHandleId: dto.selectionHandleId },
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    });
  }

  async proposeAddAssetsToAlbumFromSearch(
    auth: AuthDto,
    sessionId: string,
    dto: AgentProposeAddAssetsToAlbumFromSearchToolRequestDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const toolName = AgentToolName.ProposeAddAssetsToAlbumFromSearch;
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });
    let albumTarget: Awaited<ReturnType<typeof this.resolveWorkflowAlbumTarget>>;
    try {
      albumTarget = await this.resolveWorkflowAlbumTarget(auth, session, dto);
    } catch (error) {
      await this.tryCreatePlanningPreparationDeniedAudit(session, toolName, dto, error);
      throw error;
    }
    const summary = dto.summary ?? `Add matching photos to "${albumTarget.albumName}".`;

    return this.proposeOperationsForSession(auth, session, toolName, {
      summary,
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: `Add matching photos to "${albumTarget.albumName}"`,
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumTarget.albumId,
          assetSource: dto.assetSource,
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    });
  }

  async proposeSpaceFromSearch(
    auth: AuthDto,
    sessionId: string,
    dto: AgentProposeSpaceFromSearchToolRequestDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const temporaryTargetId = 'tmp-space-from-search';
    const summary = dto.summary ?? `Create space "${dto.spaceName}" from matching photos.`;
    const payload: { spaceName: string; description?: string; color?: UserAvatarColor } = { spaceName: dto.spaceName };
    if (dto.description !== undefined) {
      payload.description = dto.description;
    }
    if (dto.color !== undefined) {
      payload.color = dto.color;
    }

    return this.proposeOperations(auth, sessionId, AgentToolName.ProposeSpaceFromSearch, {
      summary,
      operations: [
        {
          type: AgentOperationType.SpaceCreate,
          summary: `Create space "${dto.spaceName}"`,
          targetKind: AgentOperationTargetKind.NewSpace,
          temporaryTargetId,
          payload,
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: `Add matching photos to "${dto.spaceName}"`,
          targetKind: AgentOperationTargetKind.NewSpace,
          temporaryTargetId,
          assetSource: dto.assetSource,
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    });
  }

  async proposeAddAssetsToSpaceFromSearch(
    auth: AuthDto,
    sessionId: string,
    dto: AgentProposeAddAssetsToSpaceFromSearchToolRequestDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const toolName = AgentToolName.ProposeAddAssetsToSpaceFromSearch;
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });
    let spaceTarget: Awaited<ReturnType<typeof this.resolveWorkflowSpaceTarget>>;
    try {
      this.validateWriteScope(session, AgentOperationType.SpaceAddAssets);
      this.validateSpaceNameResolutionScope(session, dto);
      spaceTarget = await this.resolveWorkflowSpaceTarget(auth, dto);
      await this.validateExistingSpaceRoleAccess(auth, spaceTarget.spaceId, SharedSpaceRole.Editor);
    } catch (error) {
      await this.tryCreatePlanningPreparationDeniedAudit(session, toolName, dto, error);
      throw error;
    }
    const summary = dto.summary ?? `Add matching photos to "${spaceTarget.spaceName}".`;

    return this.proposeOperationsForSession(auth, session, toolName, {
      summary,
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: `Add matching photos to "${spaceTarget.spaceName}"`,
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceTarget.spaceId,
          assetSource: dto.assetSource,
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    });
  }

  async proposeAssetBatchFromSearch(
    auth: AuthDto,
    sessionId: string,
    dto: AgentProposeAssetBatchFromSearchToolRequestDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const operation = {
      type: dto.action.type,
      summary: this.getAssetBatchWorkflowActionSummary(dto.action),
      targetKind: this.getAssetBatchWorkflowTargetKind(dto.action),
      assetSource: dto.assetSource,
      payload: this.getAssetBatchWorkflowPayload(dto.action),
      riskLevel: this.getAssetBatchWorkflowRiskLevel(dto.action),
      enabled: true,
    };

    return this.proposeOperations(auth, sessionId, AgentToolName.ProposeAssetBatchFromSearch, {
      summary: dto.summary ?? operation.summary,
      operations: [operation as AgentProposeAlbumOperationsDto['operations'][number]],
    });
  }

  async proposeAssetBatchFromSelection(
    auth: AuthDto,
    sessionId: string,
    dto: AgentProposeAssetBatchFromSelectionToolRequestDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const operation = {
      type: dto.action.type,
      summary: this.getAssetBatchWorkflowActionSummary(dto.action),
      targetKind: this.getAssetBatchWorkflowTargetKind(dto.action),
      assetSource: { kind: 'selectionHandle', selectionHandleId: dto.selectionHandleId },
      payload: this.getAssetBatchWorkflowPayload(dto.action),
      riskLevel: this.getAssetBatchWorkflowRiskLevel(dto.action),
      enabled: true,
    };

    return this.proposeOperations(auth, sessionId, AgentToolName.ProposeAssetBatchFromSelection, {
      summary: dto.summary ?? operation.summary,
      operations: [operation as AgentProposeAlbumOperationsDto['operations'][number]],
    });
  }

  private getAssetBatchWorkflowActionSummary(
    dto:
      | AgentProposeAssetBatchFromSearchToolRequestDto['action']
      | AgentProposeAssetBatchFromSelectionToolRequestDto['action'],
  ): string {
    switch (dto.type) {
      case AgentOperationType.AssetSetFavorite: {
        return dto.favorite ? 'Mark matching photos as favorites' : 'Remove matching photos from favorites';
      }
      case AgentOperationType.AssetSetArchive: {
        return dto.archived ? 'Archive matching photos' : 'Move matching photos back to timeline';
      }
      case AgentOperationType.AssetSetVisibility: {
        return 'Move matching photos to the Locked folder';
      }
      case AgentOperationType.AssetAddTag: {
        return dto.tagName ? `Add tag "${dto.tagName}" to matching photos` : 'Add selected tag to matching photos';
      }
      case AgentOperationType.AssetRotate: {
        return `Rotate matching photos ${dto.angle} degrees`;
      }
      case AgentOperationType.AssetCrop: {
        return `Crop matching photos to ${dto.width}×${dto.height} at (${dto.x}, ${dto.y})`;
      }
      case AgentOperationType.AssetAdjust: {
        if (dto.autoEnhance) {
          return 'Auto-enhance matching photos';
        }
        const parts: string[] = [];
        if (dto.brightness) {
          parts.push(`brightness: ${dto.brightness}`);
        }
        if (dto.contrast) {
          parts.push(`contrast: ${dto.contrast}`);
        }
        if (dto.saturation) {
          parts.push(`saturation: ${dto.saturation}`);
        }
        return `Adjust matching photos (${parts.join(', ')})`;
      }
      case AgentOperationType.AssetFlip: {
        return `Flip matching photos ${dto.axis === 'horizontal' ? 'horizontally' : 'vertically'}`;
      }
      case AgentOperationType.AssetStack: {
        return 'Stack matching photos';
      }
      case AgentOperationType.AssetUnstack: {
        return 'Unstack matching photos';
      }
      case AgentOperationType.AssetUpdateMetadata: {
        return 'Update matching photo metadata';
      }
    }
  }

  private getAssetBatchWorkflowTargetKind(
    dto: AgentProposeAssetBatchFromSearchToolRequestDto['action'],
  ): AgentOperationTargetKind {
    return dto.type === AgentOperationType.AssetRotate ||
      dto.type === AgentOperationType.AssetCrop ||
      dto.type === AgentOperationType.AssetAdjust ||
      dto.type === AgentOperationType.AssetFlip
      ? AgentOperationTargetKind.ImageEditBatch
      : AgentOperationTargetKind.AssetBatch;
  }

  private getAssetBatchWorkflowPayload(
    dto: AgentProposeAssetBatchFromSearchToolRequestDto['action'],
  ): Record<string, unknown> {
    switch (dto.type) {
      case AgentOperationType.AssetSetFavorite: {
        return { favorite: dto.favorite };
      }
      case AgentOperationType.AssetSetArchive: {
        return { archived: dto.archived };
      }
      case AgentOperationType.AssetSetVisibility: {
        return { visibility: dto.visibility };
      }
      case AgentOperationType.AssetAddTag: {
        return dto.tagId ? { tagId: dto.tagId } : { tagName: dto.tagName };
      }
      case AgentOperationType.AssetRotate: {
        return { angle: dto.angle };
      }
      case AgentOperationType.AssetCrop: {
        return { x: dto.x, y: dto.y, width: dto.width, height: dto.height };
      }
      case AgentOperationType.AssetAdjust: {
        const payload: Record<string, unknown> = {};
        if (dto.brightness !== undefined) {
          payload.brightness = dto.brightness;
        }
        if (dto.contrast !== undefined) {
          payload.contrast = dto.contrast;
        }
        if (dto.saturation !== undefined) {
          payload.saturation = dto.saturation;
        }
        if (dto.autoEnhance !== undefined) {
          payload.autoEnhance = dto.autoEnhance;
        }
        return payload;
      }
      case AgentOperationType.AssetFlip: {
        return { axis: dto.axis };
      }
      case AgentOperationType.AssetStack:
      case AgentOperationType.AssetUnstack: {
        return {};
      }
      case AgentOperationType.AssetUpdateMetadata: {
        return this.getAssetUpdateMetadataWorkflowPayload(dto);
      }
    }
  }

  private getAssetUpdateMetadataWorkflowPayload(
    dto: Extract<
      AgentProposeAssetBatchFromSearchToolRequestDto['action'],
      { type: AgentOperationType.AssetUpdateMetadata }
    >,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const key of assetUpdateMetadataWorkflowPayloadKeys) {
      if (dto[key] !== undefined) {
        payload[key] = dto[key];
      }
    }
    return payload;
  }

  private getAssetBatchWorkflowRiskLevel(
    dto: AgentProposeAssetBatchFromSearchToolRequestDto['action'],
  ): AgentOperationRiskLevel {
    switch (dto.type) {
      case AgentOperationType.AssetSetFavorite:
      case AgentOperationType.AssetCrop:
      case AgentOperationType.AssetAdjust:
      case AgentOperationType.AssetFlip:
      case AgentOperationType.AssetStack:
      case AgentOperationType.AssetUnstack: {
        return AgentOperationRiskLevel.Low;
      }
      case AgentOperationType.AssetSetArchive:
      case AgentOperationType.AssetSetVisibility: {
        return AgentOperationRiskLevel.High;
      }
      case AgentOperationType.AssetUpdateMetadata:
      case AgentOperationType.AssetAddTag:
      case AgentOperationType.AssetRotate: {
        return AgentOperationRiskLevel.Medium;
      }
    }
  }

  private validateSpaceNameResolutionScope(
    session: AgentSession,
    dto: AgentProposeAddAssetsToSpaceFromSearchToolRequestDto,
  ) {
    if (dto.spaceName && !session.permissionPlanSnapshot.assetScope.sharedSpaces) {
      throw new BadRequestException('Shared spaces are not accessible for this session');
    }
  }

  private async proposeOperations(
    auth: AuthDto,
    sessionId: string,
    toolName: AgentToolName,
    dto: AgentProposeAlbumOperationsDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });
    return this.proposeOperationsForSession(auth, session, toolName, dto);
  }

  private async proposeOperationsForSession(
    auth: AuthDto,
    session: AgentSession,
    toolName: AgentToolName,
    dto: AgentProposeAlbumOperationsDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    let prepared: { operations: AgentAlbumOperationInput[]; selectionAudit: PlanningSelectionAudit };
    try {
      prepared = await this.prepareOperations(auth, session, toolName, dto.operations);
    } catch (error) {
      await this.tryCreatePlanningPreparationDeniedAudit(session, toolName, dto, error);
      throw error;
    }

    const { operations, selectionAudit } = prepared;

    return this.runPlanningTool(
      auth,
      session,
      toolName,
      { ...dto, operations, selectionHandles: selectionAudit },
      async () => {
        await this.validateNormalAccess(auth, session, operations);
        const plan = await this.planRepository.createReplacementRevision(session.id, {
          plan: {
            sessionId: session.id,
            status: AgentOperationPlanStatus.Proposed,
            summary: dto.summary,
          },
          operations,
        });
        if (!plan) {
          throw new BadRequestException('Agent session is not accepting plan revisions');
        }

        await this.markWaitingForPlanReview(auth, session, plan);
        return { plan, summary: this.summarize(plan) };
      },
    );
  }

  private async resolveWorkflowAlbumTarget(
    auth: AuthDto,
    session: AgentSession,
    dto: AgentProposeAddAssetsToAlbumFromSearchToolRequestDto,
  ) {
    if (dto.albumId) {
      return { albumId: dto.albumId, albumName: dto.albumName ?? 'selected album' };
    }

    const requestedName = dto.albumName?.trim() ?? '';
    const albums = await this.albumRepository.getAgentAlbums(auth.user.id);
    const visibleAlbums = albums.filter((album) => {
      const isOwned = album.ownerId === auth.user.id;
      return isOwned
        ? session.permissionPlanSnapshot.assetScope.owned
        : session.permissionPlanSnapshot.assetScope.sharedSpaces;
    });
    const matches = visibleAlbums.filter(
      (album) => album.albumName.trim().toLowerCase() === requestedName.toLowerCase(),
    );

    if (matches.length === 1) {
      return { albumId: matches[0].id, albumName: matches[0].albumName };
    }

    if (matches.length === 0) {
      throw new AgentMcpRecoverableToolError({
        status: 'error',
        error: `No visible album named "${requestedName}" was found.`,
        toolName: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
        retryable: true,
        hint: 'Call listAlbums to choose an existing albumId, or use proposeAlbumFromSearch to create a new album.',
        recovery: {
          kind: 'album_target_needs_clarification',
          albumName: requestedName,
          choices: [],
          instruction: 'Retry with albumId, or create a new album from the same search source.',
        },
      });
    }

    throw new AgentMcpRecoverableToolError({
      status: 'error',
      error: `Multiple visible albums named "${requestedName}" were found.`,
      toolName: AgentToolName.ProposeAddAssetsToAlbumFromSearch,
      retryable: true,
      hint: 'Ask the user which album to use, then retry with that albumId.',
      recovery: {
        kind: 'album_target_needs_clarification',
        albumName: requestedName,
        choices: matches.slice(0, 5).map((album) => ({
          albumId: album.id,
          albumName: album.albumName,
          assetCount: album.assetCount,
        })),
        instruction: 'Retry proposeAddAssetsToAlbumFromSearch with albumId from the chosen album.',
      },
    });
  }

  private async resolveWorkflowSpaceTarget(auth: AuthDto, dto: AgentProposeAddAssetsToSpaceFromSearchToolRequestDto) {
    if (dto.spaceId) {
      return { spaceId: dto.spaceId, spaceName: dto.spaceName ?? 'selected space' };
    }

    const requestedName = dto.spaceName?.trim() ?? '';
    const spaces = await this.sharedSpaceRepository.getAllByUserId(auth.user.id);
    const matches = spaces.filter((space) => space.name.trim().toLowerCase() === requestedName.toLowerCase());

    if (matches.length === 1) {
      return { spaceId: matches[0].id, spaceName: matches[0].name };
    }

    if (matches.length === 0) {
      throw new AgentMcpRecoverableToolError({
        status: 'error',
        error: `No visible space named "${requestedName}" was found.`,
        toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
        retryable: true,
        hint: 'Call listSpaces to choose an existing spaceId, or use proposeSpaceFromSearch to create a new space.',
        recovery: {
          kind: 'space_target_needs_clarification',
          spaceName: requestedName,
          choices: [],
          instruction: 'Retry with spaceId, or create a new space from the same search source.',
        },
      });
    }

    throw new AgentMcpRecoverableToolError({
      status: 'error',
      error: `Multiple visible spaces named "${requestedName}" were found.`,
      toolName: AgentToolName.ProposeAddAssetsToSpaceFromSearch,
      retryable: true,
      hint: 'Ask the user which space to use, then retry with that spaceId.',
      recovery: {
        kind: 'space_target_needs_clarification',
        spaceName: requestedName,
        choices: matches.slice(0, 5).map((space) => ({
          spaceId: space.id,
          spaceName: space.name,
          description: space.description,
          createdById: space.createdById,
        })),
        instruction: 'Retry proposeAddAssetsToSpaceFromSearch with spaceId from the chosen space.',
      },
    });
  }

  async reviseProposedOperations(
    auth: AuthDto,
    sessionId: string,
    planId: string,
    dto: AgentReviseAlbumOperationsDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });

    let prepared: { operations: AgentAlbumOperationInput[]; selectionAudit: PlanningSelectionAudit };
    try {
      prepared = await this.prepareOperations(auth, session, AgentToolName.ReviseProposedOperations, dto.operations);
    } catch (error) {
      await this.tryCreatePlanningPreparationDeniedAudit(
        session,
        AgentToolName.ReviseProposedOperations,
        {
          ...dto,
          planId,
        },
        error,
      );
      throw error;
    }

    const { operations, selectionAudit } = prepared;

    return this.runPlanningTool(
      auth,
      session,
      AgentToolName.ReviseProposedOperations,
      { ...dto, planId, operations, selectionHandles: selectionAudit },
      async () => {
        await this.requireCurrentProposedPlan(session.id, planId);
        await this.validateNormalAccess(auth, session, operations);
        const replacement = await this.planRepository.createReplacementRevision(session.id, {
          plan: {
            sessionId: session.id,
            status: AgentOperationPlanStatus.Proposed,
            summary: dto.summary,
          },
          operations,
        });
        if (!replacement) {
          throw new BadRequestException('Agent session is not accepting plan revisions');
        }

        await this.markWaitingForPlanReview(auth, session, replacement);
        return { plan: replacement, summary: this.summarize(replacement) };
      },
    );
  }

  async summarizePlan(
    auth: AuthDto,
    sessionId: string,
    planId: string,
    dto: AgentOperationPlanSummaryRequestDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: false });

    return this.runPlanningTool(auth, session, AgentToolName.SummarizePlan, { planId, focus: dto.focus }, async () => {
      const plan = await this.requireCurrentPlan(session.id, planId);
      return { plan, summary: this.summarize(plan) };
    });
  }

  async applyApprovedOperations(
    auth: AuthDto,
    sessionId: string,
    planId: string,
    dto: AgentOperationPlanApplyRequestDto,
  ): Promise<AgentOperationPlanApplyResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });
    if (session.status !== AgentSessionStatus.WaitingForPlanReview) {
      throw new BadRequestException('Agent session is not waiting for plan review');
    }

    const currentPlan = await this.requireCurrentProposedPlan(session.id, planId);
    const applySelection = this.validateApplySelection(currentPlan, dto);

    const claimedPlan = await this.planRepository.claimCurrentForApply(session.id, planId);
    if (!claimedPlan) {
      throw new NotFoundException('Agent operation plan not found');
    }

    try {
      const reviewMetadataByOperationId = await this.buildPlanReviewMetadata(claimedPlan, applySelection);
      const applyUpdates = await this.applyClaimedPlan(auth, session, claimedPlan, applySelection);
      const appliedPlan = await this.planRepository.completeApply(
        claimedPlan.id,
        this.attachReviewMetadataToApplyUpdates(applyUpdates, reviewMetadataByOperationId),
      );
      const response = this.buildApplyResponse(
        this.mapPlan(appliedPlan, reviewMetadataByOperationId),
        applySelection.selectedOperationIds,
      );

      await this.sessionRepository.update(auth.user.id, session.id, {
        status: AgentSessionStatus.Running,
        endedAt: null,
      });
      this.websocketRepository.clientSend('on_agent_session_event', auth.user.id, {
        type: 'operation-plan-applied',
        sessionId: session.id,
        planId: appliedPlan.id,
        status: response.status,
        appliedCount: response.appliedOperationIds.length,
        skippedCount: response.skippedOperationIds.length,
        failedCount: response.failedOperationIds.length,
      });

      return response;
    } catch (error) {
      await this.tryMarkApplySessionFailed(auth, session);
      throw error;
    }
  }

  private async runPlanningTool(
    auth: AuthDto,
    session: AgentSession,
    toolName: AgentToolName,
    request: PlanningRequest,
    operation: () => Promise<{ plan: AgentOperationPlanWithOperations; summary: string }>,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const executingToolCall = await this.createPlanningAudit(session, toolName, request, {
      status: AgentToolCallStatus.Executing,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: null,
      redactedResponseMetadata: null,
      error: null,
    });

    try {
      const result = await operation();
      const toolCall = await this.transitionPlanningAudit(session, executingToolCall.id, {
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: result.summary,
        redactedResponseMetadata: {
          planId: result.plan.id,
          operationIds: result.plan.operations.map((operation) => operation.id),
        },
        error: null,
      });

      if (toolName !== AgentToolName.SummarizePlan) {
        await this.emitPlanningActivity(session, AgentSessionActivityEventStatus.Completed, {
          summary: 'Prepared plan',
          total: this.getPlanActivityCount(result.plan),
        });
      }

      return {
        status: 'success',
        plan: this.mapPlan(result.plan),
        toolCall: this.mapToolCall(toolCall),
        summary: result.summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent operation planning failed';
      const status =
        error instanceof BadRequestException || error instanceof NotFoundException
          ? AgentToolCallStatus.Denied
          : AgentToolCallStatus.Failed;
      const approvalDecision =
        status === AgentToolCallStatus.Denied ? AgentToolApprovalDecision.Denied : AgentToolApprovalDecision.Approved;

      await this.tryTransitionPlanningAudit(session, executingToolCall.id, {
        status,
        approvalDecision,
        responseSummary: null,
        redactedResponseMetadata: null,
        error: message,
      });

      throw error;
    }
  }

  private async requireCurrentProposedPlan(sessionId: string, planId: string) {
    const plan = await this.requireCurrentPlan(sessionId, planId);

    if (plan.status !== AgentOperationPlanStatus.Proposed) {
      throw new NotFoundException('Agent operation plan not found');
    }

    return plan;
  }

  private async requireCurrentPlan(sessionId: string, planId: string) {
    const [plan, currentPlan] = await Promise.all([
      this.planRepository.getByIdForSession(sessionId, planId),
      this.planRepository.getCurrentBySessionId(sessionId),
    ]);

    if (!plan || currentPlan?.id !== plan.id) {
      throw new NotFoundException('Agent operation plan not found');
    }

    return plan;
  }

  private async getOwnedSession(auth: AuthDto, sessionId: string, options: { requireActive: boolean }) {
    const session = await this.sessionRepository.getById(auth.user.id, sessionId);
    if (!session) {
      throw new NotFoundException('Agent session not found');
    }

    if (options.requireActive && !AgentOperationPlanService.activeStatuses.includes(session.status)) {
      throw new BadRequestException('Agent session is not active');
    }

    return {
      ...session,
      permissionPlanSnapshot: this.normalizePermissionPlanSnapshot(session.permissionPlanSnapshot),
    };
  }

  private normalizePermissionPlanSnapshot(plan: AgentSession['permissionPlanSnapshot']) {
    return {
      ...plan,
      writeScope: {
        ...AgentOperationPlanService.legacyWriteScopeDefaults,
        ...plan.writeScope,
      },
      limits: {
        ...plan.limits,
        maxPreviewsPerSession: plan.limits.maxPreviewsPerSession ?? plan.limits.maxPreviewsPerToolCall,
        maxOriginalsPerSession: plan.limits.maxOriginalsPerSession ?? plan.limits.maxOriginalsPerToolCall,
      },
    };
  }

  private async validateNormalAccess(auth: AuthDto, session: AgentSession, operations: AgentAlbumOperationInput[]) {
    const albumIds = new Set(
      operations
        .filter((operation) => operation.targetKind === AgentOperationTargetKind.ExistingAlbum && operation.targetId)
        .map((operation) => operation.targetId as string),
    );
    if (albumIds.size > 0) {
      const writableAlbumIds = await this.getWritableAlbumIds(auth, session, albumIds);
      if (writableAlbumIds.size !== albumIds.size) {
        throw new BadRequestException('One or more target albums are not accessible');
      }
    }

    const ownerSpaceIds = new Set(
      operations
        .filter(
          (operation) =>
            this.requiresOwnerSpaceAccess(operation.type) &&
            operation.targetKind === AgentOperationTargetKind.ExistingSpace &&
            operation.targetId,
        )
        .map((operation) => operation.targetId as string),
    );

    if (ownerSpaceIds.size > 0) {
      const writableSpaceIds = await this.accessRepository.sharedSpace.checkRoleAccess(
        auth.user.id,
        ownerSpaceIds,
        SharedSpaceRole.Owner,
      );
      const requestedWritableSpaceIds = new Set([...writableSpaceIds].filter((id) => ownerSpaceIds.has(id)));
      if (requestedWritableSpaceIds.size !== ownerSpaceIds.size) {
        throw new BadRequestException('One or more target spaces are not accessible');
      }
    }

    const editorSpaceIds = new Set(
      operations
        .filter(
          (operation) =>
            !this.requiresOwnerSpaceAccess(operation.type) &&
            operation.targetKind === AgentOperationTargetKind.ExistingSpace &&
            operation.targetId,
        )
        .map((operation) => operation.targetId as string),
    );
    if (editorSpaceIds.size > 0) {
      const writableSpaceIds = await this.accessRepository.sharedSpace.checkRoleAccess(
        auth.user.id,
        editorSpaceIds,
        SharedSpaceRole.Editor,
      );
      const requestedWritableSpaceIds = new Set([...writableSpaceIds].filter((id) => editorSpaceIds.has(id)));
      if (requestedWritableSpaceIds.size !== editorSpaceIds.size) {
        throw new BadRequestException('One or more target spaces are not accessible');
      }
    }

    const assetIds = [...new Set(operations.flatMap((operation) => operation.assetIds ?? []))];
    if (assetIds.length > 0) {
      const readableAssetIds = await this.getReadableAssetIds(auth, session, assetIds);
      if (readableAssetIds.size !== assetIds.length) {
        throw new BadRequestException('One or more assets are not accessible');
      }
    }

    const writableAssetIds = [
      ...new Set(
        operations
          .filter((operation) => this.requiresWritableAssets(operation.type))
          .flatMap((operation) => operation.assetIds ?? []),
      ),
    ];
    if (writableAssetIds.length > 0) {
      const allowedAssetIds = await this.getWritableAssetIds(auth, session, writableAssetIds);
      if (allowedAssetIds.size !== writableAssetIds.length) {
        throw new BadRequestException('One or more assets are not editable');
      }
    }

    const tagIds = new Set(
      operations.flatMap((operation) => {
        const payload = this.requireObjectPayload(operation.payload);
        return typeof payload.tagId === 'string' ? [payload.tagId] : [];
      }),
    );
    if (tagIds.size > 0) {
      const writableTagIds = await this.accessRepository.tag.checkOwnerAccess(auth.user.id, tagIds);
      const requestedWritableTagIds = new Set([...writableTagIds].filter((id) => tagIds.has(id)));
      if (requestedWritableTagIds.size !== tagIds.size) {
        throw new BadRequestException('One or more tags are not accessible');
      }
    }
  }

  private requiresWritableAssets(type: AgentOperationType) {
    return [
      AgentOperationType.AssetRotate,
      AgentOperationType.AssetCrop,
      AgentOperationType.AssetAdjust,
      AgentOperationType.AssetFlip,
      AgentOperationType.AssetStack,
      AgentOperationType.AssetUnstack,
      AgentOperationType.AssetSetFavorite,
      AgentOperationType.AssetSetArchive,
      AgentOperationType.AssetSetVisibility,
      AgentOperationType.AssetUpdateMetadata,
      AgentOperationType.AssetAddTag,
      AgentOperationType.AssetRemoveTag,
      AgentOperationType.AssetTrash,
      AgentOperationType.AssetRestore,
      AgentOperationType.ShareLinkCreate,
    ].includes(type);
  }

  private requiresOwnerSpaceAccess(type: AgentOperationType) {
    return [
      AgentOperationType.SpaceUpdateDetails,
      AgentOperationType.SpaceAddMembers,
      AgentOperationType.SpaceRemoveMembers,
      AgentOperationType.SpaceUpdateMemberRole,
      AgentOperationType.SpaceDelete,
    ].includes(type);
  }

  private async validateExistingSpaceRoleAccess(auth: AuthDto, spaceId: string, role: SharedSpaceRole) {
    const requestedSpaceIds = new Set([spaceId]);
    const writableSpaceIds = await this.accessRepository.sharedSpace.checkRoleAccess(
      auth.user.id,
      requestedSpaceIds,
      role,
    );
    if (!writableSpaceIds.has(spaceId)) {
      throw new BadRequestException('One or more target spaces are not accessible');
    }
  }

  private async getWritableAlbumIds(auth: AuthDto, session: AgentSession, albumIds: Set<string>) {
    const writableIds = new Set<string>();
    const plan = session.permissionPlanSnapshot;

    if (plan.assetScope.owned) {
      const ownerIds = await this.accessRepository.album.checkOwnerAccess(auth.user.id, albumIds);
      for (const id of ownerIds) {
        if (albumIds.has(id)) {
          writableIds.add(id);
        }
      }
    }

    if (plan.assetScope.sharedSpaces) {
      const sharedIds = await this.accessRepository.album.checkSharedAlbumAccess(
        auth.user.id,
        albumIds,
        AlbumUserRole.Editor,
      );
      for (const id of sharedIds) {
        if (albumIds.has(id)) {
          writableIds.add(id);
        }
      }
    }

    return writableIds;
  }

  private async getReadableAssetIds(auth: AuthDto, session: AgentSession, assetIds: string[]) {
    const requestedIds = new Set(assetIds);
    const readableIds = new Set<string>();
    const plan = session.permissionPlanSnapshot;
    const allowLockedAssets = plan.assetScope.locked && auth.session?.hasElevatedPermission === true;

    if (plan.assetScope.owned) {
      const ownerIds = await this.accessRepository.asset.checkOwnerAccess(
        auth.user.id,
        requestedIds,
        allowLockedAssets,
      );
      for (const id of ownerIds) {
        if (requestedIds.has(id)) {
          readableIds.add(id);
        }
      }
    }

    if (plan.assetScope.sharedSpaces) {
      const spaceIds = await this.accessRepository.asset.checkSpaceAccess(auth.user.id, requestedIds);
      for (const id of spaceIds) {
        if (requestedIds.has(id)) {
          readableIds.add(id);
        }
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

  private async getReadablePersonIds(auth: AuthDto, session: AgentSession, personIds: string[]) {
    const requestedIds = new Set(personIds);
    const readableIds = new Set<string>();
    const plan = session.permissionPlanSnapshot;

    if (plan.assetScope.owned) {
      const ownerIds = await this.accessRepository.person.checkOwnerAccess(auth.user.id, requestedIds);
      for (const id of ownerIds) {
        if (requestedIds.has(id)) {
          readableIds.add(id);
        }
      }
    }

    if (plan.assetScope.sharedSpaces) {
      const sharedIds = await this.accessRepository.person.checkSharedSpaceAccess(auth.user.id, requestedIds);
      for (const id of sharedIds) {
        if (requestedIds.has(id)) {
          readableIds.add(id);
        }
      }
    }

    return readableIds;
  }

  private async getWritableAssetIds(auth: AuthDto, session: AgentSession, assetIds: string[]) {
    const requestedIds = new Set(assetIds);
    const writableIds = new Set<string>();
    const plan = session.permissionPlanSnapshot;
    const allowLockedAssets = plan.assetScope.locked && auth.session?.hasElevatedPermission === true;

    if (plan.assetScope.owned) {
      const ownerIds = await this.accessRepository.asset.checkOwnerAccess(
        auth.user.id,
        requestedIds,
        allowLockedAssets,
      );
      for (const id of ownerIds) {
        if (requestedIds.has(id)) {
          writableIds.add(id);
        }
      }
    }

    if (plan.assetScope.sharedSpaces) {
      const spaceIds = await this.accessRepository.asset.checkSpaceEditAccess(auth.user.id, requestedIds);
      for (const id of spaceIds) {
        if (requestedIds.has(id)) {
          writableIds.add(id);
        }
      }

      if (!allowLockedAssets) {
        const lockedIds = await this.assetRepository.getAgentLockedIds(writableIds);
        for (const id of lockedIds) {
          writableIds.delete(id);
        }
      }
    }

    const agentReadableIds = await this.assetRepository.getAgentReadableIds(writableIds);
    for (const id of writableIds) {
      if (!agentReadableIds.has(id)) {
        writableIds.delete(id);
      }
    }

    return writableIds;
  }

  private async prepareOperations(
    auth: AuthDto,
    session: AgentSession,
    toolName: AgentToolName,
    operations: AgentAlbumOperationInput[],
  ) {
    const createTemporaryTargetIds = new Set<string>();
    const createSpaceTemporaryTargetIds = new Set<string>();
    const allCreateSpaceTemporaryTargetIds = new Set(
      operations
        .filter((operation) => operation.type === AgentOperationType.SpaceCreate && operation.temporaryTargetId)
        .map((operation) => operation.temporaryTargetId as string),
    );
    const preparedOperations: AgentAlbumOperationInput[] = [];
    const selectionAudit: PlanningSelectionAudit = [];

    for (const operation of operations) {
      this.validateWriteScope(session, operation.type);

      if (operation.type === AgentOperationType.AlbumCreate) {
        if (!operation.temporaryTargetId) {
          throw new BadRequestException('album.create requires temporaryTargetId');
        }

        if (createTemporaryTargetIds.has(operation.temporaryTargetId)) {
          throw new BadRequestException(`Duplicate album.create temporaryTargetId: ${operation.temporaryTargetId}`);
        }

        createTemporaryTargetIds.add(operation.temporaryTargetId);
      }

      if (operation.type === AgentOperationType.SpaceCreate) {
        if (!operation.temporaryTargetId) {
          throw new BadRequestException('space.create requires temporaryTargetId');
        }

        if (createSpaceTemporaryTargetIds.has(operation.temporaryTargetId)) {
          throw new BadRequestException(`Duplicate space.create temporaryTargetId: ${operation.temporaryTargetId}`);
        }

        createSpaceTemporaryTargetIds.add(operation.temporaryTargetId);
      }

      if (
        (operation.type === AgentOperationType.AlbumAddAssets || operation.type === AgentOperationType.AlbumSetCover) &&
        operation.targetKind === AgentOperationTargetKind.NewAlbum &&
        (!operation.temporaryTargetId || !createTemporaryTargetIds.has(operation.temporaryTargetId))
      ) {
        throw new BadRequestException(
          `No album.create operation found for temporaryTargetId: ${operation.temporaryTargetId}`,
        );
      }

      if (
        (operation.type === AgentOperationType.SpaceAddAssets ||
          operation.type === AgentOperationType.SpaceRemoveAssets) &&
        operation.targetKind === AgentOperationTargetKind.NewSpace &&
        (!operation.temporaryTargetId || !allCreateSpaceTemporaryTargetIds.has(operation.temporaryTargetId))
      ) {
        throw new BadRequestException(
          `No space.create operation found for temporaryTargetId: ${operation.temporaryTargetId}`,
        );
      }

      if (
        (operation.type === AgentOperationType.SpaceAddAssets ||
          operation.type === AgentOperationType.SpaceRemoveAssets) &&
        operation.targetKind === AgentOperationTargetKind.NewSpace &&
        operation.temporaryTargetId &&
        !createSpaceTemporaryTargetIds.has(operation.temporaryTargetId)
      ) {
        throw new BadRequestException(
          `${operation.type} references temporaryTargetId before its space.create operation`,
        );
      }

      const materializedAssetIds = await this.resolveOperationAssetIds(
        auth,
        session,
        toolName,
        operation,
        selectionAudit,
      );
      this.validateMaterializedAssetSelection(operation, materializedAssetIds);

      preparedOperations.push({
        type: operation.type,
        summary: operation.summary,
        targetKind: operation.targetKind,
        targetId: operation.targetId,
        temporaryTargetId: operation.temporaryTargetId,
        assetIds: materializedAssetIds,
        assetSource: undefined,
        assetSelectionHandleId: undefined,
        payload: operation.payload ?? {},
        dependencyIds: operation.dependencyIds ?? [],
        riskLevel: operation.riskLevel,
        enabled: operation.enabled,
      });
    }

    return { operations: preparedOperations, selectionAudit };
  }

  private async resolveOperationAssetIds(
    auth: AuthDto,
    session: AgentSession,
    toolName: AgentToolName,
    operation: AgentAlbumOperationInput,
    selectionAudit: PlanningSelectionAudit,
  ) {
    if (!this.isAssetBearingOperation(operation.type)) {
      const validation = validateNoAgentAssetSourceMechanisms(operation);
      if (!validation.valid) {
        throw new BadRequestException(validation.message);
      }

      return operation.assetIds ?? [];
    }

    const validation = validateAgentAssetSourceMechanismCount(operation);
    if (!validation.valid) {
      throw new BadRequestException(validation.message);
    }

    if (operation.assetSource) {
      return this.resolveAssetSourceAssetIds(
        auth,
        session,
        toolName,
        operation.assetSource,
        operation.type,
        selectionAudit,
      );
    }

    if (operation.assetSelectionHandleId) {
      return this.resolveSelectionHandleAssetIds(auth, session, operation.assetSelectionHandleId, selectionAudit, {
        toolName,
        field: 'operations[].assetSelectionHandleId',
      });
    }

    return operation.assetIds ?? [];
  }

  private isAssetBearingOperation(type: AgentOperationType) {
    return (
      type === AgentOperationType.AlbumAddAssets ||
      type === AgentOperationType.AlbumRemoveAssets ||
      type === AgentOperationType.AlbumSetCover ||
      type === AgentOperationType.SpaceAddAssets ||
      type === AgentOperationType.SpaceRemoveAssets ||
      type === AgentOperationType.AssetRotate ||
      type === AgentOperationType.AssetCrop ||
      type === AgentOperationType.AssetAdjust ||
      type === AgentOperationType.AssetFlip ||
      type === AgentOperationType.AssetStack ||
      type === AgentOperationType.AssetUnstack ||
      type === AgentOperationType.AssetSetFavorite ||
      type === AgentOperationType.AssetSetArchive ||
      type === AgentOperationType.AssetSetVisibility ||
      type === AgentOperationType.AssetUpdateMetadata ||
      type === AgentOperationType.AssetAddTag ||
      type === AgentOperationType.AssetRemoveTag ||
      type === AgentOperationType.AssetTrash ||
      type === AgentOperationType.AssetRestore ||
      type === AgentOperationType.ShareLinkCreate
    );
  }

  private async resolveAssetSourceAssetIds(
    auth: AuthDto,
    session: AgentSession,
    toolName: AgentToolName,
    assetSource: AgentAssetSourceInput,
    operationType: AgentOperationType,
    selectionAudit: PlanningSelectionAudit,
  ) {
    if (assetSource.kind === 'previousSearch') {
      const selectionHandleId = await this.selectionHandleIdFromSearchSourceRef(
        auth,
        session,
        toolName,
        assetSource.sourceRef,
      );

      return this.resolveSelectionHandleAssetIds(auth, session, selectionHandleId, selectionAudit, {
        toolName,
        sourceKind: 'previousSearch',
        sourceRef: assetSource.sourceRef,
      });
    }

    if (assetSource.kind === 'search') {
      return this.resolveSearchAssetSourceAssetIds(auth, session, toolName, assetSource, operationType, selectionAudit);
    }

    if (assetSource.kind === 'selectionHandle') {
      return this.resolveSelectionHandleAssetIds(
        auth,
        session,
        assetSource.selectionHandleId,
        selectionAudit,
        this.selectionHandleResolutionContextForAssetSource(toolName),
      );
    }

    throw new BadRequestException(
      'Only assetSource.search, assetSource.previousSearch, and assetSource.selectionHandle are supported for operation planning',
    );
  }

  private async resolveSearchAssetSourceAssetIds(
    auth: AuthDto,
    session: AgentSession,
    toolName: AgentToolName,
    assetSource: Extract<AgentAssetSourceInput, { kind: 'search' }>,
    operationType: AgentOperationType,
    selectionAudit: PlanningSelectionAudit,
  ): Promise<string[]> {
    const mode = assetSource.mode ?? 'metadata';
    if (mode === 'smart') {
      throw new BadRequestException('assetSource.search smart mode is not supported for operation planning yet');
    }

    const unsupportedRequestReason = this.getUnsupportedSearchSourceRequestReason(auth, session, assetSource, mode);
    if (unsupportedRequestReason) {
      throw new BadRequestException(unsupportedRequestReason);
    }

    if ((mode === 'description' || mode === 'ocr' || mode === 'filename') && !assetSource.query?.trim()) {
      throw new BadRequestException(`assetSource.search ${mode} mode requires query`);
    }

    const declarativeFilters = assetSource.filters ?? {};
    const resolution = await this.assetSearchFilterResolverService.resolveDeclarativeFilters(
      auth,
      session,
      declarativeFilters,
    );

    if (resolution.status === 'denied') {
      throw new BadRequestException(resolution.reason);
    }

    if (resolution.status === 'needs_clarification') {
      throw new AgentMcpRecoverableToolError({
        status: 'error',
        error: resolution.message,
        toolName,
        retryable: true,
        hint: 'Ask the user to clarify the search filters, then retry with a narrower assetSource.search.',
        recovery: {
          kind: 'asset_search_filters_need_clarification',
          filterKeys: Object.keys(declarativeFilters).toSorted(),
          instruction: 'Ask the user to clarify the search filters, then retry with a narrower assetSource.search.',
        },
      });
    }

    const cap = this.getSearchSourceMaterializationCap(operationType);
    const request = this.buildSearchSourceRequest(assetSource, resolution.filters, cap);
    const timelineSpaceIds = await this.getSearchTimelineSpaceIds(auth, session, resolution.filters);
    const search = buildAgentSearch({
      userId: auth.user.id,
      request,
      scope: {
        ...this.getRepositoryScope(auth, session),
        timelineSpaceIds,
      },
    });

    if (search.kind === 'smart') {
      throw new BadRequestException('assetSource.search smart mode is not supported for operation planning yet');
    }

    const result = await this.searchRepository.searchMetadata(search.pagination, search.options);
    const assetIds = result.items.map((asset) => asset.id);
    const materialization = assetSource.materialization ?? 'all-matches-with-limit';
    if (materialization === 'all-matches-with-limit' && (assetIds.length > cap || result.hasNextPage)) {
      throw new BadRequestException(
        `Search matched more than ${cap} assets. Narrow the search or use materialization "bounded-page" with a smaller limit.`,
      );
    }

    if (assetIds.length === 0) {
      throw new BadRequestException('Search source did not match any assets');
    }

    if (assetIds.length > cap) {
      throw new BadRequestException(
        `Search matched more than ${cap} assets. Narrow the search or use a smaller bounded page.`,
      );
    }

    selectionAudit.push({
      assetCount: assetIds.length,
      sampleAssetIds: assetIds.slice(0, 25),
      sourceKind: 'search',
      declarativeFilters,
      resolvedFilters: resolution.filters,
    });

    return assetIds;
  }

  private buildSearchSourceRequest(
    assetSource: Extract<AgentAssetSourceInput, { kind: 'search' }>,
    filters: AgentSearchAssetsFilters,
    cap: number,
  ) {
    const materialization = assetSource.materialization ?? 'all-matches-with-limit';
    const limit = materialization === 'all-matches-with-limit' ? cap + 1 : (assetSource.limit ?? 100);

    return {
      mode: assetSource.mode ?? 'metadata',
      query: assetSource.query,
      filters,
      limit,
      page: materialization === 'all-matches-with-limit' ? 1 : (assetSource.page ?? 1),
      order: assetSource.order ?? 'desc',
      detail: 'ids' as const,
      fields: [],
    };
  }

  private getSearchSourceMaterializationCap(operationType: AgentOperationType) {
    return operationType === AgentOperationType.AlbumSetCover
      ? AgentOperationPlanService.maxCoverSelectionHandleAssets
      : AgentOperationPlanService.maxAssetSelectionHandleAssets;
  }

  private getUnsupportedSearchSourceRequestReason(
    auth: AuthDto,
    session: AgentSession,
    assetSource: Extract<AgentAssetSourceInput, { kind: 'search' }>,
    mode: AgentSearchAssetsMode,
  ): string | null {
    if (mode === 'metadata' && assetSource.query !== undefined) {
      return 'query is only supported for smart, description, ocr, and filename search modes';
    }

    const order = assetSource.order ?? 'desc';
    const pagingReason = this.getUnsupportedSearchSourcePagingReason(order, mode);
    if (pagingReason) {
      return pagingReason;
    }

    const allowLockedAssets =
      session.permissionPlanSnapshot.assetScope.locked && auth.session?.hasElevatedPermission === true;
    if (assetSource.filters?.visibility === AssetVisibility.Locked && !allowLockedAssets) {
      return 'Locked photos require elevated permission';
    }

    return null;
  }

  private getUnsupportedSearchSourcePagingReason(
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

  private getRepositoryScope(auth: AuthDto, session: AgentSession) {
    const plan = session.permissionPlanSnapshot;
    return {
      owned: plan.assetScope.owned,
      sharedSpaces: plan.assetScope.sharedSpaces,
      locked: plan.assetScope.locked && auth.session?.hasElevatedPermission === true,
    };
  }

  private async getSearchTimelineSpaceIds(auth: AuthDto, session: AgentSession, filters: AgentSearchAssetsFilters) {
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

  private getSelectionHandleExpiresAt(session: AgentSession) {
    const minutes = session.permissionPlanSnapshot.limits.expiresInMinutes ?? 60;
    return new Date(Date.now() + minutes * 60_000);
  }

  private async selectionHandleIdFromSearchSourceRef(
    auth: AuthDto,
    session: AgentSession,
    toolName: AgentToolName,
    sourceRef: string,
  ) {
    if (!sourceRef.startsWith(searchSourceRefPrefix)) {
      throw await this.createInvalidSourceRefError(auth, session, toolName, sourceRef);
    }

    const id = sourceRef.slice(searchSourceRefPrefix.length);
    if (!z.uuidv4().safeParse(id).success) {
      throw await this.createInvalidSourceRefError(auth, session, toolName, sourceRef);
    }

    return id;
  }

  private validateMaterializedAssetSelection(operation: AgentAlbumOperationInput, assetIds: string[]) {
    if (!operation.assetSelectionHandleId && !operation.assetSource) {
      return;
    }

    if (assetIds.length === 0) {
      throw new BadRequestException('Selection handle did not contain any assets');
    }

    if (
      operation.type === AgentOperationType.AlbumSetCover &&
      assetIds.length > AgentOperationPlanService.maxCoverSelectionHandleAssets
    ) {
      throw new BadRequestException('Selection handle contains too many cover candidates');
    }

    if (
      operation.type !== AgentOperationType.AlbumSetCover &&
      assetIds.length > AgentOperationPlanService.maxAssetSelectionHandleAssets
    ) {
      throw new BadRequestException('Selection handle contains too many assets');
    }
  }

  private async resolveSelectionHandleAssetIds(
    auth: AuthDto,
    session: AgentSession,
    id: string,
    selectionAudit: PlanningSelectionAudit,
    source?:
      | { toolName: AgentToolName; sourceKind: 'previousSearch'; sourceRef: AgentSearchSourceRef }
      | SelectionHandleResolutionContext,
  ) {
    const handle = await this.selectionHandleRepository.getValidForPlanning({
      id,
      sessionId: session.id,
      userId: auth.user.id,
      now: new Date(),
    });
    if (!handle) {
      if (source && 'sourceRef' in source) {
        throw await this.createInvalidSourceRefError(auth, session, source.toolName, source.sourceRef);
      }
      throw await this.createInvalidSelectionHandleError(
        auth,
        session,
        id,
        source ?? { toolName: AgentToolName.ProposeAlbumOperations, field: 'operations[].assetSelectionHandleId' },
      );
    }

    selectionAudit.push({
      id: handle.id,
      assetCount: handle.assetCount,
      sampleAssetIds: handle.sampleAssetIds,
      ...(source && 'sourceRef' in source ? { sourceKind: source.sourceKind, sourceRef: source.sourceRef } : {}),
    });

    return handle.assetIds;
  }

  private selectionHandleResolutionContextForAssetSource(toolName: AgentToolName): SelectionHandleResolutionContext {
    const field =
      toolName === AgentToolName.ProposeAlbumOperations || toolName === AgentToolName.ReviseProposedOperations
        ? 'operations[].assetSource.selectionHandleId'
        : 'assetSource.selectionHandleId';

    return { toolName, field };
  }

  private async createInvalidSourceRefError(
    auth: AuthDto,
    session: AgentSession,
    toolName: AgentToolName,
    sourceRef: string,
  ) {
    const instruction = 'Rerun searchAssets, then retry with the returned selectionHandle.sourceRef.';
    const recovery: AgentSourceRefRecoveryMetadata = {
      kind: 'invalid-source-ref',
      attemptedSourceRef: sourceRef,
      expectedSourceKind: 'search',
      instruction,
    };

    const id = sourceRef.startsWith(searchSourceRefPrefix) ? sourceRef.slice(searchSourceRefPrefix.length) : null;
    const now = new Date();
    if (id && z.uuidv4().safeParse(id).success) {
      const attemptedHandle = await this.selectionHandleRepository.getForRecovery({
        id,
        sessionId: session.id,
        userId: auth.user.id,
      });
      if (attemptedHandle && attemptedHandle.expiresAt <= now) {
        recovery.expiredSourceRef = sourceRef;
      }
    }

    const error = 'Source ref is expired or not available for this session';
    return invalidSourceRefError({
      toolName,
      error,
      hint: recovery.expiredSourceRef ? `The attempted source ref is expired. ${instruction}` : recovery.instruction,
      recovery,
    });
  }

  private async createInvalidSelectionHandleError(
    auth: AuthDto,
    session: AgentSession,
    id: string,
    context: SelectionHandleResolutionContext,
  ) {
    const [readableAssetIds, readablePersonIds] = await Promise.all([
      this.getReadableAssetIds(auth, session, [id]),
      this.getReadablePersonIds(auth, session, [id]),
    ]);
    const receivedDomain = readableAssetIds.has(id) ? 'asset' : readablePersonIds.has(id) ? 'person' : null;
    const instruction = this.invalidSelectionHandleInstruction(context);
    if (receivedDomain) {
      return wrongIdDomainError({
        toolName: context.toolName,
        field: context.field,
        expectedDomain: 'selectionHandle',
        receivedDomain,
        instruction,
      });
    }

    const now = new Date();
    const [availableSelectionHandles, attemptedHandle] = await Promise.all([
      this.selectionHandleRepository.listValidForRecovery({
        sessionId: session.id,
        userId: auth.user.id,
        now,
        limit: selectionHandleRecoveryLimit,
      }),
      this.selectionHandleRepository.getForRecovery({
        id,
        sessionId: session.id,
        userId: auth.user.id,
      }),
    ]);
    const expiredSelectionHandle =
      attemptedHandle && attemptedHandle.expiresAt <= now
        ? this.toSelectionHandleRecoveryHint(attemptedHandle)
        : undefined;
    const recovery: AgentSelectionHandleRecoveryMetadata = {
      kind: 'invalid-selection-handle',
      attemptedSelectionHandleId: id,
      looksLikeExamplePlaceholder: knownExampleSelectionHandleIds.has(id),
      availableSelectionHandles: availableSelectionHandles.map((handle) => this.toSelectionHandleRecoveryHint(handle)),
      ...(expiredSelectionHandle ? { expiredSelectionHandle } : {}),
      instruction: `Retry ${context.toolName} with a valid same-session selection handle, or rerun searchAssets.`,
    };
    const error = 'Selection handle is expired or not available for this session';
    const hint = this.invalidSelectionHandleHint(recovery, context.toolName);

    return invalidSelectionHandleError({
      toolName: context.toolName,
      error,
      hint,
      recovery,
    });
  }

  private toSelectionHandleRecoveryHint(handle: SelectionHandleRecoveryRow): AgentSelectionHandleRecoveryHint {
    return {
      id: handle.id,
      assetCount: handle.assetCount,
      sourceToolCallId: handle.sourceToolCallId,
      createdAt: handle.createdAt.toISOString(),
      expiresAt: handle.expiresAt.toISOString(),
    };
  }

  private invalidSelectionHandleInstruction(context: SelectionHandleResolutionContext) {
    if (context.field === 'operations[].assetSelectionHandleId') {
      return 'Use a same-session selectionHandle.id returned by searchAssets, or use assetSource.search once available.';
    }

    return `Use a same-session selectionHandle.id returned by searchAssets, then retry ${context.toolName} with ${context.field}.`;
  }

  private invalidSelectionHandleHint(recovery: AgentSelectionHandleRecoveryMetadata, toolName: AgentToolName) {
    if (recovery.expiredSelectionHandle) {
      return `The attempted selection handle is expired. Rerun searchAssets, then retry ${toolName} with the returned selectionHandle.id.`;
    }

    if (recovery.availableSelectionHandles.length === 1) {
      return `Retry ${toolName} with the exact handle ${recovery.availableSelectionHandles[0].id} if that is the intended search selection.`;
    }

    if (recovery.availableSelectionHandles.length > 1) {
      return `Choose the intended same-session handle from availableSelectionHandles and retry ${toolName} with that exact id.`;
    }

    return `Rerun searchAssets, then retry ${toolName} with the returned selectionHandle.id.`;
  }

  private validateWriteScope(session: AgentSession, type: AgentOperationType) {
    const writeScope = session.permissionPlanSnapshot.writeScope;
    if (type === AgentOperationType.AlbumCreate && !writeScope.createAlbum) {
      throw new BadRequestException('Agent permission policy does not allow creating albums');
    }

    if (type === AgentOperationType.AlbumAddAssets && !writeScope.addAssets) {
      throw new BadRequestException('Agent permission policy does not allow adding assets to albums');
    }

    if (type === AgentOperationType.AlbumRemoveAssets && !writeScope.removeAssets) {
      throw new BadRequestException('Agent permission policy does not allow removing assets from albums');
    }

    if (type === AgentOperationType.AlbumUpdateDetails && !writeScope.updateDetails) {
      throw new BadRequestException('Agent permission policy does not allow updating album details');
    }

    if (type === AgentOperationType.AlbumSetCover && !writeScope.setCover) {
      throw new BadRequestException('Agent permission policy does not allow setting album covers');
    }

    if (type === AgentOperationType.SpaceCreate && !writeScope.createSpace) {
      throw new BadRequestException('Agent permission policy does not allow creating spaces');
    }

    if (type === AgentOperationType.SpaceAddAssets && !writeScope.addAssetsToSpaces) {
      throw new BadRequestException('Agent permission policy does not allow adding assets to spaces');
    }

    if (type === AgentOperationType.SpaceRemoveAssets && !writeScope.removeAssetsFromSpaces) {
      throw new BadRequestException('Agent permission policy does not allow removing assets from spaces');
    }

    if (type === AgentOperationType.SpaceUpdateDetails && !writeScope.updateSpaceDetails) {
      throw new BadRequestException('Agent permission policy does not allow updating space details');
    }

    if (type === AgentOperationType.SpaceAddMembers && !writeScope.addMembersToSpaces) {
      throw new BadRequestException('Agent permission policy does not allow adding members to spaces');
    }

    if (type === AgentOperationType.SpaceRemoveMembers && !writeScope.removeMembersFromSpaces) {
      throw new BadRequestException('Agent permission policy does not allow removing members from spaces');
    }

    if (type === AgentOperationType.SpaceUpdateMemberRole && !writeScope.updateSpaceMemberRoles) {
      throw new BadRequestException('Agent permission policy does not allow updating space member roles');
    }

    if (
      (type === AgentOperationType.AlbumAddUsers ||
        type === AgentOperationType.AlbumRemoveUsers ||
        type === AgentOperationType.AlbumUpdateUserRole) &&
      !writeScope.shareAlbums
    ) {
      throw new BadRequestException('Agent permission policy does not allow sharing albums');
    }

    if (
      (type === AgentOperationType.AssetRotate ||
        type === AgentOperationType.AssetCrop ||
        type === AgentOperationType.AssetAdjust ||
        type === AgentOperationType.AssetFlip) &&
      !writeScope.editAssets
    ) {
      throw new BadRequestException('Agent permission policy does not allow editing assets');
    }

    if (type === AgentOperationType.AssetSetFavorite && !writeScope.favoriteAssets) {
      throw new BadRequestException('Agent permission policy does not allow changing asset favorites');
    }

    if (type === AgentOperationType.AssetSetArchive && !writeScope.archiveAssets) {
      throw new BadRequestException('Agent permission policy does not allow archiving assets');
    }

    if (type === AgentOperationType.AssetSetVisibility && !writeScope.lockAssets) {
      throw new BadRequestException('Agent permission policy does not allow moving photos to the Locked folder');
    }

    if (type === AgentOperationType.AssetUpdateMetadata && !writeScope.updateAssetMetadata) {
      throw new BadRequestException('This session is not allowed to update asset metadata');
    }

    if (
      (type === AgentOperationType.AssetAddTag || type === AgentOperationType.AssetRemoveTag) &&
      !writeScope.tagAssets
    ) {
      throw new BadRequestException('Agent permission policy does not allow tagging assets');
    }

    if (
      (type === AgentOperationType.AssetTrash || type === AgentOperationType.AssetRestore) &&
      !writeScope.trashAssets
    ) {
      throw new BadRequestException('Agent permission policy does not allow moving assets to trash');
    }

    if (
      (type === AgentOperationType.ShareLinkCreate || type === AgentOperationType.ShareLinkCreateAlbum) &&
      !writeScope.createSharedLinks
    ) {
      throw new BadRequestException('Agent permission policy does not allow creating shared links');
    }

    if (
      (type === AgentOperationType.AssetStack || type === AgentOperationType.AssetUnstack) &&
      !writeScope.manageStacks
    ) {
      throw new BadRequestException('Agent permission policy does not allow stacking assets');
    }

    if (
      (type === AgentOperationType.PersonUpdate || type === AgentOperationType.PersonMerge) &&
      !writeScope.managePeople
    ) {
      throw new BadRequestException('Agent permission policy does not allow managing people');
    }

    if (type === AgentOperationType.AlbumDelete && !writeScope.deleteContainers) {
      throw new BadRequestException('Agent permission policy does not allow deleting albums');
    }

    if (type === AgentOperationType.SpaceDelete && !writeScope.deleteContainers) {
      throw new BadRequestException('Agent permission policy does not allow deleting spaces');
    }
  }

  private async markWaitingForPlanReview(auth: AuthDto, session: AgentSession, plan: AgentOperationPlanWithOperations) {
    await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.WaitingForPlanReview });
    this.websocketRepository.clientSend('on_agent_session_event', auth.user.id, {
      type: 'operation-plan-ready',
      sessionId: session.id,
      planId: plan.id,
      revision: plan.revision,
    });
  }

  private async tryMarkApplySessionFailed(auth: AuthDto, session: AgentSession) {
    try {
      await this.sessionRepository.update(auth.user.id, session.id, {
        status: AgentSessionStatus.Failed,
        endedAt: new Date(),
      });
    } catch {
      // Preserve the original post-claim apply error.
    }
  }

  private validateApplyOperationIds(plan: AgentOperationPlanWithOperations, operationIds: string[]) {
    const operationById = new Map(plan.operations.map((operation) => [operation.id, operation]));

    if (operationIds.some((operationId) => !operationById.has(operationId))) {
      throw new BadRequestException('One or more operation ids are not in the current plan');
    }

    if (operationIds.some((operationId) => operationById.get(operationId)?.enabled === false)) {
      throw new BadRequestException('One or more operation ids are disabled in the current plan');
    }
  }

  private validateApplySelection(
    plan: AgentOperationPlanWithOperations,
    dto: AgentOperationPlanApplyRequestDto,
  ): ApplySelection {
    if (dto.planRevision !== undefined && dto.planRevision !== plan.revision) {
      throw new BadRequestException('Agent operation plan revision is stale');
    }

    this.validateApplyOperationIds(plan, dto.operationIds);

    const selectedOperationIds = new Set(dto.operationIds);
    const operationById = new Map(plan.operations.map((operation) => [operation.id, operation]));
    const selectedAssetIdsByOperationId = new Map<string, string[]>();
    const selectedItemIdsByOperationId = new Map<string, string[]>();

    for (const [operationId, selection] of Object.entries(dto.itemSelections ?? {})) {
      if (!selectedOperationIds.has(operationId)) {
        throw new BadRequestException('One or more item selection operation ids are not selected');
      }

      const operation = operationById.get(operationId);
      if (!operation) {
        throw new BadRequestException('One or more item selection operation ids are not in the current plan');
      }

      const selectedItemIds = this.resolveSelectedItemIds(operation, selection);
      selectedItemIdsByOperationId.set(operationId, selectedItemIds);
      if (selection.itemKind === 'asset') {
        selectedAssetIdsByOperationId.set(operationId, selectedItemIds);
      }
    }

    const fieldOverridesByOperationId = this.validateFieldOverrides(
      dto.fieldOverrides ?? {},
      operationById,
      selectedOperationIds,
      selectedAssetIdsByOperationId,
    );

    return {
      selectedOperationIds,
      selectedAssetIdsByOperationId,
      selectedItemIdsByOperationId,
      fieldOverridesByOperationId,
    };
  }

  private validateFieldOverrides(
    fieldOverrides: NonNullable<AgentOperationPlanApplyRequestDto['fieldOverrides']>,
    operationById: Map<string, AgentOperationPlanWithOperations['operations'][number]>,
    selectedOperationIds: Set<string>,
    selectedAssetIdsByOperationId: Map<string, string[]>,
  ): Map<string, AgentOperationFieldOverride> {
    const fieldOverridesByOperationId = new Map<string, AgentOperationFieldOverride>();

    for (const [operationId, fields] of Object.entries(fieldOverrides)) {
      const operation = operationById.get(operationId);
      if (!operation) {
        throw new BadRequestException('One or more field override operation ids are not in the current plan');
      }

      if (!selectedOperationIds.has(operationId)) {
        throw new BadRequestException('One or more field override operation ids are not selected');
      }

      fieldOverridesByOperationId.set(
        operationId,
        this.normalizeFieldOverride(operation, fields, selectedAssetIdsByOperationId.get(operationId)),
      );
    }

    return fieldOverridesByOperationId;
  }

  private normalizeFieldOverride(
    operation: AgentOperationPlanWithOperations['operations'][number],
    fields: Record<string, unknown>,
    selectedAssetIds: string[] | undefined,
  ): AgentOperationFieldOverride {
    switch (operation.type) {
      case AgentOperationType.AlbumCreate:
      case AgentOperationType.AlbumUpdateDetails: {
        const payload: AgentOperationFieldOverride['payload'] = {};
        let targetAlbumId: string | undefined;
        for (const [field, value] of Object.entries(fields)) {
          if (field === 'targetAlbumId') {
            if (operation.type === AgentOperationType.AlbumCreate) {
              throw new BadRequestException('Target overrides are not supported for create operations');
            }
            if (typeof value !== 'string') {
              throw new BadRequestException('targetAlbumId must be a string');
            }

            targetAlbumId = value;
            continue;
          }

          if (field !== 'albumName' && field !== 'description') {
            throw new BadRequestException('Unsupported field override for operation type');
          }

          payload[field] = this.normalizeAlbumTextOverride(field, value);
        }

        return { payload, targetAlbumId };
      }

      case AgentOperationType.AlbumDelete: {
        const fieldNames = Object.keys(fields);
        if (fieldNames.some((field) => field !== 'targetAlbumId')) {
          throw new BadRequestException('Unsupported field override for operation type');
        }
        const targetAlbumId = fields.targetAlbumId;
        if (typeof targetAlbumId !== 'string') {
          throw new BadRequestException('targetAlbumId must be a string');
        }
        return { targetAlbumId };
      }

      case AgentOperationType.AlbumAddAssets:
      case AgentOperationType.AlbumRemoveAssets: {
        const fieldNames = Object.keys(fields);
        if (fieldNames.some((field) => field !== 'targetAlbumId')) {
          throw new BadRequestException('Unsupported field override for operation type');
        }

        const targetAlbumId = fields.targetAlbumId;
        if (typeof targetAlbumId !== 'string') {
          throw new BadRequestException('targetAlbumId must be a string');
        }

        return { targetAlbumId };
      }

      case AgentOperationType.SpaceCreate:
      case AgentOperationType.SpaceUpdateDetails: {
        const payload: AgentOperationFieldOverride['payload'] = {};
        let targetSpaceId: string | undefined;
        for (const [field, value] of Object.entries(fields)) {
          if (field === 'targetSpaceId') {
            if (operation.type === AgentOperationType.SpaceCreate) {
              throw new BadRequestException('Target overrides are not supported for create operations');
            }
            if (typeof value !== 'string') {
              throw new BadRequestException('targetSpaceId must be a string');
            }
            targetSpaceId = value;
            continue;
          }

          if (field === 'color') {
            payload.color = this.normalizeSpaceColorOverride(value);
            continue;
          }

          if (field !== 'spaceName' && field !== 'description') {
            throw new BadRequestException('Unsupported field override for operation type');
          }

          payload[field] = this.normalizeSpaceTextOverride(field, value);
        }

        return { payload, targetSpaceId };
      }

      case AgentOperationType.SpaceDelete: {
        const fieldNames = Object.keys(fields);
        if (fieldNames.some((field) => field !== 'targetSpaceId')) {
          throw new BadRequestException('Unsupported field override for operation type');
        }
        const targetSpaceId = fields.targetSpaceId;
        if (typeof targetSpaceId !== 'string') {
          throw new BadRequestException('targetSpaceId must be a string');
        }
        return { targetSpaceId };
      }

      case AgentOperationType.SpaceAddAssets:
      case AgentOperationType.SpaceRemoveAssets: {
        const fieldNames = Object.keys(fields);
        if (fieldNames.some((field) => field !== 'targetSpaceId')) {
          throw new BadRequestException('Unsupported field override for operation type');
        }

        const targetSpaceId = fields.targetSpaceId;
        if (typeof targetSpaceId !== 'string') {
          throw new BadRequestException('targetSpaceId must be a string');
        }

        return { targetSpaceId };
      }

      case AgentOperationType.AssetRotate: {
        const fieldNames = Object.keys(fields);
        if (fieldNames.some((field) => field !== 'rotationAngle')) {
          throw new BadRequestException('Unsupported field override for operation type');
        }

        const rotationAngle =
          typeof fields.rotationAngle === 'string' ? Number(fields.rotationAngle) : fields.rotationAngle;
        if (rotationAngle !== 90 && rotationAngle !== 180 && rotationAngle !== 270) {
          throw new BadRequestException('rotationAngle must be 90, 180, or 270');
        }

        return { payload: { angle: rotationAngle } };
      }

      case AgentOperationType.AssetAdjust:
      case AgentOperationType.AssetFlip: {
        // v1 uses full revise (reviseProposedOperations), not inline field overrides
        throw new BadRequestException('Unsupported field override for operation type');
      }

      case AgentOperationType.AlbumSetCover: {
        const fieldNames = Object.keys(fields);
        if (fieldNames.some((field) => field !== 'albumThumbnailAssetId')) {
          throw new BadRequestException('Unsupported field override for operation type');
        }

        const albumThumbnailAssetId = fields.albumThumbnailAssetId;
        if (typeof albumThumbnailAssetId !== 'string') {
          throw new BadRequestException('albumThumbnailAssetId must be a string');
        }

        const selectedCoverCandidateIds = selectedAssetIds ?? [...new Set(operation.assetIds)];
        if (!selectedCoverCandidateIds.includes(albumThumbnailAssetId)) {
          throw new BadRequestException('albumThumbnailAssetId must be one of the selected cover candidates');
        }

        return { albumThumbnailAssetId };
      }

      default: {
        throw new BadRequestException('Unsupported field override for operation type');
      }
    }
  }

  private normalizeAlbumTextOverride(field: 'albumName' | 'description', value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string`);
    }

    const normalized = value.trim();
    if (field === 'albumName' && (normalized.length === 0 || normalized.length > 200)) {
      throw new BadRequestException('albumName must be 1-200 characters');
    }

    if (field === 'description' && normalized.length > 1000) {
      throw new BadRequestException('description must be 1000 characters or fewer');
    }

    return normalized;
  }

  private normalizeSpaceTextOverride(field: 'spaceName' | 'description', value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string`);
    }

    const normalized = value.trim();
    if (field === 'spaceName' && (normalized.length === 0 || normalized.length > 100)) {
      throw new BadRequestException('spaceName must be 1-100 characters');
    }

    if (field === 'description' && normalized.length > 500) {
      throw new BadRequestException('description must be 500 characters or fewer');
    }

    return normalized;
  }

  private normalizeSpaceColorOverride(value: unknown): UserAvatarColor {
    if (typeof value !== 'string' || !Object.values(UserAvatarColor).includes(value as UserAvatarColor)) {
      throw new BadRequestException('color must be a valid space color');
    }

    return value as UserAvatarColor;
  }

  private resolveSelectedItemIds(
    operation: AgentOperationPlanWithOperations['operations'][number],
    selection: SparseItemSelection,
  ): string[] {
    const affectedItemIds =
      selection.itemKind === 'asset' ? [...new Set(operation.assetIds)] : this.getOperationUserIds(operation);

    if (affectedItemIds.length === 0) {
      throw new BadRequestException('Item selection is not supported for one or more operations');
    }

    const affectedItemIdSet = new Set(affectedItemIds);
    const itemIds = selection.itemIds ?? [];

    if (itemIds.some((itemId) => !affectedItemIdSet.has(itemId))) {
      throw new BadRequestException('One or more selected item ids are not affected by the operation');
    }

    switch (selection.mode) {
      case 'all': {
        return affectedItemIds;
      }
      case 'allExcept': {
        const excludedItemIds = new Set(itemIds);
        return affectedItemIds.filter((itemId) => !excludedItemIds.has(itemId));
      }
      case 'only': {
        return affectedItemIds.filter((itemId) => itemIds.includes(itemId));
      }
      case 'none': {
        return [];
      }
    }
  }

  private async applyClaimedPlan(
    auth: AuthDto,
    session: AgentSession,
    plan: AgentOperationPlanWithOperations,
    applySelection: ApplySelection,
  ): Promise<AgentOperationApplyUpdate[]> {
    const {
      selectedOperationIds,
      selectedAssetIdsByOperationId,
      selectedItemIdsByOperationId,
      fieldOverridesByOperationId,
    } = applySelection;
    const appliedOperationIds = new Set<string>();
    const createdAlbumIdByTemporaryTargetId = new Map<string, string>();
    const createdSpaceIdByTemporaryTargetId = new Map<string, string>();
    const updates: AgentOperationApplyUpdate[] = [];
    const selectedTotal = selectedOperationIds.size;
    let appliedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    await this.emitApplyProgress(auth, session.id, {
      status: AgentSessionActivityEventStatus.Running,
      total: selectedTotal,
      applied: appliedCount,
      skipped: skippedCount,
      failed: failedCount,
    });

    for (const operation of plan.operations) {
      if (!selectedOperationIds.has(operation.id)) {
        updates.push(this.skippedOperation(operation.id, 'Operation was not selected for apply'));
        continue;
      }

      const selectedAssetIds = selectedAssetIdsByOperationId.get(operation.id);
      const selectedItemIds = selectedItemIdsByOperationId.get(operation.id);
      const fieldOverride = fieldOverridesByOperationId.get(operation.id);
      const operationForApply =
        selectedAssetIds === undefined && selectedItemIds === undefined && !fieldOverride
          ? operation
          : this.applyOperationOverrides(operation, selectedAssetIds, fieldOverride, plan.operations, selectedItemIds);

      const dependencyApplied = operationForApply.dependencyIds.every((dependencyId) =>
        appliedOperationIds.has(dependencyId),
      );
      if (!dependencyApplied) {
        updates.push(this.skippedOperation(operation.id, 'Dependency was not applied'));
        skippedCount++;
        await this.emitApplyProgress(auth, session.id, {
          status: AgentSessionActivityEventStatus.Running,
          total: selectedTotal,
          applied: appliedCount,
          skipped: skippedCount,
          failed: failedCount,
        });
        continue;
      }

      if (selectedItemIds?.length === 0) {
        updates.push(this.skippedOperation(operation.id, 'No selected items for operation'));
        skippedCount++;
        await this.emitApplyProgress(auth, session.id, {
          status: AgentSessionActivityEventStatus.Running,
          total: selectedTotal,
          applied: appliedCount,
          skipped: skippedCount,
          failed: failedCount,
        });
        continue;
      }

      try {
        await this.validateApplyAccess(auth, session, operationForApply);
        const update = await this.applySingleOperation(
          auth,
          operationForApply,
          createdAlbumIdByTemporaryTargetId,
          createdSpaceIdByTemporaryTargetId,
        );
        updates.push(update);
        if (update.status === AgentOperationStatus.Applied) {
          appliedOperationIds.add(operation.id);
          appliedCount++;
        } else {
          skippedCount++;
        }
        await this.emitApplyProgress(auth, session.id, {
          status: AgentSessionActivityEventStatus.Running,
          total: selectedTotal,
          applied: appliedCount,
          skipped: skippedCount,
          failed: failedCount,
        });
      } catch (error) {
        updates.push({
          id: operation.id,
          status: AgentOperationStatus.Failed,
          result: null,
          error: error instanceof Error ? error.message : 'Agent operation apply failed',
        });
        failedCount++;
        await this.emitApplyProgress(auth, session.id, {
          status: AgentSessionActivityEventStatus.Running,
          total: selectedTotal,
          applied: appliedCount,
          skipped: skippedCount,
          failed: failedCount,
        });
      }
    }

    await this.emitApplyProgress(auth, session.id, {
      status: failedCount > 0 ? AgentSessionActivityEventStatus.Failed : AgentSessionActivityEventStatus.Completed,
      total: selectedTotal,
      applied: appliedCount,
      skipped: skippedCount,
      failed: failedCount,
    });

    return updates;
  }

  private async emitApplyProgress(
    auth: AuthDto,
    sessionId: string,
    progress: {
      status: AgentSessionActivityEventStatus;
      total: number;
      applied: number;
      skipped: number;
      failed: number;
    },
  ) {
    try {
      await this.activityEventService?.createSystemEvent(auth.user.id, sessionId, {
        kind: AgentSessionActivityEventKind.ApplyProgress,
        status: progress.status,
        counts: {
          total: progress.total,
          applied: progress.applied,
          skipped: progress.skipped,
          failed: progress.failed,
        },
      });
    } catch {
      // Activity events are visibility hints and must not block applying approved changes.
    }
  }

  private applyOperationOverrides(
    operation: AgentOperationPlanWithOperations['operations'][number],
    selectedAssetIds: string[] | undefined,
    fieldOverride: AgentOperationFieldOverride | undefined,
    operations: AgentOperationPlanWithOperations['operations'],
    selectedItemIds?: string[],
  ): AgentOperationPlanWithOperations['operations'][number] {
    const originalPayload = this.requireObjectPayload(operation.payload);
    const overriddenOperation: AgentOperationPlanWithOperations['operations'][number] = {
      ...operation,
      assetIds: fieldOverride?.albumThumbnailAssetId
        ? [fieldOverride.albumThumbnailAssetId]
        : (selectedAssetIds ?? operation.assetIds),
      payload: fieldOverride?.payload
        ? { ...originalPayload, ...fieldOverride.payload }
        : this.applySelectedUserIdsToPayload(operation.type, originalPayload, selectedItemIds),
    };

    if (fieldOverride?.targetAlbumId) {
      return {
        ...overriddenOperation,
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: fieldOverride.targetAlbumId,
        temporaryTargetId: null,
        dependencyIds: this.retainNonTargetDependencies(operation, operations, AgentOperationType.AlbumCreate),
      };
    }

    if (fieldOverride?.targetSpaceId) {
      return {
        ...overriddenOperation,
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: fieldOverride.targetSpaceId,
        temporaryTargetId: null,
        dependencyIds: this.retainNonTargetDependencies(operation, operations, AgentOperationType.SpaceCreate),
      };
    }

    return overriddenOperation;
  }

  private retainNonTargetDependencies(
    operation: AgentOperationPlanWithOperations['operations'][number],
    operations: AgentOperationPlanWithOperations['operations'],
    createType: AgentOperationType.AlbumCreate | AgentOperationType.SpaceCreate,
  ) {
    if (!operation.temporaryTargetId || operation.dependencyIds.length === 0) {
      return operation.dependencyIds;
    }

    const operationById = new Map(operations.map((candidate) => [candidate.id, candidate]));
    return operation.dependencyIds.filter((dependencyId) => {
      const dependency = operationById.get(dependencyId);
      return dependency?.type !== createType || dependency.temporaryTargetId !== operation.temporaryTargetId;
    });
  }

  private applySelectedUserIdsToPayload(
    type: AgentOperationType,
    payload: Record<string, unknown>,
    selectedUserIds?: string[],
  ): Record<string, unknown> {
    if (selectedUserIds === undefined) {
      return payload;
    }

    const selectedUserIdSet = new Set(selectedUserIds);
    if (type === AgentOperationType.SpaceAddMembers) {
      const members = this.getMemberPayloads(payload).filter((member) => selectedUserIdSet.has(member.userId));
      return { ...payload, members };
    }

    if (type === AgentOperationType.SpaceRemoveMembers || type === AgentOperationType.SpaceUpdateMemberRole) {
      const userIds = this.getUserIdsPayload(payload).filter((userId) => selectedUserIdSet.has(userId));
      return { ...payload, userIds };
    }

    if (type === AgentOperationType.AlbumAddUsers) {
      const albumUsers = this.getAlbumUserPayloads(payload).filter((u) => selectedUserIdSet.has(u.userId));
      return { ...payload, albumUsers };
    }

    if (type === AgentOperationType.AlbumRemoveUsers) {
      const userIds = this.getUserIdsPayload(payload).filter((userId) => selectedUserIdSet.has(userId));
      return { ...payload, userIds };
    }

    return payload;
  }

  private getOperationUserIds(operation: { type: AgentOperationType; payload?: unknown }): string[] {
    if (operation.type === AgentOperationType.SpaceAddMembers) {
      return [...new Set(this.getMemberPayloads(operation.payload).map((member) => member.userId))];
    }

    if (
      operation.type === AgentOperationType.SpaceRemoveMembers ||
      operation.type === AgentOperationType.SpaceUpdateMemberRole
    ) {
      return [...new Set(this.getUserIdsPayload(operation.payload))];
    }

    if (operation.type === AgentOperationType.AlbumAddUsers) {
      return [...new Set(this.getAlbumUserPayloads(operation.payload).map((u) => u.userId))];
    }

    if (operation.type === AgentOperationType.AlbumRemoveUsers) {
      return [...new Set(this.getUserIdsPayload(operation.payload))];
    }

    if (operation.type === AgentOperationType.AlbumUpdateUserRole) {
      const objectPayload = this.requireObjectPayload(operation.payload);
      return typeof objectPayload.userId === 'string' ? [objectPayload.userId] : [];
    }

    return [];
  }

  private async validateApplyAccess(
    auth: AuthDto,
    session: AgentSession,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ) {
    this.validateWriteScope(session, operation.type);
    await this.validateNormalAccess(auth, session, [
      {
        type: operation.type,
        summary: operation.summary,
        targetKind: operation.targetKind,
        targetId: operation.targetId ?? undefined,
        temporaryTargetId: operation.temporaryTargetId ?? undefined,
        assetIds: operation.assetIds,
        payload: operation.payload,
        riskLevel: operation.riskLevel,
        enabled: operation.enabled,
      },
    ]);
  }

  private async applySingleOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
    createdAlbumIdByTemporaryTargetId: Map<string, string>,
    createdSpaceIdByTemporaryTargetId: Map<string, string>,
  ): Promise<AgentOperationApplyUpdate> {
    switch (operation.type) {
      case AgentOperationType.AlbumCreate: {
        const payload = this.requireAlbumPayload(operation.payload, operation.summary);
        if (!payload.albumName) {
          throw new BadRequestException('album.create requires albumName');
        }

        const album = await this.albumService.create(auth, {
          albumName: payload.albumName,
          description: payload.description ?? '',
          assetIds: [],
        });
        if (operation.temporaryTargetId) {
          createdAlbumIdByTemporaryTargetId.set(operation.temporaryTargetId, album.id);
        }

        return this.appliedOperation(operation.id, { albumId: album.id });
      }

      case AgentOperationType.AlbumAddAssets: {
        const albumId = this.resolveTargetAlbumId(operation, createdAlbumIdByTemporaryTargetId);
        const results = await this.albumService.addAssets(auth, albumId, { ids: operation.assetIds });
        const successfulAssetIds = results.filter((result) => result.success).map((result) => result.id);
        const failedAssetCount = results.length - successfulAssetIds.length;

        if (failedAssetCount > 0) {
          return {
            id: operation.id,
            status: AgentOperationStatus.Failed,
            result: this.assetResult(albumId, successfulAssetIds, results),
            error: `Failed to add ${failedAssetCount} asset(s)`,
          };
        }

        return this.appliedOperation(operation.id, this.assetResult(albumId, successfulAssetIds, results));
      }

      case AgentOperationType.AlbumRemoveAssets: {
        const albumId = this.resolveTargetAlbumId(operation, createdAlbumIdByTemporaryTargetId);
        const results = await this.albumService.removeAssets(auth, albumId, { ids: operation.assetIds });
        return this.bulkAssetOperationResult(operation.id, { albumId }, 'remove', results);
      }

      case AgentOperationType.AlbumUpdateDetails: {
        const payload = this.requireAlbumPayload(operation.payload, operation.summary);
        const albumId = this.resolveTargetAlbumId(operation, createdAlbumIdByTemporaryTargetId);
        const album = await this.albumService.update(auth, albumId, {
          albumName: payload.albumName,
          description: payload.description,
        });

        return this.appliedOperation(operation.id, { albumId: album.id });
      }

      case AgentOperationType.AlbumSetCover: {
        const albumId = this.resolveTargetAlbumId(operation, createdAlbumIdByTemporaryTargetId);
        const [albumThumbnailAssetId] = operation.assetIds;
        if (!albumThumbnailAssetId) {
          throw new BadRequestException('album.setCover requires one asset id');
        }

        const album = await this.albumService.update(auth, albumId, { albumThumbnailAssetId });
        return this.appliedOperation(operation.id, { albumId: album.id, assetIds: [albumThumbnailAssetId] });
      }

      case AgentOperationType.AlbumAddUsers: {
        const albumId = this.resolveTargetAlbumId(operation, createdAlbumIdByTemporaryTargetId);
        const albumUsers = this.getAlbumUserPayloads(operation.payload);
        await this.albumService.addUsers(auth, albumId, { albumUsers });
        return this.appliedOperation(operation.id, { albumId, userIds: albumUsers.map((u) => u.userId) });
      }

      case AgentOperationType.AlbumRemoveUsers: {
        const albumId = this.resolveTargetAlbumId(operation, createdAlbumIdByTemporaryTargetId);
        const userIds = this.getUserIdsPayload(operation.payload);
        for (const userId of userIds) {
          await this.albumService.removeUser(auth, albumId, userId);
        }
        return this.appliedOperation(operation.id, { albumId, userIds });
      }

      case AgentOperationType.AlbumUpdateUserRole: {
        const albumId = this.resolveTargetAlbumId(operation, createdAlbumIdByTemporaryTargetId);
        const objectPayload = this.requireObjectPayload(operation.payload);
        const userId = objectPayload.userId;
        const role = objectPayload.role;
        if (typeof userId !== 'string') {
          throw new BadRequestException('album.updateUserRole requires userId');
        }
        if (typeof role !== 'string') {
          throw new BadRequestException('album.updateUserRole requires role');
        }
        await this.albumService.updateUser(auth, albumId, userId, { role: role as AlbumUserRole });
        return this.appliedOperation(operation.id, { albumId, userIds: [userId] });
      }

      case AgentOperationType.AlbumDelete: {
        const albumId = this.resolveTargetAlbumId(operation, createdAlbumIdByTemporaryTargetId);
        await this.albumService.delete(auth, albumId);
        return this.appliedOperation(operation.id, { albumId });
      }

      case AgentOperationType.SpaceCreate: {
        const payload = this.requireSpacePayload(operation.payload, operation.summary);
        if (!payload.spaceName) {
          throw new BadRequestException('space.create requires spaceName');
        }

        const dto: { name: string; description?: string; color?: UserAvatarColor } = { name: payload.spaceName };
        if (payload.description !== undefined) {
          dto.description = payload.description;
        }
        if (payload.color !== undefined) {
          dto.color = payload.color;
        }

        const space = await this.sharedSpaceService.create(auth, dto);
        if (operation.temporaryTargetId) {
          createdSpaceIdByTemporaryTargetId.set(operation.temporaryTargetId, space.id);
        }

        return this.appliedOperation(operation.id, { spaceId: space.id });
      }

      case AgentOperationType.SpaceAddAssets: {
        const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
        await this.sharedSpaceService.addAssets(auth, spaceId, { assetIds: operation.assetIds });
        return this.appliedOperation(operation.id, { spaceId, assetIds: operation.assetIds });
      }

      case AgentOperationType.SpaceRemoveAssets: {
        const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
        await this.sharedSpaceService.removeAssets(auth, spaceId, { assetIds: operation.assetIds });
        return this.appliedOperation(operation.id, { spaceId, assetIds: operation.assetIds });
      }

      case AgentOperationType.SpaceUpdateDetails: {
        const payload = this.requireSpaceUpdateDetailsPayload(operation.payload, operation.summary);
        const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
        const dto: { name?: string; description?: string; color?: UserAvatarColor } = {};
        if (payload.spaceName !== undefined) {
          dto.name = payload.spaceName;
        }
        if (payload.description !== undefined) {
          dto.description = payload.description;
        }
        if (payload.color !== undefined) {
          dto.color = payload.color;
        }

        const space = await this.sharedSpaceService.update(auth, spaceId, dto);

        return this.appliedOperation(operation.id, { spaceId: space.id });
      }

      case AgentOperationType.SpaceAddMembers: {
        const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
        const members = this.getMemberPayloads(operation.payload);
        const currentMembers = await this.sharedSpaceService.getMembers(auth, spaceId);
        const currentMemberIds = new Set(currentMembers.map((member) => member.userId));
        const appliedUserIds: string[] = [];
        const skippedUserIds: string[] = [];

        for (const member of members) {
          if (currentMemberIds.has(member.userId)) {
            skippedUserIds.push(member.userId);
            continue;
          }

          await this.sharedSpaceService.addMember(auth, spaceId, { userId: member.userId, role: member.role });
          currentMemberIds.add(member.userId);
          appliedUserIds.push(member.userId);
        }

        return this.appliedOperation(operation.id, { spaceId, userIds: appliedUserIds, skippedUserIds });
      }

      case AgentOperationType.SpaceRemoveMembers: {
        const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
        const userIds = this.getUserIdsPayload(operation.payload);
        const currentMembers = await this.sharedSpaceService.getMembers(auth, spaceId);
        this.assertSafeMemberRemovalOrRoleUpdate(auth.user.id, userIds, currentMembers);
        const currentMemberIds = new Set(currentMembers.map((member) => member.userId));
        const appliedUserIds: string[] = [];
        const skippedUserIds: string[] = [];

        for (const userId of userIds) {
          if (!currentMemberIds.has(userId)) {
            skippedUserIds.push(userId);
            continue;
          }

          await this.sharedSpaceService.removeMember(auth, spaceId, userId);
          currentMemberIds.delete(userId);
          appliedUserIds.push(userId);
        }

        return this.appliedOperation(operation.id, { spaceId, userIds: appliedUserIds, skippedUserIds });
      }

      case AgentOperationType.SpaceUpdateMemberRole: {
        const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
        const payload = this.requireMemberRolePayload(operation.payload);
        const currentMembers = await this.sharedSpaceService.getMembers(auth, spaceId);
        this.assertSafeMemberRemovalOrRoleUpdate(auth.user.id, payload.userIds, currentMembers);
        const currentMemberRoleById = new Map(currentMembers.map((member) => [member.userId, member.role]));
        const appliedUserIds: string[] = [];
        const skippedUserIds: string[] = [];

        for (const userId of payload.userIds) {
          const currentRole = currentMemberRoleById.get(userId);
          if (!currentRole || currentRole === payload.role) {
            skippedUserIds.push(userId);
            continue;
          }

          await this.sharedSpaceService.updateMember(auth, spaceId, userId, { role: payload.role });
          currentMemberRoleById.set(userId, payload.role);
          appliedUserIds.push(userId);
        }

        return this.appliedOperation(operation.id, { spaceId, userIds: appliedUserIds, skippedUserIds });
      }

      case AgentOperationType.SpaceDelete: {
        const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
        await this.sharedSpaceService.remove(auth, spaceId);
        return this.appliedOperation(operation.id, { spaceId });
      }

      case AgentOperationType.AssetSetFavorite: {
        const payload = this.requireBooleanPayload(operation.payload, 'favorite');
        await this.assetService.updateAll(auth, { ids: operation.assetIds, isFavorite: payload.favorite });
        return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
      }

      case AgentOperationType.AssetSetArchive: {
        const payload = this.requireBooleanPayload(operation.payload, 'archived');
        await this.assetService.updateAll(auth, {
          ids: operation.assetIds,
          visibility: payload.archived ? AssetVisibility.Archive : AssetVisibility.Timeline,
        });
        return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
      }

      case AgentOperationType.AssetSetVisibility: {
        await this.assetService.updateAll(auth, { ids: operation.assetIds, visibility: AssetVisibility.Locked });
        return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
      }

      case AgentOperationType.AssetUpdateMetadata: {
        const payload = this.requireAssetUpdateMetadataPayload(operation.payload, operation.summary);
        await this.assetService.updateAll(auth, { ids: operation.assetIds, ...payload });
        return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
      }

      case AgentOperationType.AssetAddTag: {
        const payload = this.requireTagPayload(operation.payload);
        const tagId = payload.tagId ?? (await this.upsertTag(auth, payload.tagName));
        const results = await this.tagService.addAssets(auth, tagId, { ids: operation.assetIds });
        return this.bulkAssetOperationResult(operation.id, { tagId }, 'tag', results);
      }

      case AgentOperationType.AssetRemoveTag: {
        const payload = this.requireTagPayload(operation.payload);
        if (!payload.tagId) {
          throw new BadRequestException('asset.removeTag requires tagId');
        }

        const results = await this.tagService.removeAssets(auth, payload.tagId, { ids: operation.assetIds });
        return this.bulkAssetOperationResult(operation.id, { tagId: payload.tagId }, 'untag', results);
      }

      case AgentOperationType.AssetRotate: {
        return this.applyRotateOperation(auth, operation);
      }

      case AgentOperationType.AssetCrop: {
        return this.applyCropOperation(auth, operation);
      }

      case AgentOperationType.AssetAdjust: {
        return this.applyAdjustOperation(auth, operation);
      }

      case AgentOperationType.AssetFlip: {
        return this.applyFlipOperation(auth, operation);
      }

      case AgentOperationType.AssetTrash: {
        await this.assetService.deleteAll(auth, { ids: operation.assetIds, force: false });
        return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
      }

      case AgentOperationType.AssetRestore: {
        await this.trashService.restoreAssets(auth, { ids: operation.assetIds });
        return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
      }

      case AgentOperationType.AssetStack: {
        return this.applyStackOperation(auth, operation);
      }

      case AgentOperationType.AssetUnstack: {
        return this.applyUnstackOperation(auth, operation);
      }

      case AgentOperationType.ShareLinkCreate: {
        return this.applyShareLinkCreateOperation(auth, operation);
      }

      case AgentOperationType.ShareLinkCreateAlbum: {
        return this.applyShareLinkCreateAlbumOperation(auth, operation);
      }

      case AgentOperationType.PersonUpdate: {
        return this.applyPersonUpdateOperation(auth, operation);
      }

      case AgentOperationType.PersonMerge: {
        return this.applyPersonMergeOperation(auth, operation);
      }

      default: {
        throw new BadRequestException(`${operation.type} is not supported for apply yet`);
      }
    }
  }

  private skippedOperation(id: string, skippedReason: string): AgentOperationApplyUpdate {
    return {
      id,
      status: AgentOperationStatus.Skipped,
      result: { skippedReason },
      error: null,
    };
  }

  private appliedOperation(id: string, result: AgentOperationResult): AgentOperationApplyUpdate {
    return {
      id,
      status: AgentOperationStatus.Applied,
      result,
      error: null,
    };
  }

  private assetResult(albumId: string, assetIds: string[], assetResults: BulkIdResponseDto[]): AgentOperationResult {
    return {
      albumId,
      assetIds,
      assetResults: assetResults.map(({ id, success, error, errorMessage }) => ({ id, success, error, errorMessage })),
    };
  }

  private bulkAssetOperationResult(
    id: string,
    target: { albumId?: string; tagId?: string },
    verb: string,
    results: BulkIdResponseDto[],
  ): AgentOperationApplyUpdate {
    const successfulAssetIds = results.filter((result) => result.success).map((result) => result.id);
    const failedAssetCount = results.length - successfulAssetIds.length;
    const result = {
      ...target,
      assetIds: successfulAssetIds,
      assetResults: results.map(({ id, success, error, errorMessage }) => ({ id, success, error, errorMessage })),
    };

    if (failedAssetCount > 0) {
      return {
        id,
        status: AgentOperationStatus.Failed,
        result,
        error: `Failed to ${verb} ${failedAssetCount} asset(s)`,
      };
    }

    return this.appliedOperation(id, result);
  }

  private resolveTargetAlbumId(
    operation: AgentOperationPlanWithOperations['operations'][number],
    createdAlbumIdByTemporaryTargetId: Map<string, string>,
  ) {
    if (operation.targetId) {
      return operation.targetId;
    }

    if (operation.temporaryTargetId) {
      const albumId = createdAlbumIdByTemporaryTargetId.get(operation.temporaryTargetId);
      if (albumId) {
        return albumId;
      }
    }

    throw new BadRequestException(`No applied album exists for operation ${operation.id}`);
  }

  private resolveTargetSpaceId(
    operation: AgentOperationPlanWithOperations['operations'][number],
    createdSpaceIdByTemporaryTargetId: Map<string, string>,
  ) {
    if (operation.targetId) {
      return operation.targetId;
    }

    if (operation.temporaryTargetId) {
      const spaceId = createdSpaceIdByTemporaryTargetId.get(operation.temporaryTargetId);
      if (spaceId) {
        return spaceId;
      }
    }

    throw new BadRequestException(`No applied space exists for operation ${operation.id}`);
  }

  private requireAlbumPayload(payload: unknown, summary: string): { albumName?: string; description?: string } {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException(`Invalid album payload for ${summary}`);
    }

    const { albumName, description } = payload as { albumName?: unknown; description?: unknown };
    return {
      albumName: typeof albumName === 'string' ? albumName : undefined,
      description: typeof description === 'string' ? description : undefined,
    };
  }

  private requireSpacePayload(
    payload: unknown,
    summary: string,
  ): { spaceName?: string; description?: string; color?: UserAvatarColor } {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException(`Invalid space payload for ${summary}`);
    }

    const { spaceName, description, color } = payload as {
      spaceName?: unknown;
      description?: unknown;
      color?: unknown;
    };
    const normalizedSpaceName = typeof spaceName === 'string' ? spaceName.trim() : undefined;
    const normalizedDescription = typeof description === 'string' ? description : undefined;
    if (normalizedSpaceName !== undefined && (normalizedSpaceName.length === 0 || normalizedSpaceName.length > 100)) {
      throw new BadRequestException(`Invalid space payload for ${summary}`);
    }
    if (normalizedDescription !== undefined && normalizedDescription.length > 500) {
      throw new BadRequestException(`Invalid space payload for ${summary}`);
    }
    if (color !== undefined && !Object.values(UserAvatarColor).includes(color as UserAvatarColor)) {
      throw new BadRequestException(`Invalid space payload for ${summary}`);
    }

    return {
      spaceName: normalizedSpaceName,
      description: normalizedDescription,
      color: color as UserAvatarColor | undefined,
    };
  }

  private requireSpaceUpdateDetailsPayload(
    payload: unknown,
    summary: string,
  ): { spaceName?: string; description?: string; color?: UserAvatarColor } {
    const objectPayload = this.requireObjectPayload(payload);
    const unsupportedFields = Object.keys(objectPayload).filter(
      (field) => field !== 'spaceName' && field !== 'description' && field !== 'color',
    );
    if (unsupportedFields.length > 0) {
      throw new BadRequestException(`Invalid space payload for ${summary}`);
    }

    const updatePayload = this.requireSpacePayload(payload, summary);
    if (
      updatePayload.spaceName === undefined &&
      updatePayload.description === undefined &&
      updatePayload.color === undefined
    ) {
      throw new BadRequestException(`Invalid space payload for ${summary}`);
    }

    return updatePayload;
  }

  private requireBooleanPayload(
    payload: unknown,
    key: 'favorite' | 'archived',
  ): { favorite?: boolean; archived?: boolean } {
    const objectPayload = this.requireObjectPayload(payload);
    const value = objectPayload[key];
    if (typeof value !== 'boolean') {
      throw new BadRequestException(`asset operation requires boolean ${key}`);
    }

    return { [key]: value };
  }

  private requireTagPayload(payload: unknown): { tagId?: string; tagName?: string } {
    const objectPayload = this.requireObjectPayload(payload);
    return {
      tagId: typeof objectPayload.tagId === 'string' ? objectPayload.tagId : undefined,
      tagName: typeof objectPayload.tagName === 'string' ? objectPayload.tagName : undefined,
    };
  }

  private getMemberPayloads(
    payload: unknown,
  ): Array<{ userId: string; role: SharedSpaceRole.Editor | SharedSpaceRole.Viewer }> {
    const objectPayload = this.requireObjectPayload(payload);
    return Array.isArray(objectPayload.members)
      ? objectPayload.members
          .filter((member): member is { userId: string; role: SharedSpaceRole.Editor | SharedSpaceRole.Viewer } => {
            if (!member || typeof member !== 'object' || Array.isArray(member)) {
              return false;
            }

            const candidate = member as Record<string, unknown>;
            return (
              typeof candidate.userId === 'string' &&
              (candidate.role === SharedSpaceRole.Editor || candidate.role === SharedSpaceRole.Viewer)
            );
          })
          .map((member) => ({ userId: member.userId, role: member.role }))
      : [];
  }

  private getUserIdsPayload(payload: unknown): string[] {
    const objectPayload = this.requireObjectPayload(payload);
    return Array.isArray(objectPayload.userIds)
      ? objectPayload.userIds.filter((userId): userId is string => typeof userId === 'string')
      : [];
  }

  private getAlbumUserPayloads(
    payload: unknown,
  ): Array<{ userId: string; role: AlbumUserRole.Editor | AlbumUserRole.Viewer }> {
    const objectPayload = this.requireObjectPayload(payload);
    return Array.isArray(objectPayload.albumUsers)
      ? objectPayload.albumUsers
          .filter((u): u is { userId: string; role: AlbumUserRole.Editor | AlbumUserRole.Viewer } => {
            if (!u || typeof u !== 'object' || Array.isArray(u)) {
              return false;
            }
            const candidate = u as Record<string, unknown>;
            return (
              typeof candidate.userId === 'string' &&
              (candidate.role === AlbumUserRole.Editor || candidate.role === AlbumUserRole.Viewer)
            );
          })
          .map((u) => ({ userId: u.userId, role: u.role }))
      : [];
  }

  private requireMemberRolePayload(payload: unknown): {
    userIds: string[];
    role: SharedSpaceRole.Editor | SharedSpaceRole.Viewer;
  } {
    const objectPayload = this.requireObjectPayload(payload);
    if (objectPayload.role !== SharedSpaceRole.Editor && objectPayload.role !== SharedSpaceRole.Viewer) {
      throw new BadRequestException('space.updateMemberRole requires viewer or editor role');
    }

    return {
      userIds: this.getUserIdsPayload(payload),
      role: objectPayload.role,
    };
  }

  private assertSafeMemberRemovalOrRoleUpdate(
    currentUserId: string,
    userIds: string[],
    currentMembers: Array<{ userId: string; role: string }>,
  ) {
    if (userIds.includes(currentUserId)) {
      throw new BadRequestException('Pi cannot remove or change your own space membership');
    }

    const currentMemberRoleById = new Map(currentMembers.map((member) => [member.userId, member.role]));
    const ownerIds = currentMembers
      .filter((member) => member.role === SharedSpaceRole.Owner)
      .map((member) => member.userId);
    const affectedOwnerIds = userIds.filter((userId) => currentMemberRoleById.get(userId) === SharedSpaceRole.Owner);
    const demotesOrRemovesOwners = affectedOwnerIds.length > 0;

    if (demotesOrRemovesOwners && ownerIds.length - affectedOwnerIds.length < 1) {
      throw new BadRequestException('Pi cannot remove or demote the last owner of a space');
    }
  }

  private async upsertTag(auth: AuthDto, tagName: string | undefined) {
    if (!tagName) {
      throw new BadRequestException('asset.addTag requires tagId or tagName');
    }

    const [tag] = await this.tagService.upsert(auth, { tags: [tagName] });
    if (!tag) {
      throw new BadRequestException('Tag upsert did not return a tag');
    }

    return tag.id;
  }

  private async applyRotateOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ): Promise<AgentOperationApplyUpdate> {
    const angle = this.requireRotationPayload(operation.payload);
    const assetResults: BulkIdResponseDto[] = [];
    const successfulAssetIds: string[] = [];

    for (const assetId of operation.assetIds) {
      try {
        const editableAsset = await this.assetRepository.getForEdit(assetId);
        if (!editableAsset) {
          throw new BadRequestException('Asset not found');
        }
        if (editableAsset.type !== AssetType.Image) {
          throw new BadRequestException('Only images can be edited');
        }

        const { edits } = await this.assetService.getAssetEdits(auth, assetId);
        const mergedEdits = this.mergeRotationEdits(
          edits.map(({ action, parameters }) => ({ action, parameters }) as AssetEditActionItem),
          angle,
        );
        await (mergedEdits.length === 0
          ? this.assetService.removeAssetEdits(auth, assetId)
          : this.assetService.editAsset(auth, assetId, { edits: mergedEdits }));

        successfulAssetIds.push(assetId);
        assetResults.push({ id: assetId, success: true });
      } catch (error) {
        assetResults.push({
          id: assetId,
          success: false,
          errorMessage: error instanceof Error ? error.message : 'Failed to rotate asset',
        });
      }
    }

    const failedAssetCount = assetResults.length - successfulAssetIds.length;
    const result = {
      assetIds: successfulAssetIds,
      assetResults: assetResults.map(({ id, success, error, errorMessage }) => ({ id, success, error, errorMessage })),
    };

    if (failedAssetCount > 0) {
      return {
        id: operation.id,
        status: AgentOperationStatus.Failed,
        result,
        error: `Failed to rotate ${failedAssetCount} asset(s)`,
      };
    }

    return this.appliedOperation(operation.id, result);
  }

  private requireRotationPayload(payload: unknown): 90 | 180 | 270 {
    const objectPayload = this.requireObjectPayload(payload);
    const angle = objectPayload.angle;
    if (angle !== 90 && angle !== 180 && angle !== 270) {
      throw new BadRequestException('asset.rotate requires angle 90, 180, or 270');
    }

    return angle;
  }

  private async applyCropOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ): Promise<AgentOperationApplyUpdate> {
    const cropParams = this.requireCropPayload(operation.payload);
    const assetResults: BulkIdResponseDto[] = [];
    const successfulAssetIds: string[] = [];

    for (const assetId of operation.assetIds) {
      try {
        const editableAsset = await this.assetRepository.getForEdit(assetId);
        if (!editableAsset) {
          throw new BadRequestException('Asset not found');
        }
        if (editableAsset.type !== AssetType.Image) {
          throw new BadRequestException('Only images can be edited');
        }

        const { edits } = await this.assetService.getAssetEdits(auth, assetId);
        // Crop must be first; replace any existing Crop edit, keep all others after it
        const mergedEdits = this.mergeCropEdits(
          edits.map(({ action, parameters }) => ({ action, parameters }) as AssetEditActionItem),
          cropParams,
        );
        await this.assetService.editAsset(auth, assetId, { edits: mergedEdits });

        successfulAssetIds.push(assetId);
        assetResults.push({ id: assetId, success: true });
      } catch (error) {
        assetResults.push({
          id: assetId,
          success: false,
          errorMessage: error instanceof Error ? error.message : 'Failed to crop asset',
        });
      }
    }

    const failedAssetCount = assetResults.length - successfulAssetIds.length;
    const result = {
      assetIds: successfulAssetIds,
      assetResults: assetResults.map(({ id, success, error, errorMessage }) => ({ id, success, error, errorMessage })),
    };

    if (failedAssetCount > 0) {
      return {
        id: operation.id,
        status: AgentOperationStatus.Failed,
        result,
        error: `Failed to crop ${failedAssetCount} asset(s)`,
      };
    }

    return this.appliedOperation(operation.id, result);
  }

  private requireAdjustPayload(payload: unknown): AdjustParameters {
    const p = this.requireObjectPayload(payload) as AdjustParameters;
    return p;
  }

  private async applyImageEditOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
    edit: AssetEditActionItem,
    verb: string,
  ): Promise<AgentOperationApplyUpdate> {
    const assetResults: BulkIdResponseDto[] = [];
    const successfulAssetIds: string[] = [];

    for (const assetId of operation.assetIds) {
      try {
        const editableAsset = await this.assetRepository.getForEdit(assetId);
        if (!editableAsset) {
          throw new BadRequestException('Asset not found');
        }
        if (editableAsset.type !== AssetType.Image) {
          throw new BadRequestException('Only images can be edited');
        }

        const { edits } = await this.assetService.getAssetEdits(auth, assetId);
        const mergedEdits = mergeEdits(
          edits.map(({ action, parameters }) => ({ action, parameters }) as AssetEditActionItem),
          [edit],
        );
        await this.assetService.editAsset(auth, assetId, { edits: mergedEdits });

        successfulAssetIds.push(assetId);
        assetResults.push({ id: assetId, success: true });
      } catch (error) {
        assetResults.push({
          id: assetId,
          success: false,
          errorMessage: error instanceof Error ? error.message : `Failed to ${verb} asset`,
        });
      }
    }

    const failedAssetCount = assetResults.length - successfulAssetIds.length;
    const result = {
      assetIds: successfulAssetIds,
      assetResults: assetResults.map(({ id, success, error, errorMessage }) => ({ id, success, error, errorMessage })),
    };

    if (failedAssetCount > 0) {
      return {
        id: operation.id,
        status: AgentOperationStatus.Failed,
        result,
        error: `Failed to ${verb} ${failedAssetCount} asset(s)`,
      };
    }

    return this.appliedOperation(operation.id, result);
  }

  private async applyAdjustOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ): Promise<AgentOperationApplyUpdate> {
    const params = this.requireAdjustPayload(operation.payload);
    return this.applyImageEditOperation(
      auth,
      operation,
      { action: AssetEditAction.Adjust, parameters: params },
      'adjust',
    );
  }

  private async applyFlipOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ): Promise<AgentOperationApplyUpdate> {
    const payload = this.requireObjectPayload(operation.payload) as { axis: MirrorAxis };
    return this.applyImageEditOperation(
      auth,
      operation,
      { action: AssetEditAction.Mirror, parameters: { axis: payload.axis } },
      'flip',
    );
  }

  private async applyShareLinkCreateOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ): Promise<AgentOperationApplyUpdate> {
    const payload = this.requireObjectPayload(operation.payload) as {
      password?: string;
      expiresAt?: string;
      showMetadata?: boolean;
      allowDownload?: boolean;
    };

    await this.sharedLinkService.create(auth, {
      type: SharedLinkType.Individual,
      assetIds: operation.assetIds,
      password: payload.password,
      expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : undefined,
      showMetadata: payload.showMetadata,
      allowDownload: payload.allowDownload,
    });

    return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
  }

  private async applyShareLinkCreateAlbumOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ): Promise<AgentOperationApplyUpdate> {
    const payload = this.requireObjectPayload(operation.payload) as {
      password?: string;
      expiresAt?: string;
      showMetadata?: boolean;
      allowDownload?: boolean;
    };

    await this.sharedLinkService.create(auth, {
      type: SharedLinkType.Album,
      albumId: operation.targetId ?? undefined,
      password: payload.password,
      expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : undefined,
      showMetadata: payload.showMetadata,
      allowDownload: payload.allowDownload,
    });

    return this.appliedOperation(operation.id, { albumId: operation.targetId ?? undefined });
  }

  private async applyPersonUpdateOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ): Promise<AgentOperationApplyUpdate> {
    const payload = this.requireObjectPayload(operation.payload) as {
      name?: string;
      birthDate?: string | null;
      isHidden?: boolean;
    };

    const personId = operation.targetId;
    if (!personId) {
      throw new BadRequestException('person.update requires a targetId (person id)');
    }

    await this.personService.update(auth, personId, {
      name: payload.name,
      birthDate: payload.birthDate,
      isHidden: payload.isHidden,
    });

    return this.appliedOperation(operation.id, { personId });
  }

  private async applyPersonMergeOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ): Promise<AgentOperationApplyUpdate> {
    const payload = this.requireObjectPayload(operation.payload) as { sourcePersonIds: string[] };

    const personId = operation.targetId;
    if (!personId) {
      throw new BadRequestException('person.merge requires a targetId (keep person id)');
    }

    await this.personService.mergePerson(auth, personId, { ids: payload.sourcePersonIds });

    return this.appliedOperation(operation.id, { personId });
  }

  private async applyStackOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ): Promise<AgentOperationApplyUpdate> {
    // Primary = favorite > rating(desc, nulls last) > newest(fileCreatedAt desc) > id
    const assets = await this.assetRepository.getAgentMetadataByIds(operation.assetIds);

    const sorted = assets.toSorted((a, b) => {
      // favorite first
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }
      // rating desc, nulls last
      const ra = a.exifInfo?.rating ?? null;
      const rb = b.exifInfo?.rating ?? null;
      if (ra !== rb) {
        if (ra === null) {
          return 1;
        }
        if (rb === null) {
          return -1;
        }
        return rb - ra;
      }
      // newest first (fileCreatedAt desc)
      const ta = a.fileCreatedAt ? new Date(a.fileCreatedAt).getTime() : 0;
      const tb = b.fileCreatedAt ? new Date(b.fileCreatedAt).getTime() : 0;
      if (ta !== tb) {
        return tb - ta;
      }
      // tie-break by id
      return a.id < b.id ? -1 : 1;
    });

    if (sorted.length === 0) {
      return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
    }

    const orderedIds = sorted.map((a) => a.id);

    try {
      await this.stackService.create(auth, { assetIds: orderedIds });
      return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
    } catch (error) {
      return {
        id: operation.id,
        status: AgentOperationStatus.Failed,
        result: { assetIds: operation.assetIds },
        error: error instanceof Error ? error.message : 'Failed to create stack',
      };
    }
  }

  private async applyUnstackOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ): Promise<AgentOperationApplyUpdate> {
    // Resolve distinct non-null stackIds from the assets
    const assets = await this.assetRepository.getByIds(operation.assetIds);
    const stackIds = [
      ...new Set(assets.map((a) => a.stackId).filter((id): id is string => id !== null && id !== undefined)),
    ];

    if (stackIds.length === 0) {
      // No stacks to dissolve — no-op, disclosed
      return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
    }

    try {
      await this.stackService.deleteAll(auth, { ids: stackIds });
      return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
    } catch (error) {
      return {
        id: operation.id,
        status: AgentOperationStatus.Failed,
        result: { assetIds: operation.assetIds },
        error: error instanceof Error ? error.message : 'Failed to delete stacks',
      };
    }
  }

  private requireCropPayload(payload: unknown): CropParameters {
    const objectPayload = this.requireObjectPayload(payload);
    const { x, y, width, height } = objectPayload as Record<string, unknown>;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      x < 0 ||
      y < 0 ||
      width < 1 ||
      height < 1
    ) {
      throw new BadRequestException('asset.crop requires valid x, y, width, height');
    }

    return { x, y, width, height };
  }

  private mergeCropEdits(edits: AssetEditActionItem[], cropParams: CropParameters): AssetEditActionItem[] {
    // Crop must always be first; replace any existing Crop, keep non-Crop edits after it
    const nonCropEdits = edits.filter((edit) => edit.action !== AssetEditAction.Crop);
    return [{ action: AssetEditAction.Crop, parameters: cropParams }, ...nonCropEdits];
  }

  private requireAssetUpdateMetadataPayload(payload: unknown, summary: string): AssetUpdateMetadataApplyPayload {
    const objectPayload = this.requireObjectPayload(payload);
    const supportedKeys = new Set<string>(assetUpdateMetadataApplyPayloadKeys);
    const suppliedKeys = Object.keys(objectPayload).filter((key) => objectPayload[key] !== undefined);
    const invalidPayloadError = () => new BadRequestException(`Invalid asset metadata payload for ${summary}`);

    if (Object.keys(objectPayload).some((key) => !supportedKeys.has(key))) {
      throw invalidPayloadError();
    }

    if (suppliedKeys.length === 0) {
      throw invalidPayloadError();
    }

    if (objectPayload.dateTimeOriginal !== undefined && objectPayload.dateTimeRelative !== undefined) {
      throw invalidPayloadError();
    }

    if (suppliedKeys.length === 1 && objectPayload.dateTimeRelative === 0) {
      throw invalidPayloadError();
    }

    if ((objectPayload.latitude === undefined) !== (objectPayload.longitude === undefined)) {
      throw invalidPayloadError();
    }

    const updatePayload: AssetUpdateMetadataApplyPayload = {};
    for (const key of assetUpdateMetadataApplyPayloadKeys) {
      const value = objectPayload[key];
      if (value === undefined) {
        continue;
      }

      switch (key) {
        case 'description': {
          if (typeof value !== 'string' || value.length > 1000) {
            throw invalidPayloadError();
          }
          updatePayload[key] = value;
          break;
        }
        case 'rating': {
          if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5)) {
            throw invalidPayloadError();
          }
          updatePayload[key] = value;
          break;
        }
        case 'dateTimeOriginal': {
          if (typeof value !== 'string' || !assetUpdateMetadataDateTimeOriginal.safeParse(value).success) {
            throw invalidPayloadError();
          }
          updatePayload[key] = value;
          break;
        }
        case 'dateTimeRelative': {
          if (typeof value !== 'number' || !Number.isInteger(value)) {
            throw invalidPayloadError();
          }
          updatePayload[key] = value;
          break;
        }
        case 'timeZone': {
          if (typeof value !== 'string' || value.length === 0) {
            throw invalidPayloadError();
          }
          try {
            new Intl.DateTimeFormat(undefined, { timeZone: value });
          } catch {
            throw invalidPayloadError();
          }
          updatePayload[key] = value;
          break;
        }
        case 'latitude': {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < -90 || value > 90) {
            throw invalidPayloadError();
          }
          updatePayload[key] = value;
          break;
        }
        case 'longitude': {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < -180 || value > 180) {
            throw invalidPayloadError();
          }
          updatePayload[key] = value;
          break;
        }
      }
    }

    return updatePayload;
  }

  private mergeRotationEdits(edits: AssetEditActionItem[], relativeAngle: 90 | 180 | 270): AssetEditActionItem[] {
    let inserted = false;
    const nextEdits: AssetEditActionItem[] = [];

    for (const edit of edits) {
      if (edit.action === AssetEditAction.Rotate) {
        const angle = edit.parameters.angle;
        const currentAngle = typeof angle === 'number' ? angle : 0;
        const netAngle = this.normalizeRotationAngle(currentAngle + relativeAngle);
        if (netAngle !== 0) {
          nextEdits.push({ action: AssetEditAction.Rotate, parameters: { angle: netAngle } });
        }
        inserted = true;
        continue;
      }

      nextEdits.push({ action: edit.action, parameters: edit.parameters } as AssetEditActionItem);
    }

    if (!inserted) {
      nextEdits.push({ action: AssetEditAction.Rotate, parameters: { angle: relativeAngle } });
    }

    return nextEdits;
  }

  private normalizeRotationAngle(angle: number) {
    return ((angle % 360) + 360) % 360;
  }

  private requireObjectPayload(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }

    return payload as Record<string, unknown>;
  }

  private createPlanningAudit(
    session: AgentSession,
    toolName: AgentToolName,
    request: PlanningRequest,
    result: PlanningAuditResult | PlanningAuditCreate,
  ) {
    const operations = request.operations ?? [];
    const assetIds = [...new Set(operations.flatMap((operation) => operation.assetIds ?? []))];
    const attemptedSelectionHandleIds = this.getAttemptedSelectionHandleIds(operations);
    const albumIds = [
      ...new Set(
        operations
          .filter((operation) => operation.targetKind === AgentOperationTargetKind.ExistingAlbum && operation.targetId)
          .map((operation) => operation.targetId as string),
      ),
    ];
    const spaceIds = [
      ...new Set(
        operations
          .filter((operation) => operation.targetKind === AgentOperationTargetKind.ExistingSpace && operation.targetId)
          .map((operation) => operation.targetId as string),
      ),
    ];
    const tagIds = [
      ...new Set(
        operations.flatMap((operation) => {
          const payload = this.requireObjectPayload(operation.payload);
          return typeof payload.tagId === 'string' ? [payload.tagId] : [];
        }),
      ),
    ];
    const userIds = [...new Set(operations.flatMap((operation) => this.getOperationUserIds(operation)))];

    return this.toolCallRepository.create({
      sessionId: session.id,
      toolName,
      status: result.status,
      approvalDecision: result.approvalDecision,
      requestSummary:
        toolName === AgentToolName.SummarizePlan
          ? `Summarize operation plan ${request.planId}`
          : this.getPlanningAuditRequestSummary(operations),
      responseSummary: result.responseSummary,
      redactedRequestMetadata: this.redactRequestMetadata(toolName, request, operations, {
        albumIds,
        spaceIds,
        tagIds,
        userIds,
        assetIds,
        attemptedSelectionHandleIds,
      }),
      redactedResponseMetadata: result.redactedResponseMetadata,
      dataClass: AgentToolDataClass.Plan,
      assetCount: assetIds.length,
      albumCount: albumIds.length,
      providerSnapshot: {
        providerCredentialId: session.credentialSnapshot.id,
        providerType: session.credentialSnapshot.providerType,
        label: session.credentialSnapshot.label,
        baseUrl: session.credentialSnapshot.baseUrl,
        model: session.modelSnapshot.model,
      },
      completedAt: result.status === AgentToolCallStatus.Executing ? null : new Date(),
      error: result.error,
    });
  }

  private getPlanningAuditRequestSummary(operations: AgentAlbumOperationInput[]) {
    const operationKind =
      operations.length > 0 &&
      operations.every((operation) => operation.type === AgentOperationType.AssetUpdateMetadata)
        ? 'metadata'
        : 'album';

    return `Store ${operations.length} proposed ${operationKind} operation(s)`;
  }

  private async transitionPlanningAudit(session: AgentSession, toolCallId: string, result: PlanningAuditResult) {
    const toolCall = await this.toolCallRepository.transition(session.id, toolCallId, AgentToolCallStatus.Executing, {
      status: result.status,
      approvalDecision: result.approvalDecision,
      responseSummary: result.responseSummary,
      redactedResponseMetadata: result.redactedResponseMetadata,
      completedAt: new Date(),
      error: result.error,
    });

    if (!toolCall) {
      throw new BadRequestException('Agent planning tool call is already executing or completed');
    }

    return toolCall;
  }

  private async tryTransitionPlanningAudit(
    session: AgentSession,
    toolCallId: string,
    result: PlanningAuditResult,
  ): Promise<void> {
    try {
      await this.transitionPlanningAudit(session, toolCallId, result);
    } catch {
      // Preserve the original planning error.
    }
  }

  private async emitPlanningActivity(
    session: AgentSession,
    status: AgentSessionActivityEventStatus.Completed | AgentSessionActivityEventStatus.Failed,
    options: { total?: number; summary: string },
  ) {
    const total = options.total === undefined ? undefined : Math.min(options.total, 10_000);
    try {
      await this.activityEventService?.createSystemEvent(session.userId, session.id, {
        kind: AgentSessionActivityEventKind.PlanComposing,
        status,
        summary: options.summary,
        ...(total === undefined ? {} : { counts: { total } }),
      });
    } catch {
      // Activity events are visibility hints and must not block planning.
    }
  }

  private getPlanActivityCount(plan: AgentOperationPlanWithOperations) {
    const assetIds = new Set(plan.operations.flatMap((operation) => operation.assetIds));
    return assetIds.size > 0 ? assetIds.size : plan.operations.length;
  }

  private async tryCreatePlanningPreparationDeniedAudit(
    session: AgentSession,
    toolName: AgentToolName,
    request: PlanningRequest,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : 'Agent operation planning failed';
    const status =
      error instanceof BadRequestException || error instanceof NotFoundException
        ? AgentToolCallStatus.Denied
        : AgentToolCallStatus.Failed;
    const approvalDecision =
      status === AgentToolCallStatus.Denied ? AgentToolApprovalDecision.Denied : AgentToolApprovalDecision.Approved;
    const redactedResponseMetadata = isAgentMcpRecoverableToolError(error)
      ? this.recoverablePlanningResponseMetadata(error.content.recovery)
      : null;

    try {
      await this.createPlanningAudit(session, toolName, request, {
        status,
        approvalDecision,
        responseSummary: null,
        redactedResponseMetadata,
        error: message,
      });
    } catch {
      // Preserve the original preparation error.
    }

    if (!isAgentMcpRecoverableToolError(error)) {
      await this.emitPlanningActivity(session, AgentSessionActivityEventStatus.Failed, {
        summary: 'Plan preparation failed',
      });
    }
  }

  private isInvalidSelectionHandleRecoveryMetadata(
    recovery: Record<string, unknown>,
  ): recovery is AgentSelectionHandleRecoveryMetadata {
    return recovery.kind === 'invalid-selection-handle';
  }

  private sanitizeWrongIdDomainRecoveryMetadata(
    recovery: Record<string, unknown>,
  ): AgentWrongIdDomainRecoveryMetadata | null {
    if (
      recovery.kind !== 'wrong_id_domain' ||
      typeof recovery.field !== 'string' ||
      typeof recovery.instruction !== 'string' ||
      !this.isKnownAgentIdDomain(recovery.expectedDomain) ||
      !this.isKnownAgentIdDomain(recovery.receivedDomain)
    ) {
      return null;
    }

    return {
      kind: 'wrong_id_domain',
      field: recovery.field,
      expectedDomain: recovery.expectedDomain,
      receivedDomain: recovery.receivedDomain,
      instruction: recovery.instruction,
    };
  }

  private isKnownAgentIdDomain(value: unknown): value is AgentIdDomain {
    return typeof value === 'string' && knownAgentIdDomains.has(value as AgentIdDomain);
  }

  private recoverablePlanningResponseMetadata(
    recovery: Record<string, unknown>,
  ): AgentToolOperationPlanResponseMetadata | null {
    if (this.isInvalidSelectionHandleRecoveryMetadata(recovery)) {
      return { selectionHandleRecovery: recovery };
    }

    const sourceRefRecovery = this.sanitizeInvalidSourceRefRecoveryMetadata(recovery);
    if (sourceRefRecovery) {
      return { sourceRefRecovery };
    }

    const wrongIdDomainRecovery = this.sanitizeWrongIdDomainRecoveryMetadata(recovery);
    if (wrongIdDomainRecovery) {
      return { wrongIdDomainRecovery };
    }

    return null;
  }

  private sanitizeInvalidSourceRefRecoveryMetadata(
    recovery: Record<string, unknown>,
  ): AgentSourceRefRecoveryMetadata | null {
    if (
      recovery.kind === 'invalid-source-ref' &&
      typeof recovery.attemptedSourceRef === 'string' &&
      recovery.expectedSourceKind === 'search' &&
      typeof recovery.instruction === 'string' &&
      (recovery.expiredSourceRef === undefined || typeof recovery.expiredSourceRef === 'string')
    ) {
      return {
        kind: 'invalid-source-ref',
        attemptedSourceRef: recovery.attemptedSourceRef,
        expectedSourceKind: recovery.expectedSourceKind,
        instruction: recovery.instruction,
        ...(recovery.expiredSourceRef ? { expiredSourceRef: recovery.expiredSourceRef } : {}),
      };
    }

    return null;
  }

  private buildSourceSummaries(
    selectionHandles: PlanningSelectionAudit | undefined,
  ): AgentToolOperationPlanRequestMetadata['sourceSummaries'] {
    if (!selectionHandles?.length) {
      return undefined;
    }

    return selectionHandles.map((handle) => {
      const filterKeys = handle.declarativeFilters ? Object.keys(handle.declarativeFilters).toSorted() : undefined;
      const resolvedFilterKeys = handle.resolvedFilters ? Object.keys(handle.resolvedFilters).toSorted() : undefined;

      return {
        sourceKind: handle.sourceKind ?? 'selectionHandle',
        ...(handle.id ? { selectionHandleId: handle.id } : {}),
        ...(handle.sourceRef ? { sourceRef: handle.sourceRef } : {}),
        assetCount: handle.assetCount,
        sampleAssetCount: handle.sampleAssetIds.length,
        ...(filterKeys?.length ? { filterKeys } : {}),
        ...(resolvedFilterKeys?.length ? { resolvedFilterKeys } : {}),
      };
    });
  }

  private redactRequestMetadata(
    _toolName: AgentToolName,
    request: PlanningRequest,
    operations: AgentAlbumOperationInput[],
    ids: {
      albumIds: string[];
      spaceIds: string[];
      tagIds: string[];
      userIds: string[];
      assetIds: string[];
      attemptedSelectionHandleIds: string[];
    },
  ): AgentToolOperationPlanRequestMetadata {
    const handleDerived = (request.selectionHandles?.length ?? 0) > 0;
    const assetIdsForAudit = handleDerived ? ids.assetIds.slice(0, 25) : ids.assetIds;
    const metadata: AgentToolOperationPlanRequestMetadata = {
      planId: request.planId,
      operationCount: operations.length,
      operationTypes: operations.map((operation) => operation.type),
      albumIds: ids.albumIds,
      assetIds: assetIdsForAudit,
    };

    if (operations.length > 0 || handleDerived) {
      metadata.assetCount = ids.assetIds.length;
    }

    if (handleDerived) {
      metadata.assetIdsSample = assetIdsForAudit;
      metadata.selectionHandles = request.selectionHandles;
      metadata.sourceSummaries = this.buildSourceSummaries(request.selectionHandles);
    }

    if (ids.attemptedSelectionHandleIds.length > 0) {
      metadata.attemptedSelectionHandleIds = ids.attemptedSelectionHandleIds;
    }

    if (ids.spaceIds.length > 0) {
      metadata.spaceIds = ids.spaceIds;
    }

    if (ids.tagIds.length > 0) {
      metadata.tagIds = ids.tagIds;
    }

    if (ids.userIds.length > 0) {
      metadata.userIds = ids.userIds;
    }

    return metadata;
  }

  private getAttemptedSelectionHandleIds(operations: AgentAlbumOperationInput[]) {
    return [
      ...new Set(
        operations.flatMap((operation) =>
          operation.assetSelectionHandleId && !operation.assetIds?.length ? [operation.assetSelectionHandleId] : [],
        ),
      ),
    ];
  }

  private async mapPlanForUserReview(plan: AgentOperationPlanWithOperations): Promise<AgentOperationPlanResponseDto> {
    return this.mapPlan(plan, await this.buildPlanReviewMetadata(plan));
  }

  private async buildPlanReviewMetadata(
    plan: AgentOperationPlanWithOperations,
    applySelection?: ApplySelection,
  ): Promise<Map<string, AgentOperationReviewMetadata>> {
    const reviewMetadataByOperationId = new Map<string, AgentOperationReviewMetadata>();
    const operationsForFreshReview: AgentPlanOperation[] = [];

    for (const operation of plan.operations) {
      const persistedReviewMetadata = this.getPersistedReviewMetadata(operation.result);
      if (persistedReviewMetadata) {
        reviewMetadataByOperationId.set(operation.id, persistedReviewMetadata);
        continue;
      }

      if (operation.type !== AgentOperationType.AssetUpdateMetadata) {
        continue;
      }

      if (applySelection && !applySelection.selectedOperationIds.has(operation.id)) {
        continue;
      }

      if (!applySelection && plan.status === AgentOperationPlanStatus.Applied) {
        continue;
      }

      const selectedAssetIds = applySelection?.selectedAssetIdsByOperationId.get(operation.id);
      operationsForFreshReview.push(selectedAssetIds ? { ...operation, assetIds: selectedAssetIds } : operation);
    }

    const sampleAssetIds = [
      ...new Set(
        operationsForFreshReview.flatMap((operation) =>
          [...new Set(operation.assetIds)].slice(0, metadataReviewSampleLimit),
        ),
      ),
    ];
    const metadataRows =
      sampleAssetIds.length > 0 ? await this.assetRepository.getAgentMetadataReviewByIds(sampleAssetIds) : [];
    const metadataByAssetId = new Map(metadataRows.map((row) => [row.id, row]));

    for (const operation of operationsForFreshReview) {
      const reviewMetadata = this.buildAssetMetadataReview(operation, metadataByAssetId);
      if (reviewMetadata) {
        reviewMetadataByOperationId.set(operation.id, reviewMetadata);
      }
    }

    return reviewMetadataByOperationId;
  }

  private buildAssetMetadataReview(
    operation: AgentPlanOperation,
    metadataByAssetId: Map<string, AgentAssetMetadataReviewRow>,
  ): AgentOperationReviewMetadata | undefined {
    const payload = this.requireObjectPayload(operation.payload);
    const sampleAssetIds = [...new Set(operation.assetIds)].slice(0, metadataReviewSampleLimit);
    const fields: NonNullable<AgentOperationReviewMetadata['assetMetadata']>['fields'] = [];

    if (Object.hasOwn(payload, 'description') && typeof payload.description === 'string') {
      fields.push({
        key: 'description',
        label: 'Description',
        previousValues: this.buildPreviousMetadataValues(sampleAssetIds, metadataByAssetId, (exifInfo) => ({
          value: exifInfo.description || null,
          valueKind: exifInfo.description ? 'known' : 'empty',
        })),
        proposedValue: payload.description === '' ? null : payload.description,
        proposedValueKind: payload.description === '' ? 'clear' : 'known',
      });
    }

    if (
      Object.hasOwn(payload, 'rating') &&
      (payload.rating === null || (typeof payload.rating === 'number' && Number.isInteger(payload.rating)))
    ) {
      fields.push({
        key: 'rating',
        label: 'Rating',
        previousValues: this.buildPreviousMetadataValues(sampleAssetIds, metadataByAssetId, (exifInfo) => ({
          value: exifInfo.rating === null ? null : String(exifInfo.rating),
          valueKind: exifInfo.rating === null ? 'empty' : 'known',
        })),
        proposedValue: payload.rating === null ? null : String(payload.rating),
        proposedValueKind: payload.rating === null ? 'clear' : 'known',
      });
    }

    if (Object.hasOwn(payload, 'dateTimeOriginal') && typeof payload.dateTimeOriginal === 'string') {
      fields.push({
        key: 'dateTimeOriginal',
        label: 'Date taken',
        previousValues: this.buildPreviousMetadataValues(sampleAssetIds, metadataByAssetId, (exifInfo) => ({
          value: this.formatMetadataDate(exifInfo.dateTimeOriginal),
          valueKind: exifInfo.dateTimeOriginal ? 'known' : 'empty',
        })),
        proposedValue: payload.dateTimeOriginal,
        proposedValueKind: 'known',
      });
    }

    if (Object.hasOwn(payload, 'dateTimeRelative') && typeof payload.dateTimeRelative === 'number') {
      fields.push({
        key: 'dateTimeRelative',
        label: 'Date shift',
        previousValues: this.buildPreviousMetadataValues(sampleAssetIds, metadataByAssetId, (exifInfo) => ({
          value: this.formatMetadataDate(exifInfo.dateTimeOriginal),
          valueKind: exifInfo.dateTimeOriginal ? 'known' : 'empty',
        })),
        proposedValue: String(payload.dateTimeRelative),
        proposedValueKind: 'relative',
      });
    }

    if (Object.hasOwn(payload, 'timeZone') && typeof payload.timeZone === 'string') {
      fields.push({
        key: 'timeZone',
        label: 'Time zone',
        previousValues: this.buildPreviousMetadataValues(sampleAssetIds, metadataByAssetId, (exifInfo) => ({
          value: exifInfo.timeZone || null,
          valueKind: exifInfo.timeZone ? 'known' : 'empty',
        })),
        proposedValue: payload.timeZone,
        proposedValueKind: 'known',
      });
    }

    if (typeof payload.latitude === 'number' && typeof payload.longitude === 'number') {
      fields.push({
        key: 'location',
        label: 'Location',
        previousValues: this.buildPreviousMetadataValues(sampleAssetIds, metadataByAssetId, (exifInfo) => ({
          value:
            typeof exifInfo.latitude === 'number' && typeof exifInfo.longitude === 'number'
              ? this.formatCoordinates(exifInfo.latitude, exifInfo.longitude)
              : null,
          valueKind:
            typeof exifInfo.latitude === 'number' && typeof exifInfo.longitude === 'number' ? 'known' : 'empty',
        })),
        proposedValue: this.formatCoordinates(payload.latitude, payload.longitude),
        proposedValueKind: 'known',
      });
    }

    if (fields.length === 0) {
      return;
    }

    return {
      assetMetadata: {
        fields,
        sampleAssetIds,
        warnings:
          fields.some((field) => field.key === 'location') && operation.assetIds.length > 1
            ? ['Coordinates will be applied to multiple photos.']
            : [],
      },
    };
  }

  private buildPreviousMetadataValues(
    assetIds: string[],
    metadataByAssetId: Map<string, AgentAssetMetadataReviewRow>,
    getValue: (exifInfo: NonNullable<AgentAssetMetadataReviewRow['exifInfo']>) => {
      value: string | null;
      valueKind: AgentOperationReviewMetadataValueKind;
    },
  ) {
    return assetIds.map((assetId) => {
      const row = metadataByAssetId.get(assetId);
      if (!row || !row.exifInfo) {
        return { assetId, value: null, valueKind: 'unknown' as const };
      }

      return { assetId, ...getValue(row.exifInfo) };
    });
  }

  private formatMetadataDate(value: Date | string | null) {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private formatCoordinates(latitude: number, longitude: number) {
    return `${latitude}, ${longitude}`;
  }

  private getPersistedReviewMetadata(result: AgentOperationResult | null): AgentOperationReviewMetadata | undefined {
    const record = this.asRecord(result);
    const reviewMetadata = this.asRecord(record?.reviewMetadata);
    const assetMetadata = reviewMetadata ? this.asRecord(reviewMetadata.assetMetadata) : undefined;

    if (!assetMetadata || !Array.isArray(assetMetadata.fields) || !Array.isArray(assetMetadata.sampleAssetIds)) {
      return;
    }

    return reviewMetadata as AgentOperationReviewMetadata;
  }

  private attachReviewMetadataToApplyUpdates(
    updates: AgentOperationApplyUpdate[],
    reviewMetadataByOperationId: Map<string, AgentOperationReviewMetadata>,
  ): AgentOperationApplyUpdate[] {
    return updates.map((update) => {
      const reviewMetadata = reviewMetadataByOperationId.get(update.id);
      if (!reviewMetadata) {
        return update;
      }

      return {
        ...update,
        result: {
          ...update.result,
          reviewMetadata,
        },
      };
    });
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  }

  private mapPlan(
    plan: AgentOperationPlanWithOperations,
    reviewMetadataByOperationId = new Map<string, AgentOperationReviewMetadata>(),
  ): AgentOperationPlanResponseDto {
    return {
      id: plan.id,
      sessionId: plan.sessionId,
      revision: plan.revision,
      status: plan.status,
      summary: plan.summary,
      operations: plan.operations.map((operation) =>
        this.mapOperation(operation, reviewMetadataByOperationId.get(operation.id)),
      ),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }

  private buildApplyResponse(
    plan: AgentOperationPlanResponseDto,
    selectedOperationIds: Set<string>,
  ): AgentOperationPlanApplyResponseDto {
    const appliedOperationIds = plan.operations
      .filter((operation) => operation.status === AgentOperationStatus.Applied)
      .map((operation) => operation.id);
    const skippedOperationIds = plan.operations
      .filter((operation) => operation.status === AgentOperationStatus.Skipped)
      .map((operation) => operation.id);
    const failedOperationIds = plan.operations
      .filter((operation) => operation.status === AgentOperationStatus.Failed)
      .map((operation) => operation.id);
    const selectedSkippedOperationIds = skippedOperationIds.filter((operationId) =>
      selectedOperationIds.has(operationId),
    );
    const status =
      appliedOperationIds.length === 0
        ? AgentOperationApplyStatus.Failed
        : failedOperationIds.length > 0 || selectedSkippedOperationIds.length > 0
          ? AgentOperationApplyStatus.PartiallyApplied
          : AgentOperationApplyStatus.Applied;

    return {
      status,
      plan,
      appliedOperationIds,
      skippedOperationIds,
      failedOperationIds,
      summary: `Applied ${appliedOperationIds.length} operation(s), skipped ${skippedOperationIds.length}, failed ${failedOperationIds.length}.`,
    };
  }

  private mapOperation(
    operation: AgentOperationPlanWithOperations['operations'][number],
    reviewMetadata?: AgentOperationReviewMetadata,
  ) {
    return {
      id: operation.id,
      planId: operation.planId,
      type: operation.type,
      summary: operation.summary,
      targetKind: operation.targetKind,
      targetId: operation.targetId,
      temporaryTargetId: operation.temporaryTargetId,
      assetIds: operation.assetIds,
      payload: operation.payload,
      dependencyIds: operation.dependencyIds,
      riskLevel: operation.riskLevel,
      enabled: operation.enabled,
      status: operation.status,
      result: operation.result,
      ...(reviewMetadata ? { reviewMetadata } : {}),
      error: operation.error,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
    };
  }

  private mapToolCall(toolCall: AgentToolCall) {
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
    };
  }

  private summarize(plan: AgentOperationPlanWithOperations) {
    const createCount = plan.operations.filter((operation) => operation.type === AgentOperationType.AlbumCreate).length;
    const addCount = plan.operations.filter((operation) => operation.type === AgentOperationType.AlbumAddAssets).length;
    const updateCount = plan.operations.filter((operation) =>
      [
        AgentOperationType.AlbumUpdateDetails,
        AgentOperationType.AlbumAddUsers,
        AgentOperationType.AlbumRemoveUsers,
        AgentOperationType.AlbumUpdateUserRole,
        AgentOperationType.AlbumDelete,
        AgentOperationType.SpaceDelete,
      ].includes(operation.type),
    ).length;
    const coverCount = plan.operations.filter(
      (operation) => operation.type === AgentOperationType.AlbumSetCover,
    ).length;
    const metadataUpdateCount = plan.operations.filter(
      (operation) => operation.type === AgentOperationType.AssetUpdateMetadata,
    ).length;

    if (metadataUpdateCount > 0 && createCount === 0 && addCount === 0 && updateCount === 0 && coverCount === 0) {
      return `Plan revision ${plan.revision}: ${metadataUpdateCount} metadata update operation(s).`;
    }

    return `Plan revision ${plan.revision}: ${createCount} album create, ${addCount} asset add, ${updateCount} detail update, ${coverCount} cover change, ${metadataUpdateCount} metadata update operation(s).`;
  }
}
