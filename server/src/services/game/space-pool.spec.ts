import { SpacePool } from 'src/services/game/space-pool';
import { describe, expect, it, vi } from 'vitest';

const repository = () =>
  ({
    getChallengesForSpace: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
    getLocationCandidates: vi.fn().mockResolvedValue([]),
    getDateCandidates: vi.fn().mockResolvedValue([]),
    getEligibleRoundAsset: vi.fn().mockResolvedValue({ previewPath: '/p' }),
    getRecentlyUsedAssetIds: vi.fn().mockResolvedValue([]),
  }) as any;

describe(SpacePool.name, () => {
  it('keeps the exact seed key the space game already uses', async () => {
    // Byte-for-byte, not merely "some stable string": the seed drives which slice of a large
    // space the candidate queries return, so changing its shape silently re-rolls every future
    // challenge in every existing space.
    const pool = new SpacePool(repository(), 'space-1');
    expect(await pool.seedKey()).toBe('space-1');
    expect(await pool.challengeCount()).toBe(2);
  });

  it('phrases the no-rounds failure in terms of the space', () => {
    const pool = new SpacePool(repository(), 'space-1');
    expect(pool.noRoundsMessage('location')).toContain('GPS');
    expect(pool.noRoundsMessage('location')).toContain('space');
    expect(pool.noRoundsMessage('date')).toContain('capture date');
  });

  it('scopes every repository call to its space', async () => {
    const repo = repository();
    const pool = new SpacePool(repo, 'space-1');

    await pool.locationCandidates(200, 'space-1:2');
    await pool.dateCandidates(200, 'space-1:2');
    await pool.resolveRoundAsset('asset-1');
    await pool.recentlyUsedAssetIds(3);

    expect(repo.getLocationCandidates).toHaveBeenCalledWith('space-1', 200, 'space-1:2', undefined);
    expect(repo.getDateCandidates).toHaveBeenCalledWith('space-1', 200, 'space-1:2');
    expect(repo.getEligibleRoundAsset).toHaveBeenCalledWith('space-1', 'asset-1');
    expect(repo.getRecentlyUsedAssetIds).toHaveBeenCalledWith('space-1', 3);
  });
});
