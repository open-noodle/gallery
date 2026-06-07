# Timeline Grouping Slice 3 Filter Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire timeline year/month drill-down into shared temporal filter state so FilterPanel, active chips, timeline requests, and scroll anchoring stay synchronized.

**Architecture:** Keep grouping as display state, separate from `FilterState`, and use helper functions to translate representative bucket activation into temporal filter updates. Photos and Spaces own the first route-level integration because they already have FilterPanel and active chips; the `Timeline` component receives the activation and anchor contract that slice 4 representative cards will call. Existing non-time filters and URL-backed typed filters remain untouched when temporal state changes.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest, Testing Library Svelte, existing FilterPanel/ActiveFiltersBar, existing `TimelineManager.timelineBuckets`, SvelteKit route state.

---

## Scope

This slice implements filter and navigation integration only:

- Add shared helper functions for representative bucket activation.
- Add scroll-anchor helper coverage for year and month drill-down.
- Add a `Timeline` contract for representative bucket activation and temporal anchoring.
- Wire Photos and Spaces browse timelines to:
  - pass `grouping` into `TimelineManagerOptions`,
  - derive FilterPanel time buckets from generic `timelineBuckets`,
  - set year/month temporal filter state from bucket activation,
  - switch grouping from `year -> month -> day`,
  - keep FilterPanel and ActiveFiltersBar synchronized,
  - clear temporal filters without clearing non-time filters.
- Preserve current URL behavior: explicit custom `from`/`to` dates remain URL-backed, while selected year/month remains transient in route state unless a later route-adoption slice decides otherwise.

This slice deliberately does not implement the visible grouping segmented control, representative card component, thumbnail/card layout, mobile floating placement, or adoption across every Timeline route. Those are slice 4 and slice 5 work. Browser-level Photos and Spaces flow coverage for `Years -> click year -> Months -> click month -> Days -> clear temporal filter` is deferred to slice 4, because the actual representative cards do not exist in this slice; slice 3 covers the route contract with test wrapper controls instead.

## File Map

- Create: `web/src/lib/utils/timeline-filter-navigation.ts`
  - Pure helpers that convert a year/month bucket activation into next `FilterState`, next grouping, and a temporal anchor.
  - Export the shared structural bucket activation type used by `Timeline.svelte`, Photos, Spaces, and test wrappers.
- Create: `web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts`
  - Unit tests for year/month activation, day-bucket no-op behavior, custom-date clearing, and non-time filter preservation.
- Create: `web/src/lib/managers/timeline-manager/timeline-anchor.ts`
  - Small helper that scrolls a `TimelineManager` to a representative year/month bucket or detailed day-mode month.
- Create: `web/src/lib/managers/timeline-manager/timeline-anchor.spec.ts`
  - Unit tests for year, month, day-mode month, and missing-anchor scroll behavior.
- Modify: `web/src/lib/managers/timeline-manager/types.ts`
  - Add `TimelineTemporalAnchor`.
- Modify: `web/src/lib/components/timeline/Timeline.svelte`
  - Accept `onTimelineBucketActivate`, `temporalAnchor`, and `onTemporalAnchorResolved` props.
  - Resolve pending anchors after `TimelineManager` initializes.
- Modify: `web/src/lib/utils/photos-filter-options.ts`
  - Reuse shared temporal clear helper in `handlePhotosRemoveFilter`.
- Modify: `web/src/lib/utils/space-filter-options.ts`
  - Reuse shared temporal clear helper in `handleSpaceRemoveFilter`.
- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`
  - Add grouping state, bucket activation handler, anchor handling, generic timeline bucket extraction, and temporal clear handling.
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - Add the same integration for Spaces browse mode while leaving select-assets/select-cover modes unchanged.
- Modify: `web/src/test-data/mocks/bindable-filter-panel.stub.svelte`
  - Expose temporal state and add test controls for temporal changes.
- Modify: `web/src/test-data/mocks/active-filters-bar-actions.stub.svelte`
  - Expose temporal state and add a timeline-chip remove test control.
- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`
  - Route-level tests for Photos sync.
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`
  - Route-level tests for Spaces sync.
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`
  - Add bucket-activation test buttons and expose options/anchor props for Photos tests.
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`
  - Add bucket-activation test buttons and expose options/anchor props for Spaces tests.

## TDD Rules For This Plan

Every behavior-changing task below starts with a failing test. Do not edit production code for a behavior until its red test has been run and observed failing for the expected reason. Regression tests that document already-correct behavior may be added alongside red tests, but they must be labeled as regression coverage and must not be used as the red proof for the task.

Use focused commands while executing tasks:

```bash
pnpm --filter immich-web exec vitest run src/lib/utils/__tests__/timeline-filter-navigation.spec.ts
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-anchor.spec.ts
pnpm --filter immich-web exec vitest run 'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts'
pnpm --filter immich-web exec vitest run 'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts'
pnpm --filter immich-web run check:typescript
```

Run full slice verification before considering the slice complete:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/utils/__tests__/timeline-filter-navigation.spec.ts \
  src/lib/managers/timeline-manager/timeline-anchor.spec.ts \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  src/lib/components/filter-panel/__tests__/filter-state.spec.ts \
  src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts
pnpm --filter immich-web run check:typescript
```

## Implementation Tasks

### Task 1: Add Shared Bucket Activation Helpers

**Files:**

- Create: `web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts`
- Create: `web/src/lib/utils/timeline-filter-navigation.ts`
- Modify: `web/src/lib/managers/timeline-manager/types.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts`:

