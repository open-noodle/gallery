import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SearchAddAllButton from './SearchAddAllButton.svelte';

describe('SearchAddAllButton', () => {
  it('renders nothing when total is 0', () => {
    render(SearchAddAllButton, { total: 0, onclick: vi.fn() });
    expect(screen.queryByTestId('add-all-to-collection')).toBeNull();
  });

  it('renders the button and fires onclick when total > 0', async () => {
    const onclick = vi.fn();
    render(SearchAddAllButton, { total: 42, onclick });
    const button = screen.getByTestId('add-all-to-collection');
    await fireEvent.click(button);
    expect(onclick).toHaveBeenCalledOnce();
  });
});
