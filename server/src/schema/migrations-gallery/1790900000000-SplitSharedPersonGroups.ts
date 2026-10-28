import { Kysely, sql } from 'kysely';

// A pre-step for 1791000000000-RepointFaceReviewToPersonGroup, whose one-person-per-group index an Immich
// 3.3 database that used cluster groups or person sharing cannot satisfy. It splits those groups one per
// owner and records how, so down() and scripts/revert-to-immich.sql can put them back
// (specs/2026-10-28-shared-person-groups-split-design.md).
//
// Idempotent, because a database that downgrades to a Gallery build without this migration keeps the
// tables and runs it again on the next upgrade. On a database that already ran 1791000000000 the index
// leaves nothing to split, so it only creates the tables.

// Frozen copies of src/gallery/utils/person-group-split.ts as released with this migration; the live module
// may change for later callers (the revert script, a future migration), this migration may not.
const split = [
  // Shares go first: person_user's FK onto person cascades on update, so moving a sharer's row would
  // drag its shares into the new group. Gallery never writes or syncs person_user.
  `INSERT INTO "person_group_split_share" ("personGroupId", "sharedById", "sharedWithId", "role", "createdAt", "updatedAt", "updateId")
  SELECT "personGroupId", "sharedById", "sharedWithId", "role", "createdAt", "updatedAt", "updateId" FROM "person_user"
  ON CONFLICT DO NOTHING`,
  `DELETE FROM "person_user"`,
  // The oldest row keeps the group. A move is an UPDATE, so person_audit gets the delete sync would miss.
  `WITH "moved" AS MATERIALIZED (
    SELECT "ranked"."ownerId", "ranked"."personGroupId" AS "originalGroupId", uuid_generate_v4() AS "splitGroupId"
    FROM (
      SELECT "ownerId", "personGroupId", row_number() OVER (PARTITION BY "personGroupId" ORDER BY "createdAt", "ownerId") AS "rank"
      FROM "person"
    ) AS "ranked"
    WHERE "ranked"."rank" > 1
  ),
  "groups" AS (
    INSERT INTO "person_group" ("id", "clusterGroupId")
    SELECT "moved"."splitGroupId", "person_group"."clusterGroupId"
    FROM "moved" INNER JOIN "person_group" ON "person_group"."id" = "moved"."originalGroupId"
  ),
  "people" AS (
    UPDATE "person" SET "personGroupId" = "moved"."splitGroupId"
    FROM "moved"
    WHERE "person"."ownerId" = "moved"."ownerId" AND "person"."personGroupId" = "moved"."originalGroupId"
  ),
  "faces" AS (
    UPDATE "asset_face" SET "personGroupId" = "moved"."splitGroupId"
    FROM "moved", "asset"
    WHERE "asset_face"."personGroupId" = "moved"."originalGroupId"
      AND "asset"."id" = "asset_face"."assetId"
      AND "asset"."ownerId" = "moved"."ownerId"
  ),
  "audit" AS (
    INSERT INTO "person_audit" ("personGroupId", "ownerId")
    SELECT "originalGroupId", "ownerId" FROM "moved"
  )
  INSERT INTO "person_group_split" ("splitGroupId", "originalGroupId", "ownerId")
  SELECT "splitGroupId", "originalGroupId", "ownerId" FROM "moved"`,
];

