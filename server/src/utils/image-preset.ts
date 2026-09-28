import { BadRequestException } from '@nestjs/common';
import { AssetFileType, AssetType } from 'src/enum.js';
import { ImagePresetOptions } from 'src/types.js';

// Gallery-fork: derived image presets. A preset pins an aspect ratio and a list of widths; the
// height is derived here so every caller — the render, the DB row, the filename — agrees on it.
// See specs/2026-09-22-derived-image-presets-design.md.

// Kept here rather than in src/constants so DTOs can import them without pulling the whole constants
// module (which several specs mock wholesale) into the zod schema evaluation path.
export const IMAGE_PRESET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const IMAGE_PRESET_ASPECT_RATIO_PATTERN = /^\d{1,4}:\d{1,4}$/;

export type AspectRatio = { width: number; height: number };

export type ResolvedImagePreset = {
  name: string;
  width: number;
  height: number;
  preset: ImagePresetOptions;
};

export const parseAspectRatio = (value: string): AspectRatio => {
  if (!IMAGE_PRESET_ASPECT_RATIO_PATTERN.test(value)) {
    throw new Error(`Invalid aspect ratio "${value}": expected "W:H"`);
  }
  const [width, height] = value.split(':').map(Number);
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid aspect ratio "${value}": both sides must be positive`);
  }
  return { width, height };
};

/**
 * The output height for a preset width. Rounded to the nearest even number: chroma-subsampled
 * encoders (JPEG 4:2:0, WebP) want even dimensions, and 16:9 at every common width lands on an
 * integer anyway (1600→900, 1280→720, 960→540, 640→360, 320→180).
 */
export const getPresetHeight = (width: number, aspectRatio: string): number => {
  const ratio = parseAspectRatio(aspectRatio);
  const exact = (width * ratio.height) / ratio.width;
  return Math.max(2, Math.round(exact / 2) * 2);
};

/**
 * Validates a `?preset=&width=` request against config. Both must match exactly — a width that is
 * not listed is rejected rather than rendered, so the cache can only ever hold what an admin chose.
 */
export const resolveImagePreset = (
  presets: Record<string, ImagePresetOptions>,
  name: string | undefined,
  width: number | undefined,
): ResolvedImagePreset => {
  if (!name) {
    throw new BadRequestException('preset is required when width is specified');
  }

  const preset = presets[name];
  if (!preset) {
    throw new BadRequestException(`Unknown image preset "${name}"`);
  }

  if (width === undefined) {
    throw new BadRequestException(`width is required for preset "${name}"`);
  }

  if (!preset.widths.includes(width)) {
    throw new BadRequestException(
      `Width ${width} is not configured for preset "${name}" (allowed: ${preset.widths.join(', ')})`,
    );
  }

  return { name, width, height: getPresetHeight(width, preset.aspectRatio), preset };
};

/** Every (preset, width) pair config currently allows — the set the nightly cleanup keeps. */
export const listConfiguredPresetVariants = (
  presets: Record<string, ImagePresetOptions>,
): { preset: string; width: number }[] => {
  const variants: { preset: string; width: number }[] = [];
  for (const [preset, options] of Object.entries(presets)) {
    for (const width of options.widths) {
      variants.push({ preset, width });
    }
  }
  return variants;
};

/**
 * Whether a source of `source` dimensions can produce a `target` cover crop without upscaling.
 * Cover scales by max(targetW/srcW, targetH/srcH); that is ≤ 1 exactly when both sides fit.
 */
export const coversWithoutEnlargement = (
  source: { width: number; height: number },
  target: { width: number; height: number },
): boolean => source.width >= target.width && source.height >= target.height;

/**
 * The dimensions the preview file was rendered at: `fit: 'outside'` on `previewSize` scales the
 * shorter edge to `previewSize` and never enlarges. Returns zeros when the source dimensions are
 * unknown, which callers treat as "cannot tell, use the original".
 */
export const estimatePreviewDimensions = (
  original: { width: number; height: number },
  previewSize: number,
): { width: number; height: number } => {
  if (original.width <= 0 || original.height <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, previewSize / Math.min(original.width, original.height));
  return { width: Math.round(original.width * scale), height: Math.round(original.height * scale) };
};

/**
 * Source dimensions as the generated files see them: EXIF orientations 5-8 (and the ±90 the metadata
 * job normalises to) rotate the frame, so width and height swap. Same rule as asset.util's
 * getDimensions, duplicated to keep this module free of the asset.util → dto → this import cycle.
 */
export const getRotatedDimensions = (asset: {
  exifImageWidth: number | null;
  exifImageHeight: number | null;
  orientation: string | null;
}): { width: number; height: number } => {
  const width = asset.exifImageWidth ?? 0;
  const height = asset.exifImageHeight ?? 0;
  const orientation = Number(asset.orientation);
  const flipped = orientation && [5, 6, 7, 8, -90, 90].includes(orientation);
  return flipped ? { width: height, height: width } : { width, height };
};

export type DerivedImageSourceKind = 'preview' | 'fullsize' | 'original';

export type DerivedImageSource = {
  kind: DerivedImageSourceKind;
  path: string;
  /** Only set for originals: generated files are already rotated, originals are not. */
  orientation?: string;
};

export type DerivedImageSourceAsset = {
  type: AssetType;
  originalPath: string;
  exifImageWidth: number | null;
  exifImageHeight: number | null;
  orientation: string | null;
  files: { type: AssetFileType; path: string; isEdited: boolean }[];
};

/**
 * Picks what to render a variant from. Cheapest source that will not upscale wins:
 *   1. the preview, when its estimated dimensions cover the target;
 *   2. the fullsize file, when one exists (RAW/HEIC conversions, or fullsize generation enabled);
 *   3. the original, when sharp can decode it (web-friendly formats only) and the asset is an image;
 *   4. otherwise the preview anyway, accepting enlargement — better a soft hero than a 404.
 * `edited` prefers the edited generated files and falls back to the unedited ones, mirroring how
 * `getForThumbnail` orders `isEdited`.
 */
export const selectDerivedImageSource = (
  asset: DerivedImageSourceAsset,
  target: { width: number; height: number },
  options: { previewSize: number; edited: boolean; isWebSupportedImage: (path: string) => boolean },
): DerivedImageSource | undefined => {
  const find = (type: AssetFileType) =>
    asset.files.find((file) => file.type === type && file.isEdited === options.edited) ??
    (options.edited ? asset.files.find((file) => file.type === type && !file.isEdited) : undefined);

  const preview = find(AssetFileType.Preview);
  const fullsize = find(AssetFileType.FullSize);
  const usingEditedFiles = options.edited && asset.files.some((file) => file.isEdited);

  if (preview) {
    const previewDimensions = estimatePreviewDimensions(getRotatedDimensions(asset), options.previewSize);
    if (previewDimensions.width > 0 && coversWithoutEnlargement(previewDimensions, target)) {
      return { kind: 'preview', path: preview.path };
    }
  }

  if (fullsize) {
    return { kind: 'fullsize', path: fullsize.path };
  }

  // An edited asset's crop/rotation only exists in its generated files; never fall back to the
  // untouched original for it.
  if (!usingEditedFiles && asset.type === AssetType.Image && options.isWebSupportedImage(asset.originalPath)) {
    return { kind: 'original', path: asset.originalPath, orientation: asset.orientation ?? undefined };
  }

  return preview ? { kind: 'preview', path: preview.path } : undefined;
};
