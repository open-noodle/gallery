import { Kysely, sql, Transaction } from 'kysely';
import { DB } from 'src/schema';

/**
 * Re-key negative/keep-here verdicts from merged-away source identities onto the surviving identity.
 * `(identityId, assetFaceId)` is non-unique, so a straight update cannot violate a constraint. Must run
 * BEFORE the source identities are deleted so the verdict never dangles.
 */
export async function rekeyVerdictIdentity(
  db: Kysely<DB> | Transaction<DB>,
  sourceIdentityIds: string[],
  targetIdentityId: string,
): Promise<void> {
  if (sourceIdentityIds.length === 0) {
    return;
  }
  await db
    .updateTable('face_person_verdict')
    .set({ identityId: targetIdentityId })
    .where('identityId', 'in', sourceIdentityIds)
    .execute();
}

/**
 * Survivor-wins re-target of a personal verdict onto the merge survivor. `(personId, assetFaceId)` is
 * unique-partial, so first drop source rows that would collide with an existing survivor row, then move
 * the rest. Must run BEFORE the source person is deleted (its FK is SET NULL, so a delete would orphan
 * the verdict rather than move it).
 */
export async function retargetVerdictPersonId(
  db: Kysely<DB> | Transaction<DB>,
  sourcePersonId: string,
  targetPersonId: string,
): Promise<void> {
  // Strength wins, not side. A durable human negative outranks a machine suggestion: when the
  // survivor holds only a `pending` row for this face and the source holds a `rejected`/`ignored`
  // one, the merge must keep the human's answer. The collision delete below is status-blind, so
  // without this a merge of two profiles of the same human re-proposes a face the user already
  // rejected (spec §4, finding F11).
  await db
    .updateTable('face_person_verdict as survivor')
    .set({
      status: sql`src."status"`,
      source: sql`src."source"`,
      actorId: sql`src."actorId"`,
      identityId: sql`coalesce(survivor."identityId", src."identityId")`,
      distance: null,
      updatedAt: sql`now()`,
    })
    .from('face_person_verdict as src')
    .whereRef('src.assetFaceId', '=', 'survivor.assetFaceId')
    .where('survivor.personId', '=', targetPersonId)
    .where('survivor.status', '=', 'pending')
    .where('src.personId', '=', sourcePersonId)
    .where('src.status', 'in', ['rejected', 'ignored'])
    .execute();

  await db
    .deleteFrom('face_person_verdict')
    .where('personId', '=', sourcePersonId)
    .where('assetFaceId', 'in', (eb) =>
      eb
        .selectFrom('face_person_verdict as survivor')
        .select('survivor.assetFaceId')
        .where('survivor.personId', '=', targetPersonId),
    )
    .execute();
  await db
    .updateTable('face_person_verdict')
    .set({ personId: targetPersonId })
    .where('personId', '=', sourcePersonId)
    .execute();
}

/** Space twin of {@link retargetVerdictPersonId}. */
export async function retargetVerdictSpacePersonId(
  db: Kysely<DB> | Transaction<DB>,
  sourceSpacePersonId: string,
  targetSpacePersonId: string,
): Promise<void> {
  // Strength wins, not side — see the identical comment in retargetVerdictPersonId above.
  await db
    .updateTable('face_person_verdict as survivor')
    .set({
      status: sql`src."status"`,
      source: sql`src."source"`,
      actorId: sql`src."actorId"`,
      identityId: sql`coalesce(survivor."identityId", src."identityId")`,
      distance: null,
      updatedAt: sql`now()`,
    })
    .from('face_person_verdict as src')
    .whereRef('src.assetFaceId', '=', 'survivor.assetFaceId')
    .where('survivor.spacePersonId', '=', targetSpacePersonId)
    .where('survivor.status', '=', 'pending')
    .where('src.spacePersonId', '=', sourceSpacePersonId)
    .where('src.status', 'in', ['rejected', 'ignored'])
    .execute();

  await db
    .deleteFrom('face_person_verdict')
    .where('spacePersonId', '=', sourceSpacePersonId)
    .where('assetFaceId', 'in', (eb) =>
      eb
        .selectFrom('face_person_verdict as survivor')
        .select('survivor.assetFaceId')
        .where('survivor.spacePersonId', '=', targetSpacePersonId),
    )
    .execute();
  await db
    .updateTable('face_person_verdict')
    .set({ spacePersonId: targetSpacePersonId })
    .where('spacePersonId', '=', sourceSpacePersonId)
    .execute();
}
