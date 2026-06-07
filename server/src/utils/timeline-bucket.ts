import { BadRequestException } from '@nestjs/common';
import { TimeBucketSize } from 'src/enum';

const TIME_BUCKET_PATTERN = /^([+]?\d{4,6})-(\d{2})-(\d{2})$/;

export function dateTruncUnitForTimeBucketSize(bucketSize: TimeBucketSize) {
  return {
    [TimeBucketSize.Year]: 'YEAR',
    [TimeBucketSize.Month]: 'MONTH',
    [TimeBucketSize.Day]: 'DAY',
  }[bucketSize];
}

export function normalizeTimeBucketForBucketSize(timeBucket: string, bucketSize: TimeBucketSize) {
  const match = TIME_BUCKET_PATTERN.exec(timeBucket);
  if (!match) {
    throw new BadRequestException('Invalid time bucket format');
  }

  const yearText = match[1].replace(/^[+]/, '');
  const year = Number(yearText);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = getDaysInMonth(year, month);

  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new BadRequestException('Invalid time bucket format');
  }

  if (bucketSize === TimeBucketSize.Year && (month !== 1 || day !== 1)) {
    throw new BadRequestException('Year time buckets must start on January 1');
  }

  if (bucketSize === TimeBucketSize.Month && day !== 1) {
    throw new BadRequestException('Month time buckets must start on the first day of the month');
  }

  return `${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number) {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
