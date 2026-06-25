import { Kysely, sql } from 'kysely';

// Backfill shared_space_album_user for albums linked under Phase 1 (before the create-side triggers
// in 1779100000000 existed). Idempotent. Mirrors the library_user Pass-2 backfill
// (1778300000000-AddLibraryUserTable.ts). Grants every (member, linked-album) pair and bumps the
// album updateId so AlbumSync re-delivers metadata to newly-granted members.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    INSERT INTO shared_space_album_user ("userId", "albumId")
    SELECT DISTINCT ssm."userId", ssa."albumId"
    FROM shared_space_album ssa
    INNER JOIN shared_space_member ssm ON ssa."spaceId" = ssm."spaceId"
    ON CONFLICT DO NOTHING;`.execute(db);

  await sql`
    UPDATE album
    SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
    WHERE "id" IN (SELECT DISTINCT "albumId" FROM shared_space_album);`.execute(db);
}

// Data-only backfill — nothing structural to revert; grants are reconciled by triggers/audit.
export async function down(): Promise<void> {}
