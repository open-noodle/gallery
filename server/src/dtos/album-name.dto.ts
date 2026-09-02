import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const AlbumNameSchema = z
  .object({
    id: z.string(),
    albumName: z.string(),
    albumThumbnailAssetId: z.string().nullable(),
    assetCount: z.int(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    shared: z.boolean(),
  })
  .meta({ id: 'AlbumNameDto' });

export class AlbumNameDto extends createZodDto(AlbumNameSchema) {}
