import { BadRequestException } from '@nestjs/common';
import { AssetFileType, AssetType, ImageFormat, ImagePresetPosition } from 'src/enum.js';
import { ImagePresetOptions } from 'src/types.js';
import {
  IMAGE_PRESET_ASPECT_RATIO_PATTERN,
  IMAGE_PRESET_NAME_PATTERN,
  coversWithoutEnlargement,
  estimatePreviewDimensions,
  getPresetHeight,
  getRotatedDimensions,
  listConfiguredPresetVariants,
  parseAspectRatio,
  resolveImagePreset,
  selectDerivedImageSource,
} from 'src/utils/image-preset.js';

const landscape: ImagePresetOptions = {
  aspectRatio: '16:9',
  widths: [1600, 1280, 960, 640, 320],
  position: ImagePresetPosition.Center,
  format: ImageFormat.Webp,
  quality: 80,
};

const square: ImagePresetOptions = {
  aspectRatio: '1:1',
  widths: [1024, 768, 640, 320],
  position: ImagePresetPosition.Attention,
  format: ImageFormat.Jpeg,
  quality: 85,
};

const presets = { landscape, square };

describe('image presets', () => {
  describe('patterns', () => {
    it('accepts slug names and rejects anything that would not survive a URL or filename', () => {
      for (const name of ['landscape', 'hero-16x9', 'a', '0', 'x'.repeat(32)]) {
        expect(IMAGE_PRESET_NAME_PATTERN.test(name)).toBe(true);
      }
      for (const name of ['', 'Landscape', 'hero 16x9', 'hero_16x9', '-hero', 'x'.repeat(33), '../etc']) {
        expect(IMAGE_PRESET_NAME_PATTERN.test(name)).toBe(false);
      }
    });

    it('accepts W:H ratios only', () => {
      for (const ratio of ['16:9', '1:1', '4:3', '3:2', '21:9', '1000:1']) {
        expect(IMAGE_PRESET_ASPECT_RATIO_PATTERN.test(ratio)).toBe(true);
      }
      for (const ratio of ['16/9', '16x9', '1.78', ':9', '16:', '16:9:1', '-16:9', '16 : 9']) {
        expect(IMAGE_PRESET_ASPECT_RATIO_PATTERN.test(ratio)).toBe(false);
      }
    });
  });

  describe('parseAspectRatio', () => {
    it('splits W:H', () => {
      expect(parseAspectRatio('16:9')).toEqual({ width: 16, height: 9 });
      expect(parseAspectRatio('1:1')).toEqual({ width: 1, height: 1 });
    });

    it('rejects malformed and zero-sided ratios', () => {
      expect(() => parseAspectRatio('16x9')).toThrow('expected "W:H"');
      expect(() => parseAspectRatio('0:9')).toThrow('positive');
      expect(() => parseAspectRatio('16:0')).toThrow('positive');
    });
  });

  describe('getPresetHeight', () => {
    it('derives the responsive 16:9 package exactly', () => {
      expect(getPresetHeight(1600, '16:9')).toBe(900);
      expect(getPresetHeight(1280, '16:9')).toBe(720);
      expect(getPresetHeight(960, '16:9')).toBe(540);
      expect(getPresetHeight(640, '16:9')).toBe(360);
      expect(getPresetHeight(320, '16:9')).toBe(180);
    });

    it('derives the square package exactly', () => {
      for (const width of [1024, 768, 640, 320]) {
        expect(getPresetHeight(width, '1:1')).toBe(width);
      }
    });

    it('rounds to an even height when the ratio does not divide cleanly', () => {
      // 1000 * 2 / 3 = 666.67 -> 666
      expect(getPresetHeight(1000, '3:2')).toBe(666);
      // 999 * 9 / 16 = 561.94 -> 562
      expect(getPresetHeight(999, '16:9')).toBe(562);
      expect(getPresetHeight(999, '16:9') % 2).toBe(0);
    });

    it('never returns less than 2', () => {
      expect(getPresetHeight(16, '1000:1')).toBe(2);
    });
  });

  describe('resolveImagePreset', () => {
    it('returns the preset with the derived height for an allowed width', () => {
      expect(resolveImagePreset(presets, 'landscape', 1280)).toEqual({
        name: 'landscape',
        width: 1280,
        height: 720,
        preset: landscape,
      });
    });

    it('rejects an unknown preset', () => {
      expect(() => resolveImagePreset(presets, 'portrait', 1280)).toThrow(BadRequestException);
      expect(() => resolveImagePreset(presets, 'portrait', 1280)).toThrow('Unknown image preset "portrait"');
    });

    it('rejects a width that is not configured, so the cache cannot be filled with arbitrary sizes', () => {
      expect(() => resolveImagePreset(presets, 'landscape', 1281)).toThrow(BadRequestException);
      expect(() => resolveImagePreset(presets, 'landscape', 1281)).toThrow('allowed: 1600, 1280, 960, 640, 320');
    });

    it('requires both parameters', () => {
      expect(() => resolveImagePreset(presets, undefined, 1280)).toThrow('preset is required');
      expect(() => resolveImagePreset(presets, 'landscape', undefined)).toThrow('width is required');
    });

    it('rejects everything when no presets are configured (upstream behaviour is untouched)', () => {
      expect(() => resolveImagePreset({}, 'landscape', 1600)).toThrow(BadRequestException);
    });
  });

  describe('listConfiguredPresetVariants', () => {
    it('flattens every (preset, width) pair', () => {
      expect(listConfiguredPresetVariants({ square: { ...square, widths: [1024, 320] } })).toEqual([
        { preset: 'square', width: 1024 },
        { preset: 'square', width: 320 },
      ]);
      expect(listConfiguredPresetVariants({})).toEqual([]);
    });
  });

  describe('coversWithoutEnlargement', () => {
    it('is true exactly when both sides of the source are at least the target', () => {
      expect(coversWithoutEnlargement({ width: 2160, height: 1440 }, { width: 1600, height: 900 })).toBe(true);
      expect(coversWithoutEnlargement({ width: 2160, height: 1440 }, { width: 1024, height: 1024 })).toBe(true);
      expect(coversWithoutEnlargement({ width: 1600, height: 900 }, { width: 1600, height: 900 })).toBe(true);
      expect(coversWithoutEnlargement({ width: 1152, height: 1440 }, { width: 1600, height: 900 })).toBe(false);
      expect(coversWithoutEnlargement({ width: 2160, height: 1000 }, { width: 1024, height: 1024 })).toBe(false);
    });
  });

  describe('estimatePreviewDimensions', () => {
    it('scales the shorter edge to the preview size and keeps the aspect', () => {
      expect(estimatePreviewDimensions({ width: 6000, height: 4000 }, 1440)).toEqual({ width: 2160, height: 1440 });
      expect(estimatePreviewDimensions({ width: 4000, height: 6000 }, 1440)).toEqual({ width: 1440, height: 2160 });
    });

    it('never enlarges', () => {
      expect(estimatePreviewDimensions({ width: 800, height: 600 }, 1440)).toEqual({ width: 800, height: 600 });
    });

    it('returns zeros for unknown source dimensions', () => {
      expect(estimatePreviewDimensions({ width: 0, height: 0 }, 1440)).toEqual({ width: 0, height: 0 });
    });
  });

  describe('getRotatedDimensions', () => {
    it('swaps width and height for rotated EXIF orientations', () => {
      const base = { exifImageWidth: 6000, exifImageHeight: 4000 };
      expect(getRotatedDimensions({ ...base, orientation: null })).toEqual({ width: 6000, height: 4000 });
      expect(getRotatedDimensions({ ...base, orientation: '1' })).toEqual({ width: 6000, height: 4000 });
      expect(getRotatedDimensions({ ...base, orientation: '6' })).toEqual({ width: 4000, height: 6000 });
      expect(getRotatedDimensions({ ...base, orientation: '8' })).toEqual({ width: 4000, height: 6000 });
      expect(getRotatedDimensions({ ...base, orientation: '90' })).toEqual({ width: 4000, height: 6000 });
    });

    it('treats missing dimensions as zero', () => {
      expect(getRotatedDimensions({ exifImageWidth: null, exifImageHeight: null, orientation: null })).toEqual({
        width: 0,
        height: 0,
      });
    });
  });

  describe('selectDerivedImageSource', () => {
    const preview = { type: AssetFileType.Preview, path: '/thumbs/a_preview.jpeg', isEdited: false };
    const fullsize = { type: AssetFileType.FullSize, path: '/thumbs/a_fullsize.jpeg', isEdited: false };
    const editedPreview = { type: AssetFileType.Preview, path: '/thumbs/a_preview_edited.jpeg', isEdited: true };
    const options = { previewSize: 1440, edited: false, isWebSupportedImage: () => true };
    const asset = {
      type: AssetType.Image,
      originalPath: '/library/a.jpg',
      exifImageWidth: 6000,
      exifImageHeight: 4000,
      orientation: null,
      files: [preview],
    };

    it('uses the preview when it covers the target without upscaling', () => {
      expect(selectDerivedImageSource(asset, { width: 1600, height: 900 }, options)).toEqual({
        kind: 'preview',
        path: preview.path,
      });
      expect(selectDerivedImageSource(asset, { width: 1024, height: 1024 }, options)).toEqual({
        kind: 'preview',
        path: preview.path,
      });
    });

    it('accounts for EXIF rotation when judging the preview', () => {
      // 4000x6000 portrait, rotated: the preview is 1440 wide, so a 1600-wide crop needs the original.
      const portrait = { ...asset, exifImageWidth: 6000, exifImageHeight: 4000, orientation: '6' };
      expect(selectDerivedImageSource(portrait, { width: 1600, height: 900 }, options)).toEqual({
        kind: 'original',
        path: portrait.originalPath,
        orientation: '6',
      });
    });

    it('prefers a fullsize file over decoding the original when the preview is too small', () => {
      const withFullsize = { ...asset, exifImageWidth: 4000, exifImageHeight: 6000, files: [preview, fullsize] };
      expect(selectDerivedImageSource(withFullsize, { width: 1600, height: 900 }, options)).toEqual({
        kind: 'fullsize',
        path: fullsize.path,
      });
    });

    it('falls back to the original only for web-decodable images', () => {
      const tallOriginal = { ...asset, exifImageWidth: 4000, exifImageHeight: 6000 };
      expect(selectDerivedImageSource(tallOriginal, { width: 1600, height: 900 }, options)).toEqual({
        kind: 'original',
        path: tallOriginal.originalPath,
        orientation: undefined,
      });

      // A RAW original sharp cannot open: accept an enlarged preview instead.
      expect(
        selectDerivedImageSource(
          tallOriginal,
          { width: 1600, height: 900 },
          { ...options, isWebSupportedImage: () => false },
        ),
      ).toEqual({ kind: 'preview', path: preview.path });
    });

    it('never decodes the original for a video; it renders from the preview frame', () => {
      const video = { ...asset, type: AssetType.Video, exifImageWidth: 1280, exifImageHeight: 720 };
      expect(selectDerivedImageSource(video, { width: 1600, height: 900 }, options)).toEqual({
        kind: 'preview',
        path: preview.path,
      });
    });

    it('uses the unknown-dimensions escape hatch: no exif means the original when it can be decoded', () => {
      const noExif = { ...asset, exifImageWidth: null, exifImageHeight: null };
      expect(selectDerivedImageSource(noExif, { width: 320, height: 180 }, options)).toEqual({
        kind: 'original',
        path: noExif.originalPath,
        orientation: undefined,
      });
    });

    it('prefers edited generated files and never falls back to the untouched original for them', () => {
      const edited = { ...asset, exifImageWidth: 4000, exifImageHeight: 6000, files: [preview, editedPreview] };
      // Too small to cover, but the edited crop only exists in the generated files.
      expect(selectDerivedImageSource(edited, { width: 1600, height: 900 }, { ...options, edited: true })).toEqual({
        kind: 'preview',
        path: editedPreview.path,
      });
    });

    it('falls back to the unedited files when edited ones were requested but do not exist', () => {
      expect(selectDerivedImageSource(asset, { width: 320, height: 180 }, { ...options, edited: true })).toEqual({
        kind: 'preview',
        path: preview.path,
      });
    });

    it('returns nothing when thumbnails have not been generated and the original cannot be decoded', () => {
      const bare = { ...asset, files: [] };
      expect(
        selectDerivedImageSource(bare, { width: 320, height: 180 }, { ...options, isWebSupportedImage: () => false }),
      ).toBeUndefined();
    });
  });
});
