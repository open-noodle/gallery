import { Kysely, sql } from 'kysely';

// #1018: records the shared space a link was created from, so a link made inside a space can cover
// assets contributed by other members instead of only the creator's own.
//
// SET NULL, not CASCADE: deleting the space must degrade the link to the creator's own assets
// (the read path re-derives every non-owned asset from live space state), never delete the link.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE "shared_link"
    ADD COLUMN "spaceId" uuid REFERENCES "shared_space" ("id") ON UPDATE CASCADE ON DELETE SET NULL
  `.execute(db);

  await sql`CREATE INDEX "shared_link_spaceId_idx" ON "shared_link" ("spaceId")`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "shared_link_spaceId_idx"`.execute(db);
  await sql`ALTER TABLE "shared_link" DROP COLUMN IF EXISTS "spaceId"`.execute(db);
}
