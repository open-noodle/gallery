import { QueueName } from '@immich/sdk';

/**
 * Queues rendered by the admin Jobs page and driven from the command palette's
 * bulk verbs. Omits system queues (BackgroundTask, Search, Notification,
 * BackupDatabase, Workflow, Editor, StorageBackendMigration).
 */
export const ADMIN_VISIBLE_QUEUES = [
  QueueName.ThumbnailGeneration,
  QueueName.MetadataExtraction,
  QueueName.Library,
  QueueName.Sidecar,
  QueueName.SmartSearch,
  QueueName.DuplicateDetection,
  QueueName.FaceDetection,
  QueueName.FacialRecognition,
  QueueName.Ocr,
  QueueName.PetDetection,
  QueueName.Classification,
  QueueName.VideoConversion,
  QueueName.StorageTemplateMigration,
  QueueName.Migration,
] as const satisfies readonly QueueName[];

export type AdminVisibleQueue = (typeof ADMIN_VISIBLE_QUEUES)[number];
