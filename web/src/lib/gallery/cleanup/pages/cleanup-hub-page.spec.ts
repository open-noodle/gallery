import TestWrapper from '#lib/components/TestWrapper.svelte';
import { todayMonthDay } from '#lib/gallery/cleanup/cleanup.ts';
import { finishedDay } from '#lib/gallery/cleanup/finished-day.ts';
import { pop } from '#lib/gallery/motion/index.ts';
import { CleanupCountQueue, type CleanupCountResponseDto } from '@immich/sdk';
import type { Component } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import CleanupPage from './CleanupHubPage.svelte';

const sdk = vi.hoisted(() => ({
  getCleanupCalendar: vi.fn(),
  getCleanupTrash: vi.fn(),
  getCleanupQueueCount: vi.fn(),
  getCleanupQueue: vi.fn(),
  getCleanupRewindYears: vi.fn(),
  getCleanupRewindAssets: vi.fn(),
}));
const flags = vi.hoisted(() => ({ value: { trash: true } }));

vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({ featureFlagsManager: flags }));
vi.mock('@immich/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...sdk }));
vi.mock('#lib/gallery/motion/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  pop: vi.fn(),
}));

// The hub pins a slim banner once the full one has scrolled away; tests drive the observer by hand.
const observers = vi.hoisted(() => ({ callbacks: [] as IntersectionObserverCallback[] }));

