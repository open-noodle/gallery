import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import SearchModeControl from '../search-mode-control.svelte';

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('search-mode-control — rail variant', () => {
  it('renders one radio per search mode', () => {
    render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn() } });

    const values = (screen.getAllByRole('radio') as HTMLInputElement[]).map((radio) => radio.value);
    expect(values).toEqual(['smart', 'metadata', 'description', 'ocr']);
  });

  it('checks the radio matching the active mode', () => {
    render(SearchModeControl, { props: { variant: 'rail', mode: 'description', onSelect: vi.fn() } });

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.find((radio) => radio.checked)?.value).toBe('description');
  });

  it('calls onSelect with the clicked mode', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSelect = vi.fn();
    render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect } });

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    await user.click(radios.find((radio) => radio.value === 'ocr')!);

    expect(onSelect).toHaveBeenCalledWith('ocr');
  });

  it('labels the group so the control is identifiable without sighted context', () => {
    render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn() } });

    expect(screen.getByRole('radiogroup', { name: 'Search mode' })).toBeInTheDocument();
  });
});

describe('search-mode-control — chip variant', () => {
  it('names the active mode on the trigger, so the mode is legible while the menu is shut', () => {
    render(SearchModeControl, { props: { variant: 'chip', mode: 'ocr', onSelect: vi.fn() } });

    expect(screen.getByRole('button', { name: 'Search mode: OCR' })).toBeInTheDocument();
  });

  it('keeps the menu shut until the trigger is clicked', () => {
    render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn() } });

    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
  });

  it('opens a menu with one item per search mode', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn() } });

    await user.click(screen.getByRole('button', { name: 'Search mode: Smart' }));

    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent?.trim())).toEqual([
      'Smart',
      'Filename',
      'Description',
      'OCR',
    ]);
  });

  it('marks the active mode as checked in the open menu', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(SearchModeControl, { props: { variant: 'chip', mode: 'metadata', onSelect: vi.fn() } });

    await user.click(screen.getByRole('button', { name: 'Search mode: Filename' }));

    const checked = screen.getAllByRole('menuitemradio').filter((item) => item.getAttribute('aria-checked') === 'true');
    expect(checked.map((item) => item.textContent?.trim())).toEqual(['Filename']);
  });

  it('calls onSelect with the chosen mode', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSelect = vi.fn();
    render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect } });

    await user.click(screen.getByRole('button', { name: 'Search mode: Smart' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Description' }));

    expect(onSelect).toHaveBeenCalledWith('description');
  });

  it('closes the menu once a mode is chosen', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn() } });

    await user.click(screen.getByRole('button', { name: 'Search mode: Smart' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Description' }));

    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
  });
});

describe('search-mode-control — chip menu dismissal', () => {
  const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn() } });
    await user.click(screen.getByRole('button', { name: 'Search mode: Smart' }));
    expect(screen.queryByRole('menu')).toBeInTheDocument();
  };

  it('closes when a click lands outside the control', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await openMenu(user);

    await user.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await openMenu(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  // The chip sits inside the search field, which is wrapped in a `clickOutside` action
  // whose `onEscape` closes the whole palette. Without stopping propagation, dismissing
  // the menu would tear down the search around it.
  it('keeps Escape from reaching the surrounding palette', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onEscapeOutside = vi.fn();
    document.addEventListener('keydown', onEscapeOutside);

    try {
      await openMenu(user);
      await user.keyboard('{Escape}');

      expect(onEscapeOutside).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onEscapeOutside);
    }
  });

  it('lets Escape through when the menu is already closed', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onEscapeOutside = vi.fn();
    document.addEventListener('keydown', onEscapeOutside);

    try {
      render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn() } });
      screen.getByRole('button', { name: 'Search mode: Smart' }).focus();
      await user.keyboard('{Escape}');

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
  it('marks the rail as scoped', () => {
    render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn(), scoped: true } });

    expect(screen.getByTestId('search-mode-rail')).toHaveAttribute('data-scoped', 'true');
  });

  it('marks the chip as scoped', () => {
    render(SearchModeControl, { props: { variant: 'chip', mode: 'smart', onSelect: vi.fn(), scoped: true } });

    expect(screen.getByTestId('search-mode-chip-trigger')).toHaveAttribute('data-scoped', 'true');
  });

  it('leaves every mode operable while scoped', () => {
    render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn(), scoped: true } });

    for (const radio of screen.getAllByRole('radio') as HTMLInputElement[]) {
      expect(radio.disabled).toBe(false);
      expect(radio).not.toHaveAttribute('aria-disabled');
    }
  });

  it('is unscoped by default', () => {
    render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn() } });

    expect(screen.getByTestId('search-mode-rail')).toHaveAttribute('data-scoped', 'false');
  });
});

describe('search-mode-control — smart search unavailable', () => {
  it('flags the smart option in the rail when machine learning is down', () => {
    render(SearchModeControl, {
      props: { variant: 'rail', mode: 'metadata', onSelect: vi.fn(), smartUnavailable: true },
    });

    expect(screen.getByTestId('search-mode-option-smart')).toHaveAttribute('title', 'Smart search is unavailable');
  });

  it('flags the smart option in the chip menu when machine learning is down', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(SearchModeControl, {
      props: { variant: 'chip', mode: 'metadata', onSelect: vi.fn(), smartUnavailable: true },
    });

    await user.click(screen.getByRole('button', { name: 'Search mode: Filename' }));

    expect(screen.getByTestId('search-mode-option-smart')).toHaveAttribute('title', 'Smart search is unavailable');
  });

  it('leaves the other modes unflagged', () => {
    render(SearchModeControl, {
      props: { variant: 'rail', mode: 'metadata', onSelect: vi.fn(), smartUnavailable: true },
    });

    for (const value of ['metadata', 'description', 'ocr']) {
      expect(screen.getByTestId(`search-mode-option-${value}`)).not.toHaveAttribute('title');
    }
  });

  it('flags nothing while smart search is healthy', () => {
    render(SearchModeControl, { props: { variant: 'rail', mode: 'smart', onSelect: vi.fn() } });

    expect(screen.getByTestId('search-mode-option-smart')).not.toHaveAttribute('title');
  });
});
