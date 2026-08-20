import { PersonalPool } from 'src/services/game/personal-pool';
import { describe, expect, it, vi } from 'vitest';

const repository = () =>
  ({
    getSoloChallengeCount: vi.fn().mockResolvedValue(4),
    getSoloLocationCandidates: vi.fn().mockResolvedValue([]),
    getSoloDateCandidates: vi.fn().mockResolvedValue([]),
    getSoloEligibleRoundAsset: vi.fn().mockResolvedValue({ previewPath: '/p' }),
    getSoloRecentlyUsedAssetIds: vi.fn().mockResolvedValue([]),
  }) as any;

const sources = { withPartners: true, withSpaces: false };

describe(PersonalPool.name, () => {
  it('namespaces its seed key, so it cannot collide with a space', async () => {
    // Space ids and user ids are drawn from the same uuid alphabet, and the seed decides which
    // slice of a large library every challenge draws from. A bare id here would mean one user and
    // one space could share a seed - and the day they did, nothing would report it.
    const pool = new PersonalPool(repository(), 'user-1', sources);
    expect(await pool.seedKey()).toBe('user:user-1');
    expect(await pool.challengeCount()).toBe(4);
  });

  it('phrases the no-rounds failure for a player, and points at the source toggles', () => {
    // A solo player has no space to add photos to, and turning a source on is a remedy that only
    // exists here - so this wording cannot be shared with the space pool's.
    const pool = new PersonalPool(repository(), 'user-1', sources);
    for (const type of ['mixed', 'location', 'date'] as const) {
      expect(pool.noRoundsMessage(type), 'the space wording leaked into the solo pool').not.toContain('This space');
      expect(pool.noRoundsMessage(type), 'the remedy the player actually has is not mentioned').toContain(
        'when you start a game',
      );
    }
    expect(pool.noRoundsMessage('location')).toContain('GPS');
    expect(pool.noRoundsMessage('date')).toContain('capture date');
  });

  it('passes the frozen source toggles into every scoped query', async () => {
    // The toggles decide which read arms the SQL emits. A pool that dropped them on the way
    // through would silently fall back to whatever the repository defaults to, which for the
    // round-image query means either serving a photo the player never opted into or refusing one
    // they did.
    const repo = repository();
    const pool = new PersonalPool(repo, 'user-1', sources);
    const scoped = { userId: 'user-1', withPartners: true, withSpaces: false };

    await pool.locationCandidates(200, 'user:user-1:4');
    await pool.dateCandidates(200, 'user:user-1:4');
    await pool.resolveRoundAsset('asset-1');
    await pool.recentlyUsedAssetIds(3);

    expect(repo.getSoloLocationCandidates).toHaveBeenCalledWith(scoped, 200, 'user:user-1:4', undefined);
    expect(repo.getSoloDateCandidates).toHaveBeenCalledWith(scoped, 200, 'user:user-1:4');
    expect(repo.getSoloEligibleRoundAsset).toHaveBeenCalledWith(scoped, 'asset-1');
    // Recently-used is scoped by who OWNS the challenges, not by which photos they may see.
    expect(repo.getSoloRecentlyUsedAssetIds).toHaveBeenCalledWith('user-1', 3);
  });
});
