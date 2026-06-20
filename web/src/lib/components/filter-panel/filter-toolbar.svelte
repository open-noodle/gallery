<script lang="ts">
  import TimelineGroupingControl from '$lib/components/timeline/TimelineGroupingControl.svelte';
  import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
  import type { Snippet } from 'svelte';
  import { twMerge } from 'tailwind-merge';

  interface Props {
    grouping: TimelineGrouping;
    onGroupingChange: (grouping: TimelineGrouping) => void;
    groupingDisabled?: boolean;
    showGrouping?: boolean;
    showFilters?: boolean;
    filters?: Snippet;
    class?: string;
  }

  let {
    grouping,
    onGroupingChange,
    groupingDisabled = false,
    showGrouping = true,
    showFilters = false,
    filters,
    class: className = '',
  }: Props = $props();
</script>

{#if showGrouping || showFilters}
  <!--
    Root display is responsive-by-intent:
    - showFilters → `flex` (visible on ALL sizes, so the chip bar still shows on mobile)
    - grouping-only → `hidden md:flex` (desktop-only, matching today's behavior)
    `bg-transparent` keeps the toolbar a hairline surface on the content background (never the old gray band).
    A caller MAY pass `class="hidden md:flex"` to force desktop-only even when showFilters is true
    (TimelineRouteGroupingBar does this); twMerge lets the later display utility win.
  -->
  <div
    class={twMerge(
      'shrink-0 items-center gap-3 bg-transparent px-4 py-2 dark:bg-transparent',
      showFilters ? 'flex' : 'hidden md:flex',
      className,
    )}
  >
    {#if showGrouping}
      <div class="hidden md:flex md:items-center" data-testid="timeline-desktop-grouping-control">
        <TimelineGroupingControl {grouping} {onGroupingChange} disabled={groupingDisabled} />
      </div>
    {/if}

    {#if showFilters}
      {#if showGrouping}
        <span
          class="hidden h-5 w-px shrink-0 bg-gray-200/70 md:block dark:bg-white/10"
          data-testid="filter-toolbar-separator"
          aria-hidden="true"
        ></span>
      {/if}
      <div class="min-w-0 flex-1">
        {@render filters?.()}
      </div>
    {/if}
  </div>
{/if}
