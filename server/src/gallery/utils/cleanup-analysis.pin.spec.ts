import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  CLEANUP_ANALYSIS_SIZE,
  CLEANUP_QUALITY_VERSION,
  CLEANUP_SCREENSHOT_VERSION,
  exposureStats,
  isScreenshotCandidate,
  laplacianVariance,
} from 'src/gallery/utils/cleanup.js';
import { readGreyscalePixels } from 'src/gallery/utils/image-quality.js';
import { mimeTypes } from 'src/utils/mime-types.js';

/**
 * Pins what the Library Cleanup quality analysis OUTPUTS, keyed by the version it is stamped with. Every
 * `asset_quality` row records the versions that computed it, and only a version bump re-runs the analysis
 * (`CleanupService.onBootstrap`): a change to the rule or the scores without a bump leaves every analysed asset
 * with the old result for good. This spec turns that into a failing test.
 *
 * When it fails because you changed the analysis on purpose: bump the version named in the message, then copy the
 * new results into the pinned expectation below together with the new version. Never update only the results.
 * Thresholds applied at query time (`CLEANUP_BLUR_THRESHOLDS`, `CLEANUP_DARK`, `CLEANUP_BRIGHT`) are not pinned:
 * they need no re-run. See "Changing the quality analysis" in specs/2026-09-23-library-cleanup-design.md.
 */

const SCREENSHOT_MESSAGE =
  'the screenshot rule changed: bump CLEANUP_SCREENSHOT_VERSION (src/gallery/utils/cleanup.ts) and update this expectation';
const QUALITY_MESSAGE =
  'the quality scores changed: bump CLEANUP_QUALITY_VERSION (src/gallery/utils/cleanup.ts) and update this expectation';

type ScreenshotInput = Omit<Parameters<typeof isScreenshotCandidate>[0], 'mimeType'>;

/** Representative assets. `mimeType` is derived from the file name exactly as `CleanupService` derives it. */
const SCREENSHOT_CASES: Record<string, ScreenshotInput> = {
  macosScreenshot: { originalFileName: 'Screenshot 2024-01-01 at 10.00.00.png', width: 2880, height: 1800 },
  oldMacosScreenShot: { originalFileName: 'Screen Shot 2019-05-05 at 1.png' },
  screenRecording: { originalFileName: 'Screen Recording 2024-02-02.mov', width: 1920, height: 1080 },
  germanScreenshot: { originalFileName: 'Bildschirmfoto 2024-03-03 um 12.00.00.png' },
  frenchScreenshot: { originalFileName: "Capture d'écran 2024-04-04.png" },
  frenchScreenshotTypographic: { originalFileName: 'Capture d’écran 2024-04-04.png' },
  dutchScreenshot: { originalFileName: 'Schermafbeelding 2024-05-05.png' },
  spanishScreenshot: { originalFileName: 'Captura de pantalla 2024-06-06.png' },
  chineseScreenshot: { originalFileName: '截屏2024-07-07.png' },
  japaneseScreenshot: { originalFileName: 'スクリーンショット 2024-08-08.png' },
  namedScreenshotFromCamera: { originalFileName: 'screenshot.jpg', make: 'Apple', model: 'iPhone 15' },
  cameraJpeg: { originalFileName: 'IMG_1234.JPG', make: 'Apple', model: 'iPhone 15', width: 4032, height: 3024 },
  cameraHeic: { originalFileName: 'IMG_5678.HEIC', make: 'Apple', model: 'iPhone 15', width: 4032, height: 3024 },
  cameraPanorama: { originalFileName: 'PANO_0001.jpg', make: 'Google', model: 'Pixel 8', width: 12_000, height: 3000 },
  pngWithoutCamera: { originalFileName: 'diagram.png', width: 800, height: 600 },
  pngFromCamera: { originalFileName: 'export.png', make: 'Canon', width: 800, height: 600 },
  uppercasePng: { originalFileName: 'IMAGE.PNG' },
  tallJpegWithoutCamera: { originalFileName: 'a.jpg', width: 1000, height: 2000 },
  almostTallJpegWithoutCamera: { originalFileName: 'a.jpg', width: 1000, height: 1999 },
  wideWebpWithoutCamera: { originalFileName: 'banner.webp', width: 3000, height: 1000 },
  squareJpegWithoutCamera: { originalFileName: 'a.jpg', width: 1000, height: 1000 },
  jpegWithoutDimensions: { originalFileName: 'a.jpg' },
  videoWithoutCamera: { originalFileName: 'clip.mp4', width: 1080, height: 2400 },
  videoFromCamera: { originalFileName: 'VID_0001.mp4', make: 'Apple', width: 1920, height: 1080 },
};

const SCREENSHOT_PIN = {
  version: 1,
  results: {
    macosScreenshot: true,
    oldMacosScreenShot: true,
    screenRecording: true,
    germanScreenshot: true,
    frenchScreenshot: true,
    frenchScreenshotTypographic: true,
    dutchScreenshot: true,
    spanishScreenshot: true,
    chineseScreenshot: true,
    japaneseScreenshot: true,
    namedScreenshotFromCamera: true,
    cameraJpeg: false,
    cameraHeic: false,
    cameraPanorama: false,
    pngWithoutCamera: true,
    pngFromCamera: false,
    uppercasePng: true,
    tallJpegWithoutCamera: true,
    almostTallJpegWithoutCamera: false,
    wideWebpWithoutCamera: true,
    squareJpegWithoutCamera: false,
    jpegWithoutDimensions: false,
    videoWithoutCamera: false,
    videoFromCamera: false,
  },
};

