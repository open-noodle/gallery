<script lang="ts">
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import FilterToolbar from '$lib/components/filter-panel/filter-toolbar.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { lang } from '$lib/stores/preferences.store';
  import { getTimelineManagerTimeBuckets } from '$lib/utils/timeline-zoom-navigation';
  import type { ComponentProps, Snippet } from 'svelte';
  import type { AssetPickerFilters } from './asset-picker-filters.svelte';
  import type { FilteredTimelineController } from './filtered-timeline-controller.svelte';

  type ResultsProps = Pick<ComponentProps<typeof SmartSearchResults>, 'isShared' | 'space' | 'onScroll'>;

  interface Props {
    controller: FilteredTimelineController;
    /** The route's upstream `<Timeline>`; unmounted while smart-search results show. */
    children: Snippet;
    searchResults: ResultsProps;
    /** Render the filter panel and toolbar (off while the route shows a selection mode). */
    chrome?: boolean;
    /** Print the result count in the active-filters bar. */
    resultCount?: boolean;
    /** The page-scoped "search here" button (#1051). */
    searchButton?: boolean;
    /** Remount the timeline when assets go to a space hidden from my timeline (#1041). */
    reloadOnHiddenSpaceAdd?: boolean;
    testId?: string;
    /** Float the panel on its own rounded surface, for routes without UserPageLayout's card. */
    surface?: boolean;
    /** An "add photos" picker's filters, shown instead of the route's while `picking`. */
    picker?: AssetPickerFilters;
    picking?: boolean;
    /** Replaces the timeline while it is empty only because of the filters. */
    filteredEmpty?: { message: string; clearLabel: string };
    isFilteredEmpty?: boolean;
    /** Render as the route's `<main>` with this class, so the upstream `<Timeline>` keeps its place. */
    mainClass?: string;
    /** Content after the timeline column inside `<main>` (absolutely positioned overlays). */
    overlay?: Snippet;
  }

  let {
    controller,
    children,
    searchResults,
    chrome = true,
    resultCount = true,
    searchButton = true,
    reloadOnHiddenSpaceAdd = false,
    testId,
    surface = false,
    picker,
    picking = false,
    filteredEmpty,
    isFilteredEmpty = false,
    mainClass,
    overlay,
  }: Props = $props();

  const selecting = $derived(assetMultiSelectManager.selectionActive);
  const pickerOpen = $derived(!!picker && picking);
</script>

{#snippet panel()}
  {#if picker && picking}
    {#key `picker-${controller.config.entityKey?.() ?? ''}`}
      <FilterPanel
        config={picker.config}
        bind:filters={picker.filters}
        timeBuckets={getTimelineManagerTimeBuckets(controller.config.getTimelineManager())}
        storageKey={controller.storageKey}
        hidden={controller.isLoadedEmpty && picker.activeCount === 0}
      />
    {/key}
  {:else}
    <!-- A mode or query switch swaps the panel's whole suggestions provider: remount it. -->
    {#key controller.showSearchResults ? `${controller.panelKey}:${$lang}` : controller.panelKey}
      <FilterPanel
        bind:filters={controller.filters}
        bind:collapsed={controller.filterCollapsed}
        externalToggle
        config={controller.panelConfig}
        timeBuckets={controller.panelTimeBuckets}
        storageKey={controller.storageKey}
        hidden={controller.isTimelineEmpty}
        personNames={controller.personNames}
        tagNames={controller.tagNames}
        onFiltersChange={controller.onFiltersChange}
      />
    {/key}
  {/if}
{/snippet}

{#snippet filtersBar()}
  <ActiveFiltersBar
    embedded
    filters={controller.filters}
    searchQuery={controller.query}
    onClearSearch={controller.clearSearch}
    resultCount={resultCount ? controller.resultCount : undefined}
    personNames={controller.personNames}
    tagNames={controller.tagNames}
    albumNames={controller.albumNames}
    ownerNames={controller.ownerNames}
    onRemoveFilter={controller.onRemoveFilter}
    onClearAll={controller.onClearAll}
    onAddAllToCollection={controller.onAddAllToCollection}
  />
{/snippet}

{#snippet content()}
  <div class="flex h-full" data-testid={testId}>
    {#if chrome && surface}
      <!-- No UserPageLayout card to blend into here: give the panel the app's surface radius and an
           equal inset from the app bar and the window edge, so it reads as a floating panel. -->
      <div class="h-full shrink-0 py-4">
        <div class="h-full overflow-hidden rounded-lg" data-testid="album-filter-panel-surface">
          {@render panel()}
        </div>
      </div>
    {:else if chrome}
      {@render panel()}
    {/if}
    <!-- pl-2 is the gutter every filter panel + timeline page shares. -->
    <div class="flex flex-1 flex-col overflow-hidden pl-2">
      {#if picker && picking}
        {#if picker.activeCount > 0}
          <ActiveFiltersBar
            filters={picker.filters}
            resultCount={controller.totalAssetCount}
            personNames={picker.personNames}
            tagNames={picker.tagNames}
            onRemoveFilter={picker.onRemoveFilter}
            onClearAll={picker.onClearAll}
          />
        {/if}
      {:else if chrome}
        <FilterToolbar
          class="mb-2"
          grouping={controller.grouping}
          onGroupingChange={controller.onGroupingChange}
          showGrouping={controller.isBrowse && !controller.showSearchResults && !selecting}
          showFilters={controller.hasActiveFilters}
          filters={filtersBar}
          showFilterButton={controller.filterCollapsed &&
            controller.isBrowse &&
            !controller.isTimelineEmpty &&
            !selecting}
          filterActive={controller.activeFilterCount > 0}
          onExpandFilters={() => (controller.filterCollapsed = false)}
          showSearchButton={searchButton && controller.isBrowse && !selecting}
          onSearch={searchButton ? () => globalSearchManager.open() : undefined}
        />
      {/if}
      {#if controller.showSearchResults && !pickerOpen}
        <SmartSearchResults
          bind:isLoading={controller.isLoading}
          bind:results={controller.searchResults}
          reloadToken={controller.searchReloadToken}
          searchQuery={controller.query}
          filters={controller.filters}
          language={$lang}
          {...controller.config.scope()}
          {...searchResults}
          total={controller.smartFacetTotal}
        />
      {:else if filteredEmpty && isFilteredEmpty}
        <div class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="empty-state-message">
          <p class="text-sm text-(--fg-muted)">{filteredEmpty.message}</p>
          <button
            type="button"
            class="text-sm text-(--primary)"
            onclick={pickerOpen ? picker?.onClearAll : controller.onClearAll}
          >
            {filteredEmpty.clearLabel}
          </button>
        </div>
      {:else}
        {#key controller.timelineReloadToken}
          {@render children()}
        {/key}
      {/if}
    </div>
  </div>
{/snippet}

{#if mainClass}
  <main class={mainClass}>
    {@render content()}
    {@render overlay?.()}
  </main>
{:else}
  {@render content()}
{/if}

{#if reloadOnHiddenSpaceAdd}
  <OnEvents onSpaceAddAssets={controller.onSpaceAddAssets} />
{/if}
