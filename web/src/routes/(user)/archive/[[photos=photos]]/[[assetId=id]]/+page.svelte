<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import RotateAction from '$lib/components/timeline/actions/RotateAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import TimelineRouteGroupingBar from '$lib/components/timeline/TimelineRouteGroupingBar.svelte';
  import { AssetAction } from '$lib/constants';

  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { registerSelectionContext } from '$lib/managers/command-context-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { getTimelineBucketZoomTarget, type ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';
  import { getTimelineTopVisibleAnchor } from '$lib/managers/timeline-manager/timeline-anchor';
  import { AssetVisibility } from '@immich/sdk';
  import { ActionButton, CommandPaletteDefaultProvider } from '@immich/ui';
  import { mdiDotsVertical } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  let timelineManager = $state<TimelineManager>() as TimelineManager;
  let timelineGrouping = $state<TimelineGrouping>('day');
  let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
  const baseTimelineOptions = { visibility: AssetVisibility.Archive };
  const options = $derived({
    ...baseTimelineOptions,
    grouping: timelineGrouping,
  });
  const hideGroupingControls = $derived(
    assetMultiSelectManager.selectionActive ||
      Boolean(timelineManager?.isInitialized && timelineManager.assetCount === 0),
  );

  const handleEscape = () => {
    if (!assetMultiSelectManager.selectionActive) {
      return;
    }

    assetMultiSelectManager.clear();
    return;
  };

  const handleSetVisibility = (assetIds: string[]) => {
    timelineManager.removeAssets(assetIds);
    assetMultiSelectManager.clear();
  };

  function handleTimelineGroupingChange(grouping: TimelineGrouping) {
    const anchor = getTimelineTopVisibleAnchor(timelineManager);
    timelineGrouping = grouping;
    temporalAnchor = anchor;
  }

  function handleTimelineBucketActivate(bucket: ActivatableTimelineBucket) {
    if (assetMultiSelectManager.selectionActive) {
      return;
    }

    const result = getTimelineBucketZoomTarget(bucket);
    if (!result) {
      return;
    }

    timelineGrouping = result.grouping;
    temporalAnchor = result.anchor;
  }

  registerSelectionContext({
    getAssets: () => assetMultiSelectManager.assets,
    clearSelection: () => assetMultiSelectManager.clear(),
    canAddToAlbum: () => true,
    getOnFavorite: () =>
      timelineManager
        ? (ids, isFavorite) => timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite))
        : undefined,
    getOnDelete: () => (timelineManager ? (assetIds) => timelineManager.removeAssets(assetIds) : undefined),
  });
</script>

<UserPageLayout hideNavbar={assetMultiSelectManager.selectionActive} title={data.meta.title} scrollbar={false}>
  <TimelineRouteGroupingBar
    grouping={timelineGrouping}
    hidden={hideGroupingControls}
    onGroupingChange={handleTimelineGroupingChange}
  />
  <Timeline
    enableRouting={true}
    bind:timelineManager
    {options}
    assetInteraction={assetMultiSelectManager}
    removeAction={AssetAction.UNARCHIVE}
    onEscape={handleEscape}
    {temporalAnchor}
    onTimelineBucketActivate={handleTimelineBucketActivate}
    onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
    grouping={timelineGrouping}
    onGroupingChange={handleTimelineGroupingChange}
  >
    {#snippet empty()}
      <EmptyPlaceholder text={$t('no_archived_assets_message')} class="mx-auto mt-10" />
    {/snippet}
  </Timeline>
</UserPageLayout>

{#if assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    {@const Actions = getAssetBulkActions($t)}
    <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />
    <ArchiveAction
      unarchive
      onArchive={(ids, visibility) => timelineManager.update(ids, (asset) => (asset.visibility = visibility))}
    />
    <CreateSharedLink />
    <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} />
    <ActionButton action={Actions.AddToAlbum} />
    <FavoriteAction
      removeFavorite={assetMultiSelectManager.isAllFavorite}
      onFavorite={(ids, isFavorite) => timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite))}
    />
    <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
      <DownloadAction menuItem />
      <RotateAction />
      <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
      <DeleteAssets menuItem onAssetDelete={(assetIds) => timelineManager.removeAssets(assetIds)} />
    </ButtonContextMenu>
  </AssetSelectControlBar>
{/if}