const rejoin = [
  `WITH "pending" AS MATERIALIZED (
    SELECT "split"."splitGroupId", "split"."originalGroupId", "split"."ownerId"
    FROM "person_group_split" AS "split"
    WHERE EXISTS (
      SELECT FROM "person" WHERE "person"."personGroupId" = "split"."splitGroupId" AND "person"."ownerId" = "split"."ownerId"
    )
    AND NOT EXISTS (
      SELECT FROM "person" WHERE "person"."personGroupId" = "split"."originalGroupId" AND "person"."ownerId" = "split"."ownerId"
    )
  ),
  "people" AS (
    UPDATE "person" SET "personGroupId" = "pending"."originalGroupId"
    FROM "pending"
    WHERE "person"."personGroupId" = "pending"."splitGroupId" AND "person"."ownerId" = "pending"."ownerId"
  ),
  "faces" AS (
    UPDATE "asset_face" SET "personGroupId" = "pending"."originalGroupId"
    FROM "pending"
    WHERE "asset_face"."personGroupId" = "pending"."splitGroupId"
  )
  INSERT INTO "person_audit" ("personGroupId", "ownerId")
  SELECT "splitGroupId", "ownerId" FROM "pending"`,
  `DELETE FROM "person_group"
  USING "person_group_split"
  WHERE "person_group"."id" = "person_group_split"."splitGroupId"
    AND NOT EXISTS (SELECT FROM "person" WHERE "person"."personGroupId" = "person_group"."id")
    AND NOT EXISTS (SELECT FROM "asset_face" WHERE "asset_face"."personGroupId" = "person_group"."id")`,
  // The insert trigger would refill a recipient's empty name from the sharer; the rows go back as they were.
  `ALTER TABLE "person_user" DISABLE TRIGGER "person_user_after_insert"`,
  `INSERT INTO "person_user" ("personGroupId", "sharedById", "sharedWithId", "role", "createdAt", "updatedAt", "updateId")
  SELECT "share"."personGroupId", "share"."sharedById", "share"."sharedWithId", "share"."role", "share"."createdAt", "share"."updatedAt", "share"."updateId"
  FROM "person_group_split_share" AS "share"
  WHERE EXISTS (
    SELECT FROM "person" WHERE "person"."personGroupId" = "share"."personGroupId" AND "person"."ownerId" = "share"."sharedById"
  )
  AND EXISTS (
    SELECT FROM "person" WHERE "person"."personGroupId" = "share"."personGroupId" AND "person"."ownerId" = "share"."sharedWithId"
  )
  ON CONFLICT DO NOTHING`,
  `ALTER TABLE "person_user" ENABLE TRIGGER "person_user_after_insert"`,
  `DELETE FROM "person_group_split_share"`,
  `DELETE FROM "person_group_split"`,
];

const run = async (db: Kysely<any>, statements: string[]) => {
  for (const statement of statements) {
    await sql.raw(statement).execute(db);
  }
};

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS "person_group_split" (
      "splitGroupId" uuid NOT NULL,
      "originalGroupId" uuid NOT NULL,
      "ownerId" uuid NOT NULL,
      CONSTRAINT "person_group_split_pkey" PRIMARY KEY ("splitGroupId"),
      CONSTRAINT "person_group_split_splitGroupId_fkey" FOREIGN KEY ("splitGroupId") REFERENCES "person_group" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "person_group_split_originalGroupId_fkey" FOREIGN KEY ("originalGroupId") REFERENCES "person_group" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "person_group_split_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    );
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS "person_group_split_originalGroupId_idx" ON "person_group_split" ("originalGroupId");`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS "person_group_split_ownerId_idx" ON "person_group_split" ("ownerId");`.execute(
    db,
  );
  await sql`
    CREATE TABLE IF NOT EXISTS "person_group_split_share" (
      "personGroupId" uuid NOT NULL,
      "sharedById" uuid NOT NULL,
      "sharedWithId" uuid NOT NULL,
      "role" person_user_role_enum NOT NULL,
      "createdAt" timestamp with time zone NOT NULL,
      "updatedAt" timestamp with time zone NOT NULL,
      "updateId" uuid NOT NULL,
      CONSTRAINT "person_group_split_share_pkey" PRIMARY KEY ("personGroupId", "sharedById", "sharedWithId"),
      CONSTRAINT "person_group_split_share_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "person_group_split_share_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE
    );
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS "person_group_split_share_sharedById_idx" ON "person_group_split_share" ("sharedById");`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS "person_group_split_share_sharedWithId_idx" ON "person_group_split_share" ("sharedWithId");`.execute(
    db,
  );
  await run(db, split);
}

// The rejoin needs person_personGroupId_key gone. On a database that switched from Immich, 1791000000000 ran
// after this migration, so its down() has dropped the index by now. Anywhere else this migration ran last
// and is undone first, with the index still there; that is fine while nothing is split, and refused otherwise.
export async function down(db: Kysely<any>): Promise<void> {
  const { rows } = await sql<{ indexed: boolean; split: boolean }>`
    SELECT to_regclass('"person_personGroupId_key"') IS NOT NULL AS "indexed",
           EXISTS (SELECT FROM "person_group_split") AS "split"
  `.execute(db);
  if (rows[0].indexed && rows[0].split) {
    throw new Error(
      'Cannot rejoin split person groups while person_personGroupId_key exists. Undo ' +
        '1791000000000-RepointFaceReviewToPersonGroup first, or delete only the gallery_migrations row of ' +
        '1790900000000-SplitSharedPersonGroups (docs/docs/install/upgrading.md, "Rolling back to an earlier release").',
    );
  }
  await run(db, rejoin);
  await sql`DROP TABLE "person_group_split_share";`.execute(db);
  await sql`DROP TABLE "person_group_split";`.execute(db);
}
