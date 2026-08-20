import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Settings } from 'luxon';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend';
import { CacheControl, SharedSpaceRole, UserMetadataKey } from 'src/enum';
import { NOT_PLACE_PROMPT_EMBEDDING, PLACE_PROMPT_EMBEDDING } from 'src/repositories/game.repository';
import { GameService } from 'src/services/game.service';
import { PERSONAL_NO_ROUNDS_MESSAGE } from 'src/services/game/personal-pool';
import { StorageService } from 'src/services/storage.service';
import { clearConfigCache } from 'src/utils/config';
import { ImmichFileResponse } from 'src/utils/file';
import { newTestService, ServiceMocks } from 'test/utils';

const locationCandidate = (id: string, lat: number, lon: number, country: string) => ({
  assetId: id,
  lat,
  lon,
  takenAt: new Date(2021, 5, 1),
  country,
});

/** The minimum an editor needs to reach `createChallenge` - one candidate in each pool. */
const stockPools = (mocks: ServiceMocks) => {
  mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
  mocks.game.getLocationCandidates.mockResolvedValue([locationCandidate('a', 52.5, 13.4, 'Germany')]);
  mocks.game.getDateCandidates.mockResolvedValue([locationCandidate('e', 41.9, 12.5, 'Italy')]);
  mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);
  mocks.game.createChallenge.mockResolvedValue('challenge-1');
};

/** The solo counterpart to stockPools: one candidate in each of the player's own pools. */
const stockSoloPools = (mocks: ServiceMocks) => {
  mocks.game.getSoloLocationCandidates.mockResolvedValue([locationCandidate('a', 52.5, 13.4, 'Germany')]);
  mocks.game.getSoloDateCandidates.mockResolvedValue([locationCandidate('e', 41.9, 12.5, 'Italy')]);
  mocks.game.getSoloRecentlyUsedAssetIds.mockResolvedValue([]);
  mocks.game.getSoloChallengeCount.mockResolvedValue(0);
  mocks.game.createChallenge.mockResolvedValue('solo-1');
  // No stored preference override - own photos only, the same default `getPreferences` falls back
  // to for any user who has never touched the PhotoGuesser settings.
  mocks.user.getMetadata.mockResolvedValue([]);
};

/** Stored PhotoGuesser source preference, in the shape UserRepository.getMetadata returns it. */
const photoGuesserMetadata = (includePartners: boolean, includeSpaces: boolean) =>
  [{ key: UserMetadataKey.Preferences, value: { photoGuesser: { includePartners, includeSpaces } } }] as any;

/** One row as GameRepository.getSoloHistory returns it - the challenge, plus what the player
 * scored on it. */
const historyRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: 'Challenge 1',
  dailyOn: null,
  createdAt: new Date('2026-08-19T10:00:00.000Z'),
  roundCount: 5,
  answered: 5,
  total: 4000,
  ...overrides,
});

/** The scene-prompt vectors handed to the location-candidate query on the call under test. */
const scenePromptsUsed = (mocks: ServiceMocks) => mocks.game.getLocationCandidates.mock.calls[0][3];

