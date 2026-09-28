import { afterEach, describe, expect, it } from 'vitest';
import { asDateString, asDateTimeString, getServerTimeZone } from 'src/utils/date.js';

describe('asDateString', () => {
  it('should return null for null input', () => {
    expect(asDateString(null)).toBeNull();
  });

  it('should pass through a pre-serialized string unchanged', () => {
    expect(asDateString('2000-01-15')).toBe('2000-01-15');
  });

  it('should return the local calendar date, not the UTC date', () => {
    const date = new Date(2000, 0, 15); // 15 Jan 2000, local midnight
    expect(asDateString(date)).toBe('2000-01-15');
  });

  it('should correctly pad years with a leading 0', () => {
    expect(asDateString(new Date('280-12-12'))).toBe('0280-12-12');
  });
});

describe('asDateTimeString', () => {
  it('should return null for null input', () => {
    expect(asDateTimeString(null)).toBeNull();
  });

  it('should pass through a pre-serialized string unchanged', () => {
    const iso = '2000-01-15T12:00:00.000Z';
    expect(asDateTimeString(iso)).toBe(iso);
  });

  it('should return an ISO 8601 datetime string for a Date', () => {
    const date = new Date('2000-01-15T12:00:00.000Z');
    expect(asDateTimeString(date)).toBe('2000-01-15T12:00:00.000Z');
  });
});

describe('getServerTimeZone', () => {
  afterEach(() => {
    process.env.TZ = 'UTC';
  });

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
