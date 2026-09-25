import { DateTime, IANAZone } from 'luxon';
import { isoDateToDate, isoDatetimeToDate } from 'src/validation.js';

/**
 * Convert a date to a ISO 8601 datetime string.
 */
export const asDateTimeString = <T extends Date | string | undefined | null>(x: T) => {
  return x instanceof Date ? isoDatetimeToDate.encode(x) : (x as Exclude<T, Date>);
};

/**
 * Convert a date to a date string (yyyy-mm-dd).
 */
export const asDateString = (x: Date | string | null): string | null => {
  return x instanceof Date ? isoDateToDate.encode(x) : x;
};

export const extractTimeZone = (dateTimeOriginal?: string | null) => {
  const extractedTimeZone = dateTimeOriginal ? DateTime.fromISO(dateTimeOriginal, { setZone: true }).zone : undefined;
  return extractedTimeZone?.type === 'fixed' ? extractedTimeZone : undefined;
};

export const mergeTimeZone = (dateTimeOriginal?: string | null, timeZone?: string | null) => {
  return dateTimeOriginal
    ? DateTime.fromISO(dateTimeOriginal, { zone: 'UTC' }).setZone(timeZone ?? undefined)
    : undefined;
};

const canonicalZone = (zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;

/**
 * The zone the server runs in (the `TZ` env var, else the system zone), or null
 * when that is UTC under any alias, so a UTC server stores no zone as before.
 */
export const getServerTimeZone = (): string | null => {
  const zone = DateTime.local().zoneName;
  if (!zone) {
    return null;
  }

  // Node reports TZ=GMT as the offset ID '+00:00' rather than 'UTC'
  const canonical = canonicalZone(zone);
  if (canonical === 'UTC' || /^[+-]00:?00$/.test(canonical)) {
    return null;
  }

  // Node reports the legacy ICU name (TZ=Asia/Kolkata -> Asia/Calcutta), which
  // the mobile app's zone database lacks. Keep the configured spelling when it
  // names the same zone; it matches the current names geo-tz stores for GPS.
  const configured = process.env.TZ;
  if (configured && IANAZone.isValidZone(configured) && canonicalZone(configured) === canonical) {
    return configured;
  }

  return zone;
};
