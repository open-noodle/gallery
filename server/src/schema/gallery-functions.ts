import { registerFunction } from '@immich/sql-tools';

// --- gallery-fork: shared-space audit trigger functions ---

export const shared_space_delete_audit = registerFunction({
  name: 'shared_space_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      -- BEFORE DELETE row-level trigger so shared_space_member rows are still
      -- visible. Emits one shared_space_audit row per (member or creator) for the
      -- deleted space. The UNION dedups the common case where the creator is also
      -- a member. The companion shared_space_member_delete_audit trigger does NOT
      -- insert into shared_space_audit during cascade, so this is the single source
      -- of truth on space deletion.
      INSERT INTO shared_space_audit ("spaceId", "userId")
      SELECT DISTINCT "spaceId", "userId" FROM (
        SELECT ssm."spaceId", ssm."userId"
        FROM shared_space_member ssm
        WHERE ssm."spaceId" = OLD."id"
        UNION
        SELECT OLD."id" AS "spaceId", OLD."createdById" AS "userId"
      ) AS targets;

      RETURN OLD;
    END`,
});

export const shared_space_member_delete_audit = registerFunction({
  name: 'shared_space_member_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      -- Always emit the join-row delete to shared_space_member_audit.
      INSERT INTO shared_space_member_audit ("spaceId", "userId")
      SELECT "spaceId", "userId" FROM "old";

      -- Emit to shared_space_audit only when the parent shared_space row still
      -- exists (i.e. this is a direct member removal, not a cascade from a
      -- shared_space delete). For cascades, the parent shared_space_delete_audit
      -- BEFORE-row trigger has already emitted the audit rows.
      INSERT INTO shared_space_audit ("spaceId", "userId")
      SELECT o."spaceId", o."userId"
      FROM "old" o
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId");

      RETURN NULL;
    END`,
});

export const shared_space_asset_delete_audit = registerFunction({
  name: 'shared_space_asset_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_asset_audit ("spaceId", "assetId")
      SELECT "spaceId", "assetId" FROM "old";
      RETURN NULL;
    END`,
});

export const shared_space_member_after_insert = registerFunction({
  name: 'shared_space_member_after_insert',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      UPDATE shared_space SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "spaceId" FROM inserted_rows);
      RETURN NULL;
    END`,
});

// --- gallery-fork: library audit trigger functions ---

// Helper: does `target_user_id` retain any access path to `target_library_id`
// ignoring the space identified by `exclude_space_id`? Used by both library
// audit triggers to avoid emitting audit rows when the user still has another
// path to the library (direct ownership, membership in another linked space,
// or creator of another linked space).
export const user_has_library_path = registerFunction({
  name: 'user_has_library_path',
  arguments: ['target_library_id uuid', 'target_user_id uuid', 'exclude_space_id uuid'],
  returnType: 'boolean',
  language: 'SQL',
  behavior: 'stable',
  body: `
    SELECT
      EXISTS (
        SELECT 1 FROM library l
        WHERE l."id" = target_library_id
          AND l."ownerId" = target_user_id
          AND l."deletedAt" IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM shared_space_library ssl2
        INNER JOIN shared_space_member ssm2 ON ssm2."spaceId" = ssl2."spaceId"
        WHERE ssl2."libraryId" = target_library_id
          AND ssm2."userId" = target_user_id
          AND ssl2."spaceId" <> exclude_space_id
      )
      OR EXISTS (
        SELECT 1
        FROM shared_space_library ssl3
        INNER JOIN shared_space ss3 ON ss3."id" = ssl3."spaceId"
        WHERE ssl3."libraryId" = target_library_id
          AND ss3."createdById" = target_user_id
          AND ssl3."spaceId" <> exclude_space_id
      );
`,
});

