import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { AssetRenameTargetState } from 'src/enum.js';

const AssetRenameTargetStateSchema = z
  .enum(AssetRenameTargetState)
  .describe(
    'What a rename on disk meets at the new name: nothing, an offline item (removed by the rename), an item the user trashed (removed only when confirmed) or a file or live item (refused)',
  )
  .meta({ id: 'AssetRenameTargetState' });

const fileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .describe('The new name, without its extension. The extension is kept and normalized, e.g. .JPEG becomes .jpg');

const AssetRenameSchema = z
  .object({
    fileName,
    renameOnDisk: z
      .boolean()
      .optional()
      .describe(
        'Also rename the file on disk, with its sidecar. Only for external library assets; otherwise only the name Gallery shows changes',
      ),
    deleteTrashed: z
      .boolean()
      .optional()
      .describe('Confirm deleting an item the user trashed that holds the new name on disk'),
  })
  .meta({ id: 'AssetRenameDto' });

const AssetRenameResponseSchema = z
  .object({
    originalFileName: z.string().describe('The name Gallery shows'),
    originalPath: z.string().describe('The path of the original file'),
  })
  .meta({ id: 'AssetRenameResponseDto' });

const AssetRenameCheckSchema = z.object({ fileName }).meta({ id: 'AssetRenameCheckDto' });

const AssetRenameCheckResponseSchema = z
  .object({ state: AssetRenameTargetStateSchema })
  .meta({ id: 'AssetRenameCheckResponseDto' });

export class AssetRenameDto extends createZodDto(AssetRenameSchema) {}
export class AssetRenameResponseDto extends createZodDto(AssetRenameResponseSchema) {}
export class AssetRenameCheckDto extends createZodDto(AssetRenameCheckSchema) {}
export class AssetRenameCheckResponseDto extends createZodDto(AssetRenameCheckResponseSchema) {}
