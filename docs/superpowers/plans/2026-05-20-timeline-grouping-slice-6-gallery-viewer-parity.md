# Timeline Grouping Slice 6 GalleryViewer Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring timeline grouping controls, representative year/month cards, and clearable temporal narrowing to web `GalleryViewer` flat-grid surfaces without changing route-owned search, folder, memory, or shared-link scopes.

**Architecture:** Add a small client-side grouping helper for `AssetResponseDto[]` and wire it into `GalleryViewer` behind an opt-in `enableGrouping` prop. `GalleryViewer` owns only display-density state and temporary local year/month narrowing; routes keep ownership of search queries, folder paths, memory state, shared-link permissions, pagination, and asset actions. Existing `TimelineGroupingControl`, `TimelineRouteGroupingBar`, `TimelineBucketCard`, and `activateTimelineBucket` are reused so Slice 6 visually and behaviorally matches Slices 4-5.

**Tech Stack:** Svelte 5 runes, TypeScript, Testing Library Svelte, Vitest, existing `GalleryViewer`, existing timeline grouping components/helpers, existing route mocks.

---

## Slice Source

Spec: `docs/superpowers/specs/2026-05-19-timeline-grouping-design.md`, Slice 6.

Baseline assumptions:

- Slices 1-5 are complete and already provide `TimelineGrouping`, `TimelineGroupingControl`, `TimelineRouteGroupingBar`, `TimelineBucketCard`, and `timeline-filter-navigation`.
- Slice 6 is client-side grid parity for `GalleryViewer` surfaces. It does not add server bucket APIs for legacy Search or non-`GalleryViewer` smart-search grids.
- Smart-search result grids that do not use `GalleryViewer` remain deferred by the amended Slice 6 spec unless the shared helper can be reused without changing pagination semantics.

## Scope

In scope:

- `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte`
- `web/src/lib/utils/gallery-viewer-grouping.ts`
- `web/src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts`
- `web/src/test-data/mocks/thumbnail-with-label.stub.svelte`
- `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts`
- Search route opt-in: `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Search route test wrapper/spec: `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/mock-gallery-viewer.test-wrapper.svelte`, `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/search-page.spec.ts`
- Shared route test stub: `web/src/test-data/mocks/gallery-viewer-props.stub.svelte`
- Folders route opt-in and spec: `web/src/routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/+page.svelte`, `web/src/routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/folders-page.spec.ts`
- Individual shared-link viewer opt-in and spec: `web/src/lib/components/share-page/individual-shared-viewer.svelte`, `web/src/lib/components/share-page/individual-shared-viewer.spec.ts`
- Memory viewer gallery opt-in and spec: `web/src/routes/(user)/memory/[[photos=photos]]/[[assetId=id]]/memory-viewer.svelte`, `web/src/routes/(user)/memory/[[photos=photos]]/[[assetId=id]]/memory-viewer.spec.ts`

Out of scope:

- Replacing `SpaceSearchResults` smart-search grids.
- Adding server bucket requests to Search, Folders, Memories, or shared-link views.
- Persisting `GalleryViewer` grouping in URL/query params.
- Mobile app parity; that is Slice 7.

## Required Behavior

- `enableGrouping={true}` on a `GalleryViewer` with assets renders a desktop grouping control.
- Manual grouping changes never create a temporal chip and never mutate the route-owned `assets` prop.
- Year mode shows one representative card per loaded asset year. The card count is the number of loaded assets in that year. The representative is the first loaded asset in that bucket.
- Month mode shows one representative card per loaded asset month after any active local temporal narrowing.
- Clicking a year card sets local selected year, switches to month grouping, shows a clearable `2015` temporal chip, and displays only loaded assets from that year.
- Clicking a month card sets local selected year/month, switches to day grouping, shows a clearable `Aug 2015` temporal chip, and displays only loaded assets from that month.
- Clearing the temporal chip restores the original loaded asset set while preserving the current grouping.
- Selection mode hides the desktop control and disables representative card activation.
- Empty `assets` does not render an orphaned grouping control.
- Single-asset grids still render normally in day mode. Shared-link single-asset behavior remains route-owned and must not be converted into a gallery.
- Search pagination stays route-owned: grouping over Search is over currently loaded `searchResultAssets`; representative card rendering must not call `onIntersected`.

---

## Implementation Tasks

### Task 1: GalleryViewer Grouping Helper

**Files:**

- Create: `web/src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts`
- Create: `web/src/lib/utils/gallery-viewer-grouping.ts`

- [ ] **Step 1: Write failing helper tests**

Create `web/src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts`:

```ts
import { AssetTypeEnum, AssetVisibility, type AssetResponseDto } from '@immich/sdk';

import {
  buildGalleryViewerBuckets,
  filterGalleryViewerAssetsByTemporalState,
  getGalleryViewerAssetDate,
} from '../gallery-viewer-grouping';

function asset(id: string, localDateTime: string, overrides: Partial<AssetResponseDto> = {}): AssetResponseDto {
  return {
    id,
    ownerId: 'user-1',
    type: AssetTypeEnum.Image,
    originalFileName: `${id}.jpg`,
    visibility: AssetVisibility.Timeline,
    isFavorite: false,
    isTrashed: false,
    fileCreatedAt: localDateTime,
    localDateTime,
    thumbhash: `${id}-thumbhash`,
    width: 1600,
    height: 900,
    ...overrides,
  } as AssetResponseDto;
}

