import { Kysely } from 'kysely';
import { PersonUserRole } from 'src/dtos/person.dto.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// Gallery keeps upstream's person sharing (immich-31620) dormant: the schema is present, nothing inserts into
// `person_user`. These pin the two database facts the decision rests on.
// See specs/2026-10-01-upstream-person-sharing-dormant-design.md.

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('person sharing (dormant)', () => {
  it('cannot share a person: the share trigger adds a second row to a group, which Option M forbids', async () => {
    const { ctx } = setup();
    const [{ user: owner }, { user: viewer }] = [await ctx.newUser(), await ctx.newUser()];
    const { result: person } = await ctx.newPerson({ ownerId: owner.id, name: 'Alice' });

    await expect(
      ctx.database
        .insertInto('person_user')
        .values({
          personGroupId: person.personGroupId,
          sharedById: owner.id,
          sharedWithId: viewer.id,
          role: PersonUserRole.Read,
        })
        .execute(),
    ).rejects.toThrow(/person_personGroupId_key/);

    const rows = await ctx.database
      .selectFrom('person')
      .select('ownerId')
      .where('personGroupId', '=', person.personGroupId)
      .execute();
    expect(rows).toEqual([{ ownerId: owner.id }]);
  });

  it('deletes a person with the person_delete_shares trigger present', async () => {
    const { ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { result: person } = await ctx.newPerson({ ownerId: owner.id, name: 'Alice' });

    await ctx.database.deleteFrom('person').where('personGroupId', '=', person.personGroupId).execute();

    const rows = await ctx.database
      .selectFrom('person')
      .select('ownerId')
      .where('personGroupId', '=', person.personGroupId)
      .execute();
    expect(rows).toEqual([]);
  });
});
