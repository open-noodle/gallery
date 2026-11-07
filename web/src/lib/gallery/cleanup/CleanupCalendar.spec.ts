import TestWrapper from '#lib/components/TestWrapper.svelte';
import CleanupCalendar from '#lib/gallery/cleanup/CleanupCalendar.svelte';
import { pop } from '#lib/gallery/motion/index.ts';
import type { CleanupCalendarDayDto } from '@immich/sdk';
import type { Component, ComponentProps } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

vi.mock('#lib/gallery/motion/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  pop: vi.fn(),
}));

const days: CleanupCalendarDayDto[] = [
  { monthDay: 101, assetCount: 0, reviewedAt: null },
  { monthDay: 102, assetCount: 40, reviewedAt: null },
  { monthDay: 103, assetCount: 5, reviewedAt: '2026-01-03T10:00:00.000Z' },
  { monthDay: 104, assetCount: 0, reviewedAt: '2026-01-04T10:00:00.000Z' },
  { monthDay: 105, assetCount: 40, reviewedAt: '2026-01-05T10:00:00.000Z' },
  { monthDay: 923, assetCount: 12, reviewedAt: null },
];

type CalendarProps = ComponentProps<typeof CleanupCalendar>;

const renderCalendar = async (props: { justReviewed?: number } = {}) => {
  const onPeek = vi.fn();
  const onLeave = vi.fn();
  const onOpen = vi.fn();
  // The open month's IconButtons need the tooltip provider the app wraps everything in.
  await render(TestWrapper as Component<{ component: typeof CleanupCalendar; componentProps: CalendarProps }>, {
    component: CleanupCalendar,
    componentProps: { days, today: 923, onPeek, onLeave, onOpen, ...props },
  });
  return { onPeek, onLeave, onOpen };
};