```ts
import { createFilterState } from '$lib/components/filter-panel/filter-panel';

import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  getTimelineManagerTimeBuckets,
} from '../timeline-filter-navigation';

describe('timeline filter navigation helpers', () => {
  it('selects a year bucket, clears custom dates, preserves non-time filters, and switches to month grouping', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      dateAfter: '2020-01-01',
      dateBefore: '2020-12-31',
      sortOrder: 'asc' as const,
    };

    const result = activateTimelineBucket(filters, {
      grouping: 'year',
      date: { year: 2015 },
    });

    expect(result).toEqual({
      filters: {
        ...filters,
        dateAfter: undefined,
        dateBefore: undefined,
        selectedYear: 2015,
        selectedMonth: undefined,
      },
      grouping: 'month',
      anchor: { year: 2015 },
    });
  });

  it('selects a month bucket and switches to detailed day grouping', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['person-1'],
      selectedYear: 2015,
    };

    const result = activateTimelineBucket(filters, {
      grouping: 'month',
      date: { year: 2015, month: 8 },
    });

    expect(result).toEqual({
      filters: {
        ...filters,
        dateAfter: undefined,
        dateBefore: undefined,
        selectedYear: 2015,
        selectedMonth: 8,
      },
      grouping: 'day',
      anchor: { year: 2015, month: 8 },
    });
  });

  it('does not turn day buckets into another drill-down mode', () => {
    const filters = createFilterState();

    expect(
      activateTimelineBucket(filters, {
        grouping: 'day',
        date: { year: 2015, month: 8, day: 23 },
      }),
    ).toBeUndefined();
  });

  it('does not activate a malformed month bucket without a month number', () => {
    const filters = createFilterState();

    expect(
      activateTimelineBucket(filters, {
        grouping: 'month',
        date: { year: 2015 },
      }),
    ).toBeUndefined();
  });

  it('clears only temporal filter state', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      rating: 4,
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
      selectedYear: 2015,
      selectedMonth: 8,
      sortOrder: 'asc' as const,
    };

    expect(clearTimelineTemporalFilter(filters)).toEqual({
      ...filters,
      dateAfter: undefined,
      dateBefore: undefined,
      selectedYear: undefined,
      selectedMonth: undefined,
    });
  });

  it('uses generic timeline buckets for temporal picker buckets before falling back to month buckets', () => {
    const manager = {
      timelineBuckets: [
        { timeBucket: '2015-01-01', count: 438 },
        { timeBucket: '2007-01-01', count: 12 },
      ],
      months: [{ yearMonth: { year: 2024, month: 2 }, assetsCount: 5 }],
    };

    expect(getTimelineManagerTimeBuckets(manager)).toEqual([
      { timeBucket: '2015-01-01', count: 438 },
      { timeBucket: '2007-01-01', count: 12 },
    ]);
  });

  it('falls back to detailed month counts when generic buckets are not available yet', () => {
    const manager = {
      timelineBuckets: [],
      months: [{ yearMonth: { year: 2024, month: 2 }, assetsCount: 5 }],
    };

    expect(getTimelineManagerTimeBuckets(manager)).toEqual([{ timeBucket: '2024-02-01T00:00:00.000Z', count: 5 }]);
  });
});
```

- [ ] **Step 2: Run the red helper tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/utils/__tests__/timeline-filter-navigation.spec.ts
```

Expected: FAIL because `timeline-filter-navigation.ts` does not exist.

- [ ] **Step 3: Add the shared anchor type**

In `web/src/lib/managers/timeline-manager/types.ts`, add this near the grouping types:

```ts
export type TimelineTemporalAnchor = { year: number; month?: number };
```

- [ ] **Step 4: Implement the helper module**

Create `web/src/lib/utils/timeline-filter-navigation.ts`:

```ts
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';

export type ActivatableTimelineBucket = {
  grouping: TimelineGrouping;
  date: {
    year: number;
    month?: number;
    day?: number;
  };
};

type TimelineBucketActivationResult = {
  filters: FilterState;
  grouping: TimelineGrouping;
  anchor: TimelineTemporalAnchor;
};

type TemporalBucketSource = {
  timelineBuckets?: Array<{ timeBucket: string; count: number }>;
  months?: Array<{ yearMonth: { year: number; month: number }; assetsCount: number }>;
};

export function clearTimelineTemporalFilter(filters: FilterState): FilterState {
  return {
    ...filters,
    dateAfter: undefined,
    dateBefore: undefined,
    selectedYear: undefined,
    selectedMonth: undefined,
  };
}

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

export function getTimelineManagerTimeBuckets(source: TemporalBucketSource | undefined) {
  if (!source) {
    return [];
  }

  if (source.timelineBuckets && source.timelineBuckets.length > 0) {
    return source.timelineBuckets.map(({ timeBucket, count }) => ({ timeBucket, count }));
  }

  return (
    source.months?.map((month) => ({
      timeBucket: `${month.yearMonth.year}-${String(month.yearMonth.month).padStart(2, '0')}-01T00:00:00.000Z`,
      count: month.assetsCount,
    })) ?? []
  );
}
```

- [ ] **Step 5: Run the green helper tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/utils/__tests__/timeline-filter-navigation.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the helper**

```bash
git add \
  web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts \
  web/src/lib/utils/timeline-filter-navigation.ts \
  web/src/lib/managers/timeline-manager/types.ts
