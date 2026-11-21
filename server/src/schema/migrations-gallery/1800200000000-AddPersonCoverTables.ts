import { Kysely, sql } from 'kysely';

// Where person covers came from (specs/2026-11-21-person-cover-quality-design.md). Every person that has a cover
// today gets an `unknown` row: nothing tells a hand-picked cover from a first face, so the cover job leaves those
// alone unless an admin runs it on All. People created from now on have no row, which the job reads as automatic.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "person_cover" (
  "personGroupId" uuid NOT NULL,
  "faceId" uuid,
  "source" character varying NOT NULL,
  "candidateCount" integer,
  "version" smallint,
  "pickedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "person_cover_personGroupId_fkey" FOREIGN KEY ("personGroupId") REFERENCES "person_group" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "person_cover_pkey" PRIMARY KEY ("personGroupId"),
  CONSTRAINT "person_cover_source_chk" CHECK ("source" IN ('auto', 'manual', 'unknown'))
);`.execute(db);
  await sql`CREATE TABLE "shared_space_person_cover" (
  "spacePersonId" uuid NOT NULL,
  "faceId" uuid,
  "candidateCount" integer,
  "version" smallint,
  "pickedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "shared_space_person_cover_spacePersonId_fkey" FOREIGN KEY ("spacePersonId") REFERENCES "shared_space_person" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "shared_space_person_cover_pkey" PRIMARY KEY ("spacePersonId")
);`.execute(db);
  await sql`
    INSERT INTO "person_cover" ("personGroupId", "faceId", "source")
    SELECT "personGroupId", "faceAssetId", 'unknown' FROM "person" WHERE "faceAssetId" IS NOT NULL;
  `.execute(db);
}

// Both tables hold only provenance and the job's bookkeeping, which neither upstream nor an older Gallery has a column
// for; the covers themselves stay in person.faceAssetId and shared_space_person.representativeFaceId.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "shared_space_person_cover";`.execute(db);
  await sql`DROP TABLE "person_cover";`.execute(db);
}
