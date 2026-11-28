import { AssetType, JobName, JobStatus } from 'src/enum.js';
import { MediaService } from 'src/services/media.service.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { getForGenerateThumbnail } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe('Gallery edit completion through video thumbnail delegation', () => {
  it('carries the initiating user to the final trim job', async () => {
    const { sut, mocks } = newTestService(MediaService);
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    const initiatorId = newUuid();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    await expect(sut.handleAssetEditThumbnailGeneration({ id: asset.id, initiatorId })).resolves.toBe(
      JobStatus.Success,
    );
    expect(mocks.job.queue).toHaveBeenCalledExactlyOnceWith({
      name: JobName.AssetVideoTrimGenerate,
      data: { id: asset.id, initiatorId },
    });
  });
});

describe('MediaService.handleAssetEditThumbnailGeneration for a video', () => {
  let sut: MediaService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(MediaService));
  });

  it('hands the video to the trim job and generates nothing itself', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));

    await expect(sut.handleAssetEditThumbnailGeneration({ id: asset.id })).resolves.toBe(JobStatus.Success);

    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.AssetVideoTrimGenerate, data: { id: asset.id } });
    expect(mocks.videoTrim.trim).not.toHaveBeenCalled();
    expect(mocks.asset.deleteFiles).not.toHaveBeenCalled();
    expect(mocks.asset.upsertFiles).not.toHaveBeenCalled();
  });
});
