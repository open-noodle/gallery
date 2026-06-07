# Timeline Zoom Navigation Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert asset-array `GalleryViewer` grouping surfaces from local temporal filtering to zoom/navigation behavior.

**Architecture:** `GalleryViewer` remains array-driven: representative cards are built from the complete local `assets` array, detailed mode renders the complete local `assets` array, and asset-viewer navigation uses `viewerAssets ?? assets` without local temporal narrowing. Bucket activation uses the shared web zoom helper, stores a one-shot local `TimelineTemporalAnchor`, switches grouping, and scrolls the component-local DOM to the first matching month bucket or asset when it still exists.

**Tech Stack:** Svelte 5 runes, Vitest, Testing Library Svelte, existing timeline grouping helpers, existing `TimelineRouteGroupingBar`, existing `TimelineBucketCard`.

---

## Files

- Modify: `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte`
  - Remove local temporal filter state and temporal filtering from embedded grouped viewers.
  - Use `getTimelineBucketZoomTarget()` instead of the legacy filter-drilldown helper.
  - Store a local anchor and resolve it by scrolling to component-local bucket/asset wrappers.
- Modify: `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts`
  - Replace filter-drilldown expectations with zoom/no-filter expectations.
  - Cover local anchor scrolling, missing-anchor targets, full-array detailed browsing, asset-viewer navigation across activated boundaries, representative-view intersection suppression, single-asset behavior, and selection-mode disablement.
- Modify: `web/src/lib/utils/gallery-viewer-grouping.ts`
  - Remove obsolete `GalleryViewerTemporalState` and `filterGalleryViewerAssetsByTemporalState()` after `GalleryViewer` no longer uses local temporal filtering.
- Modify: `web/src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts`
  - Remove tests for the obsolete local temporal filtering helper while keeping date parsing and bucket-building coverage.
- Modify: `web/src/lib/utils/timeline-filter-navigation.ts`
  - Remove the legacy `activateTimelineBucket()` helper after this slice removes the final web caller.
  - Keep `clearTimelineTemporalFilter()` for explicit filter UI.
  - Keep `getTimelineBucketZoomTarget()` and `ActivatableTimelineBucket`.
- Modify: `web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts`
  - Remove legacy filter-drilldown activation tests.
  - Keep explicit temporal clear tests and zoom helper tests.

## Acceptance Coverage

- Manual grouping changes still show representative year/month cards: Task 1 keeps and verifies the existing manual grouping test.
- Year activation switches to month grouping without hiding assets outside the year: Task 1 rewrites the year/month activation test.
- Month activation switches to detailed grouping without hiding assets outside the month: Task 1 rewrites the detailed grid assertions.
- Year activation anchors the month-card view to the tapped year when local assets still contain that year: Task 2 adds scroll assertions against bucket wrapper attributes.
- Month activation anchors the detailed grid to the tapped month when local assets still contain that month: Task 2 adds scroll assertions against asset wrapper attributes.
- Missing tapped period before anchor resolution: Task 2 rerenders the local array before the queued animation frame and asserts no chip, no unrelated scroll, and full remaining local data.
- Asset viewer next/previous navigation continues across year/month boundaries after zoom activation: Task 1 rewrites the asset-viewer navigation test.
- Infinite/intersection loading is not triggered by representative-card views unless it was already required for the visible detailed grid: Task 1 keeps the representative-view callback guard and removes the obsolete local-temporal-chip guard.
- Selection mode hides or disables grouping activation as before: Task 1 preserves the existing selection-mode test and verifies no chip is created.
- Legacy web filter-drilldown activation helper is removed after the final web caller migrates: Task 3 removes `activateTimelineBucket()` and static-checks production usage.

## Task 1: Migrate GalleryViewer From Local Temporal Filtering To Zoom

**Files:**

- Modify: `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts`
- Modify: `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte`

- [ ] **Step 1: Write failing GalleryViewer zoom behavior tests**

