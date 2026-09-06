import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Kysely, sql, Transaction } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetFileType, AssetVisibility, SourceType } from 'src/enum';
import { DB } from 'src/schema';
import { DissolveScope, dissolveScopePredicate } from 'src/utils/face-dissolve';

export interface DissolveWriteInput {
  personId: string;
  scope: DissolveScope;
  outcome: 'unassign' | 'delete-faces' | 'delete-faces-and-person';
  redetect: boolean;
}

export interface DissolveWriteResult {
  faces: number;
  assetsCleared: number;
  orphanedSpacePersonIds: string[];
  deletedThumbnailPath: string | null;
}

export interface DissolveCounts {
  faces: number;
  exif: number;
  mlWithEmbedding: number;
  mlWithoutEmbedding: number;
  softDeleted: number;
  assets: number;
  sharedAssets: number;
  notRedetectable: number;
}

const hasEmbedding = (eb: ExpressionBuilder<DB, 'asset_face'>) =>
  eb.exists(
    eb
      .selectFrom('face_search')
      .select(sql`1`.as('one'))
      .whereRef('face_search.faceId', '=', 'asset_face.id'),
  );

@Injectable()
export class FaceDissolveRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /**
   * Clears the recognition watermark for every asset holding an in-scope face of `personId`, so the ordinary
   * non-forced "Detect faces (missing)" pass re-processes exactly those assets. streamForDetectFacesJob
   * applies the `facesRecognizedAt IS NULL` filter only when `force === false` (asset-job.repository.ts:458).
   *
   * MUST run BEFORE the face rows are deleted — afterwards there is no personId left to find the assets by.
   */
  @GenerateSql({ params: [DummyValue.UUID, DissolveScope.All] })
  async clearFacesRecognizedAt(
    personId: string,
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
          .where('asset_face.personId', '=', personId)
          .where((inner) => dissolveScopePredicate(inner, scope)),
      )
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0);
  }

  /**
   * `notRedetectable` mirrors assetsWithPreviews() (asset-job.repository.ts:181) exactly: non-hidden,
   * not trashed, carrying a Preview file. On anything else the dissolve deletes the junk and recovers
   * nothing (L11), so the dialog must never promise a repair for those assets.
   */
  @GenerateSql({ params: [DummyValue.UUID, DissolveScope.All] })
  async getCounts(personId: string, scope: DissolveScope): Promise<DissolveCounts> {
    const inScope = (eb: ExpressionBuilder<DB, 'asset_face'>) =>
      eb.and([eb('asset_face.personId', '=', personId), dissolveScopePredicate(eb, scope)]);

    const faceRow = await this.db
      .selectFrom('asset_face')
      .select((eb) => [
        eb.fn.countAll<number>().as('faces'),
        eb.fn.countAll<number>().filterWhere('asset_face.sourceType', '=', SourceType.Exif).as('exif'),
        eb.fn.countAll<number>().filterWhere('asset_face.deletedAt', 'is not', null).as('softDeleted'),
        eb.fn
          .countAll<number>()
          .filterWhere((inner) =>
            inner.and([inner('asset_face.sourceType', '=', SourceType.MachineLearning), hasEmbedding(inner)]),
          )
          .as('mlWithEmbedding'),
        eb.fn
          .countAll<number>()
          .filterWhere((inner) =>
            inner.and([
              inner('asset_face.sourceType', '=', SourceType.MachineLearning),
              inner.not(hasEmbedding(inner)),
            ]),
          )
          .as('mlWithoutEmbedding'),
        eb.fn.count<number>('asset_face.assetId').distinct().as('assets'),
      ])
      .where((eb) => inScope(eb))
      .executeTakeFirstOrThrow();

    const assetIds = this.db
      .selectFrom('asset_face')
      .select('asset_face.assetId')
      .distinct()
      .where((eb) => inScope(eb));

    const sharedRow = await this.db
      .selectFrom('asset')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('asset.id', 'in', assetIds)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face as other')
            .select(sql`1`.as('one'))
            .whereRef('other.assetId', '=', 'asset.id')
            .where('other.personId', 'is not', null)
            .where('other.personId', '!=', personId)
            .where('other.deletedAt', 'is', null)
            // Pet faces can never be lost to re-detection: handleDetectFaces keeps face.isPet out of
            // faceIdsToRemove (person.service.ts:940-946), so a sibling pet carries no L3 risk (F1).
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
                      .selectFrom('person')
                      .select(sql`1`.as('one'))
                      .whereRef('person.id', '=', 'other.personId')
                      .where('person.type', '=', 'pet'),
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
      .where('asset.id', 'in', assetIds)
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

    return {
      faces: Number(faceRow.faces),
      exif: Number(faceRow.exif),
      mlWithEmbedding: Number(faceRow.mlWithEmbedding),
      mlWithoutEmbedding: Number(faceRow.mlWithoutEmbedding),
      softDeleted: Number(faceRow.softDeleted),
      assets: Number(faceRow.assets),
      sharedAssets: Number(sharedRow.count),
      notRedetectable: Number(notRedetectableRow.count),
    };
  }

  /**
   * One transaction. Ordering is load-bearing:
   *  1. capture space-person ids first (L1) — afterwards the shared_space_person_face rows are gone;
   *  2. clear the watermark — afterwards there is no personId to find the assets by;
   *  3. only then write.
   * Every statement is scoped by personId + scope. Never call the unscoped GC helpers here (L1/L2/L5).
   */
  async dissolve(input: DissolveWriteInput): Promise<DissolveWriteResult> {
    const { personId, scope, outcome, redetect } = input;

    return this.db.transaction().execute(async (trx) => {
      const inScope = (eb: ExpressionBuilder<DB, 'asset_face'>) =>
        eb.and([eb('asset_face.personId', '=', personId), dissolveScopePredicate(eb, scope)]);

      const spacePersonRows = await trx
        .selectFrom('shared_space_person_face')
        .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
        .select('shared_space_person_face.personId as id')
        .distinct()
        .where((eb) => inScope(eb))
        .execute();

      const assetsCleared = redetect ? await this.clearFacesRecognizedAt(personId, scope, trx) : 0;

      let faces: number;
      if (outcome === 'unassign') {
        // Clear the human-placement record too. Leaving it marks the faces settled forever, excluding them
        // from recognition and suggestions — the bug documented at person.repository.ts:327. Keyed by OUR
        // face ids, never by identityId: identities are shared across people after a merge (L4).
        await trx
          .deleteFrom('face_identity_face')
          .where('assetFaceId', 'in', (eb) =>
            eb
              .selectFrom('asset_face')
              .select('id')
              .where((inner) => inScope(inner)),
          )
          .execute();

        const updated = await trx
          .updateTable('asset_face')
          .set({ personId: null })
          .where((eb) => inScope(eb))
          .executeTakeFirst();
        faces = Number(updated.numUpdatedRows ?? 0);
      } else {
        const deleted = await trx
          .deleteFrom('asset_face')
          .where((eb) => inScope(eb))
          .executeTakeFirst();
        faces = Number(deleted.numDeletedRows ?? 0);
      }

      // Only the space persons WE orphaned. deleteAllOrphanedPersons() is instance-wide (L1).
      const orphanedSpacePersonIds: string[] = [];
      if (spacePersonRows.length > 0) {
        const candidateIds = spacePersonRows.map((r) => r.id);
        const stillLinked = await trx
          .selectFrom('shared_space_person_face')
          .select('personId')
          .distinct()
          .where('personId', 'in', candidateIds)
          .execute();
        const linked = new Set(stillLinked.map((r) => r.personId));
        for (const id of candidateIds) {
          if (!linked.has(id)) {
            orphanedSpacePersonIds.push(id);
          }
        }
        if (orphanedSpacePersonIds.length > 0) {
          await trx.deleteFrom('shared_space_person').where('id', 'in', orphanedSpacePersonIds).execute();
        }
      }

      // Exactly one person row, never a library-wide cleanup (L2).
      let deletedThumbnailPath: string | null = null;
      if (outcome === 'delete-faces-and-person') {
        const person = await trx
          .selectFrom('person')
          .select(['thumbnailPath'])
          .where('id', '=', personId)
          .executeTakeFirst();
        if (person) {
          deletedThumbnailPath = person.thumbnailPath === '' ? null : person.thumbnailPath;
          await trx.deleteFrom('person').where('id', '=', personId).execute();
        }
      }

      return { faces, assetsCleared, orphanedSpacePersonIds, deletedThumbnailPath };
    });
  }
}
