import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GlobalSearch from '../global-search.svelte';
import { GlobalSearchManager, type Provider, type Sections } from '$lib/managers/global-search-manager.svelte';
import { __resetForTests as resetRecentStore, addEntry } from '$lib/stores/cmdk-recent';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
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

function installPhotoStub(m: GlobalSearchManager, items: Array<{ id: string; originalFileName?: string }>) {
  const providers = (m as unknown as { providers: Record<keyof Sections, Provider> }).providers;
  providers.photos.run = async () => ({ status: 'ok', items, total: items.length });
}

describe('global-search root', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
    user = userEvent.setup({ pointerEventsCheck: 0 });
  });

  it('renders dialog containing the palette', () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    // Modal provides role="dialog"; the global-search-label span provides the sr-only heading
    // for the nested Command.Root. Assert the dialog mounts and the label span exists.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.getElementById('global-search-label')).not.toBeNull();
  });

  it('does NOT render a visible Modal title header', () => {
    const m = new GlobalSearchManager();
    m.open();
    const { container } = render(GlobalSearch, { props: { manager: m } });
    const visibleHeaders = container.querySelectorAll('h1, h2, h3, [role="heading"]');
    for (const h of visibleHeaders) {
      expect(h.textContent).not.toMatch(/global search/i);
    }
  });

  it('Esc once clears input, twice closes (APG two-stage)', async () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await user.type(input, 'hello');
    expect(input.value).toBe('hello');
    await user.keyboard('{Escape}');
    expect(input.value).toBe('');
    expect(m.isOpen).toBe(true);
    await user.keyboard('{Escape}');
    expect(m.isOpen).toBe(false);
  });

  it('Ctrl+K inside the palette closes (not captured by vimBindings)', async () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    const input = screen.getByRole('combobox');
    input.focus();
    await user.keyboard('{Control>}k{/Control}');
    expect(m.isOpen).toBe(false);
  });

  it('helper row appears on cold open with no recent entries', () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    // i18n fallback renders the key name — match on the key or any fallback text
    expect(screen.getByText(/cmdk_helper|Start typing/)).toBeInTheDocument();
  });

  it('helper row disappears after first keystroke', async () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'a');
    expect(screen.queryByText(/cmdk_helper|Start typing/)).toBeNull();
  });

  it('combobox has maxlength="256"', () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.maxLength).toBe(256);
  });

  it('auto-highlights first row when results arrive', async () => {
    const m = new GlobalSearchManager();
    installPhotoStub(m, [{ id: 'a1' }, { id: 'a2' }]);
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    // Wait for debounce (150ms) + provider resolution
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'), { timeout: 2000 });
  });

  it('ML banner hides when switching to metadata, re-shows when switching back to smart', async () => {
    const m = new GlobalSearchManager();
    m.mlHealthy = false;
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    // Banner key renders the key text under i18n fallback mode
    await vi.waitFor(() =>
      expect(screen.queryByText(/cmdk_smart_unavailable|smart search is unavailable/i)).not.toBeNull(),
    );
    m.setMode('metadata');
    await vi.waitFor(() =>
      expect(screen.queryByText(/cmdk_smart_unavailable|smart search is unavailable/i)).toBeNull(),
    );
    m.setMode('smart');
    await vi.waitFor(() =>
      expect(screen.queryByText(/cmdk_smart_unavailable|smart search is unavailable/i)).not.toBeNull(),
    );
  });

  it('Home key moves selection to the first Command.Item, End to the last', async () => {
    const m = new GlobalSearchManager();
    installPhotoStub(m, [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'), { timeout: 2000 });
    await user.keyboard('{End}');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a3'));
    await user.keyboard('{Home}');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'));
  });

  it('renders recent entries when store is non-empty and query is blank', () => {
    addEntry({ kind: 'query', id: 'q:beach', text: 'beach', mode: 'smart', lastUsed: 1 });
    addEntry({ kind: 'photo', id: 'photo:a1', assetId: 'a1', label: 'sunset.jpg', lastUsed: 2 });
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    expect(screen.getByText('beach')).toBeInTheDocument();
    expect(screen.getByText('sunset.jpg')).toBeInTheDocument();
  });

  it('Enter on a highlighted photo row calls manager.activate("photo", item)', async () => {
    const m = new GlobalSearchManager();
    installPhotoStub(m, [{ id: 'a1', originalFileName: 'x.jpg' }]);
    const activateSpy = vi.spyOn(m, 'activate').mockImplementation(() => {});
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'), { timeout: 2000 });
    await user.keyboard('{Enter}');
    expect(activateSpy).toHaveBeenCalledWith('photo', expect.objectContaining({ id: 'a1' }));
  });

  it('activateRecent("query", ...) updates the input value via manager.query sync', async () => {
    addEntry({ kind: 'query', id: 'q:sunset', text: 'sunset', mode: 'smart', lastUsed: 1 });
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.value).toBe('');
    // Directly invoke activateRecent on the manager — the effect should sync inputValue.
    m.activateRecent({ kind: 'query', id: 'q:sunset', text: 'sunset', mode: 'smart', lastUsed: 1 });
    await vi.waitFor(() => expect(input.value).toBe('sunset'));
  });

  it('preview pane is not mounted below 1024 px', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(min-width: 1024px)' ? false : true,
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }));
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    expect(document.querySelector('[data-cmdk-preview]')).toBeNull();
  });

  it('respects prefers-reduced-motion class on palette shell', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }));
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    // Modal portals its content to body, not the render container, so query the whole document.
    const hasReducedMotion = [...document.querySelectorAll<HTMLElement>('*')].some((el) =>
      (el.className?.toString() ?? '').includes('motion-reduce:'),
    );
    expect(hasReducedMotion).toBe(true);
  });
});
