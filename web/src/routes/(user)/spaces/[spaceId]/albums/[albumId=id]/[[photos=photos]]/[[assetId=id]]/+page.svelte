<script lang="ts">
  import { goto } from '$app/navigation';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import { clearFilters, createFilterState, getActiveFilterCount } from '$lib/components/filter-panel/filter-panel';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
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
  import { addAssetsToAlbums, getAlbumAssetsActions } from '$lib/services/album.service';
  import { buildAlbumAssetPickerOptions, buildAlbumTimelineOptions } from '$lib/utils/album-filter-options';
  import { buildAlbumAssetPickerFilterConfig, buildAlbumDetailFilterConfig } from '$lib/utils/album-filter-config';
  import { handlePhotosRemoveFilter } from '$lib/utils/photos-filter-options';
  import { clearTimelineTemporalFilter } from '$lib/utils/timeline-temporal-filters';
  import { withNameCapture } from '$lib/utils/filter-name-capture';
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
  import { Icon, IconButton } from '@immich/ui';
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

  const browseFilterConfig = $derived(
    withNameCapture(buildAlbumDetailFilterConfig(album.id), browsePersonNames, browseTagNames),
  );
  const browseTotal = $derived(timelineManager?.assetCount ?? 0);
  const browseHasMonths = $derived((timelineManager?.months?.length ?? 0) > 0);
  const browseActive = $derived(getActiveFilterCount(browseFilters));
  const isBrowseEmpty = $derived(
    Boolean(timelineManager?.isInitialized) && !browseHasMonths && browseTotal === 0 && browseActive === 0,
  );
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

<UserPageLayout
  title={album.albumName}
  description={`${$t('items_count', { values: { count: album.assetCount } })} · ${$t('space_album_in_space', { values: { space: space.name } })}`}
>
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

  <!-- Browse selection control bar (shows when assets are selected in browse mode) -->
  {#if mode === 'browse' && assetMultiSelectManager.selectionActive}
    <AssetSelectControlBar>
      <DownloadAction filename="{album.albumName}.zip" />
      {#if canManage}
        <RemoveFromAlbum bind:album onRemove={handleRemoveAssets} />
      {/if}
    </AssetSelectControlBar>
  {/if}

  {#if mode === 'browse'}
    <div class="flex h-full">
      {#if !assetMultiSelectManager.selectionActive}
        {#key `space-album-${album.id}`}
          <FilterPanel
            config={browseFilterConfig}
            bind:filters={browseFilters}
            timeBuckets={browseTimeBuckets}
            storageKey="gallery-filter-visible-sections-space-album"
            hidden={isBrowseEmpty}
          />
        {/key}
      {/if}

      <div class="flex flex-1 flex-col overflow-hidden pl-4">
        {#if !assetMultiSelectManager.selectionActive}
          <div
            class="mb-2 hidden shrink-0 items-center gap-2 bg-transparent px-4 py-2 md:flex dark:bg-transparent"
            data-testid="timeline-desktop-grouping-control"
          >
            <TimelineGroupingControl grouping={timelineGrouping} onGroupingChange={handleTimelineGroupingChange} />
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
              ).then(() => handleAddAssetsSuccess(added));
            },
          }}
        />
      {/snippet}
    </ControlAppBar>
  </section>
{/if}
