<script lang="ts">
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
  import { t } from 'svelte-i18n';
  import type { MapFilterController } from './map-filter-controller.svelte';

  type Props = {
    controller: MapFilterController;
  };

  // The active-filter chips and the smart-search notice, overlaid on top of the map pane.
  let { controller: map }: Props = $props();
</script>

{#if map.hasActiveFilters}
  <div class="absolute inset-x-0 top-0 z-10 bg-light/95 backdrop-blur-sm">
    <ActiveFiltersBar
      filters={map.filters}
      resultCount={map.mapMarkers.length}
      searchQuery={map.committedQuery}
      onClearSearch={map.clearCommittedQuery}
      personNames={map.personNames}
      tagNames={map.tagNames}
      albumNames={map.albumNames}
      ownerNames={map.ownerNames}
      onRemoveFilter={map.removeFilter}
      onClearAll={map.clearAll}
      onAddAllToCollection={map.addAllToCollection}
    />
  </div>
{/if}
{#if map.hasUnappliedSmartSearch}
  <div
    class="pointer-events-none absolute inset-x-0 top-0 z-10 mt-12 flex justify-center px-4"
    data-testid="map-smart-search-notice"
    role="status"
  >
    <p class="pointer-events-auto rounded-lg bg-warning/90 px-4 py-2 text-sm text-dark shadow-sm">
      {$t('map_smart_search_not_applied')}
    </p>
  </div>
{/if}
