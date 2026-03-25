<script lang="ts">
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import {
    clearFilters,
    createFilterState,
    getActiveFilterCount,
    type FilterContext,
    type FilterPanelConfig,
  } from '$lib/components/filter-panel/filter-panel';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import LinkLivePhotoAction from '$lib/components/timeline/actions/LinkLivePhotoAction.svelte';
  import RotateAction from '$lib/components/timeline/actions/RotateAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import StackAction from '$lib/components/timeline/actions/StackAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { AssetAction } from '$lib/constants';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { memoryManager } from '$lib/managers/memory-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { getAssetMediaUrl, memoryLaneTitle } from '$lib/utils';
  import {
    updateStackedAssetInTimeline,
    updateUnstackedAssetInTimeline,
    type OnLink,
    type OnUnlink,
  } from '$lib/utils/actions';
  import { openFileUploadDialog } from '$lib/utils/file-uploader';
  import { buildPhotosTimelineOptions, handlePhotosRemoveFilter } from '$lib/utils/photos-filter-options';
  import { getAltText } from '$lib/utils/thumbnail-util';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import { getAllPeople, getAllTags, getSearchSuggestions, SearchSuggestionType } from '@immich/sdk';
  import { ActionButton, CommandPaletteDefaultProvider, ImageCarousel } from '@immich/ui';
  import { mdiDotsVertical } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';
  import { SvelteMap } from 'svelte/reactivity';

  let timelineManager = $state<TimelineManager>() as TimelineManager;

  // Filter state
  let filters = $state(createFilterState());
  const options = $derived(buildPhotosTimelineOptions(filters));
  let personNames = new SvelteMap<string, string>();
  let tagNames = new SvelteMap<string, string>();

  const filterConfig: FilterPanelConfig = {
    sections: ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'],
    providers: {
      people: async () => {
        const response = await getAllPeople({ withHidden: false });
        for (const p of response.people) {
          personNames.set(p.id, p.name || 'Unknown');
        }
        return response.people
          .filter((p) => p.thumbnailPath)
          .map((p) => ({ id: p.id, name: p.name || 'Unknown', thumbnailPath: p.thumbnailPath }));
      },
      locations: async (context?: FilterContext) => {
        const countries = await getSearchSuggestions({
          $type: SearchSuggestionType.Country,
          takenAfter: context?.takenAfter,
          takenBefore: context?.takenBefore,
        });
        return countries.filter(Boolean).map((c) => ({ value: c!, type: 'country' as const }));
      },
      cities: async (country: string, context?: FilterContext) => {
        const cities = await getSearchSuggestions({
          $type: SearchSuggestionType.City,
          country,
          takenAfter: context?.takenAfter,
          takenBefore: context?.takenBefore,
        });
        return cities.filter(Boolean) as string[];
      },
      cameras: async (context?: FilterContext) => {
        const makes = await getSearchSuggestions({
          $type: SearchSuggestionType.CameraMake,
          takenAfter: context?.takenAfter,
          takenBefore: context?.takenBefore,
        });
        return makes.filter(Boolean).map((m) => ({ value: m!, type: 'make' as const }));
      },
      cameraModels: async (make: string, context?: FilterContext) => {
        const models = await getSearchSuggestions({
          $type: SearchSuggestionType.CameraModel,
          make,
          takenAfter: context?.takenAfter,
          takenBefore: context?.takenBefore,
        });
        return models.filter(Boolean) as string[];
      },
      tags: async () => {
        const tags = await getAllTags();
        for (const t of tags) {
          tagNames.set(t.id, t.value);
        }
        return tags.map((t) => ({ id: t.id, name: t.value }));
      },
    },
  };

  const hasActiveFilters = $derived(getActiveFilterCount(filters) > 0);
  const totalAssetCount = $derived(timelineManager?.assetCount ?? 0);

  let selectedAssets = $derived(assetMultiSelectManager.assets);
  let isAssetStackSelected = $derived(selectedAssets.length === 1 && !!selectedAssets[0].stack);
  let isLinkActionAvailable = $derived.by(() => {
    const isLivePhoto = selectedAssets.length === 1 && !!selectedAssets[0].livePhotoVideoId;
    const isLivePhotoCandidate =
      selectedAssets.length === 2 &&
      selectedAssets.some((asset) => asset.isImage) &&
      selectedAssets.some((asset) => asset.isVideo);

    return assetMultiSelectManager.isAllUserOwned && (isLivePhoto || isLivePhotoCandidate);
  });

  const handleEscape = () => {
    if (assetViewerManager.isViewing) {
      return;
    }
    if (assetMultiSelectManager.selectionActive) {
      assetMultiSelectManager.clear();
      return;
    }
  };

  const handleLink: OnLink = ({ still, motion }) => {
    timelineManager.removeAssets([motion.id]);
    timelineManager.upsertAssets([still]);
  };

  const handleUnlink: OnUnlink = ({ still, motion }) => {
    timelineManager.upsertAssets([motion]);
    timelineManager.upsertAssets([still]);
  };

  const handleSetVisibility = (assetIds: string[]) => {
    timelineManager.removeAssets(assetIds);
    assetMultiSelectManager.clear();
  };

  const items = $derived(
    memoryManager.memories.map((memory) => ({
      id: memory.id,
      title: $memoryLaneTitle(memory),
      href: Route.viewMemory({ id: memory.id, assetId: memory.assets[0].id }),
      alt: $t('memory_lane_title', { values: { title: $getAltText(toTimelineAsset(memory.assets[0])) } }),
      src: getAssetMediaUrl({ id: memory.assets[0].id }),
    })),
  );

  memoryManager.setFilters({ $for: DateTime.now().toISODate() });
