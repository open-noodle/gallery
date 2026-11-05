import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetFileType, AssetType, AssetVisibility } from 'src/enum.js';
import { DataSaverVideoRepository } from 'src/gallery/repositories/data-saver-video.repository.js';
import { IntegrityRepository } from 'src/repositories/integrity.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StorageMigrationRepository } from 'src/repositories/storage-migration.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const SETTINGS = 'hevc:720:1500k';

const diskPath = (assetId: string) => `/encoded-video/${assetId}_ds.mp4`;

const copy = (assetId: string, overrides: { path?: string | null; settings?: string; fromEdited?: boolean } = {}) => ({
  assetId,
  path: diskPath(assetId) as string | null,
  settings: SETTINGS,
  fromEdited: false,
  ...overrides,
});

const setup = async () => {
  const { ctx } = newMediumService(BaseService, { database: defaultDatabase, real: [], mock: [LoggingRepository] });
  const { user } = await ctx.newUser();
  return { ctx, user, sut: ctx.get(DataSaverVideoRepository) };
};

const queued = async (sut: DataSaverVideoRepository, ids: string[], force?: boolean) => {
  const found: string[] = [];
  for await (const { id } of sut.streamForQueue(SETTINGS, force)) {
    if (ids.includes(id)) {
      found.push(id);
    }
  }
  return found.toSorted();
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(DataSaverVideoRepository.name, () => {
  describe('getForJob', () => {
    it('reads the trimmed file and the copy the video already has', async () => {
      const { ctx, user, sut } = await setup();
      const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.EncodedVideo,
        path: '/encoded.mp4',
        isEdited: false,
      });

      await expect(sut.getForJob(asset.id)).resolves.toMatchObject({
        id: asset.id,
        type: AssetType.Video,
        path: null,
        settings: null,
        editedVideoPath: null,
      });

      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.EncodedVideo,
        path: '/edited.mp4',
        isEdited: true,
      });
      await sut.upsert(copy(asset.id));

      await expect(sut.getForJob(asset.id)).resolves.toMatchObject({
        path: diskPath(asset.id),
        settings: SETTINGS,
        editedVideoPath: '/edited.mp4',
      });
    });

    it('returns nothing for a trashed video', async () => {
      const { ctx, user, sut } = await setup();
      const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video, deletedAt: new Date() });
      await expect(sut.getForJob(asset.id)).resolves.toBeUndefined();
    });
  });

  describe('streamForQueue', () => {
    it('streams visible videos with no copy or a stale one, and every visible video when forced', async () => {
      const { ctx, user, sut } = await setup();
      const video = { ownerId: user.id, type: AssetType.Video };
      const { asset: missing } = await ctx.newAsset(video);
      const { asset: current } = await ctx.newAsset(video);
      const { asset: notNeeded } = await ctx.newAsset(video);
      const { asset: stale } = await ctx.newAsset(video);
      const { asset: archived } = await ctx.newAsset({ ...video, visibility: AssetVisibility.Archive });
      const { asset: hidden } = await ctx.newAsset({ ...video, visibility: AssetVisibility.Hidden });
      const { asset: trashed } = await ctx.newAsset({ ...video, deletedAt: new Date() });
      const { asset: photo } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Image });
      await sut.upsert(copy(current.id));
      await sut.upsert(copy(notNeeded.id, { path: null }));
      await sut.upsert(copy(stale.id, { settings: 'h264:720:2500k' }));
      const ids = [missing.id, current.id, notNeeded.id, stale.id, archived.id, hidden.id, trashed.id, photo.id];

      await expect(queued(sut, ids)).resolves.toEqual([missing.id, stale.id, archived.id].toSorted());
      await expect(queued(sut, ids, true)).resolves.toEqual(
        [missing.id, current.id, notNeeded.id, stale.id, archived.id].toSorted(),
      );
    });
  });

  describe('upsert', () => {
    it('stores a row and replaces it when the video is processed again', async () => {
      const { ctx, user, sut } = await setup();
      const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      await expect(sut.get(asset.id)).resolves.toBeUndefined();

      await sut.upsert(copy(asset.id));
      await expect(sut.get(asset.id)).resolves.toEqual({
        path: diskPath(asset.id),
        settings: SETTINGS,
        fromEdited: false,
      });

      await sut.upsert(copy(asset.id, { path: null, fromEdited: true }));
      await expect(sut.get(asset.id)).resolves.toEqual({ path: null, settings: SETTINGS, fromEdited: true });
    });

    it('cascades with the asset', async () => {
      const { ctx, user, sut } = await setup();
      const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      await sut.upsert(copy(asset.id));

      await ctx.database.deleteFrom('asset').where('id', '=', asset.id).execute();

      await expect(sut.get(asset.id)).resolves.toBeUndefined();
    });
  });

  describe('storage migration', () => {
    it('streams, counts and moves copies with the encoded videos, skipping videos without one', async () => {
      const { ctx, user, sut } = await setup();
      const migration = new StorageMigrationRepository(defaultDatabase);
      const video = { ownerId: user.id, type: AssetType.Video };
      const { asset: onDisk } = await ctx.newAsset(video);
      const { asset: onS3 } = await ctx.newAsset(video);
      const { asset: none } = await ctx.newAsset(video);
      const before = await migration.getFileCounts('toS3');
      await sut.upsert(copy(onDisk.id));
      await sut.upsert(copy(onS3.id, { path: `encoded-video/${onS3.id}_ds.mp4` }));
      await sut.upsert(copy(none.id, { path: null }));

      const toS3: string[] = [];
      for await (const row of migration.streamDataSaverVideos('toS3')) {
        toS3.push(row.assetId);
      }
      expect(toS3).toContain(onDisk.id);
      expect(toS3).not.toContain(onS3.id);
      expect(toS3).not.toContain(none.id);
      await expect(migration.getFileCounts('toS3')).resolves.toMatchObject({
        encodedVideos: Number(before.encodedVideos) + 1,
      });

      await expect(migration.updateDataSaverVideoPath(onDisk.id, '/elsewhere.mp4', 'moved.mp4')).resolves.toBe(false);
      await expect(migration.updateDataSaverVideoPath(onDisk.id, diskPath(onDisk.id), 'moved.mp4')).resolves.toBe(true);
      await expect(sut.get(onDisk.id)).resolves.toMatchObject({ path: 'moved.mp4' });
    });
  });

  describe('integrity check', () => {
    it('counts copies as tracked files, so the untracked-file report leaves them alone', async () => {
      const { ctx, user, sut } = await setup();
      const integrity = new IntegrityRepository(defaultDatabase);
      const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      const path = diskPath(asset.id);
      const orphan = `/encoded-video/${asset.id}_orphan.mp4`;
      await sut.upsert(copy(asset.id));

      await expect(sut.getPathsByPaths([path, orphan])).resolves.toEqual([{ path }]);
      await expect(integrity.getTrackedPaths([path, orphan])).resolves.toEqual([{ path }]);
    });
  });
});
