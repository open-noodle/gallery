import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetFileType, AssetType, AssetVisibility } from 'src/enum.js';
import { SpatialSceneRepository } from 'src/gallery/repositories/spatial-scene.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StorageMigrationRepository } from 'src/repositories/storage-migration.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const scene = (assetId: string, overrides: { path?: string; modelName?: string } = {}) => ({
  assetId,
  path: `/thumbs/${assetId}_depth.png`,
  width: 518,
  height: 686,
  boundarySharpness: 0.05,
  edgeDensity: 0.03,
  foregroundRatio: 0.4,
  focus: 0.6,
  modelName: 'depth-anything-v2-small',
  ...overrides,
});

const setup = async () => {
  const { ctx } = newMediumService(BaseService, { database: defaultDatabase, real: [], mock: [LoggingRepository] });
  const { user } = await ctx.newUser();
  return { ctx, user, sut: ctx.get(SpatialSceneRepository) };
};

const queued = async (sut: SpatialSceneRepository, ids: string[], force?: boolean) => {
  const found: string[] = [];
  for await (const { id } of sut.streamForQueue(force)) {
    if (ids.includes(id)) {
      found.push(id);
    }
  }
  return found.toSorted();
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SpatialSceneRepository.name, () => {
  describe('getForJob', () => {
    it('reads the preview that matches whether the photo is edited, and the projection', async () => {
      const { ctx, user, sut } = await setup();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, projectionType: 'EQUIRECTANGULAR' });
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: '/preview.jpg', isEdited: false });
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: '/edited.jpg', isEdited: true });

      await expect(sut.getForJob(asset.id)).resolves.toMatchObject({
        id: asset.id,
        type: AssetType.Image,
        previewPath: '/preview.jpg',
        projectionType: 'EQUIRECTANGULAR',
      });

      await ctx.database.updateTable('asset').set({ isEdited: true }).where('id', '=', asset.id).execute();

      await expect(sut.getForJob(asset.id)).resolves.toMatchObject({ previewPath: '/edited.jpg' });
    });

    it('returns a photo without a preview yet, and nothing for a trashed one', async () => {
      const { ctx, user, sut } = await setup();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: trashed } = await ctx.newAsset({ ownerId: user.id, deletedAt: new Date() });

      await expect(sut.getForJob(asset.id)).resolves.toMatchObject({ previewPath: null, projectionType: null });
      await expect(sut.getForJob(trashed.id)).resolves.toBeUndefined();
    });
  });

  describe('streamForQueue', () => {
    it('streams visible photos without a depth map, and every visible photo when forced', async () => {
      const { ctx, user, sut } = await setup();
      const { asset: missing } = await ctx.newAsset({ ownerId: user.id });
      const { asset: done } = await ctx.newAsset({ ownerId: user.id });
      const { asset: archived } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      const { asset: video } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });
      const { asset: hidden } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
      const { asset: trashed } = await ctx.newAsset({ ownerId: user.id, deletedAt: new Date() });
      await sut.upsert(scene(done.id));
      const ids = [missing.id, done.id, archived.id, video.id, hidden.id, trashed.id];

      await expect(queued(sut, ids)).resolves.toEqual([missing.id, archived.id].toSorted());
      await expect(queued(sut, ids, true)).resolves.toEqual([missing.id, done.id, archived.id].toSorted());
    });
  });

  describe('upsert', () => {
    it('stores a row and replaces it when the photo is processed again', async () => {
      const { ctx, user, sut } = await setup();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await expect(sut.get(asset.id)).resolves.toBeUndefined();

      await sut.upsert(scene(asset.id));
      const { assetId: _, ...stored } = scene(asset.id);
      await expect(sut.get(asset.id)).resolves.toEqual(stored);

      await sut.upsert(scene(asset.id, { path: 'thumbs/depth.png', modelName: 'distill-any-depth-large' }));
      await expect(sut.get(asset.id)).resolves.toMatchObject({
        path: 'thumbs/depth.png',
        modelName: 'distill-any-depth-large',
      });
    });

    it('cascades with the asset', async () => {
      const { ctx, user, sut } = await setup();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await sut.upsert(scene(asset.id));

      await ctx.database.deleteFrom('asset').where('id', '=', asset.id).execute();

      await expect(sut.get(asset.id)).resolves.toBeUndefined();
    });
  });

  describe('storage migration', () => {
    it('streams, counts and moves depth maps with the previews', async () => {
      const { ctx, user, sut } = await setup();
      const migration = new StorageMigrationRepository(defaultDatabase);
      const { asset: onDisk } = await ctx.newAsset({ ownerId: user.id });
      const { asset: onS3 } = await ctx.newAsset({ ownerId: user.id });
      const before = await migration.getFileCounts('toS3');
      await sut.upsert(scene(onDisk.id));
      await sut.upsert(scene(onS3.id, { path: `thumbs/${onS3.id}_depth.png` }));

      const toS3: string[] = [];
      for await (const row of migration.streamDepthMaps('toS3')) {
        toS3.push(row.assetId);
      }
      expect(toS3).toContain(onDisk.id);
      expect(toS3).not.toContain(onS3.id);
      await expect(migration.getFileCounts('toS3')).resolves.toMatchObject({ previews: before.previews + 1 });

      await expect(migration.updateDepthMapPath(onDisk.id, '/elsewhere.png', 'moved.png')).resolves.toBe(false);
      await expect(migration.updateDepthMapPath(onDisk.id, scene(onDisk.id).path, 'moved.png')).resolves.toBe(true);
      await expect(sut.get(onDisk.id)).resolves.toMatchObject({ path: 'moved.png' });
    });
  });
});
