import {
  AgentOperationItemKind,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  type AgentOperationItemSelection,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
} from '@immich/sdk';
import type { Translations } from 'svelte-i18n';

export type OperationEnabledState = Record<string, boolean>;

export type OperationItemSelectionState = Record<string, AgentOperationItemSelectionPayload>;

export type OperationFieldOverrideState = Record<string, Record<string, string>>;

export type AgentOperationItemSelectionPayload = {
  itemKind: AgentReviewItemKind;
  mode: AgentReviewSelectionMode;
  itemIds?: string[];
};

export type AgentOperationSelectionPayload = {
  planId: string;
  planRevision: number;
  operationIds: string[];
  itemSelections?: Record<string, AgentOperationItemSelectionPayload>;
  fieldOverrides?: OperationFieldOverrideState;
};

export type AgentReviewDestinationKind = 'album' | 'space' | 'assetBatch' | 'library' | 'imageEditBatch';

export type AgentReviewDestination = {
  kind: AgentReviewDestinationKind;
  id?: string;
  temporaryId?: string;
  name: string;
  subtitle?: string;
};

export type AgentReviewItemKind = 'asset' | 'album' | 'space' | 'person' | 'tag';

export type AgentReviewSelectionMode = 'all' | 'allExcept' | 'only' | 'none';

export type AgentReviewSelection = {
  itemKind: AgentReviewItemKind;
  totalCount: number;
  selectedCount: number;
  mode: AgentReviewSelectionMode;
  itemIds?: string[];
  supportsItemSelection: boolean;
};

export type AgentReviewThumbnailSummary = {
  totalCount: number;
  representativeAssetIds: string[];
  hasMore: boolean;
};

export type AgentReviewDependency = {
  operationId: string;
  summary: string;
  blocked: boolean;
};

export type AgentOperationEditableField =
  | {
      key: 'albumName' | 'spaceName' | 'description';
      label: string;
      input: 'text' | 'textarea';
      originalValue: string;
      value: string;
      required: boolean;
      maxLength: number;
    }
  | {
      key: 'color';
      label: string;
      input: 'select';
      originalValue: string;
      value: string;
      required: boolean;
      options: { value: string; label: string }[];
    }
  | {
      key: 'albumThumbnailAssetId';
      label: string;
      input: 'coverAsset';
      originalValue: string | undefined;
      value: string | undefined;
      assetIds: string[];
      required: boolean;
    };

export type AgentOperationReview = {
  operationId: string;
  operationType: string;
  destination: AgentReviewDestination;
  summary: string;
  riskLevel: AgentOperationRiskLevel | string;
  selection: AgentReviewSelection;
  thumbnails: AgentReviewThumbnailSummary;
  dependencies: AgentReviewDependency[];
};

export type OperationApplyState =
  | { kind: 'proposed' }
  | { kind: 'applied'; appliedAssetCount?: number }
  | { kind: 'partial'; appliedAssetCount: number; failedAssetCount: number; error?: string }
  | { kind: 'failed'; error?: string }
  | { kind: 'skipped'; reason?: string };

export type OperationReviewApplyStateSummary = {
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  partialCount: number;
  hasFailures: boolean;
};

export type AgentOperationMetadataValueKind = 'known' | 'empty' | 'clear' | 'relative' | 'unknown';

export type AgentOperationMetadataDisplayText =
  | { kind: 'raw'; text: string }
  | { kind: 'translation'; key: Translations; values?: Record<string, string | number> };

export type AgentOperationMetadataFieldReview = {
  key: string;
  label: AgentOperationMetadataDisplayText;
  currentValues: { assetId: string; text: AgentOperationMetadataDisplayText; kind: AgentOperationMetadataValueKind }[];
  proposedText: AgentOperationMetadataDisplayText;
  proposedKind: AgentOperationMetadataValueKind;
};

export type AgentOperationMetadataReview = {
  fields: AgentOperationMetadataFieldReview[];
  warnings: AgentOperationMetadataDisplayText[];
};

export type OperationTechnicalDetails = {
  operationId: string;
  operationType: string;
  status: AgentOperationStatus | string;
  targetKind: AgentOperationTargetKind | string;
  targetId?: string;
  temporaryTargetId?: string;
  error?: string;
  assetIdPreview: string[];
  assetOverflowCount: number;
  resultAlbumId?: string;
  resultAssetIdPreview?: string[];
  resultAssetOverflowCount?: number;
  resultAssetResultsPreview?: { id: string; success: boolean; errorMessage?: string }[];
  resultAssetResultsOverflowCount?: number;
  resultSkippedReason?: string;
};

export type OperationReviewDestination = AgentReviewDestination & {
  title: string;
  subtitle: string;
};

export type OperationReviewItem = {
  id: string;
  operation: AgentOperationResponseDto;
  review: AgentOperationReview;
  summary: string;
  risk: AgentOperationRiskLevel | string;
  selected: boolean;
  enabled: boolean;
  blocked: boolean;
  mixed: boolean;
  blockedBy: string[];
  typeLabelKey: Translations;
  riskLabelKey: Translations;
  assetCount: number;
  excludedAssetCount: number;
  selectedAssetIds: string[];
  representativeAssetIds: string[];
  editableFields: AgentOperationEditableField[];
  fieldErrors: Record<string, string>;
  fieldOverrides: Record<string, string>;
  metadataReview?: AgentOperationMetadataReview;
  applyState: OperationApplyState;
};

export type OperationReviewGroup = {
  id: string;
  title: string;
  subtitle: string;
  curationCriteria?: string;
  destination: OperationReviewDestination;
  assetCount: number;
  thumbnailSummary: AgentReviewThumbnailSummary;
  representativeAssetIds: string[];
  operations: OperationReviewItem[];
};

export type OperationReviewModel = {
  plan: AgentOperationPlanResponseDto;
  groups: OperationReviewGroup[];
  operationsById: Map<string, OperationReviewItem>;
  fieldErrors: { operationId: string; fieldKey: string; message: string }[];
};

export type OperationReviewImpactSummary = {
  destinationCount: number;
  totalOperationCount: number;
  selectedOperationCount: number;
  blockedOperationCount: number;
  totalAssetCount: number;
  selectedAssetCount: number;
};

export type AgentPlanThumbnailStripModel = {
  totalCount: number;
  assetIds: string[];
  overflowCount: number;
  hasMore: boolean;
  hasThumbnails: boolean;
};

const typeLabelKeys: Partial<Record<AgentOperationType, Translations>> = {
  [AgentOperationType.AlbumCreate]: 'assistant_operation_type_album_create' as Translations,
  [AgentOperationType.AlbumAddAssets]: 'assistant_operation_type_album_add_assets' as Translations,
  [AgentOperationType.AlbumUpdateDetails]: 'assistant_operation_type_album_update_details' as Translations,
  [AgentOperationType.AlbumSetCover]: 'assistant_operation_type_album_set_cover' as Translations,
  [AgentOperationType.SpaceAddAssets]: 'assistant_operation_type_space_add_assets' as Translations,
  [AgentOperationType.SpaceRemoveAssets]: 'assistant_operation_type_space_remove_assets' as Translations,
  [AgentOperationType.SpaceUpdateDetails]: 'assistant_operation_type_space_update_details' as Translations,
  [AgentOperationType.SpaceAddMembers]: 'assistant_operation_type_space_add_members' as Translations,
  [AgentOperationType.SpaceRemoveMembers]: 'assistant_operation_type_space_remove_members' as Translations,
  [AgentOperationType.SpaceUpdateMemberRole]: 'assistant_operation_type_space_update_member_role' as Translations,
  [AgentOperationType.AssetUpdateMetadata]: 'assistant_operation_type_asset_update_metadata' as Translations,
};

