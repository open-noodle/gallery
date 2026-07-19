<script lang="ts">
  import {
    createFilterState,
    type FilterPanelConfig,
    type FilterState,
  } from '$lib/components/filter-panel/filter-panel';

  interface Props {
    config: FilterPanelConfig;
    filters?: FilterState;
    hidden?: boolean;
    timeBuckets?: unknown;
    storageKey?: string;
    personNames?: Map<string, string>;
    tagNames?: Map<string, string>;
  }

  // `filters` is two-way bound by the page; the buttons below let tests activate filters.
  let { filters = $bindable(createFilterState()), hidden = false, ...rest }: Props = $props();
  void rest;
</script>

<div data-testid="filter-panel" data-hidden={String(hidden)}>
  <button
    type="button"
    data-testid="filter-panel-add-person"
    onclick={() => (filters = { ...filters, personIds: ['person-1'] })}
  >
    add person filter
  </button>
  <button
    type="button"
    data-testid="filter-panel-add-year"
    onclick={() => (filters = { ...filters, selectedYear: 2025 })}
  >
    add year filter
  </button>
</div>