describe('gallery viewer grouping helpers', () => {
  it('reads localDateTime before fileCreatedAt for bucket dates', () => {
    const result = getGalleryViewerAssetDate(
      asset('asset-1', '2015-12-31T23:30:00.000Z', { fileCreatedAt: '2016-01-01T00:30:00.000Z' }),
    );

    expect(result).toEqual({ year: 2015, month: 12, day: 31 });
  });

  it('falls back to fileCreatedAt when localDateTime is missing', () => {
    const result = getGalleryViewerAssetDate(
      asset('asset-1', '2015-01-01T00:00:00.000Z', {
        localDateTime: undefined as unknown as string,
        fileCreatedAt: '2016-02-29T10:00:00.000Z',
      }),
    );

    expect(result).toEqual({ year: 2016, month: 2, day: 29 });
  });

  it('builds year buckets from loaded assets and uses the first asset as representative', () => {
    const buckets = buildGalleryViewerBuckets(
      [
        asset('asset-2016-a', '2016-01-02T00:00:00.000Z'),
        asset('asset-2015-a', '2015-08-03T00:00:00.000Z'),
        asset('asset-2015-b', '2015-01-01T00:00:00.000Z'),
      ],
      'year',
    );

    expect(buckets).toEqual([
      expect.objectContaining({
        viewId: 'year:2016',
        timeBucket: '2016-01-01T00:00:00.000Z',
        grouping: 'year',
        date: { year: 2016 },
        count: 1,
        representativeAssetId: 'asset-2016-a',
        representativeThumbhash: 'asset-2016-a-thumbhash',
        representativeRatio: 1600 / 900,
      }),
      expect.objectContaining({
        viewId: 'year:2015',
        timeBucket: '2015-01-01T00:00:00.000Z',
        grouping: 'year',
        date: { year: 2015 },
        count: 2,
        representativeAssetId: 'asset-2015-a',
      }),
    ]);
  });

  it('builds month buckets from loaded assets while preserving first-seen bucket order', () => {
    const buckets = buildGalleryViewerBuckets(
      [
        asset('aug-a', '2015-08-03T00:00:00.000Z'),
        asset('jan-a', '2015-01-01T00:00:00.000Z'),
        asset('aug-b', '2015-08-04T00:00:00.000Z'),
      ],
      'month',
    );

    expect(buckets.map((bucket) => [bucket.viewId, bucket.count, bucket.representativeAssetId])).toEqual([
      ['month:2015-08', 2, 'aug-a'],
      ['month:2015-01', 1, 'jan-a'],
    ]);
  });

  it('filters loaded assets by selected year and month without mutating the input list', () => {
    const assets = [
      asset('aug-a', '2015-08-03T00:00:00.000Z'),
      asset('jan-a', '2015-01-01T00:00:00.000Z'),
      asset('other', '2016-08-03T00:00:00.000Z'),
    ];

    expect(filterGalleryViewerAssetsByTemporalState(assets, { selectedYear: 2015 }).map((asset) => asset.id)).toEqual([
      'aug-a',
      'jan-a',
    ]);
    expect(
      filterGalleryViewerAssetsByTemporalState(assets, { selectedYear: 2015, selectedMonth: 8 }).map(
        (asset) => asset.id,
      ),
    ).toEqual(['aug-a']);
    expect(assets.map((asset) => asset.id)).toEqual(['aug-a', 'jan-a', 'other']);
  });

  it('keeps all assets when no temporal state is active', () => {
    const assets = [asset('asset-1', '2015-08-03T00:00:00.000Z')];

    expect(filterGalleryViewerAssetsByTemporalState(assets, {})).toBe(assets);
  });
});
```

- [ ] **Step 2: Run helper red test**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts
```

Expected: FAIL because `gallery-viewer-grouping.ts` does not exist.

- [ ] **Step 3: Implement helper**

Create `web/src/lib/utils/gallery-viewer-grouping.ts`:

```ts
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
import type { ActivatableTimelineBucket } from '$lib/utils/timeline-filter-navigation';
import type { AssetResponseDto } from '@immich/sdk';

export type GalleryViewerTemporalState = {
  selectedYear?: number;
  selectedMonth?: number;
};

export type GalleryViewerBucket = ActivatableTimelineBucket & {
  viewId: string;
  timeBucket: string;
  count: number;
  representativeAssetId: string | null;
  representativeThumbhash: string | null;
  representativeRatio: number | null;
  assets: AssetResponseDto[];
};

export type GalleryViewerAssetDate = {
  year: number;
  month: number;
  day: number;
};

export function getGalleryViewerAssetDate(asset: AssetResponseDto): GalleryViewerAssetDate | undefined {
  const value = asset.localDateTime || asset.fileCreatedAt;
  const [year, month, day] = value?.slice(0, 10).split('-').map(Number) ?? [];

  if (!year || !month || !day) {
    return;
  }

  return { year, month, day };
}

export function filterGalleryViewerAssetsByTemporalState(
  assets: AssetResponseDto[],
  temporalState: GalleryViewerTemporalState,
) {
  if (!temporalState.selectedYear) {
    return assets;
  }

  return assets.filter((asset) => {
    const date = getGalleryViewerAssetDate(asset);
    return (
      date?.year === temporalState.selectedYear &&
      (temporalState.selectedMonth === undefined || date.month === temporalState.selectedMonth)
    );
  });
}

export function buildGalleryViewerBuckets(
  assets: AssetResponseDto[],
  grouping: Exclude<TimelineGrouping, 'day'>,
): GalleryViewerBucket[] {
  const buckets = new Map<string, GalleryViewerBucket>();

  for (const asset of assets) {
    const date = getGalleryViewerAssetDate(asset);
    if (!date) {
      continue;
    }

    const key = grouping === 'year' ? `${date.year}` : `${date.year}-${String(date.month).padStart(2, '0')}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.assets.push(asset);
      continue;
    }

    buckets.set(key, {
      viewId: `${grouping}:${key}`,
      timeBucket:
        grouping === 'year'
          ? `${date.year}-01-01T00:00:00.000Z`
          : `${date.year}-${String(date.month).padStart(2, '0')}-01T00:00:00.000Z`,
      grouping,
      date: grouping === 'year' ? { year: date.year } : { year: date.year, month: date.month },
      count: 1,
      representativeAssetId: asset.id,
      representativeThumbhash: asset.thumbhash ?? null,
      representativeRatio: asset.width && asset.height ? asset.width / asset.height : null,
      assets: [asset],
    });
  }

  return [...buckets.values()];
}
```

- [ ] **Step 4: Run helper green test**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper**

```bash
git add web/src/lib/utils/gallery-viewer-grouping.ts web/src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts
git commit -m "feat(web): add gallery viewer grouping helpers"
```

### Task 2: GalleryViewer Grouping UI And Local Temporal Narrowing

**Files:**

- Create: `web/src/test-data/mocks/thumbnail-with-label.stub.svelte`
- Create: `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts`
- Modify: `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte`

- [ ] **Step 1: Write failing GalleryViewer component tests**

Create `web/src/test-data/mocks/thumbnail-with-label.stub.svelte`:

```svelte
<script lang="ts">
  import type { TimelineAsset } from '$lib/managers/timeline-manager/types';

  interface Props {
    asset: TimelineAsset;
    onClick?: (asset: TimelineAsset) => void;
    onSelect?: (asset: TimelineAsset) => void;
  }

  let { asset, onClick = undefined, onSelect = undefined }: Props = $props();
</script>

<button type="button" data-testid={`thumbnail-${asset.id}`} onclick={() => onClick?.(asset)}>
  {asset.id}
</button>
<button type="button" data-testid={`thumbnail-select-${asset.id}`} onclick={() => onSelect?.(asset)}>
  select {asset.id}
</button>
```

Create `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts` with these tests:

```ts
import TestWrapper from '$lib/components/TestWrapper.svelte';
import type { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { AssetTypeEnum, AssetVisibility, type AssetResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';

import GalleryViewer from './gallery-viewer.svelte';

const { mockAssetInteraction, mockAssetViewerManager } = vi.hoisted(() => ({
  mockAssetInteraction: {
    selectionActive: false,
    assets: [],
    candidates: [],
    startAsset: null,
    clear: vi.fn(),
    clearCandidates: vi.fn(),
    hasSelectedAsset: vi.fn(() => false),
    hasSelectionCandidate: vi.fn(() => false),
    removeAssetFromMultiselectGroup: vi.fn(),
    selectAsset: vi.fn(),
    selectAssets: vi.fn(),
    setAssetSelectionCandidates: vi.fn(),
    setAssetSelectionStart: vi.fn(),
  },
  mockAssetViewerManager: {
    asset: undefined,
    isViewing: false,
    showAssetViewer: vi.fn(),
  },
}));

vi.mock('$lib/components/assets/thumbnail/thumbnail.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/thumbnail-with-label.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/elements/Portal.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: mockAssetViewerManager,
}));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { trash: true } },
}));

vi.mock('$lib/utils/navigation', () => ({
  navigate: vi.fn(),
}));

function asset(id: string, localDateTime: string, overrides: Partial<AssetResponseDto> = {}): AssetResponseDto {
  return {
    id,
    ownerId: 'user-1',
    type: AssetTypeEnum.Image,
    originalFileName: `${id}.jpg`,
    visibility: AssetVisibility.Timeline,
    isFavorite: false,
    isTrashed: false,
    fileCreatedAt: localDateTime,
    localDateTime,
    thumbhash: `${id}-thumbhash`,
    width: 1600,
    height: 900,
    ...overrides,
  } as AssetResponseDto;
}

function renderViewer({
  assets = defaultAssets(),
  enableGrouping = true,
  assetInteraction = mockAssetInteraction,
  onIntersected,
}: {
  assets?: AssetResponseDto[];
  enableGrouping?: boolean;
  assetInteraction?: AssetMultiSelectManager;
  onIntersected?: () => void;
} = {}) {
  const componentProps = {
    assets,
    assetInteraction,
    viewport: { width: 900, height: 700 },
    enableGrouping,
    onIntersected,
  };

  return render(
    TestWrapper as Component<{ component: typeof GalleryViewer; componentProps: Record<string, unknown> }>,
    {
      component: GalleryViewer,
      componentProps,
    },
  );
}

function defaultAssets() {
  return [
    asset('asset-2016', '2016-01-02T00:00:00.000Z'),
    asset('asset-2015-aug', '2015-08-03T00:00:00.000Z'),
    asset('asset-2015-jan', '2015-01-01T00:00:00.000Z'),
  ];
}