const riskLabelKeys = {
  [AgentOperationRiskLevel.Low]: 'assistant_operation_risk_low' as Translations,
  [AgentOperationRiskLevel.Medium]: 'assistant_operation_risk_medium' as Translations,
  [AgentOperationRiskLevel.High]: 'assistant_operation_risk_high' as Translations,
} satisfies Record<AgentOperationRiskLevel, Translations>;

const fallbackTypeLabelKey = 'assistant_operation_type_unknown' as Translations;
const fallbackRiskLabelKey = 'assistant_operation_risk_unknown' as Translations;
const representativeAssetLimit = 12;
export const AGENT_PLAN_ITEM_REVIEW_VISIBLE_LIMIT = 48;
export const AGENT_PLAN_THUMBNAIL_STRIP_DEFAULT_LIMIT = 6;
export const AGENT_PLAN_THUMBNAIL_STRIP_MAX_LIMIT = 12;

const gallerySpaceColors = ['primary', 'pink', 'red', 'yellow', 'blue', 'green', 'purple', 'orange', 'gray', 'amber'];
const gallerySpaceColorOptions = gallerySpaceColors.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

export const createInitialOperationEnabledState = (plan: AgentOperationPlanResponseDto): OperationEnabledState =>
  Object.fromEntries(plan.operations.map((operation) => [operation.id, operation.enabled]));

export const createInitialOperationItemSelectionState = (
  _: AgentOperationPlanResponseDto,
): OperationItemSelectionState => ({});

export const createInitialOperationFieldOverrideState = (
  _: AgentOperationPlanResponseDto,
): OperationFieldOverrideState => ({});

export const setOperationFieldOverride = (
  state: OperationFieldOverrideState,
  operationId: string,
  fieldKey: string,
  value: string,
): OperationFieldOverrideState => {
  const currentFields = state[operationId];

  return {
    ...state,
    [operationId]: currentFields ? { ...currentFields, [fieldKey]: value } : { [fieldKey]: value },
  };
};

export const resetOperationFieldOverride = (
  state: OperationFieldOverrideState,
  operationId: string,
  fieldKey?: string,
): OperationFieldOverrideState => {
  if (!fieldKey) {
    const { [operationId]: _, ...remaining } = state;
    return remaining;
  }

  const currentFields = state[operationId];
  const nextFields = currentFields ? { ...currentFields } : {};
  delete nextFields[fieldKey];
  const { [operationId]: _, ...remaining } = state;

  return Object.keys(nextFields).length === 0 ? remaining : { ...remaining, [operationId]: nextFields };
};

export const setOperationItemSelection = (
  state: OperationItemSelectionState,
  operationId: string,
  selection: AgentOperationItemSelectionPayload,
): OperationItemSelectionState => ({
  ...state,
  [operationId]: normalizeSelection(selection),
});

export const resetOperationItemSelection = (
  state: OperationItemSelectionState,
  operationId: string,
): OperationItemSelectionState => {
  const { [operationId]: _, ...remaining } = state;
  return remaining;
};

export const buildOperationItemSelectionState = (
  plan: AgentOperationPlanResponseDto,
  state: OperationItemSelectionState,
  operationId: string,
  assetId: string,
  selected: boolean,
): OperationItemSelectionState => {
  const operation = plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation || !operation.assetIds.includes(assetId)) {
    return state;
  }

  const currentSelection = state[operationId] ?? { itemKind: 'asset', mode: 'all' };
  const currentItemIds = currentSelection.itemIds ?? [];

  if (currentSelection.mode === 'all') {
    return selected
      ? state
      : setOperationItemSelection(state, operationId, {
          itemKind: 'asset',
          mode: 'allExcept',
          itemIds: [assetId],
        });
  }

  if (currentSelection.mode === 'allExcept') {
    const nextItemIds = selected
      ? currentItemIds.filter((itemId) => itemId !== assetId)
      : normalizeItemIds([...currentItemIds, assetId]);

    return nextItemIds.length === 0
      ? resetOperationItemSelection(state, operationId)
      : setOperationItemSelection(state, operationId, {
          itemKind: 'asset',
          mode: 'allExcept',
          itemIds: nextItemIds,
        });
  }

  if (currentSelection.mode === 'only') {
    const nextItemIds = selected
      ? normalizeItemIds([...currentItemIds, assetId])
      : currentItemIds.filter((itemId) => itemId !== assetId);

    return nextItemIds.length === 0
      ? setOperationItemSelection(state, operationId, { itemKind: 'asset', mode: 'none' })
      : setOperationItemSelection(state, operationId, {
          itemKind: 'asset',
          mode: 'only',
          itemIds: nextItemIds,
        });
  }

  return selected
    ? setOperationItemSelection(state, operationId, { itemKind: 'asset', mode: 'only', itemIds: [assetId] })
    : state;
};

export const getOperationAssetCount = (operations: Pick<AgentOperationResponseDto, 'assetIds'>[]) =>
  new Set(operations.flatMap((operation) => operation.assetIds)).size;

export const buildGroupEnabledState = (
  enabledByOperationId: OperationEnabledState,
  group: OperationReviewGroup,
  enabled: boolean,
): OperationEnabledState => ({
  ...enabledByOperationId,
  ...Object.fromEntries(group.operations.map((operation) => [operation.id, enabled])),
});

export const buildApprovedOperationIds = (model: OperationReviewModel) =>
  model.plan.operations
    .map((operation) => model.operationsById.get(operation.id))
    .filter((operation): operation is OperationReviewItem => operation !== undefined)
    .filter((operation) => operation.enabled && !operation.blocked)
    .map((operation) => operation.id);

export const buildSelectionPayload = (model: OperationReviewModel): AgentOperationSelectionPayload => {
  const operationIds = buildApprovedOperationIds(model);
  const itemSelections = Object.fromEntries(
    operationIds
      .map((operationId) => model.operationsById.get(operationId))
      .filter((operation): operation is OperationReviewItem => operation !== undefined)
      .filter((operation) => operation.review.selection.supportsItemSelection)
      .filter((operation) => operation.review.selection.mode !== 'all')
      .map((operation) => [
        operation.id,
        {
          itemKind: operation.review.selection.itemKind,
          mode: operation.review.selection.mode,
          ...(operation.review.selection.itemIds ? { itemIds: operation.review.selection.itemIds } : {}),
        },
      ]),
  );
  const fieldOverrides = Object.fromEntries(
    operationIds
      .map((operationId) => model.operationsById.get(operationId))
      .filter((operation): operation is OperationReviewItem => operation !== undefined)
      .filter((operation) => Object.keys(operation.fieldOverrides).length > 0)
      .map((operation) => [operation.id, operation.fieldOverrides]),
  );

  return {
    planId: model.plan.id,
    planRevision: model.plan.revision,
    operationIds,
    ...(Object.keys(itemSelections).length > 0 ? { itemSelections } : {}),
    ...(Object.keys(fieldOverrides).length > 0 ? { fieldOverrides } : {}),
  };
};

