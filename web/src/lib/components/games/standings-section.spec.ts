import type { SharedSpaceMemberResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import StandingsSection from '$lib/components/games/standings-section.svelte';

const members = [
  { userId: 'u1', name: 'Ana', email: 'ana@example.com' },
  { userId: 'u2', name: 'Ben', email: 'ben@example.com' },
  { userId: 'u3', name: 'Kim', email: 'kim@example.com' },
] as SharedSpaceMemberResponseDto[];

const base = {
  members,
  currentUserId: 'u2',
  today: {
    roundCount: 5,
    entries: [
      { userId: 'u1', name: 'Ana', total: 21_400, answered: 5 },
      { userId: 'u2', name: 'Ben', total: 18_420, answered: 5 },
      { userId: 'u3', name: 'Kim', total: 0, answered: 0 },
    ],
  },
  month: {
    month: '2026-08',
    entries: [
      { userId: 'u1', name: 'Ana', total: 59_920, daysPlayed: 14 },
      { userId: 'u2', name: 'Ben', total: 48_120, daysPlayed: 12 },
      { userId: 'u3', name: 'Kim', total: 0, daysPlayed: 0 },
    ],
  },
};

describe('StandingsSection', () => {
  it("opens on today's board", () => {
    render(StandingsSection, base);

    expect(screen.getByTestId('standings-tab-today')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('standings-tab-month')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
    // getAllByText, not getByText: Ana and Ben both answered 5 of 5 rounds, so their detail cells
    // render identical text (the raw key here, "5 of 5 rounds answered" under a real locale) -
    // getByText's single-match assertion would throw on that duplicate either way.
    expect(screen.getAllByText('game_rounds_answered')).toHaveLength(2);
  });

  it('swaps to the monthly board and shows days played', async () => {
    render(StandingsSection, base);

    await fireEvent.click(screen.getByTestId('standings-tab-month'));

    expect(screen.getByTestId('standings-tab-month')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
    // A substring match, not an exact one: the monthly detail cell joins the days-played and
    // average keys into one string, so getByText('game_days_played') would find nothing.
    expect(screen.getAllByTestId('leaderboard-row')[0]).toHaveTextContent(/game_days_played.*game_average_points/);
  });

  it('shows a dash for a member who has not played, on either tab', async () => {
    render(StandingsSection, base);

    const kimToday = screen.getAllByTestId('leaderboard-row')[2];
    expect(kimToday).toHaveTextContent('Kim');
    expect(kimToday).toHaveTextContent('—');

    await fireEvent.click(screen.getByTestId('standings-tab-month'));
    expect(screen.getAllByTestId('leaderboard-row')[2]).toHaveTextContent('—');
  });

  it("marks the viewer's own row", () => {
    render(StandingsSection, base);

    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows[1]).toHaveAttribute('data-me', 'true');
    expect(rows[0]).not.toHaveAttribute('data-me', 'true');
  });

  it('renders the month board alone, with no tabs, when there is no daily today', () => {
    render(StandingsSection, { ...base, today: null });

    expect(screen.queryByTestId('standings-tab-today')).not.toBeInTheDocument();
    expect(screen.queryByTestId('standings-tab-month')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
  });

  it('shows every member at zero on an untouched month rather than an empty state', async () => {
    render(StandingsSection, {
      ...base,
      month: {
        month: '2026-08',
        entries: [
          { userId: 'u1', name: 'Ana', total: 0, daysPlayed: 0 },
          { userId: 'u2', name: 'Ben', total: 0, daysPlayed: 0 },
          { userId: 'u3', name: 'Kim', total: 0, daysPlayed: 0 },
        ],
      },
    });

    await fireEvent.click(screen.getByTestId('standings-tab-month'));

    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
  });
});
