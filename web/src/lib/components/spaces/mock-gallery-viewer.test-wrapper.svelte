<script lang="ts">
  import type { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import type { AssetResponseDto } from '@immich/sdk';

  /**
   * Stands in for GalleryViewer in space-search-results tests. The real component measures a
   * justified layout against a scroll container, which happy-dom reports as 0x0 — so it would
   * render no thumbnails at all. This records the props under test as data attributes and
   * renders one clickable stub per asset.
   */
  interface Props {
    assets?: AssetResponseDto[];
    assetInteraction?: AssetMultiSelectManager;
    scrollElement?: HTMLElement;
    onAssetOpen?: (asset: AssetResponseDto) => void;
    withAssetViewer?: boolean;
    showArchiveIcon?: boolean;
  }

  let {
    assets = [],
    assetInteraction,
    scrollElement,
    onAssetOpen,
    withAssetViewer = true,
    showArchiveIcon = false,
  }: Props = $props();
</script>

<div
  data-testid="gallery-viewer"
  data-with-asset-viewer={String(withAssetViewer)}
  data-show-archive-icon={String(showArchiveIcon)}
  data-has-scroll-element={String(!!scrollElement)}
  data-has-asset-interaction={String(!!assetInteraction)}
>
  {#each assets as asset (asset.id)}
    <button type="button" data-testid={`gallery-asset-${asset.id}`} onclick={() => onAssetOpen?.(asset)}>
      {asset.id}
    </button>
  {/each}
</div>
