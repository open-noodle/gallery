<script lang="ts">
  type Props = {
    filters?: {
      selectedYear?: number;
      selectedMonth?: number;
      dateAfter?: string;
      dateBefore?: string;
    };
    searchQuery?: string;
    onClearSearch?: () => void;
    onClearAll?: () => void;
    onRemoveFilter?: (type: string, id?: string) => void;
  };

  let { filters, searchQuery = '', onClearSearch, onClearAll, onRemoveFilter }: Props = $props();
</script>

<div
  data-testid="active-filters-bar-stub"
  data-selected-year={filters?.selectedYear ?? ''}
  data-selected-month={filters?.selectedMonth ?? ''}
  data-date-after={filters?.dateAfter ?? ''}
  data-date-before={filters?.dateBefore ?? ''}
>
  <button type="button" data-testid="active-filters-clear-search" onclick={() => onClearSearch?.()}>Clear search</button
  >
  <button
    type="button"
    data-testid="active-filters-clear-all"
    onclick={() => {
      onClearAll?.();
      if (searchQuery) {
        onClearSearch?.();
      }
    }}
  >
    Clear all
  </button>
  <button
    type="button"
    data-testid="active-filters-remove-person"
    onclick={() => onRemoveFilter?.('person', 'person-1')}
  >
    Remove person
  </button>
  <button type="button" data-testid="active-filters-remove-timeline" onclick={() => onRemoveFilter?.('timeline')}>
    Remove timeline
  </button>
</div>