In `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts`, replace the old filter-drilldown tests with the following zoom/no-filter tests. Keep the existing render helper and the existing manual grouping, single-asset, representative intersection, selection-mode, and grouping-disabled tests.

Replace:

```ts
it('clicking a year then month card narrows loaded assets and exposes a clearable temporal chip', async () => {
  // old filter-drilldown assertions
});
```

with:

```ts
it('zooms from year to month to detailed mode without narrowing the local asset array', async () => {
  const assets = defaultAssets();
  renderViewer({ assets });

  await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
  await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));

  await waitFor(() => {
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('timeline-bucket-card')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /Jan 2016, 1 photo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aug 2015, 1 photo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jan 2015, 1 photo/i })).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByRole('button', { name: /Aug 2015, 1 photo/i }));

  await waitFor(() => {
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('thumbnail-asset-2016')).toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-asset-2015-aug')).toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-asset-2015-jan')).toBeInTheDocument();
  });

  expect(assets.map((asset) => asset.id)).toEqual(['asset-2016', 'asset-2015-aug', 'asset-2015-jan']);
});
```

Delete the obsolete test named:

```ts
it('does not request more assets while a local temporal chip narrows the day grid', async () => {
  // obsolete filter-drilldown assertion
});
```

Replace:

```ts
it('filters viewer asset navigation while a local temporal chip narrows the day grid', async () => {
  // old filtered navigation assertions
});
```

with:

```ts
it('keeps asset viewer navigation on the full viewer asset list after zoom activation', async () => {
  const assets = defaultAssets();
  const widerViewerAssets = [
    asset('asset-2015-aug', '2015-08-03T00:00:00.000Z'),
    asset('asset-2015-jan', '2015-01-01T00:00:00.000Z'),
    asset('asset-2015-aug-extra', '2015-08-04T00:00:00.000Z'),
    asset('asset-2016', '2016-01-02T00:00:00.000Z'),
  ];
  const view = renderViewer({ assets, viewerAssets: widerViewerAssets });

  await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
  await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));
  await fireEvent.click(screen.getByRole('button', { name: /Aug 2015, 1 photo/i }));

  await waitFor(() => {
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-asset-2016')).toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-asset-2015-aug')).toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-asset-2015-jan')).toBeInTheDocument();
  });

  assetViewerPropsCalls.length = 0;
  mockAssetViewerManager.asset = widerViewerAssets[0];
  mockAssetViewerManager.isViewing = true;
  await view.rerender({
    component: GalleryViewer,
    componentProps: {
      assets,
      viewerAssets: widerViewerAssets,
      assetInteraction: mockAssetInteraction,
      viewport: { width: 900, height: 700 },
      enableGrouping: true,
    },
  });

  await waitFor(() => {
    const latestAssetViewerProps = assetViewerPropsCalls.at(-1) as {
      cursor: { nextAsset?: AssetResponseDto };
    };
    expect(latestAssetViewerProps.cursor.nextAsset?.id).toBe('asset-2015-jan');
  });
  const assetViewerProps = assetViewerPropsCalls.at(-1) as {
    cursor: { nextAsset?: AssetResponseDto; previousAsset?: AssetResponseDto };
    onRandom: () => Promise<{ id: string } | undefined>;
  };
  expect(assetViewerProps.cursor.nextAsset?.id).toBe('asset-2015-jan');
  expect(assetViewerProps.cursor.previousAsset).toBeUndefined();

  const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
  await expect(assetViewerProps.onRandom()).resolves.toMatchObject({ id: 'asset-2016' });
  randomSpy.mockRestore();
});
```

