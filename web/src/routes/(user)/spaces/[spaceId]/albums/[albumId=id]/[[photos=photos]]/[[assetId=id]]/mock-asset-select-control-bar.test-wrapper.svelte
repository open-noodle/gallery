<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();
</script>

<div data-testid="asset-select-control-bar">
  {@render children?.()}
</div>
