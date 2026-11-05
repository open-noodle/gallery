import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:intl/date_symbol_data_local.dart';

import '../../medium/repository_context.dart';

// Album timelines show one photo per stack among the album's own members (lib/gallery/stacks/album_stack_collapse.dart),
// the same rule as the server: the primary when the album holds it, otherwise the earliest; only the viewer's stacks.

Future<List<String>> assetIds(TimelineQuery query) async =>
    (await query.assetSource(0, 100)).map((asset) => asset.remoteId!).toList();

Future<int> assetCount(TimelineQuery query) async =>
    (await query.bucketSource().first).fold<int>(0, (sum, bucket) => sum + bucket.assetCount);

void main() {
  late MediumRepositoryContext ctx;
  String? viewer;
  late SharedSpaceTimelineRepository sut;

  setUpAll(() async {
    await initializeDateFormatting('en');
  });

  setUp(() {
    ctx = MediumRepositoryContext();
    viewer = null;
    sut = SharedSpaceTimelineRepository(TimelineRepository(ctx.db), viewerId: () => viewer);
  });

  tearDown(() async {
    await ctx.dispose();
  });

  /// A stack of three (primary on the 3rd, children on the 1st and 2nd) plus an unstacked photo on the 4th.
  Future<({String primary, String early, String late, String loose})> stackFixture(String ownerId) async {
    final primary = await ctx.newRemoteAsset(ownerId: ownerId, createdAt: DateTime.utc(2026, 3, 3, 12), stackId: 's1');
    final early = await ctx.newRemoteAsset(ownerId: ownerId, createdAt: DateTime.utc(2026, 3, 1, 12), stackId: 's1');
    final late = await ctx.newRemoteAsset(ownerId: ownerId, createdAt: DateTime.utc(2026, 3, 2, 12), stackId: 's1');
    final loose = await ctx.newRemoteAsset(ownerId: ownerId, createdAt: DateTime.utc(2026, 3, 4, 12));
    await ctx.insertStack(id: 's1', ownerId: ownerId, primaryAssetId: primary.id);
    return (primary: primary.id, early: early.id, late: late.id, loose: loose.id);
  }

  Future<String> albumWith(String ownerId, List<String> assetIds) async {
    final album = await ctx.newRemoteAlbum(ownerId: ownerId, order: AlbumAssetOrder.desc);
    for (final id in assetIds) {
      await ctx.newRemoteAlbumAsset(albumId: album.id, assetId: id);
    }
    return album.id;
  }

  group('remote album', () {
    test('shows the primary when the album holds it', () async {
      final user = await ctx.newUser();
      viewer = user.id;
      final s = await stackFixture(user.id);
      final album = await albumWith(user.id, [s.primary, s.early, s.loose]);

      final query = sut.remoteAlbum(album, GroupAssetsBy.day);
      expect(await assetIds(query), [s.loose, s.primary]);
      expect(await assetCount(query), 2);
      expect(await assetCount(sut.remoteAlbum(album, GroupAssetsBy.none)), 2);
    });

    test('shows the earliest album member when the album does not hold the primary', () async {
      final user = await ctx.newUser();
      viewer = user.id;
      final s = await stackFixture(user.id);
      final album = await albumWith(user.id, [s.late, s.early]);

      expect(await assetIds(sut.remoteAlbum(album, GroupAssetsBy.day)), [s.early]);
    });

    test('never hides a photo behind a sibling the temporal scope excludes', () async {
      final user = await ctx.newUser();
      viewer = user.id;
      final primary = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2026, 3, 3, 12),
        stackId: 's1',
      );
      final february = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2026, 2, 20, 12),
        stackId: 's1',
      );
      await ctx.insertStack(id: 's1', ownerId: user.id, primaryAssetId: primary.id);
      final album = await albumWith(user.id, [primary.id, february.id]);

      final inFebruary = sut.remoteAlbum(
        album,
        GroupAssetsBy.day,
        temporalScope: TimelineTemporalScope.month(year: 2026, month: 2),
      );
      expect(await assetIds(inFebruary), [february.id]);
      expect(await assetIds(sut.remoteAlbum(album, GroupAssetsBy.day)), [primary.id]);
    });

    test('passes over a trashed primary to the next album member', () async {
      final user = await ctx.newUser();
      viewer = user.id;
      final primary = await ctx.newRemoteAsset(
        ownerId: user.id,
        createdAt: DateTime.utc(2026, 3, 3),
        stackId: 's1',
        deletedAt: DateTime.utc(2026, 3, 5),
      );
      final early = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime.utc(2026, 3, 1), stackId: 's1');
      final late = await ctx.newRemoteAsset(ownerId: user.id, createdAt: DateTime.utc(2026, 3, 2), stackId: 's1');
      await ctx.insertStack(id: 's1', ownerId: user.id, primaryAssetId: primary.id);
      final album = await albumWith(user.id, [primary.id, early.id, late.id]);

      expect(await assetIds(sut.remoteAlbum(album, GroupAssetsBy.day)), [early.id]);
    });

    test("leaves another user's stack expanded in a shared album", () async {
      final owner = await ctx.newUser();
      final other = await ctx.newUser();
      final s = await stackFixture(owner.id);
      final album = await albumWith(owner.id, [s.primary, s.early]);

      viewer = other.id;
      expect(await assetIds(sut.remoteAlbum(album, GroupAssetsBy.day)), [s.primary, s.early]);

      viewer = owner.id;
      expect(await assetIds(sut.remoteAlbum(album, GroupAssetsBy.day)), [s.primary]);
    });

    test('collapses nothing without a signed-in user', () async {
      final user = await ctx.newUser();
      final s = await stackFixture(user.id);
      final album = await albumWith(user.id, [s.primary, s.early]);

      expect(await assetIds(sut.remoteAlbum(album, GroupAssetsBy.day)), [s.primary, s.early]);
    });
  });

  test('space album collapses the same way, by its own membership', () async {
    final user = await ctx.newUser();
    viewer = user.id;
    final s = await stackFixture(user.id);
    final album = await ctx.newSharedSpaceAlbum();
    for (final id in [s.late, s.early, s.loose]) {
      await ctx.insertSharedSpaceAlbumAsset(albumId: album.id, assetId: id);
    }

    final query = sut.spaceAlbum('space-1', album.id, GroupAssetsBy.day);
    expect(await assetIds(query), [s.loose, s.early]);
    expect(await assetCount(query), 2);
    expect(await assetCount(sut.spaceAlbum('space-1', album.id, GroupAssetsBy.none)), 2);
  });
}
