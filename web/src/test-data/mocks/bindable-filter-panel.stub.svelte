<script lang="ts">
  interface Props {
    filters?: unknown;
    [key: string]: unknown;
  }

  let { filters = $bindable() }: Props = $props();
</script>

<div data-testid="filter-panel-stub" data-has-filters={String(filters !== undefined)}></div>