export const toAgentOperationItemSelections = (
  itemSelections: Record<string, AgentOperationItemSelectionPayload> | undefined,
): Record<string, AgentOperationItemSelection> | undefined => {
  if (!itemSelections) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(itemSelections).map(([operationId, selection]) => [
      operationId,
      {
        ...selection,
        itemKind: AgentOperationItemKind.Asset,
      } as AgentOperationItemSelection,
    ]),
  );
};

export const buildOperationReviewImpactSummary = (model: OperationReviewModel): OperationReviewImpactSummary => {
  const selectedOperations = model.plan.operations
    .map((operation) => model.operationsById.get(operation.id))
    .filter((operation): operation is OperationReviewItem => operation !== undefined)
    .filter((operation) => operation.enabled && !operation.blocked);

  return {
    destinationCount: model.groups.length,
    totalOperationCount: model.plan.operations.length,
    selectedOperationCount: selectedOperations.length,
    blockedOperationCount: [...model.operationsById.values()].filter((operation) => operation.blocked).length,
    totalAssetCount: getOperationAssetCount(model.plan.operations),
    selectedAssetCount: new Set(selectedOperations.flatMap((operation) => operation.selectedAssetIds)).size,
  };
};

export const buildOperationReviewApplyStateSummary = (
  model: OperationReviewModel,
): OperationReviewApplyStateSummary => {
  const summary: OperationReviewApplyStateSummary = {
    appliedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    partialCount: 0,
    hasFailures: false,
  };

  for (const operation of model.operationsById.values()) {
    if (operation.applyState.kind === 'applied') {
      summary.appliedCount++;
      continue;
    }

    if (operation.applyState.kind === 'skipped') {
      summary.skippedCount++;
      continue;
    }

    if (operation.applyState.kind === 'partial') {
      summary.partialCount++;
      summary.failedCount++;
      continue;
    }

    if (operation.applyState.kind === 'failed') {
      summary.failedCount++;
    }
  }

  summary.hasFailures = summary.failedCount > 0;
  return summary;
};

const technicalDetailsVisibleLimit = 20;

export const buildOperationTechnicalDetails = (item: OperationReviewItem): OperationTechnicalDetails => {
  const result = isRecord(item.operation.result) ? item.operation.result : undefined;
  const resultAssetIds = getStringArray(result?.assetIds);
  const resultAssetResults = getAssetResultDetails(result?.assetResults);

  return {
    operationId: item.operation.id,
    operationType: item.operation.type,
    status: item.operation.status,
    targetKind: item.operation.targetKind,
    ...(item.operation.targetId ? { targetId: item.operation.targetId } : {}),
    ...(item.operation.temporaryTargetId ? { temporaryTargetId: item.operation.temporaryTargetId } : {}),
    ...(item.operation.error ? { error: item.operation.error } : {}),
    assetIdPreview: item.operation.assetIds.slice(0, technicalDetailsVisibleLimit),
    assetOverflowCount: Math.max(item.operation.assetIds.length - technicalDetailsVisibleLimit, 0),
    ...(typeof result?.albumId === 'string' ? { resultAlbumId: result.albumId } : {}),
    ...(resultAssetIds
      ? {
          resultAssetIdPreview: resultAssetIds.slice(0, technicalDetailsVisibleLimit),
          resultAssetOverflowCount: Math.max(resultAssetIds.length - technicalDetailsVisibleLimit, 0),
        }
      : {}),
    ...(resultAssetResults
      ? {
          resultAssetResultsPreview: resultAssetResults.slice(0, technicalDetailsVisibleLimit),
          resultAssetResultsOverflowCount: Math.max(resultAssetResults.length - technicalDetailsVisibleLimit, 0),
        }
      : {}),
    ...(typeof result?.skippedReason === 'string' ? { resultSkippedReason: result.skippedReason } : {}),
  };
};

const normalizeThumbnailStripLimit = (requestedLimit: number) =>
  Math.min(AGENT_PLAN_THUMBNAIL_STRIP_MAX_LIMIT, Math.max(0, Math.floor(requestedLimit)));

export const buildAgentPlanThumbnailStrip = (
  group: OperationReviewGroup,
  requestedLimit = AGENT_PLAN_THUMBNAIL_STRIP_DEFAULT_LIMIT,
): AgentPlanThumbnailStripModel => {
  const visibleLimit = normalizeThumbnailStripLimit(requestedLimit);
  const totalCount = group.thumbnailSummary.totalCount;
  const assetIds = group.thumbnailSummary.representativeAssetIds.slice(0, visibleLimit);
  const overflowCount = assetIds.length > 0 ? Math.max(totalCount - assetIds.length, 0) : 0;

  return {
    totalCount,
    assetIds,
    overflowCount,
    hasMore: overflowCount > 0,
    hasThumbnails: assetIds.length > 0,
  };
};

export const buildAgentPlanItemReviewAssetIds = (
  item: OperationReviewItem,
  requestedLimit = AGENT_PLAN_ITEM_REVIEW_VISIBLE_LIMIT,
) => item.operation.assetIds.slice(0, Math.max(0, Math.floor(requestedLimit)));

export const isAssetSelectedForOperation = (item: OperationReviewItem, assetId: string) => {
  const selection = item.review.selection;
  if (!selection.supportsItemSelection) {
    return item.enabled;
  }

  if (selection.mode === 'all') {
    return true;
  }

  if (selection.mode === 'allExcept') {
    return !(selection.itemIds ?? []).includes(assetId);
  }

  if (selection.mode === 'only') {
    return (selection.itemIds ?? []).includes(assetId);
  }

  return false;
};

