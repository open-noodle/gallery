export const CHAPTER_MAX_SPAN_DAYS = 14;

export interface DayCount {
  day: Date;
  count: number;
}

export interface Chapter {
  from: Date; // first day of the winning window
  to: Date; // last day of the winning window
  count: number; // assets inside it, summed from the daily counts
}

const MS_PER_DAY = 86_400_000;

/**
 * Widest-count window of at most `maxSpanDays` consecutive calendar days.
 * Sorts `days` ascending defensively — the query already orders them, but the
 * two-pointer sweep silently returns garbage on unsorted input rather than
 * failing, so the contract is enforced here rather than assumed.
 * Ties resolve to the MOST RECENT window. Returns null for empty input.
 */
export const densestChapter = (days: DayCount[], maxSpanDays: number): Chapter | null => {
  if (days.length === 0) {
    return null;
  }

  const sorted = [...days].sort((a, b) => a.day.getTime() - b.day.getTime());

  let left = 0;
  let sum = 0;
  let best: Chapter | null = null;

  for (let right = 0; right < sorted.length; right++) {
    sum += sorted[right]!.count;

    while ((sorted[right]!.day.getTime() - sorted[left]!.day.getTime()) / MS_PER_DAY > maxSpanDays - 1) {
      sum -= sorted[left]!.count;
      left++;
    }

    if (best === null || sum >= best.count) {
      best = { from: sorted[left]!.day, to: sorted[right]!.day, count: sum };
    }
  }

  return best;
};
