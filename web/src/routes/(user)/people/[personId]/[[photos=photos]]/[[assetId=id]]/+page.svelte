<script lang="ts">
  import { afterNavigate, goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { clickOutside } from '$lib/actions/click-outside';
  import { listNavigation } from '$lib/actions/list-navigation';
  import { scrollMemoryClearer } from '$lib/actions/scroll-memory';
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import TimelineRouteGroupingBar from '$lib/components/timeline/TimelineRouteGroupingBar.svelte';
  import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
  import { PersonPageViewMode, QueryParameter, SessionStorageKey } from '$lib/constants';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
  import PersonMergeSuggestionModal from '$lib/modals/PersonMergeSuggestionModal.svelte';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import MergeFaceSelector from '$lib/gallery/people/MergeFaceSelector.svelte';
  import { getPersonPageActions, isSpaceEditor, updatePersonName } from '$lib/gallery/people/person.service';
  import PersonSuggestions from '$lib/gallery/people/PersonSuggestions.svelte';
  import { getPersonActions } from '$lib/services/person.service';
  import { lang, locale } from '$lib/stores/preferences.store';
  import { loadSpaces } from '$lib/gallery/stores/spaces-cache';
  import { userInteraction } from '$lib/stores/user.svelte';
  import { websocketEvents } from '$lib/stores/websocket';
  import { getPeopleThumbnailUrl } from '$lib/utils';
  import { getGlobalPersonThumbnailUrl } from '$lib/utils/global-person-route';
  import { handleError } from '$lib/utils/handle-error';
  import { normalizeSearchString } from '$lib/utils/string-utils';
  import { timelineGroupingProps } from '$lib/gallery/filtered-timeline/timeline-grouping.svelte';

  import { AssetVisibility, searchPerson, type PersonResponseDto } from '@immich/sdk';
  import {
    ActionButton,
    CommandPaletteDefaultProvider,
    ContextMenuButton,
    LoadingSpinner,
    modalManager,
    toastManager,
    type ActionItem,
  } from '@immich/ui';
  import { mdiAccountMultipleCheckOutline, mdiArrowLeft, mdiDotsVertical } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';
  import EditNameInput from './EditNameInput.svelte';
  import UnmergeFaceSelector from './UnmergeFaceSelector.svelte';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  let person = $derived(data.person);
  let thumbnailData = $derived(getScopedThumbnailUrl(person));

  let timelineManager = $state<TimelineManager>() as TimelineManager;
  const timelineGrouping = timelineGroupingProps(() => timelineManager);
  let numberOfAssets = $derived(timelineManager?.isInitialized ? timelineManager.assetCount : data.statistics.assets);

  const handleAddAllToCollection = () => {
    void modalManager.show(SearchAddAllToCollectionModal, {
      terms: {
        visibility: AssetVisibility.Timeline,
        personIds: [data.person.filterId ?? data.person.id],
        withSharedSpaces: true,
      },
      total: numberOfAssets,
      smartSearchEnabled: false,
      language: $lang,
    });
  };
  const baseTimelineOptions = $derived({
    visibility: AssetVisibility.Timeline,
    personIds: [data.person.filterId ?? data.person.id],
    withPartners: true,
    withSharedSpaces: true,
  });
  const options = $derived({
    ...baseTimelineOptions,
    grouping: timelineGrouping.grouping,
  });

  let viewMode: PersonPageViewMode = $state(PersonPageViewMode.VIEW_ASSETS);
  let isEditingName = $state(false);
  let previousRoute = $state<string>(Route.explore());
  let personMerge1: PersonResponseDto | undefined = $state();
  let personMerge2: PersonResponseDto | undefined = $state();
  let potentialMergePeople: PersonResponseDto[] = $state([]);
  let isSuggestionSelectedByUser = $state(false);

  let personName = $derived(person.name);
  let suggestedPeople: PersonResponseDto[] = $state([]);

  /**
   * Save the word used to search people name: for example,
   * if searching 'r' and the server returns 15 people with names starting with 'r',
   * there's no need to search again people with name starting with 'ri'.
   * However, it needs to make a new api request if searching 'r' returns 20 names (arbitrary value, the limit sent back by the server).
   * or if the new search word starts with another word / letter
   **/
  let isSearchingPeople = $state(false);
  let suggestionContainer: HTMLElement | undefined = $state();

  function getScopedThumbnailUrl(person: PersonResponseDto, updatedAt?: string): string {
    return getGlobalPersonThumbnailUrl(person, { updatedAt });
  }

  onMount(() => {
    const action = $page.url.searchParams.get(QueryParameter.ACTION);

    const fallbackRoute = $page.params.assetId ? Route.viewPerson(data.person) : Route.explore();
    previousRoute = Route.continue($page.url.searchParams.get(QueryParameter.PREVIOUS_ROUTE), fallbackRoute).toString();

    if (action === 'merge') {
      viewMode = PersonPageViewMode.MERGE_PEOPLE;
    }

    return websocketEvents.on('on_person_thumbnail', (personId: string) => {
      if (person.id === personId) {
        thumbnailData = getScopedThumbnailUrl(person, Date.now().toString());
      }
    });
  });

  const handleEscape = async () => {
    if (assetMultiSelectManager.selectionActive) {
      assetMultiSelectManager.clear();
      return;
    }

    await goto(previousRoute);
    return;
  };

  const updateAssetCount = async () => {
    await invalidateAll();
  };

  afterNavigate(({ from }) => {
    // Prevent setting previousRoute to the current page.
    if (from?.url && from.route.id !== $page.route.id) {
      previousRoute = from.url.href;
    }
  });

  const handleUnmerge = () => {
    timelineManager.removeAssets(assetMultiSelectManager.assets.map((a) => a.id));
    assetMultiSelectManager.clear();
    viewMode = PersonPageViewMode.VIEW_ASSETS;
  };

  const handleReassignAssets = () => {
    viewMode = PersonPageViewMode.UNASSIGN_ASSETS;
  };

  const handleMerge = async (person: PersonResponseDto) => {
    await updateAssetCount();
    await handleGoBack();

    data = { ...data, person };
  };

  const handleMergeSuggestion = async (): Promise<{ merged: boolean }> => {
    if (!personMerge1 || !personMerge2) {
      return { merged: false };
    }

    const result = await modalManager.show(PersonMergeSuggestionModal, {
      personToMerge: personMerge1,
      personToBeMergedInto: personMerge2,
      potentialMergePeople,
    });

    if (!result) {
      return { merged: false };
    }

    const [, personToBeMergedInto] = result;

    if (personToBeMergedInto.name !== personName && person.id === personToBeMergedInto.id) {
      await updateAssetCount();
      return { merged: true };
    }
    await goto(Route.viewPerson(personToBeMergedInto), { replaceState: true });
    return { merged: true };
  };

  const handleSuggestPeople = async (person2: PersonResponseDto) => {
    isEditingName = false;
    if (person.id !== person2.id) {
      potentialMergePeople = [];
      personMerge1 = person;
      personMerge2 = person2;
      isSuggestionSelectedByUser = true;

      await handleMergeSuggestion();
    }
  };

  const changeName = async () => {
    viewMode = PersonPageViewMode.VIEW_ASSETS;
    person.name = personName;
    isEditingName = false;

    if (isSuggestionSelectedByUser) {
      // User canceled the merge
      isSuggestionSelectedByUser = false;
      return;
    }

    try {
      person = await updatePersonName(person, personName);
      toastManager.primary($t('change_name_successfully'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_save_name'));
    }
  };

  const handleCancelEditName = () => {
    isSearchingPeople = false;
    isEditingName = false;
  };

  const handleNameChange = async (name: string) => {
    isEditingName = false;
    potentialMergePeople = [];
    personName = name;

    if (person.name === personName) {
      return;
    }
    if (name === '') {
      await changeName();
      return;
    }

    const result = await searchPerson({ name: personName, withHidden: true });

    const normalizedPersonName = normalizeSearchString(personName);
    const existingPerson = result.find(
      ({ name, id }: PersonResponseDto) =>
        normalizeSearchString(name) === normalizedPersonName && id !== person.id && name,
    );
    if (existingPerson) {
      personMerge2 = existingPerson;
      personMerge1 = person;
      potentialMergePeople = result
        .filter(
          (person: PersonResponseDto) =>
            normalizeSearchString(personMerge2?.name ?? '') === normalizeSearchString(person.name) &&
            person.id !== personMerge2?.id &&
            person.id !== personMerge1?.id &&
            !person.isHidden,
        )
        .slice(0, 3);
      const { merged } = await handleMergeSuggestion();
      if (merged) {
        return;
      }
    }
    await changeName();
  };

  const handleGoBack = async () => {
    viewMode = PersonPageViewMode.VIEW_ASSETS;
    if ($page.url.searchParams.has(QueryParameter.ACTION)) {
      $page.url.searchParams.delete(QueryParameter.ACTION);
      await goto($page.url);
    }
  };

  const handleDeleteAssets = async (assetIds: string[]) => {
    timelineManager.removeAssets(assetIds);
    await updateAssetCount();
  };

  const handleUndoDeleteAssets = async (assets: TimelineAsset[]) => {
    timelineManager.upsertAssets(assets);
    await updateAssetCount();
  };

  // Space-person writes need the owner/editor role, read from the spaces list; offered until it says
  // otherwise (the server enforces the role on every write regardless).
  const personSpaceId = $derived(
    person.primaryProfile?.type === 'space-person' ? person.primaryProfile.spaceId : undefined,
  );
  $effect(() => {
    if (personSpaceId) {
      loadSpaces();
    }
  });
  const canEditSpacePerson = $derived(
    !personSpaceId || isSpaceEditor(userInteraction.recentSpaces, personSpaceId, authManager.user.id),
  );

  const handleSetVisibility = (assetIds: string[]) => {
    timelineManager.removeAssets(assetIds);
    assetMultiSelectManager.clear();
  };

  const onPersonUpdate = async (response: PersonResponseDto) => {
    if (response.id !== person.id) {
      return;
    }

    if (response.isHidden) {
      await goto(previousRoute);
      return;
    }

    person = response;
  };

  const handlePersonAssetDelete = async ({ id, assetId }: { id: string; assetId: string }) => {
    if (id !== person.id) {
      return;
    }
    timelineManager.removeAssets([assetId]);
    await updateAssetCount();
  };

  const { SetDateOfBirth, Favorite, Unfavorite, HidePerson, ShowPerson } = $derived(
    getPersonActions($t, person, { canEditSpacePerson }),
  );
  const refreshThumbnail = () => (thumbnailData = getScopedThumbnailUrl(person, Date.now().toString()));
  const { SelectRepresentativeFace, SeparateFromGroupedPerson } = getPersonPageActions($t, {
    getPerson: () => person,
    canEditSpacePerson: () => canEditSpacePerson,
    onPersonUpdate: (updated) => (person = updated),
    onThumbnailUpdate: refreshThumbnail,
  });

  const Merge: ActionItem = {
    title: $t('merge_people'),
    icon: mdiAccountMultipleCheckOutline,
    $if: () => canEditSpacePerson,
    onAction: () => {
      viewMode = PersonPageViewMode.MERGE_PEOPLE;
    },
  };
</script>

<OnEvents
  {onPersonUpdate}
  onPersonAssetDelete={handlePersonAssetDelete}
  onAssetsDelete={updateAssetCount}
  onAssetsArchive={updateAssetCount}
  onAssetsUnarchive={updateAssetCount}
/>

<main
  class="relative z-0 flex h-dvh flex-col overflow-hidden px-2 pt-(--control-bar-height) md:px-6 md:pt-(--control-bar-height-md)"
  use:scrollMemoryClearer={{
    routeStartsWith: Route.people(),
    beforeClear: () => {
      sessionStorage.removeItem(SessionStorageKey.INFINITE_SCROLL_PAGE);
    },
  }}
>
  <!-- Sticky grouping switcher: lives outside the scrolling timeline so it stays visible (see Tags).
       mt-12 clears the taller ControlAppBar, which exceeds the --control-bar-height padding reserve. -->
  <TimelineRouteGroupingBar
    {...timelineGrouping.barProps}
    hidden={assetMultiSelectManager.selectionActive || viewMode !== PersonPageViewMode.VIEW_ASSETS}
    class="mt-12 shrink-0"
    resultCount={numberOfAssets}
    onAddAllToCollection={handleAddAllToCollection}
  />
  <div class="relative min-h-0 flex-1">
    {#key person.id}
      <Timeline
        enableRouting={true}
        {person}
        bind:timelineManager
        {options}
        assetInteraction={assetMultiSelectManager}
        onEscape={handleEscape}
        {...timelineGrouping.timelineProps}
      >
        {#if viewMode === PersonPageViewMode.VIEW_ASSETS}
          <!-- Person information block -->
          <div
            class="relative p-4 pt-12 sm:px-6"
            use:clickOutside={{
              onOutclick: handleCancelEditName,
              onEscape: isEditingName ? handleCancelEditName : undefined,
            }}
            use:listNavigation={suggestionContainer}
          >
            <div class="flex flex-wrap items-center gap-4" data-testid="person-timeline-header">
              <section class="flex w-fit place-items-center border-black" data-testid="person-timeline-identity">
                {#if isEditingName}
                  <EditNameInput
                    {person}
                    bind:suggestedPeople
                    name={person.name}
                    bind:isSearchingPeople
                    onChange={handleNameChange}
                    {thumbnailData}
                  />
                {:else}
                  <div class="relative">
                    <button
                      type="button"
                      class="flex items-center justify-center"
                      title={canEditSpacePerson ? $t('edit_name') : undefined}
                      onclick={() => (isEditingName = canEditSpacePerson)}
                    >
                      <ImageThumbnail
                        circle
                        shadow
                        url={thumbnailData}
                        altText={person.name}
                        widthStyle="3.375rem"
                        heightStyle="3.375rem"
                      />
                      <div class="flex flex-col justify-center px-4 text-start text-primary">
                        <p class="w-40 truncate font-medium">{person.name || $t('add_a_name')}</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                          {$t('assets_count', { values: { count: numberOfAssets } })}
                        </p>
                        {#if featureFlagsManager.value.peopleStatistics}
                          <p class="text-sm text-gray-500 dark:text-gray-400">
                            {$t('faces_count', { values: { count: data.statistics.faces } })}
                          </p>
                        {/if}
                        {#if person.birthDate}
                          <p class="text-sm text-gray-500 dark:text-gray-400">
                            {$t('person_birthdate', {
                              values: {
                                date: DateTime.fromISO(person.birthDate).toLocaleString(
                                  {
                                    month: 'numeric',
                                    day: 'numeric',
                                    year: 'numeric',
                                  },
                                  { locale: $locale },
                                ),
                              },
                            })}
                          </p>
                        {/if}
                      </div>
                    </button>
                  </div>
                {/if}
              </section>
            </div>
            {#if isEditingName}
              <div class="absolute z-1 w-64 sm:w-96">
                {#if isSearchingPeople}
                  <div
                    class="flex h-14 place-items-center rounded-b-lg border border-gray-400 bg-gray-200 p-2 dark:border-immich-dark-gray dark:bg-gray-700"
                  >
                    <div class="flex w-full place-items-center">
                      <LoadingSpinner />
                    </div>
                  </div>
                {:else}
                  <div bind:this={suggestionContainer}>
                    {#each suggestedPeople as person, index (person.id)}
                      <button
                        type="button"
                        class="flex h-14 w-full place-items-center border border-gray-200 bg-gray-100 p-2 hover:bg-gray-300 focus:bg-gray-300 dark:border-immich-dark-gray dark:bg-gray-700 hover:dark:bg-[#232932] focus:dark:bg-[#232932] {index ===
                        suggestedPeople.length - 1
                          ? 'rounded-b-lg border-b'
                          : ''}"
                        onclick={() => handleSuggestPeople(person)}
                      >
                        <ImageThumbnail
                          circle
                          shadow
                          url={getPeopleThumbnailUrl(person)}
                          altText={person.name}
                          widthStyle="2rem"
                          heightStyle="2rem"
                        />
                        <p class="ms-4 text-gray-700 dark:text-gray-100">{person.name}</p>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
          <PersonSuggestions {person} {canEditSpacePerson} {thumbnailData} onConfirmed={refreshThumbnail} />
        {/if}
      </Timeline>
    {/key}
  </div>
</main>

<header>
  {#if assetMultiSelectManager.selectionActive}
    <AssetSelectControlBar>
      {@const Actions = getAssetBulkActions($t)}
      <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />
      <ActionButton action={Actions.CreateSharedLink} />
      <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} />
      <ActionButton action={Actions.AddToAlbum} />
      <FavoriteAction
        removeFavorite={assetMultiSelectManager.isAllFavorite}
        onFavorite={(ids, isFavorite) => timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite))}
      />
      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <DownloadAction menuItem filename={person.name || 'immich'} />
        <MenuOption
          icon={mdiAccountMultipleCheckOutline}
          text={$t('fix_incorrect_match')}
          onClick={handleReassignAssets}
        />
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <ArchiveAction
          menuItem
          unarchive={assetMultiSelectManager.isAllArchived}
          onArchive={(ids, visibility) =>
            timelineManager.update(ids, (asset) => {
              asset.visibility = visibility;
            })}
        />
        <ActionMenuItem action={Actions.Tag} />
        <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
        <DeleteAssets
          menuItem
          onAssetDelete={(assetIds) => handleDeleteAssets(assetIds)}
          onUndoDelete={(assets) => handleUndoDeleteAssets(assets)}
        />
      </ButtonContextMenu>
    </AssetSelectControlBar>
  {:else if viewMode === PersonPageViewMode.VIEW_ASSETS}
    <ControlAppBar backIcon={mdiArrowLeft} onClose={() => goto(previousRoute)}>
      {#snippet trailing()}
        <ContextMenuButton
          items={[
            SelectRepresentativeFace,
            HidePerson,
            ShowPerson,
            SetDateOfBirth,
            Merge,
            SeparateFromGroupedPerson,
            Favorite,
            Unfavorite,
          ]}
          aria-label={$t('open')}
        />
      {/snippet}
    </ControlAppBar>
  {/if}
</header>

{#if viewMode === PersonPageViewMode.UNASSIGN_ASSETS}
  <UnmergeFaceSelector
    assetIds={assetMultiSelectManager.assets.map((a) => a.id)}
    personAssets={person}
    onClose={() => (viewMode = PersonPageViewMode.VIEW_ASSETS)}
    onConfirm={handleUnmerge}
  />
{/if}

{#if viewMode === PersonPageViewMode.MERGE_PEOPLE}
  <MergeFaceSelector {person} onBack={handleGoBack} onMerge={handleMerge} />
{/if}