export const buildOperationReviewModel = (
  plan: AgentOperationPlanResponseDto,
  enabledByOperationId: OperationEnabledState,
  itemSelectionByOperationId: OperationItemSelectionState = {},
  fieldOverrideByOperationId: OperationFieldOverrideState = {},
): OperationReviewModel => {
  const operationById = new Map(
    plan.operations.map((operation) => [
      operation.id,
      getOperationForReview(applyOperationFieldOverrides(operation, fieldOverrideByOperationId[operation.id])),
    ]),
  );
  const blockedByCache = new Map<string, string[]>();

  const getBaseSelection = (operation: AgentOperationResponseDto) =>
    buildOperationReviewSelection(
      operation,
      enabledByOperationId[operation.id] ?? operation.enabled,
      itemSelectionByOperationId[operation.id],
    );

  const isOperationRequested = (operation: AgentOperationResponseDto) => {
    const enabled = enabledByOperationId[operation.id] ?? operation.enabled;
    if (!enabled) {
      return false;
    }

    const selection = getBaseSelection(operation);
    return selection.supportsItemSelection ? selection.selectedCount > 0 : true;
  };

  const collectBlockingDependencySummaries = (
    operation: AgentOperationResponseDto,
    visitedOperationIds = new Set<string>(),
  ): string[] => {
    const cached = blockedByCache.get(operation.id);
    if (cached) {
      return cached;
    }

    const blockedBy: string[] = [];
    const nextVisitedOperationIds = new Set([...visitedOperationIds, operation.id]);

    for (const dependencyId of operation.dependencyIds) {
      const dependency = operationById.get(dependencyId);
      if (!dependency) {
        blockedBy.push('Missing dependency');
        continue;
      }

      if (visitedOperationIds.has(dependency.id)) {
        blockedBy.push(dependency.summary);
        continue;
      }

      const dependencyBlockedBy = collectBlockingDependencySummaries(dependency, nextVisitedOperationIds);
      if (!isOperationRequested(dependency) || dependencyBlockedBy.length > 0) {
        blockedBy.push(dependency.summary);
      }
    }

    blockedByCache.set(operation.id, blockedBy);
    return blockedBy;
  };

  const items = plan.operations.map((operation) => {
    const blockedBy = collectBlockingDependencySummaries(operation);
    const blocked = blockedBy.length > 0;
    const selected = enabledByOperationId[operation.id] ?? operation.enabled;
    const effectiveOperation = operationById.get(operation.id) ?? operation;
    const review = buildOperationReview(
      effectiveOperation,
      operationById,
      enabledByOperationId,
      (dependency) => collectBlockingDependencySummaries(dependency).length > 0,
      selected,
      blocked,
      itemSelectionByOperationId[operation.id],
    );
    const editableFields = buildEditableFields(operation, fieldOverrideByOperationId[operation.id]);
    const selectedAssetIds = getSelectedAssetIds(effectiveOperation, review.selection);
    const fieldErrors = validateEditableFields(editableFields, selectedAssetIds);
    const enabled =
      !blocked &&
      selected &&
      Object.keys(fieldErrors).length === 0 &&
      (!review.selection.supportsItemSelection || review.selection.selectedCount > 0);

    return {
      id: operation.id,
      operation: effectiveOperation,
      review,
      summary: review.summary,
      risk: review.riskLevel,
      selected,
      enabled,
      blocked,
      mixed:
        review.selection.supportsItemSelection &&
        review.selection.selectedCount > 0 &&
        review.selection.selectedCount < review.selection.totalCount,
      blockedBy,
      typeLabelKey: typeLabelKeys[operation.type] ?? fallbackTypeLabelKey,
      riskLabelKey: riskLabelKeys[operation.riskLevel] ?? fallbackRiskLabelKey,
      assetCount: review.selection.totalCount,
      excludedAssetCount: Math.max(review.selection.totalCount - review.selection.selectedCount, 0),
      selectedAssetIds,
      representativeAssetIds: review.thumbnails.representativeAssetIds,
      editableFields,
      fieldErrors,
      fieldOverrides: buildSparseOperationFieldOverrides(editableFields),
      metadataReview: buildMetadataReview(operation, selectedAssetIds),
      applyState: buildOperationApplyState(operation),
    };
  });

  const groupsById = new Map<string, OperationReviewGroup>();

  for (const item of items) {
    const groupId = getGroupId(item.operation);
    const group = groupsById.get(groupId) ?? {
      id: groupId,
      title: getReviewGroupTitle(item),
      subtitle: '',
      curationCriteria: undefined,
      destination: getDestination(item.operation, operationById, '', item.review.destination.name),
      assetCount: 0,
      thumbnailSummary: { totalCount: 0, representativeAssetIds: [], hasMore: false },
      representativeAssetIds: [],
      operations: [],
    };

    const operations = [...group.operations, item];
    const curationCriteria = groupHasSuggestedHighlights(operations)
      ? (group.curationCriteria ??
        getHighlightCurationCriteria([plan.summary, ...operations.map(({ operation }) => operation.summary)]))
      : undefined;
    const subtitle = `${operations.length} ${operations.length === 1 ? 'operation' : 'operations'}`;
    const thumbnailSummary = getThumbnailSummary(operations.map(({ operation }) => operation));
    groupsById.set(groupId, {
      ...group,
      subtitle,
      curationCriteria,
      destination: {
        ...group.destination,
        name: item.review.destination.name,
        subtitle:
          group.operations[0]?.review.destination.subtitle ??
          item.review.destination.subtitle ??
          group.destination.subtitle,
      },
      assetCount: getOperationAssetCount(operations.map(({ operation }) => operation)),
      thumbnailSummary,
      representativeAssetIds: thumbnailSummary.representativeAssetIds,
      operations,
    });
  }

  return {
    plan,
    groups: [...groupsById.values()],
    operationsById: new Map(items.map((item) => [item.id, item])),
    fieldErrors: items.flatMap((item) =>
      Object.entries(item.fieldErrors).map(([fieldKey, message]) => ({
        operationId: item.id,
        fieldKey,
        message,
      })),
    ),
  };
};

const getReviewGroupTitle = (item: Pick<OperationReviewItem, 'operation' | 'review'>) => {
  if (item.operation.targetKind === AgentOperationTargetKind.NewAlbum) {
    return `New album "${item.review.destination.name}"`;
  }

  if (
    item.operation.targetKind === AgentOperationTargetKind.NewSpace ||
    item.operation.targetKind === AgentOperationTargetKind.ExistingSpace
  ) {
    return item.review.destination.name;
  }

  return getGroupTitle(item.operation);
};

const buildOperationReview = (
  operation: AgentOperationResponseDto,
  operationById: Map<string, AgentOperationResponseDto>,
  enabledByOperationId: OperationEnabledState,
  isOperationBlocked: (operation: AgentOperationResponseDto) => boolean,
  selected: boolean,
  blocked: boolean,
  itemSelection?: AgentOperationItemSelectionPayload,
): AgentOperationReview => ({
  operationId: operation.id,
  operationType: operation.type,
  destination: getReviewDestination(operation, operationById),
  summary: getOperationReviewSummary(operation),
  riskLevel: operation.riskLevel,
  selection: buildOperationReviewSelection(operation, selected && !blocked, itemSelection),
  thumbnails: getThumbnailSummary([operation]),
  dependencies: operation.dependencyIds.map((operationId) => {
    const dependency = operationById.get(operationId);
    const dependencySelected = dependency ? (enabledByOperationId[dependency.id] ?? dependency.enabled) : false;
    const dependencyBlocked = dependency ? isOperationBlocked(dependency) : false;

    return {
      operationId,
      summary: dependency?.summary ?? 'Missing dependency',
      blocked: dependency === undefined || !dependencySelected || dependencyBlocked,
    };
  }),
});

const buildEditableFields = (
  operation: AgentOperationResponseDto,
  fieldOverrides: Record<string, string> | undefined,
): AgentOperationEditableField[] => {
  if (operation.type === AgentOperationType.AlbumCreate || operation.type === AgentOperationType.AlbumUpdateDetails) {
    const albumName = getRawStringPayloadValue(operation, 'albumName');
    const description = getRawStringPayloadValue(operation, 'description');

    return [
      {
        key: 'albumName',
        label: 'Album name',
        input: 'text',
        originalValue: albumName,
        value: getStringOverride(fieldOverrides, 'albumName') ?? albumName,
        required: true,
        maxLength: 200,
      },
      {
        key: 'description',
        label: 'Description',
        input: 'textarea',
        originalValue: description,
        value: getStringOverride(fieldOverrides, 'description') ?? description,
        required: false,
        maxLength: 1000,
      },
    ];
  }

  if (operation.type === AgentOperationType.AlbumSetCover && operation.assetIds.length > 1) {
    const originalValue = operation.assetIds[0];
    const overrideValue = getStringOverride(fieldOverrides, 'albumThumbnailAssetId');

    return [
      {
        key: 'albumThumbnailAssetId',
        label: 'Cover photo',
        input: 'coverAsset',
        originalValue,
        value: overrideValue ?? originalValue,
        assetIds: [...new Set(operation.assetIds)],
        required: true,
      },
    ];
  }

  if (operation.type === AgentOperationType.SpaceUpdateDetails) {
    const spaceName = getRawStringPayloadValue(operation, 'spaceName');
    const description = getRawStringPayloadValue(operation, 'description');
    const color = getRawStringPayloadValue(operation, 'color');

    return [
      {
        key: 'spaceName',
        label: 'Space name',
        input: 'text',
        originalValue: spaceName,
        value: getStringOverride(fieldOverrides, 'spaceName') ?? spaceName,
        required: true,
        maxLength: 100,
      },
      {
        key: 'description',
        label: 'Description',
        input: 'textarea',
        originalValue: description,
        value: getStringOverride(fieldOverrides, 'description') ?? description,
        required: false,
        maxLength: 500,
      },
      {
        key: 'color',
        label: 'Color',
        input: 'select',
        originalValue: color,
        value: getStringOverride(fieldOverrides, 'color') ?? color,
        required: false,
        options: gallerySpaceColorOptions,
      },
    ];
  }

  return [];
};

