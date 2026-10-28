import { Writable } from 'node:stream';
import { SyncStreamDto } from 'src/dtos/sync.dto.js';
import { MemoryType, SyncEntityType, SyncRequestType } from 'src/enum.js';
import { GallerySyncRepository } from 'src/gallery/repositories/gallery-sync.repository.js';
import { SyncQueryOptions } from 'src/repositories/sync.repository.js';
import {
  CheckpointMap,
  getStartId,
  isEntityBackfillComplete,
  mapSyncAssetV1,
  mapSyncAssetV2,
  send,
  sendEntityBackfillCompleteAck,
} from 'src/utils/sync.js';

// Gallery's sync request types, in stream order. SyncService streams them after upstream's types and
// before the memory types (see `order`).
const GALLERY_SYNC_ORDER = [
  // Shared spaces — wired in Task 10. Order: parent metadata before assets, exifs after assets.
  SyncRequestType.SharedSpacesV1,
  SyncRequestType.SharedSpaceMembersV1,
  SyncRequestType.SharedSpaceAssetsV1,
  SyncRequestType.SharedSpaceToAssetsV1,
  SyncRequestType.SharedSpaceAssetExifsV1,
  // Libraries — wired in Task 27. Order: library metadata first, then the
  // shared_space_library link rows (small, tens of rows at most), THEN the
  // bulky library asset rows. The link rows must precede the asset rows so
  // that mobile's space-detail Drift query — which joins shared_space_library
  // with remote_asset on library_id — can emit incremental buckets as the
  // 5000-row library asset batches arrive. Putting the link rows last makes
  // the JOIN return zero buckets until the very end of the sync pass, so on
  // a 40k-asset library the space view looks empty for ~60 s. See mobile
  // space-slowness investigation.
  SyncRequestType.LibrariesV1,
  SyncRequestType.SharedSpaceLibrariesV1,
  SyncRequestType.LibraryAssetsV1,
  SyncRequestType.LibraryAssetExifsV1,
  // Shared-space album sync (Phase 2A). Order: album metadata + folders first (folders have no
  // dependency on the link rows, and landing them first means the album-link rows arrive already
  // knowing their folder, instead of rendering flat at the root for one frame and then re-nesting
  // once the folder catches up), then link rows (so mobile can build the album list before asset
  // rows start streaming), then membership rows (album_asset join), then asset blobs and exif.
  SyncRequestType.SharedSpaceAlbumsV1,
  SyncRequestType.SharedSpaceAlbumFoldersV1,
  SyncRequestType.SharedSpaceAlbumLinksV1,
  // #1041: hidden rows key off (spaceId, albumId) like the link row above, so it belongs
  // immediately after the link stream — before any asset-bearing stream, same reasoning.
  SyncRequestType.SharedSpaceAlbumHiddensV1,
  SyncRequestType.SharedSpaceAlbumToAssetsV1,
  SyncRequestType.SharedSpaceAlbumAssetsV1,
  SyncRequestType.SharedSpaceAlbumAssetExifsV1,
  // #763: favorites reference assets a viewer does not own, so this overlay stream sits after
  // EVERY asset-delivering stream (own, partner, album, library, shared-space, space-album) —
  // same delivering-stream-first pattern as PartnerAssetExifsV1. It stays BEFORE the memory types
  // so the "memories stream LAST" invariant (guarded by sync.service.spec.ts) still holds.
  SyncRequestType.AssetFavoritesV1,
] as const;

export type GallerySyncRequestType = (typeof GALLERY_SYNC_ORDER)[number];

