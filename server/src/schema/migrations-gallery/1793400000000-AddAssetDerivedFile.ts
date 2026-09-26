import { Kysely, sql } from 'kysely';

// Cache index for on-demand derived images (image.presets): one row per rendered
// (asset, preset, width, edited) variant. Kept apart from asset_file, whose unique key is
// (assetId, type, isEdited) and whose rows the thumbnail job owns end to end. CASCADE on the asset:
// the row must vanish with the asset, and the serve path re-creates it on the next request anyway.
// See specs/2026-09-22-derived-image-presets-design.md.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "asset_derived_file" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "assetId" uuid NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "preset" character varying NOT NULL,
      "width" integer NOT NULL,
      "height" integer NOT NULL,
      "isEdited" boolean NOT NULL DEFAULT false,
      "path" character varying NOT NULL,
      CONSTRAINT "asset_derived_file_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "asset_derived_file_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "asset_derived_file_assetId_preset_width_isEdited_uq" UNIQUE ("assetId", "preset", "width", "isEdited")
    )
  `.execute(db);

  await sql`CREATE INDEX "asset_derived_file_assetId_idx" ON "asset_derived_file" ("assetId")`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "asset_derived_file"`.execute(db);
}
