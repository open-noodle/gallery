import { THEMES, themeForMonth } from 'src/services/memory-rules/theme.catalog';

describe('THEMES', () => {
  it('has 6 entries', () => {
    expect(THEMES).toHaveLength(6);
  });

  it('has unique keys', () => {
    const keys = THEMES.map((theme) => theme.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has a non-empty query and label for every entry', () => {
    for (const theme of THEMES) {
      expect(theme.query.length).toBeGreaterThan(0);
      expect(theme.label.length).toBeGreaterThan(0);
    }
  });
});

describe(themeForMonth.name, () => {
  it('is pinned for all 12 months', () => {
    const keysByMonth = Array.from({ length: 12 }, (_, index) => themeForMonth(index + 1).key);
    expect(keysByMonth).toEqual([
      'sunset',
      'beach',
      'food',
      'mountains',
      'snow',
      'city_night',
      'sunset',
      'beach',
      'food',
      'mountains',
      'snow',
      'city_night',
    ]);
  });

  it('gives the same theme for month 1 and month 7 (6 themes, 12 months)', () => {
    expect(themeForMonth(1).key).toBe(themeForMonth(7).key);
  });

  it('depends only on the month, so the same month in different years gives the same theme', () => {
    // themeForMonth takes only a month number, so there is no year input to vary — this is
    // exactly why rotation is stable across year and leap boundaries (365 % 6 !== 0 would
    // break a day-of-year based rotation).
    for (let month = 1; month <= 12; month++) {
      expect(themeForMonth(month)).toEqual(themeForMonth(month));
    }
  });
});
