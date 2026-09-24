import { BadRequestException } from '@nestjs/common';

export const CLEANUP_BURST_GAP_MS = 2000;
export const CLEANUP_BURST_CLIP_MAX_DISTANCE = 0.1;
/** Extra windows `fetchBurstWindow` may append while a burst straddles the window edge. */
export const CLEANUP_BURST_MAX_EXTENSIONS = 10;
export const CLEANUP_BURST_WINDOW = 2000;
/**
 * Burst-window queries one bursts page may start. A library with few bursts would otherwise scan to
 * its end looking for `limit` groups (~250 windows at 500k assets). At ~13 ms per window query
 * (500k seed), 8 windows cost ~105 ms; the worst case — a burst still straddling the last window's
 * edge — adds up to `CLEANUP_BURST_MAX_EXTENSIONS` more, ~235 ms, still under the 300 ms budget. Past
 * the cap the page ends early (possibly empty) with a cursor, and the client asks for the next one.
 */
export const CLEANUP_BURST_MAX_WINDOWS_PER_PAGE = 8;
export const CLEANUP_BLUR_THRESHOLDS = { lenient: 25, balanced: 60, strict: 110 } as const;
export const CLEANUP_DARK = { maxBrightness: 35, minClippedDark: 0.5 } as const;
export const CLEANUP_BRIGHT = { minClippedBright: 0.4 } as const;
export const CLEANUP_QUALITY_VERSION = 1;
export const CLEANUP_ANALYSIS_SIZE = 512;
export const CLEANUP_MAX_IDS = 1000;
export const CLEANUP_PAGE_LIMIT = { default: 100, max: 500 } as const;
export const CLEANUP_SPACE_HOG_DEFAULT_MIN_SIZE = 104_857_600;

export type CleanupStrictnessValue = keyof typeof CLEANUP_BLUR_THRESHOLDS;

/**
 * Blurry queue defaults, matching the page's own defaults. Shared by the service's list path
 * (`CleanupService.getQueue`) and the repository's `countBlurry`, so the hub card and the list page
 * can never silently drift apart on what "default" means.
 */
export const CLEANUP_BLURRY_DEFAULTS = { strictness: 'balanced', reason: 'all', hideFaces: true } as const;

export const CLEANUP_SCREENSHOT_PATTERNS =
  /(screen ?shot|screen recording|bildschirmfoto|capture d.écran|schermafbeelding|captura de pantalla|截屏|スクリーンショット)/i;

export const laplacianVariance = (pixels: Uint8Array | Buffer, width: number, height: number): number => {
  if (width < 3 || height < 3) {
    return 0;
  }
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const v = pixels[i - width] + pixels[i + width] + pixels[i - 1] + pixels[i + 1] - 4 * pixels[i];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
};

export const exposureStats = (pixels: Uint8Array | Buffer) => {
  const n = pixels.length;
  if (n === 0) {
    return { brightness: 0, clippedDark: 0, clippedBright: 0 };
  }
  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < n; i++) {
    const v = pixels[i];
    sum += v;
    if (v <= 8) dark++;
    else if (v >= 247) bright++;
  }
  return { brightness: sum / n, clippedDark: dark / n, clippedBright: bright / n };
};

export const isScreenshotCandidate = (input: {
  originalFileName: string;
  mimeType?: string | null;
  make?: string | null;
  model?: string | null;
  width?: number | null;
  height?: number | null;
}): boolean => {
  if (CLEANUP_SCREENSHOT_PATTERNS.test(input.originalFileName)) {
    return true;
  }
  if (input.mimeType?.startsWith('video/')) {
    return false;
  }
  if (input.make || input.model) {
    return false;
  }
  if (input.mimeType === 'image/png' || /\.png$/i.test(input.originalFileName)) {
    return true;
  }
  if (input.width && input.height) {
    const ratio = Math.max(input.width, input.height) / Math.min(input.width, input.height);
    return ratio >= 2;
  }
  return false;
};

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const toMonthDay = (month: number, day: number) => month * 100 + day;
export const isValidMonthDay = (monthDay: number): boolean => {
  if (!Number.isSafeInteger(monthDay)) {
    return false;
  }
  const month = Math.floor(monthDay / 100);
  const day = monthDay % 100;
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
};
export const ALL_MONTH_DAYS: number[] = DAYS_IN_MONTH.flatMap((days, m) =>
  Array.from({ length: days }, (_, d) => toMonthDay(m + 1, d + 1)),
);

