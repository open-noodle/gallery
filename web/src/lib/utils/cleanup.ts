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
