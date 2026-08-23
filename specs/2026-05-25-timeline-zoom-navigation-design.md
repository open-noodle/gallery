# Timeline Zoom Navigation Design

## Problem

The hierarchical timeline grouping feature currently treats year and month card activation as a temporal filter shortcut. Tapping a `2025` card sets a selected year, switches to month grouping, narrows the dataset to 2025, and shows a clearable temporal chip. Tapping a month does the same at month resolution.

That behavior conflicts with the mental model created by the grouping controls. `Years`, `Months`, and the detailed timeline read as display-resolution choices, not as filters. Users expect to zoom from a year overview to a month overview and then into the detailed timeline while keeping the full eligible archive scrollable. The current filter model makes everything outside the tapped period disappear and forces users to clear a temporal chip before freely browsing again. It also splits experiences that span year or month boundaries, such as late-December to early-January trips.

## Goals

- Make bucket-card activation a zoom/navigation action, not a filter action.
- Keep explicit date filters as real filters.
- Apply the behavior consistently across all web timeline surfaces and mobile timeline surfaces.
- Preserve route-owned constraints such as person, album, space, tag, favorite, archive, locked, trash, partner, map, search, and visibility scopes.
- Keep grouping controls, representative cards, anchors, scrubbers, asset viewers, and active filter chips internally consistent.
- Deliver in small slices that can land independently with complete tests.
- Require TDD for every behavior-changing implementation slice.

## Non-Goals

- Do not remove date filtering from the filter panel or existing search/filter APIs.
- Do not change timeline bucket API semantics unless a slice proves the current API cannot support zoom anchors.
- Do not change persisted grouping enum values.
- Do not redesign representative card visuals beyond copy and state changes required by the zoom model.
- Do not change selection, asset actions, upload, download, archive, trash, or locked-folder behavior except where controls must be disabled in selection contexts.

## Core Model

Grouping is display resolution. Filters define the eligible dataset. Anchors define where the timeline should scroll after the display resolution changes.

Bucket activation must follow this contract:

```ts
Year card tap  -> grouping = 'month', anchor = { year }
Month card tap -> grouping = 'day', anchor = { year, month }
Day group tap  -> no zoom action
Filters        -> unchanged
```

The same rule applies on mobile with platform-native types:

```dart
Year card tap  -> groupBy = GroupAssetsBy.month, anchor = TimelineZoomAnchor.year(year)
Month card tap -> groupBy = GroupAssetsBy.day, anchor = TimelineZoomAnchor.month(year: year, month: month)
Day group tap  -> no zoom action
Filters        -> unchanged
```

Bucket-card activation must never create, clear, or mutate temporal filter state. It may only change grouping and request a scroll anchor.

## Filters

Explicit temporal filter controls remain filters:

- Selecting a year/month/date range in a filter panel narrows the dataset.
- Explicit temporal filters appear in active filter chips.
- Clearing temporal filter chips removes only the temporal filter and keeps other filters.
- URL/query sync may continue to represent explicit filter state.

Bucket activation is different:

- It does not set `selectedYear`, `selectedMonth`, `dateAfter`, or `dateBefore`.
- It does not show a temporal chip.
- It does not sync temporal query params into the URL.
- It does not clear existing explicit date filters. If an explicit date filter is already active, the bucket view and zoom target operate inside that already filtered dataset.

## Labels

The target product label is `Years / Months / All`, where `All` maps internally to detailed day grouping. `All` communicates that the complete eligible dataset remains present at detailed resolution. If a slice cannot safely update labels across all surfaces, `Days` may remain temporarily, but the implementation must still use the zoom model.

Screen-reader copy should describe activation as zoom/navigation, not filtering:

- Year card: `2025, 12 photos, show months`
- Month card: `March 2025, 4 photos, show all photos from this point`
- Grouping control: `Timeline grouping`

Avoid labels such as `filter by year`, `selected year`, or `clear year` for bucket-card activation.

## Web Architecture

Web already has the key separation point:

- `TimelineGrouping` controls display resolution.
- `TimelineTemporalAnchor` identifies the target year/month to scroll to after a grouping change.
- `FilterState` represents real filters.

The target shared zoom activation helper should return only a zoom target:

