import {
  burstDecision,
  burstMemberIds,
  burstMarkOf,
  burstTimeRange,
  chunk,
  CLEANUP_QUEUE_SLUGS,
  dominantCity,
  monthDayLabel,
  nextUnreviewedDay,
  parseMonthDay,
  queueToSlug,
  shadeLevel,
  shadeScale,
  shiftMonthDay,
  slugToQueue,
  todayMonthDay,
} from '$lib/utils/cleanup';

describe('cleanup utils', () => {
  it('computes today as month*100+day in local time', () => {
    expect(todayMonthDay(new Date(2026, 8, 23, 23, 59))).toBe(923);
    expect(todayMonthDay(new Date(2024, 1, 29))).toBe(229);
  });
  it('labels a month/day', () => expect(monthDayLabel(923, 'en')).toBe('September 23'));
  it('shades by quartile of the dates that have photos', () => {
    const scale = shadeScale([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shadeLevel(0, scale)).toBe(0);
    expect(shadeLevel(1, scale)).toBe(1);
    expect(shadeLevel(2, scale)).toBe(1);
    expect(shadeLevel(3, scale)).toBe(2);
    expect(shadeLevel(5, scale)).toBe(3);
    expect(shadeLevel(8, scale)).toBe(4);
    expect(shadeLevel(3, shadeScale([]))).toBe(0);
  });
  it('keeps shading ordinary dates apart when one date holds far more photos than the rest', () => {
    const counts = [...Array.from({ length: 364 }, (_, i) => 20 + i), 5125];
    const scale = shadeScale(counts);
    const levels = new Set(counts.map((count) => shadeLevel(count, scale)));
    expect(levels).toEqual(new Set([1, 2, 3, 4]));
    expect(shadeLevel(20, scale)).toBe(1);
    expect(shadeLevel(5125, scale)).toBe(4);
  });
  it('shades every date darkest when they all hold the same number of photos', () => {
    const scale = shadeScale([7, 7, 7]);
    expect(shadeLevel(7, scale)).toBe(4);
  });
  it('maps slugs', () => {
    expect(slugToQueue('space-hogs')).toBe('space_hogs');
    expect(queueToSlug('space_hogs')).toBe('space-hogs');
    expect(Object.keys(CLEANUP_QUEUE_SLUGS)).toHaveLength(4);
  });
  it('chunks', () => expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]));

  it('parses a valid month/day route param and rejects anything else', () => {
    expect(parseMonthDay('923')).toBe(923);
    expect(parseMonthDay('101')).toBe(101);
    expect(parseMonthDay('229')).toBe(229);
    expect(parseMonthDay('1231')).toBe(1231);
    for (const bad of ['0', '100', '132', '230', '431', '1301', '0923', '9.5', 'abc', '', '-923', '92a']) {
      expect(parseMonthDay(bad)).toBeUndefined();
    }
  });
  it('steps to the adjacent calendar date, through 29 February and across the year end', () => {
    expect(shiftMonthDay(923, 1)).toBe(924);
    expect(shiftMonthDay(930, 1)).toBe(1001);
    expect(shiftMonthDay(228, 1)).toBe(229);
    expect(shiftMonthDay(229, 1)).toBe(301);
    expect(shiftMonthDay(1231, 1)).toBe(101);
    expect(shiftMonthDay(101, -1)).toBe(1231);
    expect(shiftMonthDay(301, -1)).toBe(229);
  });
  it('finds the next date with photos that is not reviewed, wrapping round the year', () => {
    const day = (monthDay: number, assetCount: number, reviewedAt: string | null = null) => ({
      monthDay,
      assetCount,
      reviewedAt,
    });
    const days = [day(101, 3), day(923, 5), day(924, 0), day(925, 2, '2026-09-01'), day(926, 1)];
    expect(nextUnreviewedDay(days, 923)).toBe(926);
    expect(nextUnreviewedDay(days, 926)).toBe(101);
    expect(nextUnreviewedDay([day(923, 5)], 923)).toBeUndefined();
    expect(nextUnreviewedDay([], 923)).toBeUndefined();
  });
  it('picks the most common city, ignoring missing ones', () => {
    expect(dominantCity([{ city: null }, { city: 'Porto' }, { city: 'Lisbon' }, { city: 'Porto' }])).toBe('Porto');
    expect(dominantCity([{ city: null }])).toBeNull();
  });

  it('marks the suggested burst pick keep and the rest trash until the user changes them', () => {
    const group = { suggestedKeepId: 'b', assets: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    const marks = new Map([['c', 'keep' as const]]);

    expect(burstMarkOf(group, marks, 'a')).toBe('trash');
    expect(burstMarkOf(group, marks, 'b')).toBe('keep');
    expect(burstDecision(group, marks)).toEqual({ keepIds: ['b', 'c'], trashIds: ['a'] });
  });

  it('formats a burst time range from the capture wall-clock times', () => {
    expect(burstTimeRange('2024-08-12T14:03:21.000Z', '2024-08-12T14:03:24.000Z', 'en-GB')).toBe(
      '12 Aug 2024 · 14:03:21 → 14:03:24',
    );
  });

  it('finds the photos taken within 2 s of another one, whatever the input order', () => {
    const at = (id: string, time: string) => ({ id, localDateTime: `2024-08-12T${time}Z` });
    const ids = burstMemberIds([
      at('lone', '09:00:00.000'),
      at('b2', '14:03:22.000'),
      at('b1', '14:03:21.000'),
      // Exactly 2 s after b2 still counts, like the server's gap rule.
      at('b3', '14:03:24.000'),
      at('late', '14:03:26.001'),
    ]);

    expect([...ids].sort()).toEqual(['b1', 'b2', 'b3']);
    expect(burstMemberIds([at('only', '10:00:00.000')]).size).toBe(0);
  });
});