export const shared_space_delete_library_audit = registerFunction({
  name: 'shared_space_delete_library_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      -- BEFORE DELETE row-level trigger so shared_space_library and
      -- shared_space_member rows for this space are still visible. The companion
      -- shared_space_library_delete_audit and shared_space_member_delete_library_audit
      -- AFTER triggers skip on cascade (their EXISTS shared_space guards fail), so
      -- this BEFORE-row trigger is the single source of truth for library_audit
      -- emission on whole-space deletion.
      INSERT INTO library_audit ("libraryId", "userId")
      SELECT DISTINCT "libraryId", "userId" FROM (
        SELECT ssl."libraryId", ssm."userId"
        FROM shared_space_library ssl
        INNER JOIN shared_space_member ssm ON ssm."spaceId" = ssl."spaceId"
        WHERE ssl."spaceId" = OLD."id"
          AND NOT user_has_library_path(ssl."libraryId", ssm."userId", OLD."id")
        UNION
        SELECT ssl."libraryId", OLD."createdById"
        FROM shared_space_library ssl
        WHERE ssl."spaceId" = OLD."id"
          AND NOT user_has_library_path(ssl."libraryId", OLD."createdById", OLD."id")
      ) AS targets;

      RETURN OLD;
    END`,
});

export const shared_space_library_delete_audit = registerFunction({
  name: 'shared_space_library_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      -- 1. Always record the join-row delete so clients drop sharedSpaceLibraryEntity.
      INSERT INTO shared_space_library_audit ("spaceId", "libraryId")
      SELECT "spaceId", "libraryId" FROM "old";

      -- 2. Fan out library_audit per affected member only if no other path remains.
      --    Skips during shared_space cascade (EXISTS guard fails); the BEFORE-row
      --    shared_space_delete_library_audit trigger handles that case.
      INSERT INTO library_audit ("libraryId", "userId")
      SELECT o."libraryId", ssm."userId"
      FROM "old" o
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = o."spaceId"
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
        AND NOT user_has_library_path(o."libraryId", ssm."userId", o."spaceId");

      -- 3. Creator of the unlinked space. INNER JOIN shared_space naturally skips
      --    during shared_space cascade because the parent row is gone.
      INSERT INTO library_audit ("libraryId", "userId")
      SELECT o."libraryId", ss."createdById"
      FROM "old" o
      INNER JOIN shared_space ss ON ss."id" = o."spaceId"
      WHERE NOT user_has_library_path(o."libraryId", ss."createdById", o."spaceId");

      RETURN NULL;
    END`,
});

export const shared_space_member_delete_library_audit = registerFunction({
  name: 'shared_space_member_delete_library_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      -- Skips during shared_space cascade (EXISTS guard fails); the BEFORE-row
      -- shared_space_delete_library_audit trigger handles that case.
      INSERT INTO library_audit ("libraryId", "userId")
      SELECT ssl."libraryId", o."userId"
      FROM "old" o
      INNER JOIN shared_space_library ssl ON ssl."spaceId" = o."spaceId"
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
        AND NOT user_has_library_path(ssl."libraryId", o."userId", o."spaceId");

      RETURN NULL;
    END`,
});

export const asset_library_delete_audit = registerFunction({
  name: 'asset_library_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO library_asset_audit ("assetId", "libraryId")
      SELECT "id", "libraryId" FROM "old" WHERE "libraryId" IS NOT NULL;
      RETURN NULL;
    END`,
});

// --- gallery-fork: album_user path function ---

// Helper: does `target_user_id` retain any access path to `target_album_id`
// ignoring the space identified by `exclude_space_id`? Used by album grant
// triggers to determine whether a user still has access via another route.
// Three branches: (1) owner OR any manual album_user share, joined to a non-deleted
//   album (album has no ownerId column — ownership is an album_user role='owner' row);
// (2) membership in ANOTHER space that links the album (excluding exclude_space_id);
// (3) being the creator of ANOTHER linking space (excluding exclude_space_id).
export const user_has_album_path = registerFunction({
  name: 'user_has_album_path',
  arguments: ['target_album_id uuid', 'target_user_id uuid', 'exclude_space_id uuid'],
  returnType: 'boolean',
  language: 'SQL',
  behavior: 'stable',
  body: `
    SELECT
      EXISTS (
        SELECT 1 FROM album_user au
        INNER JOIN album a ON a."id" = au."albumId"
        WHERE au."albumId" = target_album_id
          AND au."userId" = target_user_id
          AND a."deletedAt" IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM shared_space_album ssa2
        INNER JOIN shared_space_member ssm2 ON ssm2."spaceId" = ssa2."spaceId"
        INNER JOIN album a2 ON a2."id" = ssa2."albumId"
        WHERE ssa2."albumId" = target_album_id
          AND ssm2."userId" = target_user_id
          AND ssa2."spaceId" <> exclude_space_id
          AND a2."deletedAt" IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM shared_space_album ssa3
        INNER JOIN shared_space ss3 ON ss3."id" = ssa3."spaceId"
        INNER JOIN album a3 ON a3."id" = ssa3."albumId"
        WHERE ssa3."albumId" = target_album_id
          AND ss3."createdById" = target_user_id
          AND ssa3."spaceId" <> exclude_space_id
          AND a3."deletedAt" IS NULL
      );
`,
});

