<script lang="ts">
  import type { TimelineAsset } from '$lib/managers/timeline-manager/types';

  interface Props {
    asset: TimelineAsset;
    onClick?: (asset: TimelineAsset) => void;
    onSelect?: (asset: TimelineAsset) => void;
  }

  let { asset, onClick = undefined, onSelect = undefined }: Props = $props();
</script>

<button type="button" data-testid={`thumbnail-${asset.id}`} onclick={() => onClick?.(asset)}>
  {asset.id}
</button>
<button type="button" data-testid={`thumbnail-select-${asset.id}`} onclick={() => onSelect?.(asset)}>
  select {asset.id}
</button>
