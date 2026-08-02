# Memory Jump-to-Photo Implementation Plan (#822)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping the arrow in a Memory navigates the mobile timeline to that exact photo — in Day, Month, or Year grouping — and briefly highlights its tile.

**Architecture:** The "view in timeline" request latches the **asset** instead of a bare date. The timeline's existing per-frame scroll-drain loop gains a fifth action, `switchToDayGrouping`, taken when the rendered segments are year/month overview cards (where no asset tile exists). Once day segments are on screen, the asset's absolute index is resolved by chunk-scanning the matched segment through `TimelineService.loadAssets`, converted to a row offset with the same arithmetic `_restoreAssetPosition` already uses, and scrolled to. All decision logic lives in pure functions; the widget only applies their results.

**Tech Stack:** Flutter, Riverpod (`hooks_riverpod`), Drift (local DB), `flutter_test` + `fake_async` + `mocktail`.

**Spec:** `docs/superpowers/specs/2026-07-30-822-memory-jump-to-photo-design.md`

## Global Constraints

- **Scope is `mobile/` only.** No server, web, API, OpenAPI, or i18n changes. The existing `view_in_timeline` translation key is reused.
- **Flutter SDK:** read the pin from `mobile/mise.toml` (`"aqua:flutter/flutter"`). Do not trust a local `flutter --version` — a `mise install` may symlink an older patch that self-reports incorrectly. If in doubt invoke `~/.local/share/mise/installs/aqua-flutter-flutter/<version>/flutter/bin/{flutter,dart}` directly.
- **One-time test setup** (the `lib/generated/*.g.dart` files are gitignored), run from `mobile/`:
  ```bash
  flutter pub get
  dart run easy_localization:generate -S ../i18n
  dart run bin/generate_keys.dart
  ```
  Drift and OpenAPI generated code is committed — `build_runner` is **not** needed.
- **CI gates** (`mobile/mise.toml`): `analyze:dart` runs `dart analyze --fatal-infos` over the package, and `format` runs `dart format --set-exit-if-changed` over **`lib/` only** — never `test/`.
- **Never run `dart format lib test`.** The repo's `test/` tree was formatted by an older Dart and is not gated; formatting it with the pinned 3.44.8 reflows ~30 unrelated files into your diff. Format only the files you touched: `dart format <the files you changed>`.
- An `info`-level lint fails the build, so unused imports, duplicate imports, and non-exhaustive enum switches are errors in practice.
- **`dart analyze` is not a substitute for `flutter test`** — generated-code compile errors only surface when a test actually compiles.
- **Commit trailers:** never add `Co-Authored-By` or `Generated with` trailers.
- **Every task must leave `flutter test` green and the tree compiling.** Tasks are ordered so this holds at each commit.

## File Structure

| File                                                                                                                          | Responsibility                                                                                       | Tasks   |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------- |
| `lib/presentation/widgets/timeline/scroll_drain.dart`                                                                         | Pure decisions for the drain loop: `segmentsAreOverview`, `decideScrollDrain`, `decideScrollResolve` | 1, 2, 6 |
| `lib/presentation/widgets/timeline/asset_scan.dart` _(new)_                                                                   | Chunk windowing + asset index resolution                                                             | 3, 4    |
| `lib/presentation/widgets/timeline/timeline_scroll_target.dart`                                                               | Segment lookup (existing) + row geometry                                                             | 5       |
| `lib/providers/asset_viewer/scroll_to_asset_notifier.provider.dart` _(new, replaces `scroll_to_date_notifier.provider.dart`)_ | Latches the pending scroll target                                                                    | 7       |
| `lib/providers/timeline/highlighted_asset.provider.dart` _(new)_                                                              | Transient arrival highlight                                                                          | 8       |
| `lib/presentation/widgets/timeline/fixed/segment.model.dart`                                                                  | Renders the highlight on the target tile                                                             | 8       |
| `lib/presentation/widgets/timeline/timeline.widget.dart`                                                                      | Wires the above together; holds no decision logic of its own                                         | 2, 7, 9 |

---

### Task 1: Detect overview rendering from the built segments

**Files:**

- Modify: `mobile/lib/presentation/widgets/timeline/segment.model.dart` (add an `isOverview` getter to `Segment`)
- Modify: `mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart` (override it)
- Modify: `mobile/lib/presentation/widgets/timeline/scroll_drain.dart`
- Test: `mobile/test/presentation/widgets/timeline/scroll_drain_test.dart`

**Interfaces:**

- Consumes: nothing.
- Produces: `bool get Segment.isOverview` and `bool segmentsAreOverview(List<Segment>? segments)` — used by Task 2's widget wiring.

**Why this exists:** `timeline.state.dart:97-107` chooses the overview builder from `timelineArgsProvider.groupBy ?? timelineGroupingProvider`, then overrides it to `day` when the bucket source is dateless. A `TimelineRouteScope` can also swap in a route-local grouping notifier. Reading the grouping provider would disagree with the screen in all three cases, and a "switch to day" that changes nothing would spin until the attempt budget expired, silently dropping the request.

**Why a getter rather than an `is TimelineOverviewSegment` check in `scroll_drain.dart`:** `overview_segment.model.dart` imports `hooks_riverpod`, `overview_drilldown.provider.dart`, and `overview_representative_cache.provider.dart`. Type-testing against it from `scroll_drain.dart` would drag Riverpod and two providers into what is otherwise a dependency-light decision file. A segment already knows what it renders, so the knowledge belongs on the model.

- [ ] **Step 1: Write the failing tests**

Add to `mobile/test/presentation/widgets/timeline/scroll_drain_test.dart`. Add these imports at the top of the file:

```dart
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
```

Add this `group` inside `main()`:

```dart
  group('segmentsAreOverview', () {
    test('null segments are not an overview', () {
      expect(segmentsAreOverview(null), isFalse);
    });

    test('an empty segment list is not an overview', () {
      expect(segmentsAreOverview(const []), isFalse);
    });

    test('fixed segments only are not an overview', () {
      expect(segmentsAreOverview([_fixedSegment(), _fixedSegment()]), isFalse);
    });

    test('a list of overview segments is an overview', () {
      expect(segmentsAreOverview([_overviewSegment(), _overviewSegment()]), isTrue);
    });

    test('a mixed list containing one overview segment is an overview', () {
      // Defensive: the builder never mixes them today, but treating "any overview
      // card present" as overview keeps the scroll from targeting a card.
      expect(segmentsAreOverview([_fixedSegment(), _overviewSegment()]), isTrue);
    });
  });
```

Add these helpers at the bottom of the file, after `main()`:

```dart
FixedSegment _fixedSegment() => FixedSegment(
  firstIndex: 0,
  lastIndex: 1,
  startOffset: 0,
  endOffset: 100,
  firstAssetIndex: 0,
  bucket: TimeBucket(date: DateTime(2026, 4, 3), assetCount: 1),
  tileHeight: 100,
  columnCount: 4,
  headerExtent: 40,
  spacing: 2,
  header: HeaderType.day,
);

TimelineOverviewSegment _overviewSegment() => TimelineOverviewSegment(
  firstIndex: 0,
  lastIndex: 0,
  startOffset: 0,
  endOffset: 100,
  firstAssetIndex: 0,
  bucket: TimeBucket(date: DateTime(2026, 1), assetCount: 12),
  groupBy: GroupAssetsBy.year,
  header: HeaderType.none,
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `flutter test test/presentation/widgets/timeline/scroll_drain_test.dart`
Expected: FAIL to compile — `The function 'segmentsAreOverview' isn't defined`.

- [ ] **Step 3: Implement**

In `mobile/lib/presentation/widgets/timeline/segment.model.dart`, add this getter to the abstract `Segment` class (next to `containsIndex` / `isWithinOffset`):

```dart
  /// True when this segment renders a year/month overview card rather than rows
  /// of asset tiles. Overridden by [TimelineOverviewSegment].
  bool get isOverview => false;
```

In `mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart`, override it inside `TimelineOverviewSegment` (after the `groupBy` field):

```dart
  @override
  bool get isOverview => true;
```

In `mobile/lib/presentation/widgets/timeline/scroll_drain.dart`, add this import at the top:

```dart
import 'package:immich_mobile/presentation/widgets/timeline/segment.model.dart';
```

Append this function to the file:

