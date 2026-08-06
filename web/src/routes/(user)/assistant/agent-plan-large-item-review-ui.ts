import type { AgentOperationItemSelectionPayload, OperationItemSelectionState } from './agent-operation-plan-ui';

export type AgentPlanReviewAssetKind = 'image' | 'video' | 'unknown';

export type AgentPlanReviewAssetMetadata = {
  id: string;
  label?: string;
  filename?: string;
  kind?: AgentPlanReviewAssetKind;
  createdAt?: string;
  sourceAlbumName?: string;
  personNames?: string[];
  tagNames?: string[];
  locationLabel?: string;
  duplicateKey?: string;
  isScreenshot?: boolean;
};

export type AgentPlanItemFilterState = {
  query: string;
  kind: 'all' | 'image' | 'video';
  dateFrom?: string;
  dateTo?: string;
  sourceAlbumName?: string;
  personName?: string;
  tagName?: string;
  locationLabel?: string;
  quickFilter?: 'screenshots' | 'duplicates';
};

export type AgentPlanItemVirtualWindowInput = {
  assetIds: string[];
  scrollTop: number;
  viewportHeight: number;
  itemSize: number;
  columnCount: number;
  overscanRows: number;
};

export type AgentPlanItemVirtualWindow = {
  totalAssetCount: number;
  totalRows: number;
  startIndex: number;
  endIndex: number;
  visibleAssetIds: string[];
  beforeHeight: number;
  afterHeight: number;
};

export type AgentPlanAvailableFilterFacets = {
  hasKind: boolean;
  hasDates: boolean;
  hasSourceAlbums: boolean;
  hasPeople: boolean;
  hasTags: boolean;
  hasLocations: boolean;
  hasScreenshots: boolean;
  hasDuplicates: boolean;
};

export const buildAgentPlanItemVirtualWindow = ({
  assetIds,
  scrollTop,
  viewportHeight,
  itemSize,
  columnCount,
  overscanRows,
}: AgentPlanItemVirtualWindowInput): AgentPlanItemVirtualWindow => {
  const safeColumnCount = Math.max(1, Math.floor(columnCount));
  const safeItemSize = Math.max(1, itemSize);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const safeOverscanRows = Math.max(0, Math.floor(overscanRows));
  const totalAssetCount = assetIds.length;
  const totalRows = Math.ceil(totalAssetCount / safeColumnCount);
  const maxScrollTop = Math.max(0, totalRows * safeItemSize - safeViewportHeight);
  const clampedScrollTop = Math.min(Math.max(0, scrollTop), maxScrollTop);
  const firstVisibleRow = Math.floor(clampedScrollTop / safeItemSize);
  const visibleRowCount = Math.ceil(safeViewportHeight / safeItemSize);
  const startRow = Math.max(0, firstVisibleRow - safeOverscanRows);
  const endRow = Math.min(totalRows, firstVisibleRow + visibleRowCount + safeOverscanRows);
  const startIndex = Math.min(totalAssetCount, startRow * safeColumnCount);
  const endIndex = Math.min(totalAssetCount, endRow * safeColumnCount);

  return {
    totalAssetCount,
    totalRows,
    startIndex,
    endIndex,
    visibleAssetIds: assetIds.slice(startIndex, endIndex),
    beforeHeight: startRow * safeItemSize,
    afterHeight: Math.max(0, totalRows - endRow) * safeItemSize,
  };
};

export const buildAgentPlanReviewAssets = (
  assetIds: string[],
  metadataByAssetId: Record<string, AgentPlanReviewAssetMetadata | undefined> = {},
): AgentPlanReviewAssetMetadata[] => assetIds.map((id) => ({ ...metadataByAssetId[id], id }));

export const filterAgentPlanReviewAssets = (
  assets: AgentPlanReviewAssetMetadata[],
  filter: AgentPlanItemFilterState,
): AgentPlanReviewAssetMetadata[] => {
  const duplicateCounts = getDuplicateCounts(assets);
  const normalizedQuery = filter.query.trim().toLocaleLowerCase();

  return assets.filter((asset) => {
    if (
      normalizedQuery &&
      !getSearchableAssetText(asset).some((part) => part.toLocaleLowerCase().includes(normalizedQuery))
    ) {
      return false;
    }

    if (filter.kind !== 'all' && asset.kind !== filter.kind) {
      return false;
    }

    const createdDate = asset.createdAt?.slice(0, 10);
    if (filter.dateFrom && (!createdDate || createdDate < filter.dateFrom)) {
      return false;
    }

    if (filter.dateTo && (!createdDate || createdDate > filter.dateTo)) {
      return false;
    }

    if (filter.sourceAlbumName && asset.sourceAlbumName !== filter.sourceAlbumName) {
      return false;
    }

    if (filter.personName && !asset.personNames?.includes(filter.personName)) {
      return false;
    }

    if (filter.tagName && !asset.tagNames?.includes(filter.tagName)) {
      return false;
    }

    if (filter.locationLabel && asset.locationLabel !== filter.locationLabel) {
      return false;
    }

    if (filter.quickFilter === 'screenshots' && !asset.isScreenshot) {
      return false;
    }

    if (
      filter.quickFilter === 'duplicates' &&
      (!asset.duplicateKey || (duplicateCounts.get(asset.duplicateKey) ?? 0) <= 1)
    ) {
      return false;
    }

    return true;
  });
};