const validateEditableFields = (
  editableFields: AgentOperationEditableField[],
  selectedAssetIds: string[],
): Record<string, string> => {
  const errors: Record<string, string> = {};

  for (const field of editableFields) {
    if (field.key === 'albumName') {
      const trimmedValue = field.value.trim();
      const shouldValidateBlankName = field.originalValue.trim().length > 0 || field.value !== field.originalValue;
      if (trimmedValue.length === 0 && shouldValidateBlankName) {
        errors[field.key] = 'Album name is required.';
      } else if (trimmedValue.length > field.maxLength) {
        errors[field.key] = 'Album name must be 200 characters or fewer.';
      }
      continue;
    }

    if (field.key === 'spaceName') {
      const trimmedValue = field.value.trim();
      const shouldValidateBlankName = field.originalValue.trim().length > 0 || field.value !== field.originalValue;
      if (trimmedValue.length === 0 && shouldValidateBlankName) {
        errors[field.key] = 'Space name is required.';
      } else if (trimmedValue.length > field.maxLength) {
        errors[field.key] = 'Space name must be 100 characters or fewer.';
      }
      continue;
    }

    if (field.key === 'description' && field.value.trim().length > field.maxLength) {
      errors[field.key] =
        field.maxLength === 500
          ? 'Description must be 500 characters or fewer.'
          : 'Description must be 1,000 characters or fewer.';
      continue;
    }

    if (field.key === 'color' && !gallerySpaceColors.includes(field.value)) {
      errors[field.key] = 'Choose a valid Gallery color.';
      continue;
    }

    if (field.key === 'albumThumbnailAssetId' && (!field.value || !selectedAssetIds.includes(field.value))) {
      errors[field.key] = 'Choose a selected cover photo.';
    }
  }

  return errors;
};

