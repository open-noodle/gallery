import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { readGreyscalePixels } from 'src/gallery/utils/image-quality.js';

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
