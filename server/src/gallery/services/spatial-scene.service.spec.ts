import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import { AssetType, AssetVisibility, CacheControl, ImmichWorker, JobName, JobStatus } from 'src/enum.js';
import { SpatialSceneService } from 'src/gallery/services/spatial-scene.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, makeStream, newTestService } from 'test/utils.js';

const enabled = (spatialScene: Record<string, unknown> = {}) => ({
  machineLearning: {
    enabled: true,
    spatialScene: { enabled: true, modelName: 'depth-anything-v2-small', ...spatialScene },
  },
});

const config = (enabled: boolean, modelName: string) =>
  ({ machineLearning: { enabled: true, spatialScene: { enabled, modelName } } }) as any;

const photo = {
  id: 'asset-1',
  ownerId: 'owner-1',
  type: AssetType.Image,
  visibility: AssetVisibility.Timeline,
  originalPath: '/data/library/owner-1/IMG_0001.HEIC',
  projectionType: null,
  previewPath: '/data/thumbs/owner-1/as/se/asset-1_preview.jpeg',
};

const depth = {
  depth: Buffer.from('png bytes').toString('base64'),
  width: 518,
  height: 686,
  boundarySharpness: 0.09,
  edgeDensity: 0.013,
  foregroundRatio: 0.3,
  focus: 0.83,
};