// --- gallery-fork: album_user delete-side trigger functions ---
//
// Consume shared_space_album_user_audit inserts by deleting the corresponding
// shared_space_album_user rows UNCONDITIONALLY. Trusts the gating at insertion
// time — every path that inserts into shared_space_album_user_audit already
// checks NOT user_has_album_path(...), so audit rows represent "this (user,
// album) pair has definitively lost access".
export const shared_space_album_user_delete_after_audit = registerFunction({
  name: 'shared_space_album_user_delete_after_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      DELETE FROM shared_space_album_user ssau
      USING inserted_rows ir
      WHERE ssau."userId" = ir."userId"
        AND ssau."albumId" = ir."albumId";
      RETURN NULL;
    END`,
});

// Fan-out trigger: on unlinking an album from a space (direct or via cascade
// from album/shared_space deletion) emits rows to shared_space_album_audit
// (the join-row delete, ungated) and shared_space_album_user_audit
// (per user who loses access, gated). Mirrors shared_space_library_delete_audit.
export const shared_space_album_delete_audit = registerFunction({
  name: 'shared_space_album_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      -- 1. Always record the (space, album) link delete (ungated) so clients drop the space-album.
      INSERT INTO shared_space_album_audit ("spaceId", "albumId")
      SELECT "spaceId", "albumId" FROM "old";

      -- 2. Gated grant revocation per member; skips during shared_space cascade (BEFORE-row handles it).
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT o."albumId", ssm."userId"
      FROM "old" o
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = o."spaceId"
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
        AND NOT user_has_album_path(o."albumId", ssm."userId", o."spaceId");

      -- 3. Gated grant revocation for the space creator.
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT o."albumId", ss."createdById"
      FROM "old" o
      INNER JOIN shared_space ss ON ss."id" = o."spaceId"
      WHERE NOT user_has_album_path(o."albumId", ss."createdById", o."spaceId");

      RETURN NULL;
    END`,
});

// gallery-fork: unhiding an album is a row DELETE on shared_space_album_hidden, so record it
// for the per-user delete sync stream. Ungated and unconditional — the row's disappearance is
// the whole event, and every cascade path (unlink, space delete, album delete, user delete)
// should reach a synced client identically.
export const shared_space_album_hidden_delete_audit = registerFunction({
  name: 'shared_space_album_hidden_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_album_hidden_audit ("spaceId", "albumId", "userId")
      SELECT "spaceId", "albumId", "userId" FROM "old";
      RETURN NULL;
    END`,
});

// Fan-out trigger: on folder delete (direct, or via cascade from shared_space) emits a tombstone
// row so synced clients drop the folder. Simpler than shared_space_album_delete_audit — folders
// carry no per-member grants, so this only inserts the tombstone row.
export const shared_space_album_folder_delete_audit = registerFunction({
  name: 'shared_space_album_folder_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_album_folder_audit ("spaceId", "folderId")
      SELECT "spaceId", "id" FROM "old";
      RETURN NULL;
    END
  `,
});

// Fan-out trigger: on member removal, revoke album grants for all albums linked
// to that space, gated. Skips during shared_space cascade (EXISTS guard fails).
// Mirrors shared_space_member_delete_library_audit.
export const shared_space_member_delete_album_audit = registerFunction({
  name: 'shared_space_member_delete_album_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT ssa."albumId", o."userId"
      FROM "old" o
      INNER JOIN shared_space_album ssa ON ssa."spaceId" = o."spaceId"
      WHERE EXISTS (SELECT 1 FROM shared_space ss WHERE ss.id = o."spaceId")
        AND NOT user_has_album_path(ssa."albumId", o."userId", o."spaceId");
      RETURN NULL;
    END`,
});

// BEFORE DELETE row-level trigger on shared_space so shared_space_album and
// shared_space_member rows are still visible when fanning out grant revocations.
// The companion AFTER triggers on shared_space_album and shared_space_member
// skip during this cascade via EXISTS shared_space guards.
// Mirrors shared_space_delete_library_audit.
export const shared_space_delete_album_audit = registerFunction({
  name: 'shared_space_delete_album_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT DISTINCT "albumId", "userId" FROM (
        SELECT ssa."albumId", ssm."userId"
        FROM shared_space_album ssa
        INNER JOIN shared_space_member ssm ON ssm."spaceId" = ssa."spaceId"
        WHERE ssa."spaceId" = OLD."id"
          AND NOT user_has_album_path(ssa."albumId", ssm."userId", OLD."id")
        UNION
        SELECT ssa."albumId", OLD."createdById"
        FROM shared_space_album ssa
        WHERE ssa."spaceId" = OLD."id"
          AND NOT user_has_album_path(ssa."albumId", OLD."createdById", OLD."id")
      ) AS targets;
      RETURN OLD;
    END`,
});