```dart
/// True when the timeline is rendering year/month overview cards rather than
/// asset tiles — in which case the target photo has no tile to scroll to.
///
/// Deliberately derived from the segments that were actually built, NOT from
/// `timelineGroupingProvider`. `timeline.state.dart` picks the builder from
/// `timelineArgsProvider.groupBy ?? timelineGroupingProvider`, then overrides it
/// to `day` when the bucket source is dateless, and a `TimelineRouteScope` can
/// substitute a route-local grouping notifier. Reading the provider would
/// disagree with the screen in all three cases, and a "switch to day" that
/// changes nothing would spin until the attempt budget expired.
bool segmentsAreOverview(List<Segment>? segments) =>
    segments != null && segments.any((segment) => segment.isOverview);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `flutter test test/presentation/widgets/timeline/scroll_drain_test.dart`
Expected: PASS (all pre-existing tests in the file still pass too).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation/widgets/timeline/segment.model.dart \
        mobile/lib/presentation/widgets/timeline/overview/overview_segment.model.dart \
        mobile/lib/presentation/widgets/timeline/scroll_drain.dart \
        mobile/test/presentation/widgets/timeline/scroll_drain_test.dart
git commit -m "feat(mobile): detect overview timeline rendering from built segments"
```

---

### Task 2: Add the switchToDayGrouping action and wire the grouping switch

**Files:**

- Modify: `mobile/lib/presentation/widgets/timeline/scroll_drain.dart`
- Modify: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart` (`_attemptScrollDrain`, `_requestScrollDrain`, `_onGroupingChanged`, new `_daySwitchRequested` field)
- Test: `mobile/test/presentation/widgets/timeline/scroll_drain_test.dart`

**Interfaces:**

- Consumes: `segmentsAreOverview(List<Segment>?)` from Task 1.
- Produces: `ScrollDrainAction.switchToDayGrouping` enum value; `decideScrollDrain` gains a `required bool isOverviewTimeline` parameter.

**Deliverable:** Year/Month grouping now drills to Day and lands on the day header. That is not yet the full fix (Tasks 3-9 land on the exact photo), but it is independently reviewable and manually verifiable.

- [ ] **Step 1: Write the failing tests**

In `mobile/test/presentation/widgets/timeline/scroll_drain_test.dart`, update the existing `decide` helper inside the `decideScrollDrain` group to add the new parameter:

```dart
    ScrollDrainAction decide({
      bool hasPending = true,
      bool segmentsLoaded = true,
      bool laidOut = true,
      bool segmentMatched = true,
      bool isOverviewTimeline = false,
      int attempts = 0,
    }) {
      return decideScrollDrain(
        hasPending: hasPending,
        segmentsLoaded: segmentsLoaded,
        laidOut: laidOut,
        segmentMatched: segmentMatched,
        isOverviewTimeline: isOverviewTimeline,
        attempts: attempts,
        maxAttempts: maxAttempts,
      );
    }
