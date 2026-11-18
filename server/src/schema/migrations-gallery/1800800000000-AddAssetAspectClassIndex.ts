import { Kysely, sql } from 'kysely';

// The stored aspect class (specs/2026-11-06-aspect-ratio-filter-design.md): a full expression index on upstream's
// width and height, so PostgreSQL keeps it on every write path. ANALYZE gives the planner the expression's statistics,
// which a large, quiet library may otherwise not get from autovacuum for a long time.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX "asset_aspectClass_idx" ON "asset" ((CASE WHEN "width" IS NULL OR "height" IS NULL THEN NULL WHEN "width" <= 0 OR "height" <= 0 THEN NULL WHEN 50 * GREATEST("width"::bigint, "height"::bigint) <= 51 * LEAST("width"::bigint, "height"::bigint) THEN 'square' WHEN GREATEST("width"::bigint, "height"::bigint) >= 2 * LEAST("width"::bigint, "height"::bigint) THEN CASE WHEN "width" > "height" THEN 'panorama-wide' ELSE 'panorama-tall' END WHEN "width" > "height" THEN 'landscape' ELSE 'portrait' END));`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_asset_aspectClass_idx', '{"type":"index","name":"asset_aspectClass_idx","sql":"CREATE INDEX \\"asset_aspectClass_idx\\" ON \\"asset\\" ((CASE WHEN \\"width\\" IS NULL OR \\"height\\" IS NULL THEN NULL WHEN \\"width\\" <= 0 OR \\"height\\" <= 0 THEN NULL WHEN 50 * GREATEST(\\"width\\"::bigint, \\"height\\"::bigint) <= 51 * LEAST(\\"width\\"::bigint, \\"height\\"::bigint) THEN ''square'' WHEN GREATEST(\\"width\\"::bigint, \\"height\\"::bigint) >= 2 * LEAST(\\"width\\"::bigint, \\"height\\"::bigint) THEN CASE WHEN \\"width\\" > \\"height\\" THEN ''panorama-wide'' ELSE ''panorama-tall'' END WHEN \\"width\\" > \\"height\\" THEN ''landscape'' ELSE ''portrait'' END));"}'::jsonb);`.execute(
    db,
  );
  await sql`ANALYZE "asset";`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "asset_aspectClass_idx";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_asset_aspectClass_idx';`.execute(db);
}
