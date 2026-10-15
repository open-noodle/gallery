<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import Portal from '$lib/elements/Portal.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import type { Action } from '$lib/components/asset-viewer/actions/action';
  import { handlePromiseError } from '$lib/utils';
  import { lazyComponent } from '$lib/utils/lazy-component.svelte';
  import { navigate } from '$lib/utils/navigation';
  import type { PageData } from './$types';
  import RewindDay from './RewindDay.svelte';

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

  // Trashing from the viewer removes the tile through the AssetsDelete event; the viewer has no
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
  <!-- Keyed on the date so the marks, loaded years and focus start afresh on every date. -->
  {#key data.monthDay}
    <RewindDay monthDay={data.monthDay} years={data.years} firstYear={data.firstYear} title={data.meta.title} />
  {/key}
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
