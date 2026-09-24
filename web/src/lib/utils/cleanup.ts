export type CleanupQueueSlug = 'space-hogs' | 'bursts' | 'screenshots' | 'blurry';
export type CleanupListQueue = 'space_hogs' | 'bursts' | 'screenshots' | 'blurry';

export const CLEANUP_QUEUE_SLUGS: Record<CleanupQueueSlug, CleanupListQueue> = {
  'space-hogs': 'space_hogs',
  bursts: 'bursts',
  screenshots: 'screenshots',
  blurry: 'blurry',
};
export const slugToQueue = (slug: CleanupQueueSlug): CleanupListQueue => CLEANUP_QUEUE_SLUGS[slug];
export const queueToSlug = (queue: CleanupListQueue): CleanupQueueSlug =>
  (Object.keys(CLEANUP_QUEUE_SLUGS) as CleanupQueueSlug[]).find((s) => CLEANUP_QUEUE_SLUGS[s] === queue)!;

export const todayMonthDay = (now = new Date()) => (now.getMonth() + 1) * 100 + now.getDate();

export const monthDayLabel = (monthDay: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(
    new Date(2000, Math.floor(monthDay / 100) - 1, monthDay % 100),
  );

export const shadeLevel = (count: number, max: number): 0 | 1 | 2 | 3 | 4 => {
  if (count <= 0 || max <= 0) {
    return 0;
  }
  const ratio = count / max;
  if (ratio <= 0.25) {
    return 1;
  }
  if (ratio <= 0.5) {
    return 2;
  }
  if (ratio <= 0.75) {
    return 3;
  }
  return 4;
};

export const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

export const browserTimeZone = () => new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Month/day arithmetic runs in the leap year 2000, so 29 February is a real date.
const LEAP_YEAR = 2000;
const toMonthDay = (date: Date) => (date.getMonth() + 1) * 100 + date.getDate();

/** Parses a `[monthDay]` route param such as `923`; undefined unless it names a real date. */
export const parseMonthDay = (param: string): number | undefined => {
  if (!/^[1-9]\d{2,3}$/.test(param)) {
    return;
  }
  const monthDay = Number(param);
  const month = Math.floor(monthDay / 100);
  const day = monthDay % 100;
  const date = new Date(LEAP_YEAR, month - 1, day);
  return month >= 1 && month <= 12 && day >= 1 && date.getMonth() === month - 1 ? monthDay : undefined;
};

/** The calendar date `delta` days away. Past 31 December it wraps to January, and the reverse. */
export const shiftMonthDay = (monthDay: number, delta: number) =>
  toMonthDay(new Date(LEAP_YEAR, Math.floor(monthDay / 100) - 1, (monthDay % 100) + delta));

/** The first date after `from`, wrapping round the year, that has photos and is not yet reviewed. */
export const nextUnreviewedDay = (
  days: Array<{ monthDay: number; assetCount: number; reviewedAt: string | null }>,
  from: number,
) => {
  const candidates = days
    .filter((day) => day.monthDay !== from && day.assetCount > 0 && !day.reviewedAt)
    .map((day) => day.monthDay)
    .sort((a, b) => a - b);
  return candidates.find((monthDay) => monthDay > from) ?? candidates[0];
};

/** The most common city among the assets, or null when none has one. */
export const dominantCity = (assets: Array<{ city: string | null }>) => {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const { city } of assets) {
    if (!city) {
      continue;
    }
    const count = (counts.get(city) ?? 0) + 1;
    counts.set(city, count);
    if (best === null || count > (counts.get(best) ?? 0)) {
      best = city;
    }
  }
  return best;
};

export const monthDayShortLabel = (monthDay: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
    new Date(LEAP_YEAR, Math.floor(monthDay / 100) - 1, monthDay % 100),
  );
