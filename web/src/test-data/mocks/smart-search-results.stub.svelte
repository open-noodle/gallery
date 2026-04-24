<script lang="ts">
  interface Props {
    isLoading?: boolean;
    searchQuery?: string;
    [key: string]: unknown;
  }

  let { isLoading = $bindable(false), searchQuery = '' }: Props = $props();
</script>

<div data-testid="smart-search-results" data-loading={String(isLoading)} data-search-query={searchQuery}></div>
