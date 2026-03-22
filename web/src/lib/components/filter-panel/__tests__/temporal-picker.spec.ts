import { describe, expect, it } from 'vitest';
import { aggregateYears, getMonthsForYear } from '../temporal-utils';

describe('TemporalPicker', () => {
  const buckets = [
    { timeBucket: '2020-01-01', count: 100 },
    { timeBucket: '2020-06-01', count: 200 },
    { timeBucket: '2020-08-01', count: 400 },
    { timeBucket: '2021-03-01', count: 150 },
    { timeBucket: '2021-07-01', count: 50 },
  ];

  it('should aggregate monthly buckets into year counts', () => {
    const years = aggregateYears(buckets);
    expect(years).toHaveLength(2);
    expect(years[0]).toEqual({ year: 2020, count: 700, volumePercent: 100 });
    expect(years[1]).toEqual({ year: 2021, count: 200, volumePercent: 29 });
  });

  it('should calculate relative volume (max year = 100%)', () => {
    const years = aggregateYears(buckets);
    expect(years[0].volumePercent).toBe(100);
    expect(years[1].volumePercent).toBeLessThan(100);
  });

  it('should return all 12 months for a specific year', () => {
    const months = getMonthsForYear(buckets, 2020);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: 1, label: 'Jan', count: 100 });
    expect(months[5]).toEqual({ month: 6, label: 'Jun', count: 200 });
    expect(months[7]).toEqual({ month: 8, label: 'Aug', count: 400 });
    expect(months[1]).toEqual({ month: 2, label: 'Feb', count: 0 });
  });

  it('should handle empty buckets', () => {
    const years = aggregateYears([]);
    expect(years).toHaveLength(0);
  });

  it('should handle single bucket', () => {
    const years = aggregateYears([{ timeBucket: '2023-05-01', count: 42 }]);
    expect(years).toHaveLength(1);
    expect(years[0]).toEqual({ year: 2023, count: 42, volumePercent: 100 });
  });
});
