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
DROP TABLE IF EXISTS "shared_space_activity" CASCADE;
DROP TABLE IF EXISTS "shared_space_person_alias" CASCADE;
DROP TABLE IF EXISTS "shared_space_person_face" CASCADE;
DROP TABLE IF EXISTS "shared_space_person" CASCADE;
DROP TABLE IF EXISTS "shared_space_face_match_backfill_target" CASCADE;
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
-- 7. Undo post-v2.7.5 upstream migrations that Gallery pulled in via rebase.
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

-- 1776217577402-DropAuditTable — recreate the upstream audit table that the
-- migration removed. v2.7.5's schema still references it.
CREATE TABLE IF NOT EXISTS "audit" (
  "id" serial NOT NULL,
  "entityType" character varying NOT NULL,
  "entityId" uuid NOT NULL,
  "action" character varying NOT NULL,
  "ownerId" uuid NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "audit_ownerId_createdAt_idx" ON "audit" ("ownerId", "createdAt");

-- 1776263790468-DropDeviceIdAndDeviceAssetId — re-add the two NOT NULL
-- columns the migration dropped from `asset`. We use `DEFAULT ''` to
-- populate existing asset rows (Postgres requires a default when adding
-- a NOT NULL column to a non-empty table), then immediately DROP DEFAULT
-- so the column matches v2.7.5's schema (which has no default — leaving
-- one in place would show up as ColumnAlter drift in schema-check).
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "deviceAssetId" character varying NOT NULL DEFAULT '';
ALTER TABLE "asset" ALTER COLUMN "deviceAssetId" DROP DEFAULT;
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "deviceId"      character varying NOT NULL DEFAULT '';
ALTER TABLE "asset" ALTER COLUMN "deviceId"      DROP DEFAULT;

-- 1776332807985-SetOAuthAllowInsecureRequests — strip the key the migration
-- wrote into system_metadata. v2.7.5's config schema doesn't know about it.
UPDATE "system_metadata"
   SET "value" = "value" #- '{oauth,allowInsecureRequests}'
 WHERE "key" = 'system-config'
   AND "value" #> '{oauth,allowInsecureRequests}' IS NOT NULL;

-- 1776442031775-AddOauthSidToSession — drop the column and its index the
-- migration added to `session`.
DROP INDEX IF EXISTS "session_oauthSid_idx";
ALTER TABLE "session" DROP COLUMN IF EXISTS "oauthSid";

-- 1776792304485-ReconcileSqlToolsUpgradeChanges — restore the sql-tools
-- override text that v2.7.5 generated.
UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE INDEX \"asset_localDateTime_month_idx\" ON \"asset\" ((date_trunc(''MONTH''::text, (\"localDateTime\" AT TIME ZONE ''UTC''::text)) AT TIME ZONE ''UTC''::text));","name":"asset_localDateTime_month_idx","type":"index"}'::jsonb WHERE "name" = 'index_asset_localDateTime_month_idx';
UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE INDEX \"asset_localDateTime_idx\" ON \"asset\" (((\"localDateTime\" at time zone ''UTC'')::date));","name":"asset_localDateTime_idx","type":"index"}'::jsonb WHERE "name" = 'index_asset_localDateTime_idx';
UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE UNIQUE INDEX \"activity_like_idx\" ON \"activity\" (\"assetId\", \"userId\", \"albumId\") WHERE (\"isLiked\" = true);","name":"activity_like_idx","type":"index"}'::jsonb WHERE "name" = 'index_activity_like_idx';
UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE INDEX \"asset_id_timeline_notDeleted_idx\" ON \"asset\" (\"id\") WHERE visibility = ''timeline'' AND \"deletedAt\" IS NULL;","name":"asset_id_timeline_notDeleted_idx","type":"index"}'::jsonb WHERE "name" = 'index_asset_id_timeline_notDeleted_idx';
UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE INDEX \"asset_face_personId_assetId_notDeleted_isVisible_idx\" ON \"asset_face\" (\"personId\", \"assetId\") WHERE \"deletedAt\" IS NULL AND \"isVisible\" IS TRUE;","name":"asset_face_personId_assetId_notDeleted_isVisible_idx","type":"index"}'::jsonb WHERE "name" = 'index_asset_face_personId_assetId_notDeleted_isVisible_idx';

-- 1776848612954-MigrateAlbumOwnerIdToAlbumUser — v2.7.5 still stores the
-- owner directly on album and uses a varchar album_user.role column.
CREATE OR REPLACE FUNCTION public.album_user_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
    BEGIN
      UPDATE album SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "albumId" FROM inserted_rows);
      RETURN NULL;
    END
  $function$;

