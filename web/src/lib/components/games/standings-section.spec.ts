import StandingsSection from '#lib/components/games/standings-section.svelte';
import type { SharedSpaceMemberResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

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
  it("opens on today's board", async () => {
    await render(StandingsSection, base);

    expect(page.getByTestId('standings-tab-today').element()).toHaveAttribute('aria-pressed', 'true');
    expect(page.getByTestId('standings-tab-month').element()).toHaveAttribute('aria-pressed', 'false');
    expect(page.getByTestId('leaderboard-row').elements()).toHaveLength(3);
    // getAllByText, not getByText: Ana and Ben both answered 5 of 5 rounds, so their detail cells
    // render identical text (the raw key here, "5 of 5 rounds answered" under a real locale) -
    // getByText's single-match assertion would throw on that duplicate either way.
    expect(page.getByText('game_rounds_answered').elements()).toHaveLength(2);
  });

  it('swaps to the monthly board and shows days played', async () => {
    await render(StandingsSection, base);

    await userEvent.click(page.getByTestId('standings-tab-month').element());

    expect(page.getByTestId('standings-tab-month').element()).toHaveAttribute('aria-pressed', 'true');
    expect(page.getByTestId('leaderboard-row').elements()).toHaveLength(3);
    // A substring match, not an exact one: the monthly detail cell joins the days-played and
    // average keys into one string, so getByText('game_days_played') would find nothing.
    expect(page.getByTestId('leaderboard-row').elements()[0].textContent).toMatch(
      /game_days_played.*game_average_points/,
    );
  });

  it('shows a dash for a member who has not played, on either tab', async () => {
    await render(StandingsSection, base);

    const kimToday = page.getByTestId('leaderboard-row').elements()[2];
    expect(kimToday.textContent).toContain('Kim');
    expect(kimToday.textContent).toContain('—');

    await userEvent.click(page.getByTestId('standings-tab-month').element());
    expect(page.getByTestId('leaderboard-row').elements()[2].textContent).toContain('—');
  });

  it("marks the viewer's own row", async () => {
    await render(StandingsSection, base);

    const rows = page.getByTestId('leaderboard-row').elements();
    expect(rows[1]).toHaveAttribute('data-me', 'true');
    expect(rows[0]).not.toHaveAttribute('data-me', 'true');
  });

  it('renders the month board alone, with no tabs, when there is no daily today', async () => {
    await render(StandingsSection, { ...base, today: null });

    expect(page.getByTestId('standings-tab-today').query()).not.toBeInTheDocument();
    expect(page.getByTestId('standings-tab-month').query()).not.toBeInTheDocument();
    expect(page.getByTestId('leaderboard-row').elements()).toHaveLength(3);
  });

  it('shows every member at zero on an untouched month rather than an empty state', async () => {
    await render(StandingsSection, {
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

    await userEvent.click(page.getByTestId('standings-tab-month').element());

    expect(page.getByTestId('leaderboard-row').elements()).toHaveLength(3);
  });
});
