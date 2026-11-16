import { videoFaceBox } from '#lib/gallery/asset-viewer/video-face-box.svelte.ts';
import type { VideoFaceSightingBoxDto } from '@immich/sdk';
import type { Attachment } from 'svelte/attachments';

/**
The asset viewer's video, for panels beside it that have no reference to the player: the assign picker's sighting
strip seeks to the moment a face was seen (specs/2026-10-31-video-face-frames-design.md, Phase 2).
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

/** How long (in ms) the wake-up play may take before the seek goes ahead without it. */
const WAKE_TIMEOUT = 300;

/** The latest seek asked for, applied once the wake-up play for its video is done. */
let target: { video: HTMLVideoElement; time: number; box?: VideoFaceSightingBoxDto } | undefined;
let waking: HTMLVideoElement | undefined;

/**
Safari stops drawing a paused video's seeks once the window is resized: the clock and the face box move, the
picture stays on the old frame until the video plays again. So each seek starts with a muted play and pause, which
keeps it drawing; other browsers only see a moment of silent playback. Seeks asked for meanwhile wait for the same
play, so the mute state read here is always the viewer's own.
*/
const wakeAndSeek = async (video: HTMLVideoElement) => {
  waking = video;
  const muted = video.muted;
  video.muted = true;
  await Promise.race([video.play().catch(() => {}), new Promise((resolve) => setTimeout(resolve, WAKE_TIMEOUT))]);
  video.pause();
  video.muted = muted;
  if (waking === video) {
    waking = undefined;
  }

  if (target?.video !== video) {
    return;
  }
  const { time, box } = target;
  target = undefined;
  if (current !== video) {
    return;
  }
  video.currentTime = time;
  if (box) {
    videoFaceBox.show(box, time);
  }
};

/**
Pauses the viewer's video at `time`, in seconds on its own timeline, so the frame stays on screen, with `box` drawn
around the face when given. Returns whether a video was there to seek; the seek itself lands a moment later.
*/
export const seekViewerVideo = (time: number, box?: VideoFaceSightingBoxDto): boolean => {
  if (!current) {
    return false;
  }

  videoFaceBox.clear();
  target = { video: current, time, box };
  if (waking !== current) {
    void wakeAndSeek(current);
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
