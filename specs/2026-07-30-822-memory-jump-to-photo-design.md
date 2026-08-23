# Memory "view in timeline" must land on the actual photo (#822)

**Status:** approved, ready for implementation plan
**Issue:** [#822](https://github.com/open-noodle/gallery/issues/822)
**Scope:** `mobile/` only. No server, web, API, or i18n changes.

## Problem

Tapping the arrow in the bottom-right of a Memory is meant to take the user to that photo in the
timeline. It never does.

Two independent defects combine:

1. **The asset identity is discarded at the source.** `memory_bottom_info.widget.dart:47` calls
   `scrollToDateNotifierProvider.scrollToDate(fileCreatedDate.toLocal())` — only a `DateTime`
   survives. Nothing downstream can know _which_ photo was meant.
2. **The timeline scrolls to a bucket, not to the asset.** `timeline.widget.dart:430 _scrollToDate`
   scrolls to `segment.startOffset - 50`, the top of the matched segment. `findTimelineScrollTargetSegment`
   resolves day → month → year by fallback, so the matched segment depends on the active grouping.

The resulting behaviour matches the report exactly:

| Grouping  | Bucket granularity                       | Where the user lands    |
| --------- | ---------------------------------------- | ----------------------- |
| **Year**  | one bucket per year                      | the year overview card  |
| **Month** | one bucket per month                     | the month overview card |
| **Day**   | one bucket per day (`DateTime(y, m, d)`) | the day header          |

In Year and Month grouping the photo is not merely off-screen — it **is not rendered at all**. Those
groupings render `TimelineOverviewCard` widgets, not asset tiles. Scrolling to the photo is impossible
without first changing the grouping.

In Day grouping the photo _is_ rendered, but landing on the day header leaves it arbitrarily far below:
on a wedding day with 1500 photos the user still has to hunt.

### Reference behaviour: web

The memory viewer's equivalent button navigates to
`Route.photos({ at: asset.stack?.primaryAssetId ?? asset.id })`
(`web/src/routes/(user)/memory/[[photos=photos]]/[[assetId=id]]/MemoryViewer.svelte:638`; the asset-viewer
action at `web/src/lib/services/asset.service.ts:302` does the same via `asset.stackPrimaryAssetId`).
`Timeline.svelte:227 scrollToAssetPosition` then scrolls to the asset's absolute position within its month
and calls `focusAsset()`. Web latches an **asset**, not a date. Mobile should do the same.

Web does _not_ force a grouping change, so web has the same overview-mode blind spot. The Year/Month
behaviour below is therefore a deliberate fork decision, not web parity.

## Decisions taken

| Question                             | Decision                                                        |
| ------------------------------------ | --------------------------------------------------------------- |
| Year/Month grouping                  | Switch grouping to Day, then scroll to the photo                |
| Arrival cue                          | Brief highlight on the target tile (~1.5s)                      |
| Resolving the asset's absolute index | Chunk-scan the matched segment via `TimelineService.loadAssets` |

**Why switch grouping rather than open the viewer.** Tapping a year or month overview card already
switches grouping and drills in (`sharedTimelineOverviewDrilldownProvider`). Reusing that behaviour keeps
"go to this photo" consistent with the gesture users already know, and honours the button's
`view_in_timeline` tooltip — the user sees the photo in its timeline context.

**Accepted cost.** All three call sites navigate to `MainTimelineRoute`, which resolves the **root**
`TimelineGroupingNotifier`, whose `set()` writes `SettingsKey.timelineGroupAssetsBy`. So the grouping change
persists across restarts — exactly as a manual card drilldown does today. This is intended, not a leak.

**Why chunk-scan rather than a new SQL query.** A dedicated `indexOfAssetInTimeline` would be one precise
query, but `timeline.repository.dart` carries ~15 timeline variants (main, album, space, person, favorite,
trash, archive, locked, video, place, …), each with its own SQL. Implementing and testing the query across
all of them is far more surface than this bug warrants. A chunked scan reuses the existing
`TimelineService.loadAssets` buffered-read path the timeline already uses to render rows.

A `createdAt` binary search was rejected: assets sharing a timestamp and local-vs-UTC ordering nuances make
the midpoint comparison unreliable, for a saving that does not matter on local Drift reads.

## Architecture

```
DriftMemoryBottomInfo (tap)
  └─ scrollToAssetNotifierProvider.scrollToAsset(asset)          [1] latch the ASSET
       │
       ▼  (navigate to MainTimelineRoute)
_SliverTimelineState._attemptScrollDrain()                        per-frame retry loop
  ├─ segmentsAreOverview(segments)                                [2a] pure predicate
  └─ decideScrollDrain(..., isOverviewTimeline:)                  [2b] pure decision
       ├─ switchToDayGrouping → set(day); attempts++              (set() once per cycle)
       ├─ retry              → attempts++; next frame
       ├─ giveUp             → consume + stop
       └─ scroll             → _beginScrollToAsset()              [4] async guard
                                 ├─ findTimelineScrollTargetSegment()  (existing)
                                 ├─ await findAssetIndex(loadAssets:)  [3] chunk scan
                                 │     ↳ mounted + staleness recheck
                                 ├─ assetRowOffset(segment, i, cols)   [5] pure math
                                 └─ highlight(asset)                   [6]
```

Every numbered unit is independently testable. `[2a]`, `[2b]`, `[5]` and the chunking/highlight predicates
are pure functions; `[3]` takes a `loadAssets` callback rather than a `TimelineService`, so it is testable
with a plain closure and no mocking. `[4]` is the only piece whose full behaviour needs a device — its
decision inputs are still factored into a pure helper.

## Components

### 1. Latch the asset, not the date

`mobile/lib/providers/asset_viewer/scroll_to_date_notifier.provider.dart`
→ `mobile/lib/providers/asset_viewer/scroll_to_asset_notifier.provider.dart`

```dart
class TimelineScrollTarget {
  final BaseAsset asset;
  /// The asset's creation time in the viewer's local zone (#28941).
  final DateTime date;
}

class ScrollToAssetNotifier extends ValueNotifier<TimelineScrollTarget?> {
  void scrollToAsset(BaseAsset asset);
  TimelineScrollTarget? consume();
}

/// Replaces `scrollToDateNotifierProvider`. Still a bare top-level notifier, not a
/// Riverpod provider — the timeline subscribes to it with addListener/removeListener.
final scrollToAssetNotifierProvider = ScrollToAssetNotifier(null);
```

`scrollToAsset` derives `date` as `asset.createdAt.toLocal()` internally, so no caller can reintroduce the
UTC bug fixed in #28941. `TimelineScrollTarget.operator==` compares via `asset.refersToSameAsset(other.asset)`
and `date`, preserving the existing "repeat request re-notifies" contract.

The date-only `scrollToDate` API is **removed**, not kept alongside. All three existing call sites already
have the asset in scope:

- `mobile/lib/presentation/widgets/memory/memory_bottom_info.widget.dart:47`
- `mobile/lib/utils/action_button.utils.dart:285`
- `mobile/lib/pages/backup/drift_backup_asset_detail.page.dart:91`

### 2. Force Day grouping when in overview

`mobile/lib/presentation/widgets/timeline/scroll_drain.dart`

#### 2a. Detect overview from the rendered segments, not from the grouping providers

**This must not read `timelineGroupingProvider`.** `timeline.state.dart:97-107` decides overview-vs-fixed
from a different expression than the grouping provider alone:

```dart
final GroupAssetsBy groupBy = groupByArg ?? ref.watch(timelineGroupingProvider);
final isDateless = buckets.isNotEmpty && buckets.first is! TimeBucket;
final effectiveGroupBy = isDateless ? GroupAssetsBy.day : groupBy;
if (effectiveGroupBy == year || effectiveGroupBy == month) → TimelineOverviewSegmentBuilder
```

There are three ways the provider and the screen disagree:

1. `timelineArgsProvider.groupBy` overrides the provider entirely.
2. A **dateless** bucket source (relevance-sorted search, `fromAssets` timelines) forces `day` regardless.
3. A `TimelineRouteScope` substitutes a route-local `RouteTimelineGroupingNotifier`.

In any of them the widget would see "overview", call `set(day)` — which changes nothing, because the arg or
the dateless override wins — and repeat until the budget expires, **silently discarding the request**.
`_resolveZoomAnchor` (`timeline.widget.dart:472`) already ran into arm 1 and reads
`timelineArgsProvider.groupBy ?? timelineGroupingProvider`; it still misses arm 2.

Deriving the flag from the segments that were actually built sidesteps all three:

```dart
/// True when the timeline is rendering year/month overview cards rather than
/// asset tiles — in which case the target photo has no tile to scroll to.
bool segmentsAreOverview(List<Segment>? segments) =>
    segments != null && segments.any((s) => s is TimelineOverviewSegment);
```

`GroupAssetsBy.auto` and `.none` therefore need no special handling at all — they can never produce a
`TimelineOverviewSegment`.

#### 2b. The decision function

```dart
enum ScrollDrainAction { idle, scroll, retry, giveUp, switchToDayGrouping }

ScrollDrainAction decideScrollDrain({
  required bool hasPending,
  required bool segmentsLoaded,
  required bool laidOut,
  required bool segmentMatched,
  required bool isOverviewTimeline,   // new — from segmentsAreOverview()
  required int attempts,
  required int maxAttempts,
});
```

Evaluation order — deliberately chosen so each existing guarantee survives:

```dart
if (!hasPending) return idle;
if (segmentsLoaded && laidOut && segmentMatched && !isOverviewTimeline) return scroll;
if (attempts >= maxAttempts) return giveUp;
if (isOverviewTimeline) return switchToDayGrouping;
return retry;
```

- `scroll` stays ahead of the budget check, so a request that becomes ready on the very last frame still
  scrolls (existing behaviour).
- `!isOverviewTimeline` gates `scroll`, so an overview request can never scroll to a year/month card —
  which is the #822 symptom.
- The budget check sits **ahead** of `switchToDayGrouping`, so a grouping write that never lands cannot
  spin forever — **provided the widget increments `attempts` on that branch too** (see below).

**Widget-side guards.** Two distinct concerns, easily conflated:

1. **`attempts` must increment on `switchToDayGrouping`, not only on `retry`.** Today only the `retry`
   branch does (`timeline.widget.dart:417`). If `switchToDayGrouping` leaves the counter alone, the budget
   never advances and the loop is genuinely infinite — the guarantee above would be vacuous.
2. **`set()` must be called at most once per drain cycle**, because
   `TimelineGroupingNotifier.set()` writes the persisted `SettingsKey.timelineGroupAssetsBy`. A
   `_daySwitchRequested` flag, reset when `_requestScrollDrain` opens a cycle and when the cycle ends,
   makes subsequent `switchToDayGrouping` frames behave as a plain retry (still incrementing `attempts`).

### 3. Resolve the asset's absolute index

`mobile/lib/presentation/widgets/timeline/asset_scan.dart` (new file — kept separate from
`timeline_scroll_target.dart`, which stays purely about segment lookup and row geometry)

```dart
const int kAssetScanChunkSize = 250;

/// Hard ceiling on how many assets a single scroll request will scan before
/// giving up and falling back to the segment top. See "Buffer eviction" below.
const int kAssetScanCap = 2000;

/// Contiguous (index, count) windows covering a segment's assets.
/// Yields nothing when [assetCount] <= 0; treats [chunkSize] <= 0 as 1.
Iterable<({int index, int count})> assetScanChunks({
  required int firstAssetIndex,
  required int assetCount,
  int chunkSize = kAssetScanChunkSize,
});

/// Absolute timeline index of [target] within the segment, or null if absent.
Future<int?> findAssetIndex({
  required Future<List<BaseAsset>> Function(int index, int count) loadAssets,
  required int firstAssetIndex,
  required int assetCount,
  required BaseAsset target,
  int chunkSize = kAssetScanChunkSize,
  int cap = kAssetScanCap,
});
```

`chunkSize <= 0` is clamped to 1 rather than trusted: a zero or negative chunk size would either yield no
windows (silently "asset not found") or loop forever. Same for `assetCount <= 0`, which yields no windows
and short-circuits `findAssetIndex` to `null` without ever invoking `loadAssets`.

Matching uses `BaseAsset.refersToSameAsset`, not `==`. This matters: the codebase already documents that
`RemoteAsset.hashCode` includes `localId` while `==` does not
(`fixed/segment.model.dart:246-250`), so the same server asset compares unequal when one copy has
`localId` populated and the other does not. `refersToSameAsset` compares `remoteId`, then `localId`, then
`checksum` — all three arms need coverage, including the checksum-only asset that has neither id.

`findAssetIndex` returns `null` rather than throwing when `loadAssets` fails, so a transient read error
degrades to the fallback scroll instead of breaking the gesture.

**Buffer eviction — why the cap exists.** `TimelineService.loadAssets` replaces the service's shared
`_buffer`/`_bufferOffset` (`timeline.service.dart:241-270`). `_FixedSegmentRow.build` checks
`hasRange()` synchronously and falls back to `ThumbnailPlaceholder`s on a miss
(`fixed/segment.model.dart:113-134`). So a long scan walks the buffer away from the rows currently on
screen and the timeline visibly flashes placeholders — during exactly the huge-day case this fix is for.
`kAssetScanCap` bounds that to ~8 chunk reads; beyond it we take the segment-top fallback, which is no
worse than today's behaviour. The scan runs while the user is still transitioning out of the memory view,
so the flicker is expected to be unobservable in practice — but the cap keeps the worst case bounded rather
than proportional to bucket size.

### 4. Resolve asynchronously without corrupting the drain loop

`findAssetIndex` is a `Future`, but the drain loop is synchronous and atomic today
(`timeline.widget.dart:408-411`):

```dart
case ScrollDrainAction.scroll:
  _scrollToDate(date!, segments!);
  scrollToDateNotifierProvider.consume();
  _scrollDrainScheduled = false;
```

Introducing an `await` between the decision and the scroll opens three holes, all of which need explicit
handling:

| Hole                                                                    | Handling                                                                                                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-entrancy — the loop schedules another attempt while one is resolving | An `_resolvingScrollTarget` field is set before the `await`; `_attemptScrollDrain` returns immediately while it is non-null                              |
| The timeline unmounts mid-`await`                                       | Recheck `mounted` **and** `_scrollController.hasClients` after the await; bail without scrolling                                                         |
| A newer request lands mid-`await`                                       | Compare the latched target against `_resolvingScrollTarget` after the await; if it changed, abandon this resolution and let the loop pick up the new one |

**Consume timing.** `consume()` fires _after_ the await resolves, on both the success and the
fallback-scroll paths — never before. Consuming early would drop the request if resolution failed; the
`_resolvingScrollTarget` guard is what prevents the late consume from allowing a duplicate concurrent scan.

The decision inputs factor into a pure helper so the interesting part stays unit-testable:

```dart
enum ScrollResolveOutcome { proceed, abandonStale, abandonUnmounted }

ScrollResolveOutcome decideScrollResolve({
  required bool stillMounted,
  required bool stillHasClients,
  required bool targetUnchanged,
});
```

### 5. Scroll to the asset's row

`mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart` (extended)

```dart
double? assetRowOffset({
  required Segment segment,
  required int assetIndexInTimeline,
  required int columnCount,
});
```

Mirrors the arithmetic `_restoreAssetPosition` (`timeline.widget.dart:268-277`) already uses:

```dart
final assetIndexInSegment = assetIndexInTimeline - segment.firstAssetIndex;
final rowIndexInSegment = assetIndexInSegment ~/ columnCount;
return segment.indexToLayoutOffset(segment.gridIndex + rowIndexInSegment);
```

Returns `null` when `columnCount <= 0` or `assetIndexInSegment` falls outside
`[0, segment.bucket.assetCount)` — which also covers an empty segment (`assetCount == 0`), where every
index is out of range. The caller clamps the result to `[0, _scrollController.position.maxScrollExtent]`.

**Fallback.** When the segment matches but the asset cannot be located (`findAssetIndex` → `null`, whether
absent, capped, or failed) or the offset is `null`, `_beginScrollToAsset` scrolls to
`segment.startOffset - 50` — today's behaviour. The user still lands on the correct day rather than getting
no response.

The most likely cause of that fallback is a **stacked asset**: the timeline collapses stacks and keeps only
the primary (`timeline.repository.dart:527-529`), while `memory.repository.dart` applies no stack filter. A
memory surfacing a stack child therefore has no tile to scroll to. Resolving the stack primary is out of
scope for this fix; the day-level fallback covers it.

### 6. Highlight on arrival

`mobile/lib/providers/timeline/highlighted_asset.provider.dart`

```dart
class TimelineHighlightedAssetNotifier extends Notifier<BaseAsset?> {
  void highlight(BaseAsset asset, {Duration duration = const Duration(milliseconds: 1500)});
  void clear();
}

bool isHighlightedAsset(BaseAsset? highlighted, BaseAsset candidate);
```

The notifier owns a single `Timer`; highlighting a new asset cancels the pending clear so two rapid
requests cannot leave a stale highlight. `ref.onDispose` cancels the timer. `_beginScrollToAsset` also
calls `clear()` when it _starts_ a new resolution, so a second jump issued while the previous highlight is
still showing cannot leave the earlier tile outlined.

`_AssetTileWidget` (`fixed/segment.model.dart:201`) subscribes narrowly:

```dart
final isHighlighted = ref.watch(
  timelineHighlightedAssetProvider.select((a) => isHighlightedAsset(a, asset)),
);
```

so only the matching tile's selector flips.

The highlight itself is a rounded border drawn in `context.colorScheme.primary` over the tile, faded in and
out by an `AnimatedContainer` (200 ms). Border only — no scrim or scale change, so the photo is never
obscured while the user is trying to identify it.

### 7. Do not let the grouping-change anchor fight the scroll

`_onGroupingChanged` (`timeline.widget.dart:292`) derives a position anchor from the top visible date on
every grouping change — including the one component 2 triggers. It gains an early return when a scroll
request is pending, so the precise scroll wins.

## Error handling

| Condition                                                      | Behaviour                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Asset not in the timeline at all (archived, locked, trashed)   | No segment matches → retry → `giveUp` at 180 frames, request dropped                   |
| Asset is a stack child                                         | Segment matches, index not found → fallback scroll to segment top                      |
| Segment larger than `kAssetScanCap`                            | Scan stops at the cap → fallback scroll to segment top                                 |
| `loadAssets` throws                                            | `findAssetIndex` → `null` → fallback scroll to segment top                             |
| `chunkSize <= 0`                                               | Clamped to 1 — never an empty or infinite window sequence                              |
| `assetCount <= 0`                                              | No windows, `loadAssets` never called, `findAssetIndex` → `null`                       |
| `columnCount <= 0`                                             | `assetRowOffset` → `null` → fallback scroll to segment top                             |
| Grouping arg/dateless source pins day while provider says year | `segmentsAreOverview` reads the built segments, so no futile grouping switch           |
| Grouping write never lands                                     | `attempts` increments on `switchToDayGrouping` → budget expires → `giveUp`             |
| Timeline unmounted mid-drain                                   | Existing `mounted` guard exits the loop                                                |
| Timeline unmounted mid-`await`                                 | `decideScrollResolve` → `abandonUnmounted`, no scroll attempted                        |
| A newer request lands mid-`await`                              | `decideScrollResolve` → `abandonStale`, the loop picks up the newer target             |
| Two jumps in quick succession                                  | `_resolvingScrollTarget` blocks a concurrent scan; `clear()` drops the stale highlight |

No path throws, and every failure degrades to at-worst today's behaviour.

## Testing

Scenarios are written BDD-style and map 1:1 onto `group`/`test` names. All of the following run under
`flutter test` with no device or database.

### TDD order

Strict red → green per step: write the scenarios for that step, watch them fail for the intended reason
(not a compile error standing in for an assertion), then implement until green. Do not start a step before
the previous one is green. Each step is independently committable.

| Step | Unit                                          | Depends on | Why this order                                                                         |
| ---- | --------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| 1    | `segmentsAreOverview`                         | —          | Pure, no deps; the flag every later decision consumes                                  |
| 2    | `decideScrollDrain` (+ `switchToDayGrouping`) | 1          | Pure; encodes the state machine before anything calls it                               |
| 3    | `assetScanChunks`                             | —          | Pure; windowing must be right before any scan is built on it                           |
| 4    | `findAssetIndex`                              | 3          | Async but injectable — a plain closure, still no device                                |
| 5    | `assetRowOffset`                              | —          | Pure geometry; independent of 1–4, ordered here so 6 has both halves                   |
| 6    | `decideScrollResolve`                         | —          | Pure; the async guard's decision table                                                 |
| 7    | `ScrollToAssetNotifier`                       | —          | Pure; flips the three call sites to the asset-carrying API                             |
| 8    | `isHighlightedAsset` + highlight notifier     | —          | Pure predicate + timer behaviour, `fakeAsync` for expiry                               |
| 9    | Widget wiring in `timeline.widget.dart`       | 1–8        | Not unit-tested — every decision it makes was already proven above; manual verify only |

Step 9 deliberately contains **no new logic**: it reads the pure helpers and applies their results. If it
grows a branch that is not covered by steps 1–8, that branch belongs in a helper instead.

### `test/presentation/widgets/timeline/scroll_drain_test.dart` (extend)

```gherkin
Feature: segmentsAreOverview

  Scenario: null segments are not an overview
  Scenario: an empty segment list is not an overview
  Scenario: fixed segments only are not an overview
  Scenario: any overview segment present makes it an overview
  Scenario: a mixed list containing one overview segment is an overview

Feature: deciding what to do with a pending scroll request

  Scenario: nothing pending
    Given no scroll request is pending
    Then the action is idle
    And it is idle regardless of grouping, layout or attempt count

  Scenario: ready in day grouping
    Given a pending request, segments loaded, laid out, and a matching segment
    And the grouping is not an overview grouping
    Then the action is scroll

  Scenario: ready but in overview grouping
    Given a pending request, segments loaded, laid out, and a matching segment
    But the grouping is an overview grouping
    Then the action is switchToDayGrouping
    And it is never scroll

  Scenario Outline: not ready yet in day grouping
    Given a pending request in day grouping with attempts below the budget
    And <blocker>
    Then the action is retry
    Examples: segments not loaded | not laid out | no matching segment

  Scenario: not ready in overview grouping
    Given a pending request in overview grouping with attempts below the budget
    And segments are not loaded
    Then the action is switchToDayGrouping

  Scenario: budget exhausted
    Given a pending request that is not ready
    And attempts equal the budget
    Then the action is giveUp
    And it is still giveUp when attempts exceed the budget

  Scenario: ready exactly at the budget
    Given a pending, ready request in day grouping
    And attempts equal the budget
    Then the action is scroll

  Scenario: overview grouping cannot spin forever
    Given a pending request in overview grouping
    And attempts equal the budget
    Then the action is giveUp

Feature: decideScrollResolve

  Scenario: everything still valid after the await
    Given the widget is mounted, the controller has clients, and the target is unchanged
    Then the outcome is proceed

  Scenario: the widget unmounted during the await
    Then the outcome is abandonUnmounted

  Scenario: the scroll controller lost its clients during the await
    Then the outcome is abandonUnmounted

  Scenario: a newer scroll request replaced the target during the await
    Then the outcome is abandonStale

  Scenario: unmounted and stale at once
    Then the outcome is abandonUnmounted      # unmount dominates; nothing may touch the controller
```

### `test/presentation/widgets/timeline/timeline_scroll_target_test.dart` (extend)

Existing `findTimelineScrollTargetSegment` / `findTimelineZoomAnchorSegment` tests are unchanged.

```gherkin
Feature: assetRowOffset

  Scenario: the segment's first asset sits on the first grid row
    Then the offset equals the segment's gridOffset

  Scenario: an asset within the first row sits on the first grid row
    Given columnCount is 4 and the asset is at segment offset 3
    Then the offset equals the segment's gridOffset

  Scenario: the first asset of the second row advances one row
    Given columnCount is 4 and the asset is at segment offset 4
    Then the offset equals gridOffset plus one mainAxisExtend

  Scenario: the last asset resolves to the final row
  Scenario: columnCount of 1 puts every asset on its own row
  Scenario: an index below firstAssetIndex returns null
  Scenario: an index at or past firstAssetIndex + assetCount returns null
  Scenario: a columnCount of zero returns null
  Scenario: a negative columnCount returns null
  Scenario: a non-zero firstAssetIndex is subtracted before the row maths
  Scenario: an empty segment returns null for every index
```

### `test/presentation/widgets/timeline/asset_scan_test.dart` (new)

```gherkin
Feature: assetScanChunks

  Scenario: an empty segment yields no chunks
  Scenario: a negative assetCount yields no chunks
  Scenario: fewer assets than the chunk size yields one exact chunk
  Scenario: exactly one chunk size yields one chunk
  Scenario: one more than a chunk size yields two chunks, the second of count 1
  Scenario: chunks are contiguous and their counts sum to assetCount
  Scenario: chunks start at a non-zero firstAssetIndex
  Scenario: a chunkSize of zero is clamped to one
    Then the sequence is finite and covers every asset
  Scenario: a negative chunkSize is clamped to one

Feature: findAssetIndex

  Scenario: the target is in the first chunk
    Then the absolute timeline index is returned

  Scenario: the target is in a later chunk
    Then the absolute index accounts for the preceding chunks

  Scenario: the target is the segment's last asset
  Scenario: the target is absent
    Then null is returned
    And every chunk was requested exactly once

  Scenario: a chunk returns fewer assets than requested
    Then the resolved index still matches the requested window offset

  Scenario: loadAssets throws
    Then null is returned and no exception escapes

  Scenario: an empty segment short-circuits
    Then null is returned and loadAssets is never called

  Scenario: the segment is larger than the cap
    Given a segment of 5000 assets and a cap of 2000
    And the target sits at index 4000
    Then null is returned
    And no more than the cap's worth of assets was requested

  Scenario: a target just inside the cap is still found

  Scenario Outline: identity uses refersToSameAsset, not ==
    Given a candidate matching only by <arm>
    Then it matches
    Examples: remoteId (with a differing localId) | localId (remoteId null on both) | checksum (neither id set)

  Scenario: a candidate matching on no arm does not match
```

### `test/providers/asset_viewer/scroll_to_asset_notifier_test.dart` (replaces `scroll_to_date_notifier_test.dart`)

```gherkin
Feature: latching a scroll target

  Scenario: the notifier starts empty
  Scenario: requesting a scroll latches the asset
  Scenario: the latched date is the viewer-local creation time
    Given an asset created at a UTC instant
    Then the latched date is that instant in the local zone      # regression guard, #28941
  Scenario: requesting the same asset twice notifies listeners again
  Scenario: requesting a different asset replaces the target and notifies
  Scenario: consume returns the target and clears the latch
  Scenario: consume on an empty notifier returns null
```

### `test/providers/timeline/highlighted_asset_test.dart` (new)

```gherkin
Feature: isHighlightedAsset

  Scenario: nothing highlighted matches nothing
  Scenario: the same asset matches
  Scenario: the same remoteId with a different localId matches
  Scenario: a checksum-only asset matches its counterpart
  Scenario: a different asset does not match

Feature: the highlight notifier

  Scenario: highlighting sets the asset
  Scenario: the highlight clears itself after the duration
  Scenario: highlighting a second asset cancels the first timer
    Then the second highlight survives past the first asset's original expiry
  Scenario: clear cancels a pending timer
    Then the asset does not reappear when the original duration elapses
  Scenario: clear is idempotent
  Scenario: disposal cancels a pending timer
```

Timer expiry is driven with `fakeAsync` rather than real delays, so the suite stays deterministic and fast.

### Manual verification (device / simulator)

These cross the widget/animation boundary and are **not** claimed as unit-tested:

1. Year grouping → open a memory → tap the arrow → grouping becomes Day, timeline lands on the photo, tile
   flashes.
2. Month grouping → same.
3. Day grouping on a day with 500+ photos → lands on the photo's row, not the day header.
4. Tapping the arrow twice for the same memory asset re-scrolls the second time.
5. A memory whose asset is a stack child → lands on the correct day, no crash, no hang.
6. The `view in timeline` action button in the asset viewer and the backup detail page still work.
7. **No placeholder flicker** on a large day — watch the visible rows during the scan (the buffer-eviction
   risk the cap bounds).
8. Backing out of the memory immediately after tapping the arrow → no crash from the unmount-mid-`await`
   path.
9. Two memories in quick succession → lands on the second photo, and only the second tile is highlighted.
10. A route-scoped timeline that pins its own grouping (an album or space) → the asset-viewer
    `view in timeline` action still lands correctly and does not thrash the grouping.

### Gates

`dart analyze --fatal-infos lib test` and `dart format` both gate in CI. Run `flutter test` with the
pinned SDK from `mobile/mise.toml` (read the pin; do not trust a local symlink's self-reported version),
after `flutter pub get` and the one-time
`dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`.

## Out of scope

- Resolving a stack child to its stack primary (web does this; mobile falls back to the day).
- Any change to web, server, or the API.
- New i18n strings — the existing `view_in_timeline` key is reused.
