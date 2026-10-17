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
--     system_metadata's system-config row)
--   * Every Gallery setting in system-config and Gallery's per-type memory
--     switches in user preferences
--   * Pet detection results: every pet, its faces and its embeddings
--   * Rule memories (Immich only knows on-this-day and birthday memories)
--   * Video trims: the full-length video comes back and the trimmed copy is
--     no longer referenced
--   * Other members' photos in links shared from a space, album links to
--     albums the creator neither owns nor edits, and asset links left empty
--     by that
--   * Gallery-only API key permissions
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
-- 0. Refuse to run while any file lives in S3.
--
-- Gallery stores S3 object keys as relative paths in the same columns that hold
-- absolute disk paths (the four the Storage Migration moves). Stock Immich only
-- reads from disk, so every such row would point at a file it cannot open.
-- This runs before any write, so a refusal leaves the database untouched.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  s3_paths bigint;
BEGIN
  SELECT (SELECT count(*) FROM "asset" WHERE "originalPath" NOT LIKE '/%')
       + (SELECT count(*) FROM "asset_file" WHERE "path" NOT LIKE '/%')
       + (SELECT count(*) FROM "person" WHERE "thumbnailPath" <> '' AND "thumbnailPath" NOT LIKE '/%')
       + (SELECT count(*) FROM "user" WHERE "profileImagePath" <> '' AND "profileImagePath" NOT LIKE '/%')
    INTO s3_paths;
  IF s3_paths > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format('revert-to-immich.sql refused: %s file path(s) point at S3 storage, which Immich cannot read. Run the Storage Migration to disk first (Administration > Storage Migration, direction S3 to Disk), then run this script again.', s3_paths);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 0a. Optional: keep each shared space as an Immich shared album.
--
-- Off unless the session sets  SET gallery.convert_spaces = 'on';  (next to
-- gallery.revert_token). Each space becomes one album holding every photo a
-- member could open through it: its own photos, the online photos of its linked
-- libraries (a snapshot), the photos of its linked albums shown in the space,
-- and the photos members added to those albums from the space. Nothing becomes
-- more visible than it was:
--   * the creator owns the album while the account is live, else the
--     longest-standing live member, owners first; a space with no live member
--     is skipped. Space owners and editors become editors, viewers viewers.
--   * linked albums get a direct grant for each member (strongest role across
--     spaces); a user who already has a row on that album keeps it.
--   * 'Add to space' workflow steps add to the new albums through Immich's
--     'Add to Album(s)'. 'Add to space album' has no Immich equivalent and goes.
--   * a space person's name and birth date go onto the matching unnamed
--     personal person when exactly one value maps.
-- Others' photos a user favorited become a private album only when the session
-- also sets  SET gallery.convert_favorites = 'on';  that album is a grant the
-- photo's owner can neither see nor revoke.
-- Lost: colour and crop, co-owners, folders, hidden albums, activity, aliases.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  core_method uuid;
  n_spaces int; n_skipped int; n_assets int; n_grants int; n_favorites int; n_names int;
  n_steps int; n_steps_dropped int;
