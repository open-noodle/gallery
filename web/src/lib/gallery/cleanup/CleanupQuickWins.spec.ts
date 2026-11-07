import CleanupQuickWins from '#lib/gallery/cleanup/CleanupQuickWins.svelte';
import { CleanupCountQueue } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

const loaded = {
  [CleanupCountQueue.SpaceHogs]: { count: 12, bytes: 5_000_000_000 },
  [CleanupCountQueue.Bursts]: { count: 40, bytes: 300_000_000 },
  [CleanupCountQueue.Screenshots]: { count: 7, bytes: 10_000_000, analysedPercent: 100 },
  [CleanupCountQueue.Duplicates]: { count: 3, bytes: 20_000_000 },
  [CleanupCountQueue.Blurry]: { count: 9, bytes: 40_000_000, analysedPercent: 72 },
};

const stubReducedMotion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }));

describe('CleanupQuickWins', () => {
  // Counts tween to their value; reduced motion makes them land at once so the text can be read.
  beforeEach(() => stubReducedMotion(true));
  afterEach(() => vi.unstubAllGlobals());

  it('renders the five queues in the mockup order', async () => {
    await render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    const rows = page.getByTestId(/^cleanup-queue-(?!skeleton)/).elements();
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      'cleanup-queue-space_hogs',
      'cleanup-queue-bursts',
      'cleanup-queue-screenshots',
      'cleanup-queue-duplicates',
      'cleanup-queue-blurry',
    ]);
  });

  it('shows analysis progress only while a pixel queue is still being analysed', async () => {
    await render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    await expect.element(page.getByTestId('cleanup-queue-blurry').getByText('cleanup_analysing_percent')).toBeVisible();
    await expect
      .element(page.getByTestId('cleanup-queue-screenshots').getByText('cleanup_analysing_percent'))
      .not.toBeInTheDocument();
  });

  it('gives each count the unit the mockup shows', async () => {
    await render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    const row = (queue: string) => page.getByTestId(`cleanup-queue-${queue}`);
    await expect.element(row('space_hogs').getByText('cleanup_queue_count_files')).toBeVisible();
    await expect.element(row('bursts').getByText('cleanup_up_to_count')).toBeVisible();
    await expect.element(row('screenshots').getByText('7')).toBeVisible();
    await expect.element(row('duplicates').getByText('cleanup_queue_count_groups')).toBeVisible();
    // blurry is still being analysed, so its count is partial
    await expect.element(row('blurry').getByText('cleanup_queue_count_so_far')).toBeVisible();
    expect(row('space_hogs').getByText('cleanup_up_to_count').query()).toBeNull();
  });

  it('shows a plain count for blurry once analysis has covered the library', async () => {
    await render(CleanupQuickWins, {
      counts: { ...loaded, [CleanupCountQueue.Blurry]: { count: 9, bytes: 1, analysedPercent: 100 } },
      onEmptyTrash: vi.fn(),
    });

    await expect.element(page.getByTestId('cleanup-queue-blurry').getByText('9')).toBeVisible();
  });

  it('links each queue to its page, and duplicates to the duplicates utility', async () => {
    await render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    await expect.element(page.getByTestId('cleanup-queue-duplicates')).toHaveAttribute('href', '/utilities/duplicates');
    await expect
      .element(page.getByTestId('cleanup-queue-space_hogs'))
      .toHaveAttribute('href', '/utilities/cleanup/space-hogs');
    await expect.element(page.getByTestId('cleanup-queue-blurry')).toHaveAttribute('href', '/utilities/cleanup/blurry');
  });

  it('shows a skeleton for a queue whose count is still loading', async () => {
    await render(CleanupQuickWins, {
      counts: { ...loaded, [CleanupCountQueue.Bursts]: undefined },
      onEmptyTrash: vi.fn(),
    });

    const skeletons = page.getByTestId('cleanup-queue-skeleton').elements();
    expect(skeletons).toHaveLength(1);
    // The skeleton is an empty, CSS-sized bar; unit tests load no Tailwind, so it has no box to be visible in.
    await expect
      .element(page.getByTestId('cleanup-queue-bursts').getByTestId('cleanup-queue-skeleton'))
      .toBeInTheDocument();
  });

  it('empties the trash from the footer', async () => {
    const onEmptyTrash = vi.fn();
    await render(CleanupQuickWins, { counts: loaded, trash: { count: 4, bytes: 1_000_000 }, onEmptyTrash });

    await expect.element(page.getByText('cleanup_trash_holds')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'cleanup_trash_empty' }));
    expect(onEmptyTrash).toHaveBeenCalledOnce();
  });

  it('hides the trash footer when the trash is turned off', async () => {
    await render(CleanupQuickWins, {
      counts: loaded,
      trash: { count: 0, bytes: 0 },
      showTrash: false,
      onEmptyTrash: vi.fn(),
    });

    expect(page.getByTestId('cleanup-trash-footer').query()).toBeNull();
    await expect.element(page.getByTestId('cleanup-queue-space_hogs')).toBeVisible();
  });

  it('shows "All clear" on a queue with nothing in it, still linking to its page', async () => {
    await render(CleanupQuickWins, {
      counts: { ...loaded, [CleanupCountQueue.Screenshots]: { count: 0, bytes: 0, analysedPercent: 100 } },
      onEmptyTrash: vi.fn(),
    });

    const card = page.getByTestId('cleanup-queue-screenshots');
    await expect.element(card).toHaveAttribute('data-state', 'clear');
    await expect.element(card.getByText('cleanup_all_clear')).toBeVisible();
    await expect.element(card).toHaveAttribute('href', '/utilities/cleanup/screenshots');
    await expect.element(page.getByTestId('cleanup-queue-blurry')).not.toHaveAttribute('data-state', 'clear');
  });

  it('uses the cover photo where one is loaded and the queue icon otherwise', async () => {
    await render(CleanupQuickWins, {
      counts: loaded,
      covers: {
        [CleanupCountQueue.SpaceHogs]: { id: 'cover-1', thumbhash: null, originalFileName: 'a.mp4' } as never,
      },
      onEmptyTrash: vi.fn(),
    });

    await expect
      .element(page.getByTestId('cleanup-queue-space_hogs').element().querySelector('img'))
      .toHaveAttribute('src', expect.stringContaining('cover-1'));
    await expect.element(page.getByTestId('cleanup-queue-bursts').getByTestId('cleanup-card-icon')).toBeInTheDocument();
  });

  it('lifts as a card on hover', async () => {
    await render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    await expect.element(page.getByTestId('cleanup-queue-bursts')).toHaveAttribute('data-motion-lift-group');
  });

  it('counts the bytes up from zero when motion is allowed', async () => {
    stubReducedMotion(false);
    await render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    await expect
      .element(page.getByTestId('cleanup-queue-space_hogs').getByTestId('cleanup-card-bytes'))
      .toMatchTextContent(/^−0 B$/);
  });
});
