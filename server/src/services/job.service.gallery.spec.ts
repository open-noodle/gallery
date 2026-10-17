import { AssetType, AssetVisibility, JobName, JobStatus, QueueName } from 'src/enum.js';
import { JobService } from 'src/services/job.service.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe('JobService.onJobRun for AssetVideoTrimGenerate', () => {
  let sut: JobService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(JobService));
  });

  it('sends AssetEditReadyV2 once the trim job succeeds, as the edit job does', async () => {
    mocks.job.run.mockResolvedValue(JobStatus.Success);
    const assetId = newUuid();
    const ownerId = newUuid();
    mocks.asset.getById.mockResolvedValue({
      id: assetId,
      ownerId,
      originalFileName: 'clip.mp4',
      thumbhash: null,
      checksum: Buffer.from('abc123'),
      type: AssetType.Video,
      visibility: AssetVisibility.Timeline,
      isEdited: true,
    } as any);
    mocks.assetEdit.getWithSyncInfo.mockResolvedValue([]);

    await sut.onJobRun(QueueName.Editor, { name: JobName.AssetVideoTrimGenerate, data: { id: assetId } });

    expect(mocks.websocket.clientSend).toHaveBeenCalledWith('AssetEditReadyV2', ownerId, {
      asset: expect.objectContaining({ id: assetId, ownerId, isEdited: true }),
      edit: [],
    });
  });

  it('sends nothing when the trim job fails', async () => {
    mocks.job.run.mockResolvedValue(JobStatus.Failed);

    await sut.onJobRun(QueueName.Editor, { name: JobName.AssetVideoTrimGenerate, data: { id: newUuid() } });

    expect(mocks.websocket.clientSend).not.toHaveBeenCalled();
  });
});
