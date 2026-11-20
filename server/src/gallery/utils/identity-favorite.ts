import { Kysely, Transaction, sql, type Expression } from 'kysely';
import { DB } from 'src/schema/index.js';

// A favorite on a face identity has two homes (specs/2026-11-20-favorite-space-people-design.md): person."isFavorite"
// when the user owns a person linked to the identity, face_identity_favorite when they do not. The owned person wins,
// so the two never both say something about one identity.

/** The user's favorite for an identity: their linked person's flag when they own one, else their fallback row. */
export const identityFavorite = (userId: string, identityId: Expression<string | null>) =>
  sql<boolean>`COALESCE(
    (SELECT "fav_person"."isFavorite"
       FROM "person_identity" AS "fav_link"
       INNER JOIN "person" AS "fav_person" ON "fav_person"."personGroupId" = "fav_link"."personGroupId"
      WHERE "fav_link"."identityId" = ${identityId} AND "fav_person"."ownerId" = ${userId}),
    EXISTS (SELECT FROM "face_identity_favorite" AS "fav_row"
             WHERE "fav_row"."userId" = ${userId} AND "fav_row"."identityId" = ${identityId}))`;

/**
Drops the fallback rows of users who now own a person for the identity, and carries each one over to that person.
Run wherever a person gets linked to an identity, so the identity never has a favorite in both places.
*/
export const reconcileIdentityFavorites = async (db: Kysely<DB> | Transaction<DB>, identityIds: string[]) => {
  if (identityIds.length === 0) {
    return;
  }

  await sql`
    WITH "absorbed" AS (
      DELETE FROM "face_identity_favorite" AS "fav"
       WHERE "fav"."identityId" = ANY(${identityIds}::uuid[])
         AND EXISTS (
           SELECT FROM "person_identity" AS "link"
             INNER JOIN "person" ON "person"."personGroupId" = "link"."personGroupId"
            WHERE "link"."identityId" = "fav"."identityId" AND "person"."ownerId" = "fav"."userId")
      RETURNING "fav"."userId", "fav"."identityId"
    )
    UPDATE "person" SET "isFavorite" = true
      FROM "absorbed", "person_identity" AS "link"
     WHERE "link"."identityId" = "absorbed"."identityId"
       AND "person"."personGroupId" = "link"."personGroupId"
       AND "person"."ownerId" = "absorbed"."userId"
       AND NOT "person"."isFavorite"
  `.execute(db);
};

/** Moves the fallback rows of merged-away identities onto the surviving one; the user keeps one row at most. */
export const moveIdentityFavorites = async (
  db: Kysely<DB> | Transaction<DB>,
  sourceIdentityIds: string[],
  targetIdentityId: string,
) => {
  const sources = sourceIdentityIds.filter((id) => id !== targetIdentityId);
  if (sources.length === 0) {
    return;
  }

  await sql`
    INSERT INTO "face_identity_favorite" ("userId", "identityId")
    SELECT DISTINCT "userId", ${targetIdentityId}::uuid FROM "face_identity_favorite"
     WHERE "identityId" = ANY(${sources}::uuid[])
    ON CONFLICT DO NOTHING
  `.execute(db);
  await db.deleteFrom('face_identity_favorite').where('identityId', 'in', sources).execute();
  await reconcileIdentityFavorites(db, [targetIdentityId]);
};
