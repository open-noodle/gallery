import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { SourceType } from 'src/enum';
import { DB } from 'src/schema';

export interface EligibleFaceRow {
  assetFaceId: string;
  personId: string;
  ownerId: string;
  embedding: string;
}

export class FaceRepairRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  // Non-Timeline faces (e.g. Archive) are intentionally eligible: they may be left unassigned
  // after repair if recognition cannot re-home them, which is the accepted outcome (blank > wrong).
  streamEligibleFaces(options: { ownerId?: string; personId?: string }) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select([
        'asset_face.id as assetFaceId',
        'asset_face.personId as personId',
        'asset.ownerId as ownerId',
        sql<string>`face_search.embedding`.as('embedding'),
      ])
      .where('asset_face.personId', 'is not', null)
      .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .$if(!!options.ownerId, (qb) => qb.where('asset.ownerId', '=', options.ownerId!))
      .$if(!!options.personId, (qb) => qb.where('asset_face.personId', '=', options.personId!))
      .$narrowType<{ personId: string }>()
      .stream();
  }

  // Unassign the given faces ONLY if still assigned to `personId` and machine-learning-sourced (eligibility
  // re-check at write — a face moved by a concurrent job since planning is skipped). Returns the ids actually
  // unassigned (so the caller unlinks/queues exactly those).
  async unassignFacesFromPerson(personId: string, assetFaceIds: string[]): Promise<string[]> {
    if (assetFaceIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .updateTable('asset_face')
      .set({ personId: null })
      .where('id', 'in', assetFaceIds)
      .where('personId', '=', personId)
      .where('sourceType', '=', sql.lit(SourceType.MachineLearning))
      .where('deletedAt', 'is', null)
      .where('isVisible', '=', true)
      .returning('id')
      .execute();
    return rows.map((row) => row.id);
  }

  // Repoint any dangling representative face: if a person's faceAssetId no longer belongs to it (or is null),
  // reset it to any remaining assigned, visible, non-deleted face (or null if none remain).
  async reconcileRepresentativeFaces(personIds: string[]): Promise<void> {
    if (personIds.length === 0) {
      return;
    }
    await this.db
      .updateTable('person')
      .set((eb) => ({
        faceAssetId: eb
          .selectFrom('asset_face as remaining')
          .innerJoin('asset', 'asset.id', 'remaining.assetId')
          .select('remaining.id')
          .whereRef('remaining.personId', '=', 'person.id')
          .where('remaining.deletedAt', 'is', null)
          .where('remaining.isVisible', '=', true)
          .where('asset.deletedAt', 'is', null)
          .limit(1),
      }))
      .where('person.id', 'in', personIds)
      .where((eb) =>
        eb.or([
          eb('person.faceAssetId', 'is', null),
          eb.not(
            eb.exists(
              eb
                .selectFrom('asset_face as current')
                .select(sql`1`.as('one'))
                .whereRef('current.id', '=', 'person.faceAssetId')
                .whereRef('current.personId', '=', 'person.id'),
            ),
          ),
        ]),
      )
      .execute();
  }
}
