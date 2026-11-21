<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet<[{ itemCount: number }]> } = $props();
</script>

{@render children({ itemCount: 2 })}
