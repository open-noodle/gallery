import { AssetOrder } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';
import SmartSearchResultsRerunHost from '$lib/components/search/smart-search-results-rerun.test-host.svelte';
import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
import SmartSearchResultsHost from '$lib/components/search/smart-search-results.test-host.svelte';
import { SEARCH_FILTER_DEBOUNCE_MS } from '$lib/utils/space-search';

const searchSmartMock = vi.fn();
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, searchSmart: (...args: unknown[]) => searchSmartMock(...args) };
});

const baseFilters: FilterState = {
  personIds: [],
  tagIds: [],
  mediaType: 'all',
  sortOrder: 'relevance',
};

const baseProps = {
  searchQuery: 'beach',
  filters: baseFilters,
  isShared: false,
  withSharedSpaces: true,
  language: 'en',
};

const mockEmptyResult = { assets: { items: [], nextPage: null } };

/**
 * The shared mock never invokes its callback, so the infinite-scroll sentinel can't be driven from a
 * test. Capture the callbacks instead — the newest belongs to the live sentinel — so paging can be
 * exercised alongside the search-clearing behaviour it shares state with.
 */
let intersectionCallbacks: IntersectionObserverCallback[] = [];

const getCapturingIntersectionObserverMock = () =>
  vi.fn(function (callback: IntersectionObserverCallback) {
    intersectionCallbacks.push(callback);
    return { disconnect: vi.fn(), observe: vi.fn(), takeRecords: vi.fn(), unobserve: vi.fn() };
  });

const scrollToLoadMore = async () => {
  const callback = intersectionCallbacks.at(-1);
  expect(callback).toBeDefined();
  callback!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  await vi.advanceTimersByTimeAsync(0);
};

