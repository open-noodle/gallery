import 'package:drift/drift.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/table/people/asset_face.drift.dart';
import 'package:immich_mobile/data/db/main/table/people/person.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/exif.drift.dart';
import 'package:immich_mobile/data/db/main/table/user/partner.drift.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/album/local_album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/map.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

import '../../medium/repository_context.dart';

Future<List<TimeBucket>> timeBuckets(TimelineQuery query) async {
  final buckets = await query.bucketSource().first;
  return buckets.cast<TimeBucket>();
}

Future<List<String>> assetIds(TimelineQuery query) async {
  final assets = await query.assetSource(0, 100);
  return assets.map((asset) => asset.remoteId ?? asset.localId!).toList();
}

Future<List<Bucket>> buckets(TimelineQuery query) => query.bucketSource().first;

LatLngBounds globeBounds() => LatLngBounds(southwest: const LatLng(-89, -179), northeast: const LatLng(89, 179));

void main() {
  late MediumRepositoryContext ctx;
  late TimelineRepository sut;

  setUpAll(() async {
    await initializeDateFormatting('en');
  });

  setUp(() {
    ctx = MediumRepositoryContext();
    sut = TimelineRepository(ctx.db);
  });

  tearDown(() async {
    await ctx.dispose();
  });

  Future<void> insertExif(String assetId, {String? city, double? lat, double? lng}) {
    return ctx.db
        .into(ctx.db.remoteExifEntity)
        .insert(
          RemoteExifEntityCompanion.insert(
            assetId: assetId,
            city: Value(city),
            latitude: Value(lat),
            longitude: Value(lng),
          ),
        );
  }

  Future<void> insertPerson(String id, String ownerId) {
    return ctx.db
        .into(ctx.db.personEntity)
        .insert(
          PersonEntityCompanion.insert(
            id: id,
            ownerId: ownerId,
            name: 'Person $id',
            isFavorite: false,
            isHidden: false,
          ),
        );
  }

  Future<void> insertFace(String assetId, String personId, {bool visible = true, DateTime? deletedAt}) {
    return ctx.db
        .into(ctx.db.assetFaceEntity)
        .insert(
          AssetFaceEntityCompanion.insert(
            id: 'face-$assetId',
            assetId: assetId,
            personId: Value(personId),
            imageWidth: 100,
            imageHeight: 100,
            boundingBoxX1: 0,
            boundingBoxY1: 0,
            boundingBoxX2: 10,
            boundingBoxY2: 10,
            sourceType: 'machine-learning',
            isVisible: Value(visible),
            deletedAt: Value(deletedAt),
          ),
        );
  }

  Future<void> insertPartner({required String sharedById, required String sharedWithId, bool inTimeline = true}) {
    return ctx.db
        .into(ctx.db.partnerEntity)
        .insert(
          PartnerEntityCompanion.insert(
            sharedById: sharedById,
            sharedWithId: sharedWithId,
            inTimeline: Value(inTimeline),
          ),
        );
  }

  test('main() year scope filters buckets and assets for current user and partner', () async {
    final currentUser = await ctx.newUser(id: 'user-1');
    final partner = await ctx.newUser(id: 'partner-1');
    final otherUser = await ctx.newUser(id: 'other-1');
    await insertPartner(sharedById: partner.id, sharedWithId: currentUser.id);

    await ctx.newRemoteAsset(id: 'current-in', ownerId: currentUser.id, createdAt: DateTime(2025, 5, 1, 12));
    await ctx.newRemoteAsset(id: 'partner-in', ownerId: partner.id, createdAt: DateTime(2025, 6, 1, 12));
    await ctx.newRemoteAsset(id: 'current-old', ownerId: currentUser.id, createdAt: DateTime(2024, 5, 1, 12));
    await ctx.newRemoteAsset(id: 'partner-old', ownerId: partner.id, createdAt: DateTime(2024, 6, 1, 12));
    await ctx.newRemoteAsset(id: 'other-in', ownerId: otherUser.id, createdAt: DateTime(2025, 7, 1, 12));

    const scope = TimelineTemporalScope.year(2025);
    final query = sut.main([currentUser.id, partner.id], currentUser.id, GroupAssetsBy.month, temporalScope: scope);

    expect(await timeBuckets(query), [
      TimeBucket(date: DateTime(2025, 6), assetCount: 1),
      TimeBucket(date: DateTime(2025, 5), assetCount: 1),
    ]);
    expect(await assetIds(query), ['partner-in', 'current-in']);
  });

  test('main() year scope preserves merged local-only semantics', () async {
    final currentUser = await ctx.newUser(id: 'user-1');
    final partner = await ctx.newUser(id: 'partner-1');
    await insertPartner(sharedById: partner.id, sharedWithId: currentUser.id);

    await ctx.newRemoteAsset(id: 'current-in', ownerId: currentUser.id, createdAt: DateTime(2025, 5, 1, 12));
    await ctx.newRemoteAsset(id: 'partner-in', ownerId: partner.id, createdAt: DateTime(2025, 6, 1, 12));
    await ctx.newRemoteAsset(
      id: 'remote-duplicate',
      ownerId: currentUser.id,
      checksum: 'duplicate-checksum',
      createdAt: DateTime(2025, 7, 1, 12),
    );

    final selectedAlbum = await ctx.newLocalAlbum(backupSelection: BackupSelection.selected);
    final excludedAlbum = await ctx.newLocalAlbum(backupSelection: BackupSelection.excluded);
    final selectedInScope = await ctx.newLocalAsset(id: 'local-in', createdAt: DateTime(2025, 4, 1, 12));
    final selectedOutOfScope = await ctx.newLocalAsset(id: 'local-old', createdAt: DateTime(2024, 4, 1, 12));
    final excluded = await ctx.newLocalAsset(id: 'local-excluded', createdAt: DateTime(2025, 3, 1, 12));
    final duplicateLocal1 = await ctx.newLocalAsset(
      id: 'duplicate-local-1',
      checksum: 'duplicate-checksum',
      createdAt: DateTime(2025, 2, 1, 12),
    );
    final duplicateLocal2 = await ctx.newLocalAsset(
      id: 'duplicate-local-2',
      checksum: 'duplicate-checksum',
      createdAt: DateTime(2025, 1, 1, 12),
    );
    await ctx.newLocalAlbumAsset(albumId: selectedAlbum.id, assetId: selectedInScope.id);
    await ctx.newLocalAlbumAsset(albumId: selectedAlbum.id, assetId: selectedOutOfScope.id);
    await ctx.newLocalAlbumAsset(albumId: excludedAlbum.id, assetId: excluded.id);
    await ctx.newLocalAlbumAsset(albumId: selectedAlbum.id, assetId: duplicateLocal1.id);
    await ctx.newLocalAlbumAsset(albumId: selectedAlbum.id, assetId: duplicateLocal2.id);

    const scope = TimelineTemporalScope.year(2025);
    final query = sut.main([currentUser.id, partner.id], currentUser.id, GroupAssetsBy.month, temporalScope: scope);

    expect(await timeBuckets(query), [
      TimeBucket(date: DateTime(2025, 7), assetCount: 1),
      TimeBucket(date: DateTime(2025, 6), assetCount: 1),
      TimeBucket(date: DateTime(2025, 5), assetCount: 1),
      TimeBucket(date: DateTime(2025, 4), assetCount: 1),
    ]);
    expect(await assetIds(query), ['remote-duplicate', 'partner-in', 'current-in', 'local-in']);
  });

  test('remote() year scope filters buckets and assets and GroupAssetsBy.none count', () async {
    final user = await ctx.newUser();
    await ctx.newRemoteAsset(id: 'in-1', ownerId: user.id, createdAt: DateTime(2025, 5, 1, 12));
    await ctx.newRemoteAsset(id: 'in-2', ownerId: user.id, createdAt: DateTime(2025, 6, 1, 12));
    await ctx.newRemoteAsset(id: 'out-year', ownerId: user.id, createdAt: DateTime(2024, 5, 1, 12));
    final otherUser = await ctx.newUser();
    await ctx.newRemoteAsset(id: 'out-owner', ownerId: otherUser.id, createdAt: DateTime(2025, 5, 1, 12));

    final query = sut.remote(user.id, GroupAssetsBy.month, temporalScope: const TimelineTemporalScope.year(2025));

    expect(await timeBuckets(query), [
      TimeBucket(date: DateTime(2025, 6), assetCount: 1),
      TimeBucket(date: DateTime(2025, 5), assetCount: 1),
    ]);
    expect(await assetIds(query), ['in-2', 'in-1']);
    expect(
      await buckets(sut.remote(user.id, GroupAssetsBy.none, temporalScope: const TimelineTemporalScope.year(2025))),
      [const Bucket(assetCount: 2)],
    );
  });

  test('favorite/archive/trash/locked year scopes preserve route constraints', () async {
    final user = await ctx.newUser();
    await ctx.newRemoteAsset(id: 'favorite', ownerId: user.id, createdAt: DateTime(2025, 1, 1, 12), isFavorite: true);
    await ctx.newRemoteAsset(
      id: 'archive',
      ownerId: user.id,
      createdAt: DateTime(2025, 1, 2, 12),
      visibility: AssetVisibility.archive,
    );
    await ctx.newRemoteAsset(
      id: 'trash',
      ownerId: user.id,
      createdAt: DateTime(2025, 1, 3, 12),
      deletedAt: DateTime(2025, 2, 1),
    );
    await ctx.newRemoteAsset(
      id: 'locked',
      ownerId: user.id,
      createdAt: DateTime(2025, 1, 4, 12),
      visibility: AssetVisibility.locked,
    );
    await ctx.newRemoteAsset(
      id: 'favorite-old',
      ownerId: user.id,
      createdAt: DateTime(2024, 1, 1, 12),
      isFavorite: true,
    );

    const scope = TimelineTemporalScope.year(2025);
    expect(await assetIds(sut.favorite(user.id, GroupAssetsBy.year, temporalScope: scope)), ['favorite']);
    expect(await assetIds(sut.archived(user.id, GroupAssetsBy.year, temporalScope: scope)), ['archive']);
    expect(await assetIds(sut.trash(user.id, GroupAssetsBy.year, temporalScope: scope)), ['trash']);
    expect(await assetIds(sut.locked(user.id, GroupAssetsBy.year, temporalScope: scope)), ['locked']);
  });

  test('remoteAlbum() month scope filters buckets/assets and GroupAssetsBy.none count', () async {
    final user = await ctx.newUser();
    final album = await ctx.newRemoteAlbum(ownerId: user.id, order: AlbumAssetOrder.desc);
    final feb = await ctx.newRemoteAsset(id: 'feb', ownerId: user.id, createdAt: DateTime(2024, 2, 29, 12));
    final mar = await ctx.newRemoteAsset(id: 'mar', ownerId: user.id, createdAt: DateTime(2024, 3, 1, 12));
    final otherAlbum = await ctx.newRemoteAsset(
      id: 'other-album',
      ownerId: user.id,
      createdAt: DateTime(2024, 2, 10, 12),
    );
    await ctx.newRemoteAlbumAsset(albumId: album.id, assetId: feb.id);
    await ctx.newRemoteAlbumAsset(albumId: album.id, assetId: mar.id);

    final scope = TimelineTemporalScope.month(year: 2024, month: 2);
    final query = sut.remoteAlbum(album.id, GroupAssetsBy.day, temporalScope: scope);

    expect(await timeBuckets(query), [TimeBucket(date: DateTime(2024, 2, 29), assetCount: 1)]);
    expect(await assetIds(query), [feb.id]);
    expect(
      await assetIds(
        sut.remoteAlbum(album.id, GroupAssetsBy.day, temporalScope: const TimelineTemporalScope.year(2024)),
      ),
      [mar.id, feb.id],
    );
    expect(
      await assetIds(sut.remote(otherAlbum.ownerId, GroupAssetsBy.day, temporalScope: scope)),
      contains(otherAlbum.id),
    );
    expect(await buckets(sut.remoteAlbum(album.id, GroupAssetsBy.none, temporalScope: scope)), [
      const Bucket(assetCount: 1),
    ]);
  });

  test('localAlbum() year scope filters buckets/assets and GroupAssetsBy.none count', () async {
    final album = await ctx.newLocalAlbum();
    final inScope = await ctx.newLocalAsset(id: 'local-in', createdAt: DateTime(2025, 4, 1, 12));
    final outScope = await ctx.newLocalAsset(id: 'local-old', createdAt: DateTime(2024, 4, 1, 12));
    final otherAlbum = await ctx.newLocalAsset(id: 'local-other', createdAt: DateTime(2025, 4, 1, 12));
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: inScope.id);
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: outScope.id);

    const scope = TimelineTemporalScope.year(2025);
    final query = sut.localAlbum(album.id, GroupAssetsBy.month, temporalScope: scope);

    expect(await timeBuckets(query), [TimeBucket(date: DateTime(2025, 4), assetCount: 1)]);
    expect(await assetIds(query), [inScope.id]);
    expect(
      await assetIds(sut.localAlbum(album.id, GroupAssetsBy.month, temporalScope: const TimelineTemporalScope.none())),
      [inScope.id, outScope.id],
    );
    expect(
      await assetIds(sut.localAlbum(album.id, GroupAssetsBy.month, temporalScope: scope)),
      isNot(contains(otherAlbum.id)),
    );
    expect(await buckets(sut.localAlbum(album.id, GroupAssetsBy.none, temporalScope: scope)), [
      const Bucket(assetCount: 1),
    ]);
  });

  test('sharedSpace() year scope keeps direct membership and GroupAssetsBy.none count', () async {
    final user = await ctx.newUser();
    final space = await ctx.newSharedSpace(createdById: user.id);
    final inScope = await ctx.newRemoteAsset(id: 'space-in', ownerId: user.id, createdAt: DateTime(2025, 7, 1, 12));
    final outScope = await ctx.newRemoteAsset(id: 'space-old', ownerId: user.id, createdAt: DateTime(2024, 7, 1, 12));
    await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: inScope.id);
    await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: outScope.id);

    const scope = TimelineTemporalScope.year(2025);
    expect(await assetIds(sut.sharedSpace(space.id, GroupAssetsBy.year, temporalScope: scope)), [inScope.id]);
    expect(await buckets(sut.sharedSpace(space.id, GroupAssetsBy.none, temporalScope: scope)), [
      const Bucket(assetCount: 1),
    ]);
  });

  test('sharedSpace() year scope keeps library membership and deduplicates direct matches', () async {
    final user = await ctx.newUser();
    final space = await ctx.newSharedSpace(createdById: user.id);
    final library = await ctx.newLibrary(ownerId: user.id);
    final direct = await ctx.newRemoteAsset(id: 'space-direct', ownerId: user.id, createdAt: DateTime(2025, 9, 1, 12));
    final libraryInScope = await ctx.newRemoteAsset(
      id: 'space-library-in',
      ownerId: user.id,
      libraryId: library.id,
      createdAt: DateTime(2025, 8, 1, 12),
    );
    final libraryOutOfScope = await ctx.newRemoteAsset(
      id: 'space-library-old',
      ownerId: user.id,
      libraryId: library.id,
      createdAt: DateTime(2024, 8, 1, 12),
    );
    final directAndLibrary = await ctx.newRemoteAsset(
      id: 'space-direct-library',
      ownerId: user.id,
      libraryId: library.id,
      createdAt: DateTime(2025, 7, 1, 12),
    );
    await ctx.insertSharedSpaceLibrary(spaceId: space.id, libraryId: library.id);
    await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: direct.id);
    await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: directAndLibrary.id);

    const scope = TimelineTemporalScope.year(2025);
    expect(await timeBuckets(sut.sharedSpace(space.id, GroupAssetsBy.month, temporalScope: scope)), [
      TimeBucket(date: DateTime(2025, 9), assetCount: 1),
      TimeBucket(date: DateTime(2025, 8), assetCount: 1),
      TimeBucket(date: DateTime(2025, 7), assetCount: 1),
    ]);
    expect(await assetIds(sut.sharedSpace(space.id, GroupAssetsBy.month, temporalScope: scope)), [
      direct.id,
      libraryInScope.id,
      directAndLibrary.id,
    ]);
    expect(
      await assetIds(sut.sharedSpace(space.id, GroupAssetsBy.month, temporalScope: scope)),
      isNot(contains(libraryOutOfScope.id)),
    );
    expect(await buckets(sut.sharedSpace(space.id, GroupAssetsBy.none, temporalScope: scope)), [
      const Bucket(assetCount: 3),
    ]);
  });

  test('video/place/person/map year scopes preserve constraints', () async {
    final user = await ctx.newUser();
    await insertPerson('person-1', user.id);
    final video = await ctx.newRemoteAsset(
      id: 'video',
      ownerId: user.id,
      createdAt: DateTime(2025, 1, 1, 12),
      type: AssetType.video,
    );
    final place = await ctx.newRemoteAsset(id: 'place', ownerId: user.id, createdAt: DateTime(2025, 2, 1, 12));
    final person = await ctx.newRemoteAsset(id: 'person', ownerId: user.id, createdAt: DateTime(2025, 3, 1, 12));
    final map = await ctx.newRemoteAsset(id: 'map', ownerId: user.id, createdAt: DateTime.now(), isFavorite: true);
    await ctx.newRemoteAsset(
      id: 'old-video',
      ownerId: user.id,
      createdAt: DateTime(2024, 1, 1, 12),
      type: AssetType.video,
    );
    await insertExif(place.id, city: 'Paris');
    await insertFace(person.id, 'person-1');
    await insertExif(map.id, lat: 48.85, lng: 2.35);

    const scope = TimelineTemporalScope.year(2025);
    expect(await assetIds(sut.video([user.id], user.id, GroupAssetsBy.year, temporalScope: scope)), [video.id]);
    expect(await assetIds(sut.place('Paris', [user.id], user.id, GroupAssetsBy.year, temporalScope: scope)), [
      place.id,
    ]);
    expect(await assetIds(sut.person(user.id, 'person-1', GroupAssetsBy.year, temporalScope: scope)), [person.id]);
    expect(await buckets(sut.person(user.id, 'person-1', GroupAssetsBy.none, temporalScope: scope)), [
      const Bucket(assetCount: 1),
    ]);
    expect(
      await assetIds(
        sut.geographicMap(
          [user.id],
          user.id,
          () => TimelineMapOptions(bounds: globeBounds(), onlyFavorites: true, includeArchived: true, relativeDays: 30),
          const Stream<TimelineMapOptions>.empty(),
          GroupAssetsBy.year,
          temporalScope: TimelineTemporalScope.year(DateTime.now().year),
        ),
      ),
      [map.id],
    );
  });

  test('year boundaries and createdAt fallback use the correct scope', () async {
    final user = await ctx.newUser();
    await ctx.newRemoteAsset(id: 'dec31', ownerId: user.id, createdAt: DateTime(2024, 12, 31, 23, 59));
    await ctx.newRemoteAsset(id: 'jan1', ownerId: user.id, createdAt: DateTime(2025, 1, 1, 12));
    final fallback = await ctx.newRemoteAsset(id: 'fallback', ownerId: user.id, createdAt: DateTime(2025, 8, 1, 12));
    await (ctx.db.update(
      ctx.db.remoteAssetEntity,
    )..where((row) => row.id.equals(fallback.id))).write(const RemoteAssetEntityCompanion(localDateTime: Value(null)));

    expect(
      await assetIds(sut.remote(user.id, GroupAssetsBy.year, temporalScope: const TimelineTemporalScope.year(2024))),
      ['dec31'],
    );
    expect(
      await assetIds(sut.remote(user.id, GroupAssetsBy.year, temporalScope: const TimelineTemporalScope.year(2025))),
      ['fallback', 'jan1'],
    );
  });
}
