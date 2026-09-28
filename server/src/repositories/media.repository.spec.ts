import { mkdtempDisposableSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AssetEditAction, MirrorAxis } from 'src/dtos/editing.dto.js';
import { Colorspace, ImageFormat } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MediaRepository } from 'src/repositories/media.repository.js';
import { automock } from 'test/utils.js';

const buildSolidImage = (background: { r: number; g: number; b: number }) =>
  sharp({
    create: { width: 10, height: 10, channels: 4, background: { ...background, alpha: 1 } },
  }).png();

const getPixelColor = async (buffer: Buffer, x: number, y: number) => {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width!;
  const { data } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const idx = (y * width + x) * 4;
  return {
    r: data[idx],
    g: data[idx + 1],
    b: data[idx + 2],
  };
};

const buildTestQuadImage = async () => {
  // build a 4 quadrant image for testing mirroring
  const base = sharp({
    create: { width: 1000, height: 1000, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).png();

  const tl = await sharp({
    create: { width: 500, height: 500, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();

  const tr = await sharp({
    create: { width: 500, height: 500, channels: 3, background: { r: 0, g: 255, b: 0 } },
  })
    .png()
    .toBuffer();

  const bl = await sharp({
    create: { width: 500, height: 500, channels: 3, background: { r: 0, g: 0, b: 255 } },
  })
    .png()
    .toBuffer();

  const br = await sharp({
    create: { width: 500, height: 500, channels: 3, background: { r: 255, g: 255, b: 0 } },
  })
    .png()
    .toBuffer();

  const image = base.composite([
    { input: tl, left: 0, top: 0 }, // top-left
    { input: tr, left: 500, top: 0 }, // top-right
    { input: bl, left: 0, top: 500 }, // bottom-left
    { input: br, left: 500, top: 500 }, // bottom-right
  ]);

  return image.png().toBuffer();
};

describe(MediaRepository.name, () => {
  let sut: MediaRepository;

  beforeEach(() => {
    // eslint-disable-next-line no-sparse-arrays
    sut = new MediaRepository(automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false }));
  });

  describe('applyEdits (single actions)', () => {
    it('should apply crop edit correctly', async () => {
      const result = sut['applyEdits'](
        sharp({
          create: {
            width: 1000,
            height: 1000,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 0.5 },
          },
        }).png(),
        [
          {
            action: AssetEditAction.Crop,
            parameters: {
              x: 100,
              y: 200,
              width: 700,
              height: 300,
            },
          },
        ],
      );

      const metadata = await result.toBuffer().then((buf) => sharp(buf).metadata());
      expect(metadata.width).toBe(700);
      expect(metadata.height).toBe(300);
    });
    it('should apply rotate edit correctly', async () => {
      const result = sut['applyEdits'](
        sharp({
          create: {
            width: 500,
            height: 1000,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 0.5 },
          },
        }).png(),
        [
          {
            action: AssetEditAction.Rotate,
            parameters: {
              angle: 90,
            },
          },
        ],
      );

      const metadata = await result.toBuffer().then((buf) => sharp(buf).metadata());
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(500);
    });

    it('should apply mirror edit correctly', async () => {
      const resultHorizontal = sut['applyEdits'](sharp(await buildTestQuadImage()), [
        {
          action: AssetEditAction.Mirror,
          parameters: {
            axis: MirrorAxis.Horizontal,
          },
        },
      ]);

      const bufferHorizontal = await resultHorizontal.toBuffer();
      const metadataHorizontal = await resultHorizontal.metadata();
      expect(metadataHorizontal.width).toBe(1000);
      expect(metadataHorizontal.height).toBe(1000);

      expect(await getPixelColor(bufferHorizontal, 10, 10)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(bufferHorizontal, 990, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(bufferHorizontal, 10, 990)).toEqual({ r: 255, g: 255, b: 0 });
      expect(await getPixelColor(bufferHorizontal, 990, 990)).toEqual({ r: 0, g: 0, b: 255 });

      const resultVertical = sut['applyEdits'](sharp(await buildTestQuadImage()), [
        {
          action: AssetEditAction.Mirror,
          parameters: {
            axis: MirrorAxis.Vertical,
          },
        },
      ]);

      const bufferVertical = await resultVertical.toBuffer();
      const metadataVertical = await resultVertical.metadata();
      expect(metadataVertical.width).toBe(1000);
      expect(metadataVertical.height).toBe(1000);

      // top-left should now be bottom-left (blue)
      expect(await getPixelColor(bufferVertical, 10, 10)).toEqual({ r: 0, g: 0, b: 255 });
      // top-right should now be bottom-right (yellow)
      expect(await getPixelColor(bufferVertical, 990, 10)).toEqual({ r: 255, g: 255, b: 0 });
      // bottom-left should now be top-left (red)
      expect(await getPixelColor(bufferVertical, 10, 990)).toEqual({ r: 255, g: 0, b: 0 });
      // bottom-right should now be top-right (blue)
      expect(await getPixelColor(bufferVertical, 990, 990)).toEqual({ r: 0, g: 255, b: 0 });
    });
  });

  describe('applyEdits (adjust)', () => {
    it('should apply exposure as a linear multiply with no offset', async () => {
      const result = sut['applyEdits'](
        sharp({
          create: { width: 10, height: 10, channels: 4, background: { r: 50, g: 100, b: 150, alpha: 1 } },
        }).png(),
        [{ action: AssetEditAction.Adjust, parameters: { exposure: 50 } }],
      );

      // factor = 1 + 50/100 = 1.5
      expect(await getPixelColor(await result.toBuffer(), 5, 5)).toEqual({ r: 75, g: 150, b: 225 });
    });

    it('should clip exposure at 255', async () => {
      const result = sut['applyEdits'](
        sharp({
          create: { width: 10, height: 10, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } },
        }).png(),
        [{ action: AssetEditAction.Adjust, parameters: { exposure: 100 } }],
      );

      expect(await getPixelColor(await result.toBuffer(), 5, 5)).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('should pivot contrast around the sRGB midpoint (127.5) by default', async () => {
      const result = sut['applyEdits'](
        sharp({
          create: { width: 10, height: 10, channels: 4, background: { r: 200, g: 200, b: 200, alpha: 1 } },
        }).png(),
        [{ action: AssetEditAction.Adjust, parameters: { contrast: 50 } }],
      );

      // amount = 1.5, offset = 127.5 * (1 - 1.5) = -63.75 -> 200 * 1.5 - 63.75 = 236.25
      expect(await getPixelColor(await result.toBuffer(), 5, 5)).toEqual({ r: 236, g: 236, b: 236 });
    });

    it('should use a different, non-hardcoded midpoint for a non-sRGB colorspace pipeline', async () => {
      const background = { r: 200, g: 200, b: 200 };

      const srgbResult = sut['applyEdits'](
        buildSolidImage(background),
        [{ action: AssetEditAction.Adjust, parameters: { contrast: 50 } }],
        Colorspace.Srgb,
      );
      const p3Result = sut['applyEdits'](
        buildSolidImage(background),
        [{ action: AssetEditAction.Adjust, parameters: { contrast: 50 } }],
        Colorspace.P3,
      );

      const srgbPixel = await getPixelColor(await srgbResult.toBuffer(), 5, 5);
      const p3Pixel = await getPixelColor(await p3Result.toBuffer(), 5, 5);

      // Same input and contrast amount, but the midpoint (65535/2 vs 255/2) must be colorspace-aware —
      // this guards against re-hardcoding 128, which would be a real bug on a 16-bit P3 pipeline.
      expect(p3Pixel).not.toEqual(srgbPixel);
    });

    it('should fully desaturate to grayscale using CSS luminosity weights at saturation -100', async () => {
      const result = sut['applyEdits'](
        sharp({
          create: { width: 10, height: 10, channels: 4, background: { r: 200, g: 80, b: 40, alpha: 1 } },
        }).png(),
        [{ action: AssetEditAction.Adjust, parameters: { saturation: -100 } }],
      );

      const pixel = await getPixelColor(await result.toBuffer(), 5, 5);
      expect(pixel.r).toBe(pixel.g);
      expect(pixel.g).toBe(pixel.b);
    });

    it('should increase color channel separation at positive saturation', async () => {
      const background = { r: 200, g: 80, b: 40, alpha: 1 };
      const neutral = sut['applyEdits'](
        sharp({ create: { width: 10, height: 10, channels: 4, background } }).png(),
        [],
      );
      const saturated = sut['applyEdits'](sharp({ create: { width: 10, height: 10, channels: 4, background } }).png(), [
        { action: AssetEditAction.Adjust, parameters: { saturation: 100 } },
      ]);

      const neutralPixel = await getPixelColor(await neutral.toBuffer(), 5, 5);
      const saturatedPixel = await getPixelColor(await saturated.toBuffer(), 5, 5);

      // Boosting saturation should widen the spread between the dominant (r) and weakest (b) channel
      expect(saturatedPixel.r - saturatedPixel.b).toBeGreaterThan(neutralPixel.r - neutralPixel.b);
    });

    it('should invert colors like CSS invert(1)', async () => {
      const result = sut['applyEdits'](
        sharp({
          create: { width: 10, height: 10, channels: 4, background: { r: 100, g: 50, b: 200, alpha: 1 } },
        }).png(),
        [{ action: AssetEditAction.Adjust, parameters: { invert: true } }],
      );

      expect(await getPixelColor(await result.toBuffer(), 5, 5)).toEqual({ r: 155, g: 205, b: 55 });
    });

    it('should combine exposure and contrast rather than letting one silently overwrite the other', async () => {
      // sharp's `.linear(a, b)` is a single option slot, not a queue of operations - calling it
      // twice (once for exposure, once for contrast) makes the second call silently discard the
      // first entirely, rather than composing with it.
      const result = sut['applyEdits'](
        sharp({
          create: { width: 10, height: 10, channels: 4, background: { r: 100, g: 100, b: 100, alpha: 1 } },
        }).png(),
        [{ action: AssetEditAction.Adjust, parameters: { exposure: 50, contrast: 50 } }],
      );

      // a = 1.5 * 1.5 = 2.25, b = 127.5 * (1 - 1.5) = -63.75 -> 100 * 2.25 - 63.75 = 161.25
      // Neither value alone would be 161 (exposure alone gives 150, contrast alone gives 86) -
      // this is only reachable if both actually took effect together.
      expect(await getPixelColor(await result.toBuffer(), 5, 5)).toEqual({ r: 161, g: 161, b: 161 });
    });

    it('should apply invert before exposure, so a negative exposure darkens an inverted image', async () => {
      // Editing a scanned film negative: Invert undoes the negative first, and a *negative*
      // exposure value must then darken the now-normal-looking image, not brighten it. sharp
      // always negates last regardless of call order (`linear`/`negate` are single option slots,
      // not a queue), so exposure's (a, b) is algebraically pre-adjusted here to simulate invert
      // running first.
      const background = { r: 50, g: 50, b: 50 };

      const invertedOnly = sut['applyEdits'](buildSolidImage(background), [
        { action: AssetEditAction.Adjust, parameters: { invert: true } },
      ]);
      const invertedThenDarkened = sut['applyEdits'](buildSolidImage(background), [
        { action: AssetEditAction.Adjust, parameters: { exposure: -40, invert: true } },
      ]);

      const invertedPixel = await getPixelColor(await invertedOnly.toBuffer(), 5, 5);
      const darkerPixel = await getPixelColor(await invertedThenDarkened.toBuffer(), 5, 5);

      expect(darkerPixel.r).toBeLessThan(invertedPixel.r);
      expect(darkerPixel).toEqual({ r: 123, g: 123, b: 123 });
    });

    it('should still fully desaturate when combined with invert', async () => {
      // Regression test for a real sharp/libvips bug (reproduced even with a plain identity
      // recomb matrix): calling `.recomb()` then `.negate()` produces all-zero output. Invert
      // must be folded into the same linear(a, b) call as exposure/contrast instead of using
      // `.negate()`, or saturation -100 + invert (with no exposure/contrast set, so linear()
      // would otherwise only run for invert's sake) silently loses all color-correction effect.
      const result = sut['applyEdits'](
        sharp({
          create: { width: 10, height: 10, channels: 4, background: { r: 200, g: 80, b: 40, alpha: 1 } },
        }).png(),
        [{ action: AssetEditAction.Adjust, parameters: { saturation: -100, invert: true } }],
      );

      const pixel = await getPixelColor(await result.toBuffer(), 5, 5);
      expect(pixel.r).toBe(pixel.g);
      expect(pixel.g).toBe(pixel.b);
      expect(pixel.r).toBeGreaterThan(0);
    });

    it('should be a no-op when the adjust edit has no parameters set', async () => {
      const result = sut['applyEdits'](
        sharp({
          create: { width: 10, height: 10, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 1 } },
        }).png(),
        [{ action: AssetEditAction.Adjust, parameters: {} }],
      );

      expect(await getPixelColor(await result.toBuffer(), 5, 5)).toEqual({ r: 100, g: 150, b: 200 });
    });

    it('should exclude adjust from the affine (geometric) transform path', async () => {
      // Adjust must never be treated as a spatial edit - a regression here would try to build
      // an affine matrix from color parameters and throw, or silently distort the image.
      const result = sut['applyEdits'](
        sharp({
          create: { width: 20, height: 10, channels: 4, background: { r: 100, g: 100, b: 100, alpha: 1 } },
        }).png(),
        [{ action: AssetEditAction.Adjust, parameters: { invert: true } }],
      );

      const metadata = await result.toBuffer().then((buf) => sharp(buf).metadata());
      expect(metadata.width).toBe(20);
      expect(metadata.height).toBe(10);
    });
  });

  describe('applyEdits (multiple sequential edits)', () => {
    it('should apply horizontal mirror then vertical mirror (equivalent to 180° rotation)', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Vertical } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 0, g: 0, b: 255 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 990)).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should apply rotate 90° then horizontal mirror', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 0, g: 0, b: 255 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 990)).toEqual({ r: 255, g: 255, b: 0 });
    });

    it('should apply 180° rotation', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Rotate, parameters: { angle: 180 } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 0, g: 0, b: 255 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 990)).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should apply 270° rotations', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Rotate, parameters: { angle: 270 } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 255, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 990, 990)).toEqual({ r: 0, g: 0, b: 255 });
    });

    it('should apply crop then rotate 90°', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 1000, height: 500 } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(500);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 0, g: 255, b: 0 });
    });

    it('should apply rotate 90° then crop', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 500, height: 1000 } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(500);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 0, g: 0, b: 255 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should apply vertical mirror then horizontal mirror then rotate 90°', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Vertical } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(1000);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 0, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 255, g: 255, b: 0 });
      expect(await getPixelColor(buffer, 10, 990)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 990, 990)).toEqual({ r: 0, g: 0, b: 255 });
    });

    it('should apply crop to single quadrant then mirror', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 500, height: 500 } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(500);
      expect(metadata.height).toBe(500);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 490, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 10, 490)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 490, 490)).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should apply all operations: crop, rotate, mirror', async () => {
      const imageBuffer = await buildTestQuadImage();
      const result = sut['applyEdits'](sharp(imageBuffer), [
        { action: AssetEditAction.Crop, parameters: { x: 0, y: 0, width: 500, height: 1000 } },
        { action: AssetEditAction.Rotate, parameters: { angle: 90 } },
        { action: AssetEditAction.Mirror, parameters: { axis: MirrorAxis.Horizontal } },
      ]);

      const buffer = await result.png().toBuffer();
      const metadata = await sharp(buffer).metadata();
      expect(metadata.width).toBe(1000);
      expect(metadata.height).toBe(500);

      expect(await getPixelColor(buffer, 10, 10)).toEqual({ r: 255, g: 0, b: 0 });
      expect(await getPixelColor(buffer, 990, 10)).toEqual({ r: 0, g: 0, b: 255 });
    });
  });

  describe('generateThumbnail', () => {
    it('should process random Authentik thumbnail image', async () => {
      const response = await fetch(
        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NHB4IiBoZWlnaHQ9IjY0cHgiIHZpZXdCb3g9IjAgMCA2NCA2NCIgdmVyc2lvbj0iMS4xIj48cmVjdCBmaWxsPSIjMzc3YjM3IiBjeD0iMzIiIGN5PSIzMiIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByPSIzMiIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBzdHlsZT0iY29sb3I6ICNmZmY7IGxpbmUtaGVpZ2h0OiAxOyBmb250LWZhbWlseTogJ1JlZEhhdFRleHQnLCdPdmVycGFzcycsb3ZlcnBhc3MsaGVsdmV0aWNhLGFyaWFsLHNhbnMtc2VyaWY7ICIgZmlsbD0iI2ZmZiIgYWxpZ25tZW50LWJhc2VsaW5lPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtc2l6ZT0iMjgiIGZvbnQtd2VpZ2h0PSI0MDAiIGR5PSIuMWVtIj5BQTwvdGV4dD48L3N2Zz4=',
      );
      const buffer = Buffer.from(await response.arrayBuffer());
      const dir = mkdtempDisposableSync(join(tmpdir(), 'media-repository-'));
      const file = join(dir.path, 'test.webp');
      await sut.generateThumbnail(
        buffer,
        { colorspace: Colorspace.P3, quality: 80, format: ImageFormat.Webp, processInvalidImages: false },
        file,
      );

      expect(statSync(file).blksize).toBeGreaterThan(0);
    });
  });
});