// --- gallery-fork: album_user create-side trigger functions ---
//
// When an album is linked to a space (shared_space_album INSERT), grant
// shared_space_album_user for every current member of that space and bump
// album.updateId so AlbumSync re-delivers the metadata row.
export const shared_space_album_after_insert_user = registerFunction({
  name: 'shared_space_album_after_insert_user',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ssm."userId", ir."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ir."spaceId"
      ON CONFLICT ("userId", "albumId")
      DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now();

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "albumId" FROM inserted_rows);
      RETURN NULL;
    END`,
});

// When a user joins a space (shared_space_member INSERT), grant
// shared_space_album_user for every album already linked to that space and
// bump album.updateId so AlbumSync re-delivers those album metadata rows.
//
// Refresh createId on conflict (#752 launch review F-A, migration 1783700000000): a re-added
// member whose grant SURVIVED removal (album_user access or a second co-linking space) kept the
// original createId, so the grant-keyed per-album backfill never re-fired and contributions made
// during the absence were permanently undeliverable to that member's devices. Mirror of
// shared_space_album_after_insert_user above. Keep byte-identical to that migration's DDL —
// migration-override-parity.spec.ts pins it.
export const shared_space_member_after_insert_album = registerFunction({
  name: 'shared_space_member_after_insert_album',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ir."userId", ssa."albumId"
      FROM inserted_rows ir
      INNER JOIN shared_space_album ssa ON ssa."spaceId" = ir."spaceId"
      ON CONFLICT ("userId", "albumId")
      DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now();

      UPDATE album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (
        SELECT DISTINCT ssa."albumId"
        FROM inserted_rows ir
        INNER JOIN shared_space_album ssa ON ssa."spaceId" = ir."spaceId"
      );
      RETURN NULL;
    END`,
});

