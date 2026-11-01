import type { Faces } from '$lib/managers/asset-viewer-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { createUrl } from '$lib/utils';

/**
 * A server-rendered crop of a video face, as a data URL. A face sampled across the whole video is cut from its best
 * frame at full resolution (specs/2026-10-31-video-face-frames-design.md); cropping in the browser could only cut the
 * box out of the video's poster thumbnail, which may show a different moment. Null when the server cannot serve it
 * (an older server without the route, or no access), so the caller falls back to cropping the thumbnail.
 *
 * The server lets the browser cache a crop, but a refresh of a video keeps each matched face's id and moves it to a
 * better frame, so the face's box goes in the URL: a moved face is a new URL, an unchanged one stays cached.
 */
export const fetchVideoFaceCrop = async (face: Faces): Promise<string | null> => {
  const { id, imageWidth, imageHeight, boundingBoxX1, boundingBoxY1, boundingBoxX2, boundingBoxY2 } = face;
  const c = [imageWidth, imageHeight, boundingBoxX1, boundingBoxY1, boundingBoxX2, boundingBoxY2].join('-');
  try {
    const response = await fetch(createUrl(`/faces/${id}/thumbnail`, { ...authManager.params, c }));
    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(typeof reader.result === 'string' ? reader.result : null));
      reader.addEventListener('error', () => resolve(null));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};