```ts
type TimelineZoomActivationResult = {
  grouping: TimelineGrouping;
  anchor: TimelineTemporalAnchor;
};
```

It should not accept or return `FilterState`.

During migration, the existing filter-drilldown helper may remain for routes that have not yet moved to the zoom model. Slice 1 must introduce the new zoom helper without converting every caller. Slices 2, 3, and 4 must replace route and GalleryViewer call sites with the zoom helper. After the final web caller is migrated, the legacy filter-drilldown activation helper must be removed or reduced to explicit temporal-filter utilities only.

Route handlers should:

1. Ignore activation during selection mode.
2. Compute the zoom result from the activated bucket.
3. Set route-local grouping.
4. Set route-local temporal anchor.
5. Leave filter state untouched.

`Timeline` should continue to resolve the anchor after the manager initializes for the new grouping. Anchor resolution should be idempotent and should clear the pending anchor only after a matching segment/bucket is found and scrolled to.

### Web Surfaces

The zoom model applies to:

- Main Photos timeline
- Albums
- Shared spaces
- Space person timelines
- People
- Tags
- Favorites
- Archive
- Locked folder
- Trash
- Partners
- Map timeline panel
- GalleryViewer grouping surfaces, including search, folders, memory, share pages, and other asset-array viewers where grouping is enabled

GalleryViewer is asset-array based rather than timeline-query based. Its slice must preserve the full asset array and use local grouping plus local scroll/anchor behavior. It must not use local temporal filter state to hide assets after card activation.

GalleryViewer anchors should resolve against the local asset array:

- Year activation should render month cards for the full local asset array and scroll to the first matching month bucket for the tapped year.
- Month activation should render the detailed local asset grid and scroll to the first matching asset group for the tapped month.
- If the tapped period no longer has a matching asset by the time the view changes, the grouping change should remain, but no filter should be created and no unrelated period should be selected.

## Mobile Architecture

Mobile currently has a route-local `TimelineTemporalScope` model used by card drilldown. That model should no longer be the card-activation mechanism.

Introduce route-local zoom state:

```dart
sealed class TimelineZoomAnchor {
  const TimelineZoomAnchor();
  const factory TimelineZoomAnchor.year(int year) = TimelineZoomYearAnchor;
  const factory TimelineZoomAnchor.month({required int year, required int month}) = TimelineZoomMonthAnchor;
}
```

Mobile route handlers should:

1. Ignore activation during selection or read-only modes where overview activation is disabled.
2. Set `Setting.groupAssetsBy` to month for year activation or day for month activation.
3. Set the route-local zoom anchor.
4. Leave `TimelineTemporalScope` unchanged.
5. Scroll to the matching bucket/month after timeline segments rebuild.

`TimelineTemporalScope` may remain available for explicit date filtering if mobile has a filter UI that needs it. It must not be created by overview card taps.

### Mobile Surfaces

The zoom model applies to Flutter routes that display photo timelines, including:

- Main Photos
- Remote albums
- Local albums
- Shared spaces
- People
- Favorites
- Archive
- Locked folder
- Trash
- Videos
- Places
- Partner detail
- Recently taken
- Local timeline pages
- Any other route using the shared `Timeline` surface with year/month overview cards

Routes that force detailed mode for selection workflows should continue to hide or disable overview activation.

## Slices

Each slice must be independently shippable, tested, and reviewable. Do not mix implementation slices with unrelated cleanup.

### Slice 1: Shared Web Zoom Helper

Create the shared web zoom activation helper so it returns only grouping and anchor. Keep explicit temporal filter helpers separate. Existing filter-drilldown call sites may remain until their route slice migrates them.

Acceptance criteria:

- Year activation returns month grouping and `{ year }` anchor.
- Month activation returns day grouping and `{ year, month }` anchor.
- Day activation returns no result.
- Malformed month buckets return no result.
- The new zoom helper API does not accept or return `FilterState`.
- Existing filter-drilldown helper call sites are not expanded and receive no new callers.

### Slice 2: Web Main Photos

Apply the zoom helper to the Photos route.

Acceptance criteria:

- Tapping a year card switches to month grouping and anchors to the tapped year.
- Tapping a month card switches to day grouping and anchors to the tapped month.
- Photos `FilterState` is unchanged by bucket activation.
- Active filter chips do not gain a temporal chip from bucket activation.
- URL search params do not gain temporal filter params from bucket activation.
- Explicit filter-panel date selections still filter, still show chips, and still sync URL state.

