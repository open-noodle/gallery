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

  // The server deliberately returns name: null for a departed member so the client localises the
  // fallback. Proves the negative honestly: the positive case above shows a name CAN render as
  // itself, so this row rendering the fallback key (not the literal string "null") is a real
  // signal, not an always-empty query.
  it('renders a fallback for a departed member instead of the literal string "null"', () => {
    render(GameLeaderboard, {
      ...base,
      entries: [{ userId: 'u1', name: null, total: 500, answered: 1 }],
    });

    const row = screen.getByTestId('leaderboard-row');
    expect(row).not.toHaveTextContent('null');
    // $t() is untranslated in this test environment (no locale catalog is loaded), so the
    // fallback resolves to the raw i18n key rather than its English text ("Unknown").
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});