- [ ] **Step 2: Run the new tests and verify they fail red**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
```

Expected red failures before production changes:

- `zooms from year to month to detailed mode without narrowing the local asset array` fails because year activation creates an active temporal chip and month grouping only contains `2015` month cards.
- The same test fails after month activation because the detailed grid only contains the selected month.
- `keeps asset viewer navigation on the full viewer asset list after zoom activation` fails because navigation is filtered to the selected month and `nextAsset` is `asset-2015-aug-extra` instead of `asset-2015-jan`.

- [ ] **Step 3: Replace local temporal filtering with the shared zoom helper**

In `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte`, update imports.

Replace:

```ts
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
```

with no import from `filter-panel`.

Replace:

```ts
import {
  buildGalleryViewerBuckets,
  filterGalleryViewerAssetsByTemporalState,
  type GalleryViewerTemporalState,
} from '$lib/utils/gallery-viewer-grouping';
```

with:

```ts
import { buildGalleryViewerBuckets } from '$lib/utils/gallery-viewer-grouping';
```

Replace:

```ts
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';
```

with:

```ts
import { getTimelineBucketZoomTarget, type ActivatableTimelineBucket } from '$lib/utils/timeline-filter-navigation';
```

Replace local grouping state and derived arrays:

```ts
let galleryGrouping = $state<TimelineGrouping>('day');
let galleryTemporalFilters = $state<FilterState>(createFilterState());
let galleryTemporalState = $derived<GalleryViewerTemporalState>({
  selectedYear: galleryTemporalFilters.selectedYear,
  selectedMonth: galleryTemporalFilters.selectedMonth,
});
let hasGalleryTemporalFilter = $derived(
  galleryTemporalFilters.selectedYear !== undefined || galleryTemporalFilters.selectedMonth !== undefined,
);
let visibleAssets = $derived(filterGalleryViewerAssetsByTemporalState(assets, galleryTemporalState));
let galleryBuckets = $derived(
  galleryGrouping === 'day' ? [] : buildGalleryViewerBuckets(visibleAssets, galleryGrouping),
);
let showRepresentativeBuckets = $derived(enableGrouping && galleryGrouping !== 'day' && visibleAssets.length > 0);
```

with:

```ts
let galleryGrouping = $state<TimelineGrouping>('day');
let galleryBuckets = $derived(galleryGrouping === 'day' ? [] : buildGalleryViewerBuckets(assets, galleryGrouping));
let showRepresentativeBuckets = $derived(enableGrouping && galleryGrouping !== 'day' && assets.length > 0);
```

Replace navigation derivation:

```ts
const navigationBaseAssets = $derived(viewerAssets ?? visibleAssets);
const navigationAssets = $derived(
  enableGrouping && hasGalleryTemporalFilter
    ? filterGalleryViewerAssetsByTemporalState(navigationBaseAssets, galleryTemporalState)
    : navigationBaseAssets,
);
```

with:

```ts
const navigationAssets = $derived(viewerAssets ?? assets);
```

Replace every detailed-grid use of `visibleAssets` with `assets`:

```ts
getJustifiedLayoutFromAssets(assets, {
```

```ts
assetInteraction.selectAssets(assets.map((a) => toTimelineAsset(a)));
```

```ts
let start = assets.findIndex((a) => a.id === startAsset.id);
let end = assets.findIndex((a) => a.id === endAsset.id);
```

```ts
assetInteraction.setAssetSelectionCandidates(assets.slice(start, end + 1).map((a) => toTimelineAsset(a)));
```

In the intersection effect, replace:

```ts
if (enableGrouping && (showRepresentativeBuckets || hasGalleryTemporalFilter)) {
  return;
}
```

with:

```ts
if (enableGrouping && showRepresentativeBuckets) {
  return;
}
```

Replace the grouping and bucket handlers:

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

with:

```ts
const handleGalleryGroupingChange = (grouping: TimelineGrouping) => {
  galleryGrouping = grouping;
};

const handleGalleryBucketActivate = (bucket: ActivatableTimelineBucket) => {
  if (assetInteraction.selectionActive) {
    return;
  }

  const result = getTimelineBucketZoomTarget(bucket);
  if (!result) {
    return;
  }

  galleryGrouping = result.grouping;
};
```

Replace the grouping bar markup:

```svelte
<TimelineRouteGroupingBar
  grouping={galleryGrouping}
  filters={galleryTemporalFilters}
  resultCount={visibleAssets.length}
  hidden={!showGalleryGroupingControls}
  onGroupingChange={handleGalleryGroupingChange}
  onClearTemporalFilter={clearGalleryTemporalFilter}
/>
```

with:

```svelte
<TimelineRouteGroupingBar
  grouping={galleryGrouping}
  hidden={!showGalleryGroupingControls}
  onGroupingChange={handleGalleryGroupingChange}
/>
```

Replace detailed grid conditions and loops:

```svelte
{:else if visibleAssets.length > 0}
```

with:

```svelte
{:else if assets.length > 0}
```

Replace:

```svelte
{#each visibleAssets as asset, i (asset.id + '-' + i)}
```

with:

```svelte
{#each assets as asset, i (asset.id + '-' + i)}
```

- [ ] **Step 4: Run GalleryViewer tests and verify green**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
```

Expected green result:

- All `GalleryViewer grouping` tests pass.
- The test output may include existing Svelte warnings, but no failed tests.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
git commit -m "feat(web): zoom gallery viewer buckets without filtering"
```

## Task 2: Add GalleryViewer Local Anchor Resolution

**Files:**

- Modify: `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts`
- Modify: `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte`

- [ ] **Step 1: Add test helpers for one-shot requestAnimationFrame and scroll tracking**

In `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts`, add these helpers after `renderViewer()` and before `defaultAssets()`:

```ts
function createAnimationFrameQueue() {
  const callbacks: FrameRequestCallback[] = [];
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  window.requestAnimationFrame = requestAnimationFrame;

  return {
    requestAnimationFrame,
    async flush() {
      while (callbacks.length > 0) {
        callbacks.shift()?.(performance.now());
        await Promise.resolve();
      }
    },
    restore() {
      window.requestAnimationFrame = originalRequestAnimationFrame;
    },
  };
}

function trackScrolledElement() {
  let scrolledElement: Element | undefined;
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolledElement = this;
  });

  return {
    get scrolledElement() {
      return scrolledElement;
    },
    reset() {
      scrolledElement = undefined;
    },
    restore() {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    },
  };
}
```

- [ ] **Step 2: Write failing anchor tests**

Add this test after `zooms from year to month to detailed mode without narrowing the local asset array`:

```ts
it('anchors year and month zooms to the first matching local bucket or asset', async () => {
  const frameQueue = createAnimationFrameQueue();
  const scrollTracker = trackScrolledElement();

  try {
    renderViewer();

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
    await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));

    await waitFor(() => expect(frameQueue.requestAnimationFrame).toHaveBeenCalled());
    await frameQueue.flush();

    await waitFor(() => {
      expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-bucket-year', '2015');
      expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-bucket-month', '8');
      expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    });

    frameQueue.requestAnimationFrame.mockClear();
    scrollTracker.reset();

    await fireEvent.click(screen.getByRole('button', { name: /Aug 2015, 1 photo/i }));

    await waitFor(() => expect(frameQueue.requestAnimationFrame).toHaveBeenCalled());
    await frameQueue.flush();

    await waitFor(() => {
      expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-asset-year', '2015');
      expect(scrollTracker.scrolledElement).toHaveAttribute('data-gallery-asset-month', '8');
      expect(scrollTracker.scrolledElement).toHaveAttribute(
        'data-testid',
        'gallery-viewer-asset-anchor-asset-2015-aug',
      );
      expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    });
  } finally {
    frameQueue.restore();
    scrollTracker.restore();
  }
});
```

Add this test after the anchor success test:

```ts
it('keeps remaining local assets available when the tapped period disappears before anchor resolution', async () => {
  const frameQueue = createAnimationFrameQueue();
  const scrollTracker = trackScrolledElement();
  const assets = defaultAssets();

  try {
    const view = renderViewer({ assets });

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));
    await fireEvent.click(screen.getByRole('button', { name: /2015, 2 photos/i }));

    await waitFor(() => {
      expect(frameQueue.requestAnimationFrame).toHaveBeenCalled();
      expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    });

    await view.rerender({
      component: GalleryViewer,
      componentProps: {
        assets: [assets[0]],
        assetInteraction: mockAssetInteraction,
        viewport: { width: 900, height: 700 },
        enableGrouping: true,
      },
    });
    await frameQueue.flush();

    await waitFor(() => {
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getAllByTestId('timeline-bucket-card')).toHaveLength(1);
      expect(screen.getByRole('button', { name: /Jan 2016, 1 photo/i })).toBeInTheDocument();
    });
    expect(scrollTracker.scrolledElement).toBeUndefined();
  } finally {
    frameQueue.restore();
    scrollTracker.restore();
  }
});
```

- [ ] **Step 3: Run the new anchor tests and verify they fail red**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts -t "anchors year and month zooms|keeps remaining local assets"
```

