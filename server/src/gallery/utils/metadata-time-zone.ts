import { Tags, defaultVideosToUTC } from 'exiftool-vendored';
import { DateTime, IANAZone } from 'luxon';

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

/**
 * exiftool assumes UTC only to parse a zone-less QuickTime timestamp: the instant is right but the
 * zone is unknown, so use the server's TZ, as the docs describe (#1147). exiftool reports the same
 * source when the date says +00:00 or Z outright (e.g. an iPhone video recorded in Lisbon); that UTC
 * came from the file, so it stays. Reads zoneSource only: exiftool-vendored 39 sets it alongside the
 * deprecated tzSource, and MetadataService clears zone/tz/zoneSource (not tzSource) when a sidecar
 * date replaces the file's, so a stale tzSource must not count.
 */
export const resolveAssumedUtcVideoZone = (
  tags: Pick<Tags, 'zoneSource'>,
  rawDateTime: string | undefined,
  timeZone: string | null,
): string | null => {
  const hasExplicitUtcOffset = rawDateTime?.endsWith('Z') || rawDateTime?.endsWith('+00:00');
  const serverTimeZone = getServerTimeZone();
  if (tags.zoneSource === defaultVideosToUTC && !hasExplicitUtcOffset && serverTimeZone) {
    return serverTimeZone;
  }
  return timeZone;
};

/**
 * A file with no date in its metadata falls back to its earliest file timestamp. Keep that time's
 * local wall clock in whatever zone is known, else the server's TZ (#1147), instead of storing it as UTC.
 */
export const resolveDatelessFileDates = (earliestDate: DateTime, timeZone: string | null) => {
  const zone = timeZone ?? getServerTimeZone();
  const dateTimeOriginal = earliestDate.setZone(zone ?? 'UTC');
  return { timeZone: zone, dateTimeOriginal, localDateTime: dateTimeOriginal.setZone('UTC', { keepLocalTime: true }) };
};
