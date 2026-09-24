import {
  chunk,
  CLEANUP_QUEUE_SLUGS,
  monthDayLabel,
  queueToSlug,
  shadeLevel,
  slugToQueue,
  todayMonthDay,
} from '$lib/utils/cleanup';

describe('cleanup utils', () => {
  it('computes today as month*100+day in local time', () => {
    expect(todayMonthDay(new Date(2026, 8, 23, 23, 59))).toBe(923);
    expect(todayMonthDay(new Date(2024, 1, 29))).toBe(229);
  });
  it('labels a month/day', () => expect(monthDayLabel(923, 'en')).toBe('September 23'));
  it('shades by fraction of max', () => {
    expect(shadeLevel(0, 10)).toBe(0);
    expect(shadeLevel(1, 10)).toBe(1);
    expect(shadeLevel(5, 10)).toBe(2);
    expect(shadeLevel(7, 10)).toBe(3);
    expect(shadeLevel(10, 10)).toBe(4);
    expect(shadeLevel(3, 0)).toBe(0);
  });
  it('maps slugs', () => {
    expect(slugToQueue('space-hogs')).toBe('space_hogs');
    expect(queueToSlug('space_hogs')).toBe('space-hogs');
    expect(Object.keys(CLEANUP_QUEUE_SLUGS)).toHaveLength(4);
  });
  it('chunks', () => expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]));
});
