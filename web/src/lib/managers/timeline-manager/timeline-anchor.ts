import type { TimelineManager } from './timeline-manager.svelte';
import type { TimelineBucketDate, TimelineTemporalAnchor } from './types';

type TimelineTemporalAnchorTarget = {
  top: number;
  height: number;
};

function matchesAnchorDate(date: TimelineBucketDate, anchor: TimelineTemporalAnchor) {
  // A bucket without a month (year overview) matches on the year alone, so a
  // month-precision anchor still resolves when the grouping is coarser than the anchor.
  return (
    date.year === anchor.year && (anchor.month === undefined || date.month === undefined || date.month === anchor.month)
  );
}

function targetIsInViewport(timelineManager: TimelineManager, target: TimelineTemporalAnchorTarget): boolean {
  const viewportTop = timelineManager.scrollTop;
  const viewportBottom = viewportTop + timelineManager.viewportHeight;
  const targetBottom = target.top + target.height;

  return targetBottom > viewportTop && target.top < viewportBottom;
}

function getScrollTopForTarget(timelineManager: TimelineManager, target: TimelineTemporalAnchorTarget): number {
  return Math.min(target.top, Math.max(0, timelineManager.maxScroll));
}

export function getTimelineTemporalAnchorTarget(
  timelineManager: TimelineManager,
  anchor: TimelineTemporalAnchor,
): TimelineTemporalAnchorTarget | undefined {
  if (timelineManager.grouping === 'day' && anchor.month !== undefined) {
    const month = timelineManager.months.find(
      (month) => month.yearMonth.year === anchor.year && month.yearMonth.month === anchor.month,
    );

    if (!month) {
      return;
    }

    return { top: month.top, height: month.height };
  }

  const bucket = timelineManager.timelineBuckets.find((bucket) => matchesAnchorDate(bucket.date, anchor));
  if (!bucket) {
    return;
  }

  return { top: bucket.top, height: bucket.height };
}

/**
 * The date currently at the top of the viewport, expressed as a temporal anchor
 * for the active grouping. Used to preserve the visible position when the user
 * changes the grouping granularity, so the rebuilt timeline can scroll back to it
 * instead of jumping to the most recent content.
 */
export function getTimelineTopVisibleAnchor(timelineManager: TimelineManager): TimelineTemporalAnchor | undefined {
  if (!timelineManager?.isInitialized) {
    return undefined;
  }

  const { scrollTop } = timelineManager;

  if (timelineManager.grouping === 'day') {
    const months = timelineManager.months;
    if (!months || months.length === 0) {
      return undefined;
    }
    const month = months.find((month) => scrollTop >= month.top && scrollTop < month.top + month.height) ?? months[0];
    return { year: month.yearMonth.year, month: month.yearMonth.month };
  }

  const buckets = timelineManager.timelineBuckets;
  if (!buckets || buckets.length === 0) {
    return undefined;
  }
  const bucket =
    buckets.find((bucket) => scrollTop >= bucket.top && scrollTop < bucket.top + bucket.height) ?? buckets[0];

  return bucket.date.month === undefined
    ? { year: bucket.date.year }
    : { year: bucket.date.year, month: bucket.date.month };
}

export function scrollTimelineToTemporalAnchor(
  timelineManager: TimelineManager,
  anchor: TimelineTemporalAnchor,
): boolean {
  const target = getTimelineTemporalAnchorTarget(timelineManager, anchor);
  if (!target) {
    return false;
  }

  timelineManager.scrollTo(getScrollTopForTarget(timelineManager, target));
  return targetIsInViewport(timelineManager, target);
}
