import type { JobItem } from 'src/types.js';
import { JobName, QueueName } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StorageService } from 'src/services/storage.service.js';

// Report deletion only touches the database, so it stays safe on S3.
const S3_SAFE_INTEGRITY_JOBS = new Set<JobName>([JobName.IntegrityDeleteReportType, JobName.IntegrityDeleteReports]);

/**
 * Integrity checks read the filesystem directly (stat/walk/read streams) and are not yet S3-aware: on instances with
 * an S3 storage backend they would report every S3-stored file as missing or corrupt, and "resolving" those false
 * reports trashes healthy assets. JobService.onJobRun skips every other IntegrityCheck job whenever an S3 backend is
 * configured, including mixed disk+S3 setups mid-migration. Tracked in open-noodle/gallery#685.
 */
export const isSkippedOnS3 = (queueName: QueueName, { name }: JobItem, logger: LoggingRepository): boolean => {
  if (queueName !== QueueName.IntegrityCheck || S3_SAFE_INTEGRITY_JOBS.has(name) || !StorageService.getS3Backend()) {
    return false;
  }

  logger.warn(
    'Skipping integrity check job: an S3 storage backend is configured and integrity checks are not yet S3-aware (open-noodle/gallery#685).',
  );
  return true;
};
