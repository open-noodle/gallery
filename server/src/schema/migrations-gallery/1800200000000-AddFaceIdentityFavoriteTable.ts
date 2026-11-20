import { Kysely, sql } from 'kysely';

// Per-user favorite for a face identity the user holds no person of, so a space-only person can be favorited
// (specs/2026-11-20-favorite-space-people-design.md).
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "face_identity_favorite" (
  "userId" uuid NOT NULL,
  "identityId" uuid NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "face_identity_favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "face_identity_favorite_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "face_identity" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "face_identity_favorite_pkey" PRIMARY KEY ("userId", "identityId")
);`.execute(db);
  await sql`CREATE INDEX "face_identity_favorite_identityId_idx" ON "face_identity_favorite" ("identityId");`.execute(
    db,
  );
}

// An older Gallery has no place for a favorite on a person the user does not own, so the rows have nothing to move
// back to. A favorite on an owned person already lives in person."isFavorite" and stays there.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "face_identity_favorite";`.execute(db);
}