const buildOperationApplyState = (operation: AgentOperationResponseDto): OperationApplyState => {
  if (operation.status === AgentOperationStatus.Applied) {
    const result = isRecord(operation.result) ? operation.result : undefined;
    const appliedUserIds = getStringArray(result?.userIds);

    return {
      kind: 'applied',
      ...(operation.assetIds.length > 0 ? { appliedAssetCount: operation.assetIds.length } : {}),
      ...(appliedUserIds && appliedUserIds.length > 0 ? { appliedAssetCount: appliedUserIds.length } : {}),
    };
  }

  if (operation.status === AgentOperationStatus.Skipped) {
    const result = isRecord(operation.result) ? operation.result : undefined;
    return {
      kind: 'skipped',
      ...(typeof result?.skippedReason === 'string' ? { reason: result.skippedReason } : {}),
    };
  }

  if (operation.status === AgentOperationStatus.Failed) {
    const assetResults = isRecord(operation.result) ? getAssetResultDetails(operation.result.assetResults) : undefined;
    const appliedAssetCount = assetResults?.filter((result) => result.success).length ?? 0;

    if (assetResults && appliedAssetCount > 0) {
      return {
        kind: 'partial',
        appliedAssetCount,
        failedAssetCount: assetResults.filter((result) => !result.success).length,
        ...(operation.error ? { error: operation.error } : {}),
      };
    }

    return {
      kind: 'failed',
      ...(operation.error ? { error: operation.error } : {}),
    };
  }

  return { kind: 'proposed' };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const buildMetadataReview = (
  operation: AgentOperationResponseDto,
  selectedAssetIds: string[],
): AgentOperationMetadataReview | undefined => {
  if (operation.type !== AgentOperationType.AssetUpdateMetadata) {
    return;
  }

  const selectedAssetIdSet = new Set(selectedAssetIds);
  const rawAssetMetadata = getRawAssetMetadataReview(operation);
  const fields = rawAssetMetadata
    ? rawAssetMetadata.fields.map((field) => formatMetadataReviewField(field, selectedAssetIds, selectedAssetIdSet))
    : buildPayloadOnlyMetadataReviewFields(operation, selectedAssetIds);

  if (fields.length === 0) {
    return;
  }

  const hasLocationUpdate = fields.some((field) => field.key === 'location');
  const serverWarnings = (rawAssetMetadata?.warnings ?? [])
    .filter((warning) => !/coordinate/i.test(warning))
    .map((warning) => rawMetadataText(warning));
  const warnings =
    hasLocationUpdate && selectedAssetIds.length > 1
      ? [
          ...serverWarnings,
          translatedMetadataText('assistant_operation_metadata_warning_coordinates_multi', {
            count: selectedAssetIds.length,
          }),
        ]
      : serverWarnings;

  return { fields, warnings };
};

const getRawAssetMetadataReview = (operation: AgentOperationResponseDto) => {
  const reviewMetadata = isRecord((operation as { reviewMetadata?: unknown }).reviewMetadata)
    ? (operation as { reviewMetadata?: Record<string, unknown> }).reviewMetadata
    : undefined;
  const assetMetadata = isRecord(reviewMetadata?.assetMetadata) ? reviewMetadata.assetMetadata : undefined;
  const fields = Array.isArray(assetMetadata?.fields) ? assetMetadata.fields : undefined;

  if (!fields) {
    return;
  }

  return {
    fields: fields.flatMap((field) => (isRecord(field) ? [field] : [])),
    warnings: Array.isArray(assetMetadata?.warnings)
      ? assetMetadata.warnings.filter((warning): warning is string => typeof warning === 'string')
      : [],
  };
};

const formatMetadataReviewField = (
  field: Record<string, unknown>,
  selectedAssetIds: string[],
  selectedAssetIdSet: Set<string>,
): AgentOperationMetadataFieldReview => {
  const key = typeof field.key === 'string' ? field.key : 'unknown';
  const previousValues = Array.isArray(field.previousValues) ? field.previousValues : [];
  const currentValues = previousValues
    .flatMap((value) => (isRecord(value) ? [value] : []))
    .filter((value) => typeof value.assetId === 'string' && selectedAssetIdSet.has(value.assetId))
    .map((value) => ({
      assetId: value.assetId as string,
      text: formatMetadataValue(key, value.value, getMetadataValueKind(value.valueKind)),
      kind: getMetadataValueKind(value.valueKind),
    }));

  return {
    key,
    label: getMetadataFieldLabel(key),
    currentValues:
      currentValues.length > 0
        ? currentValues
        : selectedAssetIds.slice(0, 1).map((assetId) => ({
            assetId,
            text: translatedMetadataText('assistant_operation_metadata_value_unavailable'),
            kind: 'unknown',
          })),
    proposedText: formatProposedMetadataValue(key, field.proposedValue, getMetadataValueKind(field.proposedValueKind)),
    proposedKind: getMetadataValueKind(field.proposedValueKind),
  };
};

const buildPayloadOnlyMetadataReviewFields = (
  operation: AgentOperationResponseDto,
  selectedAssetIds: string[],
): AgentOperationMetadataFieldReview[] => {
  const payload = isRecord(operation.payload) ? operation.payload : {};
  const fields: AgentOperationMetadataFieldReview[] = [];
  const currentValues = selectedAssetIds.slice(0, 1).map((assetId) => ({
    assetId,
    text: translatedMetadataText('assistant_operation_metadata_value_unavailable'),
    kind: 'unknown' as const,
  }));

  if (Object.hasOwn(payload, 'description') && typeof payload.description === 'string') {
    fields.push({
      key: 'description',
      label: getMetadataFieldLabel('description'),
      currentValues,
      proposedText: formatProposedMetadataValue(
        'description',
        payload.description || null,
        payload.description ? 'known' : 'clear',
      ),
      proposedKind: payload.description ? 'known' : 'clear',
    });
  }

  if (Object.hasOwn(payload, 'rating') && (typeof payload.rating === 'number' || payload.rating === null)) {
    fields.push({
      key: 'rating',
      label: getMetadataFieldLabel('rating'),
      currentValues,
      proposedText: formatProposedMetadataValue('rating', payload.rating, payload.rating === null ? 'clear' : 'known'),
      proposedKind: payload.rating === null ? 'clear' : 'known',
    });
  }

  if (typeof payload.latitude === 'number' && typeof payload.longitude === 'number') {
    fields.push({
      key: 'location',
      label: getMetadataFieldLabel('location'),
      currentValues,
      proposedText: rawMetadataText(`${payload.latitude}, ${payload.longitude}`),
      proposedKind: 'known',
    });
  }

  for (const key of ['dateTimeOriginal', 'dateTimeRelative', 'timeZone']) {
    if (!Object.hasOwn(payload, key)) {
      continue;
    }

    fields.push({
      key,
      label: getMetadataFieldLabel(key),
      currentValues,
      proposedText: formatProposedMetadataValue(
        key,
        payload[key],
        key === 'dateTimeRelative' ? 'relative' : getMetadataValueKind(undefined),
      ),
      proposedKind: key === 'dateTimeRelative' ? 'relative' : 'known',
    });
  }

  return fields;
};

const getMetadataValueKind = (value: unknown): AgentOperationMetadataValueKind =>
  value === 'known' || value === 'empty' || value === 'clear' || value === 'relative' || value === 'unknown'
    ? value
    : 'known';

const rawMetadataText = (text: string): AgentOperationMetadataDisplayText => ({ kind: 'raw', text });

const translatedMetadataText = (
  key: Translations,
  values?: Record<string, string | number>,
): AgentOperationMetadataDisplayText => ({
  kind: 'translation',
  key,
  ...(values ? { values } : {}),
});

const getMetadataFieldLabel = (key: string) => {
  switch (key) {
    case 'description': {
      return translatedMetadataText('assistant_operation_metadata_field_description' as Translations);
    }
    case 'rating': {
      return translatedMetadataText('assistant_operation_metadata_field_rating' as Translations);
    }
    case 'dateTimeOriginal': {
      return translatedMetadataText('assistant_operation_metadata_field_date_taken' as Translations);
    }
    case 'dateTimeRelative': {
      return translatedMetadataText('assistant_operation_metadata_field_date_shift' as Translations);
    }
    case 'timeZone': {
      return translatedMetadataText('assistant_operation_metadata_field_time_zone' as Translations);
    }
    case 'location': {
      return translatedMetadataText('assistant_operation_metadata_field_location' as Translations);
    }
    default: {
      return translatedMetadataText('assistant_operation_metadata_field_unknown' as Translations);
    }
  }
};

const formatMetadataValue = (key: string, value: unknown, kind: AgentOperationMetadataValueKind) => {
  if (kind === 'unknown') {
    return translatedMetadataText('assistant_operation_metadata_value_unavailable' as Translations);
  }

  if (key === 'rating') {
    const rating = parseMetadataNumber(value);
    return rating === undefined
      ? translatedMetadataText('assistant_operation_metadata_value_unrated' as Translations)
      : translatedMetadataText('assistant_operation_metadata_value_rating' as Translations, { rating });
  }

  if (kind === 'empty' || value === null || value === undefined || value === '') {
    return key === 'description'
      ? translatedMetadataText('assistant_operation_metadata_value_empty' as Translations)
      : translatedMetadataText('assistant_operation_metadata_value_unavailable' as Translations);
  }

  return rawMetadataText(String(value));
};

const formatProposedMetadataValue = (key: string, value: unknown, kind: AgentOperationMetadataValueKind) => {
  if (kind === 'clear') {
    return key === 'rating'
      ? translatedMetadataText('assistant_operation_metadata_value_clear_rating' as Translations)
      : translatedMetadataText('assistant_operation_metadata_value_clear' as Translations);
  }

  if (kind === 'relative') {
    const minutes = parseMetadataNumber(value);
    return minutes === undefined
      ? translatedMetadataText('assistant_operation_metadata_value_shift_capture_time' as Translations)
      : translatedMetadataText('assistant_operation_metadata_value_shift_minutes' as Translations, { minutes });
  }

  return formatMetadataValue(key, value, kind);
};

const parseMetadataNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
};

const getStringArray = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;

const getAssetResultDetails = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const results = value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.success !== 'boolean') {
      return [];
    }

    return [
      {
        id: item.id,
        success: item.success,
        ...(typeof item.errorMessage === 'string' ? { errorMessage: item.errorMessage } : {}),
      },
    ];
  });

  return results.length > 0 ? results : undefined;
};

const buildSparseOperationFieldOverrides = (editableFields: AgentOperationEditableField[]): Record<string, string> =>
  Object.fromEntries(
    editableFields.flatMap((field) => {
      if (field.value === field.originalValue || typeof field.value !== 'string') {
        return [];
      }

      return [[field.key, field.input === 'textarea' || field.input === 'text' ? field.value.trim() : field.value]];
    }),
  );

const applyOperationFieldOverrides = (
  operation: AgentOperationResponseDto,
  fieldOverrides: Record<string, string> | undefined,
) => {
  if (
    !fieldOverrides ||
    (operation.type !== AgentOperationType.AlbumCreate &&
      operation.type !== AgentOperationType.AlbumUpdateDetails &&
      operation.type !== AgentOperationType.SpaceUpdateDetails)
  ) {
    return operation;
  }

  const payload = { ...operation.payload };
  const albumName = getStringOverride(fieldOverrides, 'albumName');
  const spaceName = getStringOverride(fieldOverrides, 'spaceName');
  const description = getStringOverride(fieldOverrides, 'description');
  const color = getStringOverride(fieldOverrides, 'color');

  if (albumName !== undefined) {
    payload.albumName = albumName;
  }

  if (spaceName !== undefined) {
    payload.spaceName = spaceName;
  }

  if (description !== undefined) {
    payload.description = description;
  }

  if (color !== undefined) {
    payload.color = color;
  }

  return { ...operation, payload };
};

const getStringOverride = (fieldOverrides: Record<string, string> | undefined, key: string) => {
  const value = fieldOverrides?.[key];
  return typeof value === 'string' ? value : undefined;
};

const getRawStringPayloadValue = (operation: AgentOperationResponseDto, key: string) => {
  const value = operation.payload[key];
  return typeof value === 'string' ? value : '';
};

