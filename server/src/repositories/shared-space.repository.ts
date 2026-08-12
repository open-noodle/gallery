import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, NotNull, sql, Transaction, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { ChunkedArray, ChunkedSet, DummyValue, GenerateSql } from 'src/decorators';
import {
  AlbumUserRole,
  AssetType,
  AssetVisibility,
  SharedSpaceActivityType,
  SharedSpaceRole,
  SourceType,
  VectorIndex,
} from 'src/enum';
import { probes } from 'src/repositories/database.repository';
import type { PeopleFaceStatistics } from 'src/repositories/person.repository';
import type { AssetSearchBuilderOptions } from 'src/repositories/search.repository';
import { DB } from 'src/schema';
import { SharedSpaceAlbumTable } from 'src/schema/tables/shared-space-album.table';
import { SharedSpaceAssetTable } from 'src/schema/tables/shared-space-asset.table';
import { SharedSpaceLibraryTable } from 'src/schema/tables/shared-space-library.table';
import { SharedSpaceMemberTable } from 'src/schema/tables/shared-space-member.table';
import { SharedSpacePersonAliasTable } from 'src/schema/tables/shared-space-person-alias.table';
import { SharedSpacePersonFaceTable } from 'src/schema/tables/shared-space-person-face.table';
import { SharedSpacePersonTable } from 'src/schema/tables/shared-space-person.table';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { anyUuid, retryOnDeadlock, searchAssetBuilderLegacy } from 'src/utils/database';
import { retargetVerdictSpacePersonId } from 'src/utils/face-verdict-merge';
import {
  spaceAlbumAssetExists,
  spaceAssetPathBranches,
  spaceContributedAssetExists,
  spaceVisibilityGate,
  spaceVisibleAssetVisibilities,
} from 'src/utils/shared-space-album-scope';

export const visibleSpaceAssetVisibilities = spaceVisibleAssetVisibilities;

type SpacePersonStatistics = {
  assets: number;
  faces: number;
};

export type LinkedSpacePerson = {
  id: string;
  isHidden: boolean;
  name?: string | null;
  birthDate?: string | null;
  updatedAt?: Date | string;
  type?: string;
};

export type SpacePersonPersonalThumbnail = {
  personId: string;
  thumbnailPath: string;
};

export type MetadataInheritanceCandidate = {
  personId: string;
  sourceProfileType?: 'user-person' | 'space-person';
  sourceProfileId?: string;
  userId: string;
  role: string;
  name: string;
  birthDate: Date | string | null;
  type: string;
  species: string | null;
  updatedAt: Date | string;
  supportingFaceCount: number;
  isAssetAdder: boolean;
};

export type SpacePersonIdentityEvidence = {
  identityId: string;
  type: string;
  supportingFaceCount: number;
};

type SpacePersonMatch = {
  personId: string;
  name: string;
  distance: number;
  identityId?: string | null;
  type?: string;
};

type SpacePersonWithEmbedding = {
  id: string;
  name: string;
  type: string;
  identityId?: string | null;
  isHidden: boolean;
  faceCount: number;
  representativeFaceId: string | null;
  representativeFaceSource?: string | null;
  embedding: string;
};

type AssetFaceForMatching = {
  id: string;
  assetId: string;
  personId: string | null;
  identityId?: string | null;
  type?: string | null;
  embedding: string | null;
};

type PetFaceForMatching = {
  id: string;
  assetId: string;
  personId: string | null;
  identityId?: string | null;
  type?: string;
};

export type SpaceFaceAssignment = {
  personId: string;
  identityId: string | null;
  type: string;
};

@Injectable()
export class SharedSpaceRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  getById(id: string) {
    return this.db.selectFrom('shared_space').selectAll().where('id', '=', id).executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getAllByUserId(userId: string) {
    return this.db
      .selectFrom('shared_space')
      .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space.id')
      .where('shared_space_member.userId', '=', userId)
      .selectAll('shared_space')
      .execute();
  }

