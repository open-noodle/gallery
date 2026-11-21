<script lang="ts">
  import { videoFaceBox } from '#lib/gallery/asset-viewer/video-face-box.svelte.ts';
  import { frameAroundFace } from '#lib/gallery/utils/face-frame.ts';
  import { mapNormalizedRectToContent } from '#lib/utils/container-utils.ts';
  import { computeImageContentMetrics } from '#lib/utils/face-box-drag.ts';

  /**
  A white box around the face at the moment the sighting strip paused the video on, with the rest of the picture
  dimmed, as a photo marks a highlighted face (specs/2026-10-31-video-face-frames-design.md, Phase 2). Placed with
  the face editor's geometry: the video is scaled to fit its container and centred in it.
  */
  interface Props {
    video: HTMLVideoElement | undefined;
    containerWidth: number;
    containerHeight: number;
  }

  let { video, containerWidth, containerHeight }: Props = $props();

  // Fitting can leave float noise such as -5.7e-14, which a style value should not carry.
  const px = (value: number) => `${Math.round(value * 100) / 100}px`;

  const placement = $derived.by(() => {
    const shown = videoFaceBox.current;
    if (!shown || !video) {
      return;
    }

    const metrics = computeImageContentMetrics(video, containerWidth, containerHeight);
    if (metrics.contentWidth <= 0 || metrics.contentHeight <= 0) {
      return;
    }

    const { x1, y1, x2, y2 } = shown.box;
    const frame = frameAroundFace(
      mapNormalizedRectToContent(
        { x: x1, y: y1 },
        { x: x2, y: y2 },
        { contentWidth: metrics.contentWidth, contentHeight: metrics.contentHeight, offsetX: 0, offsetY: 0 },
      ),
    );
    return {
      picture: {
        left: px(metrics.offsetX),
        top: px(metrics.offsetY),
        width: px(metrics.contentWidth),
        height: px(metrics.contentHeight),
      },
      frame: { left: px(frame.left), top: px(frame.top), width: px(frame.width), height: px(frame.height) },
    };
  });
</script>

{#if placement}
  {const { picture, frame } = $derived(placement)}
  <div
    class="pointer-events-none absolute z-5 overflow-hidden"
    style:left={picture.left}
    style:top={picture.top}
    style:width={picture.width}
    style:height={picture.height}
    data-testid="video-face-box"
  >
    <div
      class="absolute rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.4)] outline-3 outline-white"
      style:left={frame.left}
      style:top={frame.top}
      style:width={frame.width}
      style:height={frame.height}
      data-testid="video-face-box-face"
    ></div>
  </div>
{/if}