git commit -m "feat(web): add timeline temporal navigation helpers"
```

### Task 2: Add Temporal Scroll Anchor Helper

**Files:**

- Create: `web/src/lib/managers/timeline-manager/timeline-anchor.spec.ts`
- Create: `web/src/lib/managers/timeline-manager/timeline-anchor.ts`

- [ ] **Step 1: Write the failing anchor tests**

Create `web/src/lib/managers/timeline-manager/timeline-anchor.spec.ts`:

```ts
import { scrollTimelineToTemporalAnchor } from './timeline-anchor';
import type { TimelineManager } from './timeline-manager.svelte';

function buildManager(overrides: Partial<TimelineManager>): TimelineManager {
  return {
    grouping: 'year',
    timelineBuckets: [],
    months: [],
    scrollTo: vi.fn(),
    ...overrides,
  } as unknown as TimelineManager;
}

describe('scrollTimelineToTemporalAnchor', () => {
  it('scrolls to a matching representative year bucket', () => {
    const manager = buildManager({
      grouping: 'month',
      timelineBuckets: [{ date: { year: 2015 }, top: 120 }],
    } as Partial<TimelineManager>);

    expect(scrollTimelineToTemporalAnchor(manager, { year: 2015 })).toBe(true);
    expect(manager.scrollTo).toHaveBeenCalledWith(120);
  });

  it('scrolls to a matching representative month bucket', () => {
    const manager = buildManager({
      grouping: 'month',
      timelineBuckets: [{ date: { year: 2015, month: 8 }, top: 240 }],
    } as Partial<TimelineManager>);

    expect(scrollTimelineToTemporalAnchor(manager, { year: 2015, month: 8 })).toBe(true);
    expect(manager.scrollTo).toHaveBeenCalledWith(240);
  });

  it('scrolls to the detailed month container in day mode', () => {
    const manager = buildManager({
      grouping: 'day',
      months: [{ yearMonth: { year: 2015, month: 8 }, top: 360 }],
    } as Partial<TimelineManager>);

    expect(scrollTimelineToTemporalAnchor(manager, { year: 2015, month: 8 })).toBe(true);
    expect(manager.scrollTo).toHaveBeenCalledWith(360);
  });

  it('returns false when the anchor target is not currently loaded', () => {
    const manager = buildManager({
      grouping: 'month',
      timelineBuckets: [{ date: { year: 2014 }, top: 120 }],
    } as Partial<TimelineManager>);

    expect(scrollTimelineToTemporalAnchor(manager, { year: 2015 })).toBe(false);
    expect(manager.scrollTo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the red anchor tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-anchor.spec.ts
```

Expected: FAIL because `timeline-anchor.ts` does not exist.

- [ ] **Step 3: Implement the anchor helper**

Create `web/src/lib/managers/timeline-manager/timeline-anchor.ts`:

```ts
import type { TimelineManager } from './timeline-manager.svelte';
import type { TimelineTemporalAnchor } from './types';

function matchesAnchorDate(date: { year: number; month?: number }, anchor: TimelineTemporalAnchor) {
  return date.year === anchor.year && (anchor.month === undefined || date.month === anchor.month);
}

export function scrollTimelineToTemporalAnchor(timelineManager: TimelineManager, anchor: TimelineTemporalAnchor) {
  if (timelineManager.grouping === 'day' && anchor.month !== undefined) {
    const month = timelineManager.months.find(
      (candidate) => candidate.yearMonth.year === anchor.year && candidate.yearMonth.month === anchor.month,
    );
    if (!month) {
      return false;
    }

    timelineManager.scrollTo(month.top);
    return true;
  }

  const bucket = timelineManager.timelineBuckets.find((candidate) => matchesAnchorDate(candidate.date, anchor));
  if (!bucket) {
    return false;
  }

  timelineManager.scrollTo(bucket.top);
  return true;
}
```

- [ ] **Step 4: Run the green anchor tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/managers/timeline-manager/timeline-anchor.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the anchor helper**

```bash
git add \
  web/src/lib/managers/timeline-manager/timeline-anchor.spec.ts \
  web/src/lib/managers/timeline-manager/timeline-anchor.ts
git commit -m "feat(web): add timeline temporal anchor scrolling"
```

### Task 3: Add Timeline Activation And Anchor Contract

**Files:**

- Modify: `web/src/lib/components/timeline/Timeline.svelte`
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`

- [ ] **Step 1: Add failing route-stub contract tests**

Append these tests to `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts` for the album timeline test wrapper that Photos already mocks:

```ts
it('passes default day grouping into photos timeline options', async () => {
  mockPage.url = new URL('https://gallery.test/photos');

  renderPage();

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
  });
});
```

Append this test to `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts` for the Spaces timeline wrapper:

```ts
it('passes default day grouping into space timeline options', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

  renderPage();

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
  });
});
```

- [ ] **Step 2: Run the red contract tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  -t 'default day grouping'
```

Expected: FAIL. Photos may render `timeline-options` without `grouping`; Spaces currently does not expose `timeline-options` in its wrapper.

- [ ] **Step 3: Extend the Timeline props contract**

In `web/src/lib/components/timeline/Timeline.svelte`, add imports:

```ts
import { scrollTimelineToTemporalAnchor } from '$lib/managers/timeline-manager/timeline-anchor';
import type { ActivatableTimelineBucket } from '$lib/utils/timeline-filter-navigation';
import type {
  TimelineAsset,
  TimelineManagerOptions,
  TimelineTemporalAnchor,
  ViewportTopMonth,
} from '$lib/managers/timeline-manager/types';
```

Replace the existing `TimelineAsset`, `TimelineManagerOptions`, and `ViewportTopMonth` import from `types` with the expanded import above.

Extend `Props`:

```ts
    onTimelineBucketActivate?: (bucket: ActivatableTimelineBucket) => void;
    temporalAnchor?: TimelineTemporalAnchor;
    onTemporalAnchorResolved?: () => void;
```

Destructure the new props:

```ts
    onTimelineBucketActivate,
    temporalAnchor,
    onTemporalAnchorResolved,
```

Add this effect after the existing `timelineManager.scrollableElement = scrollableElement` effect:

```ts
$effect(() => {
  if (!temporalAnchor || !timelineManager.isInitialized) {
    return;
  }

  if (scrollTimelineToTemporalAnchor(timelineManager, temporalAnchor)) {
    onTemporalAnchorResolved?.();
  }
});
```

Add this temporary contract-use statement near the effect so TypeScript and lint know the activation prop is intentionally declared for the slice 4 representative renderer:

```ts
$effect(() => {
  void onTimelineBucketActivate;
});
```

- [ ] **Step 4: Extend test timeline wrappers**

In `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`, add this import:

```ts
import type { ActivatableTimelineBucket } from '$lib/utils/timeline-filter-navigation';
```

Then extend `Props`:

```ts
    onTimelineBucketActivate?: (bucket: ActivatableTimelineBucket) => void;
    temporalAnchor?: { year: number; month?: number };
    onTemporalAnchorResolved?: () => void;
```

Destructure:

```ts
let {
  timelineManager = $bindable(),
  options = {},
  album,
  children,
  onTimelineBucketActivate,
  temporalAnchor,
  onTemporalAnchorResolved,
}: Props = $props();
```

Add these elements after the existing `timeline-options` div:

```svelte
<button
  type="button"
  data-testid="activate-year-bucket"
  onclick={() => onTimelineBucketActivate?.({ grouping: 'year', date: { year: 2015 } })}
>
  Activate year
</button>
<button
  type="button"
  data-testid="activate-month-bucket"
  onclick={() => onTimelineBucketActivate?.({ grouping: 'month', date: { year: 2015, month: 8 } })}
>
  Activate month
</button>
<div data-testid="timeline-anchor">{JSON.stringify(temporalAnchor ?? null)}</div>
<button type="button" data-testid="resolve-timeline-anchor" onclick={() => onTemporalAnchorResolved?.()}>
  Resolve anchor
</button>
```

In `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`, add this import:

```ts
import type { ActivatableTimelineBucket } from '$lib/utils/timeline-filter-navigation';
```

Then extend `Props`:

```ts
    options?: Record<string, unknown>;
    onTimelineBucketActivate?: (bucket: ActivatableTimelineBucket) => void;
    temporalAnchor?: { year: number; month?: number };
    onTemporalAnchorResolved?: () => void;
```

Destructure:

```ts
let {
  timelineManager = $bindable(),
  children,
  options = {},
  onTimelineBucketActivate,
  temporalAnchor,
  onTemporalAnchorResolved,
  ...rest
}: Props = $props();
```

Add these elements inside the wrapper div:

```svelte
<div data-testid="timeline-options">{JSON.stringify(options)}</div>
<button
  type="button"
  data-testid="activate-year-bucket"
  onclick={() => onTimelineBucketActivate?.({ grouping: 'year', date: { year: 2015 } })}
>
  Activate year
</button>
<button
  type="button"
  data-testid="activate-month-bucket"
  onclick={() => onTimelineBucketActivate?.({ grouping: 'month', date: { year: 2015, month: 8 } })}
>
  Activate month
</button>
<div data-testid="timeline-anchor">{JSON.stringify(temporalAnchor ?? null)}</div>
<button type="button" data-testid="resolve-timeline-anchor" onclick={() => onTemporalAnchorResolved?.()}>
  Resolve anchor
</button>
```

- [ ] **Step 5: Run the contract tests again**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  -t 'default day grouping'
```

Expected: Still FAIL until route options pass grouping.

Do not commit yet; Task 4 and Task 5 make these tests green.

### Task 4: Wire Photos Filter And Bucket Navigation State

**Files:**

- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`
- Modify: `web/src/test-data/mocks/bindable-filter-panel.stub.svelte`
- Modify: `web/src/test-data/mocks/active-filters-bar-actions.stub.svelte`
- Modify: `web/src/lib/utils/photos-filter-options.ts`
- Modify: `web/src/lib/utils/__tests__/photos-filter-options.spec.ts`

- [ ] **Step 1: Add failing Photos sync tests**

Append these tests to `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`:

```ts
it('clicking a photos year bucket sets temporal filter state, switches to month grouping, and keeps non-time filters', async () => {
  mockPage.url = new URL('https://gallery.test/photos?people=person-1&city=Berlin');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });
  expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      personIds: ['person-1'],
      city: 'Berlin',
      selectedYear: 2015,
      selectedMonth: undefined,
    }),
  );
});

