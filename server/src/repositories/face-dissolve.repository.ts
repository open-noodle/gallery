import { Injectable } from '@nestjs/common';
import { Kysely, Transaction } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';
import { DissolveScope, dissolveScopePredicate } from 'src/utils/face-dissolve';

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
}
