import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // H7: `UNIQUE (status) WHERE status IN ('pending','running')` is unique on the VALUE of status, so one
  // 'pending' row AND one 'running' row can coexist — two admins clicking Scan across the pending -> running
  // transition both succeed, and pruneSupersededScans then deletes the loser's flagged-face rows mid-flight.
  //
  // Before replacing the index, demote every in-flight row except the newest to 'failed'. An instance that
  // already hit the race may hold MORE than one in-flight row right now, and creating a unique index over
  // duplicates fails outright — this makes the migration idempotent on an already-raced database instead of
  // requiring a manual cleanup first.
  await sql`
    UPDATE "face_repair_scan"
       SET "status" = 'failed', "error" = 'superseded by in-flight uniqueness repair'
     WHERE "status" IN ('pending', 'running')
       AND "id" <> (
         SELECT "id" FROM "face_repair_scan" WHERE "status" IN ('pending', 'running') ORDER BY "createdAt" DESC LIMIT 1
       )
  `.execute(db);

  await sql`DROP INDEX IF EXISTS "face_repair_scan_in_flight_uq"`.execute(db);
  // A constant expression, so ALL in-flight rows share one key and at most one can exist. The previous index
  // was UNIQUE on the VALUE of status, which let one 'pending' row and one 'running' row coexist — exactly
  // the race the original comment claimed it closed.
  await sql`CREATE UNIQUE INDEX "face_repair_scan_in_flight_uq" ON "face_repair_scan" ((true)) WHERE "status" IN ('pending', 'running')`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_face_repair_scan_in_flight_uq', '{"type":"index","name":"face_repair_scan_in_flight_uq","sql":"CREATE UNIQUE INDEX \\"face_repair_scan_in_flight_uq\\" ON \\"face_repair_scan\\" ((true)) WHERE (\\"status\\" IN (''pending'', ''running''));"}'::jsonb) ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "face_repair_scan_in_flight_uq"`.execute(db);
  await sql`CREATE UNIQUE INDEX "face_repair_scan_in_flight_uq" ON "face_repair_scan" ("status") WHERE "status" IN ('pending', 'running')`.execute(
    db,
  );
  await sql`UPDATE "migration_overrides" SET "value" = '{"type":"index","name":"face_repair_scan_in_flight_uq","sql":"CREATE UNIQUE INDEX \\"face_repair_scan_in_flight_uq\\" ON \\"face_repair_scan\\" (\\"status\\") WHERE (\\"status\\" IN (''pending'', ''running''));"}'::jsonb WHERE "name" = 'index_face_repair_scan_in_flight_uq';`.execute(
    db,
  );
}
