import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:mocktail/mocktail.dart';

class _MockTimelineRepository extends Mock implements DriftTimelineRepository {}

class _MockSettingsRepository extends Mock implements SettingsRepository {}

TimelineQuery _query(TimelineOrigin origin) =>
    (bucketSource: () => const Stream.empty(), assetSource: (_, _) async => const [], origin: origin);

void main() {
  const year = TimelineTemporalScope.year(2025);
  final month = TimelineTemporalScope.month(year: 2025, month: 2);
  final mapOptions = TimelineMapOptions(
    bounds: LatLngBounds(southwest: const LatLng(-89, -179), northeast: const LatLng(89, 179)),
  );

  late _MockTimelineRepository repo;
  late TimelineFactory sut;

  setUp(() {
    repo = _MockTimelineRepository();
    final settingsRepo = _MockSettingsRepository();
    when(() => settingsRepo.appConfig).thenReturn(const AppConfig());
    sut = TimelineFactory(timelineRepository: repo, settingsRepository: settingsRepo);
  });

  test('forwards temporal scope and forced grouping to repository routes', () {
    when(
      () => repo.main(['user-1'], 'user-1', GroupAssetsBy.day, temporalScope: year),
    ).thenReturn(_query(TimelineOrigin.main));
    when(
      () => repo.remote('user-1', GroupAssetsBy.day, temporalScope: year),
    ).thenReturn(_query(TimelineOrigin.remoteAssets));
    when(
      () => repo.localAlbum('local-album-1', GroupAssetsBy.day, temporalScope: year),
    ).thenReturn(_query(TimelineOrigin.localAlbum));
    when(
      () => repo.remoteAlbum('remote-album-1', GroupAssetsBy.day, temporalScope: month),
    ).thenReturn(_query(TimelineOrigin.remoteAlbum));
    when(
      () => repo.sharedSpace('space-1', GroupAssetsBy.month, temporalScope: year),
    ).thenReturn(_query(TimelineOrigin.remoteSpace));
    when(
      () => repo.favorite('user-1', GroupAssetsBy.day, temporalScope: year),
    ).thenReturn(_query(TimelineOrigin.favorite));
    when(() => repo.trash('user-1', GroupAssetsBy.day, temporalScope: year)).thenReturn(_query(TimelineOrigin.trash));
    when(
      () => repo.archived('user-1', GroupAssetsBy.day, temporalScope: year),
    ).thenReturn(_query(TimelineOrigin.archive));
    when(
      () => repo.locked('user-1', GroupAssetsBy.day, temporalScope: year),
    ).thenReturn(_query(TimelineOrigin.lockedFolder));
    when(
      () => repo.video(['user-1'], 'user-1', GroupAssetsBy.day, temporalScope: year),
    ).thenReturn(_query(TimelineOrigin.video));
    when(
      () => repo.place('Paris', ['user-1'], 'user-1', GroupAssetsBy.day, temporalScope: year),
    ).thenReturn(_query(TimelineOrigin.place));
    when(
      () => repo.person('user-1', 'person-1', GroupAssetsBy.day, temporalScope: year),
    ).thenReturn(_query(TimelineOrigin.person));
    when(
      () => repo.map(['user-1'], 'user-1', mapOptions, GroupAssetsBy.day, temporalScope: year),
    ).thenReturn(_query(TimelineOrigin.map));

    sut.main(['user-1'], 'user-1', temporalScope: year, groupBy: GroupAssetsBy.day);
    sut.remoteAssets('user-1', temporalScope: year, groupBy: GroupAssetsBy.day);
    sut.localAlbum(albumId: 'local-album-1', temporalScope: year, groupBy: GroupAssetsBy.day);
    sut.remoteAlbum(albumId: 'remote-album-1', temporalScope: month, groupBy: GroupAssetsBy.day);
    sut.sharedSpace(spaceId: 'space-1', temporalScope: year, groupBy: GroupAssetsBy.month);
    sut.favorite('user-1', temporalScope: year, groupBy: GroupAssetsBy.day);
    sut.trash('user-1', temporalScope: year, groupBy: GroupAssetsBy.day);
    sut.archive('user-1', temporalScope: year, groupBy: GroupAssetsBy.day);
    sut.lockedFolder('user-1', temporalScope: year, groupBy: GroupAssetsBy.day);
    sut.video(['user-1'], 'user-1', temporalScope: year, groupBy: GroupAssetsBy.day);
    sut.place('Paris', ['user-1'], 'user-1', temporalScope: year, groupBy: GroupAssetsBy.day);
    sut.person('user-1', 'person-1', temporalScope: year, groupBy: GroupAssetsBy.day);
    sut.map(['user-1'], 'user-1', mapOptions, temporalScope: year, groupBy: GroupAssetsBy.day);

    verify(() => repo.main(['user-1'], 'user-1', GroupAssetsBy.day, temporalScope: year)).called(1);
    verify(() => repo.remote('user-1', GroupAssetsBy.day, temporalScope: year)).called(1);
    verify(() => repo.localAlbum('local-album-1', GroupAssetsBy.day, temporalScope: year)).called(1);
    verify(() => repo.remoteAlbum('remote-album-1', GroupAssetsBy.day, temporalScope: month)).called(1);
    verify(() => repo.sharedSpace('space-1', GroupAssetsBy.month, temporalScope: year)).called(1);
    verify(() => repo.favorite('user-1', GroupAssetsBy.day, temporalScope: year)).called(1);
    verify(() => repo.trash('user-1', GroupAssetsBy.day, temporalScope: year)).called(1);
    verify(() => repo.archived('user-1', GroupAssetsBy.day, temporalScope: year)).called(1);
    verify(() => repo.locked('user-1', GroupAssetsBy.day, temporalScope: year)).called(1);
    verify(() => repo.video(['user-1'], 'user-1', GroupAssetsBy.day, temporalScope: year)).called(1);
    verify(() => repo.place('Paris', ['user-1'], 'user-1', GroupAssetsBy.day, temporalScope: year)).called(1);
    verify(() => repo.person('user-1', 'person-1', GroupAssetsBy.day, temporalScope: year)).called(1);
    verify(() => repo.map(['user-1'], 'user-1', mapOptions, GroupAssetsBy.day, temporalScope: year)).called(1);
  });
}