  create(values: Insertable<SharedSpaceTable>) {
    return this.db.insertInto('shared_space').values(values).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, { name: 'Updated Space' }] })
  update(id: string, values: Updateable<SharedSpaceTable>) {
    return this.db
      .updateTable('shared_space')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async remove(id: string) {
    await this.db.deleteFrom('shared_space').where('id', '=', id).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getMembers(spaceId: string) {
    return this.db
      .selectFrom('shared_space_member')
      .innerJoin('user', (join) =>
        join.onRef('user.id', '=', 'shared_space_member.userId').on('user.deletedAt', 'is', null),
      )
      .where('shared_space_member.spaceId', '=', spaceId)
      .select([
        'shared_space_member.spaceId',
        'shared_space_member.userId',
        'shared_space_member.role',
        'shared_space_member.joinedAt',
        'shared_space_member.showInTimeline',
        'shared_space_member.sharePersonMetadata',
        'shared_space_member.lastViewedAt',
        'user.name',
        'user.email',
        'user.profileImagePath',
        'user.profileChangedAt',
        'user.avatarColor',
      ])
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getMember(spaceId: string, userId: string) {
    return this.db
      .selectFrom('shared_space_member')
      .innerJoin('user', (join) =>
        join.onRef('user.id', '=', 'shared_space_member.userId').on('user.deletedAt', 'is', null),
      )
      .where('shared_space_member.spaceId', '=', spaceId)
      .where('shared_space_member.userId', '=', userId)
      .select([
        'shared_space_member.spaceId',
        'shared_space_member.userId',
        'shared_space_member.role',
        'shared_space_member.joinedAt',
        'shared_space_member.showInTimeline',
        'shared_space_member.sharePersonMetadata',
        'shared_space_member.lastViewedAt',
        'user.name',
        'user.email',
        'user.profileImagePath',
        'user.profileChangedAt',
        'user.avatarColor',
      ])
      .executeTakeFirst();
  }

  /**
   * The actor's role in each of the given spaces, for spaces where they are a member (non-members are absent
   * from the map). Used by the merge propagation planner to decide whether a fan-out space collapse is one the
   * actor is allowed to perform. Accepts a transaction so the check reads consistently inside a merge.
   */
  async getActorSpaceRoles(
    userId: string,
    spaceIds: string[],
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<Map<string, string>> {
    if (spaceIds.length === 0) {
      return new Map();
    }

    const rows = await db
      .selectFrom('shared_space_member')
      .where('shared_space_member.userId', '=', userId)
      .where('shared_space_member.spaceId', 'in', spaceIds)
      .select(['shared_space_member.spaceId', 'shared_space_member.role'])
      .execute();

    return new Map(rows.map((row) => [row.spaceId, row.role]));
  }

  addMember(values: Insertable<SharedSpaceMemberTable>) {
    return this.db.insertInto('shared_space_member').values(values).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, { role: 'editor' }] })
  updateMember(spaceId: string, userId: string, values: Updateable<SharedSpaceMemberTable>) {
    return this.db
      .updateTable('shared_space_member')
      .set(values)
      .where('spaceId', '=', spaceId)
      .where('userId', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // L7: accepts an optional trx so removeMember (service) can thread it through one
  // transaction shared with removeOwnedAlbumLinksAddedBy. Mirrors recountPersons's db param.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async removeMember(spaceId: string, userId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    await db.deleteFrom('shared_space_member').where('spaceId', '=', spaceId).where('userId', '=', userId).execute();
  }

  /**
   * Cross-owner contribution eligibility (#764). For each of `assetIds`, returns the space it may be
   * contributed to `albumId` through — i.e. a space `S` such that: the album is linked to `S`, the
   * caller is an Owner/Editor of `S`, and the asset is space-visible to the caller via `S` (direct
   * pool ∪ linked library ∪ another linked album) under the visibility gate (no Hidden/Locked). Only
   * NON-owned assets are eligible (the caller's own photos take the ordinary `album_asset` path). One
   * row per eligible asset (the tether space); assets with no eligible space are simply absent.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, [DummyValue.UUID]] })
  @ChunkedArray({ paramIndex: 2 })
  async getContributableAssetSpaces(
    userId: string,
    albumId: string,
    assetIds: string[],
  ): Promise<{ assetId: string; spaceId: string }[]> {
    if (assetIds.length === 0) {
      return [];
    }

    return this.db
      .selectFrom('shared_space_album as link')
      .innerJoin('shared_space_member as m', (join) =>
        join
          .onRef('m.spaceId', '=', 'link.spaceId')
          .on('m.userId', '=', userId)
          .on('m.role', 'in', [SharedSpaceRole.Owner, SharedSpaceRole.Editor]),
      )
      .innerJoin(
        'asset',
        (join) =>
          join
            .on('asset.id', 'in', assetIds)
            .on('asset.deletedAt', 'is', null)
            .on('asset.ownerId', '!=', userId) // owned assets take the ordinary album_asset path
            .on('asset.visibility', 'in', spaceVisibleAssetVisibilities), // gate out Hidden/Locked
      )
      .where('link.albumId', '=', albumId)
      .where((eb) =>
        eb.or([
          // Directly shared into the space's pool.
          eb.exists(
            eb
              .selectFrom('shared_space_asset as sd')
              .select(sql`1`.as('x'))
              .whereRef('sd.spaceId', '=', 'link.spaceId')
              .whereRef('sd.assetId', '=', 'asset.id'),
          ),
          // In a library linked to the space.
          eb.exists(
            eb
              .selectFrom('shared_space_library as sl')
              .select(sql`1`.as('x'))
              .whereRef('sl.spaceId', '=', 'link.spaceId')
              .whereRef('sl.libraryId', '=', 'asset.libraryId')
              .where('asset.isOffline', '=', false),
          ),
          // Already in another (non-deleted) album linked to the space.
          eb.exists(
            eb
              .selectFrom('shared_space_album as sa2')
              .innerJoin('album_asset as aa2', 'aa2.albumId', 'sa2.albumId')
              .innerJoin('album as al2', (j2) => j2.onRef('al2.id', '=', 'sa2.albumId').on('al2.deletedAt', 'is', null))
              .select(sql`1`.as('x'))
              .whereRef('sa2.spaceId', '=', 'link.spaceId')
              .whereRef('aa2.assetId', '=', 'asset.id'),
          ),
        ]),
      )
      .select(['asset.id as assetId', 'link.spaceId as spaceId'])
      .distinctOn('asset.id')
      .orderBy('asset.id')
      .execute();
  }

  // #752 P0-2: spaces that CURRENTLY link `albumId` and have `userId` as a live member — the
  // member-gate for contributed content on album read surfaces (time buckets, covers, metadata).
  // Live-link + live-membership by construction; A1 (album not soft-deleted) enforced here so a
  // trashed album's retained contributions resolve to no spaces. NOT preference-filtered — unlike
  // getSpaceIdsForTimeline, a member who hid the space from their home timeline still sees the
  // album's contributions on the album page itself.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getMemberSpaceIdsLinkingAlbum(albumId: string, userId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('shared_space_album')
      .innerJoin('album', (join) =>
        join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
      )
      .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
      .where('shared_space_album.albumId', '=', albumId)
      .where('shared_space_member.userId', '=', userId)
      .select('shared_space_album.spaceId')
      .execute();
    return rows.map((row) => row.spaceId);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getSpaceIdsForTimeline(userId: string) {
    return this.db
      .selectFrom('shared_space_member')
      .where('userId', '=', userId)
      .where('showInTimeline', '=', true)
      .select('spaceId')
      .execute();
  }

  @GenerateSql({ params: [] })
  async getSpaceIdsWithFaceRecognitionEnabled(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('shared_space')
      .select('id')
      .where('faceRecognitionEnabled', '=', true)
      .execute();
    return rows.map((r) => r.id);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getAssetCount(spaceId: string): Promise<number> {
    const result = await this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
          .select('asset.id')
          .where('shared_space_asset.spaceId', '=', spaceId)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .select('asset.id')
              .where('shared_space_library.spaceId', '=', spaceId)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .union(
            this.db
              .selectFrom('shared_space_album')
              .innerJoin('album', (join) =>
                join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .innerJoin('asset', 'asset.id', 'album_asset.assetId')
              .select('asset.id')
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('shared_space_album.showInTimeline', '=', true)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .union(
            this.db
              .selectFrom('asset')
              .select('asset.id')
              // Cross-owner contributions (#764) live in album_space_asset, not album_asset. Every
              // read/timeline surface unions them via the scope helper, so this surface must too.
              .where((eb) =>
                spaceContributedAssetExists(eb, {
                  correlateAssetId: 'asset.id',
                  scope: { spaceId },
                  requireShowInTimeline: true,
                }),
              )
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .as('combined'),
      )
      .select((eb) => eb.fn.countAll().as('count'))
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }

  async bulkAddUserAssets(spaceId: string, userId: string): Promise<number> {
    const result = await this.db
      .insertInto('shared_space_asset')
      .columns(['spaceId', 'assetId', 'addedById'])
      .expression(
        this.db
          .selectFrom('asset')
          .select([sql.lit(spaceId).as('spaceId'), 'asset.id as assetId', sql.lit(userId).as('addedById')])
          .where('asset.ownerId', '=', userId)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
      )
      .onConflict((oc) => oc.doNothing())
      .executeTakeFirst();
    return Number(result?.numInsertedOrUpdatedRows ?? 0);
  }

  @ChunkedArray()
  addAssets(values: Insertable<SharedSpaceAssetTable>[]) {
    if (values.length === 0) {
      return Promise.resolve([]);
    }

    return this.db
      .insertInto('shared_space_asset')
      .values(values)
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .execute();
  }

  /**
   * Returns the set of space IDs that contain ANY of the given asset IDs
   * via direct membership (`shared_space_asset`) AND in which the user has
   * Owner or Editor role.
   *
   * Library-linked content (`shared_space_library`) is deliberately excluded
   * — only direct per-asset membership counts. See dedup-space-sync design
   * doc for rationale.
   *
   * Returns `Set<string>` (not `Map<assetId, spaceIds[]>` as
   * `albumRepository.getByAssetIds` does) because the dedup sync caller
   * applies every matched space to every keeper, so the per-asset grouping
   * is unused.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async getEditableByAssetIds(userId: string, assetIds: Set<string>): Promise<Set<string>> {
    if (assetIds.size === 0) {
      return new Set();
    }

    const rows = await this.db
      .selectFrom('shared_space_asset')
      .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
      .select('shared_space_asset.spaceId')
      .where('shared_space_asset.assetId', 'in', [...assetIds])
      .where('shared_space_member.userId', '=', userId)
      .where('shared_space_member.role', 'in', [SharedSpaceRole.Owner, SharedSpaceRole.Editor])
      .distinct()
      .execute();

    return new Set(rows.map((row) => row.spaceId));
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async removeAssets(spaceId: string, assetIds: string[]): Promise<string[]> {
    if (assetIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', spaceId)
      .where('assetId', 'in', assetIds)
      .returning('assetId')
      .execute();
    return rows.map((r) => r.assetId);
  }

  // The subset of assetIds that are DIRECT members of the space (shared_space_asset rows). Used by
  // removeAssets to bound stack-atomic expansion to direct selections, so an album-projected asset
  // can never drag a directly-added stack sibling out of the space (S5).
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async getDirectAssetIds(spaceId: string, assetIds: string[]): Promise<string[]> {
    if (assetIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .selectFrom('shared_space_asset')
      .select('assetId')
      .where('spaceId', '=', spaceId)
      .where('assetId', 'in', assetIds)
      .execute();
    return rows.map((r) => r.assetId);
  }

  /**
   * The linked albums (id + name) in this space that project any of the given assets into the space —
   * via the global `album_asset` arm OR the cross-owner `album_space_asset` contribution arm. Used to
   * explain why "Remove from space" is a no-op on an album-projected asset: it is present via a linked
   * album, not as a direct space member, so the user must remove it from that album instead.
   */
  async getLinkedAlbumsContainingAssets(
    spaceId: string,
    assetIds: string[],
  ): Promise<{ albumId: string; albumName: string }[]> {
    if (assetIds.length === 0) {
      return [];
    }
    return this.db
      .selectFrom('shared_space_album')
      .innerJoin('album', 'album.id', 'shared_space_album.albumId')
      .where('shared_space_album.spaceId', '=', spaceId)
      .where('album.deletedAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('album_asset')
              .select('album_asset.assetId')
              .whereRef('album_asset.albumId', '=', 'album.id')
              .where('album_asset.assetId', 'in', assetIds),
          ),
          eb.exists(
            eb
              .selectFrom('album_space_asset')
              .select('album_space_asset.assetId')
              .whereRef('album_space_asset.albumId', '=', 'album.id')
              .where('album_space_asset.spaceId', '=', spaceId)
              .where('album_space_asset.assetId', 'in', assetIds),
          ),
        ]),
      )
      .select(['album.id as albumId', 'album.albumName as albumName'])
      .distinct()
      .orderBy('album.albumName', 'asc')
      .execute();
  }

  /**
   * Current names for the given album ids (live albums only). Used to resolve the CURRENT album name
   * for link/unlink activities, so an album created-then-renamed isn't stuck showing the empty or stale
   * name captured at link time.
   */
  async getAlbumNamesByIds(albumIds: string[]): Promise<{ id: string; albumName: string }[]> {
    if (albumIds.length === 0) {
      return [];
    }
    return this.db
      .selectFrom('album')
      .select(['album.id as id', 'album.albumName as albumName'])
      .where('album.id', 'in', albumIds)
      .where('album.deletedAt', 'is', null)
      .execute();
  }

  /**
   * Slice 4.B DIRECT-path purge: when the owner flips one of these assets OUT of
   * the space-shareable visibility set (Timeline/Archive) to Hidden or Locked,
   * the `shared_space_asset` join row is NOT deleted, so the delete-audit trigger
   * never fires and already-synced member devices keep the bytes. Emit a
   * `shared_space_asset_audit` tombstone for every join row referencing the given
   * assets so `SharedSpaceToAssetSync.getDeletes` purges those devices.
   *
   * `shared_space_asset_audit` is space-only (NOT shared with normal album sync),
   * so writing to it here does not bleed into non-space behavior. `id` and
   * `deletedAt` are DB-generated (immich_uuid_v7 / clock_timestamp), giving every
   * tombstone a fresh id > any prior checkpoint.
   */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  async emitDirectAssetVisibilityPurge(assetIds: string[]) {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .insertInto('shared_space_asset_audit')
      .columns(['spaceId', 'assetId'])
      .expression(
        this.db
          .selectFrom('shared_space_asset')
          .select(['shared_space_asset.spaceId', 'shared_space_asset.assetId'])
          .where('shared_space_asset.assetId', 'in', assetIds),
      )
      .execute();
  }

  /**
   * Slice 4.B DIRECT-path restore: when the owner flips one of these assets back
   * INTO the space-shareable set (Timeline/Archive), the join row already exists
   * but its `updateId` is unchanged, so `SharedSpaceToAssetSync.getUpserts` (gated
   * by `updateId` > checkpoint) won't re-add it to devices that purged it. Touch
   * the referencing rows so the `updated_at` BEFORE-UPDATE trigger bumps
   * `updateId = immich_uuid_v7(clock_timestamp())` and getUpserts re-emits.
   *
   * Over-emitting a restore for an already-visible asset is harmless (the device
   * simply re-upserts a join row it already has).
   */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  async emitDirectAssetVisibilityRestore(assetIds: string[]) {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .updateTable('shared_space_asset')
      .set({ updatedAt: sql`clock_timestamp()` })
      .where('assetId', 'in', assetIds)
      .execute();
  }

  // D1 (#752 P0-1): synthetic unlink tombstones. Contributions are RETAINED across unlink
  // (re-link reversibility, pinned by album-space-asset-permissions.service.spec) — but a device
  // that synced the edge must still purge it, and the ONLY tombstone producer is the AFTER-DELETE
  // trigger, which never fires for retained rows. Insert audit rows directly: an audit row means
  // "revoke this edge on devices", NOT "the row was deleted". getDeletes scopes delivery by
  // accessibleSpaceAlbums; members without album access get nothing, extra deliveries are
  // idempotent client deletes.
  private async tombstoneContributionsForUnlink(
    db: Kysely<DB> | Transaction<DB>,
    spaceId: string,
    albumIds: string[],
  ): Promise<void> {
    if (albumIds.length === 0) {
      return;
    }
    await db
      .insertInto('album_space_asset_audit')
      .columns(['albumId', 'assetId'])
      .expression(
        db
          .selectFrom('album_space_asset')
          .select(['album_space_asset.albumId', 'album_space_asset.assetId'])
          .where('album_space_asset.spaceId', '=', spaceId)
          .where('album_space_asset.albumId', 'in', albumIds),
      )
      .execute();
  }

  /**
   * Slice 1 ALBUM-path purge: when the owner flips an album-linked asset to
   * Hidden, the album_asset join row is retained (unlike Locked), so no
   * album_asset_audit trigger fires. Emit one shared_space_album_asset_audit
   * tombstone per (albumId, assetId) where the album is space-linked, so
   * SharedSpaceAlbumToAssetSync.getDeletes delivers the delete to members.
   * Only space-linked albums are targeted — normal album members are unaffected.
   */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  async emitAlbumAssetVisibilityPurge(assetIds: string[]) {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .insertInto('shared_space_album_asset_audit')
      .columns(['albumId', 'assetId'])
      .expression(
        this.db
          .selectFrom('album_asset')
          .select(['album_asset.albumId', 'album_asset.assetId'])
          .where('album_asset.assetId', 'in', assetIds)
          .where('album_asset.albumId', 'in', (eb) =>
            eb.selectFrom('shared_space_album').select('shared_space_album.albumId'),
          ),
      )
      .execute();

    // #764: contributions live in album_space_asset (not album_asset); tombstone the contributed
    // (albumId, assetId) pairs too so SharedSpaceAlbumToAssetSync.getDeletes drops a now-Hidden
    // contribution on member devices. Unlike the album_asset arm above there is NO space-link filter
    // here — album_space_asset has no FK to shared_space_album, so we cannot (and need not) restrict to
    // linked albums at write time. The safety is applied at READ time: getDeletes scopes these
    // tombstones by accessibleSpaceAlbums, so only a member who can see the album ever receives the delete.
    await this.db
      .insertInto('album_space_asset_audit')
      .columns(['albumId', 'assetId'])
      .expression(
        this.db
          .selectFrom('album_space_asset')
          .select(['album_space_asset.albumId', 'album_space_asset.assetId'])
          .where('album_space_asset.assetId', 'in', assetIds),
      )
      .execute();
  }

  /**
   * Slice 1 ALBUM-path restore: when the owner flips a Hidden album-linked
   * asset back to Timeline/Archive, the album_asset row was retained. Touch
   * the rows so the updated_at BEFORE-UPDATE trigger bumps album_asset.updateId
   * and SharedSpaceAlbumToAssetSync.getUpserts re-emits the membership to devices
   * that purged it. Only space-linked albums are targeted. Re-emitting to normal
   * album members is idempotent.
   *
   * Note: after Locked, album_asset rows were deleted by removeAssetsFromAll, so
   * this method finds nothing to bump and the asset does not return to the album —
   * matching Immich Locked semantics (see A8).
   */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  async emitAlbumAssetVisibilityRestore(assetIds: string[]) {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .updateTable('album_asset')
      .set({ updatedAt: sql`clock_timestamp()` })
      .where('assetId', 'in', assetIds)
      .where('albumId', 'in', (eb) => eb.selectFrom('shared_space_album').select('shared_space_album.albumId'))
      .execute();

    // #764: bump contributed rows too so getUpserts re-emits an un-hidden contribution to devices
    // that purged it. The album_space_asset_updatedAt BEFORE-UPDATE trigger regenerates updateId.
    // Unlike the album_asset arm above this has no space-link filter (a harmless over-bump — getUpserts
    // re-gates by grant + visibility, and now also per-space via contributionVisibleToMember).
    await this.db
      .updateTable('album_space_asset')
      .set({ updatedAt: sql`clock_timestamp()` })
      .where('assetId', 'in', assetIds)
      .execute();
  }

  /**
   * Slice 2 LIBRARY-path purge: when the owner flips a library-linked space asset
   * to Hidden or Locked, write a tombstone per (libraryId, assetId) in
   * shared_space_library_asset_audit for each asset that belongs to a space-linked
   * library. LibraryAssetSync.getDeletes unions this table (owner-gated) so member
   * devices drop the asset. The owner is never purged — the union arm filters
   * asset.ownerId != userId. The ASSET ROW's restore is automatic (the visibility
   * UPDATE bumps asset.updateId; LibraryAssetSync.getUpserts re-emits the
   * now-visible asset) — but its EXIF is NOT (see emitLibraryAssetVisibilityRestore
   * below). Only space-linked libraries are targeted — the library owner's own
   * sync stream and any non-space library member are unaffected.
   */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  async emitLibraryAssetVisibilityPurge(assetIds: string[]) {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .insertInto('shared_space_library_asset_audit')
      .columns(['libraryId', 'assetId'])
      .expression(
        this.db
          .selectFrom('asset')
          .select(['asset.libraryId as libraryId', 'asset.id as assetId'])
          .where('asset.id', 'in', assetIds)
          .where('asset.libraryId', 'is not', null)
          .where('asset.libraryId', 'in', (eb) =>
            eb.selectFrom('shared_space_library').select('shared_space_library.libraryId'),
          ),
      )
      .$narrowType<{ libraryId: string }>()
      .execute();
  }

  /**
   * L4 LIBRARY-path EXIF restore: when the owner flips a library-linked space
   * asset back to Timeline/Archive, the asset ROW re-upserts automatically (its
   * own updateId is bumped by the visibility UPDATE), but asset_exif.updateId is
   * untouched by a visibility flip. LibraryAssetExifSync.getUpserts is gated on
   * `asset_exif.updateId > ack`, so without this, a member who already
   * synced-then-purged the asset would see the asset row reappear with EXIF
   * missing forever. Touch asset_exif.updatedAt (mirrors
   * emitDirectAssetVisibilityRestore / emitAlbumAssetVisibilityRestore) for every
   * restored asset that belongs to a space-linked library so the updated_at
   * BEFORE-UPDATE trigger bumps updateId and getUpserts re-emits.
   *
   * Over-emitting for an already-visible asset is harmless (the device simply
   * re-upserts an exif row it already has).
   */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  async emitLibraryAssetVisibilityRestore(assetIds: string[]) {
    if (assetIds.length === 0) {
      return;
    }

    await this.db
      .updateTable('asset_exif')
      .set({ updatedAt: sql`clock_timestamp()` })
      .where('assetId', 'in', assetIds)
      .where('assetId', 'in', (eb) =>
        eb
          .selectFrom('asset')
          .select('asset.id')
          .where('asset.libraryId', 'is not', null)
          .where('asset.libraryId', 'in', (eb2) =>
            eb2.selectFrom('shared_space_library').select('shared_space_library.libraryId'),
          ),
      )
      .execute();
  }

  // ==========================================
  // Shared Space Library Link CRUD
  // ==========================================

  addLibrary(values: Insertable<SharedSpaceLibraryTable>) {
    return this.db
      .insertInto('shared_space_library')
      .values(values)
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  removeLibrary(spaceId: string, libraryId: string) {
    return this.db
      .deleteFrom('shared_space_library')
      .where('spaceId', '=', spaceId)
      .where('libraryId', '=', libraryId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getLinkedLibraries(spaceId: string) {
    return this.db.selectFrom('shared_space_library').selectAll().where('spaceId', '=', spaceId).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getSpacesLinkedToLibrary(libraryId: string) {
    return this.db
      .selectFrom('shared_space_library')
      .innerJoin('shared_space', 'shared_space.id', 'shared_space_library.spaceId')
      .selectAll('shared_space_library')
      .select('shared_space.faceRecognitionEnabled')
      .where('shared_space_library.libraryId', '=', libraryId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  hasLibraryLink(spaceId: string, libraryId: string) {
    return this.db
      .selectFrom('shared_space_library')
      .where('spaceId', '=', spaceId)
      .where('libraryId', '=', libraryId)
      .select('spaceId')
      .executeTakeFirst()
      .then((row) => !!row);
  }

  // ==========================================
  // Shared Space Album Link CRUD
  // ==========================================

  addAlbum(values: Insertable<SharedSpaceAlbumTable>) {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('shared_space_album')
        .values(values)
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .executeTakeFirst();
      if (inserted) {
        // D1 (#752 P0-1): re-link re-delivery — touch retained contributions so the
        // album_space_asset_updatedAt trigger bumps updateId and getUpserts re-emits them to
        // devices that purged on the unlink tombstone. No-op on a first-time link.
        await trx
          .updateTable('album_space_asset')
          .set({ updatedAt: sql`clock_timestamp()` })
          .where('spaceId', '=', values.spaceId)
          .where('albumId', '=', values.albumId)
          .execute();
      }
      return inserted;
    });
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async removeAlbum(spaceId: string, albumId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.tombstoneContributionsForUnlink(trx, spaceId, [albumId]);
      await trx
        .deleteFrom('shared_space_album')
        .where('spaceId', '=', spaceId)
        .where('albumId', '=', albumId)
        .execute();
    });
  }

  // albums-6: on member removal/leave, unlink the shared_space_album rows the
  // departing user ADDED and OWNS (album_user role='owner'). Remaining members lose
  // access to the ex-member's album (its future assets too). Rows the member added
  // for albums they do NOT own are left untouched. Deleting the rows fires
  // shared_space_album_delete_audit (link tombstone + gated grant revocation for
  // remaining members). Returns the album ids actually unlinked.
  // M9: deliberately does NOT filter `album.deletedAt IS NULL` — a link to the
  // departing member's own TRASHED album must also be removed on departure. The
  // soft-delete trigger already tombstoned that album's grants but leaves the
  // shared_space_album link row in place; without this, a later restore re-creates
  // grants for S's current members, re-sharing an album the owner had already left
  // the space with. Deleting a trashed album's link is safe either way — grants are
  // already revoked and the delete-audit tombstone is idempotent.
  // L7: accepts an optional trx so removeMember (service) can thread it through one
  // transaction shared with the membership-row delete — atomic member removal.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async removeOwnedAlbumLinksAddedBy(
    spaceId: string,
    userId: string,
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<string[]> {
    const deleted = await db
      .deleteFrom('shared_space_album')
      .where('shared_space_album.spaceId', '=', spaceId)
      .where('shared_space_album.addedById', '=', userId)
      .where('shared_space_album.albumId', 'in', (eb) =>
        eb
          .selectFrom('album_user')
          .select('album_user.albumId')
          .where('album_user.userId', '=', userId)
          .where('album_user.role', '=', AlbumUserRole.Owner),
      )
      .returning('shared_space_album.albumId')
      .execute();

    // D1 (#752 P0-1): member-departure link removal has the identical revocation gap as unlinkAlbum.
    await this.tombstoneContributionsForUnlink(
      db,
      spaceId,
      deleted.map((row) => row.albumId),
    );

    return deleted.map((row) => row.albumId);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getLinkedAlbumCount(spaceId: string): Promise<number> {
    const result = await this.db
      .selectFrom('shared_space_album')
      .innerJoin('album', 'album.id', 'shared_space_album.albumId')
      .where('shared_space_album.spaceId', '=', spaceId)
      .where('album.deletedAt', 'is', null)
      .select((eb) => eb.fn.countAll().$castTo<number>().as('count'))
      .executeTakeFirst();
    return result?.count ?? 0;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getLinkedAlbums(spaceId: string) {
    return (
      this.db
        .selectFrom('shared_space_album')
        .innerJoin('album', 'album.id', 'shared_space_album.albumId')
        .selectAll('album')
        .select([
          'shared_space_album.addedById',
          'shared_space_album.showInTimeline',
          'shared_space_album.createdAt as linkedAt',
        ])
        .select((eb) =>
          eb
            .selectFrom('album_user')
            .whereRef('album_user.albumId', '=', 'album.id')
            .where('album_user.role', '=', AlbumUserRole.Owner)
            .select('album_user.userId')
            .limit(1)
            .as('ownerId'),
        )
        // L17: the raw `album.albumThumbnailAssetId` (already selected via `selectAll('album')`
        // above) can point at an asset that isn't space-visible (Hidden/Locked, or since
        // soft-deleted) — a member's gated thumbnail request for it 403s and the web renders a
        // broken cover tile. This later `albumThumbnailAssetId` alias appears after `album.*` in
        // the column list, so it wins on the duplicate name: COALESCE (1) the current thumbnail
        // only if it's still a live, space-visible asset, else (2) the newest space-visible asset
        // still in the album, else (3) null (web renders NoCover).
        .select((eb) =>
          eb.fn
            .coalesce(
              eb
                .selectFrom('asset')
                .select('asset.id')
                .whereRef('asset.id', '=', 'album.albumThumbnailAssetId')
                .where('asset.deletedAt', 'is', null)
                .where((eb2) => spaceVisibilityGate(eb2)),
              eb
                .selectFrom('album_asset')
                .innerJoin('asset', 'asset.id', 'album_asset.assetId')
                .select('asset.id')
                .whereRef('album_asset.albumId', '=', 'album.id')
                .where('asset.deletedAt', 'is', null)
                .where((eb2) => spaceVisibilityGate(eb2))
                .orderBy('asset.fileCreatedAt', 'desc')
                .orderBy('asset.id', 'asc')
                .limit(1),
            )
            .as('albumThumbnailAssetId'),
        )
        .where('shared_space_album.spaceId', '=', spaceId)
        .where('album.deletedAt', 'is', null)
        .orderBy('album.createdAt', 'desc')
        .orderBy('album.id', 'asc')
        .execute()
    );
  }

  // correctness-4 support: album ids currently linked to a space (captured before a
  // member removal / space deletion so the reconcile job can target them post-commit).
  @GenerateSql({ params: [DummyValue.UUID] })
  async getLinkedAlbumIds(spaceId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('shared_space_album')
      .select('albumId')
      .where('spaceId', '=', spaceId)
      .execute();
    return rows.map((row) => row.albumId);
  }

  // correctness-4 / M7: bidirectional sweep of the grants of the given albums — self-heals
  // missing grants AND tombstones stranded ones. Runs POST-COMMIT (its own statement/txn), so
  // the READ COMMITTED snapshot race in both the create-side and delete-side triggers is
  // resolved — it sees fully committed state.
  //
  // Step 1 (M7 — grant-side self-heal): the create-side triggers (shared_space_album_after_insert_user
  // / shared_space_member_after_insert_album) each fan out from ONE just-inserted row using a
  // statement-time snapshot, so a member-join and an album-link landing in two overlapping
  // transactions can each miss the other's row and neither ever grants the (member, album) pair
  // (see the (doc) test in shared-space-album-create-triggers.spec.ts). This INSERT re-derives
  // every (userId, albumId) pair that currently has a live path (member of the album's space,
  // album not soft-deleted) and is missing its grant row. ON CONFLICT DO NOTHING makes it a
  // no-op for pairs that already have a grant.
  //
  // Step 2 (tombstone sweep, pre-existing): inserting into shared_space_album_user_audit fires
  // shared_space_album_user_delete_after_audit (deletes the grant) + SharedSpaceAlbumSync.getDeletes
  // (device tombstone). The nil sentinel excludes no real space → "does the user have ANY live
  // path?"; a grant with a live path is skipped (no over-revocation), an already-revoked grant
  // has no row to sweep. Returns the number of grants tombstoned (Step 1 never over-counts here:
  // a pair Step 1 just inserted, by construction, HAS a live path, so Step 2 always skips it).
  @GenerateSql({ params: [[DummyValue.UUID]] })
  async reconcileAlbumGrants(albumIds: string[]): Promise<number> {
    if (albumIds.length === 0) {
      return 0;
    }

    await this.db
      .insertInto('shared_space_album_user')
      .columns(['userId', 'albumId'])
      .expression((eb) =>
        eb
          .selectFrom('shared_space_album')
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
          .innerJoin('album', 'album.id', 'shared_space_album.albumId')
          .select(['shared_space_member.userId', 'shared_space_album.albumId'])
          .where('shared_space_album.albumId', 'in', albumIds)
          .where('album.deletedAt', 'is', null),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();

    const inserted = await this.db
      .insertInto('shared_space_album_user_audit')
      .columns(['albumId', 'userId'])
      .expression((eb) =>
        eb
          .selectFrom('shared_space_album_user')
          .select(['shared_space_album_user.albumId', 'shared_space_album_user.userId'])
          .where('shared_space_album_user.albumId', 'in', albumIds)
          .where(
            sql<boolean>`NOT user_has_album_path("shared_space_album_user"."albumId", "shared_space_album_user"."userId", '00000000-0000-0000-0000-000000000000'::uuid)`,
          ),
      )
      .returning('albumId')
      .execute();
    return inserted.length;
  }

  // L8: every album id with at least one live grant row — the nightly sweep's target set for
  // reconcileAlbumGrants, making the self-heal/tombstone mechanism path-independent (a backstop
  // for M6 durability, L7 residue, and cascade-deletion strands that never enqueued a reconcile).
  @GenerateSql({ params: [] })
  async getAllGrantedAlbumIds(): Promise<string[]> {
    const rows = await this.db.selectFrom('shared_space_album_user').select('albumId').distinct().execute();
    return rows.map((row) => row.albumId);
  }

  async getFaceRecognitionEnabledSpaceIds(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('shared_space')
      .select('id')
      .where('faceRecognitionEnabled', '=', true)
      .execute();
    return rows.map((row) => row.id);
  }

  // Album sync fan-out: used by the AlbumAssetsAdd/Remove handlers to find every space
  // a linked album feeds, with its face-recognition flag. Mirrors getSpacesLinkedToLibrary.
  @GenerateSql({ params: [DummyValue.UUID] })
  getSpacesLinkedToAlbum(albumId: string) {
    return this.db
      .selectFrom('shared_space_album')
      .innerJoin('shared_space', 'shared_space.id', 'shared_space_album.spaceId')
      .selectAll('shared_space_album')
      .select('shared_space.faceRecognitionEnabled')
      .where('shared_space_album.albumId', '=', albumId)
      .execute();
  }

  // rbac-6: the album owner's view of every space this album is linked into, so they can
  // review + revoke links. Intentionally NOT decorated with @GenerateSql — decorating it would
  // require a `make sql` regen against a scratch migrated DB, which is out of scope for this slice.
  getAlbumSpaceLinks(albumId: string) {
    return this.db
      .selectFrom('shared_space_album')
      .innerJoin('shared_space', 'shared_space.id', 'shared_space_album.spaceId')
      .select([
        'shared_space_album.spaceId as spaceId',
        'shared_space.name as spaceName',
        'shared_space_album.addedById as linkedById',
        'shared_space_album.showInTimeline as showInTimeline',
      ])
      .where('shared_space_album.albumId', '=', albumId)
      .orderBy('shared_space.name', 'asc')
      .orderBy('shared_space_album.spaceId', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  hasAlbumLink(spaceId: string, albumId: string) {
    return this.db
      .selectFrom('shared_space_album')
      .where('spaceId', '=', spaceId)
      .where('albumId', '=', albumId)
      .select('spaceId')
      .executeTakeFirst()
      .then((row) => !!row);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, true] })
  setAlbumShowInTimeline(spaceId: string, albumId: string, showInTimeline: boolean) {
    return this.db
      .updateTable('shared_space_album')
      .set({ showInTimeline })
      .where('spaceId', '=', spaceId)
      .where('albumId', '=', albumId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getAlbumAssetCount(albumId: string): Promise<number> {
    const row = await this.db
      .selectFrom('album_asset')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('album_asset.albumId', '=', albumId)
      .where('asset.deletedAt', 'is', null)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  @GenerateSql({ params: [DummyValue.UUID, 4] })
  getRecentAssets(spaceId: string, limit = 4) {
    return this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
          .select(['asset.id', 'asset.thumbhash', 'asset.fileCreatedAt'])
          .where('shared_space_asset.spaceId', '=', spaceId)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.type', '=', AssetType.Image)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
          .where('asset.thumbhash', 'is not', null)
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .select(['asset.id', 'asset.thumbhash', 'asset.fileCreatedAt'])
              .where('shared_space_library.spaceId', '=', spaceId)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.type', '=', AssetType.Image)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
              .where('asset.thumbhash', 'is not', null),
          )
          .union(
            this.db
              .selectFrom('shared_space_album')
              .innerJoin('album', (j) =>
                j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .innerJoin('asset', 'asset.id', 'album_asset.assetId')
              .select(['asset.id', 'asset.thumbhash', 'asset.fileCreatedAt'])
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('shared_space_album.showInTimeline', '=', true)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.type', '=', AssetType.Image)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
              .where('asset.thumbhash', 'is not', null),
          )
          .union(
            this.db
              .selectFrom('asset')
              .select(['asset.id', 'asset.thumbhash', 'asset.fileCreatedAt'])
              // Cross-owner contributions (#764) live in album_space_asset, not album_asset. Every
              // read/timeline surface unions them via the scope helper, so this surface must too.
              .where((eb) =>
                spaceContributedAssetExists(eb, {
                  correlateAssetId: 'asset.id',
                  scope: { spaceId },
                  requireShowInTimeline: true,
                }),
              )
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.type', '=', AssetType.Image)
              .where('asset.thumbhash', 'is not', null)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .as('combined'),
      )
      .select(['combined.id', 'combined.thumbhash'])
      .orderBy('combined.fileCreatedAt', 'desc')
      .limit(limit)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getLastAssetAddedAt(spaceId: string): Promise<Date | undefined> {
    const result = await this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
          .select('shared_space_asset.addedAt as ts')
          .where('shared_space_asset.spaceId', '=', spaceId)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .select('asset.createdAt as ts')
              .where('shared_space_library.spaceId', '=', spaceId)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .union(
            this.db
              .selectFrom('shared_space_album')
              .innerJoin('album', (j) =>
                j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .innerJoin('asset', 'asset.id', 'album_asset.assetId')
              .select('asset.createdAt as ts')
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('shared_space_album.showInTimeline', '=', true)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .union(
            this.db
              .selectFrom('asset')
              .select('asset.createdAt as ts')
              // Cross-owner contributions (#764) live in album_space_asset, not album_asset. Every
              // read/timeline surface unions them via the scope helper, so this surface must too.
              .where((eb) =>
                spaceContributedAssetExists(eb, {
                  correlateAssetId: 'asset.id',
                  scope: { spaceId },
                  requireShowInTimeline: true,
                }),
              )
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .as('combined'),
      )
      .select((eb) => eb.fn.max('combined.ts').as('lastAddedAt'))
      .executeTakeFirst();
    return result?.lastAddedAt ?? undefined;
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.DATE] })
  async getNewAssetCount(spaceId: string, since: Date): Promise<number> {
    const result = await this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
          .select('asset.id')
          .where('shared_space_asset.spaceId', '=', spaceId)
          .where('shared_space_asset.addedAt', '>', since)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .select('asset.id')
              .where('shared_space_library.spaceId', '=', spaceId)
              .where('asset.createdAt', '>', since)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .union(
            this.db
              .selectFrom('shared_space_album')
              .innerJoin('album', (j) =>
                j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .innerJoin('asset', 'asset.id', 'album_asset.assetId')
              .select('asset.id')
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('shared_space_album.showInTimeline', '=', true)
              .where('asset.createdAt', '>', since)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .as('combined'),
      )
      .select((eb) => eb.fn.countAll().as('count'))
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.DATE] })
  async getLastContributor(spaceId: string, since: Date): Promise<{ id: string; name: string } | undefined> {
    const contributions = this.db
      .selectFrom('shared_space_asset')
      .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
      .select(['shared_space_asset.addedById as userId', 'shared_space_asset.addedAt as ts'])
      .where('shared_space_asset.spaceId', '=', spaceId)
      .where('shared_space_asset.addedAt', '>', since)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
      .union(
        this.db
          .selectFrom('shared_space_library')
          .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
          .select(['asset.ownerId as userId', 'asset.createdAt as ts'])
          .where('shared_space_library.spaceId', '=', spaceId)
          .where('asset.createdAt', '>', since)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
      )
      .union(
        this.db
          .selectFrom('shared_space_album')
          .innerJoin('album', (j) =>
            j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
          )
          .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
          .innerJoin('asset', 'asset.id', 'album_asset.assetId')
          .select(['asset.ownerId as userId', 'asset.createdAt as ts'])
          .where('shared_space_album.spaceId', '=', spaceId)
          .where('shared_space_album.showInTimeline', '=', true)
          .where('asset.createdAt', '>', since)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
      );

    return this.db
      .selectFrom(contributions.as('contrib'))
      .innerJoin('user', (join) => join.onRef('user.id', '=', 'contrib.userId').on('user.deletedAt', 'is', null))
      .orderBy('contrib.ts', 'desc')
      .select(['user.id', 'user.name'])
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async updateMemberLastViewed(spaceId: string, userId: string): Promise<void> {
    await this.db
      .updateTable('shared_space_member')
      .set({ lastViewedAt: new Date() })
      .where('spaceId', '=', spaceId)
      .where('userId', '=', userId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getContributionCounts(spaceId: string) {
    // A member's contribution = the DISTINCT set of assets they brought into the space, across the
    // same four sources getAssetCount unions (direct pool, linked library, on-timeline linked album,
    // cross-owner contribution), attributed to whoever performed that action (addedById). Each source
    // emits (userId, assetId); UNION dedupes so an asset a member added via several paths counts once.
    return this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
          .select(['shared_space_asset.addedById as userId', 'asset.id as assetId'])
          .where('shared_space_asset.spaceId', '=', spaceId)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .select(['shared_space_library.addedById as userId', 'asset.id as assetId'])
              .where('shared_space_library.spaceId', '=', spaceId)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .union(
            this.db
              .selectFrom('shared_space_album')
              .innerJoin('album', (join) =>
                join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .innerJoin('asset', 'asset.id', 'album_asset.assetId')
              .select(['shared_space_album.addedById as userId', 'asset.id as assetId'])
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('shared_space_album.showInTimeline', '=', true)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .union(
            this.db
              .selectFrom('album_space_asset')
              .innerJoin('shared_space_album', (join) =>
                join
                  .onRef('shared_space_album.albumId', '=', 'album_space_asset.albumId')
                  .onRef('shared_space_album.spaceId', '=', 'album_space_asset.spaceId'),
              )
              .innerJoin('album', (join) =>
                join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('asset', 'asset.id', 'album_space_asset.assetId')
              .select(['album_space_asset.addedById as userId', 'asset.id as assetId'])
              .where('album_space_asset.spaceId', '=', spaceId)
              .where('shared_space_album.showInTimeline', '=', true)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .as('combined'),
      )
      .where('combined.userId', 'is not', null)
      .groupBy('combined.userId')
      .select(['combined.userId as addedById', (eb) => eb.fn.countAll().as('count')])
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getMemberActivity(spaceId: string) {
    return this.db
      .selectFrom('shared_space_asset')
      .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
      .where('shared_space_asset.spaceId', '=', spaceId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
      .groupBy('shared_space_asset.addedById')
      .select([
        'shared_space_asset.addedById',
        (eb) => eb.fn.max('shared_space_asset.addedAt').as('lastAddedAt'),
        (eb) =>
          eb
            .selectFrom('shared_space_asset as ssa2')
            .innerJoin('asset as asset2', 'asset2.id', 'ssa2.assetId')
            .whereRef('ssa2.addedById', '=', 'shared_space_asset.addedById')
            .where('ssa2.spaceId', '=', spaceId)
            .where('asset2.deletedAt', 'is', null)
            .where('asset2.isOffline', '=', false)
            .where('asset2.visibility', 'in', visibleSpaceAssetVisibilities)
            .orderBy('ssa2.addedAt', 'desc')
            .select('ssa2.assetId')
            .limit(1)
            .as('recentAssetId'),
      ])
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getMapMarkers(spaceId: string) {
    return this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
          .select('asset.id')
          .where('shared_space_asset.spaceId', '=', spaceId)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .select('asset.id')
              .where('shared_space_library.spaceId', '=', spaceId)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .as('combined'),
      )
      .innerJoin('asset', 'asset.id', 'combined.id')
      .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
      .where('asset_exif.latitude', 'is not', null)
      .where('asset_exif.longitude', 'is not', null)
      .select([
        'asset.id',
        'asset_exif.latitude',
        'asset_exif.longitude',
        'asset_exif.city',
        'asset_exif.state',
        'asset_exif.country',
      ])
      .execute();
  }

  @GenerateSql({
    params: [{ userIds: [DummyValue.UUID], visibility: AssetVisibility.Timeline }],
  })
  getFilteredMapMarkers(options: AssetSearchBuilderOptions) {
    return searchAssetBuilderLegacy(this.db, options)
      .innerJoin('asset_exif', 'asset.id', 'asset_exif.assetId')
      .where('asset_exif.latitude', 'is not', null)
      .where('asset_exif.longitude', 'is not', null)
      .select([
        'asset.id',
        'asset_exif.latitude as lat',
        'asset_exif.longitude as lon',
        'asset_exif.city',
        'asset_exif.state',
        'asset_exif.country',
      ])
      .$narrowType<{ lat: NotNull; lon: NotNull }>()
      .execute();
  }

  async logActivity(
    values: { spaceId: string; userId: string; type: string; data?: Record<string, unknown> },
    db: Kysely<DB> | Transaction<DB> = this.db,
  ) {
    await db
      .insertInto('shared_space_activity')
      .values({
        spaceId: values.spaceId,
        userId: values.userId,
        type: values.type,
        data: (values.data ?? {}) as Record<string, unknown>,
      })
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, 50, 0] })
  getActivities(spaceId: string, limit: number = 50, offset: number = 0) {
    return (
      this.db
        .selectFrom('shared_space_activity')
        .leftJoin('user', 'user.id', 'shared_space_activity.userId')
        .select([
          'shared_space_activity.id',
          'shared_space_activity.type',
          'shared_space_activity.data',
          'shared_space_activity.createdAt',
          'shared_space_activity.userId',
          'user.name',
          'user.email',
          'user.profileImagePath',
          'user.avatarColor',
        ])
        .where('shared_space_activity.spaceId', '=', spaceId)
        // Drop album link/unlink entries whose album no longer exists (e.g. the abandoned create-flow
        // album deleted on navigate-away) IN SQL, not post-hoc: LIMIT must yield full pages, because
        // the client infers hasMore from a full page and advances its offset by the returned count —
        // a post-SQL filter shrinks pages, dead-ends pagination, and desyncs the offset (#752 F4).
        .where((eb) =>
          eb.or([
            eb('shared_space_activity.type', 'not in', [
              SharedSpaceActivityType.AlbumLink,
              SharedSpaceActivityType.AlbumUnlink,
            ]),
            eb.exists(
              eb
                .selectFrom('album')
                .select('album.id')
                .where('album.deletedAt', 'is', null)
                .where(sql<boolean>`album.id::text = shared_space_activity.data->>'albumId'`),
            ),
          ]),
        )
        .orderBy('shared_space_activity.createdAt', 'desc')
        .limit(limit)
        .offset(offset)
        .execute()
    );
  }

  // ==========================================
  // Shared Space Person CRUD
  // ==========================================

  @GenerateSql({ params: [DummyValue.UUID] })
  async hasPetsBySpaceId(spaceId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('shared_space_person')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('spaceId', '=', spaceId)
      .where('type', '=', 'pet')
      .executeTakeFirstOrThrow();
    return result.count > 0;
  }

  @GenerateSql({
    params: [
      DummyValue.UUID,
      { withHidden: false, petsEnabled: true, limit: 50, offset: 0, named: false, minimumFaceCount: 3 },
    ],
  })
  getPersonsBySpaceId(
    spaceId: string,
    options: {
      withHidden?: boolean;
      petsEnabled?: boolean;
      limit?: number;
      offset?: number;
      named?: boolean;
      name?: string;
      takenAfter?: Date;
      takenBefore?: Date;
      minimumFaceCount?: number;
    },
  ) {
    const escapedName = options.name
      ?.replaceAll('\\', String.raw`\\`)
      .replaceAll('%', String.raw`\%`)
      .replaceAll('_', String.raw`\_`);
    const namePattern = escapedName ? `%${escapedName}%` : undefined;
    const minimumFaceCount = options.minimumFaceCount;

    return this.db
      .selectFrom('shared_space_person')
      .selectAll('shared_space_person')
      .where('shared_space_person.spaceId', '=', spaceId)
      .$if(!options.withHidden, (qb) => qb.where('shared_space_person.isHidden', '=', false))
      .$if(!options.petsEnabled, (qb) => qb.where('shared_space_person.type', '!=', 'pet'))
      .$if(!!options.named, (qb) => qb.where('shared_space_person.name', '!=', ''))
      .$if(!!namePattern, (qb) => qb.where(() => sql`"shared_space_person"."name" ILIKE ${namePattern} ESCAPE '\\'`))
      .$if(minimumFaceCount !== undefined, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('shared_space_person.name', '!=', ''),
            eb('shared_space_person.assetCount', '>=', minimumFaceCount!),
          ]),
        ),
      )
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('shared_space_person_face as spf2')
            .innerJoin('asset_face as af2', 'af2.id', 'spf2.assetFaceId')
            .innerJoin('asset', 'asset.id', 'af2.assetId')
            .whereRef('spf2.personId', '=', 'shared_space_person.id')
            .where('af2.deletedAt', 'is', null)
            .where('af2.isVisible', '=', true)
            .where('asset.deletedAt', 'is', null)
            .where('asset.isOffline', '=', false)
            .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
            .where((spaceEb) =>
              spaceEb.or([
                spaceEb.exists(
                  spaceEb
                    .selectFrom('shared_space_asset')
                    .select('shared_space_asset.assetId')
                    .whereRef('shared_space_asset.assetId', '=', 'asset.id')
                    .where('shared_space_asset.spaceId', '=', spaceId),
                ),
                spaceEb.exists(
                  spaceEb
                    .selectFrom('shared_space_library')
                    .select('shared_space_library.libraryId')
                    .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
                    .where('shared_space_library.spaceId', '=', spaceId),
                ),
                spaceEb.exists(
                  spaceEb
                    .selectFrom('shared_space_album')
                    .innerJoin('album', (j) =>
                      j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
                    )
                    .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
                    .select('shared_space_album.albumId')
                    .whereRef('album_asset.assetId', '=', 'asset.id')
                    .where('shared_space_album.spaceId', '=', spaceId),
                ),
              ]),
            )
            .$if(!!options.takenAfter, (qb2) => qb2.where('asset.fileCreatedAt', '>=', options.takenAfter!))
            .$if(!!options.takenBefore, (qb2) => qb2.where('asset.fileCreatedAt', '<', options.takenBefore!)),
        ),
      )
      .orderBy('shared_space_person.isHidden', 'asc')
      .orderBy(sql`NULLIF(BTRIM(shared_space_person.name), '')`, (om) => om.asc().nullsLast())
      .orderBy(
        sql`CASE WHEN NULLIF(BTRIM(shared_space_person.name), '') IS NULL THEN "shared_space_person"."assetCount" END`,
        (om) => om.desc().nullsLast(),
      )
      .orderBy('shared_space_person.id')
      .$if(!!options.limit, (qb) => qb.limit(options.limit!))
      .$if(!!options.offset, (qb) => qb.offset(options.offset!))
      .execute();
  }

  @GenerateSql({
    params: [DummyValue.UUID, { petsEnabled: true, named: false, name: 'Alice', minimumFaceCount: 3 }],
  })
  async countPersonsBySpaceId(
    spaceId: string,
    options: {
      petsEnabled?: boolean;
      named?: boolean;
      name?: string;
      takenAfter?: Date;
      takenBefore?: Date;
      minimumFaceCount?: number;
    },
  ) {
    const escapedName = options.name
      ?.replaceAll('\\', String.raw`\\`)
      .replaceAll('%', String.raw`\%`)
      .replaceAll('_', String.raw`\_`);
    const namePattern = escapedName ? `%${escapedName}%` : undefined;
    const minimumFaceCount = options.minimumFaceCount;
    const visibilityFilter = sql`"asset"."visibility" IN (${sql.join(visibleSpaceAssetVisibilities)})`;
    const takenAfterFilter = options.takenAfter ? sql`AND "asset"."fileCreatedAt" >= ${options.takenAfter}` : sql``;
    const takenBeforeFilter = options.takenBefore ? sql`AND "asset"."fileCreatedAt" < ${options.takenBefore}` : sql``;
    const petPersonFilter = options.petsEnabled ? sql`` : sql`AND "shared_space_person"."type" != 'pet'`;
    const namedPersonFilter = options.named ? sql`AND "shared_space_person"."name" != ''` : sql``;
    const namePersonFilter = namePattern
      ? sql`AND "shared_space_person"."name" ILIKE ${namePattern} ESCAPE '\\'`
      : sql``;
    const minimumPersonFilter =
      minimumFaceCount === undefined
        ? sql``
        : sql`
            AND (
              "shared_space_person"."name" != ''
              OR "shared_space_person"."assetCount" >= ${minimumFaceCount}
            )
          `;
    // Always require at least one visible, in-scope face (visibility already enforced by asset_scope CTE).
    // The date bounds are already applied to asset_scope, so this naturally enforces date filtering too.
    const visibleFaceFilter = sql`
            AND EXISTS (
              SELECT 1
              FROM "shared_space_person_face"
              INNER JOIN "asset_face" ON "asset_face"."id" = "shared_space_person_face"."assetFaceId"
              INNER JOIN "asset_scope" ON "asset_scope"."assetId" = "asset_face"."assetId"
              WHERE "shared_space_person_face"."personId" = "shared_space_person"."id"
                AND "asset_face"."deletedAt" IS NULL
                AND "asset_face"."isVisible" = true
            )
          `;
    const hasAssignedPersonFaceFilter = !!options.named || !!namePattern;
    const assignedPersonFaceFilter = hasAssignedPersonFaceFilter
      ? sql`
          AND EXISTS (
            SELECT 1
            FROM "shared_space_person_face"
            INNER JOIN "shared_space_person"
              ON "shared_space_person"."id" = "shared_space_person_face"."personId"
            WHERE "shared_space_person_face"."assetFaceId" = "asset_face"."id"
              AND "shared_space_person"."spaceId" = ${spaceId}
              ${petPersonFilter}
              ${namedPersonFilter}
              ${namePersonFilter}
          )
        `
      : options.petsEnabled
        ? sql``
        : sql`
            AND NOT EXISTS (
              SELECT 1
              FROM "shared_space_person_face"
              INNER JOIN "shared_space_person"
                ON "shared_space_person"."id" = "shared_space_person_face"."personId"
              WHERE "shared_space_person_face"."assetFaceId" = "asset_face"."id"
                AND "shared_space_person"."spaceId" = ${spaceId}
                AND "shared_space_person"."type" = 'pet'
            )
          `;

    const result = await sql<{ total: number; hidden: number; detectedFaceCount: number }>`
      WITH "asset_scope" AS (
        SELECT "asset"."id" AS "assetId"
        FROM "shared_space_asset"
        INNER JOIN "asset" ON "asset"."id" = "shared_space_asset"."assetId"
        WHERE "shared_space_asset"."spaceId" = ${spaceId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND ${visibilityFilter}
          ${takenAfterFilter}
          ${takenBeforeFilter}
        UNION
        SELECT "asset"."id" AS "assetId"
        FROM "shared_space_library"
        INNER JOIN "asset" ON "asset"."libraryId" = "shared_space_library"."libraryId"
        WHERE "shared_space_library"."spaceId" = ${spaceId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND ${visibilityFilter}
          ${takenAfterFilter}
          ${takenBeforeFilter}
        UNION
        SELECT "asset"."id" AS "assetId"
        FROM "shared_space_album"
        INNER JOIN "album"
          ON "album"."id" = "shared_space_album"."albumId"
          AND "album"."deletedAt" IS NULL
        INNER JOIN "album_asset" ON "album_asset"."albumId" = "shared_space_album"."albumId"
        INNER JOIN "asset" ON "asset"."id" = "album_asset"."assetId"
        WHERE "shared_space_album"."spaceId" = ${spaceId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND ${visibilityFilter}
          ${takenAfterFilter}
          ${takenBeforeFilter}
      ),
      "person_rows" AS (
        SELECT
          COALESCE("shared_space_person"."identityId", "shared_space_person"."id") AS "personKey",
          "shared_space_person"."isHidden"
        FROM "shared_space_person"
        WHERE "shared_space_person"."spaceId" = ${spaceId}
          ${petPersonFilter}
          ${namedPersonFilter}
          ${namePersonFilter}
          ${minimumPersonFilter}
          ${visibleFaceFilter}
      ),
      "person_keys" AS (
        SELECT "personKey", BOOL_AND("isHidden") AS "allHidden"
        FROM "person_rows"
        GROUP BY "personKey"
      ),
      "person_counts" AS (
        SELECT
          COUNT(*)::int AS "total",
          COUNT(*) FILTER (WHERE "allHidden")::int AS "hidden"
        FROM "person_keys"
      ),
      "face_counts" AS (
        SELECT COUNT(DISTINCT "asset_face"."id")::int AS "detectedFaceCount"
        FROM "asset_scope"
        INNER JOIN "asset_face" ON "asset_face"."assetId" = "asset_scope"."assetId"
        WHERE "asset_face"."deletedAt" IS NULL
          AND "asset_face"."isVisible" = true
          ${assignedPersonFaceFilter}
      )
      SELECT
        "person_counts"."total",
        "person_counts"."hidden",
        "face_counts"."detectedFaceCount"
      FROM "person_counts", "face_counts"
    `.execute(this.db);

    return result.rows[0]!;
  }

  @GenerateSql({ params: [DummyValue.UUID, { petsEnabled: true, named: false, name: 'Alice', minimumFaceCount: 3 }] })
  async getPeopleFaceStatisticsBySpaceId(
    spaceId: string,
    options: {
      petsEnabled?: boolean;
      named?: boolean;
      name?: string;
      takenAfter?: Date;
      takenBefore?: Date;
      minimumFaceCount?: number;
    },
  ): Promise<PeopleFaceStatistics> {
    const escapedName = options.name
      ?.replaceAll('\\', String.raw`\\`)
      .replaceAll('%', String.raw`\%`)
      .replaceAll('_', String.raw`\_`);
    const namePattern = escapedName ? `%${escapedName}%` : undefined;
    const minimumFaceCount = options.minimumFaceCount;
    const visibilityFilter = sql`"asset"."visibility" IN (${sql.join(visibleSpaceAssetVisibilities)})`;
    const takenAfterFilter = options.takenAfter ? sql`AND "asset"."fileCreatedAt" >= ${options.takenAfter}` : sql``;
    const takenBeforeFilter = options.takenBefore ? sql`AND "asset"."fileCreatedAt" < ${options.takenBefore}` : sql``;
    const petPersonFilter = options.petsEnabled ? sql`` : sql`AND "shared_space_person"."type" != 'pet'`;
    const namedPersonFilter = options.named ? sql`AND "shared_space_person"."name" != ''` : sql``;
    const namePersonFilter = namePattern
      ? sql`AND "shared_space_person"."name" ILIKE ${namePattern} ESCAPE '\\'`
      : sql``;
    const minimumPersonFilter =
      minimumFaceCount === undefined
        ? sql``
        : sql`
            AND (
              "shared_space_person"."name" != ''
              OR "shared_space_person"."assetCount" >= ${minimumFaceCount}
            )
          `;
    const hasAssignedPersonFaceFilter = !!options.named || !!namePattern;
    const includeFaceFilter = hasAssignedPersonFaceFilter
      ? sql`WHERE "hasMatchingAssignment" = true`
      : options.petsEnabled
        ? sql``
        : sql`WHERE "hasPetAssignment" = false`;

    const result = await sql<PeopleFaceStatistics>`
      WITH "asset_scope" AS (
        SELECT "asset"."id" AS "assetId"
        FROM "shared_space_asset"
        INNER JOIN "asset" ON "asset"."id" = "shared_space_asset"."assetId"
        WHERE "shared_space_asset"."spaceId" = ${spaceId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND ${visibilityFilter}
          ${takenAfterFilter}
          ${takenBeforeFilter}
        UNION
        SELECT "asset"."id" AS "assetId"
        FROM "shared_space_library"
        INNER JOIN "asset" ON "asset"."libraryId" = "shared_space_library"."libraryId"
        WHERE "shared_space_library"."spaceId" = ${spaceId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND ${visibilityFilter}
          ${takenAfterFilter}
          ${takenBeforeFilter}
        UNION
        SELECT "asset"."id" AS "assetId"
        FROM "shared_space_album"
        INNER JOIN "album"
          ON "album"."id" = "shared_space_album"."albumId"
          AND "album"."deletedAt" IS NULL
        INNER JOIN "album_asset" ON "album_asset"."albumId" = "shared_space_album"."albumId"
        INNER JOIN "asset" ON "asset"."id" = "album_asset"."assetId"
        WHERE "shared_space_album"."spaceId" = ${spaceId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND ${visibilityFilter}
          ${takenAfterFilter}
          ${takenBeforeFilter}
      ),
      "detected_faces" AS (
        SELECT DISTINCT "asset_face"."id" AS "assetFaceId"
        FROM "asset_scope"
        INNER JOIN "asset_face" ON "asset_face"."assetId" = "asset_scope"."assetId"
        WHERE "asset_face"."deletedAt" IS NULL
          AND "asset_face"."isVisible" = true
      ),
      "face_assignments" AS (
        SELECT
          "detected_faces"."assetFaceId",
          COALESCE(BOOL_OR("shared_space_person"."type" = 'pet'), false) AS "hasPetAssignment",
          COALESCE(BOOL_OR(
            "shared_space_person"."id" IS NOT NULL
            ${petPersonFilter}
            ${namedPersonFilter}
            ${namePersonFilter}
            ${minimumPersonFilter}
          ), false) AS "hasMatchingAssignment",
          COALESCE(BOOL_OR(
            "shared_space_person"."isHidden" = false
            ${petPersonFilter}
            ${namedPersonFilter}
            ${namePersonFilter}
            ${minimumPersonFilter}
          ), false) AS "hasMatchingVisibleAssignment",
          COALESCE(BOOL_OR(
            "shared_space_person"."isHidden" = true
            ${petPersonFilter}
            ${namedPersonFilter}
            ${namePersonFilter}
            ${minimumPersonFilter}
          ), false) AS "hasMatchingHiddenAssignment"
        FROM "detected_faces"
        LEFT JOIN "shared_space_person_face"
          ON "shared_space_person_face"."assetFaceId" = "detected_faces"."assetFaceId"
        LEFT JOIN "shared_space_person"
          ON "shared_space_person"."id" = "shared_space_person_face"."personId"
          AND "shared_space_person"."spaceId" = ${spaceId}
        GROUP BY "detected_faces"."assetFaceId"
      ),
      "included_faces" AS (
        SELECT *
        FROM "face_assignments"
        ${includeFaceFilter}
      ),
      "matching_person_rows" AS (
        SELECT DISTINCT
          COALESCE("shared_space_person"."identityId", "shared_space_person"."id") AS "personKey",
          "shared_space_person"."isHidden",
          "shared_space_person"."name"
        FROM "detected_faces"
        INNER JOIN "shared_space_person_face"
          ON "shared_space_person_face"."assetFaceId" = "detected_faces"."assetFaceId"
        INNER JOIN "shared_space_person"
          ON "shared_space_person"."id" = "shared_space_person_face"."personId"
          AND "shared_space_person"."spaceId" = ${spaceId}
        WHERE true
          ${petPersonFilter}
          ${namedPersonFilter}
          ${namePersonFilter}
      ),
      "matching_person_keys" AS (
        SELECT
          "personKey",
          BOOL_OR("isHidden" = false AND NULLIF(BTRIM("name"), '') IS NOT NULL) AS "hasNamedVisiblePerson"
        FROM "matching_person_rows"
        GROUP BY "personKey"
      )
      SELECT
        COUNT(*)::int AS "detectedFaceCount",
        COUNT(*) FILTER (WHERE "hasMatchingVisibleAssignment" = true)::int AS "assignedVisibleFaceCount",
        (SELECT COUNT(*)::int FROM "matching_person_keys" WHERE "hasNamedVisiblePerson" = true) AS "namedVisiblePersonCount",
        COUNT(*) FILTER (
          WHERE "hasMatchingVisibleAssignment" = false
            AND "hasMatchingHiddenAssignment" = true
        )::int AS "assignedHiddenFaceCount",
        COUNT(*) FILTER (
          WHERE "hasMatchingVisibleAssignment" = false
            AND "hasMatchingHiddenAssignment" = false
        )::int AS "unassignedFaceCount"
      FROM "included_faces"
    `.execute(this.db);

    const row = result.rows[0];
    return {
      detectedFaceCount: Number(row?.detectedFaceCount ?? 0),
      assignedVisibleFaceCount: Number(row?.assignedVisibleFaceCount ?? 0),
      namedVisiblePersonCount: Number(row?.namedVisiblePersonCount ?? 0),
      assignedHiddenFaceCount: Number(row?.assignedHiddenFaceCount ?? 0),
      unassignedFaceCount: Number(row?.unassignedFaceCount ?? 0),
    };
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getSpacePersonStatistics(spaceId: string, personId: string): Promise<SpacePersonStatistics> {
    const result = await sql<SpacePersonStatistics>`
      WITH "target_person" AS (
        SELECT
          "id"
        FROM "shared_space_person"
        WHERE "id" = ${personId}
          AND "spaceId" = ${spaceId}
      ),
      "asset_scope" AS (
        SELECT "asset"."id" AS "assetId"
        FROM "shared_space_asset"
        INNER JOIN "asset" ON "asset"."id" = "shared_space_asset"."assetId"
        WHERE "shared_space_asset"."spaceId" = ${spaceId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND "asset"."visibility" IN (${sql.join(visibleSpaceAssetVisibilities)})
        UNION
        SELECT "asset"."id" AS "assetId"
        FROM "shared_space_library"
        INNER JOIN "asset" ON "asset"."libraryId" = "shared_space_library"."libraryId"
        WHERE "shared_space_library"."spaceId" = ${spaceId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND "asset"."visibility" IN (${sql.join(visibleSpaceAssetVisibilities)})
        UNION
        SELECT "asset"."id" AS "assetId"
        FROM "shared_space_album"
        INNER JOIN "album"
          ON "album"."id" = "shared_space_album"."albumId"
          AND "album"."deletedAt" IS NULL
        INNER JOIN "album_asset" ON "album_asset"."albumId" = "shared_space_album"."albumId"
        INNER JOIN "asset" ON "asset"."id" = "album_asset"."assetId"
        WHERE "shared_space_album"."spaceId" = ${spaceId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND "asset"."visibility" IN (${sql.join(visibleSpaceAssetVisibilities)})
      ),
      "selected_faces" AS (
        SELECT DISTINCT
          "asset_face"."id" AS "assetFaceId",
          "asset_face"."assetId"
        FROM "target_person"
        INNER JOIN "asset_scope" ON true
        INNER JOIN "asset_face" ON "asset_face"."assetId" = "asset_scope"."assetId"
        INNER JOIN "shared_space_person_face"
          ON "shared_space_person_face"."assetFaceId" = "asset_face"."id"
          AND "shared_space_person_face"."personId" = "target_person"."id"
        WHERE "asset_face"."deletedAt" IS NULL
          AND "asset_face"."isVisible" = true
      )
      SELECT
        COUNT(DISTINCT "assetId")::int AS "assets",
        COUNT(DISTINCT "assetFaceId")::int AS "faces"
      FROM "selected_faces"
    `.execute(this.db);

    const row = result.rows[0];
    return {
      assets: Number(row?.assets ?? 0),
      faces: Number(row?.faces ?? 0),
    };
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getPersonById(id: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    return db
      .selectFrom('shared_space_person')
      .selectAll('shared_space_person')
      .where('shared_space_person.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [{ spaceId: DummyValue.UUID, personId: DummyValue.UUID, assetFaceId: DummyValue.UUID }] })
  getSpaceRepresentativeFaceForUpdate(input: { spaceId: string; personId: string; assetFaceId: string }) {
    return this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .selectAll('asset_face')
      .where('shared_space_person.spaceId', '=', input.spaceId)
      .where('shared_space_person.id', '=', input.personId)
      .where('asset_face.id', '=', input.assetFaceId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .select('shared_space_asset.assetId')
              .whereRef('shared_space_asset.assetId', '=', 'asset_face.assetId')
              .whereRef('shared_space_asset.spaceId', '=', 'shared_space_person.spaceId'),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .select('shared_space_library.libraryId')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .whereRef('shared_space_library.spaceId', '=', 'shared_space_person.spaceId'),
          ),
          spaceAlbumAssetExists(eb, {
            correlateAssetId: 'asset_face.assetId',
            scope: { spaceIdRef: 'shared_space_person.spaceId' },
          }),
        ]),
      )
      .executeTakeFirst();
  }

  @GenerateSql({ params: [{ spaceId: DummyValue.UUID, personId: DummyValue.UUID, take: 50, skip: 0 }] })
  getSpaceRepresentativeFaces(input: { spaceId: string; personId: string; take: number; skip: number }) {
    return this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .selectAll('asset_face')
      .select(['asset.fileCreatedAt', 'shared_space_person.representativeFaceId'])
      .where('shared_space_person.spaceId', '=', input.spaceId)
      .where('shared_space_person.id', '=', input.personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .select('shared_space_asset.assetId')
              .whereRef('shared_space_asset.assetId', '=', 'asset_face.assetId')
              .whereRef('shared_space_asset.spaceId', '=', 'shared_space_person.spaceId'),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .select('shared_space_library.libraryId')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .whereRef('shared_space_library.spaceId', '=', 'shared_space_person.spaceId'),
          ),
          spaceAlbumAssetExists(eb, {
            correlateAssetId: 'asset_face.assetId',
            scope: { spaceIdRef: 'shared_space_person.spaceId' },
          }),
        ]),
      )
      .orderBy('asset.fileCreatedAt', 'desc')
      .orderBy('asset_face.id')
      .offset(input.skip)
      .limit(input.take + 1)
      .execute();
  }

  createPerson(values: Insertable<SharedSpacePersonTable>) {
    return this.db.insertInto('shared_space_person').values(values).returningAll().executeTakeFirstOrThrow();
  }

  // Race-safe insert-or-get for the `(spaceId, identityId)` unique index. Concurrent
  // SharedSpaceFaceMatch* jobs carrying faces of the same identity all miss the not-yet-committed
  // space person and then race to INSERT; the losers previously crashed the handler with a
  // duplicate-key error. ON CONFLICT DO NOTHING lets the loser fall through to re-read the winner's
  // committed row instead of throwing.
  async createOrGetPersonForIdentity(
    values: Insertable<SharedSpacePersonTable> & { spaceId: string; identityId: string },
  ) {
    const inserted = await this.db
      .insertInto('shared_space_person')
      .values(values)
      .onConflict((oc) => oc.columns(['spaceId', 'identityId']).where('identityId', 'is not', null).doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) {
      return inserted;
    }

    return this.db
      .selectFrom('shared_space_person')
      .selectAll()
      .where('spaceId', '=', values.spaceId)
      .where('identityId', '=', values.identityId)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getSpacePersonByIdentity(spaceId: string, identityId: string) {
    return this.db
      .selectFrom('shared_space_person')
      .selectAll()
      .where('spaceId', '=', spaceId)
      .where('identityId', '=', identityId)
      .executeTakeFirst();
  }

  async getPersonalThumbnailForSpacePerson(input: {
    userId: string;
    spaceId: string;
    identityId: string;
  }): Promise<SpacePersonPersonalThumbnail | undefined> {
    const ownThumbnail = await this.db
      .selectFrom('person')
      .select(['person.id as personId', 'person.thumbnailPath'])
      .where('person.ownerId', '=', input.userId)
      .where('person.identityId', '=', input.identityId)
      .where('person.thumbnailPath', '!=', '')
      .orderBy('person.updatedAt', 'desc')
      .orderBy('person.id')
      .executeTakeFirst();

    if (ownThumbnail) {
      return ownThumbnail;
    }

    return this.db
      .selectFrom('person')
      .innerJoin('asset_face', 'asset_face.id', 'person.faceAssetId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .select(['person.id as personId', 'person.thumbnailPath'])
      .where('person.identityId', '=', input.identityId)
      .where('person.thumbnailPath', '!=', '')
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .whereRef('shared_space_asset.assetId', '=', 'asset.id')
              .where('shared_space_asset.spaceId', '=', input.spaceId),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .where('shared_space_library.spaceId', '=', input.spaceId),
          ),
        ]),
      )
      .orderBy('person.updatedAt', 'desc')
      .orderBy('person.id')
      .executeTakeFirst();
  }

  @GenerateSql({
    params: [{ spaceId: DummyValue.UUID, identityId: DummyValue.UUID, assetAdderIds: [DummyValue.UUID] }],
  })
  async getMetadataInheritanceCandidates(input: {
    spaceId: string;
    identityId: string;
    assetAdderIds?: string[];
  }): Promise<MetadataInheritanceCandidate[]> {
    const assetAdderIds = [...new Set(input.assetAdderIds)];
    const isAssetAdderSql =
      assetAdderIds.length > 0 ? sql<boolean>`person."ownerId" = ${anyUuid(assetAdderIds)}` : sql<boolean>`false`;

    const personalCandidates = await this.db
      .selectFrom('person')
      .innerJoin('shared_space_member', (join) =>
        join
          .onRef('shared_space_member.userId', '=', 'person.ownerId')
          .on('shared_space_member.spaceId', '=', input.spaceId)
          .on('shared_space_member.sharePersonMetadata', '=', true),
      )
      .leftJoin('asset_face', (join) =>
        join
          .onRef('asset_face.personId', '=', 'person.id')
          .on('asset_face.deletedAt', 'is', null)
          .on('asset_face.isVisible', 'is', true),
      )
      .leftJoin('shared_space_person_face', 'shared_space_person_face.assetFaceId', 'asset_face.id')
      .leftJoin('shared_space_person', (join) =>
        join
          .onRef('shared_space_person.id', '=', 'shared_space_person_face.personId')
          .on('shared_space_person.spaceId', '=', input.spaceId),
      )
      .select([
        'person.id as personId',
        sql<'user-person'>`'user-person'`.as('sourceProfileType'),
        'person.id as sourceProfileId',
        'person.ownerId as userId',
        'shared_space_member.role',
        'person.name',
        'person.birthDate',
        'person.type',
        'person.species',
        'person.updatedAt',
      ])
      .select((eb) => [
        eb.fn.count('shared_space_person.id').$castTo<number>().as('supportingFaceCount'),
        isAssetAdderSql.as('isAssetAdder'),
      ])
      .where('person.identityId', '=', input.identityId)
      .groupBy([
        'person.id',
        'person.ownerId',
        'shared_space_member.role',
        'person.name',
        'person.birthDate',
        'person.type',
        'person.species',
        'person.updatedAt',
        'isAssetAdder',
      ])
      .execute();

    if (assetAdderIds.length === 0) {
      return personalCandidates;
    }

    const visibleSpaceCandidates = await this.db
      .selectFrom('shared_space_person as source_person')
      .innerJoin('shared_space_member as source_member', (join) =>
        join
          .onRef('source_member.spaceId', '=', 'source_person.spaceId')
          .on('source_member.userId', '=', anyUuid(assetAdderIds))
          .on('source_member.showInTimeline', '=', true),
      )
      .innerJoin('shared_space_member as target_member', (join) =>
        join
          .on('target_member.spaceId', '=', input.spaceId)
          .on('target_member.userId', '=', anyUuid(assetAdderIds))
          .on('target_member.sharePersonMetadata', '=', true),
      )
      .leftJoin('shared_space_person_alias as source_alias', (join) =>
        join
          .onRef('source_alias.personId', '=', 'source_person.id')
          .onRef('source_alias.userId', '=', 'source_member.userId'),
      )
      .select([
        'source_person.id as personId',
        sql<'space-person'>`'space-person'`.as('sourceProfileType'),
        'source_person.id as sourceProfileId',
        'target_member.userId as userId',
        'target_member.role',
        'source_person.birthDate',
        'source_person.type',
        'source_person.updatedAt',
      ])
      .select((eb) => [
        sql<string>`COALESCE(NULLIF("source_alias"."alias", ''), "source_person"."name", '')`.as('name'),
        sql<string | null>`NULL`.as('species'),
        eb.ref('source_person.faceCount').$castTo<number>().as('supportingFaceCount'),
        sql<boolean>`true`.as('isAssetAdder'),
      ])
      .where('source_person.identityId', '=', input.identityId)
      .where('source_person.spaceId', '!=', input.spaceId)
      .where('source_person.isHidden', '=', false)
      .execute();

    return [...personalCandidates, ...visibleSpaceCandidates];
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getSpacePersonAssetAdderIds(spaceId: string, personId: string): Promise<string[]> {
    const directRows = await this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .innerJoin('shared_space_asset', (join) =>
        join
          .onRef('shared_space_asset.assetId', '=', 'asset_face.assetId')
          .on('shared_space_asset.spaceId', '=', spaceId),
      )
      .select('shared_space_asset.addedById as userId')
      .distinct()
      .where('shared_space_person_face.personId', '=', personId)
      .where('shared_space_asset.addedById', 'is not', null)
      .execute();

    const libraryRows = await this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('shared_space_library', (join) =>
        join
          .onRef('shared_space_library.libraryId', '=', 'asset.libraryId')
          .on('shared_space_library.spaceId', '=', spaceId),
      )
      .select('shared_space_library.addedById as userId')
      .distinct()
      .where('shared_space_person_face.personId', '=', personId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('shared_space_library.addedById', 'is not', null)
      .execute();

    const albumRows = await this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('album_asset', 'album_asset.assetId', 'asset.id')
      .innerJoin('shared_space_album', (join) =>
        join
          .onRef('shared_space_album.albumId', '=', 'album_asset.albumId')
          .on('shared_space_album.spaceId', '=', spaceId),
      )
      .innerJoin('album', (j) =>
        j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
      )
      .select('shared_space_album.addedById as userId')
      .distinct()
      .where('shared_space_person_face.personId', '=', personId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('shared_space_album.addedById', 'is not', null)
      .execute();

    return [
      ...new Set(
        [...directRows, ...libraryRows, ...albumRows].filter((row) => row.userId).map((row) => row.userId as string),
      ),
    ];
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getSpaceAssetAdder(spaceId: string, assetId: string): Promise<{ addedById: string | null } | undefined> {
    const directRow = await this.db
      .selectFrom('shared_space_asset')
      .select('addedById')
      .where('spaceId', '=', spaceId)
      .where('assetId', '=', assetId)
      .executeTakeFirst();

    if (directRow?.addedById) {
      return directRow;
    }

    const libraryRow = await this.db
      .selectFrom('shared_space_library')
      .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
      .select('shared_space_library.addedById')
      .where('shared_space_library.spaceId', '=', spaceId)
      .where('asset.id', '=', assetId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .executeTakeFirst();

    if (libraryRow?.addedById) {
      return libraryRow;
    }

    const albumRow = await this.db
      .selectFrom('shared_space_album')
      .innerJoin('album', (join) =>
        join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
      )
      .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
      .innerJoin('asset', 'asset.id', 'album_asset.assetId')
      .select('shared_space_album.addedById')
      .where('shared_space_album.spaceId', '=', spaceId)
      .where('asset.id', '=', assetId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .executeTakeFirst();

    return albumRow ?? libraryRow ?? directRow;
  }

  @GenerateSql({ params: [{ cursor: DummyValue.UUID, identityId: DummyValue.UUID, limit: 100 }] })
  getSpacePersonMetadataBackfillPage(input: { cursor?: string; identityId?: string; limit: number }) {
    return this.db
      .selectFrom('shared_space_person')
      .selectAll('shared_space_person')
      .where('identityId', 'is not', null)
      .$if(!!input.identityId, (qb) => qb.where('identityId', '=', input.identityId!))
      .$if(!!input.cursor, (qb) => qb.where('id', '>', input.cursor!))
      .orderBy('id')
      .limit(input.limit)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getIdentityEvidenceForSpacePerson(
    spaceId: string,
    spacePersonId: string,
    candidateIdentityIds?: string[],
  ): Promise<SpacePersonIdentityEvidence[]> {
    return this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('person', 'person.id', 'asset_face.personId')
      .select(['person.identityId', 'person.type'])
      .select((eb) => eb.fn.count('asset_face.id').$castTo<number>().as('supportingFaceCount'))
      .where('shared_space_person_face.personId', '=', spacePersonId)
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .select('shared_space_asset.assetId')
              .whereRef('shared_space_asset.assetId', '=', 'asset_face.assetId')
              .where('shared_space_asset.spaceId', '=', spaceId),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .select('shared_space_library.libraryId')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .where('shared_space_library.spaceId', '=', spaceId),
          ),
          spaceAlbumAssetExists(eb, {
            correlateAssetId: 'asset_face.assetId',
            scope: { spaceId },
          }),
        ]),
      )
      .where('person.identityId', 'is not', null)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
      .$if(!!candidateIdentityIds?.length, (qb) => qb.where('person.identityId', 'in', candidateIdentityIds!))
      .groupBy(['person.identityId', 'person.type'])
      .$castTo<SpacePersonIdentityEvidence>()
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { name: 'Updated Person' }] })
  updatePerson(id: string, values: Updateable<SharedSpacePersonTable>) {
    return this.db
      .updateTable('shared_space_person')
      .set(values)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async deletePerson(id: string) {
    await this.db.deleteFrom('shared_space_person').where('id', '=', id).execute();
  }

  async addPersonFaces(
    values: Insertable<SharedSpacePersonFaceTable>[],
    options?: { skipRecount?: boolean },
    db: Kysely<DB> | Transaction<DB> = this.db,
  ) {
    if (values.length === 0) {
      return [];
    }

    // This INSERT names only shared_space_person_face, but the FK check takes FOR KEY SHARE on each
    // shared_space_person parent, in row order — an invisible deadlock participant against the
    // representativeFaceId SET NULL cascade that a concurrent asset delete drives (#864). Claim the
    // parents in id order first so this agrees with every other writer, and re-drive if it still loses.
    const parentIds = [...new Set(values.map(({ personId }) => personId))].toSorted();

    const insert = async (runner: Kysely<DB> | Transaction<DB>) => {
      await runner
        .selectFrom('shared_space_person')
        .select('id')
        .where('id', 'in', parentIds)
        .orderBy('id')
        .forUpdate()
        .execute();

      return runner
        .insertInto('shared_space_person_face')
        .values(values)
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .execute();
    };

    // Slice 5 (F10): a caller inside its own transaction (the space-confirm transaction) passes that handle
    // here and must never trigger a second `this.db` acquisition mid-transaction (issue #595) — run directly
    // on it instead of opening a nested retry-wrapped transaction. The deadlock retry only makes sense for
    // the standalone (non-transactional) caller: a caller-supplied transaction that deadlocks aborts as a
    // whole and must be re-driven by ITS caller, not retried in place here.
    const result = db.isTransaction
      ? await insert(db)
      : await retryOnDeadlock(() => this.db.transaction().execute(insert));

    if (!options?.skipRecount && result.length > 0) {
      const personIds = [...new Set(result.map((r) => r.personId))];
      await this.recountPersons(personIds, db);
    }

    return result;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getPersonAssetIds(personId: string) {
    return this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .select('asset_face.assetId')
      .distinct()
      .where('shared_space_person_face.personId', '=', personId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .select('shared_space_asset.assetId')
              .whereRef('shared_space_asset.assetId', '=', 'asset_face.assetId')
              .whereRef('shared_space_asset.spaceId', '=', 'shared_space_person.spaceId'),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .select('shared_space_library.libraryId')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .whereRef('shared_space_library.spaceId', '=', 'shared_space_person.spaceId'),
          ),
          spaceAlbumAssetExists(eb, {
            correlateAssetId: 'asset_face.assetId',
            scope: { spaceIdRef: 'shared_space_person.spaceId' },
            requireShowInTimeline: true,
          }),
        ]),
      )
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getFaceIdsForPerson(personId: string): Promise<Array<{ assetFaceId: string }>> {
    return this.db
      .selectFrom('shared_space_person_face')
      .select('assetFaceId')
      .where('personId', '=', personId)
      .execute();
  }

  async reassignPersonFaces(fromPersonId: string, toPersonId: string) {
    await this.db
      .updateTable('shared_space_person_face')
      .set({ personId: toPersonId })
      .where('personId', '=', fromPersonId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async reassignPersonFacesSafe(fromPersonId: string, toPersonId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    // Delete faces that already exist on the target to avoid PK violation
    await db
      .deleteFrom('shared_space_person_face')
      .where('personId', '=', fromPersonId)
      .where(
        'assetFaceId',
        'in',
        db.selectFrom('shared_space_person_face').select('assetFaceId').where('personId', '=', toPersonId),
      )
      .execute();

    await db
      .updateTable('shared_space_person_face')
      .set({ personId: toPersonId })
      .where('personId', '=', fromPersonId)
      .execute();
  }

  async mergeSpacePersonProfile(
    input: {
      sourcePersonId: string;
      targetPersonId: string;
    },
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<void> {
    await this.reassignPersonFacesSafe(input.sourcePersonId, input.targetPersonId, db);

    const sourceAliases = await db
      .selectFrom('shared_space_person_alias')
      .selectAll()
      .where('personId', '=', input.sourcePersonId)
      .execute();

    for (const alias of sourceAliases) {
      await db
        .insertInto('shared_space_person_alias')
        .values({ personId: input.targetPersonId, userId: alias.userId, alias: alias.alias })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }

    await db.deleteFrom('shared_space_person_alias').where('personId', '=', input.sourcePersonId).execute();

    // D1: move this space-person's verdicts to the survivor before deleting the source row.
    await retargetVerdictSpacePersonId(db, input.sourcePersonId, input.targetPersonId);

    const [deleteResult] = await db.deleteFrom('shared_space_person').where('id', '=', input.sourcePersonId).execute();
    if (Number(deleteResult.numDeletedRows ?? 0) === 0) {
      throw new Error('Space person profile not found');
    }
    await this.recountPersons([input.targetPersonId], db);
  }

  async lockSpacePeopleForMerge(personIds: string[], db: Kysely<DB> | Transaction<DB> = this.db): Promise<void> {
    if (personIds.length === 0) {
      return;
    }

    const rows = await db
      .selectFrom('shared_space_person')
      .select('id')
      .where('id', 'in', [...new Set(personIds)].toSorted())
      .orderBy('id')
      .forUpdate()
      .execute();
    if (rows.length !== new Set(personIds).size) {
      throw new Error('Space person profile not found');
    }
  }

  async updateSpacePersonIdentity(
    input: {
      personId: string;
      identityId: string;
    },
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<void> {
    await db
      .updateTable('shared_space_person')
      .set({ identityId: input.identityId })
      .where('id', '=', input.personId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getFirstFaceIdForPerson(personId: string): Promise<string | null> {
    const result = await this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('face_search', 'face_search.faceId', 'shared_space_person_face.assetFaceId')
      .select('shared_space_person_face.assetFaceId')
      .where('shared_space_person_face.personId', '=', personId)
      .limit(1)
      .executeTakeFirst();
    return result?.assetFaceId ?? null;
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async isSpacePersonRepresentativeFaceValid(
    personId: string,
    faceId: string,
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<boolean> {
    const row = await db
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .select('asset_face.id')
      .where('shared_space_person_face.personId', '=', personId)
      .where('asset_face.id', '=', faceId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .select('shared_space_asset.assetId')
              .whereRef('shared_space_asset.assetId', '=', 'asset_face.assetId')
              .whereRef('shared_space_asset.spaceId', '=', 'shared_space_person.spaceId'),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .select('shared_space_library.libraryId')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .whereRef('shared_space_library.spaceId', '=', 'shared_space_person.spaceId'),
          ),
          spaceAlbumAssetExists(eb, {
            correlateAssetId: 'asset_face.assetId',
            scope: { spaceIdRef: 'shared_space_person.spaceId' },
          }),
        ]),
      )
      .executeTakeFirst();
    return !!row;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getFirstValidRepresentativeFaceForPerson(
    personId: string,
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<string | null> {
    const row = await db
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .select('asset_face.id')
      .where('shared_space_person_face.personId', '=', personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .select('shared_space_asset.assetId')
              .whereRef('shared_space_asset.assetId', '=', 'asset_face.assetId')
              .whereRef('shared_space_asset.spaceId', '=', 'shared_space_person.spaceId'),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .select('shared_space_library.libraryId')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .whereRef('shared_space_library.spaceId', '=', 'shared_space_person.spaceId'),
          ),
          spaceAlbumAssetExists(eb, {
            correlateAssetId: 'asset_face.assetId',
            scope: { spaceIdRef: 'shared_space_person.spaceId' },
          }),
        ]),
      )
      .orderBy('asset.fileCreatedAt', 'desc')
      .orderBy('asset_face.id')
      .executeTakeFirst();
    return row?.id ?? null;
  }

  async repairInvalidRepresentativeFaces(spaceId: string, db: Kysely<DB> | Transaction<DB> = this.db): Promise<void> {
    const people = await db
      .selectFrom('shared_space_person')
      .select(['id', 'representativeFaceId', 'representativeFaceSource'])
      .where('spaceId', '=', spaceId)
      .where('representativeFaceSource', '=', 'manual')
      .execute();

    for (const person of people) {
      const valid =
        !!person.representativeFaceId &&
        (await this.isSpacePersonRepresentativeFaceValid(person.id, person.representativeFaceId, db));
      if (valid) {
        continue;
      }

      await db
        .updateTable('shared_space_person')
        .set({
          representativeFaceSource: 'auto',
          representativeFaceId: await this.getFirstValidRepresentativeFaceForPerson(person.id, db),
        })
        .where('id', '=', person.id)
        .execute();
    }
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async repairOrphanedRepresentativeFaces(spaceId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    await db
      .updateTable('shared_space_person')
      .set((eb) => ({
        representativeFaceId: eb
          .selectFrom('shared_space_person_face')
          .innerJoin('face_search', 'face_search.faceId', 'shared_space_person_face.assetFaceId')
          .select('shared_space_person_face.assetFaceId')
          .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id')
          .limit(1),
      }))
      .where('shared_space_person.spaceId', '=', spaceId)
      .where('shared_space_person.representativeFaceId', 'is', null)
      .where('shared_space_person.representativeFaceSource', '=', 'auto')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('shared_space_person_face')
            .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id'),
        ),
      )
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async removePersonFacesByAssetIds(spaceId: string, assetIds: string[]) {
    const assetFaceSubquery = this.db
      .selectFrom('asset_face')
      .select('asset_face.id')
      .where('asset_face.assetId', 'in', assetIds);

    const spacePersonSubquery = this.db
      .selectFrom('shared_space_person')
      .select('shared_space_person.id')
      .where('shared_space_person.spaceId', '=', spaceId);

    const affectedPersonIds = await this.db
      .selectFrom('shared_space_person_face')
      .select('personId')
      .distinct()
      .where('assetFaceId', 'in', assetFaceSubquery)
      .where('personId', 'in', spacePersonSubquery)
      .execute();

    // Reached from unlinkLibrary / AlbumDelete / AlbumAssetsRemove — during the unmap itself. The
    // asset_face cascade deletes these same junction rows, so the two can cycle (#864). A single
    // statement is its own transaction, so re-running it is all the recovery needed.
    await retryOnDeadlock(() =>
      this.db
        .deleteFrom('shared_space_person_face')
        .where('assetFaceId', 'in', assetFaceSubquery)
        .where('personId', 'in', spacePersonSubquery)
        .execute(),
    );

    if (affectedPersonIds.length > 0) {
      await this.recountPersons(affectedPersonIds.map((r) => r.personId));
    }
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async removePersonFacesByLibrary(spaceId: string, libraryId: string) {
    const assetFaceSubquery = this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .select('asset_face.id')
      .where('asset.libraryId', '=', libraryId);

    const spacePersonSubquery = this.db
      .selectFrom('shared_space_person')
      .select('shared_space_person.id')
      .where('shared_space_person.spaceId', '=', spaceId);

    const affectedPersonIds = await this.db
      .selectFrom('shared_space_person_face')
      .select('personId')
      .distinct()
      .where('assetFaceId', 'in', assetFaceSubquery)
      .where('personId', 'in', spacePersonSubquery)
      .execute();

    // Reached from unlinkLibrary / AlbumDelete / AlbumAssetsRemove — during the unmap itself. The
    // asset_face cascade deletes these same junction rows, so the two can cycle (#864). A single
    // statement is its own transaction, so re-running it is all the recovery needed.
    await retryOnDeadlock(() =>
      this.db
        .deleteFrom('shared_space_person_face')
        .where('assetFaceId', 'in', assetFaceSubquery)
        .where('personId', 'in', spacePersonSubquery)
        .execute(),
    );

    if (affectedPersonIds.length > 0) {
      await this.recountPersons(affectedPersonIds.map((r) => r.personId));
    }
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getAlbumAssetIdsWithoutOtherSpacePath(spaceId: string, albumId: string): Promise<string[]> {
    // NB: arms are hand-rolled (not routed through spaceAlbumAssetExists) because the outer query
    // already selects from album_asset; the helper joins its OWN unaliased album_asset and a bare
    // correlateAssetId would resolve to the helper's join (a self-match returning every row).
    const rows = await this.db
      .selectFrom('album_asset')
      .select('album_asset.assetId')
      .where('album_asset.albumId', '=', albumId)
      // Not directly added to the space.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .whereRef('shared_space_asset.assetId', '=', 'album_asset.assetId')
              .where('shared_space_asset.spaceId', '=', spaceId),
          ),
        ),
      )
      // Not reachable via ANOTHER linked album's own contents (album_asset), excluding this album.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_album')
              .innerJoin('album', (join) =>
                join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_asset as other', 'other.albumId', 'shared_space_album.albumId')
              .whereRef('other.assetId', '=', 'album_asset.assetId')
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('shared_space_album.albumId', '!=', albumId),
          ),
        ),
      )
      // Not reachable via ANOTHER linked album's cross-owner contributions (album_space_asset, #764),
      // excluding this album — the arm the read layer unions but this anti-join previously omitted.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_album')
              .innerJoin('album', (join) =>
                join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_space_asset', (join) =>
                join
                  .onRef('album_space_asset.albumId', '=', 'shared_space_album.albumId')
                  .onRef('album_space_asset.spaceId', '=', 'shared_space_album.spaceId'),
              )
              .whereRef('album_space_asset.assetId', '=', 'album_asset.assetId')
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('shared_space_album.albumId', '!=', albumId),
          ),
        ),
      )
      // Not reachable via a linked library.
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .whereRef('asset.id', '=', 'album_asset.assetId')
              .where('shared_space_library.spaceId', '=', spaceId),
          ),
        ),
      )
      .execute();

    // #752 F1 (launch review): the severed album's CONTRIBUTED memberships (album_space_asset) are
    // candidates too — an asset whose only space path was a contribution into this album must be
    // swept, or its projected faces outlive the link. Same four anti-join retention arms as above.
    // CRITICAL: the outer MUST be aliased `as cand` and every arm correlated on `cand.assetId` — the
    // method's own header documents the self-correlation footgun (the album_asset outer is why the arms
    // are hand-rolled), and here the third arm itself joins album_space_asset (as `otherContribution`),
    // so an unaliased outer `album_space_asset.assetId` correlation is ambiguous / self-matches.
    const contributedRows = await this.db
      .selectFrom('album_space_asset as cand')
      .select('cand.assetId')
      .where('cand.albumId', '=', albumId)
      .where('cand.spaceId', '=', spaceId)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .whereRef('shared_space_asset.assetId', '=', 'cand.assetId')
              .where('shared_space_asset.spaceId', '=', spaceId),
          ),
        ),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_album')
              .innerJoin('album', (join) =>
                join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_asset as other', 'other.albumId', 'shared_space_album.albumId')
              .whereRef('other.assetId', '=', 'cand.assetId')
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('shared_space_album.albumId', '!=', albumId),
          ),
        ),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_album')
              .innerJoin('album', (join) =>
                join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_space_asset as otherContribution', (join) =>
                join
                  .onRef('otherContribution.albumId', '=', 'shared_space_album.albumId')
                  .onRef('otherContribution.spaceId', '=', 'shared_space_album.spaceId'),
              )
              .whereRef('otherContribution.assetId', '=', 'cand.assetId')
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('shared_space_album.albumId', '!=', albumId),
          ),
        ),
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .whereRef('asset.id', '=', 'cand.assetId')
              .where('shared_space_library.spaceId', '=', spaceId),
          ),
        ),
      )
      .execute();

    return [...new Set([...rows, ...contributedRows].map((r) => r.assetId))];
  }

  // Per-asset analogue of getAlbumAssetIdsWithoutOtherSpacePath. Call AFTER the album_asset
  // rows for the removed assets are deleted, so "any linked album" already excludes the album
  // they were removed from. Returns the subset of assetIds with NO remaining space path.
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async getAssetIdsWithoutOtherSpacePath(spaceId: string, assetIds: string[]): Promise<string[]> {
    if (assetIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.id', 'in', assetIds)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .whereRef('shared_space_asset.assetId', '=', 'asset.id')
              .where('shared_space_asset.spaceId', '=', spaceId),
          ),
        ),
      )
      // Album path — BOTH the album owner's own album_asset rows AND cross-owner album_space_asset
      // contributions (#764), via the canonical scope helper. Every read/visibility surface unions
      // both arms; routing retention through the same helper keeps them in agreement. Omitting the
      // contributed arm sweeps faces for assets still visible in the space via a contribution.
      .where((eb) => eb.not(spaceAlbumAssetExists(eb, { correlateAssetId: 'asset.id', scope: { spaceId } })))
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .innerJoin('asset as libAsset', 'libAsset.libraryId', 'shared_space_library.libraryId')
              .whereRef('libAsset.id', '=', 'asset.id')
              .where('shared_space_library.spaceId', '=', spaceId),
          ),
        ),
      )
      .execute();
    return rows.map((r) => r.id);
  }

  // L6: candidate assetIds for the stale-face sweep — every asset currently referenced by a
  // shared_space_person_face row for this space's persons. Feed the result into
  // getAssetIdsWithoutOtherSpacePath to find which of them have no remaining space path (a
  // path removed outside the service — cascade delete, or a failed fire-and-forget job — never
  // ran the synchronous removePersonFacesByAssetIds cleanup that unlinkAlbum/removeMember do).
  @GenerateSql({ params: [DummyValue.UUID] })
  async getSpacePersonFaceAssetIds(spaceId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .select('asset_face.assetId')
      .distinct()
      .where('shared_space_person.spaceId', '=', spaceId)
      .execute();
    return rows.map((r) => r.assetId);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async deleteOrphanedPersons(spaceId: string) {
    // onAssetDelete runs this immediately after recountPersons, so protecting only the recount
    // just moves the deadlock victim onto this DELETE (#864). Same treatment: resolve the orphans
    // and claim them in id order first, so this agrees on a lock order with every other writer,
    // then re-drive if the representativeFaceId cascade still picks us as the victim.
    await retryOnDeadlock(() =>
      this.db.transaction().execute(async (trx) => {
        const orphans = await trx
          .selectFrom('shared_space_person')
          .select('id')
          .where('spaceId', '=', spaceId)
          .where('id', 'not in', trx.selectFrom('shared_space_person_face').select('personId'))
          .orderBy('id')
          .forUpdate()
          .execute();

        if (orphans.length === 0) {
          return;
        }

        await trx
          .deleteFrom('shared_space_person')
          .where(
            'id',
            'in',
            orphans.map(({ id }) => id),
          )
          // re-checked under the claim: a person that gained a face must not be deleted
          .where('id', 'not in', trx.selectFrom('shared_space_person_face').select('personId'))
          .execute();
      }),
    );
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async deleteOrphanedPersonsByIds(spaceId: string, personIds: string[]): Promise<void> {
    if (personIds.length === 0) {
      return;
    }

    // Same claim-then-delete ordering as deleteOrphanedPersons (#864).
    await retryOnDeadlock(() =>
      this.db.transaction().execute(async (trx) => {
        const orphans = await trx
          .selectFrom('shared_space_person')
          .select('id')
          .where('spaceId', '=', spaceId)
          .where('id', 'in', [...new Set(personIds)].toSorted())
          .where('id', 'not in', trx.selectFrom('shared_space_person_face').select('personId'))
          .orderBy('id')
          .forUpdate()
          .execute();

        if (orphans.length === 0) {
          return;
        }

        await trx
          .deleteFrom('shared_space_person')
          .where(
            'id',
            'in',
            orphans.map(({ id }) => id),
          )
          .where('id', 'not in', trx.selectFrom('shared_space_person_face').select('personId'))
          .execute();
      }),
    );
  }

  @GenerateSql({ params: [] })
  async deleteAllOrphanedPersons() {
    await this.db
      .deleteFrom('shared_space_person')
      .where('id', 'not in', this.db.selectFrom('shared_space_person_face').select('personId'))
      .execute();
  }

  @GenerateSql({ params: [] })
  async deleteAllPersonFaces() {
    await this.db.deleteFrom('shared_space_person_face').execute();
  }

  @GenerateSql({ params: [] })
  async deleteAllPersons() {
    await this.db.deleteFrom('shared_space_person').execute();
  }

  @GenerateSql({ params: [] })
  async deleteAllPets() {
    // Mirror PersonRepository.deleteAllPets() for the shared-space copies: a pet-detection
    // reset must clear propagated pet people from every space's People view too. Deleting the
    // shared_space_person row cascades to its shared_space_person_face and _alias children, so
    // only pet-typed rows are removed and human people are left untouched.
    await this.db.deleteFrom('shared_space_person').where('type', '=', 'pet').execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  async recountPersons(personIds: string[], db: Kysely<DB> | Transaction<DB> = this.db) {
    if (personIds.length === 0) {
      return;
    }

    // A multi-row UPDATE takes its row locks in scan order, and the planner may pick a different
    // scan (so a different order) per connection.  Concurrent AssetDelete/face-match workers
    // recounting overlapping people therefore deadlocked against each other (#864).  Claim the
    // rows sorted by id first so every caller agrees on one global lock order.  The claim only
    // holds for the enclosing transaction, so open one when the caller did not supply it.
    if (db.isTransaction) {
      // A deadlock aborts the caller's entire transaction, so retrying inside it would only raise
      // "current transaction is aborted". Surfacing it lets the caller re-drive its own transaction.
      return this.recountPersonsLocked(personIds, db);
    }

    // Ordering the claim removes recount-vs-recount cycles but cannot remove every cycle: deleting
    // an asset makes Postgres lock these same rows to satisfy the representativeFaceId ON DELETE
    // SET NULL cascade, in face-deletion order, so a recount can still be picked as the victim.
    // Measured on the library-unmap repro at ~8.7k assets: 418 recount failures without this.
    return retryOnDeadlock(() => db.transaction().execute((trx) => this.recountPersonsLocked(personIds, trx)));
  }

  private async recountPersonsLocked(personIds: string[], db: Kysely<DB> | Transaction<DB>) {
    // Mirrors lockSpacePeopleForMerge, except a missing person is not an error here: a
    // concurrent worker may legitimately have deleted an orphaned person before we recount it.
    await db
      .selectFrom('shared_space_person')
      .select('id')
      .where('id', 'in', [...new Set(personIds)].toSorted())
      .orderBy('id')
      .forUpdate()
      .execute();

    await db
      .updateTable('shared_space_person')
      .set((eb) => ({
        faceCount: eb
          .selectFrom('shared_space_person_face')
          .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
          .innerJoin('asset', 'asset.id', 'asset_face.assetId')
          .where('asset_face.deletedAt', 'is', null)
          .where('asset_face.isVisible', 'is', true)
          .where('asset.deletedAt', 'is', null)
          .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
          .select((eb2) => eb2.fn.countAll().$castTo<number>().as('count'))
          .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id'),
        assetCount: eb
          .selectFrom('shared_space_person_face')
          .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
          .innerJoin('asset', 'asset.id', 'asset_face.assetId')
          .where('asset_face.deletedAt', 'is', null)
          .where('asset_face.isVisible', 'is', true)
          .where('asset.deletedAt', 'is', null)
          .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
          .select((eb2) =>
            eb2.fn
              .count(eb2.fn('distinct', ['asset_face.assetId']))
              .$castTo<number>()
              .as('count'),
          )
          .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id'),
      }))
      .where('id', 'in', personIds)
      .execute();
  }

  // ==========================================
  // Shared Space Person Alias CRUD
  // ==========================================

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getAlias(personId: string, userId: string) {
    return this.db
      .selectFrom('shared_space_person_alias')
      .selectAll()
      .where('personId', '=', personId)
      .where('userId', '=', userId)
      .executeTakeFirst();
  }

  upsertAlias(values: Insertable<SharedSpacePersonAliasTable>) {
    return this.db
      .insertInto('shared_space_person_alias')
      .values(values)
      .onConflict((oc) => oc.columns(['personId', 'userId']).doUpdateSet((eb) => ({ alias: eb.ref('excluded.alias') })))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async deleteAlias(personId: string, userId: string) {
    await this.db
      .deleteFrom('shared_space_person_alias')
      .where('personId', '=', personId)
      .where('userId', '=', userId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getAliasesBySpaceAndUser(spaceId: string, userId: string) {
    return this.db
      .selectFrom('shared_space_person_alias')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_alias.personId')
      .where('shared_space_person.spaceId', '=', spaceId)
      .where('shared_space_person_alias.userId', '=', userId)
      .selectAll('shared_space_person_alias')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async migrateAliases(fromPersonId: string, toPersonId: string) {
    // Get aliases from the source person
    const sourceAliases = await this.db
      .selectFrom('shared_space_person_alias')
      .selectAll()
      .where('personId', '=', fromPersonId)
      .execute();

    for (const alias of sourceAliases) {
      await this.db
        .insertInto('shared_space_person_alias')
        .values({ personId: toPersonId, userId: alias.userId, alias: alias.alias })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }

    // Delete source aliases
    await this.db.deleteFrom('shared_space_person_alias').where('personId', '=', fromPersonId).execute();
  }

  // ==========================================
  // Face Matching Queries
  // ==========================================

  @GenerateSql({
    params: [DummyValue.UUID, DummyValue.VECTOR, { maxDistance: 0.6, numResults: 1 }],
  })
  findClosestSpacePerson(
    spaceId: string,
    embedding: string,
    options: { maxDistance: number; numResults: number; excludePersonIds?: string[]; type?: string },
  ): Promise<SpacePersonMatch[]> {
    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Face])}`.execute(trx);
      return await trx
        .with('cte', (qb) =>
          qb
            .selectFrom('shared_space_person')
            .innerJoin('shared_space_person_face', 'shared_space_person_face.personId', 'shared_space_person.id')
            .innerJoin('face_search', 'face_search.faceId', 'shared_space_person_face.assetFaceId')
            .select([
              'shared_space_person.id as personId',
              'shared_space_person.name',
              'shared_space_person.identityId',
              'shared_space_person.type',
              sql<number>`face_search.embedding <=> ${embedding}`.as('distance'),
            ])
            .where('shared_space_person.spaceId', '=', spaceId)
            .$if(!!options.excludePersonIds?.length, (qb) =>
              qb.where('shared_space_person.id', 'not in', options.excludePersonIds!),
            )
            .$if(!!options.type, (qb) => qb.where('shared_space_person.type', '=', options.type!))
            .orderBy('distance')
            .limit(options.numResults),
        )
        .selectFrom('cte')
        .selectAll()
        .where('cte.distance', '<=', options.maxDistance)
        .execute();
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getSpacePersonsWithEmbeddings(spaceId: string): Promise<SpacePersonWithEmbedding[]> {
    return this.db
      .selectFrom('shared_space_person')
      .innerJoin('shared_space_person_face', (join) =>
        join
          .onRef('shared_space_person_face.personId', '=', 'shared_space_person.id')
          .onRef('shared_space_person_face.assetFaceId', '=', 'shared_space_person.representativeFaceId'),
      )
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person.representativeFaceId')
      .innerJoin('face_search', 'face_search.faceId', 'shared_space_person.representativeFaceId')
      .select([
        'shared_space_person.id',
        'shared_space_person.name',
        'shared_space_person.type',
        'shared_space_person.identityId',
        'shared_space_person.isHidden',
        'shared_space_person.faceCount',
        'shared_space_person.representativeFaceId',
        'shared_space_person.representativeFaceSource',
        'face_search.embedding',
      ])
      .where('shared_space_person.spaceId', '=', spaceId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, 20] })
  getSpacePersonAssignedFaceEmbeddings(spacePersonId: string, limit: number) {
    return this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('face_search', 'face_search.faceId', 'shared_space_person_face.assetFaceId')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .select('face_search.embedding')
      .where('shared_space_person_face.personId', '=', spacePersonId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .orderBy('shared_space_person_face.assetFaceId', 'asc')
      .limit(limit)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  getAssignedFaceIdsForSpace(spaceId: string, assetFaceIds: string[]) {
    return this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .select('shared_space_person_face.assetFaceId')
      .where('shared_space_person.spaceId', '=', spaceId)
      .where('shared_space_person_face.assetFaceId', '=', anyUuid(assetFaceIds))
      .execute();
  }

  getScannableSpacePeopleWithUnassignedFaces() {
    return this.db
      .selectFrom('shared_space_person')
      .innerJoin('shared_space', 'shared_space.id', 'shared_space_person.spaceId')
      .select(['shared_space_person.id', 'shared_space_person.spaceId'])
      .where(sql`BTRIM("shared_space_person"."name")`, '<>', '')
      .where('shared_space_person.isHidden', 'is', false)
      .where('shared_space_person.type', '=', 'person')
      .where('shared_space.faceRecognitionEnabled', 'is', true)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('asset', 'asset.id', 'asset_face.assetId')
            .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
            .select('asset_face.id')
            .where('asset.deletedAt', 'is', null)
            .where('asset_face.personId', 'is', null)
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.sourceType', '=', SourceType.MachineLearning)
            .where((eb) => spaceVisibilityGate(eb))
            .where((eb) =>
              eb.not(
                eb.exists(
                  eb
                    .selectFrom('shared_space_person_face')
                    .innerJoin('shared_space_person as assigned_person', (join) =>
                      join
                        .onRef('assigned_person.id', '=', 'shared_space_person_face.personId')
                        .onRef('assigned_person.spaceId', '=', 'shared_space_person.spaceId'),
                    )
                    .select('shared_space_person_face.assetFaceId')
                    .whereRef('shared_space_person_face.assetFaceId', '=', 'asset_face.id'),
                ),
              ),
            )
            // All THREE space access paths (direct / linked library / linked album +
            // cross-owner contributions) via the canonical helper.
            .where((eb) =>
              eb.or(
                spaceAssetPathBranches(eb, {
                  correlateAssetId: 'asset.id',
                  correlateLibraryId: 'asset.libraryId',
                  scope: { spaceIdRef: 'shared_space_person.spaceId' },
                }),
              ),
            ),
        ),
      )
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getAssetFacesForMatching(assetId: string): Promise<AssetFaceForMatching[]> {
    return this.db
      .selectFrom('asset_face')
      .leftJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .leftJoin('person', 'person.id', 'asset_face.personId')
      .leftJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
      .select([
        'asset_face.id',
        'asset_face.assetId',
        'asset_face.personId',
        'face_identity_face.identityId',
        'person.type',
        'face_search.embedding',
      ])
      .where('asset_face.assetId', '=', assetId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async isAssetInSpace(spaceId: string, assetId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
          .select('shared_space_asset.assetId as id')
          .where('shared_space_asset.spaceId', '=', spaceId)
          .where('shared_space_asset.assetId', '=', assetId)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .select('asset.id')
              .where('shared_space_library.spaceId', '=', spaceId)
              .where('asset.id', '=', assetId)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .union(
            this.db
              .selectFrom('shared_space_album')
              .innerJoin('album', (j) =>
                j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .innerJoin('asset', 'asset.id', 'album_asset.assetId')
              .select('asset.id')
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('asset.id', '=', assetId)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .union(
            this.db
              .selectFrom('asset')
              .select('asset.id')
              .where('asset.id', '=', assetId)
              // Cross-owner contributions (#764) live in album_space_asset, not album_asset. Every
              // read/timeline surface unions them via the scope helper, so this surface must too.
              .where((eb) =>
                spaceContributedAssetExists(eb, {
                  correlateAssetId: 'asset.id',
                  scope: { spaceId },
                }),
              )
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .as('combined'),
      )
      .select('combined.id')
      .limit(1)
      .executeTakeFirst();
    return !!result;
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async isFaceInSpace(spaceId: string, faceId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
          .innerJoin('asset_face', 'asset_face.assetId', 'shared_space_asset.assetId')
          .select('asset_face.id')
          .where('shared_space_asset.spaceId', '=', spaceId)
          .where('asset_face.id', '=', faceId)
          .where('asset_face.deletedAt', 'is', null)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where((eb) => spaceVisibilityGate(eb))
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
              .select('asset_face.id')
              .where('shared_space_library.spaceId', '=', spaceId)
              .where('asset_face.id', '=', faceId)
              .where('asset_face.deletedAt', 'is', null)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where((eb) => spaceVisibilityGate(eb)),
          )
          .union(
            this.db
              .selectFrom('shared_space_album')
              .innerJoin('album', (join) =>
                join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .innerJoin('asset', 'asset.id', 'album_asset.assetId')
              .innerJoin('asset_face', 'asset_face.assetId', 'asset.id')
              .select('asset_face.id')
              .where('shared_space_album.spaceId', '=', spaceId)
              .where('asset_face.id', '=', faceId)
              .where('asset_face.deletedAt', 'is', null)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where((eb) => spaceVisibilityGate(eb))
              .where('shared_space_album.showInTimeline', '=', true),
          )
          .as('combined'),
      )
      .select('combined.id')
      .limit(1)
      .executeTakeFirst();
    return !!result;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getAssetIdForFace(faceId: string): Promise<string | null> {
    const result = await this.db
      .selectFrom('asset_face')
      .select('assetId')
      .where('id', '=', faceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return result?.assetId ?? null;
  }

  @GenerateSql({ params: [DummyValue.UUID, { limit: DummyValue.NUMBER, afterAssetId: DummyValue.UUID }] })
  getAssetIdsInSpacePage(spaceId: string, options?: { limit?: number; afterAssetId?: string }) {
    const limit = options?.limit ?? 1000;
    const afterAssetId = options?.afterAssetId;
    const combined = this.db
      .selectFrom('shared_space_asset')
      .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
      .select('shared_space_asset.assetId as id')
      .where('shared_space_asset.spaceId', '=', spaceId)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
      .union(
        this.db
          .selectFrom('shared_space_library')
          .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
          .select('asset.id')
          .where('shared_space_library.spaceId', '=', spaceId)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
      )
      .union(
        this.db
          .selectFrom('asset')
          .select('asset.id')
          // Album path: owner album_asset + cross-owner album_space_asset contributions (#764).
          // Face membership is NOT gated by showInTimeline, so the reconcile re-projects every album
          // asset's faces — matching the retention helper's union so projection and retention agree.
          .where((eb) => spaceAlbumAssetExists(eb, { correlateAssetId: 'asset.id', scope: { spaceId } }))
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
      )
      .as('combined');

    return this.db
      .selectFrom(combined)
      .select('combined.id as assetId')
      .$if(!!afterAssetId, (qb) => qb.where('combined.id', '>', afterAssetId!))
      .orderBy('combined.id', 'asc')
      .limit(limit)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getAssetIdsInSpace(spaceId: string) {
    return this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('asset', 'asset.id', 'shared_space_asset.assetId')
          .select('shared_space_asset.assetId as id')
          .where('shared_space_asset.spaceId', '=', spaceId)
          .where('asset.deletedAt', 'is', null)
          .where('asset.isOffline', '=', false)
          .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .select('asset.id')
              .where('shared_space_library.spaceId', '=', spaceId)
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where('asset.visibility', 'in', visibleSpaceAssetVisibilities),
          )
          .as('combined'),
      )
      .select('combined.id as assetId')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getSpaceIdsForAsset(assetId: string) {
    return this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('shared_space', 'shared_space.id', 'shared_space_asset.spaceId')
          .select('shared_space_asset.spaceId')
          .where('shared_space_asset.assetId', '=', assetId)
          .where('shared_space.faceRecognitionEnabled', '=', true)
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('asset', 'asset.libraryId', 'shared_space_library.libraryId')
              .innerJoin('shared_space', 'shared_space.id', 'shared_space_library.spaceId')
              .select('shared_space_library.spaceId')
              .where('asset.id', '=', assetId)
              .where('shared_space.faceRecognitionEnabled', '=', true),
          )
          .union(
            this.db
              .selectFrom('shared_space_album')
              .innerJoin('album', (j) =>
                j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
              )
              .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
              .innerJoin('shared_space', 'shared_space.id', 'shared_space_album.spaceId')
              .select('shared_space_album.spaceId')
              .where('album_asset.assetId', '=', assetId)
              .where('shared_space.faceRecognitionEnabled', '=', true),
          )
          .as('combined'),
      )
      .select('combined.spaceId')
      .execute();
  }

  /**
   * Returns the (spaceId, personId) pairs for every shared-space person face that references
   * an asset_face belonging to the given asset.  Must be called BEFORE the asset row is deleted
   * (i.e. before the asset → asset_face → shared_space_person_face cascade runs).
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  getSpacePersonsForAsset(assetId: string) {
    return this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .select(['shared_space_person.spaceId', 'shared_space_person_face.personId'])
      .distinct()
      .where('asset_face.assetId', '=', assetId)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async isPersonFaceAssigned(assetFaceId: string, spaceId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .select('shared_space_person_face.assetFaceId')
      .where('shared_space_person_face.assetFaceId', '=', assetFaceId)
      .where('shared_space_person.spaceId', '=', spaceId)
      .limit(1)
      .executeTakeFirst();
    return !!result;
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getPersonFaceAssignmentsForSpace(assetFaceId: string, spaceId: string): Promise<SpaceFaceAssignment[]> {
    return this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .select(['shared_space_person_face.personId', 'shared_space_person.identityId', 'shared_space_person.type'])
      .where('shared_space_person_face.assetFaceId', '=', assetFaceId)
      .where('shared_space_person.spaceId', '=', spaceId)
      .orderBy('shared_space_person_face.personId')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async removePersonFaceAssignmentsForSpaceFace(spaceId: string, assetFaceId: string): Promise<string[]> {
    const assignments = await this.db
      .selectFrom('shared_space_person_face')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'shared_space_person_face.personId')
      .select('shared_space_person_face.personId')
      .where('shared_space_person_face.assetFaceId', '=', assetFaceId)
      .where('shared_space_person.spaceId', '=', spaceId)
      .orderBy('shared_space_person_face.personId')
      .execute();
    const personIds = assignments.map(({ personId }) => personId);

    if (personIds.length === 0) {
      return [];
    }

    await this.db
      .deleteFrom('shared_space_person_face')
      .where('assetFaceId', '=', assetFaceId)
      .where('personId', 'in', personIds)
      .execute();

    return personIds;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getPetFacesForAsset(assetId: string): Promise<PetFaceForMatching[]> {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('person', 'person.id', 'asset_face.personId')
      .select(['asset_face.id', 'asset_face.assetId', 'asset_face.personId', 'person.identityId', 'person.type'])
      .where('asset_face.assetId', '=', assetId)
      .where('asset_face.deletedAt', 'is', null)
      .where('person.type', '=', 'pet')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  findSpacePersonByLinkedPersonId(spaceId: string, personId: string) {
    return this.db
      .selectFrom('shared_space_person')
      .innerJoin('shared_space_person_face', 'shared_space_person_face.personId', 'shared_space_person.id')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .selectAll('shared_space_person')
      .where('shared_space_person.spaceId', '=', spaceId)
      .where('asset_face.personId', '=', personId)
      .limit(1)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async findSpacePersonsByLinkedPersonIds(spaceId: string, personIds: string[]) {
    if (personIds.length === 0) {
      return new Map<string, LinkedSpacePerson>();
    }

    const results = await this.db
      .selectFrom('shared_space_person')
      .innerJoin('shared_space_person_face', 'shared_space_person_face.personId', 'shared_space_person.id')
      .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
      .select([
        'shared_space_person.id',
        'shared_space_person.name',
        'shared_space_person.isHidden',
        'shared_space_person.birthDate',
        'shared_space_person.updatedAt',
        'shared_space_person.type',
        'asset_face.personId',
      ])
      .where('shared_space_person.spaceId', '=', spaceId)
      .where('asset_face.personId', 'in', personIds)
      .groupBy([
        'shared_space_person.id',
        'shared_space_person.name',
        'shared_space_person.isHidden',
        'shared_space_person.birthDate',
        'shared_space_person.updatedAt',
        'shared_space_person.type',
        'asset_face.personId',
      ])
      .execute();

    const map = new Map<string, LinkedSpacePerson>();
    for (const row of results) {
      if (row.personId) {
        map.set(row.personId, {
          id: row.id,
          isHidden: row.isHidden,
          name: row.name,
          birthDate: row.birthDate,
          updatedAt: row.updatedAt,
          type: row.type,
        });
      }
    }
    return map;
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async findSpaceForAssetAndUser(assetId: string, userId: string) {
    return this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
          .innerJoin('asset', (join) =>
            join.onRef('asset.id', '=', 'shared_space_asset.assetId').on('asset.deletedAt', 'is', null),
          )
          .select('shared_space_asset.spaceId')
          .where('shared_space_asset.assetId', '=', assetId)
          .where('shared_space_member.userId', '=', userId)
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
              .innerJoin('asset', (join) =>
                join
                  .onRef('asset.libraryId', '=', 'shared_space_library.libraryId')
                  .on('asset.id', '=', assetId)
                  .on('asset.deletedAt', 'is', null)
                  .on('asset.isOffline', '=', false),
              )
              .select('shared_space_library.spaceId')
              .where('shared_space_member.userId', '=', userId),
          )
          .as('combined'),
      )
      .select('combined.spaceId')
      .limit(1)
      .executeTakeFirst();
  }
}
