import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Insertable, Kysely, sql, SqlBool, Transaction, Updateable } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { AssetFace } from 'src/database';
import { Chunked, ChunkedArray, DummyValue, GenerateSql } from 'src/decorators';
import { AssetFileType, AssetVisibility, SourceType, UserMetadataKey } from 'src/enum';
import { DB } from 'src/schema';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { FaceSearchTable } from 'src/schema/tables/face-search.table';
import { PersonGroupTable } from 'src/schema/tables/person-group.table';
import { PersonTable } from 'src/schema/tables/person.table';
import { asUuid, dummy, inSharedAlbum, removeUndefinedKeys, withFilePath } from 'src/utils/database';
import { retargetDeclinePersonId } from 'src/utils/face-decline-merge';
import { reviewableAssetVisibility } from 'src/utils/face-review';
import { retargetVerdictPersonId } from 'src/utils/face-verdict-merge';
import { paginationHelper, PaginationOptions } from 'src/utils/pagination';
import {
  spaceAssetPathBranches,
  spaceVisibilityGate,
  spaceVisibleAssetVisibilities,
} from 'src/utils/shared-space-album-scope';

export interface PersonSearchOptions {
  withHidden: boolean;
  closestFaceAssetId?: string;
}

export interface PersonNameSearchOptions {
  withHidden?: boolean;
  /**
   * Fork (#869 follow-up): mirrors `AccessRepository.asset.checkOwnerAccess` — without an elevated
   * session the caller must not see anything that only exists inside their Locked Folder.
   */
  hasElevatedPermission?: boolean;
}

export interface PersonNameResponse {
  personGroupId: string;
  name: string;
}

export interface AssetFaceId {
  assetId: string;
  personGroupId: string;
}

export interface UpdateFacesData {
  oldPersonGroupId?: string;
  faceIds?: string[];
  ownerId?: string;
  newPersonGroupId: string;
}

export interface PersonStatistics {
  assets: number;
  faces: number;
}

export interface PeopleOverviewStatistics {
  total: number;
  hidden: number;
  detectedFaceCount: number;
}

export interface PeopleFaceStatistics {
  detectedFaceCount: number;
  assignedVisibleFaceCount: number;
  namedVisiblePersonCount: number;
  assignedHiddenFaceCount: number;
  unassignedFaceCount: number;
}

export interface PeopleFaceStatisticsOptions {
  minimumFaceCount?: number;
}

const peopleAssetVisibilities = spaceVisibleAssetVisibilities;

const isBlank = (value: string | null | undefined) => !value || value.trim().length === 0;

/**
 * Correlated "does this `person` row have a live, visible face on a locked (or non-locked) asset?"
 * subquery. Only counts faces that are themselves live and visible, so a person left behind by a
 * deleted or hidden face is not treated as backed by that face's asset.
 */
const visibleFaceOnAsset = (eb: ExpressionBuilder<DB, 'person'>, { locked }: { locked: boolean }) =>
  eb
    .selectFrom('asset_face')
    .innerJoin('asset', 'asset.id', 'asset_face.assetId')
    .select('asset_face.id')
    .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
    .where('asset_face.deletedAt', 'is', null)
    .where('asset_face.isVisible', 'is', true)
    .where('asset.visibility', locked ? '=' : '!=', AssetVisibility.Locked);

export interface DeleteFacesOptions {
  sourceType: SourceType;
}

export interface GetAllPeopleOptions {
  ownerId?: string;
  thumbnailPath?: string;
  faceAssetId?: string | null;
  isHidden?: boolean;
}

export interface GetAllFacesOptions {
  personGroupId?: string | null;
  assetId?: string;
  sourceType?: SourceType;
  clusterGroupId?: string;
  /**
   * Slice 5 (F9): recognition must never re-claim a face a human has already placed. Space-person
   * confirms never write `asset_face.personId` (space people are a projection over personal people),
   * so the `personId: null` filter alone does not exclude a confirmed-but-still-unassigned face — the
   * durable record is the `face_identity_face` row with `source='manual'` instead. When set, excludes
   * any face carrying one. Default off, so the force-recognition branch (which has already wiped every
   * `face_identity_face` row via `unassignFaces` before this runs) and every other caller are unchanged.
   */
  excludeManuallyPlaced?: boolean;
}

export interface RepresentativeFaceListOptions {
  personId: string;
  take: number;
  skip: number;
  /**
   * Fork RBAC (Slice 2 / M1): when set, restricts results to faces on assets that `memberUserId`
   * can reach through a shared space AND that pass the shareable-visibility gate. Omit for the
   * owner's own unscoped picker view.
   */
  scope?: { memberUserId: string };
  /**
   * Fork (#869 follow-up): the owner's unscoped view above has no visibility gate of its own, so
   * without this the picker enumerates the owner's Locked Folder faces to a session that never
   * entered the PIN. Scoped (non-owner) callers are already Timeline+Archive-only via
   * `spaceVisibilityGate`, so their own elevation can never reach the owner's locked assets.
   */
  hasElevatedPermission?: boolean;
}

export interface RepresentativeFaceUpdateOptions {
  personId: string;
  assetFaceId: string;
}

export type UnassignFacesOptions = DeleteFacesOptions & { clusterGroupId?: string };

export type GetFacesOptions = WithPersonOptions & { isVisible?: boolean };

/** a person is identified by its owner and the group it belongs to */
export type PersonId = { ownerId: string; personGroupId: string };

export type ReassignCluster = { userId: string; newClusterId: string };

export type WithPersonOptions = {
  /** whose version of the person to select */
  viewingUserId: string;
};

/**
 * Upstream filters this join to `person.ownerId = viewingUserId` — with cluster groups on, every member
 * of a group has their own person row and the viewer wants theirs. Option M keeps groups 1:1, so the
 * only row is the OWNER's, and that filter returns nothing for every non-owner: a shared-album
 * recipient or Space member would see `person: null` on a face they are allowed to see, and a hidden
 * person would stop being filtered out because there is no person row left to read `isHidden` from.
 *
 * So prefer the viewer's own row and fall back to the group's. Under M that always resolves to the
 * owner's single row; if cluster groups are ever turned on it degrades back to upstream's behaviour.
 */
const withPerson = ({ viewingUserId }: WithPersonOptions) => {
  return (eb: ExpressionBuilder<DB, 'asset_face'>) =>
    jsonObjectFrom(
      eb
        .selectFrom('person')
        .selectAll('person')
        .whereRef('person.personGroupId', '=', 'asset_face.personGroupId')
        .orderBy(sql`case when "person"."ownerId" = ${viewingUserId} then 0 else 1 end`)
        .limit(1),
    ).as('person');
};

