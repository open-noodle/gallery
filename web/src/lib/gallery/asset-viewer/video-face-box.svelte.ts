import type { VideoFaceSightingBoxDto } from '@immich/sdk';

/**
 * The face box drawn over the asset viewer's video while the sighting strip holds it at a moment
 * (specs/2026-10-31-video-face-frames-design.md, Phase 2). `time` is the moment the box belongs to, on the player's
 * timeline, so the box can go once the video moves on from it.
 */
class VideoFaceBox {
  current = $state<{ box: VideoFaceSightingBoxDto; time: number }>();

  show(box: VideoFaceSightingBoxDto, time: number) {
    this.current = { box, time };
  }

  clear() {
    this.current = undefined;
  }
}

export const videoFaceBox = new VideoFaceBox();
