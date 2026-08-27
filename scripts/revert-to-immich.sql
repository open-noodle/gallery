-- =============================================================================
-- revert-to-immich.sql
--
-- One-off cleanup that makes a Gallery-modified Postgres database look like a
-- vanilla upstream Immich database, so a user can switch their image back to
-- ghcr.io/immich-app/immich-server without hitting "missing migration" or
-- schema-drift errors on startup.
--
-- The right answer is "restore the pg_dump you took before switching to
-- Gallery." This script is the fallback for users who skipped that step.
--
-- IRREVERSIBLE DATA LOSS. This script drops every Gallery-only table and
-- every Gallery-added column on Immich-native tables. Anything stored only in
-- those tables/columns is gone forever. Specifically, you will lose:
--
--   * Shared spaces and all their members, assets, person clusters, libraries,
--     activity, audit trail
--   * User groups and their memberships
--   * Classification categories and prompts (including the merged copy in
--     system_metadata's system-config row — that key is stripped too)
--   * Pet detection results (person.type, person.species, petsDetectedAt)
--   * Asset duplicate checksums
--   * Library sync state (library_audit, library_user, library.createId)
--   * Storage migration history
--
-- Assets you uploaded through Gallery are preserved as long as they are stored
-- in Immich-native rows (asset, asset_exif, asset_face, etc.). If an asset
-- only lives inside a shared_space_asset row without a matching asset row, it
-- will be gone when the shared_space tables drop. In practice the asset table
-- is the source of truth for every uploaded file, so this should not happen.
--
-- =============================================================================
-- HOW TO RUN
-- =============================================================================
--
-- 1. Stop every Immich/Gallery container (server, microservices, web). The
--    script takes ACCESS EXCLUSIVE locks on many tables; a running server
--    will either deadlock with it or race it.
--
-- 2. Take a pg_dump NOW in case this script does the wrong thing:
--
--        docker exec immich_postgres pg_dump -U postgres -d immich \
--          > gallery-pre-revert-$(date +%F).sql
--
-- 3. Copy the script into the postgres container and run it. The extra -c
--    flag sets the data-loss acknowledgement — the script's safety check at
--    the top refuses to run otherwise. Both statements share the same psql
--    session, so the session GUC set by -c is visible to the -f script.
--
--        docker cp scripts/revert-to-immich.sql immich_postgres:/tmp/
--        docker exec immich_postgres psql -U postgres -d immich \
--          -v ON_ERROR_STOP=1 \
--          -c "SET gallery.revert_token = 'i_accept_data_loss';" \
--          -f /tmp/revert-to-immich.sql
--
--    ON_ERROR_STOP=1 is important: without it psql will keep going past the
--    first error and leave the database in a half-cleaned state. The whole
--    script is wrapped in BEGIN/COMMIT, so a mid-script failure rolls back.
--
-- 4. Switch your docker-compose image back to ghcr.io/immich-app/immich-server
--    (pin a version close to the Immich version Gallery rebased from — this
--    repository's `branding/config.json` shows the upstream version under
--    `upstream.version`).
--    Start the stack.
--
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- Safety check. Refuses to run unless the user set
--   SET gallery.revert_token = 'i_accept_data_loss';
-- beforehand, or edited the line below.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF current_setting('gallery.revert_token', true) IS DISTINCT FROM 'i_accept_data_loss' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'revert-to-immich.sql refused: read the header, then set gallery.revert_token = ''i_accept_data_loss'' before running.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Drop Gallery-only triggers on Immich-native tables.
--
-- These triggers live on upstream tables (library, asset) but call functions
-- that Gallery defined. If we drop the functions first with CASCADE these
-- triggers disappear automatically — but being explicit makes the script
-- easier to audit and avoids surprises if a future Gallery migration adds a
-- trigger that CASCADE would miss.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS "library_after_insert" ON "library";
DROP TRIGGER IF EXISTS "asset_library_delete_audit" ON "asset";
DROP TRIGGER IF EXISTS "album_soft_delete_shared_space_album" ON "album";

-- -----------------------------------------------------------------------------
-- 2. Drop Gallery-only tables (CASCADE).
--
-- CASCADE handles: inter-table FKs, indexes, triggers on these tables, and
-- any sequences owned by serial columns. The order within the list does not
-- matter because of CASCADE, but we group related tables for readability.
-- -----------------------------------------------------------------------------

-- Library sync / audit
DROP TABLE IF EXISTS "library_user" CASCADE;
DROP TABLE IF EXISTS "library_audit" CASCADE;
DROP TABLE IF EXISTS "library_asset_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_library_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_library" CASCADE;

-- Shared spaces
DROP TABLE IF EXISTS "album_space_asset_audit" CASCADE;
DROP TABLE IF EXISTS "album_space_asset" CASCADE;
DROP TABLE IF EXISTS "shared_space_activity" CASCADE;
DROP TABLE IF EXISTS "shared_space_person_alias" CASCADE;
DROP TABLE IF EXISTS "shared_space_person_face" CASCADE;
DROP TABLE IF EXISTS "shared_space_person" CASCADE;
DROP TABLE IF EXISTS "shared_space_face_match_backfill_target" CASCADE;
DROP TABLE IF EXISTS "shared_space_library_asset_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_album_asset_audit" CASCADE;
DROP TABLE IF EXISTS "face_person_verdict" CASCADE;
DROP TABLE IF EXISTS "shared_space_asset_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_member_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_asset" CASCADE;
DROP TABLE IF EXISTS "shared_space_album_user" CASCADE;
DROP TABLE IF EXISTS "shared_space_album_user_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_album_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_album" CASCADE;
DROP TABLE IF EXISTS "shared_space_member" CASCADE;
DROP TABLE IF EXISTS "shared_space" CASCADE;

-- Face identities
DROP TABLE IF EXISTS "face_repair_scan_flagged_face" CASCADE;
DROP TABLE IF EXISTS "face_repair_decline" CASCADE;
DROP TABLE IF EXISTS "face_repair_lock" CASCADE;
DROP TABLE IF EXISTS "face_repair_scan" CASCADE;
DROP TABLE IF EXISTS "face_identity_face" CASCADE;
DROP TABLE IF EXISTS "face_identity" CASCADE;

-- User groups
DROP TABLE IF EXISTS "user_group_member" CASCADE;
DROP TABLE IF EXISTS "user_group" CASCADE;

-- Classification (already dropped by migration 1778000000000 in a
-- fully-migrated DB; IF EXISTS catches partial-migration DBs).
DROP TABLE IF EXISTS "classification_prompt_embedding" CASCADE;
DROP TABLE IF EXISTS "classification_category" CASCADE;

-- Storage migration log and asset duplicate checksum
DROP TABLE IF EXISTS "storage_migration_log" CASCADE;
DROP TABLE IF EXISTS "asset_duplicate_checksum" CASCADE;

-- -----------------------------------------------------------------------------
-- 3. Drop Gallery-only functions.
--
-- At this point the triggers and tables that reference these are already
-- gone, so a plain DROP would work — CASCADE is belt-and-braces in case any
-- Gallery-installed trigger slipped through.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS library_after_insert() CASCADE;
DROP FUNCTION IF EXISTS library_user_delete_after_audit() CASCADE;
DROP FUNCTION IF EXISTS user_has_library_path(uuid, uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS asset_library_delete_audit() CASCADE;
DROP FUNCTION IF EXISTS shared_space_delete_audit() CASCADE;
DROP FUNCTION IF EXISTS shared_space_asset_delete_audit() CASCADE;
DROP FUNCTION IF EXISTS shared_space_member_delete_audit() CASCADE;
DROP FUNCTION IF EXISTS shared_space_member_after_insert() CASCADE;
DROP FUNCTION IF EXISTS shared_space_member_after_insert_library() CASCADE;
DROP FUNCTION IF EXISTS shared_space_library_after_insert_user() CASCADE;
DROP FUNCTION IF EXISTS shared_space_delete_library_audit() CASCADE;
DROP FUNCTION IF EXISTS shared_space_library_delete_audit() CASCADE;
DROP FUNCTION IF EXISTS shared_space_member_delete_library_audit() CASCADE;
DROP FUNCTION IF EXISTS user_has_album_path(uuid, uuid, uuid) CASCADE;
DROP FUNCTION IF EXISTS shared_space_album_after_insert_user() CASCADE;
DROP FUNCTION IF EXISTS shared_space_member_after_insert_album() CASCADE;
DROP FUNCTION IF EXISTS shared_space_album_delete_audit() CASCADE;
DROP FUNCTION IF EXISTS shared_space_member_delete_album_audit() CASCADE;
DROP FUNCTION IF EXISTS shared_space_delete_album_audit() CASCADE;
DROP FUNCTION IF EXISTS shared_space_album_user_delete_after_audit() CASCADE;
DROP FUNCTION IF EXISTS album_soft_delete_shared_space_album() CASCADE;
DROP FUNCTION IF EXISTS album_space_asset_delete_audit() CASCADE;

-- -----------------------------------------------------------------------------
-- 4. Drop Gallery-added columns from Immich-native tables.
--
-- The library_createId_idx index is dropped implicitly with library.createId.
-- -----------------------------------------------------------------------------
ALTER TABLE "person"            DROP COLUMN IF EXISTS "type";
ALTER TABLE "person"            DROP COLUMN IF EXISTS "species";
ALTER TABLE "asset_job_status"  DROP COLUMN IF EXISTS "petsDetectedAt";
ALTER TABLE "asset_job_status"  DROP COLUMN IF EXISTS "classifiedAt";
ALTER TABLE "library"           DROP COLUMN IF EXISTS "createId";
-- 1791000000000-RepointFaceReviewToPersonGroup added this unique index to make option M's
-- one-person-per-group invariant a database fact. It lives on the upstream `person` table, so
-- unlike the rest of that migration (which only touches Gallery-only face-review tables that
-- section 2 already dropped CASCADE) it has to come off explicitly.
DROP INDEX IF EXISTS "person_personGroupId_key";
DROP INDEX IF EXISTS "asset_face_personId_idx";
DROP INDEX IF EXISTS "person_ownerId_identityId_key";
DROP INDEX IF EXISTS "person_identityId_idx";
ALTER TABLE "person"            DROP COLUMN IF EXISTS "identityId";
-- #1018: the space a share link was created from. Dropping it implicitly drops
-- shared_link_spaceId_idx; the links themselves survive as owner-only links.
ALTER TABLE "shared_link"       DROP COLUMN IF EXISTS "spaceId";

-- -----------------------------------------------------------------------------
-- 5. Strip Gallery's merged 'classification' key out of system_metadata's
--    system-config row (added by migration 1778000000000).
-- -----------------------------------------------------------------------------
UPDATE "system_metadata"
   SET "value" = "value" - 'classification'
 WHERE "key" = 'system-config'
   AND "value" ? 'classification';

-- -----------------------------------------------------------------------------
-- 6. Delete Gallery-added rows from migration_overrides.
--
-- This table is a sql-tools schema-diff registry, not a runtime manifest —
-- upstream Immich will start fine either way. Cleaning these up is still
-- the right move so a future `pnpm migrations:generate` run doesn't see
-- stale entries.
-- -----------------------------------------------------------------------------
DELETE FROM "migration_overrides"
 WHERE "name" IN (
   'function_asset_library_delete_audit',
   'function_library_after_insert',
   'function_library_user_delete_after_audit',
   'function_shared_space_asset_delete_audit',
   'function_shared_space_delete_audit',
   'function_shared_space_delete_library_audit',
   'function_shared_space_library_after_insert_user',
   'function_shared_space_library_delete_audit',
   'function_shared_space_member_after_insert',
   'function_shared_space_member_after_insert_library',
   'function_shared_space_member_delete_audit',
   'function_shared_space_member_delete_library_audit',
   'function_user_has_library_path',
   'function_user_has_album_path',
   'function_shared_space_album_after_insert_user',
   'function_shared_space_member_after_insert_album',
   'function_shared_space_album_delete_audit',
   'function_shared_space_member_delete_album_audit',
   'function_shared_space_delete_album_audit',
   'function_shared_space_album_user_delete_after_audit',
   'function_album_soft_delete_shared_space_album',
   'function_album_space_asset_delete_audit',
   'index_asset_face_personId_idx',
   'index_face_identity_representativeFaceId_idx',
   'index_person_identityId_idx',
   'index_face_person_verdict_personId_assetFaceId_uq',
  -- renamed by 1791000000000-RepointFaceReviewToPersonGroup; both spellings are listed so the
  -- row is removed whether or not that migration ran.
  'index_face_person_verdict_personGroupId_assetFaceId_uq',
   'index_face_person_verdict_spacePersonId_assetFaceId_uq',
   'index_face_person_verdict_spacePersonId_status_distance_idx',
   'index_face_person_verdict_identityId_assetFaceId_idx',
   'index_face_repair_scan_in_flight_uq',
   'index_person_ownerId_identityId_key',
   'index_shared_space_person_identityId_spaceId_idx',
   'index_shared_space_person_space_name_idx',
   'index_shared_space_person_spaceId_identityId_key',
   'trigger_asset_library_delete_audit',
   'trigger_classification_category_updatedAt',
   'trigger_face_identity_face_updatedAt',
   'trigger_face_identity_updatedAt',
   'trigger_library_after_insert',
   'trigger_library_user_delete_after_audit',
   'trigger_face_person_verdict_updatedAt',
   'trigger_shared_space_face_match_backfill_target_updatedAt',
   'trigger_shared_space_asset_delete_audit',
   'trigger_shared_space_asset_updatedAt',
   'trigger_shared_space_delete_audit',
   'trigger_shared_space_delete_library_audit',
   'trigger_shared_space_library_after_insert_user',
   'trigger_shared_space_library_delete_audit',
   'trigger_shared_space_album_after_insert_user',
   'trigger_shared_space_member_after_insert_album',
   'trigger_shared_space_album_delete_audit',
   'trigger_shared_space_member_delete_album_audit',
   'trigger_shared_space_delete_album_audit',
   'trigger_shared_space_album_user_delete_after_audit',
   'trigger_album_soft_delete_shared_space_album',
   'trigger_album_space_asset_delete_audit',
   'trigger_album_space_asset_updatedAt',
   'trigger_shared_space_album_updatedAt',
   'trigger_shared_space_library_updatedAt',
   'trigger_shared_space_member_after_insert',
   'trigger_shared_space_member_after_insert_library',
   'trigger_shared_space_member_delete_audit',
   'trigger_shared_space_member_delete_library_audit',
   'trigger_shared_space_member_updatedAt',
   'trigger_shared_space_person_updatedAt',
   'trigger_shared_space_updatedAt',
   'trigger_user_group_updatedAt'
 );

-- -----------------------------------------------------------------------------
-- 6b. Delete Gallery's own workflow plugin.
--
-- Plugins are stored IN THE DATABASE (`plugin.wasmBytes`), not just on disk, and the server loads
-- every row from `getForLoad()` at boot. Gallery ships `gallery-core`, whose wasm imports the
-- fork-only `gallery` host function. Upstream Immich does not register that function, so leaving
-- the row behind makes its microservices worker die on startup with
--
--   cannot resolve import "extism:host/user" "gallery"
--
-- and the server never answers /api/server/ping. Unlike the migration_overrides cleanup above, this
-- one is load-bearing: skip it and upstream Immich does not boot at all.
--
-- `plugin_method` cascades from `plugin`, and `workflow_step.pluginMethodId` cascades from
-- `plugin_method`, so this also removes any workflow step wired to a Gallery action. Those steps
-- could never run on upstream anyway. The parent `workflow` rows survive.
--
-- Upstream's own `immich-plugin-core` is deliberately left alone.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.plugin') IS NOT NULL THEN
    DELETE FROM public."plugin" WHERE "name" = 'gallery-core';
  END IF;
END $$;

-- 7. Undo post-v3.0.1 upstream migrations that Gallery pulled in via rebase.
--
-- Gallery regularly rebases onto `upstream/main`, which sits ahead of the
-- latest tagged Immich release (the one in `branding/config.json` under
-- `upstream.version`). The
-- migrations in `server/src/schema/migrations/` therefore include a handful
-- of upstream migrations that the tagged release does NOT have. On a
-- Gallery-migrated DB those rows exist in `kysely_migrations` and their
-- schema changes have been applied — but upstream v<branding upstream.version>
-- doesn't ship the corresponding migration files, so on boot its migrator
-- aborts with "corrupted migrations: previously executed migration X is
-- missing", and schema-check reports drift for every column/table touched.
--
-- The fix has two halves: (a) reverse the schema change so upstream's
-- schema-check sees a matching DB, and (b) delete the kysely_migrations row
-- (step 8 below) so upstream's migrator doesn't look for the file.
--
-- This section MUST be re-evaluated after every upstream rebase. The
-- mechanical diff is:
--
--   diff <(gh api "repos/immich-app/immich/git/trees/v<tag>:server/src/schema/migrations" \
--           --jq '.tree[].path' | sort) \
--        <(ls server/src/schema/migrations/ | sort)
--
-- For every `>` line, port the migration's `down()` logic here (adding
-- DEFAULTs where `down()` adds NOT NULL columns — `down()` is designed for
-- empty dev DBs, this script runs against populated ones) and add the
-- migration name to the DELETE list in step 8. The rebase-upstream-report
-- skill covers this under "Post-rebase: revert-to-immich.sql maintenance".
-- -----------------------------------------------------------------------------