Expected red failures before production changes:

- `anchors year and month zooms to the first matching local bucket or asset` fails because no animation frame is requested and no element calls `scrollIntoView()`.
- `keeps remaining local assets available when the tapped period disappears before anchor resolution` fails because no anchor frame is requested.

- [ ] **Step 4: Store local anchors on bucket activation**

In `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte`, update the timeline type import.

Replace:

```ts
import type { TimelineAsset, TimelineGrouping, Viewport } from '$lib/managers/timeline-manager/types';
```

with:

```ts
import type {
  TimelineAsset,
  TimelineGrouping,
  TimelineTemporalAnchor,
  Viewport,
} from '$lib/managers/timeline-manager/types';
```

Update the gallery grouping state:

```ts
let galleryGrouping = $state<TimelineGrouping>('day');
let galleryTemporalAnchor = $state<TimelineTemporalAnchor | undefined>();
let galleryViewerElement: HTMLElement | undefined = $state();
```

Update manual grouping changes to drop any pending one-shot local anchor:

```ts
const handleGalleryGroupingChange = (grouping: TimelineGrouping) => {
  galleryGrouping = grouping;
  galleryTemporalAnchor = undefined;
};
```

Update bucket activation to store the shared zoom helper anchor:

```ts
const handleGalleryBucketActivate = (bucket: ActivatableTimelineBucket) => {
  if (assetInteraction.selectionActive) {
    return;
  }

  const result = getTimelineBucketZoomTarget(bucket);
  if (!result) {
    return;
  }

  galleryGrouping = result.grouping;
  galleryTemporalAnchor = result.anchor;
};
```

