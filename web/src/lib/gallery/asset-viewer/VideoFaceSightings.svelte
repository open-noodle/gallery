<script lang="ts">
  import ButtonContextMenu from '#lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '#lib/components/shared-components/context-menu/MenuOption.svelte';
  import { videoFaceBox } from '#lib/gallery/asset-viewer/video-face-box.svelte.ts';
  import { formatSightingTime, seekViewerVideo } from '#lib/gallery/asset-viewer/video-seek.ts';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import PeoplePickerModal from '#lib/modals/PeoplePickerModal.svelte';
  import { faceManager } from '#lib/stores/face.svelte.ts';
  import { createUrl } from '#lib/utils.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import {
    createPerson,
    deleteFace,
    getAssetFaceSightings,
    isHttpError,
    moveAssetFaceSighting,
    reassignFacesById,
    removeAssetFaceSighting,
    restoreAssetFaceSighting,
    splitAssetFaceSighting,
    type VideoFaceSightingDto,
    type VideoFaceSightingMoveResponseDto,
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
  import { t } from 'svelte-i18n';
  import { SvelteMap } from 'svelte/reactivity';

  /**
  Every moment a video face's person was seen, as crops in time order; a click pauses the viewer's video there, with
  a box around the face (specs/2026-10-31-video-face-frames-design.md, Phase 2). Given several faces (one person
  tracked more than once in the video), it lists all their moments together. Renders nothing, or `empty` once loaded,
  for faces with no sightings, on any error, and against a server without the route, so the picker looks as it did
  before. With `canEdit` (the asset's owner), each moment of a face that has more than one gets a menu that moves it
  to another person, a new person or unassigned (a face of its own), or takes it out of the face, each with a few
  seconds to undo it; taking out the best view makes the next best one it. A face's only moment is the whole face:
  given `personId`, its menu moves the face to another or a new person (undone by giving it back) or deletes it. A
  move to a person who already has a face in this video joins that face.
  */
  interface Props {
    faceIds: string[];
    empty?: Snippet;
    canEdit?: boolean;
    /**
    The person the faces belong to: left out of the people a moment can move to, and where a whole face goes back to
    on undo. Without it a face's only moment has no menu (the picker, which is already naming that face).
    */
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

  // One star per strip: with several faces (one person tracked twice, or moments moved to them one by one), each face
  // has a best view, and the strip stars the one the detector was surest of.
  const starredKey = $derived.by(() => {
    let top: Sighting | undefined;
    for (const sighting of sightings) {
      if (sighting.isBest && (!top || sighting.score > top.score)) {
        top = sighting;
      }
    }
    return top?.key;
  });

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
      {
        description,
        // Closes on click, so an undo cannot be sent twice.
        button: (close) => ({
          label: $t('undo'),
          color: 'secondary',
          onclick: () => {
            close();
            return undo();
          },
        }),
      },
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
  Splits the moment off into a face of its own (unassigned), then gives that face to the target through the same
  reassign the face editor uses. When the reassign fails the moment stays moved, unassigned, and the Undo still
  puts it back.
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

  /** A face this strip no longer shows: moved to someone else, or deleted. */
  const dropFace = (faceId: string, key: string) => {
    takeOut(key);
    replaceFace(faceId, []);
    onFacesChanged?.();
  };

  /** Gives a face's only moment, and so the whole face, to another or a new person; undone by giving it back. */
  const moveFace = async ({ faceId, key }: Sighting, target: Exclude<MoveTarget, { kind: 'unassigned' }>) => {
    const owner = personId;
    if (!owner) {
      return;
    }

    try {
      let id = target.kind === 'person' ? target.id : undefined;
      if (!id) {
        const person = await createPerson({ personCreateDto: {} });
        id = person.id;
      }
      await reassignFacesById({ id, faceDto: { id: faceId } });
    } catch (error) {
      handleError(error, $t('video_face_sighting_move_failed'));
      return;
    }
    dropFace(faceId, key);

    const description =
      target.kind === 'new'
        ? $t('video_face_sighting_moved_new')
        : target.name
          ? $t('video_face_sighting_moved_person', { values: { name: target.name } })
          : $t('video_face_sighting_moved');
    showUndo(description, async () => {
      try {
        await reassignFacesById({ id: owner, faceDto: { id: faceId } });
        const response = await getAssetFaceSightings({ id: faceId });
        replaceFace(faceId, response.sightings);
      } catch (error) {
        handleError(error, $t('video_face_sighting_restore_failed'));
      }
      onFacesChanged?.();
    });
  };

  /** Deletes the face whose only moment this is, as the face editor deletes a face: asked first, with no undo. */
  const deleteWholeFace = async ({ faceId, key }: Sighting) => {
    const confirmed = await modalManager.showDialog({
      prompt: $t('video_face_sighting_delete_face_prompt'),
      confirmText: $t('delete'),
      confirmColor: 'danger',
    });
    if (!confirmed) {
      return;
    }

    try {
      await deleteFace({ id: faceId, assetFaceDeleteDto: { force: false } });
    } catch (error) {
      handleError(error, $t('error_delete_face'));
      return;
    }
    dropFace(faceId, key);
    toastManager.primary($t('video_face_sighting_face_deleted'));
  };

  /**
  Moves the moment into a face the person already has in this video, so they keep one face here instead of gaining
  one per move. When it was the source face's last moment, that face goes, and the undo splits the moment out again
  and gives it back to the strip's person. Undefined when the server refuses the target (a face not sampled from
  the video), for the caller to fall back to a face of the moment's own.
  */
  const joinFace = async (
    { faceId, time, key }: Sighting,
    toFaceId: string,
    target: { name: string },
  ): Promise<boolean | undefined> => {
    let response: VideoFaceSightingMoveResponseDto;
    try {
      response = await moveAssetFaceSighting({ id: faceId, time, toFaceId });
    } catch (error) {
      if (isHttpError(error) && error.status === 400) {
        return;
      }
      handleError(error, $t('video_face_sighting_move_failed'));
      return false;
    }
    takeOut(key);
    replaceFace(faceId, response.sightings);
    replaceFace(toFaceId, response.targetSightings);
    onFacesChanged?.();

    const sourceGone = response.sightings.length === 0;
    const owner = personId;
    showUndo(
      target.name
        ? $t('video_face_sighting_moved_person', { values: { name: target.name } })
        : $t('video_face_sighting_moved'),
      async () => {
        try {
          if (sourceGone) {
            const split = await splitAssetFaceSighting({ id: toFaceId, time });
            if (owner) {
              await reassignFacesById({ id: owner, faceDto: { id: split.faceId } });
            }
          } else {
            const back = await moveAssetFaceSighting({ id: toFaceId, time, toFaceId: faceId });
            replaceFace(faceId, back.targetSightings);
          }
        } catch (error) {
          handleError(error, $t('video_face_sighting_restore_failed'));
        }
        onFacesChanged?.();
      },
    );
    return true;
  };

  /** A face the person already has in this video, other than the ones this strip shows. */
  const faceOf = (person: string) =>
    faceManager.facesByPersonId.get(person)?.find(({ id }) => !faceIds.includes(id))?.id;

  const moveToPerson = async (sighting: Sighting, wholeFace: boolean) => {
    const people = await modalManager.show(PeoplePickerModal, { excludedIds: personId ? [personId] : [] });
    const person = people?.[0];
    if (!person) {
      return;
    }
    const target = { kind: 'person', id: person.id, name: person.name } as const;
    const existing = faceOf(person.id);
    if (existing && (await joinFace(sighting, existing, target)) !== undefined) {
      return;
    }
    await (wholeFace ? moveFace(sighting, target) : move(sighting, target));
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
        {const label = $derived(formatSightingTime(sighting.time))}
        {const wholeFace = $derived((sightingsPerFace.get(sighting.faceId) ?? 0) <= 1)}
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
            {#if sighting.key === starredKey}
              <span class="absolute inset-e-1 top-1 rounded-full bg-black/60 p-0.5 text-yellow-300" data-testid="best">
                <Icon icon={mdiStar} size="12" />
              </span>
            {/if}
            <span class="mt-1 block text-center text-xs tabular-nums">{label}</span>
          </button>
          {#if canEdit && (!wholeFace || personId)}
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
                  onClick={() => moveToPerson(sighting, wholeFace)}
                />
                <MenuOption
                  icon={mdiAccountPlusOutline}
                  text={$t('video_face_sighting_move_new')}
                  onClick={() => (wholeFace ? moveFace(sighting, { kind: 'new' }) : move(sighting, { kind: 'new' }))}
                />
                {#if wholeFace}
                  <MenuOption
                    icon={mdiTrashCanOutline}
                    text={$t('video_face_sighting_delete_face')}
                    onClick={() => deleteWholeFace(sighting)}
                  />
                {:else}
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
                {/if}
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
