import { BadRequestException } from '@nestjs/common';
import { TimeBucketSize } from 'src/enum';
import { dateTruncUnitForTimeBucketSize, normalizeTimeBucketForBucketSize } from 'src/utils/timeline-bucket';

describe('normalizeTimeBucketForBucketSize', () => {
  it('accepts a year bucket at January 1', () => {
    expect(normalizeTimeBucketForBucketSize('2024-01-01', TimeBucketSize.Year)).toBe('2024-01-01');
  });

  it('rejects a year bucket that does not start on January 1', () => {
    expect(() => normalizeTimeBucketForBucketSize('2024-02-01', TimeBucketSize.Year)).toThrow(BadRequestException);
  });

  it('accepts a month bucket on day 1', () => {
    expect(normalizeTimeBucketForBucketSize('2024-02-01', TimeBucketSize.Month)).toBe('2024-02-01');
  });

  it('rejects a month bucket that does not start on day 1', () => {
    expect(() => normalizeTimeBucketForBucketSize('2024-02-10', TimeBucketSize.Month)).toThrow(BadRequestException);
  });

  it('accepts a leap-day day bucket', () => {
    expect(normalizeTimeBucketForBucketSize('2024-02-29', TimeBucketSize.Day)).toBe('2024-02-29');
  });

  it('rejects an invalid leap-day bucket', () => {
    expect(() => normalizeTimeBucketForBucketSize('2023-02-29', TimeBucketSize.Day)).toThrow(BadRequestException);
  });

  it('preserves five-digit years used by existing timeline bucket calls', () => {
    expect(normalizeTimeBucketForBucketSize('012345-01-01', TimeBucketSize.Month)).toBe('012345-01-01');
  });
});

describe('dateTruncUnitForTimeBucketSize', () => {
  it.each([
    [TimeBucketSize.Year, 'YEAR'],
    [TimeBucketSize.Month, 'MONTH'],
    [TimeBucketSize.Day, 'DAY'],
  ])('maps %s to %s', (bucketSize, unit) => {
    expect(dateTruncUnitForTimeBucketSize(bucketSize)).toBe(unit);
  });
});
