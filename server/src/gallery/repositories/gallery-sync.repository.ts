import { Injectable } from '@nestjs/common';
import { type Expression, type ExpressionBuilder, type Kysely, type SqlBool } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import type { SyncAck } from 'src/types.js';
import { columns } from 'src/database.js';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import {
  BaseSync,
  type SyncBackfillOptions,
  type SyncCreatedAfterOptions,
  type SyncQueryOptions,
} from 'src/repositories/sync.repository.js';
import { DB } from 'src/schema/index.js';
import { asUuid } from 'src/utils/database.js';
import { favoriteExistsFor } from 'src/utils/favorite.js';
import { accessibleSpaceAlbums, accessibleSpaces, spaceVisibilityGate } from 'src/utils/shared-space-album-scope.js';

// Same dummy arguments as sync.repository.ts, so the SQL docs render identical queries.
const dummyBackfillOptions = {
  nowId: DummyValue.UUID,
  beforeUpdateId: DummyValue.UUID,
  afterUpdateId: DummyValue.UUID,
};

const dummyCreateAfterOptions = {
  nowId: DummyValue.UUID,
  userId: DummyValue.UUID,
  afterCreateId: DummyValue.UUID,
};

const dummyQueryOptions = {
  nowId: DummyValue.UUID,
  userId: DummyValue.UUID,
  ack: {
    updateId: DummyValue.UUID,
  },
};

/**
 * Gallery's sync streams (favorites overlay, shared spaces, libraries, space albums), kept out of
 * the upstream SyncRepository. SyncService reaches them through GallerySyncStreams.
 */
@Injectable()
export class GallerySyncRepository {
  assetFavorite: AssetFavoriteSync;
  sharedSpace: SharedSpaceSync;
  sharedSpaceMember: SharedSpaceMemberSync;
  sharedSpaceAsset: SharedSpaceAssetSync;
  sharedSpaceAssetExif: SharedSpaceAssetExifSync;
  sharedSpaceToAsset: SharedSpaceToAssetSync;
  library: LibrarySync;
  libraryAsset: LibraryAssetSync;
  libraryAssetExif: LibraryAssetExifSync;
  sharedSpaceLibrary: SharedSpaceLibrarySync;
  sharedSpaceAlbum: SharedSpaceAlbumSync;
  sharedSpaceAlbumLink: SharedSpaceAlbumLinkSync;
  sharedSpaceAlbumHidden: SharedSpaceAlbumHiddenSync;
  sharedSpaceAlbumFolder: SharedSpaceAlbumFolderSync;
  sharedSpaceAlbumToAsset: SharedSpaceAlbumToAssetSync;
  sharedSpaceAlbumAsset: SharedSpaceAlbumAssetSync;
  sharedSpaceAlbumAssetExif: SharedSpaceAlbumAssetExifSync;

  constructor(@InjectKysely() private db: Kysely<DB>) {
    this.assetFavorite = new AssetFavoriteSync(this.db);
    this.sharedSpace = new SharedSpaceSync(this.db);
    this.sharedSpaceMember = new SharedSpaceMemberSync(this.db);
    this.sharedSpaceAsset = new SharedSpaceAssetSync(this.db);
    this.sharedSpaceAssetExif = new SharedSpaceAssetExifSync(this.db);
    this.sharedSpaceToAsset = new SharedSpaceToAssetSync(this.db);
    this.library = new LibrarySync(this.db);
    this.libraryAsset = new LibraryAssetSync(this.db);
    this.libraryAssetExif = new LibraryAssetExifSync(this.db);
    this.sharedSpaceLibrary = new SharedSpaceLibrarySync(this.db);
    this.sharedSpaceAlbum = new SharedSpaceAlbumSync(this.db);
    this.sharedSpaceAlbumLink = new SharedSpaceAlbumLinkSync(this.db);
    this.sharedSpaceAlbumHidden = new SharedSpaceAlbumHiddenSync(this.db);
    this.sharedSpaceAlbumFolder = new SharedSpaceAlbumFolderSync(this.db);
    this.sharedSpaceAlbumToAsset = new SharedSpaceAlbumToAssetSync(this.db);
    this.sharedSpaceAlbumAsset = new SharedSpaceAlbumAssetSync(this.db);
    this.sharedSpaceAlbumAssetExif = new SharedSpaceAlbumAssetExifSync(this.db);
  }
}

// Per-user favorites overlay sync (#763, design doc §4.3). Structurally identical to
// AssetEditSync in sync.repository.ts: a flat, caller-scoped table (`asset_favorite.userId = options.userId`,
// no join through `asset`), getUpserts + getDeletes, no backfill loop. `asset_favorite` is its
// own synced entity — not a field riding the asset payload — specifically so that a favorite
// write never bumps `asset.updateId`, which would otherwise amplify a personal write into a
// cross-user re-sync of the underlying asset (see AssetSync.getUpserts in sync.repository.ts and
// SharedSpaceAssetSync below, both of which resolve isFavorite via a read-only correlated EXISTS and never
// write here).
class AssetFavoriteSync extends BaseSync {
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('asset_favorite_audit', options)
      .select(['asset_favorite_audit.id', 'asset_favorite_audit.assetId'])
      .where('asset_favorite_audit.userId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('asset_favorite_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('asset_favorite', options)
      .select(['asset_favorite.assetId', 'asset_favorite.updateId'])
      .where('asset_favorite.userId', '=', options.userId)
      .stream();
  }
}

// --- gallery-fork: shared-space sync ---
// `accessibleSpaces` is the source-of-truth scoping subquery used by every
// shared-space sync class to test "does this user have access to this space?".
// A user can access a space via creator path OR membership path. Defining it
// once here prevents the divergence the design doc flags as a risk.
//
// Usage:
//   .where('shared_space.id', 'in', (eb) => accessibleSpaces(eb, userId))
//
// NOTE: owners are also added as `shared_space_member` rows by
// `SharedSpaceService.create`, so iterating via `shared_space_member` for backfill
// enumeration is sufficient — the OR'd creator path here is for query filtering
// only and protects against direct DB inserts that bypass the service.
// `accessibleSpaces` is defined in the fork-owned scope module
// (src/utils/shared-space-album-scope.ts).

const SHARED_SPACE_SYNC_COLUMNS = [
  'shared_space.id',
  'shared_space.name',
  'shared_space.description',
  'shared_space.color',
  'shared_space.createdById',
  'shared_space.thumbnailAssetId',
  'shared_space.thumbnailCropY',
  'shared_space.faceRecognitionEnabled',
  'shared_space.petsEnabled',
  'shared_space.lastActivityAt',
  'shared_space.createdAt',
  'shared_space.updatedAt',
  'shared_space.updateId',
] as const;

