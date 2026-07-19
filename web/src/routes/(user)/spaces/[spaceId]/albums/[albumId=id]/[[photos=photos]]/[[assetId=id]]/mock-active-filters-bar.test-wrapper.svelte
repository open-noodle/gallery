<script lang="ts">
  interface Props {
    onRemoveFilter: (type: string, id?: string) => void;
    onClearAll: () => void;
    onAddAllToCollection?: () => void;
    [key: string]: unknown;
  }

  let { onRemoveFilter, onClearAll, onAddAllToCollection, ...rest }: Props = $props();
  void rest;
</script>

<div data-testid="active-filters-bar" data-has-add-all={String(!!onAddAllToCollection)}>
  <button type="button" data-testid="active-filters-remove-timeline" onclick={() => onRemoveFilter('timeline')}>
    remove timeline
  </button>
  <button type="button" data-testid="active-filters-clear-all" onclick={() => onClearAll()}>clear all</button>
</div>
