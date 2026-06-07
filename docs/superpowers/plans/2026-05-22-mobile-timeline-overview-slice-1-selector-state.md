# Mobile Timeline Overview Slice 1 Selector State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable Flutter timeline grouping selector that displays `Years`, `Months`, and `Days`, persists the selected `GroupAssetsBy`, and stays in sync with the existing settings picker.

**Architecture:** This slice introduces only the selector and setting synchronization foundation. It uses the existing `Setting.groupAssetsBy`, `settingsProvider`, and `StoreKey.groupAssetsBy`; it does not add temporal scope, overview cards, representative assets, drilldown, or route replacement. The selector is a compact, app-bar-friendly segmented control that can be embedded in route app bars in future slices.

**Tech Stack:** Flutter, Dart, Riverpod, Drift-backed StoreService, easy_localization, flutter_test.

---

## Scope Boundaries

In scope:

- Add localized labels for `Years`, `Months`, `Days`, and the selector semantics label.
- Add a reusable `TimelineGroupingSelector` widget.
- Normalize unsupported stored values (`auto`, `none`, invalid indexes) to display as `Days`.
- Persist taps to `Setting.groupAssetsBy`.
- Keep `GroupSettings` writes visible to `settingsProvider` by invalidating the new settings provider after the legacy settings write.
- Add widget tests for rendering, selected state, writes, settings sync, disabled behavior, and narrow-width layout.

Out of scope:

- Replacing `FilterIconButton` on `MainTimelinePage`.
- Adding temporal scope or active temporal chips.
- Adding overview cards or representative asset queries.
- Implementing year/month card drilldown.
- Shared route adoption.
- Cover-photo selection guardrails.

## File Map

- Create: `mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart`
  - Owns the compact selector widget and the normalization helpers.
- Modify: `mobile/lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart`
  - Invalidates `settingsProvider` when the existing settings picker writes `groupAssetsBy`.
- Modify: `i18n/en.json`
  - Adds English labels for timeline grouping selector UI.
- Regenerate/ignored: `mobile/lib/generated/codegen_loader.g.dart`
  - Local generated translation loader; ignored by git.
- Regenerate/ignored: `mobile/lib/generated/translations.g.dart`
  - Local generated typed translation keys; ignored by git.
- Create: `mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart`
  - Widget tests for the selector and settings sync.

## Task 1: Add Selector Labels And Widget Tests

**Files:**

- Modify: `i18n/en.json`
- Regenerate/ignored: `mobile/lib/generated/codegen_loader.g.dart`
- Regenerate/ignored: `mobile/lib/generated/translations.g.dart`
- Create: `mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart`
- Create in Task 2: `mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart`

- [ ] **Step 1: Add English translation keys**

Edit `i18n/en.json` and add these keys near the existing `timeline` or date-related keys if there is a suitable local grouping; otherwise add them alphabetically with the surrounding top-level keys:

```json
"timeline_grouping_days": "Days",
"timeline_grouping_months": "Months",
"timeline_grouping_selector": "Timeline grouping",
"timeline_grouping_years": "Years",
```

- [ ] **Step 2: Regenerate mobile translation artifacts**

Run:

```bash
cd mobile
mise exec -- dart run easy_localization:generate -S ../i18n
mise exec -- dart run bin/generate_keys.dart
mise exec -- dart format lib/generated/codegen_loader.g.dart lib/generated/translations.g.dart
```

Expected result:

- `mobile/lib/generated/codegen_loader.g.dart` includes the four new English keys.
- `mobile/lib/generated/translations.g.dart` includes typed constants for the four new keys.
- These generated files remain ignored by git and are not included in the slice commit.

- [ ] **Step 3: Write the failing selector widget tests**

Create `mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart` with this content:

```dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/infrastructure/setting.provider.dart';
import 'package:immich_mobile/widgets/settings/asset_list_settings/asset_list_group_settings.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
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

  Semantics segment(WidgetTester tester, GroupAssetsBy groupBy) {
    return tester.widget<Semantics>(find.byKey(Key('timeline-grouping-${groupBy.name}')));
  }

  bool selected(WidgetTester tester, GroupAssetsBy groupBy) {
    return segment(tester, groupBy).properties.selected ?? false;
  }

  group('TimelineGroupingSelector', () {
    testWidgets('renders years, months, and days segments in an app-bar action slot', (tester) async {
      await tester.pumpConsumerWidget(
        const CustomScrollView(
          slivers: [
            SliverAppBar(
              actions: [
                TimelineGroupingSelector(),
              ],
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('timeline-grouping-selector')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-year')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-month')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-day')), findsOneWidget);
      expect(selected(tester, GroupAssetsBy.day), isTrue);
    });

    testWidgets('initializes selected segment from Setting.groupAssetsBy', (tester) async {
      await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.month.index);

      await tester.pumpConsumerWidget(const TimelineGroupingSelector());
      await tester.pumpAndSettle();

      expect(selected(tester, GroupAssetsBy.month), isTrue);
      expect(selected(tester, GroupAssetsBy.day), isFalse);
      expect(selected(tester, GroupAssetsBy.year), isFalse);
    });

    testWidgets('normalizes unsupported auto and none values to Days visually', (tester) async {
      await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.auto.index);
      await tester.pumpConsumerWidget(const TimelineGroupingSelector());
      await tester.pumpAndSettle();
      expect(selected(tester, GroupAssetsBy.day), isTrue);

      await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.none.index);
      final container = ProviderScope.containerOf(tester.element(find.byType(TimelineGroupingSelector)));
      container.invalidate(settingsProvider);
      await tester.pumpAndSettle();
      expect(selected(tester, GroupAssetsBy.day), isTrue);
    });

    testWidgets('tapping each segment writes the matching GroupAssetsBy setting', (tester) async {
      await tester.pumpConsumerWidget(const TimelineGroupingSelector());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('timeline-grouping-year')));
      await tester.pumpAndSettle();
      expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.year.index);
      expect(selected(tester, GroupAssetsBy.year), isTrue);

      await tester.tap(find.byKey(const Key('timeline-grouping-month')));
      await tester.pumpAndSettle();
      expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.month.index);
      expect(selected(tester, GroupAssetsBy.month), isTrue);

      await tester.tap(find.byKey(const Key('timeline-grouping-day')));
      await tester.pumpAndSettle();
      expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.day.index);
      expect(selected(tester, GroupAssetsBy.day), isTrue);
    });

    testWidgets('settings picker changes update the selector', (tester) async {
      await tester.pumpConsumerWidget(
        const SingleChildScrollView(
          child: Column(
            children: [
              TimelineGroupingSelector(),
              GroupSettings(),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.descendant(of: find.byType(GroupSettings), matching: find.text('year')));
      await tester.pumpAndSettle();

      expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.year.index);
      expect(selected(tester, GroupAssetsBy.year), isTrue);
    });

    testWidgets('disabled selector does not write settings', (tester) async {
      await Store.put(StoreKey.groupAssetsBy, GroupAssetsBy.day.index);
      await tester.pumpConsumerWidget(const TimelineGroupingSelector(enabled: false));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('timeline-grouping-year')), warnIfMissed: false);
      await tester.pumpAndSettle();

      expect(Store.get(StoreKey.groupAssetsBy), GroupAssetsBy.day.index);
      expect(selected(tester, GroupAssetsBy.day), isTrue);
    });

    testWidgets('narrow width does not throw layout overflow', (tester) async {
      await tester.binding.setSurfaceSize(const Size(180, 120));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpConsumerWidget(
        const Align(
          alignment: Alignment.topRight,
          child: SizedBox(width: 150, child: TimelineGroupingSelector()),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.byKey(const Key('timeline-grouping-selector'))).width, lessThanOrEqualTo(150));
    });
  });
}
```

- [ ] **Step 4: Run the selector tests and verify red**

Run:

```bash
cd mobile
mise exec -- dart format test/presentation/widgets/timeline/timeline_grouping_selector_test.dart
```

Expected green result:

- Dart formatter exits `0`.

- [ ] **Step 5: Run the selector tests and verify red**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/timeline_grouping_selector_test.dart
```

Expected red failure:

- Import failure for missing `timeline_grouping_selector.widget.dart`.
- After adding only the translation keys, there should be no JSON or generated-code failure.

## Task 2: Implement TimelineGroupingSelector

**Files:**

- Create: `mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart`
- Test: `mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart`

- [ ] **Step 1: Create the selector widget**

Create `mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart` with this content:

```dart
import 'dart:async';
import 'dart:math' as math;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/setting.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/providers/infrastructure/setting.provider.dart';

const timelineGroupingSelectorGroups = <GroupAssetsBy>[
  GroupAssetsBy.year,
  GroupAssetsBy.month,
  GroupAssetsBy.day,
];

