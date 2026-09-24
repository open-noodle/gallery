import type { CleanupCalendarDayDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CleanupCalendar from '$lib/components/cleanup/CleanupCalendar.svelte';

const days: CleanupCalendarDayDto[] = [
  { monthDay: 101, assetCount: 0, reviewedAt: null },
  { monthDay: 102, assetCount: 40, reviewedAt: null },
  { monthDay: 103, assetCount: 5, reviewedAt: '2026-01-03T10:00:00.000Z' },
  { monthDay: 923, assetCount: 12, reviewedAt: null },
];

const renderCalendar = () => {
  const onPeek = vi.fn();
  const onOpen = vi.fn();
  render(CleanupCalendar, { days, today: 923, onPeek, onOpen });
  return { onPeek, onOpen };
};

describe('CleanupCalendar', () => {
  it('renders one button per calendar day plus spacers for days that do not exist', () => {
    renderCalendar();

    expect(screen.getAllByRole('button')).toHaveLength(366);
    // 30 + 31 February, 31 April, June, September and November
    expect(screen.getAllByTestId('cleanup-cal-spacer')).toHaveLength(6);
    expect(screen.getByTestId('cleanup-cal-229')).toBeInTheDocument();
    expect(screen.queryByTestId('cleanup-cal-230')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cleanup-cal-431')).not.toBeInTheDocument();
  });

  it('derives the cell state from the count and review', () => {
    renderCalendar();

    expect(screen.getByTestId('cleanup-cal-101')).toHaveAttribute('data-state', 'none');
    expect(screen.getByTestId('cleanup-cal-102')).toHaveAttribute('data-state', 'l4');
    expect(screen.getByTestId('cleanup-cal-103')).toHaveAttribute('data-state', 'reviewed');
    expect(screen.getByTestId('cleanup-cal-923')).toHaveAttribute('data-state', 'l2');
    // a day the server omitted counts as no photos
    expect(screen.getByTestId('cleanup-cal-1225')).toHaveAttribute('data-state', 'none');
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
});
