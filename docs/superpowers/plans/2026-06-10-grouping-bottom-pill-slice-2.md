# Grouping Bottom Pill — Slice 2 Implementation Plan (`Timeline.withGroupingPill`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the opt-in `withGroupingPill` flag to the shared `Timeline` widget: overlay the Slice-1 `TimelineGroupingBottomPill` and add constant bottom clearance through the existing `contentBottomPadding` seam (which also lifts the scrubber's track). Default off — zero change for existing callers.

**Architecture:** Two surgical edits in `timeline.widget.dart`: (1) `Timeline` gains the flag and wraps `_SliverTimeline` in a `Stack` with the pill; (2) `_SliverTimeline` receives the flag and adds `pillHeight + bottomFloat` to `contentBottomPadding` (the trailing `SliverPadding` AND `scrubberBottomPadding` both derive from it — one seam, both effects).

**Spec:** `docs/superpowers/specs/2026-06-10-timeline-grouping-bottom-pill-design.md` (Mechanism + Slice 2). Depends on Slice 1 (`TimelineGroupingBottomPill` with public `pillHeight`/`bottomFloat`), already landed (`8cfcabd1b5`).

---

### Task 1: Failing tests (compile-RED)

**Files:**

- Create: `mobile/test/presentation/widgets/timeline/timeline_with_grouping_pill_test.dart`

Harness: model on `mobile/test/presentation/pages/dev/main_timeline_zoom_test.dart` — it shows the working pattern for pumping a real `Timeline` (Store init incl. `StoreKey.tilesPerRow`, `EasyLocalization.ensureInitialized`, a fake `TimelineService` built as `TimelineService((assetSource: ..., bucketSource: () => Stream.value([TimeBucket(...)]), origin: TimelineOrigin.main))`, `timelineServiceProvider.overrideWithValue`). Pump `Timeline` with `appBar: null` (the default `ImmichSliverAppBar` watches sync/cast/user providers — avoid them). Keep `withScrubber` at its default.

- [ ] **Step 1: Write the test file** with these 4 tests (exact assertions; adapt only harness mechanics):

```dart
// Pseudostructure — fill in the zoom-test harness (Store/EasyLocalization setUpAll, _service helper).

testWidgets('withGroupingPill renders the pill overlay', (tester) async {
  await pumpTimeline(tester, withGroupingPill: true);
  expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
});

testWidgets('withGroupingPill adds pill clearance to the content bottom padding', (tester) async {
  await pumpTimeline(tester, withGroupingPill: true);
  // pillHeight(58) + bottomFloat(26) = 84; test env has no safe-area inset and no multiselect.
  expect(
    find.byWidgetPredicate(
      (w) => w is SliverPadding && w.padding == const EdgeInsets.only(bottom: 84),
    ),
    findsOneWidget,
  );
});

testWidgets('default (false) renders no pill and no clearance — existing callers unchanged', (tester) async {
  await pumpTimeline(tester, withGroupingPill: false);
  expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsNothing);
  expect(
    find.byWidgetPredicate(
      (w) => w is SliverPadding && w.padding == const EdgeInsets.only(bottom: 0),
    ),
    findsOneWidget,
  );
});

testWidgets('multiselect with the flag on: pill hides, clearance stays constant (+120 modifier)', (tester) async {
  await pumpTimeline(tester, withGroupingPill: true); // then enable multiselect via multiSelectProvider notifier
  // enable multiselect (select an asset via the container's multiSelectProvider notifier), pumpAndSettle
  expect(
    tester.widget<AnimatedOpacity>(find.byKey(const Key('timeline-grouping-bottom-pill-opacity'))).opacity,
    0,
  );
  // 84 clearance + 120 bottomSheetOpenModifier
  expect(
    find.byWidgetPredicate(
      (w) => w is SliverPadding && w.padding == const EdgeInsets.only(bottom: 204),
    ),
    findsOneWidget,
  );
  // Exit multiselect (reset the notifier) → pill returns, clearance back to 84.
  // <reset multiSelectProvider notifier, pumpAndSettle>
  expect(
    tester.widget<AnimatedOpacity>(find.byKey(const Key('timeline-grouping-bottom-pill-opacity'))).opacity,
    1,
  );
  expect(
    find.byWidgetPredicate(
      (w) => w is SliverPadding && w.padding == const EdgeInsets.only(bottom: 84),
    ),
    findsOneWidget,
  );
});
```

Notes:

