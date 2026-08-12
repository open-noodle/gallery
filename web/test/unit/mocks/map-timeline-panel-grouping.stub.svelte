<script lang="ts">
  import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';

  interface Props {
    filters?: FilterState;
    selectedClusterIds?: Set<string>;
    onClose?: () => void;
    onFiltersChange?: (filters: FilterState) => void;
    [key: string]: unknown;
  }

  let {
    filters = $bindable(createFilterState()),
    selectedClusterIds,
    onClose,
    onFiltersChange,
    ...rest
  }: Props = $props();
  let bucketActivations = $state(0);

  function activateYear() {
    bucketActivations += 1;
  }

  // Mirrors MapTimelinePanel's real clearTemporalFilter (Finding 1, #767 fresh instance): mutate
  // the bound filters AND notify the caller, so a page-level test can prove the page wires
  // onFiltersChange through to its URL sync rather than only asserting the real component calls it.
  function clearTemporalFilter() {
    if (!filters) {
      return;
    }
    const next = {
      ...filters,
      dateAfter: undefined,
      dateBefore: undefined,
      selectedYear: undefined,
      selectedMonth: undefined,
    };
    filters = next;
    onFiltersChange?.(next);
  }
</script>

<div
  {...rest}
  data-testid="map-timeline-panel-stub"
  data-selected-year={filters?.selectedYear ?? ''}
  data-selected-cluster-ids={[...(selectedClusterIds ?? [])].join(',')}
  data-bucket-activations={bucketActivations}
>
  <button type="button" data-testid="map-panel-activate-year" onclick={activateYear}>Activate year</button>
  <button type="button" data-testid="map-panel-clear-temporal-filter" onclick={clearTemporalFilter}>
    Clear temporal filter
  </button>
  <button type="button" data-testid="map-panel-close" onclick={() => onClose?.()}>Close</button>
</div>
