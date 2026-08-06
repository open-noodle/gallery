# Pi Agent Visual Plan Review Slice 6 Large-Plan Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make expanded Pi plan review usable for hundreds or thousands of affected photos by adding virtualized grids, bounded thumbnail rendering, filters, and sparse bulk selection actions.

**Architecture:** Keep this slice frontend-first and preserve the existing plan/apply API. Add a pure helper module for virtual windowing, optional metadata filtering, and sparse bulk selection transforms, then wire it into the existing `AgentPlanItemReview` and parent review panel callbacks. Metadata-based filters only render when metadata exists; the current plan DTO only guarantees asset IDs, so the UI must degrade to ID/search and visible-window bulk controls without inventing new server fields.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Testing Library, existing Pi plan review DTOs and sparse item-selection payloads.

---

## Scope

This is Slice 6 from `docs/superpowers/specs/2026-05-17-pi-agent-visual-plan-review-design.md`:

- Virtualized expanded grids for operations with hundreds or thousands of photos.
- Lazy thumbnail loading through bounded DOM mounting.
- Filters and bulk selection actions for large affected sets.
- Performance coverage proving collapsed and expanded views do not render every asset.

This slice intentionally does not add a new server review-metadata endpoint. Filters that need rich metadata, such as videos, screenshots, duplicates, people, tags, source album, date, and location, are supported by the frontend model when metadata is present and hidden when metadata is unavailable.

## Existing Code Context

- `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
  - Builds `OperationReviewModel`.
  - Holds `OperationItemSelectionState` and `OperationReviewItem`.
  - Exposes `setOperationItemSelection`, `resetOperationItemSelection`, `buildSelectionPayload`, and `isAssetSelectedForOperation`.
- `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`
  - Renders expanded item selection.
  - Currently caps visible assets with `buildAgentPlanItemReviewAssetIds(item)` and renders a fixed first 48 items.
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
  - Owns `itemSelectionByOperationId` state.
  - Publishes sparse selections through the existing apply payload.
- `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
  - Renders the expanded `<details>` and passes item toggle/reset callbacks.
- `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
  - Threads operation-row callbacks.
- `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
  - Threads destination-card callbacks.

## File Structure

- Create: `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.ts`
  - Pure helpers for virtual grid window calculation, asset metadata filtering, available filter facets, selection counts, and sparse bulk selection transforms.
- Create: `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts`
  - Unit tests for 1,000+ asset virtualization, metadata filters, filter facet availability, and sparse bulk selection behavior.
- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`
  - Replace fixed 48-item rendering with a scrollable virtual grid.
  - Add compact filter and bulk-action controls.
  - Render only visible virtual-window thumbnails plus overscan.
- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`
  - Component tests for bounded rendering, scroll window changes, filter controls, bulk action callbacks, image failure fallback, and disabled state.
- Modify: `web/src/lib/i18n/en.json`
  - English copy for filter labels, media filter buttons, bulk action buttons, and virtual-window summary text.
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`
  - Regression coverage that the new English i18n keys exist.
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
  - Add `onBulkSetItems` and `onSetOnlyItems` props and pass them to `AgentPlanItemReview`.
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
  - Assert bulk action callbacks thread through row details.
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
  - Add `onBulkSetItems` and `onSetOnlyItems` props and pass them down.
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
  - Assert bulk action callbacks thread through destination cards.
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
  - Add optional `onBulkSetItems` and `onSetOnlyItems` props and pass them down.
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
  - Assert bulk action callbacks thread through the ledger.
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
  - Add the panel-level bulk selection handler using the pure sparse selection helper.
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
  - Assert bulk exclusion/inclusion updates apply payloads, counts, and state persistence across collapse/reopen.

## Data Model Decisions

Add local frontend-only types in `agent-plan-large-item-review-ui.ts`:

```ts
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
```

`AgentPlanItemReview` can build an asset list from `item.assetIds` when no metadata is available:

```ts
export const buildAgentPlanReviewAssets = (
  assetIds: string[],
  metadataByAssetId: Record<string, AgentPlanReviewAssetMetadata> = {},
) =>
  assetIds.map((id) => ({
    ...metadataByAssetId[id],
    id,
  }));
```

No server DTO changes are required for this slice.

## Test And Edge Case Coverage

This plan must add coverage for:

- 1,000+ affected assets produce a small virtual window, not 1,000 DOM nodes.
- Scroll position changes which asset IDs are rendered.
- Overscan includes nearby rows but remains bounded.
- Collapsed plan content remains bounded through existing thumbnail-strip tests plus new expanded-grid tests.
- `img` elements are only created for the virtual window, so thumbnail fetches are not started for every asset.
- Image load failure still shows the existing fallback for the mounted item.
- Filters work with optional metadata and are hidden or disabled when the needed metadata is absent.
- Query search matches asset ID, label, filename, people, tags, source album, and location when those fields exist.
- Date filter accepts inclusive `dateFrom` and `dateTo` boundaries.
- Video/image filters include unknown-kind assets only when `kind` is `all`.
- Screenshot and duplicate quick filters appear only when the expanded asset set contains that metadata.
- Bulk exclude visible, include visible, select all filtered, and deselect all filtered create compact sparse selection state.
- Bulk actions ignore unknown asset IDs.
- Excluding all items yields `none`.
- Including all items returns to the implicit `all` default.
- `allExcept` and `only` state remains stable across collapse/reopen because the parent panel owns the state.
- Disabled or already-applied plans do not enable filter-driven bulk mutation controls.
- Apply payload includes the sparse selection override produced by bulk actions.

## Task 1: Pure Virtual Window And Filter Helpers

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.ts`
- Create: `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts`

- [ ] **Step 1: Write failing tests for virtual windowing**

Add `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts` with these tests first:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildAgentPlanItemVirtualWindow,
  buildAgentPlanReviewAssets,
  filterAgentPlanReviewAssets,
  getAgentPlanAvailableFilterFacets,
  type AgentPlanItemFilterState,
  type AgentPlanReviewAssetMetadata,
} from './agent-plan-large-item-review-ui';

const assetIds = (count: number) =>
  Array.from({ length: count }, (_, index) => `asset-${String(index).padStart(4, '0')}`);

const defaultFilter: AgentPlanItemFilterState = {
  query: '',
  kind: 'all',
};

