import type { Rect } from '#lib/utils/container-utils.ts';

const FRAME_GAP_PX = 6;
const FRAME_MIN_PX = 40;

/**
The window a face highlight leaves undimmed, with its ring drawn outside it. Drawn on the face box itself, a 3px
ring and its rounded corners covered a face 10-15px wide entirely, so the window keeps a margin around the face
and is never smaller than FRAME_MIN_PX, centred on the face.
*/
export const frameAroundFace = (face: Rect): Rect => {
  const width = Math.max(face.width + 2 * FRAME_GAP_PX, FRAME_MIN_PX);
  const height = Math.max(face.height + 2 * FRAME_GAP_PX, FRAME_MIN_PX);
  return {
    left: face.left + (face.width - width) / 2,
    top: face.top + (face.height - height) / 2,
    width,
    height,
  };
};
