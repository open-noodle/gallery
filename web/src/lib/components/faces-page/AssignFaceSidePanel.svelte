<script lang="ts">
  import PersonPickerGrid, { type PickerCandidate } from '$lib/components/faces-page/PersonPickerGrid.svelte';
  import SearchPeople from '$lib/components/faces-page/PeopleSearch.svelte';
  import { timeBeforeShowLoadingSpinner } from '$lib/constants';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { getPeopleThumbnailUrl, handlePromiseError } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { zoomImageToBase64 } from '$lib/utils/people-utils';
  import { getPersonNameWithHiddenValue } from '$lib/utils/person';
  import { AssetTypeEnum, getAllPeople, type AssetFaceResponseDto, type PersonResponseDto } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiArrowLeftThin, mdiClose, mdiMagnify, mdiPlus } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { linear } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';

  interface Props {
    editedFace: AssetFaceResponseDto;
    assetId: string;
    assetType: AssetTypeEnum;
    onClose: () => void;
    onCreatePerson: (featurePhoto: string | null) => void;
    onReassign: (person: PersonResponseDto) => void;
  }

  let { editedFace, assetId, assetType, onClose, onCreatePerson, onReassign }: Props = $props();

  let allPeople: PersonResponseDto[] = $state([]);

  let isShowLoadingPeople = $state(false);

  async function loadPeople() {
    const timeout = setTimeout(() => (isShowLoadingPeople = true), timeBeforeShowLoadingSpinner);
    try {
      const { people } = await getAllPeople({ withHidden: true, closestAssetId: editedFace.id });
      allPeople = people;
    } catch (error) {
      handleError(error, $t('errors.cant_get_faces'));
    } finally {
      clearTimeout(timeout);
    }
    isShowLoadingPeople = false;
  }

  // loading spinners
  let isShowLoadingNewPerson = $state(false);
  let isShowLoadingSearch = $state(false);

  // search people
  let searchedPeople: PersonResponseDto[] = $state([]);
  let searchFaces = $state(false);
  let searchName = $state('');

  let showPeople = $derived(searchName ? searchedPeople : allPeople.filter((person) => !person.isHidden));
  let showPeopleCandidates: PickerCandidate[] = $derived(
    showPeople
      .filter((person) => !editedFace.person || person.id !== editedFace.person.id)
      .map((person) => ({
        id: person.id,
        name: person.name,
        isHidden: person.isHidden,
        thumbnailUrl: getPeopleThumbnailUrl(person),
        title: $getPersonNameWithHiddenValue(person.name, person.isHidden),
      })),
  );
  const candidatesById = $derived(new Map(showPeople.map((person) => [person.id, person])));
  const handleSelectCandidate = (candidate: PickerCandidate) => {
    const person = candidatesById.get(candidate.id);
    if (person) {
      onReassign(person);
    }
  };

  onMount(() => {
    handlePromiseError(loadPeople());
  });

  const handleCreatePerson = async () => {
    const timeout = setTimeout(() => (isShowLoadingNewPerson = true), timeBeforeShowLoadingSpinner);

    const newFeaturePhoto = await zoomImageToBase64(editedFace, assetId, assetType, assetViewerManager.imgRef);

    onCreatePerson(newFeaturePhoto);

    clearTimeout(timeout);
    isShowLoadingNewPerson = false;
    onCreatePerson(newFeaturePhoto);
  };
</script>

<section
  transition:fly={{ x: 360, duration: 100, easing: linear }}
  class="absolute top-0 h-full w-90 overflow-x-hidden bg-light p-2 dark:text-immich-dark-fg"
>
  <div class="flex place-items-center justify-between gap-2">
    {#if !searchFaces}
      <div class="flex items-center gap-2">
        <IconButton
          color="secondary"
          variant="ghost"
          shape="round"
          icon={mdiArrowLeftThin}
          aria-label={$t('back')}
          onclick={onClose}
        />
        <p class="flex text-lg text-immich-fg dark:text-immich-dark-fg">{$t('select_face')}</p>
      </div>
      <div class="flex justify-end gap-2">
        <IconButton
          color="secondary"
          variant="ghost"
          shape="round"
          icon={mdiMagnify}
          aria-label={$t('search_for_existing_person')}
          onclick={() => {
            searchFaces = true;
          }}
        />
        {#if !isShowLoadingNewPerson}
          <IconButton
            color="secondary"
            variant="ghost"
            shape="round"
            icon={mdiPlus}
            aria-label={$t('create_new_person')}
            onclick={handleCreatePerson}
          />
        {:else}
          <div class="flex place-content-center place-items-center">
            <LoadingSpinner />
          </div>
        {/if}
      </div>
    {:else}
      <IconButton
        color="secondary"
        variant="ghost"
        shape="round"
        icon={mdiArrowLeftThin}
        aria-label={$t('back')}
        onclick={onClose}
      />
      <div class="flex w-full">
        <SearchPeople
          type="input"
          bind:searchName
          bind:showLoadingSpinner={isShowLoadingSearch}
          bind:searchedPeopleLocal={searchedPeople}
        />
        {#if isShowLoadingSearch}
          <div>
            <LoadingSpinner />
          </div>
        {/if}
      </div>
      <IconButton
        color="secondary"
        variant="ghost"
        shape="round"
        icon={mdiClose}
        aria-label={$t('cancel_search')}
        onclick={() => (searchFaces = false)}
      />
    {/if}
  </div>
  <div class="p-4 text-sm">
    <h2 class="mt-4 mb-8">{$t('all_people')}</h2>
    <PersonPickerGrid
      candidates={showPeopleCandidates}
      isLoading={isShowLoadingPeople}
      emptyLabel={$t('no_people_found')}
      onSelect={handleSelectCandidate}
    />
  </div>
</section>
