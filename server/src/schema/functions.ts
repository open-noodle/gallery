import { registerFunction } from '@immich/sql-tools';

export const immich_uuid_v7 = registerFunction({
  name: 'immich_uuid_v7',
  arguments: ['p_timestamp timestamp with time zone default clock_timestamp()'],
  returnType: 'uuid',
  language: 'SQL',
  behavior: 'volatile',
  body: `
    SELECT encode(
      set_bit(
        set_bit(
          overlay(uuid_send(gen_random_uuid())
                  placing substring(int8send(floor(extract(epoch from p_timestamp) * 1000)::bigint) from 3)
                  from 1 for 6
          ),
          52, 1
        ),
        53, 1
      ),
      'hex')::uuid;
`,
});

export const album_user_after_insert = registerFunction({
  name: 'album_user_after_insert',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      UPDATE album SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
      WHERE "id" IN (SELECT DISTINCT "albumId" FROM inserted_rows);
      RETURN NULL;
    END`,
});

export const updated_at = registerFunction({
  name: 'updated_at',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    DECLARE
        clock_timestamp TIMESTAMP := clock_timestamp();
    BEGIN
        new."updatedAt" = clock_timestamp;
        new."updateId" = immich_uuid_v7(clock_timestamp);
        return new;
    END;`,
});

export const f_concat_ws = registerFunction({
  name: 'f_concat_ws',
  arguments: ['text', 'text[]'],
  returnType: 'text',
  language: 'SQL',
  parallel: 'safe',
  behavior: 'immutable',
  body: `SELECT array_to_string($2, $1)`,
});

export const f_unaccent = registerFunction({
  name: 'f_unaccent',
  arguments: ['text'],
  returnType: 'text',
  language: 'SQL',
  parallel: 'safe',
  strict: true,
  behavior: 'immutable',
  return: `unaccent('unaccent', $1)`,
});

export const ll_to_earth_public = registerFunction({
  name: 'll_to_earth_public',
  arguments: ['latitude double precision', 'longitude double precision'],
  returnType: 'public.earth',
  language: 'SQL',
  parallel: 'safe',
  strict: true,
  behavior: 'immutable',
  body: `SELECT public.cube(public.cube(public.cube(public.earth()*cos(radians(latitude))*cos(radians(longitude))),public.earth()*cos(radians(latitude))*sin(radians(longitude))),public.earth()*sin(radians(latitude)))::public.earth`,
});

export const user_delete_audit = registerFunction({
  name: 'user_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO user_audit ("userId")
      SELECT "id"
      FROM OLD;
      RETURN NULL;
    END`,
});

export const partner_delete_audit = registerFunction({
  name: 'partner_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO partner_audit ("sharedById", "sharedWithId")
      SELECT "sharedById", "sharedWithId"
      FROM OLD;
      RETURN NULL;
    END`,
});

export const asset_delete_audit = registerFunction({
  name: 'asset_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO asset_audit ("assetId", "ownerId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END`,
});

export const album_delete_audit = registerFunction({
  name: 'album_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO album_audit ("albumId", "userId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END`,
});

export const album_asset_delete_audit = registerFunction({
  name: 'album_asset_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO album_asset_audit ("albumId", "assetId")
      SELECT "albumId", "assetId" FROM OLD
      WHERE "albumId" IN (SELECT "id" FROM album WHERE "id" IN (SELECT "albumId" FROM OLD));
      RETURN NULL;
    END`,
});

export const album_user_delete_audit = registerFunction({
  name: 'album_user_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO album_audit ("albumId", "userId")
      SELECT "albumId", "userId"
      FROM OLD;

      IF pg_trigger_depth() = 1 THEN
        INSERT INTO album_user_audit ("albumId", "userId")
        SELECT "albumId", "userId"
        FROM OLD;
      END IF;

      RETURN NULL;
    END`,
});

export const memory_delete_audit = registerFunction({
  name: 'memory_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO memory_audit ("memoryId", "userId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END`,
});

export const memory_asset_delete_audit = registerFunction({
  name: 'memory_asset_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO memory_asset_audit ("memoryId", "assetId")
      SELECT "memoriesId", "assetId" FROM OLD
      WHERE "memoriesId" IN (SELECT "id" FROM memory WHERE "id" IN (SELECT "memoriesId" FROM OLD));
      RETURN NULL;
    END`,
});

export const stack_delete_audit = registerFunction({
  name: 'stack_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO stack_audit ("stackId", "userId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END`,
});

export const person_delete_audit = registerFunction({
  name: 'person_delete_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO person_audit ("personId", "ownerId")
      SELECT "id", "ownerId"
      FROM OLD;
      RETURN NULL;
    END`,
});

export const user_metadata_audit = registerFunction({
  name: 'user_metadata_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO user_metadata_audit ("userId", "key")
      SELECT "userId", "key"
      FROM OLD;
      RETURN NULL;
    END`,
});

export const asset_metadata_audit = registerFunction({
  name: 'asset_metadata_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO asset_metadata_audit ("assetId", "key")
      SELECT "assetId", "key"
      FROM OLD;
      RETURN NULL;
    END`,
});

export const asset_face_audit = registerFunction({
  name: 'asset_face_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO asset_face_audit ("assetFaceId", "assetId")
      SELECT "id", "assetId"
      FROM OLD;
      RETURN NULL;
    END`,
});

export const asset_edit_insert = registerFunction({
  name: 'asset_edit_insert',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      UPDATE asset
      SET "isEdited" = true
      FROM inserted_edit
      WHERE asset.id = inserted_edit."assetId" AND NOT asset."isEdited";
      RETURN NULL;
    END
  `,
});

export const asset_edit_delete = registerFunction({
  name: 'asset_edit_delete',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      UPDATE asset
      SET "isEdited" = false
      FROM deleted_edit
      WHERE asset.id = deleted_edit."assetId" AND asset."isEdited"
        AND NOT EXISTS (SELECT FROM asset_edit edit WHERE edit."assetId" = asset.id);
      RETURN NULL;
    END
  `,
});

export const asset_edit_audit = registerFunction({
  name: 'asset_edit_audit',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO asset_edit_audit ("editId", "assetId")
      SELECT "id", "assetId"
      FROM OLD;
      RETURN NULL;
    END`,
});

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

// --- gallery-fork: library_user create-side trigger functions ---
//
// See docs/plans/2026-04-11-library-user-access-backfill-design.md for the
// full design. Summary: library_user is a (userId, libraryId) access-grant
// denormalization; three insert triggers populate it, and one consumer
// trigger (below) drains it when library_audit rows are emitted.

// Populate library_user for the library owner when a library is created.
// Explicitly propagates library.createId and library.createdAt rather than
// letting the defaults generate fresh values — owner rows must share the
// library's own createId so existing clients' sync checkpoints (which are
// already past library.createId) don't retrigger a completed backfill.
export const library_after_insert = registerFunction({
  name: 'library_after_insert',
  returnType: 'TRIGGER',
  language: 'PLPGSQL',
  body: `
    BEGIN
      INSERT INTO library_user ("userId", "libraryId", "createId", "createdAt")
      SELECT "ownerId", "id", "createId", "createdAt"
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
