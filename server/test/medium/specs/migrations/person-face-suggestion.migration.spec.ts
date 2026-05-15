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
    const cols = rows.rows.map((r) => r.column_name).sort();
    expect(cols).toEqual(
      ['assetFaceId', 'createdAt', 'distance', 'id', 'personId', 'status', 'updateId', 'updatedAt'].sort(),
    );
  });

  it('enforces the unique (personId, assetFaceId) constraint', async () => {
    const c = await sql<{ count: string }>`
      SELECT COUNT(*) AS count FROM pg_indexes
      WHERE tablename = 'person_face_suggestion'
        AND indexdef ILIKE '%UNIQUE%("personId", "assetFaceId")%'
    `.execute(db);
    expect(Number(c.rows[0].count)).toBeGreaterThan(0);
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
});
