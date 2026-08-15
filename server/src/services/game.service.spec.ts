import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SharedSpaceRole } from 'src/enum';
import { GameService } from 'src/services/game.service';
import { newTestService, ServiceMocks } from 'test/utils';

const locationCandidate = (id: string, lat: number, lon: number, country: string) => ({
  assetId: id,
  lat,
  lon,
  takenAt: new Date(2021, 5, 1),
  country,
});

describe(GameService.name, () => {
  let sut: GameService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(GameService));
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
  });

  describe('list', () => {
    it('rejects a caller who is not a member of the space', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue(void 0);
      await expect(sut.list(authStub, 'space-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns an empty list for a space with no challenges', async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
      mocks.game.getChallengesForSpace.mockResolvedValue([]);

      const result = await sut.list(authStub, 'space-1');

      expect(result).toEqual([]);
    });

    it("annotates each challenge with the caller's own progress, not another member's", async () => {
      mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
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
});
