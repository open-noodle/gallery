import { JobName } from 'src/enum';
import { StorageUsageService } from 'src/gallery/storage-usage.service';
import { mockEnvData } from 'test/repositories/config.repository.mock';
import { newTestService, ServiceMocks } from 'test/utils';

const config = (display: boolean, quota: boolean) =>
  ({ storageUsage: { includeDerivativesInDisplay: display, includeDerivativesInQuota: quota } }) as never;

describe(StorageUsageService.name, () => {
  let sut: StorageUsageService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(StorageUsageService));
  });

  describe('onConfigInit', () => {
    it('queues a resync on a config file install with a toggle on', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));

      await sut.onConfigInit({ newConfig: config(true, false) });

      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.UserSyncUsage });
    });

    it('does not queue a resync on a config file install with both toggles off', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));

      await sut.onConfigInit({ newConfig: config(false, false) });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does not queue a resync without a config file, where ConfigUpdate already covers it', async () => {
      await sut.onConfigInit({ newConfig: config(true, true) });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  it('queues a resync when the first toggle is switched on', async () => {
    await sut.onConfigUpdate({ oldConfig: config(false, false), newConfig: config(true, false) });

    expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.UserSyncUsage });
  });

  it('does not queue a resync when both toggles stay off', async () => {
    await sut.onConfigUpdate({ oldConfig: config(false, false), newConfig: config(false, false) });

    expect(mocks.job.queue).not.toHaveBeenCalled();
  });

  it('does not re-queue when the second toggle is switched on', async () => {
    await sut.onConfigUpdate({ oldConfig: config(true, false), newConfig: config(true, true) });

    expect(mocks.job.queue).not.toHaveBeenCalled();
  });
});