BEGIN
  IF current_setting('gallery.convert_spaces', true) IS DISTINCT FROM 'on'
     OR to_regclass('public.shared_space') IS NULL THEN
    RETURN;
  END IF;
  IF to_regclass('public.person_identity') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'revert-to-immich.sql refused: converting spaces needs the current Gallery schema. Start the latest Gallery release once so its migrations run, stop it, then run this script again.';
  END IF;

  CREATE TEMP TABLE conv_space ON COMMIT DROP AS
  SELECT s."id" AS "spaceId", gen_random_uuid() AS "albumId", s."name", s."description",
         s."thumbnailAssetId", s."createdAt", o."userId" AS "ownerId"
    FROM "shared_space" s
    CROSS JOIN LATERAL (
      SELECT c."userId"
        FROM (SELECT m."userId", m."role", m."joinedAt"
                FROM "shared_space_member" m
               WHERE m."spaceId" = s."id"
              UNION ALL
              SELECT s."createdById", 'owner', s."createdAt") c
        JOIN "user" u ON u."id" = c."userId" AND u."deletedAt" IS NULL
       ORDER BY c."userId" = s."createdById" DESC,
                CASE c."role" WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
                c."joinedAt", c."userId"
       LIMIT 1) o;
  SELECT count(*) INTO n_spaces FROM conv_space;
  SELECT count(*) - n_spaces INTO n_skipped FROM "shared_space";

  INSERT INTO "album" ("id", "albumName", "description", "createdAt")
  SELECT "albumId", "name", "description", "createdAt" FROM conv_space;

  INSERT INTO "album_user" ("albumId", "userId", "role")
  SELECT "albumId", "ownerId", 'owner'::album_user_role_enum FROM conv_space;

  INSERT INTO "album_user" ("albumId", "userId", "role")
  SELECT cs."albumId", m."userId",
         (CASE WHEN m."role" IN ('owner', 'editor') THEN 'editor' ELSE 'viewer' END)::album_user_role_enum
    FROM conv_space cs
    JOIN "shared_space_member" m ON m."spaceId" = cs."spaceId"
    JOIN "user" u ON u."id" = m."userId" AND u."deletedAt" IS NULL
   WHERE m."userId" <> cs."ownerId"
  ON CONFLICT DO NOTHING;

  INSERT INTO "album_asset" ("albumId", "assetId")
  SELECT DISTINCT cs."albumId", a."id"
    FROM conv_space cs
    CROSS JOIN LATERAL (
      SELECT ssa."assetId" FROM "shared_space_asset" ssa WHERE ssa."spaceId" = cs."spaceId"
      UNION
      SELECT la."id"
        FROM "shared_space_library" ssl
        JOIN "asset" la ON la."libraryId" = ssl."libraryId" AND NOT la."isOffline"
       WHERE ssl."spaceId" = cs."spaceId"
      UNION
      SELECT aa."assetId"
        FROM "shared_space_album" l
        JOIN "album" al ON al."id" = l."albumId" AND al."deletedAt" IS NULL
        JOIN "album_asset" aa ON aa."albumId" = l."albumId"
       WHERE l."spaceId" = cs."spaceId" AND l."showInTimeline"
      UNION
      SELECT asa."assetId"
        FROM "album_space_asset" asa
        JOIN "shared_space_album" l ON l."albumId" = asa."albumId" AND l."spaceId" = asa."spaceId"
        JOIN "album" al ON al."id" = l."albumId" AND al."deletedAt" IS NULL
       WHERE asa."spaceId" = cs."spaceId") x
    JOIN "asset" a ON a."id" = x."assetId"
                  AND a."deletedAt" IS NULL
                  AND a."visibility" IN ('timeline', 'archive')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n_assets = ROW_COUNT;

  UPDATE "album" al
     SET "albumThumbnailAssetId" = COALESCE(
           (SELECT aa."assetId" FROM "album_asset" aa
             WHERE aa."albumId" = al."id" AND aa."assetId" = cs."thumbnailAssetId"),
           (SELECT aa."assetId" FROM "album_asset" aa JOIN "asset" a ON a."id" = aa."assetId"
             WHERE aa."albumId" = al."id" ORDER BY a."fileCreatedAt" DESC, a."id" LIMIT 1))
    FROM conv_space cs
   WHERE cs."albumId" = al."id";

  INSERT INTO "album_user" ("albumId", "userId", "role")
  SELECT l."albumId", m."userId",
         (CASE WHEN bool_or(m."role" IN ('owner', 'editor')) THEN 'editor' ELSE 'viewer' END)::album_user_role_enum
    FROM "shared_space_album" l
    JOIN "album" al ON al."id" = l."albumId" AND al."deletedAt" IS NULL
    JOIN "shared_space_member" m ON m."spaceId" = l."spaceId"
    JOIN "user" u ON u."id" = m."userId" AND u."deletedAt" IS NULL
   GROUP BY l."albumId", m."userId"
  ON CONFLICT ("albumId", "userId") DO NOTHING;
  GET DIAGNOSTICS n_grants = ROW_COUNT;

  -- Workflow steps. Section 6b deletes Gallery's plugin, and every step wired to it with it.
  IF to_regclass('public.workflow_step') IS NOT NULL THEN
    SELECT pm."id" INTO core_method
      FROM "plugin_method" pm JOIN "plugin" p ON p."id" = pm."pluginId"
     WHERE p."name" = 'immich-plugin-core' AND pm."name" = 'assetAddToAlbums';
    UPDATE "workflow_step" ws
       SET "pluginMethodId" = core_method, "config" = jsonb_build_object('albumIds', mapped."albumIds")
      FROM (SELECT ws2."id", jsonb_agg(cs."albumId" ORDER BY sp."n") AS "albumIds"
              FROM "workflow_step" ws2
              JOIN "plugin_method" gm ON gm."id" = ws2."pluginMethodId" AND gm."name" = 'addToSpace'
              JOIN "plugin" gp ON gp."id" = gm."pluginId" AND gp."name" = 'gallery-core'
              CROSS JOIN LATERAL jsonb_array_elements_text(ws2."config" -> 'spaceIds') WITH ORDINALITY sp("spaceId", "n")
              JOIN conv_space cs ON cs."spaceId"::text = sp."spaceId"
             GROUP BY ws2."id") mapped
     WHERE ws."id" = mapped."id" AND core_method IS NOT NULL;
    GET DIAGNOSTICS n_steps = ROW_COUNT;
    SELECT count(*) INTO n_steps_dropped
      FROM "workflow_step" ws
      JOIN "plugin_method" gm ON gm."id" = ws."pluginMethodId"
      JOIN "plugin" gp ON gp."id" = gm."pluginId" AND gp."name" = 'gallery-core';
    IF n_steps_dropped > 0 THEN
      RAISE NOTICE 'convert-spaces: % Gallery workflow step(s) have no Immich equivalent and will be deleted (Add to space album, or a space that was skipped)', n_steps_dropped;
    END IF;
  END IF;

  IF current_setting('gallery.convert_favorites', true) = 'on'
     AND to_regclass('public.asset_favorite') IS NOT NULL THEN
    CREATE TEMP TABLE conv_favorite ON COMMIT DROP AS
    SELECT f."userId", f."assetId"
      FROM "asset_favorite" f
      JOIN "asset" a ON a."id" = f."assetId" AND a."ownerId" <> f."userId" AND a."deletedAt" IS NULL
      JOIN "user" u ON u."id" = f."userId" AND u."deletedAt" IS NULL
     WHERE EXISTS (SELECT FROM "album_user" au
                     JOIN "album" al ON al."id" = au."albumId" AND al."deletedAt" IS NULL
                     JOIN "album_asset" aa ON aa."albumId" = au."albumId"
                    WHERE au."userId" = f."userId" AND aa."assetId" = f."assetId")
        OR EXISTS (SELECT FROM "partner" p
                    WHERE p."sharedById" = a."ownerId" AND p."sharedWithId" = f."userId"
                      AND a."visibility" IN ('timeline', 'hidden'));
    CREATE TEMP TABLE conv_favorite_album ON COMMIT DROP AS
    SELECT "userId", gen_random_uuid() AS "albumId" FROM (SELECT DISTINCT "userId" FROM conv_favorite) u;
    INSERT INTO "album" ("id", "albumName", "description")
    SELECT "albumId", 'Favorites from shared spaces', 'Other people''s photos you favorited in Gallery.'
      FROM conv_favorite_album;
    INSERT INTO "album_user" ("albumId", "userId", "role")
    SELECT "albumId", "userId", 'owner'::album_user_role_enum FROM conv_favorite_album;
    INSERT INTO "album_asset" ("albumId", "assetId")
    SELECT fa."albumId", f."assetId" FROM conv_favorite f JOIN conv_favorite_album fa USING ("userId")
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n_favorites = ROW_COUNT;
  END IF;

  -- A space person maps to a member's personal person through its faces or its face identity.
  CREATE TEMP TABLE conv_person ON COMMIT DROP AS
  SELECT op."personGroupId", nullif(btrim(ssp."name"), '') AS "name", ssp."birthDate"
    FROM "shared_space_person" ssp
    JOIN "shared_space_person_face" f ON f."personId" = ssp."id"
    JOIN "asset_face" af ON af."id" = f."assetFaceId" AND af."deletedAt" IS NULL
    JOIN "person" op ON op."personGroupId" = af."personGroupId"
    JOIN "shared_space_member" m ON m."spaceId" = ssp."spaceId" AND m."userId" = op."ownerId"
   WHERE NOT ssp."isHidden" AND ssp."type" = 'person'
  UNION
  SELECT op."personGroupId", nullif(btrim(ssp."name"), ''), ssp."birthDate"
    FROM "shared_space_person" ssp
    JOIN "person_identity" pi ON pi."identityId" = ssp."identityId"
    JOIN "person" op ON op."personGroupId" = pi."personGroupId" AND op."ownerId" = pi."ownerId"
    JOIN "shared_space_member" m ON m."spaceId" = ssp."spaceId" AND m."userId" = op."ownerId"
   WHERE NOT ssp."isHidden" AND ssp."type" = 'person';

  UPDATE "person" p
     SET "name" = n."name"
    FROM (SELECT "personGroupId", min("name") AS "name" FROM conv_person WHERE "name" IS NOT NULL
           GROUP BY "personGroupId" HAVING count(DISTINCT "name") = 1) n
   WHERE p."personGroupId" = n."personGroupId" AND btrim(p."name") = '';
  GET DIAGNOSTICS n_names = ROW_COUNT;

  UPDATE "person" p
     SET "birthDate" = n."birthDate"
    FROM (SELECT "personGroupId", min("birthDate") AS "birthDate" FROM conv_person WHERE "birthDate" IS NOT NULL
           GROUP BY "personGroupId" HAVING count(DISTINCT "birthDate") = 1) n
   WHERE p."personGroupId" = n."personGroupId" AND p."birthDate" IS NULL;

  RAISE NOTICE 'convert-spaces: % space(s) became albums (% skipped: no live member), % album photo(s), % linked-album grant(s), % workflow step(s) moved to Add to Album(s), % favorite(s) kept, % person name(s) kept',
    n_spaces, n_skipped, n_assets, n_grants, coalesce(n_steps, 0), coalesce(n_favorites, 0), n_names;
