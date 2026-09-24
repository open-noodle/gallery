import { CleanupCountQueue, type CleanupCountResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/svelte';
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

describe('Cleanup hub page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sdk.getCleanupCalendar.mockResolvedValue({
      days: [{ monthDay: 101, assetCount: 3, reviewedAt: '2026-01-01T00:00:00.000Z' }],
      daysReviewed: 1,
      streak: 1,
    });
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
});
