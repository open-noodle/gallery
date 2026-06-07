# Timeline Zoom Navigation Slice 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the cross-platform regression and documentation slice by removing the remaining filter-drilldown wording, proving map bucket activation no longer writes date filters, and separating web zoom helpers from explicit temporal-filter helpers.

**Architecture:** Completed slices already moved web and mobile bucket activation to a zoom model: activation changes grouping and stores a scroll anchor, while explicit date filters remain real filters. This slice adds regression/audit coverage around that product rule, splits the remaining legacy-named web helper module so zoom helpers do not live in a filter-navigation module, and updates older specs plus the current QA checklist so future work does not reintroduce temporal-filter drilldown semantics.

**Tech Stack:** Svelte/Vitest web tests, Flutter widget tests, `rg` audit checks, Markdown specs.

---

## Files

- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts`
  - Replace tests that say the map timeline panel writes temporal filters with tests for explicit date-filter behavior.
  - Add a regression test that clicking the mocked map panel's bucket activation button does not mutate `FilterPanel` temporal state or active chips.
- Modify: `web/src/test-data/mocks/map-timeline-panel-grouping.stub.svelte`
  - Keep it as a bindable panel boundary mock, but make `map-panel-activate-year` record a bucket activation without writing `filters.selectedYear`.
- Rename/split:
  - `web/src/lib/utils/timeline-filter-navigation.ts` -> `web/src/lib/utils/timeline-zoom-navigation.ts`
  - Create `web/src/lib/utils/timeline-temporal-filters.ts`
  - `web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts` -> `web/src/lib/utils/__tests__/timeline-zoom-navigation.spec.ts`
  - Create `web/src/lib/utils/__tests__/timeline-temporal-filters.spec.ts`
- Modify web imports that currently reference `$lib/utils/timeline-filter-navigation`:
  - Route components under `web/src/routes/(user)/`
  - Timeline components under `web/src/lib/components/timeline/`
  - GalleryViewer and grouping utilities
  - Test stubs under `web/src/test-data/mocks/`
  - `web/src/lib/utils/photos-filter-options.ts` and `web/src/lib/utils/space-filter-options.ts`
- Modify: `docs/superpowers/specs/2026-05-19-timeline-grouping-design.md`
- Modify: `docs/superpowers/specs/2026-05-22-mobile-timeline-overview-design.md`
- Modify: `docs/superpowers/specs/2026-05-25-timeline-zoom-navigation-design.md`

## Acceptance Coverage

- Existing filter-model documentation is updated or explicitly superseded:
  - The 2026-05-19 web grouping spec no longer says bucket card clicks write temporal filter state or narrow `GalleryViewer` assets.
  - The 2026-05-22 mobile overview spec no longer says bucket card taps create temporal scope or temporal chips.
  - The 2026-05-25 zoom spec's manual QA section includes both bucket-zoom and explicit-filter paths.
- Web and mobile tests cover the same product rule:
  - Web focused verification covers helper tests, map page/panel behavior, Photos, Spaces, and GalleryViewer.
  - Mobile focused verification covers main Photos zoom, shared route zoom, and route-scope/provider behavior.
- No remaining test names claim bucket activation applies temporal filters:
  - The map page specs use "bucket activation" for zoom/no-filter behavior and "explicit temporal filter" for real date filters.
- No legacy web filter-drilldown activation helper remains:
  - `getTimelineBucketZoomTarget` lives in `timeline-zoom-navigation.ts`.
  - `clearTimelineTemporalFilter` lives in `timeline-temporal-filters.ts`.
  - `rg "timeline-filter-navigation" web/src` returns no matches.
- Manual QA covers:
  - `Years -> activate year -> Months -> activate month -> Days/All` with no temporal chip and no temporal URL params.
  - Explicit date filter selection, chip rendering, URL/filter sync, and clearing without losing non-time filters.

## Task 1: Map Page Regression Tests

**Files:**

- Modify: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts`
- Modify: `web/src/test-data/mocks/map-timeline-panel-grouping.stub.svelte`

- [ ] **Step 1: Write the failing map bucket-activation regression**

In `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts`, replace the first panel-written temporal test with:

```ts
it('keeps map FilterPanel temporal state untouched when the timeline panel activates a bucket', async () => {
  sdkMock.getFilteredMapMarkers.mockResolvedValue([{ id: 'asset-1', lat: 1, lon: 2 } as never]);

  renderPage();
  await flushQueryDebounce();
  await flushMapLoad();
  await fireEvent.click(screen.getByTestId('map-cluster-asset-1'));
  await fireEvent.click(screen.getByTestId('map-panel-activate-year'));

  await waitFor(() => {
    expect(screen.getByTestId('map-timeline-panel-stub')).toHaveAttribute('data-bucket-activations', '1');
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rename the two explicit-filter map tests**

In the same file, change the remaining two tests so they exercise the real `FilterPanel` date filter path instead of the mocked bucket activation path:

```ts
it('keeps explicit map temporal filters synchronized with the FilterPanel and chips', async () => {
  renderPage();
  await fireEvent.click(screen.getByTestId('filter-panel-set-year'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '2015');
    expect(screen.getByTestId('active-filters-bar')).toHaveTextContent('2015');
  });
});

