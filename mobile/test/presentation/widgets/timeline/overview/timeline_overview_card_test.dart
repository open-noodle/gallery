import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_card.dart';
import 'package:intl/date_symbol_data_local.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../test_utils.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;

  setUpAll(() async {
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    await initializeDateFormatting('en');
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://test-server');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  Widget wrap(
    Widget child, {
    List<Locale> supportedLocales = const [Locale('en')],
    Locale locale = const Locale('en'),
    TextDirection textDirection = TextDirection.ltr,
    MediaQueryData? mediaQuery,
    ThemeData? theme,
  }) {
    return EasyLocalization(
      supportedLocales: supportedLocales,
      path: '../i18n',
      fallbackLocale: const Locale('en'),
      startLocale: locale,
      child: MaterialApp(
        locale: locale,
        theme: theme,
        home: Directionality(
          textDirection: textDirection,
          child: MediaQuery(
            data: mediaQuery ?? const MediaQueryData(),
            child: Scaffold(body: Center(child: child)),
          ),
        ),
      ),
    );
  }

  testWidgets('year card renders compact label, count, and representative thumbnail', (tester) async {
    final asset = TestUtils.createRemoteAsset(id: 'asset-1', width: 200, height: 100);

    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
          mode: TimelineOverviewMode.years,
          representativeAsset: asset,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('2025'), findsOneWidget);
    expect(find.text('1 photo'), findsOneWidget);
    expect(find.byType(Thumbnail), findsOneWidget);

    final sizedBox = tester.widget<SizedBox>(find.byKey(const ValueKey('timeline-overview-card-size')));
    expect(sizedBox.height, kTimelineOverviewCardHeight);
  });

  testWidgets('month card includes month and year with plural photo count', (tester) async {
    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025, 3), assetCount: 4),
          mode: TimelineOverviewMode.months,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Mar 2025'), findsOneWidget);
    expect(find.text('4 photos'), findsOneWidget);
  });

  testWidgets('fallback surface keeps label and count visible without a thumbnail', (tester) async {
    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2024), assetCount: 2),
          mode: TimelineOverviewMode.years,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('timeline-overview-card-fallback')), findsOneWidget);
    expect(find.text('2024'), findsOneWidget);
    expect(find.text('2 photos'), findsOneWidget);
  });

  testWidgets('actionable year card exposes localized button semantics', (tester) async {
    final semantics = tester.ensureSemantics();
    var taps = 0;

    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
          mode: TimelineOverviewMode.years,
          onTap: () => taps++,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('2025, 1 photo, show months'), findsOneWidget);
    final node = tester.getSemantics(find.bySemanticsLabel('2025, 1 photo, show months'));
    expect(node.flagsCollection.isButton, isTrue);
    expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);

    await tester.tap(find.byType(TimelineOverviewCard));
    await tester.pumpAndSettle();

    expect(taps, 1);
    semantics.dispose();
  });

  testWidgets('actionable month card exposes full localized month and plural count semantics', (tester) async {
    final semantics = tester.ensureSemantics();

    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025, 3), assetCount: 4),
          mode: TimelineOverviewMode.months,
          onTap: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Mar 2025'), findsOneWidget);
    expect(find.bySemanticsLabel('March 2025, 4 photos, show days'), findsOneWidget);
    final node = tester.getSemantics(find.bySemanticsLabel('March 2025, 4 photos, show days'));
    expect(node.flagsCollection.isButton, isTrue);
    expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
    semantics.dispose();
  });

  testWidgets('non-actionable cards do not expose button semantics', (tester) async {
    final semantics = tester.ensureSemantics();

    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025), assetCount: 0),
          mode: TimelineOverviewMode.years,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('2025'), findsOneWidget);
    expect(find.text('0 photos'), findsOneWidget);
    expect(find.bySemanticsLabel('2025, 0 photos, show months'), findsNothing);
    semantics.dispose();
  });

  testWidgets('fallback card keeps actionable semantics when thumbnail is missing', (tester) async {
    final semantics = tester.ensureSemantics();

    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025, 3), assetCount: 2),
          mode: TimelineOverviewMode.months,
          onTap: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('timeline-overview-card-fallback')), findsOneWidget);
    expect(find.bySemanticsLabel('March 2025, 2 photos, show days'), findsOneWidget);
    final node = tester.getSemantics(find.bySemanticsLabel('March 2025, 2 photos, show days'));
    expect(node.flagsCollection.isButton, isTrue);
    expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
    semantics.dispose();
  });

  testWidgets('German locale uses localized month label and English fallback action', (tester) async {
    final semantics = tester.ensureSemantics();
    await initializeDateFormatting('de');

    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025, 3), assetCount: 3),
          mode: TimelineOverviewMode.months,
          onTap: () {},
        ),
        supportedLocales: const [Locale('de'), Locale('en')],
        locale: const Locale('de'),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining(RegExp('Mär|März')), findsWidgets);
    expect(find.bySemanticsLabel(RegExp('März 2025, 3 photos, show days')), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('Arabic locale uses RTL month labels and localized semantics order', (tester) async {
    final semantics = tester.ensureSemantics();
    await initializeDateFormatting('ar');
    var taps = 0;

    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025, 3), assetCount: 5),
          mode: TimelineOverviewMode.months,
          onTap: () => taps++,
        ),
        supportedLocales: const [Locale('ar'), Locale('en')],
        locale: const Locale('ar'),
        textDirection: TextDirection.rtl,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Mar 2025'), findsNothing);
    expect(find.bySemanticsLabel(RegExp('مارس.*show days')), findsOneWidget);

    await tester.tap(find.byType(TimelineOverviewCard));
    expect(taps, 1);
    semantics.dispose();
  });

  testWidgets('rtl card anchors label group to the directional start edge', (tester) async {
    await tester.pumpWidget(
      wrap(
        SizedBox(
          width: 320,
          child: TimelineOverviewCard(
            bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
            mode: TimelineOverviewMode.years,
            onTap: () {},
          ),
        ),
        textDirection: TextDirection.rtl,
      ),
    );
    await tester.pumpAndSettle();

    final cardRect = tester.getRect(find.byKey(const ValueKey('timeline-overview-card-size')));
    final labelRect = tester.getRect(find.text('2025'));

    expect(cardRect.right - labelRect.right, lessThan(labelRect.left - cardRect.left));
  });

  testWidgets('long localized month labels and large text stay within the card', (tester) async {
    await initializeDateFormatting('de');

    await tester.pumpWidget(
      wrap(
        SizedBox(
          width: 240,
          child: TimelineOverviewCard(
            bucket: TimeBucket(date: DateTime(2025, 9), assetCount: 10),
            mode: TimelineOverviewMode.months,
            onTap: () {},
          ),
        ),
        supportedLocales: const [Locale('de'), Locale('en')],
        locale: const Locale('de'),
        mediaQuery: const MediaQueryData(textScaler: TextScaler.linear(2.4)),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.textContaining('Sept'), findsOneWidget);
    expect(find.text('10 photos'), findsOneWidget);
  });

  testWidgets('high contrast fallback preserves legible label and count colors', (tester) async {
    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
          mode: TimelineOverviewMode.years,
        ),
        mediaQuery: const MediaQueryData(highContrast: true),
        theme: ThemeData.dark(),
      ),
    );
    await tester.pumpAndSettle();

    final period = tester.widget<Text>(find.text('2025'));
    final count = tester.widget<Text>(find.text('1 photo'));

    expect(period.style?.color, Colors.white);
    expect(count.style?.color, Colors.black);
  });

  testWidgets('reduced motion overview card has no nonessential animations', (tester) async {
    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
          mode: TimelineOverviewMode.years,
          onTap: () {},
        ),
        mediaQuery: const MediaQueryData(disableAnimations: true, accessibleNavigation: true),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(AnimatedContainer), findsNothing);
    expect(find.byType(AnimatedOpacity), findsNothing);
    expect(find.byType(AnimatedSwitcher), findsNothing);

    await tester.pumpWidget(
      wrap(
        TimelineOverviewCard(
          bucket: TimeBucket(date: DateTime(2025), assetCount: 1),
          mode: TimelineOverviewMode.years,
          onTap: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(AnimatedContainer), findsNothing);
    expect(find.byType(AnimatedOpacity), findsNothing);
    expect(find.byType(AnimatedSwitcher), findsNothing);
  });

  testWidgets('multiple overview cards expose semantics in visual order', (tester) async {
    final semantics = tester.ensureSemantics();

    await tester.pumpWidget(
      wrap(
        Column(
          children: [
            TimelineOverviewCard(
              bucket: TimeBucket(date: DateTime(2025), assetCount: 2),
              mode: TimelineOverviewMode.years,
              onTap: () {},
            ),
            TimelineOverviewCard(
              bucket: TimeBucket(date: DateTime(2024), assetCount: 3),
              mode: TimelineOverviewMode.years,
              onTap: () {},
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('2025, 2 photos, show months'), findsOneWidget);
    expect(find.bySemanticsLabel('2024, 3 photos, show months'), findsOneWidget);
    expect(
      tester.getTopLeft(find.bySemanticsLabel('2025, 2 photos, show months')).dy,
      lessThan(tester.getTopLeft(find.bySemanticsLabel('2024, 3 photos, show months')).dy),
    );

    await tester.pumpWidget(
      wrap(
        Column(
          children: [
            TimelineOverviewCard(
              bucket: TimeBucket(date: DateTime(2025), assetCount: 2),
              mode: TimelineOverviewMode.years,
              onTap: () {},
            ),
            TimelineOverviewCard(
              bucket: TimeBucket(date: DateTime(2024), assetCount: 3),
              mode: TimelineOverviewMode.years,
              onTap: () {},
            ),
          ],
        ),
        textDirection: TextDirection.rtl,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('2025, 2 photos, show months'), findsOneWidget);
    expect(find.bySemanticsLabel('2024, 3 photos, show months'), findsOneWidget);
    expect(
      tester.getTopLeft(find.bySemanticsLabel('2025, 2 photos, show months')).dy,
      lessThan(tester.getTopLeft(find.bySemanticsLabel('2024, 3 photos, show months')).dy),
    );
    semantics.dispose();
  });
}
