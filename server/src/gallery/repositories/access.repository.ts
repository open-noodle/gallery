import { type Kysely } from 'kysely';
import { ChunkedSet, DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetVisibility, SharedSpaceRole } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { withDefaultVisibility } from 'src/utils/database.js';
import { setDifference } from 'src/utils/set.js';
import {
  spaceAlbumAssetExists,
  spaceAssetPathBranches,
  spaceVisibilityGate,
  spaceVisibleAssetVisibilities,
} from 'src/utils/shared-space-album-scope.js';

// Fork access checks, mounted on AccessRepository next to upstream's inner classes (spaceAlbum, spaceAsset,
// galleryPerson, sharedSpace) so upstream's classes keep only upstream methods. The grants built on them live in
// src/gallery/utils/access-grants.ts.

export class SpaceAlbumAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkSpaceLinkedAlbumAccess(userId: string, albumIds: Set<string>) {
    if (albumIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('album')
      .select('album.id')
      .distinct()
      .innerJoin('shared_space_album', 'shared_space_album.albumId', 'album.id')
      .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
      .where('album.id', 'in', [...albumIds])
      .where('album.deletedAt', 'is', null)
      .where('shared_space_member.userId', '=', userId)
      .where('shared_space_member.role', 'in', [SharedSpaceRole.Owner, SharedSpaceRole.Editor])
      .execute()
      .then((albums) => new Set(albums.map((album) => album.id)));
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkSpaceLinkedAlbumReadAccess(userId: string, albumIds: Set<string>) {
    if (albumIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('album')
      .select('album.id')
      .distinct()
      .innerJoin('shared_space_album', 'shared_space_album.albumId', 'album.id')
      .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
      .where('album.id', 'in', [...albumIds])
      .where('album.deletedAt', 'is', null)
      .where('shared_space_member.userId', '=', userId)
      .execute()
      .then((albums) => new Set(albums.map((album) => album.id)));
  }
}

export class SpaceAssetAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkSpaceAccess(userId: string, assetIds: Set<string>) {
    if (assetIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
          .innerJoin('asset', (join) =>
            join.onRef('asset.id', '=', 'shared_space_asset.assetId').on('asset.deletedAt', 'is', null),
          )
          .select(['asset.id', 'asset.livePhotoVideoId'])
          .where('shared_space_member.userId', '=', userId)
          .where((eb) => spaceVisibilityGate(eb))
          .where((eb) =>
            eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
          )
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
              .innerJoin('asset', (join) =>
                join
                  .onRef('asset.libraryId', '=', 'shared_space_library.libraryId')
                  .on('asset.deletedAt', 'is', null)
                  .on('asset.isOffline', '=', false),
              )
              .select(['asset.id', 'asset.livePhotoVideoId'])
              .where('shared_space_member.userId', '=', userId)
              .where((eb) => spaceVisibilityGate(eb))
              .where((eb) =>
                eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
              ),
          )
          .union(
            this.db
              .selectFrom('asset')
              .select(['asset.id', 'asset.livePhotoVideoId'])
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where((eb) => spaceVisibilityGate(eb))
              .where((eb) =>
                eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
              )
              // A linked album's own rows, or a contribution made through that same space (#764).
              .where((eb) =>
                spaceAlbumAssetExists(eb, {
                  correlateAssetId: 'asset.id',
                  scope: { memberUserId: userId },
                  albumTimelineGate: 'none',
                }),
              ),
          )
          .as('combined'),
      )
      .select(['combined.id', 'combined.livePhotoVideoId'])
      .execute()
      .then((assets) => {
        const allowedIds = new Set<string>();
        for (const asset of assets) {
          if (asset.id && assetIds.has(asset.id)) {
            allowedIds.add(asset.id);
          }
          if (asset.livePhotoVideoId && assetIds.has(asset.livePhotoVideoId)) {
            allowedIds.add(asset.livePhotoVideoId);
          }
        }
        return allowedIds;
      });
  }