export class SharedSpaceSync extends BaseSync {
  // Returns spaces accessible to the user, ordered by the user's MEMBERSHIP
  // createId (not the space's createId). This matches the album pattern in
  // AlbumSync.getCreatedAfter — using the membership createId means a user
  // added to a pre-existing space gets a fresh createId past their backfill
  // checkpoint, which triggers the per-space backfill loop in
  // syncSharedSpaceMembersV1 / AssetsV1 / etc. and drains the historical rows.
  //
  // Relies on the SharedSpaceService.create invariant that the creator is
  // always added as a member.
  @GenerateSql({ params: [dummyCreateAfterOptions] })
  getCreatedAfter({ nowId, userId, afterCreateId }: SyncCreatedAfterOptions) {
    return this.db
      .selectFrom('shared_space_member')
      .select(['shared_space_member.spaceId as id', 'shared_space_member.createId'])
      .where('shared_space_member.userId', '=', userId)
      .$if(!!afterCreateId, (qb) => qb.where('shared_space_member.createId', '>=', afterCreateId!))
      .where('shared_space_member.createId', '<', nowId)
      .orderBy('shared_space_member.createId', 'asc')
      .execute();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_audit', options)
      .select(['id', 'spaceId'])
      .where('userId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space', options)
      .where('shared_space.id', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .select(SHARED_SPACE_SYNC_COLUMNS)
      .stream();
  }
}

// Columns emitted to mobile clients. Explicitly excludes lastViewedAt — that's a
// per-user UI hint that mobile clients track locally and we don't want to round-trip.
const SHARED_SPACE_MEMBER_SYNC_COLUMNS = [
  'shared_space_member.spaceId',
  'shared_space_member.userId',
  'shared_space_member.role',
  'shared_space_member.joinedAt',
  'shared_space_member.showInTimeline',
  'shared_space_member.updateId',
] as const;

export class SharedSpaceMemberSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return this.backfillQuery('shared_space_member', options)
      .select(SHARED_SPACE_MEMBER_SYNC_COLUMNS)
      .where('shared_space_member.spaceId', '=', spaceId)
      .stream();
  }

  // Stream peer-removal events to OTHER members of an accessible space. The
  // current user being removed from a space is signaled separately via
  // SharedSpaceSync.getDeletes (reading shared_space_audit), not this method —
  // by the time this query runs the removed user no longer satisfies
  // accessibleSpaces, so audit rows for them are filtered out. That's the
  // intentional channel split: shared_space_audit handles "you lost access",
  // shared_space_member_audit handles "this peer left".
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_member_audit', options)
      .select(['id', 'spaceId', 'userId'])
      .where('spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_member_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_member', options)
      .select(SHARED_SPACE_MEMBER_SYNC_COLUMNS)
      .where('shared_space_member.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }
}

