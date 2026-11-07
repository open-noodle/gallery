<script lang="ts">
  import { videoFaceBox } from '$lib/gallery/asset-viewer/video-face-box.svelte';
  import { formatSightingTime, seekViewerVideo } from '$lib/gallery/asset-viewer/video-seek';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { createUrl } from '$lib/utils';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import PeoplePickerModal from '$lib/modals/PeoplePickerModal.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import {
    createPerson,
    deleteFace,
    getAssetFaceSightings,
    reassignFacesById,
    removeAssetFaceSighting,
    restoreAssetFaceSighting,
    splitAssetFaceSighting,
    type VideoFaceSightingDto,
  } from '@immich/sdk';
  import { Icon, modalManager, toastManager } from '@immich/ui';
  import {
    mdiAccountArrowRightOutline,
    mdiAccountPlusOutline,
    mdiAccountQuestionOutline,
    mdiDotsVertical,
    mdiStar,
    mdiTrashCanOutline,
  } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';

  /**
   * Every moment a video face's person was seen, as crops in time order; a click pauses the viewer's video there, with
   * a box around the face (specs/2026-10-31-video-face-frames-design.md, Phase 2). Given several faces (one person
   * tracked more than once in the video), it lists all their moments together. Renders nothing, or `empty` once loaded,
   * for faces with no sightings, on any error, and against a server without the route, so the picker looks as it did
   * before. With `canEdit` (the asset's owner), each moment of a face that has more than one gets a menu that moves it
   * to another person, a new person or unassigned (a face of its own), or takes it out of the face, each with a few
   * seconds to undo it; taking out the best view makes the next best one it.
   */
  interface Props {
    faceIds: string[];
    empty?: Snippet;
    canEdit?: boolean;
    /** The person the faces belong to, left out of the people a moment can move to. */
    personId?: string;
    /** After a move or its undo, which add and remove faces on the asset. */
    onFacesChanged?: () => void;
  }

  let { faceIds, empty, canEdit = false, personId, onFacesChanged }: Props = $props();

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

  /** The moment leaves the strip, and the face box with it when it was drawn for it. */
  const takeOut = (key: string) => {
    if (activeKey === key) {
      activeKey = undefined;
      videoFaceBox.clear();
    }
  };

  const showUndo = (description: string, undo: () => Promise<void>) =>
    toastManager.primary(
      { description, button: { label: $t('undo'), color: 'secondary', onclick: undo } },
      { timeout: 5000 },
    );

  const remove = async ({ faceId, time, key }: Sighting) => {
    try {
      const response = await removeAssetFaceSighting({ id: faceId, time });
      takeOut(key);
      replaceFace(faceId, response.sightings);
    } catch (error) {
      handleError(error, $t('video_face_sighting_remove_failed'));
      return;
    }

    showUndo($t('video_face_sighting_removed'), () => restore(faceId, time));
  };

  type MoveTarget = { kind: 'person'; id: string; name: string } | { kind: 'new' } | { kind: 'unassigned' };

  /**
   * Splits the moment off into a face of its own (unassigned), then gives that face to the target through the same
   * reassign the face editor uses. When the reassign fails the moment stays moved, unassigned, and the Undo still
   * puts it back.
   */
  const move = async ({ faceId, time, key }: Sighting, target: MoveTarget) => {
    let newFaceId: string;
    try {
      const response = await splitAssetFaceSighting({ id: faceId, time });
      newFaceId = response.faceId;
      takeOut(key);
      replaceFace(faceId, response.sightings);
    } catch (error) {
      handleError(error, $t('video_face_sighting_move_failed'));
      return;
    }

    let landed = target;
    try {
      if (target.kind === 'person') {
        await reassignFacesById({ id: target.id, faceDto: { id: newFaceId } });
      } else if (target.kind === 'new') {
        const person = await createPerson({ personCreateDto: {} });
        await reassignFacesById({ id: person.id, faceDto: { id: newFaceId } });
      }
    } catch (error) {
      handleError(error, $t('video_face_sighting_move_failed'));
      landed = { kind: 'unassigned' };
    }
    onFacesChanged?.();

    const description =
      landed.kind === 'person'
        ? landed.name
          ? $t('video_face_sighting_moved_person', { values: { name: landed.name } })
          : $t('video_face_sighting_moved')
        : landed.kind === 'new'
          ? $t('video_face_sighting_moved_new')
          : $t('video_face_sighting_moved_unassigned');
    showUndo(description, async () => {
      try {
        await deleteFace({ id: newFaceId, assetFaceDeleteDto: { force: true } });
      } catch (error) {
        handleError(error, $t('video_face_sighting_restore_failed'));
        return;
      }
      await restore(faceId, time);
      onFacesChanged?.();
    });
  };

  const moveToPerson = async (sighting: Sighting) => {
    const people = await modalManager.show(PeoplePickerModal, { excludedIds: personId ? [personId] : [] });
    const person = people?.[0];
    if (person) {
      await move(sighting, { kind: 'person', id: person.id, name: person.name });
    }
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
          {#if canEdit && (sightingsPerFace.get(sighting.faceId) ?? 0) > 1}
            <div class="absolute inset-s-0.5 top-0.5" data-testid="sighting-menu">
              <ButtonContextMenu
                icon={mdiDotsVertical}
                title={$t('video_face_sighting_options')}
                size="tiny"
                color="secondary"
                variant="filled"
                buttonClass="bg-black/60 text-white"
              >
                <MenuOption
                  icon={mdiAccountArrowRightOutline}
                  text={$t('video_face_sighting_move_person')}
                  onClick={() => moveToPerson(sighting)}
                />
                <MenuOption
                  icon={mdiAccountPlusOutline}
                  text={$t('video_face_sighting_move_new')}
                  onClick={() => move(sighting, { kind: 'new' })}
                />
                <MenuOption
                  icon={mdiAccountQuestionOutline}
                  text={$t('video_face_sighting_move_unassigned')}
                  onClick={() => move(sighting, { kind: 'unassigned' })}
                />
                <MenuOption
                  icon={mdiTrashCanOutline}
                  text={$t('video_face_sighting_remove', { values: { time: label } })}
                  onClick={() => remove(sighting)}
                />
              </ButtonContextMenu>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{:else if loaded && empty}
  {@render empty()}
{/if}