describe('GalleryViewer grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetInteraction.selectionActive = false;
    mockAssetInteraction.assets = [];
    mockAssetInteraction.candidates = [];
    mockAssetInteraction.startAsset = null;
    mockAssetViewerManager.asset = undefined;
    mockAssetViewerManager.isViewing = false;
  });

  it('renders the grouping control when grouping is enabled and assets exist', () => {
    renderViewer();

    expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  });

  it('does not render an orphaned grouping control for an empty asset list', () => {
    renderViewer({ assets: [], enableGrouping: true });

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('does not render the grouping control when grouping is disabled', () => {
    renderViewer({ enableGrouping: false });

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('manual grouping changes render representative year cards without temporal chips', async () => {
    renderViewer();

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));

    await waitFor(() => {
      expect(screen.getAllByTestId('timeline-bucket-card')).toHaveLength(2);
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.queryByTestId('thumbnail-asset-2015-aug')).not.toBeInTheDocument();
    });
  });

  it('clicking a year then month card narrows loaded assets and exposes a clearable temporal chip', async () => {
    const assets = defaultAssets();
    renderViewer({ assets });

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
    await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));

    await waitFor(() => {
      expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
      expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getAllByTestId('timeline-bucket-card')).toHaveLength(2);
    });

    await fireEvent.click(screen.getByRole('button', { name: /Aug 2015, 1 photo/i }));

    await waitFor(() => {
      expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('Aug 2015');
      expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('thumbnail-asset-2015-aug')).toBeInTheDocument();
      expect(screen.queryByTestId('thumbnail-asset-2015-jan')).not.toBeInTheDocument();
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove Aug 2015 filter' }));

    await waitFor(() => {
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('thumbnail-asset-2016')).toBeInTheDocument();
      expect(screen.getByTestId('thumbnail-asset-2015-aug')).toBeInTheDocument();
      expect(screen.getByTestId('thumbnail-asset-2015-jan')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    });
    expect(assets.map((asset) => asset.id)).toEqual(['asset-2016', 'asset-2015-aug', 'asset-2015-jan']);
  });

  it('keeps single-asset GalleryViewer grids in normal day mode', () => {
    renderViewer({ assets: [asset('single-asset', '2015-08-03T00:00:00.000Z')] });

    expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-single-asset')).toBeInTheDocument();
    expect(screen.queryByTestId('gallery-viewer-representative-buckets')).not.toBeInTheDocument();
  });

  it('does not request more assets while representative buckets are displayed', async () => {
    const onIntersected = vi.fn();
    renderViewer({ onIntersected });

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
    onIntersected.mockClear();
    await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onIntersected).not.toHaveBeenCalled();
  });

  it('hides controls and disables representative card activation during selection mode', async () => {
    const assets = defaultAssets();
    const view = renderViewer({ assets });
    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));

    const selectionInteraction = { ...mockAssetInteraction, selectionActive: true } as AssetMultiSelectManager;
    await view.rerender({
      component: GalleryViewer,
      componentProps: {
        assets,
        assetInteraction: selectionInteraction,
        viewport: { width: 900, height: 700 },
        enableGrouping: true,
      },
    });

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    const yearCard = screen.getByRole('button', { name: /2015, 2 photos/i });
    expect(yearCard).toBeDisabled();
    await fireEvent.click(yearCard);
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('preserves ungrouped day-mode GalleryViewer behavior when grouping is disabled', () => {
    renderViewer({ enableGrouping: false });

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-asset-2016')).toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-asset-2015-aug')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run GalleryViewer red tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
```

Expected: FAIL because `GalleryViewer` has no `enableGrouping` prop, no grouping control, and no representative card rendering.

- [ ] **Step 3: Implement GalleryViewer grouping**

Modify `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte`:

```ts
import TimelineRouteGroupingBar from '$lib/components/timeline/TimelineRouteGroupingBar.svelte';
import TimelineBucketCard from '$lib/components/timeline/TimelineBucketCard.svelte';
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
import {
  buildGalleryViewerBuckets,
  filterGalleryViewerAssetsByTemporalState,
  type GalleryViewerTemporalState,
} from '$lib/utils/gallery-viewer-grouping';
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';
```

Extend props:

```ts
    enableGrouping?: boolean;
```

Destructure defaults:

```ts
    enableGrouping = false,
```

Add local state and derived values:

```ts
let galleryGrouping = $state<TimelineGrouping>('day');
let galleryTemporalFilters = $state<FilterState>(createFilterState());
let galleryTemporalState = $derived<GalleryViewerTemporalState>({
  selectedYear: galleryTemporalFilters.selectedYear,
  selectedMonth: galleryTemporalFilters.selectedMonth,
});
let visibleAssets = $derived(filterGalleryViewerAssetsByTemporalState(assets, galleryTemporalState));
let galleryBuckets = $derived(
  galleryGrouping === 'day' ? [] : buildGalleryViewerBuckets(visibleAssets, galleryGrouping),
);
let showRepresentativeBuckets = $derived(enableGrouping && galleryGrouping !== 'day' && visibleAssets.length > 0);
let showGalleryGroupingControls = $derived(
  enableGrouping && assets.length > 0 && !assetInteraction.selectionActive && !assetViewerManager.isViewing,
);
```

Update calculations and selection helpers to use `visibleAssets` where the user is interacting with the rendered grid:

```ts
const navigationAssets = $derived(viewerAssets ?? visibleAssets);
const geometry = $derived(
  getJustifiedLayoutFromAssets(visibleAssets, {
    spacing: 2,
    heightTolerance: 0.5,
    rowHeight: Math.floor(viewport.width) < 850 ? 100 : 235,
    rowWidth: Math.floor(viewport.width),
  }),
);
const selectAllAssets = () => {
  assetInteraction.selectAssets(visibleAssets.map((a) => toTimelineAsset(a)));
};
```

When selecting candidates, find indexes inside `visibleAssets` instead of `assets`.

Guard the existing `onIntersected` effect so representative bucket modes never ask the route to fetch more flat-grid assets:

```ts
$effect(() => {
  if (enableGrouping && galleryGrouping !== 'day') {
    return;
  }

  // existing intersection logic stays unchanged below this guard
});
```

Add handlers:

```ts
const handleGalleryGroupingChange = (grouping: TimelineGrouping) => {
  galleryGrouping = grouping;
};

const handleGalleryBucketActivate = (bucket: ActivatableTimelineBucket) => {
  if (assetInteraction.selectionActive) {
    return;
  }

  const result = activateTimelineBucket(galleryTemporalFilters, bucket);
  if (!result) {
    return;
  }

  galleryTemporalFilters = result.filters;
  galleryGrouping = result.grouping;
};

const clearGalleryTemporalFilter = () => {
  galleryTemporalFilters = clearTimelineTemporalFilter(galleryTemporalFilters);
};
```

Render the grouping bar before the gallery body:

```svelte
{#if enableGrouping && assets.length > 0}
  <TimelineRouteGroupingBar
    grouping={galleryGrouping}
    filters={galleryTemporalFilters}
    resultCount={visibleAssets.length}
    hidden={!showGalleryGroupingControls}
    onGroupingChange={handleGalleryGroupingChange}
    onClearTemporalFilter={clearGalleryTemporalFilter}
  />
{/if}
```

Render representative cards in year/month mode:

```svelte
{#if showRepresentativeBuckets}
  <div class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 px-4 py-4" data-testid="gallery-viewer-representative-buckets" data-grouping={galleryGrouping}>
    {#each galleryBuckets as bucket (bucket.viewId)}
      <TimelineBucketCard
        {bucket}
        disabled={assetInteraction.selectionActive}
        onActivate={handleGalleryBucketActivate}
      />
    {/each}
  </div>
{:else if visibleAssets.length > 0}
  <!-- existing justified thumbnail layout, but each loop uses visibleAssets -->
{/if}
```

Preserve route-owned mutation behavior by mutating the original `assets` bindable array for delete/archive/update actions, while rendering `visibleAssets`.

- [ ] **Step 4: Run GalleryViewer green tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit GalleryViewer grouping UI**

```bash
git add \
  web/src/test-data/mocks/thumbnail-with-label.stub.svelte \
  web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte \
  web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
git commit -m "feat(web): add gallery viewer grouping controls"
```

### Task 3: Adopt GalleryViewer Grouping In Flat Grid Routes

**Files:**

- Create: `web/src/test-data/mocks/gallery-viewer-props.stub.svelte`
- Modify: `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/mock-gallery-viewer.test-wrapper.svelte`
- Modify: `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/search-page.spec.ts`
- Modify: `web/src/routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Create: `web/src/routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/folders-page.spec.ts`
- Modify: `web/src/lib/components/share-page/individual-shared-viewer.svelte`
- Create: `web/src/lib/components/share-page/individual-shared-viewer.spec.ts`
- Modify: `web/src/routes/(user)/memory/[[photos=photos]]/[[assetId=id]]/memory-viewer.svelte`
- Create: `web/src/routes/(user)/memory/[[photos=photos]]/[[assetId=id]]/memory-viewer.spec.ts`

- [ ] **Step 1: Write failing Search route opt-in test**

Create `web/src/test-data/mocks/gallery-viewer-props.stub.svelte` for the new route tests that only need to verify `GalleryViewer` props:

```svelte
<script lang="ts">
  import type { AssetResponseDto } from '@immich/sdk';

  interface Props {
    assets?: AssetResponseDto[];
    viewerAssets?: AssetResponseDto[];
    enableGrouping?: boolean;
  }

  let { assets = [], viewerAssets = [], enableGrouping = false }: Props = $props();
</script>

<div
  data-testid="gallery-viewer"
  data-enable-grouping={String(enableGrouping)}
  data-asset-count={String(assets.length)}
  data-viewer-asset-count={String(viewerAssets.length)}
>
  {#each assets as asset (asset.id)}
    <div data-testid={`asset-row-${asset.id}`}>{asset.id}</div>
  {/each}
</div>
```

Extend `mock-gallery-viewer.test-wrapper.svelte`:

```svelte
<script lang="ts">
  import type { AssetResponseDto } from '@immich/sdk';

  interface Props {
    assets?: AssetResponseDto[];
    enableGrouping?: boolean;
  }

  let { assets = [], enableGrouping = false }: Props = $props();
</script>

<div data-testid="gallery-viewer" data-enable-grouping={String(enableGrouping)}>
  {#each assets as asset (asset.id)}
    <div data-testid={`asset-row-${asset.id}`}>{asset.id}</div>
  {/each}
</div>
```

Append to `search-page.spec.ts`:

```ts
it('enables GalleryViewer grouping for legacy search result grids', async () => {
  renderPage();

  await waitFor(() => expect(screen.getByTestId('gallery-viewer')).toHaveAttribute('data-enable-grouping', 'true'));
});
```

- [ ] **Step 2: Write failing Folders route opt-in test**

Create `web/src/routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/folders-page.spec.ts`:

```ts
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { TreeNode } from '$lib/utils/tree-utils';
import { assetFactory } from '@test-data/factories/asset-factory';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';

import FoldersPage from './+page.svelte';

const { mockAfterNavigate, mockAssetMultiSelectManager, mockAuthManager, mockFoldersStore } = vi.hoisted(() => ({
  mockAfterNavigate: vi.fn(),
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
    isAllArchived: false,
    isAllFavorite: false,
    isAllUserOwned: true,
    selectAssets: vi.fn(),
  },
  mockAuthManager: {
    preferences: { tags: { enabled: true } },
  },
  mockFoldersStore: {
    folders: undefined as unknown,
    refreshAssetsByPath: vi.fn(),
  },
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: mockAfterNavigate,
  goto: vi.fn(),
  invalidateAll: vi.fn(),
}));

vi.mock('$lib/components/ActionMenuItem.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/layouts/user-page-layout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent, headerId: 'mock-header' };
});

vi.mock('$lib/components/shared-components/context-menu/button-context-menu.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/gallery-viewer/gallery-viewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/gallery-viewer-props.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/tree/breadcrumbs.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/tree/tree-item-thumbnails.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/tree/tree-items.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/sidebar/sidebar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ArchiveAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeDateAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeDescriptionAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeLocationAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/CreateSharedLinkAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DeleteAssetsAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/FavoriteAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/RotateAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/SetVisibilityAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/TagAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/elements/SkipLink.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mockAuthManager }));

vi.mock('$lib/services/asset.service', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

vi.mock('$lib/stores/folders.svelte', () => ({
  foldersStore: mockFoldersStore,
}));

vi.mock('$lib/utils/timeline-util', () => ({
  toTimelineAsset: vi.fn((asset) => asset),
}));

function renderPage() {
  const root = TreeNode.fromPaths(['Trips']);
  const tree = root.traverse('Trips');
  mockFoldersStore.folders = root;

  const props = {
    data: {
      meta: { title: 'Trips' },
      tree,
      pathAssets: [assetFactory.build({ id: 'folder-asset-1' })],
    },
  };

  return render(TestWrapper as Component<{ component: typeof FoldersPage; componentProps: typeof props }>, {
    component: FoldersPage,
    componentProps: props,
  });
}

describe('Folders page GalleryViewer grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
  });

  it('enables GalleryViewer grouping for folder asset grids', () => {
    renderPage();

    expect(screen.getByTestId('gallery-viewer')).toHaveAttribute('data-enable-grouping', 'true');
  });
});
```

- [ ] **Step 3: Write failing shared-link viewer opt-in tests**

Create `web/src/lib/components/share-page/individual-shared-viewer.spec.ts`:

```ts
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';
import { SharedLinkType, type SharedLinkResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';

import IndividualSharedViewer from './individual-shared-viewer.svelte';

const { mockAssetMultiSelectManager, mockAuthManager, mockGetAssetInfo } = vi.hoisted(() => ({
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
    isAllFavorite: false,
    isAllUserOwned: true,
    selectAssets: vi.fn(),
  },
  mockAuthManager: {
    params: {},
  },
  mockGetAssetInfo: vi.fn(),
}));

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
}));

vi.mock('$lib/components/asset-viewer/asset-viewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/Logo.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/control-app-bar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/gallery-viewer/gallery-viewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/gallery-viewer-props.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/RemoveFromSharedLinkAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: mockAuthManager,
}));

vi.mock('$lib/stores/media-query-manager.svelte', () => ({
  mediaQueryManager: { maxMd: false },
}));

vi.mock('$lib/utils/asset-utils', () => ({
  downloadArchive: vi.fn(),
}));

vi.mock('$lib/utils/file-uploader', () => ({
  fileUploadHandler: vi.fn(),
  openFileUploadDialog: vi.fn(),
}));

vi.mock('$lib/utils/timeline-util', () => ({
  toTimelineAsset: vi.fn((asset) => asset),
}));

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    getAssetInfo: mockGetAssetInfo,
  };
});

function renderViewer(sharedLinkOverrides: Partial<SharedLinkResponseDto>) {
  const props = {
    sharedLink: sharedLinkFactory.build({
      type: SharedLinkType.Individual,
      allowUpload: false,
      allowDownload: false,
      assets: [],
      ...sharedLinkOverrides,
    }),
    isOwned: false,
  };

  return render(TestWrapper as Component<{ component: typeof IndividualSharedViewer; componentProps: typeof props }>, {
    component: IndividualSharedViewer,
    componentProps: props,
  });
}

describe('IndividualSharedViewer GalleryViewer grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    mockGetAssetInfo.mockResolvedValue(assetFactory.build({ id: 'single-asset' }));
  });

  it('enables GalleryViewer grouping for multi-asset shared views', () => {
    renderViewer({
      assets: [assetFactory.build({ id: 'shared-1' }), assetFactory.build({ id: 'shared-2' })],
      allowDownload: true,
    });

    expect(screen.getByTestId('gallery-viewer')).toHaveAttribute('data-enable-grouping', 'true');
  });

  it('keeps the existing single-asset shared-link viewer path out of GalleryViewer grouping', async () => {
    renderViewer({ assets: [assetFactory.build({ id: 'single-asset' })], allowUpload: false });

    await waitFor(() => expect(mockGetAssetInfo).toHaveBeenCalledWith({ id: 'single-asset' }));
    expect(screen.queryByTestId('gallery-viewer')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Write failing Memory viewer opt-in test**

Create `web/src/routes/(user)/memory/[[photos=photos]]/[[assetId=id]]/memory-viewer.spec.ts`:

```ts
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { findMemoryAsset } from '$lib/utils/memory-viewer-source';
import { assetFactory } from '@test-data/factories/asset-factory';
import { AssetTypeEnum, MemoryType, type MemoryResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';

import MemoryViewer from './memory-viewer.svelte';

const {
  mockAfterNavigate,
  mockAssetMultiSelectManager,
  mockAssetViewerManager,
  mockAuthManager,
  mockGetAssetInfo,
  mockMemoryManager,
  mockPage,
} = vi.hoisted(() => ({
  mockAfterNavigate: vi.fn(),
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    clear: vi.fn(),
    isAllFavorite: false,
    isAllUserOwned: true,
    selectAssets: vi.fn(),
  },
  mockAssetViewerManager: {
    asset: undefined,
    isViewing: false,
    showAssetViewer: vi.fn(),
  },
  mockAuthManager: {
    params: {},
    preferences: { memories: { duration: 5 }, tags: { enabled: true } },
  },
  mockGetAssetInfo: vi.fn(),
  mockMemoryManager: {
    memories: [] as MemoryResponseDto[],
    ready: vi.fn(),
    getMemoryAsset: vi.fn(),
    hideAssetsFromMemory: vi.fn(),
    deleteAssetFromMemory: vi.fn(),
    deleteMemory: vi.fn(),
    updateMemorySaved: vi.fn(),
  },
  mockPage: {
    url: new URL('https://gallery.test/memory/photos/memory-asset-1'),
    params: { assetId: 'memory-asset-1' },
  },
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: mockAfterNavigate,
  goto: vi.fn(),
}));

vi.mock('$app/state', () => ({ page: mockPage }));

vi.mock('$lib/components/shared-components/context-menu/button-context-menu.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/context-menu/menu-option.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/control-app-bar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/gallery-viewer/gallery-viewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/gallery-viewer-props.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/AssetSelectControlBar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('./memory-photo-viewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('./memory-video-viewer.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ArchiveAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeDateAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeDescriptionAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/ChangeLocationAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/CreateSharedLinkAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DeleteAssetsAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/DownloadAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/FavoriteAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/TagAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: mockAssetViewerManager,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: mockAuthManager,
}));

vi.mock('$lib/managers/memory-manager.svelte', () => ({
  memoryManager: mockMemoryManager,
}));

vi.mock('$lib/services/asset.service', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    getAssetInfo: mockGetAssetInfo,
    deleteMemory: vi.fn(),
    removeMemoryAssets: vi.fn(),
    searchMemories: vi.fn(),
    updateMemory: vi.fn(),
  };
});

function memory(id: string, assetIds: string[]): MemoryResponseDto {
  return {
    id,
    assets: assetIds.map((assetId) =>
      assetFactory.build({
        id: assetId,
        type: AssetTypeEnum.Image,
        localDateTime: '2015-08-03T00:00:00.000Z',
        fileCreatedAt: '2015-08-03T00:00:00.000Z',
      }),
    ),
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    deletedAt: null,
    ownerId: 'user-1',
    type: MemoryType.OnThisDay,
    data: { year: 2015 },
    isSaved: false,
    memoryAt: '2020-01-01T00:00:00.000Z',
    seenAt: null,
    showAt: '2020-01-01T00:00:00.000Z',
    hideAt: null,
  } as MemoryResponseDto;
}

function renderViewer() {
  return render(TestWrapper as Component<{ component: typeof MemoryViewer; componentProps: Record<string, never> }>, {
    component: MemoryViewer,
    componentProps: {},
  });
}

describe('MemoryViewer GalleryViewer grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryManager.memories = [memory('memory-1', ['memory-asset-1', 'memory-asset-2'])];
    mockMemoryManager.ready.mockResolvedValue(undefined);
    mockMemoryManager.getMemoryAsset.mockImplementation((assetId: string | undefined) =>
      findMemoryAsset(mockMemoryManager.memories, assetId),
    );
    mockGetAssetInfo.mockResolvedValue(mockMemoryManager.memories[0].assets[0]);
    mockAfterNavigate.mockImplementation((callback) => {
      callback({ from: null, to: { params: mockPage.params, url: mockPage.url } });
    });
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it('enables GalleryViewer grouping for the memory gallery strip', async () => {
    renderViewer();

    expect(await screen.findByTestId('gallery-viewer')).toHaveAttribute('data-enable-grouping', 'true');
  });
});
```

- [ ] **Step 5: Run route opt-in red tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/search-page.spec.ts' \
  'src/routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/folders-page.spec.ts' \
  src/lib/components/share-page/individual-shared-viewer.spec.ts \
  'src/routes/(user)/memory/[[photos=photos]]/[[assetId=id]]/memory-viewer.spec.ts' \
  -t 'GalleryViewer grouping|shared views|folder asset grids|memory gallery|legacy search'
```

