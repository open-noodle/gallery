import type { GameSoloStatsResponseDto } from '@immich/sdk';
import { render, screen, within } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import SoloStats from '$lib/components/games/solo-stats.svelte';

describe('SoloStats', () => {
  // Real English rather than the key fallback: the whole point of this panel is that the two
  // streak labels say "daily" and the other three do not, which the raw keys would hide.
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
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

  const tile = (name: string) => screen.getByTestId(`solo-stat-${name}`);

  it('shows every statistic next to its own label', () => {
    render(SoloStats, { stats: makeStats() });

    expect(tile('current-streak')).toHaveTextContent('Daily streak');
    expect(tile('current-streak')).toHaveTextContent('3');
    expect(tile('best-streak')).toHaveTextContent('Best daily streak');
    expect(tile('best-streak')).toHaveTextContent('7');
    expect(tile('best-score')).toHaveTextContent('Best score');
    expect(tile('best-score')).toHaveTextContent('18,420');
    expect(tile('average-score')).toHaveTextContent('Average score');
    expect(tile('average-score')).toHaveTextContent('2,100');
    expect(tile('games-played')).toHaveTextContent('Games played');
    expect(tile('games-played')).toHaveTextContent('12');
  });

  // The server returns zeroes, never nulls, for a player with no games - so the panel has nothing
  // to special-case, and a blank tile here would be the client inventing an empty state the data
  // does not have.
  it('renders zeroes rather than blanks for a player who has never played', () => {
    render(SoloStats, {
      stats: makeStats({ currentStreak: 0, bestStreak: 0, bestScore: 0, averageScore: 0, gamesPlayed: 0 }),
    });

    for (const name of ['current-streak', 'best-streak', 'best-score', 'average-score', 'games-played']) {
      expect(tile(name)).toHaveTextContent('0');
    }
  });

  // The streaks count only fully played DAILIES; the other three count every game with a guess in
  // it, free play included. Five identical tiles in one grid would claim they measure the same
  // games - which is the support ticket this split exists to prevent.
  it('keeps the daily-only streaks in a separate group from the all-games totals', () => {
    render(SoloStats, { stats: makeStats() });

    const daily = screen.getByTestId('solo-stats-daily');
    expect(daily).toHaveTextContent('Daily challenge');
    expect(within(daily).getByTestId('solo-stat-current-streak')).toBeInTheDocument();
    expect(within(daily).getByTestId('solo-stat-best-streak')).toBeInTheDocument();

    const all = screen.getByTestId('solo-stats-all');
    expect(all).toHaveTextContent('All games');
    expect(within(all).getByTestId('solo-stat-best-score')).toBeInTheDocument();
    expect(within(all).getByTestId('solo-stat-average-score')).toBeInTheDocument();
    expect(within(all).getByTestId('solo-stat-games-played')).toBeInTheDocument();

    // Deliberate absence: a streak that also appeared under "All games" would undo the split.
    expect(within(all).queryByTestId('solo-stat-current-streak')).toBeNull();
    expect(within(all).queryByTestId('solo-stat-best-streak')).toBeNull();
  });
});
