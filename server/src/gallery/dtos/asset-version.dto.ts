import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { stringToBool } from 'src/validation.js';

// Asset versions (specs/2026-11-07-asset-versions-design.md). A leaf module: it must not import from src/dtos.

const AssetVersionKindSchema = z
  .enum(['raw', 'original', 'edit'])
  .describe("What the file is: the RAW, the camera's own JPEG or HEIC, or an edit made from them")
  .meta({ id: 'AssetVersionKind' });

const AssetVersionResponseSchema = z
  .object({
    id: z
      .uuidv4()
      .describe('Asset ID of the file: a hidden asset reached through its photo, or the photo itself for its own file'),
    kind: AssetVersionKindSchema,
    source: z.string().nullable().describe('Where it came from, when known: camera, lightroom, darktable, ...'),
    rule: z
      .string()
      .describe('The detection rule that paired it (raw:name, edit:name, edit:time); photo for the photo itself'),
    shown: z.boolean().describe("Whether this file is the one the photo's picture comes from"),
    originalFileName: z.string().describe('File name'),
    originalMimeType: z.string().optional().describe('MIME type'),
    fileSizeInByte: z.int().nullable().describe('File size in bytes'),
    width: z.int().nullable().describe('Width in pixels'),
    height: z.int().nullable().describe('Height in pixels'),
    thumbhash: z.string().nullable().describe('Thumbhash of the version (base64)'),
    fileCreatedAt: z.string().meta({ format: 'date-time' }).describe('Capture time of the version'),
    fileModifiedAt: z
      .string()
      .meta({ format: 'date-time' })
      .describe('When the file was last written: for an edit, when it was made. The newest edit is the one shown'),
    isOffline: z.boolean().describe('Whether its file is offline (an external library file that went missing)'),
  })
  .meta({ id: 'AssetVersionResponseDto' });

const AssetVersionsResponseSchema = z
  .object({
    assetId: z.uuidv4().describe('The photo'),
    versions: z
      .array(AssetVersionResponseSchema)
      .describe(
        "The files of the photo's shot, its own file included: edits newest first, then the original, then the RAW. Empty when the photo has no versions",
      ),
  })
  .meta({ id: 'AssetVersionsResponseDto' });

const AssetVersionParamSchema = z.object({
  id: z.uuidv4().describe('Asset ID of the photo'),
  versionId: z.uuidv4().describe('Asset ID of the version'),
});

const AssetVersionImageSizeSchema = z
  .enum(['thumbnail', 'preview'])
  .describe('Image size')
  .meta({ id: 'AssetVersionImageSize' });

const AssetVersionImageQuerySchema = z.object({
  size: AssetVersionImageSizeSchema.optional(),
});

const AssetVersionDownloadQuerySchema = z.object({
  download: stringToBool.default(false).optional().describe('Return the file as an attachment download'),
});

export class AssetVersionResponseDto extends createZodDto(AssetVersionResponseSchema) {}
export class AssetVersionsResponseDto extends createZodDto(AssetVersionsResponseSchema) {}
export class AssetVersionParamDto extends createZodDto(AssetVersionParamSchema) {}
export class AssetVersionImageQueryDto extends createZodDto(AssetVersionImageQuerySchema) {}
export class AssetVersionDownloadQueryDto extends createZodDto(AssetVersionDownloadQuerySchema) {}

// Spread into ServerFeaturesSchema. Optional: absent on servers that predate versions, which a client reads as off.
export const AssetVersionsServerFeatures = {
  assetVersions: z
    .boolean()
    .optional()
    .describe(
      'Whether the server supports asset versions and has them enabled. While they are off, nothing is detected and the versions already made are not listed. Absent on older servers.',
    ),
};
