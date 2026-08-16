import { formatDistanceKm, MAX_ROUND_SCORE, scorePercent, wrapLongitude, yearFromIso } from '$lib/utils/game';

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