const buildOperationReviewSelection = (
  operation: Pick<AgentOperationResponseDto, 'assetIds' | 'payload' | 'type'>,
  included: boolean,
  itemSelection?: AgentOperationItemSelectionPayload,
): AgentReviewSelection => {
  const itemKind = getOperationItemKind(operation);
  const itemIdsForOperation = getOperationSelectableItemIds(operation);
  const totalCount = itemIdsForOperation.length;
  const supportsItemSelection = totalCount > 0;

  if (!included) {
    return {
      itemKind,
      totalCount,
      selectedCount: 0,
      mode: 'none',
      supportsItemSelection,
    };
  }

  if (!supportsItemSelection) {
    return {
      itemKind,
      totalCount,
      selectedCount: 0,
      mode: 'all',
      supportsItemSelection: false,
    };
  }

  const selection = itemSelection?.itemKind === itemKind ? itemSelection : { itemKind, mode: 'all' as const };
  const itemIds = (selection.itemIds ?? []).filter((itemId) => itemIdsForOperation.includes(itemId));

  if (selection.mode === 'allExcept') {
    return {
      itemKind,
      totalCount,
      selectedCount: Math.max(totalCount - itemIds.length, 0),
      mode: 'allExcept',
      itemIds,
      supportsItemSelection: true,
    };
  }

  if (selection.mode === 'only') {
    return {
      itemKind,
      totalCount,
      selectedCount: itemIds.length,
      mode: 'only',
      itemIds,
      supportsItemSelection: true,
    };
  }

  if (selection.mode === 'none') {
    return {
      itemKind,
      totalCount,
      selectedCount: 0,
      mode: 'none',
      supportsItemSelection: true,
    };
  }

  return {
    itemKind,
    totalCount,
    selectedCount: totalCount,
    mode: 'all',
    supportsItemSelection: true,
  };
};

const getOperationItemKind = (operation: Pick<AgentOperationResponseDto, 'type'>): AgentReviewItemKind =>
  isMemberOperation(operation.type) ? 'person' : 'asset';

const getOperationForReview = (operation: AgentOperationResponseDto): AgentOperationResponseDto => {
  const result = isRecord(operation.result) ? operation.result : undefined;
  const appliedAssetIds = getStringArray(result?.assetIds);

  if (
    operation.status === AgentOperationStatus.Applied &&
    operation.type === AgentOperationType.AssetUpdateMetadata &&
    appliedAssetIds &&
    appliedAssetIds.length > 0
  ) {
    return { ...operation, assetIds: appliedAssetIds };
  }

  return operation;
};

const getOperationSelectableItemIds = (operation: Pick<AgentOperationResponseDto, 'assetIds' | 'payload' | 'type'>) =>
  isMemberOperation(operation.type) ? getOperationUserIds(operation) : [...new Set(operation.assetIds)];

const isMemberOperation = (operationType: AgentOperationType | string) =>
  operationType === AgentOperationType.SpaceAddMembers ||
  operationType === AgentOperationType.SpaceRemoveMembers ||
  operationType === AgentOperationType.SpaceUpdateMemberRole;

const getOperationUserIds = (operation: Pick<AgentOperationResponseDto, 'payload' | 'type'>) => {
  if (operation.type === AgentOperationType.SpaceAddMembers) {
    const members = Array.isArray(operation.payload.members) ? operation.payload.members : [];
    return [
      ...new Set(
        members.flatMap((member) => (isRecord(member) && typeof member.userId === 'string' ? [member.userId] : [])),
      ),
    ];
  }

  if (
    operation.type === AgentOperationType.SpaceRemoveMembers ||
    operation.type === AgentOperationType.SpaceUpdateMemberRole
  ) {
    return [...new Set(getStringArray(operation.payload.userIds))];
  }

  return [];
};

const getSelectedAssetIds = (
  operation: Pick<AgentOperationResponseDto, 'assetIds'>,
  selection: AgentReviewSelection,
) => {
  const assetIds = [...new Set(operation.assetIds)];

  if (!selection.supportsItemSelection) {
    return assetIds;
  }

  if (selection.mode === 'all') {
    return assetIds;
  }

  if (selection.mode === 'allExcept') {
    const excludedAssetIds = new Set(selection.itemIds);
    return assetIds.filter((assetId) => !excludedAssetIds.has(assetId));
  }

  if (selection.mode === 'only') {
    const includedAssetIds = new Set(selection.itemIds);
    return assetIds.filter((assetId) => includedAssetIds.has(assetId));
  }

  return [];
};

const normalizeItemIds = (itemIds: string[]) => [...new Set(itemIds)];

const normalizeSelection = (selection: AgentOperationItemSelectionPayload): AgentOperationItemSelectionPayload => {
  const itemIds = selection.itemIds ? normalizeItemIds(selection.itemIds) : undefined;
  return itemIds ? { ...selection, itemIds } : selection;
};

const getThumbnailSummary = (
  operations: Pick<AgentOperationResponseDto, 'assetIds'>[],
): AgentReviewThumbnailSummary => {
  const totalCount = getOperationAssetCount(operations);
  const representativeAssetIds = getRepresentativeAssetIds(operations);

  return {
    totalCount,
    representativeAssetIds,
    hasMore: totalCount > representativeAssetIds.length,
  };
};

const getRepresentativeAssetIds = (operations: Pick<AgentOperationResponseDto, 'assetIds'>[]) => {
  const representativeAssetIds: string[] = [];
  const seenAssetIds = new Set<string>();

  for (const [operationIndex, operation] of operations.entries()) {
    if (representativeAssetIds.length >= representativeAssetLimit) {
      break;
    }

    const remainingOperationsWithAssets = operations
      .slice(operationIndex + 1)
      .filter((operation) => operation.assetIds.length > 0).length;
    const remainingSlots = representativeAssetLimit - representativeAssetIds.length;
    const assetLimit = Math.max(1, remainingSlots - remainingOperationsWithAssets);
    let addedAssetCount = 0;

    for (const assetId of operation.assetIds) {
      if (representativeAssetIds.length >= representativeAssetLimit || addedAssetCount >= assetLimit) {
        break;
      }

      if (seenAssetIds.has(assetId)) {
        continue;
      }

      seenAssetIds.add(assetId);
      representativeAssetIds.push(assetId);
      addedAssetCount++;
    }
  }

  return representativeAssetIds;
};

const getGroupId = (operation: AgentOperationResponseDto) => {
  if (operation.targetKind === AgentOperationTargetKind.NewAlbum) {
    return `new-album:${operation.temporaryTargetId ?? operation.id}`;
  }

  if (operation.targetKind === AgentOperationTargetKind.ExistingAlbum && operation.targetId) {
    return `existing-album:${operation.targetId}`;
  }

  if (operation.targetKind === AgentOperationTargetKind.NewSpace) {
    return `new-space:${operation.temporaryTargetId ?? operation.id}`;
  }

  if (operation.targetKind === AgentOperationTargetKind.ExistingSpace && operation.targetId) {
    return `existing-space:${operation.targetId}`;
  }

  return `operation:${operation.id}`;
};

const getGroupTitle = (operation: AgentOperationResponseDto) => {
  if (operation.targetKind === AgentOperationTargetKind.NewAlbum) {
    return `New album "${getAlbumName(operation) ?? operation.temporaryTargetId ?? 'Untitled album'}"`;
  }

  if (operation.targetKind === AgentOperationTargetKind.ExistingAlbum) {
    return operation.targetId ? `Existing album ${operation.targetId}` : 'Existing album';
  }

  if (operation.targetKind === AgentOperationTargetKind.NewSpace) {
    return `New space "${getSpaceName(operation) ?? operation.temporaryTargetId ?? 'Untitled space'}"`;
  }

  if (operation.targetKind === AgentOperationTargetKind.ExistingSpace) {
    return operation.targetId ? `Existing space ${operation.targetId}` : 'Existing space';
  }

  return operation.summary;
};

