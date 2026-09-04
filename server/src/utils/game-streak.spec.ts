import { computeStreak } from 'src/utils/game-streak';

describe('computeStreak', () => {
  it('returns zeroes when nothing has been played', () => {
    expect(computeStreak([], '2026-08-19')).toEqual({ current: 0, best: 0 });
  });

  it('counts consecutive UTC days ending today', () => {
    expect(computeStreak(['2026-08-17', '2026-08-18', '2026-08-19'], '2026-08-19')).toEqual({ current: 3, best: 3 });
  });

  it('keeps the current streak alive when today is not played yet but yesterday was', () => {
    expect(computeStreak(['2026-08-17', '2026-08-18'], '2026-08-19').current).toBe(2);
  });

  it('breaks the current streak after a missed day, but remembers the best', () => {
    expect(computeStreak(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-19'], '2026-08-19')).toEqual({
      current: 1,
      best: 3,
    });
  });

  it('crosses a month boundary', () => {
    expect(computeStreak(['2026-07-31', '2026-08-01'], '2026-08-01').current).toBe(2);
  });

  // The duplicate sits INTERIOR to the run, not at its start - a duplicate at the start still
  // resets the counter to 1 whether or not it is deduplicated first, so that placement cannot
  // tell a dedupe-then-count implementation from a plain count. An interior repeat can: without
  // `[...new Set(...)]` in computeStreak, the extra 2026-08-18 breaks the day-over-day check on
  // its own re-occurrence and the run count comes out short.
  it('is unaffected by a duplicate date', () => {
    expect(computeStreak(['2026-08-17', '2026-08-18', '2026-08-18', '2026-08-19'], '2026-08-19')).toEqual({
      current: 3,
      best: 3,
    });
  });

  // The two days before yesterday: a streak whose last day is older than yesterday is over, and
  // reporting it as current would show a number the player can no longer save.
  it('drops the current streak once the gap reaches two days, keeping the best', () => {
    expect(computeStreak(['2026-08-16', '2026-08-17'], '2026-08-19')).toEqual({ current: 0, best: 2 });
  });

  // The dates arrive from the database in whatever order the group-by produced; the arithmetic
  // must not depend on that.
  it('does not depend on the order the days arrive in', () => {
    expect(computeStreak(['2026-08-19', '2026-08-17', '2026-08-18'], '2026-08-19')).toEqual({ current: 3, best: 3 });
  });

  // Crossing a leap day: 2028-02-29 exists, so the 28th, 29th and 1st of March are consecutive.
  it('crosses a leap day', () => {
    expect(computeStreak(['2028-02-28', '2028-02-29', '2028-03-01'], '2028-03-01')).toEqual({ current: 3, best: 3 });
  });

  // Crossing a year boundary: December 31st and January 1st are one day apart, not the start of
  // two unrelated years.
  it('crosses a year boundary', () => {
    expect(computeStreak(['2026-12-31', '2027-01-01'], '2027-01-01')).toEqual({ current: 2, best: 2 });
  });
});