Expected: FAIL because the routes do not pass `enableGrouping`.

- [ ] **Step 6: Pass `enableGrouping` from each route**

Modify the four `GalleryViewer` call sites:

```svelte
<!-- Search -->
<GalleryViewer
  assets={searchResultAssets}
  assetInteraction={assetMultiSelectManager}
  onIntersected={loadNextPage}
  showArchiveIcon={true}
  {viewport}
  onReload={onSearchQueryUpdate}
  slidingWindowOffset={searchResultsElement.offsetTop}
  enableGrouping
/>
```

```svelte
<!-- Folders -->
<GalleryViewer
  assets={data.pathAssets}
  assetInteraction={assetMultiSelectManager}
  {viewport}
  showAssetName={true}
  pageHeaderOffset={54}
  onReload={triggerAssetUpdate}
  enableGrouping
/>
```

```svelte
<!-- Individual shared-link viewer -->
<GalleryViewer {assets} assetInteraction={assetMultiSelectManager} {viewport} allowDeletion={false} enableGrouping />
```

```svelte
<!-- Memory viewer -->
<GalleryViewer
  assets={currentTimelineAssets}
  {viewerAssets}
  viewport={galleryViewport}
  assetInteraction={assetMultiSelectManager}
  slidingWindowOffset={viewerHeight}
  arrowNavigation={false}
  enableGrouping
/>
```

