import { JobName } from 'src/enum';
import { StorageUsageService } from 'src/gallery/storage-usage.service';
import { mockEnvData } from 'test/repositories/config.repository.mock';
import { newTestService, ServiceMocks } from 'test/utils';

const config = (includeDerivatives: boolean) => ({ storageUsage: { includeDerivatives } }) as never;

describe(StorageUsageService.name, () => {
  let sut: StorageUsageService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(StorageUsageService));
  });

  describe('onConfigInit', () => {
    it('queues a resync on a config file install with the toggle on', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));

      await sut.onConfigInit({ newConfig: config(true) });

      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.UserSyncUsage });
    });

    it('does not queue a resync on a config file install with the toggle off', async () => {
      mocks.config.getEnv.mockReturnValue(mockEnvData({ configFile: 'immich-config.json' }));

      await sut.onConfigInit({ newConfig: config(false) });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does not queue a resync without a config file, where ConfigUpdate already covers it', async () => {
      await sut.onConfigInit({ newConfig: config(true) });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('onConfigUpdate', () => {
    it('queues a resync when the toggle is switched on', async () => {
      await sut.onConfigUpdate({ oldConfig: config(false), newConfig: config(true) });

      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.UserSyncUsage });
    });

    it('queues a resync when the toggle is switched off, so the column returns to originals', async () => {
      await sut.onConfigUpdate({ oldConfig: config(true), newConfig: config(false) });

      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.UserSyncUsage });
    });

    it('does not queue a resync when the toggle stays off', async () => {
      await sut.onConfigUpdate({ oldConfig: config(false), newConfig: config(false) });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does not queue a resync when the toggle stays on', async () => {
      await sut.onConfigUpdate({ oldConfig: config(true), newConfig: config(true) });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });
});