// Memories stream LAST, after every type that can deliver an asset row.
//
// Mobile's `memory_asset_entity` has real foreign keys (`assetId` → `remote_asset_entity.id`,
// `memoryId` → `memory_entity.id`) and inserts a MemoryToAssetV1 batch as one Drift statement.
// A link row whose asset has not arrived yet fails the batch with
// SQLITE_CONSTRAINT_FOREIGNKEY (787), which aborts the whole /sync/stream request; since the
// batch is never acked, the next sync replays the same checkpoint and fails identically —
// a permanently wedged client, not a transient error.
//
// Upstream is safe by construction: a memory can only reference its owner's own assets, and
// AssetsV*/PartnerAssetsV*/AlbumAssetsV* all precede MemoryToAssetsV1 (the same ordering that
// protects AlbumToAssetsV1). The fork breaks both halves of that assumption — shared spaces,
// libraries and space albums deliver assets owned by *other* users, and memory assets are
// gated on visibility rather than ownership (MemoryRepository.search), so a memory may
// legitimately point at one of them. Keeping the memory types after the fork's asset-bearing
// streams restores the invariant. `sync.service.spec.ts` guards it.
const MEMORY_SYNC_TYPES = new Set<SyncRequestType>([
  SyncRequestType.MemoriesV1,
  SyncRequestType.MemoriesV2,
  SyncRequestType.MemoryToAssetsV1,
  SyncRequestType.MemoryToAssetsV2,
]);

/** Upstream's stream order with the memory types moved last and Gallery's types in front of them. */
const order = (upstreamOrder: SyncRequestType[]): SyncRequestType[] => [
  ...upstreamOrder.filter((type) => !MEMORY_SYNC_TYPES.has(type)),
  ...GALLERY_SYNC_ORDER,
  ...upstreamOrder.filter((type) => MEMORY_SYNC_TYPES.has(type)),
];

// Request types upstream Immich does not have. A stock Immich client cannot request any of them,
// and a Gallery app always requests SharedSpacesV1.
const forkSyncRequestTypes = new Set<SyncRequestType>(GALLERY_SYNC_ORDER);

/**
 * A stock Immich client aborts its whole sync on a value its generated client cannot decode,
 * so fork-only rows (rule memories) and pets reach fork-aware clients only.
 */
const isForkAwareClient = (dto: SyncStreamDto) => dto.types.some((type) => forkSyncRequestTypes.has(type));

/**
 * Gallery's memory type policy, shared by every memory stream version, the memory photo links and
 * `GET /memories`:
 * - `birthday` rows (immich-30831) go where upstream sends them: MemoriesV2 / MemoryToAssetsV2 and the
 *   list, never V1 (upstream narrowed V1 to `on_this_day` for clients that cannot decode the type).
 *   `withBirthday` is false on V1 and, for the list, for a Gallery app before 5.8.0 (`legacyGalleryApp`).
 * - `rule` rows reach fork-aware clients only (#1013): a stock Immich app cannot decode the type
 *   and would abort its whole sync. That holds on MemoriesV2 too: a stock app at 3.3+ requests it
 *   from a Gallery server, whose 5.x version clears upstream's 3.3.0 gate.
 */
const syncedMemoryTypes = (isForkAwareClient?: boolean, withBirthday?: boolean): MemoryType[] => [
  MemoryType.OnThisDay,
  ...(isForkAwareClient ? [MemoryType.Rule] : []),
  ...(withBirthday ? [MemoryType.Birthday] : []),
];

type BackfillCheckpoint = { type: SyncEntityType; sessionId: string; createId: string };

export type GallerySyncContext = {
  repository: GallerySyncRepository;
  upsertBackfillCheckpoint: (item: BackfillCheckpoint) => Promise<void>;
  options: SyncQueryOptions;
  response: Writable;
  checkpointMap: CheckpointMap;
  sessionId: string;
};

// The handler bodies moved verbatim from SyncService; `syncRepository` here is the GallerySyncRepository.
class GallerySyncHandlers {
  constructor(
    private syncRepository: GallerySyncRepository,
    private upsertBackfillCheckpoint: (item: BackfillCheckpoint) => Promise<void>,
  ) {}

  // #763: asset_favorite is its own synced entity (design doc §4.3) — mirrors syncAssetEditsV1
  // (deletes before upserts) so a favorite/unfavorite converges the same way an edit does.
  async syncAssetFavoritesV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.AssetFavoriteDeleteV1;
    const deletes = this.syncRepository.assetFavorite.getDeletes({ ...options, ack: checkpointMap[deleteType] });

