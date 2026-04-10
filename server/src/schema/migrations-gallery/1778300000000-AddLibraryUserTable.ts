import { Kysely, sql } from 'kysely';

// Adds the create-side mirror of library_audit: a denormalized (userId, libraryId)
// access-grant table with a per-user createId. Drives LibrarySync.getCreatedAfter
// so users who gain access to pre-existing libraries via shared-space links
// correctly receive the library metadata and its asset backfill on next sync.
//
// See docs/plans/2026-04-11-library-user-access-backfill-design.md for the full
// design, trade-offs, and rationale.

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "library_user" (
      "userId"    uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "libraryId" uuid NOT NULL REFERENCES "library"(id) ON DELETE CASCADE,
      "createId"  uuid NOT NULL DEFAULT immich_uuid_v7(),
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "library_user_pkey" PRIMARY KEY ("userId", "libraryId")
    );
  `.execute(db);

  // Hot-path index: LibrarySync.getCreatedAfter filters by userId then createId,
  // so a composite leading with userId lets the planner seek directly to the
  // user's slice and walk sorted. PK (userId, libraryId) doesn't serve this
  // query because it's ordered on the wrong column.
  await sql`CREATE INDEX "library_user_userId_createId_idx" ON "library_user" ("userId", "createId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "library_user_userId_createId_idx";`.execute(db);
  await sql`DROP TABLE IF EXISTS "library_user";`.execute(db);
}