it('clicking a photos month bucket sets month temporal state and switches to day grouping', async () => {
  mockPage.url = new URL('https://gallery.test/photos?people=person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-month-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '8');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-month', '8');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
  });
  expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      personIds: ['person-1'],
      selectedYear: 2015,
      selectedMonth: 8,
    }),
  );
});

it('clearing the photos temporal chip keeps non-time filters and the current grouping', async () => {
  mockPage.url = new URL('https://gallery.test/photos?people=person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
  await fireEvent.click(await screen.findByTestId('active-filters-remove-timeline'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
  expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      personIds: ['person-1'],
      selectedYear: undefined,
      selectedMonth: undefined,
    }),
  );
});

it('clicking a photos bucket clears custom date state before applying selected year', async () => {
  mockPage.url = new URL('https://gallery.test/photos?from=2024-01-01&to=2024-12-31&tags=tag-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-after', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-before', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
  });
  expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      tagIds: ['tag-1'],
      dateAfter: undefined,
      dateBefore: undefined,
      selectedYear: 2015,
    }),
  );
});
```

Add this test to `web/src/lib/utils/__tests__/photos-filter-options.spec.ts`:

```ts
it('clears only temporal filters through the timeline chip removal path', () => {
  const filters = {
    ...createFilterState(),
    personIds: ['person-1'],
    tagIds: ['tag-1'],
    dateAfter: '2024-01-01',
    dateBefore: '2024-12-31',
    selectedYear: 2015,
    selectedMonth: 8,
  };

  expect(handlePhotosRemoveFilter(filters, 'timeline')).toEqual({
    ...filters,
    dateAfter: undefined,
    dateBefore: undefined,
    selectedYear: undefined,
    selectedMonth: undefined,
  });
});
```

- [ ] **Step 2: Run the red Photos tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' \
  src/lib/utils/__tests__/photos-filter-options.spec.ts \
  -t 'photos year bucket|photos month bucket|photos temporal chip|clears custom date|timeline chip removal'
```

