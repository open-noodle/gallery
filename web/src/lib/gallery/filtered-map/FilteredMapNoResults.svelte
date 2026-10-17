<script lang="ts">
  import type { MapFilterController } from './map-filter-controller.svelte';

  type Props = {
    controller: MapFilterController;
  };

  let { controller: map }: Props = $props();
</script>

{#if map.noResults}
  <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
    <div
      class="pointer-events-auto rounded-lg bg-white/90 px-4 py-3 text-sm text-gray-600 shadow-sm dark:bg-gray-800/90 dark:text-gray-300"
    >
      No matching photos
    </div>
  </div>
{/if}