export class SharedSpaceAssetSync extends BaseSync {
  // Per-space backfill of asset rows joined through shared_space_asset.
  //
  // #763: isFavorite resolves the syncing user's OWN asset_favorite overlay row
  // (favoriteExistsFor), never the asset owner's — a space member sees whether THEY favorited an
  // asset shared into the space, not whether the owner did (mirrors AlbumAssetSync).
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string, userId: string) {
    return (
      this.backfillQuery('shared_space_asset', options)
        .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
        .select(columns.syncSharedSpaceAsset)
        .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
        .select('shared_space_asset.updateId')
        .where('shared_space_asset.spaceId', '=', spaceId)
        .where((eb) => spaceVisibilityGate(eb))
        // M-2: never backfill a trashed asset's metadata/thumbhash/EXIF to a space member. getUpdates
        // stays unfiltered — that's the device-purge convergence channel (asset.updateId bump rides through).
        .where('asset.deletedAt', 'is', null)
        .stream()
    );
  }

  // Create-side: stream new (space, asset) pairings the user can access. Each
  // shared_space_asset row produces one event (write amplification accepted —
  // mobile dedups by asset id at insert time).
  //
  // #763: isFavorite resolves the syncing user's own overlay row — see getBackfill above.
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getCreates(options: SyncQueryOptions) {
    const userId = options.userId;
    return (
      this.upsertQuery('shared_space_asset', options)
        .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
        .select(columns.syncSharedSpaceAsset)
        .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
        .select('shared_space_asset.updateId')
        .where('shared_space_asset.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
        .where((eb) => spaceVisibilityGate(eb))
        // M-2: getCreates must not introduce a trashed asset a device didn't already have (getUpdates is the
        // convergence channel for state changes on already-known assets).
        .where('asset.deletedAt', 'is', null)
        .stream()
    );
  }

  // Update-side: stream asset metadata changes for assets the client has already
  // received. Gated by `shared_space_asset.updateId <= sharedSpaceToAssetAck` to
  // ensure we only emit updates for join rows the client has acked.
  //
  // #763: isFavorite resolves the syncing user's own overlay row — see getBackfill above.
  @GenerateSql({ params: [dummyQueryOptions, { updateId: DummyValue.UUID }], stream: true })
  getUpdates(options: SyncQueryOptions, sharedSpaceToAssetAck: SyncAck) {
    const userId = options.userId;
    return this.upsertQuery('asset', options)
      .innerJoin('shared_space_asset', 'shared_space_asset.assetId', 'asset.id')
      .select(columns.syncSharedSpaceAsset)
      .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
      .select('asset.updateId')
      .where('shared_space_asset.updateId', '<=', sharedSpaceToAssetAck.updateId)
      .where('shared_space_asset.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .where((eb) => spaceVisibilityGate(eb))
      .stream();
  }
  // Note: shared_space_asset_audit cleanup is owned by SharedSpaceToAssetSync below,
  // mirroring how AlbumToAssetSync owns album_asset_audit cleanup.
}

export class SharedSpaceAssetExifSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return (
      this.backfillQuery('shared_space_asset', options)
        .innerJoin('asset_exif', 'asset_exif.assetId', 'shared_space_asset.assetId')
        .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
        .select(columns.syncAssetExif)
        .select('shared_space_asset.updateId')
        .where('shared_space_asset.spaceId', '=', spaceId)
        .where((eb) => spaceVisibilityGate(eb))
        // M-2: never backfill a trashed asset's metadata/thumbhash/EXIF to a space member. getUpdates
        // stays unfiltered — that's the device-purge convergence channel (asset.updateId bump rides through).
        .where('asset.deletedAt', 'is', null)
        .stream()
    );
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getCreates(options: SyncQueryOptions) {
    return (
      this.upsertQuery('shared_space_asset', options)
        .innerJoin('asset_exif', 'asset_exif.assetId', 'shared_space_asset.assetId')
        .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
        .select(columns.syncAssetExif)
        .select('shared_space_asset.updateId')
        .where('shared_space_asset.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
        .where((eb) => spaceVisibilityGate(eb))
        // M-2: getCreates must not introduce a trashed asset a device didn't already have (getUpdates is the
        // convergence channel for state changes on already-known assets).
        .where('asset.deletedAt', 'is', null)
        .stream()
    );
  }

  @GenerateSql({ params: [dummyQueryOptions, { updateId: DummyValue.UUID }], stream: true })
  getUpdates(options: SyncQueryOptions, sharedSpaceToAssetAck: SyncAck) {
    return this.upsertQuery('asset_exif', options)
      .innerJoin('shared_space_asset', 'shared_space_asset.assetId', 'asset_exif.assetId')
      .innerJoin('asset', 'asset.id', 'asset_exif.assetId')
      .select(columns.syncAssetExif)
      .select('asset_exif.updateId')
      .where('shared_space_asset.updateId', '<=', sharedSpaceToAssetAck.updateId)
      .where('shared_space_asset.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .where((eb) => spaceVisibilityGate(eb))
      .stream();
  }
}

// Owns shared_space_asset_audit cleanup. The audit table is shared with
// SharedSpaceAssetSync (which streams full asset rows) and SharedSpaceAssetExifSync
// (which streams exif rows), but only one class should call auditCleanup per table
// — otherwise the schema-driven `should cleanup every table` test counts duplicate
// invocations and fails. The convention (mirrored from AlbumToAssetSync) is that
// the join-row sync class owns cleanup of the join-row audit table.
export class SharedSpaceToAssetSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return (
      this.backfillQuery('shared_space_asset', options)
        .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
        .select([
          'shared_space_asset.assetId as assetId',
          'shared_space_asset.spaceId as spaceId',
          'shared_space_asset.updateId',
        ])
        .where('shared_space_asset.spaceId', '=', spaceId)
        // correctness-1/security-6: flat visibility gate — never stream a link row for a
        // Hidden/Locked asset (matches the SharedSpaceAssetSync content sibling; converges on restore).
        .where((eb) => spaceVisibilityGate(eb))
        // M-2: don't backfill a link row for a trashed asset either (getUpserts stays the convergence channel).
        .where('asset.deletedAt', 'is', null)
        .stream()
    );
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    // gaps-5 deliberately NOT owner-gated on this DIRECT arm. shared_space_asset_audit is dual-purpose:
    // it receives both visibility-purge tombstones (gaps-5 wanted the owner excluded — LOW/benign, restore
    // round-trips) AND genuine removal tombstones from shared_space_asset_delete_audit (the owner MUST get
    // these to converge their own other devices). The two are indistinguishable without a discriminator
    // column (a migration, out of scope), so owner removal-convergence wins and the owner is not gated here.
    // The owner IS gated on the ALBUM (getDeletes below) and LIBRARY arms, whose audit tables are purge-only.
    return this.auditQuery('shared_space_asset_audit', options)
      .select(['id', 'assetId', 'spaceId'])
      .where('spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_asset_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return (
      this.upsertQuery('shared_space_asset', options)
        .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
        .select([
          'shared_space_asset.assetId as assetId',
          'shared_space_asset.spaceId as spaceId',
          'shared_space_asset.updateId',
        ])
        .where('shared_space_asset.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
        // correctness-1/security-6: flat visibility gate — a restore's updateId bump must not re-add a
        // now-Hidden asset after the delete tombstone (resurrection); also blocks the metadata leak.
        .where((eb) => spaceVisibilityGate(eb))
        .stream()
    );
  }
}

// `accessibleSpaceAlbums` (album-id scope) and `accessibleSpaces` (space-id scope)
// live in the fork-owned scope module and are imported here for the sync
// classes below. See src/utils/shared-space-album-scope.ts.

// `accessibleLibraries` is the source-of-truth scoping subquery used by every
// library sync class. A user can access a library via direct ownership OR via
// any space they can access (membership or creator). The UNION naturally
// deduplicates so a user who both owns L and is a member of a space linking L
// gets a single row.
//
// Usage:
//   .where('library.id', 'in', (eb) => accessibleLibraries(eb, userId))
//
// NOTE: soft-deleted libraries (deletedAt IS NOT NULL) are excluded from the
// ownership branch but NOT from the space-link branch — a soft-deleted library
// is still reachable via a linked space and the client should still see it
// until the library is hard-deleted.
export function accessibleLibraries(eb: ExpressionBuilder<DB, keyof DB>, userId: string) {
  return eb
    .selectFrom('library')
    .select('library.id')
    .where('library.ownerId', '=', userId)
    .where('library.deletedAt', 'is', null)
    .union(
      eb
        .selectFrom('shared_space_library')
        .select('shared_space_library.libraryId as id')
        .where('shared_space_library.spaceId', 'in', (eb2) => accessibleSpaces(eb2, userId)),
    );
}

const LIBRARY_SYNC_COLUMNS = [
  'library.id',
  'library.name',
  'library.ownerId',
  'library.createdAt',
  'library.updatedAt',
  'library.updateId',
] as const;

export class LibrarySync extends BaseSync {
  // Queries library_user (a (userId, libraryId) denormalization populated by
  // the library_after_insert / shared_space_member_after_insert_library /
  // shared_space_library_after_insert_user triggers) keyed by the per-user
  // access-grant createId. This mirrors SharedSpaceSync.getCreatedAfter and
  // AlbumSync.getCreatedAfter — each row represents "user U gained access to
  // library L at time createId", so a user rejoining a space or being added
  // to a pre-existing space gets fresh createIds > their checkpoint and the
  // per-library asset backfill loop correctly re-iterates the library.
  //
  // The `library_user.libraryId IN accessibleLibraries(userId)` filter is
  // preserved so that soft-deleted owned libraries are excluded — matching
  // the existing behavior where `accessibleLibraries` drops the ownership
  // branch when `deletedAt IS NOT NULL`, while keeping soft-deleted libraries
  // visible via the space-link branch. Without this filter, an owner who
  // soft-deletes a library would still see its assets re-streamed on every
  // sync.
  //
  // See specs/2026-04-11-library-user-access-backfill-design.md.
  @GenerateSql({ params: [dummyCreateAfterOptions] })
  getCreatedAfter({ nowId, userId, afterCreateId }: SyncCreatedAfterOptions) {
    return this.db
      .selectFrom('library_user')
      .select(['library_user.libraryId as id', 'library_user.createId'])
      .where('library_user.userId', '=', userId)
      .where('library_user.libraryId', 'in', (eb) => accessibleLibraries(eb, userId))
      .$if(!!afterCreateId, (qb) => qb.where('library_user.createId', '>=', afterCreateId!))
      .where('library_user.createId', '<', nowId)
      .orderBy('library_user.createId', 'asc')
      .execute();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('library_audit', options)
      .select(['id', 'libraryId'])
      .where('userId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('library_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('library', options)
      .where('library.id', 'in', (eb) => accessibleLibraries(eb, options.userId))
      .select(LIBRARY_SYNC_COLUMNS)
      .stream();
  }
}

// Streams library-owned asset rows. The "once-per-asset" correctness property
// comes from filtering `asset.libraryId IN accessibleLibraries(userId)` directly
// on the asset table. A library linked to multiple spaces is still counted ONCE
// in the accessibleLibraries UNION, and each asset has exactly one libraryId,
// so this class never produces the write-amplification that SharedSpaceAssetSync
// accepts for (space, asset) pairs.
//
// Owns library_asset_audit cleanup because this class is the one that streams
// the per-asset delete events derived from that table.
export class LibraryAssetSync extends BaseSync {
  // Per-library backfill of asset rows for a specific library. Triggered by the
  // `syncLibraryAssetsV1` service loop when the client has not yet backfilled a
  // newly-accessible library.
  //
  // M3 visibility gate: the user always sees ALL visibilities of their own
  // assets. For OTHER members' assets (reached via the space-link branch of
  // accessibleLibraries), only Archive and Timeline are streamed.
  //
  // L5/#763: isFavorite resolves the syncing user's OWN asset_favorite overlay row (mirrors
  // SharedSpaceAssetSync/SharedSpaceAlbumAssetSync) — a member syncing another owner's
  // space-linked library sees whether THEY favorited the asset, never the owner's favorite.
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, libraryId: string, userId: string) {
    return (
      this.backfillQuery('asset', options)
        .select(columns.syncLibraryAsset)
        .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
        .select('asset.updateId')
        .where('asset.libraryId', '=', libraryId)
        // M-2: the non-owner (space-link) branch also excludes trashed assets; the owner keeps their own
        // trashed library assets (owner branch unfiltered). getUpserts stays the convergence channel.
        .where((eb) =>
          eb.or([
            eb('asset.ownerId', '=', userId),
            eb.and([spaceVisibilityGate(eb), eb('asset.deletedAt', 'is', null)]),
          ]),
        )
        .stream()
    );
  }

  // Single upsert stream for library assets. Mirrors PartnerAssetsSync.getUpserts
  // — that's the canonical shape for access-scoped sync without a per-pairing
  // join table. We can't split create vs update like SharedSpaceAssetSync does
  // because there's no stable library<->asset join-row updateId to gate on.
  // Both initial syncs and subsequent metadata changes flow through this stream
  // as `LibraryAssetCreateV1` events; the client upserts idempotently.
  //
  // M3 visibility gate: see getBackfill above.
  // L5/#763: isFavorite resolves the syncing user's own overlay row — see getBackfill above.
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    const userId = options.userId;
    return this.upsertQuery('asset', options)
      .select(columns.syncLibraryAsset)
      .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
      .select('asset.updateId')
      .where('asset.libraryId', 'is not', null)
      .where('asset.libraryId', 'in', (eb) => accessibleLibraries(eb, userId))
      .where((eb) => eb.or([eb('asset.ownerId', '=', userId), spaceVisibilityGate(eb)]))
      .stream();
  }

  // Stream per-asset deletes from library_asset_audit, scoped to libraries the
  // user can still access. The audit table stores both assetId and libraryId
  // (libraryId is captured by the asset_library_delete_audit trigger from the
  // OLD asset row). The libraryId scoping prevents leaking per-asset delete
  // events to clients who never had access to the library.
  //
  // The whole-library revocation path is handled separately by
  // LibrarySync.getDeletes (library_audit scoped per-user) — when a user loses
  // access to a whole library, they receive a LibraryDeleteV1 and the client
  // drops all assets locally without needing per-asset events.
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    const { userId, nowId, ack } = options;

    // Existing arm: per-asset deletes from library_asset_audit (triggered when an
    // asset row is physically deleted from the DB — not a visibility flip).
    const libraryAssetArm = this.db
      .selectFrom('library_asset_audit')
      .select(['library_asset_audit.id as id', 'library_asset_audit.assetId as assetId'])
      .where('library_asset_audit.id', '<', nowId)
      .$if(!!ack, (qb) => qb.where('library_asset_audit.id', '>', ack!.updateId))
      .where('library_asset_audit.libraryId', 'in', (eb) => accessibleLibraries(eb, userId));

    // Space visibility purge arm: tombstones written by emitLibraryAssetVisibilityPurge
    // when the owner flips a library-linked space asset to Hidden/Locked.
    // Owner-gated: the library owner never receives a visibility purge for their
    // own asset — only non-owner space members are purged.
    const spaceLibraryAssetArm = this.db
      .selectFrom('shared_space_library_asset_audit')
      .innerJoin('asset', 'asset.id', 'shared_space_library_asset_audit.assetId')
      .select(['shared_space_library_asset_audit.id as id', 'shared_space_library_asset_audit.assetId as assetId'])
      .where('shared_space_library_asset_audit.id', '<', nowId)
      .$if(!!ack, (qb) => qb.where('shared_space_library_asset_audit.id', '>', ack!.updateId))
      .where('shared_space_library_asset_audit.libraryId', 'in', (eb) => accessibleLibraries(eb, userId))
      .where('asset.ownerId', '!=', userId)
      // security-7: a member who is ALSO the owner's partner keeps partner-entitled access to the asset
      // (a partner may see Hidden). Do not purge it from their device — exclude assets whose owner shares
      // with this user via the partner table (sharedById = owner, sharedWithId = this user).
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('partner')
              .select(eb.lit(1).as('exists'))
              .whereRef('partner.sharedById', '=', 'asset.ownerId')
              .where('partner.sharedWithId', '=', userId),
          ),
        ),
      );

    return libraryAssetArm.union(spaceLibraryAssetArm).orderBy('id', 'asc').stream();
  }

  async cleanupAuditTable(daysAgo: number) {
    await this.auditCleanup('library_asset_audit', daysAgo);
    await this.auditCleanup('shared_space_library_asset_audit', daysAgo);
  }
}

