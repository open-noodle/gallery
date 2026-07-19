import { Kysely, sql } from 'kysely';

// Cross-owner contributions to space-linked albums (#764). A bookmark of a space photo the
// contributor does not own, kept OUT of `album_asset` so it never becomes a permanent album grant.
// Plain table (FK-cascade, createId watermark) — no update trigger, mirrors shared_space_album_user.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "album_space_asset" (
      "albumId"   uuid NOT NULL REFERENCES "album"(id) ON UPDATE CASCADE ON DELETE CASCADE,
      "assetId"   uuid NOT NULL REFERENCES "asset"(id) ON UPDATE CASCADE ON DELETE CASCADE,
      "spaceId"   uuid NOT NULL REFERENCES "shared_space"(id) ON DELETE CASCADE,
      "addedById" uuid REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE SET NULL,
      "addedAt"   timestamp with time zone NOT NULL DEFAULT now(),
      "createId"  uuid NOT NULL DEFAULT immich_uuid_v7(),
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "album_space_asset_pkey" PRIMARY KEY ("albumId", "assetId")
    );
  `.execute(db);
  await sql`CREATE INDEX "album_space_asset_spaceId_idx" ON "album_space_asset" ("spaceId");`.execute(db);
  await sql`CREATE INDEX "album_space_asset_assetId_idx" ON "album_space_asset" ("assetId");`.execute(db);
  await sql`CREATE INDEX "album_space_asset_addedById_idx" ON "album_space_asset" ("addedById");`.execute(db);
  await sql`CREATE INDEX "album_space_asset_createId_idx" ON "album_space_asset" ("createId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "album_space_asset";`.execute(db);
}
