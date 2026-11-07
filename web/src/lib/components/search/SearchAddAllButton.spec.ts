import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SearchAddAllButton from './SearchAddAllButton.svelte';

describe('SearchAddAllButton', () => {
  it('renders nothing when total is 0', async () => {
    const screen = await render(SearchAddAllButton, { total: 0, onclick: vi.fn() });
    expect(screen.getByTestId('add-all-to-collection').query()).toBeNull();
  });

  it('renders the button and fires onclick when total > 0', async () => {
    const onclick = vi.fn();
    const screen = await render(SearchAddAllButton, { total: 42, onclick });
    await screen.getByTestId('add-all-to-collection').click();
    expect(onclick).toHaveBeenCalledOnce();
  });
});
