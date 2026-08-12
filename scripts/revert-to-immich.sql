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
DROP INDEX IF EXISTS "asset_face_personId_idx";
DROP INDEX IF EXISTS "person_ownerId_identityId_key";
DROP INDEX IF EXISTS "person_identityId_idx";
ALTER TABLE "person"            DROP COLUMN IF EXISTS "identityId";

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
   '1781181889688-SharedSpaceLibraryAssetAuditTable',
   '1782000000000-AddAssetExifDescriptionTrigramIndex',
   '1782050000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger',
   '1782100000000-FixSharedSpaceAlbumGrantRelinkCreateId',
   '1782300000000-AddSharedSpaceAlbumAuditSyncIndexes',
   '1783000000000-AddAlbumSpaceAssetTable',
   '1783100000000-AddAlbumSpaceAssetSyncAndAudit',
   '1783628194057-DisablePostgresJit',
   '1783700000000-FixSharedSpaceMemberJoinGrantCreateId',
   '1784800000000-RepairSharedSpaceAlbumGrantDrift',

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
   '1786385711807-AlbumOwnerDeleteTrigger'
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
      OR "name" LIKE '%TrimSpacePersonNameIndex%';
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
       'storage_migration_log', 'asset_duplicate_checksum'
     );
  IF fork_tables_left > 0 THEN
    RAISE EXCEPTION 'revert-to-immich: % Gallery table(s) still present after cleanup — aborting.', fork_tables_left;
  END IF;
  RAISE NOTICE 'revert-to-immich: cleanup finished. Switch your image to ghcr.io/immich-app/immich-server and start the stack.';
END $$;

COMMIT;
