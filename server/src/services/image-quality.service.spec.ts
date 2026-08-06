import { AssetVisibility, ImmichWorker, JobName, JobStatus } from 'src/enum';
import { ImageQualityService } from 'src/services/image-quality.service';
import { AssetFactory } from 'test/factories/asset.factory';
import { systemConfigStub } from 'test/fixtures/system-config.stub';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';

describe(ImageQualityService.name, () => {
  let sut: ImageQualityService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(ImageQualityService));

    mocks.config.getWorker.mockReturnValue(ImmichWorker.Microservices);
    mocks.assetJob.getForImageQuality.mockResolvedValue({
      visibility: AssetVisibility.Timeline,
      previewFile: '/uploads/user-id/thumbs/path.jpg',
    });
    mocks.machineLearning.analyzeAssetQuality.mockResolvedValue({
      sharpness: 82,
      exposure: 91,
      brightness: 47,
      quality: 78,
    });
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('handleQueueImageQuality', () => {
    it('should do nothing if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.machineLearningDisabled);

      await sut.handleQueueImageQuality({ force: false });

      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('should queue unscored assets', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForImageQualityJob.mockReturnValue(makeStream([asset]));

      await sut.handleQueueImageQuality({ force: false });

      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.ImageQuality, data: { id: asset.id } }]);
      expect(mocks.assetJob.streamForImageQualityJob).toHaveBeenCalledWith(false);
    });

    it('should queue all assets when forced', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForImageQualityJob.mockReturnValue(makeStream([asset]));

      await sut.handleQueueImageQuality({ force: true });

      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.ImageQuality, data: { id: asset.id } }]);
      expect(mocks.assetJob.streamForImageQualityJob).toHaveBeenCalledWith(true);
    });

    it('should flush jobs in batches when exceeding pagination size', async () => {
      const assets = Array.from({ length: 1001 }, (_, i) => AssetFactory.create({ id: `asset-${i}` }));
      mocks.assetJob.streamForImageQualityJob.mockReturnValue(makeStream(assets));

      await sut.handleQueueImageQuality({ force: false });

      expect(mocks.job.queueAll).toHaveBeenCalledTimes(2);
      expect(mocks.job.queueAll.mock.calls[0][0]).toHaveLength(1000);
      expect(mocks.job.queueAll.mock.calls[1][0]).toHaveLength(1);
    });
  });

  describe('handleImageQuality', () => {
    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.machineLearningDisabled);

      expect(await sut.handleImageQuality({ id: '123' })).toEqual(JobStatus.Skipped);
      expect(mocks.machineLearning.analyzeAssetQuality).not.toHaveBeenCalled();
    });

    it('should fail when the asset is not found', async () => {
      mocks.assetJob.getForImageQuality.mockResolvedValue(void 0);

      expect(await sut.handleImageQuality({ id: 'missing' })).toEqual(JobStatus.Failed);
      expect(mocks.machineLearning.analyzeAssetQuality).not.toHaveBeenCalled();
    });

    it('should fail when the asset has no preview file', async () => {
      mocks.assetJob.getForImageQuality.mockResolvedValue({ visibility: AssetVisibility.Timeline, previewFile: null });

      expect(await sut.handleImageQuality({ id: 'no-preview' })).toEqual(JobStatus.Failed);
      expect(mocks.machineLearning.analyzeAssetQuality).not.toHaveBeenCalled();
    });

    it('should skip hidden assets', async () => {
      mocks.assetJob.getForImageQuality.mockResolvedValue({
        visibility: AssetVisibility.Hidden,
        previewFile: '/uploads/user-id/thumbs/path.jpg',
      });

      expect(await sut.handleImageQuality({ id: 'hidden' })).toEqual(JobStatus.Skipped);
      expect(mocks.machineLearning.analyzeAssetQuality).not.toHaveBeenCalled();
    });

    it('should score the asset and store the result', async () => {
      const asset = AssetFactory.create();

      expect(await sut.handleImageQuality({ id: asset.id })).toEqual(JobStatus.Success);

      expect(mocks.machineLearning.analyzeAssetQuality).toHaveBeenCalledWith('/uploads/user-id/thumbs/path.jpg');
      expect(mocks.asset.upsertAssetQuality).toHaveBeenCalledWith({
        assetId: asset.id,
        sharpness: 82,
        exposure: 91,
        brightness: 47,
        quality: 78,
      });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: asset.id,
        qualityScoredAt: expect.any(Date),
      });
    });
  });
});
