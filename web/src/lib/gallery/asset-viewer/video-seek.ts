import type { Attachment } from 'svelte/attachments';

/**
 * The asset viewer's video, for panels beside it that have no reference to the player: the assign picker's sighting
 * strip seeks to the moment a face was seen (specs/2026-10-31-video-face-frames-design.md, Phase 2).
 */
let current: HTMLVideoElement | undefined;

export const registerSeekableVideo: Attachment<HTMLVideoElement> = (video) => {
  current = video;
  return () => {
    // A newer player may have registered before this one was torn down.
    if (current === video) {
      current = undefined;
    }
  };
};

/**
 * Pauses the viewer's video at `time`, in seconds on its own timeline, so the frame stays on screen. Returns whether a
 * video was there to seek.
 */
export const seekViewerVideo = (time: number): boolean => {
  if (!current) {
    return false;
  }

  current.pause();
  current.currentTime = time;
  return true;
};

/** `0:42`, or `1:02:05` past an hour: how the player shows a time. */
export const formatSightingTime = (seconds: number) => {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
};
