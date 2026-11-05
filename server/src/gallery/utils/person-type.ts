import type { Updateable } from 'kysely';
import type { DatabaseRepository } from 'src/repositories/database.repository.js';
import type { PersonId, PersonRepository } from 'src/repositories/person.repository.js';
import type { PersonTable } from 'src/schema/tables/person.table.js';
import { personIdentityId, personSidecarColumns, writePersonSidecars } from 'src/gallery/utils/person-sidecar.js';

/**
 * Updates a personal person's type and keeps every profile on its identity in sync. Face clusters
 * remain untouched; only their person/pet classification changes.
 */
const updatePersonType = async (
  databaseRepository: DatabaseRepository,
  personRepository: PersonRepository,
  person: Updateable<PersonTable> & PersonId,
  type: 'person' | 'pet',
) =>
  databaseRepository.transaction(async (db) => {
    const { ownerId, personGroupId } = person;
    const current = await db
      .selectFrom('person')
      .select(personIdentityId().as('identityId'))
      .where('person.ownerId', '=', ownerId)
      .where('person.personGroupId', '=', personGroupId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    await personRepository.update(person, db);

    if (current.identityId === null) {
      await writePersonSidecars(db, personGroupId, { type });
    } else {
      await db.updateTable('face_identity').set({ type }).where('id', '=', current.identityId).execute();

      if (type === 'pet') {
        await db
          .insertInto('person_pet')
          .columns(['personGroupId'])
          .expression((eb) =>
            eb
              .selectFrom('person_identity')
              .select('person_identity.personGroupId')
              .where('person_identity.identityId', '=', current.identityId!),
          )
          .onConflict((oc) => oc.doNothing())
          .execute();
      } else {
        await db
          .deleteFrom('person_pet')
          .where('personGroupId', 'in', (eb) =>
            eb
              .selectFrom('person_identity')
              .select('person_identity.personGroupId')
              .where('person_identity.identityId', '=', current.identityId!),
          )
          .execute();
      }

      await db
        .updateTable('shared_space_person')
        .set({ type })
        .where('identityId', '=', current.identityId)
        .where('type', '!=', type)
        .execute();

      // Sidecar changes do not touch person.updatedAt; bump every linked profile so sync notices
      // the type change on each owner's cluster as well.
      await db
        .updateTable('person')
        .set((eb) => ({ name: eb.ref('person.name') }))
        .where('personGroupId', 'in', (eb) =>
          eb
            .selectFrom('person_identity')
            .select('person_identity.personGroupId')
            .where('person_identity.identityId', '=', current.identityId!),
        )
        .execute();
    }

    return db
      .selectFrom('person')
      .selectAll('person')
      .select(personSidecarColumns())
      .where('person.ownerId', '=', ownerId)
      .where('person.personGroupId', '=', personGroupId)
      .executeTakeFirstOrThrow();
  });

export const updatePersonWithType = (
  databaseRepository: DatabaseRepository,
  personRepository: PersonRepository,
  person: Updateable<PersonTable> & PersonId & { type?: 'person' | 'pet' },
) => {
  const { type, ...personUpdate } = person;
  return type === undefined
    ? personRepository.update(personUpdate)
    : updatePersonType(databaseRepository, personRepository, personUpdate, type);
};
