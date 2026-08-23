import {
  computeFaceCroppedCoordinates,
  computeImageContentMetrics,
  computeSelectorPosition,
} from '$lib/utils/face-box-drag';

// A minimal stand-in for HTMLImageElement -- getNaturalSize (container-utils.ts) only ever reads
// naturalWidth/naturalHeight off it, and `instanceof HTMLVideoElement` is false for this shape in
// happy-dom, which is exactly the branch we want for these tests.
const image = (naturalWidth: number, naturalHeight: number) =>
  ({ naturalWidth, naturalHeight }) as unknown as HTMLImageElement;

describe('face-box-drag (shared geometry, used by FaceEditor and SpaceFaceEditor)', () => {
  describe('computeImageContentMetrics', () => {
    it('centers a landscape image inside a taller container', () => {
      // 2000x1000 natural, scaled to fit a 1000x1000 container -> 1000x500, centered vertically.
      const metrics = computeImageContentMetrics(image(2000, 1000), 1000, 1000);

      expect(metrics.contentWidth).toBe(1000);
      expect(metrics.contentHeight).toBe(500);
      expect(metrics.offsetX).toBe(0);
      expect(metrics.offsetY).toBe(250);
    });
  });

  describe('computeFaceCroppedCoordinates', () => {
    it('maps a content-space box back to natural image pixels', () => {
      // Natural 2000x1000 inside a 1000x1000 container -> content 1000x500, offset (0, 250).
      // A box drawn at content (100, 300) sized 50x50 sits at natural-space (200, 100) sized 100x100
      // (scale factor 2x on both axes).
      const el = image(2000, 1000);
      const coords = computeFaceCroppedCoordinates({ left: 100, top: 300, width: 50, height: 50 }, el, 1000, 1000);

      expect(coords).toEqual({ imageWidth: 2000, imageHeight: 1000, x: 200, y: 100, width: 100, height: 100 });
    });

    it('returns undefined when the container has collapsed to zero size', () => {
      const el = image(2000, 1000);
      const coords = computeFaceCroppedCoordinates({ left: 0, top: 0, width: 50, height: 50 }, el, 0, 0);

      expect(coords).toBeUndefined();
    });
  });

  describe('computeSelectorPosition', () => {
    it('prefers below the face box when nothing overlaps there', () => {
      const position = computeSelectorPosition({
        faceBox: { left: 100, top: 100, width: 100, height: 100 },
        selectorWidth: 200,
        selectorHeight: 200,
        containerWidth: 800,
        containerHeight: 800,
        gap: 10,
      });

      // faceBottom (200) + gap (10) = 210
      expect(position).toEqual({ top: 210, left: 100 });
    });

    it('falls back above the face box when below would run off the container', () => {
      // Face box near the bottom of a short container -> "below" is clamped and still overlaps,
      // so "above" (zero overlap) must win instead.
      const position = computeSelectorPosition({
        faceBox: { left: 10, top: 550, width: 100, height: 100 },
        selectorWidth: 150,
        selectorHeight: 200,
        containerWidth: 800,
        containerHeight: 700,
        gap: 10,
      });

      // above: top = faceBox.top - selectorHeight - gap = 550 - 200 - 10 = 340, left clamped to faceBox.left (10)
      expect(position).toEqual({ top: 340, left: 10 });
    });
  });
});