// --- gallery-fork: album soft-delete/restore → shared_space_album lifecycle ---
//
// One AFTER UPDATE statement trigger on album. Guarded (in-body) to real
// deletedAt NULL<->NOT-NULL transitions so it ignores the frequent non-deletedAt
// album updates (renames, updateId bumps from the create-side grant triggers) and
// the re-stamp softDeleteAll does on already-trashed albums.
//
// SOFT-DELETE (live -> trashed): tombstone every shared_space_album_user grant
// (SharedSpaceAlbumSync.getDeletes drops the album + assets on members' devices;
// the existing shared_space_album_user_delete_after_audit consumer deletes the
// grant rows) and every space->album link (SharedSpaceAlbumLinkSync.getDeletes
// drops the shelf link row). A soft-deleted album is universally inaccessible
// (user_has_album_path is FALSE for everyone once deletedAt is set), so revoking
// ALL grants ungated is correct.
//
// RESTORE (trashed -> live): re-create the grant for every member of every space
// still linking the album, with a FRESH createId. ON CONFLICT DO UPDATE bumps the
// createId of any grant that survived (e.g. a member who joined during the window),
// so getCreatedAfter re-delivers past a stale checkpoint (closes albums-2 + albums-3).
// Then bump shared_space_album.updateId so SharedSpaceAlbumLinkSync.getUpserts
// re-delivers the link row (its deletedAt filter passes again after restore).
//
// NOTE: declared as plain AFTER UPDATE (not AFTER UPDATE OF "deletedAt") because
// the sql-tools decorator/override toolchain cannot express a column-restricted
// update trigger; the in-body guard makes the column restriction non-load-bearing.
export const album_soft_delete_shared_space_album = registerFunction({
  name: 'album_soft_delete_shared_space_album',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE (o."deletedAt" IS NULL) <> (n."deletedAt" IS NULL)
      ) THEN
        RETURN NULL;
      END IF;

      -- soft-delete: revoke all grants for the trashed albums
      INSERT INTO shared_space_album_user_audit ("albumId", "userId")
      SELECT ssau."albumId", ssau."userId"
      FROM shared_space_album_user ssau
      WHERE ssau."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NULL AND n."deletedAt" IS NOT NULL
      );

      -- soft-delete: tombstone all space->album links for the trashed albums
      INSERT INTO shared_space_album_audit ("spaceId", "albumId")
      SELECT ssa."spaceId", ssa."albumId"
      FROM shared_space_album ssa
      WHERE ssa."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NULL AND n."deletedAt" IS NOT NULL
      );

      -- restore: re-create grants for members of every space still linking each album
      INSERT INTO shared_space_album_user ("userId", "albumId")
      SELECT DISTINCT ssm."userId", ssa."albumId"
      FROM shared_space_album ssa
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ssa."spaceId"
      WHERE ssa."albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NOT NULL AND n."deletedAt" IS NULL
      )
      ON CONFLICT ("userId", "albumId")
      DO UPDATE SET "createId" = immich_uuid_v7(), "createdAt" = now();

      -- restore: bump shared_space_album.updateId so the link row re-delivers
      UPDATE shared_space_album
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "albumId" IN (
        SELECT n."id" FROM new_rows n
        INNER JOIN old_rows o ON o."id" = n."id"
        WHERE o."deletedAt" IS NOT NULL AND n."deletedAt" IS NULL
      );

      RETURN NULL;
    END`,
});

// --- gallery-fork: album_space_asset delete-audit (#764) ---
//
// Tombstones every deleted cross-owner contribution — explicit removal
// (AlbumService.removeAssets) AND every FK cascade (asset/album/space delete) — driving
// SharedSpaceAlbumToAssetSync's delete stream. Statement-level AFTER DELETE so cascades are
// captured too; see AlbumSpaceAssetAuditTable.
//
// Created by migration 1783100000000; registered here so `migrations:generate` / schema-check
// see a declarative counterpart. Keep byte-identical to that migration's DDL —
// migration-override-parity.spec.ts pins it.
export const album_space_asset_delete_audit = registerFunction({
  name: 'album_space_asset_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO album_space_asset_audit ("albumId", "assetId")
      SELECT "albumId", "assetId" FROM "old";
      RETURN NULL;
    END`,
});

// --- gallery-fork: asset_favorite delete-audit (#763) ---
//
// Tombstones every deleted per-user favorite — explicit unfavorite AND every FK cascade (asset
// delete, user delete) — driving the favorite delete sync stream. Statement-level AFTER DELETE so
// cascades are captured too; see AssetFavoriteAuditTable.
//
// Created by migration 1794000000000; registered here so `migrations:generate` / schema-check see a
// declarative counterpart, exactly like album_space_asset_delete_audit above. Without this the
// function and both migration_overrides rows exist only in the database and every instance boots
// with `Detected schema drift` (the class of bug #827 fixed). Keep byte-identical to that
// migration's DDL — migration-override-parity.spec.ts pins it.
export const asset_favorite_delete_audit = registerFunction({
  name: 'asset_favorite_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO asset_favorite_audit ("userId", "assetId")
      SELECT "userId", "assetId" FROM "old";
      RETURN NULL;
    END`,
});

// --- gallery-fork: asset."isFavorite" as the owner's projection of asset_favorite ---
//
// asset_favorite holds every user's favorites; asset."isFavorite" mirrors the owner's row so a stock
// Immich server on this database sees owner favorites. The forward pair copies overlay changes onto
// the column, the reverse trigger copies column writes (a stock server) back into the overlay. All of
// them fire only for statements run at depth 0, so neither direction echoes the other; nothing else writes
// asset_favorite from inside a trigger, and a cascade from deleting an asset or user leaves nothing to project.
// The reverse trigger tests OLD/NEW in its body, not in WHEN: sql-tools reads trigger conditions with
// pg_get_expr, which fails on OLD/NEW references, and that would break every schema drift check. OLD is
// NULL on INSERT, so its fields read as NULL there.
export const asset_favorite_after_insert = registerFunction({
  name: 'asset_favorite_after_insert',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      UPDATE asset SET "isFavorite" = true
      FROM inserted_rows
      WHERE asset.id = inserted_rows."assetId"
        AND asset."ownerId" = inserted_rows."userId"
        AND NOT asset."isFavorite";
      RETURN NULL;
    END`,
});

