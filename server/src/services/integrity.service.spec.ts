import { S3StorageBackend } from 'src/backends/s3-storage.backend';
import { JobStatus } from 'src/enum';
import { IntegrityService } from 'src/services/integrity.service';
import { StorageService } from 'src/services/storage.service';
import { newTestService, ServiceMocks } from 'test/utils';

describe(IntegrityService.name, () => {
  let sut: IntegrityService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(IntegrityService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('S3 backend guard (open-noodle/gallery#685)', () => {
    afterEach(() => {
      vitest.restoreAllMocks();
    });

    it('skips scan jobs when an S3 backend is configured', async () => {
      vitest.spyOn(StorageService, 'getS3Backend').mockReturnValue({} as S3StorageBackend);

      await expect(sut.handleMissingFilesQueueAll()).resolves.toBe(JobStatus.Skipped);
      await expect(sut.handleUntrackedFilesQueueAll()).resolves.toBe(JobStatus.Skipped);
      await expect(sut.handleChecksumFiles()).resolves.toBe(JobStatus.Skipped);
      expect(mocks.storage.walk).not.toHaveBeenCalled();
    });

    it('does not skip when no S3 backend is configured', () => {
      vitest.spyOn(StorageService, 'getS3Backend').mockReturnValue(void 0);

      expect(sut['skipIfS3Configured']()).toBe(false);
    });
  });

  describe('handleDeleteAllIntegrityReports', () => {
    beforeEach(() => {
      mocks.integrityReport.streamIntegrityReportsByProperty.mockReturnValue((function* () {})() as never);
    });

    it('should query all property types when no type specified', async () => {
      await sut.handleDeleteAllIntegrityReports({});

      expect(mocks.integrityReport.streamIntegrityReportsByProperty).toHaveBeenCalledWith(undefined, undefined);
      expect(mocks.integrityReport.streamIntegrityReportsByProperty).toHaveBeenCalledWith('assetId', undefined);
      expect(mocks.integrityReport.streamIntegrityReportsByProperty).toHaveBeenCalledWith('fileAssetId', undefined);
    });
  });
});
