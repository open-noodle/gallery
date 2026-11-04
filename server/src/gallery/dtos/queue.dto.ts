import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { JobNameSchema } from 'src/enum.js';

// Fork queue fields and DTOs, merged into src/dtos/queue.dto.ts with one spread and one re-export.

const QueueJobTypeCountsSchema = z
  .object({
    name: JobNameSchema,
    active: z.int().describe('Number of sampled active jobs with this name'),
    waiting: z.int().describe('Number of sampled waiting jobs with this name'),
    delayed: z.int().describe('Number of sampled delayed jobs with this name'),
    paused: z.int().describe('Number of sampled paused jobs with this name'),
  })
  .meta({ id: 'QueueJobTypeCountsDto' });

/** QueueResponseSchema */
export const GalleryQueueResponseExtension = {
  jobTypes: z.array(QueueJobTypeCountsSchema).optional().describe('Sampled job type counts for display purposes'),
};

export class QueueJobTypeCountsDto extends createZodDto(QueueJobTypeCountsSchema) {}
