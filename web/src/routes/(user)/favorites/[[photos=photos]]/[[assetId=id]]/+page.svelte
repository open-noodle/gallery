<script lang="ts">
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/EmptyPlaceholder.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import RotateAction from '$lib/components/timeline/actions/RotateAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import TimelineRouteGroupingBar from '$lib/components/timeline/TimelineRouteGroupingBar.svelte';
  import { timelineGroupingProps } from '$lib/gallery/filtered-timeline/timeline-grouping.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { getAssetBulkActions } from '$lib/services/asset.service';
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
  const timelineGrouping = timelineGroupingProps(() => timelineManager, { addAllTerms: { isFavorite: true } });
  // #763: favorites are a per-user overlay, so this page is cross-scope like the Photos timeline
  // favorites filter (see buildPhotosTimelineOptions). Without these, a favorite a member placed on
  // another member's Space asset — which the overlay explicitly permits — would be unreachable here.
  // Access is still enforced per request: the server recomputes timelineSpaceIds from current
  // membership, so losing Space access drops the asset even though the overlay row survives.
  //
  // `visibility` is required, not incidental: timeline.service.ts rejects withPartners/
  // withSharedSpaces outright (400) when visibility is undefined, because undefined resolves to
  // withDefaultVisibility = Archive+Timeline and would expose other users' ARCHIVED assets. An
  // earlier attempt at this fix added the two flags alone and 400'd every request on this page,
  // which is why it was reverted. Matching buildPhotosTimelineOptions keeps the two favorite
  // surfaces consistent; the trade-off is that an archived favorite of your own no longer appears
  // here, exactly as it already does not under the /photos favorites chip.
  const options = $derived({
    isFavorite: true,
    withStacked: true,
    withPartners: true,
    withSharedSpaces: true,
    visibility: AssetVisibility.Timeline,
    grouping: timelineGrouping.grouping,
  });

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
</script>

<UserPageLayout hideNavbar={assetMultiSelectManager.selectionActive} title={data.meta.title} scrollbar={false}>
  <TimelineRouteGroupingBar {...timelineGrouping.barProps} />
  <Timeline
    enableRouting={true}
    withStacked={true}
    bind:timelineManager
    {options}
    assetInteraction={assetMultiSelectManager}
    onEscape={handleEscape}
    {...timelineGrouping.timelineProps}
  >
    {#snippet empty()}
      <EmptyPlaceholder text={$t('no_favorites_message')} class="mx-auto mt-10" />
    {/snippet}
  </Timeline>
</UserPageLayout>

<!-- Multiselection mode app bar -->
{#if assetMultiSelectManager.selectionActive}
  <AssetSelectControlBar>
    {@const Actions = getAssetBulkActions($t)}
    <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />
    <FavoriteAction removeFavorite onFavorite={(assetIds) => timelineManager.removeAssets(assetIds)} />
    <ActionButton action={Actions.CreateSharedLink} />
    <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} />
    <ActionButton action={Actions.AddToAlbum} />
    <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
      <DownloadAction menuItem />
      <RotateAction />
      <ChangeDate menuItem />
      <ChangeDescription menuItem />
      <ChangeLocation menuItem />
      <ArchiveAction
        menuItem
        unarchive={assetMultiSelectManager.isAllArchived}
        onArchive={(ids, visibility) => timelineManager.update(ids, (asset) => (asset.visibility = visibility))}
      />
      <ActionMenuItem action={Actions.Tag} />
      <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
      <DeleteAssets
        menuItem
        onAssetDelete={(assetIds) => timelineManager.removeAssets(assetIds)}
        onUndoDelete={(assets) => timelineManager.upsertAssets(assets)}
      />
    </ButtonContextMenu>
  </AssetSelectControlBar>
{/if}