describe(GameService.name, () => {
  let sut: GameService;
  let mocks: ServiceMocks;

  beforeAll(() => {
    // Initialize the disk backend for StorageService so that getRoundImage's serveFromBackend
    // call works in tests. The DiskStorageBackend returns absolute paths as-is, so the
    // mediaLocation value doesn't matter. Same pattern as asset-media.service.spec.ts.
    (StorageService as any).diskBackend = new DiskStorageBackend('/data');
  });

  beforeEach(() => {
    ({ sut, mocks } = newTestService(GameService));
    // getScenePromptEmbeddings reads the system config with the process-wide cache; without this
    // a config stubbed by one test would leak into the next.
    clearConfigCache();
  });

  const authStub = { user: { id: 'user-1' } } as any;

  it('rejects a caller who is not a member of the space', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(void 0);
    await expect(sut.create(authStub, 'space-1', { roundCount: 5 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a viewer, because creating a challenge requires the editor role', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    await expect(sut.create(authStub, 'space-1', { roundCount: 5 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the space has no usable photos at all', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
    mocks.game.getLocationCandidates.mockResolvedValue([]);
    mocks.game.getDateCandidates.mockResolvedValue([]);
    mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);
    await expect(sut.create(authStub, 'space-1', { roundCount: 5 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('freezes the pool scale onto the challenge', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
    mocks.game.getLocationCandidates.mockResolvedValue([
      locationCandidate('a', 52.5, 13.4, 'Germany'),
      locationCandidate('b', -33.9, 18.4, 'South Africa'),
      locationCandidate('c', 40.7, -74, 'United States'),
      locationCandidate('d', 47.9, 106.9, 'Mongolia'),
    ]);
    mocks.game.getDateCandidates.mockResolvedValue([locationCandidate('e', 41.9, 12.5, 'Italy')]);
    mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);
    mocks.game.createChallenge.mockResolvedValue('challenge-1');

    await sut.create(authStub, 'space-1', { roundCount: 5 });

    const [challenge] = mocks.game.createChallenge.mock.calls[0];
    expect(challenge.scaleKm).toBeGreaterThan(0);
    expect(challenge.scaleDays).toBeGreaterThanOrEqual(1);
  });

  // A GPS-poor space must still produce a playable challenge.
  it('fills the whole set with date rounds when there are no location candidates', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
    mocks.game.getLocationCandidates.mockResolvedValue([]);
    mocks.game.getDateCandidates.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        assetId: `d${i}`,
        lat: null,
        lon: null,
        takenAt: new Date(2015 + i, 0, 1),
        country: null,
      })),
    );
    mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);
    mocks.game.createChallenge.mockResolvedValue('challenge-2');

    await sut.create(authStub, 'space-1', { roundCount: 5 });

    const [, rounds] = mocks.game.createChallenge.mock.calls[0];
    expect(rounds).toHaveLength(5);
    expect(rounds.every((r: any) => r.type === 'date')).toBe(true);
  });

  it('never repeats an asset within a challenge', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
    mocks.game.getLocationCandidates.mockResolvedValue([
      locationCandidate('a', 52.5, 13.4, 'Germany'),
      locationCandidate('b', -33.9, 18.4, 'South Africa'),
    ]);
    mocks.game.getDateCandidates.mockResolvedValue([
      locationCandidate('a', 52.5, 13.4, 'Germany'),
      locationCandidate('z', 10, 10, 'Kenya'),
    ]);
    mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);
    mocks.game.createChallenge.mockResolvedValue('challenge-3');

    await sut.create(authStub, 'space-1', { roundCount: 4 });

    const [, rounds] = mocks.game.createChallenge.mock.calls[0];
    const ids = rounds.map((r: any) => r.assetId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Regression for a joint (both-pools-or-neither) recency decision: a well-stocked location
  // pool with zero recently-used assets must not lose its exclusion just because the date pool's
  // candidates are all recently used. The date pool alone should fall back to its raw
  // (recency-inclusive) candidates, and the challenge should still reach the requested count.
  it('tops up only the pool that needs it when recency exclusion would otherwise leave it short', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
    mocks.game.getLocationCandidates.mockResolvedValue([
      locationCandidate('l1', 52.5, 13.4, 'Germany'),
      locationCandidate('l2', -33.9, 18.4, 'South Africa'),
      locationCandidate('l3', 40.7, -74, 'United States'),
      locationCandidate('l4', 47.9, 106.9, 'Mongolia'),
      locationCandidate('l5', 41.9, 12.5, 'Italy'),
    ]);
    mocks.game.getDateCandidates.mockResolvedValue([
      locationCandidate('d1', 45.8, 15.9, 'Croatia'),
      locationCandidate('d2', 10, 10, 'Kenya'),
      locationCandidate('d3', 20, 20, 'Chad'),
      locationCandidate('d4', -10, -70, 'Peru'),
      locationCandidate('d5', 35, 139, 'Japan'),
    ]);
    // Every date candidate was used by a recent challenge; none of the location candidates were.
    mocks.game.getRecentlyUsedAssetIds.mockResolvedValue(['d1', 'd2', 'd3', 'd4', 'd5']);
    mocks.game.createChallenge.mockResolvedValue('challenge-4');

    await sut.create(authStub, 'space-1', { roundCount: 5 });

    const [challenge, rounds] = mocks.game.createChallenge.mock.calls[0];
    expect(challenge.roundCount).toBe(5);
    expect(rounds).toHaveLength(5);
    const ids = rounds.map((r: any) => r.assetId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The two CLIP prompt vectors are 512-dim ViT-B-32__openai constants, but the model is
  // admin-configurable and setDimensionSize re-types smart_search.embedding to match. Against a
  // 768-dim model the ordering errors outright; against a *different* 512-dim model it silently
  // ranks in an unrelated embedding space, which is worse. So the vectors must follow the
  // configured model, and the gate must degrade rather than lie when they cannot.
  describe('scene-gate prompt vectors', () => {
    it('passes the shipped constants when the configured model is the one they were encoded with', async () => {
      stockPools(mocks);

      await sut.create(authStub, 'space-1', { roundCount: 2 });

      expect(mocks.game.getLocationCandidates).toHaveBeenCalledWith('space-1', expect.any(Number), expect.any(String), {
        place: PLACE_PROMPT_EMBEDDING,
        notPlace: NOT_PLACE_PROMPT_EMBEDDING,
      });
      // No inference for the default install - design §7.1's "one dot product per candidate and
      // no new inference".
      expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
    });

    it('encodes the prompts against a different configured model instead of reusing the constants', async () => {
      stockPools(mocks);
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { clip: { modelName: 'ViT-L-14__openai' } } });
      mocks.machineLearning.encodeText.mockResolvedValue('[0.5,0.25]');

      await sut.create(authStub, 'space-1', { roundCount: 2 });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith(expect.any(String), {
        modelName: 'ViT-L-14__openai',
      });
      const prompts = scenePromptsUsed(mocks);
      expect(prompts).toEqual({ place: [0.5, 0.25], notPlace: [0.5, 0.25] });
      expect(prompts?.place).not.toEqual(PLACE_PROMPT_EMBEDDING);
    });

    it('drops the scene ordering rather than ranking against the wrong embedding space when encoding fails', async () => {
      stockPools(mocks);
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { clip: { modelName: 'ViT-L-14__openai' } } });
      mocks.machineLearning.encodeText.mockRejectedValue(new Error('ml is down'));

      await sut.create(authStub, 'space-1', { roundCount: 2 });

      // Undefined prompts, not the shipped 512-dim constants: the challenge is still generated
      // (face gate + spread rules), just without the CLIP rank.
      expect(mocks.game.getLocationCandidates).toHaveBeenCalledWith(
        'space-1',
        expect.any(Number),
        expect.any(String),
        undefined,
      );
      expect(mocks.logger.warn).toHaveBeenCalled();
    });

    it('does not encode against a model when smart search is disabled', async () => {
      stockPools(mocks);
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { modelName: 'ViT-L-14__openai', enabled: false } },
      });

      await sut.create(authStub, 'space-1', { roundCount: 2 });

      expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
      expect(scenePromptsUsed(mocks)).toBeUndefined();
    });
  });

  // ORDER BY asset.id ASC LIMIT 200 was deterministic but *stably* so: in a space with more
  // than 200 assets no photo outside that lowest-id prefix could ever reach a round, in any
  // challenge, which falsifies design §5's "adding photos to the space makes the game better".
  // The seed makes the sample move between challenges while staying reproducible per challenge.
  it('passes a per-challenge seed to both candidate queries so the sample is not frozen to one prefix', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
    mocks.game.getLocationCandidates.mockResolvedValue([locationCandidate('a', 52.5, 13.4, 'Germany')]);
    mocks.game.getDateCandidates.mockResolvedValue([locationCandidate('e', 41.9, 12.5, 'Italy')]);
    mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);
    mocks.game.getChallengesForSpace.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }] as any);
    mocks.game.createChallenge.mockResolvedValue('challenge-3');

    await sut.create(authStub, 'space-1', { roundCount: 2 });

    // Same seed for both pools, derived from the space and how many challenges it already has -
    // so challenge 3 draws a different slice of a large space than challenges 1 and 2 did.
    expect(mocks.game.getDateCandidates).toHaveBeenCalledWith('space-1', expect.any(Number), 'space-1:2');
    expect(mocks.game.getLocationCandidates).toHaveBeenCalledWith(
      'space-1',
      expect.any(Number),
      'space-1:2',
      expect.anything(),
    );
  });

  describe('onGameChallengeCleanup', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // Which challenges count as "unplayed" - zero game_guess rows, not "not finished" - is the
    // repository query's rule, not this handler's: pruning a partially played challenge would
    // silently rewrite a score already on the leaderboard and in history, so that distinction is
    // proved against the generated SQL in game.repository.spec.ts (deleteUnplayedChallenges), the
    // same way the other query-shape guards in that file work with no database. What is testable
    // here is the wiring - the cutoff this handler computes and hands to the repository.
    it('prunes challenges older than the retention window', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));

      await sut.onGameChallengeCleanup();

      expect(mocks.game.deleteUnplayedChallenges).toHaveBeenCalledWith(new Date('2026-08-12T12:00:00.000Z'));
    });
  });

  describe('guess', () => {
    const challengeStub = {
      id: 'challenge-1',
      spaceId: 'space-1',
      scaleKm: 15_000,
      scaleDays: 3000,
      roundCount: 5,
    } as any;

    beforeEach(() => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallenge.mockResolvedValue(challengeStub);
    });

    it('scores a location guess from the distance to the frozen answer', async () => {
      mocks.game.getRound.mockResolvedValue({
        id: 'round-1',
        challengeId: 'challenge-1',
        index: 0,
        type: 'location',
        answerLat: 52.5,
        answerLon: 13.4,
        answerDate: null,
      } as any);
      mocks.game.createGuess.mockImplementation((guess: any) => guess);

      const result = await sut.guess(authStub, 'challenge-1', 0, { lat: 52.5, lon: 13.4 });

      expect(result.score).toBe(5000);
      expect(result.distanceKm).toBeCloseTo(0, 5);
    });

    // Pins challenge.scaleKm (15_000) as the actual divisor: the guess is placed exactly scaleKm/10
    // from the answer (due north, so the great-circle distance is exact), which makes the score
    // decay ratio exactly 0.1 and the expected score exactly 5000 * e^-1 ≈ 1839 - a value that only
    // comes out right if the frozen challenge scale, not some other/recomputed scale, is the divisor.
    it('scores a non-perfect location guess against the frozen scale', async () => {
      mocks.game.getRound.mockResolvedValue({
        id: 'round-1',
        challengeId: 'challenge-1',
        index: 0,
        type: 'location',
        answerLat: 0,
        answerLon: 0,
        answerDate: null,
      } as any);
      mocks.game.createGuess.mockImplementation((guess: any) => guess);

      const result = await sut.guess(authStub, 'challenge-1', 0, { lat: 13.4898, lon: 0 });

      expect(result.distanceKm).toBeCloseTo(1500, 0);
      expect(result.score).toBe(1839);
    });

    it('scores a date guess from the day offset', async () => {
      mocks.game.getRound.mockResolvedValue({
        id: 'round-2',
        challengeId: 'challenge-1',
        index: 1,
        type: 'date',
        answerLat: null,
        answerLon: null,
        answerDate: new Date(2020, 6, 1),
      } as any);
      mocks.game.createGuess.mockImplementation((guess: any) => guess);

      const result = await sut.guess(authStub, 'challenge-1', 1, { date: new Date(2020, 6, 1) });

      expect(result.score).toBe(5000);
      expect(result.offsetDays).toBe(0);
    });

    // The answer's timestamp (asset.localDateTime) carries a real time of day the player cannot
    // know. Naming the correct calendar day must score 5000 regardless of that time of day - both
    // sides are normalised to their UTC calendar day before differencing, not diffed as instants.
    it('scores a date guess naming the correct calendar day, regardless of the answer time of day', async () => {
      mocks.game.getRound.mockResolvedValue({
        id: 'round-2',
        challengeId: 'challenge-1',
        index: 1,
        type: 'date',
        answerLat: null,
        answerLon: null,
        answerDate: new Date(2020, 6, 1, 14, 23),
      } as any);
      mocks.game.createGuess.mockImplementation((guess: any) => guess);

      const result = await sut.guess(authStub, 'challenge-1', 1, { date: new Date(2020, 6, 1) });

      expect(result.score).toBe(5000);
      expect(result.offsetDays).toBe(0);
    });

    // The player picks a year and a month, so grading has to stop at the month: before this, a
    // guess that named the right month still lost points for not naming the right DAY - which the
    // UI gives no way to pick - and against a narrow pool scale that alone could zero the round.
    it('scores a date guess naming the correct month at the maximum, whatever day it falls on', async () => {
      mocks.game.getRound.mockResolvedValue({
        id: 'round-2',
        challengeId: 'challenge-1',
        index: 1,
        type: 'date',
        answerLat: null,
        answerLon: null,
        answerDate: new Date(Date.UTC(2020, 6, 12)),
      } as any);
      mocks.game.createGuess.mockImplementation((guess: any) => guess);

      // The 1st of the month, exactly as date-round.svelte emits it.
      const result = await sut.guess(authStub, 'challenge-1', 1, { date: new Date(Date.UTC(2020, 6, 1)) });

      expect(result.score).toBe(5000);
      expect(result.offsetDays).toBe(0);
    });

    // A miss is still measured in days, from the edge of the month the player picked - so being one
    // day out stays clearly better than being two months out.
    it('measures a missed month from that month edge, in days', async () => {
      mocks.game.getRound.mockResolvedValue({
        id: 'round-2',
        challengeId: 'challenge-1',
        index: 1,
        type: 'date',
        answerLat: null,
        answerLon: null,
        answerDate: new Date(Date.UTC(2020, 7, 5)),
      } as any);
      mocks.game.createGuess.mockImplementation((guess: any) => guess);

      // Picked July; the answer is 5 August, i.e. 5 days past the end of July.
      const result = await sut.guess(authStub, 'challenge-1', 1, { date: new Date(Date.UTC(2020, 6, 1)) });

      expect(result.offsetDays).toBe(5);
      expect(result.score).toBeLessThan(5000);
    });

    it('rejects a second guess on the same round', async () => {
      mocks.game.getRound.mockResolvedValue({
        id: 'round-1',
        challengeId: 'challenge-1',
        index: 0,
        type: 'location',
        answerLat: 52.5,
        answerLon: 13.4,
        answerDate: null,
      } as any);
      mocks.game.createGuess.mockRejectedValue(
        Object.assign(new Error('duplicate key'), { constraint_name: 'game_guess_round_user_uq' }),
      );

      await expect(sut.guess(authStub, 'challenge-1', 0, { lat: 1, lon: 1 })).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a location guess with no coordinates', async () => {
      mocks.game.getRound.mockResolvedValue({ id: 'r', type: 'location', challengeId: 'challenge-1' } as any);
      await expect(sut.guess(authStub, 'challenge-1', 0, {} as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('still scores a guess on a daily whose space has since turned the daily off', async () => {
      // Disabling stops generation and hides the card; it must not snatch away a game someone is
      // part-way through. `guess` gates on membership only, and that is deliberate - do not "fix"
      // this into a rejection when reading the opt-in code.
      mocks.sharedSpace.getById.mockResolvedValue({ dailyChallengeEnabled: false } as any);
      mocks.game.getRound.mockResolvedValue({
        id: 'round-1',
        challengeId: 'challenge-1',
        index: 0,
        type: 'location',
        answerLat: 52.5,
        answerLon: 13.4,
        answerDate: null,
      } as any);
      mocks.game.createGuess.mockImplementation((guess: any) => guess);

      const result = await sut.guess(authStub, 'challenge-1', 0, { lat: 52.5, lon: 13.4 });

      expect(result.score).toBe(5000);
    });
  });

  describe('get', () => {
    it('withholds the answer for a round the caller has not guessed', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallenge.mockResolvedValue({ id: 'challenge-1', spaceId: 'space-1', roundCount: 2 } as any);
      mocks.game.getRounds.mockResolvedValue([
        {
          id: 'r0',
          index: 0,
          type: 'location',
          answerLat: 52.5,
          answerLon: 13.4,
          answerDate: null,
          assetId: 'asset-1',
        },
        {
          id: 'r1',
          index: 1,
          type: 'date',
          answerLat: null,
          answerLon: null,
          answerDate: new Date(),
          assetId: 'asset-2',
        },
      ] as any);
      mocks.game.getGuessesForUser.mockResolvedValue([{ roundId: 'r0', score: 4000 }] as any);

      const result = await sut.get(authStub, 'challenge-1');

      // Guessed: answer present. Unguessed: answer absent - and no asset id, which
      // would otherwise resolve straight back to /api/assets/:id.
      expect(result.rounds[0].answer).toBeDefined();
      expect(result.rounds[1].answer).toBeUndefined();
      expect(JSON.stringify(result.rounds[1])).not.toContain('asset-2');
    });

    it('returns the caller own guess for a guessed location round', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallenge.mockResolvedValue({ id: 'challenge-1', spaceId: 'space-1', roundCount: 2 } as any);
      mocks.game.getRounds.mockResolvedValue([
        {
          id: 'r0',
          index: 0,
          type: 'location',
          answerLat: 52.5,
          answerLon: 13.4,
          answerDate: null,
          assetId: 'asset-1',
        },
        {
          id: 'r1',
          index: 1,
          type: 'date',
          answerLat: null,
          answerLon: null,
          answerDate: new Date(),
          assetId: 'asset-2',
        },
      ] as any);
      mocks.game.getGuessesForUser.mockResolvedValue([
        {
          roundId: 'r0',
          userId: 'user-1',
          guessLat: 38.72,
          guessLon: -9.14,
          guessDate: null,
          distanceKm: 412.3,
          offsetDays: null,
          score: 4000,
        },
      ] as any);

      const result = await sut.get(authStub, 'challenge-1');

      expect(result.rounds[0].guess).toEqual({
        lat: 38.72,
        lon: -9.14,
        date: null,
        distanceKm: 412.3,
        offsetDays: null,
      });
    });

    it('returns the caller own guess for a guessed date round', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallenge.mockResolvedValue({ id: 'challenge-1', spaceId: 'space-1', roundCount: 2 } as any);
      mocks.game.getRounds.mockResolvedValue([
        {
          id: 'r0',
          index: 0,
          type: 'date',
          answerLat: null,
          answerLon: null,
          answerDate: new Date('2024-06-01T00:00:00.000Z'),
          assetId: 'asset-1',
        },
        {
          id: 'r1',
          index: 1,
          type: 'location',
          answerLat: 52.5,
          answerLon: 13.4,
          answerDate: null,
          assetId: 'asset-2',
        },
      ] as any);
      mocks.game.getGuessesForUser.mockResolvedValue([
        {
          roundId: 'r0',
          userId: 'user-1',
          guessLat: null,
          guessLon: null,
          guessDate: new Date('2024-06-01T00:00:00.000Z'),
          distanceKm: null,
          offsetDays: 3,
          score: 4500,
        },
      ] as any);

      const result = await sut.get(authStub, 'challenge-1');

      // The inverse column pair. A projection that copies lat/lon into a date round, or
      // offsetDays into a location round, passes any test that only checks `guess` is set.
      expect(result.rounds[0].guess).toEqual({
        lat: null,
        lon: null,
        date: new Date('2024-06-01T00:00:00.000Z'),
        distanceKm: null,
        offsetDays: 3,
      });
    });

    it('withholds the guess for a round the caller has not guessed', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallenge.mockResolvedValue({ id: 'challenge-1', spaceId: 'space-1', roundCount: 2 } as any);
      mocks.game.getRounds.mockResolvedValue([
        {
          id: 'r0',
          index: 0,
          type: 'location',
          answerLat: 52.5,
          answerLon: 13.4,
          answerDate: null,
          assetId: 'asset-1',
        },
        {
          id: 'r1',
          index: 1,
          type: 'date',
          answerLat: null,
          answerLon: null,
          answerDate: new Date(),
          assetId: 'asset-2',
        },
      ] as any);
      mocks.game.getGuessesForUser.mockResolvedValue([{ roundId: 'r0', score: 4000 }] as any);

      const result = await sut.get(authStub, 'challenge-1');

      expect(result.rounds[1].guess).toBeUndefined();
    });

    // The spec's §3.1 invariant: a player must never see another player's guess.
    // `toRoundDetail` trusts every row `getGuessesForUser` hands it with no further per-guess
    // ownership check, so the guard has to live at the call site - the query must be scoped to
    // the caller's own id, never to some other player's. This mock stands in for the real
    // repository's `WHERE game_guess.userId = userId` (which a mocked repository can't
    // exercise): it hands back a different row depending on which userId the service actually
    // asks for, so a service that drops or mistargets that filter surfaces the wrong guess here.
    it('never returns a guess belonging to another player', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallenge.mockResolvedValue({ id: 'challenge-1', spaceId: 'space-1', roundCount: 1 } as any);
      mocks.game.getRounds.mockResolvedValue([
        {
          id: 'r0',
          index: 0,
          type: 'location',
          answerLat: 52.5,
          answerLon: 13.4,
          answerDate: null,
          assetId: 'asset-1',
        },
      ] as any);
      const guessesFor = (userId: string) =>
        userId === authStub.user.id
          ? [
              {
                roundId: 'r0',
                userId,
                guessLat: 38.72,
                guessLon: -9.14,
                guessDate: null,
                distanceKm: 412.3,
                offsetDays: null,
                score: 4000,
              },
            ]
          : [
              {
                roundId: 'r0',
                userId,
                guessLat: 38.72,
                guessLon: -0.13,
                guessDate: null,
                distanceKm: 200,
                offsetDays: null,
                score: 3000,
              },
            ];
      mocks.game.getGuessesForUser.mockImplementation(((_challengeId: string, userId: string) =>
        Promise.resolve(guessesFor(userId))) as any);

      const result = await sut.get(authStub, 'challenge-1');

      expect(result.rounds[0].guess?.lon).toBe(-9.14);
      // The other player's guess must appear nowhere in the caller's payload, under any key.
      expect(JSON.stringify(result)).not.toContain('-0.13');
      expect(mocks.game.getGuessesForUser).toHaveBeenCalledWith('challenge-1', authStub.user.id);
    });
  });

  describe('getRoundImage', () => {
    it('serves a thumbnail that is not the original file', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallenge.mockResolvedValue({ id: 'challenge-1', spaceId: 'space-1' } as any);
      mocks.game.getRound.mockResolvedValue({ id: 'r0', index: 0, type: 'location', assetId: 'asset-1' } as any);
      mocks.game.getEligibleRoundAsset.mockResolvedValue({ previewPath: '/thumbs/asset-1_preview.jpeg' } as any);

      const result = await sut.getRoundImage(authStub, 'challenge-1', 0);

      // The preview is already re-encoded and EXIF-free; the original never is. Asserting the
      // full response (routed through serveFromBackend, not a bare `new ImmichFileResponse`) pins
      // both the preview path AND the generic filename - `result.path` alone isn't type-safe once
      // getRoundImage returns the ImmichMediaResponse union serveFromBackend produces.
      expect(result).toEqual(
        new ImmichFileResponse({
          path: '/thumbs/asset-1_preview.jpeg',
          contentType: 'image/jpeg',
          cacheControl: CacheControl.PrivateWithCache,
          fileName: 'round-0.jpeg',
        }),
      );
      // The lookup is space-scoped, and the unscoped one (no deletedAt / visibility / space
      // predicate) must never be reached from this route.
      expect(mocks.game.getEligibleRoundAsset).toHaveBeenCalledWith('space-1', 'asset-1');
      expect(mocks.asset.getById).not.toHaveBeenCalled();
    });

    // Rounds are frozen by design (§4.1), so this assetId is permanent - which is exactly why
    // eligibility has to be re-checked on every request. Removed from the space, trashed (a
    // 30-day window), or moved to the locked folder all present here as "no eligible row", and
    // all of them must stop the image being served rather than being honoured forever.
    it('404s a round whose asset is no longer eligible in the space', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallenge.mockResolvedValue({ id: 'challenge-1', spaceId: 'space-1' } as any);
      mocks.game.getRound.mockResolvedValue({ id: 'r0', index: 0, type: 'location', assetId: 'asset-1' } as any);
      mocks.game.getEligibleRoundAsset.mockResolvedValue(void 0);

      await expect(sut.getRoundImage(authStub, 'challenge-1', 0)).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.game.getEligibleRoundAsset).toHaveBeenCalledWith('space-1', 'asset-1');
      expect(mocks.asset.getById).not.toHaveBeenCalled();
    });

    it('refuses a round belonging to a different challenge', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallenge.mockResolvedValue({ id: 'challenge-1', spaceId: 'space-1' } as any);
      mocks.game.getRound.mockResolvedValue(void 0);

      await expect(sut.getRoundImage(authStub, 'challenge-1', 99)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('list', () => {
    it('rejects a caller who is not a member of the space', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue(void 0);
      await expect(sut.list(authStub, 'space-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns an empty list for a space with no challenges', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallengesForSpace.mockResolvedValue([]);
      mocks.game.getLocationRoundCounts.mockResolvedValue([]);

      const result = await sut.list(authStub, 'space-1');

      expect(result).toEqual([]);
    });

    it("annotates each challenge with the caller's own progress, not another member's", async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getLocationRoundCounts.mockResolvedValue([{ challengeId: 'challenge-1', locationCount: 3 }]);
      mocks.game.getChallengesForSpace.mockResolvedValue([
        {
          id: 'challenge-1',
          spaceId: 'space-1',
          name: 'Challenge 1',
          roundCount: 5,
          scaleKm: 100,
          scaleDays: 30,
          createdAt: new Date(2024, 0, 1),
          closedAt: null,
        },
        {
          id: 'challenge-2',
          spaceId: 'space-1',
          name: 'Challenge 2',
          roundCount: 3,
          scaleKm: 200,
          scaleDays: 10,
          createdAt: new Date(2024, 1, 1),
          closedAt: null,
        },
      ] as any);
      mocks.game.getGuessesForUser.mockImplementation((challengeId: unknown) => {
        if (challengeId === 'challenge-1') {
          return Promise.resolve([{ score: 4000 }, { score: 3000 }] as any);
        }
        return Promise.resolve([]);
      });

      const result = await sut.list(authStub, 'space-1');

      expect(result).toEqual([
        expect.objectContaining({ id: 'challenge-1', answered: 2, total: 7000 }),
        expect.objectContaining({ id: 'challenge-2', answered: 0, total: 0 }),
      ]);
      expect(mocks.game.getGuessesForUser).toHaveBeenCalledWith('challenge-1', authStub.user.id);
      expect(mocks.game.getGuessesForUser).toHaveBeenCalledWith('challenge-2', authStub.user.id);
    });
  });

  /** The round types actually handed to the repository on the call under test. */
  const insertedRoundTypes = (mocks: ServiceMocks) =>
    (mocks.game.createChallenge.mock.calls[0][1] as Array<{ type: string }>).map((round) => round.type);

  describe('game type', () => {
    it('builds only date rounds when date is requested', async () => {
      stockPools(mocks);

      await sut.create(authStub, 'space-1', { roundCount: 5, type: 'date' });

      expect(insertedRoundTypes(mocks)).not.toHaveLength(0);
      expect(new Set(insertedRoundTypes(mocks))).toEqual(new Set(['date']));
    });

    it('builds only location rounds when location is requested', async () => {
      stockPools(mocks);

      await sut.create(authStub, 'space-1', { roundCount: 5, type: 'location' });

      expect(insertedRoundTypes(mocks)).not.toHaveLength(0);
      expect(new Set(insertedRoundTypes(mocks))).toEqual(new Set(['location']));
    });

    // An explicit request must not be quietly satisfied with the other kind of round: asking for a
    // location game in a space with no GPS photos is a request that cannot be met, and silently
    // handing back date rounds would look like the type picker did nothing.
    it('rejects a location game in a space with no GPS photos, rather than substituting date rounds', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
      mocks.game.getLocationCandidates.mockResolvedValue([]);
      mocks.game.getDateCandidates.mockResolvedValue([locationCandidate('e', 41.9, 12.5, 'Italy')]);
      mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);

      await expect(sut.create(authStub, 'space-1', { roundCount: 5, type: 'location' })).rejects.toThrow(/GPS/);
      expect(mocks.game.createChallenge).not.toHaveBeenCalled();
    });

    it('still mixes both kinds by default', async () => {
      stockPools(mocks);

      await sut.create(authStub, 'space-1', { roundCount: 5 });

      expect(new Set(insertedRoundTypes(mocks))).toEqual(new Set(['location', 'date']));
    });
  });

  describe('daily challenge', () => {
    const TODAY = '2026-08-16';

    beforeEach(() => {
      vi.useFakeTimers();
      // Deliberately late in the UTC day: a daily keyed off local time would roll over to the 17th
      // for anyone east of UTC, giving members of the same space different "todays" on one board.
      vi.setSystemTime(new Date('2026-08-16T23:30:00.000Z'));
      // The daily is opt-in; every test in this block is about a space that has opted in.
      mocks.sharedSpace.getById.mockResolvedValue({ dailyChallengeEnabled: true } as any);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('generates the daily on first read, stamped with the UTC date', async () => {
      stockPools(mocks);
      mocks.game.getDailyChallenge.mockResolvedValue(void 0);
      mocks.game.getGuessesForUser.mockResolvedValue([]);
      mocks.game.getRounds.mockResolvedValue([]);

      await sut.getDaily(authStub, 'space-1');

      expect(mocks.game.createChallenge).toHaveBeenCalledWith(
        expect.objectContaining({ dailyOn: TODAY, createdById: null }),
        expect.anything(),
      );
    });

    // The seed decides which photos the day's game draws, and every member generating "first"
    // has to build the identical challenge from it. Nothing else in the system would notice its
    // shape changing, so it is pinned here exactly, the way `create`'s own seed is.
    it('seeds the daily from the space and the UTC date', async () => {
      stockPools(mocks);
      mocks.game.getDailyChallenge.mockResolvedValue(void 0);
      mocks.game.getGuessesForUser.mockResolvedValue([]);
      mocks.game.getRounds.mockResolvedValue([]);

      await sut.getDaily(authStub, 'space-1');

      expect(mocks.game.getDateCandidates).toHaveBeenCalledWith(
        'space-1',
        expect.any(Number),
        `space-1:daily:${TODAY}`,
      );
      expect(mocks.game.getLocationCandidates).toHaveBeenCalledWith(
        'space-1',
        expect.any(Number),
        `space-1:daily:${TODAY}`,
        expect.anything(),
      );
    });

    // A viewer has to be able to trigger generation: the daily belongs to the space, and whoever
    // opens the page first that day should not need the editor role to see it.
    it('lets a viewer read (and so generate) the daily', async () => {
      stockPools(mocks);
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getDailyChallenge.mockResolvedValue(void 0);
      mocks.game.getGuessesForUser.mockResolvedValue([]);
      mocks.game.getRounds.mockResolvedValue([]);

      await expect(sut.getDaily(authStub, 'space-1')).resolves.toBeDefined();
    });

    it('reuses the existing daily instead of generating a second one', async () => {
      stockPools(mocks);
      mocks.game.getDailyChallenge.mockResolvedValue({
        id: 'daily-1',
        spaceId: 'space-1',
        name: 'Daily',
        roundCount: 5,
        scaleKm: 100,
        scaleDays: 30,
        dailyOn: TODAY,
        closedAt: null,
        createdAt: new Date(),
      } as any);
      mocks.game.getGuessesForUser.mockResolvedValue([]);
      mocks.game.getRounds.mockResolvedValue([]);

      const result = await sut.getDaily(authStub, 'space-1');

      expect(result.challenge?.id).toBe('daily-1');
      expect(mocks.game.createChallenge).not.toHaveBeenCalled();
    });

    // Two members opening the page in the same second both find no daily and both generate one.
    // The partial unique index on (spaceId, dailyOn) makes the loser fail; it must then read the
    // winner's row rather than surfacing a 500, so both players get the SAME challenge.
    it('recovers from losing the generation race by re-reading the winner', async () => {
      stockPools(mocks);
      mocks.game.getDailyChallenge.mockResolvedValueOnce(void 0).mockResolvedValueOnce({
        id: 'daily-winner',
        spaceId: 'space-1',
        name: 'Daily',
        roundCount: 5,
        scaleKm: 100,
        scaleDays: 30,
        dailyOn: TODAY,
        closedAt: null,
        createdAt: new Date(),
      } as any);
      mocks.game.createChallenge.mockRejectedValue({ constraint_name: 'game_challenge_daily_uq' });
      mocks.game.getGuessesForUser.mockResolvedValue([]);
      mocks.game.getRounds.mockResolvedValue([]);

      const result = await sut.getDaily(authStub, 'space-1');

      expect(result.challenge?.id).toBe('daily-winner');
    });

    // A space with nothing playable must not 500 or 400 the whole page - the daily is simply
    // unavailable today, which the page renders as its own state.
    it('reports the daily as unavailable when the space has no usable photos', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getDailyChallenge.mockResolvedValue(void 0);
      mocks.game.getLocationCandidates.mockResolvedValue([]);
      mocks.game.getDateCandidates.mockResolvedValue([]);
      mocks.game.getRecentlyUsedAssetIds.mockResolvedValue([]);

      await expect(sut.getDaily(authStub, 'space-1')).resolves.toEqual({ challenge: null });
    });

    it('refuses to delete the daily, which is shared state rather than one member’s row', async () => {
      mocks.game.getChallenge.mockResolvedValue({ id: 'daily-1', spaceId: 'space-1', dailyOn: TODAY } as any);
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Owner } as any);

      await expect(sut.delete(authStub, 'daily-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.game.deleteChallenge).not.toHaveBeenCalled();
    });

    it('keeps the daily out of the space challenge list', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallengesForSpace.mockResolvedValue([]);
      mocks.game.getLocationRoundCounts.mockResolvedValue([]);

      await sut.list(authStub, 'space-1');

      // The exclusion belongs in the query, not in a post-filter here: a service-side filter would
      // still pay for loading every daily the space has ever had.
      expect(mocks.game.getChallengesForSpace).toHaveBeenCalledWith('space-1');
    });

    it.each([
      { state: null as boolean | null, label: 'nobody has been asked' },
      { state: false as boolean | null, label: 'an editor declined' },
    ])('generates nothing when $label', async ({ state }) => {
      stockPools(mocks);
      mocks.sharedSpace.getById.mockResolvedValue({ dailyChallengeEnabled: state } as any);

      const result = await sut.getDaily(authStub, 'space-1');

      expect(result).toEqual({ challenge: null });
      // The assertion that matters: a guard placed AFTER the lookup would satisfy the line above
      // while still generating today's daily.
      expect(mocks.game.createChallenge).not.toHaveBeenCalled();
      expect(mocks.game.getDailyChallenge).not.toHaveBeenCalled();
    });

    it('returns no daily when the space is deleted between the membership check and the read', async () => {
      stockPools(mocks);
      mocks.sharedSpace.getById.mockResolvedValue(void 0);

      // requireMember already passed, so this is a race, not an authorization failure - a 500 would
      // be wrong for a page that is about to redirect anyway.
      await expect(sut.getDaily(authStub, 'space-1')).resolves.toEqual({ challenge: null });
      expect(mocks.game.createChallenge).not.toHaveBeenCalled();
      expect(mocks.game.getDailyChallenge).not.toHaveBeenCalled();
    });
  });

  describe('leaderboard', () => {
    const challenge = {
      id: 'challenge-1',
      spaceId: 'space-1',
      roundCount: 5,
      dailyOn: null,
    };

    beforeEach(() => {
      mocks.game.getChallenge.mockResolvedValue(challenge as any);
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    });

    it('includes every member, zero-filling the ones who have not played, last', async () => {
      mocks.sharedSpace.getMembers.mockResolvedValue([
        { userId: 'user-1', name: 'Ana' },
        { userId: 'user-2', name: 'Ben' },
      ] as any);
      mocks.game.getLeaderboard.mockResolvedValue([{ userId: 'user-2', total: 4200, answered: 5 }]);

      const result = await sut.leaderboard(authStub, 'challenge-1');

      expect(result.entries).toEqual([
        { userId: 'user-2', name: 'Ben', total: 4200, answered: 5 },
        { userId: 'user-1', name: 'Ana', total: 0, answered: 0 },
      ]);
    });

    it('drops a departed member rather than naming them "Unknown"', async () => {
      mocks.sharedSpace.getMembers.mockResolvedValue([{ userId: 'user-1', name: 'Ana' }] as any);
      mocks.game.getLeaderboard.mockResolvedValue([
        { userId: 'user-1', total: 100, answered: 1 },
        { userId: 'departed-user', total: 4900, answered: 5 },
      ]);

      const result = await sut.leaderboard(authStub, 'challenge-1');

      expect(result.entries).toEqual([{ userId: 'user-1', name: 'Ana', total: 100, answered: 1 }]);
      expect(JSON.stringify(result)).not.toContain('Unknown');
    });

    it('breaks a tie on points in favour of the player who used fewer rounds', async () => {
      mocks.sharedSpace.getMembers.mockResolvedValue([
        { userId: 'user-1', name: 'Ana' },
        { userId: 'user-2', name: 'Ben' },
      ] as any);
      mocks.game.getLeaderboard.mockResolvedValue([
        { userId: 'user-1', total: 4200, answered: 5 },
        { userId: 'user-2', total: 4200, answered: 3 },
      ]);

      const result = await sut.leaderboard(authStub, 'challenge-1');

      expect(result.entries.map((entry) => entry.name)).toEqual(['Ben', 'Ana']);
    });
  });

  describe('standings', () => {
    const members = [
      { userId: 'user-1', name: 'Ana' },
      { userId: 'user-2', name: 'Ben' },
      { userId: 'user-3', name: 'Cara' },
    ];

    it('rejects a caller who is not a member of the space', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue(void 0);
      await expect(sut.standings(authStub, 'space-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('zero-fills every member who has not played, and puts them last', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.sharedSpace.getMembers.mockResolvedValue(members as any);
      mocks.game.getMonthlyStandings.mockResolvedValue([{ userId: 'user-2', total: 4200, daysPlayed: 2 }]);

      const result = await sut.standings(authStub, 'space-1');

      expect(result.entries).toEqual([
        { userId: 'user-2', name: 'Ben', total: 4200, daysPlayed: 2 },
        { userId: 'user-1', name: 'Ana', total: 0, daysPlayed: 0 },
        { userId: 'user-3', name: 'Cara', total: 0, daysPlayed: 0 },
      ]);
    });

    it('ranks a member who played and scored nothing above a member who never played', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.sharedSpace.getMembers.mockResolvedValue([members[0], members[1]] as any);
      mocks.game.getMonthlyStandings.mockResolvedValue([{ userId: 'user-2', total: 0, daysPlayed: 1 }]);

      const result = await sut.standings(authStub, 'space-1');

      expect(result.entries.map((entry) => entry.name)).toEqual(['Ben', 'Ana']);
    });

    it('drops an aggregate row for someone who has left the space', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.sharedSpace.getMembers.mockResolvedValue([members[0]] as any);
      mocks.game.getMonthlyStandings.mockResolvedValue([
        { userId: 'user-1', total: 100, daysPlayed: 1 },
        { userId: 'departed-user', total: 9000, daysPlayed: 9 },
      ]);

      const result = await sut.standings(authStub, 'space-1');

      expect(result.entries).toEqual([{ userId: 'user-1', name: 'Ana', total: 100, daysPlayed: 1 }]);
    });

    describe('UTC month boundaries', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('queries the current UTC calendar month as a half-open range and reports it', async () => {
        vi.setSystemTime(new Date('2026-08-16T12:00:00.000Z'));
        mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
        mocks.sharedSpace.getMembers.mockResolvedValue([]);
        mocks.game.getMonthlyStandings.mockResolvedValue([]);

        const result = await sut.standings(authStub, 'space-1');

        expect(mocks.game.getMonthlyStandings).toHaveBeenCalledWith('space-1', '2026-08-01', '2026-09-01');
        expect(result.month).toBe('2026-08');
      });

      it('rolls the exclusive bound into the next year in December', async () => {
        vi.setSystemTime(new Date('2026-12-31T23:59:00.000Z'));
        mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
        mocks.sharedSpace.getMembers.mockResolvedValue([]);
        mocks.game.getMonthlyStandings.mockResolvedValue([]);

        await sut.standings(authStub, 'space-1');

        expect(mocks.game.getMonthlyStandings).toHaveBeenCalledWith('space-1', '2026-12-01', '2027-01-01');
      });
    });
  });

  describe('solo play', () => {
    // A solo caller is never a space member, so nothing here stubs sharedSpace.getMember - a test
    // that only passed because a membership mock was lying about the caller's spaces would hide
    // exactly the confusion this scope exists to avoid.
    const soloAuth = { user: { id: 'user-1', name: 'Ana' } } as any;

    describe('createSolo', () => {
      // The default is the player's own library and nothing else: partner and shared-space photos
      // belong to other people, and a game must not be the surface that starts showing them
      // without being asked.
      it('draws from the player alone unless the request asks for more', async () => {
        stockSoloPools(mocks);

        await sut.createSolo(soloAuth, {});

        const sources = { userId: 'user-1', withPartners: false, withSpaces: false };
        expect(mocks.game.getSoloDateCandidates).toHaveBeenCalledWith(sources, expect.any(Number), 'user:user-1:0');
        expect(mocks.game.getSoloLocationCandidates).toHaveBeenCalledWith(
          sources,
          expect.any(Number),
          'user:user-1:0',
          expect.anything(),
        );
        // The space queries take a spaceId and apply the space predicate; reaching them from here
        // would scope the pool to the wrong thing entirely.
        expect(mocks.game.getDateCandidates).not.toHaveBeenCalled();
        expect(mocks.game.getLocationCandidates).not.toHaveBeenCalled();
      });

      // `user:` prefixed, so the solo seed space cannot collide with SpacePool's bare uuid, and
      // pinned exactly: the seed decides which slice of a large library the candidate queries
      // return, so a change to its shape silently re-rolls every future challenge.
      it('seeds from the player and how many solo challenges they already have', async () => {
        stockSoloPools(mocks);
        mocks.game.getSoloChallengeCount.mockResolvedValue(2);

        await sut.createSolo(soloAuth, {});

        expect(mocks.game.getSoloDateCandidates).toHaveBeenCalledWith(
          expect.anything(),
          expect.any(Number),
          'user:user-1:2',
        );
      });

      // Frozen onto the row, not re-read per request: a player who toggles a source off mid-game
      // would otherwise 404 every round image of a challenge already in flight.
      it('freezes the requested sources onto the challenge', async () => {
        stockSoloPools(mocks);

        await sut.createSolo(soloAuth, { sources: { includePartners: true, includeSpaces: false } });

        const [challenge] = mocks.game.createChallenge.mock.calls[0];
        expect(challenge).toEqual(
          expect.objectContaining({
            spaceId: null,
            ownerId: 'user-1',
            // Never both: ownerId already carries the authorship, and setting createdById too
            // would point two different FK actions at one row for one user-deletion event.
            createdById: null,
            includePartners: true,
            includeSpaces: false,
          }),
        );
        expect(mocks.game.getSoloDateCandidates).toHaveBeenCalledWith(
          { userId: 'user-1', withPartners: true, withSpaces: false },
          expect.any(Number),
          expect.any(String),
        );
      });

      // The default a request falls back to is the stored preference, not the own-library-only
      // constant free play used before Task 9 - proven with the toggles ON, so a leftover hardcoded
      // default could not accidentally satisfy this assertion.
      it("draws from the player's stored PhotoGuesser preference when the request does not override it", async () => {
        stockSoloPools(mocks);
        mocks.user.getMetadata.mockResolvedValue(photoGuesserMetadata(true, true));

        await sut.createSolo(soloAuth, {});

        expect(mocks.game.getSoloDateCandidates).toHaveBeenCalledWith(
          { userId: 'user-1', withPartners: true, withSpaces: true },
          expect.any(Number),
          expect.any(String),
        );
      });

      // A per-game override must never leak back into the stored preference - otherwise starting
      // one wide game would silently widen every future daily too.
      it('does not write a per-request source override back to the stored preference', async () => {
        stockSoloPools(mocks);

        await sut.createSolo(soloAuth, { sources: { includePartners: true, includeSpaces: true } });

        expect(mocks.user.upsertMetadata).not.toHaveBeenCalled();
      });

      // The row columns and the response schema are different shapes, and spreading one object
      // into both is how the toggles would reach a client that never declared them - TypeScript's
      // excess-property check does not fire on a spread.
      it('keeps the frozen source toggles out of the response', async () => {
        stockSoloPools(mocks);

        const result = await sut.createSolo(soloAuth, { sources: { includePartners: true, includeSpaces: true } });

        expect(result).not.toHaveProperty('includePartners');
        expect(result).not.toHaveProperty('includeSpaces');
        expect(result).toEqual(expect.objectContaining({ id: 'solo-1', spaceId: null, ownerId: 'user-1' }));
      });

      // A solo player may have no spaces at all, so the space wording would send them to a page
      // that does not exist for them.
      it('names the personal remedies when the player has no usable photos', async () => {
        mocks.game.getSoloChallengeCount.mockResolvedValue(0);
        mocks.game.getSoloLocationCandidates.mockResolvedValue([]);
        mocks.game.getSoloDateCandidates.mockResolvedValue([]);
        mocks.game.getSoloRecentlyUsedAssetIds.mockResolvedValue([]);
        mocks.user.getMetadata.mockResolvedValue([]);

        await expect(sut.createSolo(soloAuth, {})).rejects.toThrow(PERSONAL_NO_ROUNDS_MESSAGE.mixed);
        expect(mocks.game.createChallenge).not.toHaveBeenCalled();
      });
    });

    describe('getSoloDaily', () => {
      const TODAY = '2026-08-16';

      beforeEach(() => {
        vi.useFakeTimers();
        // Late in the UTC day, like the space daily's own tests: a daily keyed off local time
        // would roll over to the 17th for anyone east of UTC and hand them a second daily.
        vi.setSystemTime(new Date('2026-08-16T23:30:00.000Z'));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('generates the personal daily on first read, stamped with the UTC date', async () => {
        stockSoloPools(mocks);
        mocks.game.getSoloDailyChallenge.mockResolvedValue(void 0);
        mocks.game.getGuessesForUser.mockResolvedValue([]);
        mocks.game.getRounds.mockResolvedValue([]);

        await sut.getSoloDaily(soloAuth);

        expect(mocks.game.createChallenge).toHaveBeenCalledWith(
          // The source toggles are asserted here and not only in createSolo's tests: the daily
          // takes no request body, so this row is the ONLY evidence of which sources today's game
          // was frozen against. Own photos only, until a preference says otherwise - the daily is
          // generated without anyone asking for it, so it must not be the surface that starts
          // drawing on other people's libraries.
          expect.objectContaining({
            dailyOn: TODAY,
            spaceId: null,
            ownerId: 'user-1',
            createdById: null,
            includePartners: false,
            includeSpaces: false,
          }),
          expect.anything(),
        );
        // A space's daily lives under a different partial unique index and a different pool; the
        // solo path must never read or write it.
        expect(mocks.game.getDailyChallenge).not.toHaveBeenCalled();
      });

      // The daily freezes whatever the stored preference says at generation time - proven with the
      // toggles ON, so a leftover hardcoded `false` could not accidentally satisfy this assertion.
      // There is no request body to override this with: the preference is the only source of truth
      // for what the daily draws from.
      it('freezes the stored PhotoGuesser preference onto the daily row', async () => {
        stockSoloPools(mocks);
        mocks.user.getMetadata.mockResolvedValue(photoGuesserMetadata(true, true));
        mocks.game.getSoloDailyChallenge.mockResolvedValue(void 0);
        mocks.game.getGuessesForUser.mockResolvedValue([]);
        mocks.game.getRounds.mockResolvedValue([]);

        await sut.getSoloDaily(soloAuth);

        expect(mocks.game.createChallenge).toHaveBeenCalledWith(
          expect.objectContaining({ includePartners: true, includeSpaces: true }),
          expect.anything(),
        );
      });

      // Pinned for the same reason the space daily's seed is: this string decides which photos the
      // day's game draws, and nothing else in the system would notice it changing shape.
      it('seeds the personal daily from the player and the UTC date', async () => {
        stockSoloPools(mocks);
        mocks.game.getSoloDailyChallenge.mockResolvedValue(void 0);
        mocks.game.getGuessesForUser.mockResolvedValue([]);
        mocks.game.getRounds.mockResolvedValue([]);

        await sut.getSoloDaily(soloAuth);

        expect(mocks.game.getSoloDateCandidates).toHaveBeenCalledWith(
          expect.anything(),
          expect.any(Number),
          `user:user-1:daily:${TODAY}`,
        );
      });

      it('reuses the existing personal daily instead of generating a second one', async () => {
        stockSoloPools(mocks);
        mocks.game.getSoloDailyChallenge.mockResolvedValue({
          id: 'solo-daily-1',
          spaceId: null,
          ownerId: 'user-1',
          name: TODAY,
          roundCount: 5,
          scaleKm: 100,
          scaleDays: 30,
          dailyOn: TODAY,
          closedAt: null,
          createdAt: new Date(),
        } as any);
        mocks.game.getGuessesForUser.mockResolvedValue([]);
        mocks.game.getRounds.mockResolvedValue([]);

        const result = await sut.getSoloDaily(soloAuth);

        expect(result.challenge?.id).toBe('solo-daily-1');
        expect(mocks.game.createChallenge).not.toHaveBeenCalled();
      });

      // Two of the player's own devices opening the page in the same second both find no daily and
      // both generate one. game_challenge_owner_daily_uq makes the loser fail - Postgres treats
      // NULLs as distinct, so the space index does not constrain solo rows at all - and the loser
      // must then read the winner's row rather than surfacing a 500 or a second, divergent daily.
      it('recovers from losing the personal daily race by re-reading the winner', async () => {
        stockSoloPools(mocks);
        mocks.game.getSoloDailyChallenge.mockResolvedValueOnce(void 0).mockResolvedValueOnce({
          id: 'solo-daily-winner',
          spaceId: null,
          ownerId: 'user-1',
          name: TODAY,
          roundCount: 5,
          scaleKm: 100,
          scaleDays: 30,
          dailyOn: TODAY,
          closedAt: null,
          createdAt: new Date(),
        } as any);
        mocks.game.createChallenge.mockRejectedValue({ constraint_name: 'game_challenge_owner_daily_uq' });
        mocks.game.getGuessesForUser.mockResolvedValue([]);
        mocks.game.getRounds.mockResolvedValue([]);

        const result = await sut.getSoloDaily(soloAuth);

        expect(result.challenge?.id).toBe('solo-daily-winner');
      });

      // A brand new account has nothing playable, and that is an ordinary state of the page rather
      // than a failed request - the same choice the space daily makes for an empty space.
      it('reports the daily as unavailable when the player has no usable photos', async () => {
        mocks.game.getSoloChallengeCount.mockResolvedValue(0);
        mocks.game.getSoloDailyChallenge.mockResolvedValue(void 0);
        mocks.game.getSoloLocationCandidates.mockResolvedValue([]);
        mocks.game.getSoloDateCandidates.mockResolvedValue([]);
        mocks.game.getSoloRecentlyUsedAssetIds.mockResolvedValue([]);
        mocks.user.getMetadata.mockResolvedValue([]);

        await expect(sut.getSoloDaily(soloAuth)).resolves.toEqual({ challenge: null });
      });
    });

    describe('soloStats', () => {
      // Restored here rather than at the end of the one test that fakes them: a failing assertion
      // would skip an inline restore and leak frozen time into every test that follows.
      afterEach(() => {
        vi.useRealTimers();
      });

      // Which DAYS count towards a streak - only dailies with every round guessed - is the
      // repository query's rule, and is covered by the e2e suite against a real database. What is
      // testable here is the arithmetic's wiring: whose days are fetched, what "today" they are
      // measured against, and that nothing on the way out can be null.
      it('reports zeroes, never nulls, for a player who has never played', async () => {
        mocks.game.getSoloCompletedDailyDates.mockResolvedValue([]);
        mocks.game.getSoloScoreSummary.mockResolvedValue({ gamesPlayed: 0, bestScore: 0, averageScore: 0 });

        await expect(sut.soloStats(soloAuth)).resolves.toEqual({
          currentStreak: 0,
          bestStreak: 0,
          bestScore: 0,
          averageScore: 0,
          gamesPlayed: 0,
        });
      });

      // The streak is measured against the UTC day, the same boundary dailyOn is stamped with -
      // and it must survive a today that has not been played yet, or every player would watch
      // their streak read 0 from midnight until they got round to playing.
      it("counts the streak against the UTC day, and keeps it alive before today's daily is played", async () => {
        vi.useFakeTimers();
        // Late in the UTC day, like the daily's own tests: a local-day "today" would already be the
        // 20th for anyone east of UTC and break the streak a day early.
        vi.setSystemTime(new Date('2026-08-19T23:30:00.000Z'));
        mocks.game.getSoloCompletedDailyDates.mockResolvedValue(['2026-08-17', '2026-08-18']);
        mocks.game.getSoloScoreSummary.mockResolvedValue({ gamesPlayed: 2, bestScore: 4000, averageScore: 3500 });

        const result = await sut.soloStats(soloAuth);

        expect(result.currentStreak).toBe(2);
        expect(result.bestStreak).toBe(2);
        expect(mocks.game.getSoloCompletedDailyDates).toHaveBeenCalledWith('user-1');
        // The sibling call: soloStats reads two repository methods for the SAME caller, and only
        // one of the two ids being pinned would let a wrong id on this call slip through unit
        // tests entirely - it would surface only in e2e, which cannot run against this branch.
        expect(mocks.game.getSoloScoreSummary).toHaveBeenCalledWith('user-1');
      });

      // Rounds are scored in whole points, so an average is the only fractional number the panel
      // could ever show - and it would show all seventeen digits of it.
      it('rounds the average to whole points', async () => {
        mocks.game.getSoloCompletedDailyDates.mockResolvedValue([]);
        mocks.game.getSoloScoreSummary.mockResolvedValue({
          gamesPlayed: 3,
          bestScore: 4500,
          // The repeating decimal a real average produces, computed rather than written out - the
          // point is that it reaches the panel as whole points.
          averageScore: 12_637 / 3,
        });

        await expect(sut.soloStats(soloAuth)).resolves.toEqual(
          expect.objectContaining({ averageScore: 4212, bestScore: 4500, gamesPlayed: 3 }),
        );
      });
    });

    describe('soloHistory', () => {
      // One row past the page is what answers hasNextPage; a client that trusted a full page as
      // "there is more" would offer a next page that turns out to be empty, and one that trusted a
      // short page would hide the last row of a page-sized history.
      it('fetches one row past the page and reports whether another follows', async () => {
        mocks.game.getSoloHistory.mockResolvedValue([
          historyRow('game-3'),
          historyRow('game-2'),
          historyRow('game-1', { dailyOn: '2026-08-17', answered: 2, total: 900 }),
        ] as any);

        const result = await sut.soloHistory(soloAuth, { page: 2, size: 2 });

        expect(mocks.game.getSoloHistory).toHaveBeenCalledWith('user-1', { skip: 2, take: 3 });
        expect(result.items.map((item) => item.id)).toEqual(['game-3', 'game-2']);
        expect(result.hasNextPage).toBe(true);
        expect(result.items[0]).toEqual({
          id: 'game-3',
          name: 'Challenge 1',
          dailyOn: null,
          createdAt: new Date('2026-08-19T10:00:00.000Z'),
          roundCount: 5,
          answered: 5,
          total: 4000,
        });
      });

      it('reports no next page when the page is not full', async () => {
        mocks.game.getSoloHistory.mockResolvedValue([historyRow('game-1')] as any);

        const result = await sut.soloHistory(soloAuth, { page: 1, size: 2 });

        expect(result.items).toHaveLength(1);
        expect(result.hasNextPage).toBe(false);
      });

      // A stale page number in a bookmark is a well-formed request with nothing behind it, not a
      // failure - 404ing it would make an ordinary end-of-list look like a broken endpoint.
      it('returns an empty page past the end rather than an error', async () => {
        mocks.game.getSoloHistory.mockResolvedValue([]);

        await expect(sut.soloHistory(soloAuth, { page: 40, size: 20 })).resolves.toEqual({
          items: [],
          hasNextPage: false,
        });
      });
    });

    describe('scope dispatch on the shared challenge routes', () => {
      const soloChallenge = {
        id: 'solo-1',
        spaceId: null,
        ownerId: 'user-1',
        name: 'Challenge 1',
        roundCount: 1,
        scaleKm: 1000,
        scaleDays: 365,
        dailyOn: null,
        closedAt: null,
        createdAt: new Date(),
        includePartners: false,
        includeSpaces: false,
      } as any;

      const stranger = { user: { id: 'user-2', name: 'Ben' } } as any;

      // 404 and not 403: a 403 confirms the id exists, an enumeration leak the space routes
      // already avoid. The membership assertion is the other half - a challenge with no space
      // must not fall through to a membership check, which would ask about a null space.
      it.each([
        ['get', (auth: any) => sut.get(auth, 'solo-1')],
        ['guess', (auth: any) => sut.guess(auth, 'solo-1', 0, { date: new Date() })],
        ['getRoundImage', (auth: any) => sut.getRoundImage(auth, 'solo-1', 0)],
        ['leaderboard', (auth: any) => sut.leaderboard(auth, 'solo-1')],
        ['delete', (auth: any) => sut.delete(auth, 'solo-1')],
      ])("404s a stranger on %s of someone else's solo challenge", async (_name, call) => {
        mocks.game.getChallenge.mockResolvedValue(soloChallenge);
        // Everything downstream of the gate is stubbed to SUCCEED, so a gate that let the stranger
        // through would return a result rather than failing for some unrelated reason - without
        // this, four of these five pass on an unstubbed round lookup whether the gate exists or not.
        mocks.game.getRound.mockResolvedValue({
          id: 'r0',
          challengeId: 'solo-1',
          index: 0,
          type: 'date',
          answerLat: null,
          answerLon: null,
          answerDate: new Date(),
          assetId: 'asset-1',
        } as any);
        mocks.game.createGuess.mockImplementation((guess: any) => guess);
        mocks.game.getRounds.mockResolvedValue([]);
        mocks.game.getGuessesForUser.mockResolvedValue([]);
        mocks.game.getSoloEligibleRoundAsset.mockResolvedValue({ previewPath: '/thumbs/a_preview.jpeg' } as any);
        mocks.game.getLeaderboard.mockResolvedValue([]);

        await expect(call(stranger)).rejects.toBeInstanceOf(NotFoundException);
        expect(mocks.sharedSpace.getMember).not.toHaveBeenCalled();
        expect(mocks.game.createGuess).not.toHaveBeenCalled();
        expect(mocks.game.deleteChallenge).not.toHaveBeenCalled();
      });

      it('lets the owner read their own solo challenge', async () => {
        mocks.game.getChallenge.mockResolvedValue(soloChallenge);
        mocks.game.getRounds.mockResolvedValue([
          {
            id: 'r0',
            index: 0,
            type: 'date',
            answerLat: null,
            answerLon: null,
            answerDate: new Date(),
            assetId: 'asset-9',
          },
        ] as any);
        mocks.game.getGuessesForUser.mockResolvedValue([]);

        const result = await sut.get(soloAuth, 'solo-1');

        expect(result).toEqual(expect.objectContaining({ id: 'solo-1', spaceId: null, ownerId: 'user-1' }));
        // Still withheld: the scope decides who may read the challenge, never what a round
        // discloses before it has been guessed.
        expect(result.rounds[0].answer).toBeUndefined();
        expect(JSON.stringify(result.rounds[0])).not.toContain('asset-9');
      });

      // The round image is where freezing pays off: the pool is rebuilt from the toggles ON THE
      // ROW, so a player who has since turned partner photos off still sees the game they started.
      it('resolves a solo round image through the toggles frozen on the challenge', async () => {
        mocks.game.getChallenge.mockResolvedValue({ ...soloChallenge, includePartners: true });
        mocks.game.getRound.mockResolvedValue({ id: 'r0', index: 0, type: 'location', assetId: 'asset-1' } as any);
        mocks.game.getSoloEligibleRoundAsset.mockResolvedValue({ previewPath: '/thumbs/asset-1_preview.jpeg' } as any);

        const result = await sut.getRoundImage(soloAuth, 'solo-1', 0);

        expect(result).toEqual(
          new ImmichFileResponse({
            path: '/thumbs/asset-1_preview.jpeg',
            contentType: 'image/jpeg',
            cacheControl: CacheControl.PrivateWithCache,
            fileName: 'round-0.jpeg',
          }),
        );
        expect(mocks.game.getSoloEligibleRoundAsset).toHaveBeenCalledWith(
          { userId: 'user-1', withPartners: true, withSpaces: false },
          'asset-1',
        );
        // The space resolver applies a space predicate this row has no space for, and the
        // unscoped asset lookup applies none of the visibility floor at all.
        expect(mocks.game.getEligibleRoundAsset).not.toHaveBeenCalled();
        expect(mocks.asset.getById).not.toHaveBeenCalled();
      });

      it('404s a solo round image whose asset is no longer eligible', async () => {
        mocks.game.getChallenge.mockResolvedValue(soloChallenge);
        mocks.game.getRound.mockResolvedValue({ id: 'r0', index: 0, type: 'location', assetId: 'asset-1' } as any);
        mocks.game.getSoloEligibleRoundAsset.mockResolvedValue(void 0);

        await expect(sut.getRoundImage(soloAuth, 'solo-1', 0)).rejects.toBeInstanceOf(NotFoundException);
      });

      // One player, so the board is their own row - not an empty board, and never a space's
      // member list, which a solo challenge does not have.
      it('reports the owner alone on a solo leaderboard', async () => {
        mocks.game.getChallenge.mockResolvedValue(soloChallenge);
        mocks.game.getLeaderboard.mockResolvedValue([{ userId: 'user-1', total: 4200, answered: 5 }]);

        const result = await sut.leaderboard(soloAuth, 'solo-1');

        expect(result.entries).toEqual([{ userId: 'user-1', name: 'Ana', total: 4200, answered: 5 }]);
        expect(mocks.sharedSpace.getMembers).not.toHaveBeenCalled();
      });

      it('lets the owner delete their own solo challenge', async () => {
        mocks.game.getChallenge.mockResolvedValue(soloChallenge);

        await sut.delete(soloAuth, 'solo-1');

        expect(mocks.game.deleteChallenge).toHaveBeenCalledWith('solo-1');
      });

      // Deleting a daily would let a player re-roll a day they did not like, which is exactly what
      // a streak has to be safe from. The refusal is scope-blind by construction.
      it('refuses to delete the personal daily', async () => {
        mocks.game.getChallenge.mockResolvedValue({ ...soloChallenge, dailyOn: '2026-08-16' });

        await expect(sut.delete(soloAuth, 'solo-1')).rejects.toBeInstanceOf(BadRequestException);
        expect(mocks.game.deleteChallenge).not.toHaveBeenCalled();
      });
    });
  });

  // The space arm of requireChallengeAccess (game.service.ts) has no direct coverage above: every
  // other test in this file that reaches it stubs sharedSpace.getMember with a role that already
  // clears the gate, so a broken space branch would only be caught by the e2e suite, which does
  // not run in this environment. get and delete are the cheapest of the five gated methods to
  // prove the membership and editor checks with.
  describe('space challenge authorization', () => {
    const spaceChallenge = {
      id: 'challenge-1',
      spaceId: 'space-1',
      ownerId: null,
      name: 'Challenge 1',
      roundCount: 1,
      scaleKm: 1000,
      scaleDays: 365,
      dailyOn: null,
      closedAt: null,
      createdAt: new Date(),
    } as any;

    it('rejects a non-member reading a space challenge', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue(void 0);
      mocks.game.getChallenge.mockResolvedValue(spaceChallenge);
      // Stubbed to succeed, like the solo stranger cases above - so a gate that let the caller
      // through would return a result instead of failing downstream for an unrelated reason.
      mocks.game.getRounds.mockResolvedValue([]);
      mocks.game.getGuessesForUser.mockResolvedValue([]);

      await expect(sut.get(authStub, 'challenge-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    // `editor` is the flag that separates read access from delete access on the space arm - a
    // viewer can pass requireMember but must still fail requireEditor.
    it('rejects a viewer deleting a space challenge, because delete requires the editor role', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallenge.mockResolvedValue(spaceChallenge);

      await expect(sut.delete(authStub, 'challenge-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.game.deleteChallenge).not.toHaveBeenCalled();
    });
  });

  // `dailyOn` is the key the whole daily rests on: the streak counts off it, the two partial unique
  // indexes dedupe on it, and both clients store it as "the daily I already played today". It is a
  // `date` column, and the driver hands a `date` back as a Date at UTC MIDNIGHT (postgres.js parses
  // '2026-08-16' with `new Date(x)`) - NOT as the plain string every other test in this file stubs,
  // which is exactly why nothing here noticed that the encoder ran in the server's local zone.
  //
  // The zone is pinned through Luxon's own default rather than by poking `process.env.TZ`: that is
  // the setting `asDateString` actually reads (`DateTime.fromJSDate(date).toFormat(...)`), and `TZ`
  // is an admin-set, documented deployment option (docker/example.env), so "the server is not on
  // UTC" is an ordinary configuration rather than an exotic one.
  describe("the daily's day key on the wire", () => {
    const DAILY_ON_FROM_DRIVER = new Date('2026-08-16T00:00:00.000Z');

    beforeEach(() => {
      // West of Greenwich: local midnight of the 16th is still the 15th here, which is the
      // direction that costs a player their streak.
      Settings.defaultZone = 'America/New_York';
    });

    afterEach(() => {
      Settings.defaultZone = 'system';
    });

    it('reports a personal daily as its UTC day, not the server host zone’s day', async () => {
      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.game.getSoloDailyChallenge.mockResolvedValue({
        id: 'solo-daily-1',
        spaceId: null,
        ownerId: 'user-1',
        name: '2026-08-16',
        roundCount: 5,
        scaleKm: 100,
        scaleDays: 30,
        dailyOn: DAILY_ON_FROM_DRIVER,
        closedAt: null,
        createdAt: new Date('2026-08-16T00:00:01.000Z'),
      } as any);
      mocks.game.getGuessesForUser.mockResolvedValue([]);
      mocks.game.getRounds.mockResolvedValue([]);

      const result = await sut.getSoloDaily({ user: { id: 'user-1' } } as any);

      expect(result.challenge?.dailyOn).toBe('2026-08-16');
    });

    it('reports a space daily as its UTC day, not the server host zone’s day', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.sharedSpace.getById.mockResolvedValue({ dailyChallengeEnabled: true } as any);
      mocks.game.getDailyChallenge.mockResolvedValue({
        id: 'daily-1',
        spaceId: 'space-1',
        ownerId: null,
        name: '2026-08-16',
        roundCount: 5,
        scaleKm: 100,
        scaleDays: 30,
        dailyOn: DAILY_ON_FROM_DRIVER,
        closedAt: null,
        createdAt: new Date('2026-08-16T00:00:01.000Z'),
      } as any);
      mocks.game.getGuessesForUser.mockResolvedValue([]);
      mocks.game.getRounds.mockResolvedValue([]);

      const result = await sut.getDaily(authStub, 'space-1');

      expect(result.challenge?.dailyOn).toBe('2026-08-16');
    });

    // The detail route is the one the mobile client reads `dailyOn` off when it records "played
    // today" - a day out here and the reminder fires for a daily that is already finished.
    it('reports the challenge detail’s dailyOn as its UTC day too', async () => {
      mocks.game.getChallenge.mockResolvedValue({
        id: 'solo-daily-1',
        spaceId: null,
        ownerId: 'user-1',
        name: '2026-08-16',
        roundCount: 5,
        scaleKm: 100,
        scaleDays: 30,
        dailyOn: DAILY_ON_FROM_DRIVER,
        closedAt: null,
        createdAt: new Date('2026-08-16T00:00:01.000Z'),
        includePartners: false,
        includeSpaces: false,
      } as any);
      mocks.game.getRounds.mockResolvedValue([]);
      mocks.game.getGuessesForUser.mockResolvedValue([]);

      const result = await sut.get({ user: { id: 'user-1' } } as any, 'solo-daily-1');

      expect(result.dailyOn).toBe('2026-08-16');
    });
  });
});