- [ ] **Step 7: Run route opt-in green tests**

Run the same command from Step 5.

Expected: PASS.

- [ ] **Step 8: Commit route adoption**

```bash
git add \
  web/src/test-data/mocks/gallery-viewer-props.stub.svelte \
  web/src/routes/'(user)'/search/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/search/'[[photos=photos]]'/'[[assetId=id]]'/mock-gallery-viewer.test-wrapper.svelte \
  web/src/routes/'(user)'/search/'[[photos=photos]]'/'[[assetId=id]]'/search-page.spec.ts \
  web/src/routes/'(user)'/folders/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/folders/'[[photos=photos]]'/'[[assetId=id]]'/folders-page.spec.ts \
  web/src/lib/components/share-page/individual-shared-viewer.svelte \
  web/src/lib/components/share-page/individual-shared-viewer.spec.ts \
  web/src/routes/'(user)'/memory/'[[photos=photos]]'/'[[assetId=id]]'/memory-viewer.svelte \
  web/src/routes/'(user)'/memory/'[[photos=photos]]'/'[[assetId=id]]'/memory-viewer.spec.ts
git commit -m "feat(web): enable grouping on gallery viewer routes"
```

### Task 4: Slice 6 Verification

**Files:**

- Verification fixes are limited to files from Tasks 1-3.

