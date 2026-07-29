import { Kysely, sql } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let database: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(SharedSpaceRepository) };
};

// Explicit ids so that UUID order and physical (insertion) order are exact reverses of each
// other. An index scan walks these ascending; a bitmap heap scan walks them in insertion order.
// That makes the two lock orders provably opposite instead of relying on random uuids.
const ASCENDING = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];

beforeAll(async () => {
  database = await getKyselyDB('deadlock864');

  // Widen the per-row window so the two statements are guaranteed to interleave mid-scan.
  // Without this the deadlock is a genuine race and the test would be flaky.
  await sql`
    create or replace function medium_test_slow_row() returns trigger language plpgsql as $$
    begin
      perform pg_sleep(0.3);
      return new;
    end $$;
  `.execute(database);
  await sql`
    create trigger medium_test_slow_row before update on shared_space_person
    for each row execute function medium_test_slow_row();
  `.execute(database);
});

describe(`${SharedSpaceRepository.name}.recountPersons (#864)`, () => {
  it('does not deadlock when concurrent callers scan the same people in opposite orders', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });

    // Insert descending so physical order is the reverse of uuid order.
    for (const id of ASCENDING.toReversed()) {
      await database.insertInto('shared_space_person').values({ id, spaceId: space.id }).execute();
    }

    // Two pinned connections, each forced onto a different scan strategy — this is what two
    // concurrent AssetDelete workers hit in production when the planner picks differently.
    const recountOn = (planner: string) =>
      database.connection().execute(async (connection) => {
        await sql.raw(planner).execute(connection);
        await sut.recountPersons(ASCENDING, connection);
      });

    const indexScan = recountOn('set enable_bitmapscan = off; set enable_seqscan = off;');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const bitmapScan = recountOn('set enable_indexscan = off; set enable_seqscan = off;');

    const results = await Promise.allSettled([indexScan, bitmapScan]);

    const deadlocked = results.filter(
      (result) => result.status === 'rejected' && String(result.reason).includes('deadlock'),
    );
    expect(deadlocked).toEqual([]);
  });

  it('recounts stale counters down to zero when the person has no visible faces', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { id } = await database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, faceCount: 99, assetCount: 99 })
      .returning('id')
      .executeTakeFirstOrThrow();

    await sut.recountPersons([id]);

    await expect(
      database
        .selectFrom('shared_space_person')
        .select(['faceCount', 'assetCount'])
        .where('id', '=', id)
        .executeTakeFirst(),
    ).resolves.toEqual({ faceCount: 0, assetCount: 0 });
  });

  it('is a no-op for an empty id list', async () => {
    const { sut } = setup();
    await expect(sut.recountPersons([])).resolves.toBeUndefined();
  });

  // Orphan cleanup can delete a person before the recount that was queued for it runs, so unknown
  // ids must be tolerated rather than throwing.
  it('tolerates ids that no longer exist', async () => {
    const { sut } = setup();
    await expect(sut.recountPersons(['00000000-0000-4000-8000-0000000f0864'])).resolves.toBeUndefined();
  });

  it('handles a duplicated id without double-counting', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { id } = await database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, faceCount: 7, assetCount: 7 })
      .returning('id')
      .executeTakeFirstOrThrow();

    await sut.recountPersons([id, id, id]);

    await expect(
      database
        .selectFrom('shared_space_person')
        .select(['faceCount', 'assetCount'])
        .where('id', '=', id)
        .executeTakeFirst(),
    ).resolves.toEqual({ faceCount: 0, assetCount: 0 });
  });

  // The isTransaction branch must join the caller's transaction rather than opening its own —
  // otherwise the recount would commit independently and survive the caller's rollback.
  it('joins a caller-supplied transaction instead of committing on its own', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { id } = await database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, faceCount: 99, assetCount: 99 })
      .returning('id')
      .executeTakeFirstOrThrow();

    const rollback = new Error('rollback');
    await expect(
      database.transaction().execute(async (trx) => {
        await sut.recountPersons([id], trx);
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    await expect(
      database
        .selectFrom('shared_space_person')
        .select(['faceCount', 'assetCount'])
        .where('id', '=', id)
        .executeTakeFirst(),
    ).resolves.toEqual({ faceCount: 99, assetCount: 99 });
  });
});