- [ ] **Step 5: Add one-shot local anchor resolution**

In `web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte`, add these helpers after `handleGalleryBucketActivate()`:

```ts
const isCurrentGalleryAnchor = (anchor: TimelineTemporalAnchor, grouping: TimelineGrouping) =>
  galleryGrouping === grouping &&
  galleryTemporalAnchor?.year === anchor.year &&
  galleryTemporalAnchor?.month === anchor.month;

const getGalleryAnchorSelector = (anchor: TimelineTemporalAnchor, grouping: TimelineGrouping) => {
  if (grouping === 'month' && anchor.month === undefined) {
    return `[data-gallery-bucket-year="${anchor.year}"]`;
  }

  if (grouping === 'day' && anchor.month !== undefined) {
    return `[data-gallery-asset-year="${anchor.year}"][data-gallery-asset-month="${anchor.month}"]`;
  }
};

$effect(() => {
  const anchor = galleryTemporalAnchor;
  const grouping = galleryGrouping;
  const container = galleryViewerElement;
  if (!anchor || !container) {
    return;
  }

  const selector = getGalleryAnchorSelector(anchor, grouping);
  if (!selector) {
    galleryTemporalAnchor = undefined;
    return;
  }

  requestAnimationFrame(() => {
    const target = container.querySelector<HTMLElement>(selector);
    target?.scrollIntoView({ block: 'start', inline: 'nearest' });
    if (isCurrentGalleryAnchor(anchor, grouping)) {
      galleryTemporalAnchor = undefined;
    }
  });
});
```

