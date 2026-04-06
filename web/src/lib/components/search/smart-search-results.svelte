<script lang="ts">
  import SpaceSearchResults from '$lib/components/spaces/space-search-results.svelte';
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';
  import { buildSmartSearchParams, SEARCH_FILTER_DEBOUNCE_MS } from '$lib/utils/space-search';
  import { searchSmart, type AssetResponseDto } from '@immich/sdk';

  interface Props {
    searchQuery: string;
    filters: FilterState;
    spaceId?: string;
    withSharedSpaces?: boolean;
    isShared: boolean;
    isLoading?: boolean;
  }

  let {
    searchQuery,
    filters,
    spaceId,
    withSharedSpaces,
    isShared,
    isLoading = $bindable(false),
  }: Props = $props();

  let searchResults = $state<AssetResponseDto[]>([]);
  let hasMoreResults = $state(false);
  let searchPage = $state(1);
  let searchAbortController: AbortController | undefined;
</script>

<SpaceSearchResults
  results={searchResults}
  {isLoading}
  hasMore={hasMoreResults}
  totalLoaded={searchResults.length}
  onLoadMore={() => void 0}
  {spaceId}
  {isShared}
  sortMode={filters.sortOrder}
/>
