# Timeline Grouping Slice 5 Route Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the slice 4 timeline grouping UI and representative bucket navigation across the remaining `Timeline`-based photo surfaces.

**Architecture:** Reuse the slice 4 `TimelineGroupingControl`, `Timeline.svelte` mobile floating control, representative bucket rendering, and slice 3 temporal navigation contract. Routes keep grouping and temporal filter state locally, because toolbar placement, active-chip placement, and empty-state behavior are route-specific. Routes with a full `FilterPanel` sync card clicks into that filter state; routes without a full `FilterPanel` expose a clearable temporal chip through `ActiveFiltersBar`.

**Tech Stack:** Svelte 5 runes, TypeScript, Testing Library Svelte, Vitest, existing `FilterState`, existing `TimelineManagerOptions`, existing `TimelineGroupingControl`, existing `Timeline.onTimelineBucketActivate`, Playwright UI e2e.

---

## Scope

This slice adopts grouping for the remaining `Timeline`-based surfaces:

- Albums detail timeline in view mode.
- People detail timeline.
- Shared space person detail timeline.
- Tags timeline.
- Archive timeline.
- Favorites timeline.
- Trash timeline.
- Locked timeline.
- Partner timeline.
- Map timeline panel.

This slice intentionally excludes surfaces that do not use `TimelineManager` today:

- Memories and memory viewer.
- Search result gallery.
- Shared-link flat gallery views.
- Any other `GalleryViewer`-based grid.

Those are later gallery-viewer adoption slices.

## Design Rules

- The grouping control remains a quiet segmented control, not a filter chip.
- Manual grouping changes never create selected year/month chips.
- Representative year/month card clicks create temporal filter state and move to the next density.
- Clearing temporal chips removes temporal narrowing without changing the current grouping mode.
- Desktop controls live in each route's existing toolbar/header/chip area.
- Mobile controls stay owned by `Timeline.svelte`; routes only pass `grouping` and `onGroupingChange`.
- Selection mode hides desktop controls and `Timeline.svelte` hides the floating mobile control.
- Select-assets and select-thumbnail modes do not inherit browse-mode grouping state unless that mode already uses browse filters by design.
- Empty-state behavior must stay route-specific and must not regress when representative buckets replace day/month internals.

## TDD Rules For This Plan

Every route behavior starts with a failing route/component test. Run the red command and confirm the failure is because the grouping UI/temporal behavior is missing, not because of a typo or mock setup error.

Do not add grouping production code before its red test is observed. Regression tests for already-correct behavior can be added in the same task, but the red proof must come from a missing behavior introduced by this slice.

## File Map

- Create: `web/src/lib/utils/timeline-route-options.ts`
  - Shared helper for adding `grouping`, `takenAfter`, and `takenBefore` to routes that only need local temporal state.
- Create: `web/src/lib/utils/__tests__/timeline-route-options.spec.ts`
  - Unit tests for helper behavior, including selected year/month and custom date boundaries.
- Create: `web/src/lib/components/timeline/TimelineRouteGroupingBar.svelte`
  - Shared desktop grouping bar plus optional temporal-only active-chip row for routes without a full `FilterPanel`.
- Create: `web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts`
  - Component tests for desktop control rendering, chip rendering/clearing, hidden state, and result count.
- Modify: `web/src/test-data/mocks/bindable-timeline.stub.svelte`
  - Expose route tests' grouping props, temporal anchor, and bucket activation buttons.
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - Add browse-mode desktop control, card activation, temporal anchor, and grouping props.
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts`
  - Album route tests for grouping control, FilterPanel sync, chips, select-assets exclusion, and empty states.
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`
  - Already has grouping props; add any missing data assertions needed by album tests.
- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - Add grouping, temporal chip state, and bucket activation for personal people.
- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts`
  - Person detail route tests for grouping, temporal chip, mobile props, and selection hiding.
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - Add grouping, temporal chip state, and bucket activation for space people.
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts`
  - Space person tests for space-scoped options, temporal chip, mobile props, and selection hiding.
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/mock-space-person-timeline.test-wrapper.svelte`
  - Expose grouping, temporal anchor, and bucket activation buttons.
- Modify: `web/src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - Add grouping, temporal chip state, and bucket activation for selected tag timelines.
- Modify: `web/src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/tags-page.spec.ts`
  - Tag route tests for grouping, temporal chip, empty child tags, and selection hiding.
- Create or modify route tests for simple timeline pages:
  - `web/src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/favorites-page.spec.ts`
  - `web/src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/archive-page.spec.ts`
  - `web/src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/trash-page.spec.ts`
  - `web/src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/locked-page.spec.ts`
  - `web/src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/partner-page.spec.ts`
- Modify simple route pages:
  - `web/src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - `web/src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - `web/src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - `web/src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - `web/src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - Bind filters into the timeline panel so panel card clicks sync back to the map FilterPanel and chips.
- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/MapTimelinePanel.svelte`
  - Add compact panel grouping control, grouping options, temporal anchor, and activation.
- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts`
  - Map route tests for FilterPanel sync and active chip behavior.
- Create: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-timeline-panel.spec.ts`
  - Direct panel tests for grouping control placement and option construction.
- Modify: `e2e/src/ui/specs/timeline/timeline-grouping.e2e-spec.ts`
  - Add browser smoke coverage for one FilterPanel route and one temporal-chip-only route.

---

## Implementation Tasks

### Task 1: Shared Route Helper And Desktop Grouping Bar

**Files:**

- Create: `web/src/lib/utils/__tests__/timeline-route-options.spec.ts`
- Create: `web/src/lib/utils/timeline-route-options.ts`
- Create: `web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts`
- Create: `web/src/lib/components/timeline/TimelineRouteGroupingBar.svelte`
- Modify: `web/src/test-data/mocks/bindable-timeline.stub.svelte`

- [ ] **Step 1: Write failing route option helper tests**

Create `web/src/lib/utils/__tests__/timeline-route-options.spec.ts`:

```ts
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { buildTimelineRouteOptions } from '$lib/utils/timeline-route-options';
import { AssetVisibility } from '@immich/sdk';

describe('buildTimelineRouteOptions', () => {
  it('adds grouping without temporal bounds when no temporal filter is active', () => {
    const filters = createFilterState();

    expect(buildTimelineRouteOptions({ visibility: AssetVisibility.Archive }, filters, 'year')).toEqual({
      visibility: AssetVisibility.Archive,
      grouping: 'year',
    });
  });

  it('adds selected year bounds while preserving base route filters', () => {
    const filters = createFilterState();
    filters.selectedYear = 2015;

    expect(buildTimelineRouteOptions({ personIds: ['person-1'], withStacked: true }, filters, 'month')).toEqual({
      personIds: ['person-1'],
      withStacked: true,
      grouping: 'month',
      takenAfter: '2015-01-01T00:00:00.000Z',
      takenBefore: '2016-01-01T00:00:00.000Z',
    });
  });

  it('adds selected month bounds as an exclusive month range', () => {
    const filters = createFilterState();
    filters.selectedYear = 2015;
    filters.selectedMonth = 8;

    expect(buildTimelineRouteOptions({ tagId: 'tag-1' }, filters, 'day')).toEqual({
      tagId: 'tag-1',
      grouping: 'day',
      takenAfter: '2015-08-01T00:00:00.000Z',
      takenBefore: '2015-09-01T00:00:00.000Z',
    });
  });

  it('prefers custom date ranges over selected year/month state', () => {
    const filters = createFilterState();
    filters.selectedYear = 2015;
    filters.selectedMonth = 8;
    filters.dateAfter = '2024-01-01';
    filters.dateBefore = '2024-12-31';

    expect(buildTimelineRouteOptions({ isFavorite: true }, filters, 'year')).toEqual({
      isFavorite: true,
      grouping: 'year',
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2025-01-01T00:00:00.000Z',
    });
  });
});
```