Expected: FAIL because route grouping state, bucket activation wiring, and stub temporal data attributes are missing.

- [ ] **Step 3: Extend filter test stubs**

In `web/src/test-data/mocks/bindable-filter-panel.stub.svelte`, add these attributes to the root `<div>`:

```svelte
  data-selected-year={filters?.selectedYear ?? ''}
  data-selected-month={filters?.selectedMonth ?? ''}
  data-date-after={filters?.dateAfter ?? ''}
  data-date-before={filters?.dateBefore ?? ''}
```

Add these test buttons before the closing `</div>`:

```svelte
  <button
    type="button"
    data-testid="filter-panel-clear-timeline"
    onclick={() => {
      if (filters) {
        updateFilters({
          ...filters,
          dateAfter: undefined,
          dateBefore: undefined,
          selectedYear: undefined,
          selectedMonth: undefined,
        });
      }
    }}
  >
    Clear timeline
  </button>
  <button
    type="button"
    data-testid="filter-panel-set-custom-range"
    onclick={() => {
      if (filters) {
        updateFilters({
          ...filters,
          dateAfter: '2024-01-01',
          dateBefore: '2024-12-31',
          selectedYear: undefined,
          selectedMonth: undefined,
        });
      }
    }}
  >
    Set custom date range
  </button>
```

In `web/src/test-data/mocks/active-filters-bar-actions.stub.svelte`, extend `Props`:

```ts
    filters?: {
      selectedYear?: number;
      selectedMonth?: number;
      dateAfter?: string;
      dateBefore?: string;
    };
```

Destructure `filters`, add attributes to the root `<div>`:

```svelte
  data-selected-year={filters?.selectedYear ?? ''}
  data-selected-month={filters?.selectedMonth ?? ''}
  data-date-after={filters?.dateAfter ?? ''}
  data-date-before={filters?.dateBefore ?? ''}
```

Add this button:

```svelte
  <button
    type="button"
    data-testid="active-filters-remove-timeline"
    onclick={() => onRemoveFilter?.('timeline')}
  >
    Remove timeline
  </button>
```

- [ ] **Step 4: Reuse the shared clear helper for Photos chip removal**

In `web/src/lib/utils/photos-filter-options.ts`, import:

```ts
import { clearTimelineTemporalFilter } from '$lib/utils/timeline-filter-navigation';
```

Replace the `case 'timeline'` branch with:

```ts
    case 'timeline': {
      return clearTimelineTemporalFilter(filters);
    }
```

- [ ] **Step 5: Wire Photos grouping and activation**

In `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`, add imports:

```ts
import {
  activateTimelineBucket,
  type ActivatableTimelineBucket,
  getTimelineManagerTimeBuckets,
} from '$lib/utils/timeline-filter-navigation';
import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
```

Add state near `filters`:

```ts
let timelineGrouping = $state<TimelineGrouping>('day');
let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
```

Replace the options derived value:

```ts
const options = $derived({
  ...buildPhotosTimelineOptions(filters),
  grouping: timelineGrouping,
});
```

Replace the `timelineBuckets` derived value:

```ts
const timelineBuckets = $derived(getTimelineManagerTimeBuckets(timelineManager));
```

Add these helpers near `syncFilterUrl`:

```ts
function handleFiltersChange(nextFilters: FilterState) {
  temporalAnchor = undefined;
  syncFilterUrl(nextFilters);
}

function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
  const result = activateTimelineBucket(filters, bucket);
  if (!result) {
    return;
  }

  filters = result.filters;
  timelineGrouping = result.grouping;
  temporalAnchor = result.anchor;
  syncFilterUrl(result.filters);
}

function handleRemoveActiveFilter(type: string, id?: string) {
  const nextFilters = handlePhotosRemoveFilter(filters, type, id);
  if (type === 'timeline') {
    temporalAnchor = undefined;
  }
  filters = nextFilters;
  syncFilterUrl(nextFilters);
}

function handleClearAllFilters() {
  const nextFilters = clearFilters(filters);
  temporalAnchor = undefined;
  filters = nextFilters;
  if (!committedQuery.trim()) {
    syncFilterUrl(nextFilters);
  }
}
```

Update `FilterPanel`:

```svelte
        onFiltersChange={handleFiltersChange}
```

Update `ActiveFiltersBar`:

```svelte
          onRemoveFilter={handleRemoveActiveFilter}
          onClearAll={handleClearAllFilters}
```

