import { BadRequestException } from '@nestjs/common';
import {
  ALL_MONTH_DAYS,
  computeStreak,
  decodeCursor,
  encodeCursor,
  exposureStats,
  groupBursts,
  isCleanupCursorTimestamp,
  isScreenshotCandidate,
  isValidMonthDay,
  isValidTimeZone,
  laplacianVariance,
  suggestKeep,
} from 'src/utils/cleanup.js';

const checkerboard = (w: number, h: number) => {
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = (x + y) % 2 === 0 ? 0 : 255;
  return px;
};
const boxBlur = (src: Uint8Array, w: number, h: number) => {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) {
            sum += src[yy * w + xx];
            n++;
          }
        }
      out[y * w + x] = Math.round(sum / n);
    }
  return out;
};

describe('laplacianVariance', () => {
  it('scores a sharp pattern far above its blurred copy', () => {
    const sharp = checkerboard(64, 64);
    expect(laplacianVariance(sharp, 64, 64)).toBeGreaterThan(laplacianVariance(boxBlur(sharp, 64, 64), 64, 64) * 10);
  });
  it('returns 0 for a flat image', () => {
    expect(laplacianVariance(new Uint8Array(100).fill(128), 10, 10)).toBe(0);
  });
  it('returns 0 for images smaller than 3x3', () => {
    expect(laplacianVariance(new Uint8Array([1, 2, 3, 4]), 2, 2)).toBe(0);
  });
  it('keeps negative Laplacian responses (no 0-255 clamp)', () => {
    // a single bright pixel on black: centre response is -4*255, neighbours +255
    const px = new Uint8Array(9);
    px[4] = 255;
    expect(laplacianVariance(px, 3, 3)).toBe(0); // only one interior pixel -> variance of one sample is 0
    const big = new Uint8Array(25);
    big[12] = 255;
    expect(laplacianVariance(big, 5, 5)).toBeGreaterThan(0);
  });
});

describe('exposureStats', () => {
  it('computes mean brightness and clipping ratios', () => {
    const px = new Uint8Array([0, 0, 8, 128, 247, 255, 255, 100]);
    const s = exposureStats(px);
    expect(s.brightness).toBeCloseTo((0 + 0 + 8 + 128 + 247 + 255 + 255 + 100) / 8);
    expect(s.clippedDark).toBeCloseTo(3 / 8);
    expect(s.clippedBright).toBeCloseTo(3 / 8);
  });
  it('handles an empty buffer', () => {
    expect(exposureStats(new Uint8Array(0))).toEqual({ brightness: 0, clippedDark: 0, clippedBright: 0 });
  });
});

describe('isScreenshotCandidate', () => {
  it.each([
    'Screenshot 2024-01-01 at 10.00.00.png',
    'Screen Shot 2019-05-05 at 1.png',
    'Screen Recording 2023-02-02.mov',
    'Bildschirmfoto 2023-01-01 um 10.png',
    "Capture d'écran 2023-01-01.png",
    'Schermafbeelding 2023-01-01.png',
    'Captura de pantalla 2023-01-01.png',
    'Screenshot_20230101-101010.jpg',
    '截屏2023-01-01.png',
    'スクリーンショット 2023-01-01.png',
  ])('matches filename %s', (originalFileName) => {
    expect(isScreenshotCandidate({ originalFileName, make: 'Apple', model: 'iPhone' })).toBe(true);
  });
  it('rejects a camera JPEG', () => {
    expect(
      isScreenshotCandidate({
        originalFileName: 'IMG_1234.JPG',
        mimeType: 'image/jpeg',
        make: 'Apple',
        model: 'iPhone 15',
        width: 4032,
        height: 3024,
      }),
    ).toBe(false);
  });
  it('accepts a PNG without camera EXIF', () => {
    expect(isScreenshotCandidate({ originalFileName: 'x.png', mimeType: 'image/png', width: 800, height: 600 })).toBe(
      true,
    );
  });
  it('uses aspect ratio >= 2.0 only without camera EXIF', () => {
    expect(
      isScreenshotCandidate({ originalFileName: 'a.jpg', mimeType: 'image/jpeg', width: 1000, height: 2000 }),
    ).toBe(true);
    expect(
      isScreenshotCandidate({ originalFileName: 'a.jpg', mimeType: 'image/jpeg', width: 1000, height: 1999 }),
    ).toBe(false);
    expect(
      isScreenshotCandidate({
        originalFileName: 'a.jpg',
        mimeType: 'image/jpeg',
        make: 'Google',
        width: 1000,
        height: 2400,
      }),
    ).toBe(false);
  });
  it('flags a screen recording video by name only', () => {
    expect(isScreenshotCandidate({ originalFileName: 'VID_0001.mp4', mimeType: 'video/mp4' })).toBe(false);
    expect(isScreenshotCandidate({ originalFileName: 'Screen Recording 1.mp4', mimeType: 'video/mp4' })).toBe(true);
  });
});

