<script lang="ts">
  import type { AssetResponseDto } from '@immich/sdk';

  interface Props {
    assets?: AssetResponseDto[];
    enableGrouping?: boolean;
  }

  let { assets = [], enableGrouping = false }: Props = $props();
</script>

<div data-testid="gallery-viewer" data-enable-grouping={String(enableGrouping)}>
  {#each assets as asset (asset.id)}
    <div data-testid={`asset-row-${asset.id}`}>{asset.id}</div>
  {/each}
</div>