- Use `ProviderScope.containerOf(tester.element(find.byType(Timeline)))` to reach the scoped `multiSelectProvider` notifier for the multiselect test (select a `TestUtils.createRemoteAsset` via `selectAsset`). If the default `GeneralBottomSheet` pulls heavy providers when multiselect renders it, pass `bottomSheet: null` for that test — the assertions are about the pill + padding, not the sheet.
- If multiple `SliverPadding`s match a predicate, scope the finder with `find.descendant(of: find.byType(CustomScrollView), matching: ...)`.

- [ ] **Step 2: Run to verify compile-RED**

Run from `mobile/`: `~/.local/share/mise/installs/flutter/3.41.7/bin/flutter test test/presentation/widgets/timeline/timeline_with_grouping_pill_test.dart`
Expected: **FAILS TO COMPILE** — `Timeline` has no `withGroupingPill` parameter. Capture as RED evidence.

### Task 2: Implement the flag (GREEN)

**Files:**

- Modify: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`

- [ ] **Step 1: `Timeline` — add the flag**

Constructor + field (after `loadingWidget`):

```dart
    this.loadingWidget,
    this.withGroupingPill = false,
  });
  ...
  final Widget? loadingWidget;

  /// Overlay the always-visible Years|Months|All bottom pill and reserve bottom
  /// clearance for it. Detail timelines (album/space/person/...) opt in; the main
  /// Photos page keeps its app-bar chip and stays off.
  final bool withGroupingPill;
```

- [ ] **Step 2: `Timeline.build` — overlay the pill**

Convert the `LayoutBuilder` builder to a block body; build `_SliverTimeline` into a local, wrap when flagged:

```dart
      body: LayoutBuilder(
        builder: (_, constraints) {
          final sliverTimeline = _SliverTimeline(
            topSliverWidget: topSliverWidget,
            topSliverWidgetHeight: topSliverWidgetHeight,
            bottomSliverWidget: bottomSliverWidget,
            appBar: appBar,
            bottomSheet: bottomSheet,
            withScrubber: withScrubber,
            persistentBottomBar: persistentBottomBar,
            snapToMonth: snapToMonth,
            maxWidth: constraints.maxWidth,
            loadingWidget: loadingWidget,
            withGroupingPill: withGroupingPill,
          );
          return ProviderScope(
            overrides: [ /* unchanged overrides */ ],
            child: withGroupingPill
                ? Stack(children: [sliverTimeline, const TimelineGroupingBottomPill()])
                : sliverTimeline,
          );
        },
      ),
```

(Import `timeline_grouping_bottom_pill.widget.dart`, alphabetical position in the timeline/ import group.)

- [ ] **Step 3: `_SliverTimeline` — clearance through the seam**

Add `withGroupingPill` param + field (default false, passed above). Then the one-line seam change:

```dart
          const bottomSheetOpenModifier = 120.0;
          final pillClearance = widget.withGroupingPill
              ? TimelineGroupingBottomPill.pillHeight + TimelineGroupingBottomPill.bottomFloat
              : 0.0;
          final contentBottomPadding =
              context.padding.bottom + pillClearance + (isMultiSelectEnabled ? bottomSheetOpenModifier : 0);
```

`scrubberBottomPadding` already derives from `contentBottomPadding` — no further change (the scrubber track lifts automatically, per spec).

- [ ] **Step 4: Run the new test file to verify GREEN**

Run: `~/.local/share/mise/installs/flutter/3.41.7/bin/flutter test test/presentation/widgets/timeline/timeline_with_grouping_pill_test.dart`
Expected: 4/4 pass.

- [ ] **Step 5: Regression — existing Timeline-dependent suites stay green**

Run: `~/.local/share/mise/installs/flutter/3.41.7/bin/flutter test test/presentation/pages/dev/main_timeline_zoom_test.dart test/presentation/widgets/timeline/`
Expected: all pass (default-off flag must change nothing).

### Task 3: Gates + commit

- [ ] Run from `mobile/`: `~/.local/share/mise/installs/flutter/3.41.7/bin/dart analyze --fatal-infos lib test` → `No issues found!`; `~/.local/share/mise/installs/flutter/3.41.7/bin/dart format --set-exit-if-changed lib/presentation/widgets/timeline/timeline.widget.dart test/presentation/widgets/timeline/timeline_with_grouping_pill_test.dart` → 0 changed.
- [ ] Commit: `git add -A mobile && git commit -m "feat(mobile): Timeline.withGroupingPill — pill overlay + bottom clearance"`

Report SHA + RED/GREEN evidence.
