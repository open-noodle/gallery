import { createZodDto } from 'nestjs-zod';
import z from 'zod';

// Bounded like the favorites write: a thumbnail grid asks in batches far below it.
const AssetSpacesSchema = z
  .object({
    assetIds: z.array(z.uuidv4()).min(1).max(1000).describe('Asset IDs'),
  })
  .meta({ id: 'AssetSpacesDto' });

const AssetSpacesItemSchema = z
  .object({
    assetId: z.string().describe('Asset ID'),
    spaceIds: z.array(z.string()).describe("IDs of the caller's spaces that show the asset"),
  })
  .meta({ id: 'AssetSpacesItemDto' });

const AssetSpacesResponseSchema = z
  .object({
    assets: z
      .array(AssetSpacesItemSchema)
      .describe("The requested assets that at least one of the caller's spaces shows"),
  })
  .meta({ id: 'AssetSpacesResponseDto' });

export class AssetSpacesDto extends createZodDto(AssetSpacesSchema) {}
export class AssetSpacesResponseDto extends createZodDto(AssetSpacesResponseSchema) {}