it('clears explicit map temporal filter state from map chips and the FilterPanel', async () => {
  renderPage();
  await fireEvent.click(screen.getByTestId('filter-panel-set-year'));
  await fireEvent.click(screen.getByTestId('clear-all-btn'));

  await waitFor(() => {
    expect(screen.getByTestId('filter-panel-stub')).toHaveAttribute('data-selected-year', '');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });
});
```

Rename the mobile overlay test to `does not leave explicit temporal state in the mobile filter overlay after clearing map chips` and set up state with `filter-panel-set-year`:

```ts
renderPage();
await fireEvent.click(screen.getByTestId('filter-panel-set-year'));
await fireEvent.click(screen.getByTestId('clear-all-btn'));
await fireEvent.click(screen.getByTestId('map-mobile-filter-toggle'));
```

- [ ] **Step 3: Run the focused red test**

Run:

```bash
cd web && pnpm exec vitest run 'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts'
```

Expected: FAIL because `map-timeline-panel-grouping.stub.svelte` still writes `filters.selectedYear = 2015`, so the new bucket-activation test sees `data-selected-year="2015"` and an active temporal chip.

- [ ] **Step 4: Make the map panel stub model zoom instead of filters**

In `web/src/test-data/mocks/map-timeline-panel-grouping.stub.svelte`, replace the mutating helper with:

```svelte
  let bucketActivations = $state(0);

  function activateYear() {
    bucketActivations += 1;
  }
```

Update the wrapper attributes:

```svelte
<div
  {...rest}
  data-testid="map-timeline-panel-stub"
  data-selected-year={filters?.selectedYear ?? ''}
  data-bucket-activations={bucketActivations}
>
```

- [ ] **Step 5: Run map tests green**

Run:

```bash
cd web && pnpm exec vitest run 'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts' 'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-timeline-panel.spec.ts'
```

Expected: PASS. The page-level mock no longer creates temporal filters from bucket activation, and the component-level panel tests still prove real map zoom behavior and explicit date-filter chip clearing.

- [ ] **Step 6: Commit**

```bash
git add 'web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts' web/src/test-data/mocks/map-timeline-panel-grouping.stub.svelte
git commit -m "test(web): align map timeline zoom regression coverage"
```

## Task 2: Split Web Zoom And Explicit Temporal-Filter Helpers

**Files:**

- Rename: `web/src/lib/utils/timeline-filter-navigation.ts` -> `web/src/lib/utils/timeline-zoom-navigation.ts`
- Create: `web/src/lib/utils/timeline-temporal-filters.ts`
- Rename: `web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts` -> `web/src/lib/utils/__tests__/timeline-zoom-navigation.spec.ts`
- Create: `web/src/lib/utils/__tests__/timeline-temporal-filters.spec.ts`
- Modify imports listed in the Files section.

- [ ] **Step 1: Run the red legacy-helper audit**

Run:

```bash
rg -n "timeline-filter-navigation" web/src
```

Expected: FAIL-style audit output with all current import paths and the old helper module/test names.

- [ ] **Step 2: Move zoom helpers to the zoom module**

Run:

```bash
git mv web/src/lib/utils/timeline-filter-navigation.ts web/src/lib/utils/timeline-zoom-navigation.ts
git mv web/src/lib/utils/__tests__/timeline-filter-navigation.spec.ts web/src/lib/utils/__tests__/timeline-zoom-navigation.spec.ts
```

In `web/src/lib/utils/timeline-zoom-navigation.ts`, remove the `FilterState` import and remove `clearTimelineTemporalFilter`. The file should export only:

```ts
import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';

export type ActivatableTimelineBucket = {
  grouping: TimelineGrouping;
  date: {
    year: number;
    month?: number;
    day?: number;
  };
};

export type TimelineZoomActivationResult = {
  grouping: TimelineGrouping;
  anchor: TimelineTemporalAnchor;
};
```

Keep the existing `getTimelineBucketZoomTarget` and `getTimelineManagerTimeBuckets` implementations unchanged.

- [ ] **Step 3: Create the explicit temporal-filter module**

Create `web/src/lib/utils/timeline-temporal-filters.ts`:

```ts
import type { FilterState } from '$lib/components/filter-panel/filter-panel';

