<script lang="ts">
  import FilterToggleButton from '$lib/components/filter-panel/filter-toggle-button.svelte';
  import ScopedSearchButton from '$lib/components/search/scoped-search-button.svelte';
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
    // Header filter button (shown when the page's FilterPanel is collapsed via externalToggle).
    showFilterButton?: boolean;
    filterActive?: boolean;
    onExpandFilters?: () => void;
    // "Search here" affordance for surfaces whose search is page-scoped (#1051). Opt-in: most
    // callers of this toolbar (favorites, archive, tags, trash…) are not searchable pages, and an
    // icon that silently searched the whole library from inside them would be a lie.
    showSearchButton?: boolean;
    onSearch?: () => void;
  }

  let {
    grouping,
    onGroupingChange,
    groupingDisabled = false,
    showGrouping = true,
    showFilters = false,
    filters,
    class: className = '',
    showFilterButton = false,
    filterActive = false,
    onExpandFilters,
    showSearchButton = false,
    onSearch,
  }: Props = $props();

  const searchButtonVisible = $derived(showSearchButton && onSearch !== undefined);
</script>

{#if showGrouping || showFilters || (showFilterButton && onExpandFilters) || searchButtonVisible}
  <!--
    Root display is responsive-by-intent:
    - showFilters → `flex` (visible on ALL sizes, so the chip bar still shows on mobile)
    - showFilterButton && onExpandFilters → `flex` (visible on ALL sizes, so a collapsed panel is
      always reopenable — the panel's own collapse control has no breakpoint gate, #752 launch review F3)
    - grouping-only → `hidden md:flex` (desktop-only, matching today's behavior)
    `bg-transparent` keeps the toolbar a hairline surface on the content background (never the old gray band).
    A caller MAY pass `class="hidden md:flex"` to force desktop-only even when showFilters is true
    (TimelineRouteGroupingBar does this); twMerge lets the later display utility win.
  -->
  <div
    class={twMerge(
      // pointer-fine:pe-15 (60px) reserves the timeline Scrubber's DESKTOP_WIDTH on the right so the
      // bar's right-aligned actions (Clear all, Add-all-to-collection) don't sit under the scrubber and
      // stay fully clickable. Matches Scrubber's own `pointer: coarse` gate (no scrubber margin on touch).
      'shrink-0 items-center gap-3 bg-transparent py-2 pe-4 dark:bg-transparent pointer-fine:pe-15',
      // The compact filter button leads the row when shown — tighten the leading inset so it sits
      // closer to the edge; grouping-only usages keep the standard ps-4.
      showFilterButton ? 'ps-2' : 'ps-4',
      showFilters || (showFilterButton && onExpandFilters) ? 'flex' : 'hidden md:flex',
      className,
    )}
    data-testid="filter-toolbar-root"
  >
    {#if showFilterButton && onExpandFilters}
      <!-- Visible at EVERY viewport: collapsing is possible at every viewport (the panel's X has no
           breakpoint) and the collapsed flag is a global preference — an md:-gated reopen button
           permanently strands small screens (#752 launch review F3). -->
      <div class="flex items-center" data-testid="filter-toolbar-reopen">
        <FilterToggleButton active={filterActive} onExpand={onExpandFilters} />
      </div>
    {/if}

    {#if showGrouping}
      <div class="hidden md:flex md:items-center" data-testid="timeline-desktop-grouping-control">
        <TimelineGroupingControl {grouping} {onGroupingChange} disabled={groupingDisabled} />
      </div>
    {/if}

    {#if searchButtonVisible}
      <!-- Desktop-only (`hidden md:flex`), matching the grouping pill it sits beside; below md the
           nav bar's magnifier is the only trigger.
           Note the nav magnifier is `xl:hidden` (NavigationBar.svelte), so between md and xl BOTH are
           on screen. That overlap is accepted, not an oversight: they read as different affordances in
           different places — global chrome vs. "search this surface" — and it is exactly what the
           YouTube channel pattern this copies does when its masthead search collapses to an icon. -->
      <div class="hidden md:flex md:items-center" data-testid="filter-toolbar-search">
        <ScopedSearchButton onclick={() => onSearch?.()} />
      </div>
    {/if}

    {#if showFilters}
      <!-- The separator divides the leading controls from the chip bar, so it must follow whichever
           of them is present — the grouping pill OR the search button (search mode drops the pill
           but keeps the button). -->
      {#if showGrouping || searchButtonVisible}
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