### Slice 3: Web Query Route Timelines

Apply the model to web routes backed by timeline queries: albums, spaces, space people, people, tags, favorites, archive, locked, trash, partners, and map timeline panel.

Acceptance criteria:

- Route-owned options remain intact after bucket activation.
- Bucket activation changes grouping and anchor only.
- Route-local temporal filter state is not created by bucket activation.
- Existing explicit temporal filter chips still work where the route has filter UI.
- Map bbox, selected cluster, space, person, album, tag, archive, locked, trash, favorite, partner, and visibility constraints survive grouping changes.

### Slice 4: Web GalleryViewer

Convert asset-array grouping surfaces to zoom behavior.

Acceptance criteria:

- Manual grouping changes still show representative year/month cards.
- Year card activation switches to month grouping without hiding assets outside the year.
- Month card activation switches to detailed grouping without hiding assets outside the month.
- Year card activation anchors the month-card view to the tapped year when local assets still contain that year.
- Month card activation anchors the detailed grid to the tapped month when local assets still contain that month.
- Asset viewer next/previous navigation continues across year/month boundaries after zoom activation.
- Infinite/intersection loading is not triggered by representative-card views unless it was already required for the visible detailed grid.
- Selection mode hides or disables grouping activation as before.

### Slice 5: Web Copy, Accessibility, And Label Polish

Update labels and semantics after behavior is consistent.

Acceptance criteria:

- Product label is `Years / Months / All` wherever feasible.
- Internal day grouping remains unchanged.
- Screen-reader labels describe zoom/navigation actions.
- Active filter chip copy is reserved for real filters.
- Tests cover desktop and mobile/coarse-pointer web grouping controls.

### Slice 6: Mobile Shared Zoom Model

Introduce mobile zoom anchor state and route/provider plumbing without changing every route at once.

Acceptance criteria:

- A year anchor can scroll a month-grouped timeline to that year.
- A month anchor can scroll a day-grouped timeline to that month.
- Anchor state is route-local and does not leak across sibling route scopes.
- Anchor state clears after successful scroll resolution.
- Existing `TimelineTemporalScope` tests continue to prove explicit scope behavior where still used.

### Slice 7: Mobile Main Photos

Apply zoom activation to mobile Photos.

Acceptance criteria:

- Tapping a year card switches to month grouping and scrolls to that year.
- Tapping a month card switches to day grouping and scrolls to that month.
- No `2025 x` or `Mar 2025 x` chip appears from card activation.
- Existing Photos filters remain active and unchanged.
- Explicit temporal filters, if exposed on mobile Photos, still narrow the dataset and remain clearable.

### Slice 8: Mobile Shared Routes

Apply zoom activation to all remaining Flutter timeline routes.

Acceptance criteria:

- Albums, spaces, people, favorites, archive, locked, trash, videos, places, partners, recently taken, and local timelines share the same behavior.
- Route-owned constraints remain intact.
- Route-local temporal chips created solely for card activation are removed.
- Selection and read-only routes continue to prevent accidental overview activation.

### Slice 9: Cross-Platform Regression And Documentation

Update specs, user-facing docs if needed, and high-level regression coverage.

Acceptance criteria:

- Existing filter-model documentation is updated or superseded.
- Web and mobile tests cover the same product rule.
- No remaining test names claim bucket activation applies temporal filters.
- No legacy web filter-drilldown activation helper remains after the web route and GalleryViewer slices finish.
- Manual QA checklist covers the full zoom path and explicit filter path.

## TDD Requirement

Every implementation slice must use test-driven development:

1. Write or update a focused failing test for the behavior in that slice.
2. Run the focused test and confirm it fails for the expected reason.
3. Implement the smallest production change needed.
4. Run the focused test and confirm it passes.
5. Run the relevant neighboring tests for regression coverage.
6. Commit only after tests pass.

Production code must not be changed before the slice has a failing test that describes the new behavior. If a slice requires multiple behaviors, split them into multiple red-green cycles.

## Test Coverage

### Shared Web Helper Tests

