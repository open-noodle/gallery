import { Kysely, sql } from 'kysely';

// Moves person."type" and person."species" into the fork-owned person_pet sidecar keyed by
// person_group.id: a person is a pet exactly when its group has a person_pet row.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "person_pet" (
      "personGroupId" uuid NOT NULL,
      "species" character varying,
      CONSTRAINT "person_pet_pkey" PRIMARY KEY ("personGroupId"),
      CONSTRAINT "person_pet_personGroupId_fkey" FOREIGN KEY ("personGroupId") REFERENCES "person_group" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    );
  `.execute(db);
  await sql`
    INSERT INTO "person_pet" ("personGroupId", "species")
    SELECT "personGroupId", "species" FROM "person" WHERE "type" = 'pet';
  `.execute(db);
  await sql`ALTER TABLE "person" DROP COLUMN "species";`.execute(db);
  await sql`ALTER TABLE "person" DROP COLUMN "type";`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "person" ADD "type" character varying NOT NULL DEFAULT 'person';`.execute(db);
  await sql`ALTER TABLE "person" ADD "species" character varying;`.execute(db);
  await sql`
    UPDATE "person" SET "type" = 'pet', "species" = pp."species"
    FROM "person_pet" pp
    WHERE pp."personGroupId" = "person"."personGroupId";
  `.execute(db);
  await sql`DROP TABLE "person_pet";`.execute(db);
}
