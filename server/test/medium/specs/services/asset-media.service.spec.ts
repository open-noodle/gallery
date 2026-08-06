import { Kysely } from 'kysely';
import { randomBytes } from 'node:crypto';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend';
import { AssetMediaStatus } from 'src/dtos/asset-media-response.dto';
import { AssetMediaSize } from 'src/dtos/asset-media.dto';
import { AssetFileType, AssetType, AssetVisibility, SharedLinkType } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { AssetMediaService } from 'src/services/asset-media.service';
import { AssetService } from 'src/services/asset.service';
import { StorageService } from 'src/services/storage.service';
import { ImmichFileResponse } from 'src/utils/file';
import { mediumFactory, newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(AssetMediaService, {
    database: db || defaultDatabase,
    real: [AccessRepository, AlbumRepository, AssetRepository, SharedLinkRepository, UserRepository],
    mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository],
  });
};

/**
 * #869 follow-up: the motion video of a live photo, with its still at `stillVisibility`. Locking
 * writes `visibility = locked` on the still only — the motion row keeps the `hidden` visibility it
 * was given when the pair was linked.
 */
const newLivePhotoMotion = async (
  ctx: ReturnType<typeof setup>['ctx'],
  ownerId: string,
  stillVisibility: AssetVisibility,
) => {
  const { asset: motion } = await ctx.newAsset({
    ownerId,
    type: AssetType.Video,
    visibility: AssetVisibility.Hidden,
  });
  await ctx.newAsset({ ownerId, visibility: stillVisibility, livePhotoVideoId: motion.id });
  await ctx.newAssetFile({
    assetId: motion.id,
    type: AssetFileType.Thumbnail,
    path: '/motion/thumbnail.jpg',
    isEdited: false,
  });
  return motion;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
  // Initialize StorageService static backends for medium tests
  (StorageService as any).diskBackend = new DiskStorageBackend('/tmp/immich-test');
});