CREATE OR REPLACE FUNCTION public.album_delete_audit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
    BEGIN
      INSERT INTO album_audit ("albumId", "userId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END
  $function$;

ALTER TABLE "album" ADD COLUMN IF NOT EXISTS "ownerId" uuid;
UPDATE "album" AS album
   SET "ownerId" = album_user."userId"
  FROM "album_user" AS album_user
 WHERE album_user."albumId" = album."id"
   AND album_user."role"::text = 'owner'
   AND album."ownerId" IS NULL;
ALTER TABLE "album" ALTER COLUMN "ownerId" SET NOT NULL;

DROP INDEX IF EXISTS "album_user_unique_owner";
ALTER TABLE "album_user" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "album_user" ALTER COLUMN "role" TYPE character varying USING "role"::text;
ALTER TABLE "album_user" ALTER COLUMN "role" SET DEFAULT 'editor';
DROP TYPE IF EXISTS "album_user_role_enum";

CREATE INDEX IF NOT EXISTS "album_ownerId_idx" ON "album" ("ownerId");
ALTER TABLE "album" DROP CONSTRAINT IF EXISTS "album_ownerId_fkey";
ALTER TABLE "album" ADD CONSTRAINT "album_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE;

DROP TRIGGER IF EXISTS "album_delete_audit" ON "album";
CREATE OR REPLACE TRIGGER "album_delete_audit"
  AFTER DELETE ON "album"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  WHEN ((pg_trigger_depth() = 0))
  EXECUTE FUNCTION album_delete_audit();

INSERT INTO "migration_overrides" ("name", "value") VALUES ('function_album_delete_audit', '{"sql":"CREATE OR REPLACE FUNCTION album_delete_audit()\n  RETURNS TRIGGER\n  LANGUAGE PLPGSQL\n  AS $$\n    BEGIN\n      INSERT INTO album_audit (\"albumId\", \"userId\")\n      SELECT \"id\", \"ownerId\"\n      FROM OLD;\n      RETURN NULL;\n    END\n  $$;","name":"album_delete_audit","type":"function"}'::jsonb)
  ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";
INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_album_delete_audit', '{"sql":"CREATE OR REPLACE TRIGGER \"album_delete_audit\"\n  AFTER DELETE ON \"album\"\n  REFERENCING OLD TABLE AS \"old\"\n  FOR EACH STATEMENT\n  WHEN (pg_trigger_depth() = 0)\n  EXECUTE FUNCTION album_delete_audit();","name":"album_delete_audit","type":"trigger"}'::jsonb)
  ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";
UPDATE "migration_overrides" SET "value" = '{"sql":"CREATE OR REPLACE FUNCTION album_user_after_insert()\n  RETURNS TRIGGER\n  LANGUAGE PLPGSQL\n  AS $$\n    BEGIN\n      UPDATE album SET \"updatedAt\" = clock_timestamp(), \"updateId\" = immich_uuid_v7(clock_timestamp())\n      WHERE \"id\" IN (SELECT DISTINCT \"albumId\" FROM inserted_rows);\n      RETURN NULL;\n    END\n  $$;","name":"album_user_after_insert","type":"function"}'::jsonb WHERE "name" = 'function_album_user_after_insert';
DELETE FROM "migration_overrides" WHERE "name" = 'index_album_user_unique_owner';

-- 1777415973792-AddVideoStreamTables — remove the transient stream tables.
DROP TABLE IF EXISTS "video_stream_segment";
DROP TABLE IF EXISTS "video_stream_variant";
DROP TABLE IF EXISTS "video_stream_session";
DROP TYPE IF EXISTS "video_stream_variant_codec_enum";

-- 1777654048096-CreateAudioVideoTables — remove extracted media metadata
-- tables that v2.7.5 does not know about.
DROP TABLE IF EXISTS "asset_audio";
DROP TABLE IF EXISTS "asset_video";
DROP TABLE IF EXISTS "asset_keyframe";

-- 1777667825574-ChangeDurationToInteger — convert duration back to the
-- string format used by v2.7.5.
DO $$
DECLARE
  duration_type text;
BEGIN
  SELECT data_type INTO duration_type
    FROM information_schema.columns
   WHERE table_schema = current_schema()
     AND table_name = 'asset'
     AND column_name = 'duration';

  IF duration_type IS DISTINCT FROM 'character varying' THEN
    ALTER TABLE asset
    ALTER COLUMN duration TYPE varchar
    USING (
      CASE
        WHEN duration IS NULL THEN NULL
        ELSE lpad((duration / 3600000)::text, 2, '0')
          || ':' || lpad(((duration / 60000) % 60)::text, 2, '0')
          || ':' || lpad(((duration / 1000) % 60)::text, 2, '0')
          || '.' || lpad((duration % 1000)::text, 3, '0')
      END
    );
  END IF;
END $$;

-- 1777897107000-PartnerAssetSyncReset only deleted sync checkpoints; no
-- schema rollback is required.

-- 1778614946174-UpdateWorkflowTables replaced the v2.7.5 plugin/workflow
-- schema. Recreate the older empty tables after dropping both old and new
-- shapes. Some Gallery images may not yet contain the 177861 migration, so
-- the old child tables can still exist here.
--
-- 1779806699547-AddPluginTemplates later added "plugin"."templates" and
-- "plugin"."sha256hash". Recreating the plugin table to its v2.7.5 shape below
-- drops both columns, so no separate rollback is needed.
DROP TABLE IF EXISTS "workflow_step" CASCADE;
DROP TABLE IF EXISTS "workflow_filter" CASCADE;
DROP TABLE IF EXISTS "workflow_action" CASCADE;
DROP TABLE IF EXISTS "workflow" CASCADE;
DROP TABLE IF EXISTS "plugin_method" CASCADE;
DROP TABLE IF EXISTS "plugin_filter" CASCADE;
DROP TABLE IF EXISTS "plugin_action" CASCADE;
DROP TABLE IF EXISTS "plugin" CASCADE;

CREATE TABLE IF NOT EXISTS "plugin" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "name" character varying NOT NULL,
  "title" character varying NOT NULL,
  "description" character varying NOT NULL,
  "author" character varying NOT NULL,
  "version" character varying NOT NULL,
  "wasmPath" character varying NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_name_uq" UNIQUE ("name"),
  CONSTRAINT "plugin_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "plugin_name_idx" ON "plugin" ("name");

CREATE TABLE IF NOT EXISTS "plugin_filter" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "pluginId" uuid NOT NULL,
  "methodName" character varying NOT NULL,
  "title" character varying NOT NULL,
  "description" character varying NOT NULL,
  "supportedContexts" character varying[] NOT NULL,
  "schema" jsonb,
  CONSTRAINT "plugin_filter_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "plugin" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "plugin_filter_methodName_uq" UNIQUE ("methodName"),
  CONSTRAINT "plugin_filter_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "plugin_filter_supportedContexts_idx" ON "plugin_filter" USING gin ("supportedContexts");
CREATE INDEX IF NOT EXISTS "plugin_filter_pluginId_idx" ON "plugin_filter" ("pluginId");
CREATE INDEX IF NOT EXISTS "plugin_filter_methodName_idx" ON "plugin_filter" ("methodName");

CREATE TABLE IF NOT EXISTS "plugin_action" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "pluginId" uuid NOT NULL,
  "methodName" character varying NOT NULL,
  "title" character varying NOT NULL,
  "description" character varying NOT NULL,
  "supportedContexts" character varying[] NOT NULL,
  "schema" jsonb,
  CONSTRAINT "plugin_action_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "plugin" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "plugin_action_methodName_uq" UNIQUE ("methodName"),
  CONSTRAINT "plugin_action_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "plugin_action_supportedContexts_idx" ON "plugin_action" USING gin ("supportedContexts");
CREATE INDEX IF NOT EXISTS "plugin_action_pluginId_idx" ON "plugin_action" ("pluginId");
CREATE INDEX IF NOT EXISTS "plugin_action_methodName_idx" ON "plugin_action" ("methodName");

CREATE TABLE IF NOT EXISTS "workflow" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "ownerId" uuid NOT NULL,
  "triggerType" character varying NOT NULL,
  "name" character varying,
  "description" character varying NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "enabled" boolean NOT NULL DEFAULT true,
  CONSTRAINT "workflow_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "workflow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "workflow_ownerId_idx" ON "workflow" ("ownerId");

CREATE TABLE IF NOT EXISTS "workflow_filter" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "workflowId" uuid NOT NULL,
  "pluginFilterId" uuid NOT NULL,
  "filterConfig" jsonb,
  "order" integer NOT NULL,
  CONSTRAINT "workflow_filter_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "workflow_filter_pluginFilterId_fkey" FOREIGN KEY ("pluginFilterId") REFERENCES "plugin_filter" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "workflow_filter_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "workflow_filter_pluginFilterId_idx" ON "workflow_filter" ("pluginFilterId");
CREATE INDEX IF NOT EXISTS "workflow_filter_workflowId_order_idx" ON "workflow_filter" ("workflowId", "order");
CREATE INDEX IF NOT EXISTS "workflow_filter_workflowId_idx" ON "workflow_filter" ("workflowId");

CREATE TABLE IF NOT EXISTS "workflow_action" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "workflowId" uuid NOT NULL,
  "pluginActionId" uuid NOT NULL,
  "actionConfig" jsonb,
  "order" integer NOT NULL,
  CONSTRAINT "workflow_action_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "workflow_action_pluginActionId_fkey" FOREIGN KEY ("pluginActionId") REFERENCES "plugin_action" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "workflow_action_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "workflow_action_pluginActionId_idx" ON "workflow_action" ("pluginActionId");
CREATE INDEX IF NOT EXISTS "workflow_action_workflowId_order_idx" ON "workflow_action" ("workflowId", "order");
CREATE INDEX IF NOT EXISTS "workflow_action_workflowId_idx" ON "workflow_action" ("workflowId");

DELETE FROM "migration_overrides" WHERE "name" = 'trigger_workflow_updatedAt';
INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_plugin_filter_supportedContexts_idx', '{"type":"index","name":"plugin_filter_supportedContexts_idx","sql":"CREATE INDEX \"plugin_filter_supportedContexts_idx\" ON \"plugin_filter\" (\"supportedContexts\") USING gin;"}'::jsonb)
  ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";
INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_plugin_action_supportedContexts_idx', '{"type":"index","name":"plugin_action_supportedContexts_idx","sql":"CREATE INDEX \"plugin_action_supportedContexts_idx\" ON \"plugin_action\" (\"supportedContexts\") USING gin;"}'::jsonb)
  ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value";

-- 1780435471692-DeleteMismatchedAssetFaces only deleted unauthorized
-- cross-owner asset_face rows; no schema rollback is required.

-- 1780592070031-ConvertNegativeRatingToNull is a no-op in Gallery (its up()
-- is commented out so the fork can keep -1 ratings); nothing to reverse.

-- 1780592071031-AssetOcrSync layered an audit table, an "updateId" column, and
-- a delete-audit trigger/function on top of the OCR tables that v2.7.5 already
-- ships (CreateAssetOCRTable predates v2.7.5). Reverse exactly those additions
-- — ported from the migration's down() with IF EXISTS guards so this is a
-- no-op against the tagged image that never ran AssetOcrSync.
DROP TRIGGER IF EXISTS "asset_ocr_delete_audit" ON "asset_ocr";
DROP INDEX IF EXISTS "asset_ocr_updateId_idx";
ALTER TABLE "asset_ocr" DROP COLUMN IF EXISTS "updateId";
DROP TABLE IF EXISTS "asset_ocr_audit";
DROP FUNCTION IF EXISTS asset_ocr_delete_audit;
-- NOTE: AssetOcrSync.down() also re-asserts the unrelated fork override
-- "function_asset_edit_delete". We deliberately do NOT port that here — the
-- asset_edit (image-editing) feature is fork-only and is torn down by the fork
-- cleanup sections, so re-asserting its override against the tagged image (which
-- never ran AssetOcrSync) introduces "function asset_edit_delete missing /
-- override needs update" schema drift. Only AssetOcrSync's own net-new objects
-- are reversed above.
DELETE FROM "migration_overrides" WHERE "name" = 'function_asset_ocr_delete_audit';
DELETE FROM "migration_overrides" WHERE "name" = 'trigger_asset_ocr_delete_audit';

-- 1781089983296-CreateIntegrityReportTable added the integrity_report table
-- and an asset."createdAt" index that v2.7.5 does not have.
DROP TABLE IF EXISTS "integrity_report";
DROP INDEX IF EXISTS "asset_createdAt_idx";

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

   -- Post-v2.7.5 upstream migrations pulled in by rebase. Paired with the
   -- schema rollbacks in step 7 above.
   '1776217577402-DropAuditTable',
   '1776263790468-DropDeviceIdAndDeviceAssetId',
   '1776332807985-SetOAuthAllowInsecureRequests',
   '1776442031775-AddOauthSidToSession',
   '1776792304485-ReconcileSqlToolsUpgradeChanges',
   '1776848612954-MigrateAlbumOwnerIdToAlbumUser',
   '1777415973792-AddVideoStreamTables',
   '1777654048096-CreateAudioVideoTables',
   '1777667825574-ChangeDurationToInteger',
   '1777897107000-PartnerAssetSyncReset',
   '1778614946174-UpdateWorkflowTables',
   '1779806699547-AddPluginTemplates',
   '1780435471692-DeleteMismatchedAssetFaces',
   '1780592070031-ConvertNegativeRatingToNull',
   '1780592071031-AssetOcrSync',
   '1781089983296-CreateIntegrityReportTable'
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
       'shared_space_activity', 'shared_space_person_alias',
       'shared_space_person_face', 'shared_space_person',
       'shared_space_asset_audit', 'shared_space_member_audit',
       'shared_space_audit', 'shared_space_asset', 'shared_space_member',
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
