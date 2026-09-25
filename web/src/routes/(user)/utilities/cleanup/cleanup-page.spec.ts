import { CleanupCountQueue, type CleanupCountResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { todayMonthDay } from '$lib/utils/cleanup';
import CleanupPage from './+page.svelte';

const sdk = vi.hoisted(() => ({
  getCleanupCalendar: vi.fn(),
  getCleanupTrash: vi.fn(),
  getCleanupQueueCount: vi.fn(),
  getCleanupQueue: vi.fn(),
  getCleanupRewindYears: vi.fn(),
  getCleanupRewindAssets: vi.fn(),
}));
const flags = vi.hoisted(() => ({ value: { trash: true } }));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({ featureFlagsManager: flags }));
vi.mock('@immich/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...sdk }));

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

const COUNTS: Record<CleanupCountQueue, CleanupCountResponseDto> = {
  [CleanupCountQueue.SpaceHogs]: { count: 12, bytes: 3000 },
  [CleanupCountQueue.Bursts]: { count: 40, bytes: 2000 },
  [CleanupCountQueue.Screenshots]: { count: 7, bytes: 1000, analysedPercent: 100 },
  [CleanupCountQueue.Duplicates]: { count: 3, bytes: 500 },
  [CleanupCountQueue.Blurry]: { count: 9, bytes: 500, analysedPercent: 72 },
};

const renderPage = () => {
  const props = { data: { meta: { title: 'cleanup' } } };
  return render(TestWrapper as Component<{ component: typeof CleanupPage; componentProps: typeof props }>, {
    component: CleanupPage,
    componentProps: props,
  });
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const asset = (id: string) => ({ id, thumbhash: null, originalFileName: `${id}.jpg` });

describe('Cleanup hub page', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    sdk.getCleanupCalendar.mockResolvedValue({
      days: [{ monthDay: 101, assetCount: 3, reviewedAt: '2026-01-01T00:00:00.000Z' }],
      daysReviewed: 1,
      streak: 1,
    });
    flags.value.trash = true;
    sdk.getCleanupTrash.mockResolvedValue({ count: 2, bytes: 100 });
    sdk.getCleanupQueueCount.mockImplementation(({ queue }: { queue: CleanupCountQueue }) =>
      Promise.resolve(COUNTS[queue]),
    );
    sdk.getCleanupQueue.mockResolvedValue({ items: [], groups: [], nextCursor: null });
    sdk.getCleanupRewindYears.mockResolvedValue({
      years: [
        { year: 2024, count: 4 },
        { year: 2019, count: 2 },
      ],
    });
    sdk.getCleanupRewindAssets.mockResolvedValue({ assets: [] });
  });

  it('fetches every panel on mount and fills the hub', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('cleanup-cal-101')).toHaveAttribute('data-state', 'reviewed'));
    expect(sdk.getCleanupQueueCount).toHaveBeenCalledTimes(5);
    expect(sdk.getCleanupCalendar).toHaveBeenCalledWith({ tz: expect.any(String) });
    expect(screen.getByTestId('cleanup-hub-subtitle')).toHaveTextContent('cleanup_days_reviewed · cleanup_streak');
    expect(screen.getByTestId('cleanup-could-still-free')).toHaveTextContent('cleanup_could_still_free');
    expect(screen.getAllByTestId(/^cleanup-queue-(?!skeleton)/)).toHaveLength(5);
    expect(screen.getByText('cleanup_trash_holds')).toBeInTheDocument();
  });

  it('leaves out the trash footer and its request when the trash is turned off', async () => {
    flags.value.trash = false;
    renderPage();

    await waitFor(() => expect(sdk.getCleanupQueueCount).toHaveBeenCalledTimes(5));
    expect(sdk.getCleanupTrash).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cleanup-trash-footer')).toBeNull();
  });

  it('links "Rewind today" to today\'s rewind', () => {
    renderPage();

    expect(screen.getByRole('link', { name: 'cleanup_rewind_today' })).toHaveAttribute(
      'href',
      `/utilities/cleanup/rewind/${todayMonthDay()}`,
    );
  });

  it('peeks today by default, reading the most recent year first', async () => {
    renderPage();

    const peek = screen.getByTestId('cleanup-day-peek');
    await waitFor(() => expect(within(peek).getByText('cleanup_day_peek_summary')).toBeInTheDocument());
    expect(sdk.getCleanupRewindYears).toHaveBeenCalledWith({ monthDay: todayMonthDay() }, expect.anything());
    expect(sdk.getCleanupRewindAssets).toHaveBeenCalledWith(
      { monthDay: todayMonthDay(), year: 2024 },
      expect.anything(),
    );
  });

  it('holds the "Could still free" figure until every count has settled', async () => {
    const bursts = deferred<CleanupCountResponseDto>();
    sdk.getCleanupQueueCount.mockImplementation(({ queue }: { queue: CleanupCountQueue }) =>
      queue === CleanupCountQueue.Bursts ? bursts.promise : Promise.resolve(COUNTS[queue]),
    );
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('cleanup-queue-space_hogs')).toHaveTextContent('cleanup_queue_count_files'),
    );
    expect(screen.getByTestId('cleanup-could-still-free-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('cleanup-could-still-free')).not.toBeInTheDocument();

    bursts.resolve(COUNTS[CleanupCountQueue.Bursts]);
    await waitFor(() => expect(screen.getByTestId('cleanup-could-still-free')).toBeInTheDocument());
    expect(screen.queryByTestId('cleanup-could-still-free-pending')).not.toBeInTheDocument();
  });

  it('fetches row covers for every list queue except bursts', async () => {
    renderPage();

    await waitFor(() => expect(sdk.getCleanupQueue).toHaveBeenCalledTimes(3));
    const queues = sdk.getCleanupQueue.mock.calls.map(([args]) => (args as { queue: string }).queue);
    expect(new Set(queues)).toEqual(new Set(['blurry', 'screenshots', 'space_hogs']));
  });

  it('peeks only the last day hovered within the debounce, dropping the earlier one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const slow = deferred<{ years: { year: number; count: number }[] }>();
    sdk.getCleanupRewindYears.mockImplementation(({ monthDay }: { monthDay: number }) =>
      monthDay === 101 ? slow.promise : Promise.resolve({ years: [{ year: 2024, count: 1 }] }),
    );
    sdk.getCleanupRewindAssets.mockImplementation(({ monthDay }: { monthDay: number }) =>
      Promise.resolve({ assets: [asset(`day-${monthDay}`)] }),
    );
    renderPage();
    await vi.advanceTimersByTimeAsync(0);
    sdk.getCleanupRewindYears.mockClear();

    // 102 then 103 inside the 150 ms window: only 103 is fetched
    await fireEvent.mouseEnter(screen.getByTestId('cleanup-cal-102'));
    await vi.advanceTimersByTimeAsync(100);
    await fireEvent.mouseEnter(screen.getByTestId('cleanup-cal-103'));
    await vi.advanceTimersByTimeAsync(150);
    expect(sdk.getCleanupRewindYears.mock.calls.map(([args]) => args)).toEqual([{ monthDay: 103 }]);
    expect(screen.getByAltText('day-103.jpg')).toBeInTheDocument();

    // 101's request is still in flight when 104 starts: its late answer is dropped
    await fireEvent.mouseEnter(screen.getByTestId('cleanup-cal-101'));
    await vi.advanceTimersByTimeAsync(150);
    await fireEvent.mouseEnter(screen.getByTestId('cleanup-cal-104'));
    await vi.advanceTimersByTimeAsync(150);
    slow.resolve({ years: [{ year: 2020, count: 9 }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByAltText('day-104.jpg')).toBeInTheDocument();
    expect(screen.queryByAltText('day-101.jpg')).not.toBeInTheDocument();
    expect(sdk.getCleanupRewindAssets).not.toHaveBeenCalledWith(
      expect.objectContaining({ monthDay: 101 }),
      expect.anything(),
    );
  });

  it('does not restart the peek when the hovered cell then receives focus', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderPage();
    await vi.advanceTimersByTimeAsync(0);
    sdk.getCleanupRewindYears.mockClear();

    const cell = screen.getByTestId('cleanup-cal-102');
    await fireEvent.mouseEnter(cell);
    await vi.advanceTimersByTimeAsync(150);
    await fireEvent.focus(cell);
    await vi.advanceTimersByTimeAsync(150);

    expect(sdk.getCleanupRewindYears).toHaveBeenCalledTimes(1);
    expect((sdk.getCleanupRewindYears.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(false);
  });
});