This anchor resolution is intentionally one-shot for `GalleryViewer`: it scrolls if the local array still renders the target after the grouping change, and clears the pending anchor even when the target disappeared before the frame. Route timeline anchors keep their longer-lived pending semantics in the shared `Timeline` manager; this local array surface does not own async query loading.

- [ ] **Step 6: Scope GalleryViewer DOM queries and add anchor data attributes**

Wrap only the grouping bar and gallery content branch in a component-local root. Replace the grouping/content markup after `<svelte:document ... />` with this structure, and leave the existing `<!-- Overlay Asset Viewer -->` portal block after the new root unchanged:

```svelte
<div bind:this={galleryViewerElement} data-testid="gallery-viewer">
  {#if enableGrouping && assets.length > 0}
    <TimelineRouteGroupingBar
      grouping={galleryGrouping}
      hidden={!showGalleryGroupingControls}
      onGroupingChange={handleGalleryGroupingChange}
    />
  {/if}

  {#if showRepresentativeBuckets}
    <div
      class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 px-4 py-4"
      data-testid="gallery-viewer-representative-buckets"
      data-grouping={galleryGrouping}
    >
      {#each galleryBuckets as bucket (bucket.viewId)}
        <div
          data-testid={`gallery-viewer-bucket-anchor-${bucket.viewId}`}
          data-gallery-bucket-year={bucket.date.year}
          data-gallery-bucket-month={bucket.date.month ?? null}
        >
          <TimelineBucketCard
            {bucket}
            disabled={assetInteraction.selectionActive}
            onActivate={handleGalleryBucketActivate}
          />
        </div>
      {/each}
    </div>
  {:else if assets.length > 0}
    <div
      style:position="relative"
      style:height={geometry.containerHeight + 'px'}
      style:width={geometry.containerWidth + 'px'}
    >
      {#each assets as asset, i (asset.id + '-' + i)}
        {#if isIntersecting(i)}
          {@const currentAsset = toTimelineAsset(asset)}
          {@const assetDate = getGalleryViewerAssetDate(asset)}
          <div
            class="absolute"
            style:overflow="clip"
            style={getStyle(i)}
            data-testid={`gallery-viewer-asset-anchor-${asset.id}`}
            data-gallery-asset-year={assetDate?.year ?? null}
            data-gallery-asset-month={assetDate?.month ?? null}
          >
            <Thumbnail
              readonly={disableAssetSelect}
              onClick={() => {
                if (assetInteraction.selectionActive) {
                  handleSelectAssets(currentAsset);
                  return;
                }
                void navigateToAsset(asset);
              }}
              onSelect={() => handleSelectAssets(currentAsset)}
              onPreview={assetInteraction.selectionActive ? () => void navigateToAsset(asset) : undefined}
              onMouseEvent={() => assetMouseEventHandler(currentAsset)}
              {showArchiveIcon}
              asset={currentAsset}
              selected={assetInteraction.hasSelectedAsset(currentAsset.id)}
              selectionCandidate={assetInteraction.hasSelectionCandidate(currentAsset.id)}
              thumbnailWidth={geometry.getWidth(i)}
              thumbnailHeight={geometry.getHeight(i)}
            />
            {#if showAssetName && !isTimelineAsset(asset)}
              <div
                class="absolute text-center p-1 text-xs font-mono font-semibold w-full bottom-0 bg-linear-to-t bg-slate-50/75 dark:bg-slate-800/75 overflow-clip text-ellipsis whitespace-pre-wrap"
              >
                {asset.originalFileName}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
```

Also update the grouping helper import to include asset date parsing:

```ts
import { buildGalleryViewerBuckets, getGalleryViewerAssetDate } from '$lib/utils/gallery-viewer-grouping';
```

