<script lang="ts">
  import { goto } from '$app/navigation';
  import empty3Url from '$lib/assets/empty-3.svg';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import RestoreAssets from './RestoreAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import TimelineRouteGroupingBar from '$lib/components/timeline/TimelineRouteGroupingBar.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { Route } from '$lib/route';
  import { getTrashActions } from '$lib/services/trash.service';
  import { handlePromiseError } from '$lib/utils';
  import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
  import { getTimelineBucketZoomTarget, type ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';
  import { getTimelineTopVisibleAnchor } from '$lib/managers/timeline-manager/timeline-anchor';
  import { t } from 'svelte-i18n';
  import type { PageData } from './$types';

  type Props = {
    data: PageData;
  };

  let { data }: Props = $props();

  let timelineManager = $state<TimelineManager>() as TimelineManager;
  let timelineGrouping = $state<TimelineGrouping>('day');
  let temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
  const baseTimelineOptions = { isTrashed: true };
  const options = $derived({
    ...baseTimelineOptions,
    grouping: timelineGrouping,
  });
  const hideGroupingControls = $derived(
    assetMultiSelectManager.selectionActive ||
      Boolean(timelineManager?.isInitialized && timelineManager.assetCount === 0),
  );

  if (!featureFlagsManager.value.trash) {
    handlePromiseError(goto(Route.photos()));
  }

  const handleEscape = () => {
    if (!assetMultiSelectManager.selectionActive) {
      return;
    }

    assetMultiSelectManager.clear();
    return;
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

  const { Empty, RestoreAll } = $derived(getTrashActions($t));
</script>

{#if featureFlagsManager.value.trash}
  <UserPageLayout
    hideNavbar={assetMultiSelectManager.selectionActive}
    actions={assetMultiSelectManager.selectionActive ? [] : [Empty, RestoreAll]}
    title={data.meta.title}
    scrollbar={false}
  >
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
      onEscape={handleEscape}
      {temporalAnchor}
      onTimelineBucketActivate={handleTimelineBucketActivate}
      onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
      grouping={timelineGrouping}
      onGroupingChange={handleTimelineGroupingChange}
    >
      <p class="p-4 font-medium text-gray-500/60 dark:text-gray-300/60">
        {$t('trashed_items_will_be_permanently_deleted_after', {
          values: { days: serverConfigManager.value.trashDays },
        })}
      </p>
      {#snippet empty()}
        <EmptyPlaceholder text={$t('trash_no_results_message')} src={empty3Url} class="mx-auto mt-10" />
      {/snippet}
    </Timeline>
  </UserPageLayout>
{/if}

{#if assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} />
    <DeleteAssets force onAssetDelete={(assetIds) => timelineManager.removeAssets(assetIds)} />
    <RestoreAssets onRestore={(assetIds) => timelineManager.removeAssets(assetIds)} />
  </AssetSelectControlBar>
{/if}
