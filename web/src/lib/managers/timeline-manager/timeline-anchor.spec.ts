import { describe, expect, it, vi } from 'vitest';
import { getTimelineTopVisibleAnchor, scrollTimelineToTemporalAnchor } from './timeline-anchor';
import type { TimelineManager } from './timeline-manager.svelte';

function buildManager(timelineManager: Partial<TimelineManager>) {
  return timelineManager as TimelineManager;
}

describe('scrollTimelineToTemporalAnchor', () => {
  it('scrolls to matching representative year bucket when grouping month', () => {
    const scrollTo = vi.fn();
    let scrollTop = 0;
    const timelineManager = buildManager({
      grouping: 'month',
      timelineBuckets: [{ date: { year: 2015 }, top: 120, height: 296 }] as TimelineManager['timelineBuckets'],
      viewportHeight: 600,
      maxScroll: 1200,
      get scrollTop() {
        return scrollTop;
      },
      scrollTo: vi.fn((top: number) => {
        scrollTo(top);
        scrollTop = top;
      }),
    });

    const didScroll = scrollTimelineToTemporalAnchor(timelineManager, { year: 2015 });

    expect(didScroll).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(120);
  });

  it('scrolls to matching representative month bucket when grouping month', () => {
    const scrollTo = vi.fn();
    let scrollTop = 0;
    const timelineManager = buildManager({
      grouping: 'month',
      timelineBuckets: [
        { date: { year: 2015, month: 8 }, top: 240, height: 296 },
      ] as TimelineManager['timelineBuckets'],
      viewportHeight: 600,
      maxScroll: 1200,
      get scrollTop() {
        return scrollTop;
      },
      scrollTo: vi.fn((top: number) => {
        scrollTo(top);
        scrollTop = top;
      }),
    });

    const didScroll = scrollTimelineToTemporalAnchor(timelineManager, { year: 2015, month: 8 });

    expect(didScroll).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(240);
  });

  it('scrolls to detailed month container in day mode', () => {
    const scrollTo = vi.fn();
    let scrollTop = 0;
    const timelineManager = buildManager({
      grouping: 'day',
      months: [{ yearMonth: { year: 2015, month: 8 }, top: 360, height: 240 }] as TimelineManager['months'],
      viewportHeight: 600,
      maxScroll: 1200,
      get scrollTop() {
        return scrollTop;
      },
      scrollTo: vi.fn((top: number) => {
        scrollTo(top);
        scrollTop = top;
      }),
    });

    const didScroll = scrollTimelineToTemporalAnchor(timelineManager, { year: 2015, month: 8 });

    expect(didScroll).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(360);
  });

  it('does not report success when the scroll position remains outside the target month', () => {
    const scrollTo = vi.fn();
    const timelineManager = buildManager({
      grouping: 'day',
      months: [{ yearMonth: { year: 2015, month: 8 }, top: 1200, height: 240 }] as TimelineManager['months'],
      viewportHeight: 600,
      maxScroll: 2000,
      scrollTop: 0,
      scrollTo,
    });

    const didScroll = scrollTimelineToTemporalAnchor(timelineManager, { year: 2015, month: 8 });

    expect(didScroll).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith(1200);
  });

  it('returns false and does not scroll when target not loaded', () => {
    const scrollTo = vi.fn();
    const timelineManager = buildManager({
      grouping: 'month',
      timelineBuckets: [{ date: { year: 2015, month: 8 }, top: 240 }] as TimelineManager['timelineBuckets'],
      scrollTo,
    });

    const didScroll = scrollTimelineToTemporalAnchor(timelineManager, { year: 2016, month: 8 });

    expect(didScroll).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls a month-precision anchor to the matching year bucket when grouping year', () => {
    const scrollTo = vi.fn();
    let scrollTop = 0;
    const timelineManager = buildManager({
      grouping: 'year',
      timelineBuckets: [{ date: { year: 2017 }, top: 480, height: 296 }] as TimelineManager['timelineBuckets'],
      viewportHeight: 600,
      maxScroll: 2000,
      get scrollTop() {
        return scrollTop;
      },
      scrollTo: vi.fn((top: number) => {
        scrollTo(top);
        scrollTop = top;
      }),
    });

    const didScroll = scrollTimelineToTemporalAnchor(timelineManager, { year: 2017, month: 11 });

    expect(didScroll).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith(480);
  });
});

describe('getTimelineTopVisibleAnchor', () => {
  it('returns the month at the top of the viewport in day grouping', () => {
    const timelineManager = buildManager({
      isInitialized: true,
      grouping: 'day',
      scrollTop: 400,
      months: [
        { yearMonth: { year: 2026, month: 2 }, top: 0, height: 300 },
        { yearMonth: { year: 2017, month: 11 }, top: 300, height: 300 },
      ] as TimelineManager['months'],
    });

    expect(getTimelineTopVisibleAnchor(timelineManager)).toEqual({ year: 2017, month: 11 });
  });

  it('returns the month bucket at the top in month grouping', () => {
    const timelineManager = buildManager({
      isInitialized: true,
      grouping: 'month',
      scrollTop: 350,
      timelineBuckets: [
        { date: { year: 2026, month: 2 }, top: 0, height: 296 },
        { date: { year: 2020, month: 8 }, top: 296, height: 296 },
      ] as TimelineManager['timelineBuckets'],
    });

    expect(getTimelineTopVisibleAnchor(timelineManager)).toEqual({ year: 2020, month: 8 });
  });

  it('returns a year-only anchor at the top in year grouping', () => {
    const timelineManager = buildManager({
      isInitialized: true,
      grouping: 'year',
      scrollTop: 350,
      timelineBuckets: [
        { date: { year: 2026 }, top: 0, height: 296 },
        { date: { year: 2020 }, top: 296, height: 296 },
      ] as TimelineManager['timelineBuckets'],
    });

    expect(getTimelineTopVisibleAnchor(timelineManager)).toEqual({ year: 2020 });
  });

  it('returns undefined when scrolled within the top section above the first month (day grouping)', () => {
    // The first month starts at topSectionHeight (e.g. below the memories strip); a scrollTop above
    // it means the top section is visible, so there is no month to anchor to.
    const timelineManager = buildManager({
      isInitialized: true,
      grouping: 'day',
      scrollTop: 0,
      months: [
        { yearMonth: { year: 2026, month: 2 }, top: 260, height: 300 },
        { yearMonth: { year: 2017, month: 11 }, top: 560, height: 300 },
      ] as TimelineManager['months'],
    });

    expect(getTimelineTopVisibleAnchor(timelineManager)).toBeUndefined();
  });

  it('returns undefined when scrolled within the top section above the first card (year grouping)', () => {
    const timelineManager = buildManager({
      isInitialized: true,
      grouping: 'year',
      scrollTop: 120,
      timelineBuckets: [
        { date: { year: 2026 }, top: 260, height: 296 },
        { date: { year: 2020 }, top: 556, height: 296 },
      ] as TimelineManager['timelineBuckets'],
    });

    expect(getTimelineTopVisibleAnchor(timelineManager)).toBeUndefined();
  });

  it('returns undefined when the timeline is not initialized', () => {
    expect(getTimelineTopVisibleAnchor(buildManager({ isInitialized: false }))).toBeUndefined();
  });
});