export const asset_favorite_after_delete = registerFunction({
  name: 'asset_favorite_after_delete',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      UPDATE asset SET "isFavorite" = false
      FROM deleted_rows
      WHERE asset.id = deleted_rows."assetId"
        AND asset."ownerId" = deleted_rows."userId"
        AND asset."isFavorite";
      RETURN NULL;
    END`,
});

export const asset_is_favorite_after_write = registerFunction({
  name: 'asset_is_favorite_after_write',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      IF NEW."isFavorite" AND OLD."isFavorite" IS NOT TRUE THEN
        INSERT INTO asset_favorite ("userId", "assetId") VALUES (NEW."ownerId", NEW.id) ON CONFLICT DO NOTHING;
      ELSIF OLD."isFavorite" AND NOT NEW."isFavorite" THEN
        DELETE FROM asset_favorite WHERE "userId" = NEW."ownerId" AND "assetId" = NEW.id;
      END IF;
      RETURN NULL;
    END`,
});

// --- gallery-fork: library_user create-side trigger functions ---
//
// See specs/2026-04-11-library-user-access-backfill-design.md for the
// full design. Summary: library_user is a (userId, libraryId) access-grant
// denormalization; three insert triggers populate it, and one consumer
// trigger (below) drains it when library_audit rows are emitted.

// Populate library_user for the library owner when a library is created.
// createId takes the column default (immich_uuid_v7()), minted in the same
// statement as the library row, so it is past every existing sync checkpoint
// just as the dropped library.createId was (1798200000000-DropLibraryCreateId).
export const library_after_insert = registerFunction({
  name: 'library_after_insert',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO library_user ("userId", "libraryId", "createdAt")
      SELECT "ownerId", "id", "createdAt"
      FROM inserted_rows
      WHERE "ownerId" IS NOT NULL AND "deletedAt" IS NULL
      ON CONFLICT DO NOTHING;
      RETURN NULL;
    END`,
});

// When a user joins a space, grant access to every library currently linked
// to that space. Also bump library.updateId so LibrarySync.getUpserts
// re-delivers the library metadata row on the new member's next sync.
export const shared_space_member_after_insert_library = registerFunction({
  name: 'shared_space_member_after_insert_library',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO library_user ("userId", "libraryId")
      SELECT DISTINCT ir."userId", ssl."libraryId"
      FROM inserted_rows ir
      INNER JOIN shared_space_library ssl ON ssl."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

      UPDATE library
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (
        SELECT DISTINCT ssl."libraryId"
        FROM inserted_rows ir
        INNER JOIN shared_space_library ssl ON ssl."spaceId" = ir."spaceId"
      );
      RETURN NULL;
    END`,
});

// When a library is linked to a space, grant library_user for every current
// member of that space and bump library.updateId so the metadata re-emits.
export const shared_space_library_after_insert_user = registerFunction({
  name: 'shared_space_library_after_insert_user',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO library_user ("userId", "libraryId")
      SELECT DISTINCT ssm."userId", ir."libraryId"
      FROM inserted_rows ir
      INNER JOIN shared_space_member ssm ON ssm."spaceId" = ir."spaceId"
      ON CONFLICT DO NOTHING;

      UPDATE library
      SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "libraryId" FROM inserted_rows);
      RETURN NULL;
    END`,
});

// Consume library_audit inserts by deleting the corresponding library_user
// rows UNCONDITIONALLY. Trusts the gating at insertion time — every path
// that inserts into library_audit already checks
// `NOT user_has_library_path(..., excludeSpaceId)`, so audit rows represent
// "this (user, library) pair has definitively lost access".
//
// IMPORTANT: any future path inserting into library_audit MUST gate
// beforehand. See design doc "Trust boundary" and the
// library_user_delete_after_audit test in library-user-triggers.spec.ts.
//
// Why we don't re-check here: `user_has_library_path(lib, user, NULL)`
// during a shared_space hard-delete returns TRUE because the BEFORE DELETE
// trigger fires BEFORE FK cascades remove shared_space_library /
// shared_space_member — the still-alive path would spuriously preserve
// rows that should have been cleaned up.
export const library_user_delete_after_audit = registerFunction({
  name: 'library_user_delete_after_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      DELETE FROM library_user lu
      USING inserted_rows ir
      WHERE lu."userId" = ir."userId"
        AND lu."libraryId" = ir."libraryId";
      RETURN NULL;
    END`,
});
