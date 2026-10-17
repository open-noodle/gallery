import type { Attachment } from 'svelte/attachments';
import { videoViewerMuted, videoViewerVolume } from '$lib/gallery/stores/preferences.store';

/** Applies the persisted volume and mute state to a viewer video, and persists every change to them. */
export const persistVideoVolume: Attachment<HTMLVideoElement> = (video) => {
  const unsubscribeMuted = videoViewerMuted.subscribe((muted) => (video.muted = muted));
  const unsubscribeVolume = videoViewerVolume.subscribe((volume) => (video.volume = volume));
  const onVolumeChange = () => {
    videoViewerMuted.set(video.muted);
    videoViewerVolume.set(video.volume);
  };

  video.addEventListener('volumechange', onVolumeChange);
  return () => {
    video.removeEventListener('volumechange', onVolumeChange);
    unsubscribeMuted();
    unsubscribeVolume();
  };
};
