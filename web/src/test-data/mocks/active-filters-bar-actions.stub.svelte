<script lang="ts">
  type Props = {
    filters?: {
      selectedYear?: number;
      selectedMonth?: number;
      dateAfter?: string;
      dateBefore?: string;
      lensModel?: string;
      albumId?: string;
      ownerId?: string;
    };
    searchQuery?: string;
    albumNames?: Map<string, string>;
    ownerNames?: Map<string, string>;
    onClearSearch?: () => void;
    onClearAll?: () => void;
    onRemoveFilter?: (type: string, id?: string) => void;
    onAddAllToCollection?: () => void;
  };

  let {
    filters,
    searchQuery = '',
    albumNames,
    ownerNames,
    onClearSearch,
    onClearAll,
    onRemoveFilter,
    onAddAllToCollection,
  }: Props = $props();

  // The real bar labels its album/owner chips `albumNames.get(id) ?? id` / `ownerNames.get(id) ?? id`.
  // Mirroring that here is what lets a page spec prove the page actually PASSES (and fills) those
  // maps: a page that forgot the props still renders a chip — just a raw-UUID one.
  const albumLabel = $derived(filters?.albumId ? (albumNames?.get(filters.albumId) ?? filters.albumId) : '');
  const ownerLabel = $derived(filters?.ownerId ? (ownerNames?.get(filters.ownerId) ?? filters.ownerId) : '');
</script>

<div
  data-testid="active-filters-bar-stub"
  data-selected-year={filters?.selectedYear ?? ''}
  data-selected-month={filters?.selectedMonth ?? ''}
  data-date-after={filters?.dateAfter ?? ''}
  data-date-before={filters?.dateBefore ?? ''}
  data-lens={filters?.lensModel ?? ''}
  data-album-label={albumLabel}
  data-owner-label={ownerLabel}
  data-has-add-all={String(!!onAddAllToCollection)}
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
  <button type="button" data-testid="active-filters-remove-lens" onclick={() => onRemoveFilter?.('lens')}>
    Remove lens
  </button>
  <button
    type="button"
    data-testid="active-filters-remove-album"
    onclick={() => onRemoveFilter?.('album', filters?.albumId)}
  >
    Remove album
  </button>
  <button
    type="button"
    data-testid="active-filters-remove-owner"
    onclick={() => onRemoveFilter?.('owner', filters?.ownerId)}
  >
    Remove owner
  </button>
</div>