```

Then add these tests inside the same group:

```dart
    test('is idle with no pending request regardless of grouping or attempts', () {
      expect(decide(hasPending: false, isOverviewTimeline: true), ScrollDrainAction.idle);
      expect(
        decide(hasPending: false, isOverviewTimeline: true, laidOut: false, attempts: maxAttempts + 1),
        ScrollDrainAction.idle,
      );
    });

    test('never scrolls while the timeline renders overview cards', () {
      // #822: in Year/Month grouping findTimelineScrollTargetSegment happily matches
      // the year/month CARD, so "ready" is true — scrolling here is exactly the bug.
      expect(decide(isOverviewTimeline: true), ScrollDrainAction.switchToDayGrouping);
    });

    test('switches to day grouping while an overview timeline is still loading', () {
      expect(decide(isOverviewTimeline: true, segmentsLoaded: false), ScrollDrainAction.switchToDayGrouping);
      expect(decide(isOverviewTimeline: true, laidOut: false), ScrollDrainAction.switchToDayGrouping);
    });

    test('keeps switching right up to the attempt budget', () {
      expect(decide(isOverviewTimeline: true, attempts: maxAttempts - 1), ScrollDrainAction.switchToDayGrouping);
    });

    test('gives up rather than switching forever when the grouping write never lands', () {
      // If the grouping is pinned by timelineArgs or a dateless bucket source, set(day)
      // is a no-op. The budget is the only thing stopping an infinite loop, so the
      // widget must increment attempts on this branch too.
      expect(decide(isOverviewTimeline: true, attempts: maxAttempts), ScrollDrainAction.giveUp);
      expect(decide(isOverviewTimeline: true, attempts: maxAttempts + 5), ScrollDrainAction.giveUp);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `flutter test test/presentation/widgets/timeline/scroll_drain_test.dart`
Expected: FAIL to compile — `No named parameter with the name 'isOverviewTimeline'`.

- [ ] **Step 3: Implement the decision change**

In `mobile/lib/presentation/widgets/timeline/scroll_drain.dart`, add the enum value to `ScrollDrainAction`:

```dart
  /// The timeline is rendering overview cards, so the target photo has no tile.
  /// Switch the grouping to day and keep retrying until the rebuilt segments arrive.
  switchToDayGrouping,
```

Replace the body of `decideScrollDrain` with:

```dart
ScrollDrainAction decideScrollDrain({
  required bool hasPending,
  required bool segmentsLoaded,
  required bool laidOut,
  required bool segmentMatched,
  required bool isOverviewTimeline,
  required int attempts,
  required int maxAttempts,
}) {
  if (!hasPending) return ScrollDrainAction.idle;
  // `scroll` stays ahead of the budget check so a request that becomes ready on the
  // very last frame still scrolls. `!isOverviewTimeline` gates it so an overview
  // timeline can never scroll to a year/month card — the #822 symptom.
  if (segmentsLoaded && laidOut && segmentMatched && !isOverviewTimeline) return ScrollDrainAction.scroll;
  // The budget sits AHEAD of the switch so a grouping write that never lands
  // (pinned by timelineArgs, or a dateless bucket source) cannot spin forever.
  if (attempts >= maxAttempts) return ScrollDrainAction.giveUp;
  if (isOverviewTimeline) return ScrollDrainAction.switchToDayGrouping;
  return ScrollDrainAction.retry;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `flutter test test/presentation/widgets/timeline/scroll_drain_test.dart`
Expected: PASS.

- [ ] **Step 5: Wire the widget**

In `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`:

Add the field next to `_scrollDrainScheduled` (around line 367):

```dart
  bool _daySwitchRequested = false;
```

In `_requestScrollDrain`, reset it when a cycle opens:

```dart
  void _requestScrollDrain() {
    if (scrollToDateNotifierProvider.value == null) return;
    if (_scrollDrainScheduled) return;
    _scrollDrainScheduled = true;
    _scrollDrainAttempts = 0;
    _daySwitchRequested = false;
    _attemptScrollDrain();
  }
```

In `_attemptScrollDrain`, compute the flag and pass it:

```dart
    final laidOut = _scrollController.hasClients && _scrollController.position.hasContentDimensions;
    final matched = date != null && segments != null && _findSegmentForDate(segments, date) != null;
    final isOverview = segmentsAreOverview(segments);

    final action = decideScrollDrain(
      hasPending: date != null,
      segmentsLoaded: segments != null,
      laidOut: laidOut,
      segmentMatched: matched,
      isOverviewTimeline: isOverview,
      attempts: _scrollDrainAttempts,
      maxAttempts: _maxScrollDrainAttempts,
    );
```

Add the new case to the `switch (action)` block, and reset `_daySwitchRequested` on the three terminal branches:

```dart
    switch (action) {
      case ScrollDrainAction.idle:
        _scrollDrainScheduled = false;
        _daySwitchRequested = false;
      case ScrollDrainAction.scroll:
        _scrollToDate(date!, segments!);
        scrollToDateNotifierProvider.consume();
        _scrollDrainScheduled = false;
        _daySwitchRequested = false;
      case ScrollDrainAction.giveUp:
        // Budget exhausted: drop the request so it cannot leak into a later timeline.
        scrollToDateNotifierProvider.consume();
        _scrollDrainScheduled = false;
        _daySwitchRequested = false;
      case ScrollDrainAction.switchToDayGrouping:
        // Overview groupings render cards, not tiles. Drill to day the same way a
        // card tap does, then keep retrying until the rebuilt segments arrive.
        // `attempts` MUST increment here: if the grouping is pinned and set() is a
        // no-op, the budget is the only thing that ends this loop.
        _scrollDrainAttempts++;
        if (!_daySwitchRequested) {
          _daySwitchRequested = true;
          unawaited(ref.read(timelineGroupingProvider.notifier).set(GroupAssetsBy.day));
        }
        WidgetsBinding.instance.addPostFrameCallback((_) => _attemptScrollDrain());
      case ScrollDrainAction.retry:
        _scrollDrainAttempts++;
        WidgetsBinding.instance.addPostFrameCallback((_) => _attemptScrollDrain());
    }
```

In `_onGroupingChanged`, add an early return after the `previous == next` guard so the position-derived anchor cannot fight the pending precise scroll:

```dart
    // A pending "view in timeline" request is about to scroll precisely — including
    // for the grouping change this very drain loop just triggered. Don't overwrite
    // its target with a position-derived anchor.
    if (scrollToDateNotifierProvider.value != null) {
      return;
    }
```

- [ ] **Step 6: Verify the widget compiles and the suite is green**

Run: `dart analyze --fatal-infos lib test && flutter test`
Expected: no analyzer output, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/presentation/widgets/timeline/scroll_drain.dart \
        mobile/lib/presentation/widgets/timeline/timeline.widget.dart \
        mobile/test/presentation/widgets/timeline/scroll_drain_test.dart
git commit -m "feat(mobile): drill overview timelines to day for view-in-timeline (#822)"
```

---

### Task 3: Chunk windowing for the segment scan

**Files:**

- Create: `mobile/lib/presentation/widgets/timeline/asset_scan.dart`
- Test: `mobile/test/presentation/widgets/timeline/asset_scan_test.dart` (create)

**Interfaces:**

- Consumes: nothing.
- Produces: `const int kAssetScanChunkSize`, `const int kAssetScanCap`, and
  `Iterable<({int index, int count})> assetScanChunks({required int firstAssetIndex, required int assetCount, int chunkSize})` — consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/presentation/widgets/timeline/asset_scan_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/timeline/asset_scan.dart';

void main() {
  group('assetScanChunks', () {
    List<({int index, int count})> chunks({int firstAssetIndex = 0, required int assetCount, int chunkSize = 250}) =>
        assetScanChunks(firstAssetIndex: firstAssetIndex, assetCount: assetCount, chunkSize: chunkSize).toList();

    test('an empty segment yields no chunks', () {
      expect(chunks(assetCount: 0), isEmpty);
    });

    test('a negative assetCount yields no chunks', () {
      expect(chunks(assetCount: -5), isEmpty);
    });

    test('fewer assets than the chunk size yields one exact chunk', () {
      expect(chunks(assetCount: 10, chunkSize: 250), [(index: 0, count: 10)]);
    });

    test('exactly one chunk size yields one chunk', () {
      expect(chunks(assetCount: 250, chunkSize: 250), [(index: 0, count: 250)]);
    });

    test('one more than a chunk size yields two chunks, the second of count 1', () {
      expect(chunks(assetCount: 251, chunkSize: 250), [(index: 0, count: 250), (index: 250, count: 1)]);
    });

    test('chunks are contiguous and their counts sum to assetCount', () {
      final result = chunks(assetCount: 1003, chunkSize: 250);

      expect(result.fold<int>(0, (sum, c) => sum + c.count), 1003);
      for (var i = 1; i < result.length; i++) {
        expect(result[i].index, result[i - 1].index + result[i - 1].count);
      }
    });

    test('chunks start at a non-zero firstAssetIndex', () {
      expect(chunks(firstAssetIndex: 1000, assetCount: 300, chunkSize: 250), [
        (index: 1000, count: 250),
        (index: 1250, count: 50),
      ]);
    });

    test('a chunkSize of zero is clamped to one so the sequence stays finite', () {
      // A zero or negative chunk size would otherwise yield nothing (a silent
      // "asset not found") or loop forever.
      expect(chunks(assetCount: 3, chunkSize: 0), [
        (index: 0, count: 1),
        (index: 1, count: 1),
        (index: 2, count: 1),
      ]);
    });

    test('a negative chunkSize is clamped to one', () {
      expect(chunks(assetCount: 2, chunkSize: -10), [(index: 0, count: 1), (index: 1, count: 1)]);
    });
  });
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `flutter test test/presentation/widgets/timeline/asset_scan_test.dart`
Expected: FAIL to compile — `Target of URI doesn't exist: '.../asset_scan.dart'`.

- [ ] **Step 3: Implement**

Create `mobile/lib/presentation/widgets/timeline/asset_scan.dart`:

```dart
import 'dart:math' as math;

/// How many assets are pulled from the timeline service per scan read.
const int kAssetScanChunkSize = 250;

/// Hard ceiling on how many assets a single scroll request will scan before
/// giving up and falling back to the segment top.
///
/// `TimelineService.loadAssets` replaces the service's shared buffer, and
/// `_FixedSegmentRow.build` checks `hasRange()` synchronously and falls back to
/// placeholders on a miss. An unbounded scan therefore walks the buffer away from
/// the rows on screen and the timeline visibly flashes placeholders — during
/// exactly the huge-day case this fix is for. The cap bounds that to ~8 reads.
const int kAssetScanCap = 2000;

/// Contiguous `(index, count)` windows covering a segment's assets.
///
/// Yields nothing when [assetCount] is zero or negative. A [chunkSize] below 1 is
/// clamped to 1 rather than trusted — otherwise the sequence would be empty (a
/// silent "not found") or infinite.
Iterable<({int index, int count})> assetScanChunks({
  required int firstAssetIndex,
  required int assetCount,
  int chunkSize = kAssetScanChunkSize,
}) sync* {
  if (assetCount <= 0) {
    return;
  }
  final size = math.max(1, chunkSize);
  for (var scanned = 0; scanned < assetCount; scanned += size) {
    yield (index: firstAssetIndex + scanned, count: math.min(size, assetCount - scanned));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `flutter test test/presentation/widgets/timeline/asset_scan_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation/widgets/timeline/asset_scan.dart \
        mobile/test/presentation/widgets/timeline/asset_scan_test.dart
git commit -m "feat(mobile): add bounded chunk windowing for timeline asset scans"
```

---

### Task 4: Resolve an asset's absolute timeline index

**Files:**

- Modify: `mobile/lib/presentation/widgets/timeline/asset_scan.dart`
- Test: `mobile/test/presentation/widgets/timeline/asset_scan_test.dart`

**Interfaces:**

- Consumes: `assetScanChunks`, `kAssetScanChunkSize`, `kAssetScanCap` from Task 3.
- Produces: `typedef AssetRangeLoader = Future<List<BaseAsset>> Function(int index, int count);` and
  `Future<int?> findAssetIndex({required AssetRangeLoader loadAssets, required int firstAssetIndex, required int assetCount, required BaseAsset target, int chunkSize, int cap})` — consumed by Task 9.

**Note on identity:** matching uses `BaseAsset.refersToSameAsset`, never `==`. `RemoteAsset.hashCode` includes `localId` while `==` does not (documented at `fixed/segment.model.dart:246-250`), so the same server asset compares unequal when one copy has `localId` populated and the other does not. `refersToSameAsset` tries `remoteId`, then `localId`, then `checksum`.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/test/presentation/widgets/timeline/asset_scan_test.dart`. Add these imports at the top:

```dart
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
```

Add this `group` inside `main()`:

```dart
  group('findAssetIndex', () {
    // A fake timeline of `total` assets. Records every window requested so the
    // tests can assert on read volume as well as the resolved index.
    ({AssetRangeLoader load, List<({int index, int count})> reads}) fakeTimeline(int total) {
      final reads = <({int index, int count})>[];
      Future<List<BaseAsset>> load(int index, int count) async {
        reads.add((index: index, count: count));
        return [for (var i = index; i < index + count; i++) _remote('asset-$i')];
      }

      return (load: load, reads: reads);
    }

    test('finds a target in the first chunk', () async {
      final timeline = fakeTimeline(1000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 1000,
        target: _remote('asset-7'),
        chunkSize: 250,
      );

      expect(result, 7);
      expect(timeline.reads, hasLength(1));
    });

    test('finds a target in a later chunk, accounting for preceding chunks', () async {
      final timeline = fakeTimeline(1000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 1000,
        target: _remote('asset-612'),
        chunkSize: 250,
      );

      expect(result, 612);
    });

    test('resolves an absolute index when the segment does not start at zero', () async {
      final timeline = fakeTimeline(2000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 900,
        assetCount: 300,
        target: _remote('asset-1100'),
        chunkSize: 250,
      );

      expect(result, 1100);
    });

    test('finds the last asset in the segment', () async {
      final timeline = fakeTimeline(1000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 500,
        target: _remote('asset-499'),
        chunkSize: 250,
      );

      expect(result, 499);
    });

    test('returns null for an absent target, requesting each chunk exactly once', () async {
      final timeline = fakeTimeline(1000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 500,
        target: _remote('not-in-this-timeline'),
        chunkSize: 250,
      );

      expect(result, isNull);
      expect(timeline.reads, [(index: 0, count: 250), (index: 250, count: 250)]);
    });

    test('resolves correctly when a chunk returns fewer assets than requested', () async {
      // The service is free to return a short page; the offset must come from the
      // requested window, not from a running count of what came back.
      Future<List<BaseAsset>> shortLoad(int index, int count) async {
        if (index == 0) return [_remote('asset-0')]; // asked for 4, got 1
        return [for (var i = index; i < index + count; i++) _remote('asset-$i')];
      }

      final result = await findAssetIndex(
        loadAssets: shortLoad,
        firstAssetIndex: 0,
        assetCount: 8,
        target: _remote('asset-5'),
        chunkSize: 4,
      );

      expect(result, 5);
    });

    test('returns null instead of throwing when a read fails', () async {
      Future<List<BaseAsset>> failing(int index, int count) async => throw StateError('db gone');

      await expectLater(
        findAssetIndex(
          loadAssets: failing,
          firstAssetIndex: 0,
          assetCount: 10,
          target: _remote('asset-1'),
        ),
        completion(isNull),
      );
    });

    test('short-circuits an empty segment without reading', () async {
      final timeline = fakeTimeline(10);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 0,
        target: _remote('asset-1'),
      );

      expect(result, isNull);
      expect(timeline.reads, isEmpty);
    });

    test('stops at the cap and gives up rather than scanning a huge segment', () async {
      final timeline = fakeTimeline(5000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 5000,
        target: _remote('asset-4000'),
        chunkSize: 250,
        cap: 2000,
      );

      expect(result, isNull);
      expect(timeline.reads.fold<int>(0, (sum, r) => sum + r.count), 2000);
    });

    test('still finds a target that sits just inside the cap', () async {
      final timeline = fakeTimeline(5000);

      final result = await findAssetIndex(
        loadAssets: timeline.load,
        firstAssetIndex: 0,
        assetCount: 5000,
        target: _remote('asset-1999'),
        chunkSize: 250,
        cap: 2000,
      );

      expect(result, 1999);
    });

    test('matches on remoteId even when localId differs', () async {
      // RemoteAsset.hashCode includes localId while == does not, so `==` would miss
      // this. The album-fetched copy has localId=null; the merged-timeline copy has it.
      Future<List<BaseAsset>> load(int index, int count) async => [_remote('asset-0', localId: 'local-abc')];

      final result = await findAssetIndex(
        loadAssets: load,
        firstAssetIndex: 0,
        assetCount: 1,
        target: _remote('asset-0'),
      );

      expect(result, 0);
    });

    test('matches on localId when neither side has a remote id', () async {
      Future<List<BaseAsset>> load(int index, int count) async => [_local('local-1')];

      final result = await findAssetIndex(
        loadAssets: load,
        firstAssetIndex: 0,
        assetCount: 1,
        target: _local('local-1'),
      );

      expect(result, 0);
    });

    test('falls back to checksum when neither id pair is comparable', () async {
      // A local-only asset (no remoteId) against a remote asset with no localId:
      // both id arms bail out, so checksum is the only thing left.
      Future<List<BaseAsset>> load(int index, int count) async => [_local('local-9', checksum: 'shared-checksum')];

      final result = await findAssetIndex(
        loadAssets: load,
        firstAssetIndex: 0,
        assetCount: 1,
        target: _remote('remote-9', checksum: 'shared-checksum'),
      );

      expect(result, 0);
    });

    test('does not match an asset that shares nothing', () async {
      Future<List<BaseAsset>> load(int index, int count) async => [_remote('asset-0')];

      final result = await findAssetIndex(
        loadAssets: load,
        firstAssetIndex: 0,
        assetCount: 1,
        target: _remote('asset-1'),
      );

      expect(result, isNull);
    });
  });
```

Add these fixtures at the bottom of the file:

```dart
RemoteAsset _remote(String id, {String? localId, String? checksum}) => RemoteAsset(
  id: id,
  localId: localId,
  name: '$id.jpg',
  ownerId: 'owner-1',
  checksum: checksum ?? 'checksum-$id',
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  isEdited: false,
);

LocalAsset _local(String id, {String? checksum}) => LocalAsset(
  id: id,
  name: '$id.jpg',
  checksum: checksum,
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  playbackStyle: AssetPlaybackStyle.image,
  isEdited: false,
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `flutter test test/presentation/widgets/timeline/asset_scan_test.dart`
Expected: FAIL to compile — `The function 'findAssetIndex' isn't defined`.

- [ ] **Step 3: Implement**

In `mobile/lib/presentation/widgets/timeline/asset_scan.dart`, add the import:

```dart
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
```

Append:

```dart
/// Loads `count` assets starting at absolute timeline index `index`.
/// Matches `TimelineService.loadAssets`, but injectable so the scan is testable
/// without a service or a database.
typedef AssetRangeLoader = Future<List<BaseAsset>> Function(int index, int count);

/// The absolute timeline index of [target] within a segment, or null when it is
/// absent, beyond [cap], or a read failed.
///
/// Returning null rather than throwing means a transient read error degrades to
/// the caller's fallback scroll instead of breaking the gesture.
Future<int?> findAssetIndex({
  required AssetRangeLoader loadAssets,
  required int firstAssetIndex,
  required int assetCount,
  required BaseAsset target,
  int chunkSize = kAssetScanChunkSize,
  int cap = kAssetScanCap,
}) async {
  final scannable = math.min(assetCount, cap);
  for (final chunk in assetScanChunks(
    firstAssetIndex: firstAssetIndex,
    assetCount: scannable,
    chunkSize: chunkSize,
  )) {
    final List<BaseAsset> assets;
    try {
      assets = await loadAssets(chunk.index, chunk.count);
    } catch (_) {
      return null;
    }
    for (var i = 0; i < assets.length; i++) {
      // Identity, not equality: RemoteAsset.hashCode includes localId while == does
      // not, so the same server asset can compare unequal across two load paths.
      if (assets[i].refersToSameAsset(target)) {
        // Offset from the REQUESTED window, so a short page cannot shift the result.
        return chunk.index + i;
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `flutter test test/presentation/widgets/timeline/asset_scan_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation/widgets/timeline/asset_scan.dart \
        mobile/test/presentation/widgets/timeline/asset_scan_test.dart
git commit -m "feat(mobile): resolve an asset's absolute timeline index by bounded scan"
```

---

### Task 5: Row geometry for a resolved asset

**Files:**

- Modify: `mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart`
- Test: `mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart`

**Interfaces:**

- Consumes: nothing.
- Produces: `double? assetRowOffset({required Segment segment, required int assetIndexInTimeline, required int columnCount})` — consumed by Task 9.

**Reference:** mirrors the arithmetic `_restoreAssetPosition` already uses at `timeline.widget.dart:268-277`. For the fixtures below, `gridOffset == startOffset + headerExtent + spacing` and `mainAxisExtend == tileHeight + spacing`, both defined on `Segment`/`FixedSegment`.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart`, inside `main()`:

```dart
  group('assetRowOffset', () {
    // startOffset 1000, headerExtent 40, spacing 2 -> gridOffset 1042
    // tileHeight 100, spacing 2 -> mainAxisExtend 102
    FixedSegment segment({int firstAssetIndex = 500, int assetCount = 30, int columnCount = 4}) => FixedSegment(
      firstIndex: 10,
      lastIndex: 20,
      startOffset: 1000,
      endOffset: 2000,
      firstAssetIndex: firstAssetIndex,
      bucket: TimeBucket(date: DateTime(2026, 4, 3), assetCount: assetCount),
      tileHeight: 100,
      columnCount: columnCount,
      headerExtent: 40,
      spacing: 2,
      header: HeaderType.day,
    );

    double? offset(FixedSegment s, int index, {int columnCount = 4}) =>
        assetRowOffset(segment: s, assetIndexInTimeline: index, columnCount: columnCount);

    test('the first asset of the segment sits on the first grid row', () {
      expect(offset(segment(), 500), 1042);
    });

    test('an asset within the first row still sits on the first grid row', () {
      expect(offset(segment(), 503), 1042);
    });

    test('the first asset of the second row advances by one row extent', () {
      expect(offset(segment(), 504), 1042 + 102);
    });

    test('the last asset resolves to its own row', () {
      // 30 assets, 4 per row -> asset 29 is on row 7 (0-indexed).
      expect(offset(segment(), 529), 1042 + (102 * 7));
    });

    test('a columnCount of 1 puts every asset on its own row', () {
      expect(offset(segment(columnCount: 1), 503, columnCount: 1), 1042 + (102 * 3));
    });

    test('a non-zero firstAssetIndex is subtracted before the row maths', () {
      // Same in-segment position as `offset(segment(), 504)` above, different base.
      expect(offset(segment(firstAssetIndex: 0), 4), 1042 + 102);
    });

    test('an index below firstAssetIndex returns null', () {
      expect(offset(segment(), 499), isNull);
    });

    test('an index at or past the end of the segment returns null', () {
      expect(offset(segment(), 530), isNull);
      expect(offset(segment(), 999), isNull);
    });

    test('an empty segment returns null for every index', () {
      expect(offset(segment(assetCount: 0), 500), isNull);
    });

    test('a zero or negative columnCount returns null instead of dividing by zero', () {
      expect(offset(segment(), 504, columnCount: 0), isNull);
      expect(offset(segment(), 504, columnCount: -4), isNull);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `flutter test test/presentation/widgets/timeline/timeline_scroll_target_test.dart`
Expected: FAIL to compile — `The function 'assetRowOffset' isn't defined`.

- [ ] **Step 3: Implement**

`mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart` **already imports** `segment.model.dart` (line 4). Do not add it again — `--fatal-infos` treats a duplicate import as a failure. No import changes are needed for this task.

Append:

```dart
/// The scroll offset of the row holding [assetIndexInTimeline] within [segment].
///
/// Mirrors the arithmetic `_SliverTimelineState._restoreAssetPosition` uses.
/// Returns null when [columnCount] is not positive, or when the index falls
/// outside the segment's assets — which also covers an empty segment, where every
/// index is out of range. Callers clamp the result to the scroll extent.
double? assetRowOffset({required Segment segment, required int assetIndexInTimeline, required int columnCount}) {
  if (columnCount <= 0) {
    return null;
  }
  final assetIndexInSegment = assetIndexInTimeline - segment.firstAssetIndex;
  if (assetIndexInSegment < 0 || assetIndexInSegment >= segment.bucket.assetCount) {
    return null;
  }
  final rowIndexInSegment = assetIndexInSegment ~/ columnCount;
  return segment.indexToLayoutOffset(segment.gridIndex + rowIndexInSegment);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `flutter test test/presentation/widgets/timeline/timeline_scroll_target_test.dart`
Expected: PASS (the pre-existing segment-lookup tests still pass).

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation/widgets/timeline/timeline_scroll_target.dart \
        mobile/test/presentation/widgets/timeline/timeline_scroll_target_test.dart
git commit -m "feat(mobile): compute the scroll offset of an asset's row in a segment"
```

---

### Task 6: The async-resolution guard decision

**Files:**

- Modify: `mobile/lib/presentation/widgets/timeline/scroll_drain.dart`
- Test: `mobile/test/presentation/widgets/timeline/scroll_drain_test.dart`

**Interfaces:**

- Consumes: nothing.
- Produces: `enum ScrollResolveOutcome { proceed, abandonStale, abandonUnmounted }` and
  `ScrollResolveOutcome decideScrollResolve({required bool stillMounted, required bool stillHasClients, required bool targetUnchanged})` — consumed by Task 9.

**Why this exists:** Task 9 introduces an `await` between deciding to scroll and actually scrolling. That opens three holes — the widget may unmount, the scroll controller may lose its clients, and a newer request may replace the target. This function is the decision table for all three, kept pure so it is testable without a device.

- [ ] **Step 1: Write the failing tests**

Add this `group` to `mobile/test/presentation/widgets/timeline/scroll_drain_test.dart`, inside `main()`:

```dart
  group('decideScrollResolve', () {
    ScrollResolveOutcome decide({
      bool stillMounted = true,
      bool stillHasClients = true,
      bool targetUnchanged = true,
    }) => decideScrollResolve(
      stillMounted: stillMounted,
      stillHasClients: stillHasClients,
      targetUnchanged: targetUnchanged,
    );

    test('proceeds when nothing changed during the await', () {
      expect(decide(), ScrollResolveOutcome.proceed);
    });

    test('abandons when the widget unmounted during the await', () {
      expect(decide(stillMounted: false), ScrollResolveOutcome.abandonUnmounted);
    });

    test('abandons when the scroll controller lost its clients during the await', () {
      expect(decide(stillHasClients: false), ScrollResolveOutcome.abandonUnmounted);
    });

    test('abandons a stale resolution when a newer request replaced the target', () {
      expect(decide(targetUnchanged: false), ScrollResolveOutcome.abandonStale);
    });

    test('unmounting dominates staleness so nothing touches a dead controller', () {
      expect(decide(stillMounted: false, targetUnchanged: false), ScrollResolveOutcome.abandonUnmounted);
      expect(decide(stillHasClients: false, targetUnchanged: false), ScrollResolveOutcome.abandonUnmounted);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `flutter test test/presentation/widgets/timeline/scroll_drain_test.dart`
Expected: FAIL to compile — `Undefined name 'ScrollResolveOutcome'`.

- [ ] **Step 3: Implement**

Append to `mobile/lib/presentation/widgets/timeline/scroll_drain.dart`:

```dart
/// What to do with an in-flight scroll resolution once its async index lookup
/// has completed.
enum ScrollResolveOutcome {
  /// Everything is still valid — scroll.
  proceed,

  /// A newer "view in timeline" request replaced the target mid-flight. Drop this
  /// resolution and let the drain loop pick up the newer one.
  abandonStale,

  /// The timeline went away mid-flight. Touching the scroll controller now would
  /// throw, so do nothing.
  abandonUnmounted,
}

/// Decides whether a resolved scroll target is still safe to act on.
///
/// Unmounting dominates staleness: a dead controller must not be touched even
/// when the target also changed.
ScrollResolveOutcome decideScrollResolve({
  required bool stillMounted,
  required bool stillHasClients,
  required bool targetUnchanged,
}) {
  if (!stillMounted || !stillHasClients) return ScrollResolveOutcome.abandonUnmounted;
  if (!targetUnchanged) return ScrollResolveOutcome.abandonStale;
  return ScrollResolveOutcome.proceed;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `flutter test test/presentation/widgets/timeline/scroll_drain_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation/widgets/timeline/scroll_drain.dart \
        mobile/test/presentation/widgets/timeline/scroll_drain_test.dart
git commit -m "feat(mobile): add the async scroll-resolution guard decision"
```

---

### Task 7: Latch the on-screen asset instead of the date

**Files:**

- Create: `mobile/lib/providers/asset_viewer/scroll_to_asset_notifier.provider.dart`
- Delete: `mobile/lib/providers/asset_viewer/scroll_to_date_notifier.provider.dart`
- Modify: `mobile/lib/presentation/widgets/memory/memory_bottom_info.widget.dart` (take an `asset`, drop `memory.assets.first`)
- Modify: `mobile/lib/presentation/pages/drift_memory.page.dart:363` (pass the asset actually on screen)
- Modify: `mobile/lib/utils/action_button.utils.dart:285`
- Modify: `mobile/lib/pages/backup/drift_backup_asset_detail.page.dart:91`
- Modify: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`
- Create: `mobile/test/providers/asset_viewer/scroll_to_asset_notifier_test.dart`
- Create: `mobile/test/presentation/widgets/memory/memory_bottom_info_test.dart`
- Delete: `mobile/test/providers/asset_viewer/scroll_to_date_notifier_test.dart`

**Interfaces:**

- Consumes: nothing.
- Produces: `class TimelineScrollTarget { final BaseAsset asset; final DateTime date; }`, `class ScrollToAssetNotifier extends ValueNotifier<TimelineScrollTarget?>` with `void scrollToAsset(BaseAsset asset)` and `TimelineScrollTarget? consume()`, the top-level `scrollToAssetNotifierProvider`, and `RemoteAsset memoryAssetForPage(DriftMemory memory, int page)` — consumed by Task 9.

**Behaviour preserved:** this task keeps the timeline scrolling to `target.date` exactly as before. Task 9 changes where it lands.

**The bug this also fixes.** `DriftMemoryBottomInfo` currently reads `memory.assets.first` for both the date label and the jump target, while `drift_memory.page.dart` pages _through_ a memory's assets — it tracks `currentAssetPage` (line 51) and `currentAsset` (line 55) but passes neither to the bottom info (line 363). So the arrow targets the memory's **first** photo no matter which one is on screen. Without this, Tasks 1-9 would navigate precisely to the wrong asset whenever the user has paged forward. The date label follows the same asset, since both describe the photo the user is looking at.

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/providers/asset_viewer/scroll_to_asset_notifier_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_asset_notifier.provider.dart';

void main() {
  group('ScrollToAssetNotifier', () {
    test('starts with no pending target', () {
      final notifier = ScrollToAssetNotifier(null);

      expect(notifier.value, isNull);
      expect(notifier.consume(), isNull);
    });

    test('latches the requested asset until a consumer is ready for it', () {
      // The race a broadcast event loses: the request is made (from a memory or a
      // notification) BEFORE the timeline is mounted and subscribed. The latch keeps
      // it so the timeline can drain it once it is ready.
      final notifier = ScrollToAssetNotifier(null);
      final asset = _asset('a1');

      notifier.scrollToAsset(asset);

      expect(notifier.value?.asset, same(asset));
    });

    test('latches the creation time in the viewer local zone, not UTC', () {
      // Regression guard for #28941: the timeline buckets by local date, so a UTC
      // instant must be converted before it is used to match a segment.
      final notifier = ScrollToAssetNotifier(null);
      final utc = DateTime.utc(2026, 4, 3, 23, 30);

      notifier.scrollToAsset(_asset('a1', createdAt: utc));

      expect(notifier.value?.date, utc.toLocal());
      expect(notifier.value?.date.isUtc, isFalse);
    });

    test('applies the pending target at most once', () {
      final notifier = ScrollToAssetNotifier(null);
      notifier.scrollToAsset(_asset('a1'));

      expect(notifier.consume(), isNotNull);
      // A rebuild / second drain must not re-trigger the scroll.
      expect(notifier.consume(), isNull);
    });

    test('notifies listeners on every request, even for the same asset', () {
      // Tapping "view in timeline" twice for the same photo must re-trigger the
      // scroll, so requesting an unchanged target still has to notify.
      final notifier = ScrollToAssetNotifier(null);
      var notifications = 0;
      notifier.addListener(() => notifications++);

      final asset = _asset('a1');
      notifier.scrollToAsset(asset);
      notifier.scrollToAsset(asset);

      expect(notifications, greaterThanOrEqualTo(2));
    });

    test('replaces the target and notifies when a different asset is requested', () {
      final notifier = ScrollToAssetNotifier(null);
      var notifications = 0;
      notifier.addListener(() => notifications++);

      notifier.scrollToAsset(_asset('a1'));
      notifier.scrollToAsset(_asset('a2'));

      expect(notifications, greaterThanOrEqualTo(2));
      expect((notifier.value?.asset as RemoteAsset).id, 'a2');
    });

    test('treats two copies of the same asset as the same target', () {
      // The merged-timeline copy carries localId; the album-fetched copy does not.
      // They must not count as a new request.
      final notifier = ScrollToAssetNotifier(null);
      final createdAt = DateTime(2026, 4, 3, 12);

      notifier.scrollToAsset(_asset('a1', createdAt: createdAt));
      final first = notifier.value;
      notifier.scrollToAsset(_asset('a1', createdAt: createdAt, localId: 'local-1'));

      expect(notifier.value, first);
    });
  });
}

RemoteAsset _asset(String id, {DateTime? createdAt, String? localId}) => RemoteAsset(
  id: id,
  localId: localId,
  name: '$id.jpg',
  ownerId: 'owner-1',
  checksum: 'checksum-$id',
  type: AssetType.image,
  createdAt: createdAt ?? DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  isEdited: false,
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `flutter test test/providers/asset_viewer/scroll_to_asset_notifier_test.dart`
Expected: FAIL to compile — `Target of URI doesn't exist: '.../scroll_to_asset_notifier.provider.dart'`.

- [ ] **Step 3: Create the new notifier**

Create `mobile/lib/providers/asset_viewer/scroll_to_asset_notifier.provider.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';

/// A pending "view in timeline" request: which asset, and the local date the
/// timeline buckets it under.
@immutable
class TimelineScrollTarget {
  final BaseAsset asset;

  /// The asset's creation time in the viewer's local zone. The timeline buckets by
  /// local date, so a UTC instant would match the wrong segment (#28941).
  final DateTime date;

  const TimelineScrollTarget({required this.asset, required this.date});

  @override
  bool operator ==(Object other) =>
      other is TimelineScrollTarget && date == other.date && asset.refersToSameAsset(other.asset);

  // Only `date` participates: `==` compares assets by identity rather than by
  // field equality (two copies of one asset can differ in localId), and equal
  // targets always share a date. Hashing on date alone keeps the contract intact.
  @override
  int get hashCode => date.hashCode;
}

final scrollToAssetNotifierProvider = ScrollToAssetNotifier(null);

/// Holds a pending request to scroll the timeline to a given asset.
///
/// Unlike a fire-and-forget broadcast event, the request is latched here until a
/// timeline is ready to act on it. This survives the window between requesting the
/// scroll (tapping "view in timeline" from a memory or a notification) and the
/// timeline mounting and loading its segments. The timeline drains the request
/// with [consume] once it can scroll.
class ScrollToAssetNotifier extends ValueNotifier<TimelineScrollTarget?> {
  ScrollToAssetNotifier(super.value);

  /// Requests a scroll to [asset]. Always notifies listeners, even when the same
  /// asset is requested twice in a row, so repeated taps re-trigger the scroll.
  void scrollToAsset(BaseAsset asset) {
    final target = TimelineScrollTarget(asset: asset, date: asset.createdAt.toLocal());
    if (value == target) {
      notifyListeners();
    } else {
      value = target;
    }
  }

  /// Returns the pending target (or null) and clears the latch so the request is
  /// applied at most once.
  TimelineScrollTarget? consume() {
    final pending = value;
    value = null;
    return pending;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `flutter test test/providers/asset_viewer/scroll_to_asset_notifier_test.dart`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the on-screen asset selector**

Create `mobile/test/presentation/widgets/memory/memory_bottom_info_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/presentation/widgets/memory/memory_bottom_info.widget.dart';

void main() {
  group('memoryAssetForPage', () {
    final assets = [_asset('a0'), _asset('a1'), _asset('a2')];
    final memory = DriftMemory(id: 'm1', createdAt: DateTime(2026, 4, 3), assets: assets);

    test('returns the asset on the requested page', () {
      // The whole point of #822: the arrow must target the photo on screen, not
      // whichever one happens to be first in the memory.
      expect(memoryAssetForPage(memory, 1).id, 'a1');
      expect(memoryAssetForPage(memory, 2).id, 'a2');
    });

    test('returns the first asset for page zero', () {
      expect(memoryAssetForPage(memory, 0).id, 'a0');
    });

    test('clamps a page past the end to the last asset', () {
      // currentAssetPage belongs to the ACTIVE memory; an inactive page in the
      // vertical PageView can ask with an index this memory does not have.
      expect(memoryAssetForPage(memory, 99).id, 'a2');
    });

    test('clamps a negative page to the first asset', () {
      expect(memoryAssetForPage(memory, -1).id, 'a0');
    });
  });
}

RemoteAsset _asset(String id) => RemoteAsset(
  id: id,
  name: '$id.jpg',
  ownerId: 'owner-1',
  checksum: 'checksum-$id',
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  isEdited: false,
);
```

**Before writing the test, confirm the `DriftMemory` constructor** in `mobile/lib/domain/models/memory.model.dart` — adjust the named arguments above to match its actual required fields. Do not guess: read the class first.

- [ ] **Step 6: Run the test to verify it fails**

Run: `flutter test test/presentation/widgets/memory/memory_bottom_info_test.dart`
Expected: FAIL to compile — `The function 'memoryAssetForPage' isn't defined`.

- [ ] **Step 7: Migrate the memory bottom info to the on-screen asset**

In `mobile/lib/presentation/widgets/memory/memory_bottom_info.widget.dart`: swap the provider import, add a top-level selector, and take the asset as a parameter instead of digging it out of the memory.

```dart
/// The asset shown on [page] of [memory], clamped to the memory's bounds.
///
/// `currentAssetPage` in the memory page belongs to the ACTIVE memory, so an
/// inactive page in the vertical PageView can ask for an index this memory does
/// not have.
RemoteAsset memoryAssetForPage(DriftMemory memory, int page) =>
    memory.assets[page.clamp(0, memory.assets.length - 1)];
```

Change the widget to accept the asset, replacing the `memory` field:

```dart
class DriftMemoryBottomInfo extends StatelessWidget {
  final RemoteAsset asset;
  final String title;
  const DriftMemoryBottomInfo({super.key, required this.asset, required this.title});
```

Replace the `fileCreatedDate` line so the label describes the photo on screen:

```dart
    final fileCreatedDate = asset.createdAt;
```

Replace the `onPressed` body's final line:

```dart
                // #28941: the notifier converts to the viewer's local time itself.
                scrollToAssetNotifierProvider.scrollToAsset(asset);
```

- [ ] **Step 8: Pass the on-screen asset from the memory page**

In `mobile/lib/presentation/pages/drift_memory.page.dart`, replace line 363:

```dart
                  DriftMemoryBottomInfo(
                    // currentAssetPage tracks the ACTIVE memory only; other pages in
                    // the vertical PageView show their own first asset.
                    asset: memoryAssetForPage(
                      memories[mIndex],
                      mIndex == currentMemoryIndex.value ? currentAssetPage.value : 0,
                    ),
                    title: title,
                  ),
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `flutter test test/presentation/widgets/memory/memory_bottom_info_test.dart`
Expected: PASS.

- [ ] **Step 10: Migrate the remaining two call sites**

`mobile/lib/utils/action_button.utils.dart` — swap the provider import, and replace line 285:

```dart
                scrollToAssetNotifierProvider.scrollToAsset(context.asset);
```

`mobile/lib/pages/backup/drift_backup_asset_detail.page.dart` — same import swap, and replace line 91:

```dart
                      scrollToAssetNotifierProvider.scrollToAsset(asset);
```

- [ ] **Step 11: Migrate the timeline widget (behaviour unchanged)**

In `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`, swap the import, then replace every `scrollToDateNotifierProvider` reference with `scrollToAssetNotifierProvider` (lines 217, 349, 373, 391, 410, 414, plus the `_onGroupingChanged` guard added in Task 2).

In `_attemptScrollDrain`, take the date off the target:

```dart
    final target = scrollToAssetNotifierProvider.value;
    final date = target?.date;
```

The rest of the method is unchanged — `_scrollToDate(date!, segments!)` still runs, so the landing position does not change yet.

- [ ] **Step 12: Delete the old files**

```bash
git rm mobile/lib/providers/asset_viewer/scroll_to_date_notifier.provider.dart \
       mobile/test/providers/asset_viewer/scroll_to_date_notifier_test.dart
```

- [ ] **Step 13: Verify the whole suite is green**

Run: `dart analyze --fatal-infos lib test && flutter test`
Expected: no analyzer output (in particular, no lingering references to the deleted provider or to `DriftMemoryBottomInfo(memory: ...)`), all tests pass.

- [ ] **Step 14: Commit**

```bash
git add -A mobile/lib mobile/test
git commit -m "refactor(mobile): latch the asset rather than the date for view-in-timeline"
```

---

### Task 8: Highlight the target tile on arrival

**Files:**

- Create: `mobile/lib/providers/timeline/highlighted_asset.provider.dart`
- Modify: `mobile/lib/presentation/widgets/timeline/fixed/segment.model.dart` (`_AssetTileWidget.build`, around line 253)
- Create: `mobile/test/providers/timeline/highlighted_asset_test.dart`

**Interfaces:**

- Consumes: nothing.
- Produces: `bool isHighlightedAsset(BaseAsset? highlighted, BaseAsset candidate)`, `class TimelineHighlightedAssetNotifier extends Notifier<BaseAsset?>` with `void highlight(BaseAsset asset, {Duration duration})` and `void clear()`, `const Duration kTimelineHighlightDuration`, and `timelineHighlightedAssetProvider` — consumed by Task 9.

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/providers/timeline/highlighted_asset_test.dart`:

```dart
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/providers/timeline/highlighted_asset.provider.dart';

void main() {
  group('isHighlightedAsset', () {
    test('nothing highlighted matches nothing', () {
      expect(isHighlightedAsset(null, _remote('a1')), isFalse);
    });

    test('the same asset matches', () {
      expect(isHighlightedAsset(_remote('a1'), _remote('a1')), isTrue);
    });

    test('the same remoteId with a different localId matches', () {
      // The grid's copy may carry localId while the memory's copy does not.
      expect(isHighlightedAsset(_remote('a1'), _remote('a1', localId: 'local-1')), isTrue);
    });

    test('a checksum-only asset matches its counterpart', () {
      expect(isHighlightedAsset(_local('l1', checksum: 'shared'), _remote('a1', checksum: 'shared')), isTrue);
    });

    test('a different asset does not match', () {
      expect(isHighlightedAsset(_remote('a1'), _remote('a2')), isFalse);
    });
  });

  group('TimelineHighlightedAssetNotifier', () {
    test('highlighting sets the asset', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      container.read(timelineHighlightedAssetProvider.notifier).highlight(_remote('a1'));

      expect(container.read(timelineHighlightedAssetProvider), isNotNull);
    });

    test('the highlight clears itself after the duration', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        addTearDown(container.dispose);

        container
            .read(timelineHighlightedAssetProvider.notifier)
            .highlight(_remote('a1'), duration: const Duration(milliseconds: 1500));

        async.elapse(const Duration(milliseconds: 1499));
        expect(container.read(timelineHighlightedAssetProvider), isNotNull);

        async.elapse(const Duration(milliseconds: 2));
        expect(container.read(timelineHighlightedAssetProvider), isNull);
      });
    });

    test('highlighting a second asset cancels the first timer', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        addTearDown(container.dispose);
        final notifier = container.read(timelineHighlightedAssetProvider.notifier);

        notifier.highlight(_remote('a1'), duration: const Duration(milliseconds: 1000));
        async.elapse(const Duration(milliseconds: 900));
        notifier.highlight(_remote('a2'), duration: const Duration(milliseconds: 1000));

        // The first timer would have fired at 1000ms; the second highlight must survive it.
        async.elapse(const Duration(milliseconds: 200));
        expect((container.read(timelineHighlightedAssetProvider) as RemoteAsset?)?.id, 'a2');

        async.elapse(const Duration(milliseconds: 900));
        expect(container.read(timelineHighlightedAssetProvider), isNull);
      });
    });

    test('clear cancels a pending timer so the asset cannot reappear', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        addTearDown(container.dispose);
        final notifier = container.read(timelineHighlightedAssetProvider.notifier);

        notifier.highlight(_remote('a1'), duration: const Duration(milliseconds: 1000));
        notifier.clear();

        expect(container.read(timelineHighlightedAssetProvider), isNull);
        async.elapse(const Duration(milliseconds: 2000));
        expect(container.read(timelineHighlightedAssetProvider), isNull);
      });
    });

    test('clear is idempotent', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      final notifier = container.read(timelineHighlightedAssetProvider.notifier);

      notifier.clear();
      notifier.clear();

      expect(container.read(timelineHighlightedAssetProvider), isNull);
    });

    test('disposal cancels a pending timer', () {
      fakeAsync((async) {
        final container = ProviderContainer();
        container.read(timelineHighlightedAssetProvider.notifier).highlight(_remote('a1'));

        container.dispose();

        // Would throw "Cannot use a Notifier after it has been disposed" if the
        // timer were still live when it fired.
        async.elapse(const Duration(seconds: 5));
      });
    });
  });
}

RemoteAsset _remote(String id, {String? localId, String? checksum}) => RemoteAsset(
  id: id,
  localId: localId,
  name: '$id.jpg',
  ownerId: 'owner-1',
  checksum: checksum ?? 'checksum-$id',
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  isEdited: false,
);

LocalAsset _local(String id, {String? checksum}) => LocalAsset(
  id: id,
  name: '$id.jpg',
  checksum: checksum,
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  playbackStyle: AssetPlaybackStyle.image,
  isEdited: false,
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `flutter test test/providers/timeline/highlighted_asset_test.dart`
Expected: FAIL to compile — `Target of URI doesn't exist: '.../highlighted_asset.provider.dart'`.

- [ ] **Step 3: Implement the provider**

Create `mobile/lib/providers/timeline/highlighted_asset.provider.dart`:

```dart
import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';

/// How long the arrival highlight stays on the tile after a "view in timeline" jump.
const Duration kTimelineHighlightDuration = Duration(milliseconds: 1500);

/// Whether [candidate] is the currently highlighted asset.
///
/// Uses `refersToSameAsset` rather than `==`: the grid's copy of an asset and the
/// copy that requested the jump can differ in `localId`, which `RemoteAsset`
/// includes in `hashCode` but not in `==`.
bool isHighlightedAsset(BaseAsset? highlighted, BaseAsset candidate) =>
    highlighted != null && highlighted.refersToSameAsset(candidate);

/// The asset to briefly outline after the timeline jumps to it, or null.
class TimelineHighlightedAssetNotifier extends Notifier<BaseAsset?> {
  Timer? _timer;

  @override
  BaseAsset? build() {
    ref.onDispose(() {
      _timer?.cancel();
      _timer = null;
    });
    return null;
  }

  void highlight(BaseAsset asset, {Duration duration = kTimelineHighlightDuration}) {
    _timer?.cancel();
    state = asset;
    _timer = Timer(duration, () {
      _timer = null;
      state = null;
    });
  }

  void clear() {
    _timer?.cancel();
    _timer = null;
    state = null;
  }
}

final timelineHighlightedAssetProvider = NotifierProvider<TimelineHighlightedAssetNotifier, BaseAsset?>(
  TimelineHighlightedAssetNotifier.new,
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `flutter test test/providers/timeline/highlighted_asset_test.dart`
Expected: PASS.

- [ ] **Step 5: Render the highlight on the tile**

In `mobile/lib/presentation/widgets/timeline/fixed/segment.model.dart`, add the import:

```dart
import 'package:immich_mobile/providers/timeline/highlighted_asset.provider.dart';
```

In `_AssetTileWidget.build`, add the narrow subscription alongside the existing `ref.watch` calls:

```dart
    // `select` so only the matching tile's selector flips when the highlight moves.
    final isHighlighted = ref.watch(timelineHighlightedAssetProvider.select((a) => isHighlightedAsset(a, asset)));
```

Replace the `child: ThumbnailTile(...)` of the `GestureDetector` with a stack that overlays the outline. An overlay is used rather than a border on the tile itself so the highlight never changes the tile's layout:

```dart
        child: Stack(
          fit: StackFit.passthrough,
          children: [
            ThumbnailTile(
              asset,
              lockSelection: lockSelection,
              showStorageIndicator: showStorageIndicator,
              showStackIndicator: showStackIndicator,
              heroOffset: heroOffset,
            ),
            Positioned.fill(
              child: IgnorePointer(
                child: AnimatedOpacity(
                  opacity: isHighlighted ? 1.0 : 0.0,
                  duration: const Duration(milliseconds: 200),
                  child: DecoratedBox(
                    decoration: BoxDecoration(border: Border.all(color: context.colorScheme.primary, width: 3)),
                  ),
                ),
              ),
            ),
          ],
        ),
```

- [ ] **Step 6: Verify**

Run: `dart analyze --fatal-infos lib test && flutter test`
Expected: no analyzer output, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/providers/timeline/highlighted_asset.provider.dart \
        mobile/lib/presentation/widgets/timeline/fixed/segment.model.dart \
        mobile/test/providers/timeline/highlighted_asset_test.dart
git commit -m "feat(mobile): briefly highlight the tile a timeline jump lands on"
```

---

### Task 9: Scroll to the asset's row instead of the segment top

**Files:**

- Modify: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart` (replace `_scrollToDate` with `_beginScrollToAsset`, add `_resolvingScrollTarget`, guard `_attemptScrollDrain`)

**Interfaces:**

- Consumes: `findAssetIndex` + `AssetRangeLoader` (Task 4), `assetRowOffset` (Task 5), `decideScrollResolve` + `ScrollResolveOutcome` (Task 6), `TimelineScrollTarget` + `scrollToAssetNotifierProvider` (Task 7), `timelineHighlightedAssetProvider` (Task 8).
- Produces: nothing consumed by later tasks.

**This task contains no new decision logic** — every branch it takes was proven in Tasks 1-8. If it grows a branch not covered there, that branch belongs in a helper instead.

- [ ] **Step 1: Add the imports and the re-entrancy field**

In `mobile/lib/presentation/widgets/timeline/timeline.widget.dart` add:

```dart
import 'package:immich_mobile/presentation/widgets/timeline/asset_scan.dart';
import 'package:immich_mobile/providers/timeline/highlighted_asset.provider.dart';
```

(`timeline_scroll_target.dart`, `scroll_drain.dart`, `providers/infrastructure/timeline.provider.dart` and `providers/timeline/timeline_grouping.provider.dart` are already imported.)

Add the field next to `_daySwitchRequested`:

```dart
  /// Non-null while an async index resolution is in flight. Blocks the drain loop
  /// from starting a second concurrent scan.
  TimelineScrollTarget? _resolvingScrollTarget;
```

- [ ] **Step 2: Guard the drain loop against re-entry**

At the top of `_attemptScrollDrain`, immediately after the `if (!mounted)` block:

```dart
    // A resolution is already in flight; it will restart the loop when it settles.
    if (_resolvingScrollTarget != null) {
      return;
    }
```

- [ ] **Step 3: Hand the scroll branch to the async resolver**

Replace the `ScrollDrainAction.scroll` case. Note it no longer consumes or clears `_scrollDrainScheduled` — `_beginScrollToAsset` owns both, after the await:

```dart
      case ScrollDrainAction.scroll:
        unawaited(_beginScrollToAsset(target!, segments!));
```

- [ ] **Step 4: Replace `_scrollToDate` with `_beginScrollToAsset`**

Delete the existing `_scrollToDate` method and add:

```dart
  /// Resolves [target] to its exact row and scrolls there, falling back to the top
  /// of the matched segment when the asset cannot be located.
  ///
  /// Owns the tail of the drain cycle: it consumes the request and releases
  /// `_scrollDrainScheduled` only after the async resolution settles, so a failed
  /// lookup cannot silently drop the request.
  Future<void> _beginScrollToAsset(TimelineScrollTarget target, List<Segment> segments) async {
    final segment = _findSegmentForDate(segments, target.date);
    if (segment == null) {
      // Defensive: decideScrollDrain only returns `scroll` when a segment matched,
      // so this is unreachable today. Release the cycle and re-open it rather than
      // returning bare, which would strand the still-latched request forever.
      _scrollDrainScheduled = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _requestScrollDrain();
      });
      return;
    }

    _resolvingScrollTarget = target;
    // Drop any highlight still showing from a previous jump.
    ref.read(timelineHighlightedAssetProvider.notifier).clear();

    final columnCount = ref.read(timelineArgsProvider).columnCount;
    final assetIndex = await findAssetIndex(
      loadAssets: ref.read(timelineServiceProvider).loadAssets,
      firstAssetIndex: segment.firstAssetIndex,
      assetCount: segment.bucket.assetCount,
      target: target.asset,
    );

    // `==` on TimelineScrollTarget compares date + refersToSameAsset, so re-tapping
    // the SAME photo mid-resolution reads as unchanged and is absorbed. That is
    // intended: the destination is identical, and restarting would only re-scan.
    final outcome = decideScrollResolve(
      stillMounted: mounted,
      stillHasClients: _scrollController.hasClients,
      targetUnchanged: scrollToAssetNotifierProvider.value == target,
    );
    _resolvingScrollTarget = null;

    switch (outcome) {
      case ScrollResolveOutcome.abandonUnmounted:
        _scrollDrainScheduled = false;
        return;
      case ScrollResolveOutcome.abandonStale:
        // A newer request is latched. Release the cycle and let its listener run.
        _scrollDrainScheduled = false;
        _daySwitchRequested = false;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _requestScrollDrain();
        });
        return;
      case ScrollResolveOutcome.proceed:
        break;
    }

    final rowOffset = assetIndex == null
        ? null
        : assetRowOffset(segment: segment, assetIndexInTimeline: assetIndex, columnCount: columnCount);

    // Fallback: the asset is not in this segment (most likely a stack child — the
    // timeline collapses stacks to the primary, memories do not) or the geometry
    // could not be computed. Landing on the correct day beats not moving at all.
    final desiredOffset = rowOffset ?? (segment.startOffset - 50);
    final targetOffset = desiredOffset.clamp(0.0, _scrollController.position.maxScrollExtent);

    scrollToAssetNotifierProvider.consume();
    _scrollDrainScheduled = false;
    _daySwitchRequested = false;

    final timelineState = ref.read(timelineStateProvider.notifier);
    timelineState.setScrubbing(true);
    try {
      await _scrollController.animateTo(
        targetOffset,
        duration: const Duration(milliseconds: 500),
        curve: Curves.easeInOut,
      );
    } finally {
      // `finally`, not a plain trailing call: an interrupted animation (the user
      // scrolls, or the controller is detached) completes the future with an error.
      // Leaving `isScrubbing` true would strand the whole timeline rendering
      // placeholder tiles. The `mounted` guard is required because `ref.read` throws
      // once the widget is disposed.
      if (mounted) {
        timelineState.setScrubbing(false);
      }
    }

    // Only mark a tile we actually landed on — not the day-level fallback.
    if (mounted && rowOffset != null) {
      ref.read(timelineHighlightedAssetProvider.notifier).highlight(target.asset);
    }
  }
