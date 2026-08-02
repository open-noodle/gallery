import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/fixed/segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/overview/overview_segment.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.state.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';

/// Seeds [timelineOverviewModeProvider] so a test can start at a given zoom level.
class _SeededOverviewMode extends TimelineOverviewModeNotifier {
  _SeededOverviewMode(this._seed);

  final TimelineOverviewMode _seed;

  @override
  TimelineOverviewMode build() => _seed;
}

void main() {
  /// [pinnedGroupBy] pins `TimelineArgs.groupBy` (the cleanup preview), which always means the
  /// flat grid at that granularity; otherwise the zoom level comes from [mode].
  ProviderContainer containerFor(TimelineOverviewMode mode, {bool dateless = false, GroupAssetsBy? pinnedGroupBy}) {
    final service = TimelineService((
      assetSource: (offset, count) async => const [],
      bucketSource: dateless
          ? () => Stream.value([const Bucket(assetCount: 3), const Bucket(assetCount: 2)])
          : () => Stream.value([
              TimeBucket(date: DateTime(2025), assetCount: 2),
              TimeBucket(date: DateTime(2024), assetCount: 1),
            ]),
      origin: TimelineOrigin.main,
    ));

    final container = ProviderContainer(
      overrides: [
        timelineServiceProvider.overrideWithValue(service),
        timelineArgsProvider.overrideWithValue(
          TimelineArgs(maxWidth: 390, maxHeight: 800, columnCount: 3, groupBy: pinnedGroupBy),
        ),
        timelineOverviewModeProvider.overrideWith(() => _SeededOverviewMode(mode)),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await service.dispose();
    });
    return container;
  }

  test('years mode uses overview segments', () async {
    final container = containerFor(TimelineOverviewMode.years);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<TimelineOverviewSegment>()));
    expect(segments.first.firstAssetIndex, 0);
    expect(segments.last.firstAssetIndex, 2);
  });

  test('months mode uses overview segments', () async {
    final container = containerFor(TimelineOverviewMode.months);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<TimelineOverviewSegment>()));
  });

  test('a pinned day groupBy stays on fixed grid segments', () async {
    final container = containerFor(TimelineOverviewMode.all, pinnedGroupBy: GroupAssetsBy.day);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<FixedSegment>()));
  });

  // The one behaviour this refactor deliberately changed: a pinned `TimelineArgs.groupBy` (the
  // cleanup preview) always means the FLAT GRID at that granularity, even when the zoom level
  // would otherwise render overview cards. Mode and pinned grouping disagree on purpose here —
  // years would mean year cards, but the pinned month must win and produce a month-header grid.
  // Without the pinned short-circuit in `timeline.state.dart` this renders overview cards.
  test('a pinned groupBy wins over the zoom level and renders the grid, not overview cards', () async {
    final container = containerFor(TimelineOverviewMode.years, pinnedGroupBy: GroupAssetsBy.month);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<FixedSegment>()));
    expect(segments, everyElement(isNot(isA<TimelineOverviewSegment>())));
    expect(segments.map((segment) => segment.header), everyElement(HeaderType.month));
  });

  // S-6 ("a pinned groupBy renders the flat grid and never the overview") is not added here:
  // once `pinnedGroupBy` is set, `timeline.state.dart` forces `spec.mode` to `all` internally and
  // never evaluates `timelineGroupingSpecProvider`, so the container's seeded `mode` argument is
  // unobservable. The two tests above already prove FixedSegment-only rendering for a pinned
  // `day` and `month` groupBy (including the not-TimelineOverviewSegment and header assertions) —
  // a third case only varying the (irrelevant) seeded mode would be a duplicate.
  test('S-7: with a pinned groupBy, changing the mode afterwards is ignored', () async {
    final container = containerFor(TimelineOverviewMode.all, pinnedGroupBy: GroupAssetsBy.day);
    await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.years);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<FixedSegment>()));
  });

  // Slice 3: date-less bucket fallback tests

  test('date-less buckets in months mode fall back to fixed grid segments', () async {
    final container = containerFor(TimelineOverviewMode.months, dateless: true);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<FixedSegment>()));
  });

  test('date-less buckets in years mode fall back to fixed grid segments', () async {
    final container = containerFor(TimelineOverviewMode.years, dateless: true);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<FixedSegment>()));
  });

  test('TimeBuckets in months mode still use overview segments', () async {
    final container = containerFor(TimelineOverviewMode.months);

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, everyElement(isA<TimelineOverviewSegment>()));
  });

  test('empty bucket list in months mode produces no segments and no throw', () async {
    final service = TimelineService((
      assetSource: (offset, count) async => const [],
      bucketSource: () => Stream.value(const <Bucket>[]),
      origin: TimelineOrigin.main,
    ));

    final container = ProviderContainer(
      overrides: [
        timelineServiceProvider.overrideWithValue(service),
        timelineArgsProvider.overrideWithValue(const TimelineArgs(maxWidth: 390, maxHeight: 800, columnCount: 3)),
        timelineOverviewModeProvider.overrideWith(() => _SeededOverviewMode(TimelineOverviewMode.months)),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await service.dispose();
    });

    final segments = await container.read(timelineSegmentProvider.future);

    expect(segments, isEmpty);
  });

  // The "Photo Grid" -> "Group by" setting is a header-granularity choice, not the
  // Years/Months/All overview selector (#903). With the selector on "All" the grid must
  // stay a grid, and only the header granularity follows the setting.
  group('grid grouping follows the persisted Group by setting', () {
    late Drift db;

    setUpAll(() async {
      TestWidgetsFlutterBinding.ensureInitialized();
      db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
      await SettingsRepository.ensureInitialized(db);
    });

    setUp(() async {
      await SettingsRepository.instance.clear(SettingsKey.values);
    });

    tearDownAll(() async {
      await SettingsRepository.instance.clear(SettingsKey.values);
      await db.close();
    });

    ProviderContainer settingsBackedContainer() {
      final service = TimelineService((
        assetSource: (offset, count) async => const [],
        bucketSource: () => Stream.value([
          TimeBucket(date: DateTime(2025, 7), assetCount: 4),
          TimeBucket(date: DateTime(2025, 6), assetCount: 2),
        ]),
        origin: TimelineOrigin.main,
      ));

      final container = ProviderContainer(
        overrides: [
          timelineServiceProvider.overrideWithValue(service),
          // No groupBy: the provider must resolve it from the selector + the setting.
          timelineArgsProvider.overrideWithValue(const TimelineArgs(maxWidth: 390, maxHeight: 800, columnCount: 3)),
        ],
      );
      addTearDown(() async {
        container.dispose();
        await service.dispose();
      });
      return container;
    }

    ProviderContainer emptyBucketContainer() {
      final service = TimelineService((
        assetSource: (offset, count) async => const [],
        bucketSource: () => Stream.value(const <Bucket>[]),
        origin: TimelineOrigin.main,
      ));

      final container = ProviderContainer(
        overrides: [
          timelineServiceProvider.overrideWithValue(service),
          timelineArgsProvider.overrideWithValue(const TimelineArgs(maxWidth: 390, maxHeight: 800, columnCount: 3)),
        ],
      );
      addTearDown(() async {
        container.dispose();
        await service.dispose();
      });
      return container;
    }

    test('S-4: empty buckets in Months mode produce no segments and do not throw', () async {
      final container = emptyBucketContainer();
      await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);

      final segments = await container.read(timelineSegmentProvider.future);

      expect(segments, isEmpty);
    });

    test('S-5: empty buckets in All mode with the month setting produce no segments', () async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);
      final container = emptyBucketContainer();

      final segments = await container.read(timelineSegmentProvider.future);

      expect(segments, isEmpty);
    });

    test('month setting renders a grid with month-only headers', () async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);
      final container = settingsBackedContainer();

      final segments = await container.read(timelineSegmentProvider.future);

      expect(segments, everyElement(isA<FixedSegment>()));
      expect(segments.map((segment) => segment.header), everyElement(HeaderType.month));
    });

    test('month + day setting renders a grid with day headers', () async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.day);
      final container = settingsBackedContainer();

      final segments = await container.read(timelineSegmentProvider.future);

      expect(segments, everyElement(isA<FixedSegment>()));
      expect(segments.map((segment) => segment.header), everyElement(HeaderType.monthAndDay));
    });

    test('a leftover year setting falls back to the month + day grid', () async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.year);
      final container = settingsBackedContainer();

      final segments = await container.read(timelineSegmentProvider.future);

      expect(segments, everyElement(isA<FixedSegment>()));
      expect(segments.map((segment) => segment.header), everyElement(HeaderType.monthAndDay));
    });

    test('selecting Months still renders the overview cards', () async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);
      final container = settingsBackedContainer();
      await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.months);

      final segments = await container.read(timelineSegmentProvider.future);

      expect(segments, everyElement(isA<TimelineOverviewSegment>()));
    });

    test('selecting Years still renders the overview cards', () async {
      await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);
      final container = settingsBackedContainer();
      await container.read(timelineOverviewModeProvider.notifier).set(TimelineOverviewMode.years);

      final segments = await container.read(timelineSegmentProvider.future);

      expect(segments, everyElement(isA<TimelineOverviewSegment>()));
    });
  });
}