- [ ] **Step 1: Run all Slice 6 focused tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts \
  src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts \
  'src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/search-page.spec.ts' \
  'src/routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/folders-page.spec.ts' \
  src/lib/components/share-page/individual-shared-viewer.spec.ts \
  'src/routes/(user)/memory/[[photos=photos]]/[[assetId=id]]/memory-viewer.spec.ts'
```

Expected: PASS.

- [ ] **Step 2: Run route regression tests for changed GalleryViewer consumers**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/search-page.spec.ts' \
  'src/routes/(user)/memories/page.spec.ts' \
  src/lib/utils/memory-viewer-source.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript**

Run:

```bash
pnpm --filter immich-web check:typescript
```

Expected: PASS.

- [ ] **Step 4: Run targeted ESLint**

Run:

```bash
pnpm --filter immich-web exec eslint \
  src/test-data/mocks/thumbnail-with-label.stub.svelte \
  src/test-data/mocks/gallery-viewer-props.stub.svelte \
  src/lib/utils/gallery-viewer-grouping.ts \
  src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts \
  src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte \
  src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts \
  src/routes/'(user)'/search/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/search/'[[photos=photos]]'/'[[assetId=id]]'/search-page.spec.ts \
  src/routes/'(user)'/folders/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/folders/'[[photos=photos]]'/'[[assetId=id]]'/folders-page.spec.ts \
  src/lib/components/share-page/individual-shared-viewer.svelte \
  src/lib/components/share-page/individual-shared-viewer.spec.ts \
  src/routes/'(user)'/memory/'[[photos=photos]]'/'[[assetId=id]]'/memory-viewer.svelte \
  src/routes/'(user)'/memory/'[[photos=photos]]'/'[[assetId=id]]'/memory-viewer.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Coverage checklist**

