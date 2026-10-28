import { CleanupCountQueue } from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import CleanupQuickWins from '$lib/gallery/cleanup/CleanupQuickWins.svelte';

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

  it('renders the five queues in the mockup order', () => {
    render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    const rows = screen.getAllByTestId(/^cleanup-queue-(?!skeleton)/);
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      'cleanup-queue-space_hogs',
      'cleanup-queue-bursts',
      'cleanup-queue-screenshots',
      'cleanup-queue-duplicates',
      'cleanup-queue-blurry',
    ]);
  });

  it('shows analysis progress only while a pixel queue is still being analysed', () => {
    render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    expect(within(screen.getByTestId('cleanup-queue-blurry')).getByText('cleanup_analysing_percent')).toBeVisible();
    expect(
      within(screen.getByTestId('cleanup-queue-screenshots')).queryByText('cleanup_analysing_percent'),
    ).not.toBeInTheDocument();
  });

  it('gives each count the unit the mockup shows', () => {
    render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    const row = (queue: string) => within(screen.getByTestId(`cleanup-queue-${queue}`));
    expect(row('space_hogs').getByText('cleanup_queue_count_files')).toBeVisible();
    expect(row('bursts').getByText('cleanup_up_to_count')).toBeVisible();
    expect(row('screenshots').getByText('7')).toBeVisible();
    expect(row('duplicates').getByText('cleanup_queue_count_groups')).toBeVisible();
    // blurry is still being analysed, so its count is partial
    expect(row('blurry').getByText('cleanup_queue_count_so_far')).toBeVisible();
    expect(row('space_hogs').queryByText('cleanup_up_to_count')).toBeNull();
  });

  it('shows a plain count for blurry once analysis has covered the library', () => {
    render(CleanupQuickWins, {
      counts: { ...loaded, [CleanupCountQueue.Blurry]: { count: 9, bytes: 1, analysedPercent: 100 } },
      onEmptyTrash: vi.fn(),
    });

    expect(within(screen.getByTestId('cleanup-queue-blurry')).getByText('9')).toBeVisible();
  });

  it('links each queue to its page, and duplicates to the duplicates utility', () => {
    render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    expect(screen.getByTestId('cleanup-queue-duplicates')).toHaveAttribute('href', '/utilities/duplicates');
    expect(screen.getByTestId('cleanup-queue-space_hogs')).toHaveAttribute('href', '/utilities/cleanup/space-hogs');
    expect(screen.getByTestId('cleanup-queue-blurry')).toHaveAttribute('href', '/utilities/cleanup/blurry');
  });

  it('shows a skeleton for a queue whose count is still loading', () => {
    render(CleanupQuickWins, {
      counts: { ...loaded, [CleanupCountQueue.Bursts]: undefined },
      onEmptyTrash: vi.fn(),
    });

    const skeletons = screen.getAllByTestId('cleanup-queue-skeleton');
    expect(skeletons).toHaveLength(1);
    expect(within(screen.getByTestId('cleanup-queue-bursts')).getByTestId('cleanup-queue-skeleton')).toBeVisible();
  });

  it('empties the trash from the footer', async () => {
    const onEmptyTrash = vi.fn();
    render(CleanupQuickWins, { counts: loaded, trash: { count: 4, bytes: 1_000_000 }, onEmptyTrash });

    expect(screen.getByText('cleanup_trash_holds')).toBeVisible();
    await fireEvent.click(screen.getByRole('button', { name: 'cleanup_trash_empty' }));
    expect(onEmptyTrash).toHaveBeenCalledOnce();
  });

  it('hides the trash footer when the trash is turned off', () => {
    render(CleanupQuickWins, {
      counts: loaded,
      trash: { count: 0, bytes: 0 },
      showTrash: false,
      onEmptyTrash: vi.fn(),
    });

    expect(screen.queryByTestId('cleanup-trash-footer')).toBeNull();
    expect(screen.getByTestId('cleanup-queue-space_hogs')).toBeVisible();
  });

  it('shows "All clear" on a queue with nothing in it, still linking to its page', () => {
    render(CleanupQuickWins, {
      counts: { ...loaded, [CleanupCountQueue.Screenshots]: { count: 0, bytes: 0, analysedPercent: 100 } },
      onEmptyTrash: vi.fn(),
    });

    const card = screen.getByTestId('cleanup-queue-screenshots');
    expect(card).toHaveAttribute('data-state', 'clear');
    expect(within(card).getByText('cleanup_all_clear')).toBeVisible();
    expect(card).toHaveAttribute('href', '/utilities/cleanup/screenshots');
    expect(screen.getByTestId('cleanup-queue-blurry')).not.toHaveAttribute('data-state', 'clear');
  });

  it('uses the cover photo where one is loaded and the queue icon otherwise', () => {
    render(CleanupQuickWins, {
      counts: loaded,
      covers: {
        [CleanupCountQueue.SpaceHogs]: { id: 'cover-1', thumbhash: null, originalFileName: 'a.mp4' } as never,
      },
      onEmptyTrash: vi.fn(),
    });

    expect(screen.getByTestId('cleanup-queue-space_hogs').querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('cover-1'),
    );
    expect(within(screen.getByTestId('cleanup-queue-bursts')).getByTestId('cleanup-card-icon')).toBeInTheDocument();
  });

  it('lifts as a card on hover', () => {
    render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    expect(screen.getByTestId('cleanup-queue-bursts')).toHaveAttribute('data-motion-lift-group');
  });

  it('counts the bytes up from zero when motion is allowed', () => {
    stubReducedMotion(false);
    render(CleanupQuickWins, { counts: loaded, onEmptyTrash: vi.fn() });

    expect(within(screen.getByTestId('cleanup-queue-space_hogs')).getByTestId('cleanup-card-bytes')).toHaveTextContent(
      /^−0 B$/,
    );
  });
});
