import { Kysely, sql } from 'kysely';

// 1783628194057-DisablePostgresJit set jit=off on the connecting role, which then carried the setting
// into every database that role uses, and a revert run as another role could not reset it. Keep the
// setting on Immich's database instead and reset the role. Role settings outrank database settings,
// so the role reset is what lets the database one apply.
//
// ALTER DATABASE needs the database owner or a superuser. Without that privilege the role setting
// stays as it was and the server still boots.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      EXECUTE format('ALTER DATABASE %I SET jit = off', current_database());
      EXECUTE 'ALTER ROLE CURRENT_USER RESET jit';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'jit=off stays on role %: it cannot alter database %', CURRENT_USER, current_database();
    END $$
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER ROLE CURRENT_USER SET jit = off`.execute(db);
  await sql`
    DO $$
    BEGIN
      EXECUTE format('ALTER DATABASE %I RESET jit', current_database());
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END $$
  `.execute(db);
}