describe('CleanupCalendar', () => {
  it('renders one button per calendar day, in twelve months of seven columns from the 1st', async () => {
    await renderCalendar();

    expect(page.getByRole('button').elements()).toHaveLength(366);
    await expect.element(page.getByTestId('cleanup-cal-spacer')).not.toBeInTheDocument();
    for (let month = 1; month <= 12; month++) {
      const grid = page
        .getByTestId(`cleanup-month-${month}`)
        .element()
        .querySelector('[data-testid="cleanup-month-days"]');
      // No blank cells before the 1st: a cell is a date across every year, not a weekday.
      expect((grid?.firstElementChild as HTMLElement | null)?.dataset.testid).toBe(`cleanup-cal-${month * 100 + 1}`);
    }
  });

  it('gives February its 29th and no 30th', async () => {
    await renderCalendar();

    expect(page.getByTestId('cleanup-month-2').element().querySelectorAll('button')).toHaveLength(29);
    await expect.element(page.getByTestId('cleanup-cal-230')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('cleanup-cal-431')).not.toBeInTheDocument();
  });

  it("emphasises today's month", async () => {
    await renderCalendar();

    await expect.element(page.getByTestId('cleanup-month-9')).toHaveAttribute('data-current', 'true');
    await expect.element(page.getByTestId('cleanup-month-8')).not.toHaveAttribute('data-current');
  });

  it('returns the preview to today when the pointer or focus leaves the calendar', async () => {
    const { onLeave } = await renderCalendar();

    page.getByTestId('cleanup-calendar').element().dispatchEvent(new PointerEvent('pointerleave'));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('pops the day that was just reviewed', async () => {
    await renderCalendar({ justReviewed: 103 });

    await vi.waitFor(() => expect(pop).toHaveBeenCalledWith(page.getByTestId('cleanup-cal-103').element()));
  });

  it('keeps cells out of the site-wide hover scale', async () => {
    await renderCalendar();

    await expect.element(page.getByTestId('cleanup-cal-923')).toHaveAttribute('data-no-press');
  });

  it('derives the cell state from the count and review', async () => {
    await renderCalendar();

    await expect.element(page.getByTestId('cleanup-cal-101')).toHaveAttribute('data-state', 'none');
    await expect.element(page.getByTestId('cleanup-cal-102')).toHaveAttribute('data-state', 'l4');
    await expect.element(page.getByTestId('cleanup-cal-103')).toHaveAttribute('data-state', 'reviewed');
    await expect.element(page.getByTestId('cleanup-cal-923')).toHaveAttribute('data-state', 'l2');
    await expect.element(page.getByTestId('cleanup-cal-105')).toHaveAttribute('data-state', 'reviewed');
    // a day the server omitted counts as no photos
    await expect.element(page.getByTestId('cleanup-cal-1225')).toHaveAttribute('data-state', 'none');
  });

  it('never shows a day without photos as reviewed', async () => {
    await renderCalendar();

    await expect.element(page.getByTestId('cleanup-cal-104')).toHaveAttribute('data-state', 'none');
    await expect
      .element(page.getByTestId('cleanup-cal-104'))
      .toHaveAttribute('aria-label', 'cleanup_calendar_day_label');
  });

  it('shades reviewed days lighter when they hold few photos, like the mockup', async () => {
    await renderCalendar();

    await expect.element(page.getByTestId('cleanup-cal-103')).toHaveClass('bg-green-500/55');
    await expect.element(page.getByTestId('cleanup-cal-105')).toHaveClass('bg-green-500');
    await expect.element(page.getByTestId('cleanup-cal-105')).not.toHaveClass('bg-green-500/55');
  });

  it('marks today', async () => {
    await renderCalendar();

    await expect.element(page.getByTestId('cleanup-cal-923')).toHaveAttribute('data-today', 'true');
    await expect.element(page.getByTestId('cleanup-cal-922')).not.toHaveAttribute('data-today');
  });

  it('labels each cell with its date and count', async () => {
    await renderCalendar();

    await expect
      .element(page.getByTestId('cleanup-cal-923'))
      .toHaveAttribute('aria-label', 'cleanup_calendar_day_label');
    await expect
      .element(page.getByTestId('cleanup-cal-103'))
      .toHaveAttribute('aria-label', 'cleanup_calendar_day_label_reviewed');
  });

  it('peeks on hover and focus, and opens on click', async () => {
    const { onPeek, onOpen } = await renderCalendar();
    const cell = page.getByTestId('cleanup-cal-923');

    await userEvent.hover(cell);
    expect(onPeek).toHaveBeenLastCalledWith(923);

    onPeek.mockClear();
    (cell.element() as HTMLElement).focus();
    expect(onPeek).toHaveBeenLastCalledWith(923);

    await userEvent.click(cell);
    expect(onOpen).toHaveBeenCalledWith(923);
  });

  it("pops today's cell only when motion is allowed", async () => {
    await renderCalendar();

    const classes = [...page.getByTestId('cleanup-cal-923').element().classList];
    expect(classes.some((name) => name.startsWith('motion-safe:animate-'))).toBe(true);
    expect(classes.some((name) => name.startsWith('animate-'))).toBe(false);
  });
});

describe('CleanupCalendar on a touch screen', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: media.includes('coarse'),
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens a tapped month large, with day numbers, and opens the tapped day', async () => {
    const { onOpen } = await renderCalendar();

    await userEvent.click(page.getByTestId('cleanup-month-open-1'));

    await expect.element(page.getByTestId('cleanup-month-open')).toBeInTheDocument();
    await expect.element(page.getByTestId('cleanup-cal-102')).toHaveTextContent('2');
    await expect.element(page.getByTestId('cleanup-cal-923')).not.toBeInTheDocument();

    await userEvent.click(page.getByTestId('cleanup-cal-102'));
    expect(onOpen).toHaveBeenCalledWith(102);
  });

  it('steps between months and goes back to the year', async () => {
    await renderCalendar();

    await userEvent.click(page.getByTestId('cleanup-month-open-12'));
    await userEvent.click(page.getByRole('button', { name: 'next' }));
    await expect.element(page.getByTestId('cleanup-cal-131')).toBeInTheDocument();

    await userEvent.click(page.getByTestId('cleanup-month-back'));
    await expect.element(page.getByTestId('cleanup-month-open')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('cleanup-month-9')).toBeInTheDocument();
  });
});
