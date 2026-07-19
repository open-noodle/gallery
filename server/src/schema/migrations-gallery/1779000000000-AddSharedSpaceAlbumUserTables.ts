import { Kysely, sql } from 'kysely';

// Phase 2A slice A1: bare tables only (no triggers/functions — those land in
// A2/A3, where migration_overrides are added). Mirrors the library_user blueprint
// (1778300000000) and the audit tables (1778200000000).

export async function up(db: Kysely<any>): Promise<void> {
  // Grant table (FK-cascade), mirrors library_user.
  await sql`
    CREATE TABLE "shared_space_album_user" (
      "userId"   uuid NOT NULL REFERENCES "user"(id) ON UPDATE CASCADE ON DELETE CASCADE,
      "albumId"  uuid NOT NULL REFERENCES "album"(id) ON UPDATE CASCADE ON DELETE CASCADE,
      "createId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "shared_space_album_user_pkey" PRIMARY KEY ("userId", "albumId")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_album_user_userId_createId_idx" ON "shared_space_album_user" ("userId", "createId");`.execute(
    db,
  );

  // Link-removal audit (FK-less append log), mirrors shared_space_library_audit.
  await sql`
    CREATE TABLE "shared_space_album_audit" (
      "id"        uuid NOT NULL DEFAULT immich_uuid_v7(),
      "spaceId"   uuid NOT NULL,
      "albumId"   uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_album_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_album_audit_spaceId_idx" ON "shared_space_album_audit" ("spaceId");`.execute(db);
  await sql`CREATE INDEX "shared_space_album_audit_albumId_idx" ON "shared_space_album_audit" ("albumId");`.execute(db);
  await sql`CREATE INDEX "shared_space_album_audit_deletedAt_idx" ON "shared_space_album_audit" ("deletedAt");`.execute(
    db,
  );

  // Grant-revocation audit (FK-less append log), mirrors library_audit.
  await sql`
    CREATE TABLE "shared_space_album_user_audit" (
      "id"        uuid NOT NULL DEFAULT immich_uuid_v7(),
      "albumId"   uuid NOT NULL,
      "userId"    uuid NOT NULL,
      "deletedAt" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "shared_space_album_user_audit_pkey" PRIMARY KEY ("id")
    );
  `.execute(db);
  await sql`CREATE INDEX "shared_space_album_user_audit_albumId_idx" ON "shared_space_album_user_audit" ("albumId");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_user_audit_userId_idx" ON "shared_space_album_user_audit" ("userId");`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_user_audit_deletedAt_idx" ON "shared_space_album_user_audit" ("deletedAt");`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "shared_space_album_user_audit";`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_space_album_audit";`.execute(db);
  await sql`DROP INDEX IF EXISTS "shared_space_album_user_userId_createId_idx";`.execute(db);
  await sql`DROP TABLE IF EXISTS "shared_space_album_user";`.execute(db);
}
