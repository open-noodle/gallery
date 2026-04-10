import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_asset.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_library.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.drift.dart';
import 'package:immich_mobile/infrastructure/entities/user.entity.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';

void main() {
  late Drift db;

  setUp(() {
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
  });

  tearDown(() async {
    await db.close();
  });

  test(
    'mergedBucket includes shared space assets for a viewer with showInTimeline=true even when they own no assets',
    () async {
      const ownerId = 'owner-1';
      const viewerId = 'viewer-1';
      const spaceId = 'space-1';
      const assetId = 'asset-1';
      final createdAt = DateTime(2024, 1, 1, 12);

      // Two users: an owner and a viewer.
      await db
          .into(db.userEntity)
          .insert(UserEntityCompanion.insert(id: ownerId, email: 'owner@test.dev', name: 'Owner'));
      await db
          .into(db.userEntity)
          .insert(UserEntityCompanion.insert(id: viewerId, email: 'viewer@test.dev', name: 'Viewer'));

      // The owner uploads an asset. The viewer owns nothing.
      await db
          .into(db.remoteAssetEntity)
          .insert(
            RemoteAssetEntityCompanion.insert(
              id: assetId,
              name: 'asset-1.jpg',
              type: AssetType.image,
              checksum: 'checksum-1',
              ownerId: ownerId,
              visibility: AssetVisibility.timeline,
              createdAt: Value(createdAt),
              updatedAt: Value(createdAt),
              localDateTime: Value(createdAt),
            ),
          );

      // A shared space owned by the owner, with the viewer as a member who
      // has explicitly enabled "show in timeline".
      await db
          .into(db.sharedSpaceEntity)
          .insert(SharedSpaceEntityCompanion.insert(id: spaceId, name: 'Test Space', createdById: ownerId));
      await db
          .into(db.sharedSpaceMemberEntity)
          .insert(
            SharedSpaceMemberEntityCompanion.insert(
              spaceId: spaceId,
              userId: viewerId,
              role: 'viewer',
              showInTimeline: const Value(true),
            ),
          );

      // The owner's asset is shared into the space.
      await db
          .into(db.sharedSpaceAssetEntity)
          .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));

      // From the viewer's main timeline, the asset should appear in a bucket.
      final buckets = await db.mergedAssetDrift
          .mergedBucket(groupBy: GroupAssetsBy.day.index, userIds: [viewerId], currentUserId: viewerId)
          .get();

      expect(buckets, hasLength(1));
      expect(buckets.single.assetCount, 1);
    },
  );

  test('mergedBucket includes library-linked shared space assets for a viewer with showInTimeline=true', () async {
    const ownerId = 'owner-1';
    const viewerId = 'viewer-1';
    const spaceId = 'space-1';
    const libraryId = 'library-1';
    const assetId = 'asset-1';
    final createdAt = DateTime(2024, 1, 1, 12);

    await db
        .into(db.userEntity)
        .insert(UserEntityCompanion.insert(id: ownerId, email: 'owner@test.dev', name: 'Owner'));
    await db
        .into(db.userEntity)
        .insert(UserEntityCompanion.insert(id: viewerId, email: 'viewer@test.dev', name: 'Viewer'));

    // An asset that belongs to a library owned by the owner.
    await db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: assetId,
            name: 'lib-asset.jpg',
            type: AssetType.image,
            checksum: 'checksum-lib',
            ownerId: ownerId,
            visibility: AssetVisibility.timeline,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: Value(createdAt),
            libraryId: const Value(libraryId),
          ),
        );

    // A space that has the library linked, not the individual asset.
    await db
        .into(db.sharedSpaceEntity)
        .insert(SharedSpaceEntityCompanion.insert(id: spaceId, name: 'Takeout', createdById: ownerId));
    await db
        .into(db.sharedSpaceMemberEntity)
        .insert(
          SharedSpaceMemberEntityCompanion.insert(
            spaceId: spaceId,
            userId: viewerId,
            role: 'viewer',
            showInTimeline: const Value(true),
          ),
        );
    await db
        .into(db.sharedSpaceLibraryEntity)
        .insert(SharedSpaceLibraryEntityCompanion.insert(spaceId: spaceId, libraryId: libraryId));

    final buckets = await db.mergedAssetDrift
        .mergedBucket(groupBy: GroupAssetsBy.day.index, userIds: [viewerId], currentUserId: viewerId)
        .get();

    expect(buckets, hasLength(1));
    expect(buckets.single.assetCount, 1);
  });

  test('mergedBucket excludes shared space assets when showInTimeline is false', () async {
    const ownerId = 'owner-1';
    const viewerId = 'viewer-1';
    const spaceId = 'space-1';
    const assetId = 'asset-1';
    final createdAt = DateTime(2024, 1, 1, 12);

    await db
        .into(db.userEntity)
        .insert(UserEntityCompanion.insert(id: ownerId, email: 'owner@test.dev', name: 'Owner'));
    await db
        .into(db.userEntity)
        .insert(UserEntityCompanion.insert(id: viewerId, email: 'viewer@test.dev', name: 'Viewer'));
    await db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: assetId,
            name: 'asset-1.jpg',
            type: AssetType.image,
            checksum: 'checksum-1',
            ownerId: ownerId,
            visibility: AssetVisibility.timeline,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: Value(createdAt),
          ),
        );
    await db
        .into(db.sharedSpaceEntity)
        .insert(SharedSpaceEntityCompanion.insert(id: spaceId, name: 'Hidden Space', createdById: ownerId));
    // Viewer IS a member, but explicitly opted out of their timeline.
    await db
        .into(db.sharedSpaceMemberEntity)
        .insert(
          SharedSpaceMemberEntityCompanion.insert(
            spaceId: spaceId,
            userId: viewerId,
            role: 'viewer',
            showInTimeline: const Value(false),
          ),
        );
    await db
        .into(db.sharedSpaceAssetEntity)
        .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));

    final buckets = await db.mergedAssetDrift
        .mergedBucket(groupBy: GroupAssetsBy.day.index, userIds: [viewerId], currentUserId: viewerId)
        .get();

    expect(buckets, isEmpty);
  });

  test('mergedBucket excludes shared space assets when the user is not a member', () async {
    const ownerId = 'owner-1';
    const outsiderId = 'outsider-1';
    const spaceId = 'space-1';
    const assetId = 'asset-1';
    final createdAt = DateTime(2024, 1, 1, 12);

    await db
        .into(db.userEntity)
        .insert(UserEntityCompanion.insert(id: ownerId, email: 'owner@test.dev', name: 'Owner'));
    await db
        .into(db.userEntity)
        .insert(UserEntityCompanion.insert(id: outsiderId, email: 'outsider@test.dev', name: 'Outsider'));
    await db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: assetId,
            name: 'private.jpg',
            type: AssetType.image,
            checksum: 'checksum-private',
            ownerId: ownerId,
            visibility: AssetVisibility.timeline,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: Value(createdAt),
          ),
        );
    await db
        .into(db.sharedSpaceEntity)
        .insert(SharedSpaceEntityCompanion.insert(id: spaceId, name: 'Private Space', createdById: ownerId));
    // Only the owner is a member; outsider is not.
    await db
        .into(db.sharedSpaceMemberEntity)
        .insert(
          SharedSpaceMemberEntityCompanion.insert(
            spaceId: spaceId,
            userId: ownerId,
            role: 'owner',
            showInTimeline: const Value(true),
          ),
        );
    await db
        .into(db.sharedSpaceAssetEntity)
        .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));

    final buckets = await db.mergedAssetDrift
        .mergedBucket(groupBy: GroupAssetsBy.day.index, userIds: [outsiderId], currentUserId: outsiderId)
        .get();

    expect(buckets, isEmpty);
  });

  test(
    "mergedBucket does not leak a partner's shared-space assets into the current user's timeline",
    () async {
      // Scenario: userA has userB as a partner (showing in timeline). userB is a
      // member of a shared space with showInTimeline=true. userA should see
      // userB's own-owned assets (partner sharing) but NOT the space assets that
      // userB has opted to show in userB's own timeline — those are userB's
      // preference, not userA's.
      const userAId = 'user-a';
      const userBId = 'user-b';
      const ownerId = 'space-owner';
      const spaceId = 'space-1';
      const partnerAssetId = 'partner-asset';
      const spaceAssetId = 'space-asset';
      final createdAt = DateTime(2024, 1, 1, 12);

      await db
          .into(db.userEntity)
          .insert(UserEntityCompanion.insert(id: userAId, email: 'a@test.dev', name: 'A'));
      await db
          .into(db.userEntity)
          .insert(UserEntityCompanion.insert(id: userBId, email: 'b@test.dev', name: 'B'));
      await db
          .into(db.userEntity)
          .insert(UserEntityCompanion.insert(id: ownerId, email: 'owner@test.dev', name: 'Owner'));

      // Asset owned by userB — should appear in A's timeline via partner sharing.
      await db
          .into(db.remoteAssetEntity)
          .insert(
            RemoteAssetEntityCompanion.insert(
              id: partnerAssetId,
              name: 'partner.jpg',
              type: AssetType.image,
              checksum: 'checksum-partner',
              ownerId: userBId,
              visibility: AssetVisibility.timeline,
              createdAt: Value(createdAt),
              updatedAt: Value(createdAt),
              localDateTime: Value(createdAt),
            ),
          );

      // Asset owned by space owner, shared into a space userB is a member of.
      // userA is NOT a member of this space and should NOT see it.
      await db
          .into(db.remoteAssetEntity)
          .insert(
            RemoteAssetEntityCompanion.insert(
              id: spaceAssetId,
              name: 'space.jpg',
              type: AssetType.image,
              checksum: 'checksum-space',
              ownerId: ownerId,
              visibility: AssetVisibility.timeline,
              createdAt: Value(createdAt),
              updatedAt: Value(createdAt),
              localDateTime: Value(createdAt),
            ),
          );
      await db
          .into(db.sharedSpaceEntity)
          .insert(SharedSpaceEntityCompanion.insert(id: spaceId, name: 'B Space', createdById: ownerId));
      await db
          .into(db.sharedSpaceMemberEntity)
          .insert(
            SharedSpaceMemberEntityCompanion.insert(
              spaceId: spaceId,
              userId: userBId,
              role: 'viewer',
              showInTimeline: const Value(true),
            ),
          );
      await db
          .into(db.sharedSpaceAssetEntity)
          .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: spaceAssetId));

      // userA's main timeline — userIds represents A + B (B is a partner), but
      // currentUserId is A, so only A's space memberships drive the lookup.
      final buckets = await db.mergedAssetDrift
          .mergedBucket(
            groupBy: GroupAssetsBy.day.index,
            userIds: [userAId, userBId],
            currentUserId: userAId,
          )
          .get();

      // Exactly one bucket with one asset: the partner asset. The space asset
      // must NOT appear because the current user (A) isn't in that space.
      expect(buckets, hasLength(1));
      expect(buckets.single.assetCount, 1);
    },
  );

  test('mergedBucket deduplicates an asset that is both owned by the viewer and shared into their space', () async {
    const viewerId = 'viewer-1';
    const spaceId = 'space-1';
    const assetId = 'asset-1';
    final createdAt = DateTime(2024, 1, 1, 12);

    await db
        .into(db.userEntity)
        .insert(UserEntityCompanion.insert(id: viewerId, email: 'viewer@test.dev', name: 'Viewer'));
    await db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: assetId,
            name: 'asset-1.jpg',
            type: AssetType.image,
            checksum: 'checksum-1',
            ownerId: viewerId,
            visibility: AssetVisibility.timeline,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: Value(createdAt),
          ),
        );
    await db
        .into(db.sharedSpaceEntity)
        .insert(SharedSpaceEntityCompanion.insert(id: spaceId, name: 'Own Space', createdById: viewerId));
    await db
        .into(db.sharedSpaceMemberEntity)
        .insert(
          SharedSpaceMemberEntityCompanion.insert(
            spaceId: spaceId,
            userId: viewerId,
            role: 'owner',
            showInTimeline: const Value(true),
          ),
        );
    await db
        .into(db.sharedSpaceAssetEntity)
        .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));

    // The WHERE clause is owned-OR-shared; the asset matches both, but it's
    // still a single row in remote_asset_entity so it must be counted once.
    final buckets = await db.mergedAssetDrift
        .mergedBucket(groupBy: GroupAssetsBy.day.index, userIds: [viewerId], currentUserId: viewerId)
        .get();

    expect(buckets, hasLength(1));
    expect(buckets.single.assetCount, 1);
  });

  test('mergedAsset returns the row for a shared-space asset visible to the viewer', () async {
    const ownerId = 'owner-1';
    const viewerId = 'viewer-1';
    const spaceId = 'space-1';
    const assetId = 'asset-1';
    final createdAt = DateTime(2024, 1, 1, 12);

    await db
        .into(db.userEntity)
        .insert(UserEntityCompanion.insert(id: ownerId, email: 'owner@test.dev', name: 'Owner'));
    await db
        .into(db.userEntity)
        .insert(UserEntityCompanion.insert(id: viewerId, email: 'viewer@test.dev', name: 'Viewer'));
    await db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: assetId,
            name: 'asset-1.jpg',
            type: AssetType.image,
            checksum: 'checksum-1',
            ownerId: ownerId,
            visibility: AssetVisibility.timeline,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: Value(createdAt),
          ),
        );
    await db
        .into(db.sharedSpaceEntity)
        .insert(SharedSpaceEntityCompanion.insert(id: spaceId, name: 'Test Space', createdById: ownerId));
    await db
        .into(db.sharedSpaceMemberEntity)
        .insert(
          SharedSpaceMemberEntityCompanion.insert(
            spaceId: spaceId,
            userId: viewerId,
            role: 'viewer',
            showInTimeline: const Value(true),
          ),
        );
    await db
        .into(db.sharedSpaceAssetEntity)
        .insert(SharedSpaceAssetEntityCompanion.insert(spaceId: spaceId, assetId: assetId));

    final rows = await db.mergedAssetDrift
        .mergedAsset(userIds: [viewerId], currentUserId: viewerId, limit: (_) => Limit(50, 0))
        .get();

    expect(rows, hasLength(1));
    expect(rows.single.remoteId, assetId);
  });

  test('mergedBucket falls back to createdAt when localDateTime is null', () async {
    const userId = 'user-1';
    final createdAt = DateTime(2024, 1, 1, 12);

    await db
        .into(db.userEntity)
        .insert(UserEntityCompanion.insert(id: userId, email: 'user-1@test.dev', name: 'User 1'));

    await db
        .into(db.remoteAssetEntity)
        .insert(
          RemoteAssetEntityCompanion.insert(
            id: 'asset-1',
            name: 'asset-1.jpg',
            type: AssetType.image,
            checksum: 'checksum-1',
            ownerId: userId,
            visibility: AssetVisibility.timeline,
            createdAt: Value(createdAt),
            updatedAt: Value(createdAt),
            localDateTime: const Value(null),
          ),
        );

    final buckets = await db.mergedAssetDrift
        .mergedBucket(groupBy: GroupAssetsBy.day.index, userIds: [userId], currentUserId: userId)
        .get();

    expect(buckets, hasLength(1));
    expect(buckets.single.assetCount, 1);
    expect(buckets.single.bucketDate, isNotEmpty);
  });
}