    for await (const { id, ...data } of deletes) {
      await send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.AssetFavoriteV1;
    const upserts = this.syncRepository.assetFavorite.getUpserts({ ...options, ack: checkpointMap[upsertType] });

    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  async syncSharedSpacesV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.SharedSpaceDeleteV1;
    const deletes = this.syncRepository.sharedSpace.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      await send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.SharedSpaceV1;
    const upserts = this.syncRepository.sharedSpace.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  async syncSharedSpaceMembersV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.SharedSpaceMemberDeleteV1;
    const deletes = this.syncRepository.sharedSpaceMember.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      await send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.SharedSpaceMemberBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.SharedSpaceMemberV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceMember.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.sharedSpaceMember.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  async syncSharedSpaceAssetsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const backfillType = SyncEntityType.SharedSpaceAssetBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const updateType = SyncEntityType.SharedSpaceAssetUpdateV1;
    const createType = SyncEntityType.SharedSpaceAssetCreateV1;
    const updateCheckpoint = checkpointMap[updateType];
    const createCheckpoint = checkpointMap[createType];
    if (createCheckpoint) {
      const endId = createCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceAsset.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
          options.userId,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data: mapSyncAssetV1(data) });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    if (createCheckpoint) {
      const updates = this.syncRepository.sharedSpaceAsset.getUpdates(
        { ...options, ack: updateCheckpoint },
        createCheckpoint,
      );
      for await (const { updateId, ...data } of updates) {
        await send(response, { type: updateType, ids: [updateId], data: mapSyncAssetV1(data) });
      }
    }