const highlightCriteriaPattern =
  /\b((?:metadata-only|preview-assisted) suggested highlights? (?:prioritized|prioritizing|considered) [^.]+)(?:\.|$)/i;

const normalizeCriteriaSentence = (criteria: string) => {
  const normalized = criteria.trim().replaceAll(/\s+/g, ' ');
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1).replace(/\.$/, '')}.`;
};

const getHighlightCurationCriteria = (summaries: string[]) => {
  for (const summary of summaries) {
    const match = summary.match(highlightCriteriaPattern);
    if (match?.[1]) {
      return normalizeCriteriaSentence(match[1]);
    }
  }
};

const groupHasSuggestedHighlights = (operations: OperationReviewItem[]) =>
  operations.some(({ operation }) => /\bsuggested highlights?\b/i.test(operation.summary));

const getOperationReviewSummary = (operation: AgentOperationResponseDto) => {
  switch (operation.type) {
    case AgentOperationType.AlbumCreate: {
      return `Create album "${getAlbumName(operation) ?? operation.temporaryTargetId ?? 'Untitled album'}"`;
    }
    case AgentOperationType.AlbumAddAssets: {
      return `Add ${formatPhotoCount(getOperationAssetCount([operation]))}`;
    }
    case AgentOperationType.AlbumSetCover: {
      return 'Set cover photo';
    }
    case AgentOperationType.AlbumUpdateDetails: {
      const albumName = getAlbumName(operation);
      if (albumName) {
        return `Rename album to "${albumName}"`;
      }

      return 'Update album details';
    }
    case AgentOperationType.SpaceAddAssets: {
      return `Add ${formatPhotoCount(getOperationAssetCount([operation]))}`;
    }
    case AgentOperationType.SpaceRemoveAssets: {
      return `Remove ${formatPhotoCount(getOperationAssetCount([operation]))}`;
    }
    case AgentOperationType.SpaceUpdateDetails: {
      return getSpaceUpdateDetailsSummary(operation);
    }
    case AgentOperationType.SpaceAddMembers: {
      return `Add ${formatPersonCount(getOperationUserIds(operation).length)}`;
    }
    case AgentOperationType.SpaceRemoveMembers: {
      return `Remove ${formatPersonCount(getOperationUserIds(operation).length)}`;
    }
    case AgentOperationType.SpaceUpdateMemberRole: {
      const role = typeof operation.payload.role === 'string' ? operation.payload.role : 'member';
      return `Change ${formatPersonCount(getOperationUserIds(operation).length)} to ${role}`;
    }
    case AgentOperationType.AssetUpdateMetadata: {
      const verb = operation.status === AgentOperationStatus.Applied ? 'Updated' : 'Update';
      return `${verb} metadata for ${formatPhotoCount(getOperationAssetCount([operation]))}`;
    }
    default: {
      return operation.summary;
    }
  }
};

const getSpaceUpdateDetailsSummary = (operation: AgentOperationResponseDto) => {
  const summaries: string[] = [];
  const spaceName = getSpaceName(operation);
  const description = getRawStringPayloadValue(operation, 'description');
  const color = getRawStringPayloadValue(operation, 'color');

  if (spaceName) {
    summaries.push(`Renamed to "${spaceName}"`);
  }

  if (typeof operation.payload.description === 'string') {
    summaries.push(description.trim().length === 0 ? 'Cleared description' : 'Updated description');
  }

  if (color) {
    summaries.push(`Changed color to ${color}`);
  }

  return summaries.length > 0 ? summaries.join('; ') : 'Update space details';
};

const formatPhotoCount = (count: number) => `${count} ${count === 1 ? 'photo' : 'photos'}`;
const formatPersonCount = (count: number) => `${count} ${count === 1 ? 'person' : 'people'}`;

const getReviewDestination = (
  operation: AgentOperationResponseDto,
  operationById: Map<string, AgentOperationResponseDto>,
): AgentReviewDestination => {
  if (
    operation.targetKind === AgentOperationTargetKind.NewAlbum ||
    operation.targetKind === AgentOperationTargetKind.ExistingAlbum
  ) {
    const createOperation =
      operation.temporaryTargetId === null
        ? undefined
        : [...operationById.values()].find(
            (candidate) =>
              candidate.type === AgentOperationType.AlbumCreate &&
              candidate.temporaryTargetId === operation.temporaryTargetId,
          );
    const albumName = getAlbumName(operation) ?? (createOperation ? getAlbumName(createOperation) : undefined);
    const destination: AgentReviewDestination = {
      kind: 'album',
      name: albumName ?? getGroupTitle(operation),
      subtitle: operation.targetKind === AgentOperationTargetKind.NewAlbum ? 'New album' : 'Existing album',
    };

    if (operation.targetId) {
      destination.id = operation.targetId;
    }

    if (operation.temporaryTargetId) {
      destination.temporaryId = operation.temporaryTargetId;
    }

    return destination;
  }

  if (
    operation.targetKind === AgentOperationTargetKind.NewSpace ||
    operation.targetKind === AgentOperationTargetKind.ExistingSpace
  ) {
    const createOperation =
      operation.temporaryTargetId === null
        ? undefined
        : [...operationById.values()].find(
            (candidate) =>
              candidate.targetKind === AgentOperationTargetKind.NewSpace &&
              candidate.temporaryTargetId === operation.temporaryTargetId,
          );
    const spaceName = getSpaceName(operation) ?? (createOperation ? getSpaceName(createOperation) : undefined);
    const destination: AgentReviewDestination = {
      kind: 'space',
      name: spaceName ?? getGroupTitle(operation),
      subtitle: operation.targetKind === AgentOperationTargetKind.NewSpace ? 'New space' : 'Existing space',
    };

    if (operation.targetId) {
      destination.id = operation.targetId;
    }

    if (operation.temporaryTargetId) {
      destination.temporaryId = operation.temporaryTargetId;
    }

    return destination;
  }

  const rawTargetKind = String(operation.targetKind);
  if (rawTargetKind.includes('space')) {
    return { kind: 'space', name: operation.summary };
  }

  if (rawTargetKind.includes('asset') || rawTargetKind.includes('image')) {
    return { kind: rawTargetKind.includes('image') ? 'imageEditBatch' : 'assetBatch', name: operation.summary };
  }

  return { kind: 'library', name: operation.summary };
};

const getDestination = (
  operation: AgentOperationResponseDto,
  operationById: Map<string, AgentOperationResponseDto>,
  subtitle: string,
  titleOverride?: string,
): OperationReviewDestination => ({
  ...getReviewDestination(operation, operationById),
  title: titleOverride ?? getGroupTitle(operation),
  subtitle,
});

const getAlbumName = (operation: AgentOperationResponseDto) => {
  const albumName = operation.payload.albumName;

  return typeof albumName === 'string' && albumName.trim().length > 0 ? albumName.trim() : undefined;
};

const getSpaceName = (operation: AgentOperationResponseDto) => {
  const spaceName = operation.payload.spaceName;

  return typeof spaceName === 'string' && spaceName.trim().length > 0 ? spaceName.trim() : undefined;
};
