import { Selectable } from 'kysely';
import { createZodDto } from 'nestjs-zod';
import { AssetFileTypeSchema } from 'src/enum';
import { AssetFileTable } from 'src/schema/tables/asset-file.table';
import { isoDatetimeToDate, stringToBool } from 'src/validation';
import z from 'zod';

const AssetFileSearchSchema = z
  .object({
    assetId: z.uuidv4().describe('Asset ID to filter files by'),
    type: AssetFileTypeSchema.optional().describe('Filter by type of file'),
    isEdited: stringToBool.optional().describe('The file was generated from an edit'),
    isProgressive: stringToBool.optional().describe('The file is a progressively encoded JPEG'),
    isTransparent: stringToBool.optional().describe('The file is transparent'),
  })
  .meta({ id: 'AssetFileSearchDto' });

const AssetFileResponseSchema = z
  .object({
    id: z.uuidv4().describe('Asset file ID'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
    updatedAt: isoDatetimeToDate.describe('Update date'),
    type: AssetFileTypeSchema.describe('Type of file'),
    path: z.string().optional().describe('File path. Only returned to the owner of the asset.'),
    isEdited: z.boolean().describe('The file was generated from an edit'),
    isProgressive: z.boolean().describe('The file is a progressively encoded JPEG'),
    isTransparent: z.boolean().describe('The file is transparent'),
  })
  .meta({ id: 'AssetFileResponseDto' });

export class AssetFileSearchDto extends createZodDto(AssetFileSearchSchema) {}
export class AssetFileResponseDto extends createZodDto(AssetFileResponseSchema) {}

export const mapAssetFile = (
  file: Selectable<AssetFileTable>,
  { includePath = true }: { includePath?: boolean } = {},
): AssetFileResponseDto => {
  return {
    id: file.id,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    type: file.type,
    ...(includePath && { path: file.path }),
    isEdited: file.isEdited,
    isProgressive: file.isProgressive,
    isTransparent: file.isTransparent,
  };
};
