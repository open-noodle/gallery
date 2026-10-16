import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const AssetInfoQuerySchema = z
  .object({
    spaceId: z.uuidv4().optional().describe('Shared space the asset is viewed in, used to resolve its people'),
  })
  .meta({ id: 'AssetInfoQueryDto' });

export class AssetInfoQueryDto extends createZodDto(AssetInfoQuerySchema) {}