describe('isValidMonthDay', () => {
  it.each([101, 131, 229, 430, 1231])('accepts %i', (v) => expect(isValidMonthDay(v)).toBe(true));
  it.each([0, 100, 132, 230, 431, 1232, 1301, -101, 1.5])('rejects %s', (v) => expect(isValidMonthDay(v)).toBe(false));
  it('lists 366 days in order', () => {
    expect(ALL_MONTH_DAYS).toHaveLength(366);
    expect(ALL_MONTH_DAYS[0]).toBe(101);
    expect(ALL_MONTH_DAYS).toContain(229);
    expect(ALL_MONTH_DAYS.at(-1)).toBe(1231);
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects garbage', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('computeStreak', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  it('is 0 without completions', () => expect(computeStreak([], 'UTC', now)).toBe(0));
  it('counts consecutive days ending today', () => {
    const d = ['2026-09-21T09:00:00Z', '2026-09-22T09:00:00Z', '2026-09-23T09:00:00Z'].map((s) => new Date(s));
    expect(computeStreak(d, 'UTC', now)).toBe(3);
  });
  it('allows the streak to end yesterday', () => {
    expect(computeStreak([new Date('2026-09-22T09:00:00Z')], 'UTC', now)).toBe(1);
  });
  it('breaks on a gap', () => {
    const d = ['2026-09-19T09:00:00Z', '2026-09-22T09:00:00Z', '2026-09-23T09:00:00Z'].map((s) => new Date(s));
    expect(computeStreak(d, 'UTC', now)).toBe(2);
  });
  it('counts several completions on one date once', () => {
    const d = ['2026-09-23T08:00:00Z', '2026-09-23T09:00:00Z'].map((s) => new Date(s));
    expect(computeStreak(d, 'UTC', now)).toBe(1);
  });
  it('uses the viewer timezone for the date boundary', () => {
    // 2026-09-22T22:30Z is 00:30 on 23 Sep in Berlin (CEST, UTC+2) but still 22 Sep in UTC.
    const d = [new Date('2026-09-22T22:30:00Z')];
    const later = new Date('2026-09-24T10:00:00Z'); // 24 Sep in both zones
    expect(computeStreak(d, 'Europe/Berlin', later)).toBe(1); // completed "yesterday" (the 23rd) in Berlin
    expect(computeStreak(d, 'UTC', later)).toBe(0); // completed on the 22nd, two days ago in UTC
    // Los Angeles: 22:30Z on the 22nd is 15:30 on the 22nd; now (10:00Z on the 23rd) is 03:00 on the 23rd -> yesterday
    expect(computeStreak(d, 'America/Los_Angeles', now)).toBe(1);
  });
  it('is 0 when the last completion is older than yesterday', () => {
    expect(computeStreak([new Date('2026-09-20T09:00:00Z')], 'UTC', now)).toBe(0);
  });
});

const row = (
  id: string,
  iso: string,
  autoStackId: string | null = null,
  sharpness: number | null = 10,
  fileSize = 100,
) => ({
  id,
  localDateTime: new Date(iso),
  cursorT: iso,
  autoStackId,
  sharpness,
  fileSize,
});

describe('groupBursts', () => {
  it('joins photos within 2.0s and splits beyond', () => {
    const groups = groupBursts([
      row('a', '2024-01-01T10:00:00.000Z'),
      row('b', '2024-01-01T10:00:02.000Z'),
      row('c', '2024-01-01T10:00:04.001Z'),
      row('d', '2024-01-01T10:00:05.000Z'),
    ]);
    expect(groups.map((g) => g.assets.map((a) => a.id))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(groups.every((g) => g.source === 'timeWindow')).toBe(true);
  });
  it('splits when autoStackId changes and marks burstId groups', () => {
    const groups = groupBursts([
      row('a', '2024-01-01T10:00:00Z', 'X'),
      row('b', '2024-01-01T10:00:01Z', 'X'),
      row('c', '2024-01-01T10:00:01.5Z', 'Y'),
      row('d', '2024-01-01T10:00:01.8Z', 'Y'),
    ]);
    expect(groups.map((g) => [g.source, g.assets.map((a) => a.id)])).toEqual([
      ['burstId', ['a', 'b']],
      ['burstId', ['c', 'd']],
    ]);
  });
  it('drops singletons', () => {
    expect(groupBursts([row('a', '2024-01-01T10:00:00Z'), row('b', '2024-01-01T11:00:00Z')])).toEqual([]);
  });
});

describe('suggestKeep', () => {
  it('prefers sharpness, then size, then earliest', () => {
    const base = { autoStackId: null, cursorT: '' };
    expect(
      suggestKeep([
        { ...base, id: 'a', localDateTime: new Date(1), sharpness: 5, fileSize: 999 },
        { ...base, id: 'b', localDateTime: new Date(2), sharpness: 50, fileSize: 1 },
      ]),
    ).toBe('b');
    expect(
      suggestKeep([
        { ...base, id: 'a', localDateTime: new Date(1), sharpness: null, fileSize: 1 },
        { ...base, id: 'b', localDateTime: new Date(2), sharpness: null, fileSize: 9 },
      ]),
    ).toBe('b');
    expect(
      suggestKeep([
        { ...base, id: 'a', localDateTime: new Date(1), sharpness: 5, fileSize: 1 },
        { ...base, id: 'b', localDateTime: new Date(2), sharpness: 5, fileSize: 1 },
      ]),
    ).toBe('a');
  });
});

describe('cursor codec', () => {
  it('round-trips', () => {
    const c = { v: ['2024-01-01T00:00:00.000Z', 'id-1'] };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('rejects garbage with BadRequest', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow(BadRequestException);
    expect(() => decodeCursor(Buffer.from('{"x":1}').toString('base64url'))).toThrow(BadRequestException);
  });
});

describe('isCleanupCursorTimestamp', () => {
  it('accepts ISO UTC timestamps with 0-6 fractional digits', () => {
    expect(isCleanupCursorTimestamp('2024-01-01T00:00:00Z')).toBe(true);
    expect(isCleanupCursorTimestamp('2024-01-01T00:00:00.123Z')).toBe(true);
    expect(isCleanupCursorTimestamp('2024-01-01T00:00:00.123456Z')).toBe(true);
  });

  it('rejects anything that is not a full-precision UTC timestamp', () => {
    expect(isCleanupCursorTimestamp('not-a-date')).toBe(false);
    expect(isCleanupCursorTimestamp('2024-01-01')).toBe(false);
    expect(isCleanupCursorTimestamp('2024-01-01T00:00:00.1234567Z')).toBe(false);
    expect(isCleanupCursorTimestamp('2024-01-01T00:00:00+02:00')).toBe(false);
    expect(isCleanupCursorTimestamp("2024-01-01T00:00:00Z'; drop table asset; --")).toBe(false);
    expect(isCleanupCursorTimestamp('2024-13-45T00:00:00Z')).toBe(false);
  });
});
