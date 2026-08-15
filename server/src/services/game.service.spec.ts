import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
});