- [ ] **Step 2: Run the red helper tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/utils/__tests__/timeline-route-options.spec.ts
```

Expected: FAIL because `timeline-route-options.ts` does not exist.

- [ ] **Step 3: Implement the route option helper**

Create `web/src/lib/utils/timeline-route-options.ts`:

```ts
import { buildFilterContext, type FilterState } from '$lib/components/filter-panel/filter-panel';
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';

export function buildTimelineRouteOptions(
  base: Record<string, unknown>,
  temporalFilters: FilterState,
  grouping: TimelineGrouping,
): Record<string, unknown> {
  const context = buildFilterContext(temporalFilters);
  return {
    ...base,
    grouping,
    ...(context?.takenAfter ? { takenAfter: context.takenAfter } : {}),
    ...(context?.takenBefore ? { takenBefore: context.takenBefore } : {}),
  };
}
```

- [ ] **Step 4: Write failing grouping bar component tests**

Create `web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts`:

```ts
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
import { fireEvent, render, screen } from '@testing-library/svelte';

import TimelineRouteGroupingBar from './TimelineRouteGroupingBar.svelte';

describe('TimelineRouteGroupingBar', () => {
  it('renders a desktop grouping control with the active grouping', () => {
    render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'month',
        onGroupingChange: () => {},
      },
    });

    expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
  });

  it('emits grouping changes without mutating temporal filters', async () => {
    const changes: TimelineGrouping[] = [];
    const filters = createFilterState();
    filters.selectedYear = 2015;

    render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'day',
        filters,
        onGroupingChange: (grouping: TimelineGrouping) => changes.push(grouping),
        onClearTemporalFilter: () => {
          filters.selectedYear = undefined;
        },
      },
    });

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));

    expect(changes).toEqual(['year']);
    expect(filters.selectedYear).toBe(2015);
  });

  it('renders a clearable temporal chip when temporal filters are active', async () => {
    const filters = createFilterState();
    filters.selectedYear = 2015;
    const clears: string[] = [];

    render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'month',
        filters,
        resultCount: 42,
        onGroupingChange: () => {},
        onClearTemporalFilter: () => clears.push('clear'),
      },
    });

    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
    expect(screen.getByTestId('result-count')).toHaveTextContent('42 results');

    await fireEvent.click(screen.getByTestId('chip-close'));

    expect(clears).toEqual(['clear']);
  });

  it('does not render non-temporal chips in the route grouping bar', () => {
    const filters = createFilterState();
    filters.personIds = ['person-1'];

    render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'day',
        filters,
        onGroupingChange: () => {},
        onClearTemporalFilter: () => {},
      },
    });

    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('hides both grouping control and chip row when hidden', () => {
    const filters = createFilterState();
    filters.selectedYear = 2015;

    render(TimelineRouteGroupingBar, {
      props: {
        grouping: 'year',
        filters,
        hidden: true,
        onGroupingChange: () => {},
        onClearTemporalFilter: () => {},
      },
    });

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run the red grouping bar tests**

Run:

```bash
pnpm --filter immich-web exec vitest run src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts
```

Expected: FAIL because `TimelineRouteGroupingBar.svelte` does not exist.

- [ ] **Step 6: Implement the grouping bar**

Create `web/src/lib/components/timeline/TimelineRouteGroupingBar.svelte`:

```svelte
<script lang="ts">
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import { createFilterState, getActiveFilterCount, type FilterState } from '$lib/components/filter-panel/filter-panel';
  import TimelineGroupingControl from '$lib/components/timeline/TimelineGroupingControl.svelte';
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import type { ClassValue } from 'svelte/elements';

  interface Props {
    grouping: TimelineGrouping;
    filters?: FilterState;
    resultCount?: number;
    hidden?: boolean;
    class?: ClassValue;
    onGroupingChange: (grouping: TimelineGrouping) => void;
    onClearTemporalFilter?: () => void;
  }

  let {
    grouping,
    filters,
    resultCount,
    hidden = false,
    class: className = '',
    onGroupingChange,
    onClearTemporalFilter,
  }: Props = $props();

  const temporalFilters = $derived.by(() => {
    if (!filters) {
      return;
    }

    return {
      ...createFilterState(),
      dateAfter: filters.dateAfter,
      dateBefore: filters.dateBefore,
      selectedYear: filters.selectedYear,
      selectedMonth: filters.selectedMonth,
    };
  });
  const hasTemporalChip = $derived(Boolean(temporalFilters && getActiveFilterCount(temporalFilters) > 0));
</script>

{#if !hidden}
  <div
    class={[
      'hidden shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900 md:flex',
      className,
    ]}
    data-testid="timeline-desktop-grouping-control"
  >
    <TimelineGroupingControl {grouping} {onGroupingChange} />
  </div>

  {#if temporalFilters && hasTemporalChip}
    <ActiveFiltersBar
      filters={temporalFilters}
      {resultCount}
      onRemoveFilter={(type) => {
        if (type === 'timeline') {
          onClearTemporalFilter?.();
        }
      }}
      onClearAll={() => onClearTemporalFilter?.()}
    />
  {/if}
{/if}
```

- [ ] **Step 7: Extend the reusable Timeline test stub**

Modify `web/src/test-data/mocks/bindable-timeline.stub.svelte` so route tests can assert grouping props and trigger card activation:

```svelte
<script lang="ts">
  import type { TimelineAsset, TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
  import type { ActivatableTimelineBucket } from '$lib/utils/timeline-filter-navigation';
  import type { Snippet } from 'svelte';

  type TimelineStubGlobals = typeof globalThis & {
    __timelineStubAssetCount?: number;
  };

  interface Props {
    children?: Snippet;
    timelineManager?: unknown;
    options?: Record<string, unknown>;
    grouping?: TimelineGrouping;
    onGroupingChange?: (grouping: TimelineGrouping) => void;
    onTimelineBucketActivate?: (bucket: ActivatableTimelineBucket) => void;
    temporalAnchor?: TimelineTemporalAnchor;
    onTemporalAnchorResolved?: () => void;
    [key: string]: unknown;
  }

  const stubGlobals = globalThis as TimelineStubGlobals;
  const defaultTimeBucket = '2015-08-01T00:00:00.000Z';

  let {
    children,
    timelineManager = $bindable(),
    options = {},
    grouping = 'day',
    onGroupingChange,
    onTimelineBucketActivate,
    temporalAnchor,
    onTemporalAnchorResolved,
    ...rest
  }: Props = $props();

  const stubAssetCount = $derived(stubGlobals.__timelineStubAssetCount ?? 1);
  const stubTimeBuckets = $derived(
    stubAssetCount === 0
      ? []
      : [
          {
            timeBucket: defaultTimeBucket,
            count: stubAssetCount,
            representativeAssetId: 'asset-1',
            representativeThumbhash: 'stub-thumbhash',
            representativeRatio: 1,
          },
        ],
  );
  const serializedOptions = $derived(JSON.stringify(options ?? {}));

  $effect(() => {
    const nextTimelineManager = {
      months:
        stubAssetCount === 0
          ? []
          : [{ yearMonth: { year: 2015, month: 8 }, assetsCount: stubAssetCount, timelineDays: [] }],
      timelineBuckets: stubTimeBuckets,
      assetCount: stubAssetCount,
      isInitialized: true,
      showAssetOwners: false,
      suspendTransitions: false,
      removeAssets: () => {},
      upsertAssets: () => {},
      update: () => {},
      toggleShowAssetOwners: () => {},
      getRandomAsset: () => Promise.resolve(undefined as TimelineAsset | undefined),
    };

    if (timelineManager && typeof timelineManager === 'object') {
      Object.assign(timelineManager, nextTimelineManager);
    } else {
      timelineManager = nextTimelineManager;
    }
  });
</script>

<div
  {...rest}
  data-testid="timeline-stub"
  data-has-timeline={String(timelineManager !== undefined)}
  data-options={serializedOptions}
>
  <div data-testid="timeline-options">{serializedOptions}</div>
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
  <button type="button" data-testid="timeline-mobile-set-year" onclick={() => onGroupingChange?.('year')}>
    Mobile year
  </button>
  <div data-testid="timeline-mobile-grouping-props">
    {JSON.stringify({ grouping, hasHandler: Boolean(onGroupingChange) })}
  </div>
  <div data-testid="timeline-anchor">{JSON.stringify(temporalAnchor ?? null)}</div>
  <button type="button" data-testid="resolve-timeline-anchor" onclick={() => onTemporalAnchorResolved?.()}>
    Resolve anchor
  </button>
  {@render children?.()}
</div>
```

- [ ] **Step 8: Run green shared tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/utils/__tests__/timeline-route-options.spec.ts \
  src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit shared route helpers**

```bash
git add \
  web/src/lib/utils/timeline-route-options.ts \
  web/src/lib/utils/__tests__/timeline-route-options.spec.ts \
  web/src/lib/components/timeline/TimelineRouteGroupingBar.svelte \
  web/src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts \
  web/src/test-data/mocks/bindable-timeline.stub.svelte
git commit -m "feat(web): add shared timeline route grouping helpers"
```

### Task 2: Adopt Grouping On Album Detail Timeline

**Files:**

- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts`
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/mock-timeline.test-wrapper.svelte`

- [x] **Step 1: Add failing album route tests**

Append these tests to `page.route.spec.ts`. Keep the real `ActiveFiltersBar` in this spec because existing album tests assert real chip labels with `active-chip`:

```ts
it('renders album browse grouping controls and passes mobile grouping props', async () => {
  renderPage();

  await waitFor(() => expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument());
  expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
    JSON.stringify({ grouping: 'day', hasHandler: true }),
  );
});

it('changes album grouping without changing album filters or URL state', async () => {
  renderPage();
  const user = userEvent.setup();

  await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
  await user.click(screen.getByTestId('people-item-person-view'));
  await user.click(screen.getByTestId('timeline-grouping-year'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
    expect(screen.getByTestId('active-chip')).toHaveTextContent('Album Person');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });
});

it('clicking album year and month buckets syncs the album FilterPanel temporal state', async () => {
  renderPage();

  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015 }));
  });

  await fireEvent.click(screen.getByTestId('activate-month-bucket'));
  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('Aug 2015');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015, month: 8 }));
  });
});

it('clears album temporal chips while preserving non-time album filters and grouping', async () => {
  renderPage();
  const user = userEvent.setup();

  await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
  await user.click(screen.getByTestId('people-item-person-view'));
  await fireEvent.click(screen.getByTestId('activate-year-bucket'));
  await fireEvent.click(screen.getByLabelText('Remove 2015 filter'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('active-chip')).toHaveTextContent('Album Person');
    expect(screen.getByTestId('active-filters-bar')).not.toHaveTextContent('2015');
  });
});

it('does not render browse grouping controls in album select-assets or select-thumbnail modes', async () => {
  renderPage();

  await fireEvent.click(screen.getByLabelText('add_photos'));
  await waitFor(() => expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument());
  expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"grouping"');

  await fireEvent.click(screen.getByLabelText('close'));
  await userEvent.click(screen.getByLabelText('album_options'));
  await userEvent.click(screen.getByText('select_album_cover'));

  expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"grouping"');
  expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
    JSON.stringify({ grouping: 'day', hasHandler: false }),
  );
});
```

- [x] **Step 2: Run red album tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts' \
  -t 'album browse grouping|changes album grouping|album year and month buckets|clears album temporal|select-assets or select-thumbnail'
```

Expected: FAIL because album does not render grouping controls or pass bucket activation props.

- [x] **Step 3: Wire album grouping state and handlers**

In `+page.svelte`, add imports:

```ts
import TimelineGroupingControl from '$lib/components/timeline/TimelineGroupingControl.svelte';
import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  getTimelineManagerTimeBuckets,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';
```

Add state near the existing filter state:

```ts
let timelineGrouping = $state<TimelineGrouping>('day');
let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
```

Replace `timeBuckets` with the grouping-aware source:

```ts
const timeBuckets = $derived(getTimelineManagerTimeBuckets(timelineManager));
```

Add a derived browse-mode guard and update browse options only:

```ts
const isBrowseTimeline = $derived(viewMode === AlbumPageViewMode.VIEW);

const options = $derived.by(() => {
  if (viewMode === AlbumPageViewMode.SELECT_ASSETS) {
    return buildAlbumAssetPickerOptions(album.id, pickerFilters);
  }

  const baseOptions = buildAlbumTimelineOptions(
    album.id,
    album.order ?? authManager.preferences.albums.defaultAssetOrder,
    albumFilters,
  );

  return isBrowseTimeline ? { ...baseOptions, grouping: timelineGrouping } : baseOptions;
});
```

Add handlers:

```ts
function handleTimelineGroupingChange(grouping: TimelineGrouping) {
  timelineGrouping = grouping;
  temporalAnchor = undefined;
}

function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
  const result = activateTimelineBucket(albumFilters, bucket);
  if (!result) {
    return;
  }

  albumFilters = result.filters;
  timelineGrouping = result.grouping;
  temporalAnchor = result.anchor;
}

function clearAlbumTemporalFilter() {
  albumFilters = clearTimelineTemporalFilter(albumFilters);
  temporalAnchor = undefined;
}
```

Render the desktop control above album active chips, only in browse mode:

```svelte
          {#if viewMode === AlbumPageViewMode.VIEW && !assetMultiSelectManager.selectionActive}
            <div
              class="hidden shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900 md:flex"
              data-testid="timeline-desktop-grouping-control"
            >
              <TimelineGroupingControl grouping={timelineGrouping} onGroupingChange={handleTimelineGroupingChange} />
            </div>
          {/if}
```

Update the album `ActiveFiltersBar` `onRemoveFilter` and `onClearAll` callbacks:

```svelte
              onRemoveFilter={(type, id) => {
                albumFilters = type === 'timeline' ? clearTimelineTemporalFilter(albumFilters) : handlePhotosRemoveFilter(albumFilters, type, id);
                if (type === 'timeline') {
                  temporalAnchor = undefined;
                }
              }}
              onClearAll={() => {
                albumFilters = clearFilters(albumFilters);
                temporalAnchor = undefined;
              }}
```

Pass grouping props to browse `Timeline`:

```svelte
              onTimelineBucketActivate={isBrowseTimeline ? handleTimelineBucketActivate : undefined}
              temporalAnchor={isBrowseTimeline ? temporalAnchor : undefined}
              onTemporalAnchorResolved={isBrowseTimeline ? () => (temporalAnchor = undefined) : undefined}
              grouping={isBrowseTimeline ? timelineGrouping : 'day'}
              onGroupingChange={isBrowseTimeline ? handleTimelineGroupingChange : undefined}
```

- [x] **Step 4: Run green album tests**

Run the same focused album command from Step 2.

Expected: PASS.

- [x] **Step 5: Commit album adoption**

```bash
git add \
  web/src/routes/'(user)'/albums/'[albumId=id]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/albums/'[albumId=id]'/'[[photos=photos]]'/'[[assetId=id]]'/page.route.spec.ts \
  web/src/routes/'(user)'/albums/'[albumId=id]'/'[[photos=photos]]'/'[[assetId=id]]'/mock-timeline.test-wrapper.svelte
git commit -m "feat(web): add album timeline grouping controls"
```

### Task 3: Adopt Grouping On People And Space Person Detail Timelines

**Files:**

- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/mock-space-person-timeline.test-wrapper.svelte`

- [x] **Step 1: Add failing personal person route tests**

Append to `person-detail-page.spec.ts`:

```ts
it('renders person grouping controls and passes mobile grouping props', () => {
  renderPage();

  expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
    JSON.stringify({ grouping: 'day', hasHandler: true }),
  );
});

it('clicking a person year bucket sets temporal chip state and keeps the person option', async () => {
  renderPage();

  await userEvent.click(screen.getByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"personIds":["person-1"]');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015 }));
  });
});

it('clearing the person temporal chip keeps month grouping and removes time bounds', async () => {
  renderPage();

  await userEvent.click(screen.getByTestId('activate-year-bucket'));
  await userEvent.click(screen.getByTestId('chip-close'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
    expect(screen.getByTestId('active-filters-bar')).not.toBeInTheDocument();
  });
});

it('hides person desktop grouping controls during selection mode', () => {
  mockAssetMultiSelectManager.selectionActive = true;

  renderPage();

  expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
});
```

- [x] **Step 2: Add failing space person route tests**

Append to `space-person-detail-page.spec.ts`:

```ts
it('renders space person grouping controls and passes space-scoped mobile props', () => {
  renderPage();

  expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
    JSON.stringify({ grouping: 'day', hasHandler: true }),
  );
});

it('clicking a space person year bucket sets temporal chip state and keeps space person options', async () => {
  renderPage();

  await userEvent.click(screen.getByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spaceId":"space-1"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"spacePersonIds":["person-1"]');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
  });
});

it('hides space person desktop grouping controls during selection mode', () => {
  mockAssetMultiSelectManager.selectionActive = true;

  renderPage();

  expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
});
```

- [x] **Step 3: Run red person route tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts' \
  -t 'person grouping|person year bucket|person temporal chip|selection mode'
```

Expected: FAIL because neither route renders desktop grouping controls or passes activation props.

- [x] **Step 4: Implement person route grouping**

In both person route files, add imports:

```ts
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import TimelineRouteGroupingBar from '$lib/components/timeline/TimelineRouteGroupingBar.svelte';
import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
import { buildTimelineRouteOptions } from '$lib/utils/timeline-route-options';
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';
```

Add state:

```ts
let timelineGrouping = $state<TimelineGrouping>('day');
let timelineFilters = $state(createFilterState());
let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
```

For personal people, update options:

```ts
const options = $derived(
  buildTimelineRouteOptions({ personIds: [person.id], withStacked: true }, timelineFilters, timelineGrouping),
);
```

For space people, update options:

```ts
const options = $derived(
  buildTimelineRouteOptions(
    { spaceId: space.id, spacePersonIds: [person.id], withStacked: true },
    timelineFilters,
    timelineGrouping,
  ),
);
```

Add handlers in both routes:

```ts
function handleTimelineGroupingChange(grouping: TimelineGrouping) {
  timelineGrouping = grouping;
  temporalAnchor = undefined;
}

function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
  const result = activateTimelineBucket(timelineFilters, bucket);
  if (!result) {
    return;
  }

  timelineFilters = result.filters;
  timelineGrouping = result.grouping;
  temporalAnchor = result.anchor;
}

function clearTemporalFilter() {
  timelineFilters = clearTimelineTemporalFilter(timelineFilters);
  temporalAnchor = undefined;
}
```

Render the bar immediately above `Timeline`:

```svelte
    <TimelineRouteGroupingBar
      grouping={timelineGrouping}
      filters={timelineFilters}
      resultCount={timelineManager?.assetCount}
      hidden={assetMultiSelectManager.selectionActive}
      onGroupingChange={handleTimelineGroupingChange}
      onClearTemporalFilter={clearTemporalFilter}
    />
```

Pass props into `Timeline`:

```svelte
      onTimelineBucketActivate={handleTimelineBucketActivate}
      {temporalAnchor}
      onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
      grouping={timelineGrouping}
      onGroupingChange={handleTimelineGroupingChange}
```

- [x] **Step 5: Run green person route tests**

Run the same focused command from Step 3.

Expected: PASS.

- [x] **Step 6: Commit people adoption**

```bash
git add \
  web/src/routes/'(user)'/people/'[personId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/people/'[personId]'/'[[photos=photos]]'/'[[assetId=id]]'/person-detail-page.spec.ts \
  web/src/routes/'(user)'/spaces/'[spaceId]'/people/'[personId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/spaces/'[spaceId]'/people/'[personId]'/'[[photos=photos]]'/'[[assetId=id]]'/space-person-detail-page.spec.ts \
  web/src/routes/'(user)'/spaces/'[spaceId]'/people/'[personId]'/'[[photos=photos]]'/'[[assetId=id]]'/mock-space-person-timeline.test-wrapper.svelte
git commit -m "feat(web): add people timeline grouping controls"
```

### Task 4: Adopt Grouping On Tags And Simple Library Routes

**Files:**

- Modify: `web/src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/tags-page.spec.ts`
- Modify/Create:
  - `web/src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - `web/src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/favorites-page.spec.ts`
  - `web/src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - `web/src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/archive-page.spec.ts`
  - `web/src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - `web/src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/trash-page.spec.ts`
  - `web/src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - `web/src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/locked-page.spec.ts`
  - `web/src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  - `web/src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/partner-page.spec.ts`

- [x] **Step 1: Add failing tags route tests**

Replace the current zero-argument `renderPage()` helper in `tags-page.spec.ts` with an override-aware helper that matches the existing local `makeTag()` factory:

```ts
function renderPage(overrides: { path?: string; tags?: TagResponseDto[] } = {}) {
  const props = {
    data: {
      tags: overrides.tags ?? [makeTag()],
      path: overrides.path ?? 'Trips',
      meta: { title: overrides.path ?? 'Trips' },
    },
  };

  return render(TestWrapper as Component<{ component: typeof TagsPage; componentProps: typeof props }>, {
    component: TagsPage,
    componentProps: props,
  });
}
```

Append to `tags-page.spec.ts`:

```ts
it('renders tag grouping controls for a selected tag timeline', async () => {
  renderPage({ path: 'Trips', tags: [makeTag({ id: 'tag-1', value: 'Trips' })] });

  expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  expect(screen.getByTestId('timeline-options')).toHaveTextContent('"tagId":"tag-1"');
  expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
    JSON.stringify({ grouping: 'day', hasHandler: true }),
  );
});

it('clicking a tag year bucket keeps tag scope and exposes a clearable temporal chip', async () => {
  renderPage({ path: 'Trips', tags: [makeTag({ id: 'tag-1', value: 'Trips' })] });

  await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"tagId":"tag-1"');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
  });

  await fireEvent.click(screen.getByTestId('chip-close'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });
});

it('does not render tag grouping controls when the selected tag has only child tags', () => {
  renderPage({ path: 'Trips', tags: [makeTag({ id: 'tag-child', value: 'Trips/Child' })] });

  expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
});
```

- [x] **Step 2: Add failing simple route tests**

Create or extend the simple route specs. Each spec should mock `Timeline.svelte` with `@test-data/mocks/bindable-timeline.stub.svelte` and include route-specific base option assertions.

In each simple route spec, add or extend the existing setup so the shared timeline stub starts with one matching asset and can be forced empty for edge tests:

```ts
type TimelineStubGlobals = typeof globalThis & {
  __timelineStubAssetCount?: number;
};

const timelineStubGlobals = globalThis as TimelineStubGlobals;

beforeEach(() => {
  vi.clearAllMocks();
  mockAssetMultiSelectManager.selectionActive = false;
  mockAssetMultiSelectManager.assets = [];
  timelineStubGlobals.__timelineStubAssetCount = 1;
});

afterEach(() => {
  delete timelineStubGlobals.__timelineStubAssetCount;
});
```

Use this exact assertion shape for each route:

```ts
it('renders timeline grouping controls and passes mobile grouping props', () => {
  renderPage();

  expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
  expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
    JSON.stringify({ grouping: 'day', hasHandler: true }),
  );
});

it('clicking year and month buckets keeps route base options and exposes temporal chips', async () => {
  renderPage();

  await fireEvent.click(screen.getByTestId('activate-year-bucket'));
  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
  });

  await fireEvent.click(screen.getByTestId('activate-month-bucket'));
  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('Aug 2015');
  });
});

it('shows a singular temporal result count when the route has one matching asset', async () => {
  renderPage();

  await fireEvent.click(screen.getByTestId('activate-year-bucket'));

  await waitFor(() => {
    expect(screen.getByTestId('result-count')).toHaveTextContent('1 result');
  });
});

it('manual grouping changes do not create temporal chips', async () => {
  renderPage();

  await fireEvent.click(screen.getByTestId('timeline-grouping-year'));

  await waitFor(() => {
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });
});

it('hides desktop grouping controls during selection mode', () => {
  mockAssetMultiSelectManager.selectionActive = true;

  renderPage();

  expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
});

it('does not render orphaned grouping controls over an unfiltered empty placeholder', () => {
  timelineStubGlobals.__timelineStubAssetCount = 0;

  renderPage();

  expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  expect(screen.getByTestId('timeline-stub')).toBeInTheDocument();
});
```

Add these route-specific option checks:

```ts
// favorites-page.spec.ts
expect(screen.getByTestId('timeline-options')).toHaveTextContent('"isFavorite":true');

// archive-page.spec.ts
expect(screen.getByTestId('timeline-options')).toHaveTextContent('"visibility":"archive"');

// trash-page.spec.ts
expect(screen.getByTestId('timeline-options')).toHaveTextContent('"isTrashed":true');

// locked-page.spec.ts
expect(screen.getByTestId('timeline-options')).toHaveTextContent('"visibility":"locked"');

// partner-page.spec.ts
expect(screen.getByTestId('timeline-options')).toHaveTextContent('"userId":"partner-user-id"');
```

- [x] **Step 3: Run red tags and simple route tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/tags-page.spec.ts' \
  'src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/favorites-page.spec.ts' \
  'src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/archive-page.spec.ts' \
  'src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/trash-page.spec.ts' \
  'src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/locked-page.spec.ts' \
  'src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/partner-page.spec.ts' \
  -t 'grouping controls|year and month buckets|manual grouping|selection mode|selected tag|singular temporal|orphaned grouping'
```

Expected: FAIL because these routes do not render grouping controls or pass activation props.

- [x] **Step 4: Implement tags and simple route grouping**

For tags and each simple route, add the same imports:

```ts
import { createFilterState, getActiveFilterCount } from '$lib/components/filter-panel/filter-panel';
import TimelineRouteGroupingBar from '$lib/components/timeline/TimelineRouteGroupingBar.svelte';
import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
import { buildTimelineRouteOptions } from '$lib/utils/timeline-route-options';
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';
```

Add route-local temporal state:

```ts
let timelineGrouping = $state<TimelineGrouping>('day');
let timelineFilters = $state(createFilterState());
let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
const isUnfilteredTimelineEmpty = $derived(
  timelineManager?.isInitialized && timelineManager.assetCount === 0 && getActiveFilterCount(timelineFilters) === 0,
);
```

Use the helper for options. Examples:

```ts
// tags
const options = $derived(
  buildTimelineRouteOptions({ deferInit: !tag, tagId: tag?.id }, timelineFilters, timelineGrouping),
);

// favorites
const options = $derived(
  buildTimelineRouteOptions({ isFavorite: true, withStacked: true }, timelineFilters, timelineGrouping),
);

// archive
const options = $derived(
  buildTimelineRouteOptions({ visibility: AssetVisibility.Archive }, timelineFilters, timelineGrouping),
);

// trash
const options = $derived(buildTimelineRouteOptions({ isTrashed: true }, timelineFilters, timelineGrouping));

// locked
const options = $derived(
  buildTimelineRouteOptions({ visibility: AssetVisibility.Locked }, timelineFilters, timelineGrouping),
);

// partners
const options = $derived(
  buildTimelineRouteOptions(
    { userId: data.partner.id, visibility: AssetVisibility.Timeline, withStacked: true },
    timelineFilters,
    timelineGrouping,
  ),
);
```

Add handlers:

```ts
function handleTimelineGroupingChange(grouping: TimelineGrouping) {
  timelineGrouping = grouping;
  temporalAnchor = undefined;
}

function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
  const result = activateTimelineBucket(timelineFilters, bucket);
  if (!result) {
    return;
  }

  timelineFilters = result.filters;
  timelineGrouping = result.grouping;
  temporalAnchor = result.anchor;
}

function clearTemporalFilter() {
  timelineFilters = clearTimelineTemporalFilter(timelineFilters);
  temporalAnchor = undefined;
}
```

Render `TimelineRouteGroupingBar` above each `Timeline`, hidden in selection mode:

```svelte
  <TimelineRouteGroupingBar
    grouping={timelineGrouping}
    filters={timelineFilters}
    resultCount={timelineManager?.assetCount}
    hidden={assetMultiSelectManager.selectionActive || isUnfilteredTimelineEmpty}
    onGroupingChange={handleTimelineGroupingChange}
    onClearTemporalFilter={clearTemporalFilter}
  />
```

Pass props into each `Timeline`:

```svelte
    onTimelineBucketActivate={handleTimelineBucketActivate}
    {temporalAnchor}
    onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
    grouping={timelineGrouping}
    onGroupingChange={handleTimelineGroupingChange}
```

- [x] **Step 5: Run green tags and simple route tests**

Run the same focused command from Step 3.

Expected: PASS.

- [x] **Step 6: Commit tags and simple route adoption**

```bash
git add \
  web/src/routes/'(user)'/tags/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/tags/'[[photos=photos]]'/'[[assetId=id]]'/tags-page.spec.ts \
  web/src/routes/'(user)'/favorites/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/favorites/'[[photos=photos]]'/'[[assetId=id]]'/favorites-page.spec.ts \
  web/src/routes/'(user)'/archive/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/archive/'[[photos=photos]]'/'[[assetId=id]]'/archive-page.spec.ts \
  web/src/routes/'(user)'/trash/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/trash/'[[photos=photos]]'/'[[assetId=id]]'/trash-page.spec.ts \
  web/src/routes/'(user)'/locked/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/locked/'[[photos=photos]]'/'[[assetId=id]]'/locked-page.spec.ts \
  web/src/routes/'(user)'/partners/'[userId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/partners/'[userId]'/'[[photos=photos]]'/'[[assetId=id]]'/partner-page.spec.ts
git commit -m "feat(web): add grouping to remaining library timelines"
```

### Task 5: Adopt Grouping In The Map Timeline Panel

**Files:**

- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/MapTimelinePanel.svelte`
- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts`
- Create: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-timeline-panel.spec.ts`
- Create: `web/src/test-data/mocks/map-timeline-panel-grouping.stub.svelte`
- Modify: `web/src/test-data/mocks/map-component.stub.svelte`

- [x] **Step 1: Add failing MapTimelinePanel tests**

Create `map-timeline-panel.spec.ts`:

```ts
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';

import MapTimelinePanel from './MapTimelinePanel.svelte';

const { mockAssetMultiSelectManager } = vi.hoisted(() => ({
  mockAssetMultiSelectManager: {
    selectionActive: false,
    assets: [],
    ownedAssets: [],
    clear: vi.fn(),
    getOwnedAssets: vi.fn(() => []),
    isAllFavorite: false,
    isAllArchived: false,
    isAllUserOwned: true,
  },
}));

vi.mock('$lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/bindable-timeline.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/context-menu/button-context-menu.svelte', async () => {
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

vi.mock('$lib/components/timeline/actions/LinkLivePhotoAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/SelectAllAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/SetVisibilityAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/StackAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/actions/TagAction.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/elements/Portal.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { preferences: { tags: { enabled: true } } },
}));

vi.mock('$lib/services/asset.service', () => ({
  getAssetBulkActions: vi.fn(() => ({})),
}));

function renderPanel(filters = createFilterState()) {
  return render(
    TestWrapper as Component<{ component: typeof MapTimelinePanel; componentProps: Record<string, unknown> }>,
    {
      component: MapTimelinePanel,
      componentProps: {
        bbox: { west: 1, south: 2, east: 3, north: 4 },
        selectedClusterIds: new Set(['asset-1', 'asset-2']),
        assetCount: 2,
        filters,
        onClose: vi.fn(),
      },
    },
  );
}

describe('MapTimelinePanel grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    mockAssetMultiSelectManager.ownedAssets = [];
  });

  it('renders compact grouping controls and passes mobile grouping props', () => {
    renderPanel();

    expect(screen.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
      JSON.stringify({ grouping: 'day', hasHandler: true }),
    );
  });

  it('manual grouping changes keep map bbox and selected cluster filters without temporal chips', async () => {
    renderPanel();

    await fireEvent.click(screen.getByTestId('timeline-grouping-year'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"assetFilter":{}');
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    });
  });

  it('year bucket activation updates panel temporal filters and anchors the map panel', async () => {
    renderPanel(createFilterState());

    await fireEvent.click(screen.getByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"takenAfter":"2015-01-01T00:00:00.000Z"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"takenBefore":"2016-01-01T00:00:00.000Z"');
      expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015 }));
    });
  });

  it('month bucket activation switches to day grouping and uses an exclusive month range', async () => {
    renderPanel(createFilterState());

    await fireEvent.click(screen.getByTestId('activate-month-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"takenAfter":"2015-08-01T00:00:00.000Z"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"takenBefore":"2015-09-01T00:00:00.000Z"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent(JSON.stringify({ year: 2015, month: 8 }));
    });
  });

  it('hides panel grouping controls while selection mode is active', () => {
    mockAssetMultiSelectManager.selectionActive = true;

    renderPanel();

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
      JSON.stringify({ grouping: 'day', hasHandler: false }),
    );
  });
});
```

- [x] **Step 2: Add failing map route sync tests**

Create `web/src/test-data/mocks/map-timeline-panel-grouping.stub.svelte`:

```svelte
<script lang="ts">
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';

  interface Props {
    filters?: FilterState;
    onClose?: () => void;
    [key: string]: unknown;
  }

  let { filters = $bindable(), onClose, ...rest }: Props = $props();

  function activateYear() {
    filters = { ...filters, selectedYear: 2015 };
  }
</script>

<div {...rest} data-testid="map-timeline-panel-stub" data-selected-year={filters?.selectedYear ?? ''}>
  <button type="button" data-testid="map-panel-activate-year" onclick={activateYear}>Activate year</button>
  <button type="button" data-testid="map-panel-close" onclick={() => onClose?.()}>Close</button>
</div>
```

Modify `web/src/test-data/mocks/map-component.stub.svelte` to expose a deterministic cluster button:

```svelte
<script lang="ts">
  import type { SelectionBBox } from '$lib/components/shared-components/map/types';
  import type { Snippet } from 'svelte';

  type Marker = {
    id: string;
    lat?: number;
    lon?: number;
    city?: string | null;
    state?: string | null;
    country?: string | null;
  };

  interface Props {
    mapMarkers?: Marker[];
    popup?: Snippet<[{ marker: Marker }]>;
    onClusterSelect?: (assetIds: string[], bbox: SelectionBBox) => void;
    [key: string]: unknown;
  }

  let { mapMarkers = [], popup, onClusterSelect, ...rest }: Props = $props();
</script>

<div
  {...rest}
  data-testid="map-stub"
  data-marker-count={String(mapMarkers.length)}
  data-marker-ids={mapMarkers.map((marker) => marker.id).join(',')}
>
  {#if popup && mapMarkers[0]}
    <div data-testid="map-popup">
      {@render popup({ marker: mapMarkers[0] })}
    </div>
  {/if}
  {#if onClusterSelect && mapMarkers[0]}
    <button
      type="button"
      data-testid={`map-cluster-${mapMarkers[0].id}`}
      onclick={() => onClusterSelect([mapMarkers[0].id], { west: 1, south: 2, east: 3, north: 4 })}
    >
      Open cluster
    </button>
  {/if}
</div>
```

In `map-page.spec.ts`, change the existing `MapTimelinePanel.svelte` mock from `noop-component.svelte` to `map-timeline-panel-grouping.stub.svelte`:

```ts
vi.mock('./MapTimelinePanel.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/map-timeline-panel-grouping.stub.svelte');
  return { default: MockComponent };
});
```

Extend the existing `afterEach` so the mobile viewport override in the new test cannot leak:

```ts
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});
```

Append to `map-page.spec.ts`:

```ts
it('lets the map timeline panel write temporal filters back to the map FilterPanel and chips', async () => {
  sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);

  renderPage();
  await flushQueryDebounce();
  await fireEvent.click(screen.getByTestId('map-cluster-asset-1'));
  await fireEvent.click(screen.getByTestId('map-panel-activate-year'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
  });
});

it('clears panel-written temporal state from map chips and the FilterPanel', async () => {
  sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);

  renderPage();
  await flushQueryDebounce();
  await fireEvent.click(screen.getByTestId('map-cluster-asset-1'));
  await fireEvent.click(screen.getByTestId('map-panel-activate-year'));
  await fireEvent.click(screen.getByTestId('clear-all-btn'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });
});

it('does not leave panel-written temporal state in the mobile filter overlay after clearing map chips', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);

  renderPage();
  await flushQueryDebounce();
  await fireEvent.click(screen.getByTestId('map-cluster-asset-1'));
  await fireEvent.click(screen.getByTestId('map-panel-activate-year'));
  await fireEvent.click(screen.getByTestId('map-panel-close'));
  await fireEvent.click(screen.getByTestId('clear-all-btn'));
  await fireEvent.click(screen.getByTestId('map-mobile-filter-toggle'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
  });
});
```

- [x] **Step 3: Run red map tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-timeline-panel.spec.ts' \
  'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts' \
  -t 'MapTimelinePanel grouping|map timeline panel write temporal|clears panel-written temporal'
```

Expected: FAIL because map panel does not render grouping controls and map page does not bind filters into the panel.

- [x] **Step 4: Implement map panel grouping and filter binding**

In `+page.svelte`, bind filters into the panel:

Also add a stable test id to the existing mobile filter toggle:

```svelte
        <button type="button" data-testid="map-mobile-filter-toggle" onclick={() => (showMobileFilters = !showMobileFilters)}>
          <Icon icon={mdiFilterVariant} size="24" />
        </button>
```

```svelte
            <MapTimelinePanel
              bbox={selectedClusterBBox}
              {selectedClusterIds}
              assetCount={selectedClusterIds.size}
              onClose={closeTimelinePanel}
              {spaceId}
              bind:filters
            />
```

In `MapTimelinePanel.svelte`, update props:

```ts
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import TimelineRouteGroupingBar from '$lib/components/timeline/TimelineRouteGroupingBar.svelte';
import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
import {
  activateTimelineBucket,
  clearTimelineTemporalFilter,
  type ActivatableTimelineBucket,
} from '$lib/utils/timeline-filter-navigation';

let {
  bbox,
  selectedClusterIds,
  assetCount,
  onClose,
  spaceId,
  filters = $bindable(createFilterState()),
}: Props = $props();
let timelineGrouping = $state<TimelineGrouping>('day');
let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
```

Update `timelineOptions`:

```ts
      {
        ...buildMapTimelineOptions(filters, timelineBoundingBox, selectedClusterIds, spaceId, {
          onlyFavorites: $mapSettings.onlyFavorites,
          withPartners: $mapSettings.withPartners,
        }),
        grouping: timelineGrouping,
      };
```

Add handlers:

```ts
function handleTimelineGroupingChange(grouping: TimelineGrouping) {
  timelineGrouping = grouping;
  temporalAnchor = undefined;
}

function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
  const result = activateTimelineBucket(filters ?? createFilterState(), bucket);
  if (!result) {
    return;
  }

  filters = result.filters;
  timelineGrouping = result.grouping;
  temporalAnchor = result.anchor;
}

