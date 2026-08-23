# Timeline Grouping × Filters — Empty Month/Year on iOS (Bug 3)

**Date:** 2026-06-09
**Status:** Design — awaiting review
**Related:** [2026-05-19-timeline-grouping-design.md](./2026-05-19-timeline-grouping-design.md), [2026-05-22-mobile-timeline-overview-design.md](./2026-05-22-mobile-timeline-overview-design.md), [2026-06-08-timeline-grouping-fixes-design.md](./2026-06-08-timeline-grouping-fixes-design.md) (PR #625, #670, #674); [2026-05-31-mobile-search-infinite-scroll-and-sort-design.md](../../plans/2026-05-31-mobile-search-infinite-scroll-and-sort-design.md) (#654 live search + sort)

## Context

Hagen's third report against timeline grouping. With **any filter active** (person, text/smart search, etc.), the Years/Months/Days grouping breaks on the iOS app:

- **Day view (filter active):** works — filtered photos render grouped by day.
- **Month view (filter active):** completely empty — no month tiles.
- **Year:** reported as "missing from the switcher entirely".
- Reproduces with multiple filter types, so it is a general filter × grouping problem, not person-specific.

**Environment:** server `v4.57.0-rc1`, iOS TestFlight `v4.57.0`.

This is the inverse of what the overview design promised. [2026-05-22-mobile-timeline-overview-design.md](./2026-05-22-mobile-timeline-overview-design.md) explicitly required filters to compose with grouping — _"Keep active filters/search/person/album/space constraints in effect so overview cards only represent matching assets"_ (Goals), _"a filtered Photos timeline only shows years matching the active filters"_ (§Years), and a repository test that _"Year and month overview counts match the assets returned by day mode under the same filters."_ The plumbing to drill down from a filtered overview already exists. The mobile **search/filter data path was just never wired to produce dated buckets**, so the overview renders nothing.

## Root cause

When a filter is active, the timeline switches its data source:

- **Empty filter** → `factory.main(...)`, whose Drift bucket query `GROUP BY`s on a date expression keyed by the current `GroupAssetsBy`, emitting proper **`TimeBucket(date, assetCount)`** rows (`timeline.repository.dart` `_watchMainBucket` + `effectiveCreatedAt(groupBy)` + `truncateDate(groupBy)`).
- **Active filter** → `buildPhotosTimelineQuery` (`mobile/lib/providers/photos_filter/timeline_query.provider.dart:38-53`) builds the timeline from `factory.fromAssetStream(notifier.getAssets, notifier.count, TimelineOrigin.search)`.

`fromAssetStream` (`mobile/lib/infrastructure/repositories/timeline.repository.dart:585-596`) emits **plain, date-less `Bucket(assetCount)` segments** via `_generateBuckets` (`timeline.repository.dart:1162-1171`) and **takes no `GroupAssetsBy` at all**:

```dart
TimelineQuery fromAssetStream(List<BaseAsset> Function() getAssets, Stream<int> assetCount, TimelineOrigin origin) => (
  bucketSource: () async* {
    yield _generateBuckets(getAssets().length);          // List<Bucket>, no dates
    yield* assetCount.map(_generateBuckets);
  },
  assetSource: (offset, count) => Future.value(getAssets().skip(offset).take(count).toList(growable: false)),
  origin: origin,
);
```

The renderer then breaks on these date-less buckets:

- `timelineSegmentProvider` (`mobile/lib/presentation/widgets/timeline/timeline.state.dart:97-112`) picks the builder by the current `GroupAssetsBy`: month/year → `TimelineOverviewSegmentBuilder`; day → `FixedSegmentBuilder`.
- `TimelineOverviewSegment` (`mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart:52-53`) bails when the bucket is not a `TimeBucket`:

  ```dart
  if (bucket is! TimeBucket) {
    return const SizedBox.shrink();   // ← every month/year tile renders empty
  }
  ```

- `FixedSegmentBuilder` (day) guards `bucket is TimeBucket` before reading `.date` (`fixed/segment_builder.dart:40,66`) and `header.widget.dart:46` returns `SizedBox.shrink()` for a non-`TimeBucket` bucket — so a date-less day timeline renders a header-less grid fine, which is why **Day works** and **Month/Year are blank**.

**"Year missing from the switcher" is a side effect, not a separate defect.** The selector unconditionally offers all three levels — `timelineGroupingSelectorGroups = [year, month, day]` (`timeline_grouping_selector.widget.dart:12`); there is no origin/filter restriction. The compact chip cycles by tapping (the ping-pong from PR #674), and with Month/Year rendering empty the user perceives Year as unreachable. Once buckets render, the level becomes reachable and populated; no selector change is required.

### Why the existing pieces make this a small, well-scoped fix

- `fromAssetsWithBuckets` (`timeline.repository.dart:598-615`) **already** proves the client-side pattern: sort a fixed asset list by date desc and group into day `TimeBucket`s. We generalise it to month/year, to honor the sort direction, and to the streaming case.
- The overview card needs only a **count + one representative asset** per bucket, fetched **by global index** `firstAssetIndex` (cumulative bucket counts) from the service (`overview_segment.model.dart:61-63`, `overview_segment_builder.dart:36`). So the asset source must be laid out in the **same order** as the buckets. Because buckets are derived from the loaded assets, every bucket's `firstAssetIndex` is already in the loaded set — representatives never grey out waiting on a fetch.
- This mirrors **web**, which already derives search/album/space overview representatives **client-side from already-loaded assets** (`gallery-viewer-grouping.ts`, called out as the untouched "scope boundary (b)" in the 2026-06-08 spec). This change brings the mobile search timeline to parity with that web behaviour.

## Decisions (confirmed)

1. **Build real date buckets for the filtered/search timeline** from the assets loaded so far, grouped by the active `GroupAssetsBy`. (Completes the overview design's intent.)
2. **Relevance-sorted smart search is exempt from grouping.** When the active sort is _relevance_ (offered only for smart/`context` search — `sort_icon_button.widget.dart:28`), the filtered timeline stays a flat, relevance-ordered list and grouping does not apply. Confirmed acceptable by the product owner; preserves relevance ranking, which date grouping would destroy. **Smart search with a newest/oldest sort still groups** (it is date-ordered) — only relevance is flat.
3. **Grouped views honor the newest/oldest sort direction.** `_order` maps newest → `AssetOrder.desc` and oldest → `AssetOrder.asc` (`search_api.repository.dart:18-22`). Date buckets and their assets are ordered to match the active sort (oldest → ascending / oldest-first; otherwise newest-first), so a chosen "oldest" sort is never silently flipped to newest-first.

## Design

Three coordinated changes, all **mobile-only**. No server/SDK/web changes.

### 1. `fromAssetStream` builds grouped, direction-aware `TimeBucket`s (data layer)

**`mobile/lib/infrastructure/repositories/timeline.repository.dart`** — give `fromAssetStream` a `groupBy` and a `descending` flag, and build dated buckets (reusing the `fromAssetsWithBuckets` pattern generalised to month/year and to either order). `GroupAssetsBy.none` preserves today's date-less segments (the flat/relevance path).

```dart
TimelineQuery fromAssetStream(
  List<BaseAsset> Function() getAssets,
  Stream<int> assetCount,
  TimelineOrigin origin, {
  GroupAssetsBy groupBy = GroupAssetsBy.none,
  bool descending = true,
}) => (
  bucketSource: () async* {
    yield _streamBuckets(getAssets(), groupBy, descending);
    // assetCount fires whenever a page loads; re-bucket from the grown getAssets() (the emitted value is just a change signal).
    yield* assetCount.map((_) => _streamBuckets(getAssets(), groupBy, descending));
  },
  assetSource: (offset, count) =>
      Future.value(_orderedForGrouping(getAssets(), groupBy, descending).skip(offset).take(count).toList(growable: false)),
  origin: origin,
);

// Date-less segments (flat) for `none`; dated TimeBuckets in `descending` order otherwise.
List<Bucket> _streamBuckets(List<BaseAsset> assets, GroupAssetsBy groupBy, bool descending) {
  if (groupBy == GroupAssetsBy.none) return _generateBuckets(assets.length);
  final counts = <DateTime, int>{}; // LinkedHashMap: insertion order follows the pre-ordered asset list
  for (final asset in _orderedForGrouping(assets, groupBy, descending)) {
    final key = _localBucketDate(asset.createdAt, groupBy);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return [for (final e in counts.entries) TimeBucket(date: e.key, assetCount: e.value)];
}

List<BaseAsset> _orderedForGrouping(List<BaseAsset> assets, GroupAssetsBy groupBy, bool descending) {
  if (groupBy == GroupAssetsBy.none) return assets; // keep the search order (relevance, as returned)
  final sorted = [...assets]..sort((a, b) => a.createdAt.compareTo(b.createdAt));
  return descending ? sorted.reversed.toList(growable: false) : sorted;
}

// Mirrors `fromAssetsWithBuckets`' `.toLocal()` truncation. `BaseAsset.createdAt` is the capture time
// (mapped from `fileCreatedAt`, `asset_extensions.dart:13`); `BaseAsset` carries no `localDateTime`.
DateTime _localBucketDate(DateTime createdAt, GroupAssetsBy groupBy) {
  final t = createdAt.toLocal();
  return switch (groupBy) {
    GroupAssetsBy.day || GroupAssetsBy.auto => DateTime(t.year, t.month, t.day),
    GroupAssetsBy.month => DateTime(t.year, t.month),
    GroupAssetsBy.year => DateTime(t.year),
    GroupAssetsBy.none => DateTime(t.year, t.month, t.day),
  };
}
```

Both `bucketSource` and `assetSource` call `_orderedForGrouping` with the same args, so the representative-by-`firstAssetIndex` lookup always lands inside its bucket. (`_orderedForGrouping` re-sorts per `assetSource` call; negligible at filtered-result sizes — revisit only if a profile says otherwise.)

**`mobile/lib/domain/services/timeline.service.dart:146-147`** — thread both params through the factory:

```dart
TimelineService fromAssetStream(
  List<BaseAsset> Function() getAssets,
  Stream<int> assetCount,
  TimelineOrigin type, {
  GroupAssetsBy groupBy = GroupAssetsBy.none,
  bool descending = true,
}) => TimelineService(_timelineRepository.fromAssetStream(getAssets, assetCount, type, groupBy: groupBy, descending: descending));
```

### 2. Query provider decides grouping + direction for the search timeline

**`mobile/lib/providers/photos_filter/timeline_query.provider.dart`** — pass the active grouping and sort direction, except for relevance-sorted smart search which stays flat:

```dart
final notifier = ref.watch(photosFilterSearchProvider.notifier);
final isSmart = filter.context != null && filter.context!.isNotEmpty;        // matches sort_icon_button.widget.dart:28
final isRelevance = isSmart && filter.sort == SearchSortOrder.relevance;
final groupBy = isRelevance ? GroupAssetsBy.none : factory.groupBy;          // factory.groupBy reads Setting.groupAssetsBy (auto→day)
final descending = filter.sort != SearchSortOrder.oldest;                    // oldest → ascending, else newest-first
final svc = factory.fromAssetStream(
  notifier.getAssets, notifier.count, TimelineOrigin.search, groupBy: groupBy, descending: descending,
);
```

Reactivity is already correct: `timeline_route_scope.dart` overrides `timelineServiceProvider` and **watches `Setting.groupAssetsBy`**, so switching Years/Months/Days rebuilds the service through `buildPhotosTimelineRouteService` → `buildPhotosTimelineQuery`, which re-reads `factory.groupBy`. (`buildPhotosTimelineQuery` already `ref.watch`es the effective filter, so a sort change rebuilds too.)

### 3. Segment provider follows the bucket type

**`mobile/lib/presentation/widgets/timeline/timeline.state.dart:97-112`** — render the flat grid whenever the service emitted date-less buckets, regardless of the setting, so a relevance/flat search never hits the empty-overview path:

```dart
yield* timelineService.watchBuckets().map((buckets) {
  final hasDatedBuckets = buckets.isEmpty || buckets.first is TimeBucket;
  final effectiveGroupBy = hasDatedBuckets ? groupBy : GroupAssetsBy.day; // date-less ⇒ flat grid
  if (effectiveGroupBy == GroupAssetsBy.year || effectiveGroupBy == GroupAssetsBy.month) {
    return TimelineOverviewSegmentBuilder(buckets: buckets, groupBy: effectiveGroupBy).generate();
  }
  return FixedSegmentBuilder(
    buckets: buckets,
    tileHeight: tileExtent,
    columnCount: columnCount,
    spacing: spacing,
    groupBy: effectiveGroupBy,
  ).generate();
});
```

This is a no-op for every dated source (main/person/place/album/space/video/map and the new grouped search path). It changes only the **date-less** sources — `fromAssetStream` with `none` (relevance) and the three `fromAssets` callers (folder explorer `folder.page.dart:180`, activity `activity.service.dart:62`, deep-link `deep_link.service.dart:155`): for these, a Month/Year setting now renders the flat grid **instead of an empty overview** — strictly an improvement (those surfaces already showed nothing under Month/Year grouping today).

## Behaviour after the fix

| Filter + sort                                                              | Day / "All"                                           | Months / Years                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Person / place / tag / favourite / rating / type / date (default → newest) | day-grouped grid, newest-first (now with day headers) | **month/year cover tiles render**, newest-first; tap drills down via the existing zoom anchor |
| Any filter, **oldest** sort                                                | day-grouped grid, oldest-first                        | month/year cover tiles, oldest-first                                                          |
| Smart/text search, **newest/oldest** sort                                  | day-grouped grid (date-ordered)                       | month/year cover tiles                                                                        |
| Smart/text search, **relevance** sort                                      | flat, relevance-ordered grid (unchanged)              | flat grid (no empty overview — segment provider falls back)                                   |

Hagen's main repro (person filter, default newest sort) is fully fixed: Month and Year populate, and Year is reachable.

## Known limitations (documented, by design)

- **Loaded-so-far coverage.** Overview covers reflect the results loaded so far, filling in as the user scrolls (the search notifier pages on scroll — `photos_filter_search.provider.dart`). In overview modes the compact tiles reach the bottom quickly, so `loadMore` (the page's `ScrollUpdateNotification` + `_SearchLoadMoreFooter`) eagerly pages through a filtered set until the viewport fills or results exhaust — coverage converges fast for realistic filtered sets. Matches the web `gallery-viewer-grouping` approach and the `time_buckets.provider` "When" accordion's existing not-the-whole-corpus note. A server-side filtered time-bucket endpoint for complete, upfront coverage of very large filtered sets is **out of scope**.
- **Capture-date bucketing uses `fileCreatedAt.toLocal()`.** `BaseAsset` carries no `localDateTime`, so client-side grouping buckets by the capture instant converted to the device timezone — identical to the existing `fromAssetsWithBuckets`. For a photo captured in a timezone different from the device, this can place it in a different day/month than the **unfiltered** main timeline (which buckets by the asset's stored `localDateTime`). Pre-existing mobile date semantics; not introduced here.

## Testing (TDD)

**RED first, at the data layer where the bug lives**, then wire the upper layers. Watch each test fail before implementing.

### Slice 1 — repository grouped buckets (`mobile/test/infrastructure/repositories/timeline_repository_test.dart`)

`fromAssetStream` needs no DB; construct `DriftTimelineRepository(db)` (in-memory, as the file already does) and drive it with in-memory `RemoteAsset`s at chosen `createdAt`s.

- **RED (compile):** write the bug test — `fromAssetStream(..., groupBy: GroupAssetsBy.month)` over assets in 2024-03 (×2), 2024-01 (×1), 2023-12 (×1), asserting `bucketSource().first` yields **`TimeBucket`s** `[(2024-03, 2), (2024-01, 1), (2023-12, 1)]`. Run it: it **fails to compile** — `fromAssetStream` has no `groupBy`/`descending` parameter (feature missing). This is the first RED.
- **RED (assertion):** add the `groupBy`/`descending` parameters to the factory + repository signatures, defaulting to `GroupAssetsBy.none` / `true`, but **still returning `_generateBuckets` segments**. Re-run: now it compiles and **fails the assertion** (buckets are date-less `Bucket`s, not `TimeBucket`s). This proves the test catches the bug.
- **GREEN:** implement `_streamBuckets` / `_orderedForGrouping` / `_localBucketDate`. Re-run → pass.
- Then add (RED→GREEN each):
  - `groupBy: year` → year `TimeBucket`s `[(2024, 3), (2023, 1)]`, newest-first.
  - `groupBy: day` → day `TimeBucket`s, newest-first.
  - **Direction:** `groupBy: month, descending: false` (oldest) → buckets ascending `[(2023-12, 1), (2024-01, 1), (2024-03, 2)]`, and `assetSource(0, n)` returns assets oldest-first.
  - **Consistency:** for `month` descending, `assetSource(0, n)` is date-desc and bucket `firstAssetIndex` lands on that bucket's first asset.
  - **Regression guard:** `groupBy: none` (default) → date-less `Bucket` segments unchanged, and `assetSource` preserves input order.
  - **Empty:** `groupBy: month` over `[]` → `bucketSource().first` is empty; no throw.
  - **Single bucket:** all assets in one month → one `TimeBucket`.
  - **Year boundary:** 2023-12-31 and 2024-01-01 → for `month`, two buckets `2023-12` / `2024-01`; for `year`, `2023` / `2024`.
  - **Re-emission:** push a new count on a `StreamController<int>` after appending an asset → second emission re-buckets from the grown `getAssets()`.

### Slice 2 — query provider grouping/direction decision (`mobile/test/providers/photos_filter/timeline_query_provider_test.dart`)

Existing tests mock `factory.fromAssetStream(any(), any(), TimelineOrigin.search)` — update the matchers for the new named `groupBy`/`descending`. **Adjust those mocks first (RED — the real call now passes named args the stub doesn't match), then add:**

- Non-empty **non-smart** filter (e.g. person), grouping setting = month → called with `groupBy: GroupAssetsBy.month, descending: true`.
- Same filter with `sort == oldest` → `descending: false`.
- Smart filter (`context` set) + `sort == relevance` → `groupBy: GroupAssetsBy.none`.
- Smart filter + `sort == newest` → grouping setting (not `none`).

### Slice 3 — segment provider bucket-type fallback (`mobile/test/presentation/widgets/timeline/timeline_state_test.dart` or sibling)

- Service emits **date-less `Bucket`s** + setting = month → `timelineSegmentProvider` yields `FixedSegment`s (flat grid), **not** empty `TimelineOverviewSegment`s. (RED today: it would build an empty overview.)
- Service emits **`TimeBucket`s** + setting = month → yields `TimelineOverviewSegment`s (unchanged).
- Empty bucket list + setting = month → no segments / no throw.

### Slice 4 — integration acceptance (widget/provider)

Where the existing overview/filter widget tests live: with an active person filter and grouping = Months, the timeline renders month overview cards, and **the sum of the month buckets' counts equals the loaded asset count** (no assets dropped vs the flat/day view under the same filter — the "counts match day mode under the same filters" guard from the 2026-05-22 design, applied to the client path). Add a **drill-down** test: tapping a month card switches grouping to Days and resolves the zoom anchor to that month on the client-bucketed search timeline. Add a **reactivity** test: changing `Setting.groupAssetsBy` while a filter is active rebuilds the service and re-emits buckets at the new grouping.

### Manual verification

On the iOS build / a personal-clone RC: person filter → Months shows tiles → tap a month drills to its days → Year shows tiles. Set sort to oldest → confirm grouped views are oldest-first. Confirm a relevance-sorted smart text search still shows the flat relevance-ordered list and does not blank out when Month/Year is selected.

## Scope

Mobile only. Files touched:

- `mobile/lib/infrastructure/repositories/timeline.repository.dart` — `fromAssetStream` + `_streamBuckets`/`_orderedForGrouping`/`_localBucketDate`.
- `mobile/lib/domain/services/timeline.service.dart` — `TimelineFactory.fromAssetStream` signature.
- `mobile/lib/providers/photos_filter/timeline_query.provider.dart` — grouping/direction decision (the **only** production caller of `factory.fromAssetStream`, line 50).
- `mobile/lib/presentation/widgets/timeline/timeline.state.dart` — `timelineSegmentProvider` bucket-type fallback.
- Tests: `timeline_repository_test.dart`, `timeline_query_provider_test.dart` (mock-matcher update for the new named args), and a `timelineSegmentProvider` test.

**No** server, SDK, OpenAPI, or web changes. No `GroupAssetsBy` enum/index changes. No grouping-selector UI change (the level set is already correct).

## Out of scope

- **Server-side filtered time buckets.** A search/filter-aware bucket endpoint giving complete, upfront month/year coverage for very large filtered sets (and per-bucket drill-down loading) is a larger server+mobile effort; client-side-from-loaded-assets matches web and resolves the reported bug.
- **Grouping for relevance-sorted smart search** (intentionally flat, per Decision 2).
- Mobile `mergedBucket` count-query optimisation and the chip "Day"→"All" label alignment (already out of scope in the 2026-06-08 spec).

## Rollout / validation

No flag — pure bug fix. Validate on the personal instance / a Hagen-scale personal-clone via the RC tooling (the build that surfaced this was `v4.57.0-rc1`); confirm Month/Year populate under a person filter and a metadata text filter, oldest sort renders oldest-first, and relevance smart search stays flat.
