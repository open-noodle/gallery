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

  let { searchQuery, filters, spaceId, withSharedSpaces, isShared, isLoading = $bindable(false) }: Props = $props();

  let searchResults = $state<AssetResponseDto[]>([]);
  let hasMoreResults = $state(false);
  let searchPage = $state(1);
  let searchAbortController: AbortController | undefined;

  const executeSearch = async (page: number, append: boolean) => {
    const query = searchQuery.trim();
    if (!query) {
      return;
    }

    searchAbortController?.abort();
    const controller = new AbortController();
    searchAbortController = controller;

    isLoading = true;
    try {
      const { assets } = await searchSmart({
        smartSearchDto: {
          ...buildSmartSearchParams({ query, filters, spaceId, withSharedSpaces }),
          page,
          size: 100,
        },
      });

      if (controller.signal.aborted) {
        return;
      }

      if (append) {
        // Defend against pagination overlaps (e.g., backend tie-breaker gaps or
        // race-y page boundaries) so Svelte's keyed {#each} doesn't crash on duplicate IDs.
        const existingIds = new Set(searchResults.map((a) => a.id));
        const deduped = assets.items.filter((a) => !existingIds.has(a.id));
        searchResults = [...searchResults, ...deduped];
      } else {
        searchResults = assets.items;
      }
      searchPage = page;
      hasMoreResults = assets.nextPage !== null;
    } catch {
      if (controller.signal.aborted) {
        return;
      }
      searchResults = append ? searchResults : [];
      hasMoreResults = false;
    } finally {
      if (!controller.signal.aborted) {
        isLoading = false;
      }
    }
  };

  const handleLoadMore = () => {
    void executeSearch(searchPage + 1, true);
  };

  $effect(() => {
    // Track everything that should trigger a re-search
    const _ = [
      searchQuery,
      filters.personIds,
      filters.city,
      filters.country,
      filters.make,
      filters.model,
      filters.tagIds,
      filters.rating,
      filters.mediaType,
      filters.selectedYear,
      filters.selectedMonth,
      filters.sortOrder,
      filters.isFavorite,
    ];

    if (!searchQuery.trim()) {
      return;
    }

    const timeout = setTimeout(() => {
      searchPage = 1;
      void executeSearch(1, false);
    }, SEARCH_FILTER_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      searchAbortController?.abort();
    };
  });
</script>

<SpaceSearchResults
  results={searchResults}
  {isLoading}
  hasMore={hasMoreResults}
  totalLoaded={searchResults.length}
  onLoadMore={handleLoadMore}
  {spaceId}
  {isShared}
  sortMode={filters.sortOrder}
/>
