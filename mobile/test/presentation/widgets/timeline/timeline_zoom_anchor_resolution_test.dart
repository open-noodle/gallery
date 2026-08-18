import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/models/timeline_zoom_anchor.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';
import 'package:immich_mobile/providers/timeline/zoom_anchor.provider.dart';
import 'package:intl/date_symbol_data_local.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../test_utils.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;

  setUpAll(() async {
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    await initializeDateFormatting('en');
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await SettingsRepository.ensureInitialized(db);
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await Store.put(StoreKey.serverEndpoint, 'http://test-server');
    await SettingsRepository.instance.write(SettingsKey.timelineTilesPerRow, 3);
  });

  tearDownAll(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await db.close();
  });

  testWidgets('resolves a year anchor in months mode and clears it after scrolling', (tester) async {
    final service = _service([
      TimeBucket(date: DateTime(2026, 4), assetCount: 8),
      TimeBucket(date: DateTime(2026, 3), assetCount: 8),
      TimeBucket(date: DateTime(2026, 2), assetCount: 8),
      TimeBucket(date: DateTime(2026, 1), assetCount: 8),
      TimeBucket(date: DateTime(2025, 12), assetCount: 8),
      TimeBucket(date: DateTime(2025, 11), assetCount: 8),
      TimeBucket(date: DateTime(2024, 12), assetCount: 8),
      TimeBucket(date: DateTime(2024, 11), assetCount: 8),
    ]);
    addTearDown(service.dispose);

    await _pumpTimeline(tester, service);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));
    await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);
    await tester.pumpAndSettle();

    ref.read(timelineZoomAnchorProvider.notifier).setYear(2025);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(_scrollPixels(tester), greaterThan(0));
  });

  testWidgets('resolves a month anchor in all mode and clears it after scrolling', (tester) async {
    final service = _service([
      TimeBucket(date: DateTime(2025, 5, 2), assetCount: 9),
      TimeBucket(date: DateTime(2025, 4, 2), assetCount: 9),
      TimeBucket(date: DateTime(2025, 3, 20), assetCount: 9),
      TimeBucket(date: DateTime(2025, 3, 1), assetCount: 9),
      TimeBucket(date: DateTime(2025, 2, 1), assetCount: 9),
      TimeBucket(date: DateTime(2025, 1, 1), assetCount: 9),
    ]);
    addTearDown(service.dispose);

    await _pumpTimeline(tester, service);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));

    ref.read(timelineZoomAnchorProvider.notifier).setMonth(year: 2025, month: 3);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(_scrollPixels(tester), greaterThan(0));
  });

  // #903: with "Group by" set to Month, drilling a month card down to All lands on a photo
  // grid of month buckets — the month anchor must still resolve against those buckets.
  testWidgets('resolves a month anchor on a month-grouped grid and clears it after scrolling', (tester) async {
    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);
    final service = _service([
      TimeBucket(date: DateTime(2025, 6), assetCount: 9),
      TimeBucket(date: DateTime(2025, 5), assetCount: 9),
      TimeBucket(date: DateTime(2025, 4), assetCount: 9),
      TimeBucket(date: DateTime(2025, 3), assetCount: 9),
      TimeBucket(date: DateTime(2025, 2), assetCount: 9),
      TimeBucket(date: DateTime(2025), assetCount: 9),
    ]);
    addTearDown(service.dispose);

    await _pumpTimeline(tester, service);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));
    // The selector stays on All: the month bucketing comes from the setting, not the selector.
    expect(ref.read(timelineOverviewModeProvider), TimelineOverviewMode.all);

    ref.read(timelineZoomAnchorProvider.notifier).setMonth(year: 2025, month: 3);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pumpAndSettle();

    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.none());
    expect(_scrollPixels(tester), greaterThan(0));
  });

  testWidgets('keeps a missing year anchor pending without scrolling', (tester) async {
    final service = _service([
      TimeBucket(date: DateTime(2026, 4), assetCount: 8),
      TimeBucket(date: DateTime(2026, 3), assetCount: 8),
      TimeBucket(date: DateTime(2024, 12), assetCount: 8),
      TimeBucket(date: DateTime(2024, 11), assetCount: 8),
    ]);
    addTearDown(service.dispose);

    await _pumpTimeline(tester, service);
    final ref = ProviderScope.containerOf(tester.element(find.byType(Timeline)));
    await ref.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);
    await tester.pumpAndSettle();

    ref.read(timelineZoomAnchorProvider.notifier).setYear(2025);
    await tester.pump();
    await tester.pumpAndSettle();

    expect(ref.read(timelineZoomAnchorProvider), const TimelineZoomAnchor.year(2025));
    expect(_scrollPixels(tester), 0);
  });
}

TimelineService _service(List<Bucket> buckets) {
  final assets = <BaseAsset>[
    for (var i = 0; i < buckets.fold<int>(0, (total, bucket) => total + bucket.assetCount); i++)
      TestUtils.createRemoteAsset(id: 'asset-$i'),
  ];

  return TimelineService((
    bucketSource: () => Stream.value(buckets),
    assetSource: (offset, count) async {
      final end = (offset + count).clamp(0, assets.length);
      if (offset >= end) {
        return const <BaseAsset>[];
      }
      return assets.sublist(offset, end);
    },
    origin: TimelineOrigin.main,
  ));
}

Future<void> _pumpTimeline(WidgetTester tester, TimelineService service) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        timelineServiceProvider.overrideWithValue(service),
        timelineZoomAnchorProvider.overrideWith(TimelineZoomAnchorNotifier.new),
      ],
      child: EasyLocalization(
        supportedLocales: const [Locale('en')],
        path: '../i18n',
        fallbackLocale: const Locale('en'),
        child: const MaterialApp(home: Timeline(appBar: null, bottomSheet: null, withScrubber: false)),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

double _scrollPixels(WidgetTester tester) {
  return tester.state<ScrollableState>(find.byType(Scrollable).first).position.pixels;
}
