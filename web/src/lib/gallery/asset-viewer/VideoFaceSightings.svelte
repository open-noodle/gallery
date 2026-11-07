<script lang="ts">
  import { videoFaceBox } from '$lib/gallery/asset-viewer/video-face-box.svelte';
  import { formatSightingTime, seekViewerVideo } from '$lib/gallery/asset-viewer/video-seek';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { createUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import {
    getAssetFaceSightings,
    removeAssetFaceSighting,
    restoreAssetFaceSighting,
    type VideoFaceSightingDto,
  } from '@immich/sdk';
  import { Icon, toastManager } from '@immich/ui';
  import { mdiStar, mdiTrashCanOutline } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';

  /**
   * Every moment a video face's person was seen, as crops in time order; a click pauses the viewer's video there, with
   * a box around the face (specs/2026-10-31-video-face-frames-design.md, Phase 2). Given several faces (one person
   * tracked more than once in the video), it lists all their moments together. Renders nothing, or `empty` once loaded,
   * for faces with no sightings, on any error, and against a server without the route, so the picker looks as it did
   * before. With `canRemove`, each moment of a face that has more than one gets a button that takes it out of the face,
   * with a few seconds to undo it; taking out the best view makes the next best one it.
   */
  interface Props {
    faceIds: string[];
    empty?: Snippet;
    canRemove?: boolean;
  }

  let { faceIds, empty, canRemove = false }: Props = $props();

  type Sighting = VideoFaceSightingDto & { faceId: string; key: string };

  let sightings: Sighting[] = $state([]);
  let loaded = $state(false);
  let activeKey: string | undefined = $state();

  const forFace = (faceId: string, list: VideoFaceSightingDto[]): Sighting[] =>
    list.map((sighting) => ({ ...sighting, faceId, key: `${faceId}:${sighting.time}` }));

  const load = async (faceId: string, signal: AbortSignal): Promise<Sighting[]> => {
    try {
      const response = await getAssetFaceSightings({ id: faceId }, { signal });
      return forFace(faceId, response.sightings);
    } catch {
      return [];
    }
  };

  /** Swaps in what the server now lists for one face, which moves the star when the best view changed. */
  const replaceFace = (faceId: string, list: VideoFaceSightingDto[]) => {
    if (!faceIds.includes(faceId)) {
      return;
    }
    sightings = [...sightings.filter((sighting) => sighting.faceId !== faceId), ...forFace(faceId, list)].sort(
      (a, b) => a.time - b.time,
    );
  };

  const sightingsPerFace = $derived.by(() => {
    const counts = new SvelteMap<string, number>();
    for (const { faceId } of sightings) {
      counts.set(faceId, (counts.get(faceId) ?? 0) + 1);
    }
    return counts;
  });

  const restore = async (faceId: string, time: number) => {
    try {
      const response = await restoreAssetFaceSighting({ id: faceId, time });
      replaceFace(faceId, response.sightings);
    } catch (error) {
      handleError(error, $t('video_face_sighting_restore_failed'));
    }
  };

  const remove = async ({ faceId, time, key }: Sighting) => {
    try {
      const response = await removeAssetFaceSighting({ id: faceId, time });
      if (activeKey === key) {
        activeKey = undefined;
        videoFaceBox.clear();
      }
      replaceFace(faceId, response.sightings);
    } catch (error) {
      handleError(error, $t('video_face_sighting_remove_failed'));
      return;
    }

    toastManager.primary(
      {
        description: $t('video_face_sighting_removed'),
        button: { label: $t('undo'), color: 'secondary', onclick: () => restore(faceId, time) },
      },
      { timeout: 5000 },
    );
  };

  $effect(() => {
    const ids = [...faceIds];
    const controller = new AbortController();
    sightings = [];
    loaded = false;
    activeKey = undefined;
    void Promise.all(ids.map((id) => load(id, controller.signal))).then((lists) => {
      if (!controller.signal.aborted) {
        sightings = lists.flat().sort((a, b) => a.time - b.time);
        loaded = true;
      }
    });
    return () => {
      controller.abort();
      // The box belongs to this strip, so it goes with it.
      videoFaceBox.clear();
    };
  });

  const thumbnailUrl = ({ faceId, time }: Sighting) =>
    createUrl(`/faces/${faceId}/sightings/thumbnail`, { ...authManager.params, time });

  const show = ({ time, box, key }: Sighting) => {
    if (seekViewerVideo(time, box)) {
      activeKey = key;
    }
  };
</script>

{#if sightings.length > 0}
  <div class="mb-4" data-testid="video-face-sightings">
    <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">
      {$t('video_face_sightings_count', { values: { count: sightings.length } })}
    </p>
    <div class="flex gap-2 overflow-x-auto pb-2">
      {#each sightings as sighting (sighting.key)}
        {@const label = formatSightingTime(sighting.time)}
        <div class="relative shrink-0">
          <button
            type="button"
            class="relative rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={$t('video_face_sightings_show_at', { values: { time: label } })}
            aria-pressed={activeKey === sighting.key}
            onclick={() => show(sighting)}
          >
            <img
              src={thumbnailUrl(sighting)}
              alt=""
              loading="lazy"
              draggable="false"
              class="size-16 rounded-lg bg-gray-200 object-cover dark:bg-gray-700 {activeKey === sighting.key
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
          {#if canRemove && (sightingsPerFace.get(sighting.faceId) ?? 0) > 1}
            <button
              type="button"
              class="absolute inset-s-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-primary"
              aria-label={$t('video_face_sighting_remove', { values: { time: label } })}
              title={$t('video_face_sighting_remove', { values: { time: label } })}
              onclick={() => remove(sighting)}
              data-testid="remove-sighting"
            >
              <Icon icon={mdiTrashCanOutline} size="12" />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{:else if loaded && empty}
  {@render empty()}
{/if}