describe('buildAgentPlanItemVirtualWindow', () => {
  it('returns only the visible rows plus overscan for one thousand assets', () => {
    const window = buildAgentPlanItemVirtualWindow({
      assetIds: assetIds(1000),
      scrollTop: 0,
      viewportHeight: 360,
      itemSize: 96,
      columnCount: 6,
      overscanRows: 1,
    });

    expect(window.totalAssetCount).toBe(1000);
    expect(window.totalRows).toBe(167);
    expect(window.startIndex).toBe(0);
    expect(window.endIndex).toBe(30);
    expect(window.visibleAssetIds).toHaveLength(30);
    expect(window.visibleAssetIds[0]).toBe('asset-0000');
    expect(window.visibleAssetIds.at(-1)).toBe('asset-0029');
    expect(window.afterHeight).toBe((167 - 5) * 96);
  });

  it('moves the window when the user scrolls', () => {
    const window = buildAgentPlanItemVirtualWindow({
      assetIds: assetIds(1000),
      scrollTop: 960,
      viewportHeight: 360,
      itemSize: 96,
      columnCount: 6,
      overscanRows: 1,
    });

    expect(window.startIndex).toBe(54);
    expect(window.endIndex).toBe(90);
    expect(window.visibleAssetIds[0]).toBe('asset-0054');
    expect(window.visibleAssetIds).not.toContain('asset-0000');
    expect(window.beforeHeight).toBe(9 * 96);
  });

  it('clamps negative scroll and oversized scroll positions', () => {
    const first = buildAgentPlanItemVirtualWindow({
      assetIds: assetIds(10),
      scrollTop: -100,
      viewportHeight: 360,
      itemSize: 96,
      columnCount: 6,
      overscanRows: 1,
    });
    const last = buildAgentPlanItemVirtualWindow({
      assetIds: assetIds(10),
      scrollTop: 50_000,
      viewportHeight: 360,
      itemSize: 96,
      columnCount: 6,
      overscanRows: 1,
    });

    expect(first.visibleAssetIds).toEqual(assetIds(10));
    expect(last.visibleAssetIds).toEqual(assetIds(10));
    expect(first.beforeHeight).toBe(0);
    expect(last.afterHeight).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts"
```

Expected: fail because `agent-plan-large-item-review-ui.ts` does not exist.

- [ ] **Step 3: Implement the minimal virtual window helper**

Create `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.ts`:

```ts
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

export const buildAgentPlanItemVirtualWindow = ({
  assetIds,
  scrollTop,
  viewportHeight,
  itemSize,
  columnCount,
  overscanRows,
}: AgentPlanItemVirtualWindowInput): AgentPlanItemVirtualWindow => {
  const safeItemSize = Math.max(1, itemSize);
  const safeColumnCount = Math.max(1, columnCount);
  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const totalRows = Math.ceil(assetIds.length / safeColumnCount);
  const visibleRowCount = Math.max(1, Math.ceil(safeViewportHeight / safeItemSize));
  const maxFirstVisibleRow = Math.max(0, totalRows - visibleRowCount);
  const firstVisibleRow = Math.min(maxFirstVisibleRow, Math.floor(safeScrollTop / safeItemSize));
  const lastVisibleRow = firstVisibleRow + visibleRowCount;
  const startRow = Math.max(0, Math.min(totalRows, firstVisibleRow - overscanRows));
  const endRow = Math.max(startRow, Math.min(totalRows, lastVisibleRow + overscanRows));
  const startIndex = startRow * safeColumnCount;
  const endIndex = Math.min(assetIds.length, endRow * safeColumnCount);

  return {
    totalAssetCount: assetIds.length,
    totalRows,
    startIndex,
    endIndex,
    visibleAssetIds: assetIds.slice(startIndex, endIndex),
    beforeHeight: startRow * safeItemSize,
    afterHeight: Math.max(0, (totalRows - endRow) * safeItemSize),
  };
};

export const buildAgentPlanReviewAssets = (
  assetIds: string[],
  metadataByAssetId: Record<string, AgentPlanReviewAssetMetadata> = {},
): AgentPlanReviewAssetMetadata[] =>
  assetIds.map((id) => ({
    ...metadataByAssetId[id],
    id,
  }));

export const filterAgentPlanReviewAssets = (
  assets: AgentPlanReviewAssetMetadata[],
  _filter: AgentPlanItemFilterState,
): AgentPlanReviewAssetMetadata[] => assets;

export const getAgentPlanAvailableFilterFacets = (_assets: AgentPlanReviewAssetMetadata[]) => ({
  hasKind: false,
  hasDates: false,
  hasSourceAlbums: false,
  hasPeople: false,
  hasTags: false,
  hasLocations: false,
  hasScreenshots: false,
  hasDuplicates: false,
});
```

- [ ] **Step 4: Run the virtual window tests and verify they pass**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts"
```

Expected: the virtual window tests pass, filter tests are not present yet.

- [ ] **Step 5: Write failing tests for metadata filtering and facet availability**

Append these tests to `agent-plan-large-item-review-ui.spec.ts`:

```ts
const metadataAssets = (): AgentPlanReviewAssetMetadata[] => [
  {
    id: 'asset-1',
    label: 'Family beach',
    filename: 'IMG_1001.JPG',
    kind: 'image',
    createdAt: '2026-04-01T12:00:00.000Z',
    sourceAlbumName: 'Vacation',
    personNames: ['Pierre', 'Maya'],
    tagNames: ['beach', 'family'],
    locationLabel: 'Lisbon',
  },
  {
    id: 'asset-2',
    filename: 'Screen Shot 2026-04-03.png',
    kind: 'image',
    createdAt: '2026-04-03T08:00:00.000Z',
    isScreenshot: true,
    tagNames: ['screenshots'],
  },
  {
    id: 'asset-3',
    filename: 'clip.mov',
    kind: 'video',
    createdAt: '2026-04-05T18:00:00.000Z',
    sourceAlbumName: 'Videos',
    duplicateKey: 'dup-1',
  },
  {
    id: 'asset-4',
    filename: 'clip-copy.mov',
    kind: 'video',
    createdAt: '2026-04-06T18:00:00.000Z',
    sourceAlbumName: 'Videos',
    duplicateKey: 'dup-1',
  },
  {
    id: 'asset-5',
    filename: 'unknown.bin',
    kind: 'unknown',
  },
];

describe('filterAgentPlanReviewAssets', () => {
  it('matches query across id, label, filename, album, people, tags, and location', () => {
    expect(
      filterAgentPlanReviewAssets(metadataAssets(), { ...defaultFilter, query: 'maya' }).map((asset) => asset.id),
    ).toEqual(['asset-1']);
    expect(
      filterAgentPlanReviewAssets(metadataAssets(), { ...defaultFilter, query: 'screen shot' }).map(
        (asset) => asset.id,
      ),
    ).toEqual(['asset-2']);
    expect(
      filterAgentPlanReviewAssets(metadataAssets(), { ...defaultFilter, query: 'lisbon' }).map((asset) => asset.id),
    ).toEqual(['asset-1']);
    expect(
      filterAgentPlanReviewAssets(metadataAssets(), { ...defaultFilter, query: 'asset-3' }).map((asset) => asset.id),
    ).toEqual(['asset-3']);
  });

  it('filters by media kind and leaves unknown assets only in the all view', () => {
    expect(
      filterAgentPlanReviewAssets(metadataAssets(), { ...defaultFilter, kind: 'video' }).map((asset) => asset.id),
    ).toEqual(['asset-3', 'asset-4']);
    expect(
      filterAgentPlanReviewAssets(metadataAssets(), { ...defaultFilter, kind: 'image' }).map((asset) => asset.id),
    ).toEqual(['asset-1', 'asset-2']);
    expect(filterAgentPlanReviewAssets(metadataAssets(), defaultFilter).map((asset) => asset.id)).toContain('asset-5');
  });

  it('applies inclusive date, album, people, tag, and location filters', () => {
    const filtered = filterAgentPlanReviewAssets(metadataAssets(), {
      ...defaultFilter,
      dateFrom: '2026-04-01',
      dateTo: '2026-04-03',
      sourceAlbumName: 'Vacation',
      personName: 'Pierre',
      tagName: 'beach',
      locationLabel: 'Lisbon',
    });

    expect(filtered.map((asset) => asset.id)).toEqual(['asset-1']);
  });

  it('filters screenshots and duplicate groups with quick filters', () => {
    expect(
      filterAgentPlanReviewAssets(metadataAssets(), { ...defaultFilter, quickFilter: 'screenshots' }).map(
        (asset) => asset.id,
      ),
    ).toEqual(['asset-2']);
    expect(
      filterAgentPlanReviewAssets(metadataAssets(), { ...defaultFilter, quickFilter: 'duplicates' }).map(
        (asset) => asset.id,
      ),
    ).toEqual(['asset-3', 'asset-4']);
  });
});

describe('getAgentPlanAvailableFilterFacets', () => {
  it('reports only the facets that exist in the expanded asset set', () => {
    expect(getAgentPlanAvailableFilterFacets(metadataAssets())).toEqual({
      hasKind: true,
      hasDates: true,
      hasSourceAlbums: true,
      hasPeople: true,
      hasTags: true,
      hasLocations: true,
      hasScreenshots: true,
      hasDuplicates: true,
    });
  });

  it('does not advertise metadata filters when the plan only has asset ids', () => {
    expect(getAgentPlanAvailableFilterFacets(buildAgentPlanReviewAssets(['asset-1', 'asset-2']))).toEqual({
      hasKind: false,
      hasDates: false,
      hasSourceAlbums: false,
      hasPeople: false,
      hasTags: false,
      hasLocations: false,
      hasScreenshots: false,
      hasDuplicates: false,
    });
  });
});
```

- [ ] **Step 6: Run the tests and verify they fail for missing filtering**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts"
```

Expected: fail because filters currently return all assets and facet availability is always false.

- [ ] **Step 7: Implement filtering and facet helpers**

Replace the placeholder filter and facet helpers in `agent-plan-large-item-review-ui.ts` with:

```ts
const normalize = (value: string | undefined) => value?.trim().toLowerCase() ?? '';

const includesNormalized = (value: string | undefined, query: string) => normalize(value).includes(query);

const createdDateOnly = (createdAt: string | undefined) => createdAt?.slice(0, 10);

const matchesDateRange = (asset: AgentPlanReviewAssetMetadata, filter: AgentPlanItemFilterState) => {
  const date = createdDateOnly(asset.createdAt);
  if (!date && (filter.dateFrom || filter.dateTo)) {
    return false;
  }

  return (!filter.dateFrom || date! >= filter.dateFrom) && (!filter.dateTo || date! <= filter.dateTo);
};

const matchesQuery = (asset: AgentPlanReviewAssetMetadata, query: string) => {
  if (!query) {
    return true;
  }

  const searchable = [
    asset.id,
    asset.label,
    asset.filename,
    asset.sourceAlbumName,
    asset.locationLabel,
    ...(asset.personNames ?? []),
    ...(asset.tagNames ?? []),
  ];

  return searchable.some((value) => includesNormalized(value, query));
};

const duplicateKeys = (assets: AgentPlanReviewAssetMetadata[]) => {
  const counts = new Map<string, number>();
  for (const asset of assets) {
    if (!asset.duplicateKey) {
      continue;
    }
    counts.set(asset.duplicateKey, (counts.get(asset.duplicateKey) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
};

export const filterAgentPlanReviewAssets = (
  assets: AgentPlanReviewAssetMetadata[],
  filter: AgentPlanItemFilterState,
): AgentPlanReviewAssetMetadata[] => {
  const query = normalize(filter.query);
  const duplicateGroupKeys = filter.quickFilter === 'duplicates' ? duplicateKeys(assets) : new Set<string>();

  return assets.filter((asset) => {
    if (!matchesQuery(asset, query)) {
      return false;
    }
    if (filter.kind !== 'all' && asset.kind !== filter.kind) {
      return false;
    }
    if (!matchesDateRange(asset, filter)) {
      return false;
    }
    if (filter.sourceAlbumName && asset.sourceAlbumName !== filter.sourceAlbumName) {
      return false;
    }
    if (filter.personName && !(asset.personNames ?? []).includes(filter.personName)) {
      return false;
    }
    if (filter.tagName && !(asset.tagNames ?? []).includes(filter.tagName)) {
      return false;
    }
    if (filter.locationLabel && asset.locationLabel !== filter.locationLabel) {
      return false;
    }
    if (filter.quickFilter === 'screenshots' && !asset.isScreenshot) {
      return false;
    }
    if (filter.quickFilter === 'duplicates' && (!asset.duplicateKey || !duplicateGroupKeys.has(asset.duplicateKey))) {
      return false;
    }
    return true;
  });
};

export const getAgentPlanAvailableFilterFacets = (assets: AgentPlanReviewAssetMetadata[]) => ({
  hasKind: assets.some((asset) => asset.kind === 'image' || asset.kind === 'video'),
  hasDates: assets.some((asset) => Boolean(asset.createdAt)),
  hasSourceAlbums: assets.some((asset) => Boolean(asset.sourceAlbumName)),
  hasPeople: assets.some((asset) => (asset.personNames?.length ?? 0) > 0),
  hasTags: assets.some((asset) => (asset.tagNames?.length ?? 0) > 0),
  hasLocations: assets.some((asset) => Boolean(asset.locationLabel)),
  hasScreenshots: assets.some((asset) => asset.isScreenshot === true),
  hasDuplicates: duplicateKeys(assets).size > 0,
});
```

- [ ] **Step 8: Run the helper tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts"
```

Expected: all helper tests pass.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add "web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.ts" "web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts"
git commit -m "feat: add agent plan large item helpers"
```

## Task 2: Sparse Bulk Selection Helpers

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts`

- [ ] **Step 1: Write failing tests for sparse bulk updates**

Append these imports to `agent-plan-large-item-review-ui.spec.ts`:

```ts
import {
  applyAgentPlanBulkItemSelection,
  getAgentPlanSparseSelectedCount,
  setAgentPlanOnlyItemSelection,
} from './agent-plan-large-item-review-ui';
import { type OperationItemSelectionState } from './agent-operation-plan-ui';
```

Append these tests:

```ts
describe('applyAgentPlanBulkItemSelection', () => {
  const operationId = 'operation-1';
  const allAssetIds = assetIds(10);

  it('stores allExcept when excluding visible assets from the implicit all selection', () => {
    const next = applyAgentPlanBulkItemSelection({
      state: {},
      operationId,
      allAssetIds,
      targetAssetIds: ['asset-0001', 'asset-0002'],
      selected: false,
    });

    expect(next[operationId]).toEqual({
      itemKind: 'asset',
      mode: 'allExcept',
      itemIds: ['asset-0001', 'asset-0002'],
    });
    expect(getAgentPlanSparseSelectedCount(allAssetIds.length, next[operationId])).toBe(8);
  });

  it('returns to implicit all when included assets remove every allExcept exclusion', () => {
    const state: OperationItemSelectionState = {
      [operationId]: {
        itemKind: 'asset',
        mode: 'allExcept',
        itemIds: ['asset-0001', 'asset-0002'],
      },
    };

    const next = applyAgentPlanBulkItemSelection({
      state,
      operationId,
      allAssetIds,
      targetAssetIds: ['asset-0001', 'asset-0002'],
      selected: true,
    });

    expect(next[operationId]).toBeUndefined();
    expect(getAgentPlanSparseSelectedCount(allAssetIds.length, next[operationId])).toBe(10);
  });

  it('stores only when selecting a filtered subset from none', () => {
    const state: OperationItemSelectionState = {
      [operationId]: {
        itemKind: 'asset',
        mode: 'none',
      },
    };

    const next = applyAgentPlanBulkItemSelection({
      state,
      operationId,
      allAssetIds,
      targetAssetIds: ['asset-0004', 'asset-0005'],
      selected: true,
    });

    expect(next[operationId]).toEqual({
      itemKind: 'asset',
      mode: 'only',
      itemIds: ['asset-0004', 'asset-0005'],
    });
    expect(getAgentPlanSparseSelectedCount(allAssetIds.length, next[operationId])).toBe(2);
  });

  it('stores none when every asset is deselected', () => {
    const next = applyAgentPlanBulkItemSelection({
      state: {},
      operationId,
      allAssetIds,
      targetAssetIds: allAssetIds,
      selected: false,
    });

    expect(next[operationId]).toEqual({
      itemKind: 'asset',
      mode: 'none',
    });
    expect(getAgentPlanSparseSelectedCount(allAssetIds.length, next[operationId])).toBe(0);
  });

  it('ignores unknown target asset ids and de-duplicates incoming ids', () => {
    const next = applyAgentPlanBulkItemSelection({
      state: {},
      operationId,
      allAssetIds,
      targetAssetIds: ['asset-0001', 'asset-0001', 'asset-9999'],
      selected: false,
    });

    expect(next[operationId]).toEqual({
      itemKind: 'asset',
      mode: 'allExcept',
      itemIds: ['asset-0001'],
    });
  });

  it('de-duplicates operation asset ids before building sparse state', () => {
    const next = applyAgentPlanBulkItemSelection({
      state: {},
      operationId,
      allAssetIds: ['asset-0001', 'asset-0001', 'asset-0002'],
      targetAssetIds: ['asset-0001'],
      selected: false,
    });

    expect(next[operationId]).toEqual({
      itemKind: 'asset',
      mode: 'only',
      itemIds: ['asset-0002'],
    });
  });
});

describe('setAgentPlanOnlyItemSelection', () => {
  const operationId = 'operation-1';
  const allAssetIds = assetIds(10);

  it('replaces the current selection with only the filtered target ids', () => {
    const next = setAgentPlanOnlyItemSelection({
      state: {},
      operationId,
      allAssetIds,
      targetAssetIds: ['asset-0004', 'asset-0005'],
    });

    expect(next[operationId]).toEqual({
      itemKind: 'asset',
      mode: 'only',
      itemIds: ['asset-0004', 'asset-0005'],
    });
  });

  it('clears sparse state when the replacement target is every known asset', () => {
    const next = setAgentPlanOnlyItemSelection({
      state: {
        [operationId]: {
          itemKind: 'asset',
          mode: 'only',
          itemIds: ['asset-0004'],
        },
      },
      operationId,
      allAssetIds,
      targetAssetIds: allAssetIds,
    });

    expect(next[operationId]).toBeUndefined();
  });

  it('stores none when the replacement target has no known assets', () => {
    const next = setAgentPlanOnlyItemSelection({
      state: {},
      operationId,
      allAssetIds,
      targetAssetIds: ['asset-9999'],
    });

    expect(next[operationId]).toEqual({
      itemKind: 'asset',
      mode: 'none',
    });
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts"
```

Expected: fail because `applyAgentPlanBulkItemSelection`, `setAgentPlanOnlyItemSelection`, and `getAgentPlanSparseSelectedCount` do not exist.

- [ ] **Step 3: Implement sparse bulk helpers**

Add this code to `agent-plan-large-item-review-ui.ts`:

```ts
import type { AgentOperationItemSelectionPayload, OperationItemSelectionState } from './agent-operation-plan-ui';

type ApplyAgentPlanBulkItemSelectionInput = {
  state: OperationItemSelectionState;
  operationId: string;
  allAssetIds: string[];
  targetAssetIds: string[];
  selected: boolean;
};

const uniqueKnownIds = (targetAssetIds: string[], allAssetIds: string[]) => {
  const all = new Set(allAssetIds);
  return [...new Set(targetAssetIds)].filter((id) => all.has(id));
};

export const getAgentPlanSparseSelectedCount = (
  totalAssetCount: number,
  selection: AgentOperationItemSelectionPayload | undefined,
) => {
  if (!selection || selection.mode === 'all') {
    return totalAssetCount;
  }
  if (selection.mode === 'none') {
    return 0;
  }
  if (selection.mode === 'allExcept') {
    return Math.max(0, totalAssetCount - (selection.itemIds?.length ?? 0));
  }
  return Math.min(totalAssetCount, selection.itemIds?.length ?? 0);
};

const normalizeSelection = (
  totalAssetCount: number,
  allAssetIds: string[],
  selectedIds: Set<string>,
): AgentOperationItemSelectionPayload | undefined => {
  if (selectedIds.size === totalAssetCount) {
    return undefined;
  }
  if (selectedIds.size === 0) {
    return { itemKind: 'asset', mode: 'none' };
  }

  const unselectedCount = totalAssetCount - selectedIds.size;
  if (unselectedCount < selectedIds.size) {
    return {
      itemKind: 'asset',
      mode: 'allExcept',
      itemIds: allAssetIds.filter((id) => !selectedIds.has(id)),
    };
  }

  return {
    itemKind: 'asset',
    mode: 'only',
    itemIds: allAssetIds.filter((id) => selectedIds.has(id)),
  };
};

export const applyAgentPlanBulkItemSelection = ({
  state,
  operationId,
  allAssetIds,
  targetAssetIds,
  selected,
}: ApplyAgentPlanBulkItemSelectionInput): OperationItemSelectionState => {
  const knownAllAssetIds = [...new Set(allAssetIds)];
  const knownTargetIds = uniqueKnownIds(targetAssetIds, knownAllAssetIds);
  if (knownTargetIds.length === 0) {
    return state;
  }

  const current = state[operationId];
  const excludedIds = new Set(current?.mode === 'allExcept' ? (current.itemIds ?? []) : []);
  const selectedIds =
    !current || current.mode === 'all'
      ? new Set(knownAllAssetIds)
      : current.mode === 'none'
        ? new Set<string>()
        : current.mode === 'only'
          ? new Set(current.itemIds ?? [])
          : new Set(knownAllAssetIds.filter((id) => !excludedIds.has(id)));

  for (const assetId of knownTargetIds) {
    if (selected) {
      selectedIds.add(assetId);
    } else {
      selectedIds.delete(assetId);
    }
  }

  const normalized = normalizeSelection(knownAllAssetIds.length, knownAllAssetIds, selectedIds);
  const next = { ...state };
  if (!normalized) {
    delete next[operationId];
    return next;
  }

  next[operationId] = normalized;
  return next;
};

export const setAgentPlanOnlyItemSelection = ({
  state,
  operationId,
  allAssetIds,
  targetAssetIds,
}: Omit<ApplyAgentPlanBulkItemSelectionInput, 'selected'>): OperationItemSelectionState => {
  const knownAllAssetIds = [...new Set(allAssetIds)];
  const knownTargetIds = uniqueKnownIds(targetAssetIds, knownAllAssetIds);
  const normalized = normalizeSelection(knownAllAssetIds.length, knownAllAssetIds, new Set(knownTargetIds));
  const next = { ...state };

  if (!normalized) {
    delete next[operationId];
    return next;
  }

  next[operationId] = normalized;
  return next;
};
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts"
```

Expected: all helper tests pass.

- [ ] **Step 5: Add a regression test for compact mode choice**

Add this test:

```ts
it('uses allExcept when the excluded side is smaller than the included side', () => {
  const next = applyAgentPlanBulkItemSelection({
    state: {},
    operationId,
    allAssetIds: assetIds(100),
    targetAssetIds: ['asset-0001', 'asset-0002', 'asset-0003'],
    selected: false,
  });

  expect(next[operationId]).toEqual({
    itemKind: 'asset',
    mode: 'allExcept',
    itemIds: ['asset-0001', 'asset-0002', 'asset-0003'],
  });
});
```

- [ ] **Step 6: Run helper tests again**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts"
```

Expected: all tests pass.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add "web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.ts" "web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts"
git commit -m "feat: add sparse bulk plan item selection"
```

## Task 3: Virtualized Expanded Item Review UI

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`
- Modify: `web/src/lib/i18n/en.json`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`

- [ ] **Step 1: Write failing component tests for bounded rendering**

Update the test setup in `agent-plan-item-review.spec.ts` to pass no-op `onBulkSetItems` and `onSetOnlyItems` callbacks and add translation strings for the new controls:

```ts
import type { ComponentProps } from 'svelte';

const messages: Record<string, string> = {
  assistant_operation_item_review_label: 'Review photos for {summary}',
  assistant_operation_item_selected_count: '{selected} of {total} selected',
  assistant_operation_item_excluded_count: '{count} excluded',
  assistant_operation_item_reset: 'Reset selection',
  assistant_operation_item_thumbnail_alt: 'Photo {index} of {count}',
  assistant_operation_item_toggle: 'Include photo {index}',
  assistant_operation_item_overflow: '+{count} not shown',
  assistant_operation_item_overflow_label: '{count} more affected photos are not shown',
  assistant_operation_item_thumbnail_unavailable: 'Preview unavailable',
  assistant_operation_item_filter_label: 'Filter photos',
  assistant_operation_item_filter_placeholder: 'Filter photos',
  assistant_operation_item_media_all: 'All',
  assistant_operation_item_media_photos: 'Photos',
  assistant_operation_item_media_videos: 'Videos',
  assistant_operation_item_quick_screenshots: 'Screenshots',
  assistant_operation_item_quick_duplicates: 'Duplicates',
  assistant_operation_item_exclude_videos: 'Exclude videos',
  assistant_operation_item_include_only_videos: 'Include only videos',
  assistant_operation_item_exclude_visible: 'Exclude visible',
  assistant_operation_item_include_visible: 'Include visible',
  assistant_operation_item_select_all_filtered: 'Select all filtered',
  assistant_operation_item_deselect_all_filtered: 'Deselect all filtered',
  assistant_operation_item_virtual_summary: 'Showing {visible} of {total} photos',
};
```

Also extend the existing mocked translation replacement chain with:

```ts
.replace('{visible}', String(options?.values?.visible ?? ''))
```

```ts
const renderItemReview = (props: Partial<ComponentProps<typeof AgentPlanItemReview>> = {}) =>
  render(AgentPlanItemReview, {
    props: {
      item: item(assetIds(1000)),
      canChangeSelection: true,
      onToggleItem: vi.fn(),
      onBulkSetItems: vi.fn(),
      onSetOnlyItems: vi.fn(),
      onResetSelection: vi.fn(),
      ...props,
    },
  });
```

Add these tests:

```ts
it('mounts only the virtual window for a thousand affected photos', () => {
  renderItemReview({
    viewportHeight: 360,
    itemSize: 96,
    columnCount: 6,
    overscanRows: 1,
  });

  expect(screen.getAllByTestId('agent-plan-item-review-image')).toHaveLength(30);
  expect(screen.queryByAltText('asset-0999')).not.toBeInTheDocument();
  expect(screen.getByText('Showing 30 of 1,000 photos')).toBeInTheDocument();
});

it('updates the mounted thumbnails when the grid scrolls', async () => {
  renderItemReview({
    viewportHeight: 360,
    itemSize: 96,
    columnCount: 6,
    overscanRows: 1,
  });

  const grid = screen.getByTestId('agent-plan-item-review-grid');
  Object.defineProperty(grid, 'scrollTop', { value: 960, configurable: true });
  await fireEvent.scroll(grid);

  expect(screen.getByAltText('asset-0054')).toBeInTheDocument();
  expect(screen.queryByAltText('asset-0000')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-item-review.spec.ts"
```

Expected: fail because the component still renders a fixed first 48 items and does not expose a virtual grid.

- [ ] **Step 3: Implement virtualized rendering in the component**

In `agent-plan-item-review.svelte`:

- Import the new helpers.
- Add optional testable sizing props with production defaults.
- Track `scrollTop` in local state.
- Build `filteredAssetIds`.
- Build the virtual window from filtered IDs.
- Render top and bottom spacers around the mounted window.
- Use a mounted asset's `filename`, then `label`, then `id` as the image alt text so filtered/search tests and users have a stable visible name when metadata exists.

The component props should become:

```ts
type Props = {
  item: OperationReviewItem;
  canChangeSelection: boolean;
  onToggleItem: (operationId: string, assetId: string, selected: boolean) => void;
  onBulkSetItems: (operationId: string, assetIds: string[], selected: boolean) => void;
  onSetOnlyItems: (operationId: string, assetIds: string[]) => void;
  onResetSelection: (operationId: string) => void;
  metadataByAssetId?: Record<string, AgentPlanReviewAssetMetadata>;
  viewportHeight?: number;
  itemSize?: number;
  columnCount?: number;
  overscanRows?: number;
};
```

Use these production defaults:

```ts
const DEFAULT_VIEWPORT_HEIGHT = 420;
const DEFAULT_ITEM_SIZE = 104;
const DEFAULT_COLUMN_COUNT = 6;
const DEFAULT_OVERSCAN_ROWS = 2;
```

The grid should expose:

```svelte
<div
  class="item-review-grid"
  data-testid="agent-plan-item-review-grid"
  style={`height: ${viewportHeight}px; --agent-plan-item-size: ${itemSize}px;`}
  onscroll={(event) => {
    scrollTop = event.currentTarget.scrollTop;
  }}
>
  <div style={`height: ${virtualWindow.beforeHeight}px;`}></div>
  <div class="item-review-grid__items">
    {#each virtualWindow.visibleAssetIds as assetId (assetId)}
      <!-- existing mounted thumbnail tile and checkbox -->
    {/each}
  </div>
  <div style={`height: ${virtualWindow.afterHeight}px;`}></div>
</div>
```

Keep each mounted thumbnail using `loading="lazy"` and `data-testid="agent-plan-item-review-image"`. Because only the virtual window is mounted, non-visible thumbnails do not start requests.

- [ ] **Step 4: Run the bounded-rendering tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-item-review.spec.ts"
```

Expected: the new bounded rendering and existing thumbnail tests pass.

- [ ] **Step 5: Write failing tests for filters and disabled state**

Add tests:

```ts
it('filters mounted assets with metadata-backed search', async () => {
  renderItemReview({
    item: item(['asset-1', 'asset-2', 'asset-3']),
    metadataByAssetId: {
      'asset-1': { id: 'asset-1', filename: 'family-beach.jpg', personNames: ['Maya'] },
      'asset-2': { id: 'asset-2', filename: 'receipt.png' },
      'asset-3': { id: 'asset-3', filename: 'clip.mov', kind: 'video' },
    },
  });

  await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter photos' }), { target: { value: 'maya' } });

  expect(screen.getByAltText('family-beach.jpg')).toBeInTheDocument();
  expect(screen.queryByAltText('receipt.png')).not.toBeInTheDocument();
});

it('only shows video filters when media metadata exists', () => {
  renderItemReview({
    item: item(['asset-1', 'asset-2']),
    metadataByAssetId: {
      'asset-1': { id: 'asset-1', kind: 'image' },
      'asset-2': { id: 'asset-2', kind: 'video' },
    },
  });

  expect(screen.getByRole('button', { name: 'Videos' })).toBeInTheDocument();
});

it('shows screenshot and duplicate quick filters only when that metadata exists', () => {
  renderItemReview({
    item: item(['asset-1', 'asset-2', 'asset-3']),
    metadataByAssetId: {
      'asset-1': { id: 'asset-1', filename: 'screen.png', isScreenshot: true },
      'asset-2': { id: 'asset-2', filename: 'dup-a.jpg', duplicateKey: 'dup-1' },
      'asset-3': { id: 'asset-3', filename: 'dup-b.jpg', duplicateKey: 'dup-1' },
    },
  });

  expect(screen.getByRole('button', { name: 'Screenshots' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Duplicates' })).toBeInTheDocument();
});

it('sets filtered videos as the only selected photos', async () => {
  const onSetOnlyItems = vi.fn();
  renderItemReview({
    item: item(['asset-1', 'asset-2', 'asset-3']),
    metadataByAssetId: {
      'asset-1': { id: 'asset-1', kind: 'image' },
      'asset-2': { id: 'asset-2', kind: 'video' },
      'asset-3': { id: 'asset-3', kind: 'video' },
    },
    onSetOnlyItems,
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Include only videos' }));

  expect(onSetOnlyItems).toHaveBeenCalledWith('operation-1', ['asset-2', 'asset-3']);
});

it('hides metadata filter controls when the plan only has asset ids', () => {
  renderItemReview({ item: item(['asset-1', 'asset-2']) });

  expect(screen.queryByRole('button', { name: 'Videos' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Screenshots' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Include only videos' })).not.toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: 'Filter photos' })).toBeInTheDocument();
});

it('disables bulk action controls when the plan cannot be changed', () => {
  renderItemReview({ canChangeSelection: false });

  expect(screen.getByRole('button', { name: 'Exclude visible' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Select all filtered' })).toBeDisabled();
});
```

- [ ] **Step 6: Run tests and verify they fail for missing controls**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-item-review.spec.ts"
```

Expected: fail because filter controls and bulk controls are not implemented.

- [ ] **Step 7: Implement filter and bulk controls**

Build `videoAssetIds` from the metadata-backed asset list, then add a compact toolbar above the virtual grid:

```svelte
<div class="item-review-toolbar">
  <input
    aria-label={$t('assistant_operation_item_filter_label')}
    type="search"
    bind:value={filter.query}
    placeholder={$t('assistant_operation_item_filter_placeholder')}
  />

  {#if facets.hasKind}
    <div class="item-review-toolbar__segmented" aria-label="Media type">
      <button type="button" aria-pressed={filter.kind === 'all'} onclick={() => (filter.kind = 'all')}>
        {$t('assistant_operation_item_media_all')}
      </button>
      <button type="button" aria-pressed={filter.kind === 'image'} onclick={() => (filter.kind = 'image')}>
        {$t('assistant_operation_item_media_photos')}
      </button>
      <button type="button" aria-pressed={filter.kind === 'video'} onclick={() => (filter.kind = 'video')}>
        {$t('assistant_operation_item_media_videos')}
      </button>
    </div>
    <button type="button" disabled={!canChangeSelection} onclick={() => onBulkSetItems(item.id, videoAssetIds, false)}>
      {$t('assistant_operation_item_exclude_videos')}
    </button>
    <button type="button" disabled={!canChangeSelection} onclick={() => onSetOnlyItems(item.id, videoAssetIds)}>
      {$t('assistant_operation_item_include_only_videos')}
    </button>
  {/if}

  {#if facets.hasScreenshots}
    <button
      type="button"
      aria-pressed={filter.quickFilter === 'screenshots'}
      onclick={() => (filter.quickFilter = filter.quickFilter === 'screenshots' ? undefined : 'screenshots')}
    >
      {$t('assistant_operation_item_quick_screenshots')}
    </button>
  {/if}

  {#if facets.hasDuplicates}
    <button
      type="button"
      aria-pressed={filter.quickFilter === 'duplicates'}
      onclick={() => (filter.quickFilter = filter.quickFilter === 'duplicates' ? undefined : 'duplicates')}
    >
      {$t('assistant_operation_item_quick_duplicates')}
    </button>
  {/if}

  <button type="button" disabled={!canChangeSelection} onclick={() => onBulkSetItems(item.id, virtualWindow.visibleAssetIds, false)}>
    {$t('assistant_operation_item_exclude_visible')}
  </button>
  <button type="button" disabled={!canChangeSelection} onclick={() => onBulkSetItems(item.id, virtualWindow.visibleAssetIds, true)}>
    {$t('assistant_operation_item_include_visible')}
  </button>
  <button type="button" disabled={!canChangeSelection} onclick={() => onSetOnlyItems(item.id, filteredAssetIds)}>
    {$t('assistant_operation_item_select_all_filtered')}
  </button>
  <button type="button" disabled={!canChangeSelection} onclick={() => onBulkSetItems(item.id, filteredAssetIds, false)}>
    {$t('assistant_operation_item_deselect_all_filtered')}
  </button>
</div>
```

Reset `scrollTop` to `0` and set the scroll container's `scrollTop` to `0` when filter state changes so the user does not land on an empty high scroll position after narrowing results.

- [ ] **Step 8: Write the failing i18n test**

Extend `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`:

```ts
it('defines the large item review English strings', () => {
  expect(en).toEqual(
    expect.objectContaining({
      assistant_operation_item_filter_label: 'Filter photos',
      assistant_operation_item_filter_placeholder: 'Filter photos',
      assistant_operation_item_media_all: 'All',
      assistant_operation_item_media_photos: 'Photos',
      assistant_operation_item_media_videos: 'Videos',
      assistant_operation_item_quick_screenshots: 'Screenshots',
      assistant_operation_item_quick_duplicates: 'Duplicates',
      assistant_operation_item_exclude_videos: 'Exclude videos',
      assistant_operation_item_include_only_videos: 'Include only videos',
      assistant_operation_item_exclude_visible: 'Exclude visible',
      assistant_operation_item_include_visible: 'Include visible',
      assistant_operation_item_select_all_filtered: 'Select all filtered',
      assistant_operation_item_deselect_all_filtered: 'Deselect all filtered',
      assistant_operation_item_virtual_summary:
        'Showing {visible, number} of {total, number} {total, plural, one {photo} other {photos}}',
    }),
  );
});
```

- [ ] **Step 9: Run the i18n test and verify it fails**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts"
```

Expected: fail because the large item review keys are not defined in `web/src/lib/i18n/en.json`.

- [ ] **Step 10: Add the English i18n keys**

Add these keys to `web/src/lib/i18n/en.json`:

```json
{
  "assistant_operation_item_filter_label": "Filter photos",
  "assistant_operation_item_filter_placeholder": "Filter photos",
  "assistant_operation_item_media_all": "All",
  "assistant_operation_item_media_photos": "Photos",
  "assistant_operation_item_media_videos": "Videos",
  "assistant_operation_item_quick_screenshots": "Screenshots",
  "assistant_operation_item_quick_duplicates": "Duplicates",
  "assistant_operation_item_exclude_videos": "Exclude videos",
  "assistant_operation_item_include_only_videos": "Include only videos",
  "assistant_operation_item_exclude_visible": "Exclude visible",
  "assistant_operation_item_include_visible": "Include visible",
  "assistant_operation_item_select_all_filtered": "Select all filtered",
  "assistant_operation_item_deselect_all_filtered": "Deselect all filtered",
  "assistant_operation_item_virtual_summary": "Showing {visible, number} of {total, number} {total, plural, one {photo} other {photos}}"
}
```

Use the existing key ordering around the other `assistant_operation_item_*` strings.

- [ ] **Step 11: Run component and i18n tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-item-review.spec.ts"
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts"
```

Expected: all item review and i18n tests pass.

- [ ] **Step 12: Commit Task 3**

Run:

```bash
git add "web/src/routes/(user)/assistant/agent-plan-item-review.svelte" "web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts" "web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts" "web/src/lib/i18n/en.json"
git commit -m "feat: virtualize agent plan item review"
```

## Task 4: Wire Bulk Selection Through The Review Panel

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`

- [ ] **Step 1: Write failing threading tests**

In `agent-plan-operation-row.spec.ts`, `agent-plan-destination-card.spec.ts`, `agent-plan-evidence-ledger.spec.ts`, and `agent-operation-plan-review-panel.spec.ts`, add the new mocked i18n labels used by `AgentPlanItemReview`:

```ts
assistant_operation_item_filter_label: 'Filter photos',
assistant_operation_item_filter_placeholder: 'Filter photos',
assistant_operation_item_media_all: 'All',
assistant_operation_item_media_photos: 'Photos',
assistant_operation_item_media_videos: 'Videos',
assistant_operation_item_quick_screenshots: 'Screenshots',
assistant_operation_item_quick_duplicates: 'Duplicates',
assistant_operation_item_exclude_videos: 'Exclude videos',
assistant_operation_item_include_only_videos: 'Include only videos',
assistant_operation_item_exclude_visible: 'Exclude visible',
assistant_operation_item_include_visible: 'Include visible',
assistant_operation_item_select_all_filtered: 'Select all filtered',
assistant_operation_item_deselect_all_filtered: 'Deselect all filtered',
assistant_operation_item_virtual_summary: 'Showing {visible} of {total} photos',
```

Extend each mock replacement chain with:

```ts
.replace('{visible}', String(options?.values?.visible ?? ''))
```

In row/card/ledger specs, pass `onBulkSetItems: vi.fn()` and `onSetOnlyItems: vi.fn()` to existing render helpers. Add assertions at each layer that clicking `Exclude visible` calls the bulk callback and clicking `Select all filtered` calls the replacement callback with the operation ID and visible filtered IDs:

```ts
const onBulkSetItems = vi.fn();
const onSetOnlyItems = vi.fn();
render(AgentPlanOperationRow, {
  item: reviewItemWithAssetIds(['asset-1', 'asset-2']),
  canChangeSelection: true,
  onToggleOperation: vi.fn(),
  onToggleItem: vi.fn(),
  onBulkSetItems,
  onSetOnlyItems,
  onResetItemSelection: vi.fn(),
  onSetFieldOverride: vi.fn(),
  onResetFieldOverride: vi.fn(),
});

await fireEvent.click(screen.getByText('Details'));
await fireEvent.click(screen.getByRole('button', { name: 'Exclude visible' }));
await fireEvent.click(screen.getByRole('button', { name: 'Select all filtered' }));

expect(onBulkSetItems).toHaveBeenCalledWith('operation-1', ['asset-1', 'asset-2'], false);
expect(onSetOnlyItems).toHaveBeenCalledWith('operation-1', ['asset-1', 'asset-2']);
```

Use the local helper names already present in each spec instead of introducing duplicate fixtures.

- [ ] **Step 2: Run threading specs and verify they fail**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts"
```

Expected: fail because `onBulkSetItems` and `onSetOnlyItems` are not threaded through these components.

- [ ] **Step 3: Add the callback prop to row, card, and ledger**

Add this prop shape to each component:

```ts
onBulkSetItems: (operationId: string, assetIds: string[], selected: boolean) => void;
onSetOnlyItems: (operationId: string, assetIds: string[]) => void;
```

Thread it through:

```svelte
<AgentPlanItemReview
  {item}
  {canChangeSelection}
  {onToggleItem}
  {onBulkSetItems}
  {onSetOnlyItems}
  onResetSelection={onResetItemSelection}
/>
```

For `AgentPlanEvidenceLedger`, keep a no-op default:

```ts
onBulkSetItems = () => {},
onSetOnlyItems = () => {},
```

- [ ] **Step 4: Run threading specs**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts"
```

Expected: all threading specs pass.

- [ ] **Step 5: Write failing panel tests for sparse payload and persistence**

Add panel-level tests:

```ts
it('applies a bulk visible exclusion as sparse allExcept item selection', async () => {
  const largeAssetIds = assetIds(1000);
  sdkMock.getCurrentOperationPlan.mockResolvedValue(
    plan([
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal album',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        payload: { albumName: 'Portugal' },
      }),
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add one thousand assets',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: largeAssetIds,
        dependencyIds: [createId],
        payload: {},
      }),
    ]),
  );
  sdkMock.applyApprovedOperations.mockResolvedValue({
    status: AgentOperationApplyStatus.Applied,
    plan: appliedPlan(),
    appliedOperationIds: [createId, addId],
    skippedOperationIds: [],
    failedOperationIds: [],
    summary: 'Applied 2 operation(s), skipped 0, failed 0.',
  });

  render(AgentOperationPlanReviewPanel, { props: { session } });

  const detailsButtons = await screen.findAllByText('Details');
  await fireEvent.click(detailsButtons[1]);
  await fireEvent.click(screen.getByRole('button', { name: 'Exclude visible' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Apply 2 selected' }));

  expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith(
    expect.objectContaining({
      id: session.id,
      planId,
      agentOperationPlanApplyRequestDto: expect.objectContaining({
        operationIds: [createId, addId],
        planRevision: 1,
        itemSelections: {
          [addId]: expect.objectContaining({
            itemKind: 'asset',
            mode: 'allExcept',
            itemIds: expect.arrayContaining(['asset-0000', 'asset-0001']),
          }),
        },
      }),
    }),
  );
  const payload = sdkMock.applyApprovedOperations.mock.calls[0][0].agentOperationPlanApplyRequestDto;
  expect(payload.itemSelections![addId].itemIds!.length).toBeLessThan(80);
});

it('preserves bulk selection state when details are collapsed and reopened', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add three assets',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        assetIds: ['asset-1', 'asset-2', 'asset-3'],
        payload: {},
      }),
    ]),
  );

  render(AgentOperationPlanReviewPanel, { props: { session } });

  await fireEvent.click(await screen.findByText('Details'));
  await fireEvent.click(screen.getByRole('button', { name: 'Exclude visible' }));
  await fireEvent.click(screen.getByText('Details'));
  await fireEvent.click(screen.getByText('Details'));

  expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();
});

it('publishes replacement selection when selecting all filtered photos', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add three assets',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        assetIds: ['asset-1', 'asset-2', 'asset-3'],
        payload: {},
      }),
    ]),
  );
  const onSelectionChange = vi.fn();

  render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

  await fireEvent.click(await screen.findByText('Details'));
  await fireEvent.input(screen.getByRole('searchbox', { name: 'Filter photos' }), { target: { value: 'asset-2' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Select all filtered' }));

  expect(onSelectionChange).toHaveBeenLastCalledWith({
    planId,
    planRevision: 1,
    operationIds: [addId],
    itemSelections: {
      [addId]: {
        itemKind: 'asset',
        mode: 'only',
        itemIds: ['asset-2'],
      },
    },
  });
});
```

Use existing panel-spec fixture helpers where possible. The current expanded-row toggle is the `Details` summary text.

- [ ] **Step 6: Run panel spec and verify it fails**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
```

Expected: fail because the panel does not yet implement bulk updates.

- [ ] **Step 7: Implement panel-level bulk selection handler**

In `agent-operation-plan-review-panel.svelte`, import:

```ts
import { applyAgentPlanBulkItemSelection, setAgentPlanOnlyItemSelection } from './agent-plan-large-item-review-ui';
```

Add:

```ts
const bulkSetItems = (operationId: string, assetIds: string[], selected: boolean) => {
  if (!plan) {
    return;
  }

  const operation = plan.operations.find((candidate) => candidate.id === operationId);
  const allAssetIds = operation?.assetIds ?? [];
  const nextItemSelectionByOperationId = applyAgentPlanBulkItemSelection({
    state: itemSelectionByOperationId,
    operationId,
    allAssetIds,
    targetAssetIds: assetIds,
    selected,
  });

  itemSelectionByOperationId = nextItemSelectionByOperationId;
  publishSelection(plan, enabledByOperationId, nextItemSelectionByOperationId, fieldOverrideByOperationId);
};

const setOnlyItems = (operationId: string, assetIds: string[]) => {
  if (!plan) {
    return;
  }

  const operation = plan.operations.find((candidate) => candidate.id === operationId);
  const allAssetIds = operation?.assetIds ?? [];
  const nextItemSelectionByOperationId = setAgentPlanOnlyItemSelection({
    state: itemSelectionByOperationId,
    operationId,
    allAssetIds,
    targetAssetIds: assetIds,
  });

  itemSelectionByOperationId = nextItemSelectionByOperationId;
  publishSelection(plan, enabledByOperationId, nextItemSelectionByOperationId, fieldOverrideByOperationId);
};
```

Pass it into the ledger:

```svelte
<AgentPlanEvidenceLedger
  ...
  onBulkSetItems={bulkSetItems}
  onSetOnlyItems={setOnlyItems}
/>
```

- [ ] **Step 8: Run panel and threading specs**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts"
```

Expected: all specs pass.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add "web/src/routes/(user)/assistant/agent-plan-operation-row.svelte" "web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "web/src/routes/(user)/assistant/agent-plan-destination-card.svelte" "web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte" "web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte" "web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
git commit -m "feat: wire agent plan bulk item refinement"
```

## Task 5: Large-Plan Regression Coverage And Verification

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`

- [ ] **Step 1: Add component-level regression tests for collapsed and expanded large plans**

Update the existing large destination-card test in `agent-plan-destination-card.spec.ts` so it also passes the new `onBulkSetItems` and `onSetOnlyItems` props:

```ts
it('renders bounded thumbnails for a destination with 1,000 affected photos', () => {
  const largeAssetIds = Array.from({ length: 1000 }, (_, index) => `large-asset-${index + 1}`);
  const largeGroup = buildOperationReviewModel(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add one thousand assets',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: largeAssetIds,
        payload: {},
      }),
    ]),
    { [addId]: true },
  ).groups[0];

  render(AgentPlanDestinationCard, {
    props: {
      group: largeGroup,
      canChangeSelection: true,
      onToggleGroup: vi.fn(),
      onToggleOperation: vi.fn(),
      onToggleItem: vi.fn(),
      onBulkSetItems: vi.fn(),
      onSetOnlyItems: vi.fn(),
      onResetItemSelection: vi.fn(),
      onSetFieldOverride: vi.fn(),
      onResetFieldOverride: vi.fn(),
    },
  });

  const thumbnailStrip = screen.getByTestId('agent-plan-thumbnail-strip');
  expect(within(thumbnailStrip).getAllByTestId('agent-plan-thumbnail-image')).toHaveLength(6);
  expect(within(thumbnailStrip).getByText('+994')).toBeInTheDocument();
  expect(screen.queryByText('large-asset-7')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Add panel-level regression tests for apply payload bounds**

Add:

```ts
it('sends a compact sparse payload after filtering a large plan', async () => {
  const largeAssetIds = assetIds(1000);
  sdkMock.getCurrentOperationPlan.mockResolvedValue(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add one thousand assets',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        assetIds: largeAssetIds,
        payload: {},
      }),
    ]),
  );
  sdkMock.applyApprovedOperations.mockResolvedValue({
    status: AgentOperationApplyStatus.Applied,
    plan: appliedPlan(),
    appliedOperationIds: [addId],
    skippedOperationIds: [],
    failedOperationIds: [],
    summary: 'Applied 1 operation(s), skipped 0, failed 0.',
  });

  render(AgentOperationPlanReviewPanel, { props: { session } });

  await fireEvent.click(await screen.findByText('Details'));
  await fireEvent.click(screen.getByRole('button', { name: 'Exclude visible' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Apply 1 selected' }));

  const payload = sdkMock.applyApprovedOperations.mock.calls[0][0].agentOperationPlanApplyRequestDto;
  expect(payload.itemSelections![addId].mode).toBe('allExcept');
  expect(payload.itemSelections![addId].itemIds!.length).toBeLessThan(80);
});
```

- [ ] **Step 3: Run regression specs and verify failures if behavior is not wired**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
```

Expected: pass if Tasks 3 and 4 are complete. If a test fails due to a fixture name mismatch, update the fixture to use the existing helper shape without changing the assertion intent.

- [ ] **Step 4: Run focused web tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts" "src/routes/(user)/assistant/agent-plan-item-review.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
```

Expected: all focused tests pass.

- [ ] **Step 5: Run type and Svelte checks**

Run:

```bash
pnpm --dir web check:typescript
pnpm --dir web check:svelte
```

Expected: both checks pass.

- [ ] **Step 6: Run formatting**

Run:

```bash
pnpm --filter immich-web run format
```

Expected: format completes without errors.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add "web/src/routes/(user)/assistant"
git commit -m "test: cover large agent plan refinement"
```

## Final Verification

Run the complete focused suite for this slice:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts" "src/routes/(user)/assistant/agent-plan-item-review.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
pnpm --dir web check:typescript
pnpm --dir web check:svelte
pnpm --filter immich-web run format
```

Expected:

- Focused Vitest suite passes.
- TypeScript passes.
- Svelte passes.
- Formatting passes.
- `git status --short` shows only intentional files before the final commit, and a clean tree after commits.

## Self-Review

Spec coverage:

- Virtualized expanded grids: Task 1 adds window math, Task 3 renders only the virtual window.
- Lazy thumbnail loading: Task 3 bounds mounted `img` nodes, so non-visible thumbnails do not begin requests.
- Filters: Task 1 adds metadata-aware filters, Task 3 exposes them only when supported by metadata.
- Bulk selection actions: Task 2 adds sparse transforms, Task 3 adds controls, Task 4 wires the panel.
- Hundreds/thousands of photos: Task 1 and Task 5 test 1,000 assets in deterministic helper and component coverage.
- Selection persistence: Task 4 tests collapse/reopen state preservation.
- Performance tests: Task 1, Task 3, and Task 5 verify bounded windows, bounded thumbnails, and compact payloads.

Type consistency:

- `AgentPlanReviewAssetMetadata` is frontend-only and optional.
- `onBulkSetItems(operationId, assetIds, selected)` and `onSetOnlyItems(operationId, assetIds)` are threaded through item review, row, destination card, ledger, and panel.
- Existing sparse apply payloads remain unchanged.

Risk controls:

- No server DTO or generated SDK changes.
- No new virtualization dependency.
- Metadata filters do not appear when the current plan only contains asset IDs.
- Bulk actions are calculated on explicit user actions, not on every render.
