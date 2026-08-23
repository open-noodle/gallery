import { Chapter, CHAPTER_MAX_SPAN_DAYS, DayCount, densestChapter } from 'src/services/memory-rules/chapter.util';

const day = (iso: string, count: number): DayCount => ({ day: new Date(`${iso}T00:00:00.000Z`), count });

describe('densestChapter', () => {
  it('returns null for empty input', () => {
    expect(densestChapter([], 14)).toBeNull();
  });

  it('returns a single-day window when given one day', () => {
    const result = densestChapter([day('2024-05-01', 3)], 14);
    expect(result).toEqual<Chapter>({
      from: new Date('2024-05-01T00:00:00.000Z'),
      to: new Date('2024-05-01T00:00:00.000Z'),
      count: 3,
    });
  });

  it('covers the whole set when every day fits inside the span', () => {
    const days = [day('2024-05-01', 2), day('2024-05-03', 4), day('2024-05-05', 1)];
    const result = densestChapter(days, 14);
    expect(result).toEqual<Chapter>({
      from: new Date('2024-05-01T00:00:00.000Z'),
      to: new Date('2024-05-05T00:00:00.000Z'),
      count: 7,
    });
  });

  it('picks the denser of two far-apart clusters', () => {
    const days = [
      day('2020-01-01', 2),
      day('2020-01-02', 2),
      // second cluster, denser, far away from the first
      day('2020-06-01', 5),
      day('2020-06-02', 6),
    ];
    const result = densestChapter(days, 14);
    expect(result).toEqual<Chapter>({
      from: new Date('2020-06-01T00:00:00.000Z'),
      to: new Date('2020-06-02T00:00:00.000Z'),
      count: 11,
    });
  });

  it('breaks a tie between two equally dense clusters by picking the more recent one', () => {
    const days = [
      // earlier 3-day cluster, total 9
      day('2020-01-01', 3),
      day('2020-01-02', 3),
      day('2020-01-03', 3),
      // later 3-day cluster, also total 9
      day('2020-06-01', 3),
      day('2020-06-02', 3),
      day('2020-06-03', 3),
    ];
    const result = densestChapter(days, 14);
    expect(result?.from).toEqual(new Date('2020-06-01T00:00:00.000Z'));
    expect(result?.count).toBe(9);
  });

  it('includes both days when they are exactly maxSpanDays - 1 apart', () => {
    const days = [day('2020-01-01', 4), day('2020-01-14', 5)];
    const result = densestChapter(days, CHAPTER_MAX_SPAN_DAYS);
    expect(result).toEqual<Chapter>({
      from: new Date('2020-01-01T00:00:00.000Z'),
      to: new Date('2020-01-14T00:00:00.000Z'),
      count: 9,
    });
  });

  it('splits into separate windows when days are exactly maxSpanDays apart', () => {
    const days = [day('2020-01-01', 4), day('2020-01-15', 5)];
    const result = densestChapter(days, CHAPTER_MAX_SPAN_DAYS);
    expect(result).toEqual<Chapter>({
      from: new Date('2020-01-15T00:00:00.000Z'),
      to: new Date('2020-01-15T00:00:00.000Z'),
      count: 5,
    });
  });

  it('finds a dense window at the very start of the series (no off-by-one at left = 0)', () => {
    const days = [day('2020-01-01', 10), day('2020-01-02', 10), day('2020-03-01', 1), day('2020-05-01', 1)];
    const result = densestChapter(days, 14);
    expect(result).toEqual<Chapter>({
      from: new Date('2020-01-01T00:00:00.000Z'),
      to: new Date('2020-01-02T00:00:00.000Z'),
      count: 20,
    });
  });

  it('returns the same result regardless of input order (defensive sort)', () => {
    const ascending = [day('2020-01-01', 2), day('2020-01-02', 2), day('2020-06-01', 5), day('2020-06-02', 6)];
    const descending = ascending.toReversed();

    expect(densestChapter(descending, 14)).toEqual(densestChapter(ascending, 14));
  });
});
