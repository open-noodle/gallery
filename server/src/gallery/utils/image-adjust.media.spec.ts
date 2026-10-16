import sharp from 'sharp';
import { AssetEditAction } from 'src/dtos/editing.dto.js';
import { Colorspace } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { automock } from 'test/utils.js';

// The colour adjustment through MediaRepository's real sharp pipeline: it runs on the output of the scRGB edit pass.
const solidBitmap = (background: { r: number; g: number; b: number }, alpha = 1, width = 10, height = 10) =>
  sharp({ create: { width, height, channels: 4, background: { ...background, alpha } } })
    .raw()
    .toBuffer({ resolveWithObject: true });
const bitmapPixel = (
  { data, info }: { data: Buffer; info: { width: number; channels: number } },
  x: number,
  y: number,
) => {
  const idx = (y * info.width + x) * info.channels;
  return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
};

describe('MediaRepository (image adjust)', () => {
  let sut: MediaRepository;

  beforeEach(() => {
    // eslint-disable-next-line no-sparse-arrays
    sut = new MediaRepository(automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false }));
  });

  describe('transform (adjust)', () => {
    const neutral = { exposure: 0, contrast: 0, saturation: 0, invert: false };

    it('should apply the adjustment with no size and no edits', async () => {
      const result = await sut['transform'](await solidBitmap({ r: 100, g: 50, b: 200 }), {
        adjust: { ...neutral, invert: true },
      });

      expect(bitmapPixel(result, 5, 5)).toEqual([155, 205, 55, 255]);
    });

    it('should adjust the 8-bit output of a wide-gamut (rgb16 pipeline) decode', async () => {
      const png = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 200, g: 200, b: 200 } },
      })
        .png()
        .toBuffer();
      const decoded = await sut.decodeImage(png, { colorspace: Colorspace.P3, processInvalidImages: false });

      const result = await sut['transform'](decoded, { adjust: { ...neutral, contrast: 50 } });

      expect(bitmapPixel(result, 5, 5).slice(0, 3)).toEqual([236, 236, 236]);
    });

    it('should keep semi-transparent pixels as straight alpha', async () => {
      // The scRGB pass flags its output premultiplied while returning straight-alpha bytes.
      const result = await sut['transform'](await solidBitmap({ r: 100, g: 50, b: 200 }, 0.5), {
        size: 5,
        adjust: { ...neutral, invert: true },
      });

      expect(bitmapPixel(result, 2, 2)).toEqual([155, 205, 55, 128]);
    });

    it('should adjust after cropping, and not count as a spatial edit', async () => {
      const result = await sut['transform'](await solidBitmap({ r: 100, g: 100, b: 100 }, 1, 20, 10), {
        edits: [{ action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 8, height: 6 } }],
        adjust: { ...neutral, exposure: 50 },
      });

      expect(result.info.width).toBe(8);
      expect(result.info.height).toBe(6);
      expect(bitmapPixel(result, 4, 3).slice(0, 3)).toEqual([150, 150, 150]);
    });

    it('should apply the adjustment to the thumbhash', async () => {
      const image = await solidBitmap({ r: 30, g: 30, b: 30 }, 1, 50, 50);
      const plain = await sut.generateThumbhash(image, { colorspace: Colorspace.Srgb, processInvalidImages: false });
      const inverted = await sut.generateThumbhash(image, {
        colorspace: Colorspace.Srgb,
        processInvalidImages: false,
        adjust: { ...neutral, invert: true },
      });

      expect(Buffer.compare(plain, inverted)).not.toBe(0);
    });
  });
});
