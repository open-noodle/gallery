import 'package:drift/drift.dart' show Value;
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/infrastructure/repositories/remote_album.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/space_album.repository.dart';

import '../repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late SpaceAlbumRepository repo;

  setUp(() {
    ctx = MediumRepositoryContext();
    repo = SpaceAlbumRepository(ctx.db);
  });
  tearDown(() => ctx.dispose());

  group('isAlbumLinked', () {
    test('true when the album has a space link, false otherwise', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final linked = await ctx.newSharedSpaceAlbum(name: 'Linked');
      final unlinked = await ctx.newSharedSpaceAlbum(name: 'Unlinked');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: linked.id);

      expect(await repo.isAlbumLinked(linked.id), isTrue);
      expect(await repo.isAlbumLinked(unlinked.id), isFalse);
    });
  });

  group('watchLinkedAlbums', () {
    test('emits the linked albums (metadata + showInTimeline) for a space', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final a1 = await ctx.newSharedSpaceAlbum(name: 'Hawaii');
      final a2 = await ctx.newSharedSpaceAlbum(name: 'Reef');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: a1.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: a2.id, showInTimeline: false);

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.map((a) => a.id), containsAll([a1.id, a2.id]));
      expect(albums.firstWhere((a) => a.id == a2.id).showInTimeline, isFalse);
      expect(albums.firstWhere((a) => a.id == a1.id).name, 'Hawaii');
    });

    test('excludes albums linked to a different space', () async {
      final user = await ctx.newUser();
      final s1 = await ctx.newSharedSpace(createdById: user.id);
      final s2 = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      await ctx.insertSharedSpaceAlbumLink(spaceId: s2.id, albumId: album.id);
      final albums = await repo.watchLinkedAlbums(s1.id).first;
      expect(albums, isEmpty);
    });

    test('assetCount reflects shared_space_album_asset rows for each album', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final a1 = await ctx.newSharedSpaceAlbum(name: 'Hawaii');
      final a2 = await ctx.newSharedSpaceAlbum(name: 'Reef');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: a1.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: a2.id);

      // Insert 2 assets for a1, 0 for a2
      final asset1 = await ctx.newRemoteAsset(ownerId: user.id);
      final asset2 = await ctx.newRemoteAsset(ownerId: user.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: a1.id, assetId: asset1.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: a1.id, assetId: asset2.id);

      final albums = await repo.watchLinkedAlbums(space.id).first;
      final hawaii = albums.firstWhere((a) => a.id == a1.id);
      final reef = albums.firstWhere((a) => a.id == a2.id);
      expect(hawaii.assetCount, 2);
      expect(reef.assetCount, 0);
    });

    test('assetCount counts only visible assets — excludes hidden, deleted, and unsynced (mobile-5)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Mixed');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);

      final visibleTimeline = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.timeline);
      final visibleArchive = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.archive);
      final hidden = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.hidden);
      final deleted = await ctx.newRemoteAsset(ownerId: user.id, deletedAt: DateTime(2026, 1, 1));

      // 4 membership rows with a remote_asset + 1 membership row whose asset was
      // never synced (no remote_asset row at all) → only 2 are visible.
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: visibleTimeline.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: visibleArchive.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: hidden.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: deleted.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: 'never-synced-asset');

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.single.assetCount, 2, reason: 'timeline + archive only; hidden/deleted/unsynced excluded');
    });

    test('assetCount is 0 for an album with no visible assets but the album still lists (mobile-5)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'AllHidden');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);
      final hidden = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.hidden);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: hidden.id);

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.map((a) => a.id), contains(album.id), reason: 'album must still appear on the shelf');
      expect(albums.single.assetCount, 0);
    });

    test('watchLinkedAlbums exposes linkedAt (link.createdAt) and updatedAt (meta.updatedAt)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final linked = DateTime.utc(2026, 1, 2);
      final updated = DateTime.utc(2026, 3, 4);
      final album = await ctx.newSharedSpaceAlbum(name: 'Alpha', updatedAt: updated);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, createdAt: linked);

      final albums = await repo.watchLinkedAlbums(space.id).first;

      expect(albums.single.linkedAt, linked);
      expect(albums.single.updatedAt, updated);
    });

    test('projects the album createdAt from the metadata row', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Hawaii', createdAt: DateTime.utc(2025, 6, 1));
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.single.createdAt, album.createdAt);
    });

    // #973 — the album search box matches the description, so the join has to
    // carry it. It is only ever read for search, hence no other coverage.
    test('projects the album description from the metadata row, null when unset', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final described = await ctx.newSharedSpaceAlbum(name: 'Hawaii', description: 'Reef dives, 2025');
      final bare = await ctx.newSharedSpaceAlbum(name: 'Reef');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: described.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: bare.id);

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.firstWhere((a) => a.id == described.id).description, 'Reef dives, 2025');
      expect(albums.firstWhere((a) => a.id == bare.id).description, isNull);
    });

    test('derives startDate/endDate from the album assets, truncated to a UTC day', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Hawaii');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);

      for (final at in [
        DateTime.utc(2026, 1, 5, 9, 30),
        DateTime.utc(2026, 1, 20, 17, 45),
        DateTime.utc(2026, 1, 12, 3, 0),
      ]) {
        final asset = await ctx.newRemoteAsset(ownerId: user.id, createdAt: at);
        await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);
      }

      final albums = await repo.watchLinkedAlbums(space.id).first;
      // S15 — day precision, matching the server's ::date cast. Times of day gone.
      expect(albums.single.startDate, DateTime.utc(2026, 1, 5));
      expect(albums.single.endDate, DateTime.utc(2026, 1, 20));
    });

    test('leaves startDate/endDate null for an album with no assets', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Empty');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.single.assetCount, 0);
      expect(albums.single.startDate, isNull);
      expect(albums.single.endDate, isNull);
    });

    // S13 — remote_asset.localDateTime is nullable, so MIN/MAX can be null even
    // for an album that has assets. Such an album must be treated exactly like
    // an empty one for the date range, but its asset count is unaffected.
    test('startDate/endDate stay null when every asset has a null localDateTime (S13)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'NoDates');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);

      final asset1 = await ctx.newRemoteAsset(ownerId: user.id, localDateTime: const Value(null));
      final asset2 = await ctx.newRemoteAsset(ownerId: user.id, localDateTime: const Value(null));
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset1.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset2.id);

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.single.assetCount, 2, reason: 'asset count must be unaffected by missing localDateTime');
      expect(albums.single.startDate, isNull);
      expect(albums.single.endDate, isNull);
    });

    test('excludes deleted and hidden assets from the date range', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Hawaii');
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);

      final visible = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime.utc(2026, 1, 10));
      final deleted = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2026, 5, 1),
        deletedAt: DateTime.utc(2026, 5, 2),
      );
      final hidden = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2026, 6, 1),
        visibility: AssetVisibility.hidden,
      );
      for (final a in [visible, deleted, hidden]) {
        await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: a.id);
      }

      final albums = await repo.watchLinkedAlbums(space.id).first;
      expect(albums.single.assetCount, 1);
      expect(albums.single.endDate, DateTime.utc(2026, 1, 10));
    });

    // S20
    test('reports the per-space link date when an album is linked to two spaces', () async {
      final user = await ctx.newUser();
      final s1 = await ctx.newSharedSpace(createdById: user.id);
      final s2 = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum(name: 'Shared');
      await ctx.insertSharedSpaceAlbumLink(spaceId: s1.id, albumId: album.id, createdAt: DateTime.utc(2026, 1, 1));
      await ctx.insertSharedSpaceAlbumLink(spaceId: s2.id, albumId: album.id, createdAt: DateTime.utc(2026, 3, 1));

      final inS1 = await repo.watchLinkedAlbums(s1.id).first;
      final inS2 = await repo.watchLinkedAlbums(s2.id).first;
      expect(inS1.single.linkedAt, DateTime.utc(2026, 1, 1));
      expect(inS2.single.linkedAt, DateTime.utc(2026, 3, 1));
    });
  });

  test('deleteAlbumMetadata removes metadata + membership but keeps remote_asset', () async {
    final user = await ctx.newUser();
    final album = await ctx.newSharedSpaceAlbum();
    final asset = await ctx.newRemoteAsset(ownerId: user.id);
    await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);

    await repo.deleteAlbumMetadata(album.id);

    final meta = await ctx.db.select(ctx.db.sharedSpaceAlbumEntity).get();
    final membership = await ctx.db.select(ctx.db.sharedSpaceAlbumAssetEntity).get();
    final assets = await ctx.db.select(ctx.db.remoteAssetEntity).get();
    expect(meta, isEmpty); // metadata gone
    expect(membership, isEmpty); // membership swept
    expect(assets.map((a) => a.id), contains(asset.id)); // blob retained
  });

  test('deleteLink removes only the (spaceId, albumId) row, keeps metadata + membership', () async {
    final user = await ctx.newUser();
    final space = await ctx.newSharedSpace(createdById: user.id);
    final album = await ctx.newSharedSpaceAlbum();
    final asset = await ctx.newRemoteAsset(ownerId: user.id);
    await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id);
    await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);

    await repo.deleteLink(spaceId: space.id, albumId: album.id);

    expect(await ctx.db.select(ctx.db.sharedSpaceAlbumLinkEntity).get(), isEmpty);
    expect(await ctx.db.select(ctx.db.sharedSpaceAlbumEntity).get(), isNotEmpty);
    expect(await ctx.db.select(ctx.db.sharedSpaceAlbumAssetEntity).get(), isNotEmpty);
  });

  group('absorbed album add-photos (mobile F1 regression)', () {
    test('local junction write throws on an absorbed album (no remote_album row), leaving no junction row', () async {
      final user = await ctx.newUser();
      final asset = await ctx.newRemoteAsset(ownerId: user.id);
      final localRepo = RemoteAlbumRepository(ctx.db);

      // An absorbed linked album lives only in shared_space_album — it has no
      // remote_album row. The personal-album add path batch-inserts into
      // remote_album_asset, whose FK albumId -> remote_album is enforced, so the
      // write fails (the empirical FK 787 bug the new server-only path avoids).
      await expectLater(localRepo.addAssets('absorbed-album', [asset.id]), throwsA(anything));

      // The failed transaction rolls back; the server-only fix never performs
      // this local insert, so the junction table stays empty either way.
      expect(await ctx.db.select(ctx.db.remoteAlbumAssetEntity).get(), isEmpty);
    });
  });
}
