import { clamp } from 'lodash-es';
import { getNaturalSize, scaleToFit, type ContentMetrics } from '$lib/utils/container-utils';

/**
 * Shared face-box drag geometry -- the coordinate transform and selector-placement math used by
 * BOTH the owner's `FaceEditor.svelte` and the space-flavoured `SpaceFaceEditor.svelte` when a
 * user drags/resizes a face box over the asset. Kept as pure functions in one place because two
 * independently maintained copies of this transform would drift and silently misplace boxes
 * (Slice 8, Task 2).
 */

export type BoundingRect = { left: number; top: number; width: number; height: number };

export type FaceCoordinates = {
  imageWidth: number;
  imageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Where the (possibly scaled/letterboxed) image content sits within its container. */
export const computeImageContentMetrics = (
  htmlElement: HTMLImageElement | HTMLVideoElement,
  containerWidth: number,
  containerHeight: number,
): ContentMetrics => {
  const natural = getNaturalSize(htmlElement);
  const container = { width: containerWidth, height: containerHeight };
  const { width: contentWidth, height: contentHeight } = scaleToFit(natural, container);
  return {
    contentWidth,
    contentHeight,
    offsetX: (containerWidth - contentWidth) / 2,
    offsetY: (containerHeight - contentHeight) / 2,
  };
};

/**
 * Converts a face rectangle's bounding box from CONTENT pixel space (the canvas overlay, scaled
 * to fit the container) into NATURAL pixel space (the original image/video) -- what every
 * face-box write endpoint (owner and space) expects. `undefined` when the container has
 * collapsed to zero size and the transform cannot be expressed.
 */
export const computeFaceCroppedCoordinates = (
  boundingRect: BoundingRect,
  htmlElement: HTMLImageElement | HTMLVideoElement,
  containerWidth: number,
  containerHeight: number,
): FaceCoordinates | undefined => {
  const { left, top, width, height } = boundingRect;
  const { offsetX, offsetY, contentWidth, contentHeight } = computeImageContentMetrics(
    htmlElement,
    containerWidth,
    containerHeight,
  );

  if (contentWidth <= 0 || contentHeight <= 0) {
    return undefined;
  }

  const natural = getNaturalSize(htmlElement);
  const scaleX = natural.width / contentWidth;
  const scaleY = natural.height / contentHeight;
  const imageX = (left - offsetX) * scaleX;
  const imageY = (top - offsetY) * scaleY;

  return {
    imageWidth: natural.width,
    imageHeight: natural.height,
    x: Math.floor(imageX),
    y: Math.floor(imageY),
    width: Math.floor(width * scaleX),
    height: Math.floor(height * scaleY),
  };
};

export type SelectorPosition = { top: number; left: number };

/**
 * Picks the corner of the face box the picker flyout should anchor to (below, above, right,
 * left), preferring whichever position overlaps the face box the least once clamped to stay
 * inside the container.
 */
export const computeSelectorPosition = (params: {
  faceBox: BoundingRect;
  selectorWidth: number;
  selectorHeight: number;
  containerWidth: number;
  containerHeight: number;
  gap?: number;
}): SelectorPosition => {
  const { faceBox, selectorWidth, selectorHeight, containerWidth, containerHeight, gap = 15 } = params;

  const clampTop = (top: number) => clamp(top, gap, containerHeight - selectorHeight - gap);
  const clampLeft = (left: number) => clamp(left, gap, containerWidth - selectorWidth - gap);

  const overlapArea = (position: SelectorPosition) => {
    const selectorRight = position.left + selectorWidth;
    const selectorBottom = position.top + selectorHeight;
    const faceRight = faceBox.left + faceBox.width;
    const faceBottom = faceBox.top + faceBox.height;

    const overlapX = Math.max(0, Math.min(selectorRight, faceRight) - Math.max(position.left, faceBox.left));
    const overlapY = Math.max(0, Math.min(selectorBottom, faceBottom) - Math.max(position.top, faceBox.top));
    return overlapX * overlapY;
  };

  const faceBottom = faceBox.top + faceBox.height;
  const faceRight = faceBox.left + faceBox.width;

  const positions: SelectorPosition[] = [
    { top: clampTop(faceBottom + gap), left: clampLeft(faceBox.left) },
    { top: clampTop(faceBox.top - selectorHeight - gap), left: clampLeft(faceBox.left) },
    { top: clampTop(faceBox.top), left: clampLeft(faceRight + gap) },
    { top: clampTop(faceBox.top), left: clampLeft(faceBox.left - selectorWidth - gap) },
  ];

  let bestPosition = positions[0]!;
  let leastOverlap = Infinity;

  for (const position of positions) {
    const overlap = overlapArea(position);
    if (overlap < leastOverlap) {
      leastOverlap = overlap;
      bestPosition = position;
      if (overlap === 0) {
        break;
      }
    }
  }

  return bestPosition;
};