/** A deterministic pseudo-random byte stream (LCG), so the noise cases never change between runs. */
const noise = (n: number, seed: number) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
};

const W = 32;
const H = 24;
const buffer = (fn: (x: number, y: number, i: number) => number) => {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      out[y * W + x] = Math.max(0, Math.min(255, Math.round(fn(x, y, y * W + x))));
    }
  }
  return out;
};
const random = noise(W * H, 42);

/** Fixed greyscale buffers, scored with `laplacianVariance` and `exposureStats` as `handleQualityAnalysis` does. */
const PIXEL_CASES: Record<string, Uint8Array> = {
  flatGrey: buffer(() => 128),
  black: buffer(() => 0),
  white: buffer(() => 255),
  checkerboard: buffer((x, y) => ((x + y) % 2 === 0 ? 0 : 255)),
  horizontalGradient: buffer((x) => (x * 255) / (W - 1)),
  softEdge: buffer((x) => 128 + 100 * Math.tanh((x - W / 2) / 4)),
  hardEdge: buffer((x) => (x < W / 2 ? 30 : 220)),
  noise: buffer((_x, _y, i) => random[i]),
  darkNoise: buffer((_x, _y, i) => random[i] / 16),
  brightNoise: buffer((_x, _y, i) => 240 + random[i] / 16),
  darkClippedNoise: buffer((_x, _y, i) => random[i] / 32),
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const score = (pixels: Uint8Array, width: number, height: number) => {
  const { brightness, clippedDark, clippedBright } = exposureStats(pixels);
  return {
    sharpness: round(laplacianVariance(pixels, width, height)),
    brightness: round(brightness),
    clippedDark: round(clippedDark),
    clippedBright: round(clippedBright),
  };
};

const QUALITY_PIN = {
  version: 1,
  results: {
    flatGrey: { sharpness: 0, brightness: 128, clippedDark: 0, clippedBright: 0 },
    black: { sharpness: 0, brightness: 0, clippedDark: 1, clippedBright: 0 },
    white: { sharpness: 0, brightness: 255, clippedDark: 0, clippedBright: 1 },
    checkerboard: { sharpness: 1_040_400, brightness: 127.5, clippedDark: 0.5, clippedBright: 0.5 },
    horizontalGradient: { sharpness: 0.4667, brightness: 127.5, clippedDark: 0.0625, clippedBright: 0.0625 },
    softEdge: { sharpness: 5.8667, brightness: 124.875, clippedDark: 0, clippedBright: 0 },
    hardEdge: { sharpness: 2406.6667, brightness: 125, clippedDark: 0, clippedBright: 0 },
    noise: { sharpness: 106_891.3314, brightness: 131.5026, clippedDark: 0.0182, clippedBright: 0.0456 },
    darkNoise: { sharpness: 422.3999, brightness: 8.2448, clippedDark: 0.5065, clippedBright: 0 },
    brightNoise: { sharpness: 411.5315, brightness: 248.2005, clippedDark: 0, clippedBright: 0.6055 },
    darkClippedNoise: { sharpness: 109.6788, brightness: 4.1276, clippedDark: 1, clippedBright: 0 },
    decodedPreview: {
      sharpness: 115.6387,
      brightness: 138.4354,
      clippedDark: 0,
      clippedBright: 0,
      width: 512,
      height: 384,
    },
  },
};

describe('Library Cleanup analysis pin', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cleanup-analysis-pin-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('screenshot rule output matches CLEANUP_SCREENSHOT_VERSION', () => {
    const results = Object.fromEntries(
      Object.entries(SCREENSHOT_CASES).map(([name, input]) => [
        name,
        isScreenshotCandidate({ ...input, mimeType: mimeTypes.lookup(input.originalFileName) }),
      ]),
    );
    expect({ version: CLEANUP_SCREENSHOT_VERSION, results }, SCREENSHOT_MESSAGE).toEqual(SCREENSHOT_PIN);
  });

  it('quality scores match CLEANUP_QUALITY_VERSION', async () => {
    const results: Record<string, object> = Object.fromEntries(
      Object.entries(PIXEL_CASES).map(([name, pixels]) => [name, score(pixels, W, H)]),
    );

    // The decode step too: a 1600x1200 photo-like image read at CLEANUP_ANALYSIS_SIZE, as the job reads a preview.
    const path = join(dir, 'preview.png');
    const big = { width: 1600, height: 1200 };
    const raw = Buffer.alloc(big.width * big.height * 3);
    for (let y = 0; y < big.height; y++) {
      for (let x = 0; x < big.width; x++) {
        const i = (y * big.width + x) * 3;
        const tile = (Math.floor(x / 100) + Math.floor(y / 100)) % 2;
        raw[i] = tile ? 200 : 40;
        raw[i + 1] = (x * 255) / big.width;
        raw[i + 2] = (y * 255) / big.height;
      }
    }
    await sharp(raw, { raw: { ...big, channels: 3 } })
      .png()
      .toFile(path);
    const { data, width, height } = await readGreyscalePixels(path, CLEANUP_ANALYSIS_SIZE);
    results.decodedPreview = { ...score(data, width, height), width, height };

    expect({ version: CLEANUP_QUALITY_VERSION, results }, QUALITY_MESSAGE).toEqual(QUALITY_PIN);
  });
});
