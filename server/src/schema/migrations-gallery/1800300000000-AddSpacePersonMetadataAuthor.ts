import { Kysely, sql } from 'kysely';

// Names crossing between spaces (specs/2026-11-22-cross-account-identity-joins-design.md): a value typed into one space
// reaches another only while the person who typed it is a member there, so the row records who typed it. Existing names
// take their author from the space's activity log: the first update that recorded this exact name. A name with no such
// entry, and every existing birthday, keeps a null author and stays in its own space.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "shared_space_person" ADD "nameSetById" uuid;`.execute(db);
  await sql`ALTER TABLE "shared_space_person" ADD "birthDateSetById" uuid;`.execute(db);
  await sql`ALTER TABLE "shared_space_person" ADD CONSTRAINT "shared_space_person_nameSetById_fkey" FOREIGN KEY ("nameSetById") REFERENCES "user" ("id") ON DELETE SET NULL;`.execute(
    db,
  );
  await sql`ALTER TABLE "shared_space_person" ADD CONSTRAINT "shared_space_person_birthDateSetById_fkey" FOREIGN KEY ("birthDateSetById") REFERENCES "user" ("id") ON DELETE SET NULL;`.execute(
    db,
  );
  await sql`
    UPDATE "shared_space_person" AS person
    SET "nameSetById" = (
      SELECT activity."userId"
      FROM "shared_space_activity" AS activity
      WHERE activity."spaceId" = person."spaceId"
        AND activity."type" = 'person_update'
        AND activity."userId" IS NOT NULL
        AND activity."data"->>'personId' = person."id"::text
        AND activity."data"->>'personName' = person."name"
      ORDER BY activity."createdAt" ASC
      LIMIT 1
    )
    WHERE person."nameSource" = 'manual'
  `.execute(db);
}

// The authors have no earlier home to move back to. An older Gallery does not read them.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "shared_space_person" DROP CONSTRAINT "shared_space_person_birthDateSetById_fkey";`.execute(db);
  await sql`ALTER TABLE "shared_space_person" DROP CONSTRAINT "shared_space_person_nameSetById_fkey";`.execute(db);
  await sql`ALTER TABLE "shared_space_person" DROP COLUMN "birthDateSetById";`.execute(db);
  await sql`ALTER TABLE "shared_space_person" DROP COLUMN "nameSetById";`.execute(db);
}
