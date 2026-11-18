import SoloHistory from '#lib/components/games/solo-history.svelte';
import type { GameSoloHistoryItemResponseDto } from '@immich/sdk';
import { init, register, waitLocale } from 'svelte-i18n';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

describe('SoloHistory', () => {
  beforeAll(async () => {
    register('en-US', () => import('#i18n/en.json'));
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

  it('lists a game with its score and how much of it was played, linking to the game itself', async () => {
    await render(SoloHistory, { ...base, items: [makeItem()] });

    const row = page.getByTestId('solo-history-row-challenge-1').element();
    expect(row).toHaveAttribute('href', '/photoguesser/challenge-1');
    expect(row.textContent).toContain('Challenge 3');
    expect(row.textContent).toContain('5 of 5 rounds answered');
    expect(row.textContent).toContain('18,420 pts');
  });

  // A daily's `name` is its raw UTC date - the server stores it only to keep the column non-null -
  // so a history list titled from it would read as ten rows of "2026-08-19" in every language.
  // The date still has to appear somewhere, or every daily row looks identical.
  it('titles a daily with the localized daily label and dates it from its own day', async () => {
    await render(SoloHistory, { ...base, items: [makeItem({ name: '2026-08-19', dailyOn: '2026-08-19' })] });

    const row = page.getByTestId('solo-history-row-challenge-1').element();
    expect(row.textContent).toContain('Daily challenge');
    expect(row.textContent).toContain('Aug 19, 2026');
    expect(row.textContent).not.toContain('2026-08-19');
  });

  it('shows the empty state when no game has been played', async () => {
    await render(SoloHistory, { ...base, items: [] });

    expect(page.getByTestId('solo-history-empty').element().textContent).toContain('No games played yet');
  });

  // hasNextPage is the only signal that history is truncated; without a control the player simply
  // never sees anything past the first page.
  it('offers to load the next page only when one follows', async () => {
    const onLoadMore = vi.fn();
    await render(SoloHistory, { ...base, items: [makeItem()], hasNextPage: true, onLoadMore });

    await userEvent.click(page.getByTestId('solo-history-load-more').element());

    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('hides the load-more control on the last page', async () => {
    await render(SoloHistory, { ...base, items: [makeItem()], hasNextPage: false });

    // Deliberate absence: the list itself must still be there, so this cannot pass vacuously.
    expect(page.getByTestId('solo-history-list').element()).toBeInTheDocument();
    expect(page.getByTestId('solo-history-load-more').query()).toBeNull();
  });

  it('lists every game newest-first, in the order the server returned them', async () => {
    await render(SoloHistory, {
      ...base,
      items: [makeItem({ id: 'newer', name: 'Challenge 4' }), makeItem({ id: 'older', name: 'Challenge 3' })],
    });

    const rows = page.getByTestId('solo-history-list').getByRole('link').elements() as HTMLElement[];
    expect(rows.map((row) => row.dataset.testid)).toEqual(['solo-history-row-newer', 'solo-history-row-older']);
  });
});