```

- [ ] **Step 5: Cancel an in-flight resolution on dispose**

In `dispose()`, add before `_scrollController.dispose()`:

```dart
    _resolvingScrollTarget = null;
```

- [ ] **Step 6: Verify the whole suite is green**

Run: `dart analyze --fatal-infos lib test && flutter test`
Expected: no analyzer output, all tests pass. In particular there must be no remaining reference to `_scrollToDate`.

- [ ] **Step 7: Format**

Run: `dart format` on the files you changed in this task
Expected: reformats nothing of substance; commit any whitespace changes it makes.

- [ ] **Step 8: Commit**

```bash
git add mobile/lib/presentation/widgets/timeline/timeline.widget.dart
git commit -m "fix(mobile): land view-in-timeline on the exact photo, not the bucket (#822)"
```

---

## Manual verification

Unit tests cover every decision; these cross the widget/animation boundary and must be checked on a device or simulator (see the `mobile-emulator` skill for an iOS simulator loop):

- [ ] **Page forward within a memory, then tap the arrow → lands on the photo on screen, not the memory's first photo.** The date label above the arrow must also track the photo being viewed.
- [ ] Year grouping → open a memory → tap the arrow → grouping becomes Day, the timeline lands on the photo, its tile flashes.
- [ ] Month grouping → same.
- [ ] Day grouping on a day with 500+ photos → lands on the photo's row, not the day header.
- [ ] **No placeholder flicker** on a large day — watch the visible rows during the scan.
- [ ] Tapping the arrow twice for the same memory asset re-scrolls the second time.
- [ ] A memory whose asset is a stack child → lands on the correct day, no crash, no hang, no highlight.
- [ ] Backing out of the memory immediately after tapping the arrow → no crash (unmount-mid-await path).
- [ ] Two memories in quick succession → lands on the second photo, and only the second tile is highlighted.
- [ ] The `view in timeline` action in the asset viewer and in the backup detail page still work.
- [ ] A route-scoped timeline (album or space) → the asset-viewer `view in timeline` action still lands correctly and does not thrash the grouping.

## Out of scope

- Resolving a stack child to its stack primary (web does this via `stackPrimaryAssetId`; mobile falls back to the day).
- Any change to web, server, or the API.
- New i18n strings — the existing `view_in_timeline` key is reused.
