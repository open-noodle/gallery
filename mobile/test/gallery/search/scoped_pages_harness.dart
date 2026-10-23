import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/models/space_album_folder.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/remote_album.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/gallery/search/search.repository.dart';
import 'package:immich_mobile/models/server_info/server_version.model.dart';
import 'package:immich_mobile/pages/library/spaces/space_album_detail.page.dart';
import 'package:immich_mobile/pages/library/spaces/space_detail.page.dart';
import 'package:immich_mobile/presentation/pages/person.page.dart';
import 'package:immich_mobile/presentation/pages/remote_album.page.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/person_timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/server_info.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/services/server_info.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart' as api;

import '../../riverpod_mocks.dart';
import '../../test_utils.dart';
import 'search_mode_harness.dart';
import 'switch_over_harness.dart';

// Slice 6's screens: the real album, space, space album and person pages, with their real TimelineRouteScope, Timeline,
// grouping pill and search, over stand-ins for what each page loads besides its search (album role, space metadata,
// linked albums) and a long timeline of its own to scroll.

/// The ids the pages are opened with: the contract fixtures' (contractIds) in the end-to-end test, short names in the
/// widget tests.
class ScopedPageIds {
  final String albumId;
  final String albumName;
  final String spaceId;
  final String spaceName;
  final String spaceAlbumId;
  final String spaceAlbumName;
  final String personId;
  final String personName;
  final String spacePersonId;
  final String spacePersonName;

  const ScopedPageIds({
    this.albumId = 'album-trip',
    this.albumName = 'Japan 2023',
    this.spaceId = 'space-family',
    this.spaceName = 'Family',
    this.spaceAlbumId = 'album-space-trip',
    this.spaceAlbumName = 'Space trip',
    this.personId = 'anna',
    this.personName = 'Anna',
    this.spacePersonId = 'pia',
    this.spacePersonName = 'Pia',
  });
}

enum ScopedPage { album, space, spaceAlbum, personalPerson, spacePerson }

Widget scopedPage(ScopedPage page, ScopedPageIds ids) => switch (page) {
  ScopedPage.album => RemoteAlbumPage(album: scopedAlbum(ids)),
  ScopedPage.space => SpaceDetailPage(spaceId: ids.spaceId),
  ScopedPage.spaceAlbum => SpaceAlbumDetailPage(spaceId: ids.spaceId, albumId: ids.spaceAlbumId, canEdit: false),
  ScopedPage.personalPerson => PersonPage(
    person: Person(id: ids.personId, name: ids.personName),
  ),
  ScopedPage.spacePerson => PersonPage(
    person: Person(id: ids.spacePersonId, name: ids.spacePersonName, spaceId: ids.spaceId),
  ),
};

RemoteAlbum scopedAlbum(ScopedPageIds ids) => RemoteAlbum(
  id: ids.albumId,
  name: ids.albumName,
  ownerId: testUserId,
  description: '',
  createdAt: DateTime(2026, 1, 1),
  updatedAt: DateTime(2026, 1, 1),
  isActivityEnabled: false,
  order: AlbumAssetOrder.desc,
  assetCount: 3,
  ownerName: 'Me',
  isShared: false,
);

/// Every page's own timeline: [days] days of [perDay] photos, long enough to scroll.
class ScopedTimelineFactory implements TimelineFactory {
  final int days;
  final int perDay;

  /// One line per timeline a page built: `remoteAlbum <id>`, `sharedSpace <id>`, ...
  final calls = <String>[];

  ScopedTimelineFactory({this.days = 60, this.perDay = 4});

  TimelineService _service(String call, TimelineOrigin origin) {
    calls.add(call);
    final buckets = [
      for (var day = 0; day < days; day++)
        TimeBucket(
          date: DateTime(2025, 12, 31).subtract(Duration(days: day)),
          assetCount: perDay,
        ),
    ];
    final assets = <BaseAsset>[
      for (var i = 0; i < days * perDay; i++) TestUtils.createRemoteAsset(id: 'own-$i', ownerId: testUserId),
    ];
    return TimelineService((
      bucketSource: () => Stream.value(buckets),
      assetSource: (offset, count) async {
        final end = (offset + count).clamp(0, assets.length);
        return offset >= end ? const <BaseAsset>[] : assets.sublist(offset, end);
      },
      origin: origin,
    ));
  }