describe('SmartSearchResults', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    intersectionCallbacks = [];
    vi.stubGlobal('IntersectionObserver', getCapturingIntersectionObserverMock());
    searchSmartMock.mockReset();
    searchSmartMock.mockResolvedValue(mockEmptyResult);
  });

  // Test 38
  it('schedules exactly one fetch on mount with non-empty query', async () => {
    render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);
  });

  // Test 39
  it('does not fetch on mount with empty query', async () => {
    render(SmartSearchResults, { props: { ...baseProps, searchQuery: '' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(searchSmartMock).not.toHaveBeenCalled();
  });

  // Test 40
  it('triggers a new fetch when searchQuery changes, aborting the previous', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);

    await rerender({ ...baseProps, searchQuery: 'mountain' });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(2);
    // Verify the second call had the new query
    expect(searchSmartMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ query: 'mountain' }) }),
    );
  });

  // Test 41
  it('triggers a debounced re-fetch when filters change', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);

    await rerender({ ...baseProps, filters: { ...baseFilters, city: 'Berlin' } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(2);
    expect(searchSmartMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ city: 'Berlin' }) }),
    );
  });

  it('forwards language and refetches when language changes', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    expect(searchSmartMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ language: 'en' }) }),
    );

    await rerender({ ...baseProps, language: 'de' });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    expect(searchSmartMock).toHaveBeenCalledTimes(2);
    expect(searchSmartMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ language: 'de' }) }),
    );
  });

  it('triggers re-fetch when custom date range changes', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);

    await rerender({ ...baseProps, filters: { ...baseFilters, dateAfter: '2024-01-01' } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    expect(searchSmartMock).toHaveBeenCalledTimes(2);
    expect(searchSmartMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        smartSearchDto: expect.objectContaining({ takenAfter: '2024-01-01T00:00:00.000Z' }),
      }),
    );
  });

  // Test 42
  it('debounces multiple consecutive filter changes within the window into a single fetch', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);

    // 5 rapid filter changes within the debounce window
    for (let i = 0; i < 5; i++) {
      await rerender({ ...baseProps, filters: { ...baseFilters, rating: i + 1 } });
      await vi.advanceTimersByTimeAsync(50); // < debounce window
    }
    // Final advance past the debounce window
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    // Initial mount (1) + one debounced fetch (1) = 2 total
    expect(searchSmartMock).toHaveBeenCalledTimes(2);
  });

  // Test 43
  it('debounce boundary: 249ms does not fire, 250ms does', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);

    await rerender({ ...baseProps, filters: { ...baseFilters, city: 'Berlin' } });
    await vi.advanceTimersByTimeAsync(249);
    expect(searchSmartMock).toHaveBeenCalledTimes(1); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(searchSmartMock).toHaveBeenCalledTimes(2); // now
  });

  // Test 44
  it('does not fetch when filters change while searchQuery is empty', async () => {
    const { rerender } = render(SmartSearchResults, { props: { ...baseProps, searchQuery: '' } });
    await rerender({ ...baseProps, searchQuery: '', filters: { ...baseFilters, city: 'Berlin' } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).not.toHaveBeenCalled();
  });

  // Test 45
  it('triggers re-fetch with order=Asc when sortOrder changes from relevance to asc', async () => {
    const { rerender } = render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    await rerender({ ...baseProps, filters: { ...baseFilters, sortOrder: 'asc' } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    expect(searchSmartMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ order: AssetOrder.Asc }) }),
    );
  });

  // Test 46
  it('triggers re-fetch with order omitted when sortOrder changes from asc to relevance', async () => {
    const { rerender } = render(SmartSearchResults, {
      props: { ...baseProps, filters: { ...baseFilters, sortOrder: 'asc' } },
    });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    await rerender({ ...baseProps, filters: { ...baseFilters, sortOrder: 'relevance' } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    const lastCall = searchSmartMock.mock.lastCall;
    expect(lastCall).toBeDefined();
    expect(lastCall![0].smartSearchDto.order).toBeUndefined();
  });

  // Test 49
  it.todo('loadMore while another loadMore is in flight: abort first, second wins');

  // Test 52 — cooperative abort on unmount, NOT SDK signal propagation.
  // The wrapper uses cooperative abort (checks `controller.signal.aborted` *after*
  // the await and discards stale results). A meaningful assertion would need to
  // observe that `searchResults`/`isLoading` don't change after unmount, but
  // Svelte 5's runtime tolerates writes to unmounted state and there's no
  // observable signal via testing-library to catch a silent write. Covered
  // indirectly by the E2E abort behavior. Left as todo until we can spy on
  // an observable side effect.
  it.todo('discards results from in-flight request after wrapper unmounts');

  // Test 53
  it('catches backend errors and surfaces empty results without crashing', async () => {
    searchSmartMock.mockRejectedValueOnce(new Error('Smart search is not enabled'));
    render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    // No exception thrown, component still rendered
    expect(searchSmartMock).toHaveBeenCalledTimes(1);
  });

  // Test 54
  it('handles empty results (0 items) without crashing', async () => {
    searchSmartMock.mockResolvedValue(mockEmptyResult);
    render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    // Should render the dumb grid with 0 results
  });

  // Test 55
  it('forwards spaceId to buildSmartSearchParams when set', async () => {
    render(SmartSearchResults, { props: { ...baseProps, spaceId: 'space-1', withSharedSpaces: undefined } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ spaceId: 'space-1' }) }),
    );
  });

  // Test 56
  it('forwards withSharedSpaces to buildSmartSearchParams when spaceId is undefined', async () => {
    render(SmartSearchResults, { props: { ...baseProps, withSharedSpaces: true } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ withSharedSpaces: true }) }),
    );
  });

  it('forwards the route album scope to buildSmartSearchParams', async () => {
    render(SmartSearchResults, { props: { ...baseProps, albumIds: ['album-1'] } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ albumIds: ['album-1'] }) }),
    );
  });

  // Hosts pass `$derived([album.id])`, and Svelte's derived compares with `===`, so every unrelated
  // `album` reassignment (a rename, the `refreshAlbum()` after a delete) mints a fresh array. Track
  // that identity and each of those discards the loaded pages and re-runs the whole vector search.
  //
  // Driven through a HOST component, not `rerender`: rerender re-fires the mount effect even for
  // literally identical props, so it cannot tell the bug from the harness.
  it('does not re-search when the host re-derives the album scope without changing it', async () => {
    render(SmartSearchResultsHost, { props: { album: { id: 'album-1', name: 'a' }, filters: baseFilters } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    expect(searchSmartMock).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByTestId('host-rename-album'));
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    expect(searchSmartMock).toHaveBeenCalledTimes(1);
  });

  it('re-searches when the album scope actually changes', async () => {
    render(SmartSearchResultsHost, { props: { album: { id: 'album-1', name: 'a' }, filters: baseFilters } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    await fireEvent.click(screen.getByTestId('host-switch-album'));
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    expect(searchSmartMock).toHaveBeenCalledTimes(2);
    expect(searchSmartMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ smartSearchDto: expect.objectContaining({ albumIds: ['album-2'] }) }),
    );
  });

  it('omits albumIds entirely when no album scope is given', async () => {
    render(SmartSearchResults, { props: baseProps });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
    const dto = searchSmartMock.mock.calls[0][0].smartSearchDto as Record<string, unknown>;
    expect(dto).not.toHaveProperty('albumIds');
  });

  // #1028: the space shell collapses its cover as the reader scrolls the results, and the only
  // scrolling element lives inside the grid this component wraps.
  it('forwards scroll reports from the result grid to the host', async () => {
    const onScroll = vi.fn();
    const { getByTestId } = render(SmartSearchResults, { props: { ...baseProps, onScroll } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    const scroller = getByTestId('search-results-scroller');
    Object.defineProperty(scroller, 'scrollTop', { value: 180, configurable: true });
    await fireEvent.scroll(scroller);

    expect(onScroll).toHaveBeenCalledWith(180);
  });

  it('forwards route-provided exact total to the result grid', async () => {
    searchSmartMock.mockResolvedValueOnce({
      assets: {
        items: [{ id: 'asset-1', originalFileName: 'photo.jpg' }],
        nextPage: '2',
      },
    });

    const { getByTestId } = render(SmartSearchResults, { props: { ...baseProps, total: 42 } });
    await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

    expect(getByTestId('result-count')).toHaveTextContent('spaces_search_result_count');
  });

  // #1052: a new search must blank the grid the moment it is triggered. Until it did, the previous
  // query's photos stayed on screen — keeping their scroll offset — for the debounce plus the whole
  // round trip, and a host remount replayed them from scratch.
  describe('clearing previous results (#1052)', () => {
    const asset = (id: string) => ({ id, originalFileName: `${id}.jpg` });
    const page = (ids: string[], nextPage: string | null = null) => ({
      assets: { items: ids.map((id) => asset(id)), nextPage },
    });

    /** The assets the host currently holds — the grid itself virtualizes to nothing under happy-dom. */
    const resultIds = () => screen.getByTestId('host-result-ids').textContent;

    const renderHost = async () => {
      searchSmartMock.mockResolvedValue(page(['asset-1']));
      render(SmartSearchResultsRerunHost, { props: { filters: baseFilters } });
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
      expect(resultIds()).toBe('asset-1');
    };

    it('blanks the previous results as soon as a new query is submitted', async () => {
      await renderHost();

      await fireEvent.click(screen.getByTestId('host-new-search'));

      // Deliberately no timer advance: the old results must be gone *before* the replacement lands.
      expect(resultIds()).toBe('');
      expect(screen.getByTestId('search-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('result-count')).not.toBeInTheDocument();
    });

    it('blanks the previous results as soon as a filter change re-runs the search', async () => {
      await renderHost();

      await fireEvent.click(screen.getByTestId('host-add-filter'));

      expect(resultIds()).toBe('');
      expect(screen.getByTestId('search-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('result-count')).not.toBeInTheDocument();
    });

    it('does not replay the previous search when the host re-mounts it for a new query', async () => {
      await renderHost();

      // Clearing the query unmounts the component, but the host keeps the loaded assets.
      await fireEvent.click(screen.getByTestId('host-clear-search'));
      await fireEvent.click(screen.getByTestId('host-new-search'));

      expect(resultIds()).toBe('');
      expect(screen.getByTestId('search-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('result-count')).not.toBeInTheDocument();
    });

    it('stays blank for the whole debounce window, not just the first tick', async () => {
      await renderHost();

      await fireEvent.click(screen.getByTestId('host-new-search'));
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS - 1);

      expect(resultIds()).toBe('');
      expect(searchSmartMock).toHaveBeenCalledTimes(1);
    });

    // The blanked grid must show the spinner, not the empty state. Every searchable page resets its
    // own `isLoading` to false in the same block that commits the new query, so the component has to
    // re-assert loading afterwards — otherwise a new search flashes "no results" before it resolves,
    // which reads as a worse bug than the stale results #1052 is about.
    it('shows the loading state, not the empty state, when the host commits a search from the URL', async () => {
      await renderHost();

      await fireEvent.click(screen.getByTestId('host-commit-url-search'));

      expect(resultIds()).toBe('');
      expect(screen.getByTestId('search-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('search-empty')).not.toBeInTheDocument();
    });

    it('keeps the current results on screen while a reload re-runs the same search', async () => {
      await renderHost();

      await fireEvent.click(screen.getByTestId('host-reload'));

      // A reload restores results after an undone delete — same search, so nothing to blank.
      expect(resultIds()).toBe('asset-1');
      expect(screen.getByTestId('result-count')).toBeInTheDocument();
      expect(screen.queryByTestId('search-loading')).not.toBeInTheDocument();
    });

    it('shows the new results once they arrive', async () => {
      await renderHost();

      searchSmartMock.mockResolvedValue(page(['asset-2']));
      await fireEvent.click(screen.getByTestId('host-new-search'));
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

      expect(resultIds()).toBe('asset-2');
      expect(screen.getByTestId('result-count')).toBeInTheDocument();
      expect(screen.queryByTestId('search-loading')).not.toBeInTheDocument();
      expect(searchSmartMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ smartSearchDto: expect.objectContaining({ query: 'mountain' }) }),
      );
    });

    it('does not restore the previous results while the new search is in flight', async () => {
      await renderHost();

      let resolveSecond: (value: unknown) => void = () => {};
      searchSmartMock.mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));

      await fireEvent.click(screen.getByTestId('host-new-search'));
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
      expect(resultIds()).toBe('');

      resolveSecond(page(['asset-2']));
      await vi.advanceTimersByTimeAsync(0);
      expect(resultIds()).toBe('asset-2');
    });

    it('ignores a late response from the query that was replaced', async () => {
      let resolveFirst: (value: unknown) => void = () => {};
      searchSmartMock.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
      searchSmartMock.mockResolvedValue(page(['asset-2']));

      render(SmartSearchResultsRerunHost, { props: { filters: baseFilters } });
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

      await fireEvent.click(screen.getByTestId('host-new-search'));
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
      expect(resultIds()).toBe('asset-2');

      // The abandoned query answers last; it must not overwrite the search now on screen.
      resolveFirst(page(['asset-1']));
      await vi.advanceTimersByTimeAsync(0);
      expect(resultIds()).toBe('asset-2');
    });

    it('leaves the results blank when the new search fails', async () => {
      await renderHost();

      searchSmartMock.mockRejectedValueOnce(new Error('smart search is not enabled'));
      await fireEvent.click(screen.getByTestId('host-new-search'));
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

      expect(resultIds()).toBe('');
      expect(screen.getByTestId('search-empty')).toBeInTheDocument();
    });

    it('restarts pagination at page 1 after a new query, discarding the loaded pages', async () => {
      searchSmartMock.mockResolvedValueOnce(page(['asset-1'], '2'));
      render(SmartSearchResultsRerunHost, { props: { filters: baseFilters } });
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

      searchSmartMock.mockResolvedValueOnce(page(['asset-2'], null));
      await scrollToLoadMore();
      expect(resultIds()).toBe('asset-1,asset-2');

      searchSmartMock.mockResolvedValue(page(['asset-9']));
      await fireEvent.click(screen.getByTestId('host-new-search'));
      expect(resultIds()).toBe('');
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

      expect(resultIds()).toBe('asset-9');
      expect(searchSmartMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ smartSearchDto: expect.objectContaining({ page: 1, query: 'mountain' }) }),
      );
    });

    it('appends the next page without blanking what is already loaded', async () => {
      searchSmartMock.mockResolvedValueOnce(page(['asset-1'], '2'));
      render(SmartSearchResultsRerunHost, { props: { filters: baseFilters } });
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

      searchSmartMock.mockResolvedValueOnce(page(['asset-2'], null));
      await scrollToLoadMore();

      // Paging is an append, not a new search — the first page must survive it.
      expect(resultIds()).toBe('asset-1,asset-2');
      expect(searchSmartMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ smartSearchDto: expect.objectContaining({ page: 2 }) }),
      );
    });

    // Test 51 — the dangerous ordering: an append is in flight when the query changes, so its
    // response could land on top of the freshly blanked grid and mix two searches together.
    it('discards a page that was still loading when a new query replaced the search', async () => {
      searchSmartMock.mockResolvedValueOnce(page(['asset-1'], '2'));
      render(SmartSearchResultsRerunHost, { props: { filters: baseFilters } });
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

      let resolvePage2: (value: unknown) => void = () => {};
      searchSmartMock.mockImplementationOnce(() => new Promise((resolve) => (resolvePage2 = resolve)));
      await scrollToLoadMore();
      expect(resultIds()).toBe('asset-1');

      searchSmartMock.mockResolvedValue(page(['asset-9']));
      await fireEvent.click(screen.getByTestId('host-new-search'));
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

      resolvePage2(page(['asset-2'], null));
      await vi.advanceTimersByTimeAsync(0);

      expect(resultIds()).toBe('asset-9');
    });

    it('blanks the previous album scope results when the host switches album', async () => {
      searchSmartMock.mockResolvedValue(page(['asset-1']));
      render(SmartSearchResultsHost, { props: { album: { id: 'album-1', name: 'a' }, filters: baseFilters } });
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);
      expect(screen.getByTestId('result-count')).toBeInTheDocument();

      await fireEvent.click(screen.getByTestId('host-switch-album'));

      expect(screen.getByTestId('search-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('result-count')).not.toBeInTheDocument();
    });

    it('does not blank when the host re-derives the album scope without changing it', async () => {
      searchSmartMock.mockResolvedValue(page(['asset-1']));
      render(SmartSearchResultsHost, { props: { album: { id: 'album-1', name: 'a' }, filters: baseFilters } });
      await vi.advanceTimersByTimeAsync(SEARCH_FILTER_DEBOUNCE_MS);

      await fireEvent.click(screen.getByTestId('host-rename-album'));

      expect(screen.getByTestId('result-count')).toBeInTheDocument();
      expect(screen.queryByTestId('search-loading')).not.toBeInTheDocument();
    });
  });

  // Test 57 — render assertion for isShared on the dumb grid
  it.todo('forwards isShared prop to the dumb grid render');

  // Test 57b — bindable isLoading
  it.todo('isLoading $bindable propagates to parent before/after fetch');
});