- [ ] **Step 7: Run GalleryViewer tests and verify green**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
```

Expected green result:

- All `GalleryViewer grouping` tests pass.
- Anchor success test scrolls to the `2015`/`8` month bucket and then to `asset-2015-aug`.
- Missing-anchor test keeps the month grouping, creates no chip, renders the remaining `Jan 2016` bucket, and does not scroll to an unrelated target.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.svelte web/src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
git commit -m "feat(web): anchor gallery viewer zoom targets"
```

## Task 3: Remove Obsolete GalleryViewer Temporal Filtering And Legacy Activation Helper

**Files:**

- Modify: `web/src/lib/utils/gallery-viewer-grouping.ts`
- Modify: `web/src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts`
- Modify: `web/src/lib/utils/timeline-filter-navigation.ts`
- Modify: `web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts`

- [ ] **Step 1: Verify obsolete helpers still exist before cleanup**

Run:

```bash
rg -n "filterGalleryViewerAssetsByTemporalState|GalleryViewerTemporalState|activateTimelineBucket" web/src
```

Expected before cleanup:

- Matches remain in helper files and helper tests.
- No `activateTimelineBucket(` matches remain in production `GalleryViewer` or route components after Tasks 1 and 2.

- [ ] **Step 2: Remove GalleryViewer temporal filtering helper tests**

In `web/src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts`, replace the import:

```ts
import {
  buildGalleryViewerBuckets,
  filterGalleryViewerAssetsByTemporalState,
  getGalleryViewerAssetDate,
} from '../gallery-viewer-grouping';
```

with:

```ts
import { buildGalleryViewerBuckets, getGalleryViewerAssetDate } from '../gallery-viewer-grouping';
```

Delete these tests:

```ts
it('filters loaded assets by selected year and month without mutating the input list', () => {
  // obsolete local temporal filter behavior
});

it('keeps all assets when no temporal state is active', () => {
  // obsolete local temporal filter behavior
});
```

- [ ] **Step 3: Remove GalleryViewer temporal filtering helper implementation**

In `web/src/lib/utils/gallery-viewer-grouping.ts`, delete:

```ts
export type GalleryViewerTemporalState = {
  selectedYear?: number;
  selectedMonth?: number;
};
```

Delete:

```ts
export function filterGalleryViewerAssetsByTemporalState(
  assets: AssetResponseDto[],
  temporalState: GalleryViewerTemporalState,
) {
  if (!temporalState.selectedYear) {
    return assets;
  }

  return assets.filter((asset) => {
    const date = getGalleryViewerAssetDate(asset);
    if (!date) {
      return false;
    }

    return (
      date.year === temporalState.selectedYear &&
      (temporalState.selectedMonth === undefined || date.month === temporalState.selectedMonth)
    );
  });
}
```

- [ ] **Step 4: Remove legacy bucket activation tests**

In `web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts`, replace the import:

```ts
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  getTimelineBucketZoomTarget,
  getTimelineManagerTimeBuckets,
} from '../timeline-filter-navigation';
```

with:

```ts
import {
  clearTimelineTemporalFilter,
  getTimelineBucketZoomTarget,
  getTimelineManagerTimeBuckets,
} from '../timeline-filter-navigation';
```

Delete these tests:

```ts
it('selects a year bucket, clears custom dates, preserves non-time filters, and switches to month grouping', () => {
  // legacy filter-drilldown activation behavior
});

it('selects a month bucket and switches to detailed day grouping', () => {
  // legacy filter-drilldown activation behavior
});

it('does not turn day buckets into another drill-down mode', () => {
  // legacy filter-drilldown activation behavior
});

it('does not activate a malformed month bucket without a month number', () => {
  // legacy filter-drilldown activation behavior
});
```

- [ ] **Step 5: Remove legacy bucket activation implementation**

In `web/src/lib/utils/timeline-filter-navigation.ts`, delete:

