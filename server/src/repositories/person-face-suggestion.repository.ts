import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';

@Injectable()
export class PersonFaceSuggestionRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [[{ personId: DummyValue.UUID, assetFaceId: DummyValue.UUID, distance: 0.6 }]] })
  async upsertPending(rows: Array<{ personId: string; assetFaceId: string; distance: number }>): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db
      .insertInto('person_face_suggestion')
      .values(rows.map((r) => ({ personId: r.personId, assetFaceId: r.assetFaceId, distance: r.distance })))
      .onConflict((oc) =>
        oc
          .columns(['personId', 'assetFaceId'])
          .doUpdateSet({
            distance: (eb) => eb.ref('excluded.distance'),
            updatedAt: sql`now()`,
          })
          .where('person_face_suggestion.status', '=', 'pending'),
      )
      .execute();
  }
}
