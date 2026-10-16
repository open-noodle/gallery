import { DateTime } from 'luxon';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getServerTimeZone,
  resolveAssumedUtcVideoZone,
  resolveDatelessFileDates,
} from 'src/gallery/utils/metadata-time-zone.js';

afterEach(() => {
  process.env.TZ = 'UTC';
});

describe('getServerTimeZone', () => {
  it('should return the IANA zone the server runs in', () => {
    process.env.TZ = 'America/Port_of_Spain';
    expect(getServerTimeZone()).toBe('America/Port_of_Spain');
  });

  // Node resolves these to their legacy ICU names (Asia/Calcutta, ...), which
  // the mobile app's time zone database does not know.
  it.each(['Asia/Kolkata', 'Europe/Kyiv', 'Asia/Ho_Chi_Minh'])('should keep the configured spelling of %s', (zone) => {
    process.env.TZ = zone;
    expect(getServerTimeZone()).toBe(zone);
  });

  it('should not return a TZ value that is not itself a zone name', () => {
    process.env.TZ = ':America/New_York';
    expect(getServerTimeZone()).toBe('America/New_York');
  });

  it('should return a zone whose offset is 0 for part of the year', () => {
    process.env.TZ = 'Europe/London';
    expect(getServerTimeZone()).toBe('Europe/London');
  });

  it.each(['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT', 'Etc/Universal'])(
    'should return null when the server runs in %s',
    (zone) => {
      process.env.TZ = zone;
      expect(getServerTimeZone()).toBeNull();
    },
  );

  it('should return null when TZ is not a zone the runtime understands', () => {
    // Node falls back to UTC and reports no zone name
    process.env.TZ = 'not-a-zone';
    expect(getServerTimeZone()).toBeNull();
  });
});

describe('resolveAssumedUtcVideoZone', () => {
  it.each(['tzSource', 'zoneSource'] as const)('should use the server zone for an assumed UTC (%s)', (key) => {
    process.env.TZ = 'America/New_York';
    expect(resolveAssumedUtcVideoZone({ [key]: 'defaultVideosToUTC' }, '2024:06:01 01:07:00', 'UTC')).toBe(
      'America/New_York',
    );
  });

  it.each(['2024:06:01 01:07:00Z', '2024:06:01 01:07:00+00:00'])('should keep a UTC the file states: %s', (raw) => {
    process.env.TZ = 'America/New_York';
    expect(resolveAssumedUtcVideoZone({ tzSource: 'defaultVideosToUTC' }, raw, 'UTC+0')).toBe('UTC+0');
  });

  it('should keep the zone on a UTC server', () => {
    expect(resolveAssumedUtcVideoZone({ tzSource: 'defaultVideosToUTC' }, '2024:06:01 01:07:00', 'UTC')).toBe('UTC');
  });

  it('should keep a zone that came from the metadata', () => {
    process.env.TZ = 'America/New_York';
    expect(resolveAssumedUtcVideoZone({ tzSource: 'GPSLatitude/GPSLongitude' }, undefined, 'Europe/Paris')).toBe(
      'Europe/Paris',
    );
  });
});

describe('resolveDatelessFileDates', () => {
  const earliest = DateTime.fromISO('2024-06-01T01:07:00Z');

  it('should keep the local time in the server zone', () => {
    process.env.TZ = 'America/New_York';
    const result = resolveDatelessFileDates(earliest, null);
    expect(result.timeZone).toBe('America/New_York');
    expect(result.dateTimeOriginal.toMillis()).toBe(earliest.toMillis());
    expect(result.localDateTime.toISO()).toBe('2024-05-31T21:07:00.000Z');
  });

  it("should prefer the file's own zone", () => {
    process.env.TZ = 'America/New_York';
    const result = resolveDatelessFileDates(earliest, 'Asia/Tokyo');
    expect(result.timeZone).toBe('Asia/Tokyo');
    expect(result.localDateTime.toISO()).toBe('2024-06-01T10:07:00.000Z');
  });

  it('should store UTC with no zone on a UTC server', () => {
    const result = resolveDatelessFileDates(earliest, null);
    expect(result.timeZone).toBeNull();
    expect(result.localDateTime.toISO()).toBe('2024-06-01T01:07:00.000Z');
  });
});