Confirm all are covered by tests before completion:

- [ ] Helper groups by `localDateTime` and falls back to `fileCreatedAt`.
- [ ] Leap-day and year-boundary date parsing are covered.
- [ ] Representative bucket uses first loaded asset and exposes thumbhash/ratio.
- [ ] Year card click narrows loaded assets, switches to month grouping, and shows temporal chip.
- [ ] Month card click narrows loaded assets, switches to day grouping, and shows temporal chip.
- [ ] Temporal chip clear restores all loaded assets without resetting grouping.
- [ ] Manual grouping does not create temporal chips.
- [ ] Selection mode hides controls and disables card activation.
- [ ] Empty asset list does not render orphaned grouping controls.
- [ ] Single-asset `GalleryViewer` grids keep normal day-mode thumbnail rendering.
- [ ] Search route enables grouping without moving pagination ownership into GalleryViewer.
- [ ] Folders route enables grouping while preserving folder path scope.
- [ ] Shared-link multi-asset route enables grouping while preserving single-asset viewer behavior.
- [ ] Memory viewer gallery enables grouping while preserving `viewerAssets` for adjacent memory navigation.

- [ ] **Step 6: Commit verification fixes**

When Step 1-5 required code or test fixes, commit only those changed files:

```bash
git add <fixed files>
git commit -m "test(web): verify gallery viewer grouping parity"
```

Expected: no commit if verification passed without changes.
