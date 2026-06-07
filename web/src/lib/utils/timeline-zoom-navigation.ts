import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';

export type ActivatableTimelineBucket = {
  grouping: TimelineGrouping;
  date: {
    year: number;
    month?: number;
    day?: number;
  };
};

export type TimelineZoomActivationResult = {
  grouping: TimelineGrouping;
  anchor: TimelineTemporalAnchor;
};

type TemporalBucketSource = {
  timelineBuckets?: Array<{ timeBucket: string; count: number }>;
  months?: Array<{ yearMonth: { year: number; month: number }; assetsCount: number }>;
};

export function getTimelineBucketZoomTarget(
  bucket: ActivatableTimelineBucket,
): TimelineZoomActivationResult | undefined {
  if (bucket.grouping === 'year') {
    return {
      grouping: 'month',
      anchor: { year: bucket.date.year },
    };
  }

  if (bucket.grouping === 'month') {
    if (bucket.date.month === undefined) {
      return;
    }

    return {
      grouping: 'day',
      anchor: { year: bucket.date.year, month: bucket.date.month },
    };
  }
}

export function getTimelineManagerTimeBuckets(source: TemporalBucketSource | undefined) {
  if (!source) {
    return [];
  }

  if (source.timelineBuckets && source.timelineBuckets.length > 0) {
    return source.timelineBuckets.map(({ timeBucket, count }) => ({ timeBucket, count }));
  }

  return (
    source.months?.map((month) => ({
      timeBucket: `${String(month.yearMonth.year).padStart(4, '0')}-${String(month.yearMonth.month).padStart(2, '0')}-01`,
      count: month.assetsCount,
    })) ?? []
  );
}
