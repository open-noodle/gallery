import { Injectable } from '@nestjs/common';
import { Expression, ExpressionBuilder, Kysely, SqlBool, Transaction, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetFileType, AssetVisibility, SourceType } from 'src/enum.js';
import {
  deleteFacePredicate,
  DissolveScope,
  dissolveFacePredicate,
  dissolveScopePredicate,
  hideFacePredicate,
  keepFacePredicate,
} from 'src/gallery/utils/face-dissolve.js';
import { personIsPet } from 'src/gallery/utils/person-sidecar.js';
import { DB } from 'src/schema/index.js';

export interface DissolveWriteInput {
  /**
   * The person's public id. Upstream repointed `asset_face` at `person_group` and dropped `person.id`,
   * so this is `person.personGroupId` — sound under Option M's 1:1 person_group-to-person invariant
   * (see PersonRepository.getByGroupIdOnly).
   */
  personGroupId: string;
  scope: DissolveScope;
  /** Snapshotted onto the restore record, which outlives the person. */
  ownerId: string;
  personName: string;
  actorId: string;
}

export interface DissolveWriteResult {
  /** The restore record; null when the dissolve touched no face, so nothing was recorded. */
  dissolveId: string | null;
  /** The detected faces this dissolve hid. Faces that were already hidden are not in it. */
  hiddenFaceIds: string[];
  deleted: number;
  unassigned: number;
  assetsCleared: number;
  personRemoved: boolean;
  deletedThumbnailPath: string | null;
  orphanedSpacePersonIds: string[];
}

export interface DissolveCounts {
  /** Every in-scope row, hidden and crop-hidden included: what the apply touches, and its concurrency guard. */
  faces: number;
  /** In-scope faces by treatment (keepFacePredicate / hideFacePredicate / deleteFacePredicate). */
  hide: number;
  delete: number;
  keep: number;
  softDeleted: number;
  assets: number;
  /** Photos of the faces that get deleted: the only ones re-scanned. `sharedAssets`/`notRedetectable` are among these. */
  rescanAssets: number;
  sharedAssets: number;
  notRedetectable: number;
  /** Faces of the person outside the scope; the person is removed when none remain. */
  remainingFaces: number;
  personRemoved: boolean;
  spacePersonsRemoved: number;
  spacePersonsKept: number;
  spacesKept: number;
}

export interface PersonHealthRow {
  id: string;
  name: string;
  ownerId: string;
  faceCount: number;
  machineLearning: number;
  exif: number;
  manual: number;
  facesWithoutEmbedding: number;
}

export type PersonHealthSort = 'exifFaces' | 'facesWithoutEmbedding' | 'faceCount';

/** The sort key is an API-facing name; this maps it to the SELECT alias it actually orders by. */
const HEALTH_SORT_COLUMN: Record<PersonHealthSort, string> = {
  exifFaces: 'exif',
  facesWithoutEmbedding: 'facesWithoutEmbedding',
  faceCount: 'faceCount',
};

const hasEmbedding = (eb: ExpressionBuilder<DB, 'asset_face'>) =>
  eb.exists(
    eb
      .selectFrom('face_search')
      .select(sql`1`.as('one'))
      .whereRef('face_search.faceId', '=', 'asset_face.id'),
  );

/** Faces a dissolve takes off every Space person: the ones it hides and the ones it deletes. */
const leavesSpaces = (eb: ExpressionBuilder<DB, 'asset_face'>) =>
  eb.or([hideFacePredicate(eb), deleteFacePredicate(eb)]);

/** Postgres caps one statement at 65535 bind parameters; record rows go in well under that. */
const RECORD_CHUNK = 1000;

