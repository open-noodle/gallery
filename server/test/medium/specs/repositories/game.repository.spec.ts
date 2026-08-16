import { Kysely } from 'kysely';
import { AssetRepository } from 'src/repositories/asset.repository';
import { GameRepository } from 'src/repositories/game.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [GameRepository, AssetRepository, UserRepository],
    mock: [LoggingRepository],
  });
  return { ctx, gameRepo: ctx.get(GameRepository) };
};

/**
 * One challenge with `roundCount` date rounds. `dailyOn` null makes it a player-created
 * challenge, which the aggregate must ignore entirely.
 */
const newChallenge = async (
  ctx: ReturnType<typeof setup>['ctx'],
  gameRepo: GameRepository,
  options: { spaceId: string; ownerId: string; dailyOn: string | null; roundCount: number },
) => {
  const rounds = [];
  for (let index = 0; index < options.roundCount; index++) {
    const { asset } = await ctx.newAsset({ ownerId: options.ownerId });
    rounds.push({
      challengeId: '',
      index,
      type: 'date' as const,
      assetId: asset.id,
      answerLat: null,
      answerLon: null,
      answerDate: new Date('2020-06-15T00:00:00.000Z'),
    });
  }

  const challengeId = await gameRepo.createChallenge(
    {
      spaceId: options.spaceId,
      createdById: null,
      name: options.dailyOn ?? 'Custom',
      dailyOn: options.dailyOn,
      roundCount: options.roundCount,
      scaleKm: 100,
      scaleDays: 30,
    },
    rounds,
  );

  const createdRounds = await gameRepo.getRounds(challengeId);
  return { challengeId, roundIds: createdRounds.map((round) => round.id) };
};

const guess = (gameRepo: GameRepository, roundId: string, userId: string, score: number) =>
  gameRepo.createGuess({
    roundId,
    userId,
    guessLat: null,
    guessLon: null,
    guessDate: new Date('2020-06-15T00:00:00.000Z'),
    distanceKm: null,
    offsetDays: 0,
    score,
  });

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('GameRepository.getMonthlyStandings', () => {
  it('sums a player’s scores across the month’s dailies and counts each daily once', async () => {
    const { ctx, gameRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const first = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-05',
      roundCount: 3,
    });
    const second = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-06',
      roundCount: 1,
    });

    // Three rounds of one daily, one round of another: 4 guesses, but only 2 days played.
    await guess(gameRepo, first.roundIds[0], owner.id, 1000);
    await guess(gameRepo, first.roundIds[1], owner.id, 2000);
    await guess(gameRepo, first.roundIds[2], owner.id, 500);
    await guess(gameRepo, second.roundIds[0], owner.id, 400);

    const rows = await gameRepo.getMonthlyStandings(space.id, '2026-08-01', '2026-09-01');

    expect(rows).toEqual([{ userId: owner.id, total: 3900, daysPlayed: 2 }]);
  });

  it('excludes player-created challenges, however many points they hold', async () => {
    const { ctx, gameRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const daily = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-05',
      roundCount: 1,
    });
    const custom = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: null,
      roundCount: 1,
    });

    await guess(gameRepo, daily.roundIds[0], owner.id, 100);
    await guess(gameRepo, custom.roundIds[0], owner.id, 5000);

    const rows = await gameRepo.getMonthlyStandings(space.id, '2026-08-01', '2026-09-01');

    expect(rows).toEqual([{ userId: owner.id, total: 100, daysPlayed: 1 }]);
  });

  it('treats the month as half-open: the 1st is in, the last day of the previous month is out', async () => {
    const { ctx, gameRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const july31 = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-07-31',
      roundCount: 1,
    });
    const august1 = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-01',
      roundCount: 1,
    });
    const september1 = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-09-01',
      roundCount: 1,
    });

    await guess(gameRepo, july31.roundIds[0], owner.id, 700);
    await guess(gameRepo, august1.roundIds[0], owner.id, 800);
    await guess(gameRepo, september1.roundIds[0], owner.id, 900);

    const rows = await gameRepo.getMonthlyStandings(space.id, '2026-08-01', '2026-09-01');

    expect(rows).toEqual([{ userId: owner.id, total: 800, daysPlayed: 1 }]);
  });

  it('scopes to the space, so another space’s dailies never leak in', async () => {
    const { ctx, gameRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: other } = await ctx.newSharedSpace({ createdById: owner.id });

    const mine = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-05',
      roundCount: 1,
    });
    const theirs = await newChallenge(ctx, gameRepo, {
      spaceId: other.id,
      ownerId: owner.id,
      dailyOn: '2026-08-05',
      roundCount: 1,
    });

    await guess(gameRepo, mine.roundIds[0], owner.id, 300);
    await guess(gameRepo, theirs.roundIds[0], owner.id, 4000);

    const rows = await gameRepo.getMonthlyStandings(space.id, '2026-08-01', '2026-09-01');

    expect(rows).toEqual([{ userId: owner.id, total: 300, daysPlayed: 1 }]);
  });

  it('returns one row per player who guessed, and none for a player who did not', async () => {
    const { ctx, gameRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { result: other } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const daily = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-05',
      roundCount: 2,
    });

    await guess(gameRepo, daily.roundIds[0], owner.id, 100);
    await guess(gameRepo, daily.roundIds[1], other.id, 250);

    const rows = await gameRepo.getMonthlyStandings(space.id, '2026-08-01', '2026-09-01');

    // No ordering is asserted: the repository deliberately does not sort - it has no names to
    // break ties with. Task 3's service does that.
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ userId: owner.id, total: 100, daysPlayed: 1 });
    expect(rows).toContainEqual({ userId: other.id, total: 250, daysPlayed: 1 });
  });
});
