import { sdkMock } from '$lib/__mocks__/sdk.mock';
import SpaceSearch from '$lib/components/spaces/space-search.svelte';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

describe('SpaceSearch component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should show search bar initially', () => {
    render(SpaceSearch, { spaceId: 'space-1' });
    expect(screen.getByPlaceholderText('search')).toBeInTheDocument();
  });

  it('should show search results after submitting a query', async () => {
    sdkMock.searchSmart.mockResolvedValue({
      assets: {
        items: [{ id: 'asset-1', originalFileName: 'photo.jpg' }],
        total: 1,
        count: 1,
        facets: [],
        nextPage: null,
      },
    } as any);

    render(SpaceSearch, { spaceId: 'space-1' });
    const user = userEvent.setup();

    const input = screen.getByPlaceholderText('search');
    await user.type(input, 'sunset');
    await user.keyboard('{Enter}');

    expect(sdkMock.searchSmart).toHaveBeenCalledWith({
      smartSearchDto: { query: 'sunset', spaceId: 'space-1' },
    });

    expect(await screen.findByText('1 results')).toBeInTheDocument();
  });

  it('should show search bar after search, clear, and empty submit', async () => {
    sdkMock.searchSmart.mockResolvedValue({
      assets: {
        items: [],
        total: 0,
        count: 0,
        facets: [],
        nextPage: null,
      },
    } as any);

    render(SpaceSearch, { spaceId: 'space-1' });
    const user = userEvent.setup();

    // Step 1: Type something and submit
    const input = screen.getByPlaceholderText('search');
    await user.type(input, 'cats');
    await user.keyboard('{Enter}');

    // Wait for search to complete
    await screen.findByText('search_no_result');

    // Step 2: Clear the search bar
    await user.clear(input);

    // Step 3: Submit empty search
    await user.keyboard('{Enter}');

    // The search bar should still be visible and functional
    expect(screen.getByPlaceholderText('search')).toBeInTheDocument();
    // The "no results" message should be gone (back to default view)
    expect(screen.queryByText('search_no_result')).not.toBeInTheDocument();
  });

  it('should restore space view after search with no results then clearing', async () => {
    const onSearchStateChange = vi.fn();

    sdkMock.searchSmart.mockResolvedValue({
      assets: { items: [], total: 0, count: 0, facets: [], nextPage: null },
    } as any);

    render(SpaceSearch, { spaceId: 'space-1', onSearchStateChange });
    const user = userEvent.setup();

    // 1. Initially no search results overlay (space photos visible)
    expect(screen.queryByText('search_no_result')).not.toBeInTheDocument();
    expect(onSearchStateChange).not.toHaveBeenCalled();

    // 2. Search for something that doesn't exist
    const input = screen.getByPlaceholderText('search');
    await user.type(input, 'nonexistent');
    await user.keyboard('{Enter}');

    // 3. Validate search results shown (space photos hidden)
    expect(await screen.findByText('search_no_result')).toBeInTheDocument();
    expect(onSearchStateChange).toHaveBeenCalledWith(true);

    // 4. Clear search bar and submit empty
    await user.clear(input);
    await user.keyboard('{Enter}');

    // 5. Validate space view restored (space photos visible again)
    expect(screen.queryByText('search_no_result')).not.toBeInTheDocument();
    expect(onSearchStateChange).toHaveBeenCalledWith(false);
  });

  it('should allow searching again after clearing', async () => {
    sdkMock.searchSmart
      .mockResolvedValueOnce({
        assets: { items: [], total: 0, count: 0, facets: [], nextPage: null },
      } as any)
      .mockResolvedValueOnce({
        assets: {
          items: [{ id: 'asset-2', originalFileName: 'dog.jpg' }],
          total: 1,
          count: 1,
          facets: [],
          nextPage: null,
        },
      } as any);

    render(SpaceSearch, { spaceId: 'space-1' });
    const user = userEvent.setup();

    // First search - no results
    const input = screen.getByPlaceholderText('search');
    await user.type(input, 'cats');
    await user.keyboard('{Enter}');
    await screen.findByText('search_no_result');

    // Clear and search again
    await user.clear(input);
    await user.keyboard('{Enter}');

    // Search bar still there
    expect(screen.getByPlaceholderText('search')).toBeInTheDocument();

    // New search
    await user.type(input, 'dogs');
    await user.keyboard('{Enter}');

    // Should show new results
    expect(await screen.findByText('1 results')).toBeInTheDocument();
  });
});
