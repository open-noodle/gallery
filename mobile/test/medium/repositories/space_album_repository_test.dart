import 'package:flutter_test/flutter_test.dart';
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
      final localRepo = DriftRemoteAlbumRepository(ctx.db);

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
