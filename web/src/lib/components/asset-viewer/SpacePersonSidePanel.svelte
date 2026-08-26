<script lang="ts">
  import { shortcut } from '$lib/actions/shortcut';
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import PersonPickerGrid, { type PickerCandidate } from '$lib/components/faces-page/PersonPickerGrid.svelte';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import { appendUniqueById, getSpacePersonThumbnailUrl, zoomImageToBase64 } from '$lib/utils/people-utils';
  import {
    attachSpacePersonFace,
    createSpacePerson,
    deleteSpaceAssetFace,
    detachSpacePersonFace,
    getSpaceAssetFaces,
    getSpacePeople,
    type AssetTypeEnum,
    type SharedSpacePersonResponseDto,
    type SpaceAssetFaceResponseDto,
  } from '@immich/sdk';
  import { Button, IconButton, Input } from '@immich/ui';
  import { mdiArrowLeftThin, mdiCloseCircle, mdiPencil, mdiTrashCan } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { linear } from 'svelte/easing';
  import { fly } from 'svelte/transition';

  /**
   * The space-flavoured sibling of `PersonSidePanel.svelte` (Slice 8, Task 2). Same job -- name an
   * unrecognised face, correct a wrong one -- routed to the shared-space endpoints (spec §6.1-6.4)
   * instead of the owner-only person/face endpoints. Unlike the owner panel, every action here is
   * immediate (PUT/DELETE), not a batched "Done" -- the space endpoints are already transactional
   * per action, so there is nothing to defer.
   */
  interface Props {
    spaceId: string;
    assetId: string;
    assetType: AssetTypeEnum;
    onClose: () => void;
    onRefresh: () => void;
  }

  let { spaceId, assetId, assetType, onClose, onRefresh }: Props = $props();

  let faces: SpaceAssetFaceResponseDto[] | undefined = $state();
  let loadError = $state(false);

  let pickerFaceId: string | undefined = $state();
  let spaceCandidates: SharedSpacePersonResponseDto[] = $state([]);
  let candidatesLoaded = $state(false);
  let isLoadingCandidates = $state(false);
  let newPersonName = $state('');
  let isSavingNewPerson = $state(false);

  const thumbnailWidth = '90px';

  const loadFaces = async () => {
    try {
      // Deduped on the way in, though the read returns one row per face: a repeated id throws
      // `each_key_duplicate` in the keyed block below, and Svelte abandons the branch swap when it
      // does -- stranding this panel on its loading spinner, with no error and no way back, which
      // is how a face named in a second space presented in the field (#992). See appendUniqueById,
      // written for the same failure mode on the people grid.
      faces = appendUniqueById([], await getSpaceAssetFaces({ id: spaceId, assetId }));
    } catch (error) {
      handleError(error, $t('errors.cant_get_faces'));
      loadError = true;
    }
  };

  onMount(() => {
    void loadFaces();
  });

  const loadCandidatesOnce = async () => {
    if (candidatesLoaded) {
      return;
    }
    isLoadingCandidates = true;
    try {
      spaceCandidates = await getSpacePeople({ id: spaceId, withHidden: false });
      candidatesLoaded = true;
    } catch (error) {
      handleError(error, $t('errors.cant_get_faces'));
    } finally {
      isLoadingCandidates = false;
    }
  };

  const openPicker = (faceId: string) => {
    pickerFaceId = faceId;
    newPersonName = '';
    void loadCandidatesOnce();
  };

  const closePicker = () => {
    pickerFaceId = undefined;
    newPersonName = '';
  };

  const updateFaceRow = (assetFaceId: string, spacePersonId: string | null, spacePersonName: string | null) => {
    faces = faces?.map((f) => (f.id === assetFaceId ? { ...f, spacePersonId, spacePersonName } : f));
  };

  const attachToPerson = async (face: SpaceAssetFaceResponseDto, candidate: PickerCandidate) => {
    try {
      await attachSpacePersonFace({ id: spaceId, personId: candidate.id, assetFaceId: face.id });
      updateFaceRow(face.id, candidate.id, candidate.name);
      closePicker();
      onRefresh();
    } catch (error) {
      handleError(error, $t('errors.cant_apply_changes'));
    }
  };

  const createAndAttach = async (face: SpaceAssetFaceResponseDto) => {
    const name = newPersonName.trim();
    if (!name) {
      return;
    }
    isSavingNewPerson = true;
    try {
      const person = await createSpacePerson({
        id: spaceId,
        sharedSpacePersonCreateDto: { name, assetFaceId: face.id },
      });
      updateFaceRow(face.id, person.id, person.name);
      closePicker();
      onRefresh();
    } catch (error) {
      handleError(error, $t('errors.cant_apply_changes'));
    } finally {
      isSavingNewPerson = false;
    }
  };

  const detach = async (face: SpaceAssetFaceResponseDto) => {
    if (!face.spacePersonId) {
      return;
    }
    try {
      await detachSpacePersonFace({ id: spaceId, personId: face.spacePersonId, assetFaceId: face.id });
      updateFaceRow(face.id, null, null);
      onRefresh();
    } catch (error) {
      handleError(error, $t('errors.cant_apply_changes'));
    }
  };

  // Spec §6.6 (Slice 9): deletes the box outright -- unlike `detach` above (which only removes
  // this space's projection row and leaves the box itself intact), this destroys the row for
  // every space holding it. Only offered when `face.isEditorDrawn` -- the server refuses this for
  // a detected face regardless, but the control must never be offered for one.
  const deleteFace = async (face: SpaceAssetFaceResponseDto) => {
    try {
      await deleteSpaceAssetFace({ id: spaceId, assetFaceId: face.id });
      faces = faces?.filter((f) => f.id !== face.id);
      onRefresh();
    } catch (error) {
      handleError(error, $t('errors.cant_apply_changes'));
    }
  };

  let pickerCandidates: PickerCandidate[] = $derived(
    spaceCandidates.map((person) => ({
      id: person.id,
      name: person.name,
      isHidden: person.isHidden,
      thumbnailUrl: getSpacePersonThumbnailUrl(spaceId, person.id, person.updatedAt),
    })),
  );
