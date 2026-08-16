import { render, screen } from '@testing-library/svelte';
import GameLeaderboard from '$lib/components/games/game-leaderboard.svelte';

describe('GameLeaderboard', () => {
  const base = { roundCount: 5 };

  it("renders one row per entry, with each entry's own name", () => {
    render(GameLeaderboard, {
      ...base,
      entries: [
        { userId: 'u1', name: 'Alice', total: 4200, answered: 5 },
        { userId: 'u2', name: 'Bob', total: 3100, answered: 4 },
        { userId: 'u3', name: 'Carol', total: 900, answered: 2 },
      ],
    });

    expect(screen.getByTestId('game-leaderboard')).toBeInTheDocument();
    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  // The server hardcodes 'Unknown' for a departed member (game.service.ts) - name is non-nullable
  // end to end (GameLeaderboardResponseDto, the SDK type), so there is no null-name case for the
  // client to fall back on. This just proves that hardcoded name renders as-is, like any other.
  it("renders the server's own placeholder name for a departed member as-is", () => {
    render(GameLeaderboard, {
      ...base,
      entries: [{ userId: 'u1', name: 'Unknown', total: 500, answered: 1 }],
    });

    expect(screen.getByTestId('leaderboard-row')).toHaveTextContent('Unknown');
  });
});
