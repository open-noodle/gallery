import { DateTime } from 'luxon';
import { isSeasonStart, seasonOf, seasonStartingOn, seasonYearOf } from 'src/services/memory-rules/season.util';

const utc = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });

describe('seasonOf', () => {
  it('maps every month to its meteorological season', () => {
    expect([12, 1, 2].map((month) => seasonOf(month))).toEqual(['winter', 'winter', 'winter']);
    expect([3, 4, 5].map((month) => seasonOf(month))).toEqual(['spring', 'spring', 'spring']);
    expect([6, 7, 8].map((month) => seasonOf(month))).toEqual(['summer', 'summer', 'summer']);
    expect([9, 10, 11].map((month) => seasonOf(month))).toEqual(['autumn', 'autumn', 'autumn']);
  });
});

describe('seasonYearOf', () => {
  it('keeps December with its own year but maps Jan/Feb to the previous year (winter cross-year)', () => {
    expect(seasonYearOf(12, 2024)).toBe(2024);
    expect(seasonYearOf(1, 2025)).toBe(2024);
    expect(seasonYearOf(2, 2025)).toBe(2024);
  });

  it('returns the calendar year for non-winter-tail months', () => {
    expect(seasonYearOf(7, 2024)).toBe(2024);
    expect(seasonYearOf(3, 2025)).toBe(2025);
  });
});

describe('seasonStartingOn', () => {
  it('returns the starting season on the first day of each meteorological season', () => {
    expect(seasonStartingOn(utc('2026-03-01'))).toBe('spring');
    expect(seasonStartingOn(utc('2026-06-01'))).toBe('summer');
    expect(seasonStartingOn(utc('2026-09-01'))).toBe('autumn');
    expect(seasonStartingOn(utc('2026-12-01'))).toBe('winter');
  });

  it('returns null on any other day', () => {
    expect(seasonStartingOn(utc('2026-06-02'))).toBeNull();
    expect(seasonStartingOn(utc('2026-01-01'))).toBeNull();
    expect(seasonStartingOn(utc('2026-07-01'))).toBeNull();
  });
});

describe('isSeasonStart', () => {
  it('is true only when a season starts on the target day', () => {
    expect(isSeasonStart(utc('2026-06-01'))).toBe(true);
    expect(isSeasonStart(utc('2026-06-02'))).toBe(false);
    expect(isSeasonStart(utc('2026-01-01'))).toBe(false);
  });
});