-- 1784647658615-AddOAuthBearerTokenToSession (upstream #29720) added
-- session."oauthBearerToken" so the server can send id_token_hint on OIDC
-- logout. The tagged upstream release in branding/config.json does not ship
-- this migration, so the column has to go back for its schema-check to match.
-- IF EXISTS because this script also runs against a tagged :main image whose
-- database never had the column; the migration's own down() assumes it does.
ALTER TABLE "session" DROP COLUMN IF EXISTS "oauthBearerToken";

-- 1782000000000-AddAssetExifDescriptionTrigramIndex added a fork-only GIN
-- trigram index on asset_exif.description (for timeline description filtering)
-- that v2.7.5 does not have, plus its migration_overrides registration row.
DROP INDEX IF EXISTS "idx_asset_exif_description_trigram";
DELETE FROM "migration_overrides" WHERE "name" = 'index_idx_asset_exif_description_trigram';

-- 1783628194057-DisablePostgresJit set jit=off on the application role. Restore
-- the PostgreSQL default so the reverted database carries no Gallery-specific
-- planner tuning.
ALTER ROLE CURRENT_USER RESET jit;

-- 1784836013770-MinFacePreferenceMigration (upstream #30177) is data-only: it
-- backfills each user's user_metadata 'preferences' with people.minimumFaces
-- from the old system-config machineLearning.facialRecognition.minFaces. Its
-- down() is a no-op, there is no schema change to reverse, and the extra JSONB
-- key is inert for the tagged release's schema-check and boot — only its
-- kysely_migrations row must go (step 8).

-- 1784986754474-AlbumDescriptionNullable (upstream #30123, re-timestamped by #30424
-- from 1784664555996 so it sorts after ConvertUserPasswordEmptyStringToNull) made
-- album.description
-- nullable and rewrote '' to NULL. The tagged release still declares the column
-- NOT NULL DEFAULT '', so both the data and the constraint have to go back or its
-- schema-check fails. The UPDATE must run BEFORE the SET NOT NULL or rows written
-- since the migration would violate it. All three statements are idempotent, and
-- the column exists in both schemas (only its nullability differs), so no guard is
-- needed — unlike the DROP COLUMN cases above.
UPDATE "album" SET "description" = '' WHERE "description" IS NULL;
ALTER TABLE "album" ALTER COLUMN "description" SET DEFAULT ''::text;
ALTER TABLE "album" ALTER COLUMN "description" SET NOT NULL;

-- 1784986754473-ConvertUserPasswordEmptyStringToNull (upstream #30223) did the
-- same for user.password. Same reasoning and same ordering constraint: OAuth-only
-- users created after the migration carry NULL and must be rewritten to '' before
-- the NOT NULL goes back.
UPDATE "user" SET "password" = '' WHERE "password" IS NULL;
ALTER TABLE "user" ALTER COLUMN "password" SET DEFAULT '';
ALTER TABLE "user" ALTER COLUMN "password" SET NOT NULL;

-- 1786385711807-AlbumOwnerDeleteTrigger (upstream #30692) added an AFTER DELETE
-- row trigger on album_user that deletes an album once its last 'owner'-role
-- album_user row is gone, plus the function it calls and two migration_overrides
-- rows registering both. The tagged release ships none of them, so its
-- schema-check reports the function, the trigger and both override rows as extra.
-- Guarded with IF EXISTS because this script also runs against a tagged-release DB
-- where they were never created; album_user itself exists in both schemas.
--
-- The migration's leading `DELETE FROM "album" WHERE NOT EXISTS (... 'owner')` is
-- a one-way data cleanup and cannot be undone here. It only removes albums that
-- already had no owner, which Gallery's single album-creation path (album.repository
-- createWithAssets, which inserts the owner album_user row in the same CTE) does
-- not produce.
DROP TRIGGER IF EXISTS "album_user_delete" ON "album_user";
DROP FUNCTION IF EXISTS album_user_delete();
DELETE FROM "migration_overrides"
 WHERE "name" IN ('function_album_user_delete', 'trigger_album_user_delete');

-- 1786741078327-AddWorkflowLogsTable (upstream #29878, re-timestamped by #30774)
-- added the workflow_log table with its two indexes and two foreign keys, plus a
-- workflow.logging boolean column. The tagged release ships neither, so its
-- schema-check reports the table and the column as extra. Dropping the table takes
-- its indexes and constraints with it. Guarded with IF EXISTS because this script
-- also runs against a tagged-release DB where they were never created.
DROP TABLE IF EXISTS "workflow_log";
ALTER TABLE "workflow" DROP COLUMN IF EXISTS "logging";

-- 1786972746371-AssetOcrUpdatedAtTrigger (upstream #29303) added an updatedAt column
-- to asset_ocr, an updated_at() trigger on it, and the matching migration_overrides
-- row. The tagged release has none of the three, so it reports the column and the
-- trigger as extra. Everything is guarded because this script also runs against a
-- tagged-release DB where asset_ocr itself may predate none of this — and DROP COLUMN
-- IF EXISTS still errors when the TABLE is absent, hence the to_regclass guard.
DO $$
BEGIN
  IF to_regclass('public.asset_ocr') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS "asset_ocr_updatedAt" ON "asset_ocr";
    ALTER TABLE "asset_ocr" DROP COLUMN IF EXISTS "updatedAt";
  END IF;
END $$;
DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_ocr_updatedAt';

-- 1786972746372-AssetOcrSyncReset (upstream #29303) is data-only: it deletes the
-- AssetOcrV1 sync checkpoints so clients re-sync OCR rows that were missed before the
-- trigger above existed. There is no schema to reverse, and re-adding checkpoints
-- would be wrong, so only its kysely_migrations row is removed in step 8.

-- 1787148183730-DeleteMismatchedMemoryAssets (upstream #28950) is data-only: it deletes
-- memory_asset rows whose memory and asset have different owners. There is no schema to
-- reverse, and the deleted rows cannot be reconstructed, so only its kysely_migrations row
-- is removed in step 8.

-- 1787148183729-ClusterGroups (upstream #30739) is the largest post-tag migration Gallery carries.
-- It re-keys people: `person.id` is replaced by the composite primary key (ownerId, personGroupId),
-- `asset_face.personId` becomes `personGroupId`, and four new tables appear (cluster_group,
-- cluster_group_request, person_group, person_group_audit) along with user.clusterGroupId.
--
-- Gallery adopts that schema but never mounts the feature (option M — see
-- docs/superpowers/specs/2026-08-21-cluster-groups-m-landing-plan.md), so a reverted database still
-- has to be handed back to the tagged release with `person.id` restored. This mirrors the
-- migration's own down(), made idempotent because the script also runs against a tagged-release DB
-- where none of it was ever created.
--
-- Ordering note: person_group must outlive the asset_face repoint below, so the tables are dropped
-- last. The Gallery-only face-review tables that 1787100000000 / 1791000000000 touched are already
-- gone (section 2, CASCADE), which is why neither fork migration needs anything here beyond the
-- unique index dropped in section 4.
DO $$
BEGIN
  IF to_regclass('public.person_group') IS NULL THEN
    RETURN;  -- the migration never ran on this database
  END IF;

  -- person: composite key back to a plain id
  ALTER TABLE "person" DROP CONSTRAINT IF EXISTS "person_pkey";
  ALTER TABLE "person" ADD COLUMN IF NOT EXISTS "id" uuid NOT NULL DEFAULT uuid_generate_v4();
  UPDATE "person" SET "id" = "personGroupId";
  ALTER TABLE "person" ADD CONSTRAINT "person_pkey" PRIMARY KEY ("id");
  CREATE INDEX IF NOT EXISTS "person_ownerId_idx" ON "person" ("ownerId");

  -- asset_face: personGroupId back to personId, repointed at person.id
  DROP INDEX IF EXISTS "asset_face_assetId_personGroupId_idx";
  DROP INDEX IF EXISTS "asset_face_personGroupId_assetId_notDeleted_isVisible_idx";
  DROP INDEX IF EXISTS "asset_face_personGroupId_assetId_idx";
  ALTER TABLE "asset_face" DROP CONSTRAINT IF EXISTS "asset_face_personGroupId_fkey";
  ALTER TABLE "asset_face" RENAME COLUMN "personGroupId" TO "personId";
  UPDATE "asset_face" SET "personId" = "person"."id"
    FROM "person" WHERE "asset_face"."personId" = "person"."personGroupId";
  ALTER TABLE "asset_face" ADD CONSTRAINT "asset_face_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "person" ("id") ON UPDATE CASCADE ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS "asset_face_assetId_personId_idx" ON "asset_face" ("assetId", "personId");
  CREATE INDEX IF NOT EXISTS "asset_face_personId_assetId_idx" ON "asset_face" ("personId", "assetId");
  CREATE INDEX IF NOT EXISTS "asset_face_personId_assetId_notDeleted_isVisible_idx"
    ON "asset_face" ("personId", "assetId") WHERE ("deletedAt" IS NULL AND "isVisible" IS TRUE);

  -- person_audit
  ALTER TABLE "person_audit" ADD COLUMN IF NOT EXISTS "personId" uuid;
  UPDATE "person_audit" SET "personId" = "personGroupId";
  ALTER TABLE "person_audit" ALTER COLUMN "personId" SET NOT NULL;
  CREATE INDEX IF NOT EXISTS "person_audit_personId_idx" ON "person_audit" ("personId");
  DROP INDEX IF EXISTS "person_audit_personGroupId_idx";
  ALTER TABLE "person_audit" DROP COLUMN IF EXISTS "personGroupId";

  -- person / user back-references, then the new tables
  ALTER TABLE "person" DROP CONSTRAINT IF EXISTS "person_personGroupId_fkey";
  DROP INDEX IF EXISTS "person_personGroupId_idx";
  ALTER TABLE "person" DROP COLUMN IF EXISTS "personGroupId";
  ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_clusterGroupId_fkey";
  DROP INDEX IF EXISTS "user_clusterGroupId_idx";
  ALTER TABLE "user" DROP COLUMN IF EXISTS "clusterGroupId";
  DROP TABLE IF EXISTS "cluster_group_request";
  DROP TABLE IF EXISTS "person_group_audit";
  DROP TABLE IF EXISTS "person_group";
  DROP TABLE IF EXISTS "cluster_group";
END $$;

-- person_delete_audit went back to writing personId when person.id returned above; restore the
-- function, its trigger and the two migration_overrides payloads to the tagged release's spelling.
DO $$
BEGIN
  IF to_regclass('public.person_audit') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION person_delete_audit()
      RETURNS TRIGGER
      LANGUAGE PLPGSQL
      AS $func$
        BEGIN
          INSERT INTO person_audit ("personId", "ownerId")
          SELECT "id", "ownerId"
          FROM OLD;
          RETURN NULL;
        END
      $func$;
    CREATE OR REPLACE TRIGGER "person_delete_audit"
      AFTER DELETE ON "person"
      REFERENCING OLD TABLE AS "old"
      FOR EACH STATEMENT
      WHEN (pg_trigger_depth() = 0)
      EXECUTE FUNCTION person_delete_audit();
  END IF;
END $$;
DROP FUNCTION IF EXISTS person_group_delete_audit;

UPDATE "migration_overrides"
SET "value" = '{"type":"function","name":"person_delete_audit","sql":"CREATE OR REPLACE FUNCTION person_delete_audit()\n  RETURNS TRIGGER\n  LANGUAGE PLPGSQL\n  AS $$\n    BEGIN\n      INSERT INTO person_audit (\"personId\", \"ownerId\")\n      SELECT \"id\", \"ownerId\"\n      FROM OLD;\n      RETURN NULL;\n    END\n  $$;"}'::jsonb
WHERE "name" = 'function_person_delete_audit';

UPDATE "migration_overrides"
SET "value" = '{"type":"trigger","name":"person_delete_audit","sql":"CREATE OR REPLACE TRIGGER \"person_delete_audit\"\n  AFTER DELETE ON \"person\"\n  REFERENCING OLD TABLE AS \"old\"\n  FOR EACH STATEMENT\n  WHEN (pg_trigger_depth() = 0)\n  EXECUTE FUNCTION person_delete_audit();"}'::jsonb
WHERE "name" = 'trigger_person_delete_audit';

DELETE FROM "migration_overrides" WHERE "name" IN (
  'function_person_group_delete_audit',
  'trigger_cluster_group_updatedAt',
  'trigger_person_group_delete_audit',
  'trigger_person_group_updatedAt',
  'index_asset_face_personGroupId_assetId_notDeleted_isVisible_idx'
);

INSERT INTO "migration_overrides" ("name", "value")
VALUES ('index_asset_face_personId_assetId_notDeleted_isVisible_idx', '{"type":"index","name":"asset_face_personId_assetId_notDeleted_isVisible_idx","sql":"CREATE INDEX \"asset_face_personId_assetId_notDeleted_isVisible_idx\" ON \"asset_face\" (\"personId\", \"assetId\") WHERE (\"deletedAt\" IS NULL AND \"isVisible\" IS TRUE);"}'::jsonb)
ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";

-- 1787100000000-DropPersonFksBeforeClusterGroups and 1791000000000-RepointFaceReviewToPersonGroup
-- are Gallery-only and act entirely on face_person_verdict / face_repair_decline /
-- face_repair_scan_flagged_face, which section 2 drops CASCADE. Their only footprint on an upstream
-- table is the person_personGroupId_key index, removed in section 4. Nothing further to reverse —
-- only their kysely_migrations rows, in step 8.

-- -----------------------------------------------------------------------------
-- 8. Delete Gallery + post-v<branding upstream.version> upstream migration rows
--    from kysely_migrations.
--
-- This is the ONE step that is load-bearing for "Immich starts up cleanly."
-- Without it, Immich's migrator sees rows for files it does not have and
-- aborts with the classic "corrupted migrations" error. The names in the
-- "post-rebase upstream" block must stay in sync with step 7 above.
-- -----------------------------------------------------------------------------
DELETE FROM "kysely_migrations"
 WHERE "name" IN (
   -- Gallery fork migrations (server/src/schema/migrations-gallery/).
   '1772230000000-CreateStorageMigrationLogTable',
   '1772240000000-CreateSharedSpaceTables',
   '1772250000000-AddShowInTimelineToSharedSpaceMember',
   '1772260000000-AddThumbnailAssetIdToSharedSpace',
   '1772270000000-AddColorToSharedSpace',
   '1772782339000-AddPetDetectionColumns',
   '1772790000000-AddLastActivityAtToSharedSpace',
   '1772800000000-AddLastViewedAtToSharedSpaceMember',
   '1772810000000-AddSharedSpaceActivityTable',
   '1772815000000-AddThumbnailCropYToSharedSpace',
   '1772820000000-AddSharedSpaceFaceRecognition',
   '1773846750001-AddPersonNameTrigramIndex',
   '1774215658876-AddSharedSpaceLibraryTable',
   '1774300000000-CreateUserGroupTables',
   '1775000000000-AddPetsEnabledToSharedSpace',
   '1775100000000-AddAssetDuplicateChecksum',
   '1775100000000-DropSpacePersonThumbnailPath',
   '1775300000000-AddSharedSpaceAlbumTable',
   '1776000000000-AddClassificationTables',
   '1777000000000-AddSpacePersonCounts',
   '1777000000000-AdminScopedClassification',
   '1778000000000-MoveClassificationToConfig',
   '1778100000000-SharedSpaceAuditTables',
   '1778110000000-AddSharedSpaceMemberSyncColumns',
   '1778120000000-AddSharedSpaceAssetSyncColumns',
   '1778200000000-LibraryAuditTables',
   '1778210000000-AddLibrarySyncColumns',
   '1778300000000-AddLibraryUserTable',
   '1778400000000-AddFaceIdentities',
   '1778500000000-AddSpacePersonRepresentativeFaceSource',
   '1778600000000-SortSpacePeopleByNameIndex',
   '1778700000000-AddSharedSpaceFaceMatchBackfillTarget',
   '1778800000000-ReconcileFaceIdentityIndexOverrides',
   '1778800000000-TrimSpacePersonNameIndex',
   '1779000000000-AddSharedSpaceAlbumUserTables',
   '1779100000000-AddSharedSpaceAlbumCreateSideTriggers',
   '1779200000000-AddSharedSpaceAlbumDeleteSideTriggers',
   '1779300000000-FixUserHasAlbumPathSoftDeleted',
   '1779309791424-SharedSpaceAlbumAssetAuditTable',
   '1780000000000-AddFaceRepairScan',
   '1781000000000-AddFaceRepairDecline',
   '1781181889688-SharedSpaceLibraryAssetAuditTable',
   '1781500000000-AddFaceRepairScanFlaggedFace',
   '1782000000000-AddAssetExifDescriptionTrigramIndex',
   '1782050000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger',
   '1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId',
   '1782300000000-AddSharedSpaceAlbumAuditSyncIndexes',
   '1783000000000-AddAlbumSpaceAssetTable',
   '1783050000000-AddFaceRepairScanInFlightIndex',
   '1783100000000-AddAlbumSpaceAssetSyncAndAudit',
   '1783628194057-DisablePostgresJit',
   '1783700000000-FixSharedSpaceMemberJoinGrantCreateId',
   '1784000000000-FixFaceRepairScanInFlightIndexOverride',
   '1784800000000-RepairSharedSpaceAlbumGrantDrift',
   '1785000000000-AddFaceRepairLock',
   '1786000000000-FaceRepairLockPersonNullable',
   '1787000000000-AddFacePersonVerdict',
   '1788000000000-ReconcileFacePersonVerdictConstraints',
   '1789000000000-AddFacePersonVerdictStatusCreatedAtIdIndex',
  '1787100000000-DropPersonFksBeforeClusterGroups',
  '1790000000000-FixFaceRepairScanInFlightIndex',
  '1791000000000-RepointFaceReviewToPersonGroup',
  '1792123120451-AddSharedLinkSpaceId',
  '1793000000000-ClearPreOptionMFaceRepairScans',

   -- Pre-rename names for two migrations that were renumbered off timestamp collisions
   -- ("renumber AddFaceRepairScanFlaggedFace off the #722 collision",
   -- "renumber AddFaceRepairScanInFlightIndex off the #752 collision"). The current names are
   -- already in the list above (1781500000000 / 1783050000000); an RC/staging database that ran
   -- this branch before either renumbering fix recorded the OLD name below instead, which has no
   -- matching file on disk in this tree, and without an exact-name DELETE entry that database
   -- trips "corrupted migrations: previously executed migration ... is missing" on boot.
   '1782000000000-AddFaceRepairScanFlaggedFace',
   '1783000000000-AddFaceRepairScanInFlightIndex',

   -- Build-time compatibility alias (server/bin/sync-gallery-migrations.mjs).
   -- Gallery's postbuild records ChangeDurationToInteger under BOTH its current
   -- upstream name (1777667825574) and its pre-rename name (1776735180298), so
   -- already-deployed DBs that ran the migration under the pre-rename name keep
   -- booting. Upstream Immich v3.0.1 ships only 1777667825574, so on a reverted
   -- DB the pre-rename alias row is an orphan and upstream's migrator aborts with
   -- "corrupted migrations: previously executed migration
   -- 1776735180298-ChangeDurationToInteger is missing". Drop the alias row here;
   -- the real 1777667825574 row is always present by revert time and matches the
   -- upstream file, so it stays.
   '1776735180298-ChangeDurationToInteger',

   -- Post-tag upstream migrations pulled in by rebase, paired with the schema
   -- rollbacks in step 7. Keep timestamp-sorted.
   '1784647658615-AddOAuthBearerTokenToSession',
   '1784836013770-MinFacePreferenceMigration',
   '1784986754473-ConvertUserPasswordEmptyStringToNull',
   '1784986754474-AlbumDescriptionNullable',
   '1786385711807-AlbumOwnerDeleteTrigger',
   '1786741078327-AddWorkflowLogsTable',
   '1786972746371-AssetOcrUpdatedAtTrigger',
   '1786972746372-AssetOcrSyncReset',
  '1787148183729-ClusterGroups',
  '1787148183730-DeleteMismatchedMemoryAssets'
 );

-- -----------------------------------------------------------------------------
-- 9. Report what happened and commit.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  fork_tables_left int;
  fork_rows_left int;
BEGIN
  -- Pattern list deliberately excludes '%AddPersonNameTrigramIndex%'
  -- because upstream Immich has a migration with that same basename
  -- (1775165531374-AddPersonNameTrigramIndex) — Gallery's own version
  -- at 1773846750001 is a stub since upstream adopted the same migration
  -- under a different timestamp. The DELETE IN list above handles the
  -- Gallery stub by exact name; this sanity check must not match the
  -- legit upstream row.
  SELECT count(*) INTO fork_rows_left
    FROM "kysely_migrations"
   WHERE "name" LIKE '%SharedSpace%'
      OR "name" LIKE '%StorageMigrationLog%'
      OR "name" LIKE '%PetDetection%'
      OR "name" LIKE '%UserGroup%'
      OR "name" LIKE '%Classification%'
      OR "name" LIKE '%LibraryAudit%'
      OR "name" LIKE '%LibrarySync%'
      OR "name" LIKE '%LibraryUser%'
      OR "name" LIKE '%AddAssetDuplicateChecksum%'
      OR "name" LIKE '%AddFaceIdentities%'
      OR "name" LIKE '%AddSpacePersonRepresentativeFaceSource%'
      OR "name" LIKE '%SortSpacePeopleByNameIndex%'
      OR "name" LIKE '%ReconcileFaceIdentityIndexOverrides%'
      OR "name" LIKE '%TrimSpacePersonNameIndex%'
      OR "name" LIKE '%AddPersonFaceSuggestion%'
      OR "name" LIKE '%AddSpacePersonFaceSuggestion%'
      OR "name" LIKE '%AddFaceSuggestionIntentStatuses%'
      OR "name" LIKE '%AddFacePersonVerdict%'
      OR "name" LIKE '%AddFaceRepairScan%'
      OR "name" LIKE '%AddFaceRepairDecline%'
      OR "name" LIKE '%AddFaceRepairLock%'
      OR "name" LIKE '%AddFaceRepairScanFlaggedFace%'
      OR "name" LIKE '%AddFaceRepairScanInFlightIndex%';
  IF fork_rows_left > 0 THEN
    RAISE EXCEPTION 'revert-to-immich: % Gallery row(s) still present in kysely_migrations after cleanup — aborting.', fork_rows_left;
  END IF;

  SELECT count(*) INTO fork_tables_left
    FROM pg_tables
   WHERE schemaname = current_schema()
     AND tablename IN (
       'library_user', 'library_audit', 'library_asset_audit',
       'shared_space_library_audit', 'shared_space_library',
       'shared_space_library_asset_audit',
       'shared_space_activity', 'shared_space_person_alias',
       'shared_space_person_face', 'shared_space_person',
       'shared_space_face_match_backfill_target',
       'shared_space_asset_audit', 'shared_space_member_audit',
       'shared_space_audit', 'shared_space_asset', 'shared_space_member',
       'shared_space_album', 'shared_space_album_audit',
       'shared_space_album_user', 'shared_space_album_user_audit',
       'shared_space_album_asset_audit',
       'album_space_asset_audit',
       'face_identity_face', 'face_identity',
       'shared_space', 'user_group_member', 'user_group',
       'classification_prompt_embedding', 'classification_category',
       'storage_migration_log', 'asset_duplicate_checksum',
       'face_person_verdict', 'face_repair_scan', 'face_repair_decline',
       'face_repair_scan_flagged_face', 'face_repair_lock'
     );
  IF fork_tables_left > 0 THEN
    RAISE EXCEPTION 'revert-to-immich: % Gallery table(s) still present after cleanup — aborting.', fork_tables_left;
  END IF;
  RAISE NOTICE 'revert-to-immich: cleanup finished. Switch your image to ghcr.io/immich-app/immich-server and start the stack.';
END $$;

COMMIT;
