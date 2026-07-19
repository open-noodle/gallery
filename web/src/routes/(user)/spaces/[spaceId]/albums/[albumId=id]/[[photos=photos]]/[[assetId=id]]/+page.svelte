<script lang="ts">
  import { goto, onNavigate } from '$app/navigation';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import AlbumTitle from '$lib/components/album-page/AlbumTitle.svelte';
  import AlbumDescription from '$lib/components/album-page/AlbumDescription.svelte';
  import AlbumSummary from '$lib/components/album-page/AlbumSummary.svelte';
  import { isSpaceAlbumRoute } from '$lib/utils/navigation';
  import {
    clearFilters,
    createFilterState,
    getActiveFilterCount,
    loadFilterCollapsed,
  } from '$lib/components/filter-panel/filter-panel';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import FilterToggleButton from '$lib/components/filter-panel/filter-toggle-button.svelte';
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import RemoveFromAlbum from '$lib/components/timeline/actions/RemoveFromAlbumAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import TimelineGroupingControl from '$lib/components/timeline/TimelineGroupingControl.svelte';
  import { assetMultiSelectManager, AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { getTimelineTopVisibleAnchor } from '$lib/managers/timeline-manager/timeline-anchor';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineAsset, TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
  import { addAssetsToAlbums, getAlbumAssetsActions, handleDeleteAlbum } from '$lib/services/album.service';
  import { buildAlbumAssetPickerOptions, buildAlbumTimelineOptions } from '$lib/utils/album-filter-options';
  import { buildAlbumAssetPickerFilterConfig, buildAlbumDetailFilterConfig } from '$lib/utils/album-filter-config';
  import { handlePhotosRemoveFilter } from '$lib/utils/photos-filter-options';
  import { clearTimelineTemporalFilter } from '$lib/utils/timeline-temporal-filters';
  import { withNameCapture } from '$lib/utils/filter-name-capture';
  import { filterStateToSearchTerms } from '$lib/utils/filter-search-terms';
  import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
  import { lang } from '$lib/stores/preferences.store';
  import { SvelteMap } from 'svelte/reactivity';
  import {
    type ActivatableTimelineBucket,
    getTimelineBucketZoomTarget,
    getTimelineManagerTimeBuckets,
  } from '$lib/utils/timeline-zoom-navigation';
  import {
    AlbumUserRole,
    getAlbumInfo,
    SharedSpaceRole,
    type AlbumResponseDto,
    type SharedSpaceMemberResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import HeaderActionButton from '$lib/components/HeaderActionButton.svelte';
  import { Icon, IconButton, modalManager } from '@immich/ui';
  import { mdiArrowLeft, mdiImageOutline, mdiImagePlusOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const space: SharedSpaceResponseDto = $derived(data.space);
  const members: SharedSpaceMemberResponseDto[] = $derived(data.members);
  let album = $state<AlbumResponseDto>(data.album);

  // Mode: 'browse' shows the album timeline; 'add' shows the asset picker
  let mode = $state<'browse' | 'add'>('browse');

  // Timeline grouping state — default 'day' gives the flat "All" grid (fixes stuck-cover bug)
  let timelineGrouping = $state<TimelineGrouping>('day');
  let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
  let timelineManager = $state<TimelineManager>() as TimelineManager;
  let pickerTimelineManager = $state<TimelineManager>() as TimelineManager;

  // Picker multi-select manager (mirrors global album page's timelineMultiSelectManager)
  const pickerMultiSelectManager = new AssetMultiSelectManager();

  // Independent filter state per mode (mirrors the global album page).
  let browseFilters = $state(createFilterState());
  let pickerFilters = $state(createFilterState());
  const browsePersonNames = new SvelteMap<string, string>();
  const browseTagNames = new SvelteMap<string, string>();
  const pickerPersonNames = new SvelteMap<string, string>();
  const pickerTagNames = new SvelteMap<string, string>();
  const currentMember = $derived(members.find((m) => m.userId === authManager.user.id));
  const isSpaceEditor = $derived(
    currentMember?.role === SharedSpaceRole.Owner || currentMember?.role === SharedSpaceRole.Editor,
  );
  const isAlbumEditor = $derived(
    album.albumUsers.some(
      (au) =>
        au.user.id === authManager.user.id && (au.role === AlbumUserRole.Owner || au.role === AlbumUserRole.Editor),
    ),
  );
  const canManage = $derived(isSpaceEditor || isAlbumEditor);
  // Album title/description editing is owner-gated, mirroring the regular album page's `isOwned`.
  const isOwned = $derived(album.albumUsers[0]?.user.id === authManager.user.id);

  // Match the regular album flow: an abandoned empty + unnamed album (created here and left without a
  // title or any photos) is cleaned up on navigate-away. Deleting it also drops the shared_space_album
  // link (FK cascade), so it won't linger as a nameless, empty card in the space.
  onNavigate(async ({ to }) => {
    if (!isSpaceAlbumRoute(to?.route.id) && album.assetCount === 0 && !album.albumName) {
      await handleDeleteAlbum(album, { notify: false, prompt: false });
    }
  });

  const browseFilterConfig = $derived(
    withNameCapture(buildAlbumDetailFilterConfig(album.id), browsePersonNames, browseTagNames),
  );
  const browseTotal = $derived(timelineManager?.assetCount ?? 0);
  const browseHasMonths = $derived((timelineManager?.months?.length ?? 0) > 0);
  const browseActive = $derived(getActiveFilterCount(browseFilters));
  const isBrowseEmpty = $derived(
    Boolean(timelineManager?.isInitialized) && !browseHasMonths && browseTotal === 0 && browseActive === 0,
  );

  // Filter-panel collapse is driven here so the header filter button can reclaim the panel's space.
  let filterCollapsed = $state(loadFilterCollapsed());
  const showBrowseFilteredEmpty = $derived(
    Boolean(timelineManager?.isInitialized) && !browseHasMonths && browseTotal === 0 && browseActive > 0,
  );
  const browseTimeBuckets = $derived(getTimelineManagerTimeBuckets(timelineManager));

  const browseOptions = $derived({
    ...buildAlbumTimelineOptions(
      album.id,
      album.order ?? authManager.preferences.albums.defaultAssetOrder,
      browseFilters,
    ),
    // The grouping MUST live in the options object — that is what the TimelineManager reads to
    // build buckets. The top-level <Timeline grouping={...}> prop alone does not re-group.
    grouping: timelineGrouping,
  });

  // Mirror the global album page: collect every asset matching the active browse filters
  // (scoped to this album) into another album/space. ActiveFiltersBar self-gates the button
  // on there being active filters + results.
  const handleAddAllToCollection = () => {
    void modalManager.show(SearchAddAllToCollectionModal, {
      terms: { ...filterStateToSearchTerms(browseFilters), albumIds: [album.id] },
      total: browseTotal,
      smartSearchEnabled: false,
      language: $lang,
    });
  };

  const pickerFilterConfig = $derived(
    withNameCapture(buildAlbumAssetPickerFilterConfig(), pickerPersonNames, pickerTagNames),
  );
  const pickerTotal = $derived(pickerTimelineManager?.assetCount ?? 0);
  const pickerHasMonths = $derived((pickerTimelineManager?.months?.length ?? 0) > 0);
  const pickerActive = $derived(getActiveFilterCount(pickerFilters));
  const isPickerEmpty = $derived(
    Boolean(pickerTimelineManager?.isInitialized) && !pickerHasMonths && pickerTotal === 0 && pickerActive === 0,
  );
  const showPickerFilteredEmpty = $derived(
    Boolean(pickerTimelineManager?.isInitialized) && !pickerHasMonths && pickerTotal === 0 && pickerActive > 0,
  );
  const pickerTimeBuckets = $derived(getTimelineManagerTimeBuckets(pickerTimelineManager));

  const pickerOptions = $derived(buildAlbumAssetPickerOptions(album.id, pickerFilters));

  const refreshAlbum = async () => {
    album = await getAlbumInfo({ id: album.id });
  };

  const handleRemoveAssets = (assetIds: string[]) => {
    // Prune the browse timeline immediately so removed photos don't linger.
    // RemoveFromAlbumAction already re-fetches the album via bind:album and clears the
    // selection internally before firing onRemove, so we only need to defensively clear here.
    timelineManager?.removeAssets(assetIds);
    assetMultiSelectManager.clear();
  };

  function resetPicker() {
    pickerFilters = createFilterState();
    pickerPersonNames.clear();
    pickerTagNames.clear();
    pickerMultiSelectManager.clear();
    timelineGrouping = 'day';
    temporalAnchor = undefined;
  }

  function enterAddMode() {
    resetPicker();
    mode = 'add';
  }

  const handleExitAddMode = () => {
    resetPicker();
    mode = 'browse';
  };

  const handleAddAssetsSuccess = async (added: TimelineAsset[] = []) => {
    timelineManager?.upsertAssets(added);
    resetPicker();
    mode = 'browse';
    await refreshAlbum();
  };

  function handleTimelineGroupingChange(grouping: TimelineGrouping) {
    const anchor = getTimelineTopVisibleAnchor(timelineManager);
    timelineGrouping = grouping;
    temporalAnchor = anchor;
  }

  function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
    if (mode !== 'browse' || assetMultiSelectManager.selectionActive) {
      return;
    }
    const result = getTimelineBucketZoomTarget(bucket);
    if (!result) {
      return;
    }
    timelineGrouping = result.grouping;
    temporalAnchor = result.anchor;
  }

  const { AddAssets, Upload } = $derived(getAlbumAssetsActions($t, album, pickerMultiSelectManager.assets));
</script>

<!-- Header shows the space (context/breadcrumb); the album name lives in the editable AlbumTitle in the
     timeline below, mirroring the regular album page (which has no page-header title). -->
<UserPageLayout hideNavbar={assetMultiSelectManager.selectionActive} title={space.name}>
  {#snippet leading()}
    <IconButton
      variant="ghost"
      shape="round"
      color="secondary"
      aria-label={$t('back')}
      onclick={() => void goto(`/spaces/${space.id}/albums`)}
      icon={mdiArrowLeft}
    />
  {/snippet}

  {#snippet buttons()}
    {#if canManage && mode === 'browse'}
      <IconButton
        variant="ghost"
        shape="round"
        color="secondary"
        aria-label={$t('space_album_add_photos')}
        data-testid="add-photos-button"
        onclick={enterAddMode}
        icon={mdiImagePlusOutline}
      />
    {/if}
  {/snippet}

  {#if mode === 'browse'}
    <div class="flex h-full">
      {#if !assetMultiSelectManager.selectionActive}
        {#key `space-album-${album.id}`}
          <FilterPanel
            config={browseFilterConfig}
            bind:filters={browseFilters}
            bind:collapsed={filterCollapsed}
            externalToggle
            timeBuckets={browseTimeBuckets}
            storageKey="gallery-filter-visible-sections-space-album"
            hidden={isBrowseEmpty}
          />
        {/key}
      {/if}

      <div class="flex flex-1 flex-col overflow-hidden pl-4">
        {#if !assetMultiSelectManager.selectionActive}
          <div
            class="mb-2 shrink-0 items-center gap-2 bg-transparent py-2 pe-4 dark:bg-transparent {filterCollapsed &&
            !isBrowseEmpty
              ? 'flex ps-2'
              : 'hidden ps-4 md:flex'}"
          >
            {#if filterCollapsed && !isBrowseEmpty}
              <!-- Visible at EVERY viewport: the panel's own collapse control has no breakpoint gate,
                   so the reopen affordance can't be desktop-only either (#752 launch review F3). -->
              <FilterToggleButton active={browseActive > 0} onExpand={() => (filterCollapsed = false)} />
            {/if}
            <div class="hidden md:flex md:items-center" data-testid="timeline-desktop-grouping-control">
              <TimelineGroupingControl grouping={timelineGrouping} onGroupingChange={handleTimelineGroupingChange} />
            </div>
          </div>
        {/if}

        {#if browseActive > 0}
          <div class="mb-4 shrink-0">
            <ActiveFiltersBar
              filters={browseFilters}
              resultCount={browseTotal}
              personNames={browsePersonNames}
              tagNames={browseTagNames}
              onRemoveFilter={(type, id) => {
                if (type === 'timeline') {
                  browseFilters = clearTimelineTemporalFilter(browseFilters);
                  temporalAnchor = undefined;
                } else {
                  browseFilters = handlePhotosRemoveFilter(browseFilters, type, id);
                }
              }}
              onClearAll={() => {
                browseFilters = clearFilters(browseFilters);
                temporalAnchor = undefined;
              }}
              onAddAllToCollection={handleAddAllToCollection}
            />
          </div>
        {/if}

        {#if showBrowseFilteredEmpty}
          <div class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="browse-filtered-empty">
            <p class="text-sm text-gray-500 dark:text-gray-400">{$t('space_album_no_photos_match_filters')}</p>
            <button
              type="button"
              data-testid="browse-clear-filters"
              class="text-sm text-(--primary)"
              onclick={() => {
                browseFilters = clearFilters(browseFilters);
                temporalAnchor = undefined;
              }}
            >
              {$t('space_album_clear_all_filters')}
            </button>
          </div>
        {:else}
          <Timeline
            enableRouting={true}
            options={browseOptions}
            bind:timelineManager
            assetInteraction={assetMultiSelectManager}
            isSelectionMode={false}
            singleSelect={false}
            grouping={timelineGrouping}
            onGroupingChange={handleTimelineGroupingChange}
            onTimelineBucketActivate={handleTimelineBucketActivate}
            {temporalAnchor}
            onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
          >
            <!-- Editable album header (Timeline leading content — always rendered, incl. for an empty
                 album so it can be named). Owner-gated, mirroring the regular album page. Unlike that
                 page, the header + period control already sit above, so it needs almost no top padding. -->
            <section class="pt-2">
              <AlbumTitle
                id={album.id}
                albumName={album.albumName}
                {isOwned}
                onUpdate={(albumName) => (album = { ...album, albumName })}
              />
              {#if album.assetCount > 0}
                <AlbumSummary {album} />
              {/if}
              <AlbumDescription
                id={album.id}
                {isOwned}
                bind:description={() => album.description, (description) => (album = { ...album, description })}
              />
            </section>

            {#snippet empty()}
              <section class="mt-50 flex place-content-center place-items-center">
                <div class="flex flex-col items-center gap-4 text-center">
                  <Icon icon={mdiImageOutline} size="3.5em" class="text-gray-400" />
                  <p class="text-lg text-gray-500 dark:text-gray-400">{$t('no_assets_to_show')}</p>
                  {#if canManage}
                    <button
                      type="button"
                      data-testid="empty-add-photos-button"
                      class="text-sm text-(--primary)"
                      onclick={enterAddMode}
                    >
                      {$t('add_photos')}
                    </button>
                  {/if}
                </div>
              </section>
            {/snippet}
          </Timeline>
        {/if}
      </div>
    </div>
  {/if}
</UserPageLayout>

<!-- Browse selection control bar (shows when assets are selected in browse mode). Rendered OUTSIDE
     UserPageLayout: its wrapper is `relative z-0`, which is a stacking context, so a control bar nested
     inside it (and before the Timeline) paints UNDER the asset grid and the z-1 scrubber. Matching the
     other timeline pages (recently-added/favorites/…), the bar sits after the layout so it paints on top.
     rbac-5/albums-8: album-path assets never grant space-editor metadata-edit (checkSpaceEditAccess
     omits the album arm, pinned by shared-space-album-scope.guard.spec.ts). This route is entirely
     album-path, so it intentionally exposes ONLY Download + RemoveFromAlbum — never Archive / Change
     date/location / Tag / visibility. In the MERGED direct-space timeline those metadata-edit actions
     are separately gated by `isAllUserOwned`, so an editor can never trigger them on a non-owned
     album-path asset; the residual mixed-bulk case is refused server-side (400 on album-path-only ids),
     which the client cannot pre-empt without a per-asset origin signal (none exists on TimelineAsset). -->
{#if mode === 'browse' && assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    <DownloadAction filename="{album.albumName}.zip" />
    {#if canManage}
      <RemoveFromAlbum bind:album onRemove={handleRemoveAssets} data-testid="album-remove-from-album" />
    {/if}
  </AssetSelectControlBar>
{/if}

{#if mode === 'add'}
  <section class="fixed inset-0 z-40 bg-immich-bg dark:bg-immich-dark-bg" data-testid="add-photos-overlay">
    <!--
      The sidebar + picker Timeline live inside <main>; the ControlAppBar is rendered AFTER it. The
      bar is `position: absolute` with auto z-index, so it would be painted under the full-height
      <main> (swallowing clicks on the trailing Upload/Add buttons) if it came first. Keeping it last
      — as the global album page does — lets it paint on top while staying pinned to the top.
    -->
    <main class="relative h-dvh overflow-hidden pt-(--navbar-height)" data-testid="add-photos-timeline-main">
      <div class="flex h-full">
        {#key `space-album-picker-${album.id}`}
          <FilterPanel
            config={pickerFilterConfig}
            bind:filters={pickerFilters}
            timeBuckets={pickerTimeBuckets}
            storageKey="gallery-filter-visible-sections-space-album-picker"
            hidden={isPickerEmpty}
          />
        {/key}
        <div class="flex flex-1 flex-col overflow-hidden px-2 md:px-6">
          {#if pickerActive > 0}
            <div class="mb-4 shrink-0">
              <ActiveFiltersBar
                filters={pickerFilters}
                resultCount={pickerTotal}
                personNames={pickerPersonNames}
                tagNames={pickerTagNames}
                onRemoveFilter={(type, id) => (pickerFilters = handlePhotosRemoveFilter(pickerFilters, type, id))}
                onClearAll={() => (pickerFilters = clearFilters(pickerFilters))}
              />
            </div>
          {/if}

          {#if showPickerFilteredEmpty}
            <div class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="picker-filtered-empty">
              <p class="text-sm text-gray-500 dark:text-gray-400">{$t('space_album_no_photos_to_add_match_filters')}</p>
              <button
                type="button"
                data-testid="picker-clear-filters"
                class="text-sm text-(--primary)"
                onclick={() => (pickerFilters = clearFilters(pickerFilters))}
              >
                {$t('space_album_clear_all_filters')}
              </button>
            </div>
          {:else}
            <Timeline
              enableRouting={false}
              options={pickerOptions}
              bind:timelineManager={pickerTimelineManager}
              assetInteraction={pickerMultiSelectManager}
              isSelectionMode={true}
              singleSelect={false}
            />
          {/if}
        </div>
      </div>
    </main>
    <ControlAppBar onClose={handleExitAddMode}>
      {#snippet leading()}
        <p class="text-lg dark:text-immich-dark-fg">
          {#if !pickerMultiSelectManager.selectionActive}
            {$t('add_to_album')}
          {:else}
            {$t('selected_count', { values: { count: pickerMultiSelectManager.assets.length } })}
          {/if}
        </p>
      {/snippet}

      {#snippet trailing()}
        <HeaderActionButton action={Upload} />
        <HeaderActionButton
          action={{
            ...AddAssets,
            onAction: () => {
              const added = pickerMultiSelectManager.assets;
              void addAssetsToAlbums(
                [album.id],
                added.map(({ id }) => id),
                { notify: true },
              ).then((ok) => (ok ? handleAddAssetsSuccess(added) : undefined));
            },
          }}
        />
      {/snippet}
    </ControlAppBar>
  </section>
{/if}
