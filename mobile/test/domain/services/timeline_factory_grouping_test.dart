import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/config/timeline_config.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:mocktail/mocktail.dart';

class _MockTimelineRepository extends Mock implements TimelineRepository {}

class _MockSettingsRepository extends Mock implements SettingsRepository {}

void main() {
  late _MockSettingsRepository settingsRepo;
  late TimelineFactory factory;

  setUp(() {
    settingsRepo = _MockSettingsRepository();
    factory = TimelineFactory(timelineRepository: _MockTimelineRepository(), settingsRepository: settingsRepo);
  });

  void storedSetting(GroupAssetsBy value) {
    when(() => settingsRepo.appConfig).thenReturn(AppConfig(timeline: TimelineConfig(groupAssetsBy: value)));
  }

  test('F-1: month is preserved', () {
    storedSetting(GroupAssetsBy.month);
    expect(factory.groupBy, GroupAssetsBy.month);
  });

  test('F-2: day is preserved', () {
    storedSetting(GroupAssetsBy.day);
    expect(factory.groupBy, GroupAssetsBy.day);
  });

  test('F-3: a leftover year falls back to day', () {
    storedSetting(GroupAssetsBy.year);
    expect(factory.groupBy, GroupAssetsBy.day);
  });

  test('F-4: auto falls back to day', () {
    storedSetting(GroupAssetsBy.auto);
    expect(factory.groupBy, GroupAssetsBy.day);
  });

  test('none falls back to day as a persisted value', () {
    storedSetting(GroupAssetsBy.none);
    expect(factory.groupBy, GroupAssetsBy.day);
  });
}