    const creates = this.syncRepository.sharedSpaceAsset.getCreates({ ...options, ack: createCheckpoint });
    let first = true;
    for await (const { updateId, ...data } of creates) {
      if (first) {
        await send(response, {
          type: SyncEntityType.SyncAckV1,
          data: {},
          ackType: SyncEntityType.SharedSpaceAssetUpdateV1,
          ids: [options.nowId],
        });
        first = false;
      }
      await send(response, { type: createType, ids: [updateId], data: mapSyncAssetV1(data) });
    }
  }

  async syncSharedSpaceAssetExifsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const backfillType = SyncEntityType.SharedSpaceAssetExifBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const updateType = SyncEntityType.SharedSpaceAssetExifUpdateV1;
    const createType = SyncEntityType.SharedSpaceAssetExifCreateV1;
    const upsertCheckpoint = checkpointMap[updateType];
    const createCheckpoint = checkpointMap[createType];
    if (createCheckpoint) {
      const endId = createCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceAssetExif.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    if (createCheckpoint) {
      const updates = this.syncRepository.sharedSpaceAssetExif.getUpdates(
        { ...options, ack: upsertCheckpoint },
        createCheckpoint,
      );
      for await (const { updateId, ...data } of updates) {
        await send(response, { type: updateType, ids: [updateId], data });
      }
    }

    const creates = this.syncRepository.sharedSpaceAssetExif.getCreates({ ...options, ack: createCheckpoint });
    let first = true;
    for await (const { updateId, ...data } of creates) {
      if (first) {
        await send(response, {
          type: SyncEntityType.SyncAckV1,
          data: {},
          ackType: SyncEntityType.SharedSpaceAssetExifUpdateV1,
          ids: [options.nowId],
        });
        first = false;
      }
      await send(response, { type: createType, ids: [updateId], data });
    }
  }

  async syncSharedSpaceToAssetsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.SharedSpaceToAssetDeleteV1;
    const deletes = this.syncRepository.sharedSpaceToAsset.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      await send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.SharedSpaceToAssetBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.SharedSpaceToAssetV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceToAsset.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.sharedSpaceToAsset.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  // Library sync — streams Library rows the user can access. Mirrors the
  // shape of syncSharedSpacesV1: deletes first (from library_audit where
  // userId = me), then full upserts via LibrarySync.getUpserts.
  async syncLibrariesV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.LibraryDeleteV1;
    const deletes = this.syncRepository.library.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, libraryId } of deletes) {
      await send(response, { type: deleteType, ids: [id], data: { libraryId } });
    }

    const upsertType = SyncEntityType.LibraryV1;
    const upserts = this.syncRepository.library.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  // Library assets — deletes first, then per-library backfill loop keyed by
  // library_user.createId, then a single upserts stream scoped by accessibleLibraries.
  // Mirrors syncPartnerAssetsV1 (NOT syncSharedSpaceAssetsV1): libraries have no
  // per-pairing join-row updateId to gate a separate Updates stream, so all
  // live changes flow through a single getUpserts via `LibraryAssetCreateV1`.
  // Dedup is enforced at the query level — LibraryAssetSync uses
  // `asset.libraryId IN accessibleLibraries` directly, so a library linked to
  // multiple spaces still produces each asset once.
  async syncLibraryAssetsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.LibraryAssetDeleteV1;
    const deletes = this.syncRepository.libraryAsset.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, assetId } of deletes) {
      await send(response, { type: deleteType, ids: [id], data: { assetId } });
    }

    const backfillType = SyncEntityType.LibraryAssetBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const libraries = await this.syncRepository.library.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.LibraryAssetCreateV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const library of libraries) {
        const createId = library.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.libraryAsset.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          library.id,
          options.userId,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data: mapSyncAssetV1(data) });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (libraries.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: libraries.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.libraryAsset.getUpserts({ ...options, ack: upsertCheckpoint });
    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data: mapSyncAssetV1(data) });
    }
  }

  // Library asset exifs — mirrors syncLibraryAssetsV1 shape: backfill per
  // library, then a single getUpserts stream.
  async syncLibraryAssetExifsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const backfillType = SyncEntityType.LibraryAssetExifBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const libraries = await this.syncRepository.library.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.LibraryAssetExifCreateV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const library of libraries) {
        const createId = library.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.libraryAssetExif.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          library.id,
          options.userId,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (libraries.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: libraries.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.libraryAssetExif.getUpserts({ ...options, ack: upsertCheckpoint });
    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  // shared_space_library join rows — mirrors syncSharedSpaceMembersV1. Deletes
  // first (from shared_space_library_audit scoped to accessibleSpaces), then
  // per-space backfill, then upserts for any new link rows.
  async syncSharedSpaceLibrariesV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.SharedSpaceLibraryDeleteV1;
    const deletes = this.syncRepository.sharedSpaceLibrary.getDeletes({
      ...options,
      ack: checkpointMap[deleteType],
    });
    for await (const { id, ...data } of deletes) {
      await send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.SharedSpaceLibraryBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.SharedSpaceLibraryV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceLibrary.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.sharedSpaceLibrary.getUpserts({
      ...options,
      ack: checkpointMap[upsertType],
    });
    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  // ── Shared-space album sync handlers (Phase 2A) ────────────────────────────
  //
  // Five handlers, each cloned from the corresponding personal-album handler
  // with the repo accessor swapped to syncRepository.sharedSpaceAlbum* and
  // the entity types swapped to SharedSpaceAlbum*.
  //
  // Metadata (SharedSpaceAlbumsV1) — clone of syncAlbumsV1.
  //   Grant watermark: sharedSpaceAlbum.getCreatedAfter (shared_space_album_user).
  //   Deletes:  shared_space_album_user_audit  (grant revocation)
  //   Upserts:  album rows for accessibleSpaceAlbums
  //
  // Link (SharedSpaceAlbumLinksV1) — clone of syncSharedSpaceLibrariesV1.
  //   Space watermark: sharedSpace.getCreatedAfter (space membership).
  //   Backfill: per-space backfill of shared_space_album join rows.
  //
  // Membership (SharedSpaceAlbumToAssetsV1) — clone of syncAlbumToAssetsV1.
  //   Grant watermark: sharedSpaceAlbum.getCreatedAfter (grant createId).
  //   Backfill: per-album backfill of album_asset join rows.
  //
  // Assets (SharedSpaceAlbumAssetsV1) — clone of syncAlbumAssetsV2.
  //   Grant watermark: sharedSpaceAlbum.getCreatedAfter.
  //   albumToAssetAck: checkpointMap[SharedSpaceAlbumToAssetV1] (same coupling).
  //
  // Exif (SharedSpaceAlbumAssetExifsV1) — clone of syncAlbumAssetExifsV1.
  //   Grant watermark + ack: same as assets.

  async syncSharedSpaceAlbumsV1(options: SyncQueryOptions, response: Writable, checkpointMap: CheckpointMap) {
    const deleteType = SyncEntityType.SharedSpaceAlbumDeleteV1;
    const deletes = this.syncRepository.sharedSpaceAlbum.getDeletes({ ...options, ack: checkpointMap[deleteType] });
    for await (const { id, ...data } of deletes) {
      await send(response, { type: deleteType, ids: [id], data });
    }

    const upsertType = SyncEntityType.SharedSpaceAlbumV1;
    const upserts = this.syncRepository.sharedSpaceAlbum.getUpserts({ ...options, ack: checkpointMap[upsertType] });
    for await (const { updateId, ...data } of upserts) {
      // Same coercion upstream applies to its own album streams (#30123): album.description
      // is nullable in the database now, but the sync wire contract is still non-nullable and
      // mobile decodes it as such, so a null would break the client.
      // TODO: return null instead of '' in v4
      await send(response, {
        type: upsertType,
        ids: [updateId],
        data: { ...data, description: data.description ?? '' },
      });
    }
  }

  // shared_space_album join rows — mirrors syncSharedSpaceLibrariesV1. Deletes
  // first (from shared_space_album_audit scoped to accessibleSpaces), then
  // per-space backfill, then upserts for any new link rows.
  async syncSharedSpaceAlbumLinksV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.SharedSpaceAlbumLinkDeleteV1;
    const deletes = this.syncRepository.sharedSpaceAlbumLink.getDeletes({
      ...options,
      ack: checkpointMap[deleteType],
    });
    for await (const { id, ...data } of deletes) {
      await send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.SharedSpaceAlbumLinkBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.SharedSpaceAlbumLinkV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceAlbumLink.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.sharedSpaceAlbumLink.getUpserts({
      ...options,
      ack: checkpointMap[upsertType],
    });
    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  // #1041: per-member "album hidden from MY timeline" rows — mirrors syncSharedSpaceAlbumLinksV1
  // exactly, substituting syncRepository.sharedSpaceAlbumHidden and the Hidden entity types. Backfill
  // is driven by the same sharedSpace.getCreatedAfter watermark as the link stream: a member starts
  // receiving their own hidden rows for a space when that space first syncs.
  async syncSharedSpaceAlbumHiddensV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.SharedSpaceAlbumHiddenDeleteV1;
    const deletes = this.syncRepository.sharedSpaceAlbumHidden.getDeletes({
      ...options,
      ack: checkpointMap[deleteType],
    });
    for await (const { id, ...data } of deletes) {
      await send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.SharedSpaceAlbumHiddenBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.SharedSpaceAlbumHiddenV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceAlbumHidden.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
          options.userId,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.sharedSpaceAlbumHidden.getUpserts({
      ...options,
      ack: checkpointMap[upsertType],
    });
    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  // shared_space_album_folder rows — clone of syncSharedSpaceAlbumLinksV1. Deletes first (from
  // shared_space_album_folder_audit, scoped to accessibleSpaces), then per-space backfill, then
  // upserts for any new/renamed/reparented folders.
  //
  // getDeletes also selects spaceId (needed to gate the audit query), but the wire DTO
  // (SyncSharedSpaceAlbumFolderDeleteV1) carries only folderId — a folder id is globally unique,
  // so the client does not need the space to resolve which local row to drop.
  async syncSharedSpaceAlbumFoldersV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.SharedSpaceAlbumFolderDeleteV1;
    const deletes = this.syncRepository.sharedSpaceAlbumFolder.getDeletes({
      ...options,
      ack: checkpointMap[deleteType],
    });
    for await (const { id, folderId } of deletes) {
      await send(response, { type: deleteType, ids: [id], data: { folderId } });
    }

    const backfillType = SyncEntityType.SharedSpaceAlbumFolderBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const spaces = await this.syncRepository.sharedSpace.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.SharedSpaceAlbumFolderV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const space of spaces) {
        const createId = space.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceAlbumFolder.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          space.id,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (spaces.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: spaces.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.sharedSpaceAlbumFolder.getUpserts({
      ...options,
      ack: checkpointMap[upsertType],
    });
    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  // album_asset join rows (membership) — mirrors syncAlbumToAssetsV1. Per-album
  // backfill loop keyed by the shared_space_album_user grant createId.
  async syncSharedSpaceAlbumToAssetsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const deleteType = SyncEntityType.SharedSpaceAlbumToAssetDeleteV1;
    const deletes = this.syncRepository.sharedSpaceAlbumToAsset.getDeletes({
      ...options,
      ack: checkpointMap[deleteType],
    });
    for await (const { id, ...data } of deletes) {
      await send(response, { type: deleteType, ids: [id], data });
    }

    const backfillType = SyncEntityType.SharedSpaceAlbumToAssetBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const albums = await this.syncRepository.sharedSpaceAlbum.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const upsertType = SyncEntityType.SharedSpaceAlbumToAssetV1;
    const upsertCheckpoint = checkpointMap[upsertType];
    if (upsertCheckpoint) {
      const endId = upsertCheckpoint.updateId;

      for (const album of albums) {
        const createId = album.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceAlbumToAsset.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          album.id,
          options.userId,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (albums.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: albums.at(-1)!.createId,
      });
    }

    const upserts = this.syncRepository.sharedSpaceAlbumToAsset.getUpserts({
      ...options,
      ack: checkpointMap[upsertType],
    });
    for await (const { updateId, ...data } of upserts) {
      await send(response, { type: upsertType, ids: [updateId], data });
    }
  }

  // Full asset rows for album-accessible assets — mirrors syncAlbumAssetsV2.
  // Per-album backfill keyed by shared_space_album_user grant createId.
  // The getUpdates ack threads SharedSpaceAlbumToAssetV1 (same coupling).
  async syncSharedSpaceAlbumAssetsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const backfillType = SyncEntityType.SharedSpaceAlbumAssetBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const albums = await this.syncRepository.sharedSpaceAlbum.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const updateType = SyncEntityType.SharedSpaceAlbumAssetUpdateV1;
    const createType = SyncEntityType.SharedSpaceAlbumAssetCreateV1;
    const updateCheckpoint = checkpointMap[updateType];
    const createCheckpoint = checkpointMap[createType];
    if (createCheckpoint) {
      const endId = createCheckpoint.updateId;

      for (const album of albums) {
        const createId = album.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceAlbumAsset.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          album.id,
          options.userId,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data: mapSyncAssetV2(data) });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (albums.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: albums.at(-1)!.createId,
      });
    }

    const albumToAssetAck = checkpointMap[SyncEntityType.SharedSpaceAlbumToAssetV1];
    if (createCheckpoint && albumToAssetAck) {
      const updates = this.syncRepository.sharedSpaceAlbumAsset.getUpdates(
        { ...options, ack: updateCheckpoint },
        albumToAssetAck,
      );
      for await (const { updateId, ...data } of updates) {
        await send(response, { type: updateType, ids: [updateId], data: mapSyncAssetV2(data) });
      }
    }

    const creates = this.syncRepository.sharedSpaceAlbumAsset.getCreates({ ...options, ack: createCheckpoint });
    let first = true;
    for await (const { updateId, ...data } of creates) {
      if (first) {
        await send(response, {
          type: SyncEntityType.SyncAckV1,
          data: {},
          ackType: SyncEntityType.SharedSpaceAlbumAssetUpdateV1,
          ids: [options.nowId],
        });
        first = false;
      }
      await send(response, { type: createType, ids: [updateId], data: mapSyncAssetV2(data) });
    }
  }

  // Exif for album-accessible assets — mirrors syncAlbumAssetExifsV1.
  // Per-album backfill keyed by shared_space_album_user grant createId.
  // The getUpdates ack threads SharedSpaceAlbumToAssetV1 (same coupling).
  async syncSharedSpaceAlbumAssetExifsV1(
    options: SyncQueryOptions,
    response: Writable,
    checkpointMap: CheckpointMap,
    sessionId: string,
  ) {
    const backfillType = SyncEntityType.SharedSpaceAlbumAssetExifBackfillV1;
    const backfillCheckpoint = checkpointMap[backfillType];
    const albums = await this.syncRepository.sharedSpaceAlbum.getCreatedAfter({
      ...options,
      afterCreateId: backfillCheckpoint?.updateId,
    });
    const updateType = SyncEntityType.SharedSpaceAlbumAssetExifUpdateV1;
    const createType = SyncEntityType.SharedSpaceAlbumAssetExifCreateV1;
    const upsertCheckpoint = checkpointMap[updateType];
    const createCheckpoint = checkpointMap[createType];
    if (createCheckpoint) {
      const endId = createCheckpoint.updateId;

      for (const album of albums) {
        const createId = album.createId;
        if (isEntityBackfillComplete(createId, backfillCheckpoint)) {
          continue;
        }

        const startId = getStartId(createId, backfillCheckpoint);
        const backfill = this.syncRepository.sharedSpaceAlbumAssetExif.getBackfill(
          { ...options, afterUpdateId: startId, beforeUpdateId: endId },
          album.id,
          options.userId,
        );

        for await (const { updateId, ...data } of backfill) {
          await send(response, { type: backfillType, ids: [createId, updateId], data });
        }

        await sendEntityBackfillCompleteAck(response, backfillType, createId);
      }
    } else if (albums.length > 0) {
      await this.upsertBackfillCheckpoint({
        type: backfillType,
        sessionId,
        createId: albums.at(-1)!.createId,
      });
    }

    const albumToAssetAck = checkpointMap[SyncEntityType.SharedSpaceAlbumToAssetV1];
    if (createCheckpoint && albumToAssetAck) {
      const updates = this.syncRepository.sharedSpaceAlbumAssetExif.getUpdates(
        { ...options, ack: upsertCheckpoint },
        albumToAssetAck,
      );
      for await (const { updateId, ...data } of updates) {
        await send(response, { type: updateType, ids: [updateId], data });
      }
    }

    const creates = this.syncRepository.sharedSpaceAlbumAssetExif.getCreates({ ...options, ack: createCheckpoint });
    let first = true;
    for await (const { updateId, ...data } of creates) {
      if (first) {
        await send(response, {
          type: SyncEntityType.SyncAckV1,
          data: {},
          ackType: SyncEntityType.SharedSpaceAlbumAssetExifUpdateV1,
          ids: [options.nowId],
        });
        first = false;
      }
      await send(response, { type: createType, ids: [updateId], data });
    }
  }
}

const handlers = ({
  repository,
  upsertBackfillCheckpoint,
  options,
  response,
  checkpointMap,
  sessionId,
}: GallerySyncContext): Record<GallerySyncRequestType, () => Promise<void>> => {
  const h = new GallerySyncHandlers(repository, upsertBackfillCheckpoint);
  return {
    [SyncRequestType.AssetFavoritesV1]: () => h.syncAssetFavoritesV1(options, response, checkpointMap),
    // Shared-space sync handlers.
    [SyncRequestType.SharedSpacesV1]: () => h.syncSharedSpacesV1(options, response, checkpointMap),
    [SyncRequestType.SharedSpaceMembersV1]: () =>
      h.syncSharedSpaceMembersV1(options, response, checkpointMap, sessionId),
    [SyncRequestType.SharedSpaceAssetsV1]: () => h.syncSharedSpaceAssetsV1(options, response, checkpointMap, sessionId),
    [SyncRequestType.SharedSpaceAssetExifsV1]: () =>
      h.syncSharedSpaceAssetExifsV1(options, response, checkpointMap, sessionId),
    [SyncRequestType.SharedSpaceToAssetsV1]: () =>
      h.syncSharedSpaceToAssetsV1(options, response, checkpointMap, sessionId),
    // Library sync handlers.
    [SyncRequestType.LibrariesV1]: () => h.syncLibrariesV1(options, response, checkpointMap),
    [SyncRequestType.LibraryAssetsV1]: () => h.syncLibraryAssetsV1(options, response, checkpointMap, sessionId),
    [SyncRequestType.LibraryAssetExifsV1]: () => h.syncLibraryAssetExifsV1(options, response, checkpointMap, sessionId),
    [SyncRequestType.SharedSpaceLibrariesV1]: () =>
      h.syncSharedSpaceLibrariesV1(options, response, checkpointMap, sessionId),
    // Shared-space album sync handlers (Phase 2A).
    [SyncRequestType.SharedSpaceAlbumsV1]: () => h.syncSharedSpaceAlbumsV1(options, response, checkpointMap),
    [SyncRequestType.SharedSpaceAlbumFoldersV1]: () =>
      h.syncSharedSpaceAlbumFoldersV1(options, response, checkpointMap, sessionId),
    [SyncRequestType.SharedSpaceAlbumLinksV1]: () =>
      h.syncSharedSpaceAlbumLinksV1(options, response, checkpointMap, sessionId),
    [SyncRequestType.SharedSpaceAlbumHiddensV1]: () =>
      h.syncSharedSpaceAlbumHiddensV1(options, response, checkpointMap, sessionId),
    [SyncRequestType.SharedSpaceAlbumToAssetsV1]: () =>
      h.syncSharedSpaceAlbumToAssetsV1(options, response, checkpointMap, sessionId),
    [SyncRequestType.SharedSpaceAlbumAssetsV1]: () =>
      h.syncSharedSpaceAlbumAssetsV1(options, response, checkpointMap, sessionId),
    [SyncRequestType.SharedSpaceAlbumAssetExifsV1]: () =>
      h.syncSharedSpaceAlbumAssetExifsV1(options, response, checkpointMap, sessionId),
  };
};

const cleanupAuditTables = async (repository: GallerySyncRepository, daysAgo: number) => {
  await repository.assetFavorite.cleanupAuditTable(daysAgo);
  await repository.sharedSpace.cleanupAuditTable(daysAgo);
  await repository.sharedSpaceMember.cleanupAuditTable(daysAgo);
  await repository.sharedSpaceToAsset.cleanupAuditTable(daysAgo);
  await repository.library.cleanupAuditTable(daysAgo);
  await repository.libraryAsset.cleanupAuditTable(daysAgo);
  await repository.sharedSpaceLibrary.cleanupAuditTable(daysAgo);
  await repository.sharedSpaceAlbum.cleanupAuditTable(daysAgo);
  await repository.sharedSpaceAlbumLink.cleanupAuditTable(daysAgo);
  await repository.sharedSpaceAlbumHidden.cleanupAuditTable(daysAgo);
  await repository.sharedSpaceAlbumFolder.cleanupAuditTable(daysAgo);
  await repository.sharedSpaceAlbumToAsset.cleanupAuditTable(daysAgo);
};

/** Gallery's sync streams, hooked into SyncService at one spread, one order call and one cleanup call. */
export const GallerySyncStreams = { handlers, order, cleanupAuditTables, isForkAwareClient, syncedMemoryTypes };
