import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared hoisted user mock — navigation provider and render-time recent filter both
// read `get(user)` / `$user`. Must appear above the component import so Vitest hoists
// the mock before any module that binds the store at load time.
//
// Default is `null` (matches the pre-existing behavior where the real `writable<T>()`
// was uninitialized → non-admin). Tests that need an admin view set it explicitly.
const { mockUser } = vi.hoisted(() => ({
  mockUser: { current: null as { isAdmin: boolean } | null },
}));
vi.mock('$lib/stores/user.store', () => ({
  user: {
    subscribe: (run: (v: { isAdmin: boolean } | null) => void) => {
      run(mockUser.current);
      return () => {};
    },
  },
}));

const { mockFlags } = vi.hoisted(() => ({
  mockFlags: {
    valueOrUndefined: { search: true, map: true, trash: true } as Record<string, boolean> | undefined,
  },
}));
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: mockFlags,
}));

import GlobalSearch from '../global-search.svelte';
import { GlobalSearchManager, type Provider, type Sections } from '$lib/managers/global-search-manager.svelte';
import { getMlHealth } from '@immich/sdk';
import { __resetForTests as resetRecentStore, addEntry } from '$lib/stores/cmdk-recent';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// svelte/reactivity's MediaQuery captures matchMedia at module load time — mocking
// window.matchMedia in a test doesn't retroactively update existing instances.
// Mock the manager module directly and expose a mutable flag.
const { mediaState } = vi.hoisted(() => ({ mediaState: { minLg: false } }));
vi.mock('$lib/stores/media-query-manager.svelte', () => ({
  mediaQueryManager: {
    get minLg() {
      return mediaState.minLg;
    },
    get pointerCoarse() {
      return false;
    },
    get maxMd() {
      return false;
    },
    get isFullSidebar() {
      return true;
    },
    get reducedMotion() {
      return false;
    },
  },
}));
vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    searchSmart: vi.fn().mockResolvedValue({ assets: { items: [], nextPage: null } }),
    searchAssets: vi.fn().mockResolvedValue({ assets: { items: [], nextPage: null } }),
    searchPerson: vi.fn().mockResolvedValue([]),
    searchPlaces: vi.fn().mockResolvedValue([]),
    getAllTags: vi.fn().mockResolvedValue([]),
    getMlHealth: vi.fn().mockResolvedValue({ smartSearchHealthy: true }),
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
    mediaState.minLg = false;
    // Default to uninitialized user — matches pre-Task-15 behavior. Tests that need
    // admin-scoped navigation results (e.g. nav sub-sections) set this explicitly.
    mockUser.current = null;
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
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
    vi.mocked(getMlHealth).mockResolvedValueOnce({ smartSearchHealthy: false });
    const m = new GlobalSearchManager();
    m.open();
    // Give the probe a tick to resolve before rendering so mlHealthy flips to false.
    await Promise.resolve();
    await Promise.resolve();
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
    // Disable the navigation provider so the End key lands on the last photo (not
    // whichever nav item happens to fuzzy-match this query). Post-Task-15 the nav
    // section is always mounted below the entity sections.
    (m as unknown as { runNavigationProvider: (q: string) => { status: 'empty' } }).runNavigationProvider =
      () => ({ status: 'empty' });
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
    mediaState.minLg = false;
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    expect(document.querySelector('[data-cmdk-preview]')).toBeNull();
  });

  it('preview pane mounts at ≥ 1024 px', () => {
    mediaState.minLg = true;
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    expect(document.querySelector('[data-cmdk-preview]')).not.toBeNull();
  });

  it('navigation sub-sections render after entity sections in document order', async () => {
    mockUser.current = { isAdmin: true };
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    // Type a query that matches a navigation item (admin=true per beforeEach).
    await user.type(screen.getByRole('combobox'), 'classific');
    // svelte-i18n fallbackLocale 'dev' renders literal keys.
    const navHeading = await screen.findByText('cmdk_section_system_settings', {}, { timeout: 2000 });
    expect(navHeading).toBeInTheDocument();
    // Photos heading should exist in the DOM (loading-branch renders it too).
    const photosHeading = screen.queryByText('cmdk_photos_heading');
    if (photosHeading) {
      // Nav heading must appear AFTER photos heading in DOM order.
      expect(photosHeading.compareDocumentPosition(navHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('progress stripe is hidden for fast-settling queries (< 200ms grace)', async () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    // All providers mock-resolve instantly → settles before the 200ms timer fires.
    await user.type(screen.getByRole('combobox'), 'beach');
    // Small wait to let the batch settle under real timers.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-cmdk-progress]')).toBeNull();
  });

  it('progress stripe becomes visible when batchInFlight exceeds 200ms', async () => {
    const m = new GlobalSearchManager();
    // Stub photos to never resolve — batch stays in flight past the 200ms grace.
    (m as unknown as { providers: Record<keyof Sections, Provider> }).providers.photos.run = () =>
      new Promise(() => {});
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    // Wait past debounce (150ms) + grace (200ms) + a bit of slack.
    await new Promise((r) => setTimeout(r, 500));
    expect(document.querySelector('[data-cmdk-progress]')).not.toBeNull();
  });

  it('render-time filter hides stale admin navigate entries for non-admins', () => {
    mockUser.current = { isAdmin: false };
    addEntry({
      kind: 'navigate',
      id: 'nav:admin:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'x',
      adminOnly: true,
      lastUsed: 1,
    });
    addEntry({
      kind: 'navigate',
      id: 'nav:userPages:photos',
      route: '/photos',
      labelKey: 'photos',
      icon: 'x',
      adminOnly: false,
      lastUsed: 2,
    });
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    // Non-admin should see photos but NOT users in the recents list.
    expect(screen.getByText('photos')).toBeInTheDocument();
    expect(screen.queryByText('users')).toBeNull();
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
