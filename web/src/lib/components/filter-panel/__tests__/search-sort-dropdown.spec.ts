import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import SearchSortDropdown from '../search-sort-dropdown.svelte';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('SearchSortDropdown', () => {
  it('should render with current sort mode label', async () => {
    await render(SearchSortDropdown, { sortOrder: 'relevance', onSelect: vi.fn() });
    await expect.element(page.getByTestId('search-sort-btn')).toHaveTextContent('Relevance');
  });

  it('should show Newest first label for desc', async () => {
    await render(SearchSortDropdown, { sortOrder: 'desc', onSelect: vi.fn() });
    await expect.element(page.getByTestId('search-sort-btn')).toHaveTextContent('Newest first');
  });

  it('should show Oldest first label for asc', async () => {
    await render(SearchSortDropdown, { sortOrder: 'asc', onSelect: vi.fn() });
    await expect.element(page.getByTestId('search-sort-btn')).toHaveTextContent('Oldest first');
  });

  it('should open dropdown and show all options on click', async () => {
    await render(SearchSortDropdown, { sortOrder: 'relevance', onSelect: vi.fn() });
    await userEvent.click(page.getByTestId('search-sort-btn'));
    // 'Relevance' appears in both button and dropdown
    await expect.poll(() => page.getByText('Relevance').elements()).toHaveLength(2);
    await expect.element(page.getByText('Newest first')).toBeInTheDocument();
    await expect.element(page.getByText('Oldest first')).toBeInTheDocument();
  });

  it('should call onSelect with correct value', async () => {
    const onSelect = vi.fn();
    await render(SearchSortDropdown, { sortOrder: 'relevance', onSelect });
    await userEvent.click(page.getByTestId('search-sort-btn'));
    await userEvent.click(page.getByText('Newest first'));
    expect(onSelect).toHaveBeenCalledWith('desc');
  });

  it('should omit the relevance option when showRelevance is false', async () => {
    await render(SearchSortDropdown, { sortOrder: 'desc', onSelect: vi.fn(), showRelevance: false });
    await userEvent.click(page.getByTestId('search-sort-btn'));
    await expect.poll(() => page.getByText('Newest first').elements()).toHaveLength(2);
    expect(page.getByText('Relevance').query()).toBeNull();
    await expect.element(page.getByText('Oldest first')).toBeInTheDocument();
  });

  it('should expose the current option as an aria-label in compact mode', async () => {
    await render(SearchSortDropdown, { sortOrder: 'asc', onSelect: vi.fn(), compact: true });
    await expect.element(page.getByTestId('search-sort-btn')).toHaveAttribute('aria-label', 'Oldest first');
  });
});