// Streams asset_exif rows for library-owned assets. Scoped by
// asset.libraryId IN accessibleLibraries, joined through asset → asset_exif.
// Mirrors AlbumAssetExifSync but uses the library-access boundary instead of
// the album-user boundary. No cleanupAuditTable — there is no dedicated
// exif audit table (consistent with AlbumAssetExifSync).
export class LibraryAssetExifSync extends BaseSync {
  // M3 visibility gate: the user always sees ALL visibilities of their own
  // assets. For OTHER members' assets (reached via the space-link branch of
  // accessibleLibraries), only Archive and Timeline are streamed.
  // backfillQuery('asset', ...) places `asset` as the base table, so the gate
  // can reference asset.ownerId and asset.visibility directly.
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, libraryId: string, userId: string) {
    return (
      this.backfillQuery('asset', options)
        .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
        .select(columns.syncAssetExif)
        .select('asset.updateId')
        .where('asset.libraryId', '=', libraryId)
        // M-2: the non-owner (space-link) branch also excludes trashed assets; the owner keeps their own
        // trashed library assets (owner branch unfiltered). getUpserts stays the convergence channel.
        .where((eb) =>
          eb.or([
            eb('asset.ownerId', '=', userId),
            eb.and([spaceVisibilityGate(eb), eb('asset.deletedAt', 'is', null)]),
          ]),
        )
        .stream()
    );
  }

  // Single upsert stream — same rationale as LibraryAssetSync.getUpserts.
  //
  // M3 visibility gate: upsertQuery('asset_exif', ...) places asset_exif as
  // the base table; we innerJoin asset so asset.ownerId and asset.visibility
  // are reachable for the M3 gate. The libraryId scope is expressed as a
  // direct WHERE on asset.libraryId (available after the join) rather than
  // a subquery, matching the style used by SharedSpaceAssetExifSync.
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('asset_exif', options)
      .innerJoin('asset', 'asset.id', 'asset_exif.assetId')
      .select(columns.syncAssetExif)
      .select('asset_exif.updateId')
      .where('asset.libraryId', 'is not', null)
      .where('asset.libraryId', 'in', (eb) => accessibleLibraries(eb, options.userId))
      .where((eb) => eb.or([eb('asset.ownerId', '=', options.userId), spaceVisibilityGate(eb)]))
      .stream();
  }
}

