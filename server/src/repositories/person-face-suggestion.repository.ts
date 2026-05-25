import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetVisibility } from 'src/enum';
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

  @GenerateSql({ params: [[{ spacePersonId: DummyValue.UUID, assetFaceId: DummyValue.UUID, distance: 0.6 }]] })
  async upsertPendingForSpacePerson(
    rows: Array<{ spacePersonId: string; assetFaceId: string; distance: number }>,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db
      .insertInto('person_face_suggestion')
      .values(rows.map((r) => ({ spacePersonId: r.spacePersonId, assetFaceId: r.assetFaceId, distance: r.distance })))
      .onConflict((oc) =>
        oc
          .columns(['spacePersonId', 'assetFaceId'])
          .where('spacePersonId', 'is not', null)
          .doUpdateSet({
            distance: (eb) => eb.ref('excluded.distance'),
            updatedAt: sql`now()`,
          })
          .where('person_face_suggestion.status', '=', 'pending'),
      )
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

  private async markPersonalResolved(
    personId: string,
    assetFaceId: string,
    status: 'rejected' | 'ignored',
  ): Promise<number> {
    const result = await this.db
      .updateTable('person_face_suggestion')
      .set({ status })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markRejected(personId: string, assetFaceId: string): Promise<number> {
    return this.markPersonalResolved(personId, assetFaceId, 'rejected');
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markIgnored(personId: string, assetFaceId: string): Promise<number> {
    return this.markPersonalResolved(personId, assetFaceId, 'ignored');
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markConfirmedForSpacePerson(spacePersonId: string, assetFaceId: string): Promise<number> {
    const result = await this.db
      .updateTable('person_face_suggestion')
      .set({ status: 'confirmed' })
      .where('spacePersonId', '=', spacePersonId)
      .where('assetFaceId', '=', assetFaceId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  private async markSpacePersonResolved(
    spacePersonId: string,
    assetFaceId: string,
    status: 'rejected' | 'ignored',
  ): Promise<number> {
    const result = await this.db
      .updateTable('person_face_suggestion')
      .set({ status })
      .where('spacePersonId', '=', spacePersonId)
      .where('assetFaceId', '=', assetFaceId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markRejectedForSpacePerson(spacePersonId: string, assetFaceId: string): Promise<number> {
    return this.markSpacePersonResolved(spacePersonId, assetFaceId, 'rejected');
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markIgnoredForSpacePerson(spacePersonId: string, assetFaceId: string): Promise<number> {
    return this.markSpacePersonResolved(spacePersonId, assetFaceId, 'ignored');
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

  @GenerateSql({
    params: [DummyValue.UUID, DummyValue.UUID, { maxDistance: 0.5, suggestionMaxDistance: 0.8, page: 1, size: 10 }],
  })
  async getPendingForSpacePerson(
    spaceId: string,
    spacePersonId: string,
    opts: { maxDistance: number; suggestionMaxDistance: number; page: number; size: number },
  ) {
    if (opts.suggestionMaxDistance <= opts.maxDistance) {
      return { total: 0, items: [] };
    }

    const scannable = await this.db
      .selectFrom('shared_space_person')
      .innerJoin('shared_space', 'shared_space.id', 'shared_space_person.spaceId')
      .select('shared_space_person.id')
      .where('shared_space_person.id', '=', spacePersonId)
      .where('shared_space_person.spaceId', '=', spaceId)
      .where(sql`BTRIM("shared_space_person"."name")`, '<>', '')
      .where('shared_space_person.isHidden', 'is', false)
      .where('shared_space_person.type', '=', 'person')
      .where('shared_space.faceRecognitionEnabled', 'is', true)
      .executeTakeFirst();
    if (!scannable) {
      return { total: 0, items: [] };
    }

    const base = this.db
      .selectFrom('person_face_suggestion as pfs')
      .innerJoin('asset_face as af', 'af.id', 'pfs.assetFaceId')
      .innerJoin('asset', 'asset.id', 'af.assetId')
      .where('pfs.spacePersonId', '=', spacePersonId)
      .where('pfs.status', '=', 'pending')
      .where('pfs.distance', '>', opts.maxDistance)
      .where('pfs.distance', '<=', opts.suggestionMaxDistance)
      .where('af.personId', 'is', null)
      .where('af.deletedAt', 'is', null)
      .where('af.isVisible', 'is', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', 'is', false)
      .where('asset.visibility', 'in', [AssetVisibility.Archive, AssetVisibility.Timeline])
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .select('shared_space_asset.assetId')
              .whereRef('shared_space_asset.assetId', '=', 'asset.id')
              .where('shared_space_asset.spaceId', '=', spaceId),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .select('shared_space_library.libraryId')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .where('shared_space_library.spaceId', '=', spaceId),
          ),
        ]),
      );

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

  @GenerateSql({
    params: [DummyValue.UUID, DummyValue.UUID, DummyValue.UUID, { maxDistance: 0.5, suggestionMaxDistance: 0.8 }],
  })
  async hasPendingForSpacePerson(
    spaceId: string,
    spacePersonId: string,
    assetFaceId: string,
    opts: { maxDistance: number; suggestionMaxDistance: number },
  ): Promise<boolean> {
    if (opts.suggestionMaxDistance <= opts.maxDistance) {
      return false;
    }

    const row = await this.db
      .selectFrom('person_face_suggestion as pfs')
      .innerJoin('shared_space_person', 'shared_space_person.id', 'pfs.spacePersonId')
      .innerJoin('shared_space', 'shared_space.id', 'shared_space_person.spaceId')
      .innerJoin('asset_face as af', 'af.id', 'pfs.assetFaceId')
      .innerJoin('asset', 'asset.id', 'af.assetId')
      .select('pfs.assetFaceId')
      .where('pfs.spacePersonId', '=', spacePersonId)
      .where('pfs.assetFaceId', '=', assetFaceId)
      .where('pfs.status', '=', 'pending')
      .where('pfs.distance', '>', opts.maxDistance)
      .where('pfs.distance', '<=', opts.suggestionMaxDistance)
      .where('shared_space_person.spaceId', '=', spaceId)
      .where(sql`BTRIM("shared_space_person"."name")`, '<>', '')
      .where('shared_space_person.isHidden', 'is', false)
      .where('shared_space_person.type', '=', 'person')
      .where('shared_space.faceRecognitionEnabled', 'is', true)
      .where('af.personId', 'is', null)
      .where('af.deletedAt', 'is', null)
      .where('af.isVisible', 'is', true)
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', 'is', false)
      .where('asset.visibility', 'in', [AssetVisibility.Archive, AssetVisibility.Timeline])
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('shared_space_asset')
              .select('shared_space_asset.assetId')
              .whereRef('shared_space_asset.assetId', '=', 'asset.id')
              .where('shared_space_asset.spaceId', '=', spaceId),
          ),
          eb.exists(
            eb
              .selectFrom('shared_space_library')
              .select('shared_space_library.libraryId')
              .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
              .where('shared_space_library.spaceId', '=', spaceId),
          ),
        ]),
      )
      .executeTakeFirst();

    return !!row;
  }
}
