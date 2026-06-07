<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import GalleryViewer from '$lib/components/shared-components/gallery-viewer/GalleryViewer.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import RotateAction from '$lib/components/timeline/actions/RotateAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import { QueryParameter } from '$lib/constants';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { registerSelectionContext } from '$lib/managers/command-context-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import type { Viewport } from '$lib/managers/timeline-manager/types';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { lang, locale } from '$lib/stores/preferences.store';
  import { handlePromiseError } from '$lib/utils';
  import { parseUtcDate } from '$lib/utils/date-time';
  import { handleError } from '$lib/utils/handle-error';
  import { isAlbumsRoute, isPeopleRoute } from '$lib/utils/navigation';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import {
    type AlbumResponseDto,
    type AssetResponseDto,
    AssetVisibility,
    getPerson,
    getTagById,
    type MetadataSearchDto,
    searchAssets,
    searchPerson,
    searchSmart,
    type SmartSearchDto,
  } from '@immich/sdk';
  import { ActionButton, CommandPaletteDefaultProvider, Icon, IconButton } from '@immich/ui';
  import { mdiArrowLeft, mdiClose, mdiDotsVertical, mdiImageOffOutline, mdiSelectAll } from '@mdi/js';
  import { tick, untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';

  const viewport: Viewport = $state({ width: 0, height: 0 });
  let searchResultsElement: HTMLElement | undefined = $state();

  // The GalleryViewer pushes it's own history state, which causes weird
  // behavior for history.back(). To prevent that we store the previous page
  // manually and navigate back to that.
  let previousRoute = $state<string>(Route.explore());

  let nextPage = $state(1);
  let searchResultAlbums: AlbumResponseDto[] = $state([]);
  let searchResultAssets: AssetResponseDto[] = $state([]);
  let isLoading = $state(true);
  let scrollY = $state(0);
  let scrollYHistory = 0;

  type SearchTerms = MetadataSearchDto & Pick<SmartSearchDto, 'query' | 'queryAssetId'>;
  let searchQuery = $derived(page.url.searchParams.get(QueryParameter.QUERY));
  let smartSearchEnabled = $derived(featureFlagsManager.value.smartSearch);
  let terms = $derived<SearchTerms>(searchQuery ? JSON.parse(searchQuery) : {});
  let searchTermKeys = $derived(getVisibleSearchKeys(terms));

  $effect(() => {
    // we want this to *only* be reactive on `terms`
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    terms;
    untrack(() => handlePromiseError(onSearchQueryUpdate()));
  });

  $effect(() => {
    if (scrollY) {
      scrollYHistory = scrollY;
    }
  });

  afterNavigate(({ from }) => {
    // Prevent setting previousRoute to the current page.
    if (from?.url && from.route.id !== page.route.id) {
      previousRoute = from.url.href;
    }
    const route = from?.route?.id;

    if (isPeopleRoute(route)) {
      previousRoute = Route.photos();
    }

    if (isAlbumsRoute(route)) {
      previousRoute = Route.explore();
    }

    tick()
      .then(() => {
        window.scrollTo(0, scrollYHistory);
      })
      .catch(() => {
        // do nothing
      });
  });

  const onAssetDelete = (assetIds: string[]) => {
    const assetIdSet = new Set(assetIds);
    searchResultAssets = searchResultAssets.filter((asset: AssetResponseDto) => !assetIdSet.has(asset.id));
  };

  const handleSetVisibility = (assetIds: string[]) => {
    assetMultiSelectManager.clear();
    onAssetDelete(assetIds);
  };

  const onFavorite = (ids: string[], isFavorite: boolean) => {
    for (const id of ids) {
      const asset = searchResultAssets.find((asset) => asset.id === id);
      if (asset) {
        asset.isFavorite = isFavorite;
      }
    }
  };

  const onArchive = (ids: string[], visibility: AssetVisibility) => {
    const idSet = new Set(ids);
    if (terms.visibility && terms.visibility !== visibility) {
      searchResultAssets = searchResultAssets.filter((asset) => !idSet.has(asset.id));
      return;
    }
    for (const id of ids) {
      const asset = searchResultAssets.find((asset) => asset.id === id);
      if (asset) {
        asset.visibility = visibility;
      }
    }
  };

  const onUndoDelete = () => {
    void onSearchQueryUpdate();
  };

  registerSelectionContext({
    getAssets: () => assetMultiSelectManager.assets,
    clearSelection: () => assetMultiSelectManager.clear(),
    canAddToAlbum: () => true,
    getOnFavorite: () => onFavorite,
    getOnArchive: () => onArchive,
    getOnDelete: () => onAssetDelete,
    getOnUndoDelete: () => onUndoDelete,
  });

  const handleSelectAll = () => {
    assetMultiSelectManager.selectAssets(searchResultAssets.map((asset) => toTimelineAsset(asset)));
  };

  async function onSearchQueryUpdate() {
    nextPage = 1;
    searchResultAssets = [];
    searchResultAlbums = [];
    await loadNextPage(true);
  }

  // eslint-disable-next-line svelte/valid-prop-names-in-kit-pages
  export const loadNextPage = async (force?: boolean) => {
    if (!nextPage || (isLoading && !force)) {
      return;
    }
    isLoading = true;

    const searchDto: SearchTerms = {
      page: nextPage,
      withExif: true,
      ...terms,
    };

    try {
      const { albums, assets } =
        ('query' in searchDto || 'queryAssetId' in searchDto) && smartSearchEnabled
          ? await searchSmart({
              smartSearchDto: { visibility: AssetVisibility.Timeline, ...searchDto, language: $lang },
            })
          : await searchAssets({ metadataSearchDto: { visibility: AssetVisibility.Timeline, ...searchDto } });

      searchResultAlbums.push(...albums.items);
      searchResultAssets.push(...assets.items);

      nextPage = Number(assets.nextPage) || 0;
    } catch (error) {
      handleError(error, $t('loading_search_results_failed'));
    } finally {
      isLoading = false;
    }
  };

  function getHumanReadableDate(dateString: string) {
    const date = parseUtcDate(dateString).startOf('day');
    return date.toLocaleString(
      {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      },
      { locale: $locale },
    );
  }

  function getHumanReadableSearchKey(key: keyof SearchTerms): string {
    const keyMap: Partial<Record<keyof SearchTerms, string>> = {
      takenAfter: $t('start_date'),
      takenBefore: $t('end_date'),
      visibility: $t('in_archive'),
      isFavorite: $t('favorite'),
      isNotInAlbum: $t('not_in_any_album'),
      type: $t('media_type'),
      query: $t('context'),
      city: $t('city'),
      country: $t('country'),
      state: $t('state'),
      make: $t('camera_brand'),
      model: $t('camera_model'),
      lensModel: $t('lens_model'),
      personIds: $t('people'),
      tagIds: $t('tags'),
      originalFileName: $t('file_name_text'),
      originalPath: $t('full_path_or_folder'),
      description: $t('description'),
      queryAssetId: $t('query_asset_id'),
      ocr: $t('ocr'),
    };
    return keyMap[key] || key;
  }

  const isScopedPersonToken = (personId: string) =>
    personId.startsWith('person:') || personId.startsWith('space-person:');

  async function getPersonName(personIds: string[]) {
    const scopedPersonIds = personIds.filter((personId) => isScopedPersonToken(personId));
    const scopedPeople =
      scopedPersonIds.length > 0 ? await searchPerson({ name: '', withHidden: true, withSharedSpaces: true }) : [];
    const scopedPeopleByFilterId = new Map(
      scopedPeople.map((person) => [person.filterId ?? `person:${person.id}`, person]),
    );

    const personNames = await Promise.all(
      personIds.map(async (personId) => {
        if (isScopedPersonToken(personId)) {
          const person = scopedPeopleByFilterId.get(personId);

          return person?.name || $t('no_name');
        }

        const person = await getPerson({ id: personId });

        if (person.name === '') {
          return $t('no_name');
        }

        return person.name;
      }),
    );

    return personNames.join(', ');
  }

  async function getTagNames(tagIds: string[] | null) {
    if (tagIds === null) {
      return $t('untagged');
    }
    const tagNames = await Promise.all(
      tagIds.map(async (tagId) => {
        const tag = await getTagById({ id: tagId });

        return tag.value;
      }),
    );

    return tagNames.join(', ');
  }

  const onAlbumAddAssets = ({ assetIds }: { assetIds: string[] }) => {
    assetMultiSelectManager.clear();

    if (terms.isNotInAlbum) {
      const assetIdSet = new Set(assetIds);
      searchResultAssets = searchResultAssets.filter((asset) => !assetIdSet.has(asset.id));
    }
  };

  function getObjectKeys<T extends object>(obj: T): (keyof T)[] {
    return Object.keys(obj) as (keyof T)[];
  }

  function getVisibleSearchKeys(terms: SearchTerms) {
    return getObjectKeys(terms).filter((key) => key !== 'withSharedSpaces');
  }

  function removeFilter(key: keyof SearchTerms) {
    delete terms[key];
    assetMultiSelectManager.clear();
    void goto(Route.search(terms));
  }
</script>

<svelte:window bind:scrollY />

<OnEvents {onAlbumAddAssets} />

{#if searchTermKeys.length > 0}
  <section id="search-chips" class="mx-auto mt-24 w-full max-w-7xl px-4 sm:px-8 lg:px-12">
    <div class="flex w-full flex-wrap place-content-center place-items-center gap-2.5 sm:gap-3">
      {#each searchTermKeys as searchKey (searchKey)}
        {@const value = terms[searchKey]}
        <div
          class="inline-flex max-w-full items-center rounded-full bg-primary/10 py-1 ps-1 pe-1 text-xs text-primary ring-1 ring-primary/15 transition-shadow hover:ring-primary/25 dark:bg-immich-dark-primary/15 dark:text-immich-dark-primary dark:ring-immich-dark-primary/20 dark:hover:ring-immich-dark-primary/30"
        >
          <span
            class="shrink-0 rounded-full bg-primary px-3 py-1.5 font-medium text-light dark:bg-immich-dark-primary dark:text-immich-dark-gray"
          >
            {getHumanReadableSearchKey(searchKey as keyof SearchTerms)}
          </span>

          {#if value !== true}
            <span class="max-w-[min(36rem,55vw)] min-w-0 truncate px-3 py-1.5 text-immich-fg dark:text-immich-dark-fg">
              {#if (searchKey === 'takenAfter' || searchKey === 'takenBefore') && typeof value === 'string'}
                {getHumanReadableDate(value)}
              {:else if searchKey === 'personIds' && Array.isArray(value)}
                {#await getPersonName(value) then personName}
                  {personName}
                {/await}
              {:else if searchKey === 'tagIds' && (Array.isArray(value) || value === null)}
                {#await getTagNames(value) then tagNames}
                  {tagNames}
                {/await}
              {:else if searchKey === 'rating'}
                {$t('rating_count', { values: { count: value ?? 0 } })}
              {:else if value === null || value === ''}
                {$t('unknown')}
              {:else}
                {value}
              {/if}
            </span>
          {/if}

          <button
            type="button"
            class="ms-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-primary outline-offset-2 outline-immich-primary transition-colors hover:bg-primary/15 focus-visible:outline-2 dark:text-immich-dark-primary dark:outline-immich-dark-primary dark:hover:bg-immich-dark-primary/20"
            aria-label={$t('remove_filter')}
            title={$t('remove_filter')}
            onclick={() => removeFilter(searchKey)}
          >
            <Icon icon={mdiClose} size="14" />
          </button>
        </div>
      {/each}
    </div>
  </section>
{/if}

<section
  class="m-4 mb-12 max-h-screen bg-immich-bg dark:bg-immich-dark-bg"
  bind:clientHeight={viewport.height}
  bind:clientWidth={viewport.width}
  bind:this={searchResultsElement}
>
  <section id="search-content">
    {#if searchResultAssets.length > 0}
      <GalleryViewer
        assets={searchResultAssets}
        assetInteraction={assetMultiSelectManager}
        onEndReached={loadNextPage}
        showArchiveIcon={true}
        {viewport}
        onReload={onSearchQueryUpdate}
        slidingWindowOffset={searchResultsElement.offsetTop}
        enableGrouping
      />
    {:else if !isLoading}
      <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
        <div class="flex flex-col content-center items-center text-center">
          <Icon icon={mdiImageOffOutline} size="3.5em" />
          <p class="mt-5 text-3xl font-medium">{$t('no_results')}</p>
          <p class="text-base font-normal">{$t('no_results_description')}</p>
        </div>
      </div>
    {/if}

    {#if isLoading}
      <div class="flex items-center justify-center py-16">
        <LoadingSpinner size="giant" />
      </div>
    {/if}
  </section>

  <section>
    {#if assetMultiSelectManager.selectionActive}
      <div class="fixed inset-s-0 top-0 z-2 w-full">
        <AssetSelectControlBar>
          {@const Actions = getAssetBulkActions($t)}
          <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />

          <CreateSharedLink />
          <IconButton
            shape="round"
            color="secondary"
            variant="ghost"
            aria-label={$t('select_all')}
            icon={mdiSelectAll}
            onclick={handleSelectAll}
          />
          <ActionButton action={Actions.AddToAlbum} />
          {#if assetMultiSelectManager.isAllUserOwned}
            <FavoriteAction removeFavorite={assetMultiSelectManager.isAllFavorite} {onFavorite} />

            <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
              <ActionMenuItem action={Actions.AddToAlbum} />
              <DownloadAction menuItem />
              <RotateAction />
              <ChangeDate menuItem />
              <ChangeDescription menuItem />
              <ChangeLocation menuItem />
              <ArchiveAction menuItem unarchive={assetMultiSelectManager.isAllArchived} {onArchive} />
              <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
              {#if authManager.preferences.tags.enabled}
                <TagAction menuItem />
              {/if}
              <DeleteAssets menuItem {onAssetDelete} onUndoDelete={onSearchQueryUpdate} />
              <hr />
              <ActionMenuItem action={Actions.RegenerateThumbnailJob} />
              <ActionMenuItem action={Actions.RefreshMetadataJob} />
              <ActionMenuItem action={Actions.TranscodeVideoJob} />
            </ButtonContextMenu>
          {:else}
            <DownloadAction />
          {/if}
        </AssetSelectControlBar>
      </div>
    {:else}
      <div class="fixed inset-s-0 top-0 z-2 w-full">
        <ControlAppBar onClose={() => goto(previousRoute)} backIcon={mdiArrowLeft}>
          <div class="mx-auto w-full max-w-2xl pe-2">
            <div
              class="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200/80 bg-white/90 px-4 py-2 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-immich-dark-gray/90 dark:text-gray-200"
            >
              <span>{$t('search_legacy_notice')}</span>
              <button
                type="button"
                class="font-medium text-primary hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-primary"
                onclick={() => globalSearchManager.open()}
              >
                {$t('search_open_palette')}
              </button>
            </div>
          </div>
        </ControlAppBar>
      </div>
    {/if}
  </section>
</section>
