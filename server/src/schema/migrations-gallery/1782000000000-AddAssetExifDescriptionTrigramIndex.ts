import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX IF NOT EXISTS "idx_asset_exif_description_trigram" ON "asset_exif" USING gin (f_unaccent("description") gin_trgm_ops);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_idx_asset_exif_description_trigram', '{"type":"index","name":"idx_asset_exif_description_trigram","sql":"CREATE INDEX \\"idx_asset_exif_description_trigram\\" ON \\"asset_exif\\" USING gin (f_unaccent(\\"description\\") gin_trgm_ops);"}'::jsonb) ON CONFLICT ("name") DO NOTHING;`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX "idx_asset_exif_description_trigram";`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_idx_asset_exif_description_trigram';`.execute(db);
}
