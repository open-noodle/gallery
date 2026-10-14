import { Kysely, Transaction, sql } from 'kysely';
import { DB } from 'src/schema/index.js';

// person.identityId, person.type and person.species live in the fork sidecars person_identity and
// person_pet (keyed by personGroupId; option M keeps one person per group). These expressions read
// them back for a person row under `alias`, so the Person shape seen by services and DTOs is
// unchanged.
const groupRef = (alias: string) => sql.ref(`${alias}.personGroupId`);

export const personIdentityId = (alias = 'person') =>
  sql<
    string | null
  >`(SELECT "person_identity"."identityId" FROM "person_identity" WHERE "person_identity"."personGroupId" = ${groupRef(alias)})`;

/** A person is a pet exactly when its group has a person_pet row. */
export const personIsPet = (alias = 'person') =>
  sql<boolean>`EXISTS (SELECT FROM "person_pet" WHERE "person_pet"."personGroupId" = ${groupRef(alias)})`;

export const personType = (alias = 'person') =>
  sql<string>`(CASE WHEN ${personIsPet(alias)} THEN 'pet' ELSE 'person' END)`;

export const personSpecies = (alias = 'person') =>
  sql<
    string | null
  >`(SELECT "person_pet"."species" FROM "person_pet" WHERE "person_pet"."personGroupId" = ${groupRef(alias)})`;

/** Person fields stored in sidecars, accepted by PersonRepository.create next to the person row. */
export type PersonSidecarFields = { identityId?: string | null; type?: string; species?: string | null };

/** The sidecar fields of a Person, to add next to `selectAll(alias)`. */
export const personSidecarColumns = (alias = 'person') => [
  personIdentityId(alias).as('identityId'),
  personType(alias).as('type'),
  personSpecies(alias).as('species'),
];

/**
 * A person deleted ahead of its group leaves its person_identity row behind until the group is
 * swept. Readers never see it because they join through person, but it still holds the
 * (ownerId, identityId) unique key, so writers clear it first.
 */
export const clearOrphanPersonIdentity = (db: Kysely<DB> | Transaction<DB>, ownerId: string, identityId: string) =>
  db
    .deleteFrom('person_identity')
    .where('ownerId', '=', ownerId)
    .where('identityId', '=', identityId)
    .where(({ not, exists, selectFrom }) =>
      not(exists(selectFrom('person').whereRef('person.personGroupId', '=', 'person_identity.personGroupId'))),
    )
    .execute();

/** {@link clearOrphanPersonIdentity} for every owner of the given identities. */
export const clearOrphanPersonIdentities = (db: Kysely<DB> | Transaction<DB>, identityIds: string[]) =>
  db
    .deleteFrom('person_identity')
    .where('identityId', 'in', identityIds)
    .where(({ not, exists, selectFrom }) =>
      not(exists(selectFrom('person').whereRef('person.personGroupId', '=', 'person_identity.personGroupId'))),
    )
    .execute();

/** Links (or with `null` unlinks) the person in group `personGroupId` to a face identity. */
export const setPersonIdentity = async (
  db: Kysely<DB> | Transaction<DB>,
  personGroupId: string,
  identityId: string | null,
): Promise<void> => {
  if (identityId === null) {
    await db.deleteFrom('person_identity').where('personGroupId', '=', personGroupId).execute();
    return;
  }

  const person = await db
    .selectFrom('person')
    .select('ownerId')
    .where('personGroupId', '=', personGroupId)
    .executeTakeFirst();
  if (!person) {
    return;
  }

  await clearOrphanPersonIdentity(db, person.ownerId, identityId);
  await db
    .insertInto('person_identity')
    .values({ personGroupId, ownerId: person.ownerId, identityId })
    .onConflict((oc) => oc.column('personGroupId').doUpdateSet({ identityId }))
    .execute();
};

/**
 * Writes the given sidecar fields for the person in group `personGroupId`. `type: 'pet'` adds the
 * person_pet row and any other type removes it; `species` alone only updates an existing pet.
 */
export const writePersonSidecars = async (
  db: Kysely<DB> | Transaction<DB>,
  personGroupId: string,
  { identityId, type, species }: PersonSidecarFields,
): Promise<void> => {
  if (identityId !== undefined) {
    await setPersonIdentity(db, personGroupId, identityId);
  }

  if (type === 'pet') {
    await db
      .insertInto('person_pet')
      .values({ personGroupId, species: species ?? null })
      .onConflict((oc) =>
        species === undefined ? oc.doNothing() : oc.column('personGroupId').doUpdateSet({ species }),
      )
      .execute();
  } else if (type !== undefined) {
    await db.deleteFrom('person_pet').where('personGroupId', '=', personGroupId).execute();
  } else if (species !== undefined) {
    await db.updateTable('person_pet').set({ species }).where('personGroupId', '=', personGroupId).execute();
  }
};
