import { UserAvatarColor } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import GameLeaderboard from '$lib/components/games/game-leaderboard.svelte';
// Imported from its real .ts home, not re-exported from the .svelte module: bare `tsc --noEmit`
// cannot see a named value export re-exported from a .svelte file (see the doc comment on
// toAvatarUser itself), so a direct import from game-leaderboard.svelte would type-check under
// svelte-check but fail `pnpm check:typescript`.
import { toAvatarUser } from '$lib/utils/leaderboard';

const row = (name: string, total: number, overrides: Record<string, unknown> = {}) => ({
  user: {
    id: name.toLowerCase(),
    name,
    email: `${name.toLowerCase()}@example.com`,
    profileImagePath: '',
    avatarColor: UserAvatarColor.Primary,
    profileChangedAt: '',
  },
  total,
  detail: '5 of 5 rounds answered',
  value: `${total} pts`,
  isMe: false,
  ...overrides,
});

describe('GameLeaderboard', () => {
  it('renders one row per entry, in the order given', () => {
    render(GameLeaderboard, { rows: [row('Ana', 9100), row('Ben', 4200), row('Cara', 100)] });

    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
    expect(screen.getAllByTestId('leaderboard-row').map((el) => el.textContent)).toEqual([
      expect.stringContaining('Ana'),
      expect.stringContaining('Ben'),
      expect.stringContaining('Cara'),
    ]);
  });

  it('numbers tied totals with the same rank and skips the next', () => {
    render(GameLeaderboard, { rows: [row('Ana', 9100), row('Ben', 4200), row('Cara', 4200), row('Dee', 100)] });

    expect(screen.getAllByTestId('leaderboard-rank').map((el) => el.textContent?.trim())).toEqual(['1', '2', '2', '4']);
  });

  it("marks the viewer's own row so they can find themselves", () => {
    render(GameLeaderboard, { rows: [row('Ana', 9100), row('Ben', 4200, { isMe: true })] });

    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows[0]).not.toHaveAttribute('data-me', 'true');
    expect(rows[1]).toHaveAttribute('data-me', 'true');
  });

  it('renders an avatar for every row', () => {
    render(GameLeaderboard, { rows: [row('Ana', 9100), row('Ben', 4200)] });

    // No profileImagePath, so UserAvatar falls back to the initial.
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('gives the table an accessible name', () => {
    render(GameLeaderboard, { rows: [row('Ana', 9100)] });

    expect(screen.getByRole('table', { name: 'game_leaderboard' })).toBeInTheDocument();
  });
});

describe('toAvatarUser', () => {
  it('fills the gaps a member DTO leaves, so UserAvatar always has a full shape', () => {
    const user = toAvatarUser({ userId: 'u1', name: 'Ana', email: 'ana@example.com' } as never);

    expect(user).toEqual({
      id: 'u1',
      name: 'Ana',
      email: 'ana@example.com',
      profileImagePath: '',
      avatarColor: UserAvatarColor.Primary,
      profileChangedAt: '',
    });
  });

  it('passes profileChangedAt through, so the profile image cache-buster stays correct', () => {
    const user = toAvatarUser({
      userId: 'u1',
      name: 'Ana',
      email: 'ana@example.com',
      profileImagePath: 'upload/profile/u1.jpg',
      avatarColor: 'green',
      profileChangedAt: '2026-08-01T00:00:00.000Z',
    } as never);

    expect(user.profileChangedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(user.profileImagePath).toBe('upload/profile/u1.jpg');
    expect(user.avatarColor).toBe('green');
  });
});