function clearTemporalFilter() {
  filters = clearTimelineTemporalFilter(filters ?? createFilterState());
  temporalAnchor = undefined;
}
```

Render compact controls under the panel header and pass props to `Timeline`:

```svelte
  <TimelineRouteGroupingBar
    class="md:flex px-2 py-1"
    grouping={timelineGrouping}
    {filters}
    resultCount={assetCount}
    hidden={assetMultiSelectManager.selectionActive}
    onGroupingChange={handleTimelineGroupingChange}
    onClearTemporalFilter={clearTemporalFilter}
  />

  <Timeline
    bind:timelineManager
    enableRouting={false}
    options={timelineOptions}
    onEscape={handleEscape}
    assetInteraction={assetMultiSelectManager}
    showArchiveIcon
    onTimelineBucketActivate={handleTimelineBucketActivate}
    {temporalAnchor}
    onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
    grouping={timelineGrouping}
    onGroupingChange={handleTimelineGroupingChange}
  />
```

- [x] **Step 5: Run green map tests**

Run the same focused command from Step 3.

Expected: PASS.

- [x] **Step 6: Commit map panel adoption**

```bash
git add \
  web/src/routes/'(user)'/map/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  web/src/routes/'(user)'/map/'[[photos=photos]]'/'[[assetId=id]]'/MapTimelinePanel.svelte \
  web/src/routes/'(user)'/map/'[[photos=photos]]'/'[[assetId=id]]'/map-page.spec.ts \
  web/src/routes/'(user)'/map/'[[photos=photos]]'/'[[assetId=id]]'/map-timeline-panel.spec.ts \
  web/src/test-data/mocks/map-timeline-panel-grouping.stub.svelte \
  web/src/test-data/mocks/map-component.stub.svelte