/**
 * Option M: owner-agnostic variant of `withPerson`.
 *
 * `withPerson` selects the viewer's OWN person row in the face's group — correct for user-facing
 * reads. The face-repair admin console reads faces belonging to people the admin does not own and
 * has no viewer to key on, so this resolves the single person row in the group instead. Sound only
 * under M's 1:1 person_group-to-person invariant; see `getByGroupIdOnly`.
 */
const withPersonAnyOwner = (eb: ExpressionBuilder<DB, 'asset_face'>) =>
  jsonObjectFrom(
    eb
      .selectFrom('person')
      .selectAll('person')
      .whereRef('person.personGroupId', '=', 'asset_face.personGroupId'),
  ).as('person');

const withFaceSearch = (eb: ExpressionBuilder<DB, 'asset_face'>) => {
  return jsonObjectFrom(
    eb.selectFrom('face_search').selectAll('face_search').whereRef('face_search.faceId', '=', 'asset_face.id'),
  ).as('faceSearch');
};

@Injectable()
export class PersonRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [{ oldPersonGroupId: DummyValue.UUID, newPersonGroupId: DummyValue.UUID }] })
  async reassignFaces({ oldPersonGroupId, faceIds, ownerId, newPersonGroupId }: UpdateFacesData): Promise<number> {
    const result = await this.db
      .updateTable('asset_face')
      .from('asset')
      .whereRef('asset_face.assetId', '=', 'asset.id')
      .set({ personGroupId: newPersonGroupId })
      .$if(!!oldPersonGroupId, (qb) => qb.where('asset_face.personGroupId', '=', oldPersonGroupId!))
      .$if(!!faceIds, (qb) => qb.where('asset_face.id', 'in', faceIds!))
      .$if(!!ownerId, (qb) => qb.where('asset.ownerId', '=', ownerId!))
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0);
  }

  async mergePersonProfile(
    input: {
      sourcePersonId: string;
      targetPersonId: string;
      targetIdentityId: string;
    },
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<{ deletedThumbnailPath: string | null; targetNeedsFeatureFaceRepair: boolean }> {
    const people = await db
      .selectFrom('person')
      .select(['personGroupId', 'name', 'birthDate', 'thumbnailPath', 'color', 'species', 'faceAssetId'])
      .where('personGroupId', 'in', [input.sourcePersonId, input.targetPersonId])
      .execute();
    const target = people.find((person) => person.personGroupId === input.targetPersonId);
    const source = people.find((person) => person.personGroupId === input.sourcePersonId);
    if (!target || !source) {
      throw new Error('Person profile not found');
    }

    const update: Updateable<PersonTable> = { identityId: input.targetIdentityId };
    if (isBlank(target.name) && !isBlank(source.name)) {
      update.name = source.name;
    }

    if (!target.birthDate && source.birthDate) {
      update.birthDate = source.birthDate;
    }

    if (isBlank(target.color) && !isBlank(source.color)) {
      update.color = source.color;
    }

    if (isBlank(target.species) && !isBlank(source.species)) {
      update.species = source.species;
    }

    await db.updateTable('person').set(update).where('personGroupId', '=', input.targetPersonId).execute();
    await db
      .updateTable('asset_face')
      .set({ personGroupId: input.targetPersonId })
      .where('personGroupId', '=', input.sourcePersonId)
      .execute();

    // Human placements live in `face_identity_face.source='manual'` (identity-keyed); negative/keep-here
    // verdicts live in `face_person_verdict`. Both are re-pointed to the survivor at merge time: the
    // identityId re-key runs in mergeIdentitiesAfterProfileResolution, and the personId re-target runs
    // just below (survivor-wins). The identityId FK is ON DELETE SET NULL as a safety net.

    // D1: move this person's verdicts to the survivor before deleting the source person (personId FK is
    // SET NULL — a bare delete would orphan them). Survivor-wins on the (personId, assetFaceId) collision.
    await retargetVerdictPersonId(db, input.sourcePersonId, input.targetPersonId);

    // H10: face_repair_decline.personId is ON DELETE CASCADE (unlike the verdict FK above), so the source
    // person's cluster mute must be moved onto the survivor before deletion too, or it is silently
    // destroyed and the cluster resurfaces on the next scan.
    await retargetDeclinePersonId(db, input.sourcePersonId, input.targetPersonId);

    const targetNeedsFeatureFaceRepair =
      !target.faceAssetId || !(await this.isFeatureFaceValid(input.targetPersonId, target.faceAssetId, db));
    const [deleteResult] = await db.deleteFrom('person').where('personGroupId', '=', input.sourcePersonId).execute();
    if (Number(deleteResult.numDeletedRows ?? 0) === 0) {
      throw new Error('Person profile not found');
    }

    return { deletedThumbnailPath: source.thumbnailPath || null, targetNeedsFeatureFaceRepair };
  }

  async lockPeopleForMerge(personIds: string[], db: Kysely<DB> | Transaction<DB> = this.db): Promise<void> {
    if (personIds.length === 0) {
      return;
    }

    const rows = await db
      .selectFrom('person')
      .select('personGroupId')
      .where('personGroupId', 'in', [...new Set(personIds)].toSorted())
      .orderBy('personGroupId')
      .forUpdate()
      .execute();
    if (rows.length !== new Set(personIds).size) {
      throw new Error('Person profile not found');
    }
  }

  private async isFeatureFaceValid(
    personId: string,
    faceAssetId: string,
    db: Kysely<DB> | Transaction<DB>,
  ): Promise<boolean> {
    const row = await db
      .selectFrom('asset_face')
      .select('asset_face.id')
      .where('asset_face.id', '=', faceAssetId)
      .where('asset_face.personGroupId', '=', personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .executeTakeFirst();

    return !!row;
  }

  async updatePersonIdentity(
    input: {
      personId: string;
      identityId: string;
    },
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<void> {
    await db.updateTable('person').set({ identityId: input.identityId }).where('personGroupId', '=', input.personId).execute();
  }

  @GenerateSql({ params: [{ sourceType: SourceType.MachineLearning, clusterGroupId: DummyValue.UUID }] })
  async unassignFaces({ sourceType, clusterGroupId }: UnassignFacesOptions): Promise<void> {
    // "Reset all people" bulk-nulls personId across the whole library. It must also clear the human-placement
    // record (face_identity_face.source='manual'); otherwise every previously-confirmed face keeps a stale
    // manual link with no person behind it, and both face engines would treat those unassigned faces as
    // settled forever — permanently excluding them from recognition and suggestions after a reset.
    await this.db
      .deleteFrom('face_identity_face')
      .where('assetFaceId', 'in', (eb) =>
        eb.selectFrom('asset_face').select('id').where('asset_face.sourceType', '=', sourceType),
      )
      .execute();
    await this.db
      .updateTable('asset_face')
      .set({ personGroupId: null })
      .from('asset')
      .whereRef('asset_face.assetId', '=', 'asset.id')
      .where('asset_face.sourceType', '=', sourceType)
      .$if(!!clusterGroupId, (qb) =>
        qb.innerJoin('user', 'user.id', 'asset.ownerId').where('user.clusterGroupId', '=', clusterGroupId!),
      )
      .execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.UUID] })
  @Chunked()
  async delete(personGroupIds: string[], ownerId?: string) {
    if (personGroupIds.length === 0) {
      return [];
    }

    return this.db
      .deleteFrom('person')
      .$if(!!ownerId, (qb) => qb.where('ownerId', '=', ownerId!))
      .where('person.personGroupId', 'in', personGroupIds)
      .returning(['personGroupId', 'ownerId', 'thumbnailPath'])
      .execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  @Chunked()
  async deleteGroups(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.db.deleteFrom('person_group').where('person_group.id', 'in', ids).execute();
  }

  @GenerateSql()
  async deleteEmptyGroups(): Promise<number> {
    const result = await this.db
      .deleteFrom('person_group')
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('person')
              .whereRef('person.personGroupId', '=', 'person_group.id')
              .select('person.personGroupId'),
          ),
        ),
      )
      .executeTakeFirst();

    return Number(result.numDeletedRows);
  }

  @GenerateSql()
  async deleteOrphanedClusterGroups(): Promise<number> {
    const result = await this.db
      .deleteFrom('cluster_group')
      .where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom('user').whereRef('user.clusterGroupId', '=', 'cluster_group.id').select('user.id'))),
      )
      .executeTakeFirst();

    return Number(result.numDeletedRows);
  }

  async deleteFaces({ sourceType }: DeleteFacesOptions): Promise<void> {
    await this.db.deleteFrom('asset_face').where('asset_face.sourceType', '=', sourceType).execute();
  }

  async deleteAllPets(): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      // Delete pet faces before the pet people they belong to: asset_face.personId is
      // ON DELETE SET NULL, so removing the people first would orphan (not delete) the faces.
      await trx
        .deleteFrom('asset_face')
        .where('asset_face.personGroupId', 'in', (eb) =>
          eb.selectFrom('person').select('person.personGroupId').where('person.type', '=', 'pet'),
        )
        .execute();

      await trx.deleteFrom('person').where('person.type', '=', 'pet').execute();
    });
  }

  @GenerateSql({
    params: [{ personGroupId: null, sourceType: SourceType.MachineLearning, clusterGroupId: DummyValue.UUID }],
    stream: true,
  })
  getAllFaces(options: GetAllFacesOptions = {}) {
    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .$if(options.personGroupId === null, (qb) => qb.where('asset_face.personGroupId', 'is', null))
      .$if(!!options.personGroupId, (qb) => qb.where('asset_face.personGroupId', '=', options.personGroupId!))
      .$if(!!options.sourceType, (qb) => qb.where('asset_face.sourceType', '=', options.sourceType!))
      .$if(!!options.assetId, (qb) => qb.where('asset_face.assetId', '=', options.assetId!))
      .$if(!!options.clusterGroupId, (qb) =>
        qb
          .innerJoin('asset', 'asset.id', 'asset_face.assetId')
          .innerJoin('user', 'user.id', 'asset.ownerId')
          .where('user.clusterGroupId', '=', options.clusterGroupId!),
      )
      .$if(!!options.excludeManuallyPlaced, (qb) =>
        qb.where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('face_identity_face')
                .select('face_identity_face.assetFaceId')
                .whereRef('face_identity_face.assetFaceId', '=', 'asset_face.id')
                .where('face_identity_face.source', '=', 'manual'),
            ),
          ),
        ),
      )
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .stream();
  }

  getAll(options: GetAllPeopleOptions = {}) {
    return this.db
      .selectFrom('person')
      .selectAll('person')
      .$if(!!options.ownerId, (qb) => qb.where('person.ownerId', '=', options.ownerId!))
      .$if(options.thumbnailPath !== undefined, (qb) => qb.where('person.thumbnailPath', '=', options.thumbnailPath!))
      .$if(options.faceAssetId === null, (qb) => qb.where('person.faceAssetId', 'is', null))
      .$if(!!options.faceAssetId, (qb) => qb.where('person.faceAssetId', '=', options.faceAssetId!))
      .$if(options.isHidden !== undefined, (qb) => qb.where('person.isHidden', '=', options.isHidden!))
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID, { month: 4, day: 23 }] })
  getBirthdaysForDay(ownerId: string, { month, day }: { month: number; day: number }) {
    return this.db
      .selectFrom('person')
      .select(['personGroupId', 'name', 'birthDate'])
      .where('ownerId', '=', ownerId)
      .where('isHidden', '=', false)
      .where('type', '=', 'person')
      .where('name', '!=', '')
      .where('birthDate', 'is not', null)
      .where(sql`extract(month from "birthDate")`, '=', month)
      .where(sql`extract(day from "birthDate")`, '=', day)
      .execute();
  }

  @GenerateSql()
  getFileSamples() {
    return this.db
      .selectFrom('person')
      .select(['ownerId', 'personGroupId', 'thumbnailPath'])
      .where('thumbnailPath', '!=', sql.lit(''))
      .limit(sql.lit(3))
      .execute();
  }

  @GenerateSql({ params: [{ take: 1, skip: 0 }, DummyValue.UUID] })
  async getAllForUser(pagination: PaginationOptions, userId: string, options?: PersonSearchOptions) {
    const items = await this.db
      .selectFrom('person')
      .selectAll('person')
      .innerJoin('asset_face', 'asset_face.personGroupId', 'person.personGroupId')
      .innerJoin('asset', (join) =>
        join
          .onRef('asset_face.assetId', '=', 'asset.id')
          .onRef('asset.ownerId', '=', 'person.ownerId')
          .on('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
          .on('asset.deletedAt', 'is', null),
      )
      .where('person.ownerId', '=', userId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .orderBy('person.isHidden', 'asc')
      .orderBy('person.isFavorite', 'desc')
      .having((eb) =>
        eb.or([
          eb('person.name', '!=', ''),
          eb(
            (innerEb) => innerEb.fn.count('asset_face.assetId'),
            '>=',
            sql<number>`COALESCE(
              (SELECT value -> 'people' ->> 'minimumFaces'
              FROM user_metadata
              WHERE "userId" = ${userId}
                AND key = ${sql.lit(UserMetadataKey.Preferences)}),
              '3'
            )::int `,
          ),
        ]),
      )
      .groupBy(['person.ownerId', 'person.personGroupId'])
      .$if(!!options?.closestFaceAssetId, (qb) =>
        qb.orderBy((eb) =>
          eb(
            (eb) =>
              eb
                .selectFrom('face_search')
                .select('face_search.embedding')
                .whereRef('face_search.faceId', '=', 'person.faceAssetId'),
            '<=>',
            (eb) =>
              eb
                .selectFrom('face_search')
                .select('face_search.embedding')
                .where('face_search.faceId', '=', options!.closestFaceAssetId!),
          ),
        ),
      )
      .$if(!options?.closestFaceAssetId, (qb) =>
        qb
          .orderBy(sql`NULLIF(BTRIM(person.name), '') is null`, 'asc')
          .orderBy(sql`NULLIF(BTRIM(person.name), '')`, (om) => om.asc().nullsLast())
          .orderBy(sql`CASE WHEN NULLIF(BTRIM(person.name), '') IS NULL THEN COUNT("asset_face"."assetId") END`, (om) =>
            om.desc().nullsLast(),
          )
          .orderBy('person.personGroupId'),
      )
      .$if(!options?.withHidden, (qb) => qb.where('person.isHidden', '=', false))
      .offset(pagination.skip ?? 0)
      .limit(pagination.take + 1)
      .execute();

    return paginationHelper(items, pagination.take);
  }

  @GenerateSql()
  getAllWithoutFaces() {
    // The deletedAt / isVisible predicates must live inside the JOIN ON clause,
    // not in WHERE. A WHERE filter on a LEFT JOIN'd table silently converts it
    // to an INNER JOIN, which excludes persons with zero asset_face rows entirely
    // and leaves named zombies uncleaned after a force-recognition reset.
    return this.db
      .selectFrom('person')
      .selectAll('person')
      .leftJoin('asset_face', (join) =>
        join
          .onRef('asset_face.personGroupId', '=', 'person.personGroupId')
          .on('asset_face.deletedAt', 'is', null)
          .on((eb) =>
            eb.or([eb('asset_face.isVisible', 'is', null), eb('asset_face.isVisible', '=', true)]),
          ),
      )
      .groupBy(['person.ownerId', 'person.personGroupId'])
      .having((eb) => eb.fn.count('asset_face.assetId'), '=', 0)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { viewingUserId: DummyValue.UUID, isVisible: true }] })
  getFaces(assetId: string, options: GetFacesOptions) {
    const { viewingUserId, isVisible } = options;

    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .select(withPerson({ viewingUserId }))
      .where('asset_face.assetId', '=', assetId)
      .where('asset_face.deletedAt', 'is', null)
      .$if(isVisible !== undefined, (qb) => qb.where('asset_face.isVisible', '=', isVisible!))
      .orderBy('asset_face.boundingBoxX1', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { viewingUserId: DummyValue.UUID }] })
  getFaceById(id: string, { viewingUserId }: WithPersonOptions) {
    // TODO return null instead of find or fail
    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .select(withPerson({ viewingUserId }))
      .where('asset_face.id', '=', id)
      .where('asset_face.deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
  }

  // Admin face-thumbnail read: no person join, and INCLUDES tombstoned faces (the "not a face"
  // action sets deletedAt but keeps boundingBox/dims, and resolutions history must still render).
  // Slice 1 (F1): excludes faces on a non-reviewable (Locked/Hidden) asset — the Locked folder requires
  // the owner's elevated re-authentication, which this admin route never performs. A Locked-asset face id
  // makes this throw, which the sole caller (face-repair.service.ts getAdminFaceThumbnail) already turns
  // into a 404, so the asset's existence is never disclosed. The tombstone inclusion above is unaffected —
  // deliberate and still tested.
  @GenerateSql({ params: [DummyValue.UUID] })
  getFaceByIdIncludingTombstoned(id: string) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .selectAll('asset_face')
      .select(withPersonAnyOwner)
      .where('asset_face.id', '=', id)
      .where((eb) => reviewableAssetVisibility(eb))
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [{ personId: DummyValue.UUID, take: 50, skip: 0 }] })
  getRepresentativeFaces(options: RepresentativeFaceListOptions) {
    return this.db
      .selectFrom('person')
      .innerJoin('asset_face', (join) =>
        join.on((eb) =>
          eb.or([
            eb('asset_face.personGroupId', '=', eb.ref('person.personGroupId')),
            eb.exists(
              eb
                .selectFrom('face_identity_face')
                .select('face_identity_face.assetFaceId')
                .whereRef('face_identity_face.assetFaceId', '=', 'asset_face.id')
                .whereRef('face_identity_face.identityId', '=', 'person.identityId'),
            ),
          ]),
        ),
      )
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .selectAll('asset_face')
      .select(['asset.fileCreatedAt', 'person.faceAssetId as representativeFaceId'])
      .where('person.personGroupId', '=', options.personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('face_identity_face')
              .select('face_identity_face.assetFaceId')
              .whereRef('face_identity_face.assetFaceId', '=', 'asset_face.id')
              .where(sql<SqlBool>`face_identity_face."identityId" IS DISTINCT FROM person."identityId"`),
          ),
        ),
      )
      .$if(!options.hasElevatedPermission, (qb) => qb.where('asset.visibility', '!=', AssetVisibility.Locked))
      .$if(!!options.scope, (qb) =>
        qb.where((eb) =>
          eb.and([
            // Fork RBAC (Slice 2 / M1): a non-owner (space-granted) caller may only see faces on assets
            // they can reach through a space AND that pass the shareable visibility gate. Filters faces
            // matched via BOTH the personId arm and the identity-expansion arm (predicate is on the
            // joined asset row), so cross-user identity faces are also excluded.
            spaceVisibilityGate(eb),
            eb.or(
              spaceAssetPathBranches(eb, {
                correlateAssetId: 'asset.id',
                correlateLibraryId: 'asset.libraryId',
                scope: { memberUserId: options.scope!.memberUserId },
              }),
            ),
          ]),
        ),
      )
      .orderBy('asset.fileCreatedAt', 'desc')
      .orderBy('asset_face.id')
      .offset(options.skip)
      .limit(options.take + 1)
      .execute();
  }

  @GenerateSql({ params: [{ personId: DummyValue.UUID, assetFaceId: DummyValue.UUID }] })
  getRepresentativeFaceForUpdate(options: RepresentativeFaceUpdateOptions) {
    return this.db
      .selectFrom('person')
      .innerJoin('asset_face', (join) =>
        join.on((eb) =>
          eb.or([
            eb('asset_face.personGroupId', '=', eb.ref('person.personGroupId')),
            eb.exists(
              eb
                .selectFrom('face_identity_face')
                .select('face_identity_face.assetFaceId')
                .whereRef('face_identity_face.assetFaceId', '=', 'asset_face.id')
                .whereRef('face_identity_face.identityId', '=', 'person.identityId'),
            ),
          ]),
        ),
      )
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .selectAll('asset_face')
      .where('person.personGroupId', '=', options.personId)
      .where('asset_face.id', '=', options.assetFaceId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('face_identity_face')
              .select('face_identity_face.assetFaceId')
              .whereRef('face_identity_face.assetFaceId', '=', 'asset_face.id')
              .where(sql<SqlBool>`face_identity_face."identityId" IS DISTINCT FROM person."identityId"`),
          ),
        ),
      )
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getFaceForFacialRecognitionJob(id: string) {
    return this.db
      .selectFrom('asset_face')
      .select(['asset_face.id', 'asset_face.assetId', 'asset_face.personGroupId', 'asset_face.sourceType'])
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('asset')
            .innerJoin('user', 'user.id', 'asset.ownerId')
            .select(['asset.ownerId', 'asset.visibility', 'asset.fileCreatedAt', 'user.clusterGroupId'])
            .whereRef('asset.id', '=', 'asset_face.assetId'),
        ).as('asset'),
      )
      .select(withFaceSearch)
      .where('asset_face.id', '=', id)
      .where('asset_face.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [{ ownerId: DummyValue.UUID, personGroupId: DummyValue.UUID }] })
  getDataForThumbnailGenerationJob({ ownerId, personGroupId }: PersonId) {
    return this.db
      .selectFrom('person')
      .innerJoin('asset_face', 'asset_face.id', 'person.faceAssetId')
      .innerJoin('asset', 'asset_face.assetId', 'asset.id')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'person.ownerId',
        'asset_face.boundingBoxX1 as x1',
        'asset_face.boundingBoxY1 as y1',
        'asset_face.boundingBoxX2 as x2',
        'asset_face.boundingBoxY2 as y2',
        'asset_face.imageWidth as oldWidth',
        'asset_face.imageHeight as oldHeight',
        'asset.type',
        'asset.originalPath',
        'asset_exif.orientation as exifOrientation',
      ])
      .select((eb) => withFilePath(eb, AssetFileType.Preview).as('previewPath'))
      .where('person.ownerId', '=', ownerId)
      .where('person.personGroupId', '=', personGroupId)
      .where('asset_face.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async reassignFace(
    assetFaceId: string,
    newPersonGroupId: string,
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<number> {
    const result = await db
      .updateTable('asset_face')
      .set({ personGroupId: newPersonGroupId })
      .where('asset_face.id', '=', assetFaceId)
      .executeTakeFirst();

    return Number(result.numChangedRows ?? 0);
  }

  @GenerateSql({ params: [{ ownerId: DummyValue.UUID, personGroupId: DummyValue.UUID }] })
  getByGroupId({ ownerId, personGroupId }: PersonId) {
    return this.db //
      .selectFrom('person')
      .selectAll('person')
      .where('person.personGroupId', '=', personGroupId)
      .where('person.ownerId', '=', ownerId)
      .executeTakeFirst();
  }

  /**
   * Option M: resolve a person by group id ALONE.
   *
   * Upstream deleted `person.id`; the primary key is now composite `(ownerId, personGroupId)`. Most
   * fork call sites only ever carry the person's public id — which `mapPerson` emits as
   * `personGroupId` — and have no owner in hand. This is sound ONLY because Gallery never creates
   * multi-user cluster groups, so `person_group` stays 1:1 with `person`.
   *
   * That invariant is enforced by the unique index `person_personGroupId_key`
   * (`1791000000000-RepointFaceReviewToPersonGroup`). Keeping the assumption in this single accessor
   * is deliberate: it is the one place M's 1:1 bet is load-bearing.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  getByGroupIdOnly(personGroupId: string) {
    return this.db //
      .selectFrom('person')
      .selectAll('person')
      .where('person.personGroupId', '=', personGroupId)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING, { withHidden: true }] })
  getByName(userId: string, personName: string, { withHidden, hasElevatedPermission }: PersonNameSearchOptions) {
    return (
      this.db
        .with('similarity_threshold', (db) =>
          db.selectNoFrom(sql`set_config('pg_trgm.word_similarity_threshold', '0.5', true)`.as('thresh')),
        )
        .selectFrom(['similarity_threshold', 'person'])
        .selectAll('person')
        .where('person.ownerId', '=', userId)
        .where(
          () =>
            sql`(f_unaccent("person"."name") ILIKE '%' || f_unaccent(${personName}) || '%' OR f_unaccent("person"."name") %> f_unaccent(${personName}))`,
        )
        .orderBy(sql`f_unaccent("person"."name") <->>> f_unaccent(${personName})`)
        .limit(100)
        .$if(!withHidden, (qb) => qb.where('person.isHidden', '=', false))
        // Fork (#869 follow-up): this owner-scoped lookup had no asset-visibility gate at all, so a person
        // whose faces only ever appear inside the Locked Folder was named back to a session that had never
        // entered the PIN — the withSharedSpaces path (searchAccessiblePeople) already gates on visibility.
        // Drop a person only when the Locked Folder is the ONLY thing backing them: a person with a face on
        // any non-locked asset is still legitimately discoverable, and a person with no faces at all (freshly
        // created, or every face unassigned) reveals nothing about locked content.
        .$if(!hasElevatedPermission, (qb) =>
          qb.where((eb) =>
            eb.or([
              eb.not(eb.exists(visibleFaceOnAsset(eb, { locked: true }))),
              eb.exists(visibleFaceOnAsset(eb, { locked: false })),
            ]),
          ),
        )
        .execute()
    );
  }

  @GenerateSql({ params: [DummyValue.UUID, { withHidden: true }] })
  getDistinctNames(userId: string, { withHidden }: PersonNameSearchOptions): Promise<PersonNameResponse[]> {
    return this.db
      .selectFrom('person')
      .select(['person.personGroupId', 'person.name'])
      .distinctOn((eb) => eb.fn('lower', ['person.name']))
      .where((eb) => eb.and([eb('person.ownerId', '=', userId), eb('person.name', '!=', '')]))
      .$if(!withHidden, (qb) => qb.where('person.isHidden', '=', false))
      .execute();
  }

  /**
   * L3: `memberUserId` scopes the count to a space-only reader's reachable assets (own assets are
   * never included here — a legacy person's assets all belong to `person.ownerId` — so this is a
   * pure narrowing of the owner's Timeline assets down to the ones the member can actually reach
   * via a shared space). Omit it for the owner's own unrestricted count.
   */
  @GenerateSql(
    { params: [DummyValue.UUID, DummyValue.UUID] },
    { params: [DummyValue.UUID, DummyValue.UUID, { memberUserId: DummyValue.UUID }] },
  )
  async getStatistics(
    personGroupId: string,
    userId: string,
    options: { memberUserId?: string } = {},
  ): Promise<PersonStatistics> {
    const result = await this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .select((eb) => eb.fn.count(eb.fn('distinct', ['asset.id'])).as('assets'))
      .select((eb) => eb.fn.count(eb.fn('distinct', ['asset_face.id'])).as('faces'))
      .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      // #30739 added the owner-or-shared-album reachability gate. It is one arm of a disjunction, not a
      // filter to AND with the fork's: a Space reader owns none of these assets and need not share an
      // album with the owner, so ANDing the two counts zero for exactly the caller L3 exists to serve.
      .where((eb) =>
        eb.or([
          eb('asset.ownerId', '=', asUuid(userId)),
          inSharedAlbum(eb, userId),
          ...(options.memberUserId
            ? spaceAssetPathBranches(eb, {
                correlateAssetId: 'asset.id',
                correlateLibraryId: 'asset.libraryId',
                scope: { memberUserId: options.memberUserId },
              })
            : []),
        ]),
      )
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .where('asset_face.personGroupId', '=', personGroupId)
      .executeTakeFirst();

    return {
      assets: Number(result?.assets ?? 0),
      faces: Number(result?.faces ?? 0),
    };
  }

  @GenerateSql({ params: [DummyValue.UUID, { minimumFaceCount: 3 }] })
  async getNumberOfPeople(userId: string, options: PeopleFaceStatisticsOptions = {}) {
    const minimumFaceCount = options.minimumFaceCount ?? 1;
    const result = await sql<{ total: number; hidden: number }>`
      WITH "eligible_people" AS (
        SELECT
          "person"."personGroupId",
          "person"."isHidden"
        FROM "person"
        INNER JOIN "asset_face" ON "asset_face"."personGroupId" = "person"."personGroupId"
        INNER JOIN "asset" ON "asset"."id" = "asset_face"."assetId"
        WHERE "person"."ownerId" = ${userId}
          AND "asset"."visibility" = ${AssetVisibility.Timeline}
          AND "asset"."deletedAt" IS NULL
          AND "asset_face"."deletedAt" IS NULL
          AND "asset_face"."isVisible" = true
        -- see getPeopleOverviewStatistics: group by the composite PRIMARY KEY, not the unique index
        GROUP BY "person"."ownerId", "person"."personGroupId"
        HAVING NULLIF(BTRIM("person"."name"), '') IS NOT NULL
          OR COUNT("asset_face"."assetId") >= ${minimumFaceCount}
      )
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "isHidden" = true)::int AS "hidden"
      FROM "eligible_people"
    `.execute(this.db);

    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      hidden: Number(row?.hidden ?? 0),
    };
  }

  @GenerateSql({ params: [DummyValue.UUID, { minimumFaceCount: 3 }] })
  async getPeopleOverviewStatistics(
    userId: string,
    options: PeopleFaceStatisticsOptions = {},
  ): Promise<PeopleOverviewStatistics> {
    const minimumFaceCount = options.minimumFaceCount ?? 1;
    const result = await sql<PeopleOverviewStatistics>`
      WITH "eligible_faces" AS (
        SELECT
          "asset_face"."id" AS "assetFaceId",
          "asset_face"."personGroupId"
        FROM "asset_face"
        INNER JOIN "asset" ON "asset"."id" = "asset_face"."assetId"
        WHERE "asset"."ownerId" = ${userId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND "asset"."visibility" IN (${sql.join(peopleAssetVisibilities)})
          AND "asset_face"."deletedAt" IS NULL
          AND "asset_face"."isVisible" = true
      ),
      "eligible_people" AS (
        SELECT
          "person"."personGroupId",
          "person"."isHidden"
        FROM "person"
        INNER JOIN "eligible_faces" ON "eligible_faces"."personGroupId" = "person"."personGroupId"
        WHERE "person"."ownerId" = ${userId}
        -- group by the table's PRIMARY KEY, which #30739 made composite. Postgres only infers
        -- functional dependency from a primary key, never from a unique index, so grouping by
        -- "personGroupId" alone leaves "isHidden" and "name" ungrouped and the query fails to plan.
        GROUP BY "person"."ownerId", "person"."personGroupId"
        HAVING NULLIF(BTRIM("person"."name"), '') IS NOT NULL
          OR COUNT(DISTINCT "eligible_faces"."assetFaceId") >= ${minimumFaceCount}
      )
      SELECT
        COUNT(DISTINCT "eligible_people"."personGroupId")::int AS "total",
        COUNT(DISTINCT "eligible_people"."personGroupId") FILTER (WHERE "eligible_people"."isHidden" = true)::int AS "hidden",
        COUNT(DISTINCT "eligible_faces"."assetFaceId")::int AS "detectedFaceCount"
      FROM "eligible_faces"
      LEFT JOIN "eligible_people" ON "eligible_people"."personGroupId" = "eligible_faces"."personGroupId"
    `.execute(this.db);

    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      hidden: Number(row?.hidden ?? 0),
      detectedFaceCount: Number(row?.detectedFaceCount ?? 0),
    };
  }

  @GenerateSql({ params: [DummyValue.UUID, { minimumFaceCount: 3 }] })
  async getPeopleFaceStatistics(
    userId: string,
    options: PeopleFaceStatisticsOptions = {},
  ): Promise<PeopleFaceStatistics> {
    const minimumFaceCount = options.minimumFaceCount ?? 1;
    const result = await sql<PeopleFaceStatistics>`
      WITH "eligible_faces" AS (
        SELECT
          "asset_face"."id" AS "assetFaceId",
          "asset_face"."personGroupId"
        FROM "asset_face"
        INNER JOIN "asset" ON "asset"."id" = "asset_face"."assetId"
        WHERE "asset"."ownerId" = ${userId}
          AND "asset"."deletedAt" IS NULL
          AND "asset"."isOffline" = false
          AND "asset"."visibility" IN (${sql.join(peopleAssetVisibilities)})
          AND "asset_face"."deletedAt" IS NULL
          AND "asset_face"."isVisible" = true
      ),
      "person_face_counts" AS (
        SELECT
          "personGroupId" AS "personId",
          COUNT(DISTINCT "assetFaceId")::int AS "assetCount"
        FROM "eligible_faces"
        WHERE "personGroupId" IS NOT NULL
        GROUP BY "personGroupId"
      ),
      "detected_faces" AS (
        SELECT
          "eligible_faces"."assetFaceId",
          "person"."personGroupId" AS "personId",
          NULLIF(BTRIM("person"."name"), '') IS NOT NULL AS "isNamed",
          CASE
            WHEN "person"."personGroupId" IS NOT NULL
              AND (
                NULLIF(BTRIM("person"."name"), '') IS NOT NULL
                OR "person_face_counts"."assetCount" >= ${minimumFaceCount}
              )
            THEN "person"."isHidden"
            ELSE NULL
          END AS "isHidden"
        FROM "eligible_faces"
        LEFT JOIN "person"
          ON "person"."personGroupId" = "eligible_faces"."personGroupId"
          AND "person"."ownerId" = ${userId}
        LEFT JOIN "person_face_counts"
          ON "person_face_counts"."personId" = "person"."personGroupId"
      )
      SELECT
        COUNT(DISTINCT "assetFaceId")::int AS "detectedFaceCount",
        COUNT(DISTINCT "assetFaceId") FILTER (WHERE "isHidden" = false)::int AS "assignedVisibleFaceCount",
        COUNT(DISTINCT "personId") FILTER (WHERE "isHidden" = false AND "isNamed" = true)::int AS "namedVisiblePersonCount",
        COUNT(DISTINCT "assetFaceId") FILTER (WHERE "isHidden" = true)::int AS "assignedHiddenFaceCount",
        COUNT(DISTINCT "assetFaceId") FILTER (WHERE "isHidden" IS NULL)::int AS "unassignedFaceCount"
      FROM "detected_faces"
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

  create(person: Insertable<PersonTable>) {
    return this.db.insertInto('person').values(person).returningAll().executeTakeFirstOrThrow();
  }

  /**
   * Option M: create a person together with its own person_group.
   *
   * Under M a person is never shared across users, so every new person gets a fresh 1:1 group. This
   * is the fork's replacement for the old `create({ ownerId, ... })` — which worked when `person.id`
   * was a standalone primary key — and it is the only sanctioned way to mint a person, so the 1:1
   * invariant cannot be broken by accident at a call site.
   */
  async createWithGroup(person: Omit<Insertable<PersonTable>, 'personGroupId'>) {
    const group = await this.createGroup(person.ownerId);
    return this.create({ ...person, personGroupId: group.id });
  }

  async createAll(people: Insertable<PersonTable>[]) {
    if (people.length === 0) {
      return [];
    }

    return this.db.insertInto('person').values(people).returningAll().execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  createGroup(ownerId: string) {
    return this.db
      .insertInto('person_group')
      .columns(['clusterGroupId'])
      .expression((eb) => eb.selectFrom('user').select('user.clusterGroupId').where('user.id', '=', ownerId))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [{ userId: DummyValue.UUID, newClusterId: DummyValue.UUID }] })
  async reassignCluster({ userId, newClusterId }: ReassignCluster): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      // a group nobody else has people in moves across as it is
      await trx
        .updateTable('person_group')
        .set({ clusterGroupId: newClusterId })
        .where('person_group.id', 'in', (eb) =>
          eb.selectFrom('person').select('person.personGroupId').where('person.ownerId', '=', userId),
        )
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('person')
                .select('person.personGroupId')
                .whereRef('person.personGroupId', '=', 'person_group.id')
                .where('person.ownerId', '!=', userId),
            ),
          ),
        )
        .execute();

      // the rest is shared with someone else, so this user gets a group of their own for each
      const mapping = await trx
        .with('shared', (db) =>
          db
            .selectFrom('person')
            .select('person.personGroupId as oldId')
            .distinct()
            .where('person.ownerId', '=', userId)
            .where(({ exists, selectFrom }) =>
              exists(
                selectFrom('person as other')
                  .select('other.personGroupId')
                  .whereRef('other.personGroupId', '=', 'person.personGroupId')
                  .where('other.ownerId', '!=', userId),
              ),
            ),
        )
        .with(
          (cte) => cte('mapping').materialized(),
          (db) => db.selectFrom('shared').select(['shared.oldId', sql<string>`uuid_generate_v4()`.as('newId')]),
        )
        .with('created', (db) =>
          db
            .insertInto('person_group')
            .columns(['id', 'clusterGroupId'])
            .expression((eb) =>
              eb.selectFrom('mapping').select(['mapping.newId', sql.val(newClusterId).as('clusterGroupId')]),
            ),
        )
        .selectFrom('mapping')
        .select(['mapping.oldId', 'mapping.newId'])
        .execute();

      if (mapping.length === 0) {
        return;
      }

      const oldIds = mapping.map(({ oldId }) => oldId);
      const newIds = mapping.map(({ newId }) => newId);
      const remapped = sql<{
        oldId: string;
        newId: string;
      }>`(select unnest(${`{${oldIds}}`}::uuid[]) as "oldId", unnest(${`{${newIds}}`}::uuid[]) as "newId")`.as(
        'mapping',
      );

      await trx
        .updateTable('person')
        .from(remapped)
        .set((eb) => ({ personGroupId: eb.ref('mapping.newId') }))
        .whereRef('person.personGroupId', '=', 'mapping.oldId')
        .where('person.ownerId', '=', userId)
        .execute();

      await trx
        .updateTable('asset_face')
        .from(remapped)
        .set((eb) => ({ personGroupId: eb.ref('mapping.newId') }))
        .whereRef('asset_face.personGroupId', '=', 'mapping.oldId')
        .where(({ exists, selectFrom }) =>
          exists(
            selectFrom('asset')
              .select('asset.id')
              .whereRef('asset.id', '=', 'asset_face.assetId')
              .where('asset.ownerId', '=', userId),
          ),
        )
        .execute();
    });
  }

  @GenerateSql({ params: [DummyValue.UUID, 2] })
  async createGroups(personGroups: Insertable<PersonGroupTable>[]) {
    if (personGroups.length === 0) {
      return [];
    }

    return this.db.insertInto('person_group').values(personGroups).returningAll().execute();
  }

  @GenerateSql({ params: [[], [], [{ faceId: DummyValue.UUID, embedding: DummyValue.VECTOR }]] })
  async refreshFaces(
    facesToAdd: (Insertable<AssetFaceTable> & { assetId: string })[],
    faceIdsToRemove: string[],
    embeddingsToAdd?: Insertable<FaceSearchTable>[],
  ): Promise<void> {
    let query = this.db;
    if (facesToAdd.length > 0) {
      (query as any) = query.with('added', (db) => db.insertInto('asset_face').values(facesToAdd));
    }

    if (faceIdsToRemove.length > 0) {
      (query as any) = query.with('removed', (db) =>
        db.deleteFrom('asset_face').where('asset_face.id', '=', (eb) => eb.fn.any(eb.val(faceIdsToRemove))),
      );
    }

    if (embeddingsToAdd?.length) {
      (query as any) = query.with('added_embeddings', (db) => db.insertInto('face_search').values(embeddingsToAdd));
    }

    await query.selectFrom(dummy).execute();
  }

  async update(person: Updateable<PersonTable> & PersonId, db: Kysely<DB> | Transaction<DB> = this.db) {
    return db
      .updateTable('person')
      .set(person)
      .where('person.ownerId', '=', person.ownerId)
      .where('person.personGroupId', '=', person.personGroupId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateAll(people: Insertable<PersonTable>[]): Promise<void> {
    if (people.length === 0) {
      return;
    }

    await this.db
      .insertInto('person')
      .values(people)
      .onConflict((oc) =>
        oc.columns(['ownerId', 'personGroupId']).doUpdateSet((eb) =>
          removeUndefinedKeys(
            {
              name: eb.ref('excluded.name'),
              birthDate: eb.ref('excluded.birthDate'),
              thumbnailPath: eb.ref('excluded.thumbnailPath'),
              faceAssetId: eb.ref('excluded.faceAssetId'),
              isHidden: eb.ref('excluded.isHidden'),
              isFavorite: eb.ref('excluded.isFavorite'),
              color: eb.ref('excluded.color'),
            },
            people[0],
          ),
        ),
      )
      .execute();
  }

  @GenerateSql({
    params: [[{ assetId: DummyValue.UUID, personGroupId: DummyValue.UUID }], { viewingUserId: DummyValue.UUID }],
  })
  @ChunkedArray()
  getFacesByIds(ids: AssetFaceId[], { viewingUserId }: WithPersonOptions) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    const assetIds: string[] = [];
    const personGroupIds: string[] = [];
    for (const { assetId, personGroupId } of ids) {
      assetIds.push(assetId);
      personGroupIds.push(personGroupId);
    }

    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .select(withPerson({ viewingUserId }))
      .where('asset_face.assetId', 'in', assetIds)
      .where('asset_face.personGroupId', 'in', personGroupIds)
      .where('asset_face.deletedAt', 'is', null)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, 20] })
  getAssignedFaceEmbeddings(personId: string, limit: number) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select('face_search.embedding')
      .where('asset_face.personGroupId', '=', personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .orderBy('asset_face.id', 'asc')
      .limit(limit)
      .execute();
  }

  /**
   * Slice 9 (F17): a person is only "scannable" — worth queueing `PersonSuggestionScan` for — when
   * BOTH cheap `EXISTS` checks below hold. Neither is the KNN the scan job itself performs, so
   * together they cannot tell whether any candidate actually falls within the configured distance
   * band for this specific person — that would need a per-person embedding search, which this
   * pre-check deliberately avoids (`handlePersonSuggestionScan` still does that work). A person who
   * passes both checks but whose real candidates all sit outside the band still gets a job that
   * finds nothing and returns early; that residual waste is not what this narrows.
   *
   * What it does remove: the previous predicate only correlated on `asset.ownerId = person.ownerId`,
   * so a single unassigned face anywhere in the owner's library queued a scan for every named,
   * visible, non-pet person that owner has — regardless of whether that person has ever been seen
   * in a photo. That is fixed by requiring the person to have at least one of their own assigned,
   * live, visible faces with an embedding (the exact precondition `getAssignedFaceEmbeddings` needs
   * before `handlePersonSuggestionScan` will do any work — a person with none is always Skipped
   * immediately, so queueing them can never do anything). The owner-side `EXISTS` keeps the
   * ownership correlation but is narrowed to `reviewableAssetVisibility` (Slice 1) so a Locked or
   * Hidden stray face no longer counts as a candidate the scan would never actually search against.
   */
  getScannablePeopleWithUnassignedFaces() {
    return this.db
      .selectFrom('person')
      .select(['person.personGroupId', 'person.ownerId'])
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where('person.type', '=', 'person')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
            .select('asset_face.id')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true),
        ),
      )
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('asset', 'asset.id', 'asset_face.assetId')
            .select('asset_face.id')
            .whereRef('asset.ownerId', '=', 'person.ownerId')
            .where('asset.deletedAt', 'is', null)
            .where('asset_face.personGroupId', 'is', null)
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.sourceType', '=', SourceType.MachineLearning)
            .where((eb2) => reviewableAssetVisibility(eb2)),
        ),
      )
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getRandomFace(personGroupId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    return db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .where('asset_face.personGroupId', '=', personGroupId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .executeTakeFirst();
  }

  @GenerateSql()
  async getLatestFaceDate(): Promise<string | undefined> {
    const result = (await this.db
      .selectFrom('asset_job_status')
      .select((eb) => sql`${eb.fn.max('asset_job_status.facesRecognizedAt')}::text`.as('latestDate'))
      .executeTakeFirst()) as { latestDate: string } | undefined;

    return result?.latestDate;
  }

  getByOwnerAndSpecies(ownerId: string, species: string) {
    return this.db
      .selectFrom('person')
      .selectAll('person')
      .where('person.ownerId', '=', ownerId)
      .where('person.type', '=', 'pet')
      .where('person.species', '=', species)
      .executeTakeFirst();
  }

  async createAssetFace(face: Insertable<AssetFaceTable>): Promise<string> {
    const result = await this.db.insertInto('asset_face').values(face).returning('id').executeTakeFirstOrThrow();
    return result.id;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async deleteAssetFace(id: string): Promise<void> {
    await this.db.deleteFrom('asset_face').where('asset_face.id', '=', id).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async softDeleteAssetFaces(id: string): Promise<void> {
    await this.db.updateTable('asset_face').set({ deletedAt: new Date() }).where('asset_face.id', '=', id).execute();
  }

  async vacuum({ reindexVectors }: { reindexVectors: boolean }): Promise<void> {
    await sql`VACUUM ANALYZE asset_face, face_search, person`.execute(this.db);
    await sql`REINDEX TABLE asset_face`.execute(this.db);
    await sql`REINDEX TABLE person`.execute(this.db);
    if (reindexVectors) {
      await sql`REINDEX TABLE face_search`.execute(this.db);
    }
  }

  @GenerateSql({ params: [[], []] })
  async updateVisibility(visible: AssetFace[], hidden: AssetFace[]): Promise<void> {
    if (visible.length === 0 && hidden.length === 0) {
      return;
    }

    await this.db.transaction().execute(async (trx) => {
      if (visible.length > 0) {
        await trx
          .updateTable('asset_face')
          .set({ isVisible: true })
          .where(
            'asset_face.id',
            'in',
            visible.map(({ id }) => id),
          )
          .execute();
      }

      if (hidden.length > 0) {
        await trx
          .updateTable('asset_face')
          .set({ isVisible: false })
          .where(
            'asset_face.id',
            'in',
            hidden.map(({ id }) => id),
          )
          .execute();
      }
    });
  }

  @GenerateSql({ params: [{ personGroupId: DummyValue.UUID, assetId: DummyValue.UUID }] })
  getForFeatureFaceUpdate({ personGroupId, assetId }: { personGroupId: string; assetId: string }) {
    return this.db
      .selectFrom('asset_face')
      .select('asset_face.id')
      .where('asset_face.assetId', '=', assetId)
      .where('asset_face.personGroupId', '=', personGroupId)
      .innerJoin('asset', (join) => join.onRef('asset.id', '=', 'asset_face.assetId').on('asset.isOffline', '=', false))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  getForMergePerson(personGroupIds: string[]) {
    return this.db
      .selectFrom('person')
      .selectAll('person')
      .where('person.personGroupId', 'in', personGroupIds)
      .orderBy('person.ownerId')
      .execute();
  }
}