describe(AssetService.name, () => {
  describe('uploadAsset', () => {
    it('should work', async () => {
      const { sut, ctx } = setup();

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const fileSizeInByte = 12_345;

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte });
      const auth = factory.auth({ user: { id: user.id } });

      await expect(
        sut.uploadAsset(
          auth,
          {
            fileModifiedAt: new Date(),
            fileCreatedAt: new Date(),
            assetData: Buffer.from('some data'),
          },
          mediumFactory.uploadFile({ size: fileSizeInByte }),
        ),
      ).resolves.toEqual({
        id: expect.any(String),
        status: AssetMediaStatus.CREATED,
      });

      expect(ctx.getMock(EventRepository).emit).toHaveBeenCalledWith('AssetCreate', {
        asset: expect.objectContaining({}),
        file: expect.objectContaining({ size: fileSizeInByte }),
      });
    });

    it('should work with an empty metadata list', async () => {
      const { sut, ctx } = setup();

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: 12_345 });
      const auth = factory.auth({ user: { id: user.id } });
      const file = mediumFactory.uploadFile();

      await expect(
        sut.uploadAsset(
          auth,
          {
            fileModifiedAt: new Date(),
            fileCreatedAt: new Date(),
            assetData: Buffer.from('some data'),
            metadata: [],
          },
          file,
        ),
      ).resolves.toEqual({
        id: expect.any(String),
        status: AssetMediaStatus.CREATED,
      });
    });

    it('should add to a shared link', async () => {
      const { sut, ctx } = setup();

      const sharedLinkRepo = ctx.get(SharedLinkRepository);

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();

      const sharedLink = await sharedLinkRepo.create({
        key: randomBytes(50),
        type: SharedLinkType.Individual,
        description: 'Shared link description',
        userId: user.id,
        allowDownload: true,
        allowUpload: true,
      });

      const auth = factory.auth({ user: { id: user.id }, sharedLink });
      const file = mediumFactory.uploadFile();
      const uploadDto = {
        fileModifiedAt: new Date(),
        fileCreatedAt: new Date(),
        assetData: Buffer.from('some data'),
      };

      const response = await sut.uploadAsset(auth, uploadDto, file);
      expect(response).toEqual({ id: expect.any(String), status: AssetMediaStatus.CREATED });

      const update = await sharedLinkRepo.get(user.id, sharedLink.id);
      const assets = update!.assets;
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({ id: response.id });
    });

    it('should handle adding a duplicate asset to a shared link', async () => {
      const { sut, ctx } = setup();

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const sharedLinkRepo = ctx.get(SharedLinkRepository);

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: 12_345 });

      const sharedLink = await sharedLinkRepo.create({
        key: randomBytes(50),
        type: SharedLinkType.Individual,
        description: 'Shared link description',
        userId: user.id,
        allowDownload: true,
        allowUpload: true,
        assetIds: [asset.id],
      });

      const auth = factory.auth({ user: { id: user.id }, sharedLink });
      const uploadDto = {
        fileModifiedAt: new Date(),
        fileCreatedAt: new Date(),
        assetData: Buffer.from('some data'),
      };

      const response = await sut.uploadAsset(auth, uploadDto, mediumFactory.uploadFile({ checksum: asset.checksum }));
      expect(response).toEqual({ id: expect.any(String), status: AssetMediaStatus.DUPLICATE });

      const update = await sharedLinkRepo.get(user.id, sharedLink.id);
      const assets = update!.assets;
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({ id: response.id });
    });

    it('should add to an album shared link', async () => {
      const { sut, ctx } = setup();

      const sharedLinkRepo = ctx.get(SharedLinkRepository);

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();
      const { album } = await ctx.newAlbum({ ownerId: user.id });

      const sharedLink = await sharedLinkRepo.create({
        key: randomBytes(50),
        type: SharedLinkType.Album,
        albumId: album.id,
        description: 'Shared link description',
        userId: user.id,
        allowDownload: true,
        allowUpload: true,
      });

      const auth = factory.auth({ user: { id: user.id }, sharedLink });
      const uploadDto = {
        fileModifiedAt: new Date(),
        fileCreatedAt: new Date(),
        assetData: Buffer.from('some data'),
      };

      const response = await sut.uploadAsset(auth, uploadDto, mediumFactory.uploadFile());
      expect(response).toEqual({ id: expect.any(String), status: AssetMediaStatus.CREATED });

      const result = await ctx.get(AlbumRepository).getAssetIds(album.id, [response.id]);
      const assets = [...result];
      expect(assets).toHaveLength(1);
      expect(assets[0]).toEqual(response.id);

      // Upstream #29008 reshaped AlbumUpdate from one event per recipient
      // ({ id, recipientId }) into a single event carrying the full audience. The
      // uploader is a shared-link visitor rather than an album member, so every
      // album user is a recipient.
      expect(ctx.getMock(EventRepository).emit).toHaveBeenCalledWith('AlbumUpdate', {
        id: album.id,
        userIds: [user.id],
        recipientIds: [user.id],
      });
    });

    it('should handle adding a duplicate asset to an album shared link', async () => {
      const { sut, ctx } = setup();

      const sharedLinkRepo = ctx.get(SharedLinkRepository);

      ctx.getMock(StorageRepository).utimes.mockResolvedValue();
      ctx.getMock(EventRepository).emit.mockResolvedValue();
      ctx.getMock(JobRepository).queue.mockResolvedValue();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id }, [asset.id]);
      // await ctx.newExif({ assetId: asset.id, fileSizeInByte: 12_345 });

      const sharedLink = await sharedLinkRepo.create({
        key: randomBytes(50),
        type: SharedLinkType.Album,
        albumId: album.id,
        description: 'Shared link description',
        userId: user.id,
        allowDownload: true,
        allowUpload: true,
      });

      const auth = factory.auth({ user: { id: user.id }, sharedLink });
      const uploadDto = {
        fileModifiedAt: new Date(),
        fileCreatedAt: new Date(),
        assetData: Buffer.from('some data'),
      };

      const response = await sut.uploadAsset(auth, uploadDto, mediumFactory.uploadFile({ checksum: asset.checksum }));
      expect(response).toEqual({ id: expect.any(String), status: AssetMediaStatus.DUPLICATE });

      const result = await ctx.get(AlbumRepository).getAssetIds(album.id, [response.id]);
      const assets = [...result];
      expect(assets).toHaveLength(1);
      expect(assets[0]).toEqual(response.id);
    });
  });

  describe('viewThumbnail', () => {
    it('should return original thumbnail by default when both exist', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create both original and edited thumbnails
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/original/preview.jpg',
        isEdited: false,
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/edited/preview.jpg',
        isEdited: true,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW });

      expect(result).toBeInstanceOf(ImmichFileResponse);
      expect((result as ImmichFileResponse).path).toBe('/original/preview.jpg');
    });

    it('should return edited thumbnail when edited=true', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create both original and edited thumbnails
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/original/preview.jpg',
        isEdited: false,
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/edited/preview.jpg',
        isEdited: true,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: true });

      expect(result).toBeInstanceOf(ImmichFileResponse);
      expect((result as ImmichFileResponse).path).toBe('/edited/preview.jpg');
    });

    it('should return original thumbnail when edited=false', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create both original and edited thumbnails
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/original/preview.jpg',
        isEdited: false,
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/edited/preview.jpg',
        isEdited: true,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: false });

      expect(result).toBeInstanceOf(ImmichFileResponse);
      expect((result as ImmichFileResponse).path).toBe('/original/preview.jpg');
    });

    it('should return original thumbnail when only original exists and edited=false', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create only original thumbnail
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/original/preview.jpg',
        isEdited: false,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: false });

      expect(result).toBeInstanceOf(ImmichFileResponse);
      expect((result as ImmichFileResponse).path).toBe('/original/preview.jpg');
    });

    it('should return original thumbnail when only original exists and edited=true', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create only original thumbnail
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: '/original/preview.jpg',
        isEdited: false,
      });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.PREVIEW, edited: true });

      expect(result).toBeInstanceOf(ImmichFileResponse);
      expect((result as ImmichFileResponse).path).toBe('/original/preview.jpg');
    });

    it('should work with thumbnail size', async () => {
      const { sut, ctx } = setup();

      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      // Create both original and edited thumbnails
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Thumbnail,
        path: '/original/thumbnail.jpg',
        isEdited: false,
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Thumbnail,
        path: '/edited/thumbnail.jpg',
        isEdited: true,
      });

      const auth = factory.auth({ user: { id: user.id } });

      // Test default (should get original)
      const resultDefault = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.THUMBNAIL });
      expect(resultDefault).toBeInstanceOf(ImmichFileResponse);
      expect((resultDefault as ImmichFileResponse).path).toBe('/original/thumbnail.jpg');

      // Test edited=true (should get edited)
      const resultEdited = await sut.viewThumbnail(auth, asset.id, { size: AssetMediaSize.THUMBNAIL, edited: true });
      expect(resultEdited).toBeInstanceOf(ImmichFileResponse);
      expect((resultEdited as ImmichFileResponse).path).toBe('/edited/thumbnail.jpg');
    });

    // #869 follow-up: a live photo is two asset rows and only the still carries `visibility = locked`.
    // The motion half keeps `hidden`, so the owner-access check — which drops locked assets for a
    // session that has not entered the PIN — served its thumbnail while the folder was locked.
    describe('locked live photo motion half', () => {
      it('refuses the motion thumbnail to a session that is not elevated', async () => {
        const { sut, ctx } = setup();
        const { user } = await ctx.newUser();
        const motion = await newLivePhotoMotion(ctx, user.id, AssetVisibility.Locked);

        const auth = factory.auth({ user: { id: user.id } });

        await expect(sut.viewThumbnail(auth, motion.id, { size: AssetMediaSize.THUMBNAIL })).rejects.toThrow(
          'Not found or no asset.view access',
        );
      });

      it('serves the motion thumbnail to an elevated session', async () => {
        const { sut, ctx } = setup();
        const { user } = await ctx.newUser();
        const motion = await newLivePhotoMotion(ctx, user.id, AssetVisibility.Locked);

        const auth = factory.auth({ user: { id: user.id }, session: { hasElevatedPermission: true } });
        const result = await sut.viewThumbnail(auth, motion.id, { size: AssetMediaSize.THUMBNAIL });

        expect((result as ImmichFileResponse).path).toBe('/motion/thumbnail.jpg');
      });

      // The regression guard with the widest blast radius in this change: checkOwnerAccess is the gate
      // every live-photo thumbnail and /video/playback request passes through, so an `isNotLockedAsset`
      // that over-matched would stop EVERY live photo in the app from playing. Without this case, the
      // two above still pass when the pairing gate is applied to all paired motion videos.
      it('serves the motion thumbnail of an unlocked live photo to a session that is not elevated', async () => {
        const { sut, ctx } = setup();
        const { user } = await ctx.newUser();
        const motion = await newLivePhotoMotion(ctx, user.id, AssetVisibility.Timeline);

        const auth = factory.auth({ user: { id: user.id } });
        const result = await sut.viewThumbnail(auth, motion.id, { size: AssetMediaSize.THUMBNAIL });

        expect((result as ImmichFileResponse).path).toBe('/motion/thumbnail.jpg');
      });
    });
  });
});
