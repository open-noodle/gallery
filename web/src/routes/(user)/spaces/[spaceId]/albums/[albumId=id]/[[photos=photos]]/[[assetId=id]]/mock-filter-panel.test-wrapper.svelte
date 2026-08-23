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
    timeBuckets?: Array<{ timeBucket: string; count: number }>;
    storageKey?: string;
    personNames?: Map<string, string>;
    tagNames?: Map<string, string>;
    onFiltersChange?: (filters: FilterState) => void;
  }

  // `filters` is two-way bound by the page; the buttons below let tests activate filters.
  let {
    config,
    filters = $bindable(createFilterState()),
    hidden = false,
    timeBuckets = [],
    onFiltersChange,
    ...rest
  }: Props = $props();
  void rest;

  // The real panel funnels EVERY control through `updateFilters`, which sets the bound value and
  // then fires `onFiltersChange` (filter-panel.svelte). Mutating the binding alone would let a page
  // that never wires the callback — and so never writes its filters to the URL — pass.
  function updateFilters(nextFilters: FilterState) {
    filters = nextFilters;
    onFiltersChange?.(nextFilters);
  }

  /**
   * The real panel calls `config.suggestionsProvider` on mount and on every filter change
   * (filter-panel.svelte). Without that call here, a page's ENTIRE query-mode provider — the branch
   * that swaps album suggestions for search facets — is never exercised, and deleting it leaves the
   * suite green. The rendered people list below is what lets a test observe which branch ran.
   */
  let suggestedPeople = $state<Array<{ id: string; name: string }>>([]);
  let suggestionError = $state('');

  $effect(() => {
    const provider = config?.suggestionsProvider;
    const currentFilters = filters;
    if (!provider) {
      return;
    }
    let cancelled = false;
    void provider(currentFilters)
      .then((result) => {
        if (cancelled) {
          return;
        }
        suggestedPeople = result.people ?? [];
        suggestionError = '';
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        suggestedPeople = [];
        suggestionError = error instanceof Error ? error.message : 'unknown error';
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<div
  data-testid="filter-panel"
  data-hidden={String(hidden)}
  data-time-buckets={timeBuckets.map((bucket) => bucket.timeBucket).join(',')}
  data-suggestion-error={suggestionError}
>
  <button
    type="button"
    data-testid="filter-panel-add-person"
    onclick={() => updateFilters({ ...filters, personIds: ['person-1'] })}
  >
    add person filter
  </button>
  <button
    type="button"
    data-testid="filter-panel-add-year"
    onclick={() => updateFilters({ ...filters, selectedYear: 2025 })}
  >
    add year filter
  </button>
  {#each suggestedPeople as person (person.id)}
    <button
      type="button"
      data-testid="filter-panel-suggested-person-{person.id}"
      onclick={() => updateFilters({ ...filters, personIds: [person.id] })}
    >
      {person.name}
    </button>
  {/each}
</div>
