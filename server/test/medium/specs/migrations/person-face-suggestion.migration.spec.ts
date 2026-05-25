import { Kysely, sql } from 'kysely';
import { PersonFaceSuggestionRepository } from 'src/repositories/person-face-suggestion.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { up as upIntentStatuses, down as downIntentStatuses } from 'src/schema/migrations-gallery/1779100000000-AddFaceSuggestionIntentStatuses';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

afterAll(async () => {
  await db.destroy();
});

async function seedPendingSuggestion(testDb: Kysely<DB>) {
  const { ctx } = newMediumService(BaseService, {
    database: testDb,
    real: [PersonFaceSuggestionRepository],
    mock: [LoggingRepository],
  });
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { result: person } = await ctx.newPerson({ ownerId: user.id, name: 'Suggestion Target' });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });

  await ctx.get(PersonFaceSuggestionRepository).upsertPending([
    { personId: person.id, assetFaceId: assetFace.id, distance: 0.6 },
  ]);

  return { personId: person.id, assetFaceId: assetFace.id };
}

describe('person_face_suggestion migration', () => {
  it('creates the table with the expected columns', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'person_face_suggestion'
    `.execute(db);
    const cols = rows.rows.map((r) => r.column_name).toSorted();
    expect(cols).toEqual(
      [
        'assetFaceId',
        'createdAt',
        'distance',
        'id',
        'personId',
        'spacePersonId',
        'status',
        'updateId',
        'updatedAt',
      ].toSorted(),
    );
  });

  it('allows exactly one nullable suggestion target', async () => {
    const columns = await sql<{ column_name: string; is_nullable: string }>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'person_face_suggestion'
        AND column_name IN ('personId', 'spacePersonId')
    `.execute(db);
    expect(Object.fromEntries(columns.rows.map((row) => [row.column_name, row.is_nullable]))).toEqual({
      personId: 'YES',
      spacePersonId: 'YES',
    });

    const checks = await sql<{ count: string }>`
      SELECT COUNT(*) AS count
      FROM pg_constraint
      WHERE conrelid = 'person_face_suggestion'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%num_nonnulls%'
        AND pg_get_constraintdef(oid) ILIKE '%"personId"%'
        AND pg_get_constraintdef(oid) ILIKE '%"spacePersonId"%'
        AND pg_get_constraintdef(oid) LIKE '%= 1%'
    `.execute(db);
    expect(Number(checks.rows[0].count)).toBe(1);
  });

  it('defines the personal and space-person suggestion indexes', async () => {
    const indexes = await sql<{ indexname: string; indexdef: string }>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'person_face_suggestion'
        AND indexname IN (
          'person_face_suggestion_personId_assetFaceId_uq',
          'person_face_suggestion_spacePersonId_assetFaceId_uq',
          'person_face_suggestion_spacePersonId_status_distance_idx'
        )
    `.execute(db);
    const indexDefinitions = Object.fromEntries(indexes.rows.map((row) => [row.indexname, row.indexdef]));

    expect(indexDefinitions.person_face_suggestion_personId_assetFaceId_uq).toContain('UNIQUE INDEX');
    expect(indexDefinitions.person_face_suggestion_personId_assetFaceId_uq).toContain('("personId", "assetFaceId")');
    expect(indexDefinitions.person_face_suggestion_personId_assetFaceId_uq).toContain(
      'WHERE ("personId" IS NOT NULL)',
    );

    expect(indexDefinitions.person_face_suggestion_spacePersonId_assetFaceId_uq).toContain('UNIQUE INDEX');
    expect(indexDefinitions.person_face_suggestion_spacePersonId_assetFaceId_uq).toContain(
      '("spacePersonId", "assetFaceId")',
    );
    expect(indexDefinitions.person_face_suggestion_spacePersonId_assetFaceId_uq).toContain(
      'WHERE ("spacePersonId" IS NOT NULL)',
    );

    expect(indexDefinitions.person_face_suggestion_spacePersonId_status_distance_idx).toContain(
      '("spacePersonId", status, distance)',
    );
    expect(indexDefinitions.person_face_suggestion_spacePersonId_status_distance_idx).toContain(
      'WHERE ("spacePersonId" IS NOT NULL)',
    );
  });

  it('keeps the personal suggestion status and asset face indexes', async () => {
    const c = await sql<{ count: string }>`
      SELECT COUNT(*) AS count FROM pg_indexes
      WHERE tablename = 'person_face_suggestion'
        AND indexname IN (
          'person_face_suggestion_personId_status_distance_idx',
          'person_face_suggestion_assetFaceId_idx'
        )
    `.execute(db);
    expect(Number(c.rows[0].count)).toBe(2);
  });

  it('defines the status check constraint with intent statuses', async () => {
    const r = await sql<{ definition: string }>`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conname = 'person_face_suggestion_status_chk'
        AND contype = 'c'
    `.execute(db);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].definition).toContain("'pending'");
    expect(r.rows[0].definition).toContain("'confirmed'");
    expect(r.rows[0].definition).toContain("'rejected'");
    expect(r.rows[0].definition).toContain("'ignored'");
    expect(r.rows[0].definition).not.toContain("'dismissed'");
  });

  it('converts dismissed suggestions to rejected on up and back to dismissed on down', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        const migrationDb = trx as unknown as Kysely<unknown>;

        await downIntentStatuses(migrationDb);
        const { personId, assetFaceId } = await seedPendingSuggestion(trx);

        await trx
          .updateTable('person_face_suggestion')
          .set({ status: sql`dismissed` })
          .where('personId', '=', personId)
          .where('assetFaceId', '=', assetFaceId)
          .execute();

        await upIntentStatuses(migrationDb);
        await expect(
          trx
            .selectFrom('person_face_suggestion')
            .select('status')
            .where('personId', '=', personId)
            .where('assetFaceId', '=', assetFaceId)
            .executeTakeFirstOrThrow(),
        ).resolves.toMatchObject({ status: 'rejected' });

        await downIntentStatuses(migrationDb);
        await expect(
          trx
            .selectFrom('person_face_suggestion')
            .select('status')
            .where('personId', '=', personId)
            .where('assetFaceId', '=', assetFaceId)
            .executeTakeFirstOrThrow(),
        ).resolves.toMatchObject({ status: 'dismissed' });

        throw new Error('rollback-intent-status-test');
      }),
    ).rejects.toThrow('rollback-intent-status-test');
  });

  it('allows rejected and ignored statuses and rejects removed status values', async () => {
    const { personId, assetFaceId } = await seedPendingSuggestion(db);
    const updateStatus = (status: string) =>
      db
        .updateTable('person_face_suggestion')
        .set({ status: sql`${status}` })
        .where('personId', '=', personId)
        .where('assetFaceId', '=', assetFaceId)
        .execute();

    await expect(updateStatus('rejected')).resolves.toBeDefined();
    await expect(updateStatus('ignored')).resolves.toBeDefined();
    await expect(updateStatus('dismissed')).rejects.toThrow('person_face_suggestion_status_chk');
    await expect(updateStatus('bogus')).rejects.toThrow('person_face_suggestion_status_chk');
  });

  it('registered the updatedAt trigger override row', async () => {
    const r = await sql<{ count: string }>`
      SELECT COUNT(*) AS count FROM migration_overrides
      WHERE name = 'trigger_person_face_suggestion_updatedAt'
    `.execute(db);
    expect(Number(r.rows[0].count)).toBe(1);
  });

  it('created the updatedAt trigger in the database', async () => {
    const r = await sql<{ count: string }>`
      SELECT COUNT(*) AS count FROM pg_trigger
      WHERE tgname = 'person_face_suggestion_updatedAt'
        AND tgrelid = 'person_face_suggestion'::regclass
    `.execute(db);
    expect(Number(r.rows[0].count)).toBe(1);
  });
});
