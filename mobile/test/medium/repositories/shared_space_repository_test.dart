import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/infrastructure/repositories/shared_space.repository.dart';

import '../repository_context.dart';

void main() {
  late MediumRepositoryContext ctx;
  late SharedSpaceRepository repo;

  setUp(() {
    ctx = MediumRepositoryContext();
    repo = SharedSpaceRepository(ctx.db);
  });
  tearDown(() => ctx.dispose());

  // Local mirror of the server's `findSpaceForAssetAndUser`: which space hands this
  // viewer this asset. #1047 needs it to send "view in timeline" on a memory photo to
  // the Space timeline that actually holds the photo.
  group('findSpaceIdForAsset', () {
    test('returns the space that holds the asset for a member', () async {
      final owner = await ctx.newUser();
      final viewer = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: owner.id);
      await ctx.newSharedSpaceMember(spaceId: space.id, userId: viewer.id);
      final asset = await ctx.newRemoteAsset(ownerId: owner.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: asset.id);

      expect(await repo.findSpaceIdForAsset(assetId: asset.id, userId: viewer.id), space.id);
    });

    test('returns null for a space the viewer does not belong to', () async {
      final owner = await ctx.newUser();
      final outsider = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: owner.id);
      await ctx.newSharedSpaceMember(spaceId: space.id, userId: owner.id);
      final asset = await ctx.newRemoteAsset(ownerId: owner.id);
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: asset.id);

      expect(await repo.findSpaceIdForAsset(assetId: asset.id, userId: outsider.id), isNull);
    });

    test('returns null when no space holds the asset', () async {
      final owner = await ctx.newUser();
      final viewer = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: owner.id);
      await ctx.newSharedSpaceMember(spaceId: space.id, userId: viewer.id);
      final asset = await ctx.newRemoteAsset(ownerId: owner.id);

      expect(await repo.findSpaceIdForAsset(assetId: asset.id, userId: viewer.id), isNull);
    });

    // A space can share a whole library rather than individual assets; the asset then
    // has no shared_space_asset row and is reached through its libraryId.
    test('returns the space that shares the asset library', () async {
      final owner = await ctx.newUser();
      final viewer = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: owner.id);
      await ctx.newSharedSpaceMember(spaceId: space.id, userId: viewer.id);
      final library = await ctx.newLibrary(ownerId: owner.id);
      await ctx.insertSharedSpaceLibrary(spaceId: space.id, libraryId: library.id);
      final asset = await ctx.newRemoteAsset(ownerId: owner.id, libraryId: library.id);

      expect(await repo.findSpaceIdForAsset(assetId: asset.id, userId: viewer.id), space.id);
    });

    test('ignores an asset that was deleted', () async {
      final owner = await ctx.newUser();
      final viewer = await ctx.newUser();
      final space = await ctx.newSharedSpace(createdById: owner.id);
      await ctx.newSharedSpaceMember(spaceId: space.id, userId: viewer.id);
      final asset = await ctx.newRemoteAsset(ownerId: owner.id, deletedAt: DateTime(2026, 4, 3));
      await ctx.insertSharedSpaceAsset(spaceId: space.id, assetId: asset.id);

      expect(await repo.findSpaceIdForAsset(assetId: asset.id, userId: viewer.id), isNull);
    });
  });
}