export const isValidTimeZone = (tz: string): boolean => {
  if (!tz) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const localDateKey = (date: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export const computeStreak = (reviewedAt: Date[], tz: string, now: Date): number => {
  const days = new Set(reviewedAt.map((d) => localDateKey(d, tz)));
  const dayMs = 86_400_000;
  let cursor = now;
  if (!days.has(localDateKey(cursor, tz))) {
    cursor = new Date(cursor.getTime() - dayMs);
    if (!days.has(localDateKey(cursor, tz))) {
      return 0;
    }
  }
  let streak = 0;
  while (days.has(localDateKey(cursor, tz))) {
    streak++;
    cursor = new Date(cursor.getTime() - dayMs);
  }
  return streak;
};

export type BurstRow = {
  id: string;
  /** Millisecond `Date`, used for gap maths only. Never build a cursor from it — see `cursorT`. */
  localDateTime: Date;
  /** Full-precision (microsecond) ISO timestamp from the database; the only safe keyset cursor value. */
  cursorT: string;
  autoStackId: string | null;
  sharpness: number | null;
  fileSize: number;
};
export type BurstGroup = { source: 'burstId' | 'timeWindow'; assets: BurstRow[] };

export const groupBursts = (rows: BurstRow[], gapMs = CLEANUP_BURST_GAP_MS): BurstGroup[] => {
  const groups: BurstRow[][] = [];
  let current: BurstRow[] = [];
  for (const row of rows) {
    const prev = current.at(-1);
    const split =
      !prev ||
      row.localDateTime.getTime() - prev.localDateTime.getTime() > gapMs ||
      (prev.autoStackId ?? null) !== (row.autoStackId ?? null);
    if (split) {
      if (current.length > 0) groups.push(current);
      current = [row];
    } else {
      current.push(row);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups
    .filter((g) => g.length >= 2)
    .map((assets) => ({ source: assets[0].autoStackId ? 'burstId' : 'timeWindow', assets }));
};

export const suggestKeep = (group: BurstRow[]): string => {
  const sorted = [...group].sort(
    (a, b) =>
      (b.sharpness ?? -1) - (a.sharpness ?? -1) ||
      b.fileSize - a.fileSize ||
      a.localDateTime.getTime() - b.localDateTime.getTime(),
  );
  return sorted[0].id;
};

export type CleanupCursor = { v: Array<string | number> };

/**
 * A `(localDateTime, id)` keyset cursor's timestamp: an ISO-8601 UTC string with up to microsecond
 * precision, as produced by `CLEANUP_CURSOR_T_SQL`. Anything else is rejected before it reaches SQL.
 *
 * A JS Date rolls impossible dates over (`2024-02-30` becomes 1 March), which PostgreSQL's
 * `::timestamptz` cast would then reject with a 500, so the parsed value must round-trip to the same
 * seconds. Cursors outside the years 0001-9999 are unsupported; EXIF cannot produce them in practice.
 */
export const isCleanupCursorTimestamp = (value: string) => {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19);
};
export const encodeCursor = (value: CleanupCursor) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const decodeCursor = (value: string): CleanupCursor => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as CleanupCursor).v) &&
      (parsed as CleanupCursor).v.every((x) => typeof x === 'string' || typeof x === 'number')
    ) {
      return parsed as CleanupCursor;
    }
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor');
};
