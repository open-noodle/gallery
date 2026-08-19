import { Kysely } from 'kysely';
import { DB } from 'src/schema';
// Side-effect import: registers every decorated table so the migrated template database this spec
// runs against carries the declarative constraints below. Same idiom as schema-drift.spec.ts.
import 'src/schema';
import { mediumFactory } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A challenge belongs to EXACTLY ONE scope: a shared space or a user, never both and never
// neither. Both halves of that rule are database constraints rather than service-layer checks,
// and neither can be proven against a mock - which is the whole reason this is a medium test.
//
// The daily uniqueness half is the subtle one. Postgres treats NULLs as distinct in a unique
// index, so the moment `spaceId` became nullable the existing `(spaceId, dailyOn)` index stopped
// constraining solo rows at all. Without a second index the lazy-generation race - which the
// first index exists to LOSE - would start winning twice, and one user would get two divergent
// dailies for the same UTC day.
describe('game_challenge scope constraints', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = await getKyselyDB();
  });

  afterAll(async () => {
    await db.destroy();
  });

  /** One user and one space to hang challenges off, fresh per test so the daily cases cannot
   * collide with each other on the very index they are asserting. */
  const seedSpaceAndUser = async () => {
    const user = await db
      .insertInto('user')
      .values(mediumFactory.userInsert())
      .returningAll()
      .executeTakeFirstOrThrow();
    const space = await db
      .insertInto('shared_space')
      .values(mediumFactory.sharedSpaceInsert({ createdById: user.id }))
      .returningAll()
      .executeTakeFirstOrThrow();

    return { spaceId: space.id, userId: user.id };
  };

  const insertChallenge = (values: Record<string, unknown>) =>
    db
      .insertInto('game_challenge' as never)
      .values({ name: 'c', roundCount: 5, scaleKm: 100, scaleDays: 365, ...values } as never)
      .execute();

  it('rejects a challenge with neither a space nor an owner', async () => {
    await expect(insertChallenge({ spaceId: null, ownerId: null })).rejects.toThrow(/game_challenge_scope_chk/);
  });

  it('rejects a challenge with both a space and an owner', async () => {
    const { spaceId, userId } = await seedSpaceAndUser();
    await expect(insertChallenge({ spaceId, ownerId: userId })).rejects.toThrow(/game_challenge_scope_chk/);
  });

  it('rejects a second daily for the same owner and date', async () => {
    const { userId } = await seedSpaceAndUser();
    await insertChallenge({ spaceId: null, ownerId: userId, dailyOn: '2026-08-19' });

    await expect(insertChallenge({ spaceId: null, ownerId: userId, dailyOn: '2026-08-19' })).rejects.toThrow(
      /game_challenge_owner_daily_uq/,
    );
  });

  it('still rejects a second daily for the same space and date', async () => {
    const { spaceId } = await seedSpaceAndUser();
    await insertChallenge({ spaceId, ownerId: null, dailyOn: '2026-08-19' });

    await expect(insertChallenge({ spaceId, ownerId: null, dailyOn: '2026-08-19' })).rejects.toThrow(
      /game_challenge_daily_uq/,
    );
  });

  it('allows two solo challenges for one owner when neither is a daily', async () => {
    const { userId } = await seedSpaceAndUser();
    await insertChallenge({ spaceId: null, ownerId: userId, dailyOn: null });

    await expect(insertChallenge({ spaceId: null, ownerId: userId, dailyOn: null })).resolves.toBeDefined();
  });
});