  @override
  TimelineService remoteAlbum({
    required String albumId,
    GroupAssetsBy? groupBy,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _service('remoteAlbum $albumId', TimelineOrigin.remoteAlbum);

  @override
  TimelineService sharedSpace({
    required String spaceId,
    GroupAssetsBy? groupBy,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _service('sharedSpace $spaceId', TimelineOrigin.remoteAlbum);

  @override
  TimelineService spaceAlbum({
    required String spaceId,
    required String albumId,
    GroupAssetsBy? groupBy,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _service('spaceAlbum $albumId', TimelineOrigin.remoteAlbum);

  @override
  TimelineService person(
    String userId,
    String personId, {
    GroupAssetsBy? groupBy,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _service('person $personId', TimelineOrigin.person);

  @override
  TimelineService sharedSpacePerson(
    List<String> assetIds, {
    GroupAssetsBy? groupBy,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _service('sharedSpacePerson', TimelineOrigin.person);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _MockRemoteAlbumService extends Mock implements RemoteAlbumService {}

class _MockSharedSpaceApi extends Mock implements SharedSpaceApiRepository {}

class _MockServerInfoService extends Mock implements ServerInfoService {}

/// The container the scoped pages run in: the Photos search harness's, plus each page's own stand-ins.
ProviderContainer scopedPagesContainer({
  required Drift db,
  required GallerySearchRepository repository,
  ScopedPageIds ids = const ScopedPageIds(),
  ScopedTimelineFactory? timelines,
  bool realDebounce = false,
}) {
  final albums = _MockRemoteAlbumService();
  final album = scopedAlbum(ids);
  when(() => albums.watchAlbum(any())).thenAnswer((_) => Stream.value(album));
  when(() => albums.watchDateRange(any())).thenAnswer((_) => Stream.value((DateTime(2024), DateTime(2024))));
  when(() => albums.getSharedUsers(any())).thenAnswer((_) async => <UserDto>[]);
  when(() => albums.getUserRole(any(), any())).thenAnswer((_) async => AlbumUserRole.editor);

  final spaces = _MockSharedSpaceApi();
  final space = api.SharedSpaceResponseDto(
    createdAt: '2024-01-01T00:00:00.000Z',
    createdById: 'user-member',
    id: ids.spaceId,
    name: ids.spaceName,
    updatedAt: '2024-01-01T00:00:00.000Z',
  );
  when(() => spaces.get(any())).thenAnswer((_) async => space);
  when(() => spaces.getMembers(any())).thenAnswer((_) async => <api.SharedSpaceMemberResponseDto>[]);

  final spaceAlbum = SpaceAlbum(
    id: ids.spaceAlbumId,
    name: ids.spaceAlbumName,
    assetCount: 3,
    showInTimeline: true,
    linkedAt: DateTime.utc(2024),
    updatedAt: DateTime.utc(2024),
    createdAt: DateTime.utc(2024),
  );

  return searchModeContainer(
    db: db,
    repository: repository,
    realDebounce: realDebounce,
    extra: [
      timelineFactoryProvider.overrideWithValue(timelines ?? ScopedTimelineFactory()),
      remoteAlbumServiceProvider.overrideWithValue(albums),
      serverInfoProvider.overrideWith(
        (ref) => StubServerInfoNotifier(
          _MockServerInfoService(),
          version: const ServerVersion(major: 3, minor: 3, patch: 0),
        ),
      ),
      sharedSpaceApiRepositoryProvider.overrideWithValue(spaces),
      spaceAlbumsProvider(ids.spaceId).overrideWith((_) => Stream.value([spaceAlbum])),
      spaceAlbumFoldersProvider(ids.spaceId).overrideWith((_) => Stream.value(const <SpaceAlbumFolder>[])),
      driftSpaceEditableProvider(ids.spaceId).overrideWith((_) async => false),
      driftSharedSpacePersonAssetIdsProvider((
        spaceId: ids.spaceId,
        personId: ids.spacePersonId,
      )).overrideWith((_) async => const <String>[]),
    ],
  );
}

/// Pumps [page] as the app shows it.
Future<void> pumpScopedPage(WidgetTester tester, ProviderContainer container, Widget page) async {
  stubRemoteImages(tester);
  await pumpPhotosPage(tester, container, page: page);
  await settleFrames(tester);
}

/// What the grouping pill's search button does.
Future<void> tapPillSearch(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('timeline-pill-search')));
  await settleFrames(tester);
}

/// The provider container of the page's own route (TimelineRouteScope), where its search lives.
ProviderContainer routeContainer(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byKey(const Key('timeline-grouping-bottom-pill'))));
