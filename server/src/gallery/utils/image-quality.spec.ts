import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { exposureStats, laplacianVariance } from 'src/gallery/utils/cleanup.js';
import { readFaceGreyscalePixels, readGreyscalePixels } from 'src/gallery/utils/image-quality.js';
import { PERSON_COVER_CROP_SIZE, PERSON_COVER_EXPOSURE } from 'src/gallery/utils/person-cover.js';

describe('readGreyscalePixels', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'image-quality-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns one grey byte per pixel, shrunk so the long edge fits the size', async () => {
    const path = join(dir, 'wide.png');
    await sharp({ create: { width: 400, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .png()
      .toFile(path);

    const { data, width, height } = await readGreyscalePixels(path, 100);

    expect([width, height]).toEqual([100, 50]);
    expect(data).toHaveLength(100 * 50);
    expect(data[0]).toBe(255);
  });

  it('never enlarges a small image', async () => {
    const path = join(dir, 'small.png');
    await sharp({ create: { width: 20, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .png()
      .toFile(path);

    const { width, height } = await readGreyscalePixels(path, 512);

    expect([width, height]).toEqual([20, 10]);
  });
});

// A 64 x 64 "face" of fine black and white stripes, pasted at (100, 80) on a mid-grey 400 x 300 photo.
const stripes = () => {
  const pixels = Buffer.alloc(64 * 64 * 3);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      pixels.fill(((x >> 1) + (y >> 1)) % 2 === 0 ? 230 : 40, (y * 64 + x) * 3, (y * 64 + x + 1) * 3);
    }
  }
  return sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } });
};

const isWellExposed = ({ brightness, clippedDark }: { brightness: number; clippedDark: number }) =>
  brightness >= PERSON_COVER_EXPOSURE.minBrightness &&
  brightness <= PERSON_COVER_EXPOSURE.maxBrightness &&
  clippedDark < PERSON_COVER_EXPOSURE.maxClippedDark;

describe('readFaceGreyscalePixels', () => {
  let dir: string;
  const size = PERSON_COVER_CROP_SIZE;
  const face = { x1: 100, y1: 80, x2: 164, y2: 144 };
  const photo = async (name: string, faceImage: Sharp) => {
    const path = join(dir, name);
    await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 128, g: 128, b: 128 } } })
      .composite([{ input: await faceImage.png().toBuffer(), left: face.x1, top: face.y1 }])
      .jpeg({ quality: 95 })
      .toFile(path);
    return path;
  };
  const photoSize = { width: 400, height: 300 };
  const score = async (path: string, source = photoSize, box = face) => {
    const data = await readFaceGreyscalePixels(path, box, source, size);
    return { length: data.length, sharpness: laplacianVariance(data, size, size), ...exposureStats(data) };
  };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'face-quality-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns a size x size grey square of the face box', async () => {
    const original = await score(await photo('original.jpg', stripes()));

    expect(original.length).toBe(size * size);
    expect(isWellExposed(original)).toBe(true);
  });

  it('ranks a blurred copy of the face below the original', async () => {
    const original = await score(await photo('sharp.jpg', stripes()));
    const blurred = await score(await photo('blurred.jpg', stripes().blur(3)));

    expect(blurred.sharpness).toBeLessThan(original.sharpness / 4);
  });

  it('leaves a darkened copy of the face outside the exposure filter', async () => {
    const dark = await score(await photo('dark.jpg', stripes().linear(0.15, 0)));

    expect(isWellExposed(dark)).toBe(false);
  });

  it('scales a box stored for another image size to the decoded one', async () => {
    const path = await photo('scaled.jpg', stripes());
    // The same face, stored by a detector that saw the photo at twice the size.
    const doubled = { x1: face.x1 * 2, y1: face.y1 * 2, x2: face.x2 * 2, y2: face.y2 * 2 };

    const direct = await score(path);
    const scaled = await score(path, { width: 800, height: 600 }, doubled);

    expect(scaled.sharpness).toBeCloseTo(direct.sharpness, 5);
  });

  it('clamps a box that runs off the image', async () => {
    const path = await photo('edge.jpg', stripes());

    const { length } = await score(path, photoSize, { x1: 350, y1: 250, x2: 500, y2: 400 });

    expect(length).toBe(size * size);
  });
});
