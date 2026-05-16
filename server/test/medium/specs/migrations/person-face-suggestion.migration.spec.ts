import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';
import { getKyselyDB } from 'test/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

afterAll(async () => {
  await db.destroy();
});

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

  it('defines the status check constraint', async () => {
    const r = await sql<{ count: string }>`
      SELECT COUNT(*) AS count FROM pg_constraint
      WHERE conname = 'person_face_suggestion_status_chk'
        AND contype = 'c'
    `.execute(db);
    expect(Number(r.rows[0].count)).toBe(1);
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