git commit -m "feat(web): add map timeline grouping controls"
```

### Task 6: Browser-Level Route Adoption Smoke Coverage

**Files:**

- Modify: `e2e/src/ui/specs/timeline/timeline-grouping.e2e-spec.ts`

- [ ] **Step 1: Add failing browser smoke tests**

Reset mutable mock state in the existing `test.beforeEach` so the new route smoke tests are deterministic:

```ts
test.beforeEach(async ({ context }) => {
  changes.albumAdditions = [];
  changes.assetDeletions = [];
  changes.assetArchivals = [];
  changes.assetFavorites = [timelineRestData.album.assetIds[0]];

  await setupBaseMockApiRoutes(context, adminUserId);
  await setupTimelineMockApiRoutes(context, timelineRestData, changes, testContext);
});
```

Append to `timeline-grouping.e2e-spec.ts`:

```ts
test('album timeline supports grouping drilldown and temporal chip clearing', async ({ page }) => {
  await page.goto(`/albums/${timelineRestData.album.id}`);

  await page.getByTestId('timeline-grouping-year').click();
  await expect(page.getByTestId('timeline-grouping-year')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('timeline-bucket-card').first().click();
  await expect(page.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('active-filters-bar')).toContainText(/\d{4}/);

  await page.getByTestId('chip-close').click();
  await expect(page.getByTestId('active-filters-bar')).not.toContainText(/\b\d{4}\b/);
});

test('favorites timeline supports temporal chips without a full filter panel', async ({ page }) => {
  await page.goto('/favorites');

  await page.getByTestId('timeline-grouping-year').click();
  await page.getByTestId('timeline-bucket-card').first().click();

  await expect(page.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('active-filters-bar')).toContainText(/\d{4}/);
});
```

- [ ] **Step 2: Run red browser tests**

Run:

```bash
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 pnpm --filter immich-e2e exec playwright test src/ui/specs/timeline/timeline-grouping.e2e-spec.ts
```

Expected: FAIL on album/favorites route grouping controls until Tasks 2 and 4 are implemented. If the local Docker webServer exceeds the configured 60s startup timeout, record that infrastructure blocker and keep the route-level Vitest tests as the runnable guard.

- [ ] **Step 3: Run green browser tests**

After Tasks 2-5 pass, run the same Playwright command.

Expected: PASS, or the same local Docker webServer timeout documented with exact output.

- [ ] **Step 4: Commit browser smoke coverage**

```bash
git add e2e/src/ui/specs/timeline/timeline-grouping.e2e-spec.ts
git commit -m "test(e2e): cover timeline grouping route adoption"
```

### Task 7: Final Verification And Coverage Review

**Files:**

- Verify all files from Tasks 1-6.
- Read: `docs/superpowers/specs/2026-05-19-timeline-grouping-design.md`
- Read: `docs/superpowers/plans/2026-05-20-timeline-grouping-slice-4-ui-controls-cards.md`

- [ ] **Step 1: Run shared helper tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/utils/__tests__/timeline-route-options.spec.ts \
  src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts \
  src/lib/components/timeline/TimelineGroupingControl.spec.ts \
  src/lib/components/timeline/Timeline.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run all adopted route tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts' \
  'src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts' \
  'src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/space-person-detail-page.spec.ts' \
  'src/routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/tags-page.spec.ts' \
  'src/routes/(user)/favorites/[[photos=photos]]/[[assetId=id]]/favorites-page.spec.ts' \
  'src/routes/(user)/archive/[[photos=photos]]/[[assetId=id]]/archive-page.spec.ts' \
  'src/routes/(user)/trash/[[photos=photos]]/[[assetId=id]]/trash-page.spec.ts' \
  'src/routes/(user)/locked/[[photos=photos]]/[[assetId=id]]/locked-page.spec.ts' \
  'src/routes/(user)/partners/[userId]/[[photos=photos]]/[[assetId=id]]/partner-page.spec.ts' \
  'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts' \
  'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-timeline-panel.spec.ts'
```

Expected: PASS.

- [ ] **Step 3: Run previous slice regression tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  src/lib/components/timeline/TimelineBucketCard.spec.ts \
  src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts \
  src/lib/utils/__tests__/timeline-filter-navigation.spec.ts \
  src/lib/utils/__tests__/photos-filter-options.spec.ts \
  src/lib/utils/__tests__/space-filter-options.spec.ts \
  src/lib/utils/__tests__/searchable-page-search.spec.ts \
  src/lib/utils/__tests__/album-filter-options.spec.ts \
  src/lib/utils/__tests__/map-filter-options.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run TypeScript verification**

Run:

```bash
pnpm --filter immich-web run check:typescript
```

Expected: PASS.

- [ ] **Step 5: Run targeted ESLint**

Run:

```bash
pnpm --filter immich-web exec eslint \
  src/lib/utils/timeline-route-options.ts \
  src/lib/utils/__tests__/timeline-route-options.spec.ts \
  src/lib/components/timeline/TimelineRouteGroupingBar.svelte \
  src/lib/components/timeline/TimelineRouteGroupingBar.spec.ts \
  src/test-data/mocks/bindable-timeline.stub.svelte \
  src/routes/'(user)'/albums/'[albumId=id]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/albums/'[albumId=id]'/'[[photos=photos]]'/'[[assetId=id]]'/page.route.spec.ts \
  src/routes/'(user)'/people/'[personId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/people/'[personId]'/'[[photos=photos]]'/'[[assetId=id]]'/person-detail-page.spec.ts \
  src/routes/'(user)'/spaces/'[spaceId]'/people/'[personId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/spaces/'[spaceId]'/people/'[personId]'/'[[photos=photos]]'/'[[assetId=id]]'/space-person-detail-page.spec.ts \
  src/routes/'(user)'/tags/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/tags/'[[photos=photos]]'/'[[assetId=id]]'/tags-page.spec.ts \
  src/routes/'(user)'/favorites/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/archive/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/trash/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/locked/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/partners/'[userId]'/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/map/'[[photos=photos]]'/'[[assetId=id]]'/+page.svelte \
  src/routes/'(user)'/map/'[[photos=photos]]'/'[[assetId=id]]'/MapTimelinePanel.svelte \
  src/routes/'(user)'/map/'[[photos=photos]]'/'[[assetId=id]]'/map-timeline-panel.spec.ts \
  src/test-data/mocks/map-timeline-panel-grouping.stub.svelte \
  src/test-data/mocks/map-component.stub.svelte \
  --max-warnings 0
```

Expected: PASS.

- [ ] **Step 6: Run browser smoke verification**

Run:

```bash
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 pnpm --filter immich-e2e exec playwright test src/ui/specs/timeline/timeline-grouping.e2e-spec.ts
```

Expected: PASS, or document a local e2e infrastructure timeout if Docker webServer startup exceeds the Playwright limit before assertions run.

- [ ] **Step 7: Coverage checklist**

Confirm each item is covered by a named test:

```md
- [ ] Album browse timeline has desktop grouping and mobile grouping props.
- [ ] Album select-assets and select-thumbnail modes do not receive browse grouping state.
- [ ] Album FilterPanel and active chips sync after year/month card activation.
- [ ] Album temporal chip clearing preserves non-time album filters and current grouping.
- [ ] People detail keeps `personIds` scope after grouping and temporal activation.
- [ ] Space person detail keeps `spaceId` and `spacePersonIds` scope after grouping and temporal activation.
- [ ] Tags grouping only renders for tags with assets and preserves child tag empty state.
- [ ] Favorites, archive, trash, locked, and partner routes preserve their base visibility/favorite/trash/user filters.
- [ ] Routes without full FilterPanel expose clearable temporal chips.
- [ ] Manual grouping changes do not create temporal chips.
- [ ] Selection mode hides desktop controls on every adopted route.
- [ ] `Timeline.svelte` mobile floating control receives grouping handler on every adopted route.
- [ ] Map panel writes selected year/month back to map `FilterPanel` and `ActiveFiltersBar`.
- [ ] Map panel keeps bbox and selected-cluster asset filtering while grouping changes.
- [ ] Empty timeline and filtered empty states remain route-specific and visible.
- [ ] Existing day-mode detailed timeline behavior remains covered by slice 4 and manager regression tests.
```

- [ ] **Step 8: Edge-case checklist**

Confirm these edge cases are covered by named tests:

```md
- [ ] Empty route datasets do not render orphaned grouping controls over empty placeholders.
- [ ] Single-bucket/single-asset temporal chip routes show `1 result`.
- [ ] Year card activation preserves active person, tag, album, visibility, favorite, trash, locked, partner, bbox, and map filters.
- [ ] Month card activation switches to day grouping and uses an exclusive next-month bound.
- [ ] Clearing temporal chips removes `takenAfter` and `takenBefore`.
- [ ] Clearing temporal chips does not reset grouping.
- [ ] Manual grouping changes clear stale anchors.
- [ ] Selection bars and mobile controls do not overlap because desktop controls are hidden and mobile control is managed by `Timeline.svelte`.
- [ ] Map mobile filter overlay does not receive stale temporal state after panel closes.
- [ ] Localized month chip labels are covered by existing `ActiveFiltersBar` tests.
- [ ] Dark/light mode styling uses existing shared components.
```

- [ ] **Step 9: Commit verification fixes if needed**

If final verification required fixes, commit them:

```bash
git add <changed-files>
git commit -m "test(web): verify timeline grouping route adoption"
```

## Self-Review Notes

- This plan covers every `Timeline` consumer listed in the design spec except Memories and Search, which are not `TimelineManager` surfaces and are explicitly later `GalleryViewer` slices.
- TDD is explicit for every behavior-changing task: each task starts with failing tests, red command, implementation, green command, and commit.
- The plan preserves slice 4 design: no new card visuals, no new landing/header patterns, and route work is limited to toolbar placement, local state, and option wiring.
- The plan includes edge cases for selection mode, select-assets modes, temporal chip clearing, non-time filter preservation, map panel filter binding, and route-specific empty states.
