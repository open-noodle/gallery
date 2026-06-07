<script lang="ts">
  import type { AssetResponseDto } from '@immich/sdk';

  interface Props {
    assets?: AssetResponseDto[];
    viewerAssets?: AssetResponseDto[];
    enableGrouping?: boolean;
  }

  let { assets = [], viewerAssets = [], enableGrouping = false }: Props = $props();
</script>

<div
  data-testid="gallery-viewer"
  data-enable-grouping={String(enableGrouping)}
  data-asset-count={String(assets.length)}
  data-viewer-asset-count={String(viewerAssets.length)}
>
  {#each assets as asset (asset.id)}
    <div data-testid={`asset-row-${asset.id}`}>{asset.id}</div>
  {/each}
</div>
