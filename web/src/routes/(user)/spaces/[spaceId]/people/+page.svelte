<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { QueryParameter, timeBeforeShowLoadingSpinner } from '$lib/constants';
  import Dropdown from '$lib/elements/Dropdown.svelte';
  import SearchBar from '$lib/elements/SearchBar.svelte';
  import PeopleFaceStatisticsInfo from '$lib/components/people/people-face-statistics-info.svelte';
  import PeopleManagementGrid from '$lib/components/people/people-management-grid.svelte';
  import PeopleMergeSelector from '$lib/components/people/people-merge-selector.svelte';
  import type { ManagedPerson } from '$lib/components/people/people-types';
  import ManageSpacePeopleVisibility from '$lib/components/spaces/manage-space-people-visibility.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import PersonEditBirthDateModal from '$lib/modals/PersonEditBirthDateModal.svelte';
  import { locale, PeopleFilterBy, PeopleSortBy, peopleViewSettings } from '$lib/stores/preferences.store';
  import { createUrl, handlePromiseError } from '$lib/utils';
  import { createCrossOwnerMergeHandlers, runMergeWithCrossOwnerConfirmation } from '$lib/utils/cross-owner-merge';
  import { handleError } from '$lib/utils/handle-error';
  import { clearQueryParam } from '$lib/utils/navigation';
  import { peopleFilterToTypeParam as filterToTypeParam, resolvePeopleFilterBy } from '$lib/utils/people-filter';
  import { sortPeople } from '$lib/utils/people-utils';
  import { formatPeopleHeaderDescription } from '$lib/utils/people-statistics';
  import {
    getSpacePeople,
    getSpacePeopleFaceStatistics,
    getSpacePeopleStatistics,
    mergeSpacePeople,
    SharedSpaceRole,
    updateSpacePerson,
    type SharedSpaceMemberResponseDto,
    type SharedSpacePeopleStatisticsResponseDto,
    type SharedSpacePersonResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { Button, Icon, modalManager, toastManager } from '@immich/ui';
  import {
    mdiAccountGroupOutline,
    mdiAccountMultipleCheckOutline,
    mdiAccountMultipleOutline,
    mdiCalendarEditOutline,
    mdiDotsVertical,
    mdiEyeOffOutline,
    mdiEyeOutline,
    mdiPaw,
    mdiSortAlphabeticalAscending,
    mdiSortNumericDescending,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const PAGE_SIZE = 100;

  const space: SharedSpaceResponseDto = $derived(data.space);
  const members: SharedSpaceMemberResponseDto[] = $derived(data.members);
  let people = $state<SharedSpacePersonResponseDto[]>([]);
  let peopleStatistics = $state<SharedSpacePeopleStatisticsResponseDto | null>(null);
  let loadedSpaceId = $state('');
  let loading = $state(false);
  let hasMore = $state(false);
  let searchName = $state('');
  let statisticsSearchName = $state<string | null>(null);
  let showLoadingSpinner = $state(false);
  let abortController: AbortController | null = null;
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  let selectHidden = $state(false);
  const peopleSortOptions = [PeopleSortBy.PhotoCount, PeopleSortBy.Name];
  const peopleSortIcons: Record<PeopleSortBy, string> = {
    [PeopleSortBy.PhotoCount]: mdiSortNumericDescending,
    [PeopleSortBy.Name]: mdiSortAlphabeticalAscending,
  };
  let peopleSortByNames: Record<PeopleSortBy, string> = $derived({
    [PeopleSortBy.PhotoCount]: $t('sort_people_most_photos'),
    [PeopleSortBy.Name]: $t('name'),
  });
  let peopleSortBy = $derived(
    Object.values(PeopleSortBy).includes($peopleViewSettings.sortBy)
      ? $peopleViewSettings.sortBy
      : PeopleSortBy.PhotoCount,
  );

  // Space People type filter. Server-side rather than a filter over `people`: the tab pages at
  // PAGE_SIZE and pets are a small fraction of a real library, so filtering only what has loaded
  // would show a near-empty grid until scrolled to the end. Mirrors `/people/+page.svelte`.
  const peopleFilterOptions = [PeopleFilterBy.All, PeopleFilterBy.People, PeopleFilterBy.Pets];
  const peopleFilterIcons: Record<PeopleFilterBy, string> = {
    [PeopleFilterBy.All]: mdiAccountGroupOutline,
    [PeopleFilterBy.People]: mdiAccountMultipleOutline,
    [PeopleFilterBy.Pets]: mdiPaw,
  };
  let peopleFilterNames: Record<PeopleFilterBy, string> = $derived({
    [PeopleFilterBy.All]: $t('all'),
    [PeopleFilterBy.People]: $t('people'),
    [PeopleFilterBy.Pets]: $t('pets'),
  });
  let peopleFilterBy = $derived(resolvePeopleFilterBy($peopleViewSettings.filterBy));

  const visiblePeople = $derived(
    sortPeople(
      people.filter((p) => !p.isHidden),
      peopleSortBy,
    ),
  );
  const countVisiblePeople = $derived(peopleStatistics ? peopleStatistics.total - peopleStatistics.hidden : 0);
  // The Pets filter (or People, in a space with only pets) legitimately zeroes countVisiblePeople,
  // visiblePeople and peopleStatistics — none of that means the space itself has no people. Without
  // `peopleFilterBy !== PeopleFilterBy.All` here, a zero-result filter would hide the search bar and
  // both dropdowns, including the filter dropdown itself, trapping the user on the filtered view with
  // no way back to All (S1-style dead end; the filter must stay a fixed three-option control per the
  // design, not one whose shape shifts under the user mid-session).
  const hasSearchablePeople = $derived(
    countVisiblePeople > 0 || visiblePeople.length > 0 || !!searchName.trim() || peopleFilterBy !== PeopleFilterBy.All,
  );
  const activeSearchFilterName = $derived(
    searchName.trim() || ($page.url.searchParams.get(QueryParameter.SEARCHED_PEOPLE) ?? '').trim(),
  );
  const activeStatisticsSearchName = $derived(activeSearchFilterName || null);
  const peopleStatisticsEnabled = $derived(featureFlagsManager.value.peopleStatistics);
  const headerDescription = $derived(
    peopleStatistics
      ? formatPeopleHeaderDescription({
          visiblePeopleCount: countVisiblePeople,
          detectedFaceCount: peopleStatistics.detectedFaceCount,
          locale: $locale,
          faceSingular: $t('face'),
          facePlural: $t('faces'),
          includeFaceCount: peopleStatisticsEnabled,
          showZeroPeople: !!searchName.trim() || (peopleStatisticsEnabled && peopleStatistics.detectedFaceCount > 0),
        })
      : undefined,
  );
  let showFaceStatisticsInfo = $derived(
    peopleStatisticsEnabled &&
      !!peopleStatistics &&
      !!headerDescription &&
      statisticsSearchName === activeStatisticsSearchName,
  );
  let spaceFaceStatisticsCacheKey = $derived(
    `user:${authManager.user.id}:space:${space.id}:people:face-statistics:name=${encodeURIComponent(activeSearchFilterName)}`,
  );
  let allPeople = $state<SharedSpacePersonResponseDto[]>([]);
  let mergingPerson = $state<SharedSpacePersonResponseDto>();
  // Whether the space has any people at all, ignoring the type filter — it gates show/hide access
  // (canManageVisibility below). `peopleStatistics` gets re-fetched WITH the active type filter on
  // every filter/search change, so it legitimately reads 0 under a Pets filter with no pets; that
  // must not take the show/hide screen with it, since it's the one place a misdetected species
  // bucket can be corrected. `load` resolves this, so it is set once and left alone by
  // refreshPeople/searchPeople.
  let hasSpacePeople = $state(false);

  $effect(() => {
    if (data.space.id === loadedSpaceId) {
      return;
    }

    people = data.people;
    peopleStatistics = data.peopleStatistics;
    hasSpacePeople = data.hasSpacePeople;
    statisticsSearchName = null;
    hasMore = data.people.length >= PAGE_SIZE;
    mergingPerson = undefined;
    loadedSpaceId = data.space.id;
  });

  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isOwner = $derived(currentMember?.role === SharedSpaceRole.Owner);
  const isEditor = $derived(isOwner || currentMember?.role === SharedSpaceRole.Editor);
  const canManageVisibility = $derived(isEditor && hasSpacePeople);

  onMount(() => {
    const searchedPeople = $page.url.searchParams.get(QueryParameter.SEARCHED_PEOPLE);
    if (searchedPeople) {
      searchName = searchedPeople;
      handlePromiseError(searchPeople(searchedPeople));
    }
  });

  const getThumbUrl = (person: SharedSpacePersonResponseDto): string => {
    return createUrl(`/shared-spaces/${space.id}/people/${person.id}/thumbnail`, { updatedAt: person.updatedAt });
  };

  const toManagedPerson = (person: SharedSpacePersonResponseDto): ManagedPerson => ({
    id: person.id,
    displayName: person.name || '',
    canonicalName: person.name,
    thumbnailUrl: getThumbUrl(person),
    href: `/spaces/${space.id}/people/${person.id}`,
    isHidden: person.isHidden,
    type: person.type,
    assetCount: person.assetCount,
    faceCount: person.faceCount,
  });

  const getPeopleQuery = (
    query: { limit?: number; offset?: number; withHidden?: boolean } = {},
    searchFilter = searchName,
    spaceId = space.id,
  ) => {
    const name = searchFilter.trim();
    const type = filterToTypeParam(peopleFilterBy);
    return { id: spaceId, ...(name && { name }), ...(type && { $type: type }), ...query };
  };

  // Shared by TWO endpoints — getSpacePeopleStatistics and getSpacePeopleFaceStatistics. Do NOT
  // add the type filter here: face statistics deliberately stay whole-space and ignore it. Add
  // `$type` at the getSpacePeopleStatistics call sites only.
  const getStatisticsQuery = (searchFilter = searchName, spaceId = space.id) => {
    const name = searchFilter.trim();
    return { id: spaceId, ...(name && { name }) };
  };

  const statisticsScopeMatches = (spaceId: string, searchFilter: string) =>
    space.id === spaceId && activeStatisticsSearchName === (searchFilter.trim() || null);

  const loadSpaceFaceStatistics = () => getSpacePeopleFaceStatistics(getStatisticsQuery(statisticsSearchName ?? ''));

  const cancelSearchRequest = () => {
    abortController?.abort();
    abortController = null;
    showLoadingSpinner = false;

    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }
  };

  async function updateSearchQueryParam() {
    const currentSearch = $page.url.searchParams.get(QueryParameter.SEARCHED_PEOPLE) ?? '';
    if (currentSearch === searchName) {
      return;
    }

    if (searchName) {
      $page.url.searchParams.set(QueryParameter.SEARCHED_PEOPLE, searchName);
    } else {
      $page.url.searchParams.delete(QueryParameter.SEARCHED_PEOPLE);
    }

    await goto($page.url, { keepFocus: true });
  }

  async function refreshPeople() {
    const requestSpaceId = space.id;
    const requestSearchName = searchName.trim();
    const type = filterToTypeParam(peopleFilterBy);
    try {
      const [newPeople, newStatistics] = await Promise.all([
        getSpacePeople(getPeopleQuery({ limit: PAGE_SIZE }, requestSearchName, requestSpaceId)),
        getSpacePeopleStatistics({
          ...getStatisticsQuery(requestSearchName, requestSpaceId),
          ...(type && { $type: type }),
        }).catch((error) => {
          if (statisticsScopeMatches(requestSpaceId, requestSearchName)) {
            handleError(error, $t('spaces_error_loading_people'));
          }
          return null;
        }),
      ]);

      if (!statisticsScopeMatches(requestSpaceId, requestSearchName)) {
        return;
      }

      people = newPeople;
      peopleStatistics = newStatistics;
      statisticsSearchName = requestSearchName || null;
      hasMore = people.length >= PAGE_SIZE;
    } catch (error) {
      if (statisticsScopeMatches(requestSpaceId, requestSearchName)) {
        handleError(error, $t('spaces_error_loading_people'));
      }
    }
  }

  async function searchPeople(name?: string) {
    searchName = name ?? searchName;
    await updateSearchQueryParam();

    const requestSpaceId = space.id;
    const requestSearchName = searchName.trim();
    if (!requestSearchName) {
      cancelSearchRequest();
      await refreshPeople();
      return;
    }

    cancelSearchRequest();
    const controller = new AbortController();
    abortController = controller;
    searchTimeout = setTimeout(() => (showLoadingSpinner = true), timeBeforeShowLoadingSpinner);
    const type = filterToTypeParam(peopleFilterBy);

    try {
      const [newPeople, newStatistics] = await Promise.all([
        getSpacePeople(getPeopleQuery({ limit: PAGE_SIZE }, requestSearchName, requestSpaceId), {
          signal: controller.signal,
        }),
        getSpacePeopleStatistics(
          { ...getStatisticsQuery(requestSearchName, requestSpaceId), ...(type && { $type: type }) },
          { signal: controller.signal },
        ).catch((error) => {
          if (!controller.signal.aborted && statisticsScopeMatches(requestSpaceId, requestSearchName)) {
            handleError(error, $t('spaces_error_loading_people'));
          }
          return null;
        }),
      ]);

      if (abortController !== controller || !statisticsScopeMatches(requestSpaceId, requestSearchName)) {
        return;
      }

      people = newPeople;
      peopleStatistics = newStatistics;
      statisticsSearchName = requestSearchName || null;
      hasMore = people.length >= PAGE_SIZE;
    } catch (error) {
      if (controller.signal.aborted || !statisticsScopeMatches(requestSpaceId, requestSearchName)) {
        return;
      }
      handleError(error, $t('spaces_error_loading_people'));
    } finally {
      if (abortController === controller) {
        abortController = null;
        showLoadingSpinner = false;
      }
      if (searchTimeout) {
        clearTimeout(searchTimeout);
        searchTimeout = null;
      }
    }
  }

  async function onResetSearchBar() {
    searchName = '';
    cancelSearchRequest();
    await clearQueryParam(QueryParameter.SEARCHED_PEOPLE, $page.url);
    await refreshPeople();
  }

  async function handleFilterChange(filterBy: PeopleFilterBy) {
    $peopleViewSettings.filterBy = filterBy;
    // Cancel any in-flight search request first: without this, a request outstanding when the
    // filter dropdown is used resolves against the pre-filter abortController/statisticsScopeMatches
    // and overwrites `people` with the pre-filter list (mirrors onResetSearchBar above).
    cancelSearchRequest();
    // refreshPeople re-fetches from offset 0, so switching filters replaces the loaded list
    // rather than appending onto it, and carries the active search along.
    await refreshPeople();
  }

  async function loadMore() {
    if (loading || !hasMore) {
      return;
    }
    loading = true;
    try {
      const more = await getSpacePeople(getPeopleQuery({ limit: PAGE_SIZE, offset: people.length }));
      people = [...people, ...more];
      hasMore = more.length >= PAGE_SIZE;
    } catch (error) {
      handleError(error, $t('spaces_error_loading_people'));
    } finally {
      loading = false;
    }
  }

  async function openVisibilityModal() {
    try {
      allPeople = await getSpacePeople({ id: space.id, withHidden: true, limit: PAGE_SIZE });
    } catch (error) {
      handleError(error, $t('spaces_error_loading_people'));
      return;
    }
    hasMoreVisibility = allPeople.length >= PAGE_SIZE;
    selectHidden = true;
  }

  let hasMoreVisibility = $state(false);
  let loadingVisibility = $state(false);

  async function loadMoreVisibility() {
    if (loadingVisibility || !hasMoreVisibility) {
      return;
    }
    loadingVisibility = true;
    try {
      const more = await getSpacePeople({
        id: space.id,
        withHidden: true,
        limit: PAGE_SIZE,
        offset: allPeople.length,
      });
      allPeople = [...allPeople, ...more];
      hasMoreVisibility = more.length >= PAGE_SIZE;
    } catch (error) {
      handleError(error, $t('spaces_error_loading_people'));
    } finally {
      loadingVisibility = false;
    }
  }

  const onNameSubmit = async (name: string, person: SharedSpacePersonResponseDto) => {
    try {
      if (name === person.name) {
        return;
      }
      const updatedPerson = await updateSpacePerson({
        id: space.id,
        personId: person.id,
        sharedSpacePersonUpdateDto: { name },
      });
      people = people.map((currentPerson) =>
        currentPerson.id === person.id
          ? { ...currentPerson, ...updatedPerson, name: updatedPerson.name ?? name }
          : currentPerson,
      );
    } catch (error) {
      handleError(error, $t('errors.unable_to_save_name'));
    }
  };

  const getMergeDisplayName = (person: SharedSpacePersonResponseDto) => person.name || '';

  const loadMergePeople = async () => {
    return getSpacePeople({ id: space.id, limit: PAGE_SIZE });
  };

  const mergePeople = async (
    targetPerson: SharedSpacePersonResponseDto,
    selectedPeople: SharedSpacePersonResponseDto[],
  ) => {
    const committed = await runMergeWithCrossOwnerConfirmation(
      (confirmCrossOwner) =>
        mergeSpacePeople({
          id: space.id,
          personId: targetPerson.id,
          sharedSpacePersonMergeDto: confirmCrossOwner
            ? { ids: selectedPeople.map(({ id }) => id), confirmCrossOwner: true }
            : { ids: selectedPeople.map(({ id }) => id) },
        }),
      createCrossOwnerMergeHandlers(),
    );
    if (!committed) {
      // Cross-owner merge was blocked or the user declined the confirmation — nothing merged.
      return;
    }

    toastManager.success($t('spaces_people_merged'));
    return targetPerson;
  };

  async function handleMergeComplete() {
    mergingPerson = undefined;
    await refreshPeople();
  }

  async function openBirthDateModal(selectedPerson: SharedSpacePersonResponseDto) {
    const person = people.find(({ id }) => id === selectedPerson.id) ?? selectedPerson;
    await modalManager.show(PersonEditBirthDateModal, {
      birthDate: person.birthDate,
      onSave: async (birthDate) => {
        try {
          const updatedPerson = await updateSpacePerson({
            id: space.id,
            personId: person.id,
            sharedSpacePersonUpdateDto: { birthDate },
          });
          const savedPerson = { ...person, ...updatedPerson, birthDate: updatedPerson.birthDate ?? birthDate };
          people = people.map((currentPerson) => (currentPerson.id === person.id ? savedPerson : currentPerson));
          toastManager.success($t('date_of_birth_saved'));
          return true;
        } catch (error) {
          handleError(error, $t('errors.unable_to_save_date_of_birth'));
          return false;
        }
      },
    });
  }

  async function handleHide(person: SharedSpacePersonResponseDto) {
    try {
      await updateSpacePerson({
        id: space.id,
        personId: person.id,
        sharedSpacePersonUpdateDto: { isHidden: true },
      });
      const idx = people.findIndex((p) => p.id === person.id);
      if (idx !== -1) {
        people[idx] = { ...people[idx], isHidden: true };
      }
      if (peopleStatistics) {
        peopleStatistics = { ...peopleStatistics, hidden: peopleStatistics.hidden + 1 };
      }
      toastManager.primary($t('changed_visibility_successfully'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_hide_person'));
    }
  }
</script>

<div class="flex h-full flex-col">
  {#if headerDescription || hasSearchablePeople || canManageVisibility}
    <div class="flex items-center justify-between gap-2 px-4 py-2">
      {#if headerDescription}
        <div class="flex min-w-0 items-center gap-1">
          <p class="truncate text-sm text-gray-500" data-testid="space-people-heading-description">
            {headerDescription}
          </p>
          {#if showFaceStatisticsInfo}
            <PeopleFaceStatisticsInfo cacheKey={spaceFaceStatisticsCacheKey} loadStatistics={loadSpaceFaceStatistics} />
          {/if}
        </div>
      {:else}
        <div></div>
      {/if}
      {#if hasSearchablePeople || canManageVisibility}
        <div class="flex shrink-0 items-center justify-center gap-2">
          {#if hasSearchablePeople}
            <div class="hidden sm:block">
              <div class="h-10 w-40 lg:w-80">
                <SearchBar
                  bind:name={searchName}
                  {showLoadingSpinner}
                  placeholder={$t('search_people')}
                  onReset={() => void onResetSearchBar()}
                  onSearch={() => void searchPeople()}
                />
              </div>
            </div>
            <Dropdown
              title={$t('filter_people_by')}
              options={peopleFilterOptions}
              selectedOption={peopleFilterBy}
              onSelect={(filterBy) => handlePromiseError(handleFilterChange(filterBy))}
              render={(filterBy) => ({ title: peopleFilterNames[filterBy], icon: peopleFilterIcons[filterBy] })}
            />
            <Dropdown
              title={$t('sort_people_by')}
              options={peopleSortOptions}
              selectedOption={peopleSortBy}
              onSelect={(sortBy) => ($peopleViewSettings.sortBy = sortBy)}
              render={(sortBy) => ({ title: peopleSortByNames[sortBy], icon: peopleSortIcons[sortBy] })}
            />
          {/if}
          {#if canManageVisibility}
            <Button
              leadingIcon={mdiEyeOutline}
              onclick={openVisibilityModal}
              size="small"
              variant="ghost"
              color="secondary">{$t('show_and_hide_people')}</Button
            >
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if visiblePeople.length === 0}
    <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
      <div class="flex flex-col content-center items-center text-center">
        <Icon icon={mdiAccountGroupOutline} size="3.5em" />
        <p class="mt-5 text-lg text-gray-500 dark:text-gray-400">
          {$t(searchName ? 'search_no_people_named' : 'spaces_no_people', { values: { name: searchName } })}
        </p>
        {#if !searchName}
          <p class="mt-1 text-sm text-gray-400 dark:text-gray-500">
            {$t('spaces_no_people_description')}
          </p>
        {/if}
      </div>
    </div>
  {:else}
    <div class="px-4 pt-4">
      <PeopleManagementGrid
        people={visiblePeople}
        {toManagedPerson}
        gridClass="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
        hasNextPage={hasMore}
        {loading}
        loadNextPage={loadMore}
        canEditNames={isEditor}
        canShowActions={isEditor}
        {onNameSubmit}
      >
        {#snippet actions(person)}
          <ButtonContextMenu
            buttonClass="icon-white-drop-shadow"
            color="secondary"
            size="medium"
            variant="filled"
            icon={mdiDotsVertical}
            title={$t('show_person_options')}
          >
            <MenuOption
              onClick={() => void openBirthDateModal(person)}
              icon={mdiCalendarEditOutline}
              text={$t('set_date_of_birth')}
            />
            <MenuOption onClick={() => handleHide(person)} icon={mdiEyeOffOutline} text={$t('hide_person')} />
            <MenuOption
              onClick={() => (mergingPerson = person)}
              icon={mdiAccountMultipleCheckOutline}
              text={$t('merge_people')}
            />
          </ButtonContextMenu>
        {/snippet}
      </PeopleManagementGrid>
    </div>
  {/if}

  {#if mergingPerson}
    <PeopleMergeSelector
      person={mergingPerson}
      getDisplayName={getMergeDisplayName}
      getThumbnailUrl={getThumbUrl}
      loadPeople={loadMergePeople}
      {mergePeople}
      onBack={() => (mergingPerson = undefined)}
      onMerge={() => void handleMergeComplete()}
      showSimilaritySort={false}
      loadErrorMessage={$t('spaces_error_loading_people')}
      mergeErrorMessage={$t('spaces_error_merging_people')}
    />
  {/if}
</div>

{#if selectHidden}
  <dialog
    transition:fly={{ y: 500, duration: 150, easing: quintOut, opacity: 0 }}
    class="fixed inset-0 size-full max-h-none max-w-none bg-light"
    aria-labelledby="manage-visibility-title"
    {@attach (dialog) => dialog.showModal()}
  >
    <ManageSpacePeopleVisibility
      people={allPeople}
      spaceId={space.id}
      onClose={() => (selectHidden = false)}
      onUpdate={() => refreshPeople()}
      hasMore={hasMoreVisibility}
      loading={loadingVisibility}
      onLoadMore={loadMoreVisibility}
    />
  </dialog>
{/if}