</script>

<svelte:document
  use:shortcut={{ shortcut: { key: 'Escape' }, onShortcut: () => (pickerFaceId ? closePicker() : onClose()) }}
/>

<section
  transition:fly={{ x: 360, duration: 100, easing: linear }}
  class="absolute top-0 h-full w-90 overflow-x-hidden bg-light p-2 dark:text-immich-dark-fg"
>
  <div class="flex place-items-center gap-2">
    <IconButton
      shape="round"
      color="secondary"
      variant="ghost"
      icon={mdiArrowLeftThin}
      aria-label={$t('back')}
      onclick={onClose}
    />
    <p class="flex text-lg text-immich-fg dark:text-immich-dark-fg">{$t('edit_faces')}</p>
  </div>

  <div class="p-4 text-sm">
    {#if loadError}
      <div data-testid="space-person-panel-error" role="alert" class="text-center text-danger">
        {$t('errors.something_went_wrong')}
      </div>
    {:else if faces === undefined}
      <div class="flex w-full justify-center">
        <LoadingSpinner />
      </div>
    {:else}
      <div class="mt-4 flex flex-wrap gap-2">
        {#each faces as face (face.id)}
          {@const personName = face.spacePersonName ?? $t('face_unassigned')}
          <div class="relative h-29 w-24">
            <div class="relative">
              {#await zoomImageToBase64(face, assetId, assetType, assetViewerManager.imgRef)}
                <ImageThumbnail
                  curve
                  shadow
                  url="/src/lib/assets/no-thumbnail.png"
                  altText={personName}
                  title={personName}
                  widthStyle={thumbnailWidth}
                  heightStyle={thumbnailWidth}
                />
              {:then data}
                <ImageThumbnail
                  curve
                  shadow
                  url={data ?? '/src/lib/assets/no-thumbnail.png'}
                  altText={personName}
                  title={personName}
                  widthStyle={thumbnailWidth}
                  heightStyle={thumbnailWidth}
                />
              {/await}
            </div>

            <p class="relative mt-1 truncate font-medium" title={personName}>
              <span class={face.spacePersonName ? '' : 'dark:text-gray-500'}>{personName}</span>
            </p>

            <div class="absolute inset-e-[-3px] top-[-3px] size-5 rounded-full">
              <IconButton
                shape="round"
                color="primary"
                icon={mdiPencil}
                aria-label={$t('select_new_face')}
                size="small"
                class="absolute inset-s-1/2 top-1/2 translate-[-50%] transform"
                onclick={() => openPicker(face.id)}
              />
            </div>
            {#if face.spacePersonId}
              <div class="absolute inset-e-[-3px] top-8 size-5 rounded-full">
                <IconButton
                  shape="round"
                  color="danger"
                  icon={mdiCloseCircle}
                  aria-label={$t('unassign_face')}
                  size="small"
                  class="absolute inset-s-1/2 top-1/2 translate-[-50%] transform"
                  onclick={() => detach(face)}
                />
              </div>
            {/if}
            {#if face.isEditorDrawn}
              <div class="absolute inset-e-[-3px] top-16 size-5 rounded-full">
                <IconButton
                  shape="round"
                  color="danger"
                  icon={mdiTrashCan}
                  aria-label={$t('delete_face')}
                  size="small"
                  class="absolute inset-s-1/2 top-1/2 translate-[-50%] transform"
                  onclick={() => deleteFace(face)}
                />
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

{#if pickerFaceId && faces}
  {@const activeFace = faces.find((f) => f.id === pickerFaceId)}
  {#if activeFace}
    <section
      transition:fly={{ x: 360, duration: 100, easing: linear }}
      class="absolute top-0 h-full w-90 overflow-x-hidden bg-light p-2 dark:text-immich-dark-fg"
    >
      <div class="flex place-items-center gap-2">
        <IconButton
          shape="round"
          color="secondary"
          variant="ghost"
          icon={mdiArrowLeftThin}
          aria-label={$t('back')}
          onclick={closePicker}
        />
        <p class="flex text-lg text-immich-fg dark:text-immich-dark-fg">{$t('select_face')}</p>
      </div>
      <div class="p-4 text-sm">
        <div class="mb-4 flex gap-2">
          <Input placeholder={$t('create_person')} bind:value={newPersonName} size="tiny" />
          <Button
            size="small"
            disabled={!newPersonName.trim() || isSavingNewPerson}
            onclick={() => createAndAttach(activeFace)}
          >
            {$t('create_person')}
          </Button>
        </div>
        <h2 class="mt-4 mb-8">{$t('all_people')}</h2>
        <PersonPickerGrid
          candidates={pickerCandidates}
          isLoading={isLoadingCandidates}
          emptyLabel={$t('no_people_found')}
          onSelect={(candidate) => attachToPerson(activeFace, candidate)}
        />
      </div>
    </section>
  {/if}
{/if}
