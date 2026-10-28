<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import type { Action } from '$lib/components/asset-viewer/actions/action';
  import Portal from '$lib/elements/Portal.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { handlePromiseError } from '$lib/utils';
  import { lazyComponent } from '$lib/utils/lazy-component.svelte';
  import { navigate } from '$lib/utils/navigation';
  import type { AssetResponseDto } from '@immich/sdk';
  import type { Snippet } from 'svelte';

  type Props = {
    /** The photo in the URL, opened in the asset viewer over the page. */
    asset?: AssetResponseDto;
    children: Snippet;
  };

  let { asset, children }: Props = $props();

  $effect(() => {
    if (asset) {
      assetViewerManager.setAsset(asset);
    }
  });

  const closeViewer = () => {
    assetViewerManager.showAssetViewer(false);
    handlePromiseError(navigate({ targetRoute: 'current', assetId: null }));
  };

  // Trashing from the viewer removes the photo from the page through the AssetsDelete event; the viewer
  // has no neighbours to move to, so it simply closes.
  const preAction = (payload: Action) => {
    if (payload.type === 'trash') {
      closeViewer();
    }
  };

  // Mounting the viewer through `{#await}` leaves it permanently unreactive on reopen.
  // See lazyComponent().
  const LazyAssetViewer = lazyComponent(() => import('$lib/components/asset-viewer/AssetViewer.svelte'));
</script>

<!-- The Cleanup rewind and queue pages: the page itself, with the asset viewer opened over it for the
     photo in the URL. -->
<UserPageLayout scrollbar={true}>
  {@render children()}
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
