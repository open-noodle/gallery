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
  });
}
