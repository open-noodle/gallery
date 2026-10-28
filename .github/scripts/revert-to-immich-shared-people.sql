-- Immich 3.3 people shared between users, seeded into a stock Immich database before Gallery's first boot.
-- Used by gallery-revert-to-immich-validation.yml (through revert-to-immich-data.sh shared-people-seed) and by
-- server/test/medium/specs/services/database-migration.service.spec.ts, which proves it against the
-- stock schema. Three users in one cluster group, written the way Immich writes them:
--   * groups recognition pooled across owners: a second (and third) owner's row in an existing group, each with
--     its own name, hidden and favourite state, and a face on each owner's own photo;
--   * person_user shares, whose trigger adds the recipient's row, one passed on in a chain and one whose
--     recipient cleared the copied name;
--   * a face of a cluster member who has no row in its group, and a group with one owner.
-- The users have no password and the photos have no files: the checks read the database.
DO $$
DECLARE
  cluster uuid := uuid_generate_v4();
  users uuid[];
  grp uuid;
  minute int := 0;
  i int;
  owner_index int;
BEGIN
  INSERT INTO "cluster_group" ("id") VALUES (cluster);
  WITH created AS (
    INSERT INTO "user" ("email", "name", "clusterGroupId")
    SELECT 'shared-people-' || n || '@example.com', 'Shared People ' || n, cluster FROM generate_series(1, 3) AS n
    RETURNING "id", "email"
  )
  SELECT array_agg("id" ORDER BY "email") INTO users FROM created;

  INSERT INTO "asset" ("ownerId", "originalFileName", "checksum", "checksumAlgorithm", "type", "originalPath",
                       "fileCreatedAt", "fileModifiedAt", "localDateTime")
  SELECT u, 'shared-people-' || n || '.jpg', decode(md5(u::text || '/' || n), 'hex'), 'sha1', 'IMAGE',
         '/data/upload/shared-people/' || u || '/' || n || '.jpg', now(), now(), now()
  FROM unnest(users) AS u, generate_series(1, 4) AS n;

  -- Pooled by recognition: users 1 and 2, and user 3 in every other group.
  FOR i IN 1..10 LOOP
    INSERT INTO "person_group" ("clusterGroupId") VALUES (cluster) RETURNING "id" INTO grp;
    FOR owner_index IN 1..(CASE WHEN i % 2 = 0 THEN 3 ELSE 2 END) LOOP
      minute := minute + 1;
      INSERT INTO "person" ("ownerId", "personGroupId", "name", "isHidden", "isFavorite", "birthDate", "createdAt")
      VALUES (users[owner_index], grp, 'Pooled ' || i || ' by ' || owner_index, owner_index = 2 AND i % 3 = 0,
              owner_index = 1 AND i % 4 = 0, CASE WHEN i % 5 = 0 THEN DATE '1950-06-01' END,
              TIMESTAMPTZ '2026-01-01' + minute * INTERVAL '1 minute');
      INSERT INTO "asset_face" ("assetId", "personGroupId", "imageWidth", "imageHeight", "boundingBoxX1",
                                "boundingBoxX2", "boundingBoxY1", "boundingBoxY2", "sourceType")
      SELECT "id", grp, 10, 10, 0, 1, 0, 1, 'machine-learning'
      FROM "asset" WHERE "ownerId" = users[owner_index] ORDER BY "originalPath" OFFSET (i % 4) LIMIT 1;
    END LOOP;
    IF i % 2 = 1 AND i % 3 = 0 THEN
      -- User 3 has a face here but no row.
      INSERT INTO "asset_face" ("assetId", "personGroupId", "imageWidth", "imageHeight", "boundingBoxX1",
                                "boundingBoxX2", "boundingBoxY1", "boundingBoxY2", "sourceType")
      SELECT "id", grp, 10, 10, 0, 1, 0, 1, 'machine-learning'
      FROM "asset" WHERE "ownerId" = users[3] ORDER BY "originalPath" LIMIT 1;
    END IF;
  END LOOP;

  -- Shared by user 1 with user 2; the first is passed on to user 3, the second has its copied name cleared.
  FOR i IN 1..5 LOOP
    INSERT INTO "person_group" ("clusterGroupId") VALUES (cluster) RETURNING "id" INTO grp;
    minute := minute + 1;
    INSERT INTO "person" ("ownerId", "personGroupId", "name", "createdAt")
    VALUES (users[1], grp, 'Shared ' || i, TIMESTAMPTZ '2026-01-01' + minute * INTERVAL '1 minute');
    INSERT INTO "asset_face" ("assetId", "personGroupId", "imageWidth", "imageHeight", "boundingBoxX1",
                              "boundingBoxX2", "boundingBoxY1", "boundingBoxY2", "sourceType")
    SELECT "id", grp, 10, 10, 0, 1, 0, 1, 'machine-learning'
    FROM "asset" WHERE "ownerId" = users[1] ORDER BY "originalPath" OFFSET (i % 4) LIMIT 1;
    INSERT INTO "person_user" ("personGroupId", "sharedById", "sharedWithId", "role")
    VALUES (grp, users[1], users[2], 'write');
    IF i = 1 THEN
      INSERT INTO "person_user" ("personGroupId", "sharedById", "sharedWithId", "role")
      VALUES (grp, users[2], users[3], 'read');
    END IF;
    IF i = 2 THEN
      UPDATE "person" SET "name" = '' WHERE "ownerId" = users[2] AND "personGroupId" = grp;
    END IF;
  END LOOP;

  -- One owner only.
  INSERT INTO "person_group" ("clusterGroupId") VALUES (cluster) RETURNING "id" INTO grp;
  INSERT INTO "person" ("ownerId", "personGroupId", "name") VALUES (users[3], grp, 'Solo');
END $$;
