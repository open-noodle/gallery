import { CleanupCountQueue, CleanupQueue, CleanupListQueue as SdkCleanupListQueue } from '@immich/sdk';

export type CleanupQueueSlug = 'space-hogs' | 'bursts' | 'screenshots' | 'blurry';
export type CleanupListQueue = 'space_hogs' | 'bursts' | 'screenshots' | 'blurry';

export const CLEANUP_QUEUE_SLUGS: Record<CleanupQueueSlug, CleanupListQueue> = {
  'space-hogs': 'space_hogs',
  bursts: 'bursts',
  screenshots: 'screenshots',
  blurry: 'blurry',
};
export const slugToQueue = (slug: CleanupQueueSlug): CleanupListQueue => CLEANUP_QUEUE_SLUGS[slug];

/** The SDK enums for a queue: listing, counting and committing each use their own. */
export const CLEANUP_SDK_QUEUES: Record<
  CleanupListQueue,
  { list: SdkCleanupListQueue; count: CleanupCountQueue; commit: CleanupQueue }
> = {
  space_hogs: {
    list: SdkCleanupListQueue.SpaceHogs,
    count: CleanupCountQueue.SpaceHogs,
    commit: CleanupQueue.SpaceHogs,
  },
  bursts: { list: SdkCleanupListQueue.Bursts, count: CleanupCountQueue.Bursts, commit: CleanupQueue.Bursts },
  screenshots: {
    list: SdkCleanupListQueue.Screenshots,
    count: CleanupCountQueue.Screenshots,
    commit: CleanupQueue.Screenshots,
  },
  blurry: { list: SdkCleanupListQueue.Blurry, count: CleanupCountQueue.Blurry, commit: CleanupQueue.Blurry },
};

/** Must match the server's default, which the hub's Space hogs count uses: 100 MiB. */
export const CLEANUP_SPACE_HOG_DEFAULT_MIN_SIZE = 104_857_600;
export const CLEANUP_SPACE_HOG_MIN_SIZES = [52_428_800, CLEANUP_SPACE_HOG_DEFAULT_MIN_SIZE, 524_288_000, 1_073_741_824];
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

/** Must match the server's `CLEANUP_BURST_GAP_MS`: shots at most this far apart form a burst. */
export const CLEANUP_BURST_GAP_MS = 2000;

/**
 * The ids of photos taken within `CLEANUP_BURST_GAP_MS` of another photo in `assets`. Rewind's
 * one-at-a-time hints use it to point at the Bursts queue; it is the time rule only, without the
 * server's CLIP check, so it is a hint rather than a promise that the photo is in that queue.
 */
export const burstMemberIds = (assets: Array<{ id: string; localDateTime: string }>) => {
  // `map` already copies, so sorting in place does not touch the caller's array.
  const sorted = assets.map(({ id, localDateTime }) => ({ id, time: Date.parse(localDateTime) }));
  sorted.sort((a, b) => a.time - b.time);
  const ids = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].time - sorted[i - 1].time > CLEANUP_BURST_GAP_MS) {
      continue;
    }
    ids.add(sorted[i - 1].id);
    ids.add(sorted[i].id);
  }
  return ids;
};

export type BurstMark = 'keep' | 'trash';

type BurstGroupLike = { suggestedKeepId: string; assets: Array<{ id: string }> };

/** A burst photo's mark: whatever the user set, else keep for the suggested pick and trash for the rest. */
export const burstMarkOf = (group: BurstGroupLike, marks: ReadonlyMap<string, BurstMark>, id: string): BurstMark =>
  marks.get(id) ?? (id === group.suggestedKeepId ? 'keep' : 'trash');

/** Splits every member of a burst group into keep and trash, by its current mark. */
export const burstDecision = (group: BurstGroupLike, marks: ReadonlyMap<string, BurstMark>) => {
  const keepIds: string[] = [];
  const trashIds: string[] = [];
  for (const { id } of group.assets) {
    (burstMarkOf(group, marks, id) === 'keep' ? keepIds : trashIds).push(id);
  }
  return { keepIds, trashIds };
};

/**
 * "12 Aug 2024 · 14:03:21 → 14:03:24". `localDateTime` is the wall-clock time at capture stored as
 * if it were UTC, so it is formatted in UTC to show that time unchanged.
 */
export const burstTimeRange = (from: string, to: string, locale: string) => {
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  });
  return `${date.format(new Date(from))} · ${time.format(new Date(from))} → ${time.format(new Date(to))}`;
};
