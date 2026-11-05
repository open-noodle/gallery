<script lang="ts">
  import Timeline from '#lib/components/timeline/Timeline.svelte';
  import type { TimelineManager } from '#lib/managers/timeline-manager/timeline-manager.svelte.ts';
  import type { ComponentProps } from 'svelte';

  // Two timelines on one bound manager, in the order a remount with an outro runs (FilteredTimeline's reload
  // token): the new instance mounts while the old one is still outroing, then the old one is torn down.
  type Props = {
    showOld: boolean;
    showNew: boolean;
    timelineProps: Omit<ComponentProps<typeof Timeline>, 'timelineManager'>;
    onManager: (manager: TimelineManager) => void;
  };

  let { showOld, showNew, timelineProps, onManager }: Props = $props();
  let timelineManager = $state<TimelineManager>();

  $effect(() => {
    if (timelineManager) {
      onManager(timelineManager);
    }
  });
</script>

{#if showOld}
  <Timeline bind:timelineManager {...timelineProps} />
{/if}
{#if showNew}
  <Timeline bind:timelineManager {...timelineProps} />
{/if}
