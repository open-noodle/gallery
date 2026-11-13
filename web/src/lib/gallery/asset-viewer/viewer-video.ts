import { registerSeekableVideo } from '#lib/gallery/asset-viewer/video-seek.ts';
import { persistVideoVolume } from '#lib/gallery/asset-viewer/video-volume.ts';
import type { Attachment } from 'svelte/attachments';

/** Everything Gallery attaches to the asset viewer's video: the persisted volume, and seeking from the side panel. */
export const galleryViewerVideo: Attachment<HTMLVideoElement> = (video) => {
  const cleanups = [persistVideoVolume(video), registerSeekableVideo(video)];
  return () => {
    for (const cleanup of cleanups) {
      cleanup?.();
    }
  };
};