```ts
type TimelineBucketActivationResult = {
  filters: FilterState;
  grouping: TimelineGrouping;
  anchor: TimelineTemporalAnchor;
};
```

Delete:

```ts
export function activateTimelineBucket(
  filters: FilterState,
  bucket: ActivatableTimelineBucket,
): TimelineBucketActivationResult | undefined {
  if (bucket.grouping === 'year') {
    const nextFilters = clearTimelineTemporalFilter(filters);
    return {
      filters: {
        ...nextFilters,
        selectedYear: bucket.date.year,
      },
      grouping: 'month',
      anchor: { year: bucket.date.year },
    };
  }

  if (bucket.grouping === 'month') {
    if (bucket.date.month === undefined) {
      return;
    }

    const nextFilters = clearTimelineTemporalFilter(filters);
    return {
      filters: {
        ...nextFilters,
        selectedYear: bucket.date.year,
        selectedMonth: bucket.date.month,
      },
      grouping: 'day',
      anchor: { year: bucket.date.year, month: bucket.date.month },
    };
  }
}
```

- [ ] **Step 6: Run helper tests and static cleanup checks**

Run:

```bash
pnpm --dir web exec vitest run src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts src/lib/utils/__tests__/timeline-filter-navigation.spec.ts
```

Expected green result:

- All grouping helper tests pass.
- All timeline filter navigation helper tests pass.

Run:

```bash
rg -n "filterGalleryViewerAssetsByTemporalState|GalleryViewerTemporalState|activateTimelineBucket" web/src
```

Expected static result:

- No matches in `web/src`.

- [ ] **Step 7: Run full Slice 4 verification**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts src/lib/utils/__tests__/timeline-filter-navigation.spec.ts
```

Expected green result:

- All selected Vitest files pass.

Run:

```bash
pnpm --dir web check:typescript
```

Expected green result:

- TypeScript check exits successfully.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add web/src/lib/utils/gallery-viewer-grouping.ts web/src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts web/src/lib/utils/timeline-filter-navigation.ts web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts
git commit -m "refactor(web): remove legacy timeline bucket activation"
```

## Final Slice Verification

- [ ] **Step 1: Verify no production legacy activation calls remain**

Run:

```bash
rg -n "activateTimelineBucket\\(" web/src
```

Expected:

- No matches.

- [ ] **Step 2: Verify all Slice 4 tests pass together**

Run:

```bash
pnpm --dir web exec vitest run src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts src/lib/utils/__tests__/gallery-viewer-grouping.spec.ts src/lib/utils/__tests__/timeline-filter-navigation.spec.ts
```

Expected:

- All tests pass.

- [ ] **Step 3: Verify web types**

Run:

```bash
pnpm --dir web check:typescript
```

Expected:

- TypeScript check passes.

- [ ] **Step 4: Review git history and push**

Run:

```bash
git log --oneline -3
git status --short --branch
git push
```

Expected:

- Last three commits are Task 1, Task 2, and Task 3.
- Worktree is clean.
- Branch pushes to `origin/brainstorm/pr625`.

## Plan Self-Review

- Spec coverage: Every Slice 4 acceptance criterion is mapped in the Acceptance Coverage section and implemented by Tasks 1-3.
- TDD order: Each behavior change starts with failing tests or a static red cleanup check, then implementation, then green verification.
- Edge cases: Full local array preservation, viewer navigation across activated boundaries, representative-view intersection suppression, selection mode, single-asset detailed behavior, successful anchors, missing anchor target, malformed dates through existing helper tests, and obsolete-helper removal are covered.
- Type consistency: `TimelineTemporalAnchor`, `TimelineGrouping`, `ActivatableTimelineBucket`, `getTimelineBucketZoomTarget()`, `buildGalleryViewerBuckets()`, and `getGalleryViewerAssetDate()` match current source names.
- Slice boundary: This plan only changes web `GalleryViewer` and removes helpers made obsolete by the final web caller migration. It does not change Slice 5 labels/accessibility text or mobile behavior.
