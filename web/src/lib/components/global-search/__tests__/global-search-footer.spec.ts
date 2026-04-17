import { GlobalSearchManager } from '$lib/managers/global-search-manager.svelte';
import ShortcutsModal from '$lib/modals/ShortcutsModal.svelte';
import { modalManager } from '@immich/ui';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalSearchFooter from '../global-search-footer.svelte';

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    searchSmart: vi.fn().mockResolvedValue({ assets: { items: [], nextPage: null } }),
    searchAssets: vi.fn().mockResolvedValue({ assets: { items: [], nextPage: null } }),
    searchPerson: vi.fn().mockResolvedValue([]),
    searchPlaces: vi.fn().mockResolvedValue([]),
    getAllTags: vi.fn().mockResolvedValue([]),
  };
});

describe('global-search-footer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders four segmented-control radios', () => {
    const manager = new GlobalSearchManager();
    render(GlobalSearchFooter, { props: { manager } });
    for (const label of ['cmdk_mode_smart', 'cmdk_mode_filename', 'cmdk_mode_description', 'cmdk_mode_ocr']) {
      expect(screen.getByRole('radio', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
  });

  it('reflects manager.mode as the checked radio', () => {
    const manager = new GlobalSearchManager();
    manager.setMode('metadata');
    render(GlobalSearchFooter, { props: { manager } });
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    const filenameRadio = radios.find((r) => r.value === 'metadata');
    expect(filenameRadio?.checked).toBe(true);
  });

  it('clicking a segment calls manager.setMode with the right value', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const manager = new GlobalSearchManager();
    const spy = vi.spyOn(manager, 'setMode');
    render(GlobalSearchFooter, { props: { manager } });
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    const descriptionRadio = radios.find((r) => r.value === 'description');
    await user.click(descriptionRadio!);
    expect(spy).toHaveBeenCalledWith('description');
  });

  it('displays the Ctrl+/ keybind hint', () => {
    const manager = new GlobalSearchManager();
    render(GlobalSearchFooter, { props: { manager } });
    expect(screen.getByText(/ctrl\+\//i)).toBeInTheDocument();
  });
});

describe('prefix scoping — footer chrome', () => {
  let manager: GlobalSearchManager;

  // Load en so `$t('cmdk_scope_hint_footer')` resolves to "@ # / >" rather than
  // the raw key. Other blocks in this file use raw-key assertions and don't need
  // locale setup — this scoped beforeAll keeps the change localized.
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    localStorage.clear();
    manager = new GlobalSearchManager();
  });

  it('renders both kbd groups (Ctrl+/ cycle and @ # / > scope)', () => {
    const { getByText } = render(GlobalSearchFooter, { props: { manager } });
    expect(getByText('Ctrl+/')).toBeInTheDocument();
    expect(getByText('@ # / >')).toBeInTheDocument();
    // The label next to the kbd is translated (cmdk_scope_hint_footer_label); beforeAll
    // loads en-US so it must resolve to "scope" and stay rendered — guards against
    // silently dropping the label node during future template edits.
    expect(getByText('scope')).toBeInTheDocument();
  });

  it('? icon button hidden below sm breakpoint (carries sm:block class)', () => {
    const { container } = render(GlobalSearchFooter, { props: { manager } });
    const btn = container.querySelector('[data-cmdk-shortcuts-trigger]');
    expect(btn?.className).toMatch(/sm:block|sm:flex|sm:inline-flex/);
  });

  it('clicking ? calls modalManager.show(ShortcutsModal, {})', () => {
    const showSpy = vi.spyOn(modalManager, 'show');
    const { container } = render(GlobalSearchFooter, { props: { manager } });
    const btn = container.querySelector('[data-cmdk-shortcuts-trigger]') as HTMLButtonElement;
    btn.click();
    expect(showSpy).toHaveBeenCalledWith(ShortcutsModal, {});
  });
});