Update `Timeline` props:

```svelte
          onTimelineBucketActivate={handleTimelineBucketActivate}
          {temporalAnchor}
          onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
```

- [ ] **Step 6: Run the Photos tests green**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' \
  src/lib/utils/__tests__/photos-filter-options.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Photos integration**

```bash
git add \
  web/src/routes/'(user)'/photos/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/photos/'[[assetId=id]]'/photos-page.spec.ts \
  web/src/test-data/mocks/bindable-filter-panel.stub.svelte \
  web/src/test-data/mocks/active-filters-bar-actions.stub.svelte \
  web/src/lib/utils/photos-filter-options.ts \
  web/src/lib/utils/__tests__/photos-filter-options.spec.ts
git commit -m "feat(web): sync photos timeline buckets with temporal filters"
```

### Task 5: Wire Spaces Filter And Bucket Navigation State

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`
- Modify: `web/src/lib/utils/space-filter-options.ts`
- Modify: `web/src/lib/utils/__tests__/space-filter-options.spec.ts`

- [ ] **Step 1: Add failing Spaces sync tests**

Append these tests to `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`:

```ts
it('clicking a space year bucket sets temporal filter state, switches to month grouping, and keeps non-time filters', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=space-person-1&city=Berlin');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });
});

it('clicking a space month bucket sets month temporal state and switches to day grouping', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=space-person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-month-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '8');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
  });
});

it('clearing the space temporal chip keeps non-time filters and the current grouping', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=space-person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
  await fireEvent.click(await screen.findByTestId('active-filters-remove-timeline'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
});

it('does not add grouping to select-assets timeline options', async () => {
  renderPage();

  await fireEvent.click(screen.getByLabelText('add_photos'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"timelineSpaceId":"space-1"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"grouping"');
  });
});
```

Add this test to `web/src/lib/utils/__tests__/space-filter-options.spec.ts`:

```ts
it('clears only temporal filters through the timeline chip removal path', () => {
  const filters = {
    ...createFilterState(),
    personIds: ['space-person-1'],
    tagIds: ['tag-1'],
    dateAfter: '2024-01-01',
    dateBefore: '2024-12-31',
    selectedYear: 2015,
    selectedMonth: 8,
  };

  expect(handleSpaceRemoveFilter(filters, 'timeline')).toEqual({
    ...filters,
    dateAfter: undefined,
    dateBefore: undefined,
    selectedYear: undefined,
    selectedMonth: undefined,
  });
});
```

- [ ] **Step 2: Run the red Spaces tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  src/lib/utils/__tests__/space-filter-options.spec.ts \
  -t 'space year bucket|space month bucket|space temporal chip|select-assets|timeline chip removal'
```

Expected: FAIL because Spaces route grouping state and temporal clear helper reuse are missing.

- [ ] **Step 3: Reuse the shared clear helper for Spaces chip removal**

In `web/src/lib/utils/space-filter-options.ts`, import:

```ts
import { clearTimelineTemporalFilter } from '$lib/utils/timeline-filter-navigation';
```

Replace the `case 'timeline'` branch with:

```ts
    case 'timeline': {
      return clearTimelineTemporalFilter(filters);
    }
```

- [ ] **Step 4: Wire Spaces grouping and activation**

In `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`, add imports:

```ts
import {
  activateTimelineBucket,
  type ActivatableTimelineBucket,
  getTimelineManagerTimeBuckets,
} from '$lib/utils/timeline-filter-navigation';
import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
```

Add state near `filters`:

```ts
let timelineGrouping = $state<TimelineGrouping>('day');
let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
```

Replace the `options` derived value:

```ts
const options = $derived.by(() => {
  if (viewMode === 'select-assets') {
    return { visibility: AssetVisibility.Timeline, timelineSpaceId: space.id };
  }
  return { ...buildSpaceTimelineOptions(space.id, filters), grouping: timelineGrouping };
});
```

Replace the `timelineBuckets` derived value:

```ts
const timelineBuckets = $derived(getTimelineManagerTimeBuckets(timelineManager));
```

Replace `handleRemoveFilter` with:

```ts
function handleRemoveFilter(type: string, id?: string) {
  const nextFilters = handleSpaceRemoveFilter(filters, type, id);
  if (type === 'timeline') {
    temporalAnchor = undefined;
  }
  filters = nextFilters;
  syncFilterUrl(nextFilters);
}
```

Add these helpers near `handleRemoveFilter`:

```ts
function handleFiltersChange(nextFilters: FilterState) {
  temporalAnchor = undefined;
  syncFilterUrl(nextFilters);
}

function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
  if (viewMode !== 'view') {
    return;
  }

  const result = activateTimelineBucket(filters, bucket);
  if (!result) {
    return;
  }

  filters = result.filters;
  timelineGrouping = result.grouping;
  temporalAnchor = result.anchor;
  syncFilterUrl(result.filters);
}

function handleClearAllFilters() {
  const nextFilters = clearFilters(filters);
  temporalAnchor = undefined;
  filters = nextFilters;
  if (!committedSearchQuery.trim()) {
    syncFilterUrl(nextFilters);
  }
}
```

Update `FilterPanel`:

```svelte
          onFiltersChange={handleFiltersChange}
```

Update `ActiveFiltersBar`:

```svelte
          onClearAll={handleClearAllFilters}
```

Update `Timeline` props:

```svelte
            onTimelineBucketActivate={handleTimelineBucketActivate}
            {temporalAnchor}
            onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
```

Update the empty-state clear-all button:

```svelte
                onclick={handleClearAllFilters}
```

- [ ] **Step 5: Run the Spaces tests green**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  src/lib/utils/__tests__/space-filter-options.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Spaces integration**

```bash
git add \
  web/src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/spaces-page.spec.ts \
  web/src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/mock-timeline.test-wrapper.svelte \
  web/src/lib/utils/space-filter-options.ts \
  web/src/lib/utils/__tests__/space-filter-options.spec.ts
git commit -m "feat(web): sync space timeline buckets with temporal filters"
```

### Task 6: Cover URL And FilterPanel Edge Cases

**Files:**

- Modify: `web/src/lib/utils/__tests__/searchable-page-search.spec.ts`
- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`

- [ ] **Step 1: Add edge-case and regression tests**

Append this regression test to `web/src/lib/utils/__tests__/searchable-page-search.spec.ts`. It documents the existing URL contract and may already pass; do not count it as the red TDD signal for this task.

```ts
it('does not serialize transient year and month selections into URL params', () => {
  const url = new URL('https://gallery.test/photos?view=timeline');
  const filters = {
    ...createFilterState(),
    personIds: ['person-1'],
    selectedYear: 2015,
    selectedMonth: 8,
  };

  expect(buildSearchablePageUrl(url, '', 'desc', filters)).toBe('/photos?view=timeline&sort=desc&people=person-1');
});
```

Append this test to `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`:

```ts
it('keeps photos temporal state transient across URL sync for non-time filter changes', async () => {
  mockPage.url = new URL('https://gallery.test/photos');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
  await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
  });
  expect(goto).toHaveBeenLastCalledWith('/photos?country=Germany', {
    replaceState: true,
    keepFocus: true,
    noScroll: true,
  });
});

