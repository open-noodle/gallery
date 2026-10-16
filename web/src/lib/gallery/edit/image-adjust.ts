import type { AssetImageAdjustResponseDto } from '@immich/sdk';

export type ImageAdjust = AssetImageAdjustResponseDto;

export const NEUTRAL_IMAGE_ADJUST: Readonly<ImageAdjust> = Object.freeze({
  exposure: 0,
  contrast: 0,
  saturation: 0,
  invert: false,
});

export const isNeutralImageAdjust = ({ exposure, contrast, saturation, invert }: ImageAdjust) =>
  exposure === 0 && contrast === 0 && saturation === 0 && !invert;

export const isSameImageAdjust = (a: ImageAdjust, b: ImageAdjust) =>
  a.exposure === b.exposure && a.contrast === b.contrast && a.saturation === b.saturation && a.invert === b.invert;

/**
 * The CSS filter the editor previews an adjustment with. The server renders the saved thumbnails with the same
 * functions in the same order, clamping between them as browsers do (`applyImageAdjust` in
 * server/src/gallery/utils/image-adjust.ts), so the preview is the saved result. Keep the two in step.
 *
 * Invert runs before exposure and contrast so that, on a scanned film negative, they act on the positive the user
 * sees: a negative exposure darkens it.
 */
export const imageAdjustFilter = ({ exposure, contrast, saturation, invert }: ImageAdjust): string =>
  [
    saturation === 0 ? '' : `saturate(${1 + saturation / 100})`,
    invert ? 'invert(1)' : '',
    exposure === 0 ? '' : `brightness(${1 + exposure / 100})`,
    contrast === 0 ? '' : `contrast(${1 + contrast / 100})`,
  ]
    .filter(Boolean)
    .join(' ');
