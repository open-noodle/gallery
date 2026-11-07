import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import SearchModeControl from '../search-mode-control.svelte';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('search-mode-control — rail variant', () => {
  it('renders one radio per search mode', async () => {
    await render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn() } });

    const values = (page.getByRole('radio').elements() as HTMLInputElement[]).map((radio) => radio.value);
    expect(values).toEqual(['smart', 'metadata', 'description', 'ocr']);
  });

  it('checks the radio matching the active mode', async () => {
    await render(SearchModeControl, { props: { variant: 'rail', mode: 'description', onSelect: vi.fn() } });

    const radios = page.getByRole('radio').elements() as HTMLInputElement[];
    expect(radios.find((radio) => radio.checked)?.value).toBe('description');
  });

  it('calls onSelect with the clicked mode', async () => {
    const onSelect = vi.fn();
    await render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect } });

    const radios = page.getByRole('radio').elements() as HTMLInputElement[];
    await userEvent.click(radios.find((radio) => radio.value === 'ocr')!);

    expect(onSelect).toHaveBeenCalledWith('ocr');
  });

  it('labels the group so the control is identifiable without sighted context', async () => {
    await render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn() } });

    await expect.element(page.getByRole('radiogroup', { name: 'Search mode' })).toBeInTheDocument();
  });
});

describe('search-mode-control — chip variant', () => {
  it('names the active mode on the trigger, so the mode is legible while the menu is shut', async () => {
    await render(SearchModeControl, { props: { variant: 'chip', mode: 'ocr', onSelect: vi.fn() } });

    await expect.element(page.getByRole('button', { name: 'Search mode: OCR' })).toBeInTheDocument();
  });

  it('keeps the menu shut until the trigger is clicked', async () => {
    await render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn() } });

    await expect.element(page.getByRole('menuitemradio')).not.toBeInTheDocument();
  });

  it('opens a menu with one item per search mode', async () => {
    await render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn() } });

    await userEvent.click(page.getByRole('button', { name: 'Search mode: Smart' }));

    expect(
      page
        .getByRole('menuitemradio')
        .elements()
        .map((item) => item.textContent?.trim()),
    ).toEqual(['Smart', 'Filename', 'Description', 'OCR']);
  });

  it('marks the active mode as checked in the open menu', async () => {
    await render(SearchModeControl, { props: { variant: 'chip', mode: 'metadata', onSelect: vi.fn() } });

    await userEvent.click(page.getByRole('button', { name: 'Search mode: Filename' }));

    const checked = page
      .getByRole('menuitemradio')
      .elements()
      .filter((item) => item.getAttribute('aria-checked') === 'true');
    expect(checked.map((item) => item.textContent?.trim())).toEqual(['Filename']);
  });

  it('calls onSelect with the chosen mode', async () => {
    const onSelect = vi.fn();
    await render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect } });

    await userEvent.click(page.getByRole('button', { name: 'Search mode: Smart' }));
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Description' }));

    expect(onSelect).toHaveBeenCalledWith('description');
  });

  it('closes the menu once a mode is chosen', async () => {
    await render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn() } });

    await userEvent.click(page.getByRole('button', { name: 'Search mode: Smart' }));
    await userEvent.click(page.getByRole('menuitemradio', { name: 'Description' }));

    await expect.element(page.getByRole('menuitemradio')).not.toBeInTheDocument();
  });
});

