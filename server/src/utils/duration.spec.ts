import { formatSecondsToDuration, parseDurationToSeconds } from 'src/utils/duration';
import { describe, expect, it } from 'vitest';

describe('parseDurationToSeconds', () => {
  it('should parse HH:MM:SS.ffffff format', () => {
    expect(parseDurationToSeconds('0:05:23.456789')).toBeCloseTo(323.456_789);
  });

  it('should parse H:MM:SS format without fractional seconds', () => {
    expect(parseDurationToSeconds('1:23:45')).toBe(5025);
  });

  it('should parse 0:00:00.000000', () => {
    expect(parseDurationToSeconds('0:00:00.000000')).toBe(0);
  });

  it('should return null for null input', () => {
    expect(parseDurationToSeconds(null)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseDurationToSeconds('')).toBeNull();
  });
});

describe('formatSecondsToDuration', () => {
  it('should format seconds to HH:MM:SS.ffffff', () => {
    expect(formatSecondsToDuration(323.456_789)).toBe('0:05:23.456789');
  });

  it('should format zero', () => {
    expect(formatSecondsToDuration(0)).toBe('0:00:00.000000');
  });

  it('should format hours', () => {
    expect(formatSecondsToDuration(5025)).toBe('1:23:45.000000');
  });
});
