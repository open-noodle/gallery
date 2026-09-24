import { CleanupCountQueue } from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import CleanupQueueRail from '$lib/components/cleanup/CleanupQueueRail.svelte';

const loaded = {
  [CleanupCountQueue.SpaceHogs]: { count: 12, bytes: 5_000_000_000 },
  [CleanupCountQueue.Bursts]: { count: 40, bytes: 300_000_000 },
  [CleanupCountQueue.Screenshots]: { count: 7, bytes: 10_000_000, analysedPercent: 100 },
  [CleanupCountQueue.Duplicates]: { count: 3, bytes: 20_000_000 },
  [CleanupCountQueue.Blurry]: { count: 9, bytes: 40_000_000, analysedPercent: 72 },
};

describe('CleanupQueueRail', () => {
  it('renders the five queues in the mockup order', () => {
    render(CleanupQueueRail, { counts: loaded, onEmptyTrash: vi.fn() });

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
    render(CleanupQueueRail, { counts: loaded, onEmptyTrash: vi.fn() });

    expect(within(screen.getByTestId('cleanup-queue-blurry')).getByText('cleanup_analysing_percent')).toBeVisible();
    expect(
      within(screen.getByTestId('cleanup-queue-screenshots')).queryByText('cleanup_analysing_percent'),
    ).not.toBeInTheDocument();
  });

  it('gives each count the unit the mockup shows', () => {
    render(CleanupQueueRail, { counts: loaded, onEmptyTrash: vi.fn() });

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
    render(CleanupQueueRail, {
      counts: { ...loaded, [CleanupCountQueue.Blurry]: { count: 9, bytes: 1, analysedPercent: 100 } },
      onEmptyTrash: vi.fn(),
    });

    expect(within(screen.getByTestId('cleanup-queue-blurry')).getByText('9')).toBeVisible();
  });

  it('links each queue to its page, and duplicates to the duplicates utility', () => {
    render(CleanupQueueRail, { counts: loaded, onEmptyTrash: vi.fn() });

    expect(screen.getByTestId('cleanup-queue-duplicates')).toHaveAttribute('href', '/utilities/duplicates');
    expect(screen.getByTestId('cleanup-queue-space_hogs')).toHaveAttribute('href', '/utilities/cleanup/space-hogs');
    expect(screen.getByTestId('cleanup-queue-blurry')).toHaveAttribute('href', '/utilities/cleanup/blurry');
  });

  it('shows a skeleton for a queue whose count is still loading', () => {
    render(CleanupQueueRail, {
      counts: { ...loaded, [CleanupCountQueue.Bursts]: undefined },
      onEmptyTrash: vi.fn(),
    });

    const skeletons = screen.getAllByTestId('cleanup-queue-skeleton');
    expect(skeletons).toHaveLength(1);
    expect(within(screen.getByTestId('cleanup-queue-bursts')).getByTestId('cleanup-queue-skeleton')).toBeVisible();
  });

  it('empties the trash from the footer', async () => {
    const onEmptyTrash = vi.fn();
    render(CleanupQueueRail, { counts: loaded, trash: { count: 4, bytes: 1_000_000 }, onEmptyTrash });

    expect(screen.getByText('cleanup_trash_holds')).toBeVisible();
    await fireEvent.click(screen.getByRole('button', { name: 'cleanup_trash_empty' }));
    expect(onEmptyTrash).toHaveBeenCalledOnce();
  });
});
