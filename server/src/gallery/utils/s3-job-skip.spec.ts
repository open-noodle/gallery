import type { JobItem } from 'src/types.js';
import { S3StorageBackend } from 'src/backends/s3-storage.backend.js';
import { JobName, JobStatus, QueueName } from 'src/enum.js';
import { JobService } from 'src/services/job.service.js';
import { StorageService } from 'src/services/storage.service.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe('integrity jobs on S3 (open-noodle/gallery#685)', () => {
  let sut: JobService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(JobService));
    mocks.job.run.mockResolvedValue(JobStatus.Success);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const scanJobs: JobItem[] = [
    { name: JobName.IntegrityUntrackedFilesQueueAll, data: {} },
    { name: JobName.IntegrityUntrackedFiles, data: { type: 'asset_file', paths: [] } as never },
    { name: JobName.IntegrityUntrackedFilesRefresh, data: { items: [] } },
    { name: JobName.IntegrityMissingFilesQueueAll, data: {} },
    { name: JobName.IntegrityMissingFiles, data: { items: [] } },
    { name: JobName.IntegrityMissingFilesRefresh, data: { items: [] } },
    { name: JobName.IntegrityChecksumFiles, data: {} },
    { name: JobName.IntegrityChecksumFilesRefresh, data: { items: [] } },
  ];

  it.each(scanJobs)('skips $name without running its handler when an S3 backend is configured', async (job) => {
    vi.spyOn(StorageService, 'getS3Backend').mockReturnValue({} as S3StorageBackend);

    await sut.onJobRun(QueueName.IntegrityCheck, job);

    expect(mocks.job.run).not.toHaveBeenCalled();
    expect(mocks.event.emit).toHaveBeenCalledWith('JobSuccess', { job, response: JobStatus.Skipped });
  });

  it.each(scanJobs)('runs $name when no S3 backend is configured', async (job) => {
    vi.spyOn(StorageService, 'getS3Backend').mockReturnValue(void 0);

    await sut.onJobRun(QueueName.IntegrityCheck, job);

    expect(mocks.job.run).toHaveBeenCalledWith(job);
  });

  it.each<JobItem>([
    { name: JobName.IntegrityDeleteReportType, data: { type: 'missing_file' } as never },
    { name: JobName.IntegrityDeleteReports, data: { reportIds: [] } as never },
  ])('runs the database-only $name on S3', async (job) => {
    vi.spyOn(StorageService, 'getS3Backend').mockReturnValue({} as S3StorageBackend);

    await sut.onJobRun(QueueName.IntegrityCheck, job);

    expect(mocks.job.run).toHaveBeenCalledWith(job);
  });

  it('runs jobs on other queues on S3', async () => {
    vi.spyOn(StorageService, 'getS3Backend').mockReturnValue({} as S3StorageBackend);
    const job: JobItem = { name: JobName.AssetGenerateThumbnails, data: { id: 'asset-id' } };

    await sut.onJobRun(QueueName.ThumbnailGeneration, job);

    expect(mocks.job.run).toHaveBeenCalledWith(job);
  });
});