export function clearTimelineTemporalFilter(filters: FilterState): FilterState {
  return {
    ...filters,
    dateAfter: undefined,
    dateBefore: undefined,
    selectedYear: undefined,
    selectedMonth: undefined,
  };
}
```

- [ ] **Step 4: Split helper tests**

In `web/src/lib/utils/__tests__/timeline-zoom-navigation.spec.ts`, remove `createFilterState`, `clearTimelineTemporalFilter`, and the `clears only temporal filter state` test. Update the import:

```ts
import {
  getTimelineBucketZoomTarget,
  getTimelineManagerTimeBuckets,
} from '../timeline-zoom-navigation';

describe('timeline zoom navigation helpers', () => {
```

Create `web/src/lib/utils/__tests__/timeline-temporal-filters.spec.ts`:

```ts
import { createFilterState } from '$lib/components/filter-panel/filter-panel';

import { clearTimelineTemporalFilter } from '../timeline-temporal-filters';

describe('timeline temporal filter helpers', () => {
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
});
```

- [ ] **Step 5: Update imports**

Use a mechanical rewrite for type/zoom imports:

```bash
rg -l "timeline-filter-navigation" web/src | xargs perl -pi -e 's#\$lib/utils/timeline-filter-navigation#\$lib/utils/timeline-zoom-navigation#g; s#\.\./timeline-filter-navigation#../timeline-zoom-navigation#g'
```

Then manually split imports in files that use `clearTimelineTemporalFilter`:

```ts
import { clearTimelineTemporalFilter } from '$lib/utils/timeline-temporal-filters';
```

Keep `getTimelineBucketZoomTarget` and `ActivatableTimelineBucket` imported from `$lib/utils/timeline-zoom-navigation`.

- [ ] **Step 6: Run helper tests and the green legacy-helper audit**

Run:

```bash
cd web && pnpm exec vitest run src/lib/utils/__tests__/timeline-zoom-navigation.spec.ts src/lib/utils/__tests__/timeline-temporal-filters.spec.ts
rg -n "timeline-filter-navigation" web/src
```

Expected: helper specs PASS, and the `rg` command returns no matches with exit code 1.

- [ ] **Step 7: Run representative web tests after import migration**

Run:

```bash
cd web && pnpm exec vitest run src/lib/utils/__tests__/timeline-zoom-navigation.spec.ts src/lib/utils/__tests__/timeline-temporal-filters.spec.ts 'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' 'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' 'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-timeline-panel.spec.ts' 'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts' src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
```

Expected: PASS. Any import break from the split must be fixed before committing.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "refactor(web): split timeline zoom and temporal filter helpers"
```

## Task 3: Supersede Filter-Drilldown Documentation

**Files:**

- Modify: `docs/superpowers/specs/2026-05-19-timeline-grouping-design.md`
- Modify: `docs/superpowers/specs/2026-05-22-mobile-timeline-overview-design.md`
- Modify: `docs/superpowers/specs/2026-05-25-timeline-zoom-navigation-design.md`

- [ ] **Step 1: Run the red documentation/test-name audit**

Run:

```bash
rg -n "sets the temporal filter|flow back into temporal filter|Wire year/month card clicks to temporal filter state|narrows the visible GalleryViewer assets|applies year temporal scope|applies month temporal scope|clear temporal chip|Temporal drilldown matches the web model|write temporal filters back|panel-written temporal" docs/superpowers/specs/2026-05-19-timeline-grouping-design.md docs/superpowers/specs/2026-05-22-mobile-timeline-overview-design.md 'web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts'
```

Expected: FAIL-style audit output with outdated web spec language, mobile spec language, and old map test names if Task 1 has not already removed them.

- [ ] **Step 2: Update the 2026-05-19 web grouping spec**

Add an update notice after the title:

```md
> Update: The zoom-navigation follow-up spec from 2026-05-25 supersedes this document's original filter-drilldown model. Bucket card activation now changes display grouping and scroll anchor only; explicit date filters remain the only source of temporal narrowing and temporal chips.
```

Replace the old card-click sections so they say:

```md
Card clicks move the user to the next grouping density without updating temporal filter state:

- Clicking `2015` in `Years` switches grouping to `Months` and anchors to that year.
- Clicking `Aug. 2015` in `Months` switches grouping to `Days` and anchors to that month.
- No temporal chip is created. Clearing explicit temporal filters remains available only for date filters the user set through filter UI.
```

Update FilterPanel, route adoption, performance, acceptance criteria, and Slice 3/Slice 6 bullets so no remaining wording says bucket activation writes temporal filters, narrows assets, or exposes chips.

- [ ] **Step 3: Update the 2026-05-22 mobile overview spec**

Add an update notice after the title:

```md
> Update: The zoom-navigation follow-up spec from 2026-05-25 supersedes this document's original temporal-scope drilldown model. Bucket card activation now updates grouping and a route-local zoom anchor only; `TimelineTemporalScope` is reserved for explicit temporal filters where a route exposes them.
```

Replace the old temporal scope sections so they say:

```md
Tapping a year:

- Switches grouping to `Months`.
- Stores a route-local year zoom anchor.
- Reloads buckets under the existing route constraints and explicit filters.
- Does not create a temporal chip or narrow the route by year.

Tapping a month:

- Switches grouping to `Days`.
- Stores a route-local month zoom anchor.
- Reloads buckets under the existing route constraints and explicit filters.
- Does not create a temporal chip or narrow the route by month.
```

Update the Development Process, Testing, Edge Cases, and Open Questions sections so they refer to zoom activation, route-local anchors, explicit temporal filters, and no activation-created temporal chips.

- [ ] **Step 4: Expand the current manual QA checklist**

In `docs/superpowers/specs/2026-05-25-timeline-zoom-navigation-design.md`, expand `## Manual QA Matrix` with two explicit paths:

```md
For each scenario, run both paths:

1. Bucket zoom path: start in `Years`, activate a year, verify `Months` stays scrollable beyond that year with no temporal chip or temporal URL param, activate a month, verify detailed mode stays scrollable beyond that month, then manually switch back to `Years`.
2. Explicit filter path: set an explicit year/month/date-range filter through the route's filter UI, verify buckets and detailed assets are narrowed, verify the temporal chip and URL/filter state appear where that route supports them, clear the temporal chip, and verify non-time filters remain.
```

- [ ] **Step 5: Run the documentation/test-name audit green**

Run:

```bash
rg -n "sets the temporal filter|flow back into temporal filter|Wire year/month card clicks to temporal filter state|narrows the visible GalleryViewer assets|applies year temporal scope|applies month temporal scope|clear temporal chip|Temporal drilldown matches the web model|write temporal filters back|panel-written temporal" docs/superpowers/specs/2026-05-19-timeline-grouping-design.md docs/superpowers/specs/2026-05-22-mobile-timeline-overview-design.md 'web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts'
```

Expected: no matches, exit code 1.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-05-19-timeline-grouping-design.md docs/superpowers/specs/2026-05-22-mobile-timeline-overview-design.md docs/superpowers/specs/2026-05-25-timeline-zoom-navigation-design.md
git commit -m "docs: supersede timeline filter drilldown language"
```

## Task 4: Cross-Platform Verification And Push

**Files:**

- No new file changes expected unless verification exposes a real gap.

- [ ] **Step 1: Run final audits**

Run:

```bash
rg -n "timeline-filter-navigation" web/src
rg -n "write temporal filters back|panel-written temporal|sets the temporal filter|flow back into temporal filter|narrows the visible GalleryViewer assets|applies year temporal scope|applies month temporal scope|Temporal drilldown matches the web model" docs/superpowers/specs/2026-05-19-timeline-grouping-design.md docs/superpowers/specs/2026-05-22-mobile-timeline-overview-design.md web/src mobile/test
```

Expected: both commands return no matches with exit code 1. If the second command finds intentional explicit-filter tests, narrow the pattern only after confirming the matched text is not about bucket activation.

- [ ] **Step 2: Run focused web verification**

Run:

```bash
cd web && pnpm exec vitest run src/lib/utils/__tests__/timeline-zoom-navigation.spec.ts src/lib/utils/__tests__/timeline-temporal-filters.spec.ts 'src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts' 'src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts' 'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-timeline-panel.spec.ts' 'src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts' src/lib/components/shared-components/gallery-viewer/gallery-viewer.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run focused mobile verification**

Run:

```bash
cd mobile && flutter test test/presentation/pages/dev/main_timeline_zoom_test.dart test/presentation/pages/timeline_route_adoption_test.dart test/presentation/widgets/timeline/timeline_route_scope_test.dart -r expanded
```

Expected: PASS. Existing localization warnings are acceptable only if the test process exits 0.

- [ ] **Step 4: Run targeted analyzers/checks for touched areas**

Run:

```bash
cd web && pnpm exec tsc --noEmit
cd mobile && flutter analyze test/presentation/pages/dev/main_timeline_zoom_test.dart test/presentation/pages/timeline_route_adoption_test.dart test/presentation/widgets/timeline/timeline_route_scope_test.dart lib/presentation/widgets/timeline/timeline_route_scope.dart
```

Expected: PASS. If broad mobile analyze is run, note that the repository currently has unrelated `packages/ui/showcase` dependency/import failures.

- [ ] **Step 5: Confirm clean status and push**

Run:

```bash
git status --short
git push
```

Expected: clean working tree before push, then branch pushed to `origin/brainstorm/pr625`.

- [ ] **Step 6: Start CI babysitting**

After the push, run the CI babysitting flow for PR 625. Inspect failing logs if any check fails, fix only failures caused by this branch, and push follow-up commits until CI is green or a real external blocker is documented.