- Year bucket returns month grouping and year anchor.
- Month bucket returns day grouping and month anchor.
- Day bucket returns no result.
- Month bucket without a month number returns no result.
- Helper cannot mutate the filter object because it does not receive one.
- Explicit temporal filter clearing helper remains separate and still clears only date filters.

### Web Photos Tests

- Default grouping remains day/detailed before user changes it.
- Manual grouping change to year/month/all does not mutate filters.
- Year card activation changes grouping to month and sets an anchor.
- Month card activation changes grouping to day and sets an anchor.
- Active filter bar does not show temporal chips from card activation.
- URL does not receive selected year/month/date range from card activation.
- Existing non-time filters remain in timeline options after activation.
- Explicit date range from the filter panel still updates filters, chips, URL state, and timeline options.
- Clearing explicit temporal filters keeps non-time filters.
- Search results and smart facets keep their current temporal filter behavior for explicit filters.

### Web Route Tests

For each query route family, cover:

- Grouping controls render only when the route has eligible assets and is not in selection mode.
- Manual grouping changes preserve route-owned constraints.
- Year activation preserves route-owned constraints, sets month grouping, and sets year anchor.
- Month activation preserves route-owned constraints, sets day grouping, and sets month anchor.
- No temporal chip appears from card activation.
- Explicit temporal chips, where exposed, remain clearable and do not clear route-owned constraints.

Route-specific assertions:

- Album routes preserve album id and album asset constraints.
- Space routes preserve space id and space membership filters.
- Space person routes preserve both space id and person id.
- People routes preserve person id.
- Tags routes preserve tag id.
- Favorites preserve favorite constraint.
- Archive preserves archive visibility constraint.
- Locked preserves locked visibility constraint.
- Trash preserves trash constraint.
- Partners preserve partner user id.
- Map panel preserves bbox and selected cluster filters.

### Web Anchor Tests

- Anchor resolution scrolls to the matching year bucket in year grouping.
- Anchor resolution scrolls to the matching month bucket in month grouping.
- Anchor resolution scrolls to the matching month section in detailed day grouping.
- Anchor resolution waits for timeline manager initialization before scrolling.
- Anchor resolution clears the pending anchor only after a matching target is found and scrolled to.
- Anchor resolution keeps the pending anchor when the target is absent because data is still loading.
- Anchor resolution drops or ignores stale anchors when route options or grouping changes make the target invalid.
- Anchor resolution does not scroll to a nearest unrelated year/month when the exact target is absent.
- Repeated activation of the same bucket is idempotent.
- Rapid year-to-month-to-day activation resolves only the latest anchor.

### Web GalleryViewer Tests

- Grouping controls render for grouped asset arrays and hide for empty arrays.
- Manual year grouping renders representative year cards without temporal chips.
- Year activation renders month cards while the backing asset list remains complete.
- Month activation renders detailed assets while assets outside that month remain reachable.
- Year activation scrolls to the first local month bucket in the tapped year.
- Month activation scrolls to the first local detailed group or asset in the tapped month.
- If assets for the tapped period disappear before anchor resolution, no filter chip appears and the full remaining local asset list remains available.
- Viewer next/previous navigation is not restricted to the activated year/month.
- Selection mode disables representative bucket activation.
- Single-asset viewers keep detailed behavior.
- Loading/intersection callbacks are not called only because a representative card was activated.

### Mobile Shared Tests

- Zoom anchor model validates month ranges.
- Year activation updates grouping setting to month and stores a year anchor.
- Month activation updates grouping setting to day and stores a month anchor.
- Day/auto/none activation does nothing.
- Route scopes isolate anchors across sibling timelines.
- Anchor resolution scrolls to matching year/month segment.
- Anchor resolution leaves pending state if the target segment is not loaded yet.
- Anchor resolution clears pending state after successful scroll.
- Temporal scope provider is not updated by card activation.

### Mobile Photos Tests

- Photos year activation changes grouping and anchor only.
- Photos month activation changes grouping and anchor only.
- `PhotosFilterSubheader` does not render a temporal chip from card activation.
- Existing text/person/place/tag/favorite/media filters remain active.
- Explicit temporal filters still render chips and narrow results if mobile exposes them.
- Clearing explicit filters does not change grouping unless the route already did so.

### Mobile Shared Route Tests

For every adopted route:

