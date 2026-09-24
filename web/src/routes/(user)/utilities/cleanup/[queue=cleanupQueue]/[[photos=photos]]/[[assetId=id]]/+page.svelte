<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import Portal from '$lib/elements/Portal.svelte';
  import type { Action } from '$lib/components/asset-viewer/actions/action';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { handlePromiseError } from '$lib/utils';
  import { lazyComponent } from '$lib/utils/lazy-component.svelte';
  import { navigate } from '$lib/utils/navigation';
  import type { PageData } from './$types';
  import BurstsQueue from './BurstsQueue.svelte';
  import SelectQueue from './SelectQueue.svelte';
  import SpaceHogsQueue from './SpaceHogsQueue.svelte';

  type Props = {
    data: PageData;
  };

  let { data }: Props = $props();

  $effect(() => {
    if (data.asset) {
      assetViewerManager.setAsset(data.asset);
    }
  });

  const closeViewer = () => {
    assetViewerManager.showAssetViewer(false);
    handlePromiseError(navigate({ targetRoute: 'current', assetId: null }));
  };

  // Trashing from the viewer removes the item through the AssetsDelete event; the viewer has no
  // neighbours to move to in v1, so it simply closes.
  const preAction = (payload: Action) => {
    if (payload.type === 'trash') {
      closeViewer();
    }
  };

  // Mounting the viewer through `{#await}` leaves it permanently unreactive on reopen.
  // See lazyComponent().
  const LazyAssetViewer = lazyComponent(() => import('$lib/components/asset-viewer/AssetViewer.svelte'));
</script>

<UserPageLayout scrollbar={true}>
  <div class="mx-auto w-full max-w-7xl px-2 pt-2 pb-10 md:px-4" data-testid="cleanup-queue-{data.slug}">
    <!-- Keyed on the queue so the list, filters and selection start afresh when switching queues. -->
    {#key data.queue}
      {#if data.queue === 'space_hogs'}
        <SpaceHogsQueue title={data.meta.title} />
      {:else if data.queue === 'bursts'}
        <BurstsQueue title={data.meta.title} />
      {:else}
        <SelectQueue queue={data.queue} title={data.meta.title} />
      {/if}
    {/key}
  </div>
</UserPageLayout>

{#if assetViewerManager.isViewing && assetViewerManager.asset}
  {#if LazyAssetViewer.current}
    {@const AssetViewer = LazyAssetViewer.current}
    <Portal target="body">
      <AssetViewer
        cursor={{ current: assetViewerManager.asset }}
        showNavigation={false}
        {preAction}
        onClose={closeViewer}
      />
    </Portal>
  {/if}
{/if}
