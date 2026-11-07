import { isApplePlatform } from '#lib/gallery/search/search-hotkey.ts';
import { globalSearchManager } from '#lib/managers/global-search-manager.svelte.ts';
import { storeTypedSearchNames } from '#lib/utils/typed-search/typed-search-name-cache.ts';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent, type Locator } from 'vitest/browser';
import GlobalSearchInputTrigger from '../global-search-input-trigger.svelte';

const { mockPage } = vi.hoisted(() => ({
  mockPage: {
    url: new URL('https://gallery.test/photos'),
    route: { id: null as string | null },
    params: {} as Record<string, string>,
  },
}));

vi.mock('$app/state', () => ({ page: mockPage }));

const { mediaState } = vi.hoisted(() => ({ mediaState: { pointerCoarse: false, minLg: false } }));

// A touch tap the way a browser delivers it: a cancelable `pointerdown`, then focus
// unless the handler prevented it, then pointerup and click.
const tap = async (locator: Locator) => {
  const element = locator.element() as HTMLElement;
  const down = new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, cancelable: true });
  element.dispatchEvent(down);
  if (!down.defaultPrevented) {
    element.focus();
  }
  element.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, cancelable: true }));
  element.click();
  await tick();
};

// A real click on `document.body` lands on its centre, which is inside the open
// dropdown; click a spot that is genuinely outside instead.
const clickOutside = async () => {
  const outside = document.createElement('div');
  outside.style.cssText = 'position:fixed;right:0;bottom:0;width:8px;height:8px';
  document.body.append(outside);
  await userEvent.click(outside);
  outside.remove();
};

vi.mock('#lib/stores/media-query-manager.svelte.js', () => ({
  mediaQueryManager: {
    get pointerCoarse() {
      return mediaState.pointerCoarse;
    },
    get minLg() {
      return mediaState.minLg;
    },
  },
}));

