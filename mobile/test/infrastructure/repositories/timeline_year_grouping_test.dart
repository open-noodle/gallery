import 'package:drift/drift.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:intl/date_symbol_data_local.dart';

import '../../medium/repository_context.dart';

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

  test('remote() groups generic remote buckets by year', () async {
    final user = await ctx.newUser();
    await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2026, 4, 1, 12));
    await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2026, 8, 1, 12));
    await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2025, 4, 1, 12));

    final buckets = await sut.remote(user.id, GroupAssetsBy.year).bucketSource().first;

    expect(buckets, [TimeBucket(date: DateTime(2026), assetCount: 2), TimeBucket(date: DateTime(2025), assetCount: 1)]);
  });

  test('remote() year buckets fall back to createdAt year when localDateTime is null', () async {
    final user = await ctx.newUser();
    final asset = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2026, 4, 1, 12));
    await (ctx.db.update(
      ctx.db.remoteAssetEntity,
    )..where((row) => row.id.equals(asset.id))).write(const RemoteAssetEntityCompanion(localDateTime: Value(null)));

    final buckets = await sut.remote(user.id, GroupAssetsBy.year).bucketSource().first;

    expect(buckets, [TimeBucket(date: DateTime(2026), assetCount: 1)]);
  });

  test('remoteAlbum() groups remote album buckets by year', () async {
    final user = await ctx.newUser();
    final album = await ctx.newRemoteAlbum(ownerId: user.id, order: AlbumAssetOrder.desc);
    final asset1 = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2026, 4, 1, 12));
    final asset2 = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2026, 8, 1, 12));
    final asset3 = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime(2025, 4, 1, 12));
    await ctx.newRemoteAlbumAsset(albumId: album.id, assetId: asset1.id);
    await ctx.newRemoteAlbumAsset(albumId: album.id, assetId: asset2.id);
    await ctx.newRemoteAlbumAsset(albumId: album.id, assetId: asset3.id);

    final buckets = await sut.remoteAlbum(album.id, GroupAssetsBy.year).bucketSource().first;

    expect(buckets, [TimeBucket(date: DateTime(2026), assetCount: 2), TimeBucket(date: DateTime(2025), assetCount: 1)]);
  });

  test('localAlbum() groups local album buckets by year', () async {
    final album = await ctx.newLocalAlbum();
    final asset1 = await ctx.newLocalAsset(createdAt: DateTime(2026, 4, 1, 12));
    final asset2 = await ctx.newLocalAsset(createdAt: DateTime(2026, 8, 1, 12));
    final asset3 = await ctx.newLocalAsset(createdAt: DateTime(2025, 4, 1, 12));
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: asset1.id);
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: asset2.id);
    await ctx.newLocalAlbumAsset(albumId: album.id, assetId: asset3.id);

    final buckets = await sut.localAlbum(album.id, GroupAssetsBy.year).bucketSource().first;

    expect(buckets, [TimeBucket(date: DateTime(2026), assetCount: 2), TimeBucket(date: DateTime(2025), assetCount: 1)]);
  });
}
