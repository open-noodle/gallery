import { AssetType, AssetVisibility, JobName, JobStatus, QueueName } from 'src/enum.js';
import { JobService } from 'src/services/job.service.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { getForAsset } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const setupEditReady = () => {
  const { sut, mocks } = newTestService(JobService);
  const owner = UserFactory.create();
  const editor = UserFactory.create();
  const asset = AssetFactory.create({ ownerId: owner.id, isFavorite: true, duration: 100 });
  mocks.job.run.mockResolvedValue(JobStatus.Success);
  mocks.asset.getById.mockResolvedValue(getForAsset(asset));
  mocks.assetEdit.getWithSyncInfo.mockResolvedValue([]);
  mocks.user.get.mockResolvedValue(editor);
  mocks.access.spaceAsset.checkSpaceAccess.mockResolvedValue(new Set([asset.id]));
  mocks.asset.getByIds.mockResolvedValue([{ ...asset, duration: 40, isFavoriteForUser: false }]);
  return { sut, mocks, owner, editor, asset };
};

describe('Gallery edit completion delivery', () => {
  it.each([JobName.AssetEditThumbnailGeneration, JobName.AssetVideoTrimGenerate] as const)(
    '%s delivers to the owner and initiating Gallery user with viewer fields',
    async (name) => {
      const { sut, mocks, owner, editor, asset } = setupEditReady();
      await sut.onJobRun(QueueName.Editor, { name, data: { id: asset.id, initiatorId: editor.id } });

      expect(mocks.websocket.clientSend).toHaveBeenCalledExactlyOnceWith(
        'AssetEditReadyV2',
        owner.id,
        expect.objectContaining({ asset: expect.objectContaining({ id: asset.id, isFavorite: true, duration: 100 }) }),
      );
      // No fourth argument: stock sockets receive no cross-owner event.
      expect(mocks.websocket.clientSendByClient).toHaveBeenCalledExactlyOnceWith('AssetEditReadyV2', editor.id, [
        expect.objectContaining({ asset: expect.objectContaining({ id: asset.id, isFavorite: false, duration: 40 }) }),
      ]);
      expect(mocks.asset.getByIds).toHaveBeenCalledExactlyOnceWith([asset.id], editor.id);
      expect(mocks.event.emit).not.toHaveBeenCalledWith('JobError', expect.anything());
    },
  );

  it('supports the inverse favorite projection', async () => {
    const { sut, mocks, editor, asset } = setupEditReady();
    mocks.asset.getById.mockResolvedValue({ ...getForAsset(asset), isFavorite: false });
    mocks.asset.getByIds.mockResolvedValue([{ ...asset, isFavoriteForUser: 1 }]);
    await sut.onJobRun(QueueName.Editor, {
      name: JobName.AssetEditThumbnailGeneration,
      data: { id: asset.id, initiatorId: editor.id },
    });
    expect(mocks.websocket.clientSendByClient).toHaveBeenCalledWith('AssetEditReadyV2', editor.id, [
      expect.objectContaining({ asset: expect.objectContaining({ isFavorite: true }) }),
    ]);
  });

  it.each(['legacy job', 'owner initiator', 'revoked access', 'deleted user', 'missing asset projection'])(
    '%s preserves owner delivery without forwarding',
    async (scenario) => {
      const { sut, mocks, owner, editor, asset } = setupEditReady();
      switch (scenario) {
        case 'revoked access': {
          mocks.access.spaceAsset.checkSpaceAccess.mockResolvedValue(new Set());

          break;
        }
        case 'deleted user': {
          mocks.user.get.mockResolvedValue(undefined);

          break;
        }
        case 'missing asset projection': {
          mocks.asset.getByIds.mockResolvedValue([]);

          break;
        }
        // No default
      }
      const initiatorId = scenario === 'legacy job' ? undefined : scenario === 'owner initiator' ? owner.id : editor.id;
      await sut.onJobRun(QueueName.Editor, {
        name: JobName.AssetEditThumbnailGeneration,
        data: { id: asset.id, initiatorId },
      });
      expect(mocks.websocket.clientSend).toHaveBeenCalledOnce();
      expect(mocks.websocket.clientSendByClient).not.toHaveBeenCalled();
      expect(mocks.event.emit).not.toHaveBeenCalledWith('JobError', expect.anything());
      if (scenario === 'revoked access') {
        expect(mocks.asset.getByIds).not.toHaveBeenCalled();
      }
    },
  );
});

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