vi.mock('#lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('#lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

const COUNTS: Record<CleanupCountQueue, CleanupCountResponseDto> = {
  [CleanupCountQueue.SpaceHogs]: { count: 12, bytes: 3000 },
  [CleanupCountQueue.Bursts]: { count: 40, bytes: 2000 },
  [CleanupCountQueue.Screenshots]: { count: 7, bytes: 1000, analysedPercent: 100 },
  [CleanupCountQueue.Duplicates]: { count: 3, bytes: 500 },
  [CleanupCountQueue.Blurry]: { count: 9, bytes: 500, analysedPercent: 72 },
};

const renderPage = async () => {
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
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    observers.callbacks = [];
    // resetAllMocks clears the global matchMedia stub; the calendar's touch check needs one.
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: false,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          observers.callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
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
    await renderPage();

    await expect.element(page.getByTestId('cleanup-cal-101')).toHaveAttribute('data-state', 'reviewed');
    expect(sdk.getCleanupQueueCount).toHaveBeenCalledTimes(5);
    expect(sdk.getCleanupCalendar).toHaveBeenCalledWith({ tz: expect.any(String) });
    await expect
      .element(page.getByTestId('cleanup-hub-subtitle'))
      .toMatchTextContent('cleanup_days_reviewed · cleanup_streak');
    await expect.element(page.getByTestId('cleanup-could-still-free')).toMatchTextContent('cleanup_could_still_free');
    expect(page.getByTestId(/^cleanup-queue-(?!skeleton)/).elements()).toHaveLength(5);
    await expect.element(page.getByText('cleanup_trash_holds')).toBeInTheDocument();
  });

  it('leaves out the trash footer and its request when the trash is turned off', async () => {
    flags.value.trash = false;
    await renderPage();

    await vi.waitFor(() => expect(sdk.getCleanupQueueCount).toHaveBeenCalledTimes(5));
    expect(sdk.getCleanupTrash).not.toHaveBeenCalled();
    expect(page.getByTestId('cleanup-trash-footer').query()).toBeNull();
  });

  it("starts today's rewind from the banner", async () => {
    await renderPage();

    await expect
      .element(page.getByTestId('cleanup-banner-start'))
      .toHaveAttribute('href', `/utilities/cleanup/rewind/${todayMonthDay()}`);
  });

  it('shows today in the banner, loading its busiest year once', async () => {
    sdk.getCleanupRewindYears.mockResolvedValue({
      years: [
        { year: 2024, count: 4 },
        { year: 2019, count: 9 },
      ],
    });
    await renderPage();

    const banner = page.getByTestId('cleanup-day-banner');
    await expect.element(banner.getByText('cleanup_banner_photos_years')).toBeInTheDocument();
    await expect.element(banner.getByText('cleanup_banner_today')).toBeInTheDocument();
    expect(sdk.getCleanupRewindYears).toHaveBeenCalledWith({ monthDay: todayMonthDay() }, expect.anything());
    expect(sdk.getCleanupRewindAssets).toHaveBeenCalledTimes(1);
    expect(sdk.getCleanupRewindAssets).toHaveBeenCalledWith(
      { monthDay: todayMonthDay(), year: 2019 },
      expect.anything(),
    );
  });

  it('swaps the banner to a hovered day and back to today when the pointer leaves the calendar', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await renderPage();
    await vi.advanceTimersByTimeAsync(0);

    await userEvent.hover(page.getByTestId('cleanup-cal-102'));
    await vi.advanceTimersByTimeAsync(150);
    await expect.element(page.getByTestId('cleanup-day-banner')).toMatchTextContent('January 2');
    await expect
      .element(page.getByTestId('cleanup-banner-start'))
      .toHaveAttribute('href', '/utilities/cleanup/rewind/102');

    page.getByTestId('cleanup-calendar').element().dispatchEvent(new PointerEvent('pointerleave'));
    await vi.advanceTimersByTimeAsync(0);
    await expect.element(page.getByTestId('cleanup-day-banner').getByText('cleanup_banner_today')).toBeInTheDocument();
  });

  it('pins a slim banner once the full one has scrolled away', async () => {
    await renderPage();
    await vi.waitFor(() => expect(observers.callbacks.length).toBeGreaterThan(0));
    await expect.element(page.getByTestId('cleanup-banner-slim')).not.toBeInTheDocument();

    const scrolledAway = { isIntersecting: false, boundingClientRect: { top: -200 } } as IntersectionObserverEntry;
    observers.callbacks.at(-1)!([scrolledAway], {} as IntersectionObserver);
    await expect.element(page.getByTestId('cleanup-banner-slim')).toBeInTheDocument();

    const back = {
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: { top: 80 },
    } as IntersectionObserverEntry;
    observers.callbacks.at(-1)!([back], {} as IntersectionObserver);
    await expect.element(page.getByTestId('cleanup-banner-slim')).not.toBeInTheDocument();
  });

  it('pins once most of the banner has scrolled away, even while a strip of it still shows', async () => {
    await renderPage();
    await vi.waitFor(() => expect(observers.callbacks.length).toBeGreaterThan(0));

    const mostlyGone = {
      isIntersecting: true,
      intersectionRatio: 0.1,
      boundingClientRect: { top: -180 },
      rootBounds: { height: 800 },
    } as unknown as IntersectionObserverEntry;
    observers.callbacks.at(-1)!([mostlyGone], {} as IntersectionObserver);

    await expect.element(page.getByTestId('cleanup-banner-slim')).toBeInTheDocument();
  });

  it('pops the day just finished in rewind', async () => {
    finishedDay.set(101);
    await renderPage();

    await vi.waitFor(() => expect(pop).toHaveBeenCalledWith(page.getByTestId('cleanup-cal-101').element()));
    expect(finishedDay.take()).toBeUndefined();
  });

  it('holds the "Could still free" figure until every count has settled', async () => {
    const bursts = deferred<CleanupCountResponseDto>();
    sdk.getCleanupQueueCount.mockImplementation(({ queue }: { queue: CleanupCountQueue }) =>
      queue === CleanupCountQueue.Bursts ? bursts.promise : Promise.resolve(COUNTS[queue]),
    );
    await renderPage();

    await expect.element(page.getByTestId('cleanup-queue-space_hogs')).toMatchTextContent('cleanup_queue_count_files');
    await expect.element(page.getByTestId('cleanup-could-still-free-pending')).toBeInTheDocument();
    await expect.element(page.getByTestId('cleanup-could-still-free')).not.toBeInTheDocument();

    bursts.resolve(COUNTS[CleanupCountQueue.Bursts]);
    await expect.element(page.getByTestId('cleanup-could-still-free')).toBeInTheDocument();
    await expect.element(page.getByTestId('cleanup-could-still-free-pending')).not.toBeInTheDocument();
  });

  it('fetches row covers for every list queue except bursts', async () => {
    await renderPage();

    await vi.waitFor(() => expect(sdk.getCleanupQueue).toHaveBeenCalledTimes(3));
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
    await renderPage();
    await vi.advanceTimersByTimeAsync(0);
    sdk.getCleanupRewindYears.mockClear();

    // 102 then 103 inside the 150 ms window: only 103 is fetched
    await userEvent.hover(page.getByTestId('cleanup-cal-102'));
    await vi.advanceTimersByTimeAsync(100);
    await userEvent.hover(page.getByTestId('cleanup-cal-103'));
    await vi.advanceTimersByTimeAsync(150);
    expect(sdk.getCleanupRewindYears.mock.calls.map(([args]) => args)).toEqual([{ monthDay: 103 }]);
    await expect.element(page.getByAltText('day-103.jpg')).toBeInTheDocument();

    // 101's request is still in flight when 104 starts: its late answer is dropped
    await userEvent.hover(page.getByTestId('cleanup-cal-101'));
    await vi.advanceTimersByTimeAsync(150);
    await userEvent.hover(page.getByTestId('cleanup-cal-104'));
    await vi.advanceTimersByTimeAsync(150);
    slow.resolve({ years: [{ year: 2020, count: 9 }] });
    await vi.advanceTimersByTimeAsync(0);
    await expect.element(page.getByAltText('day-104.jpg')).toBeInTheDocument();
    await expect.element(page.getByAltText('day-101.jpg')).not.toBeInTheDocument();
    expect(sdk.getCleanupRewindAssets).not.toHaveBeenCalledWith(
      expect.objectContaining({ monthDay: 101 }),
      expect.anything(),
    );
  });

  it('does not restart the peek when the hovered cell then receives focus', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await renderPage();
    await vi.advanceTimersByTimeAsync(0);
    sdk.getCleanupRewindYears.mockClear();

    const cell = page.getByTestId('cleanup-cal-102');
    await userEvent.hover(cell);
    await vi.advanceTimersByTimeAsync(150);
    (cell.element() as HTMLElement).focus();
    await vi.advanceTimersByTimeAsync(150);

    expect(sdk.getCleanupRewindYears).toHaveBeenCalledTimes(1);
    expect((sdk.getCleanupRewindYears.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(false);
  });
});
