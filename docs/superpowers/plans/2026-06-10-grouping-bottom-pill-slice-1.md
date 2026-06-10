# Grouping Bottom Pill — Slice 1 Implementation Plan (pill widget)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `TimelineGroupingBottomPill` — a floating, always-visible bottom pill hosting the full Years|Months|All `TimelineGroupingSelector`, with nav-pill visual parity and multiselect/keyboard hide rules. Widget + tests only; `Timeline` integration is Slice 2.

**Architecture:** One new self-contained `ConsumerWidget` that renders a bottom-aligned overlay (align + safe-area float + blur pill surface + selector). Hide/show via the `GalleryBottomNav` pattern (TweenAnimationBuilder slide + AnimatedOpacity + IgnorePointer). No new providers — it watches the existing `multiSelectProvider` and `MediaQuery`.

**Tech stack:** Flutter/Dart (pinned `~/.local/share/mise/installs/flutter/3.41.7/bin/{flutter,dart}`), Riverpod, mobile test harness (`pumpConsumerWidget`, in-memory Drift Store).

**Spec:** `docs/superpowers/specs/2026-06-10-timeline-grouping-bottom-pill-design.md` (Slice 1 section).

---

### Task 1: Failing tests for the pill widget (compile-RED)

**Files:**

- Create: `mobile/test/presentation/widgets/timeline/timeline_grouping_bottom_pill_test.dart`

Model the harness on `mobile/test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart` (same `setUpAll` with `TestUtils.init()`, `SharedPreferences.setMockInitialValues({})`, `EasyLocalization.ensureInitialized()`, in-memory Drift + `StoreService.init`, `Store.clear()` in `setUp`/`tearDownAll`) — the selector calls `.tr()` and writes `Setting.groupAssetsBy` through the Store. Tap targets come from `timeline_grouping_selector_test.dart` (segments have keys `timeline-grouping-${groupBy.name}`; the full selector container key is `timeline-grouping-selector`).

- [ ] **Step 1: Write the test file**

```dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/setting.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  /// Host the pill the way Timeline will in Slice 2: an overlay child of a Stack.
  Widget host({EdgeInsets viewInsets = EdgeInsets.zero, EdgeInsets padding = EdgeInsets.zero}) {
    return MediaQuery(
      data: MediaQueryData(viewInsets: viewInsets, padding: padding),
      child: const Stack(children: [SizedBox.expand(), TimelineGroupingBottomPill()]),
    );
  }

  group('TimelineGroupingBottomPill', () {
    testWidgets('renders the full 3-segment selector', (tester) async {
      await tester.pumpConsumerWidget(host());
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
      expect(find.byType(TimelineGroupingSelector), findsOneWidget);
      // Full selector, not the compact chip: all three segments are present.
      expect(find.byKey(const Key('timeline-grouping-year')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-month')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-day')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-compact-selector')), findsNothing);
    });

    testWidgets('tapping a segment writes Setting.groupAssetsBy', (tester) async {
      await tester.pumpConsumerWidget(host());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('timeline-grouping-month')));
      await tester.pumpAndSettle();

      expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
    });

    testWidgets('hides while multiselect is enabled and reappears after', (tester) async {
      final selected = TestUtils.createRemoteAsset(id: 'a1');
      final notifier = MultiSelectNotifier(
        MultiSelectState(selectedAssets: {selected}, lockedSelectionAssets: const {}, forceEnable: false),
      );
      await tester.pumpConsumerWidget(
        host(),
        overrides: [multiSelectProvider.overrideWith(() => notifier)],
      );
      await tester.pumpAndSettle();

      // Hidden: opacity 0 and not hittable.
      final opacity = tester.widget<AnimatedOpacity>(
        find.byKey(const Key('timeline-grouping-bottom-pill-opacity')),
      );
      expect(opacity.opacity, 0);
      final ignore = tester.widget<IgnorePointer>(
        find.ancestor(
          of: find.byKey(const Key('timeline-grouping-bottom-pill')),
          matching: find.byType(IgnorePointer),
        ).first,
      );
      expect(ignore.ignoring, isTrue);

      // Exit multiselect → visible again.
      notifier.reset();
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<AnimatedOpacity>(find.byKey(const Key('timeline-grouping-bottom-pill-opacity')))
            .opacity,
        1,
      );
    });

    testWidgets('hides while the keyboard is up', (tester) async {
      await tester.pumpConsumerWidget(host(viewInsets: const EdgeInsets.only(bottom: 300)));
      await tester.pumpAndSettle();

      expect(
        tester
            .widget<AnimatedOpacity>(find.byKey(const Key('timeline-grouping-bottom-pill-opacity')))
            .opacity,
        0,
      );
    });

    testWidgets('floats max(safe-area, 26) above the bottom', (tester) async {
      EdgeInsets pillOuterPadding() {
        // The pill's own outer Padding (the one carrying the bottom float); nearest ancestor.
        final padding = tester.widget<Padding>(
          find
              .ancestor(
                of: find.byKey(const Key('timeline-grouping-bottom-pill')),
                matching: find.byType(Padding),
              )
              .first,
        );
        return padding.padding as EdgeInsets;
      }

      // Small safe area → 26px float.
      await tester.pumpConsumerWidget(host(padding: const EdgeInsets.only(bottom: 10)));
      await tester.pumpAndSettle();
      expect(pillOuterPadding().bottom, 26);

      // Large safe area → safe-area float.
      await tester.pumpConsumerWidget(host(padding: const EdgeInsets.only(bottom: 50)));
      await tester.pumpAndSettle();
      expect(pillOuterPadding().bottom, 50);
    });

    testWidgets('reduced motion applies hide state immediately (no animation)', (tester) async {
      final selected = TestUtils.createRemoteAsset(id: 'a1');
      await tester.pumpConsumerWidget(
        MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: const Stack(children: [SizedBox.expand(), TimelineGroupingBottomPill()]),
        ),
        overrides: [
          multiSelectProvider.overrideWith(
            () => MultiSelectNotifier(
              MultiSelectState(selectedAssets: {selected}, lockedSelectionAssets: const {}, forceEnable: false),
            ),
          ),
        ],
      );
      // A single frame is enough: durations are zero under reduced motion.
      await tester.pump();
      expect(
        tester
            .widget<AnimatedOpacity>(find.byKey(const Key('timeline-grouping-bottom-pill-opacity')))
            .duration,
        Duration.zero,
      );
    });

    testWidgets('adds no button semantics of its own (exactly the selector buttons)', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpConsumerWidget(host());
      await tester.pumpAndSettle();

      // The selector contributes exactly 3 button nodes (year/month/day segments).
      final buttons = tester.semantics
          .simulatedAccessibilityTraversal()
          .where((node) => node.hasFlag(SemanticsFlag.isButton))
          .length;
      expect(buttons, 3);
      handle.dispose();
    });

    testWidgets('large text scale renders without overflow', (tester) async {
      await tester.pumpConsumerWidget(
        MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2.0)),
          child: const Stack(children: [SizedBox.expand(), TimelineGroupingBottomPill()]),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('timeline-grouping-bottom-pill')), findsOneWidget);
    });

    testWidgets('RTL: renders and segment taps still write the setting', (tester) async {
      await tester.pumpConsumerWidget(
        Directionality(textDirection: TextDirection.rtl, child: host()),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('timeline-grouping-year')));
      await tester.pumpAndSettle();
      expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.year.index);
    });
  });
}
```

