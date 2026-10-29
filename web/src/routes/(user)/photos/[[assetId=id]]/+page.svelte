<script lang="ts">
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import LinkLivePhotoAction from '$lib/components/timeline/actions/LinkLivePhotoAction.svelte';
  import RotateAction from '$lib/components/timeline/actions/RotateAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { AssetAction } from '$lib/constants';
  import FilteredTimelinePage from '$lib/gallery/filtered-timeline/FilteredTimelinePage.svelte';
  import { createPhotosTimeline } from '$lib/gallery/filtered-timeline/photos-timeline';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { memoryManager } from '$lib/managers/memory-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { getStackBulkActions } from '$lib/services/stack.service';
  import { getAssetMediaUrl, memoryLaneTitle } from '$lib/utils';
  import { type OnLink, type OnUnlink } from '$lib/utils/actions';
  import { openFileUploadDialog } from '$lib/utils/file-uploader';
  import { getAltText } from '$lib/utils/thumbnail-util';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import MemoryCard from '$lib/components/memories/MemoryCard.svelte';
  import { ActionButton, CommandPaletteDefaultProvider, ImageCarousel } from '@immich/ui';
  import { mdiDotsVertical } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  let timelineManager = $state<TimelineManager>() as TimelineManager;
  const filtered = createPhotosTimeline(() => timelineManager);
  const options = $derived(filtered.options);
  filtered.registerSelectionContext({ canAddToAlbum: () => true, canAddToSpace: () => true });

  let selectedAssets = $derived(assetMultiSelectManager.assets);
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
    filtered.onSetVisibility(assetIds);
  };

  const items = $derived(
    memoryManager.memories.map((memory) => ({
      id: memory.id,
      title: $memoryLaneTitle(memory),
      href: Route.viewMemory({ id: memory.id, assetId: memory.assets[0].id }),
      alt: $t('memory_lane_title', { values: { title: $getAltText(toTimelineAsset(memory.assets[0])) } }),
      src: getAssetMediaUrl({ id: memory.assets[0].id }),
      type: memory.type,
    })),
  );

  memoryManager.setFilters({ $for: DateTime.now().toISODate() });
</script>

<FilteredTimelinePage
  controller={filtered}
  searchResults={{ isShared: false }}
  reloadOnHiddenSpaceAdd
  hideNavbar={assetMultiSelectManager.selectionActive}
  scrollbar={false}
>
  <Timeline
    enableRouting={true}
    bind:timelineManager
    {options}
    assetInteraction={assetMultiSelectManager}
    removeAction={AssetAction.ARCHIVE}
    onEscape={handleEscape}
    {...filtered.timelineProps}
    withStacked
  >
    {#if authManager.preferences.memories.enabled && !filtered.hasActiveFilters}
      <!-- Month/year cards need room below the strip; the grouping bar above already supplies the
           strip's top margin, so mt-0 drops ImageCarousel's own (merged through twMerge). -->
      <div class={{ 'pb-8': filtered.grouping !== 'day' }}>
        <ImageCarousel {items} class="mt-0">
          {#snippet child(item)}
            <MemoryCard {item} />
          {/snippet}
        </ImageCarousel>
      </div>
    {/if}
    {#snippet empty()}
      <!-- #763: an empty FILTERED timeline is not an empty library; only the unfiltered one invites an upload. -->
      {#if filtered.isNarrowed}
        <EmptyPlaceholder text={$t('no_results')} class="mx-auto mt-10" />
      {:else}
        <EmptyPlaceholder text={$t('no_assets_message')} onClick={() => openFileUploadDialog()} class="mx-auto mt-10" />
      {/if}
    {/snippet}
  </Timeline>
</FilteredTimelinePage>

{#if assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    {@const Actions = getAssetBulkActions($t)}
    {@const StackActions = getStackBulkActions($t)}
    <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />

    <ActionButton action={Actions.CreateSharedLink} />
    <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} onSelectAll={filtered.onSelectAll} />
    <ActionButton action={Actions.AddToAlbum} />

    <!-- #763: a favorite is a per-user overlay row, so it needs no ownership gate. -->
    <FavoriteAction removeFavorite={assetMultiSelectManager.isAllFavorite} onFavorite={filtered.onFavorite} />

    {#if assetMultiSelectManager.isAllUserOwned}
      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <DownloadAction menuItem />
        {#if !filtered.showSearchResults}
          <ActionMenuItem action={StackActions.Stack} />
          <ActionMenuItem action={StackActions.Unstack} />
        {/if}
        {#if !filtered.showSearchResults && isLinkActionAvailable}
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
        <ArchiveAction menuItem onArchive={filtered.onArchive} />
        <ActionMenuItem action={Actions.Tag} />
        <DeleteAssets menuItem onAssetDelete={filtered.onAssetDelete} onUndoDelete={filtered.onUndoDelete} />
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
