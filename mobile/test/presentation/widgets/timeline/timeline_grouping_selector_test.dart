import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
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
            SliverAppBar(actions: [TimelineGroupingSelector()]),
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
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);

      await tester.pumpConsumerWidget(const TimelineGroupingSelector());
      await tester.pumpAndSettle();

      expect(selected(tester, GroupAssetsBy.month), isTrue);
      expect(selected(tester, GroupAssetsBy.day), isFalse);
      expect(selected(tester, GroupAssetsBy.year), isFalse);
    });

    testWidgets('selected segment exposes button semantics without duplicate child text', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);
      final semantics = tester.ensureSemantics();
      try {
        await tester.pumpConsumerWidget(const TimelineGroupingSelector());
        await tester.pumpAndSettle();

        expect(tester.getSemantics(find.byKey(const Key('timeline-grouping-selector'))).label, 'Timeline grouping');
        expect(find.bySemanticsLabel('Years'), findsOneWidget);
        expect(find.bySemanticsLabel('Months'), findsOneWidget);
        expect(find.bySemanticsLabel('Days'), findsOneWidget);

        final years = tester.getSemantics(find.byKey(const Key('timeline-grouping-year')));
        final months = tester.getSemantics(find.byKey(const Key('timeline-grouping-month')));
        final days = tester.getSemantics(find.byKey(const Key('timeline-grouping-day')));

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

    testWidgets('normalizes unsupported auto and none values to Days visually', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.auto);
      await tester.pumpConsumerWidget(const TimelineGroupingSelector());
      await tester.pumpAndSettle();
      expect(selected(tester, GroupAssetsBy.day), isTrue);

      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.none);
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
      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.year);
      expect(selected(tester, GroupAssetsBy.year), isTrue);

      await tester.tap(find.byKey(const Key('timeline-grouping-month')));
      await tester.pumpAndSettle();
      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
      expect(selected(tester, GroupAssetsBy.month), isTrue);

      await tester.tap(find.byKey(const Key('timeline-grouping-day')));
      await tester.pumpAndSettle();
      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
      expect(selected(tester, GroupAssetsBy.day), isTrue);
    });

    testWidgets('settings picker changes update the selector', (tester) async {
      await tester.pumpConsumerWidget(
        const SingleChildScrollView(child: Column(children: [TimelineGroupingSelector(), GroupSettings()])),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.descendant(of: find.byType(GroupSettings), matching: find.text('year')));
      await tester.pumpAndSettle();

      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.year);
      expect(selected(tester, GroupAssetsBy.year), isTrue);
    });

    testWidgets('disabled selector does not write settings', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.day);
      await tester.pumpConsumerWidget(const TimelineGroupingSelector(enabled: false));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('timeline-grouping-year')), warnIfMissed: false);
      await tester.pumpAndSettle();

      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
      expect(selected(tester, GroupAssetsBy.day), isTrue);
    });

    testWidgets('disabled selector removes actionable semantics and does not write settings', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.day);
      final semantics = tester.ensureSemantics();
      try {
        await tester.pumpConsumerWidget(const TimelineGroupingSelector(enabled: false));
        await tester.pumpAndSettle();

        for (final groupBy in timelineGroupingSelectorGroups) {
          final label = switch (groupBy) {
            GroupAssetsBy.year => 'Years',
            GroupAssetsBy.month => 'Months',
            GroupAssetsBy.day => 'Days',
            GroupAssetsBy.auto || GroupAssetsBy.none => 'Days',
          };
          final node = tester.getSemantics(find.byKey(Key('timeline-grouping-${groupBy.name}')));
          expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isFalse, reason: label);
          expect(node.flagsCollection.toStrings(), contains('hasEnabledState'), reason: label);
          expect(node.flagsCollection.toStrings(), isNot(contains('isEnabled')), reason: label);
        }

        await tester.tap(find.byKey(const Key('timeline-grouping-year')), warnIfMissed: false);
        await tester.pumpAndSettle();

        expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
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
      for (final groupBy in timelineGroupingSelectorGroups) {
        expect(tester.getSize(find.byKey(Key('timeline-grouping-${groupBy.name}'))).height, greaterThanOrEqualTo(48));
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
      expect(find.byKey(const Key('timeline-grouping-year')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-month')), findsOneWidget);
      expect(find.byKey(const Key('timeline-grouping-day')), findsOneWidget);
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
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);

      await tester.pumpConsumerWidget(
        const Directionality(textDirection: TextDirection.rtl, child: TimelineGroupingSelector()),
      );
      await tester.pumpAndSettle();

      final years = tester.getCenter(find.byKey(const Key('timeline-grouping-year')));
      final months = tester.getCenter(find.byKey(const Key('timeline-grouping-month')));
      final days = tester.getCenter(find.byKey(const Key('timeline-grouping-day')));

      expect(years.dx, greaterThan(months.dx));
      expect(months.dx, greaterThan(days.dx));

      await tester.tap(find.byKey(const Key('timeline-grouping-day')));
      await tester.pumpAndSettle();

      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
    });

    testWidgets('compact mode renders only the current grouping in a small app-bar chip', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.day);

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
      expect(find.byKey(const Key('timeline-grouping-year')), findsNothing);
      expect(find.byKey(const Key('timeline-grouping-month')), findsNothing);
      expect(find.byKey(const Key('timeline-grouping-day')), findsNothing);
      expect(find.text('Day'), findsOneWidget);
      expect(find.text('Days'), findsNothing);
      expect(find.byIcon(Icons.expand_more_rounded), findsNothing);
      expect(tester.getSize(find.byKey(const Key('timeline-grouping-compact-selector'))).width, lessThanOrEqualTo(92));
    });

    testWidgets('compact mode tapping Day zooms out to Month', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.day);

      await tester.pumpConsumerWidget(const TimelineGroupingSelector.compact());
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('timeline-grouping-compact-selector')));
      await tester.pumpAndSettle();

      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
      expect(find.text('Month'), findsOneWidget);
    });

    testWidgets('compact mode bounces between extremes', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.year);
      await tester.pumpConsumerWidget(const TimelineGroupingSelector.compact());
      await tester.pumpAndSettle();

      final selector = find.byKey(const Key('timeline-grouping-compact-selector'));

      // Year -> Month -> Day (heading down)
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);

      // Day -> Month -> Year (direction inverted at Day; preserved through Month)
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.year);
    });

    testWidgets('compact mode opens a direct selection menu on long press', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.day);

      await tester.pumpConsumerWidget(const TimelineGroupingSelector.compact());
      await tester.pumpAndSettle();

      await tester.longPress(find.byKey(const Key('timeline-grouping-compact-selector')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('timeline-grouping-menu-month')));
      await tester.pumpAndSettle();

      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
      expect(find.text('Month'), findsOneWidget);
      expect(find.text('Months'), findsNothing);
    });

    testWidgets('compact mode resumes bouncing after a long-press menu selection', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.day);
      await tester.pumpConsumerWidget(const TimelineGroupingSelector.compact());
      await tester.pumpAndSettle();

      final selector = find.byKey(const Key('timeline-grouping-compact-selector'));

      // Pick Year directly via the long-press menu.
      await tester.longPress(selector);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('timeline-grouping-menu-year')));
      await tester.pumpAndSettle();
      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.year);

      // Subsequent taps bounce down: Year -> Month -> Day.
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
      await tester.tap(selector);
      await tester.pumpAndSettle();
      expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
    });

    testWidgets('compact mode fits Month without ellipsizing at large mobile text scale', (tester) async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);

      await tester.pumpConsumerWidget(
        const MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(1.25)),
          child: CustomScrollView(
            slivers: [
              SliverAppBar(actions: [TimelineGroupingSelector.compact()]),
            ],
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Month'), findsOneWidget);
      expect(find.textContaining('...'), findsNothing);
      expect(tester.getSize(find.byKey(const Key('timeline-grouping-compact-selector'))).width, lessThanOrEqualTo(112));
      expect(tester.takeException(), isNull);
    });
  });
}