(If `pumpConsumerWidget` already wraps a `Directionality`/`MaterialApp`, adapt the RTL/MediaQuery wrappers to nest inside it — follow whatever `timeline_grouping_selector_test.dart` does for its RTL test. Adjust the semantics-traversal API to the harness's Flutter version if `simulatedAccessibilityTraversal` differs — the assertion to preserve is "exactly 3 button nodes".)

- [ ] **Step 2: Run to verify compile-RED**

Run from `mobile/`: `~/.local/share/mise/installs/flutter/3.41.7/bin/flutter test test/presentation/widgets/timeline/timeline_grouping_bottom_pill_test.dart`.
Expected: **FAILS TO COMPILE** — `timeline_grouping_bottom_pill.widget.dart` does not exist. Report the error line as RED evidence.

### Task 2: Implement the pill widget (GREEN)

**Files:**

- Create: `mobile/lib/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart`

- [ ] **Step 1: Write the widget**

```dart
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';

/// Floating bottom pill hosting the full Years | Months | All grouping selector.
///
/// Always visible on detail timelines (the scrolls-away top header it replaces was the bug);
/// hides only for multiselect (the selection bottom sheet takes the bottom edge) and while
/// the keyboard is up. Visual language mirrors [GalleryNavPill]'s blur-surface pill.
class TimelineGroupingBottomPill extends ConsumerWidget {
  const TimelineGroupingBottomPill({super.key});

  /// Height reserved by the pill (surface + vertical padding); Slice 2 derives the
  /// timeline's bottom content clearance from this.
  static const double pillHeight = 58.0;
  static const double bottomFloat = 26.0;

  static const double _keyboardThreshold = 80.0;
  static const Duration _hideAnimation = Duration(milliseconds: 200);
  static const double _pillRadius = 28.0;
  static const double _maxSelectorWidth = 218.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final mq = MediaQuery.of(context);
    final hiddenForMultiSelect = ref.watch(
      multiSelectProvider.select((s) => s.isEnabled || s.forceEnable),
    );
    final keyboardUp = mq.viewInsets.bottom > _keyboardThreshold;
    final hiding = hiddenForMultiSelect || keyboardUp;
    final duration = mq.disableAnimations ? Duration.zero : _hideAnimation;
    final bottomInset = mq.padding.bottom > bottomFloat ? mq.padding.bottom : bottomFloat;

    return TweenAnimationBuilder<double>(
      key: const Key('timeline-grouping-bottom-pill-slide'),
      tween: Tween<double>(end: hiding ? 12.0 : 0.0),
      duration: duration,
      curve: Curves.easeOutCubic,
      builder: (_, slide, child) => Transform.translate(offset: Offset(0, slide), child: child),
      child: AnimatedOpacity(
        key: const Key('timeline-grouping-bottom-pill-opacity'),
        duration: duration,
        opacity: hiding ? 0 : 1,
        child: IgnorePointer(
          ignoring: hiding,
          child: Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: EdgeInsets.only(left: 14, right: 14, bottom: bottomInset),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(_pillRadius),
                child: BackdropFilter(
                  filter: ui.ImageFilter.blur(sigmaX: 28, sigmaY: 28),
                  child: Container(
                    key: const Key('timeline-grouping-bottom-pill'),
                    height: pillHeight,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    decoration: BoxDecoration(
                      // Mirrors GalleryNavPill's surface treatment (dark: translucent elevated
                      // surface; light: high-alpha surface slab over the blur).
                      color: theme.brightness == Brightness.dark
                          ? theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.68)
                          : theme.colorScheme.surface.withValues(alpha: 0.9),
                      borderRadius: BorderRadius.circular(_pillRadius),
                      border: Border.all(
                        color: theme.colorScheme.outlineVariant.withValues(alpha: 0.55),
                        width: 1,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.7),
                          offset: const Offset(0, 20),
                          blurRadius: 44,
                          spreadRadius: -14,
                        ),
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.4),
                          offset: const Offset(0, 4),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: _maxSelectorWidth),
                        child: const TimelineGroupingSelector(),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
```

Notes pinned by the spec:

- The selector's own `LayoutBuilder` caps at 218 and shrinks below that on narrow widths — the `ConstrainedBox` + the 14px horizontal outer padding give it `min(218, width − 28)`.
- The selector renders 48px tall inside the 58px surface (`Center`) — nav-pill height parity.
- No `Semantics` widget added — the pill must contribute zero button nodes of its own.

- [ ] **Step 2: Run the test file to verify GREEN**

Run: `~/.local/share/mise/installs/flutter/3.41.7/bin/flutter test test/presentation/widgets/timeline/timeline_grouping_bottom_pill_test.dart` (from `mobile/`).
Expected: all 9 tests PASS. If the multiselect-hide test fails on the opacity assertion timing, `pumpAndSettle` after `notifier.reset()` (state change animates over 200 ms).

### Task 3: Gates + commit

- [ ] **Step 1: Analyzer + format**

Run from `mobile/`:

- `~/.local/share/mise/installs/flutter/3.41.7/bin/dart analyze --fatal-infos lib test` → expect `No issues found!`
- `~/.local/share/mise/installs/flutter/3.41.7/bin/dart format --set-exit-if-changed lib/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart test/presentation/widgets/timeline/timeline_grouping_bottom_pill_test.dart` → expect 0 changed.

- [ ] **Step 2: Commit**

```bash
git add -A mobile && git commit -m "feat(mobile): TimelineGroupingBottomPill widget (always-visible grouping selector)"
```

Report the SHA, plus RED and GREEN command output summaries as TDD evidence.
