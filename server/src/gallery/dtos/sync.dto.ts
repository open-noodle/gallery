import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import type { SyncAssetExifV1, SyncAssetV1, SyncAssetV2, SyncItem } from 'src/dtos/sync.dto.js';
import { ExtraModel } from 'src/decorators.js';
import { SyncEntityType, SyncRequestType, SyncRequestTypeSchema } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { isoDatetimeToDate } from 'src/validation.js';

// Fork sync DTOs, merged into upstream's src/dtos/sync.dto.ts by one re-export, one `& GallerySyncItem` and one
// `.extend(...)` of SyncStreamSchema. Leaf module: the import from src/dtos/sync.dto.ts is type-only.

// Upstream album sync payloads the fork entity types reuse; upstream does not export these classes.
type SyncAlbumV2 = SyncItem[SyncEntityType.AlbumV2];
type SyncAlbumDeleteV1 = SyncItem[SyncEntityType.AlbumDeleteV1];
type SyncAlbumToAssetV1 = SyncItem[SyncEntityType.AlbumToAssetV1];
type SyncAlbumToAssetDeleteV1 = SyncItem[SyncEntityType.AlbumToAssetDeleteV1];

// #763: asset_favorite is its own synced entity (design doc §4.3) — caller-scoped (no userId in
// the payload; the stream is already filtered to the syncing user), mirroring SyncAssetEditV1.
const SyncAssetFavoriteV1Schema = z
  .object({ assetId: z.uuidv4().describe('Asset ID') })
  .meta({ id: 'SyncAssetFavoriteV1' });

const SyncAssetFavoriteDeleteV1Schema = z
  .object({ assetId: z.uuidv4().describe('Asset ID') })
  .meta({ id: 'SyncAssetFavoriteDeleteV1' });

@ExtraModel()
export class SyncAssetFavoriteV1 extends createZodDto(SyncAssetFavoriteV1Schema) {}
@ExtraModel()
class SyncAssetFavoriteDeleteV1 extends createZodDto(SyncAssetFavoriteDeleteV1Schema) {}

// --- gallery-fork: shared-space sync DTOs ---

const SyncSharedSpaceDeleteV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
  })
  .meta({ id: 'SyncSharedSpaceDeleteV1' });

const SyncSharedSpaceToAssetV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    assetId: z.string().describe('Asset ID'),
  })
  .meta({ id: 'SyncSharedSpaceToAssetV1' });

const SyncSharedSpaceToAssetDeleteV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    assetId: z.string().describe('Asset ID'),
  })
  .meta({ id: 'SyncSharedSpaceToAssetDeleteV1' });

const SyncSharedSpaceV1Schema = z
  .object({
    id: z.string().describe('Shared space ID'),
    name: z.string().describe('Space name'),
    description: z.string().nullable().describe('Space description'),
    color: z.string().nullable().describe('Color'),
    createdById: z.string().describe('Created by user ID'),
    thumbnailAssetId: z.string().nullable().describe('Thumbnail asset ID'),
    thumbnailCropY: z.int().nullable().describe('Thumbnail crop Y offset'),
    faceRecognitionEnabled: z.boolean().describe('Face recognition enabled'),
    petsEnabled: z.boolean().describe('Pets enabled'),
    lastActivityAt: isoDatetimeToDate.nullable().describe('Last activity timestamp'),
    createdAt: isoDatetimeToDate.describe('Created at'),
    updatedAt: isoDatetimeToDate.describe('Updated at'),
  })
  .meta({ id: 'SyncSharedSpaceV1' });

const SyncSharedSpaceMemberDeleteV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    userId: z.string().describe('User ID'),
  })
  .meta({ id: 'SyncSharedSpaceMemberDeleteV1' });

const SyncSharedSpaceMemberV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    userId: z.string().describe('User ID'),
    role: z.string().describe('Member role'),
    joinedAt: isoDatetimeToDate.describe('When the user joined the space'),
    showInTimeline: z.boolean().describe('Whether the space contributes to the user timeline'),
  })
  .meta({ id: 'SyncSharedSpaceMemberV1' });

