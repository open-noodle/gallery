import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';
// Side-effect import: registers every decorated table so the schema exists to assert against.
import 'src/schema';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('shared_space_album_hidden schema', () => {
  it('creates the table with the expected columns', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'shared_space_album_hidden'
    `.execute(db);
    expect(rows.rows.map((r) => r.column_name).toSorted()).toEqual([
      'albumId',
      'createId',
      'createdAt',
      'spaceId',
      'updateId',
      'updatedAt',
      'userId',
    ]);
  });

  it('creates the audit table with the expected columns', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'shared_space_album_hidden_audit'
    `.execute(db);
    expect(rows.rows.map((r) => r.column_name).toSorted()).toEqual([
      'albumId',
      'deletedAt',
      'id',
      'spaceId',
      'userId',
    ]);
  });

  it('keys the hidden row on (spaceId, albumId, userId)', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'shared_space_album_hidden'::regclass AND i.indisprimary
    `.execute(db);
    expect(rows.rows.map((r) => r.column_name).toSorted()).toEqual(['albumId', 'spaceId', 'userId']);
  });
});
