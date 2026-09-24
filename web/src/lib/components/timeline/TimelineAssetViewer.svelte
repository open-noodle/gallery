<script lang="ts">
  import { lazyComponent } from '$lib/utils/lazy-component.svelte';
  import type { Action } from '$lib/components/asset-viewer/actions/action';
  import type { AssetCursor } from '$lib/components/asset-viewer/AssetViewer.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { AssetAction } from '$lib/constants';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { assetCacheManager } from '$lib/managers/AssetCacheManager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
  import { websocketEvents } from '$lib/stores/websocket';
  import { handlePromiseError } from '$lib/utils';
  import { navigateToAsset } from '$lib/utils/asset-utils';
  import { handleErrorAsync } from '$lib/utils/handle-error';
  import { navigate } from '$lib/utils/navigation';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import { type AlbumResponseDto, type AssetResponseDto, type PersonResponseDto, getAssetInfo } from '@immich/sdk';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    timelineManager: TimelineManager;
    invisible: boolean;
    withStacked?: boolean;
    isShared?: boolean;
    album?: AlbumResponseDto;
    person?: PersonResponseDto;
    removeAction?: AssetAction.UNARCHIVE | AssetAction.ARCHIVE | AssetAction.SET_VISIBILITY_TIMELINE | null;
    spaceId?: string;
    /** Shared-space surface + the caller's write capability on it — see `Timeline` (#889). */
    space?: { id: string; canWrite: boolean };
  }

  let {
    timelineManager,
    // eslint-disable-next-line no-useless-assignment
    invisible = $bindable(false),
    removeAction,
    withStacked = false,
    isShared = false,
    album,
    person,
    spaceId,
    space,
  }: Props = $props();

  const getAsset = (id: string) => {
    return handleErrorAsync(
      () => assetCacheManager.getAsset({ ...authManager.params, id, spaceId }),
      $t('error_retrieving_asset_information'),
    );
  };

  const getNextAsset = async (currentAsset: AssetResponseDto) => {
    const earlierTimelineAsset = await timelineManager.getEarlierAsset(currentAsset);
    if (!earlierTimelineAsset) {
      return;
    }
    return getAsset(earlierTimelineAsset.id);
  };

  const getPreviousAsset = async (currentAsset: AssetResponseDto) => {
    const laterTimelineAsset = await timelineManager.getLaterAsset(currentAsset);
    if (!laterTimelineAsset) {
      return;
    }
    return getAsset(laterTimelineAsset.id);
  };

  let assetCursor = $state<AssetCursor>({
    current: assetViewerManager.asset!,
    previousAsset: undefined,
    nextAsset: undefined,
  });

  const loadCloseAssets = async (currentAsset: AssetResponseDto) => {
    const [nextAsset, previousAsset] = await Promise.all([getNextAsset(currentAsset), getPreviousAsset(currentAsset)]);

    assetCursor = {
      current: currentAsset,
      nextAsset,
      previousAsset,
    };
  };

  //TODO: replace this with async derived in svelte 6
  $effect(() => {
    const asset = assetViewerManager.asset;
    if (asset) {
      handlePromiseError(loadCloseAssets(asset));
    }
  });

  const handleRandom = async () => {
    const randomAsset = await timelineManager.getRandomAsset();
    if (!randomAsset) {
      return;
    }

    await navigate({ targetRoute: 'current', assetId: randomAsset.id });
    return { id: randomAsset.id };
  };

  const handleClose = async (assetId: string) => {
    invisible = true;
    assetViewerManager.gridScrollTarget = { at: assetId };
    await navigate({
      targetRoute: 'current',
      assetId: null,
      assetGridRouteSearchParams: assetViewerManager.gridScrollTarget,
    });
  };

  const onAlbumRemoveAssets = async ({ assetIds, albumIds }: { assetIds: string[]; albumIds: string[] }) => {
    if (!album || !albumIds.includes(album.id)) {
      return;
    }

    timelineManager.removeAssets(assetIds);

    if (!assetIds.includes(assetCursor.current.id)) {
      return;
    }

    // keep the cleanup workflow in viewer by moving to adjacent asset first
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    (await navigateToAsset(assetCursor?.nextAsset)) ||
      (await navigateToAsset(assetCursor?.previousAsset)) ||
      (await handleClose(assetCursor.current.id));
  };

  const handlePreAction = async (action: Action) => {
    switch (action.type) {
      case removeAction:
      case AssetAction.TRASH:
      case AssetAction.RESTORE:
      case AssetAction.DELETE:
      case AssetAction.ARCHIVE:
      case AssetAction.SET_VISIBILITY_LOCKED:
      case AssetAction.SET_VISIBILITY_TIMELINE: {
        // must update manager before performing any navigation
        timelineManager.removeAssets([action.asset.id]);

        // find the next asset to show or close the viewer
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        (await navigateToAsset(assetCursor?.nextAsset)) ||
          (await navigateToAsset(assetCursor?.previousAsset)) ||
          (await handleClose(action.asset.id));

        break;
      }
      // no default
    }
  };
  const handleAction = (action: Action) => {
    switch (action.type) {
      case AssetAction.ARCHIVE:
      case AssetAction.UNARCHIVE: {
        timelineManager.upsertAssets([action.asset]);
        break;
      }
      // no default
    }
  };
  const handleUndoDelete = async (assets: TimelineAsset[]) => {
    timelineManager.upsertAssets(assets);
    if (assets.length === 0) {
      return;
    }

    const restoredAsset = assets[0];
    const asset = await getAssetInfo({ ...authManager.params, id: restoredAsset.id, spaceId });
    assetViewerManager.setAsset(asset);
    await navigate({ targetRoute: 'current', assetId: restoredAsset.id });
  };

  const handleUpdateOrUpload = (asset: AssetResponseDto) => {
    if (asset.id === assetCursor.current.id) {
      void loadCloseAssets(asset);
    }
  };

  onMount(() => {
    const unsubscribes = [
      websocketEvents.on('on_upload_success', (asset: AssetResponseDto) => handleUpdateOrUpload(asset)),
      websocketEvents.on('on_asset_update', (asset: AssetResponseDto) => handleUpdateOrUpload(asset)),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  });

  onDestroy(() => {
    assetCacheManager.invalidate();
  });

  // Mounting the viewer through `{#await}` leaves it permanently unreactive on reopen.
  // See lazyComponent().
  const LazyAssetViewer = lazyComponent(() => import('$lib/components/asset-viewer/AssetViewer.svelte'));
</script>

<<<<<<< 3c07ab4ea989bdba899e93409d1f23f2dbc889d1
{#if LazyAssetViewer.current}
  {@const AssetViewer = LazyAssetViewer.current}
||||||| ca4637adc79
{#await import('$lib/components/asset-viewer/AssetViewer.svelte') then { default: AssetViewer }}
=======
<OnEvents {onAlbumRemoveAssets} />

{#await import('$lib/components/asset-viewer/AssetViewer.svelte') then { default: AssetViewer }}
>>>>>>> e598e108966814fe8f70f81cd2a47c66dd5e7c71
  <AssetViewer
    {withStacked}
    cursor={assetCursor}
    {isShared}
    {album}
    {person}
    {spaceId}
    {space}
    onAssetChange={(asset) => {
      timelineManager?.upsertAssets([toTimelineAsset(asset)]);
    }}
    preAction={handlePreAction}
    onAction={(action) => {
      handleAction(action);
      assetCacheManager.invalidate();
    }}
    onUndoDelete={handleUndoDelete}
    onRandom={handleRandom}
    onClose={handleClose}
  />
{/if}
