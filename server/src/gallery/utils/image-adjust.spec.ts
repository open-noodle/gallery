import type { Bitmap } from 'src/types.js';
import { type ImageAdjust, NEUTRAL_IMAGE_ADJUST } from 'src/gallery/dtos/image-adjust.dto.js';
import { applyImageAdjust } from 'src/gallery/utils/image-adjust.js';

const adjust = (values: Partial<ImageAdjust>): ImageAdjust => ({ ...NEUTRAL_IMAGE_ADJUST, ...values });

const bitmap = (pixel: number[], channels = pixel.length): Bitmap => ({
  data: Buffer.from(pixel),
  info: { width: 1, height: 1, channels: channels as 1 | 2 | 3 | 4 },
});

const pixelOf = (image: Bitmap) => [...image.data];

describe(applyImageAdjust.name, () => {
  it('should return the bitmap untouched when the adjustment is neutral', () => {
    const image = bitmap([10, 20, 30]);
    expect(applyImageAdjust(image, NEUTRAL_IMAGE_ADJUST)).toBe(image);
  });

  it('should apply exposure as CSS brightness()', () => {
    expect(pixelOf(applyImageAdjust(bitmap([50, 100, 150]), adjust({ exposure: 50 })))).toEqual([75, 150, 225]);
  });

  it('should pivot contrast around mid-grey like CSS contrast()', () => {
    // (200/255 - 0.5) * 1.5 + 0.5 = 0.9265 -> 236
    expect(pixelOf(applyImageAdjust(bitmap([200, 200, 200]), adjust({ contrast: 50 })))).toEqual([236, 236, 236]);
  });

  it('should clamp after exposure before contrast runs, as a browser does', () => {
    // Measured in Chromium: brightness(2) contrast(0.5) turns red 199 into 191. Folding both into one linear map gives
    // 199 * 1 + 63.75 = 255 instead, which is what made the saved thumbnail disagree with the preview.
    expect(pixelOf(applyImageAdjust(bitmap([199, 80, 40]), adjust({ exposure: 100, contrast: -50 })))).toEqual([
      191, 144, 104,
    ]);
  });

  it('should match the browser preview for a combined edit', () => {
    // Chromium rendered saturate(0.5) invert(1) brightness(1.2) contrast(1.3) of these pixels as 124,217,248 and 160.
    expect(
      pixelOf(
        applyImageAdjust(bitmap([199, 80, 40]), adjust({ saturation: -50, invert: true, exposure: 20, contrast: 30 })),
      ),
    ).toEqual([124, 217, 248]);
    expect(
      pixelOf(
        applyImageAdjust(
          bitmap([128, 128, 128]),
          adjust({ saturation: -50, invert: true, exposure: 20, contrast: 30 }),
        ),
      ),
    ).toEqual([160, 160, 160]);
  });

  it('should invert before exposure, so a negative exposure darkens a film negative', () => {
    const inverted = pixelOf(applyImageAdjust(bitmap([50, 50, 50]), adjust({ invert: true })));
    const darkened = pixelOf(applyImageAdjust(bitmap([50, 50, 50]), adjust({ invert: true, exposure: -40 })));

    expect(inverted).toEqual([205, 205, 205]);
    expect(darkened).toEqual([123, 123, 123]);
  });

  it('should desaturate to grey with the CSS luminance weights at saturation -100', () => {
    // 0.213 * 200 + 0.715 * 80 + 0.072 * 40 = 102.68
    expect(pixelOf(applyImageAdjust(bitmap([200, 80, 40]), adjust({ saturation: -100 })))).toEqual([103, 103, 103]);
  });

  it('should still desaturate when combined with invert', () => {
    expect(pixelOf(applyImageAdjust(bitmap([200, 80, 40]), adjust({ saturation: -100, invert: true })))).toEqual([
      152, 152, 152,
    ]);
  });

  it('should widen the channel spread at positive saturation, clamping each channel', () => {
    const [r, g, b] = pixelOf(applyImageAdjust(bitmap([200, 80, 40]), adjust({ saturation: 100 })));
    expect(r - b).toBeGreaterThan(160);
    expect(g).toBeLessThan(80);
    expect(b).toBe(0);
  });

  it('should leave alpha untouched, as straight alpha', () => {
    expect(pixelOf(applyImageAdjust(bitmap([100, 50, 200, 128]), adjust({ invert: true })))).toEqual([
      155, 205, 55, 128,
    ]);
    expect(pixelOf(applyImageAdjust(bitmap([100, 50, 200, 128]), adjust({ saturation: -100 })))).toEqual([
      71, 71, 71, 128,
    ]);
  });

  it('should adjust only the grey channel of a grey + alpha bitmap', () => {
    expect(pixelOf(applyImageAdjust(bitmap([100, 128], 2), adjust({ invert: true, saturation: 50 })))).toEqual([
      155, 128,
    ]);
  });

  it('should use the 16-bit range for a 16-bit bitmap', () => {
    const samples = new Uint16Array([40_000, 10_000, 65_535]);
    const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    const result = applyImageAdjust({ data, info: { width: 1, height: 1, channels: 3 } }, adjust({ invert: true }));

    expect([...new Uint16Array(result.data.buffer, result.data.byteOffset, 3)]).toEqual([25_535, 55_535, 0]);
  });

  it('should reject a buffer whose size does not match its geometry', () => {
    expect(() =>
      applyImageAdjust({ data: Buffer.alloc(5), info: { width: 1, height: 1, channels: 3 } }, adjust({ invert: true })),
    ).toThrow('Cannot adjust');
  });
});
