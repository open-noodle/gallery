import {
  formatDistanceKm,
  MAX_ROUND_SCORE,
  scorePercent,
  timeUntilNextDaily,
  wrapLongitude,
  yearFromIso,
} from '$lib/utils/game';

describe('formatDistanceKm', () => {
  it('uses metres below one kilometre', () => {
    expect(formatDistanceKm(0)).toBe('0 m');
    expect(formatDistanceKm(0.42)).toBe('420 m');
  });

  it('uses one decimal between 1 and 10 km', () => {
    expect(formatDistanceKm(1.24)).toBe('1.2 km');
  });

  it('rounds to whole kilometres above 10', () => {
    expect(formatDistanceKm(550.4)).toBe('550 km');
    expect(formatDistanceKm(17_755)).toBe('17,755 km');
  });
});

describe('scorePercent', () => {
  it('maps the score range onto 0-100', () => {
    expect(scorePercent(0)).toBe(0);
    expect(scorePercent(MAX_ROUND_SCORE)).toBe(100);
    expect(scorePercent(2500)).toBe(50);
  });

  it('clamps out-of-range input rather than overflowing the bar', () => {
    expect(scorePercent(-10)).toBe(0);
    expect(scorePercent(99_999)).toBe(100);
  });
});

describe('yearFromIso', () => {
  it('reads the calendar year', () => {
    expect(yearFromIso('2020-07-01T14:23:00.000Z')).toBe(2020);
  });
});

describe('wrapLongitude', () => {
  it('leaves an in-range longitude untouched', () => {
    expect(wrapLongitude(45.5)).toBe(45.5);
    expect(wrapLongitude(-179)).toBe(-179);
  });

  // 180 and -180 are the same meridian; the modulo formula normalises the exact boundary to -180.
  it('normalises the antimeridian boundary to -180', () => {
    expect(wrapLongitude(180)).toBe(-180);
    expect(wrapLongitude(-180)).toBe(-180);
  });

  it('wraps a longitude past the antimeridian back into [-180, 180]', () => {
    expect(wrapLongitude(200)).toBe(-160);
    expect(wrapLongitude(-230)).toBe(130);
  });
});

describe('timeUntilNextDaily', () => {
  it('counts the remaining hours and minutes of the UTC day', () => {
    expect(timeUntilNextDaily(new Date('2026-08-16T21:45:00.000Z'))).toBe('2h 15m');
    expect(timeUntilNextDaily(new Date('2026-08-16T00:00:00.000Z'))).toBe('24h 0m');
    expect(timeUntilNextDaily(new Date('2026-08-16T23:59:00.000Z'))).toBe('0h 1m');
  });

  // The whole point of the UTC choice: the server keys the daily on the UTC calendar day, so a
  // countdown built from local time would run to the wrong instant for every viewer outside UTC -
  // and for one east of it, would still be counting after the new daily had already appeared.
  it('is driven by the UTC day, not the local one', () => {
    // 22:30 UTC on 16 August is already 00:30 on the 17th in UTC+2. A local-day countdown would
    // read ~23h30m here; the UTC answer is 1h30m.
    expect(timeUntilNextDaily(new Date('2026-08-16T22:30:00.000Z'))).toBe('1h 30m');
  });

  // Crossing a month boundary relies on Date.UTC normalising day 32 into the 1st, rather than any
  // month-length arithmetic of our own.
  it('rolls over the end of a month', () => {
    expect(timeUntilNextDaily(new Date('2026-08-31T23:00:00.000Z'))).toBe('1h 0m');
  });
});