const SHARED_SPACE_LIBRARY_SYNC_COLUMNS = [
  'shared_space_library.spaceId',
  'shared_space_library.libraryId',
  'shared_space_library.addedById',
  'shared_space_library.createdAt',
  'shared_space_library.updatedAt',
  'shared_space_library.updateId',
] as const;

// Streams the shared_space_library join rows — the per-space "which libraries
// are linked" mapping. Scoped by accessibleSpaces (NOT accessibleLibraries):
// this is the join row belonging to the space, and the user must have access
// to the space itself to see its link set.
//
// Owns shared_space_library_audit cleanup.
export class SharedSpaceLibrarySync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return this.backfillQuery('shared_space_library', options)
      .select(SHARED_SPACE_LIBRARY_SYNC_COLUMNS)
      .where('shared_space_library.spaceId', '=', spaceId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_library_audit', options)
      .select(['id', 'spaceId', 'libraryId'])
      .where('spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_library_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_library', options)
      .select(SHARED_SPACE_LIBRARY_SYNC_COLUMNS)
      .where('shared_space_library.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }
}

// Streams album metadata for albums accessible to the user via the
// shared_space_album_user grant. The grant table is populated by A2 triggers
// (create-side) and consumed by A3 triggers (delete-side).
//
// NOTE (hybrid-clone gotcha §7): getDeletes reads shared_space_album_user_audit
// (the gated grant-revocation audit) NOT album_audit. This mirrors
// LibrarySync.getDeletes which reads library_audit (not album_audit).
// The grant audit fires when the user LOSES ACCESS to the album
// (space unlinked or member removed), so it signals "client should drop this
// album" without requiring the album itself to be deleted.
export class SharedSpaceAlbumSync extends BaseSync {
  // Reads shared_space_album_user grant table keyed by createId.
  // This mirrors AlbumSync.getCreatedAfter (album_user table) and
  // LibrarySync.getCreatedAfter (library_user table). A fresh grant
  // row is written for every (userId, albumId) pair when an album is linked
  // to a space the user belongs to, or when the user joins a space with
  // existing album links.
  @GenerateSql({ params: [dummyCreateAfterOptions] })
  getCreatedAfter({ nowId, userId, afterCreateId }: SyncCreatedAfterOptions) {
    return this.db
      .selectFrom('shared_space_album_user')
      .select(['albumId as id', 'createId'])
      .where('userId', '=', userId)
      .where('albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .$if(!!afterCreateId, (qb) => qb.where('createId', '>=', afterCreateId!))
      .where('createId', '<', nowId)
      .orderBy('createId', 'asc')
      .execute();
  }

  // HYBRID-CLONE: reads shared_space_album_user_audit (grant revocation),
  // NOT album_audit. Each row signals that the user has lost access to
  // the album (no other path remains). The client should drop the album.
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_album_user_audit', options)
      .select(['id', 'albumId'])
      .where('userId', '=', options.userId)
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_album_user_audit', daysAgo);
  }

  // Streams album metadata rows for albums the user can access via
  // accessibleSpaceAlbums, excluding soft-deleted albums.
  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('album', options)
      .distinctOn(['album.id', 'album.updateId'])
      .where('album.id', 'in', (eb) => accessibleSpaceAlbums(eb, options.userId))
      .select([
        'album.id',
        'album.albumName as name',
        'album.description',
        'album.createdAt',
        'album.updatedAt',
        'album.albumThumbnailAssetId as thumbnailAssetId',
        'album.isActivityEnabled',
        'album.order',
        'album.updateId',
      ])
      .stream();
  }
}

// Columns emitted for each space→album link join row.
const SHARED_SPACE_ALBUM_SYNC_COLUMNS = [
  'shared_space_album.spaceId',
  'shared_space_album.albumId',
  'shared_space_album.showInTimeline',
  'shared_space_album.folderId',
  'shared_space_album.addedById',
  'shared_space_album.createdAt',
  'shared_space_album.updatedAt',
  'shared_space_album.updateId',
] as const;

// Streams the shared_space_album join rows — the per-space "which albums are
// linked" mapping. Scoped by accessibleSpaces (NOT accessibleSpaceAlbums):
// this is the join row belonging to the space, and the user must have access
// to the space itself to see its album link set.
//
// Clone of SharedSpaceLibrarySync with shared_space_library→shared_space_album
// and carrying showInTimeline. Owns shared_space_album_audit cleanup.
export class SharedSpaceAlbumLinkSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return (
      this.backfillQuery('shared_space_album', options)
        .innerJoin('album', 'album.id', 'shared_space_album.albumId')
        .select(SHARED_SPACE_ALBUM_SYNC_COLUMNS)
        .where('shared_space_album.spaceId', '=', spaceId)
        // Slice 8 (correctness-3): never stream a soft-deleted album's link row; the
        // trigger tombstones it via shared_space_album_audit, and this stops getUpserts/
        // getBackfill re-adding it before restore.
        .where('album.deletedAt', 'is', null)
        .stream()
    );
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_album_audit', options)
      .select(['id', 'spaceId', 'albumId'])
      .where('spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_album_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return (
      this.upsertQuery('shared_space_album', options)
        .innerJoin('album', 'album.id', 'shared_space_album.albumId')
        .select(SHARED_SPACE_ALBUM_SYNC_COLUMNS)
        .where('shared_space_album.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
        // Slice 8 (correctness-3): exclude soft-deleted albums so a stale updateId bump
        // cannot re-add a tombstoned link row (convergence). Restore bumps updateId and
        // clears deletedAt → the row re-delivers.
        .where('album.deletedAt', 'is', null)
        .stream()
    );
  }
}

// Columns emitted for each personal hidden-album row. Mirrors SHARED_SPACE_ALBUM_SYNC_COLUMNS —
// updateId must be selected because the service handler destructures it off the row to key the
// sync event's `ids`.
const SHARED_SPACE_ALBUM_HIDDEN_SYNC_COLUMNS = [
  'shared_space_album_hidden.spaceId',
  'shared_space_album_hidden.albumId',
  'shared_space_album_hidden.userId',
  'shared_space_album_hidden.updateId',
] as const;