describe('global-search-input-trigger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalSearchManager.close();
    mockPage.url = new URL('https://gallery.test/photos');
    mockPage.route.id = null;
    mockPage.params = {};
    sessionStorage.clear();
    mediaState.pointerCoarse = false;
    mediaState.minLg = false;
  });

  it('opens a dropdown from an editable search field', async () => {
    const openSpy = vi.spyOn(globalSearchManager, 'open');

    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    await userEvent.click(input);
    await userEvent.type(input, 'mountain');

    expect(openSpy).toHaveBeenCalledWith('dropdown');
    await expect.element(input).toHaveValue('mountain');
    expect(document.querySelector('[data-cmdk-dropdown-panel]')).not.toBeNull();
  });

  it('renders typed filter pills while using the inline dropdown search field', async () => {
    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    await userEvent.click(input);
    await userEvent.type(input, 'person:anna');

    const dropdownPanel = document.querySelector('[data-cmdk-dropdown-panel]');

    expect(dropdownPanel).not.toBeNull();
    await expect
      .element(page.elementLocator(dropdownPanel as HTMLElement))
      .toContainElement(page.getByTestId('typed-search-token-rail'));
    await expect
      .element(page.getByTestId('typed-search-token-person'))
      .toHaveAttribute('data-status', 'pending-entity');
    await expect.element(page.getByTestId('typed-search-token-person-key')).toMatchTextContent('person');
    await expect.element(page.getByTestId('typed-search-token-person-value')).toMatchTextContent('anna');
  });

  it('keeps the dropdown panel closed until the search field receives focus', async () => {
    await render(GlobalSearchInputTrigger);

    expect(document.querySelector('[data-cmdk-dropdown-panel]')).toBeNull();

    await userEvent.click(page.getByRole('combobox', { name: 'cmdk_placeholder' }));

    expect(document.querySelector('[data-cmdk-dropdown-panel]')).not.toBeNull();
    expect(globalSearchManager.presentation).toBe('dropdown');
  });

  it('shows the committed page query while the search field is closed', async () => {
    mockPage.url = new URL('https://gallery.test/photos?q=mountains');

    await render(GlobalSearchInputTrigger);

    await expect.element(page.getByRole('combobox', { name: 'cmdk_placeholder' })).toHaveValue('mountains');
    expect(document.querySelector('[data-cmdk-dropdown-panel]')).toBeNull();
  });

  it('shows committed raw typed search text while the search field is closed', async () => {
    mockPage.url = new URL('https://gallery.test/photos?people=person-cat');
    storeTypedSearchNames(
      '/photos?people=person-cat',
      {
        personNames: new Map([['person-cat', 'cat']]),
        tagNames: new Map(),
      },
      'person:cat',
    );

    await render(GlobalSearchInputTrigger);

    await expect.element(page.getByRole('combobox', { name: 'cmdk_placeholder' })).toHaveValue('person:cat');
    expect(document.querySelector('[data-cmdk-dropdown-panel]')).toBeNull();
  });

  it('keeps committed raw typed search text after opening the inline dropdown', async () => {
    mockPage.url = new URL('https://gallery.test/photos?q=mountains&tags=tag-nature');
    storeTypedSearchNames(
      '/photos?q=mountains&tags=tag-nature',
      {
        personNames: new Map(),
        tagNames: new Map([['tag-nature', 'nature']]),
      },
      'tag:nature mountains',
    );

    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    await expect.element(input).toHaveValue('tag:nature mountains');

    await userEvent.click(input);

    await expect.element(input).toHaveValue('tag:nature mountains');
    expect(document.querySelector('[data-cmdk-dropdown-panel]')).not.toBeNull();
  });

  it('pressing Enter after clearing the top search field clears the committed search', async () => {
    mockPage.url = new URL('https://gallery.test/photos?q=mountains');
    const activateSearchSpy = vi.spyOn(globalSearchManager, 'activateSearch').mockImplementation(async () => {});

    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    await expect.element(input).toHaveValue('mountains');

    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');

    expect(activateSearchSpy).toHaveBeenCalledWith('');
  });

  it('closes the dropdown on outside click', async () => {
    await render(GlobalSearchInputTrigger);

    await userEvent.click(page.getByRole('combobox', { name: 'cmdk_placeholder' }));
    expect(document.querySelector('[data-cmdk-dropdown-panel]')).not.toBeNull();

    await clickOutside();

    expect(document.querySelector('[data-cmdk-dropdown-panel]')).toBeNull();
    expect(globalSearchManager.isOpen).toBe(false);
  });

  it('does not let the dropdown outside-click listener close the modal presentation', async () => {
    await render(GlobalSearchInputTrigger);

    globalSearchManager.open('modal');
    await clickOutside();

    expect(globalSearchManager.isOpen).toBe(true);
    expect(globalSearchManager.presentation).toBe('modal');
  });

  it('switches from dropdown to modal presentation on the keyboard launcher shortcut', async () => {
    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    await userEvent.click(input);
    expect(globalSearchManager.presentation).toBe('dropdown');

    await userEvent.keyboard(isApplePlatform() ? '{Meta>}k{/Meta}' : '{Control>}k{/Control}');

    expect(globalSearchManager.isOpen).toBe(true);
    expect(globalSearchManager.presentation).toBe('modal');
    expect(document.querySelector('[data-cmdk-dropdown-panel]')).toBeNull();
  });

  it('opens the modal palette when the search field is tapped', async () => {
    const openSpy = vi.spyOn(globalSearchManager, 'open');

    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    await tap(input);

    expect(openSpy).toHaveBeenCalledWith('modal');
    expect(globalSearchManager.presentation).toBe('modal');
    expect(document.querySelector('[data-cmdk-dropdown-panel]')).toBeNull();
  });

  it('does not focus the search field when it is tapped', async () => {
    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    await tap(input);

    await expect.element(input).not.toHaveFocus();
  });

  it('opens the inline dropdown for pen input rather than the modal', async () => {
    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    input
      .element()
      .dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'pen', bubbles: true, cancelable: true }));
    await userEvent.click(input);

    expect(globalSearchManager.presentation).toBe('dropdown');
  });

  it('opens the inline dropdown when a pointerdown carries no pointer type', async () => {
    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    input.element().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    await userEvent.click(input);

    expect(globalSearchManager.presentation).toBe('dropdown');
  });

  it('does not let focus downgrade an open modal to the inline dropdown', async () => {
    await render(GlobalSearchInputTrigger);

    globalSearchManager.open('modal');

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    (input.element() as HTMLElement).focus();

    expect(globalSearchManager.presentation).toBe('modal');
    expect(document.querySelector('[data-cmdk-dropdown-panel]')).toBeNull();
  });

  it('upgrades an already-open inline dropdown to the modal when tapped', async () => {
    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    await userEvent.click(input);
    expect(globalSearchManager.presentation).toBe('dropdown');

    await tap(input);

    expect(globalSearchManager.presentation).toBe('modal');
    expect(document.querySelector('[data-cmdk-dropdown-panel]')).toBeNull();
  });

  it('reopens the modal on a second tap after the first modal was closed', async () => {
    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    await tap(input);
    expect(globalSearchManager.presentation).toBe('modal');

    globalSearchManager.close();
    expect(globalSearchManager.isOpen).toBe(false);

    await tap(input);

    expect(globalSearchManager.isOpen).toBe(true);
    expect(globalSearchManager.presentation).toBe('modal');
    expect(document.querySelector('[data-cmdk-dropdown-panel]')).toBeNull();
  });

  it('opens the inline dropdown, not the modal, when focus arrives via Tab with no pointer event', async () => {
    await render(GlobalSearchInputTrigger);

    await userEvent.tab();

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    await expect.element(input).toHaveFocus();
    expect(globalSearchManager.presentation).toBe('dropdown');
    expect(document.querySelector('[data-cmdk-dropdown-panel]')).not.toBeNull();
  });

  it('renders the placeholder and hotkey hint', async () => {
    await render(GlobalSearchInputTrigger);

    await expect.element(page.getByTestId('cmdk-input-trigger')).toBeInTheDocument();
    await expect.element(page.getByRole('combobox', { name: 'cmdk_placeholder' })).toBeInTheDocument();
    await expect.element(page.getByText(/^(⌘K|Ctrl\+K)$/)).toBeInTheDocument();
  });

  it('shows the sort dropdown on the photos page when a query is active', async () => {
    mockPage.url = new URL('https://gallery.test/photos?q=mountain&sort=asc');

    await render(GlobalSearchInputTrigger);

    await expect.element(page.getByTestId('search-sort-btn')).toHaveAttribute('aria-label', 'search_sort_oldest');
  });

  it('shows the sort dropdown on the photos page before a query exists', async () => {
    mockPage.url = new URL('https://gallery.test/photos');

    await render(GlobalSearchInputTrigger);

    await expect.element(page.getByTestId('search-sort-btn')).toHaveAttribute('aria-label', 'search_sort_newest');
  });

  it('shows the sort dropdown on a space detail page before a query exists', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-123');

    await render(GlobalSearchInputTrigger);

    await expect.element(page.getByTestId('search-sort-btn')).toHaveAttribute('aria-label', 'search_sort_newest');
  });

  it('shows relevance on searchable pages with an active query', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-123?q=mountain');

    await render(GlobalSearchInputTrigger);

    await expect.element(page.getByTestId('search-sort-btn')).toHaveAttribute('aria-label', 'search_sort_relevance');
  });

  it('hides the sort dropdown on non-searchable pages', async () => {
    mockPage.url = new URL('https://gallery.test/albums');

    await render(GlobalSearchInputTrigger);

    await expect.element(page.getByTestId('search-sort-btn')).not.toBeInTheDocument();
  });

  it('applies sort immediately from the top-bar trigger', async () => {
    mockPage.url = new URL('https://gallery.test/photos?q=mountain');
    const applySortSpy = vi.spyOn(globalSearchManager, 'applySearchSort').mockResolvedValue();

    await render(GlobalSearchInputTrigger);

    await userEvent.click(page.getByTestId('search-sort-btn'));
    await userEvent.click(page.getByText('search_sort_newest'));

    expect(applySortSpy).toHaveBeenCalledWith('desc', 'mountain');
  });

  it('applies sort immediately before a query exists', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/space-123');
    const applySortSpy = vi.spyOn(globalSearchManager, 'applySearchSort').mockResolvedValue();

    await render(GlobalSearchInputTrigger);

    await userEvent.click(page.getByTestId('search-sort-btn'));
    await userEvent.click(page.getByText('search_sort_oldest'));

    expect(applySortSpy).toHaveBeenCalledWith('asc', '');
  });

  it('hides the keyboard hint when the pointer is coarse', async () => {
    mediaState.pointerCoarse = true;

    await render(GlobalSearchInputTrigger);

    await expect.element(page.getByText(/^(⌘K|Ctrl\+K)$/)).not.toBeInTheDocument();
  });

  it('keeps the search field usable when the keyboard hint is hidden', async () => {
    mediaState.pointerCoarse = true;

    await render(GlobalSearchInputTrigger);

    const input = page.getByRole('combobox', { name: 'cmdk_placeholder' });
    await expect.element(input).toBeInTheDocument();
    await expect.element(page.getByTestId('cmdk-input-trigger')).toBeInTheDocument();
  });

  it('shows the keyboard hint when the pointer is not coarse', async () => {
    mediaState.pointerCoarse = false;

    await render(GlobalSearchInputTrigger);

    await expect.element(page.getByText(/^(⌘K|Ctrl\+K)$/)).toBeInTheDocument();
  });
});