- Route creates timeline service with unchanged route constraints after bucket activation.
- Year activation switches to month grouping and anchors.
- Month activation switches to day grouping and anchors.
- No route-local temporal chip appears from card activation.
- Selection-only routes force detailed mode or disable overview activation.
- Read-only routes do not expose invalid actions.

### Accessibility Tests

- Grouping control announces the current mode.
- Year cards announce period, count, and zoom action.
- Month cards announce period, count, and zoom action.
- No screen-reader copy says bucket activation filters the timeline.
- Disabled cards are not actionable.
- Keyboard activation matches pointer activation on web.
- Large text does not truncate essential labels beyond the existing visual design constraints.
- RTL layout preserves logical ordering and understandable semantics.

### Regression Tests

- Explicit date filters still narrow bucket counts.
- Bucket activation inside an explicit date filter stays within the explicit filtered dataset without changing the filter.
- Year-boundary trips remain continuously scrollable after zooming from year to month to all/detailed mode.
- Month-boundary events remain continuously scrollable after zooming from month to all/detailed mode.
- Leap-day assets anchor correctly in February.
- Assets with missing or malformed dates do not crash representative grouping.
- Empty buckets are not activatable.
- Representative thumbnail load failure preserves labels and activation if the bucket has assets.
- Rapid grouping changes ignore stale anchors.
- Rapid route changes do not apply anchors to the wrong route.
- Asset viewer open/close does not reset grouping unexpectedly.
- Selection mode entering/exiting does not create filters or anchors.
- App/page reload may preserve persisted grouping where existing behavior does, but must not persist bucket-activation anchors as filters.

### Browser And Integration Tests

At least one browser-level web flow must cover the complete zoom model:

- Photos: `Years -> tap year -> Months -> tap month -> All/detailed`.
- Assert no temporal chip appears after bucket activation.
- Assert the URL does not gain temporal filter params after bucket activation.
- Assert the user can scroll beyond the tapped year/month without clearing filters.
- Assert explicit date filters still narrow the same timeline and still show clearable chips.

At least one non-Photos browser-level web flow must cover route-owned constraints:

- Use a route such as Albums or Spaces.
- Activate a year and month bucket.
- Assert the route-owned constraint remains in the timeline request/options.
- Assert no temporal chip appears from bucket activation.
- Assert adjacent years/months remain scrollable when assets exist.

At least one GalleryViewer-level browser or component integration flow must cover local-array behavior:

- Render a local asset array spanning multiple years and months.
- Activate a year bucket and then a month bucket.
- Assert assets outside the activated year/month remain available for detailed browsing and viewer navigation.

At least one mobile widget or integration flow must cover:

- Photos: `Years -> tap year -> Months -> tap month -> All/detailed`.
- Assert no temporal chip appears after bucket activation.
- Assert existing filters remain active.
- Assert adjacent years/months remain reachable.

At least one mobile shared-route widget or integration flow must cover:

- A route such as album, space, or person detail.
- Activate a year and month bucket.
- Assert route-owned constraints remain in the route service.
- Assert no route-local temporal chip appears from bucket activation.

## Manual QA Matrix

For each platform and scenario, run both paths:

1. Bucket zoom path: start in `Years`, activate a year, verify `Months` stays scrollable beyond that year with no temporal chip or temporal URL param, activate a month, verify detailed mode stays scrollable beyond that month, then manually switch back to `Years`.
2. Explicit filter path: set an explicit year/month/date-range filter through the route's filter UI, verify buckets and detailed assets are narrowed, verify the temporal chip and URL/filter state appear where that route supports them, clear the temporal chip, and verify non-time filters remain.

Scenarios:

- No filters active.
- Explicit year filter active.
- Explicit month/date-range filter active.
- Person filter active.
- Album or space route active.
- Archive/favorite/trash/locked route active.
- A trip/event spanning December and January.
- A trip/event spanning two months.
- Selection mode active.
- Asset viewer opened from detailed mode after zoom activation.
- Mobile narrow viewport and desktop wide viewport.

Expected result in every bucket-activation flow: the user can scroll beyond the activated year/month without clearing a chip.

## Documentation Updates

This spec supersedes earlier filter-drilldown language in the timeline grouping specs. Implementation slices should update old docs and test names as they touch each area so they no longer describe bucket activation as temporal filtering.