it('lets a custom photos date range override selected timeline year state', async () => {
  mockPage.url = new URL('https://gallery.test/photos?people=person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
  await fireEvent.click(screen.getByTestId('filter-panel-set-custom-range'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-after', '2024-01-01');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-before', '2024-12-31');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-date-after', '2024-01-01');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
  expect(buildPhotosTimelineOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({
      personIds: ['person-1'],
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
      selectedYear: undefined,
      selectedMonth: undefined,
    }),
  );
});
```

Append this test to `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`:

```ts
it('keeps space temporal state transient across URL sync for non-time filter changes', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
  await fireEvent.click(screen.getByTestId('filter-panel-set-country'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
  });
  expect(gotoMock).toHaveBeenLastCalledWith('/spaces/space-1/photos?country=Germany', {
    replaceState: true,
    keepFocus: true,
    noScroll: true,
  });
});

it('lets a custom space date range override selected timeline year state', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?people=space-person-1');

  renderPage();
  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
  await fireEvent.click(screen.getByTestId('filter-panel-set-custom-range'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-month', '');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-after', '2024-01-01');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-date-before', '2024-12-31');
    expect(screen.getByTestId('active-filters-bar-stub')).toHaveAttribute('data-date-after', '2024-01-01');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
});
```

- [ ] **Step 2: Run the edge tests red**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/utils/__tests__/searchable-page-search.spec.ts \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  -t 'transient|custom .*date'
```

Expected: FAIL because the route transient-state tests expose that `handleFiltersChange()` clears the active temporal anchor too aggressively for non-time filter changes. The custom-date override tests are contract coverage for the FilterPanel-to-route path and may already pass once the stub control from Task 4 exists. The URL serialization test documents the existing contract that selected year/month remains transient and may already pass.

- [ ] **Step 3: Preserve temporal state when non-time filters change**

Replace `handleFiltersChange` in both Photos and Spaces with:

```ts
function handleFiltersChange(nextFilters: FilterState) {
  const temporalChanged =
    nextFilters.dateAfter !== filters.dateAfter ||
    nextFilters.dateBefore !== filters.dateBefore ||
    nextFilters.selectedYear !== filters.selectedYear ||
    nextFilters.selectedMonth !== filters.selectedMonth;

  if (temporalChanged) {
    temporalAnchor = undefined;
  }

  syncFilterUrl(nextFilters);
}
```

This keeps the temporal selection active when a person/tag/location/media filter changes after a year or month has been selected, matching the design's "filters and grouping are separate axes" rule.

- [ ] **Step 4: Run edge tests green**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/utils/__tests__/searchable-page-search.spec.ts \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  -t 'transient|custom .*date'
```

Expected: PASS.

- [ ] **Step 5: Commit edge coverage**

```bash
git add \
  web/src/lib/utils/__tests__/searchable-page-search.spec.ts \
  web/src/routes/'(user)'/photos/'[[assetId=id]]'/photos-page.spec.ts \
  web/src/routes/'(user)'/photos/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/spaces-page.spec.ts \
  web/src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte
git commit -m "test(web): cover transient timeline temporal navigation"
```

### Task 7: Final Verification And Coverage Review

**Files:**

- Verify changed files from Tasks 1-6.
- Read: `docs/superpowers/specs/2026-05-19-timeline-grouping-design.md`
- Read: `docs/superpowers/plans/2026-05-20-timeline-grouping-slice-2-web-model.md`

- [ ] **Step 1: Run focused slice tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/utils/__tests__/timeline-filter-navigation.spec.ts \
  src/lib/managers/timeline-manager/timeline-anchor.spec.ts \
  'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' \
  src/lib/utils/__tests__/photos-filter-options.spec.ts \
  src/lib/utils/__tests__/space-filter-options.spec.ts \
  src/lib/utils/__tests__/searchable-page-search.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run adjacent FilterPanel and timeline model tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/components/filter-panel/__tests__/filter-state.spec.ts \
  src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts \
  src/lib/components/filter-panel/__tests__/filter-panel.spec.ts \
  src/lib/managers/timeline-manager/timeline-grouping.svelte.spec.ts \
  src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript verification**

Run:

```bash
pnpm --filter immich-web run check:typescript
```

Expected: PASS with no Svelte prop or route type errors.

- [ ] **Step 4: Run targeted ESLint**

Run:

```bash
pnpm --filter immich-web exec eslint \
  src/lib/utils/timeline-filter-navigation.ts \
  src/lib/utils/__tests__/timeline-filter-navigation.spec.ts \
  src/lib/managers/timeline-manager/timeline-anchor.ts \
  src/lib/managers/timeline-manager/timeline-anchor.spec.ts \
  src/lib/components/timeline/Timeline.svelte \
  src/routes/'(user)'/photos/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/photos/'[[assetId=id]]'/photos-page.spec.ts \
  src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/spaces/'[spaceId]'/'[[photos=photos]]'/'[[assetId=id]]'/spaces-page.spec.ts \
  src/test-data/mocks/bindable-filter-panel.stub.svelte \
  src/test-data/mocks/active-filters-bar-actions.stub.svelte \
  src/lib/utils/photos-filter-options.ts \
  src/lib/utils/space-filter-options.ts \
  src/lib/utils/__tests__/photos-filter-options.spec.ts \
  src/lib/utils/__tests__/space-filter-options.spec.ts \
  src/lib/utils/__tests__/searchable-page-search.spec.ts \
  --max-warnings 0
```

Expected: PASS.

- [ ] **Step 5: Run the spec coverage checklist**

Confirm each requirement is covered by tests or explicitly deferred:

```md
- [ ] Year bucket activation sets `selectedYear`, clears custom date range, preserves non-time filters, switches grouping to `month`, and creates a year anchor.
- [ ] Month bucket activation sets `selectedYear` + `selectedMonth`, clears custom date range, preserves non-time filters, switches grouping to `day`, and creates a month anchor.
- [ ] Day bucket activation is a no-op; day headers remain the detailed selection path.
- [ ] FilterPanel receives selected year/month after bucket activation on Photos and Spaces.
- [ ] ActiveFiltersBar receives selected year/month after bucket activation on Photos and Spaces.
- [ ] Timeline options include grouping on Photos and Spaces browse mode.
- [ ] Timeline options do not include grouping in Spaces select-assets mode.
- [ ] Active temporal chip clear removes only temporal filters and preserves person/tag/location/media/rating/favorite/album filters.
- [ ] Clear all removes temporal filters and clears pending anchors.
- [ ] Changing non-time filters after year/month selection preserves transient selected year/month.
- [ ] Custom date ranges take precedence over selected year/month when set through FilterPanel.
- [ ] Selected year/month remains transient and is not serialized to URL params.
- [ ] Anchor helper scrolls representative year/month buckets and detailed day-mode months.
- [ ] Missing anchor targets do not scroll and leave the pending anchor available for a later layout pass.
- [ ] Visual grouping segmented control is deferred to slice 4.
- [ ] Representative card rendering, keyboard activation, thumbnails, and responsive card layout are deferred to slice 4.
- [ ] Browser-level Photos and Spaces flow coverage is deferred to slice 4 when real representative cards exist; this slice covers the route contract with wrapper-driven route tests.
- [ ] Adoption on Albums, People, Tags, Archive, Favorites, Trash, Locked, and Map timeline panel is deferred to slice 5.
```

- [ ] **Step 6: Run edge-case checklist**

Confirm these edge cases are covered:

```md
- [ ] Active person/tag/location filters remain active when clicking a year or month bucket.
- [ ] Custom `from`/`to` temporal filter is cleared by representative bucket activation.
- [ ] Custom `from`/`to` temporal filter overrides transient selected year/month when set later in FilterPanel.
- [ ] Clearing the timeline chip does not clear sort order.
- [ ] Clearing the timeline chip does not clear search query.
- [ ] Clearing all filters still clears temporal state and preserves route sort behavior.
- [ ] Non-time filter changes after selected year/month do not drop selected year/month.
- [ ] Search mode continues using smart facet buckets and does not render timeline bucket activation.
- [ ] Spaces select-assets/select-cover modes do not receive browse grouping state.
- [ ] Missing representative bucket anchor does not throw.
- [ ] Day mode month anchoring uses existing `TimelineMonth.top`.
```

- [ ] **Step 7: Commit final verification updates if needed**

If Task 7 required any fixes, commit them:

```bash
git add <changed-files>
git commit -m "test(web): verify timeline filter navigation coverage"
```

## Design Consistency Notes

- Grouping remains display state. It is not added to `FilterState`, not counted as a filter, and not serialized into typed filter URL params in this slice.
- Year/month bucket activation updates the same temporal fields that FilterPanel and ActiveFiltersBar already display: `selectedYear`, `selectedMonth`, `dateAfter`, and `dateBefore`.
- Clicking a bucket clears custom date text fields because the design treats card clicks as a temporal shortcut, not as a second simultaneous temporal constraint.
- Clearing the temporal chip clears only temporal state. It intentionally leaves current grouping unchanged because filters and grouping are separate axes.
- The route integration starts with Photos and Spaces because those pages already exercise the FilterPanel and active-chip contract. Later route adoption should reuse the same helpers instead of copying local logic.
- Slice 4 representative cards should call `onTimelineBucketActivate(bucket)` from `Timeline.svelte`; this slice creates and tests that contract without implementing visual cards early.
