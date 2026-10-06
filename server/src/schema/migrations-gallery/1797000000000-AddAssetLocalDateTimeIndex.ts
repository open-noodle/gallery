import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // The filter panel's taken range (src/utils/asset-filter.ts) is `"localDateTime" >= $1 AND < $2`.
  // The existing localDateTime indexes are on ::date / date_trunc expressions, which a raw range
  // cannot use, so without this the suggestion, facet, map and search filters scan the library.
  await sql`CREATE INDEX IF NOT EXISTS "asset_localDateTime_range_idx" ON "asset" ("localDateTime")`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "asset_localDateTime_range_idx"`.execute(db);
}
