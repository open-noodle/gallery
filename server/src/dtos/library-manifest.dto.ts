import { createZodDto } from 'nestjs-zod';
import { AssetTypeSchema, ChecksumAlgorithm } from 'src/enum';
import z from 'zod';

const LibraryManifestOwnerSchema = z
  .object({
    id: z.uuidv4().describe('Owner user ID'),
    email: z.string().describe('Owner email'),
  })
  .meta({ id: 'LibraryManifestOwnerDto' });

const LibraryManifestAlbumSchema = z
  .object({
    id: z.uuidv4().describe('Album ID'),
    name: z.string().describe('Album name'),
  })
  .meta({ id: 'LibraryManifestAlbumDto' });

const LibraryManifestAssetSchema = z
  .object({
    assetId: z.uuidv4().describe('Asset ID'),
    objectKey: z.string().describe('Object-storage key (asset.originalPath)'),
    originalFileName: z.string().describe('Original file name'),
    checksum: z.string().describe('Base64 encoded SHA1 hash'),
    checksumAlgorithm: z.enum(ChecksumAlgorithm).describe('Checksum algorithm'),
    size: z.int().min(0).nullable().describe('Original file size in bytes; null if unknown'),
    type: AssetTypeSchema,
    fileCreatedAt: z.string().meta({ format: 'date-time' }).describe('File creation time'),
    fileModifiedAt: z.string().meta({ format: 'date-time' }).describe('File modification time'),
    albumIds: z.array(z.uuidv4()).describe('IDs of the owner-owned albums this asset belongs to'),
  })
  .meta({ id: 'LibraryManifestAssetDto' });

const LibraryManifestResponseSchema = z
  .object({
    manifestSchemaVersion: z.int().describe('Manifest schema version; consumers must guard'),
    generatedAt: z.string().meta({ format: 'date-time' }).describe('When this page was generated'),
    owner: LibraryManifestOwnerSchema,
    albums: z.array(LibraryManifestAlbumSchema).describe('All albums owned by the target user'),
    assets: z.array(LibraryManifestAssetSchema),
    nextCursor: z.uuidv4().nullable().describe('Pass as ?cursor for the next page; null when exhausted'),
  })
  .meta({ id: 'LibraryManifestResponseDto' });

export class LibraryManifestAssetDto extends createZodDto(LibraryManifestAssetSchema) {}
export class LibraryManifestResponseDto extends createZodDto(LibraryManifestResponseSchema) {}

const LibraryManifestQuerySchema = z
  .object({
    cursor: z.uuidv4().optional().describe('Asset id cursor from the previous page (nextCursor)'),
  })
  .meta({ id: 'LibraryManifestQueryDto' });

export class LibraryManifestQueryDto extends createZodDto(LibraryManifestQuerySchema) {}
