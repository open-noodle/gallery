import { Kysely } from 'kysely';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { SyncEntityType, SyncRequestType } from 'src/enum.js';
import { GalleryAssetRepository } from 'src/gallery/repositories/gallery-asset.repository.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DuplicateRepository } from 'src/repositories/duplicate.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetMediaService } from 'src/services/asset-media.service.js';
import { AssetService } from 'src/services/asset.service.js';
import { DuplicateService } from 'src/services/duplicate.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { SyncTestContext, mediumFactory, newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// Upstream's owner-only writes of asset."isFavorite" (upload, copy, duplicate resolve) stay upstream text; the
// reverse trigger turns each into the owner's asset_favorite row, so both sync streams carry the favorite.

let defaultDatabase: Kysely<DB>;

const favoriteRows = (assetId: string) =>
  defaultDatabase.selectFrom('asset_favorite').select('userId').where('assetId', '=', assetId).execute();

const expectFavoriteSynced = async (ctx: SyncTestContext, auth: AuthDto, assetId: string) => {
  const response = await ctx.syncStream(auth, [SyncRequestType.AssetsV2, SyncRequestType.AssetFavoritesV1]);
  expect(response).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: SyncEntityType.AssetV2,
        data: expect.objectContaining({ id: assetId, isFavorite: true }),
      }),
      expect.objectContaining({ type: SyncEntityType.AssetFavoriteV1, data: { assetId } }),
    ]),
  );
  await ctx.syncAckAll(auth, response);
};

const setup = async () => {
  const ctx = new SyncTestContext(defaultDatabase);
  const { auth, user } = await ctx.newSyncAuthUser();
  return { ctx, auth, user };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
  (StorageService as any).diskBackend = new DiskStorageBackend('/tmp/immich-test', {} as StorageRepository);
});

beforeEach(() => {
  clearConfigCache();
});

describe('upstream owner-only favorite writes', () => {
  it('upload with isFavorite true creates the owner overlay row', async () => {
    const { ctx, auth, user } = await setup();
    const { sut, ctx: serviceCtx } = newMediumService(AssetMediaService, {
      database: defaultDatabase,
      real: [
        AccessRepository,
        AlbumRepository,
        AssetRepository,
        GalleryAssetRepository,
        SharedLinkRepository,
        UserRepository,
      ],
      mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository],
    });
    serviceCtx.getMock(StorageRepository).utimes.mockResolvedValue();
    serviceCtx.getMock(EventRepository).emit.mockResolvedValue();
    serviceCtx.getMock(JobRepository).queue.mockResolvedValue();
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AssetsV2, SyncRequestType.AssetFavoritesV1]);

    const { id } = await sut.uploadAsset(
      auth,
      { fileModifiedAt: new Date(), fileCreatedAt: new Date(), assetData: Buffer.from('data'), isFavorite: true },
      mediumFactory.uploadFile(),
    );

    await expect(favoriteRows(id)).resolves.toEqual([{ userId: user.id }]);
    await expectFavoriteSynced(ctx, auth, id);
  });

  it('copy carries the owner favorite to the target', async () => {
    const { ctx, auth, user } = await setup();
    const { sut } = newMediumService(AssetService, {
      database: defaultDatabase,
      real: [AccessRepository, AssetRepository, GalleryAssetRepository, AssetFavoriteRepository],
      mock: [LoggingRepository],
    });
    const { asset: source } = await ctx.newAsset({ ownerId: user.id, isFavorite: true });
    const { asset: target } = await ctx.newAsset({ ownerId: user.id });
    await ctx.syncAckAll(
      auth,
      await ctx.syncStream(auth, [SyncRequestType.AssetsV2, SyncRequestType.AssetFavoritesV1]),
    );

    await sut.copy(auth, {
      sourceId: source.id,
      targetId: target.id,
      albums: false,
      sharedLinks: false,
      stack: false,
      sidecar: false,
    });

    await expect(favoriteRows(target.id)).resolves.toEqual([{ userId: user.id }]);
    await expectFavoriteSynced(ctx, auth, target.id);
  });

  it("duplicate resolve gives the keeper the owner's favorite and keeps other users' favorites", async () => {
    const { ctx, auth, user } = await setup();
    const { user: member } = await ctx.newUser();
    const { sut, ctx: serviceCtx } = newMediumService(DuplicateService, {
      database: defaultDatabase,
      real: [
        AccessRepository,
        AlbumRepository,
        AssetRepository,
        GalleryAssetRepository,
        AssetFavoriteRepository,
        ConfigRepository,
        DuplicateRepository,
        SharedSpaceRepository,
        SystemMetadataRepository,
        TagRepository,
      ],
      mock: [EventRepository, JobRepository, LoggingRepository],
    });
    serviceCtx.getMock(EventRepository).emit.mockResolvedValue();
    serviceCtx.getMock(JobRepository).queueAll.mockResolvedValue();

    const duplicateId = factory.uuid();
    const { asset: keeper } = await ctx.newAsset({ ownerId: user.id, duplicateId });
    const { asset: trashed } = await ctx.newAsset({ ownerId: user.id, duplicateId, isFavorite: true });
    await ctx.newExif({ assetId: keeper.id, fileSizeInByte: 1000 });
    await ctx.newExif({ assetId: trashed.id, fileSizeInByte: 1000 });
    await ctx.get(AssetFavoriteRepository).addAll(member.id, [trashed.id]);
    await ctx.syncAckAll(
      auth,
      await ctx.syncStream(auth, [SyncRequestType.AssetsV2, SyncRequestType.AssetFavoritesV1]),
    );

    await expect(
      sut.resolve(auth, { groups: [{ duplicateId, keepAssetIds: [keeper.id], trashAssetIds: [trashed.id] }] }),
    ).resolves.toEqual([{ id: duplicateId, success: true }]);

    const rows = await favoriteRows(keeper.id);
    expect(rows.map(({ userId }) => userId).sort()).toEqual([user.id, member.id].sort());
    await expectFavoriteSynced(ctx, auth, keeper.id);
  });
});
