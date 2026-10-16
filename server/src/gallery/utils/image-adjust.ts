import type { Bitmap } from 'src/types.js';
import { type ImageAdjust, isNeutralImageAdjust } from 'src/gallery/dtos/image-adjust.dto.js';

const clamp01 = (value: number) => (value < 0 ? 0 : Math.min(value, 1));

/**
 * Applies the adjustment to an already edited and resized bitmap exactly as the web editor previews it: the CSS
 * filter list `saturate() invert() brightness() contrast()` built by `imageAdjustFilter` in
 * web/src/lib/gallery/edit/image-adjust.ts (keep the two in step), with the CSS Filter Effects definitions
 * (https://www.w3.org/TR/filter-effects-1/#ShorthandEquivalents). Invert runs before exposure and contrast so that, on
 * a scanned film negative, they act on the positive the user sees: a negative exposure darkens it.
 *
 * - each function clamps its output to the colour range before the next one runs, as browsers do. Folding exposure and
 *   contrast into one linear map does not: exposure +100 then contrast -50 turns red 199 into 191 in the browser, 255
 *   when folded;
 * - the functions act on the encoded values, not linear light, so this runs after the scRGB edit and resize pass and
 *   on its 8-bit (or 16-bit) output, never inside it;
 * - alpha is left as it is. The scRGB pass hands back straight alpha even though sharp flags it premultiplied, and
 *   the functions are defined on straight alpha.
 *
 * Plain arithmetic over the raw buffer rather than sharp's `linear`/`recomb`/`negate`: those are single option slots
 * that libvips applies in a fixed order without clamping between them.
 */
export const applyImageAdjust = (image: Bitmap, adjust: ImageAdjust): Bitmap => {
  if (isNeutralImageAdjust(adjust)) {
    return image;
  }

  const { width, height, channels } = image.info;
  const samples = width * height * channels;
  const bytesPerSample = image.data.length / samples;
  if (bytesPerSample !== 1 && bytesPerSample !== 2) {
    throw new Error(`Cannot adjust a ${width}x${height}x${channels} bitmap of ${image.data.length} bytes`);
  }

  const max = bytesPerSample === 1 ? 255 : 65_535;
  const input =
    bytesPerSample === 1
      ? image.data
      : new Uint16Array(image.data.buffer, image.data.byteOffset, image.data.length / 2);
  const outputBuffer = Buffer.alloc(image.data.length);
  const output =
    bytesPerSample === 1 ? outputBuffer : new Uint16Array(outputBuffer.buffer, outputBuffer.byteOffset, samples);

  const brightness = 1 + adjust.exposure / 100;
  const contrast = 1 + adjust.contrast / 100;
  // invert, brightness and contrast act on each channel alone, on a value already clamped to 0..1.
  const tone = (value: number) => {
    let v = adjust.invert ? 1 - value : value;
    if (brightness !== 1) {
      v = clamp01(v * brightness);
    }
    if (contrast !== 1) {
      v = clamp01((v - 0.5) * contrast + 0.5);
    }
    return Math.round(v * max);
  };

  // Grey (+ alpha) bitmaps have one colour channel; saturation does not apply to them.
  const colorChannels = channels >= 3 ? 3 : 1;
  const s = 1 + adjust.saturation / 100;

  if (s === 1 || colorChannels < 3) {
    // Without saturation every channel maps through the same table.
    const table = new Uint16Array(max + 1);
    for (let value = 0; value <= max; value++) {
      table[value] = tone(value / max);
    }
    for (let i = 0; i < samples; i += channels) {
      for (let c = 0; c < channels; c++) {
        output[i + c] = c < colorChannels ? table[input[i + c]] : input[i + c];
      }
    }
  } else {
    // The saturate() matrix: https://www.w3.org/TR/filter-effects-1/#saturateEquivalent
    const m = [
      [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ];
    for (let i = 0; i < samples; i += channels) {
      const r = input[i] / max;
      const g = input[i + 1] / max;
      const b = input[i + 2] / max;
      output[i] = tone(clamp01(m[0][0] * r + m[0][1] * g + m[0][2] * b));
      output[i + 1] = tone(clamp01(m[1][0] * r + m[1][1] * g + m[1][2] * b));
      output[i + 2] = tone(clamp01(m[2][0] * r + m[2][1] * g + m[2][2] * b));
      for (let c = 3; c < channels; c++) {
        output[i + c] = input[i + c];
      }
    }
  }

  return { data: outputBuffer, info: image.info };
};
