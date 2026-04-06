import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:intl/date_symbol_data_local.dart';

import '../../medium/repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late DriftTimelineRepository sut;

  setUpAll(() async {
    await initializeDateFormatting('en');
  });

  setUp(() async {
    ctx = MediumRepositoryContext();
    sut = DriftTimelineRepository(ctx.db);
  });

  tearDown(() async {
    await ctx.dispose();
  });

  group('sharedSpace() TimelineQuery', () {
    late String userId;
    late String spaceId;

    setUp(() async {
      final user = await ctx.newUser();
      userId = user.id;
      final space = await ctx.newSharedSpace(createdById: userId);
      spaceId = space.id;
    });

    test('returns empty bucket list for a space with no assets', () async {
      final query = sut.sharedSpace(spaceId, GroupAssetsBy.day);
      final buckets = await query.bucketSource().first;
      expect(buckets, isEmpty);
    });

    test('returns bucket counts grouped by day', () async {
      final asset1 = await ctx.newRemoteAsset(
        ownerId: userId,
        createdAt: DateTime(2026, 4, 1, 12),
      );
      final asset2 = await ctx.newRemoteAsset(
        ownerId: userId,
        createdAt: DateTime(2026, 4, 1, 18),
      );
      final asset3 = await ctx.newRemoteAsset(
        ownerId: userId,
        createdAt: DateTime(2026, 4, 2, 9),
      );
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset1.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset2.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset3.id);

      final query = sut.sharedSpace(spaceId, GroupAssetsBy.day);
      final buckets = await query.bucketSource().first;

      expect(buckets, hasLength(2));
      // Buckets are returned in DESC order of date.
      expect(buckets[0].assetCount, 1); // April 2
      expect(buckets[1].assetCount, 2); // April 1
    });

    test('returns assets ordered by createdAt DESC', () async {
      final asset1 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 4, 1));
      final asset2 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 4, 5));
      final asset3 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 4, 3));
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset1.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset2.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset3.id);

      final query = sut.sharedSpace(spaceId, GroupAssetsBy.day);
      final assets = await query.assetSource(0, 10);

      expect(assets, hasLength(3));
      expect(assets[0].remoteId, asset2.id); // April 5
      expect(assets[1].remoteId, asset3.id); // April 3
      expect(assets[2].remoteId, asset1.id); // April 1
    });

    test('respects offset and limit on the asset source', () async {
      for (var i = 0; i < 5; i++) {
        final asset = await ctx.newRemoteAsset(
          ownerId: userId,
          createdAt: DateTime(2026, 4, i + 1),
        );
        await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset.id);
      }

      final query = sut.sharedSpace(spaceId, GroupAssetsBy.day);
      final slice = await query.assetSource(1, 2);
      expect(slice, hasLength(2));
    });

    test('returns assets owned by other users (foreign assets)', () async {
      final otherUser = await ctx.newUser();
      final foreignAsset = await ctx.newRemoteAsset(ownerId: otherUser.id, createdAt: DateTime(2026, 4, 4));
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: foreignAsset.id);

      final query = sut.sharedSpace(spaceId, GroupAssetsBy.day);
      final assets = await query.assetSource(0, 10);

      expect(assets, hasLength(1));
      expect(assets[0].remoteId, foreignAsset.id);
    });

    test('returns NO assets when querying a different space', () async {
      // Create a second space, insert assets only into it.
      final otherSpace = await ctx.newSharedSpace(createdById: userId);
      final asset = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 4, 4));
      await ctx.insertSharedSpaceAsset(spaceId: otherSpace.id, assetId: asset.id);

      // Query the FIRST space's timeline. Assert it returns zero buckets and zero assets.
      // This locks in the per-space scoping property — without it, the query could leak across spaces.
      final query = sut.sharedSpace(spaceId, GroupAssetsBy.day);
      final buckets = await query.bucketSource().first;
      final assets = await query.assetSource(0, 10);

      expect(buckets, isEmpty);
      expect(assets, isEmpty);
    });

    test('does not return soft-deleted assets', () async {
      final liveAsset = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 4, 4));
      final deletedAsset = await ctx.newRemoteAsset(
        ownerId: userId,
        createdAt: DateTime(2026, 4, 4),
        deletedAt: DateTime(2026, 4, 5),
      );
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: liveAsset.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: deletedAsset.id);

      final query = sut.sharedSpace(spaceId, GroupAssetsBy.day);
      final assets = await query.assetSource(0, 10);

      expect(assets, hasLength(1));
      expect(assets[0].remoteId, liveAsset.id);
    });

    test('bucket stream is reactive — emits new buckets when an asset is added after subscription', () async {
      final query = sut.sharedSpace(spaceId, GroupAssetsBy.day);
      final emissions = <List<Bucket>>[];
      final sub = query.bucketSource().listen(emissions.add);

      // Wait for the initial empty emission
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(emissions, hasLength(1));
      expect(emissions[0], isEmpty);

      // Insert an asset and verify a new emission arrives
      final asset = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 4, 1));
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset.id);
      await Future<void>.delayed(const Duration(milliseconds: 100));

      expect(emissions.length, greaterThanOrEqualTo(2));
      expect(emissions.last, hasLength(1));
      expect(emissions.last[0].assetCount, 1);

      await sub.cancel();
    });

    test('groups by month when GroupAssetsBy.month', () async {
      // Use mid-day times to avoid timezone wraparound at midnight (the SQL
      // strftime sees the UTC representation, so naive midnight values can
      // shift to the previous month in non-UTC zones).
      final asset1 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 4, 5, 12));
      final asset2 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 4, 15, 12));
      final asset3 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 5, 5, 12));
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset1.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset2.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset3.id);

      final query = sut.sharedSpace(spaceId, GroupAssetsBy.month);
      final buckets = await query.bucketSource().first;

      // Two months: April (2 assets) and May (1 asset), DESC.
      expect(buckets, hasLength(2));
      expect(buckets[0].assetCount, 1); // May
      expect(buckets[1].assetCount, 2); // April
    });

    test('returns a single ungrouped bucket when GroupAssetsBy.none', () async {
      final asset1 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 4, 5, 12));
      final asset2 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 4, 15, 12));
      final asset3 = await ctx.newRemoteAsset(ownerId: userId, createdAt: DateTime(2026, 5, 5, 12));
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset1.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset2.id);
      await ctx.insertSharedSpaceAsset(spaceId: spaceId, assetId: asset3.id);

      final query = sut.sharedSpace(spaceId, GroupAssetsBy.none);
      final buckets = await query.bucketSource().first;

      // none groups everything into a single bucket containing all assets.
      expect(buckets, hasLength(1));
      expect(buckets[0].assetCount, 3);
    });
  });
}