// gallery-fork (#1041): the per-member "album hidden from MY timeline" rows.
//
// Scoped by userId equality, NOT by accessibleSpaces — unlike every sibling stream in this file.
// These rows are a personal viewing preference, so a member must never receive a peer's. The audit
// table has no scoping of its own (spaceId/albumId/userId, no membership relation baked in), so
// getDeletes must filter it by userId too.
export class SharedSpaceAlbumHiddenSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string, userId: string) {
    return this.backfillQuery('shared_space_album_hidden', options)
      .innerJoin('album', 'album.id', 'shared_space_album_hidden.albumId')
      .select(SHARED_SPACE_ALBUM_HIDDEN_SYNC_COLUMNS)
      .where('shared_space_album_hidden.spaceId', '=', spaceId)
      .where('shared_space_album_hidden.userId', '=', asUuid(userId))
      .where('album.deletedAt', 'is', null)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_album_hidden_audit', options)
      .select(['id', 'spaceId', 'albumId', 'userId'])
      .where('userId', '=', asUuid(options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_album_hidden_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_album_hidden', options)
      .innerJoin('album', 'album.id', 'shared_space_album_hidden.albumId')
      .select(SHARED_SPACE_ALBUM_HIDDEN_SYNC_COLUMNS)
      .where('shared_space_album_hidden.userId', '=', asUuid(options.userId))
      .where('album.deletedAt', 'is', null)
      .stream();
  }
}

// Columns emitted for each folder row.
const SHARED_SPACE_ALBUM_FOLDER_SYNC_COLUMNS = [
  'shared_space_album_folder.id',
  'shared_space_album_folder.spaceId',
  'shared_space_album_folder.parentId',
  'shared_space_album_folder.name',
  'shared_space_album_folder.createdAt',
  'shared_space_album_folder.updatedAt',
  'shared_space_album_folder.updateId',
] as const;

// Streams a space's album folders. Structurally a clone of SharedSpaceAlbumLinkSync, minus the
// soft-delete join — folders have no deletedAt and no album to check.
//
// accessibleSpaces() on BOTH arms is the privacy gate: a folder NAME is member-only information,
// the same rule the REST listing enforces. Dropping it from either arm is a leak, not a style slip.
export class SharedSpaceAlbumFolderSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, spaceId: string) {
    return this.backfillQuery('shared_space_album_folder', options)
      .select(SHARED_SPACE_ALBUM_FOLDER_SYNC_COLUMNS)
      .where('shared_space_album_folder.spaceId', '=', spaceId)
      .stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    return this.auditQuery('shared_space_album_folder_audit', options)
      .select(['id', 'spaceId', 'folderId'])
      .where('spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }

  cleanupAuditTable(daysAgo: number) {
    return this.auditCleanup('shared_space_album_folder_audit', daysAgo);
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    return this.upsertQuery('shared_space_album_folder', options)
      .select(SHARED_SPACE_ALBUM_FOLDER_SYNC_COLUMNS)
      .where('shared_space_album_folder.spaceId', 'in', (eb) => accessibleSpaces(eb, options.userId))
      .stream();
  }
}

// #764/§8.3: a contribution is visible to a member ONLY through the SINGLE space it was contributed
// via. Gate every contributed sync arm on live membership of that space AND the album still being
// linked to it — mirroring the web read arm (spaceContributedAssetExists). The album_asset grant /
// accessibleSpaceAlbums are space-agnostic and would otherwise leak an S1 contribution to an
// S2-only member of a multi-space co-linked album (edge + payload + exif).
//
// Correlated subquery: the two whereRefs reference the OUTER `album_space_asset` (the contributed arm
// this predicate is attached to), exactly as the web read arm correlates album_space_asset.spaceId to
// the link's space.
const contributionVisibleToMember = (eb: ExpressionBuilder<DB, keyof DB>, userId: string): Expression<SqlBool> =>
  eb.exists(
    eb
      .selectFrom('shared_space_album')
      .innerJoin('shared_space_member', (join) =>
        join
          .onRef('shared_space_member.spaceId', '=', 'shared_space_album.spaceId')
          .on('shared_space_member.userId', '=', asUuid(userId)),
      )
      .whereRef('shared_space_album.albumId', '=', 'album_space_asset.albumId')
      .whereRef('shared_space_album.spaceId', '=', 'album_space_asset.spaceId')
      .select(eb.lit(1).as('one')),
  );

// Streams album_asset join rows (album membership) for albums accessible via
// the shared_space_album_user grant. Clone of AlbumToAssetSync with the
// album_user scoping swapped for the grant. Also unions the album_space_asset
// contributed arm (#764), gated per-space by contributionVisibleToMember.
//
// getDeletes reads album_asset_audit scoped to albums in accessibleSpaceAlbums
// (not album_user like AlbumToAssetSync) so that access-revocation at the space
// level stops the user from seeing further delete events.
class SharedSpaceAlbumToAssetSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, albumId: string, userId: string) {
    const { nowId, beforeUpdateId, afterUpdateId } = options;
    // album_asset arm — the album owner's own membership (unchanged).
    const albumAssetArm = this.db
      .selectFrom('album_asset')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .select(['album_asset.assetId as assetId', 'album_asset.albumId as albumId', 'album_asset.updateId'])
      .where('album_asset.albumId', '=', albumId)
      .where('album_asset.updateId', '<', nowId)
      .where('album_asset.updateId', '<=', beforeUpdateId)
      .$if(!!afterUpdateId, (qb) => qb.where('album_asset.updateId', '>', afterUpdateId!))
      // correctness-1/security-6: flat visibility gate — never backfill a Hidden/Locked asset's link.
      .where((eb) => spaceVisibilityGate(eb))
      // M-2: don't backfill a link row for a trashed album asset either (getUpserts stays convergence).
      .where('asset.deletedAt', 'is', null);

