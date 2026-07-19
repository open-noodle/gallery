// `hide isNull`: drift and flutter_test both export `isNull`; this test uses
// drift's Value()/.equals() (space-album link writes) and flutter_test's isNull
// matcher (live-photos group merged in from main), so drift's must yield.
import 'package:drift/drift.dart' hide isNull;
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_album_link.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/stack.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:intl/date_symbol_data_local.dart';

import '../repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late TimelineRepository sut;

  setUpAll(() async {
    await initializeDateFormatting();
  });

  setUp(() {
    ctx = MediumRepositoryContext();
    sut = TimelineRepository(ctx.db);
  });

  tearDown(() async {
    await ctx.dispose();
  });

  group('remoteAlbum assets', () {
    test('no duplicate assets when identical checksum appears in multiple local asset rows', () async {
      // Regression check for #23273: a LEFT OUTER JOIN on checksum would fan out and create duplicates
      // happens when same photo exists in multiple albums on device
      final user = await ctx.newUser();
      const checksum = 'yolo';
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

    test('orders shifted album assets in both directions and keeps normal asset order (#28852)', () async {
      final user = await ctx.newUser();
      final descendingAlbum = await ctx.newRemoteAlbum(ownerId: user.id, order: .desc);
      final ascendingAlbum = await ctx.newRemoteAlbum(ownerId: user.id, order: .asc);
      final shiftedLater = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2024, 9, 2, 12),
        localDateTime: DateTime.utc(2024, 9, 3, 12),
      );
      final shiftedEarlier = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2024, 9, 3, 12),
        localDateTime: DateTime.utc(2024, 9, 2, 12),
      );
      final normalLater = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2024, 9, 4, 14),
        localDateTime: DateTime.utc(2024, 9, 4, 14),
      );
      final normalEarlier = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2024, 9, 4, 12),
        localDateTime: DateTime.utc(2024, 9, 4, 12),
      );
      final seeded = [shiftedLater, shiftedEarlier, normalLater, normalEarlier];
      for (final asset in seeded) {
        await ctx.newRemoteAlbumAsset(albumId: descendingAlbum.id, assetId: asset.id);
        await ctx.newRemoteAlbumAsset(albumId: ascendingAlbum.id, assetId: asset.id);
      }

      final descending = sut.remoteAlbum(descendingAlbum.id, .day);
      final ascending = sut.remoteAlbum(ascendingAlbum.id, .day);

      final buckets = await descending.bucketSource().first;
      expect(buckets, hasLength(3));
      expect(buckets.map((bucket) => bucket.assetCount), [2, 1, 1]);

      final descendingAssets = await descending.assetSource(0, 10);
      expect(descendingAssets.map((asset) => (asset as RemoteAsset).id), [
        normalLater.id,
        normalEarlier.id,
        shiftedLater.id,
        shiftedEarlier.id,
      ]);

      final ascendingAssets = await ascending.assetSource(0, 10);
      expect(ascendingAssets.map((asset) => (asset as RemoteAsset).id), [
        shiftedEarlier.id,
        shiftedLater.id,
        normalEarlier.id,
        normalLater.id,
      ]);
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

    test('orders shifted person assets by effective date (#28852)', () async {
      final user = await ctx.newUser();
      final person = await ctx.newPerson(ownerId: user.id);
      final shiftedLater = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2024, 9, 2, 12),
        localDateTime: DateTime.utc(2024, 9, 3, 12),
      );
      final shiftedEarlier = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2024, 9, 3, 12),
        localDateTime: DateTime.utc(2024, 9, 2, 12),
      );
      await ctx.newFace(assetId: shiftedLater.id, personId: person.id);
      await ctx.newFace(assetId: shiftedEarlier.id, personId: person.id);

      final query = sut.person(user.id, person.id, .day);

      final buckets = await query.bucketSource().first;
      expect(buckets, hasLength(2));

      final assets = await query.assetSource(0, 10);
      expect(assets.map((asset) => (asset as RemoteAsset).id), [shiftedLater.id, shiftedEarlier.id]);
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

  group('localAlbum assets', () {
    late String userId;
    late String otherUserId;

    setUp(() async {
      final user = await ctx.newUser();
      userId = user.id;
      await ctx.newAuthUser(id: userId);
      final other = await ctx.newUser();
      otherUserId = other.id;
    });

    test('does not duplicate assets when a partner shares the checksum', () async {
      const checksum = 'shared-partner-checksum';
      final album = await ctx.newLocalAlbum();
      final local = await ctx.newLocalAsset(checksum: checksum);
      await ctx.newLocalAlbumAsset(albumId: album.id, assetId: local.id);
      final myRemote = await ctx.newRemoteAsset(ownerId: userId, checksum: checksum);
      await ctx.newRemoteAsset(ownerId: otherUserId, checksum: checksum);

      final assets = await sut.localAlbum(album.id, .day).assetSource(0, 10);

      expect(assets, hasLength(1));
      final asset = assets.single as LocalAsset;
      expect(asset.id, local.id);
      // Must resolve the current user's remote id
      expect(asset.remoteId, myRemote.id);
    });

    test('bucket count ignores a partner sharing the checksum', () async {
      const checksum = 'shared-partner-checksum';
      final album = await ctx.newLocalAlbum();
      final local = await ctx.newLocalAsset(checksum: checksum);
      await ctx.newLocalAlbumAsset(albumId: album.id, assetId: local.id);
      await ctx.newRemoteAsset(ownerId: userId, checksum: checksum);
      await ctx.newRemoteAsset(ownerId: otherUserId, checksum: checksum);

      final buckets = await sut.localAlbum(album.id, .day).bucketSource().first;

      expect(buckets, hasLength(1));
      expect(buckets.single.assetCount, 1);
    });
  });

  group('spaceAlbum query', () {
    test('returns exactly the album assets regardless of showInTimeline', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final inAlbum = await ctx.newRemoteAsset(ownerId: user.id);
      final notInAlbum = await ctx.newRemoteAsset(ownerId: user.id);
      // off-timeline link → still returned by the detail query
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: false);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: inAlbum.id);

      final assets = await sut.spaceAlbum(space.id, album.id, .none).assetSource(0, 100);
      final ids = assets.map((a) => (a as RemoteAsset).id);
      expect(ids, contains(inAlbum.id));
      expect(ids, isNot(contains(notInAlbum.id)));
    });
  });

  group('sharedSpace album branch', () {
    test('includes an album asset when its link showInTimeline = true', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final asset = await ctx.newRemoteAsset(ownerId: user.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);

      final assets = await sut.sharedSpace(space.id, .none).assetSource(0, 100);
      final ids = assets.map((a) => (a as RemoteAsset).id);
      expect(ids, contains(asset.id));
    });

    test('excludes an album asset when its link showInTimeline = false', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final asset = await ctx.newRemoteAsset(ownerId: user.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: false);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);

      final assets = await sut.sharedSpace(space.id, .none).assetSource(0, 100);
      final ids = assets.map((a) => (a as RemoteAsset).id);
      expect(ids, isNot(contains(asset.id)));
    });

    test('counts an asset once when it is both album-linked and direct-added', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final asset = await ctx.newRemoteAsset(ownerId: user.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: asset.id);

      final assets = await sut.sharedSpace(space.id, .none).assetSource(0, 100);
      final matching = assets.where((a) => (a as RemoteAsset).id == asset.id);
      expect(matching, hasLength(1));
    });

    test('an album in two spaces shows its asset in each space timeline', () async {
      final user = await ctx.newUser();
      final s1 = await ctx.newSharedSpace(createdById: user.id);
      final s2 = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final asset = await ctx.newRemoteAsset(ownerId: user.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: s1.id, albumId: album.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumLink(spaceId: s2.id, albumId: album.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);

      final a1 = await sut.sharedSpace(s1.id, .none).assetSource(0, 100);
      final a2 = await sut.sharedSpace(s2.id, .none).assetSource(0, 100);
      expect(a1.map((a) => (a as RemoteAsset).id), contains(asset.id));
      expect(a2.map((a) => (a as RemoteAsset).id), contains(asset.id));
    });

    // B6 regression pin: flipping showInTimeline on the link row removes the
    // album's asset from the space timeline (and re-adding it brings it back).
    //
    // This test was ALREADY GREEN on first run from B0 (the union query already
    // honours the showInTimeline filter). It is pinned here as an explicit
    // regression guard so that future query refactors can't silently break this
    // data contract.
    test('toggle-flip regression: updating showInTimeline flips asset in/out of space timeline', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final asset = await ctx.newRemoteAsset(ownerId: user.id);

      // Start: showInTimeline = true → asset is in the space timeline.
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: asset.id);

      final before = await sut.sharedSpace(space.id, .none).assetSource(0, 100);
      expect(before.map((a) => (a as RemoteAsset).id), contains(asset.id));

      // Simulate the sync-nudge delivering the toggled PATCH result:
      // update the link row to showInTimeline = false.
      await (ctx.db.update(ctx.db.sharedSpaceAlbumLinkEntity)
            ..where((t) => t.spaceId.equals(space.id) & t.albumId.equals(album.id)))
          .write(const SharedSpaceAlbumLinkEntityCompanion(showInTimeline: Value(false)));

      // After toggle: asset must be excluded from the space timeline.
      final after = await sut.sharedSpace(space.id, .none).assetSource(0, 100);
      expect(after.map((a) => (a as RemoteAsset).id), isNot(contains(asset.id)));

      // Re-enable: asset returns.
      await (ctx.db.update(ctx.db.sharedSpaceAlbumLinkEntity)
            ..where((t) => t.spaceId.equals(space.id) & t.albumId.equals(album.id)))
          .write(const SharedSpaceAlbumLinkEntityCompanion(showInTimeline: Value(true)));

      final restored = await sut.sharedSpace(space.id, .none).assetSource(0, 100);
      expect(restored.map((a) => (a as RemoteAsset).id), contains(asset.id));
    });
  });

  group('mobile-6: archived visibility', () {
    // Sum of per-bucket assetCount == number of visible assets in the timeline.
    Future<int> bucketTotal(TimelineQuery q) async {
      final buckets = await q.bucketSource().first;
      return buckets.fold<int>(0, (sum, b) => sum + b.assetCount);
    }

    test('spaceAlbum detail returns an Archived album asset (sites 4-6)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final archived = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.archive);
      final hidden = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.hidden);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: true);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: archived.id);
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: hidden.id);

      // Site 6: assetSource.
      final assets = await sut.spaceAlbum(space.id, album.id, GroupAssetsBy.none).assetSource(0, 100);
      final ids = assets.map((a) => (a as RemoteAsset).id).toList();
      expect(ids, contains(archived.id), reason: 'archived album asset must surface on mobile');
      expect(ids, isNot(contains(hidden.id)), reason: 'hidden must never leak');

      // Site 4 (groupBy none count) + Site 5 (groupBy day): 1 visible (archived) only.
      expect(await bucketTotal(sut.spaceAlbum(space.id, album.id, GroupAssetsBy.none)), 1);
      expect(await bucketTotal(sut.spaceAlbum(space.id, album.id, GroupAssetsBy.day)), 1);
    });

    test('sharedSpace timeline returns an Archived direct-added asset (sites 1-3)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final archived = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.archive);
      final hidden = await ctx.newRemoteAsset(ownerId: user.id, visibility: AssetVisibility.hidden);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: archived.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: hidden.id);

      // Site 3: assetSource.
      final assets = await sut.sharedSpace(space.id, GroupAssetsBy.none).assetSource(0, 100);
      final ids = assets.map((a) => (a as RemoteAsset).id).toList();
      expect(ids, contains(archived.id), reason: 'archived direct-added asset must surface on mobile');
      expect(ids, isNot(contains(hidden.id)), reason: 'hidden must never leak');

      // Site 1 (groupBy none count) + Site 2 (groupBy day): 1 visible (archived) only.
      expect(await bucketTotal(sut.sharedSpace(space.id, GroupAssetsBy.none)), 1);
      expect(await bucketTotal(sut.sharedSpace(space.id, GroupAssetsBy.day)), 1);
    });
  });

  group('aggregated-space stack collapse (S3)', () {
    const stackId = 'stack-1';
    final createdAt = DateTime(2024, 1, 1, 12);

    Future<void> insertStack(String id, String ownerId, String primaryAssetId) => ctx.db
        .into(ctx.db.stackEntity)
        .insert(StackEntityCompanion.insert(id: id, ownerId: ownerId, primaryAssetId: primaryAssetId));

    test('collapses a 3-frame stack to its cover in assetSource + bucket count (E20/E23)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final primary = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child1 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child2 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      await insertStack(stackId, user.id, primary.id);
      for (final a in [primary, child1, child2]) {
        await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: a.id);
      }

      // asset query: only the cover survives
      final assets = await sut.sharedSpace(space.id, GroupAssetsBy.none).assetSource(0, 100);
      expect(assets.map((a) => (a as RemoteAsset).id).toList(), [primary.id]);

      // bucket-count query agrees: one day bucket with count 1
      final buckets = await sut.sharedSpace(space.id, GroupAssetsBy.day).bucketSource().first;
      expect(buckets, hasLength(1));
      expect((buckets.single as TimeBucket).assetCount, 1);

      // the flat (none) count builder also collapses (sum of segment counts == 1)
      final noneBuckets = await sut.sharedSpace(space.id, GroupAssetsBy.none).bucketSource().first;
      expect(noneBuckets.fold<int>(0, (sum, b) => sum + b.assetCount), 1);
    });

    test('does NOT collapse the space-album detail timeline (E21)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final album = await ctx.newSharedSpaceAlbum();
      final primary = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child1 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child2 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      await insertStack(stackId, user.id, primary.id);
      await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: album.id, showInTimeline: true);
      for (final a in [primary, child1, child2]) {
        await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: a.id);
      }

      final assets = await sut.spaceAlbum(space.id, album.id, GroupAssetsBy.none).assetSource(0, 100);
      expect(assets.map((a) => (a as RemoteAsset).id).toSet(), {primary.id, child1.id, child2.id});

      // the album count builder likewise stays uncollapsed (all 3 counted)
      final albumBuckets = await sut.spaceAlbum(space.id, album.id, GroupAssetsBy.none).bucketSource().first;
      expect(albumBuckets.fold<int>(0, (sum, b) => sum + b.assetCount), 3);
    });

    test('legacy partial stack (only non-primary frames are members) yields zero (E22)', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      final primary = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child1 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      final child2 = await ctx.newRemoteAsset(ownerId: user.id, stackId: stackId, createdAt: createdAt);
      await insertStack(stackId, user.id, primary.id);
      // Only the NON-primary frames are direct members; the primary is absent.
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: child1.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: child2.id);

      final assets = await sut.sharedSpace(space.id, GroupAssetsBy.none).assetSource(0, 100);
      // non-primary frames are collapsed out; the primary isn't a member → nothing shows
      // (consistent with server/web timeline; documented limitation).
      expect(assets, isEmpty);
    });

    test('shows a stack flat (not vanished) when its stack row is not synced locally', () async {
      final user = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: user.id);
      // A viewer sees another member's stacked frames with stack_id set, but no
      // stack_entity row (stack_entity only syncs for own/partner stacks). The
      // collapse must degrade to a flat view, never hide the frames.
      final frame1 = await ctx.newRemoteAsset(ownerId: user.id, stackId: 'unsynced-stack', createdAt: createdAt);
      final frame2 = await ctx.newRemoteAsset(ownerId: user.id, stackId: 'unsynced-stack', createdAt: createdAt);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: frame1.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: frame2.id);
      // Deliberately NO insertStack(...) — the stack_entity row is absent.

      final assets = await sut.sharedSpace(space.id, GroupAssetsBy.none).assetSource(0, 100);
      expect(assets.map((a) => (a as RemoteAsset).id).toSet(), {frame1.id, frame2.id});

      // count builder agrees: both frames counted, none dropped
      final buckets = await sut.sharedSpace(space.id, GroupAssetsBy.none).bucketSource().first;
      expect(buckets.fold<int>(0, (sum, b) => sum + b.assetCount), 2);
    });
  });
}
