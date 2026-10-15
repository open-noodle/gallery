import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const StorageMigrationDirectionSchema = z.enum(['toS3', 'toDisk']).meta({ id: 'StorageMigrationDirection' });

const StorageMigrationFileTypesSchema = z
  .object({
    originals: z.boolean().default(true).describe('Include original files'),
    thumbnails: z.boolean().default(true).describe('Include thumbnail files'),
    previews: z.boolean().default(true).describe('Include preview files'),
    fullsize: z.boolean().default(true).describe('Include full-size files'),
    encodedVideos: z.boolean().default(true).describe('Include encoded video files'),
    sidecars: z.boolean().default(true).describe('Include sidecar files'),
    personThumbnails: z.boolean().default(true).describe('Include person thumbnail files'),
    profileImages: z.boolean().default(true).describe('Include profile image files'),
  })
  .meta({ id: 'StorageMigrationFileTypesDto' });

const StorageMigrationStartSchema = z
  .object({
    direction: StorageMigrationDirectionSchema.describe('Migration direction'),
    deleteSource: z.boolean().default(false).describe('Delete source files after migration'),
    fileTypes: StorageMigrationFileTypesSchema.describe('File types to migrate'),
    concurrency: z.int().min(1).max(20).default(5).describe('Concurrency level'),
  })
  .meta({ id: 'StorageMigrationStartDto' });

const StorageMigrationEstimateQuerySchema = z
  .object({
    direction: StorageMigrationDirectionSchema.describe('Migration direction'),
  })
  .meta({ id: 'StorageMigrationEstimateQueryDto' });

const StorageMigrationBatchParamSchema = z
  .object({
    batchId: z.uuidv4().describe('Batch ID'),
  })
  .meta({ id: 'StorageMigrationBatchParamDto' });

const StorageRoutingStatusEntrySchema = z
  .object({
    routedTo: z.enum(['disk', 's3']).describe('The resolved backend new files of this kind are written to'),
    misplacedCount: z.int().describe('Number of files of this kind currently stored on the other backend'),
  })
  .meta({ id: 'StorageRoutingStatusEntryDto' });

const StorageRoutingStatusSchema = z
  .object({
    originals: StorageRoutingStatusEntrySchema,
    thumbnails: StorageRoutingStatusEntrySchema,
    encodedVideo: StorageRoutingStatusEntrySchema,
  })
  .meta({ id: 'StorageRoutingStatusDto' });

export class StorageMigrationFileTypesDto extends createZodDto(StorageMigrationFileTypesSchema) {}
export class StorageMigrationStartDto extends createZodDto(StorageMigrationStartSchema) {}
export class StorageMigrationEstimateQueryDto extends createZodDto(StorageMigrationEstimateQuerySchema) {}
export class StorageMigrationBatchParamDto extends createZodDto(StorageMigrationBatchParamSchema) {}
export class StorageRoutingStatusDto extends createZodDto(StorageRoutingStatusSchema) {}
