import type { CleanupCalendarDayDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CleanupCalendar from '$lib/components/cleanup/CleanupCalendar.svelte';
import { pop } from '$lib/gallery/motion';

vi.mock('$lib/gallery/motion', async (importOriginal) => ({
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

const renderCalendar = (props: { justReviewed?: number } = {}) => {
  const onPeek = vi.fn();
  const onLeave = vi.fn();
  const onOpen = vi.fn();
  render(CleanupCalendar, { days, today: 923, onPeek, onLeave, onOpen, ...props });
  return { onPeek, onLeave, onOpen };
};

describe('CleanupCalendar', () => {
  it('renders one button per calendar day, in twelve months of seven columns from the 1st', () => {
    renderCalendar();

    expect(screen.getAllByRole('button')).toHaveLength(366);
    expect(screen.queryByTestId('cleanup-cal-spacer')).not.toBeInTheDocument();
    for (let month = 1; month <= 12; month++) {
      const grid = screen.getByTestId(`cleanup-month-${month}`).querySelector('[data-testid="cleanup-month-days"]');
      // No blank cells before the 1st: a cell is a date across every year, not a weekday.
      expect(grid?.firstElementChild).toHaveAttribute('data-testid', `cleanup-cal-${month * 100 + 1}`);
    }
  });

  it('gives February its 29th and no 30th', () => {
    renderCalendar();

    expect(screen.getByTestId('cleanup-month-2').querySelectorAll('button')).toHaveLength(29);
    expect(screen.queryByTestId('cleanup-cal-230')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cleanup-cal-431')).not.toBeInTheDocument();
  });

  it("emphasises today's month", () => {
    renderCalendar();

    expect(screen.getByTestId('cleanup-month-9')).toHaveAttribute('data-current', 'true');
    expect(screen.getByTestId('cleanup-month-8')).not.toHaveAttribute('data-current');
  });

  it('returns the preview to today when the pointer or focus leaves the calendar', async () => {
    const { onLeave } = renderCalendar();

    await fireEvent.pointerLeave(screen.getByTestId('cleanup-calendar'));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('pops the day that was just reviewed', () => {
    renderCalendar({ justReviewed: 103 });

    expect(pop).toHaveBeenCalledWith(screen.getByTestId('cleanup-cal-103'));
  });

  it('keeps cells out of the site-wide hover scale', () => {
    renderCalendar();

    expect(screen.getByTestId('cleanup-cal-923')).toHaveAttribute('data-no-press');
  });

  it('derives the cell state from the count and review', () => {
    renderCalendar();

    expect(screen.getByTestId('cleanup-cal-101')).toHaveAttribute('data-state', 'none');
    expect(screen.getByTestId('cleanup-cal-102')).toHaveAttribute('data-state', 'l4');
    expect(screen.getByTestId('cleanup-cal-103')).toHaveAttribute('data-state', 'reviewed');
    expect(screen.getByTestId('cleanup-cal-923')).toHaveAttribute('data-state', 'l2');
    expect(screen.getByTestId('cleanup-cal-105')).toHaveAttribute('data-state', 'reviewed');
    // a day the server omitted counts as no photos
    expect(screen.getByTestId('cleanup-cal-1225')).toHaveAttribute('data-state', 'none');
  });

  it('never shows a day without photos as reviewed', () => {
    renderCalendar();

    expect(screen.getByTestId('cleanup-cal-104')).toHaveAttribute('data-state', 'none');
    expect(screen.getByTestId('cleanup-cal-104')).toHaveAttribute('aria-label', 'cleanup_calendar_day_label');
  });

  it('shades reviewed days lighter when they hold few photos, like the mockup', () => {
    renderCalendar();

    expect(screen.getByTestId('cleanup-cal-103')).toHaveClass('bg-green-500/55');
    expect(screen.getByTestId('cleanup-cal-105')).toHaveClass('bg-green-500');
    expect(screen.getByTestId('cleanup-cal-105')).not.toHaveClass('bg-green-500/55');
  });

  it('marks today', () => {
    renderCalendar();

    expect(screen.getByTestId('cleanup-cal-923')).toHaveAttribute('data-today', 'true');
    expect(screen.getByTestId('cleanup-cal-922')).not.toHaveAttribute('data-today');
  });

  it('labels each cell with its date and count', () => {
    renderCalendar();

    expect(screen.getByTestId('cleanup-cal-923')).toHaveAttribute('aria-label', 'cleanup_calendar_day_label');
    expect(screen.getByTestId('cleanup-cal-103')).toHaveAttribute('aria-label', 'cleanup_calendar_day_label_reviewed');
  });

  it('peeks on hover and focus, and opens on click', async () => {
    const { onPeek, onOpen } = renderCalendar();
    const cell = screen.getByTestId('cleanup-cal-923');

    await fireEvent.mouseEnter(cell);
    expect(onPeek).toHaveBeenLastCalledWith(923);

    onPeek.mockClear();
    await fireEvent.focus(cell);
    expect(onPeek).toHaveBeenLastCalledWith(923);

    await fireEvent.click(cell);
    expect(onOpen).toHaveBeenCalledWith(923);
  });

  it("pops today's cell only when motion is allowed", () => {
    renderCalendar();

    const classes = [...screen.getByTestId('cleanup-cal-923').classList];
    expect(classes.some((name) => name.startsWith('motion-safe:animate-'))).toBe(true);
    expect(classes.some((name) => name.startsWith('animate-'))).toBe(false);
  });
});
