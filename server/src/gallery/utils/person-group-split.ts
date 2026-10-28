import { Kysely, sql } from 'kysely';

// Immich 3.3 lets several users own a `person` row in one `person_group` (cluster-group recognition and
// person sharing). Gallery's person_personGroupId_key allows one, so a database that used either cannot
// switch until those groups are split. The split mirrors upstream's own PersonRepository.reassignCluster:
// each extra row gets a group of its own, taking the faces on its owner's assets. person_group_split
// records each move and person_group_split_share holds the person_user rows, so the rejoin restores
// the upstream tables as Immich left them. See specs/2026-10-28-shared-person-groups-split-design.md.
//
// A row with no visible face on its owner's photos (a person shared with the user, whose faces are the
// sharer's) would land in a group of its own with nothing in it, and Gallery's nightly PersonCleanup deletes
// people without faces, taking the record of the move with it. Such rows are parked whole in
// person_group_split_person instead, and the group is kept by a row that has faces of its own.
//
// The statements are plain SQL because scripts/revert-to-immich.sql runs the rejoin too;
// src/schema/revert-to-immich.spec.ts checks the script carries the same text.

export const personGroupSplitStatements = [
  // Shares go first: person_user's FK onto person cascades on update, so moving a sharer's row would
  // drag its shares into the new group. Gallery never writes or syncs person_user.
  `INSERT INTO "person_group_split_share" ("personGroupId", "sharedById", "sharedWithId", "role", "createdAt", "updatedAt", "updateId")
  SELECT "personGroupId", "sharedById", "sharedWithId", "role", "createdAt", "updatedAt", "updateId" FROM "person_user"
  ON CONFLICT DO NOTHING`,
  `DELETE FROM "person_user"`,
  // The group is kept by its oldest row with a visible face on its owner's photos (else its oldest row). Every
  // other row without one is parked.
  `INSERT INTO "person_group_split_person" ("ownerId", "personGroupId", "createdAt", "name", "thumbnailPath", "isHidden", "birthDate", "faceAssetId", "isFavorite", "color")
  SELECT "person"."ownerId", "person"."personGroupId", "person"."createdAt", "person"."name", "person"."thumbnailPath", "person"."isHidden", "person"."birthDate", "person"."faceAssetId", "person"."isFavorite", "person"."color"
  FROM "person"
  INNER JOIN (
    SELECT "own"."ownerId", "own"."personGroupId", "own"."hasFaces",
      row_number() OVER (PARTITION BY "own"."personGroupId" ORDER BY "own"."hasFaces" DESC, "own"."createdAt", "own"."ownerId") AS "rank"
    FROM (
      SELECT "candidate"."ownerId", "candidate"."personGroupId", "candidate"."createdAt",
        EXISTS (
          SELECT FROM "asset_face" INNER JOIN "asset" ON "asset"."id" = "asset_face"."assetId"
          WHERE "asset_face"."personGroupId" = "candidate"."personGroupId" AND "asset"."ownerId" = "candidate"."ownerId"
            AND "asset_face"."deletedAt" IS NULL AND ("asset_face"."isVisible" IS NULL OR "asset_face"."isVisible")
        ) AS "hasFaces"
      FROM "person" AS "candidate"
      WHERE "candidate"."personGroupId" IN (SELECT "personGroupId" FROM "person" GROUP BY "personGroupId" HAVING count(*) > 1)
    ) AS "own"
  ) AS "ranked" ON "ranked"."ownerId" = "person"."ownerId" AND "ranked"."personGroupId" = "person"."personGroupId"
  WHERE "ranked"."rank" > 1 AND NOT "ranked"."hasFaces"
  ON CONFLICT DO NOTHING`,
  // person_delete_audit records each parked row, so synced clients drop it.
  `DELETE FROM "person"
  USING "person_group_split_person" AS "parked"
  WHERE "person"."ownerId" = "parked"."ownerId" AND "person"."personGroupId" = "parked"."personGroupId"`,
  // What is left in a shared group is its keeper, the oldest, and rows with faces of their own. Each of those
  // moves to a group of its own. A move is an UPDATE, so person_audit gets the delete sync would miss.
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

// Needs person_personGroupId_key gone: it puts a second row back into the original group. A split
// whose person was deleted or merged away on Gallery stays where the user left it. Fork rows on a split
// group follow its FKs when the group is deleted: person_identity, person_pet and face_repair_decline
// (personGroupId and suspectedOwnerId) cascade, face_person_verdict.personGroupId is set to null, and
// face_repair_scan_flagged_face keeps a stale id (no FK). A caller that keeps them repoints them first.
//
// 1790900000000-SplitSharedPersonGroups carries its own frozen copy of these statements, so editing this
// module never changes a released migration.
export const personGroupRejoinStatements = [
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
  // Parked rows come back with a fresh updatedAt/updateId, so synced clients fetch them again. A group deleted on
  // Gallery took its parked rows along (FK); a feature face deleted since is dropped.
  `INSERT INTO "person" ("ownerId", "personGroupId", "createdAt", "name", "thumbnailPath", "isHidden", "birthDate", "faceAssetId", "isFavorite", "color")
  SELECT "parked"."ownerId", "parked"."personGroupId", "parked"."createdAt", "parked"."name", "parked"."thumbnailPath", "parked"."isHidden", "parked"."birthDate",
    (SELECT "asset_face"."id" FROM "asset_face" WHERE "asset_face"."id" = "parked"."faceAssetId"), "parked"."isFavorite", "parked"."color"
  FROM "person_group_split_person" AS "parked"
  ON CONFLICT DO NOTHING`,
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
  `DELETE FROM "person_group_split_person"`,
  `DELETE FROM "person_group_split"`,
];

const run = async (db: Kysely<any>, statements: string[]) => {
  for (const statement of statements) {
    await sql.raw(statement).execute(db);
  }
};

export const splitSharedPersonGroups = (db: Kysely<any>) => run(db, personGroupSplitStatements);

export const rejoinSplitPersonGroups = (db: Kysely<any>) => run(db, personGroupRejoinStatements);
