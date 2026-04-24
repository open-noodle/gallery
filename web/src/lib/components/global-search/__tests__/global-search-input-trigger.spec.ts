import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalSearchInputTrigger from '../global-search-input-trigger.svelte';

const { mockPage } = vi.hoisted(() => ({
  mockPage: {
    url: new URL('https://gallery.test/photos'),
    route: { id: null as string | null },
    params: {} as Record<string, string>,
  },
}));

vi.mock('$app/state', () => ({ page: mockPage }));

describe('global-search-input-trigger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPage.url = new URL('https://gallery.test/photos');
    mockPage.route.id = null;
    mockPage.params = {};
  });

  it('opens cmdk on click and keyboard activation', async () => {
    const openSpy = vi.spyOn(globalSearchManager, 'open').mockImplementation(() => {});
    const user = userEvent.setup();

    render(GlobalSearchInputTrigger);

    const button = screen.getByTestId('cmdk-input-trigger');
    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');

    expect(openSpy).toHaveBeenCalledTimes(2);
  });

  it('renders the placeholder and hotkey hint', () => {
    render(GlobalSearchInputTrigger);

    expect(screen.getByTestId('cmdk-input-trigger')).toBeInTheDocument();
    expect(screen.getByText('cmdk_placeholder')).toBeInTheDocument();
    expect(screen.getByText(/^(⌘K|Ctrl\+K)$/)).toBeInTheDocument();
  });

  it('shows the sort dropdown on the photos page when a query is active', () => {
    mockPage.url = new URL('https://gallery.test/photos?q=mountain&sort=asc');

    render(GlobalSearchInputTrigger);

    expect(screen.getByTestId('search-sort-btn')).toHaveTextContent(/oldest first/i);
  });

  it('shows the sort dropdown on a space detail page when a query is active', () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-123?q=mountain');

    render(GlobalSearchInputTrigger);

    expect(screen.getByTestId('search-sort-btn')).toHaveTextContent(/relevance/i);
  });

  it('hides the sort dropdown when there is no active page query', () => {
    mockPage.url = new URL('https://gallery.test/photos');

    render(GlobalSearchInputTrigger);

    expect(screen.queryByTestId('search-sort-btn')).not.toBeInTheDocument();
  });

  it('applies sort immediately from the top-bar trigger', async () => {
    mockPage.url = new URL('https://gallery.test/photos?q=mountain');
    const applySortSpy = vi.spyOn(globalSearchManager, 'applySearchSort').mockResolvedValue();
    const user = userEvent.setup();

    render(GlobalSearchInputTrigger);

    await user.click(screen.getByTestId('search-sort-btn'));
    await user.click(screen.getByText('Newest first'));

    expect(applySortSpy).toHaveBeenCalledWith('desc', 'mountain');
  });
});
