import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Insertable, Kysely, Selectable, sql, SqlBool, Transaction, Updateable } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { AssetFace } from 'src/database';
import { Chunked, ChunkedArray, DummyValue, GenerateSql } from 'src/decorators';
import { AssetFileType, AssetVisibility, SourceType, UserMetadataKey } from 'src/enum';
import { DB } from 'src/schema';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { FaceSearchTable } from 'src/schema/tables/face-search.table';
import { PersonTable } from 'src/schema/tables/person.table';
import { dummy, removeUndefinedKeys, withFilePath } from 'src/utils/database';
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
  id: string;
  name: string;
}

export interface DormantPerson {
  id: string;
  name: string;
}

export interface AssetFaceId {
  assetId: string;
  personId: string;
}

export interface UpdateFacesData {
  oldPersonId?: string;
  faceIds?: string[];
  newPersonId: string;
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
    .whereRef('asset_face.personId', '=', 'person.id')
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
  personId?: string | null;
  assetId?: string;
  sourceType?: SourceType;
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

export type UnassignFacesOptions = DeleteFacesOptions;

export type SelectFaceOptions = (keyof Selectable<AssetFaceTable>)[];

const withPerson = (eb: ExpressionBuilder<DB, 'asset_face'>) => {
  return jsonObjectFrom(
    eb.selectFrom('person').selectAll('person').whereRef('person.id', '=', 'asset_face.personId'),
  ).as('person');
};

const withFaceSearch = (eb: ExpressionBuilder<DB, 'asset_face'>) => {
  return jsonObjectFrom(
    eb.selectFrom('face_search').selectAll('face_search').whereRef('face_search.faceId', '=', 'asset_face.id'),
  ).as('faceSearch');
};

@Injectable()
export class PersonRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [{ oldPersonId: DummyValue.UUID, newPersonId: DummyValue.UUID }] })
  async reassignFaces({ oldPersonId, faceIds, newPersonId }: UpdateFacesData): Promise<number> {
    const result = await this.db
      .updateTable('asset_face')
      .set({ personId: newPersonId })
      .$if(!!oldPersonId, (qb) => qb.where('asset_face.personId', '=', oldPersonId!))
      .$if(!!faceIds, (qb) => qb.where('asset_face.id', 'in', faceIds!))
      .executeTakeFirst();

    return Number(result.numChangedRows ?? 0);
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
      .select(['id', 'name', 'birthDate', 'thumbnailPath', 'color', 'species', 'faceAssetId'])
      .where('id', 'in', [input.sourcePersonId, input.targetPersonId])
      .execute();
    const target = people.find((person) => person.id === input.targetPersonId);
    const source = people.find((person) => person.id === input.sourcePersonId);
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

    await db.updateTable('person').set(update).where('id', '=', input.targetPersonId).execute();
    await db
      .updateTable('asset_face')
      .set({ personId: input.targetPersonId })
      .where('personId', '=', input.sourcePersonId)
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
    const [deleteResult] = await db.deleteFrom('person').where('id', '=', input.sourcePersonId).execute();
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
      .select('id')
      .where('id', 'in', [...new Set(personIds)].toSorted())
      .orderBy('id')
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
      .where('asset_face.personId', '=', personId)
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
    await db.updateTable('person').set({ identityId: input.identityId }).where('id', '=', input.personId).execute();
  }

  async unassignFaces({ sourceType }: UnassignFacesOptions): Promise<void> {
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
      .set({ personId: null })
      .where('asset_face.sourceType', '=', sourceType)
      .execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  @Chunked()
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.db.deleteFrom('person').where('person.id', 'in', ids).execute();
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
        .where('asset_face.personId', 'in', (eb) =>
          eb.selectFrom('person').select('person.id').where('person.type', '=', 'pet'),
        )
        .execute();

      await trx.deleteFrom('person').where('person.type', '=', 'pet').execute();
    });
  }

  getAllFaces(options: GetAllFacesOptions = {}) {
    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .$if(options.personId === null, (qb) => qb.where('asset_face.personId', 'is', null))
      .$if(!!options.personId, (qb) => qb.where('asset_face.personId', '=', options.personId!))
      .$if(!!options.sourceType, (qb) => qb.where('asset_face.sourceType', '=', options.sourceType!))
      .$if(!!options.assetId, (qb) => qb.where('asset_face.assetId', '=', options.assetId!))
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
      .select(['id', 'name', 'birthDate'])
      .where('ownerId', '=', ownerId)
      .where('isHidden', '=', false)
      .where('type', '=', 'person')
      .where('name', '!=', '')
      .where('birthDate', 'is not', null)
      .where(sql`extract(month from "birthDate")`, '=', month)
      .where(sql`extract(day from "birthDate")`, '=', day)
      .execute();
  }

  /**
   * Dormant people: named, non-hidden, non-pet persons whose most recent Timeline-visible,
   * previewable asset predates `lastSeenBefore`, with at least `minAssets` such assets ever.
   * The asset-side predicates mirror `AssetRepository.getMemoryFacesForPeriod` exactly — a
   * missing `Preview` file or an archived asset must not make a still-active person look dormant.
   */
  @GenerateSql({
    params: [DummyValue.UUID, { lastSeenBefore: DummyValue.DATE, minAssets: 10, limit: 10 }],
  })
  getDormantPeople(
    ownerId: string,
    { lastSeenBefore, minAssets, limit }: { lastSeenBefore: Date; minAssets: number; limit: number },
  ): Promise<DormantPerson[]> {
    return this.db
      .selectFrom('person')
      .select(['person.id', 'person.name'])
      .innerJoin('asset_face', 'asset_face.personId', 'person.id')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .where('person.ownerId', '=', ownerId)
      .where('person.type', '=', 'person')
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.ownerId', '=', ownerId)
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.deletedAt', 'is', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_file')
            .select('asset_file.assetId')
            .whereRef('asset_file.assetId', '=', 'asset.id')
            .where('asset_file.type', '=', AssetFileType.Preview),
        ),
      )
      .groupBy('person.id')
      .having((eb) => eb.fn.max('asset.localDateTime'), '<', lastSeenBefore)
      .having((eb) => eb.fn.count(eb.fn('distinct', ['asset.id'])), '>=', minAssets)
      .orderBy((eb) => eb.fn.count(eb.fn('distinct', ['asset.id'])), 'desc')
      .orderBy('person.id', 'asc')
      .limit(limit)
      .execute();
  }

  @GenerateSql()
  getFileSamples() {
    return this.db
      .selectFrom('person')
      .select(['id', 'thumbnailPath'])
      .where('thumbnailPath', '!=', sql.lit(''))
      .limit(sql.lit(3))
      .execute();
  }

  @GenerateSql({ params: [{ take: 1, skip: 0 }, DummyValue.UUID] })
  async getAllForUser(pagination: PaginationOptions, userId: string, options?: PersonSearchOptions) {
    const items = await this.db
      .selectFrom('person')
      .selectAll('person')
      .innerJoin('asset_face', 'asset_face.personId', 'person.id')
      .innerJoin('asset', (join) =>
        join
          .onRef('asset_face.assetId', '=', 'asset.id')
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
      .groupBy('person.id')
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
          .orderBy('person.id'),
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
          .onRef('asset_face.personId', '=', 'person.id')
          .on('asset_face.deletedAt', 'is', null)
          .on('asset_face.isVisible', 'is', true),
      )
      .groupBy('person.id')
      .having((eb) => eb.fn.count('asset_face.assetId'), '=', 0)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getFaces(assetId: string, options?: { isVisible?: boolean }) {
    const isVisible = options === undefined ? true : options.isVisible;

    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .select(withPerson)
      .where('asset_face.assetId', '=', assetId)
      .where('asset_face.deletedAt', 'is', null)
      .$if(isVisible !== undefined, (qb) => qb.where('asset_face.isVisible', '=', isVisible!))
      .orderBy('asset_face.boundingBoxX1', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getFaceById(id: string) {
    // TODO return null instead of find or fail
    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .select(withPerson)
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
      .select(withPerson)
      .where('asset_face.id', '=', id)
      .where((eb) => reviewableAssetVisibility(eb))
      .executeTakeFirstOrThrow();
  }

  // Sibling of getFaceByIdIncludingTombstoned for the admin PREVIEW route, which serves the whole source
  // photo rather than a 250px crop. It adds one filter: the asset must not be in the trash. The face
  // tombstone is deliberately still allowed through — the resolutions history renders tombstoned faces, so
  // a future magnifier there needs no server change.
  @GenerateSql({ params: [DummyValue.UUID] })
  getFaceByIdOnLiveAsset(id: string) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .selectAll('asset_face')
      .select(withPerson)
      .where('asset_face.id', '=', id)
      .where('asset.deletedAt', 'is', null)
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
            eb('asset_face.personId', '=', eb.ref('person.id')),
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
      .where('person.id', '=', options.personId)
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
            eb('asset_face.personId', '=', eb.ref('person.id')),
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
      .where('person.id', '=', options.personId)
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
      .select(['asset_face.id', 'asset_face.assetId', 'asset_face.personId', 'asset_face.sourceType'])
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('asset')
            .select(['asset.ownerId', 'asset.visibility', 'asset.fileCreatedAt'])
            .whereRef('asset.id', '=', 'asset_face.assetId'),
        ).as('asset'),
      )
      .select(withFaceSearch)
      .where('asset_face.id', '=', id)
      .where('asset_face.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getDataForThumbnailGenerationJob(id: string) {
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
      .where('person.id', '=', id)
      .where('asset_face.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async reassignFace(
    assetFaceId: string,
    newPersonId: string,
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<number> {
    const result = await db
      .updateTable('asset_face')
      .set({ personId: newPersonId })
      .where('asset_face.id', '=', assetFaceId)
      .executeTakeFirst();

    return Number(result.numChangedRows ?? 0);
  }

  getById(personId: string) {
    return this.db //
      .selectFrom('person')
      .selectAll('person')
      .where('person.id', '=', personId)
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
      .select(['person.id', 'person.name'])
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
  @GenerateSql({ params: [DummyValue.UUID] }, { params: [DummyValue.UUID, { memberUserId: DummyValue.UUID }] })
  async getStatistics(personId: string, options: { memberUserId?: string } = {}): Promise<PersonStatistics> {
    const result = await this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .select((eb) => eb.fn.count(eb.fn('distinct', ['asset.id'])).as('assets'))
      .select((eb) => eb.fn.count(eb.fn('distinct', ['asset_face.id'])).as('faces'))
      .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .where('asset_face.personId', '=', personId)
      .$if(!!options.memberUserId, (qb) =>
        qb.where((eb) =>
          eb.or(
            spaceAssetPathBranches(eb, {
              correlateAssetId: 'asset.id',
              correlateLibraryId: 'asset.libraryId',
              scope: { memberUserId: options.memberUserId! },
            }),
          ),
        ),
      )
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
          "person"."id",
          "person"."isHidden"
        FROM "person"
        INNER JOIN "asset_face" ON "asset_face"."personId" = "person"."id"
        INNER JOIN "asset" ON "asset"."id" = "asset_face"."assetId"
        WHERE "person"."ownerId" = ${userId}
          AND "asset"."visibility" = ${AssetVisibility.Timeline}
          AND "asset"."deletedAt" IS NULL
          AND "asset_face"."deletedAt" IS NULL
          AND "asset_face"."isVisible" = true
        GROUP BY "person"."id"
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
          "asset_face"."personId"
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
          "person"."id",
          "person"."isHidden"
        FROM "person"
        INNER JOIN "eligible_faces" ON "eligible_faces"."personId" = "person"."id"
        WHERE "person"."ownerId" = ${userId}
        GROUP BY "person"."id"
        HAVING NULLIF(BTRIM("person"."name"), '') IS NOT NULL
          OR COUNT(DISTINCT "eligible_faces"."assetFaceId") >= ${minimumFaceCount}
      )
      SELECT
        COUNT(DISTINCT "eligible_people"."id")::int AS "total",
        COUNT(DISTINCT "eligible_people"."id") FILTER (WHERE "eligible_people"."isHidden" = true)::int AS "hidden",
        COUNT(DISTINCT "eligible_faces"."assetFaceId")::int AS "detectedFaceCount"
      FROM "eligible_faces"
      LEFT JOIN "eligible_people" ON "eligible_people"."id" = "eligible_faces"."personId"
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
          "asset_face"."personId"
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
          "personId",
          COUNT(DISTINCT "assetFaceId")::int AS "assetCount"
        FROM "eligible_faces"
        WHERE "personId" IS NOT NULL
        GROUP BY "personId"
      ),
      "detected_faces" AS (
        SELECT
          "eligible_faces"."assetFaceId",
          "person"."id" AS "personId",
          NULLIF(BTRIM("person"."name"), '') IS NOT NULL AS "isNamed",
          CASE
            WHEN "person"."id" IS NOT NULL
              AND (
                NULLIF(BTRIM("person"."name"), '') IS NOT NULL
                OR "person_face_counts"."assetCount" >= ${minimumFaceCount}
              )
            THEN "person"."isHidden"
            ELSE NULL
          END AS "isHidden"
        FROM "eligible_faces"
        LEFT JOIN "person"
          ON "person"."id" = "eligible_faces"."personId"
          AND "person"."ownerId" = ${userId}
        LEFT JOIN "person_face_counts"
          ON "person_face_counts"."personId" = "person"."id"
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

  async createAll(people: Insertable<PersonTable>[]): Promise<string[]> {
    if (people.length === 0) {
      return [];
    }

    const results = await this.db.insertInto('person').values(people).returningAll().execute();
    return results.map(({ id }) => id);
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

  async update(person: Updateable<PersonTable> & { id: string }, db: Kysely<DB> | Transaction<DB> = this.db) {
    return db
      .updateTable('person')
      .set(person)
      .where('person.id', '=', person.id)
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
        oc.column('id').doUpdateSet((eb) =>
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

  @GenerateSql({ params: [[{ assetId: DummyValue.UUID, personId: DummyValue.UUID }]] })
  @ChunkedArray()
  getFacesByIds(ids: AssetFaceId[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    const assetIds: string[] = [];
    const personIds: string[] = [];
    for (const { assetId, personId } of ids) {
      assetIds.push(assetId);
      personIds.push(personId);
    }

    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .select(withPerson)
      .where('asset_face.assetId', 'in', assetIds)
      .where('asset_face.personId', 'in', personIds)
      .where('asset_face.deletedAt', 'is', null)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, 20] })
  getAssignedFaceEmbeddings(personId: string, limit: number) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select('face_search.embedding')
      .where('asset_face.personId', '=', personId)
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
      .select(['person.id', 'person.ownerId'])
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where('person.type', '=', 'person')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
            .select('asset_face.id')
            .whereRef('asset_face.personId', '=', 'person.id')
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
            .where('asset_face.personId', 'is', null)
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.sourceType', '=', SourceType.MachineLearning)
            .where((eb2) => reviewableAssetVisibility(eb2)),
        ),
      )
      .stream();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getRandomFace(personId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    return db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .where('asset_face.personId', '=', personId)
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

  @GenerateSql({ params: [[DummyValue.UUID]] })
  @Chunked()
  getForPeopleDelete(ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.db.selectFrom('person').select(['id', 'thumbnailPath']).where('id', 'in', ids).execute();
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

  @GenerateSql({ params: [{ personId: DummyValue.UUID, assetId: DummyValue.UUID }] })
  getForFeatureFaceUpdate({ personId, assetId }: { personId: string; assetId: string }) {
    return this.db
      .selectFrom('asset_face')
      .select('asset_face.id')
      .where('asset_face.assetId', '=', assetId)
      .where('asset_face.personId', '=', personId)
      .innerJoin('asset', (join) => join.onRef('asset.id', '=', 'asset_face.assetId').on('asset.isOffline', '=', false))
      .executeTakeFirst();
  }
}
