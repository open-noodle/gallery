import TestWrapper from '#lib/components/TestWrapper.svelte';
import SearchBar from '#lib/elements/SearchBar.svelte';
import type { Component } from 'svelte';
import { render } from 'vitest-browser-svelte';

type SearchBarWrapperProps = {
  component: typeof SearchBar;
  componentProps: Record<string, unknown>;
};

function renderSearchBar(props: Record<string, unknown>) {
  return render(TestWrapper as Component<SearchBarWrapperProps>, {
    component: SearchBar,
    componentProps: props,
  });
}

// The blur listener reads `relatedTarget`; a real focus move cannot target a detached or arbitrary
// element, so the event is dispatched directly with the target the test needs.
const blur = (element: Element, relatedTarget: Element | null = null) =>
  element.dispatchEvent(new FocusEvent('blur', { relatedTarget }));

describe('SearchBar', () => {
  it('calls onBlurSearch when focus leaves the search bar', async () => {
    const onBlurSearch = vi.fn();
    const outsideButton = document.createElement('button');
    document.body.append(outsideButton);

    const screen = await renderSearchBar({
      name: 'beach',
      placeholder: 'Search',
      showLoadingSpinner: false,
      onBlurSearch,
    });

    blur(screen.getByPlaceholder('Search').element(), outsideButton);

    expect(onBlurSearch).toHaveBeenCalledTimes(1);
    outsideButton.remove();
  });

  it('does not call onBlurSearch when focus moves to an internal control', async () => {
    const onBlurSearch = vi.fn();

    const screen = await renderSearchBar({
      name: 'beach',
      placeholder: 'Search',
      showLoadingSpinner: false,
      onBlurSearch,
    });

    const input = screen.getByPlaceholder('Search').element();
    const clearButton = screen.getByRole('button', { name: /clear/i }).element();

    blur(input, clearButton);

    expect(onBlurSearch).not.toHaveBeenCalled();
  });

  it('does not fail when onBlurSearch is omitted', async () => {
    const screen = await renderSearchBar({
      name: 'beach',
      placeholder: 'Search',
      showLoadingSpinner: false,
    });

    expect(() => blur(screen.getByPlaceholder('Search').element())).not.toThrow();
  });
});
