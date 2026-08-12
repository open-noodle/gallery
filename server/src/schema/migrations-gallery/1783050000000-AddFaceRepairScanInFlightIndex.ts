import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Single-flight guard: at most one in-flight (pending/running) face-repair scan at a time. Backs the
  // SELECT-then-INSERT check in createScan so two concurrent triggers cannot both persist a running scan.
  await sql`CREATE UNIQUE INDEX "face_repair_scan_in_flight_uq" ON "face_repair_scan" ("status") WHERE "status" IN ('pending', 'running')`.execute(
    db,
  );
  // The IN(...) predicate does not round-trip through pg_get_expr (Postgres rewrites it to `(status)::text =
  // ANY(...)`), so register a schema override carrying the literal DDL — otherwise the decorator-vs-database
  // schema check reports perpetual drift for this index (mirrors idx_person_name_trigram).
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_face_repair_scan_in_flight_uq', '{"type":"index","name":"face_repair_scan_in_flight_uq","sql":"CREATE UNIQUE INDEX \\"face_repair_scan_in_flight_uq\\" ON \\"face_repair_scan\\" (\\"status\\") WHERE \\"status\\" IN (''pending'', ''running'');"}'::jsonb) ON CONFLICT ("name") DO NOTHING;`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "face_repair_scan_in_flight_uq"`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_face_repair_scan_in_flight_uq';`.execute(db);
}