export const getAgentPlanAvailableFilterFacets = (
  assets: AgentPlanReviewAssetMetadata[],
): AgentPlanAvailableFilterFacets => {
  const duplicateCounts = getDuplicateCounts(assets);

  return {
    hasKind: assets.some((asset) => asset.kind === 'image' || asset.kind === 'video'),
    hasDates: assets.some((asset) => Boolean(asset.createdAt)),
    hasSourceAlbums: assets.some((asset) => Boolean(asset.sourceAlbumName)),
    hasPeople: assets.some((asset) => Boolean(asset.personNames?.length)),
    hasTags: assets.some((asset) => Boolean(asset.tagNames?.length)),
    hasLocations: assets.some((asset) => Boolean(asset.locationLabel)),
    hasScreenshots: assets.some((asset) => asset.isScreenshot === true),
    hasDuplicates: [...duplicateCounts.values()].some((count) => count > 1),
  };
};

export const getAgentPlanSparseSelectedCount = (
  totalAssetCount: number,
  selection?: AgentOperationItemSelectionPayload,
): number => {
  const total = Math.max(0, Math.floor(totalAssetCount));

  if (!selection || selection.mode === 'all') {
    return total;
  }

  if (selection.mode === 'none') {
    return 0;
  }

  const itemCount = selection.itemIds?.length ?? 0;
  const selectedCount = selection.mode === 'allExcept' ? total - itemCount : itemCount;

  return Math.min(Math.max(selectedCount, 0), total);
};

export const applyAgentPlanBulkItemSelection = ({
  state,
  operationId,
  allAssetIds,
  targetAssetIds,
  selected,
}: {
  state: OperationItemSelectionState;
  operationId: string;
  allAssetIds: string[];
  targetAssetIds: string[];
  selected: boolean;
}): OperationItemSelectionState => {
  const knownAssetIds = dedupePreservingOrder(allAssetIds);
  const targetIds = filterKnownAssetIds(targetAssetIds, knownAssetIds);

  if (targetIds.length === 0) {
    return state;
  }

  const selectedIds = getSelectedIdsFromSparseSelection(knownAssetIds, state[operationId]);

  for (const assetId of targetIds) {
    if (selected) {
      selectedIds.add(assetId);
    } else {
      selectedIds.delete(assetId);
    }
  }

  return setNormalizedSparseSelection(state, operationId, knownAssetIds, selectedIds);
};

export const setAgentPlanOnlyItemSelection = ({
  state,
  operationId,
  allAssetIds,
  targetAssetIds,
}: {
  state: OperationItemSelectionState;
  operationId: string;
  allAssetIds: string[];
  targetAssetIds: string[];
}): OperationItemSelectionState => {
  const knownAssetIds = dedupePreservingOrder(allAssetIds);
  const targetIds = filterKnownAssetIds(targetAssetIds, knownAssetIds);

  return setNormalizedSparseSelection(state, operationId, knownAssetIds, new Set(targetIds));
};

const getSearchableAssetText = (asset: AgentPlanReviewAssetMetadata): string[] => [
  asset.id,
  asset.label ?? '',
  asset.filename ?? '',
  asset.sourceAlbumName ?? '',
  asset.locationLabel ?? '',
  ...(asset.personNames ?? []),
  ...(asset.tagNames ?? []),
];

const getDuplicateCounts = (assets: AgentPlanReviewAssetMetadata[]) => {
  const counts = new Map<string, number>();

  for (const { duplicateKey } of assets) {
    if (!duplicateKey) {
      continue;
    }

    counts.set(duplicateKey, (counts.get(duplicateKey) ?? 0) + 1);
  }

  return counts;
};

const dedupePreservingOrder = (assetIds: string[]) => [...new Set(assetIds)];

const filterKnownAssetIds = (assetIds: string[], knownAssetIds: string[]) => {
  const knownAssetIdSet = new Set(knownAssetIds);

  return dedupePreservingOrder(assetIds).filter((assetId) => knownAssetIdSet.has(assetId));
};

const getSelectedIdsFromSparseSelection = (
  knownAssetIds: string[],
  selection?: AgentOperationItemSelectionPayload,
): Set<string> => {
  if (!selection || selection.mode === 'all') {
    return new Set(knownAssetIds);
  }

  if (selection.mode === 'none') {
    return new Set();
  }

  const selectionIds = filterKnownAssetIds(selection.itemIds ?? [], knownAssetIds);

  if (selection.mode === 'allExcept') {
    const excludedAssetIds = new Set(selectionIds);
    return new Set(knownAssetIds.filter((assetId) => !excludedAssetIds.has(assetId)));
  }

  return new Set(selectionIds);
};

const setNormalizedSparseSelection = (
  state: OperationItemSelectionState,
  operationId: string,
  knownAssetIds: string[],
  selectedIds: Set<string>,
): OperationItemSelectionState => {
  const orderedSelectedIds = knownAssetIds.filter((assetId) => selectedIds.has(assetId));
  const totalCount = knownAssetIds.length;

  if (orderedSelectedIds.length === totalCount) {
    return removeSparseSelection(state, operationId);
  }

  if (orderedSelectedIds.length === 0) {
    return {
      ...state,
      [operationId]: { itemKind: 'asset', mode: 'none' },
    };
  }

  const selectedIdSet = new Set(orderedSelectedIds);
  const orderedUnselectedIds = knownAssetIds.filter((assetId) => !selectedIdSet.has(assetId));
  const selection: AgentOperationItemSelectionPayload =
    orderedUnselectedIds.length < orderedSelectedIds.length
      ? { itemKind: 'asset', mode: 'allExcept', itemIds: orderedUnselectedIds }
      : { itemKind: 'asset', mode: 'only', itemIds: orderedSelectedIds };

  return {
    ...state,
    [operationId]: selection,
  };
};

const removeSparseSelection = (
  state: OperationItemSelectionState,
  operationId: string,
): OperationItemSelectionState => {
  const { [operationId]: _, ...remaining } = state;
  return remaining;
};