const SyncLibraryV1Schema = z
  .object({
    id: z.string().describe('Library ID'),
    name: z.string().describe('Library name'),
    ownerId: z.string().describe('Owner user ID'),
    createdAt: isoDatetimeToDate.describe('Created at'),
    updatedAt: isoDatetimeToDate.describe('Updated at'),
  })
  .meta({ id: 'SyncLibraryV1' });

const SyncLibraryDeleteV1Schema = z
  .object({
    libraryId: z.string().describe('Library ID'),
  })
  .meta({ id: 'SyncLibraryDeleteV1' });

const SyncLibraryAssetDeleteV1Schema = z
  .object({
    assetId: z.string().describe('Asset ID'),
  })
  .meta({ id: 'SyncLibraryAssetDeleteV1' });

const SyncSharedSpaceLibraryV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    libraryId: z.string().describe('Library ID'),
    addedById: z.string().nullable().describe('User who added the library to the space'),
    createdAt: isoDatetimeToDate.describe('Created at'),
    updatedAt: isoDatetimeToDate.describe('Updated at'),
  })
  .meta({ id: 'SyncSharedSpaceLibraryV1' });

const SyncSharedSpaceLibraryDeleteV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    libraryId: z.string().describe('Library ID'),
  })
  .meta({ id: 'SyncSharedSpaceLibraryDeleteV1' });

// --- gallery-fork: shared-space album link DTOs ---

const SyncSharedSpaceAlbumLinkV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    albumId: z.string().describe('Album ID'),
    showInTimeline: z.boolean().describe('Whether this album appears in the space timeline'),
    folderId: z.string().nullable().describe('Album folder ID within the space, or null if at the space root'),
    addedById: z.string().nullable().describe('User who linked the album to the space'),
    createdAt: isoDatetimeToDate.describe('Created at'),
    updatedAt: isoDatetimeToDate.describe('Updated at'),
  })
  .meta({ id: 'SyncSharedSpaceAlbumLinkV1' });

const SyncSharedSpaceAlbumLinkDeleteV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    albumId: z.string().describe('Album ID'),
  })
  .meta({ id: 'SyncSharedSpaceAlbumLinkDeleteV1' });

// #1041: per-member "album hidden from MY timeline" rows. The row's existence IS the flag, so the
// payload is just the composite key. Unlike SyncSharedSpaceAlbumLinkDeleteV1 above, the delete
// schema also carries userId: shared_space_album_hidden's primary key is (spaceId, albumId, userId)
// — userId is part of what identifies the row, not an incidental field.
const SyncSharedSpaceAlbumHiddenV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    albumId: z.string().describe('Album ID'),
    userId: z.string().describe('User ID'),
  })
  .meta({ id: 'SyncSharedSpaceAlbumHiddenV1' });

const SyncSharedSpaceAlbumHiddenDeleteV1Schema = z
  .object({
    spaceId: z.string().describe('Shared space ID'),
    albumId: z.string().describe('Album ID'),
    userId: z.string().describe('User ID'),
  })
  .meta({ id: 'SyncSharedSpaceAlbumHiddenDeleteV1' });
// --- gallery-fork: shared-space album folder DTOs ---

const SyncSharedSpaceAlbumFolderV1Schema = z
  .object({
    id: z.string().describe('Folder ID'),
    spaceId: z.string().describe('Shared space ID'),
    parentId: z.string().nullable().describe('Parent folder ID'),
    name: z.string().describe('Folder name'),
    createdAt: isoDatetimeToDate.describe('Created at'),
    updatedAt: isoDatetimeToDate.describe('Updated at'),
  })
  .meta({ id: 'SyncSharedSpaceAlbumFolderV1' });

const SyncSharedSpaceAlbumFolderDeleteV1Schema = z
  .object({
    folderId: z.string().describe('Folder ID'),
  })
  .meta({ id: 'SyncSharedSpaceAlbumFolderDeleteV1' });

