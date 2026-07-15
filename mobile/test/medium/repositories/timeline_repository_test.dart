import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:intl/date_symbol_data_local.dart';

import '../repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late DriftTimelineRepository sut;

  setUpAll(() async {
    await initializeDateFormatting();
  });

  setUp(() {
    ctx = MediumRepositoryContext();
    sut = DriftTimelineRepository(ctx.db);
  });

  tearDown(() async {
    await ctx.dispose();
  });

  group('remoteAlbum assets', () {
    test('no duplicate assets when identical checksum appears in multiple local asset rows', () async {
      // Regression check for #23273: a LEFT OUTER JOIN on checksum would fan out and create duplicates
      // happens when same photo exists in multiple albums on device
      final user = await ctx.newUser();
      final checksum = 'yolo';
      final album = await ctx.newRemoteAlbum(ownerId: user.id);
      final remoteAsset = await ctx.newRemoteAsset(ownerId: user.id, checksum: checksum);
      await ctx.newRemoteAlbumAsset(albumId: album.id, assetId: remoteAsset.id);

      final localAsset1 = await ctx.newLocalAsset(checksum: checksum);
      final localAsset2 = await ctx.newLocalAsset(checksum: checksum);

      final query = sut.remoteAlbum(album.id, .day);

      final buckets = await query.bucketSource().first;
      expect(buckets, hasLength(1));
      expect(buckets.single.assetCount, 1);

      final assets = await query.assetSource(0, 10);
      expect(assets, hasLength(1));
      expect((assets.first as RemoteAsset).id, remoteAsset.id);
      expect([localAsset1.id, localAsset2.id], contains((assets.first as RemoteAsset).localId));
    });
  });

  group('person assets', () {
    test('does not duplicate an asset that has multiple face records for the same person', () async {
      // Regression check for #26723: an INNER JOIN between remote_asset_entity and asset_face_entity
      // fanned out one asset into N rows when N face records pointed at the same (asset, person) pair
      final user = await ctx.newUser();
      final asset = await ctx.newRemoteAsset(ownerId: user.id);

      final person = await ctx.newPerson(ownerId: user.id);
      await ctx.newFace(assetId: asset.id, personId: person.id);
      await ctx.newFace(assetId: asset.id, personId: person.id);

      final query = sut.person(user.id, person.id, .day);

      final buckets = await query.bucketSource().first;
      expect(buckets, hasLength(1));
      expect(buckets.single.assetCount, 1);

      final assets = await query.assetSource(0, 10);
      expect(assets, hasLength(1));
      expect((assets.first as RemoteAsset).id, asset.id);
    });
  });

  group('aggregated-space stack collapse (#751)', () {
    test('collapses a stack to its primary in the grouped space timeline', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      const stackId = 'space-stack-1';
      final primary = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId);
      final child = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId);
      await ctx.insertStack(id: stackId, ownerId: user.id, primaryAssetId: primary.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: primary.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: child.id);

      final query = sut.sharedSpace(space.id, GroupAssetsBy.day);

      final buckets = await query.bucketSource().first;
      expect(buckets.fold<int>(0, (sum, b) => sum + b.assetCount), 1);

      final assets = await query.assetSource(0, 10);
      expect(assets, hasLength(1));
      expect((assets.single as RemoteAsset).id, primary.id);
    });

    test('collapses the ungrouped (none) space count query', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      const stackId = 'space-stack-2';
      final primary = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId);
      final child = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId);
      await ctx.insertStack(id: stackId, ownerId: user.id, primaryAssetId: primary.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: primary.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: child.id);

      final buckets = await sut.sharedSpace(space.id, GroupAssetsBy.none).bucketSource().first;
      expect(buckets.fold<int>(0, (sum, b) => sum + b.assetCount), 1);
    });

    test('keeps an un-stacked asset alongside a collapsed stack', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      const stackId = 'space-stack-3';
      final primary = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId);
      final child = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId);
      final loner = await ctx.newRemoteAsset(ownerId: user.id);
      await ctx.insertStack(id: stackId, ownerId: user.id, primaryAssetId: primary.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: primary.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: child.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: loner.id);

      final query = sut.sharedSpace(space.id, GroupAssetsBy.day);

      final buckets = await query.bucketSource().first;
      expect(buckets.fold<int>(0, (sum, b) => sum + b.assetCount), 2);

      final assets = await query.assetSource(0, 10);
      expect(assets.map((a) => (a as RemoteAsset).id), containsAll([primary.id, loner.id]));
      expect(assets.map((a) => (a as RemoteAsset).id), isNot(contains(child.id)));
    });
  });

  group('live photos', () {
    test('remote-only live photo contains livePhotoVideoId and is marked as a motion photo', () async {
      final user = await ctx.newUser();
      final asset = await ctx.newRemoteAsset(ownerId: user.id, livePhotoVideoId: 'motion-photo-1');

      final assets = await sut.main([user.id], user.id, GroupAssetsBy.day).assetSource(0, 10);

      expect(assets, hasLength(1));
      final remote = assets.single as RemoteAsset;
      expect(remote.id, asset.id);
      expect(remote.livePhotoVideoId, 'motion-photo-1');
      expect(remote.isMotionPhoto, isTrue);
      expect(remote.localId, isNull);
    });

    test('merged live photo resolves localId and is marked as a motion photo', () async {
      final user = await ctx.newUser();
      const checksum = 'shared-live-photo-checksum';
      final asset = await ctx.newRemoteAsset(ownerId: user.id, checksum: checksum, livePhotoVideoId: 'motion-photo-2');
      final local = await ctx.newLocalAsset(checksum: checksum);

      final assets = await sut.main([user.id], user.id, GroupAssetsBy.day).assetSource(0, 10);

      expect(assets, hasLength(1));
      final remote = assets.single as RemoteAsset;
      expect(remote.id, asset.id);
      expect(remote.livePhotoVideoId, 'motion-photo-2');
      expect(remote.isMotionPhoto, isTrue);
      expect(remote.localId, local.id);
    });
  });
}
