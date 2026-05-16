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
          .where('personId', 'is not', null)
          .doUpdateSet({
            distance: (eb) => eb.ref('excluded.distance'),
            updatedAt: sql`now()`,
          })
          .where('person_face_suggestion.status', '=', 'pending'),
      )
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async resolveAssignedFace(assetFaceId: string): Promise<void> {
    await this.db
      .deleteFrom('person_face_suggestion')
      .where('assetFaceId', '=', assetFaceId)
      .where('status', '=', 'pending')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markConfirmed(personId: string, assetFaceId: string): Promise<number> {
    const result = await this.db
      .updateTable('person_face_suggestion')
      .set({ status: 'confirmed' })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markDismissed(personId: string, assetFaceId: string): Promise<number> {
    const result = await this.db
      .updateTable('person_face_suggestion')
      .set({ status: 'dismissed' })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  @GenerateSql({
    params: [DummyValue.UUID, { maxDistance: 0.5, suggestionMaxDistance: 0.8, page: 1, size: 10 }],
  })
  async getPendingForPerson(
    personId: string,
    opts: { maxDistance: number; suggestionMaxDistance: number; page: number; size: number },
  ) {
    // Read gate: feature disabled when suggestion band is empty
    if (opts.suggestionMaxDistance <= opts.maxDistance) {
      return { total: 0, items: [] };
    }

    // Read gate: person must be scannable (named, not hidden, type='person')
    const scannable = await this.db
      .selectFrom('person')
      .select('person.id')
      .where('person.id', '=', personId)
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where('person.type', '=', 'person')
      .executeTakeFirst();
    if (!scannable) {
      return { total: 0, items: [] };
    }

    // The count and items queries below are two separate round-trips with no wrapping transaction.
    // A concurrent resolveAssignedFace between them can make total > items.length. This is an
    // acceptable trade-off for a background review queue where stale counts cause no harm.
    const base = this.db
      .selectFrom('person_face_suggestion as pfs')
      .innerJoin('asset_face as af', 'af.id', 'pfs.assetFaceId')
      .innerJoin('asset', 'asset.id', 'af.assetId')
      .where('pfs.personId', '=', personId)
      .where('pfs.status', '=', 'pending')
      .where('pfs.distance', '>', opts.maxDistance)
      .where('pfs.distance', '<=', opts.suggestionMaxDistance)
      .where('af.personId', 'is', null)
      .where('af.deletedAt', 'is', null);

    const totalRow = await base.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();

    const items = await base
      .select([
        'pfs.assetFaceId as assetFaceId',
        'pfs.distance as distance',
        'af.assetId as assetId',
        'af.imageWidth as imageWidth',
        'af.imageHeight as imageHeight',
        'af.boundingBoxX1 as boundingBoxX1',
        'af.boundingBoxX2 as boundingBoxX2',
        'af.boundingBoxY1 as boundingBoxY1',
        'af.boundingBoxY2 as boundingBoxY2',
        'asset.fileCreatedAt as fileCreatedAt',
      ])
      .orderBy('pfs.distance', 'asc')
      .limit(opts.size)
      .offset((opts.page - 1) * opts.size)
      .execute();

    return { total: Number(totalRow.total), items };
  }
}