    // album_space_asset arm — cross-owner contributions (#764). Mechanical mirror keyed on updateId.
    const contributedArm = this.db
      .selectFrom('album_space_asset')
      .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
      .select([
        'album_space_asset.assetId as assetId',
        'album_space_asset.albumId as albumId',
        'album_space_asset.updateId',
      ])
      .where('album_space_asset.albumId', '=', albumId)
      .where('album_space_asset.updateId', '<', nowId)
      .where('album_space_asset.updateId', '<=', beforeUpdateId)
      .$if(!!afterUpdateId, (qb) => qb.where('album_space_asset.updateId', '>', afterUpdateId!))
      .where((eb) => spaceVisibilityGate(eb))
      // #764/§8.3: only members of the space this contribution was made via may receive it.
      .where((eb) => contributionVisibleToMember(eb, userId))
      // M-2: don't backfill a link row for a trashed contributed asset either (getUpserts stays convergence).
      .where('asset.deletedAt', 'is', null);

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getDeletes(options: SyncQueryOptions) {
    const { userId, nowId, ack } = options;
    // Union THREE audit sources: the shared album_asset_audit (normal album deletes), the space-only
    // shared_space_album_asset_audit (owned-asset visibility Hidden purge), and the album_space_asset_audit
    // (cross-owner contribution removals / delete / Hidden purge — #764). All arms are checkpoint-gated by
    // the same nowId/ack bounds and scoped to albums accessible to this user via the space. A single
    // ORDER BY id is applied over the whole union — per-arm ordering is invalid SQL.
    const albumAssetArm = this.db
      .selectFrom('album_asset_audit')
      .select(['id', 'assetId', 'albumId'])
      .where('id', '<', nowId)
      .$if(!!ack, (qb) => qb.where('id', '>', ack!.updateId))
      .where('albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId));

    const spaceAlbumAssetArm = this.db
      .selectFrom('shared_space_album_asset_audit')
      // gaps-5: owner-gate the album visibility-purge arm to match the library arm — the album owner must
      // never receive a delete for their OWN hidden asset (over-purge). This table is purge-only (no delete
      // trigger), so the asset row always exists → a plain INNER JOIN is correct.
      .innerJoin('asset', 'asset.id', 'shared_space_album_asset_audit.assetId')
      .select([
        'shared_space_album_asset_audit.id as id',
        'shared_space_album_asset_audit.assetId as assetId',
        'shared_space_album_asset_audit.albumId as albumId',
      ])
      .where('shared_space_album_asset_audit.id', '<', nowId)
      .$if(!!ack, (qb) => qb.where('shared_space_album_asset_audit.id', '>', ack!.updateId))
      .where('shared_space_album_asset_audit.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where('asset.ownerId', '!=', userId);

    // album_space_asset_audit — cross-owner contribution removals (#764). Trigger-driven, so the
    // asset row may already be gone on FK cascade → NO asset join. A contribution is never also an
    // owner's album_asset row (spec §5.1), so the owner has no independent path → NO ownerId filter:
    // every member, including the asset's owner, drops the edge on removal/delete/Hidden-purge.
    const contributedAuditArm = this.db
      .selectFrom('album_space_asset_audit')
      .select(['id', 'assetId', 'albumId'])
      .where('id', '<', nowId)
      .$if(!!ack, (qb) => qb.where('id', '>', ack!.updateId))
      .where('albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId));

    return albumAssetArm.union(spaceAlbumAssetArm).union(contributedAuditArm).orderBy('id', 'asc').stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getUpserts(options: SyncQueryOptions) {
    const { userId, nowId, ack } = options;
    const albumAssetArm = this.db
      .selectFrom('album_asset')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_asset.albumId')
      .select(['album_asset.assetId as assetId', 'album_asset.albumId as albumId', 'album_asset.updateId'])
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where('album_asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('album_asset.updateId', '>', ack!.updateId))
      // correctness-1/security-6: flat visibility gate — a restore's updateId bump must not re-add a
      // now-Hidden asset after the delete tombstone (resurrection); also blocks the metadata leak.
      .where((eb) => spaceVisibilityGate(eb));

    const contributedArm = this.db
      .selectFrom('album_space_asset')
      .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_space_asset.albumId')
      .select([
        'album_space_asset.assetId as assetId',
        'album_space_asset.albumId as albumId',
        'album_space_asset.updateId',
      ])
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_space_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where('album_space_asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('album_space_asset.updateId', '>', ack!.updateId))
      .where((eb) => spaceVisibilityGate(eb))
      // #764/§8.3: only members of the space this contribution was made via may receive it.
      .where((eb) => contributionVisibleToMember(eb, userId));

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }

  // Prune the space-only audit tables this stream owns. The shared album_asset_audit is pruned by
  // albumToAsset.cleanupAuditTable (AlbumToAssetSync).
  async cleanupAuditTable(daysAgo: number) {
    await this.auditCleanup('shared_space_album_asset_audit', daysAgo);
    await this.auditCleanup('album_space_asset_audit', daysAgo);
  }
}

// Streams full asset metadata rows for albums accessible via the
// shared_space_album_user grant, unioning the album owner's own album_asset rows
// with the cross-owner album_space_asset contributions (#764, gated per-space by
// contributionVisibleToMember). Clone of AlbumAssetSync with the album_user
// scoping swapped for the grant.
//
// Preserves the split getCreates/getUpdates/getBackfill pattern, the per-user isFavorite overlay
// resolution (#763: favoriteExistsFor(eb, userId) — the syncing user's own favorite, never the
// asset owner's), and the albumToAssetAck coupling that ensures updates only fire for assets the
// client already knows about.
class SharedSpaceAlbumAssetSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, albumId: string, userId: string) {
    const { nowId, beforeUpdateId, afterUpdateId } = options;

    // album_asset arm — the album owner's own membership (unchanged).
    const albumAssetArm = this.db
      .selectFrom('album_asset')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
      .select('album_asset.updateId')
      .where('album_asset.albumId', '=', albumId)
      .where('album.deletedAt', 'is', null)
      .where('album_asset.updateId', '<', nowId)
      .where('album_asset.updateId', '<=', beforeUpdateId)
      .$if(!!afterUpdateId, (qb) => qb.where('album_asset.updateId', '>', afterUpdateId!))
      .where((eb) => spaceVisibilityGate(eb))
      // M-2: never backfill a trashed owner-arm album asset to a space member either.
      .where('asset.deletedAt', 'is', null);

    // album_space_asset arm — cross-owner contributions (#764). Mechanical mirror keyed on updateId.
    const contributedArm = this.db
      .selectFrom('album_space_asset')
      .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
      .innerJoin('album', 'album.id', 'album_space_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
      .select('album_space_asset.updateId')
      .where('album_space_asset.albumId', '=', albumId)
      .where('album.deletedAt', 'is', null)
      .where('album_space_asset.updateId', '<', nowId)
      .where('album_space_asset.updateId', '<=', beforeUpdateId)
      .$if(!!afterUpdateId, (qb) => qb.where('album_space_asset.updateId', '>', afterUpdateId!))
      .where((eb) => spaceVisibilityGate(eb))
      // #764/§8.3: only members of the space this contribution was made via may receive it.
      .where((eb) => contributionVisibleToMember(eb, userId))
      // M-2: never backfill a trashed contributed asset's metadata/thumbhash/EXIF to a space member.
      .where('asset.deletedAt', 'is', null);

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }

  @GenerateSql({ params: [dummyQueryOptions, { updateId: DummyValue.UUID }], stream: true })
  getUpdates(options: SyncQueryOptions, albumToAssetAck: SyncAck) {
    const { userId, nowId, ack } = options;

    // album_asset arm — the album owner's own membership (unchanged).
    const albumAssetArm = this.db
      .selectFrom('asset')
      .innerJoin('album_asset', 'album_asset.assetId', 'asset.id')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
      .select('asset.updateId')
      .where('asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('asset.updateId', '>', ack!.updateId))
      .where('album_asset.updateId', '<=', albumToAssetAck.updateId) // Ensure we only send updates for assets that the client already knows about
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where((eb) => spaceVisibilityGate(eb));

    // album_space_asset arm — cross-owner contributions (#764). Mechanical mirror keyed on updateId.
    const contributedArm = this.db
      .selectFrom('asset')
      .innerJoin('album_space_asset', 'album_space_asset.assetId', 'asset.id')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_space_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
      .select('asset.updateId')
      .where('asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('asset.updateId', '>', ack!.updateId))
      .where('album_space_asset.updateId', '<=', albumToAssetAck.updateId)
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_space_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where((eb) => spaceVisibilityGate(eb))
      // #764/§8.3: only members of the space this contribution was made via may receive it.
      .where((eb) => contributionVisibleToMember(eb, userId));

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getCreates(options: SyncQueryOptions) {
    const { userId, nowId, ack } = options;

    // album_asset arm — the album owner's own membership (unchanged).
    const albumAssetArm = this.db
      .selectFrom('album_asset')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
      .select('album_asset.updateId')
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where('album_asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('album_asset.updateId', '>', ack!.updateId))
      .where((eb) => spaceVisibilityGate(eb))
      // M-2: getCreates must not introduce a trashed owner-arm album asset a device didn't already have.
      .where('asset.deletedAt', 'is', null);

    // album_space_asset arm — cross-owner contributions (#764). Mechanical mirror keyed on updateId.
    const contributedArm = this.db
      .selectFrom('album_space_asset')
      .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_space_asset.albumId')
      .select(columns.syncAlbumAsset)
      .select((eb) => favoriteExistsFor(eb, userId).as('isFavorite'))
      .select('album_space_asset.updateId')
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_space_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where('album_space_asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('album_space_asset.updateId', '>', ack!.updateId))
      .where((eb) => spaceVisibilityGate(eb))
      // #764/§8.3: only members of the space this contribution was made via may receive it.
      .where((eb) => contributionVisibleToMember(eb, userId))
      // M-2: getCreates must not introduce a trashed contributed asset a device didn't already have.
      .where('asset.deletedAt', 'is', null);

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }
}

// Streams asset_exif rows for album-accessible assets via the
// shared_space_album_user grant, unioning the album owner's own album_asset exif
// with the cross-owner album_space_asset contributions (#764, gated per-space by
// contributionVisibleToMember). Clone of AlbumAssetExifSync with the album_user
// scoping swapped for the grant.
class SharedSpaceAlbumAssetExifSync extends BaseSync {
  @GenerateSql({ params: [dummyBackfillOptions, DummyValue.UUID, DummyValue.UUID], stream: true })
  getBackfill(options: SyncBackfillOptions, albumId: string, userId: string) {
    const { nowId, beforeUpdateId, afterUpdateId } = options;

    // album_asset arm — the album owner's own membership (unchanged).
    const albumAssetArm = this.db
      .selectFrom('album_asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'album_asset.assetId')
      .innerJoin('album', 'album.id', 'album_asset.albumId')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .select(columns.syncAssetExif)
      .select('album_asset.updateId')
      .where('album_asset.albumId', '=', albumId)
      .where('album.deletedAt', 'is', null)
      .where('album_asset.updateId', '<', nowId)
      .where('album_asset.updateId', '<=', beforeUpdateId)
      .$if(!!afterUpdateId, (qb) => qb.where('album_asset.updateId', '>', afterUpdateId!))
      .where((eb) => spaceVisibilityGate(eb))
      // M-2: never backfill a trashed owner-arm album asset to a space member either.
      .where('asset.deletedAt', 'is', null);

    // album_space_asset arm — cross-owner contributions (#764). Mechanical mirror keyed on updateId.
    const contributedArm = this.db
      .selectFrom('album_space_asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'album_space_asset.assetId')
      .innerJoin('album', 'album.id', 'album_space_asset.albumId')
      .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
      .select(columns.syncAssetExif)
      .select('album_space_asset.updateId')
      .where('album_space_asset.albumId', '=', albumId)
      .where('album.deletedAt', 'is', null)
      .where('album_space_asset.updateId', '<', nowId)
      .where('album_space_asset.updateId', '<=', beforeUpdateId)
      .$if(!!afterUpdateId, (qb) => qb.where('album_space_asset.updateId', '>', afterUpdateId!))
      .where((eb) => spaceVisibilityGate(eb))
      // #764/§8.3: only members of the space this contribution was made via may receive it.
      .where((eb) => contributionVisibleToMember(eb, userId))
      // M-2: never backfill a trashed contributed asset's metadata/thumbhash/EXIF to a space member.
      .where('asset.deletedAt', 'is', null);

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }

  @GenerateSql({ params: [dummyQueryOptions, { updateId: DummyValue.UUID }], stream: true })
  getUpdates(options: SyncQueryOptions, albumToAssetAck: SyncAck) {
    const { userId, nowId, ack } = options;

    // album_asset arm — the album owner's own membership (unchanged).
    const albumAssetArm = this.db
      .selectFrom('asset_exif')
      .innerJoin('album_asset', 'album_asset.assetId', 'asset_exif.assetId')
      .innerJoin('asset', 'asset.id', 'asset_exif.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_asset.albumId')
      .select(columns.syncAssetExif)
      .select('asset_exif.updateId')
      .where('asset_exif.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('asset_exif.updateId', '>', ack!.updateId))
      .where('album_asset.updateId', '<=', albumToAssetAck.updateId) // Ensure we only send exif updates for assets that the client already knows about
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where((eb) => spaceVisibilityGate(eb));

    // album_space_asset arm — cross-owner contributions (#764). Mechanical mirror keyed on updateId.
    const contributedArm = this.db
      .selectFrom('asset_exif')
      .innerJoin('album_space_asset', 'album_space_asset.assetId', 'asset_exif.assetId')
      .innerJoin('asset', 'asset.id', 'asset_exif.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_space_asset.albumId')
      .select(columns.syncAssetExif)
      .select('asset_exif.updateId')
      .where('asset_exif.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('asset_exif.updateId', '>', ack!.updateId))
      .where('album_space_asset.updateId', '<=', albumToAssetAck.updateId)
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_space_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where((eb) => spaceVisibilityGate(eb))
      // #764/§8.3: only members of the space this contribution was made via may receive it.
      .where((eb) => contributionVisibleToMember(eb, userId));

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }

  @GenerateSql({ params: [dummyQueryOptions], stream: true })
  getCreates(options: SyncQueryOptions) {
    const { userId, nowId, ack } = options;

    // album_asset arm — the album owner's own membership (unchanged).
    const albumAssetArm = this.db
      .selectFrom('album_asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'album_asset.assetId')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_asset.albumId')
      .select(columns.syncAssetExif)
      .select('album_asset.updateId')
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where('album_asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('album_asset.updateId', '>', ack!.updateId))
      .where((eb) => spaceVisibilityGate(eb))
      // M-2: getCreates must not introduce a trashed owner-arm album asset a device didn't already have.
      .where('asset.deletedAt', 'is', null);

    // album_space_asset arm — cross-owner contributions (#764). Mechanical mirror keyed on updateId.
    const contributedArm = this.db
      .selectFrom('album_space_asset')
      .innerJoin('asset_exif', 'asset_exif.assetId', 'album_space_asset.assetId')
      .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
      .innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_space_asset.albumId')
      .select(columns.syncAssetExif)
      .select('album_space_asset.updateId')
      .where('shared_space_album_user.userId', '=', userId)
      .where('album_space_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
      .where('album_space_asset.updateId', '<', nowId)
      .$if(!!ack, (qb) => qb.where('album_space_asset.updateId', '>', ack!.updateId))
      .where((eb) => spaceVisibilityGate(eb))
      // #764/§8.3: only members of the space this contribution was made via may receive it.
      .where((eb) => contributionVisibleToMember(eb, userId))
      // M-2: getCreates must not introduce a trashed contributed asset's EXIF a device didn't already have.
      .where('asset.deletedAt', 'is', null);

    return albumAssetArm.union(contributedArm).orderBy('updateId', 'asc').stream();
  }
}
