# Timeline Overview — Cover Flicker + Grouping Round-Trip Scroll Jump (Bugs 4 + 5)

**Date:** 2026-06-09
**Status:** Design — awaiting review
**Related:** [2026-05-22-mobile-timeline-overview-design.md](./2026-05-22-mobile-timeline-overview-design.md), [2026-05-25-timeline-zoom-navigation-design.md](./2026-05-25-timeline-zoom-navigation-design.md), [2026-06-08-timeline-grouping-fixes-design.md](./2026-06-08-timeline-grouping-fixes-design.md), [2026-06-09-mobile-filter-grouping-fix-design.md](./2026-06-09-mobile-filter-grouping-fix-design.md) (PR #625, #670, #674, #679)

## Context

Two further mobile bugs observed on-device against the timeline overview (Years/Months cards):

1. **Bug A — cover flicker on first load.** In Years/Months view, the cover thumbnails flicker while the timeline is loading: a card's image loads, then the card drops back to the gray fallback, then the card below it loads and grays out in turn — a cascade running top-to-bottom. Once everything has fully loaded the flicker stops. Reproduces on the main Photos timeline **and on album and shared-space timelines** (any route using the shared overview).
2. **Bug B — grouping round trip jumps the scroll position.** In "All" (day) view at the very top (e.g. 9 Jun visible), switch the grouping chip to Months — **without tapping any month card** — then switch back to All: the timeline lands on **1 Jun** instead of returning to 9 Jun. A grouping round trip with no selection must not move the user's position.

Both are mobile-only; no server/SDK/web changes.

## Bug A — overview cover flicker

### Root cause

The overview card resolves its cover **by global index from the timeline service's single sliding asset buffer**, with no per-bucket memoization:

- `_TimelineOverviewSegmentCard` (`mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart:60-86`): if `timelineService.hasRange(segment.firstAssetIndex, 1)` it reads the asset synchronously; otherwise it renders a `FutureBuilder(future: timelineService.loadAssets(firstAssetIndex, 1))` whose `snapshot.data` is null while loading → `representativeAsset: null`.
- `TimelineOverviewCard` renders the **gray fallback** (`surfaceContainerHighest`) whenever `representativeAsset == null` (`overview_card.dart:118-124`).
- `TimelineService` keeps **one** buffer of `kTimelineAssetLoadBatchSize = 1024` assets (`timeline.service.dart`, `constants.dart:29`). Year/month `firstAssetIndex` values are cumulative counts spread across the whole library, so the visible cards' representatives generally cannot coexist in one buffer window: **each card's `loadAssets` slides the buffer to its own region, evicting every other card's representative.**
- During initial load, the bucket stream re-emits repeatedly (sync/paging); each emission fires `TimelineReloadEvent` → `setState(() {})` (`timeline.widget.dart:219`), rebuilding **all** visible cards (line 573). Each rebuilt card whose index fell out of the buffer goes gray, kicks off a new `loadAssets`, which evicts the next card's range → the observed top-to-bottom load→gray cascade. When emissions stop, the last-loaded state sticks — matching "only flickers on first load".

Albums and shared spaces flicker for the same reason: they render through the same shared `Timeline` → `TimelineOverviewSegment` path, and their bucket streams also re-emit during initial sync.

This is a pre-existing fragility from the #670 overview, amplified by routes with chatty initial bucket streams (and by #679's filtered overview, where paging re-emits per page).

### Design: per-bucket representative cache

Memoize each bucket's resolved representative so it survives rebuilds and buffer movement. The card consults the cache first and **never falls back to gray once a representative has been resolved** for that bucket.

- **New route-scoped provider** `timelineOverviewRepresentativeCacheProvider` — a `Notifier` holding `Map<String, BaseAsset>` keyed by `'${groupBy.name}:${bucket.date.toIso8601String()}'`. The `groupBy` component is load-bearing, not cosmetic: a year bucket `2024` and a month bucket `Jan 2024` both carry date `2024-01-01`. Provider-held rather than widget `State` because the timeline tears down and rebuilds its subtree on segment reloads, which resets `State` (the #674 lesson). **Route-scoped via an explicit override in `TimelineRouteScope`** (`timeline_route_scope.dart`), exactly like `timelineZoomAnchorProvider` is today — so albums/spaces/photos each get their own cache and it dies with the route. (Note: `timelineGroupingZoomingInProvider` is a _global_ provider and is NOT the model to copy here.)
- **`_TimelineOverviewSegmentCard` lookup order:**
  1. Cache hit → render the cached representative immediately (no gray), regardless of buffer state.
  2. Cache miss + `hasRange` → read synchronously, **write to cache**, render.
  3. Cache miss + no range → existing `FutureBuilder` path; on resolve, **write to cache**. While in flight the gray fallback shows — but only ever once per bucket per route visit.
- **Staleness:** store the bucket's `assetCount` alongside the asset. If a later emission changes a bucket's count, keep showing the cached representative and refresh it in the background (kick the `FutureBuilder` path; replace on resolve). Stale-but-plausible beats gray. If the cached representative's bucket disappears entirely (date no longer in the bucket list), the entry is simply unused; no eviction pass needed.
- **Invalidation — service-instance change, not just route death.** The route scope does NOT rebuild when `timelineServiceProvider` re-evaluates (the service provider is a sibling inside the same scope), so route scoping alone would keep serving covers resolved under a **previous filter** — a representative that may not match the active filter at all, which is worse than the flicker. The cache notifier therefore `ref.listen`s to `timelineServiceProvider` and **clears the map whenever the service instance changes** (filter change, temporal-scope change). Trade-off, documented: grouping switches also rebuild the service (the route-scope override watches `Setting.groupAssetsBy`), so a year↔month switch clears the cache and covers re-resolve once per switch — identical to today's behavior, no regression; the cache's job is killing the intra-view cascade, which it still does.

_Alternative considered and rejected:_ enlarging the asset buffer or giving the overview its own multi-window buffer — touches the shared scrolling machinery and still thrashes for large libraries; the cache is a few dozen entries and strictly additive.

### Testing (TDD — RED first)

In `mobile/test/presentation/widgets/timeline/overview/` (+ a small provider test):

- **RED (the bug):** card for a bucket whose representative was previously resolved renders the `Thumbnail` (not the gray fallback) when the service buffer no longer covers its `firstAssetIndex` (simulate: resolve once, move the buffer via another `loadAssets`, rebuild the card). Today this renders the fallback → fails.
- Cache provider unit tests: write/read by `(groupBy, date)` key; year-`2024` vs month-`Jan 2024` keys do not collide; count-change keeps the old asset until a replacement is stored; separate route scopes do not share entries.
- **Filter-change invalidation (RED-able):** resolve a cover, then swap the `timelineServiceProvider` instance (simulating a filter change) → the old representative must NOT render; the card re-resolves from the new service.
- **Count-change triggers a refresh:** a bucket emission with a different `assetCount` for a cached date kicks a background re-resolve (old asset shown meanwhile, replaced on resolve) — assert the reload actually happens, not just that the old value persists.
- Card writes to the cache on both the synchronous (`hasRange`) and `FutureBuilder` resolve paths.
- Cascade regression: two cards at far-apart indices; loading the second (which evicts the first's buffer range) does not blank the first on rebuild.
- Existing overview card/semantics tests stay green (fallback still shown for a genuinely never-resolved bucket with in-flight load).

## Bug B — grouping round trip loses the day-precision position

### Root cause

`_onGroupingChanged` (`mobile/lib/presentation/widgets/timeline/timeline.widget.dart:255-273`) anchors the rebuilt timeline to **the date of the top-visible bucket**:

```dart
final date = _currentTopVisibleDate(segments);   // (bucket as TimeBucket).date
ref.read(timelineZoomAnchorProvider.notifier).setDate(date);
```

Bucket dates are **truncated to their granularity**: a month bucket's `date` is the 1st of the month (`TimeBucket` built from `truncateDate(groupBy)` / `_localBucketDate`). So:

1. Day view, top = 9 Jun → switch to Months: anchor = `date(2026-06-09)` → month view scrolls to the June card. Correct.
2. Months → All (no card tapped): top-visible bucket is the **June month bucket whose `date` is 2026-06-01** → anchor = `date(2026-06-01)` → `findTimelineScrollTargetSegment` (`timeline_scroll_target.dart`) matches the 1 Jun day segment → the user lands on 1 Jun.

The day-level precision is destroyed by round-tripping through the coarser bucket's truncated date. (Card-tap drill-down is unaffected — it sets an explicit year/month anchor and `_onGroupingChanged` skips via the `isEmpty` guard at line 261.)

### Design: retain the finer date across a no-selection round trip

Remember the most recent position-derived anchor date, and when leaving a coarser grouping, **keep the remembered finer date if it still falls inside the top-visible bucket's period**; otherwise (the user actually scrolled somewhere else) fall back to the bucket's truncated date.

- Extract a pure decision function (new file `mobile/lib/presentation/widgets/timeline/timeline_grouping_anchor.dart`):

  ```dart
  /// The date to anchor on when the grouping changes away from [previousGroupBy].
  /// [topBucketDate] is the (granularity-truncated) date of the top-visible bucket.
  /// [remembered] is the last position-derived anchor date, if any.
  DateTime resolveGroupingChangeAnchorDate({
    required DateTime topBucketDate,
    required GroupAssetsBy previousGroupBy,
    DateTime? remembered,
  }) {
    if (remembered == null) return topBucketDate;
    final within = switch (previousGroupBy) {
      GroupAssetsBy.year => remembered.year == topBucketDate.year,
      GroupAssetsBy.month => remembered.year == topBucketDate.year && remembered.month == topBucketDate.month,
      _ => false, // day buckets are already full precision — use them as-is
    };
    return within ? remembered : topBucketDate;
  }
  ```

- **Remembered date storage:** on `TimelineZoomAnchorNotifier` (`zoom_anchor.provider.dart`) as `DateTime? lastPositionDate`, updated by `setDate` and **not** cleared when the anchor is consumed (`clear()` at `timeline.widget.dart:442` keeps it). `setDate` has exactly one production caller (`_onGroupingChanged`, `timeline.widget.dart:272`), so `lastPositionDate` is precisely "the last position-derived anchor" with no other writers. Route scoping comes for free: `timelineZoomAnchorProvider` is already overridden per-route in `TimelineRouteScope` (`timeline_route_scope.dart`), so it never leaks across routes and survives the timeline's subtree teardowns (the #674 lesson).
- `_onGroupingChanged` becomes: compute `topBucketDate`; `final date = resolveGroupingChangeAnchorDate(topBucketDate: topBucketDate, previousGroupBy: GroupAssetsBy.values[previous], remembered: notifier.lastPositionDate)`; `setDate(date)`.

Walking the report's repro: All@9 Jun → Months remembers 9 Jun, anchors June. Months → All: top bucket = June (1 Jun), 9 Jun ∈ June → anchor 9 Jun → **back to 9 Jun**. If the user scrolls the month view to March first: top bucket = March, 9 Jun ∉ March → anchor 1 Mar (today's behavior, correct — they moved). Works transitively across All→Months→Years→Months→All (each leg's top bucket still contains 9 Jun, so the remembered date survives the whole round trip). Card-tap drill-down keeps its explicit-anchor skip; the next position-derived change overwrites `lastPositionDate`, so staleness self-corrects.

### Testing (TDD — RED first)

- **Pure-function tests** (new `timeline_grouping_anchor_test.dart`) — write first; the initial run is a **compile-RED** (the function doesn't exist), then implement: remembered-within-month kept (9 Jun + top 1 Jun → 9 Jun); remembered-outside-month dropped (9 Jun + top 1 Mar → 1 Mar); year variants (within-year kept, outside-year dropped); `previousGroupBy: day` always returns the bucket date; `previousGroupBy: auto`/`none` (legacy setting values) return the bucket date; `remembered: null` returns the bucket date.
- **Widget round-trip test** (extend `main_timeline_zoom_test.dart` patterns): day view positioned at a 9 Jun segment → set grouping to month → back to day → the resolved scroll target is the 9 Jun segment, not 1 Jun. **RED today** (lands on 1 Jun) — this is the bug's regression guard; watch it fail before wiring `_onGroupingChanged`.
- Scrolled-in-between variant: after switching to month, scroll so a different month is on top, switch back → lands on that month's first day (existing behavior preserved).
- Drill-down regression: card tap still uses the explicit anchor path (existing tests in `overview_drilldown_provider_test.dart` / zoom tests stay green).
- `lastPositionDate` survives `clear()` (anchor consumption) but updates on each `setDate`.
- **Unresolvable top date:** when `_currentTopVisibleDate` returns null (empty segments / scroll controller without clients), no anchor is set and `lastPositionDate` is unchanged (the stale value is harmless: it is only ever consulted under the containment check, which self-corrects).

## Scope

Mobile only. Files:

- Bug A: `overview_segment.model.dart`, new cache provider (+ `TimelineRouteScope` wiring), tests.
- Bug B: `timeline.widget.dart` (`_onGroupingChanged`), `zoom_anchor.provider.dart` (`lastPositionDate`), new `timeline_grouping_anchor.dart` pure helper, tests.

The two bugs are independent and can land as separate commits in one PR.

## Out of scope

- Server-side cover endpoint usage on mobile (mobile covers stay client-side from the local service; the 2026-06-08 spec's `getTimeBucketCovers` is web-only).
- Buffer-size tuning / multi-window asset buffering in `TimelineService`.
- Damping the filtered overview's `loadMore`-driven bucket re-emissions (#679 known limitation) — the cache makes the re-emissions visually harmless.
- Pixel-offset restoration within a day (returning to the exact scroll pixel); anchoring to the day segment matches the existing scroll-to-date behavior.

## Rollout / validation

No flag — bug fixes. Validate on-device (branded sideload as before): (1) cold-open Years/Months on Photos, an album, and a shared space — covers fill in once without the gray cascade; (2) All@top → Months → All returns to the same day; scrolling the month view in between still re-anchors to the scrolled month.
