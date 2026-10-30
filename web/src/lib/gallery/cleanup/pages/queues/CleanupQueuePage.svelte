<script lang="ts">
  import BurstsQueue from '$lib/gallery/cleanup/pages/queues/BurstsQueue.svelte';
  import SelectQueue from '$lib/gallery/cleanup/pages/queues/SelectQueue.svelte';
  import SpaceHogsQueue from '$lib/gallery/cleanup/pages/queues/SpaceHogsQueue.svelte';
  import type { slugToQueue } from '$lib/gallery/cleanup/cleanup';

  type Props = {
    queue: ReturnType<typeof slugToQueue>;
    slug: string;
    title: string;
  };

  let { queue, slug, title }: Props = $props();
</script>

<div class="mx-auto w-full max-w-7xl px-2 pt-2 pb-10 md:px-4" data-testid="cleanup-queue-{slug}">
  <!-- Keyed on the queue so the list, filters and selection start afresh when switching queues. -->
  {#key queue}
    {#if queue === 'space_hogs'}
      <SpaceHogsQueue {title} />
    {:else if queue === 'bursts'}
      <BurstsQueue {title} />
    {:else}
      <SelectQueue {queue} {title} />
    {/if}
  {/key}
</div>
