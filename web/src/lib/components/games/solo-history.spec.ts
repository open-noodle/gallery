import type { GameSoloHistoryItemResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import SoloHistory from '$lib/components/games/solo-history.svelte';

describe('SoloHistory', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  const makeItem = (overrides: Partial<GameSoloHistoryItemResponseDto> = {}): GameSoloHistoryItemResponseDto => ({
    id: 'challenge-1',
    name: 'Challenge 3',
    dailyOn: null,
    roundCount: 5,
    answered: 5,
    total: 18_420,
    createdAt: '2026-08-19T09:00:00.000Z',
    ...overrides,
  });

  const base = { hasNextPage: false, loading: false, onLoadMore: () => {} };

  it('lists a game with its score and how much of it was played, linking to the game itself', () => {
    render(SoloHistory, { ...base, items: [makeItem()] });

    const row = screen.getByTestId('solo-history-row-challenge-1');
    expect(row).toHaveAttribute('href', '/photoguesser/challenge-1');
    expect(row).toHaveTextContent('Challenge 3');
    expect(row).toHaveTextContent('5 of 5 rounds answered');
    expect(row).toHaveTextContent('18,420 pts');
  });

  // A daily's `name` is its raw UTC date - the server stores it only to keep the column non-null -
  // so a history list titled from it would read as ten rows of "2026-08-19" in every language.
  // The date still has to appear somewhere, or every daily row looks identical.
  it('titles a daily with the localized daily label and dates it from its own day', () => {
    render(SoloHistory, { ...base, items: [makeItem({ name: '2026-08-19', dailyOn: '2026-08-19' })] });

    const row = screen.getByTestId('solo-history-row-challenge-1');
    expect(row).toHaveTextContent('Daily challenge');
    expect(row).toHaveTextContent('Aug 19, 2026');
    expect(row).not.toHaveTextContent('2026-08-19');
  });

  it('shows the empty state when no game has been played', () => {
    render(SoloHistory, { ...base, items: [] });

    expect(screen.getByTestId('solo-history-empty')).toHaveTextContent('No games played yet');
  });

  // hasNextPage is the only signal that history is truncated; without a control the player simply
  // never sees anything past the first page.
  it('offers to load the next page only when one follows', async () => {
    const onLoadMore = vi.fn();
    render(SoloHistory, { ...base, items: [makeItem()], hasNextPage: true, onLoadMore });

    await fireEvent.click(screen.getByTestId('solo-history-load-more'));

    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('hides the load-more control on the last page', () => {
    render(SoloHistory, { ...base, items: [makeItem()], hasNextPage: false });

    // Deliberate absence: the list itself must still be there, so this cannot pass vacuously.
    expect(screen.getByTestId('solo-history-list')).toBeInTheDocument();
    expect(screen.queryByTestId('solo-history-load-more')).toBeNull();
  });

  it('lists every game newest-first, in the order the server returned them', () => {
    render(SoloHistory, {
      ...base,
      items: [makeItem({ id: 'newer', name: 'Challenge 4' }), makeItem({ id: 'older', name: 'Challenge 3' })],
    });

    const rows = within(screen.getByTestId('solo-history-list')).getAllByRole('link');
    expect(rows.map((row) => row.dataset.testid)).toEqual(['solo-history-row-newer', 'solo-history-row-older']);
  });
});