GroupAssetsBy normalizeTimelineGrouping(GroupAssetsBy groupBy) {
  return switch (groupBy) {
    GroupAssetsBy.year || GroupAssetsBy.month || GroupAssetsBy.day => groupBy,
    GroupAssetsBy.auto || GroupAssetsBy.none => GroupAssetsBy.day,
  };
}

GroupAssetsBy timelineGroupingFromSettingIndex(int index) {
  if (index < 0 || index >= GroupAssetsBy.values.length) {
    return GroupAssetsBy.day;
  }

  return normalizeTimelineGrouping(GroupAssetsBy.values[index]);
}

class TimelineGroupingSelector extends ConsumerWidget {
  const TimelineGroupingSelector({super.key, this.enabled = true});

  static const double _maxWidth = 218;
  static const double _height = 40;

  final bool enabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(
      settingsProvider.select((settings) => timelineGroupingFromSettingIndex(settings.get(Setting.groupAssetsBy))),
    );
    final theme = Theme.of(context);
    final colors = theme.colorScheme;

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth.isFinite ? math.min(constraints.maxWidth, _maxWidth) : _maxWidth;

        return Semantics(
          container: true,
          label: 'timeline_grouping_selector'.tr(context: context),
          child: Opacity(
            opacity: enabled ? 1 : 0.45,
            child: SizedBox(
              key: const Key('timeline-grouping-selector'),
              width: width,
              height: _height,
              child: Material(
                color: colors.surfaceContainerHighest.withValues(alpha: theme.brightness == Brightness.dark ? 0.74 : 0.9),
                shape: StadiumBorder(side: BorderSide(color: colors.outlineVariant.withValues(alpha: 0.7))),
                clipBehavior: Clip.antiAlias,
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Row(
                    children: [
                      for (final groupBy in timelineGroupingSelectorGroups)
                        Expanded(
                          child: _TimelineGroupingSegment(
                            groupBy: groupBy,
                            selected: selected == groupBy,
                            enabled: enabled,
                            onTap: () async {
                              unawaited(HapticFeedback.selectionClick());
                              await ref.read(settingsProvider.notifier).set(Setting.groupAssetsBy, groupBy.index);
                            },
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _TimelineGroupingSegment extends StatelessWidget {
  const _TimelineGroupingSegment({
    required this.groupBy,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final GroupAssetsBy groupBy;
  final bool selected;
  final bool enabled;
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final foreground = selected ? colors.onPrimary : colors.onSurface.withValues(alpha: 0.86);

    return Semantics(
      key: Key('timeline-grouping-${groupBy.name}'),
      button: true,
      selected: selected,
      enabled: enabled,
      label: _label(context, groupBy),
      child: InkWell(
        onTap: enabled && !selected ? () => unawaited(onTap()) : null,
        borderRadius: BorderRadius.circular(999),
        child: AnimatedContainer(
          duration: Durations.short3,
          curve: Curves.easeOutCubic,
          height: double.infinity,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: selected ? colors.primary : Colors.transparent, borderRadius: BorderRadius.circular(999)),
          padding: const EdgeInsets.symmetric(horizontal: 6),
          child: Text(
            _label(context, groupBy),
            maxLines: 1,
            overflow: TextOverflow.fade,
            softWrap: false,
            style: theme.textTheme.labelLarge?.copyWith(color: foreground, fontWeight: selected ? FontWeight.w700 : FontWeight.w600),
          ),
        ),
      ),
    );
  }
}

String _label(BuildContext context, GroupAssetsBy groupBy) {
  return switch (groupBy) {
    GroupAssetsBy.year => 'timeline_grouping_years'.tr(context: context),
    GroupAssetsBy.month => 'timeline_grouping_months'.tr(context: context),
    GroupAssetsBy.day => 'timeline_grouping_days'.tr(context: context),
    GroupAssetsBy.auto || GroupAssetsBy.none => 'timeline_grouping_days'.tr(context: context),
  };
}
```

- [ ] **Step 2: Format the new widget**

Run:

```bash
cd mobile
mise exec -- dart format lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart
```

Expected green result:

- Dart formatter exits `0`.

- [ ] **Step 3: Run selector tests and verify only settings sync remains red**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/timeline_grouping_selector_test.dart
```

Expected result at this point:

- The rendering, initialization, normalization, tapping, disabled, and narrow-width tests pass.
- The settings picker sync test fails until Task 3 invalidates `settingsProvider`.

## Task 3: Sync Existing Settings Picker With The New Selector

**Files:**

- Modify: `mobile/lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart`
- Test: `mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart`
- Existing regression test: `mobile/test/widgets/settings/asset_list_group_settings_test.dart`

- [ ] **Step 1: Update GroupSettings to invalidate settingsProvider**

Modify `mobile/lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart`.

Add this import:

```dart
import 'package:immich_mobile/providers/infrastructure/setting.provider.dart';
```

Change `updateAppSettings` from:

```dart
Future<void> updateAppSettings(GroupAssetsBy groupBy) async {
  await ref.watch(appSettingsServiceProvider).setSetting(AppSettingsEnum.groupAssetsBy, groupBy.index);
  ref.invalidate(appSettingsServiceProvider);
}
```

to:

```dart
Future<void> updateAppSettings(GroupAssetsBy groupBy) async {
  await ref.read(appSettingsServiceProvider).setSetting(AppSettingsEnum.groupAssetsBy, groupBy.index);
  ref.invalidate(appSettingsServiceProvider);
  ref.invalidate(settingsProvider);
}
```

This keeps legacy app-settings consumers working while making new `settingsProvider` consumers rebuild after the settings picker changes the shared `StoreKey.groupAssetsBy` value.

- [ ] **Step 2: Format the modified settings file**

Run:

```bash
cd mobile
mise exec -- dart format lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart
```

Expected green result:

- Dart formatter exits `0`.

- [ ] **Step 3: Run selector tests and verify green**

Run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/timeline_grouping_selector_test.dart
```

Expected green result:

- All tests in `timeline_grouping_selector_test.dart` pass, including `settings picker changes update the selector`.

- [ ] **Step 4: Run existing settings regression tests**

Run:

```bash
cd mobile
mise exec -- flutter test test/widgets/settings/asset_list_group_settings_test.dart
```

Expected green result:

- Existing `GroupSettings` tests still pass.

## Task 4: Final Slice 1 Verification And Commit

**Files:**

- Verify all files from Tasks 1-3.

- [ ] **Step 1: Run targeted tests together**

Run:

```bash
cd mobile
mise exec -- flutter test \
  test/domain/models/timeline_grouping_test.dart \
  test/presentation/widgets/timeline/timeline_grouping_selector_test.dart \
  test/widgets/settings/asset_list_group_settings_test.dart
```

Expected green result:

- All three targeted test files pass.

- [ ] **Step 2: Run Dart analyzer on touched production files**

Run:

```bash
cd mobile
mise exec -- dart analyze \
  lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart \
  lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart
```

Expected green result:

- Analyzer exits `0` with no errors or warnings for the touched production files.

- [ ] **Step 3: Check formatting-sensitive generated files and status**

Run:

```bash
git diff --check
git status --short
```

Expected result:

- `git diff --check` exits `0`.
- `git status --short` shows only the intended Slice 1 files.

- [ ] **Step 4: Commit Slice 1 implementation**

Run:

```bash
git add \
  i18n/en.json \
  mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart \
  mobile/lib/widgets/settings/asset_list_settings/asset_list_group_settings.dart \
  mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart
git commit -m "feat(mobile): add timeline grouping selector"
```

Expected result:

- Commit succeeds.
- Commit contains only Slice 1 selector state and setting sync work.

## Plan Self-Review

Spec coverage for Slice 1:

- TDD: Task 1 writes tests before the selector exists and requires the red import failure.
- Selector rendering: covered by the app-bar action slot widget test.
- Setting writes: covered by tapping each segment and checking `StoreKey.groupAssetsBy`.
- Initialization: covered by preloading `StoreKey.groupAssetsBy`.
- Settings sync: covered by the combined `TimelineGroupingSelector` + `GroupSettings` test.
- Existing enum indexes: already covered by `mobile/test/domain/models/timeline_grouping_test.dart` from the mobile parity foundation; this slice does not change enum order.
- Narrow width: covered by a `150px` width no-overflow test.
- Disabled state: covered so future selection/asset-viewer overlays have a safe way to disable the control.

Future-slice requirements intentionally not implemented here:

- Temporal scope model and query composition belong to Slice 2.
- Overview cards and representative data belong to Slice 3.
- Main Photos app-bar replacement and drilldown belong to Slice 4.
- Shared route adoption and cover-photo guardrails belong to Slice 5.
- Accessibility/localization polish beyond the base labels and semantics belongs to Slice 6.