END $$;

-- -----------------------------------------------------------------------------
-- 0b. Remove Gallery data that stock Immich would misread.
--
-- These rows sit in upstream tables, so dropping the fork tables and columns
-- below would leave them behind looking like ordinary Immich data. Each step
-- is a no-op when the fork table, column or rows are absent.
-- -----------------------------------------------------------------------------

-- Pets. Gallery stores them as upstream person/asset_face rows told apart only
-- by person_pet (person.type on databases from before it; both go in sections 2
-- and 4) and pet_search (dropped in section 2), so without this they come back
-- as people. asset_face."personGroupId" is ON DELETE SET NULL, so the faces
-- must go explicitly; deleting the person_group then cascades to person.
-- pet_search holds the faces that pet recognition has not assigned to anyone yet.
DO $$
BEGIN
  IF to_regclass('public.pet_search') IS NOT NULL THEN
    DELETE FROM "asset_face" WHERE "id" IN (SELECT "faceId" FROM "pet_search");
  END IF;
  IF to_regclass('public.person_pet') IS NOT NULL THEN
    DELETE FROM "asset_face" WHERE "personGroupId" IN (SELECT "personGroupId" FROM "person_pet");
    DELETE FROM "person_group" WHERE "id" IN (SELECT "personGroupId" FROM "person_pet");
  ELSIF EXISTS (SELECT FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'person' AND column_name = 'type') THEN
    DELETE FROM "asset_face"
     WHERE "personGroupId" IN (SELECT "personGroupId" FROM "person" WHERE "type" = 'pet');
    DELETE FROM "person_group"
     WHERE "id" IN (SELECT "personGroupId" FROM "person" WHERE "type" = 'pet');
  END IF;
END $$;

-- Rule memories. Immich's MemoryType has no 'rule', and its MemoriesV2 sync
-- stream sends every type, so one such row breaks mobile sync. memory_asset
-- rows cascade.
DELETE FROM "memory" WHERE "type" = 'rule';

-- Video trims. Immich only edits images: it would show the trimmed thumbnails
-- over the full-length original. Drop the edited files the trim produced and
-- the trim itself. A trim cannot be combined with an image edit, so every
-- edited file of a trimmed asset came from the trim. The trimmed video and
-- thumbnails stay on disk as unreferenced files. The trim also replaced the
-- thumbhash with the trimmed frame's; clearing it makes Immich's nightly
-- missing-thumbnails job regenerate it from the original.
--
-- Current Gallery keeps trims in asset_video_trim, and asset.duration is
-- already the original's. Clear isEdited too, so Immich asks for the original
-- thumbnails.
DO $$
BEGIN
  IF to_regclass('public.asset_video_trim') IS NOT NULL THEN
    UPDATE "asset"
       SET "thumbhash" = NULL, "isEdited" = false
      FROM "asset_video_trim"
     WHERE "asset_video_trim"."assetId" = "asset"."id";
    DELETE FROM "asset_file"
     WHERE "isEdited"
       AND "assetId" IN (SELECT "assetId" FROM "asset_video_trim");
  END IF;
END
$$;
-- Gallery before 1798900000000 kept trims in asset_edit and the trimmed length
-- in asset.duration: restore the original duration (stored in seconds in the
-- edit). Deleting the edit clears isEdited through asset_edit_delete.
UPDATE "asset"
   SET "thumbhash" = NULL
  FROM "asset_edit"
 WHERE "asset_edit"."assetId" = "asset"."id"
   AND "asset_edit"."action" = 'trim';
