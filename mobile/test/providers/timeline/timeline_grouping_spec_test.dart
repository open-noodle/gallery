import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Drift db;
  late ProviderContainer container;

  setUpAll(() async {
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await SettingsRepository.ensureInitialized(db);
  });

  // SettingsRepository.instance is a process-wide singleton: without this clear, a value
  // written by one test leaks into the next and the failures look like ordering flakes.
  setUp(() async {
    await SettingsRepository.instance.clear(SettingsKey.values);
    container = ProviderContainer();
  });

  tearDown(() => container.dispose());

  tearDownAll(() async {
    await SettingsRepository.instance.clear(SettingsKey.values);
    await db.close();
  });

  Future<void> setGridSetting(GroupAssetsBy value) =>
      SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, value);

  Future<void> setMode(TimelineOverviewMode mode) => container.read(timelineOverviewModeProvider.notifier).set(mode);

  group('timelineGroupingSpecProvider', () {
    test('M-1: years queries and renders at year granularity', () async {
      await setMode(TimelineOverviewMode.years);
      final spec = container.read(timelineGroupingSpecProvider);
      expect(spec.mode, TimelineOverviewMode.years);
      expect(spec.groupBy, GroupAssetsBy.year);
    });

    test('M-2: months queries and renders at month granularity', () async {
      await setMode(TimelineOverviewMode.months);
      final spec = container.read(timelineGroupingSpecProvider);
      expect(spec.mode, TimelineOverviewMode.months);
      expect(spec.groupBy, GroupAssetsBy.month);
    });

    test('M-3: all with Month + day selected renders day headers', () async {
      await setGridSetting(GroupAssetsBy.day);
      await setMode(TimelineOverviewMode.all);
      final spec = container.read(timelineGroupingSpecProvider);
      expect(spec.mode, TimelineOverviewMode.all);
      expect(spec.groupBy, GroupAssetsBy.day);
    });

    test('M-4: all with Month selected renders month headers — the #903 case', () async {
      await setGridSetting(GroupAssetsBy.month);
      await setMode(TimelineOverviewMode.all);
      final spec = container.read(timelineGroupingSpecProvider);
      expect(spec.mode, TimelineOverviewMode.all);
      expect(spec.groupBy, GroupAssetsBy.month);
    });

    test('M-5: years ignores the grid setting', () async {
      await setGridSetting(GroupAssetsBy.month);
      await setMode(TimelineOverviewMode.years);
      expect(container.read(timelineGroupingSpecProvider).groupBy, GroupAssetsBy.year);
    });

    test('M-6: on all, the spec follows a setting change', () async {
      await setGridSetting(GroupAssetsBy.day);
      await setMode(TimelineOverviewMode.all);
      expect(container.read(timelineGroupingSpecProvider).groupBy, GroupAssetsBy.day);

      await setGridSetting(GroupAssetsBy.month);
      await Future<void>.delayed(const Duration(milliseconds: 5));
      expect(container.read(timelineGroupingSpecProvider).groupBy, GroupAssetsBy.month);
    });

    test('M-7: on months, a setting change leaves the spec alone', () async {
      await setGridSetting(GroupAssetsBy.day);
      await setMode(TimelineOverviewMode.months);
      expect(container.read(timelineGroupingSpecProvider).groupBy, GroupAssetsBy.month);

      await setGridSetting(GroupAssetsBy.month);
      await Future<void>.delayed(const Duration(milliseconds: 5));
      expect(container.read(timelineGroupingSpecProvider).groupBy, GroupAssetsBy.month);
    });

    test('the mode starts at all', () {
      expect(container.read(timelineOverviewModeProvider), TimelineOverviewMode.all);
    });
  });
}
