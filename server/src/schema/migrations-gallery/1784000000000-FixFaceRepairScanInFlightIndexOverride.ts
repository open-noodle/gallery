import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Correct the schema override for `face_repair_scan_in_flight_uq`. The original migration
  // (1783050000000-AddFaceRepairScanInFlightIndex) stored the partial-index DDL with a bare
  // `WHERE "status" IN (...)`, but sql-tools' schemaFromCode always emits the predicate
  // parenthesized — `WHERE ("status" IN (...))` (see `asIndexCreate`). The mismatch made the
  // decorator-vs-database schema check report perpetual drift for this index on every boot (the
  // index reported as both missing and extra, plus "override needs to be updated"). Rewrite the
  // stored override to the parenthesized form so it byte-matches the code-side override — the same
  // reconciliation 1778800000000-ReconcileFaceIdentityIndexOverrides did for the identity indexes.
  await sql`UPDATE "migration_overrides" SET "value" = '{"type":"index","name":"face_repair_scan_in_flight_uq","sql":"CREATE UNIQUE INDEX \\"face_repair_scan_in_flight_uq\\" ON \\"face_repair_scan\\" (\\"status\\") WHERE (\\"status\\" IN (''pending'', ''running''));"}'::jsonb WHERE "name" = 'index_face_repair_scan_in_flight_uq';`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`UPDATE "migration_overrides" SET "value" = '{"type":"index","name":"face_repair_scan_in_flight_uq","sql":"CREATE UNIQUE INDEX \\"face_repair_scan_in_flight_uq\\" ON \\"face_repair_scan\\" (\\"status\\") WHERE \\"status\\" IN (''pending'', ''running'');"}'::jsonb WHERE "name" = 'index_face_repair_scan_in_flight_uq';`.execute(
    db,
  );
}
