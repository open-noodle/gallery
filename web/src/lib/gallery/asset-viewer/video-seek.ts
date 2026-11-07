import type { VideoFaceSightingBoxDto } from '@immich/sdk';
import type { Attachment } from 'svelte/attachments';
import { videoFaceBox } from '$lib/gallery/asset-viewer/video-face-box.svelte';

/**
 * The asset viewer's video, for panels beside it that have no reference to the player: the assign picker's sighting
 * strip seeks to the moment a face was seen (specs/2026-10-31-video-face-frames-design.md, Phase 2).
 */
let current: HTMLVideoElement | undefined;

/** A seek this close (in seconds) to the shown moment is still that moment. */
const SAME_MOMENT = 0.1;

export const registerSeekableVideo: Attachment<HTMLVideoElement> = (video) => {
  current = video;

  // The face box marks one paused moment, so it goes once the video plays or is scrubbed away from it.
  const onPlay = () => videoFaceBox.clear();
  const onSeeking = () => {
    const shown = videoFaceBox.current;
    if (shown && Math.abs(video.currentTime - shown.time) > SAME_MOMENT) {
      videoFaceBox.clear();
    }
  };
  video.addEventListener('play', onPlay);
  video.addEventListener('seeking', onSeeking);

  return () => {
    video.removeEventListener('play', onPlay);
    video.removeEventListener('seeking', onSeeking);
    // A newer player may have registered before this one was torn down.
    if (current === video) {
      current = undefined;
      videoFaceBox.clear();
    }
  };
};

/**
 * Pauses the viewer's video at `time`, in seconds on its own timeline, so the frame stays on screen, with `box` drawn
 * around the face when given. Returns whether a video was there to seek.
 */
export const seekViewerVideo = (time: number, box?: VideoFaceSightingBoxDto): boolean => {
  if (!current) {
    return false;
  }

  current.pause();
  current.currentTime = time;
  if (box) {
    videoFaceBox.show(box, time);
  } else {
    videoFaceBox.clear();
  }
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
