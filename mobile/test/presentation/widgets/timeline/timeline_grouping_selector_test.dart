import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/widgets/settings/asset_list_settings/asset_list_group_settings.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  Semantics segment(WidgetTester tester, TimelineOverviewMode mode) {
    return tester.widget<Semantics>(find.byKey(Key('timeline-grouping-${mode.name}')));
  }

  bool selected(WidgetTester tester, TimelineOverviewMode mode) {
    return segment(tester, mode).properties.selected ?? false;
  }

  ProviderContainer containerOf(WidgetTester tester) {
    return ProviderScope.containerOf(tester.element(find.byType(TimelineGroupingSelector)));
  }

  // The selector is view state, so drive it through its own provider rather than through
  // Setting.groupAssetsBy — that setting is the independent "Photo Grid" -> "Group by" choice.
  Future<void> setGrouping(WidgetTester tester, TimelineOverviewMode mode) async {
    await containerOf(tester).read(timelineOverviewModeProvider.notifier).set(mode);
    await tester.pumpAndSettle();
  }

  TimelineOverviewMode grouping(WidgetTester tester) => containerOf(tester).read(timelineOverviewModeProvider);

  group('TimelineGroupingSelector', () {
    testWidgets('renders years, months, and days segments in an app-bar action slot', (tester) async {
      await tester.pumpConsumerWidget(
        const CustomScrollView(
          slivers: [
            SliverAppBar(actions: [TimelineGroupingSelector()]),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('timeline-grouping-selector')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-years')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-months')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-all')), findsOneWidget);
      expect(selected(tester, TimelineOverviewMode.all), isTrue);
    });

    testWidgets('bare variant draws no surface or border of its own (for hosts that paint the pill)', (tester) async {
      await tester.pumpConsumerWidget(const TimelineGroupingSelector(bare: true));
      await tester.pumpAndSettle();

      final material = tester.widget<Material>(
        find.descendant(of: find.byKey(const Key('timeline-grouping-selector')), matching: find.byType(Material)),
      );
      expect(material.color, Colors.transparent);
      expect((material.shape! as StadiumBorder).side, BorderSide.none);
    });

    testWidgets('default variant keeps its own surface and border (app-bar hosts paint nothing)', (tester) async {
      await tester.pumpConsumerWidget(const TimelineGroupingSelector());
      await tester.pumpAndSettle();

      final material = tester.widget<Material>(
        find.descendant(of: find.byKey(const Key('timeline-grouping-selector')), matching: find.byType(Material)),
      );
      expect(material.color, isNot(Colors.transparent));
      expect((material.shape! as StadiumBorder).side.style, BorderStyle.solid);
    });

    testWidgets('selects the segment matching the active grouping', (tester) async {
      await tester.pumpConsumerWidget(const TimelineGroupingSelector());
      await tester.pumpAndSettle();
      await setGrouping(tester, TimelineOverviewMode.months);

      expect(selected(tester, TimelineOverviewMode.months), isTrue);
      expect(selected(tester, TimelineOverviewMode.all), isFalse);
      expect(selected(tester, TimelineOverviewMode.years), isFalse);
    });

    testWidgets('opens on the All segment regardless of the Group by setting', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);

      await tester.pumpConsumerWidget(const TimelineGroupingSelector());
      await tester.pumpAndSettle();

      expect(selected(tester, TimelineOverviewMode.all), isTrue);
      expect(selected(tester, TimelineOverviewMode.months), isFalse);
    });

    testWidgets('selected segment exposes button semantics without duplicate child text', (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        await tester.pumpConsumerWidget(const TimelineGroupingSelector());
        await tester.pumpAndSettle();
        await setGrouping(tester, TimelineOverviewMode.months);

        expect(tester.getSemantics(find.byKey(const Key('timeline-grouping-selector'))).label, 'Timeline grouping');
        expect(find.bySemanticsLabel('Years'), findsOneWidget);
        expect(find.bySemanticsLabel('Months'), findsOneWidget);
        expect(find.bySemanticsLabel('All'), findsOneWidget);

        final years = tester.getSemantics(find.byKey(const Key('timeline-grouping-years')));
        final months = tester.getSemantics(find.byKey(const Key('timeline-grouping-months')));
        final days = tester.getSemantics(find.byKey(const Key('timeline-grouping-all')));

        expect(years.flagsCollection.isButton, isTrue);
        expect(years.flagsCollection.toStrings(), contains('hasSelectedState'));
        expect(years.flagsCollection.toStrings(), isNot(contains('isSelected')));
        expect(years.flagsCollection.toStrings(), contains('isEnabled'));
        expect(months.flagsCollection.isButton, isTrue);
        expect(months.flagsCollection.toStrings(), contains('isSelected'));
        expect(months.flagsCollection.toStrings(), contains('isEnabled'));
        expect(days.flagsCollection.isButton, isTrue);
        expect(days.flagsCollection.toStrings(), contains('hasSelectedState'));
        expect(days.flagsCollection.toStrings(), isNot(contains('isSelected')));
        expect(days.flagsCollection.toStrings(), contains('isEnabled'));
      } finally {
        semantics.dispose();
      }
    });

    testWidgets('tapping each segment changes the grouping without writing the Group by setting', (tester) async {
      await tester.pumpConsumerWidget(const TimelineGroupingSelector());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('timeline-grouping-years')));
      await tester.pumpAndSettle();
      expect(grouping(tester), TimelineOverviewMode.years);
      expect(selected(tester, TimelineOverviewMode.years), isTrue);

      await tester.tap(find.byKey(const Key('timeline-grouping-months')));
      await tester.pumpAndSettle();
      expect(grouping(tester), TimelineOverviewMode.months);
      expect(selected(tester, TimelineOverviewMode.months), isTrue);

      await tester.tap(find.byKey(const Key('timeline-grouping-all')));
      await tester.pumpAndSettle();
      expect(grouping(tester), TimelineOverviewMode.all);
      expect(selected(tester, TimelineOverviewMode.all), isTrue);

      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
    });

    // #903: picking "Month" under Photo Grid must group the photo grid's headers, not flip the
    // timeline into the Months overview cards. The selector has to stay where it was.
    testWidgets('settings picker changes leave the selector alone', (tester) async {
      await tester.pumpConsumerWidget(
        const SingleChildScrollView(child: Column(children: [TimelineGroupingSelector(), GroupSettings()])),
      );
      await tester.pumpAndSettle();

      await tester.tap(
        find.descendant(of: find.byType(GroupSettings), matching: find.text(StaticTranslations.instance.month)),
      );
      await tester.pumpAndSettle();

      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
      expect(grouping(tester), TimelineOverviewMode.all);
      expect(selected(tester, TimelineOverviewMode.all), isTrue);
      expect(selected(tester, TimelineOverviewMode.months), isFalse);
    });

    testWidgets('disabled selector does not change the grouping', (tester) async {
      await tester.pumpConsumerWidget(const TimelineGroupingSelector(enabled: false));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('timeline-grouping-years')), warnIfMissed: false);
      await tester.pumpAndSettle();

      expect(grouping(tester), TimelineOverviewMode.all);
      expect(selected(tester, TimelineOverviewMode.all), isTrue);
    });

    testWidgets('disabled selector removes actionable semantics and does not change the grouping', (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        await tester.pumpConsumerWidget(const TimelineGroupingSelector(enabled: false));
        await tester.pumpAndSettle();

        for (final mode in timelineOverviewModeSelectorOrder) {
          final label = switch (mode) {
            TimelineOverviewMode.years => 'Years',
            TimelineOverviewMode.months => 'Months',
            TimelineOverviewMode.all => 'All',
          };
          final node = tester.getSemantics(find.byKey(Key('timeline-grouping-${mode.name}')));
          expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isFalse, reason: label);
          expect(node.flagsCollection.toStrings(), contains('hasEnabledState'), reason: label);
          expect(node.flagsCollection.toStrings(), isNot(contains('isEnabled')), reason: label);
        }

        await tester.tap(find.byKey(const Key('timeline-grouping-years')), warnIfMissed: false);
        await tester.pumpAndSettle();

        expect(grouping(tester), TimelineOverviewMode.all);
      } finally {
        semantics.dispose();
      }
    });

    testWidgets('segments meet compact mobile tap target inside the app bar slot', (tester) async {
      await tester.pumpConsumerWidget(
        const CustomScrollView(
          slivers: [
            SliverAppBar(actions: [TimelineGroupingSelector()]),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.getSize(find.byKey(const Key('timeline-grouping-selector'))).height, greaterThanOrEqualTo(48));
      for (final mode in timelineOverviewModeSelectorOrder) {
        expect(tester.getSize(find.byKey(Key('timeline-grouping-${mode.name}'))).height, greaterThanOrEqualTo(48));
      }
    });

    testWidgets('large text and narrow width keep all labels inside the selector', (tester) async {
      await tester.binding.setSurfaceSize(const Size(180, 120));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpConsumerWidget(
        const MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(2)),
          child: Align(
            alignment: Alignment.topRight,
            child: SizedBox(width: 150, child: TimelineGroupingSelector()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.byKey(const Key('timeline-grouping-selector'))).width, lessThanOrEqualTo(150));
      expect(find.byKey(const Key('timeline-grouping-years')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-months')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-all')), findsOneWidget);
    });

    testWidgets('reduced motion removes nonessential selector animation', (tester) async {
      await tester.pumpConsumerWidget(
        const MediaQuery(
          data: MediaQueryData(disableAnimations: true, accessibleNavigation: true),
          child: TimelineGroupingSelector(),
        ),
      );
      await tester.pumpAndSettle();

      final reducedDurations = tester
          .widgetList<AnimatedContainer>(find.byType(AnimatedContainer))
          .map((w) => w.duration);
      expect(reducedDurations, isNotEmpty);
      expect(reducedDurations, everyElement(Duration.zero));

      await tester.pumpConsumerWidget(const TimelineGroupingSelector());
      await tester.pumpAndSettle();

      final normalDurations = tester
          .widgetList<AnimatedContainer>(find.byType(AnimatedContainer))
          .map((w) => w.duration);
      expect(normalDurations, isNotEmpty);
      expect(normalDurations, everyElement(isNot(Duration.zero)));
    });

    testWidgets('rtl layout preserves tap behavior and directional visual order', (tester) async {
      await tester.pumpConsumerWidget(
        const Directionality(textDirection: TextDirection.rtl, child: TimelineGroupingSelector()),
      );
      await tester.pumpAndSettle();
      await setGrouping(tester, TimelineOverviewMode.months);

      final years = tester.getCenter(find.byKey(const Key('timeline-grouping-years')));
      final months = tester.getCenter(find.byKey(const Key('timeline-grouping-months')));
      final days = tester.getCenter(find.byKey(const Key('timeline-grouping-all')));

      expect(years.dx, greaterThan(months.dx));
      expect(months.dx, greaterThan(days.dx));

      await tester.tap(find.byKey(const Key('timeline-grouping-all')));
      await tester.pumpAndSettle();

      expect(grouping(tester), TimelineOverviewMode.all);
    });

    testWidgets('compact mode renders only the current grouping in a small app-bar chip', (tester) async {
      await tester.pumpConsumerWidget(
        const CustomScrollView(
          slivers: [
            SliverAppBar(actions: [TimelineGroupingSelector.compact()]),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('timeline-grouping-compact-selector')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-selector')), findsNothing);
      expect(find.byKey(const Key('timeline-grouping-years')), findsNothing);
      expect(find.byKey(const Key('timeline-grouping-months')), findsNothing);
      expect(find.byKey(const Key('timeline-grouping-all')), findsNothing);
      // The chip paints the localized initial only. Spelling the mode out cost 98px of a bar that
      // has ~155px to spare before the logo starts shrinking (#1030); the word stays in the
      // long-press menu and in the accessibility value.
      expect(find.text('A'), findsOneWidget);
      expect(find.text('All'), findsNothing);
      expect(find.text('Day'), findsNothing);
      expect(find.text('Days'), findsNothing);
      expect(find.byIcon(Icons.expand_more_rounded), findsNothing);
      expectTapTargetMin(tester, find.byKey(const Key('timeline-grouping-compact-selector')), min: 40);
      expect(tester.getSize(find.byKey(const Key('timeline-grouping-compact-selector'))).width, lessThanOrEqualTo(48));
    });

    testWidgets('compact chip keeps the full mode name as its accessibility value', (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        await tester.pumpConsumerWidget(const TimelineGroupingSelector.compact());
        await tester.pumpAndSettle();
        await setGrouping(tester, TimelineOverviewMode.months);

        final chip = tester.getSemantics(find.byKey(const Key('timeline-grouping-compact-selector')));
        expect(chip.label, 'Timeline grouping');
        expect(chip.value, 'Months', reason: 'the abbreviation is visual only; screen readers get the word');
      } finally {
        semantics.dispose();
      }
    });

    testWidgets('compact mode tapping Day zooms out to Month', (tester) async {
      await tester.pumpConsumerWidget(const TimelineGroupingSelector.compact());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('timeline-grouping-compact-selector')));
      await tester.pumpAndSettle();

      expect(grouping(tester), TimelineOverviewMode.months);
      expect(find.text('M'), findsOneWidget);
    });

    testWidgets('compact mode bounces between extremes', (tester) async {
      await tester.pumpConsumerWidget(const TimelineGroupingSelector.compact());
      await tester.pumpAndSettle();
      await setGrouping(tester, TimelineOverviewMode.years);

      final selector = find.byKey(const Key('timeline-grouping-compact-selector'));

      // Year -> Month -> Day (heading down)
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(grouping(tester), TimelineOverviewMode.months);
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(grouping(tester), TimelineOverviewMode.all);

      // Day -> Month -> Year (direction inverted at Day; preserved through Month)
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(grouping(tester), TimelineOverviewMode.months);
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(grouping(tester), TimelineOverviewMode.years);
    });

    testWidgets('compact mode keeps bouncing back to Years when the chip is recreated between taps', (tester) async {
      // The timeline destroys and recreates the app-bar subtree whenever its segments reload
      // (every grouping change flashes the timelineSegmentProvider loading state). The bounce
      // direction must survive that recreation, otherwise the chip gets stuck oscillating
      // Months <-> All and never returns to Years.
      var generation = 0;
      late StateSetter setOuter;
      await tester.pumpConsumerWidget(
        StatefulBuilder(
          builder: (context, setState) {
            setOuter = setState;
            // A fresh key on every generation forces the selector's State to be disposed and
            // rebuilt, exactly like the timeline swapping its loading/data slivers.
            return TimelineGroupingSelector.compact(key: ValueKey(generation));
          },
        ),
      );
      await tester.pumpAndSettle();
      await setGrouping(tester, TimelineOverviewMode.years);

      final selector = find.byKey(const Key('timeline-grouping-compact-selector'));

      Future<void> tapAndRecreate() async {
        await tester.tap(selector);
        await tester.pumpAndSettle();
        setOuter(() => generation++);
        await tester.pumpAndSettle();
      }

      await tapAndRecreate();
      expect(grouping(tester), TimelineOverviewMode.months); // Years -> Months
      await tapAndRecreate();
      expect(grouping(tester), TimelineOverviewMode.all); // Months -> All
      await tapAndRecreate();
      expect(grouping(tester), TimelineOverviewMode.months); // All -> Months
      await tapAndRecreate();
      expect(grouping(tester), TimelineOverviewMode.years); // Months -> Years (the bug)
    });

    testWidgets('compact mode opens a direct selection menu on long press', (tester) async {
      await tester.pumpConsumerWidget(const TimelineGroupingSelector.compact());
      await tester.pumpAndSettle();

      await tester.longPress(find.byKey(const Key('timeline-grouping-compact-selector')));
      await tester.pumpAndSettle();

      // The menu is where the abbreviated chip spells its options out in full.
      expect(find.text('Years'), findsOneWidget);
      expect(find.text('Months'), findsOneWidget);
      expect(find.text('All'), findsOneWidget);
      expect(find.text('Month'), findsNothing);

      await tester.tap(find.byKey(const Key('timeline-grouping-menu-months')));
      await tester.pumpAndSettle();

      expect(grouping(tester), TimelineOverviewMode.months);
      expect(find.text('M'), findsOneWidget);
    });

    testWidgets('compact mode resumes bouncing after a long-press menu selection', (tester) async {
      await tester.pumpConsumerWidget(const TimelineGroupingSelector.compact());
      await tester.pumpAndSettle();

      final selector = find.byKey(const Key('timeline-grouping-compact-selector'));

      // Pick Year directly via the long-press menu.
      await tester.longPress(selector);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('timeline-grouping-menu-years')));
      await tester.pumpAndSettle();
      expect(grouping(tester), TimelineOverviewMode.years);

      // Subsequent taps bounce down: Year -> Month -> Day.
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(grouping(tester), TimelineOverviewMode.months);
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(grouping(tester), TimelineOverviewMode.all);
    });

    testWidgets('compact chip paints its initial in full at normal size and never clips when enlarged', (tester) async {
      // The chip carries a single localized initial. At the default text scale it must render at
      // full size; when the OS enlarges text it may scale down to fit but must never clip.
      Future<void> pumpAt(double scale) async {
        await tester.pumpConsumerWidget(
          MediaQuery(
            data: MediaQueryData(textScaler: TextScaler.linear(scale)),
            child: const CustomScrollView(
              slivers: [
                SliverAppBar(actions: [TimelineGroupingSelector.compact()]),
              ],
            ),
          ),
        );
        await tester.pumpAndSettle();
        await setGrouping(tester, TimelineOverviewMode.months);
      }

      // Default scale: the glyphs are painted at their full intrinsic width (not shrunk, not clipped).
      await pumpAt(1.0);
      expect(find.text('M'), findsOneWidget);
      expect(find.text('Months'), findsNothing);
      final paragraph = tester.renderObject<RenderParagraph>(find.text('M'));
      final intrinsic = paragraph.getMaxIntrinsicWidth(double.infinity);
      expect(tester.getRect(find.text('M')).width, greaterThanOrEqualTo(intrinsic - 0.5));
      expect(tester.takeException(), isNull);

      // Enlarged text: the initial still renders in full (scaled down to fit), bounded by the chip.
      await pumpAt(2.0);
      expect(find.text('M'), findsOneWidget);
      final chipWidth = tester.getSize(find.byKey(const Key('timeline-grouping-compact-selector'))).width;
      expect(tester.getRect(find.text('M')).width, lessThanOrEqualTo(chipWidth));
      expect(tester.takeException(), isNull);
    });
  });
}