  /**
   * A stack is readable when every photo StackRepository.getById returns for it (live, default visibilities)
   * is readable through a space, so the stack never hands out a photo the member cannot see.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkSpaceStackAccess(userId: string, stackIds: Set<string>) {
    if (stackIds.size === 0) {
      return new Set<string>();
    }

    const assets = await this.db
      .selectFrom('asset')
      .select(['asset.id', 'asset.stackId'])
      .where('asset.stackId', 'in', [...stackIds])
      .where('asset.deletedAt', 'is', null)
      .$call(withDefaultVisibility)
      .execute();
    const readable = await this.checkSpaceAccess(userId, new Set(assets.map((asset) => asset.id)));

    const allowed = new Set<string>();
    const denied = new Set<string>();
    for (const { id, stackId } of assets) {
      if (stackId) {
        (readable.has(id) ? allowed : denied).add(stackId);
      }
    }
    return setDifference(allowed, denied);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 2 })
  async checkSpaceAccessForSpace(userId: string, spaceId: string, assetIds: Set<string>) {
    if (assetIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
          .innerJoin('asset', (join) =>
            join.onRef('asset.id', '=', 'shared_space_asset.assetId').on('asset.deletedAt', 'is', null),
          )
          .select(['asset.id', 'asset.livePhotoVideoId'])
          .where('shared_space_member.userId', '=', userId)
          .where('shared_space_asset.spaceId', '=', spaceId)
          .where((eb) => spaceVisibilityGate(eb))
          .where((eb) =>
            eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
          )
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
              .innerJoin('asset', (join) =>
                join
                  .onRef('asset.libraryId', '=', 'shared_space_library.libraryId')
                  .on('asset.deletedAt', 'is', null)
                  .on('asset.isOffline', '=', false),
              )
              .select(['asset.id', 'asset.livePhotoVideoId'])
              .where('shared_space_member.userId', '=', userId)
              .where('shared_space_library.spaceId', '=', spaceId)
              .where((eb) => spaceVisibilityGate(eb))
              .where((eb) =>
                eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
              ),
          )
          .union(
            this.db
              .selectFrom('asset')
              .select(['asset.id', 'asset.livePhotoVideoId'])
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where((eb) => spaceVisibilityGate(eb))
              .where((eb) =>
                eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
              )
              // A linked album's own rows, or a contribution made through that same space (#764).
              .where((eb) =>
                spaceAlbumAssetExists(eb, {
                  correlateAssetId: 'asset.id',
                  scope: { memberUserId: userId, spaceId },
                  albumTimelineGate: 'none',
                }),
              ),
          )
          .as('combined'),
      )
      .select(['combined.id', 'combined.livePhotoVideoId'])
      .execute()
      .then((assets) => {
        const allowedIds = new Set<string>();
        for (const asset of assets) {
          if (asset.id && assetIds.has(asset.id)) {
            allowedIds.add(asset.id);
          }
          if (asset.livePhotoVideoId && assetIds.has(asset.livePhotoVideoId)) {
            allowedIds.add(asset.livePhotoVideoId);
          }
        }
        return allowedIds;
      });
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkSpaceEditAccess(userId: string, assetIds: Set<string>) {
    if (assetIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom(
        this.db
          .selectFrom('shared_space_asset')
          .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_asset.spaceId')
          .innerJoin('asset', (join) =>
            join.onRef('asset.id', '=', 'shared_space_asset.assetId').on('asset.deletedAt', 'is', null),
          )
          .select(['asset.id', 'asset.livePhotoVideoId'])
          .where('shared_space_member.userId', '=', userId)
          .where((eb) => spaceVisibilityGate(eb))
          .where((eb) =>
            eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
          )
          .where('shared_space_member.role', 'in', ['editor', 'owner'])
          .where((eb) =>
            eb.exists(
              eb
                .selectFrom('shared_space_member as owner_member')
                .select(eb.lit(1).as('exists'))
                .whereRef('owner_member.spaceId', '=', 'shared_space_asset.spaceId')
                .whereRef('owner_member.userId', '=', 'asset.ownerId'),
            ),
          )
          .union(
            this.db
              .selectFrom('shared_space_library')
              .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_library.spaceId')
              .innerJoin('asset', (join) =>
                join
                  .onRef('asset.libraryId', '=', 'shared_space_library.libraryId')
                  .on('asset.deletedAt', 'is', null)
                  .on('asset.isOffline', '=', false),
              )
              .select(['asset.id', 'asset.livePhotoVideoId'])
              .where('shared_space_member.userId', '=', userId)
              .where((eb) => spaceVisibilityGate(eb))
              .where((eb) =>
                eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
              )
              .where('shared_space_member.role', 'in', ['editor', 'owner'])
              .where((eb) =>
                eb.exists(
                  eb
                    .selectFrom('shared_space_member as owner_member')
                    .select(eb.lit(1).as('exists'))
                    .whereRef('owner_member.spaceId', '=', 'shared_space_library.spaceId')
                    .whereRef('owner_member.userId', '=', 'asset.ownerId'),
                ),
              ),
          )
          .union(
            this.db
              .selectFrom('asset')
              .innerJoin('shared_space_member', (join) =>
                join
                  .on('shared_space_member.userId', '=', userId)
                  .on('shared_space_member.role', 'in', [SharedSpaceRole.Editor, SharedSpaceRole.Owner]),
              )
              .select(['asset.id', 'asset.livePhotoVideoId'])
              .where('asset.deletedAt', 'is', null)
              .where('asset.isOffline', '=', false)
              .where((eb) => spaceVisibilityGate(eb))
              .where((eb) =>
                eb.or([eb('asset.id', 'in', [...assetIds]), eb('asset.livePhotoVideoId', 'in', [...assetIds])]),
              )
              // The album leg. `spaceIdRef` correlates the album's space to the actor's OWN membership
              // row, which is what makes the owner-is-member check below bind to the same space (spec
              // §2.4). Gate 'none' on purpose: editability must not follow a timeline display toggle.
              .where((eb) =>
                spaceAlbumAssetExists(eb, {
                  correlateAssetId: 'asset.id',
                  scope: { spaceIdRef: 'shared_space_member.spaceId' },
                  albumTimelineGate: 'none',
                }),
              )
              .where((eb) =>
                eb.exists(
                  eb
                    .selectFrom('shared_space_member as owner_member')
                    .select(eb.lit(1).as('exists'))
                    .whereRef('owner_member.spaceId', '=', 'shared_space_member.spaceId')
                    .whereRef('owner_member.userId', '=', 'asset.ownerId'),
                ),
              ),
          )
          .as('combined'),
      )
      .select(['combined.id', 'combined.livePhotoVideoId'])
      .execute()
      .then((assets) => {
        const allowedIds = new Set<string>();
        for (const asset of assets) {
          if (asset.id && assetIds.has(asset.id)) {
            allowedIds.add(asset.id);
          }
          if (asset.livePhotoVideoId && assetIds.has(asset.livePhotoVideoId)) {
            allowedIds.add(asset.livePhotoVideoId);
          }
        }
        return allowedIds;
      });
  }
}

export class GalleryPersonAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkOwnerAccess(userId: string, personGroupIds: Set<string>) {
    if (personGroupIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('person')
      .select('person.personGroupId')
      .where('person.personGroupId', 'in', [...personGroupIds])
      .where('person.ownerId', '=', userId)
      .execute()
      .then((persons) => new Set(persons.map((person) => person.personGroupId)));
  }

  /**
   * Fork (#869 follow-up): read access to a PERSON is granted off any one reachable face, but the person
   * thumbnail is a crop of one specific photo — the representative face `person.faceAssetId` points at.
   * Returns the subset whose representative face does NOT sit in the Locked Folder; a person with no
   * representative face at all has no locked source to leak and stays in the set.
   */
  @GenerateSql({ params: [DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 0 })
  async checkUnlockedThumbnailAccess(personIds: Set<string>) {
    if (personIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('person')
      .select('person.personGroupId')
      .leftJoin('asset_face', 'asset_face.id', 'person.faceAssetId')
      .leftJoin('asset', 'asset.id', 'asset_face.assetId')
      .where('person.personGroupId', 'in', [...personIds])
      .where((eb) => eb.or([eb('asset.visibility', 'is', null), eb('asset.visibility', '!=', AssetVisibility.Locked)]))
      .execute()
      .then((persons) => new Set(persons.map((person) => person.personGroupId)));
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkSharedSpaceAccess(userId: string, personIds: Set<string>) {
    if (personIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('person')
      .select('person.personGroupId')
      .where('person.personGroupId', 'in', [...personIds])
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('asset', (join) =>
              join
                .onRef('asset.id', '=', 'asset_face.assetId')
                .on('asset.deletedAt', 'is', null)
                // rbac-7 (deny-only widening): widen from Timeline-only to the shareable set
                // (Timeline + Archive) so a person appearing only on Archived space assets — shown in the
                // space people grid via getPersonsBySpaceId — is also granted PersonRead. Never Hidden/Locked.
                .on('asset.visibility', 'in', spaceVisibleAssetVisibilities),
            )
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where((eb) =>
              eb.or(
                spaceAssetPathBranches(eb, {
                  correlateAssetId: 'asset.id',
                  correlateLibraryId: 'asset.libraryId',
                  scope: { memberUserId: userId },
                  albumTimelineGate: 'none',
                }),
              ),
            ),
        ),
      )
      .execute()
      .then((persons) => new Set(persons.map((person) => person.personGroupId)));
  }

  // Fork RBAC (Slice 3 / M2): checkSharedSpaceAccess above proves PersonRead reachability for ANY
  // space role (including Viewer). Mutating the owner's GLOBAL representative face must be limited
  // to the owner or an Editor/Owner of a space the person is shared through — this mirrors
  // checkSharedSpaceAccess exactly except for the added `memberRole` filter.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkSharedSpaceEditAccess(userId: string, personIds: Set<string>) {
    if (personIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('person')
      .select('person.personGroupId')
      .where('person.personGroupId', 'in', [...personIds])
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('asset', (join) =>
              join
                .onRef('asset.id', '=', 'asset_face.assetId')
                .on('asset.deletedAt', 'is', null)
                // rbac-7 (deny-only widening): widen from Timeline-only to the shareable set
                // (Timeline + Archive) so a person appearing only on Archived space assets — shown in the
                // space people grid via getPersonsBySpaceId — is also granted PersonRead. Never Hidden/Locked.
                .on('asset.visibility', 'in', spaceVisibleAssetVisibilities),
            )
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where((eb) =>
              eb.or(
                spaceAssetPathBranches(eb, {
                  correlateAssetId: 'asset.id',
                  correlateLibraryId: 'asset.libraryId',
                  scope: { memberUserId: userId, memberRole: [SharedSpaceRole.Owner, SharedSpaceRole.Editor] },
                  albumTimelineGate: 'none',
                }),
              ),
            ),
        ),
      )
      .execute()
      .then((persons) => new Set(persons.map((person) => person.personGroupId)));
  }
}

export class SharedSpaceAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkMemberAccess(userId: string, spaceIds: Set<string>) {
    if (spaceIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('shared_space_member')
      .select('shared_space_member.spaceId')
      .where('shared_space_member.spaceId', 'in', [...spaceIds])
      .where('shared_space_member.userId', '=', userId)
      .execute()
      .then((rows) => new Set(rows.map((row) => row.spaceId)));
  }
}
