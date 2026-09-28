import { AssetEditAction, type AssetResponseDto } from '@immich/sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EditActions } from '$lib/managers/edit/edit-manager.svelte';
import { transformManager } from './transform-manager.svelte';
import source from './transform-manager.svelte.ts?raw';

function assetWithExif(): AssetResponseDto {
  return {
    id: 'asset-1',
    thumbhash: null,
    exifInfo: { exifImageWidth: 1200, exifImageHeight: 800 },
  } as unknown as AssetResponseDto;
}

describe('transformManager', () => {
  it('sets anonymous CORS before loading the preview image', () => {
    const crossOriginIndex = source.indexOf("this.imgElement.crossOrigin = 'anonymous';");
    const srcIndex = source.indexOf('this.imgElement.src = imageURL;');

    expect(crossOriginIndex).toBeGreaterThanOrEqual(0);
    expect(crossOriginIndex).toBeLessThan(srcIndex);
  });

  describe('adjust', () => {
    beforeEach(() => {
      transformManager.reset();
    });

    describe('hasAdjustChanges', () => {
      it('is false at default state', () => {
        expect(transformManager.hasAdjustChanges()).toBe(false);
      });

      it('is true when exposure is non-zero', () => {
        transformManager.exposure = 10;
        expect(transformManager.hasAdjustChanges()).toBe(true);
      });

      it('is true when contrast is non-zero', () => {
        transformManager.contrast = -10;
        expect(transformManager.hasAdjustChanges()).toBe(true);
      });

      it('is true when saturation is non-zero', () => {
        transformManager.saturation = 10;
        expect(transformManager.hasAdjustChanges()).toBe(true);
      });

      it('is true when invert is enabled', () => {
        transformManager.invert = true;
        expect(transformManager.hasAdjustChanges()).toBe(true);
      });
    });

    describe('getEdits', () => {
      beforeEach(() => {
        // Neutralize crop so it doesn't also appear in `edits` — region matches
        // previewImageSize (cropImageSize * cropImageScale) at their reset() defaults.
        transformManager.region = { x: 0, y: 0, width: 1000, height: 1000 };
      });

      it('produces no adjust edit when nothing changed', () => {
        expect(transformManager.edits).toEqual([]);
      });

      it('includes only the changed field in the adjust edit', () => {
        transformManager.exposure = 20;
        expect(transformManager.edits).toEqual([{ action: AssetEditAction.Adjust, parameters: { exposure: 20 } }]);
      });

      it('omits invert when false but includes it when true', () => {
        transformManager.invert = true;
        expect(transformManager.edits).toEqual([{ action: AssetEditAction.Adjust, parameters: { invert: true } }]);
      });

      it('includes all four fields when all are changed', () => {
        transformManager.exposure = 10;
        transformManager.contrast = -15;
        transformManager.saturation = 30;
        transformManager.invert = true;

        expect(transformManager.edits).toEqual([
          {
            action: AssetEditAction.Adjust,
            parameters: { exposure: 10, contrast: -15, saturation: 30, invert: true },
          },
        ]);
      });
    });

    describe('onActivate', () => {
      it('pre-populates adjust fields from an existing edit', async () => {
        const edits: EditActions = [
          {
            action: AssetEditAction.Adjust,
            parameters: { exposure: 15, contrast: -5, saturation: 40, invert: true },
          },
        ];

        await transformManager.onActivate(assetWithExif(), edits);

        expect(transformManager.exposure).toBe(15);
        expect(transformManager.contrast).toBe(-5);
        expect(transformManager.saturation).toBe(40);
        expect(transformManager.invert).toBe(true);
      });

      it('defaults adjust fields to zero/false when no adjust edit exists', async () => {
        await transformManager.onActivate(assetWithExif(), []);

        expect(transformManager.exposure).toBe(0);
        expect(transformManager.contrast).toBe(0);
        expect(transformManager.saturation).toBe(0);
        expect(transformManager.invert).toBe(false);
      });

      it('resets adjust fields when reactivating without a prior adjust edit', async () => {
        transformManager.exposure = 50;
        transformManager.invert = true;

        await transformManager.onActivate(assetWithExif(), []);

        expect(transformManager.exposure).toBe(0);
        expect(transformManager.invert).toBe(false);
      });
    });

    describe('resetAllChanges', () => {
      it('zeroes adjust fields', async () => {
        transformManager.exposure = 10;
        transformManager.contrast = 10;
        transformManager.saturation = 10;
        transformManager.invert = true;

        await transformManager.resetAllChanges();

        expect(transformManager.exposure).toBe(0);
        expect(transformManager.contrast).toBe(0);
        expect(transformManager.saturation).toBe(0);
        expect(transformManager.invert).toBe(false);
        expect(transformManager.hasAdjustChanges()).toBe(false);
      });
    });

    describe('reset', () => {
      it('zeroes adjust fields', () => {
        transformManager.exposure = 10;
        transformManager.contrast = 10;
        transformManager.saturation = 10;
        transformManager.invert = true;

        transformManager.reset();

        expect(transformManager.exposure).toBe(0);
        expect(transformManager.contrast).toBe(0);
        expect(transformManager.saturation).toBe(0);
        expect(transformManager.invert).toBe(false);
      });
    });
  });
});
