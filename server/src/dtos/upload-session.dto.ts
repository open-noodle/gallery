import { createZodDto } from 'nestjs-zod';
import { UPLOAD_SESSION_SIDECAR_MAX_BYTES } from 'src/constants';
import { AssetMetadataUpsertItemSchema } from 'src/dtos/asset.dto';
import { AssetVisibilitySchema } from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

/**
 * JSON-native counterpart to AssetMediaCreateSchema. It deliberately does NOT reuse that schema:
 * `stringToBool` accepts only the strings "true"/"false" and `JsonParsed` expects a JSON string,
 * so the multipart schema rejects a JSON body outright. See spec §4.3.
 */
const UploadSessionCreateSchema = z
  .object({
    filename: z.string().min(1).describe('Original filename; the stored extension is derived from it'),
    size: z.int().positive().describe('Total upload size in bytes (Upload-Length)'),
    fileCreatedAt: isoDatetimeToDate.describe('File creation date'),
    fileModifiedAt: isoDatetimeToDate.describe('File modification date'),
    isFavorite: z.boolean().optional().describe('Mark as favorite'),
    visibility: AssetVisibilitySchema.optional(),
    livePhotoVideoId: z.uuidv4().optional().describe('Live photo video ID'),
    duration: z.int().min(0).optional().describe('Duration in milliseconds (for videos)'),
    metadata: z.array(AssetMetadataUpsertItemSchema).optional().describe('Asset metadata items'),
    checksum: z.string().optional().describe('Base64 or hex encoded SHA1, for pre-upload duplicate detection'),
    sidecar: z
      .string()
      .max(UPLOAD_SESSION_SIDECAR_MAX_BYTES)
      .optional()
      .describe('Inline XMP sidecar content (UTF-8 text)'),
  })
  .meta({ id: 'UploadSessionCreateDto' });

const UploadSessionResponseSchema = z
  .object({
    id: z.string().describe('Upload session ID'),
    offset: z.int().describe('Bytes committed so far'),
    expiresAt: z.string().describe('ISO timestamp after which the session may be reclaimed'),
  })
  .meta({ id: 'UploadSessionResponseDto' });

export class UploadSessionCreateDto extends createZodDto(UploadSessionCreateSchema) {}
export class UploadSessionResponseDto extends createZodDto(UploadSessionResponseSchema) {}
