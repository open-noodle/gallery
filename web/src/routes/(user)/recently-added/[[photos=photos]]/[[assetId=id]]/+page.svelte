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
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { AssetAction } from '$lib/constants';
  import FilteredTimelinePage from '$lib/gallery/filtered-timeline/FilteredTimelinePage.svelte';
  import { createRecentlyAddedTimeline } from '$lib/gallery/filtered-timeline/recently-added-timeline.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { type OnLink, type OnUnlink } from '$lib/utils/actions';
  import { openFileUploadDialog } from '$lib/utils/file-uploader';
  import { shouldShowRecentlyAddedCount } from '$lib/utils/recently-added-filter-options';
  import { ActionButton, CommandPaletteDefaultProvider } from '@immich/ui';
  import { mdiDotsVertical } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';
  import { getStackBulkActions } from '$lib/services/stack.service';

  type Props = {
    data: PageData;
  };

  let { data }: Props = $props();

  let timelineManager = $state<TimelineManager>() as TimelineManager;
  const filtered = createRecentlyAddedTimeline(() => timelineManager);
  const options = $derived(filtered.options);
  const count = $derived(filtered.resultCount ?? 0);
  const countLabel = $derived(
    shouldShowRecentlyAddedCount(count, filtered.hasActiveFilters)
      ? $t('items_count', { values: { count } })
      : undefined,
  );

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
</script>

<FilteredTimelinePage
  controller={filtered}
  searchResults={{ isShared: false }}
  resultCount={false}
  searchButton={false}
  hideNavbar={assetMultiSelectManager.selectionActive}
  title={data.meta.title}
  description={countLabel}
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
    {#snippet empty()}
      <EmptyPlaceholder text={$t('no_assets_message')} onClick={() => openFileUploadDialog()} class="mx-auto mt-10" />
    {/snippet}
  </Timeline>
</FilteredTimelinePage>

{#if assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    {@const Actions = getAssetBulkActions($t)}
    {@const StackActions = filtered.browseOnly(getStackBulkActions($t))}
    <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />

    <ActionButton action={Actions.CreateSharedLink} />
    <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} onSelectAll={filtered.onSelectAll} />
    <ActionButton action={Actions.AddToAlbum} />

    <FavoriteAction removeFavorite={assetMultiSelectManager.isAllFavorite} onFavorite={filtered.onFavorite} />

    {#if assetMultiSelectManager.isAllUserOwned}
      <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
        <DownloadAction menuItem />
        <ActionMenuItem action={StackActions.Stack} />
        <ActionMenuItem action={StackActions.Unstack} />
        {#if !filtered.showSearchResults && isLinkActionAvailable}
          <LinkLivePhotoAction
            menuItem
            unlink={assetMultiSelectManager.assets.length === 1}
            onLink={handleLink}
            onUnlink={handleUnlink}
          />
        {/if}
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