</script>

<UserPageLayout hideNavbar={assetMultiSelectManager.selectionActive} scrollbar={false}>
  <div class="flex h-full">
    <FilterPanel
      bind:filters
      config={filterConfig}
      timeBuckets={timelineManager?.months?.map((m) => ({
        timeBucket: `${m.yearMonth.year}-${String(m.yearMonth.month).padStart(2, '0')}-01T00:00:00.000Z`,
        count: m.assetsCount,
      })) ?? []}
      initialCollapsed={true}
      storageKey="gallery-filter-visible-sections-photos"
    />
    <div class="flex-1 overflow-hidden pl-4">
      {#if hasActiveFilters}
        <ActiveFiltersBar
          {filters}
          resultCount={totalAssetCount}
          {personNames}
          {tagNames}
          onRemoveFilter={(type, id) => {
            filters = handlePhotosRemoveFilter(filters, type, id);
          }}
          onClearAll={() => {
            filters = clearFilters(filters);
          }}
        />
      {/if}
      <Timeline
        enableRouting={true}
        bind:timelineManager
        {options}
        assetInteraction={assetMultiSelectManager}
        removeAction={AssetAction.ARCHIVE}
        onEscape={handleEscape}
        withStacked
      >
        {#if authManager.preferences.memories.enabled && !hasActiveFilters}
          <ImageCarousel {items} />
        {/if}
        {#snippet empty()}
          <EmptyPlaceholder
            text={$t('no_assets_message')}
            onClick={() => openFileUploadDialog()}
            class="mx-auto mt-10"
          />
        {/snippet}
      </Timeline>
    </div>
  </div>
</UserPageLayout>

{#if assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    {@const Actions = getAssetBulkActions($t)}
    <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />

    <CreateSharedLink />
    <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} />
    <ActionButton action={Actions.AddToAlbum} />

    {#if assetMultiSelectManager.isAllUserOwned}
      <FavoriteAction
        removeFavorite={assetMultiSelectManager.isAllFavorite}
        onFavorite={(ids, isFavorite) => timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite))}
      />

      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <DownloadAction menuItem />
        {#if assetMultiSelectManager.assets.length > 1 || isAssetStackSelected}
          <StackAction
            unstack={isAssetStackSelected}
            onStack={(result) => updateStackedAssetInTimeline(timelineManager, result)}
            onUnstack={(assets) => updateUnstackedAssetInTimeline(timelineManager, assets)}
          />
        {/if}
        {#if isLinkActionAvailable}
          <LinkLivePhotoAction
            menuItem
            unlink={assetMultiSelectManager.assets.length === 1}
            onLink={handleLink}
            onUnlink={handleUnlink}
          />
        {/if}
        <RotateAction />
        <ChangeDate menuItem />
        <ChangeDescription menuItem />
        <ChangeLocation menuItem />
        <ArchiveAction
          menuItem
          onArchive={(ids, visibility) => timelineManager.update(ids, (asset) => (asset.visibility = visibility))}
        />
        {#if authManager.preferences.tags.enabled}
          <TagAction menuItem />
        {/if}
        <DeleteAssets
          menuItem
          onAssetDelete={(assetIds) => timelineManager.removeAssets(assetIds)}
          onUndoDelete={(assets) => timelineManager.upsertAssets(assets)}
        />
        <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
        <hr />
        <ActionMenuItem action={Actions.RegenerateThumbnailJob} />
        <ActionMenuItem action={Actions.RefreshMetadataJob} />
        <ActionMenuItem action={Actions.TranscodeVideoJob} />
      </ButtonContextMenu>
    {:else}
      <DownloadAction />
    {/if}
  </AssetSelectControlBar>
{/if}