describe('search-mode-control — chip menu dismissal', () => {
  const openMenu = async () => {
    await render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn() } });
    await userEvent.click(page.getByRole('button', { name: 'Search mode: Smart' }));
    await expect.element(page.getByRole('menu')).toBeInTheDocument();
  };

  it('closes when a click lands outside the control', async () => {
    await openMenu();

    await userEvent.click(document.body);

    await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    await openMenu();

    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
  });

  // The chip sits inside the search field, which is wrapped in a `clickOutside` action
  // whose `onEscape` closes the whole palette. Without stopping propagation, dismissing
  // the menu would tear down the search around it.
  it('keeps Escape from reaching the surrounding palette', async () => {
    const onEscapeOutside = vi.fn();
    document.addEventListener('keydown', onEscapeOutside);

    try {
      await openMenu();
      await userEvent.keyboard('{Escape}');

      expect(onEscapeOutside).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onEscapeOutside);
    }
  });

  // Same reasoning as Escape, for the rest of the keys the palette acts on. `Command.Root`'s
  // onKeyDown treats Enter as "run the top search" and the arrows as "move the result
  // selection", so a key aimed at this menu must not reach it — pressing Enter to pick a
  // mode would otherwise also fire activateSearch and navigate away.
  it.each(['{Enter}', '{ArrowDown}', '{ArrowUp}', '{Home}', '{End}'])(
    'keeps %s from reaching the surrounding palette',
    async (key) => {
      const onKeyOutside = vi.fn();
      document.addEventListener('keydown', onKeyOutside);

      try {
        await openMenu();
        await userEvent.keyboard(key);

        expect(onKeyOutside).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', onKeyOutside);
      }
    },
  );

  it('still selects a mode when Enter activates a menu item', async () => {
    const onSelect = vi.fn();
    await render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect } });

    await userEvent.click(page.getByRole('button', { name: 'Search mode: Smart' }));
    (page.getByRole('menuitemradio', { name: 'OCR' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('ocr');
  });

  it('moves focus down the menu with ArrowDown', async () => {
    await openMenu();

    await userEvent.keyboard('{ArrowDown}');

    expect(document.activeElement).toBe(page.getByRole('menuitemradio', { name: 'Smart' }).element());
  });

  it('wraps from the last item back to the first', async () => {
    await openMenu();

    (page.getByRole('menuitemradio', { name: 'OCR' }).element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(document.activeElement).toBe(page.getByRole('menuitemradio', { name: 'Smart' }).element());
  });

  it('lets Escape through when the menu is already closed', async () => {
    const onEscapeOutside = vi.fn();
    document.addEventListener('keydown', onEscapeOutside);

    try {
      await render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn() } });
      (page.getByRole('button', { name: 'Search mode: Smart' }).element() as HTMLElement).focus();
      await userEvent.keyboard('{Escape}');

      expect(onEscapeOutside).toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onEscapeOutside);
    }
  });
});

describe('search-mode-control — prefix scope', () => {
  // `GlobalSearchManager.setMode` short-circuits under a prefix scope, so the control
  // has to say so. It must NOT disable the inputs though: the footer this replaces
  // deliberately kept them focusable so a keyboard user can still queue up a mode for
  // once the prefix is cleared.
  it('marks the rail as scoped', async () => {
    await render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn(), scoped: true } });

    await expect.element(page.getByTestId('search-mode-rail')).toHaveAttribute('data-scoped', 'true');
  });

  it('marks the chip as scoped', async () => {
    await render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn(), scoped: true } });

    await expect.element(page.getByTestId('search-mode-chip-trigger')).toHaveAttribute('data-scoped', 'true');
  });

  it('leaves every mode operable while scoped', async () => {
    await render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn(), scoped: true } });

    for (const radio of page.getByRole('radio').elements() as HTMLInputElement[]) {
      expect(radio.disabled).toBe(false);
      await expect.element(page.elementLocator(radio)).not.toHaveAttribute('aria-disabled');
    }
  });

  it('is unscoped by default', async () => {
    await render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn() } });

    await expect.element(page.getByTestId('search-mode-rail')).toHaveAttribute('data-scoped', 'false');
  });
});

describe('search-mode-control — smart search unavailable', () => {
  it('flags the smart option in the rail when machine learning is down', async () => {
    await render(SearchModeControl, {
      props: { variant: 'rail', mode: 'metadata', onSelect: vi.fn(), smartUnavailable: true },
    });

    await expect
      .element(page.getByTestId('search-mode-option-smart'))
      .toHaveAttribute('title', 'Smart search is unavailable');
  });

  it('flags the smart option in the chip menu when machine learning is down', async () => {
    await render(SearchModeControl, {
      props: { variant: 'chip', mode: 'metadata', onSelect: vi.fn(), smartUnavailable: true },
    });

    await userEvent.click(page.getByRole('button', { name: 'Search mode: Filename' }));

    await expect
      .element(page.getByTestId('search-mode-option-smart'))
      .toHaveAttribute('title', 'Smart search is unavailable');
  });

  it('leaves the other modes unflagged', async () => {
    await render(SearchModeControl, {
      props: { variant: 'rail', mode: 'metadata', onSelect: vi.fn(), smartUnavailable: true },
    });

    for (const value of ['metadata', 'description', 'ocr']) {
      await expect.element(page.getByTestId(`search-mode-option-${value}`)).not.toHaveAttribute('title');
    }
  });

  it('flags nothing while smart search is healthy', async () => {
    await render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn() } });

    await expect.element(page.getByTestId('search-mode-option-smart')).not.toHaveAttribute('title');
  });
});