@ExtraModel()
export class SyncSharedSpaceDeleteV1 extends createZodDto(SyncSharedSpaceDeleteV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceToAssetV1 extends createZodDto(SyncSharedSpaceToAssetV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceToAssetDeleteV1 extends createZodDto(SyncSharedSpaceToAssetDeleteV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceV1 extends createZodDto(SyncSharedSpaceV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceMemberDeleteV1 extends createZodDto(SyncSharedSpaceMemberDeleteV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceMemberV1 extends createZodDto(SyncSharedSpaceMemberV1Schema) {}

@ExtraModel()
export class SyncLibraryV1 extends createZodDto(SyncLibraryV1Schema) {}

@ExtraModel()
export class SyncLibraryDeleteV1 extends createZodDto(SyncLibraryDeleteV1Schema) {}

@ExtraModel()
export class SyncLibraryAssetDeleteV1 extends createZodDto(SyncLibraryAssetDeleteV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceLibraryV1 extends createZodDto(SyncSharedSpaceLibraryV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceLibraryDeleteV1 extends createZodDto(SyncSharedSpaceLibraryDeleteV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceAlbumLinkV1 extends createZodDto(SyncSharedSpaceAlbumLinkV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceAlbumLinkDeleteV1 extends createZodDto(SyncSharedSpaceAlbumLinkDeleteV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceAlbumHiddenV1 extends createZodDto(SyncSharedSpaceAlbumHiddenV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceAlbumHiddenDeleteV1 extends createZodDto(SyncSharedSpaceAlbumHiddenDeleteV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceAlbumFolderV1 extends createZodDto(SyncSharedSpaceAlbumFolderV1Schema) {}

@ExtraModel()
export class SyncSharedSpaceAlbumFolderDeleteV1 extends createZodDto(SyncSharedSpaceAlbumFolderDeleteV1Schema) {}
export type GallerySyncItem = {
  [SyncEntityType.AssetFavoriteV1]: SyncAssetFavoriteV1;
  [SyncEntityType.AssetFavoriteDeleteV1]: SyncAssetFavoriteDeleteV1;
  // gallery-fork shared-space sync types
  [SyncEntityType.SharedSpaceV1]: SyncSharedSpaceV1;
  [SyncEntityType.SharedSpaceDeleteV1]: SyncSharedSpaceDeleteV1;
  [SyncEntityType.SharedSpaceMemberV1]: SyncSharedSpaceMemberV1;
  [SyncEntityType.SharedSpaceMemberBackfillV1]: SyncSharedSpaceMemberV1;
  [SyncEntityType.SharedSpaceMemberDeleteV1]: SyncSharedSpaceMemberDeleteV1;
  [SyncEntityType.SharedSpaceAssetCreateV1]: SyncAssetV1;
  [SyncEntityType.SharedSpaceAssetUpdateV1]: SyncAssetV1;
  [SyncEntityType.SharedSpaceAssetBackfillV1]: SyncAssetV1;
  [SyncEntityType.SharedSpaceAssetExifCreateV1]: SyncAssetExifV1;
  [SyncEntityType.SharedSpaceAssetExifUpdateV1]: SyncAssetExifV1;
  [SyncEntityType.SharedSpaceAssetExifBackfillV1]: SyncAssetExifV1;
  [SyncEntityType.SharedSpaceToAssetV1]: SyncSharedSpaceToAssetV1;
  [SyncEntityType.SharedSpaceToAssetBackfillV1]: SyncSharedSpaceToAssetV1;
  [SyncEntityType.SharedSpaceToAssetDeleteV1]: SyncSharedSpaceToAssetDeleteV1;
  // Library sync — wired in Task 27 (DTOs added alongside the dispatch change).
  [SyncEntityType.LibraryV1]: SyncLibraryV1;
  [SyncEntityType.LibraryDeleteV1]: SyncLibraryDeleteV1;
  [SyncEntityType.LibraryAssetCreateV1]: SyncAssetV1;
  [SyncEntityType.LibraryAssetDeleteV1]: SyncLibraryAssetDeleteV1;
  [SyncEntityType.LibraryAssetBackfillV1]: SyncAssetV1;
  [SyncEntityType.LibraryAssetExifCreateV1]: SyncAssetExifV1;
  [SyncEntityType.LibraryAssetExifBackfillV1]: SyncAssetExifV1;
  [SyncEntityType.SharedSpaceLibraryV1]: SyncSharedSpaceLibraryV1;
  [SyncEntityType.SharedSpaceLibraryBackfillV1]: SyncSharedSpaceLibraryV1;
  [SyncEntityType.SharedSpaceLibraryDeleteV1]: SyncSharedSpaceLibraryDeleteV1;
  // gallery-fork: shared-space album sync types (V2 shape: no ownerId, access is
  // via space grant so ownership info is not needed by the mobile client)
  [SyncEntityType.SharedSpaceAlbumV1]: SyncAlbumV2;
  [SyncEntityType.SharedSpaceAlbumBackfillV1]: SyncAlbumV2;
  [SyncEntityType.SharedSpaceAlbumDeleteV1]: SyncAlbumDeleteV1;
  [SyncEntityType.SharedSpaceAlbumLinkV1]: SyncSharedSpaceAlbumLinkV1;
  [SyncEntityType.SharedSpaceAlbumLinkBackfillV1]: SyncSharedSpaceAlbumLinkV1;
  [SyncEntityType.SharedSpaceAlbumLinkDeleteV1]: SyncSharedSpaceAlbumLinkDeleteV1;
  [SyncEntityType.SharedSpaceAlbumHiddenV1]: SyncSharedSpaceAlbumHiddenV1;
  [SyncEntityType.SharedSpaceAlbumHiddenBackfillV1]: SyncSharedSpaceAlbumHiddenV1;
  [SyncEntityType.SharedSpaceAlbumHiddenDeleteV1]: SyncSharedSpaceAlbumHiddenDeleteV1;
  [SyncEntityType.SharedSpaceAlbumFolderV1]: SyncSharedSpaceAlbumFolderV1;
  [SyncEntityType.SharedSpaceAlbumFolderBackfillV1]: SyncSharedSpaceAlbumFolderV1;
  [SyncEntityType.SharedSpaceAlbumFolderDeleteV1]: SyncSharedSpaceAlbumFolderDeleteV1;
  [SyncEntityType.SharedSpaceAlbumToAssetV1]: SyncAlbumToAssetV1;
  [SyncEntityType.SharedSpaceAlbumToAssetBackfillV1]: SyncAlbumToAssetV1;
  [SyncEntityType.SharedSpaceAlbumToAssetDeleteV1]: SyncAlbumToAssetDeleteV1;
  [SyncEntityType.SharedSpaceAlbumAssetCreateV1]: SyncAssetV2;
  [SyncEntityType.SharedSpaceAlbumAssetUpdateV1]: SyncAssetV2;
  [SyncEntityType.SharedSpaceAlbumAssetBackfillV1]: SyncAssetV2;
  [SyncEntityType.SharedSpaceAlbumAssetExifCreateV1]: SyncAssetExifV1;
  [SyncEntityType.SharedSpaceAlbumAssetExifUpdateV1]: SyncAssetExifV1;
  [SyncEntityType.SharedSpaceAlbumAssetExifBackfillV1]: SyncAssetExifV1;
};

// Unknown request types are dropped, not rejected: a client newer than this server (a stock Immich app
// clears upstream's version gates against Gallery's 5.x version) would otherwise lose its whole stream.
const knownSyncRequestTypes = new Set<unknown>(Object.values(SyncRequestType));
const syncStreamLogger = LoggingRepository.create('SyncStreamDto');
const dropUnknownSyncRequestTypes = (types: unknown) => {
  if (!Array.isArray(types)) {
    return types;
  }
  const unknown = types.filter((type) => typeof type === 'string' && !knownSyncRequestTypes.has(type));
  if (unknown.length > 0) {
    syncStreamLogger.debug(`Ignoring unknown sync request types: ${unknown.join(', ')}`);
  }
  return types.filter((type) => !unknown.includes(type));
};

/** SyncStreamSchema: overrides upstream's `types`. */
export const GallerySyncStreamExtension = {
  // nonoptional: z.preprocess alone would drop `types` from the OpenAPI `required` list
  types: z
    .preprocess(dropUnknownSyncRequestTypes, z.array(SyncRequestTypeSchema))
    .nonoptional()
    .describe('Sync request types'),
};
