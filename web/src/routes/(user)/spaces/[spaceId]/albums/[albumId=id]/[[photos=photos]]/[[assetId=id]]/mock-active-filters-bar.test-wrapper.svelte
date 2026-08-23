<script lang="ts">
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';

  interface Props {
    filters?: FilterState;
    onRemoveFilter: (type: string, id?: string) => void;
    onClearAll: () => void;
    onAddAllToCollection?: () => void;
    // The real bar renders a search chip with a ✕ from these two, and prints `resultCount` in the
    // add-all label. Swallowing them into `...rest` made the whole clear-search affordance — and the
    // browse-vs-search count swap — unobservable, so a page that never wired them still passed.
    resultCount?: number;
    searchQuery?: string;
    onClearSearch?: () => void;
    personNames?: Map<string, string>;
    tagNames?: Map<string, string>;
    [key: string]: unknown;
  }

  let {
    filters,
    onRemoveFilter,
    onClearAll,
    onAddAllToCollection,
    resultCount,
    searchQuery = '',
    onClearSearch,
    personNames,
    tagNames,
    ...rest
  }: Props = $props();
  void rest;

  // Mirrors the real bar's fallback: a missing name renders the raw id, so a test can tell a named
  // chip from an unnamed one.
  const personLabels = $derived((filters?.personIds ?? []).map((id) => personNames?.get(id) ?? id).join(','));
  const tagLabels = $derived((filters?.tagIds ?? []).map((id) => tagNames?.get(id) ?? id).join(','));
</script>

<div
  data-testid="active-filters-bar"
  data-has-add-all={String(!!onAddAllToCollection)}
  data-result-count={resultCount ?? ''}
  data-search-query={searchQuery}
  data-person-labels={personLabels}
  data-tag-labels={tagLabels}
>
  <button type="button" data-testid="active-filters-remove-timeline" onclick={() => onRemoveFilter('timeline')}>
    remove timeline
  </button>
  <button type="button" data-testid="active-filters-clear-all" onclick={() => onClearAll()}>clear all</button>
  {#if searchQuery}
    <button type="button" data-testid="active-filters-clear-search" onclick={() => onClearSearch?.()}>
      clear search
    </button>
  {/if}
  {#if onAddAllToCollection}
    <button type="button" data-testid="active-filters-add-all" onclick={() => onAddAllToCollection()}> add all </button>
  {/if}
</div>
