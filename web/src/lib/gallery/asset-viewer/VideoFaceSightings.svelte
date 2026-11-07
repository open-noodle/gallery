<script lang="ts">
  import { videoFaceBox } from '$lib/gallery/asset-viewer/video-face-box.svelte';
  import { formatSightingTime, seekViewerVideo } from '$lib/gallery/asset-viewer/video-seek';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { createUrl } from '$lib/utils';
  import { getAssetFaceSightings, type VideoFaceSightingDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiStar } from '@mdi/js';
  import { t } from 'svelte-i18n';

  /**
   * Every moment a video face's person was seen, as crops in time order; a click pauses the viewer's video there, with
   * a box around the face (specs/2026-10-31-video-face-frames-design.md, Phase 2). Renders nothing for a face with no sightings, on any
   * error, and against a server without the route, so the picker looks as it did before.
   */
  interface Props {
    faceId: string;
  }

  let { faceId }: Props = $props();

  let sightings: VideoFaceSightingDto[] = $state([]);
  let activeTime: number | undefined = $state();

  $effect(() => {
    const id = faceId;
    const controller = new AbortController();
    sightings = [];
    activeTime = undefined;
    getAssetFaceSightings({ id }, { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) {
          sightings = response.sightings;
        }
      })
      .catch(() => {});
    return () => {
      controller.abort();
      // The box belongs to this face's strip, so it goes with it.
      videoFaceBox.clear();
    };
  });

  const thumbnailUrl = (time: number) =>
    createUrl(`/faces/${faceId}/sightings/thumbnail`, { ...authManager.params, time });

  const show = ({ time, box }: VideoFaceSightingDto) => {
    if (seekViewerVideo(time, box)) {
      activeTime = time;
    }
  };
</script>

{#if sightings.length > 0}
  <div class="mb-4" data-testid="video-face-sightings">
    <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
      {$t('video_face_sightings_count', { values: { count: sightings.length } })}
    </p>
    <div class="flex gap-2 overflow-x-auto pb-2">
      {#each sightings as sighting (sighting.time)}
        {@const label = formatSightingTime(sighting.time)}
        <button
          type="button"
          class="relative shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={$t('video_face_sightings_show_at', { values: { time: label } })}
          aria-pressed={activeTime === sighting.time}
          onclick={() => show(sighting)}
        >
          <img
            src={thumbnailUrl(sighting.time)}
            alt=""
            loading="lazy"
            draggable="false"
            class="size-16 rounded-lg bg-gray-200 object-cover dark:bg-gray-700 {activeTime === sighting.time
              ? 'ring-2 ring-primary'
              : ''}"
          />
          {#if sighting.isBest}
            <span class="absolute inset-e-1 top-1 rounded-full bg-black/60 p-0.5 text-yellow-300" data-testid="best">
              <Icon icon={mdiStar} size="12" />
            </span>
          {/if}
          <span class="mt-1 block text-center text-xs tabular-nums">{label}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}
