import SoloStats from '#lib/components/games/solo-stats.svelte';
import type { GameSoloStatsResponseDto } from '@immich/sdk';
import { init, register, waitLocale } from 'svelte-i18n';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

describe('SoloStats', () => {
  // Real English rather than the key fallback: the whole point of this panel is that the two
  // streak labels say "daily" and the other three do not, which the raw keys would hide.
  beforeAll(async () => {
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  const makeStats = (overrides: Partial<GameSoloStatsResponseDto> = {}): GameSoloStatsResponseDto => ({
    currentStreak: 3,
    bestStreak: 7,
    bestScore: 18_420,
    averageScore: 2100,
    gamesPlayed: 12,
    ...overrides,
  });

  const tile = (name: string) => page.getByTestId(`solo-stat-${name}`).element();

  it('shows every statistic next to its own label', async () => {
    await render(SoloStats, { stats: makeStats() });

    expect(tile('current-streak').textContent).toContain('Daily streak');
    expect(tile('current-streak').textContent).toContain('3');
    expect(tile('best-streak').textContent).toContain('Best daily streak');
    expect(tile('best-streak').textContent).toContain('7');
    expect(tile('best-score').textContent).toContain('Best score');
    expect(tile('best-score').textContent).toContain('18,420');
    expect(tile('average-score').textContent).toContain('Average score');
    expect(tile('average-score').textContent).toContain('2,100');
    expect(tile('games-played').textContent).toContain('Games played');
    expect(tile('games-played').textContent).toContain('12');
  });

  // The server returns zeroes, never nulls, for a player with no games - so the panel has nothing
  // to special-case, and a blank tile here would be the client inventing an empty state the data
  // does not have.
  it('renders zeroes rather than blanks for a player who has never played', async () => {
    await render(SoloStats, {
      stats: makeStats({ currentStreak: 0, bestStreak: 0, bestScore: 0, averageScore: 0, gamesPlayed: 0 }),
    });

    for (const name of ['current-streak', 'best-streak', 'best-score', 'average-score', 'games-played']) {
      expect(tile(name).textContent).toContain('0');
    }
  });

  // The streaks count only fully played DAILIES; the other three count every game with a guess in
  // it, free play included. Five identical tiles in one grid would claim they measure the same
  // games - which is the support ticket this split exists to prevent.
  it('keeps the daily-only streaks in a separate group from the all-games totals', async () => {
    await render(SoloStats, { stats: makeStats() });

    const daily = page.getByTestId('solo-stats-daily').element();
    expect(daily.textContent).toContain('Daily challenge');
    expect(page.elementLocator(daily).getByTestId('solo-stat-current-streak').element()).toBeInTheDocument();
    expect(page.elementLocator(daily).getByTestId('solo-stat-best-streak').element()).toBeInTheDocument();

    const all = page.getByTestId('solo-stats-all').element();
    expect(all.textContent).toContain('All games');
    expect(page.elementLocator(all).getByTestId('solo-stat-best-score').element()).toBeInTheDocument();
    expect(page.elementLocator(all).getByTestId('solo-stat-average-score').element()).toBeInTheDocument();
    expect(page.elementLocator(all).getByTestId('solo-stat-games-played').element()).toBeInTheDocument();

    // Deliberate absence: a streak that also appeared under "All games" would undo the split.
    expect(page.elementLocator(all).getByTestId('solo-stat-current-streak').query()).toBeNull();
    expect(page.elementLocator(all).getByTestId('solo-stat-best-streak').query()).toBeNull();
  });
});