describe(SpatialSceneService.name, () => {
  let sut: SpatialSceneService;
  let mocks: ServiceMocks;
  let put: ReturnType<typeof vi.fn>;
  let exists: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearConfigCache();
    ({ sut, mocks } = newTestService(SpatialSceneService));
    mocks.config.getWorker.mockReturnValue(ImmichWorker.Microservices);
    put = vi.fn().mockResolvedValue(undefined);
    exists = vi.fn().mockResolvedValue(true);
    // Not a DiskStorageBackend, so depthMapPath takes the S3 form: a relative key.
    vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue({ put, exists } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onJobSuccess', () => {
    beforeEach(() => mocks.systemMetadata.get.mockResolvedValue(enabled()));

    it('queues a depth map after an upload thumbnail run', async () => {
      await sut.onJobSuccess({
        job: { name: JobName.AssetGenerateThumbnails, data: { id: 'asset-1', source: 'upload' } },
        response: JobStatus.Success,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SpatialScene, data: { id: 'asset-1' } });
    });

    it('queues a new depth map after an edit, which changes the geometry', async () => {
      await sut.onJobSuccess({
        job: { name: JobName.AssetEditThumbnailGeneration, data: { id: 'asset-1' } },
        response: JobStatus.Success,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SpatialScene, data: { id: 'asset-1' } });
    });

    it('does nothing for a non-upload thumbnail run, a failed run or another job', async () => {
      await sut.onJobSuccess({
        job: { name: JobName.AssetGenerateThumbnails, data: { id: 'asset-1' } },
        response: JobStatus.Success,
      });
      await sut.onJobSuccess({
        job: { name: JobName.AssetGenerateThumbnails, data: { id: 'asset-1', source: 'upload' } },
        response: JobStatus.Failed,
      });
      await sut.onJobSuccess({ job: { name: JobName.Ocr, data: { id: 'asset-1' } }, response: JobStatus.Success });
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does nothing while Spatial Scene is off', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { spatialScene: { enabled: false } } });
      await sut.onJobSuccess({
        job: { name: JobName.AssetGenerateThumbnails, data: { id: 'asset-1', source: 'upload' } },
        response: JobStatus.Success,
      });
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('onConfigUpdate', () => {
    it('reprocesses every photo when the model changes', async () => {
      await sut.onConfigUpdate({
        oldConfig: config(true, 'depth-anything-v2-small'),
        newConfig: config(true, 'distill-any-depth-large'),
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SpatialSceneQueueAll, data: { force: true } });
    });

    it('does nothing when the model is unchanged, or Spatial Scene is off', async () => {
      await sut.onConfigUpdate({ oldConfig: config(false, 'a'), newConfig: config(true, 'a') });
      await sut.onConfigUpdate({ oldConfig: config(true, 'a'), newConfig: config(false, 'b') });
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('onAssetDelete', () => {
    it('deletes the depth map, found by its deterministic path', async () => {
      await sut.onAssetDelete({ assetId: 'asset-1', userId: 'owner-1' });
      expect(exists).toHaveBeenCalledWith('thumbs/owner-1/as/se/asset-1_depth.png');
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: ['thumbs/owner-1/as/se/asset-1_depth.png'] },
      });
    });

    it('queues nothing for a photo without one, so the disk backend does not warn', async () => {
      exists.mockResolvedValue(false);
      await sut.onAssetDelete({ assetId: 'asset-1', userId: 'owner-1' });
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('handleQueueSpatialScene', () => {
    it('is skipped while Spatial Scene is off', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { spatialScene: { enabled: false } } });
      await expect(sut.handleQueueSpatialScene({ force: false })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.spatialScene.streamForQueue).not.toHaveBeenCalled();
    });

    it('queues one job per photo, passing force through', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled());
      mocks.spatialScene.streamForQueue.mockReturnValue(makeStream([{ id: 'asset-1' }, { id: 'asset-2' }]));

      await expect(sut.handleQueueSpatialScene({ force: true })).resolves.toBe(JobStatus.Success);

      expect(mocks.spatialScene.streamForQueue).toHaveBeenCalledWith(true);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.SpatialScene, data: { id: 'asset-1' } },
        { name: JobName.SpatialScene, data: { id: 'asset-2' } },
      ]);
    });
  });

  describe('handleSpatialScene', () => {
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue(enabled());
      mocks.spatialScene.getForJob.mockResolvedValue(photo);
      mocks.machineLearning.estimateDepth.mockResolvedValue(depth);
    });

    it('stores the depth map beside the thumbnails and records it', async () => {
      await expect(sut.handleSpatialScene({ id: 'asset-1' })).resolves.toBe(JobStatus.Success);

      expect(mocks.machineLearning.estimateDepth).toHaveBeenCalledWith(photo.previewPath, {
        modelName: 'depth-anything-v2-small',
      });
      expect(put).toHaveBeenCalledWith('thumbs/owner-1/as/se/asset-1_depth.png', Buffer.from('png bytes'), {
        contentType: 'image/png',
      });
      expect(mocks.spatialScene.upsert).toHaveBeenCalledWith({
        assetId: 'asset-1',
        path: 'thumbs/owner-1/as/se/asset-1_depth.png',
        width: 518,
        height: 686,
        boundarySharpness: 0.09,
        edgeDensity: 0.013,
        foregroundRatio: 0.3,
        focus: 0.83,
        modelName: 'depth-anything-v2-small',
      });
    });

    it('stores an absolute path on the disk backend', async () => {
      const disk = Object.assign(Object.create(DiskStorageBackend.prototype), { put });
      vi.spyOn(StorageService, 'getWriteBackend').mockReturnValue(disk);

      await sut.handleSpatialScene({ id: 'asset-1' });

      const [path] = put.mock.calls[0];
      expect(path).toMatch(/^\/.*\/thumbs\/owner-1\/as\/se\/asset-1_depth\.png$/);
      expect(mocks.spatialScene.upsert).toHaveBeenCalledWith(expect.objectContaining({ path }));
    });

    it.each([
      ['deleted since it was queued', undefined],
      ['a video', { ...photo, type: AssetType.Video }],
      ['hidden', { ...photo, visibility: AssetVisibility.Hidden }],
      ['an equirectangular panorama', { ...photo, projectionType: 'EQUIRECTANGULAR' }],
      ['an Insta360 panorama', { ...photo, originalPath: '/data/library/owner-1/VID.insp' }],
    ])('skips a photo that is %s', async (_, asset) => {
      mocks.spatialScene.getForJob.mockResolvedValue(asset as any);
      await expect(sut.handleSpatialScene({ id: 'asset-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.machineLearning.estimateDepth).not.toHaveBeenCalled();
    });

    it('fails a photo without a preview', async () => {
      mocks.spatialScene.getForJob.mockResolvedValue({ ...photo, previewPath: null });
      await expect(sut.handleSpatialScene({ id: 'asset-1' })).resolves.toBe(JobStatus.Failed);
    });

    it('drops a map computed with a model that was switched away from mid-call', async () => {
      mocks.systemMetadata.get
        .mockResolvedValueOnce(enabled())
        .mockResolvedValue(enabled({ modelName: 'distill-any-depth-large' }));
      // the second read must see the change: the service reads the config through the cache
      mocks.machineLearning.estimateDepth.mockImplementation(() => {
        clearConfigCache();
        return Promise.resolve(depth);
      });

      await expect(sut.handleSpatialScene({ id: 'asset-1' })).resolves.toBe(JobStatus.Skipped);
      expect(put).not.toHaveBeenCalled();
      expect(mocks.spatialScene.upsert).not.toHaveBeenCalled();
    });

    it('fails when the machine learning service does', async () => {
      mocks.machineLearning.estimateDepth.mockRejectedValue(new Error('ML down'));
      await expect(sut.handleSpatialScene({ id: 'asset-1' })).resolves.toBe(JobStatus.Failed);
      expect(mocks.spatialScene.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getDepthMap', () => {
    const auth = factory.auth({ user: { id: 'owner-1' } });

    it('requires view access to the photo', async () => {
      await expect(sut.getDepthMap(auth, 'asset-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.spatialScene.get).not.toHaveBeenCalled();
    });

    it('responds 404 for a photo without a depth map', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.spatialScene.get.mockResolvedValue(undefined);
      await expect(sut.getDepthMap(auth, 'asset-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('serves the stored map', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
      mocks.spatialScene.get.mockResolvedValue({ path: 'thumbs/owner-1/as/se/asset-1_depth.png' } as any);
      const serve = vi.spyOn(sut['backendMedia'], 'serveFromBackend').mockResolvedValue({} as any);

      await sut.getDepthMap(auth, 'asset-1');

      expect(serve).toHaveBeenCalledWith(
        'thumbs/owner-1/as/se/asset-1_depth.png',
        'image/png',
        CacheControl.PrivateWithCache,
      );
    });
  });

  describe('per-photo actions', () => {
    const auth = factory.auth({ user: { id: 'owner-1' } });

    describe('refreshDepthMap', () => {
      it('requires edit access to the photo', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled());
        mocks.spatialScene.getForJob.mockResolvedValue(photo);
        await expect(sut.refreshDepthMap(auth, 'asset-1')).rejects.toBeInstanceOf(BadRequestException);
        expect(mocks.job.queue).not.toHaveBeenCalled();
      });

      it('lets a space Editor of the photo refresh it', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled());
        mocks.access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set(['asset-1']));
        mocks.spatialScene.getForJob.mockResolvedValue(photo);
        await sut.refreshDepthMap(auth, 'asset-1');
        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SpatialScene, data: { id: 'asset-1' } });
      });

      it('is refused while Spatial Scene is off', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
        mocks.systemMetadata.get.mockResolvedValue(config(false, 'depth-anything-v2-small'));
        mocks.spatialScene.getForJob.mockResolvedValue(photo);
        await expect(sut.refreshDepthMap(auth, 'asset-1')).rejects.toThrow('Spatial Scene is disabled');
        expect(mocks.job.queue).not.toHaveBeenCalled();
      });

      it.each([
        ['a video', { type: AssetType.Video }],
        ['a hidden photo', { visibility: AssetVisibility.Hidden }],
        ['an equirectangular panorama', { projectionType: 'EQUIRECTANGULAR' }],
        ['an .insp panorama', { originalPath: '/data/library/owner-1/IMG_0001.insp' }],
      ])('is refused for %s', async (_label, overrides) => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
        mocks.systemMetadata.get.mockResolvedValue(enabled());
        mocks.spatialScene.getForJob.mockResolvedValue({ ...photo, ...overrides } as any);
        await expect(sut.refreshDepthMap(auth, 'asset-1')).rejects.toThrow('not available for this asset');
        expect(mocks.job.queue).not.toHaveBeenCalled();
      });

      it('is refused for a trashed photo', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
        mocks.systemMetadata.get.mockResolvedValue(enabled());
        mocks.spatialScene.getForJob.mockResolvedValue(undefined);
        await expect(sut.refreshDepthMap(auth, 'asset-1')).rejects.toBeInstanceOf(BadRequestException);
      });

      it('queues a new depth map', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
        mocks.systemMetadata.get.mockResolvedValue(enabled());
        mocks.spatialScene.getForJob.mockResolvedValue(photo);
        await sut.refreshDepthMap(auth, 'asset-1');
        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SpatialScene, data: { id: 'asset-1' } });
      });
    });

    describe('setOffer', () => {
      it('requires edit access to the photo, writing nothing', async () => {
        mocks.systemMetadata.get.mockResolvedValue(enabled());
        mocks.spatialScene.getForJob.mockResolvedValue(photo);
        await expect(sut.setOffer(auth, 'asset-1', { offered: true })).rejects.toBeInstanceOf(BadRequestException);
        expect(mocks.spatialScene.setOffer).not.toHaveBeenCalled();
        expect(mocks.job.queue).not.toHaveBeenCalled();
      });

      it('is refused while Spatial Scene is off, writing nothing', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
        mocks.systemMetadata.get.mockResolvedValue(config(false, 'depth-anything-v2-small'));
        await expect(sut.setOffer(auth, 'asset-1', { offered: true })).rejects.toThrow('Spatial Scene is disabled');
        expect(mocks.spatialScene.setOffer).not.toHaveBeenCalled();
      });

      it('is refused for a video, writing nothing', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
        mocks.systemMetadata.get.mockResolvedValue(enabled());
        mocks.spatialScene.getForJob.mockResolvedValue({ ...photo, type: AssetType.Video });
        await expect(sut.setOffer(auth, 'asset-1', { offered: true })).rejects.toBeInstanceOf(BadRequestException);
        expect(mocks.spatialScene.setOffer).not.toHaveBeenCalled();
      });

      it('offers it on a photo with a depth map, queuing nothing', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
        mocks.systemMetadata.get.mockResolvedValue(enabled());
        mocks.spatialScene.getForJob.mockResolvedValue(photo);
        mocks.spatialScene.get.mockResolvedValue({ path: 'thumbs/owner-1/as/se/asset-1_depth.png' } as any);
        await sut.setOffer(auth, 'asset-1', { offered: true });
        expect(mocks.spatialScene.setOffer).toHaveBeenCalledWith('asset-1', true);
        expect(mocks.job.queue).not.toHaveBeenCalled();
      });

      it('queues a depth map when offering it on a photo without one', async () => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
        mocks.systemMetadata.get.mockResolvedValue(enabled());
        mocks.spatialScene.getForJob.mockResolvedValue(photo);
        mocks.spatialScene.get.mockResolvedValue(undefined);
        await sut.setOffer(auth, 'asset-1', { offered: true });
        expect(mocks.spatialScene.setOffer).toHaveBeenCalledWith('asset-1', true);
        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SpatialScene, data: { id: 'asset-1' } });
      });

      it.each([false, null])('records offered: %s without queuing a depth map', async (offered) => {
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
        mocks.systemMetadata.get.mockResolvedValue(enabled());
        mocks.spatialScene.getForJob.mockResolvedValue(photo);
        mocks.spatialScene.get.mockResolvedValue(undefined);
        await sut.setOffer(auth, 'asset-1', { offered });
        expect(mocks.spatialScene.setOffer).toHaveBeenCalledWith('asset-1', offered);
        expect(mocks.job.queue).not.toHaveBeenCalled();
      });
    });
  });

  describe('choices, for the admin', () => {
    it('counts them', async () => {
      mocks.spatialScene.countOffers.mockResolvedValue(4);
      await expect(sut.getChoices()).resolves.toEqual({ count: 4 });
    });

    it('clears them, whether or not Spatial Scene is on, and says how many', async () => {
      mocks.systemMetadata.get.mockResolvedValue(config(false, 'depth-anything-v2-small'));
      mocks.spatialScene.deleteOffers.mockResolvedValue(4);
      await expect(sut.clearChoices(factory.auth({ user: { id: 'admin-1', isAdmin: true } }))).resolves.toEqual({
        count: 4,
      });
      expect(mocks.spatialScene.deleteOffers).toHaveBeenCalledOnce();
    });
  });
});
