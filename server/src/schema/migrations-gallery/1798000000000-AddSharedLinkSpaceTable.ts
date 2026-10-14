import { Kysely, sql } from 'kysely';

// Moves the space a share link was created from (#1018) off the upstream `shared_link` table into the
// fork-owned `shared_link_space` sidecar, so `shared_link` is upstream's table again.
//
// CASCADE on `spaceId` keeps the old SET NULL meaning: deleting the space drops the sidecar row, and a
// link with no row degrades to the creator's own assets (the read path re-derives every non-owned asset
// from live space state).
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "shared_link_space" (
      "sharedLinkId" uuid NOT NULL REFERENCES "shared_link" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      "spaceId"      uuid NOT NULL REFERENCES "shared_space" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "shared_link_space_pkey" PRIMARY KEY ("sharedLinkId")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_link_space_spaceId_idx" ON "shared_link_space" ("spaceId");`.execute(db);

  await sql`
    INSERT INTO "shared_link_space" ("sharedLinkId", "spaceId")
    SELECT "id", "spaceId" FROM "shared_link" WHERE "spaceId" IS NOT NULL;
  `.execute(db);

  await sql`DROP INDEX IF EXISTS "shared_link_spaceId_idx";`.execute(db);
  await sql`ALTER TABLE "shared_link" DROP COLUMN IF EXISTS "spaceId";`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE "shared_link"
    ADD COLUMN "spaceId" uuid REFERENCES "shared_space" ("id") ON UPDATE CASCADE ON DELETE SET NULL;
  `.execute(db);
  await sql`CREATE INDEX "shared_link_spaceId_idx" ON "shared_link" ("spaceId");`.execute(db);

  await sql`
    UPDATE "shared_link" SET "spaceId" = sls."spaceId"
      FROM "shared_link_space" sls
     WHERE sls."sharedLinkId" = "shared_link"."id";
  `.execute(db);

  await sql`DROP TABLE IF EXISTS "shared_link_space";`.execute(db);
}