@Injectable()
export class FaceDissolveRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /**
   * Clears the recognition watermark for the photos of the in-scope faces a dissolve DELETES, so the ordinary
   * non-forced "Detect faces (missing)" pass re-processes exactly those photos. streamForDetectFacesJob applies the
   * `facesRecognizedAt IS NULL` filter only when `force === false`. Detected faces are hidden instead and their photos
   * are never re-scanned: the detector would find the same boxes again.
   *
   * MUST run BEFORE the face rows are deleted — afterwards there is no personGroupId left to find the photos by.
   */
  @GenerateSql({ params: [DummyValue.UUID, DissolveScope.All] })
  async clearFacesRecognizedAt(
    personGroupId: string,
    scope: DissolveScope,
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<number> {
    const result = await db
      .updateTable('asset_job_status')
      .set({ facesRecognizedAt: null })
      .where('assetId', 'in', (eb) =>
        eb
          .selectFrom('asset_face')
          .select('asset_face.assetId')
          .distinct()
          .where((inner) =>
            inner.and([dissolveFacePredicate(inner, personGroupId, scope), deleteFacePredicate(inner)]),
          ),
      )
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0);
  }

  /**
   * The preview. Uses the same predicates as dissolve(), so the dialog and the transaction cannot disagree.
   * `notRedetectable` mirrors assetsWithPreviews() exactly: non-hidden, not trashed, carrying a Preview file (L11).
   */
  @GenerateSql({ params: [DummyValue.UUID, DissolveScope.All] })
  async getCounts(personGroupId: string, scope: DissolveScope): Promise<DissolveCounts> {
    const inScope = (eb: ExpressionBuilder<DB, 'asset_face'>) => dissolveFacePredicate(eb, personGroupId, scope);

    const faceRow = await this.db
      .selectFrom('asset_face')
      .select((eb) => [
        eb.fn.countAll<number>().as('faces'),
        eb.fn
          .countAll<number>()
          .filterWhere((inner) => hideFacePredicate(inner))
          .as('hide'),
        eb.fn
          .countAll<number>()
          .filterWhere((inner) => deleteFacePredicate(inner))
          .as('delete'),
        eb.fn
          .countAll<number>()
          .filterWhere((inner) => keepFacePredicate(inner))
          .as('keep'),
        eb.fn.countAll<number>().filterWhere('asset_face.deletedAt', 'is not', null).as('softDeleted'),
        eb.fn.count<number>('asset_face.assetId').distinct().as('assets'),
      ])
      .where((eb) => inScope(eb))
      .executeTakeFirstOrThrow();

    const rescanAssetIds = this.db
      .selectFrom('asset_face')
      .select('asset_face.assetId')
      .distinct()
      .where((eb) => eb.and([inScope(eb), deleteFacePredicate(eb)]));

    const rescanRow = await this.db
      .selectFrom('asset')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('asset.id', 'in', rescanAssetIds)
      .executeTakeFirstOrThrow();

    const sharedRow = await this.db
      .selectFrom('asset')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('asset.id', 'in', rescanAssetIds)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face as other')
            .select(sql`1`.as('one'))
            .whereRef('other.assetId', '=', 'asset.id')
            .where('other.personGroupId', 'is not', null)
            .where('other.personGroupId', '!=', personGroupId)
            .where('other.deletedAt', 'is', null)
            // Pet faces can never be lost to re-detection: handleDetectFaces keeps them out of faceIdsToRemove,
            // so a sibling pet carries no L3 risk (F1).
            .where((inner) =>
              inner.not(
                inner.or([
                  inner.exists(
                    inner
                      .selectFrom('pet_search')
                      .select(sql`1`.as('one'))
                      .whereRef('pet_search.faceId', '=', 'other.id'),
                  ),
                  inner.exists(
                    inner
                      .selectFrom('person_pet')
                      .select(sql`1`.as('one'))
                      .whereRef('person_pet.personGroupId', '=', 'other.personGroupId'),
                  ),
                ]),
              ),
            ),
        ),
      )
      .executeTakeFirstOrThrow();

    const notRedetectableRow = await this.db
      .selectFrom('asset')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('asset.id', 'in', rescanAssetIds)
      .where((eb) =>
        eb.or([
          eb('asset.visibility', '=', AssetVisibility.Hidden),
          eb('asset.deletedAt', 'is not', null),
          eb.not(
            eb.exists(
              eb
                .selectFrom('asset_file')
                .select(sql`1`.as('one'))
                .whereRef('asset_file.assetId', '=', 'asset.id')
                .where('asset_file.type', '=', AssetFileType.Preview),
            ),
          ),
        ]),
      )
      .executeTakeFirstOrThrow();

    // What still carries the person after the dissolve: every out-of-scope face, in any state. dissolve() removes
    // the person exactly when this is zero.
    const remainingRow = await this.db
      .selectFrom('asset_face')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('asset_face.personGroupId', '=', personGroupId)
      .where((eb) => eb.not(dissolveScopePredicate(eb, scope)))
      .executeTakeFirstOrThrow();

    // A Space person survives when it is still linked to any face this dissolve does not take off it. NOT IN over
    // face ids, never a negated personGroupId comparison: other faces' personGroupId may be NULL.
    const spaceRows = await this.db
      .selectFrom('shared_space_person')
      .select((eb) => [
        'shared_space_person.spaceId',
        eb
          .exists(
            eb
              .selectFrom('shared_space_person_face as link')
              .select(sql`1`.as('one'))
              .whereRef('link.personId', '=', 'shared_space_person.id')
              .where('link.assetFaceId', 'not in', (inner) =>
                inner
                  .selectFrom('asset_face')
                  .select('asset_face.id')
                  .where((face) => face.and([inScope(face), leavesSpaces(face)])),
              ),
          )
          .as('kept'),
      ])
      .where('shared_space_person.id', 'in', (eb) =>
        eb
          .selectFrom('shared_space_person_face')
          .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
          .select('shared_space_person_face.personId')
          .where((inner) => inner.and([inScope(inner), leavesSpaces(inner)])),
      )
      .execute();
    const kept = spaceRows.filter((row) => row.kept);

    const remainingFaces = Number(remainingRow.count);
    return {
      faces: Number(faceRow.faces),
      hide: Number(faceRow.hide),
      delete: Number(faceRow.delete),
      keep: Number(faceRow.keep),
      softDeleted: Number(faceRow.softDeleted),
      assets: Number(faceRow.assets),
      rescanAssets: Number(rescanRow.count),
      sharedAssets: Number(sharedRow.count),
      notRedetectable: Number(notRedetectableRow.count),
      remainingFaces,
      personRemoved: remainingFaces === 0,
      spacePersonsRemoved: spaceRows.length - kept.length,
      spacePersonsKept: kept.length,
      spacesKept: new Set(kept.map((row) => row.spaceId)).size,
    };
  }

  /**
   * The contamination signal. Deliberately NOT the picker search (searchOwnerPeople) — this aggregate is what
   * makes a person with only EXIF faces findable at all, since no scan will ever flag one.
   */
  @GenerateSql({ params: [{ ownerId: DummyValue.UUID, sort: 'exifFaces', page: 1, size: 20 }] })
  async getPeopleHealth(options: {
    ownerId: string;
    sort: PersonHealthSort;
    page: number;
    size: number;
  }): Promise<{ people: PersonHealthRow[]; total: number; hasMore: boolean }> {
    const rows = await this.db
      .selectFrom('person')
      // Deliberately NOT filtered by deletedAt/isVisible. This aggregate's whole job is to predict what a
      // dissolve would find and remove, and a dissolve touches every face of the person in scope regardless
      // of visibility or soft-deletion (dissolveFacePredicate). Filtering them here made the Health tab
      // under-report against the dialog for the same person — an admin comparing the two saw numbers that
      // could not be reconciled, and the dissolve then deleted faces discovery never counted.
      .leftJoin('asset_face', (join) => join.onRef('asset_face.personGroupId', '=', 'person.personGroupId'))
      .where((eb) => eb.not(personIsPet('person')))
      // ownerId is mandatory: an unfiltered aggregate spans every visible asset_face row on the instance and
      // orders by an aggregate alias, so no page can be pruned and each page re-runs the whole GROUP BY.
      .where('person.ownerId', '=', options.ownerId)
      .select((eb) => [
        'person.personGroupId as id',
        'person.name',
        'person.ownerId',
        eb.fn.count<number>('asset_face.id').as('faceCount'),
        eb.fn.count<number>('asset_face.id').filterWhere('asset_face.sourceType', '=', SourceType.Exif).as('exif'),
        eb.fn
          .count<number>('asset_face.id')
          .filterWhere('asset_face.sourceType', '=', SourceType.MachineLearning)
          .as('machineLearning'),
        eb.fn.count<number>('asset_face.id').filterWhere('asset_face.sourceType', '=', SourceType.Manual).as('manual'),
        eb.fn
          .count<number>('asset_face.id')
          .filterWhere((inner) => inner.not(hasEmbedding(inner)))
          .as('facesWithoutEmbedding'),
      ])
      .groupBy(['person.personGroupId', 'person.name', 'person.ownerId'])
      .orderBy(sql.ref(HEALTH_SORT_COLUMN[options.sort]), 'desc')
      // Stable tiebreaker: ties are the common case here (every uncontaminated person ties at 0 under
      // exifFaces/facesWithoutEmbedding), and without one Postgres may order them differently per
      // execution, so the health tab's page-concatenating pagination can show a person twice while
      // silently skipping another. Same fix as face-repair.repository.ts:67 under the identical
      // limit(size+1)/offset scheme.
      .orderBy('person.personGroupId', 'asc')
      .limit(options.size + 1)
      .offset((options.page - 1) * options.size)
      .execute();

    const hasMore = rows.length > options.size;
    const people = rows.slice(0, options.size).map((row) => ({
      id: row.id,
      name: row.name,
      ownerId: row.ownerId,
      faceCount: Number(row.faceCount),
      exif: Number(row.exif),
      machineLearning: Number(row.machineLearning),
      manual: Number(row.manual),
      facesWithoutEmbedding: Number(row.facesWithoutEmbedding),
    }));

    const totalRow = await this.db
      .selectFrom('person')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where((eb) => eb.not(personIsPet('person')))
      .where('person.ownerId', '=', options.ownerId)
      .executeTakeFirstOrThrow();

    return { people, total: Number(totalRow.count), hasMore };
  }

  /**
   * The write. The caller owns the transaction (the service drains pending suggestions in the same one). Each
   * in-scope face gets one treatment by source: kept faces are unassigned, detected faces hidden and recorded for
   * restore, imported faces deleted with their photos re-queued. Ordering is load-bearing:
   *  1. capture the Space persons first — after the delete their links are gone;
   *  2. clear the watermark — after the delete there is no personGroupId to find the photos by;
   *  3. only then write. Every statement is scoped by personGroupId + scope. Never call the unscoped GC helpers
   *     here (L1/L2/L5).
   */
  async dissolve(input: DissolveWriteInput, trx: Transaction<DB>): Promise<DissolveWriteResult> {
    const { personGroupId, scope } = input;
    const inScope = (eb: ExpressionBuilder<DB, 'asset_face'>) => dissolveFacePredicate(eb, personGroupId, scope);
    const and =
      (...predicates: Array<(eb: ExpressionBuilder<DB, 'asset_face'>) => Expression<SqlBool>>) =>
      (eb: ExpressionBuilder<DB, 'asset_face'>) =>
        eb.and([inScope(eb), ...predicates.map((predicate) => predicate(eb))]);

    // 1. The Space persons this dissolve may empty.
    const spacePersonIds = (
      await trx
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .select('shared_space_person_face.personId as id')
        .distinct()
        .where(and(leavesSpaces))
        .execute()
    ).map((row) => row.id);

    // 2. Only the photos of deleted faces are re-scanned.
    const assetsCleared = await this.clearFacesRecognizedAt(personGroupId, scope, trx);

    // 3. Kept faces: unassigned, human-placement record cleared too (a stale manual link marks a face settled
    //    forever, person.repository.ts). Keyed by OUR face ids, never by identity id (L4).
    await trx
      .deleteFrom('face_identity_face')
      .where('assetFaceId', 'in', (eb) =>
        eb.selectFrom('asset_face').select('asset_face.id').where(and(keepFacePredicate)),
      )
      .execute();
    const unassigned = await trx
      .updateTable('asset_face')
      .set({ personGroupId: null })
      .where(and(keepFacePredicate))
      .executeTakeFirst();

    // 4. Detected faces: the "Not a face" tombstone. Recognition (getAllFaces, searchFaces) skips deletedAt faces, and
    //    a re-scan matches the tombstone instead of adding the box again.
    const hiddenFaceIds = (
      await trx
        .updateTable('asset_face')
        .set({ deletedAt: new Date(), personGroupId: null })
        .where(and(hideFacePredicate, (eb) => eb('asset_face.deletedAt', 'is', null)))
        .returning('asset_face.id')
        .execute()
    ).map((row) => row.id);
    if (hiddenFaceIds.length > 0) {
      await trx
        .deleteFrom('face_identity_face')
        .where('assetFaceId', '=', (eb) => eb.fn.any(eb.val(hiddenFaceIds)))
        .execute();
    }

    // 5. Detected faces that were already hidden: only the person link goes. Not recorded, so a restore of this
    //    dissolve leaves them hidden.
    const alreadyHidden = await trx
      .updateTable('asset_face')
      .set({ personGroupId: null })
      .where(and(hideFacePredicate, (eb) => eb('asset_face.deletedAt', 'is not', null)))
      .executeTakeFirst();

    // 6. Imported faces, soft-deleted ones included: a surviving tombstone would absorb the re-scan's detection (L12).
    const deleted = await trx.deleteFrom('asset_face').where(and(deleteFacePredicate)).executeTakeFirst();

    // 7-9. Spaces. A hidden face's row survives, so nothing cascades: unlink it here, remove only the Space persons
    //      this left with no face (never deleteAllOrphanedPersons, L1), and repoint a survivor showing a hidden face.
    if (hiddenFaceIds.length > 0) {
      await trx
        .deleteFrom('shared_space_person_face')
        .where('assetFaceId', '=', (eb) => eb.fn.any(eb.val(hiddenFaceIds)))
        .execute();
    }
    let orphanedSpacePersonIds: string[] = [];
    if (spacePersonIds.length > 0) {
      orphanedSpacePersonIds = (
        await trx
          .deleteFrom('shared_space_person')
          .where('id', '=', (eb) => eb.fn.any(eb.val(spacePersonIds)))
          .where((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom('shared_space_person_face')
                  .select(sql`1`.as('one'))
                  .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id'),
              ),
            ),
          )
          .returning('id')
          .execute()
      ).map((row) => row.id);

      await trx
        .updateTable('shared_space_person')
        .set((eb) => ({
          representativeFaceId: eb
            .selectFrom('shared_space_person_face as link')
            .innerJoin('asset_face', 'asset_face.id', 'link.assetFaceId')
            .select('link.assetFaceId')
            .whereRef('link.personId', '=', 'shared_space_person.id')
            .where('asset_face.deletedAt', 'is', null)
            .orderBy('link.assetFaceId')
            .limit(1),
        }))
        .where('id', '=', (eb) => eb.fn.any(eb.val(spacePersonIds)))
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('asset_face')
              .select(sql`1`.as('one'))
              .whereRef('asset_face.id', '=', 'shared_space_person.representativeFaceId')
              .where('asset_face.deletedAt', 'is not', null),
          ),
        )
        .execute();
    }

    // 10. Exactly one person row, and only once no face carries it (never PersonCleanup, L2).
    let personRemoved = false;
    let deletedThumbnailPath: string | null = null;
    const remaining = await trx
      .selectFrom('asset_face')
      .select('asset_face.id')
      .where('asset_face.personGroupId', '=', personGroupId)
      .limit(1)
      .execute();
    if (remaining.length === 0) {
      const removed = await trx
        .deleteFrom('person')
        .where('personGroupId', '=', personGroupId)
        .returning('thumbnailPath')
        .executeTakeFirst();
      if (removed) {
        personRemoved = true;
        deletedThumbnailPath = removed.thumbnailPath === '' ? null : removed.thumbnailPath;
      }
    }

    // 11. The restore record, written only when a face was touched.
    const unassignedCount = Number(unassigned.numUpdatedRows ?? 0);
    const deletedCount = Number(deleted.numDeletedRows ?? 0);
    const touched =
      hiddenFaceIds.length + unassignedCount + deletedCount + Number(alreadyHidden.numUpdatedRows ?? 0) > 0;
    let dissolveId: string | null = null;
    if (touched) {
      const record = await trx
        .insertInto('face_dissolve')
        .values({
          ownerId: input.ownerId,
          personGroupId,
          personName: input.personName,
          scope,
          actorId: input.actorId,
          hiddenCount: hiddenFaceIds.length,
          deletedCount,
          unassignedCount,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      dissolveId = record.id;
      for (let index = 0; index < hiddenFaceIds.length; index += RECORD_CHUNK) {
        await trx
          .insertInto('face_dissolve_face')
          .values(
            hiddenFaceIds
              .slice(index, index + RECORD_CHUNK)
              .map((assetFaceId) => ({ dissolveId: record.id, assetFaceId })),
          )
          .execute();
      }
    }

    return {
      dissolveId,
      hiddenFaceIds,
      deleted: deletedCount,
      unassigned: unassignedCount,
      assetsCleared,
      personRemoved,
      deletedThumbnailPath,
      orphanedSpacePersonIds,
    };
  }
}
