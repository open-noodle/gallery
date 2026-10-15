import { Kysely, sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { DB } from 'src/schema/index.js';
import * as scopeJit from 'src/schema/migrations-gallery/1799400000000-ScopeJitOffToDatabase.js';
import { getKyselyDB } from 'test/utils.js';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

// The jit entry of pg_db_role_setting for this database (role 0) and for the connecting role (database 0).
const jitSettings = async () => {
  const { rows } = await sql<{ scope: string; jit: string | null }>`
    SELECT CASE WHEN s.setdatabase = 0 THEN 'role' ELSE 'database' END AS scope,
           (SELECT c FROM unnest(s.setconfig) c WHERE c LIKE 'jit=%') AS jit
      FROM pg_db_role_setting s
     WHERE (s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database()) AND s.setrole = 0)
        OR (s.setdatabase = 0 AND s.setrole = (SELECT oid FROM pg_roles WHERE rolname = CURRENT_USER))
  `.execute(db);
  return Object.fromEntries(rows.filter((row) => row.jit).map((row) => [row.scope, row.jit]));
};

describe('1799400000000-ScopeJitOffToDatabase', () => {
  it('moves jit=off from the role to the database, and back on down()', async () => {
    await sql`ALTER ROLE CURRENT_USER SET jit = off`.execute(db);
    await sql`DO $$ BEGIN EXECUTE format('ALTER DATABASE %I RESET jit', current_database()); END $$`.execute(db);
    expect(await jitSettings()).toEqual({ role: 'jit=off' });

    await scopeJit.up(db);
    expect(await jitSettings()).toEqual({ database: 'jit=off' });

    await scopeJit.down(db);
    expect(await jitSettings()).toEqual({ role: 'jit=off' });
  });
});