UPDATE "asset"
   SET "duration" = round(("asset_edit"."parameters"->>'originalDuration')::numeric * 1000)
  FROM "asset_edit"
 WHERE "asset_edit"."assetId" = "asset"."id"
   AND "asset_edit"."action" = 'trim'
   AND ("asset_edit"."parameters"->>'originalDuration')::numeric > 0;
DELETE FROM "asset_file"
 WHERE "isEdited"
   AND "assetId" IN (SELECT "assetId" FROM "asset_edit" WHERE "action" = 'trim');
DELETE FROM "asset_edit" WHERE "action" = 'trim';

-- Share links created from a space. Gallery lets such a link carry other
-- members' assets and re-checks space membership on every read; Immich grants
-- whatever shared_link_asset lists, and the whole album for an album link,
-- with no such check. So keep only what the creator could have shared in plain
-- Immich (own assets, and partners' assets under the same conditions as
-- Immich's asset share permission), drop album links to albums the creator
-- neither owns nor edits (Immich's album share permission), and drop asset
-- links this leaves empty. Without 0a, space access to an album lives only in
-- the dropped shared_space_album* tables, never in album_user. With 0a, every
-- member holds an album_user row on the space's linked albums, so a link a space
-- owner or editor made on a linked album survives as an Immich album editor's.
-- The asset prune covers every link, not only those made from a space: deleting
-- a space drops the link's space row but keeps the other members' asset rows. It
-- also drops assets of partners removed since the link was made.
CREATE TEMP TABLE revert_pruned_link ("id" uuid) ON COMMIT DROP;
WITH pruned AS (
  DELETE FROM "shared_link_asset" sla
   USING "shared_link" sl, "asset" a
   WHERE sla."sharedLinkId" = sl."id"
     AND sla."assetId" = a."id"
     AND a."ownerId" <> sl."userId"
     AND NOT EXISTS (SELECT FROM "partner" p
                      JOIN "user" u ON u."id" = p."sharedById" AND u."deletedAt" IS NULL
                     WHERE p."sharedById" = a."ownerId" AND p."sharedWithId" = sl."userId"
                       AND a."visibility" IN ('timeline', 'hidden'))
  RETURNING sla."sharedLinkId"
)
INSERT INTO revert_pruned_link SELECT DISTINCT "sharedLinkId" FROM pruned;
DELETE FROM "shared_link" sl
 WHERE sl."type" = 'INDIVIDUAL'
   AND sl."id" IN (SELECT "id" FROM revert_pruned_link)
   AND NOT EXISTS (SELECT FROM "shared_link_asset" sla WHERE sla."sharedLinkId" = sl."id");
-- Links made from a space: the shared_link_space sidecar (1798000000000), or
-- the shared_link."spaceId" column it replaced on databases from before it.
CREATE TEMP TABLE revert_space_link ("id" uuid) ON COMMIT DROP;
DO $$
BEGIN
  IF to_regclass('public.shared_link_space') IS NOT NULL THEN
    INSERT INTO revert_space_link SELECT "sharedLinkId" FROM "shared_link_space";
  END IF;
  IF EXISTS (SELECT FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'shared_link' AND column_name = 'spaceId') THEN
    INSERT INTO revert_space_link SELECT "id" FROM "shared_link" WHERE "spaceId" IS NOT NULL;
  END IF;
END $$;
DELETE FROM "shared_link" sl
 WHERE sl."id" IN (SELECT "id" FROM revert_space_link)
   AND sl."type" = 'ALBUM'
   AND NOT EXISTS (SELECT FROM "album_user" au
                    WHERE au."albumId" = sl."albumId" AND au."userId" = sl."userId" AND au."role" IN ('owner', 'editor'));
DELETE FROM "shared_link" sl
 WHERE sl."id" IN (SELECT "id" FROM revert_space_link)
   AND sl."type" = 'INDIVIDUAL'
   AND NOT EXISTS (SELECT FROM "shared_link_asset" sla WHERE sla."sharedLinkId" = sl."id");

-- Gallery-only system_metadata rows. Immich reads its rows by key and never
-- looks at these.
DELETE FROM "system_metadata"
 WHERE "key" IN (
   'pet-recognition-state',
   'classification-config-state',
   'shared-space-face-job-cleanup-state',
   'face-suggestion-default-on-state',
   'person-suggestion-scan-job-cleanup-state'
 );

-- Gallery-only API key permissions (Gallery's Permission enum minus Immich's).
-- Immich would carry them as unknown strings.
UPDATE "api_key" k
   SET "permissions" = kept."permissions"
  FROM (
    SELECT "id", array(
             SELECT p FROM unnest("permissions") AS p
              WHERE p <> ALL (ARRAY[
                'sharedSpace.create', 'sharedSpace.read', 'sharedSpace.update', 'sharedSpace.delete',
                'sharedSpaceMember.create', 'sharedSpaceMember.update', 'sharedSpaceMember.delete',
                'sharedSpaceAsset.create', 'sharedSpaceAsset.read', 'sharedSpaceAsset.delete',
                'sharedSpaceAlbum.create', 'sharedSpaceAlbum.update', 'sharedSpaceAlbum.delete',
                'sharedSpaceAlbumFolder.create', 'sharedSpaceAlbumFolder.update', 'sharedSpaceAlbumFolder.delete',
                'sharedSpaceLibrary.create', 'sharedSpaceLibrary.delete',
                'userGroup.create', 'userGroup.read', 'userGroup.update', 'userGroup.delete'
              ]::character varying[])
           )::character varying[] AS "permissions"
      FROM "api_key"
  ) kept
 WHERE kept."id" = k."id"
   AND kept."permissions" <> k."permissions";

-- Sync checkpoints for Gallery's sync streams (Gallery's SyncEntityType values
-- minus Immich's). Immich never reads them; they would stay in its table forever.
DELETE FROM "session_sync_checkpoint"
 WHERE "type" IN (
    'AssetFavoriteDeleteV1', 'AssetFavoriteV1', 'LibraryAssetBackfillV1', 'LibraryAssetCreateV1',
    'LibraryAssetDeleteV1', 'LibraryAssetExifBackfillV1', 'LibraryAssetExifCreateV1',
    'LibraryDeleteV1', 'LibraryV1', 'SharedSpaceAlbumAssetBackfillV1',
    'SharedSpaceAlbumAssetCreateV1', 'SharedSpaceAlbumAssetExifBackfillV1',
    'SharedSpaceAlbumAssetExifCreateV1', 'SharedSpaceAlbumAssetExifUpdateV1',
    'SharedSpaceAlbumAssetUpdateV1', 'SharedSpaceAlbumBackfillV1', 'SharedSpaceAlbumDeleteV1',
    'SharedSpaceAlbumFolderBackfillV1', 'SharedSpaceAlbumFolderDeleteV1',
    'SharedSpaceAlbumFolderV1', 'SharedSpaceAlbumHiddenBackfillV1',
    'SharedSpaceAlbumHiddenDeleteV1', 'SharedSpaceAlbumHiddenV1', 'SharedSpaceAlbumLinkBackfillV1',
    'SharedSpaceAlbumLinkDeleteV1', 'SharedSpaceAlbumLinkV1', 'SharedSpaceAlbumToAssetBackfillV1',
    'SharedSpaceAlbumToAssetDeleteV1', 'SharedSpaceAlbumToAssetV1', 'SharedSpaceAlbumV1',
    'SharedSpaceAssetBackfillV1', 'SharedSpaceAssetCreateV1', 'SharedSpaceAssetExifBackfillV1',
    'SharedSpaceAssetExifCreateV1', 'SharedSpaceAssetExifUpdateV1', 'SharedSpaceAssetUpdateV1',
    'SharedSpaceDeleteV1', 'SharedSpaceLibraryBackfillV1', 'SharedSpaceLibraryDeleteV1',
    'SharedSpaceLibraryV1', 'SharedSpaceMemberBackfillV1', 'SharedSpaceMemberDeleteV1',
    'SharedSpaceMemberV1', 'SharedSpaceToAssetBackfillV1', 'SharedSpaceToAssetDeleteV1',
    'SharedSpaceToAssetV1', 'SharedSpaceV1'
 );

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
-- The reverse favorite-projection trigger names asset_favorite in its body, which Postgres does not
-- track as a dependency: section 2's DROP TABLE asset_favorite CASCADE leaves it in place, and every
-- asset write on stock Immich would then fail with "relation asset_favorite does not exist".
DROP TRIGGER IF EXISTS "asset_is_favorite_after_write" ON "asset";

-- -----------------------------------------------------------------------------
-- 1b. Restore upstream columns Gallery removed.
--
-- #763: per-user favorites. Gallery replaced asset."isFavorite" with the
-- asset_favorite overlay, so reverting must RESTORE the upstream column before
-- the overlay is dropped. This is the first fork change that removes upstream
-- schema, so it is the first restore step in this script.
-- LOSSY: favorites belonging to non-owners (space members who favorited someone
-- else's photo) have nowhere to live in plain Immich and are discarded.
--
-- 1798800000000-RestoreAssetIsFavoriteProjection brought the column back as the owner's projection of
-- the overlay, so on a current database this block changes nothing. It stays for databases last booted
-- by a release between 1794100000000-DropAssetIsFavoriteColumn and that migration, which have no column.
-- -----------------------------------------------------------------------------
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "isFavorite" boolean NOT NULL DEFAULT false;

-- Guarded: on a Gallery DB that predates the #763 migrations entirely (e.g. the CI validation
-- image built from a pre-favorites main, or a deployment that never upgraded that far), the
-- asset_favorite overlay does not exist and the raw column still carries the favorites — there
-- is nothing to backfill and the bare UPDATE would abort the transaction.
DO $$
BEGIN
  IF to_regclass('public.asset_favorite') IS NOT NULL THEN
    UPDATE "asset"
       SET "isFavorite" = true
      FROM asset_favorite f
     WHERE f."assetId" = "asset"."id"
       AND f."userId"  = "asset"."ownerId"
       AND NOT "asset"."isFavorite";
  END IF;
END $$;

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
DROP TABLE IF EXISTS "shared_link_space" CASCADE;
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
DROP TABLE IF EXISTS "shared_space_album_hidden" CASCADE;
DROP TABLE IF EXISTS "shared_space_album_hidden_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_album_user" CASCADE;
DROP TABLE IF EXISTS "shared_space_album_user_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_album_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_album" CASCADE;
DROP TABLE IF EXISTS "shared_space_album_folder_audit" CASCADE;
DROP TABLE IF EXISTS "shared_space_album_folder" CASCADE;
DROP TABLE IF EXISTS "shared_space_member" CASCADE;
DROP TABLE IF EXISTS "shared_space" CASCADE;

-- Face identities
DROP TABLE IF EXISTS "person_identity" CASCADE;
DROP TABLE IF EXISTS "person_pet" CASCADE;
DROP TABLE IF EXISTS "face_repair_scan_flagged_face" CASCADE;
DROP TABLE IF EXISTS "face_repair_decline" CASCADE;
DROP TABLE IF EXISTS "face_repair_lock" CASCADE;
DROP TABLE IF EXISTS "face_repair_scan" CASCADE;
DROP TABLE IF EXISTS "face_identity_face" CASCADE;
DROP TABLE IF EXISTS "asset_face_creator" CASCADE;
DROP TABLE IF EXISTS "face_identity" CASCADE;

-- Pet recognition embeddings
DROP TABLE IF EXISTS "pet_search" CASCADE;

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

-- Per-user favorites overlay (#763). asset."isFavorite" is restored and
-- backfilled from this table in step 1b above before it is dropped here.
DROP TABLE IF EXISTS "asset_favorite_audit" CASCADE;
DROP TABLE IF EXISTS "asset_favorite" CASCADE;

-- Gallery job stamps (pet detection, classification) beside asset_job_status.
DROP TABLE IF EXISTS "asset_job_status_gallery" CASCADE;

-- Video trims, cleaned up in step 1 above.
DROP TABLE IF EXISTS "asset_video_trim" CASCADE;

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
DROP FUNCTION IF EXISTS shared_space_album_hidden_delete_audit() CASCADE;
DROP FUNCTION IF EXISTS shared_space_album_folder_delete_audit() CASCADE;
DROP FUNCTION IF EXISTS album_soft_delete_shared_space_album() CASCADE;
DROP FUNCTION IF EXISTS album_space_asset_delete_audit() CASCADE;
DROP FUNCTION IF EXISTS asset_favorite_delete_audit() CASCADE;
DROP FUNCTION IF EXISTS asset_favorite_after_insert() CASCADE;
DROP FUNCTION IF EXISTS asset_favorite_after_delete() CASCADE;
DROP FUNCTION IF EXISTS asset_is_favorite_after_write() CASCADE;

-- -----------------------------------------------------------------------------
-- 4. Drop Gallery-added columns from Immich-native tables.
--
-- Indexes on these columns would go with them; they are dropped by name anyway
-- so revert-to-immich.spec.ts can check every fork index is covered.
-- -----------------------------------------------------------------------------
-- Databases from before the person_pet and asset_job_status_gallery sidecars.
ALTER TABLE "person"            DROP COLUMN IF EXISTS "type";
ALTER TABLE "person"            DROP COLUMN IF EXISTS "species";
ALTER TABLE "asset_job_status"  DROP COLUMN IF EXISTS "petsDetectedAt";
ALTER TABLE "asset_job_status"  DROP COLUMN IF EXISTS "classifiedAt";
-- Databases from before 1798200000000-DropLibraryCreateId.
DROP INDEX IF EXISTS "library_createId_idx";
ALTER TABLE "library"           DROP COLUMN IF EXISTS "createId";
-- 1791000000000-RepointFaceReviewToPersonGroup added this unique index to make option M's
-- one-person-per-group invariant a database fact. It lives on the upstream `person` table, so
-- unlike the rest of that migration (which only touches Gallery-only face-review tables that
-- section 2 already dropped CASCADE) it has to come off explicitly.
DROP INDEX IF EXISTS "person_personGroupId_key";
DROP INDEX IF EXISTS "asset_face_personId_idx";
-- Databases from before person_identity replaced person."identityId".
DROP INDEX IF EXISTS "person_ownerId_identityId_key";
DROP INDEX IF EXISTS "person_identityId_idx";
ALTER TABLE "person"            DROP COLUMN IF EXISTS "identityId";
-- #1018: the space a share link was created from, on databases from before
-- shared_link_space replaced the column. Section 0b already removed what these
-- links could only reach through the space.
DROP INDEX IF EXISTS "shared_link_spaceId_idx";
ALTER TABLE "shared_link"       DROP COLUMN IF EXISTS "spaceId";
-- Records which user drew a face box, so a space editor may delete their own and never the
-- owner's (1796000000000-AddAssetFaceCreatedBy), on databases from before asset_face_creator
-- replaced the column. Upstream has no such column; the FK to "user" goes with it.
DROP INDEX IF EXISTS "asset_face_createdBy_idx";
ALTER TABLE "asset_face"        DROP COLUMN IF EXISTS "createdBy";

-- -----------------------------------------------------------------------------
-- 5. Strip Gallery's settings out of system_metadata's system-config row and
--    out of each user's preferences.
--
-- Stock Immich warns about every unknown key in system-config on each config
-- load, until an admin next saves the settings. The list is every fork path in
-- the config DTO (server/src/gallery/dtos/config.dto.ts and its spreads in
-- server/src/dtos/config.dto.ts); revert-to-immich.spec.ts fails until a new
-- one is added here. 'classification' holds the categories that migration
-- 1778000000000 merged in from the dropped classification tables.
-- -----------------------------------------------------------------------------
UPDATE "system_metadata"
   SET "value" = "value"
     #- '{classification}'
     #- '{memories}'
     #- '{storageUsage}'
     #- '{job,peopleBackfill}'
     #- '{job,petDetection}'
     #- '{job,classification}'
     #- '{machineLearning,clip,maxDistance}'
     #- '{machineLearning,petDetection}'
     #- '{machineLearning,petRecognition}'
     #- '{machineLearning,facialRecognition,suggestions}'
     #- '{machineLearning,facialRecognition,suggestionMaxDistance}'
     #- '{nightlyTasks,clusterNewPets}'
     #- '{server,mergePeopleAcrossOwners}'
 WHERE "key" = 'system-config';

-- Gallery's per-type memory switches (memories.types), which Immich's
-- preferences do not have.
UPDATE "user_metadata"
   SET "value" = "value" #- '{memories,types}'
 WHERE "key" = 'preferences'
   AND "value" #> '{memories,types}' IS NOT NULL;

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
   'function_shared_space_album_hidden_delete_audit',
   'trigger_shared_space_album_hidden_delete_audit',
   'trigger_shared_space_album_hidden_updatedAt',
   'function_album_soft_delete_shared_space_album',
   'function_album_space_asset_delete_audit',
   'function_asset_favorite_delete_audit',
   'function_asset_favorite_after_insert',
   'function_asset_favorite_after_delete',
   'function_asset_is_favorite_after_write',
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
   'index_pet_index',
   'index_person_ownerId_identityId_key',
   'index_shared_space_person_identityId_spaceId_idx',
   'index_shared_space_person_space_name_idx',
   'index_shared_space_person_spaceId_identityId_key',
   'index_shared_space_album_folder_parentId_idx',
   'index_shared_space_album_folder_nested_name_key',
   'index_shared_space_album_folder_root_name_key',
   'function_shared_space_album_folder_delete_audit',
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
   'trigger_shared_space_album_folder_delete_audit',
   'trigger_shared_space_library_updatedAt',
   'trigger_shared_space_member_after_insert',
   'trigger_shared_space_member_after_insert_library',
   'trigger_shared_space_member_delete_audit',
   'trigger_shared_space_member_delete_library_audit',
   'trigger_shared_space_member_updatedAt',
   'trigger_shared_space_person_updatedAt',
   'trigger_shared_space_updatedAt',
   'trigger_user_group_updatedAt',
   'trigger_shared_space_album_folder_updatedAt',
   'trigger_asset_favorite_delete_audit',
   'trigger_asset_favorite_after_insert',
   'trigger_asset_favorite_after_delete',
   'trigger_asset_is_favorite_after_write'
 );

-- -----------------------------------------------------------------------------
-- 6b. Delete Gallery's own workflow plugin.
--
-- Plugins are stored IN THE DATABASE (`plugin.wasmBytes`), not just on disk, and the server loads
-- every enabled row from `getForLoad()` at boot. Current Gallery ships `gallery-core` as a no-op
-- wasm with no custom host import (its steps run in Gallery's TypeScript), so stock Immich loads it
-- but every Gallery step would do nothing. Gallery releases before that change shipped a wasm that
-- imports the fork-only `gallery` host function. A database last booted by one of those still holds
-- that wasm (the row keeps version 1.0.0 and is rewritten in place only by a newer Gallery boot), and
-- stock Immich's microservices worker then dies on startup with
--
--   cannot resolve import "extism:host/user" "gallery"
--
-- so for such a database this delete is load-bearing.
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

-- 7. Undo post-tag upstream migrations that Gallery pulled in via rebase, plus
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

-- 1782000000000-AddAssetExifDescriptionTrigramIndex added a fork-only GIN
-- trigram index on asset_exif.description (for timeline description filtering)
-- that upstream Immich does not have, plus its migration_overrides registration row.
DROP INDEX IF EXISTS "idx_asset_exif_description_trigram";
DELETE FROM "migration_overrides" WHERE "name" = 'index_idx_asset_exif_description_trigram';

-- 1797000000000-AddAssetLocalDateTimeIndex added a fork-only plain btree on
-- asset."localDateTime" for the filter panel's taken range.
DROP INDEX IF EXISTS "asset_localDateTime_range_idx";

-- jit=off: restore the PostgreSQL default so the reverted database carries no
-- Gallery-specific planner tuning. 1799400000000-ScopeJitOffToDatabase keeps the
-- setting on this database. Before it, 1783628194057-DisablePostgresJit set it on
-- the application role, which only that role can reset here; on such a database
-- this resets the role running the script, so run it as the application role.
-- ALTER DATABASE needs the database owner or a superuser. Without that privilege
-- 1799400000000 also left the setting on the role, so the role is reset instead.
DO $$
DECLARE
  database_reset boolean := true;
BEGIN
  BEGIN
    EXECUTE format('ALTER DATABASE %I RESET jit', current_database());
  EXCEPTION WHEN insufficient_privilege THEN
    database_reset := false;
    RAISE WARNING 'jit stays as set on database %: % cannot alter it', current_database(), CURRENT_USER;
  END;
  IF NOT database_reset
     OR to_regclass('public.gallery_migrations') IS NULL
     OR NOT EXISTS (SELECT FROM "gallery_migrations" WHERE "name" = '1799400000000-ScopeJitOffToDatabase')
  THEN
    EXECUTE 'ALTER ROLE CURRENT_USER RESET jit';
  END IF;
END $$;

-- No post-tag upstream migration needs reversing right now. `upstream.version` is
-- 3.3.3 and this branch's `server/src/schema/migrations/` is identical to upstream
-- v3.3.3's (same 100 files, unchanged from v3.3.0), so every upstream migration Gallery
-- carries is one the tagged release also ships. The 3.3.0 -> 3.3.1 and 3.3.1 -> 3.3.3
-- bumps removed nothing.
-- The 3.2.4 -> 3.3.0 bump removed four more entries, for the
-- same reason as below: 1789419229196-ConvertUserOAuthIdEmptyStringToNull,
-- 1790587508209-RenameGeoNamesCountries, 1790616293884-PersonSharing and
-- 1790693088454-AddPersonUserTableSharedBySharedWithConstraint. v3.3.0 needs the
-- nullable oauthId and the person_user table; recover their reversals from git history
-- if a future tag ever drops back below 3.3.0.
--
-- That direction matters: reversing a migration the tagged release DOES ship is
-- actively wrong. Its kysely_migrations row is then missing while its file is
-- present, so the tagged migrator re-runs it against a schema this script has
-- already half-reverted. So the 3.1.0 -> 3.2.0 bump REMOVED ten entries from here
-- and from step 8 rather than adding any:
--
--   1784647658615-AddOAuthBearerTokenToSession
--   1784836013770-MinFacePreferenceMigration
--   1784986754473-ConvertUserPasswordEmptyStringToNull
--   1784986754474-AlbumDescriptionNullable
--   1786385711807-AlbumOwnerDeleteTrigger
--   1786741078327-AddWorkflowLogsTable
--   1786972746371-AssetOcrUpdatedAtTrigger
--   1786972746372-AssetOcrSyncReset
--   1787148183729-ClusterGroups
--   1787148183730-DeleteMismatchedMemoryAssets
--
-- The first two were already stale BEFORE this bump — both ship in v3.1.0 as well,
-- so the group had been over-reverting since the v3.0.3 -> v3.1.0 bump, which added
-- no migrations and so was done without pruning. The coverage gate only reports
-- MISSING entries, never extra ones, which is why it stayed green. When bumping
-- `upstream.version`, run the diff in BOTH directions.
--
-- ClusterGroups was the largest removal: its reversal un-re-keyed `person` back to a
-- plain `id`, renamed `asset_face.personGroupId` to `personId`, dropped the four new
-- tables, restored the pre-ClusterGroups `person_delete_audit` function/trigger and
-- rewrote three `migration_overrides` payloads. v3.2.0 ships all of it, so none of
-- that may run. Recover it from git history if a future tag ever drops back below it.

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
   '1785000000000-CreatePetSearchTable',
   '1785200000000-AddSpeciesToPetSearch',
   '1786000000000-FaceRepairLockPersonNullable',
   '1787000000000-AddFacePersonVerdict',
   '1788000000000-ReconcileFacePersonVerdictConstraints',
   '1789000000000-AddFacePersonVerdictStatusCreatedAtIdIndex',
  '1787100000000-DropPersonFksBeforeClusterGroups',
  '1790000000000-FixFaceRepairScanInFlightIndex',
  '1791000000000-RepointFaceReviewToPersonGroup',
  '1792123120451-AddSharedLinkSpaceId',
  '1793000000000-AddSharedSpaceAlbumHidden',
  '1793100000000-AddSharedSpaceAlbumFolderTable',
  '1793200000000-SharedSpaceAlbumFolderAuditTable',
  '1793300000000-ClearPreOptionMFaceRepairScans',
  -- #763 per-user favorites. Renumbered off 1784000000000/1784100000000 during the v3.2.0 rebase:
  -- 1784000000000 was already taken by FixFaceRepairScanInFlightIndexOverride above.
  '1794000000000-AddAssetFavoriteTables',
  '1794100000000-DropAssetIsFavoriteColumn',
  '1796000000000-AddAssetFaceCreatedBy',
  '1797000000000-AddAssetLocalDateTimeIndex',
  '1798000000000-AddSharedLinkSpaceTable',
  '1798100000000-AddAssetFaceCreatorTable',
  '1798200000000-DropLibraryCreateId',
  '1798500000000-AddAssetJobStatusGalleryTable',
  '1798600000000-AddPersonIdentityTable',
  '1798700000000-AddPersonPetTable',
  '1798800000000-RestoreAssetIsFavoriteProjection',
  '1798900000000-MoveVideoTrimToSidecar',
  '1799400000000-ScopeJitOffToDatabase',
  -- Pre-rename name, recorded by builds from before the ledger split: this migration was
  -- renumbered off 1793000000000 when fork PR #1060 took that timestamp, but rolling RC instances
  -- had already recorded the pre-rename name. Drop that row too, or upstream's migrator aborts
  -- with "corrupted migrations" on a reverted rolling-derived DB.
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

   -- Pre-rename name of ChangeDurationToInteger, recorded by builds from before the
   -- ledger split. A split build renames or deletes these rows on boot; this DELETE
   -- covers databases never booted by one. The tagged upstream release ships only
   -- 1777667825574, so an orphan 1776735180298 row makes upstream's migrator abort with
   -- "corrupted migrations: previously executed migration
   -- 1776735180298-ChangeDurationToInteger is missing". The 1777667825574 row matches
   -- the upstream file, so it stays.
   '1776735180298-ChangeDurationToInteger'

   -- Post-tag upstream migrations pulled in by rebase would follow here, paired with
   -- schema rollbacks in step 7 and kept timestamp-sorted. None right now:
   -- `upstream.version` is 3.3.3 and every upstream migration this branch carries ships
   -- in that tag (see step 7).
 );

-- Gallery builds since the ledger split record fork migrations in their own table instead. The
-- DELETE above still covers databases last booted by an older build.
DROP TABLE IF EXISTS "gallery_migrations";
DROP TABLE IF EXISTS "gallery_migrations_lock";

-- -----------------------------------------------------------------------------
-- 9. Report what happened and commit.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  fork_tables_left int;
  fork_rows_left int;
  fork_triggers_left int;
BEGIN
  -- Pattern list deliberately excludes '%AddPersonNameTrigramIndex%'
  -- because upstream Immich has a migration with that same basename
  -- (1775165531374-AddPersonNameTrigramIndex). Gallery's own 1773846750001
  -- version was dropped once upstream shipped that migration, but older
  -- databases may still record it. The DELETE IN list above removes that
  -- row by exact name; this sanity check must not match the upstream row.
  SELECT count(*) INTO fork_rows_left
    FROM "kysely_migrations"
   WHERE "name" LIKE '%SharedSpace%'
      OR "name" LIKE '%StorageMigrationLog%'
      OR "name" LIKE '%PetDetection%'
      OR "name" LIKE '%PetSearch%'
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
      OR "name" LIKE '%AddFaceRepairScanInFlightIndex%'
      OR "name" LIKE '%AssetFavoriteTables%';
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
       'shared_space_album_hidden', 'shared_space_album_hidden_audit',
       'shared_space_album_asset_audit', 'shared_space_album_folder',
       'shared_space_album_folder_audit',
       'album_space_asset_audit', 'album_space_asset',
       'face_identity_face', 'face_identity', 'asset_face_creator',
       'shared_link_space',
       'shared_space', 'user_group_member', 'user_group',
       'classification_prompt_embedding', 'classification_category',
       'storage_migration_log', 'asset_duplicate_checksum',
       'face_person_verdict', 'face_repair_scan', 'face_repair_decline',
       'face_repair_scan_flagged_face', 'face_repair_lock',
       'pet_search',
       'asset_favorite_audit', 'asset_favorite',
       'asset_job_status_gallery',
       'asset_video_trim',
       'person_identity',
       'person_pet',
       'gallery_migrations', 'gallery_migrations_lock'
     );
  IF fork_tables_left > 0 THEN
    RAISE EXCEPTION 'revert-to-immich: % Gallery table(s) still present after cleanup — aborting.', fork_tables_left;
  END IF;

  SELECT count(*) INTO fork_triggers_left
    FROM pg_trigger
   WHERE tgname IN (
       'asset_library_delete_audit', 'asset_is_favorite_after_write',
       'library_after_insert', 'album_soft_delete_shared_space_album'
     );
  IF fork_triggers_left > 0 THEN
    RAISE EXCEPTION 'revert-to-immich: % Gallery trigger(s) still present on Immich tables after cleanup, aborting.', fork_triggers_left;
  END IF;
  RAISE NOTICE 'revert-to-immich: cleanup finished. Switch your image to ghcr.io/immich-app/immich-server and start the stack.';
END $$;

COMMIT;
