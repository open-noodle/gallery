<script lang="ts">
  import SpaceSearchResults from '$lib/components/spaces/space-search-results.svelte';
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';
  import { dedupeAppend } from '$lib/utils/search-dedup';
  import { buildSmartSearchParams, SEARCH_FILTER_DEBOUNCE_MS } from '$lib/utils/space-search';
  import { searchSmart, type AssetResponseDto } from '@immich/sdk';

  interface Props {
    searchQuery: string;
    filters: FilterState;
    spaceId?: string;
    /**
     * Album scope imposed by the host route — how an album detail page narrows a page-aware search
     * to the album it is showing. Unioned with any `filters.albumId`; see `buildSmartSearchParams`.
     */
    albumIds?: string[];
    /** Shared-space surface + the caller's write capability on it — see `Timeline` (#889). */
    space?: { id: string; canWrite: boolean };
    withSharedSpaces?: boolean;
    language?: string;
    isShared: boolean;
    isLoading?: boolean;
    total?: number;
    /**
     * Loaded results, exposed so the host page's multi-select toolbar can act on them
     * (select-all, and removing/updating assets after a bulk action).
     */
    results?: AssetResponseDto[];
    /**
     * Bump to force a re-run of the current search — how a host page restores results after an
     * undone delete, since undo hands back TimelineAssets rather than full AssetResponseDtos.
     */
    reloadToken?: number;
  }

  let {
    searchQuery,
    filters,
    spaceId,
    albumIds,
    space,
    withSharedSpaces,
    language,
    isShared,
    isLoading = $bindable(false),
    total,
    results: searchResults = $bindable([]),
    reloadToken = 0,
  }: Props = $props();

  /**
   * Content key for the album scope. Hosts pass `$derived([album.id])`, and Svelte's derived
   * compares with `===`, so every unrelated `album` reassignment — a rename, the `refreshAlbum()`
   * that follows a delete — mints a fresh array. Tracking the ARRAY in the re-search effect below
   * would discard every loaded page and re-run the whole vector search on each of those. Reading it
   * through a `$derived` string collapses that to value equality: the effect only re-fires when the
   * scope genuinely changes. (Calling `.join()` inside the effect would not help — reading the prop
   * at all is what registers the dependency.)
   */
  const albumScopeKey = $derived(albumIds?.join(',') ?? '');

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
          ...buildSmartSearchParams({ query, filters, spaceId, albumIds, withSharedSpaces, language }),
          page,
          size: 100,
        },
      });

      if (controller.signal.aborted) {
        return;
      }

      // On append, dedupe by id — primary guard against duplicate rows across
      // paginated searchSmart responses. The server's ORDER BY is single-key
      // (smart_search.embedding <=>) so that vchord's ordered index scan can
      // be used; identical embeddings (byte-identical image content) can then
      // yield the same asset.id on adjacent pages. See
      // specs/2026-04-21-search-tiebreaker-design.md.
      searchResults = append ? dedupeAppend(searchResults, assets.items) : assets.items;
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

  // Re-runs the current search from page 1. Used by GalleryViewer's own delete-with-undo path;
  // a host page triggers the same thing by bumping `reloadToken`.
  const handleReload = () => {
    searchPage = 1;
    void executeSearch(1, false);
  };

  $effect(() => {
    // Track everything that should trigger a re-search
    const _ = [
      searchQuery,
      reloadToken,
      // Navigating straight from one album to a sibling keeps this component mounted and only swaps
      // the scope, so it has to re-search like any other narrowing change. Tracked by CONTENT via
      // `albumScopeKey` — see its doc comment for why the array itself must not be read here.
      albumScopeKey,
      filters.personIds,
      filters.city,
      filters.country,
      filters.make,
      filters.model,
      filters.tagIds,
      filters.rating,
      filters.mediaType,
      filters.dateAfter,
      filters.dateBefore,
      filters.selectedYear,
      filters.selectedMonth,
      filters.sortOrder,
      filters.isFavorite,
      language,
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
  bind:results={searchResults}
  {isLoading}
  hasMore={hasMoreResults}
  totalLoaded={searchResults.length}
  onLoadMore={handleLoadMore}
  onReload={handleReload}
  {spaceId}
  {space}
  {isShared}
  sortMode={filters.sortOrder}
  {total}
/>
