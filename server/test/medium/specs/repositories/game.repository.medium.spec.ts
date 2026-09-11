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
 * One challenge with `roundCount` date rounds, in whichever scope the caller asks for, created at
 * a chosen instant. Built through the repository's own `createChallenge` (mirrors the sibling
 * `newChallenge` in game.repository.spec.ts) rather than a raw insert, so the row this suite
 * prunes is exactly the shape `GameService.generateChallenge` produces - `createdAt` is the one
 * addition, because `deleteUnplayedChallenges` is keyed on it and no other caller needs to set it
 * explicitly.
 */
const newChallenge = async (
  ctx: ReturnType<typeof setup>['ctx'],
  gameRepo: GameRepository,
  options: {
    scope: { spaceId: string; ownerId: null } | { spaceId: null; ownerId: string };
    assetOwnerId: string;
    roundCount: number;
    createdAt: Date;
  },
) => {
  const rounds = [];
  for (let index = 0; index < options.roundCount; index++) {
    const { asset } = await ctx.newAsset({ ownerId: options.assetOwnerId });
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
      ...options.scope,
      createdById: null,
      name: 'c',
      dailyOn: null,
      roundCount: options.roundCount,
      scaleKm: 100,
      scaleDays: 30,
      createdAt: options.createdAt,
    },
    rounds,
  );

  const createdRounds = await gameRepo.getRounds(challengeId);
  return { challengeId, roundIds: createdRounds.map((round) => round.id) };
};

const guess = (gameRepo: GameRepository, roundId: string, userId: string) =>
  gameRepo.createGuess({
    roundId,
    userId,
    guessLat: null,
    guessLon: null,
    guessDate: new Date('2020-06-15T00:00:00.000Z'),
    distanceKm: null,
    offsetDays: 0,
    score: 100,
  });

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// Behavioural coverage for the nightly prune's query: game.repository.spec.ts's own
// "generated query shape" describe block already pins the SQL TEXT (the INNER JOIN to
// game_guess), which catches a regression at the query-shape layer with no database. This suite
// is the complementary layer - it actually executes deleteUnplayedChallenges against a real
// Postgres and observes which rows survive, because the one failure mode that matters here is
// silent: a challenge someone has already scored on getting deleted, discovered long after the
// fact with no way to reconstruct it.
describe('GameRepository.deleteUnplayedChallenges', () => {
  // Fixed instants around one CUTOFF this suite hands to the method under test directly - this
  // exercises the repository's own `olderThan` contract, independent of whatever retention
  // window GameService.onGameChallengeCleanup happens to compute (that wiring is covered in
  // game.service.spec.ts).
  const CUTOFF = new Date('2026-08-10T00:00:00.000Z');
  const OLD = new Date('2026-08-01T00:00:00.000Z'); // before CUTOFF - eligible to prune
  const INSIDE_WINDOW = new Date('2026-08-15T00:00:00.000Z'); // after CUTOFF - too new to prune

  it('deletes an unplayed challenge older than the cutoff in EITHER scope, from one call with no scope filter', async () => {
    const { ctx, gameRepo } = setup();
    const { result: user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    const oldSpaceChallenge = await newChallenge(ctx, gameRepo, {
      scope: { spaceId: space.id, ownerId: null },
      assetOwnerId: user.id,
      roundCount: 1,
      createdAt: OLD,
    });
    const oldSoloChallenge = await newChallenge(ctx, gameRepo, {
      scope: { spaceId: null, ownerId: user.id },
      assetOwnerId: user.id,
      roundCount: 1,
      createdAt: OLD,
    });

    await gameRepo.deleteUnplayedChallenges(CUTOFF);

    // One call, no spaceId/ownerId in the query at all - a space daily nobody opened is exactly
    // as much dead weight as a solo one, so both must be gone from this single invocation.
    await expect(gameRepo.getChallenge(oldSpaceChallenge.challengeId)).resolves.toBeUndefined();
    await expect(gameRepo.getChallenge(oldSoloChallenge.challengeId)).resolves.toBeUndefined();
  });

  // The case the whole rule exists for: "zero guesses", not "not finished". A partially played
  // challenge already contributes a real score to history and stats (soloHistory,
  // getSoloScoreSummary) - pruning it would silently rewrite numbers the player has already seen,
  // discovered only long after the fact.
  it('keeps a partially played challenge - one guess among several rounds - even though it is older than the cutoff', async () => {
    const { ctx, gameRepo } = setup();
    const { result: user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    const challenge = await newChallenge(ctx, gameRepo, {
      scope: { spaceId: space.id, ownerId: null },
      assetOwnerId: user.id,
      roundCount: 3,
      createdAt: OLD,
    });
    // Exactly one of three rounds answered - four rounds unplayed, one real score already
    // recorded. That single guess must be enough to save the whole challenge.
    await guess(gameRepo, challenge.roundIds[1], user.id);

    await gameRepo.deleteUnplayedChallenges(CUTOFF);

    await expect(gameRepo.getChallenge(challenge.challengeId)).resolves.toBeDefined();
  });

  // The boundary, executed rather than asserted on text: a challenge nobody has played yet but
  // that was only just generated is not "abandoned", it is a game still in flight.
  it('keeps an unplayed challenge that is still inside the retention window', async () => {
    const { ctx, gameRepo } = setup();
    const { result: user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });

    const challenge = await newChallenge(ctx, gameRepo, {
      scope: { spaceId: space.id, ownerId: null },
      assetOwnerId: user.id,
      roundCount: 1,
      createdAt: INSIDE_WINDOW,
    });

    await gameRepo.deleteUnplayedChallenges(CUTOFF);

    await expect(gameRepo.getChallenge(challenge.challengeId)).resolves.toBeDefined();
  });
});
