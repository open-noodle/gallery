<script lang="ts">
  import { type PickerCandidate } from '$lib/components/faces-page/PersonPickerGrid.svelte';
  import PersonPickerPanel from '$lib/components/faces-page/PersonPickerPanel.svelte';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import { maximumLengthSearchPeople, timeBeforeShowLoadingSpinner } from '$lib/constants';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { getPeopleThumbnailUrl, handlePromiseError } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { orderPickerCandidates, zoomImageToBase64 } from '$lib/utils/people-utils';
  import { getPersonNameWithHiddenValue, searchNameLocal } from '$lib/utils/person';
  import {
    AssetTypeEnum,
    getAllPeople,
    searchPerson,
    type AssetFaceResponseDto,
    type PersonResponseDto,
  } from '@immich/sdk';
  import { IconButton } from '@immich/ui';
  import { mdiPlus } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

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

  /**
   * Deliberately WITHOUT upstream's `closestAssetId`.
   *
   * That parameter orders the whole list by how much each person's face resembles the one you
   * tapped. It is a name suggestion, and a good one for the first handful of rows -- but past those
   * it is indistinguishable from random, and a library with several hundred named people is then
   * several hundred rows nobody can scan or scroll to (#992). Dropping it takes `getAllForUser`'s
   * other branch, which sorts named people alphabetically and puts the unnamed clusters after them
   * by face count -- the same order `getPersonsBySpaceId` serves the space picker, and the same one
   * every other people list in the fork already uses. This picker was the sole exception.
   *
   * The resemblance ordering itself stays on the server for the person page's "sort faces" toggle
   * (`closestPersonId`), which opts into it explicitly.
   */
  async function loadPeople() {
    const timeout = setTimeout(() => (isShowLoadingPeople = true), timeBeforeShowLoadingSpinner);
    try {
      const { people } = await getAllPeople({ withHidden: true });
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
  let searchName = $state('');
  let searchAbortController: AbortController | null = null;
  /** The last server response, and the query that produced it — see the short-circuit below. */
  let searchResults: PersonResponseDto[] = [];
  let searchWord = '';

  /**
   * The search used to sit behind a magnifier icon, in a `PeopleSearch` that swapped out the whole
   * header. `PersonPickerPanel` shows the field outright, as the space-flavoured picker always has,
   * so the request is issued from here instead.
   *
   * It goes to the SERVER on purpose: `getAllPeople` above serves one page, so narrowing the loaded
   * list would quietly stop finding anyone past it on a large library.
   *
   * The rest mirrors what `PeopleSearch` did with the response, because dropping any of it would be
   * a silent regression on a path that used to have it: `searchNameLocal` applies the same
   * prefix-and-slice narrowing; the abort stops a slow earlier keystroke landing on top of a later
   * one; and an unsaturated result set is narrowed in place when the query merely grows, so typing a
   * name costs one request rather than one per letter.
   */
  const runSearch = async (query: string) => {
    if (query === '') {
      searchAbortController?.abort();
      searchAbortController = null;
      searchResults = [];
      searchWord = '';
      searchedPeople = [];
      isShowLoadingSearch = false;
      return;
    }

    if (searchResults.length > 0 && searchResults.length < maximumLengthSearchPeople && query.startsWith(searchWord)) {
      searchedPeople = searchNameLocal(query, searchResults, maximumLengthSearchPeople);
      return;
    }

    searchAbortController?.abort();
    const abortController = new AbortController();
    searchAbortController = abortController;
    const timeout = setTimeout(() => (isShowLoadingSearch = true), timeBeforeShowLoadingSpinner);
    try {
      const people = await searchPerson({ name: query }, { signal: abortController.signal });
      searchResults = people;
      searchWord = query;
      searchedPeople = searchNameLocal(query, people, maximumLengthSearchPeople);
    } catch (error) {
      if (!abortController.signal.aborted) {
        handleError(error, $t('errors.cant_search_people'));
      }
    } finally {
      clearTimeout(timeout);
      if (searchAbortController === abortController) {
        searchAbortController = null;
        isShowLoadingSearch = false;
      }
    }
  };

  let showPeople = $derived(searchName ? searchedPeople : allPeople.filter((person) => !person.isHidden));
  let showPeopleCandidates: PickerCandidate[] = $derived(
    orderPickerCandidates(
      showPeople
        .filter((person) => !editedFace.person || person.id !== editedFace.person.id)
        .map((person) => ({
          id: person.id,
          name: person.name,
          isHidden: person.isHidden,
          thumbnailUrl: getPeopleThumbnailUrl(person),
          title: $getPersonNameWithHiddenValue(person.name, person.isHidden),
        })),
    ),
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

<PersonPickerPanel
  candidates={showPeopleCandidates}
  isLoading={isShowLoadingPeople || isShowLoadingSearch}
  emptyLabel={$t('no_people_found')}
  onSelect={handleSelectCandidate}
  {onClose}
  bind:query={searchName}
  onQueryChange={(query) => handlePromiseError(runSearch(query))}
>
  {#snippet headerActions()}
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
  {/snippet}
</PersonPickerPanel>
