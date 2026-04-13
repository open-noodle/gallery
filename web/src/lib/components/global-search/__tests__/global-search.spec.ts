import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { GlobalSearchManager, type Provider, type Sections } from '$lib/managers/global-search-manager.svelte';
import { addEntry, __resetForTests as resetRecentStore } from '$lib/stores/cmdk-recent';
import { getMlHealth } from '@immich/sdk';
import GlobalSearch from '../global-search.svelte';

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
  providers.photos.run = () => Promise.resolve({ status: 'ok' as const, items, total: items.length });
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
    expect(document.querySelector('#global-search-label')).not.toBeNull();
  });

  it('left column has min-w-0 so flex-1 shrinks below long-filename content', () => {
    // Regression guard: flex children default to min-width: auto (= content size),
    // so without explicit min-w-0 on the `flex-1` left column, rows with long
    // filenames (e.g. pexels-kirsten-buhne-682055-1521306.jpg) force the whole
    // row wider than the modal and push the fixed-width preview pane off-screen.
    // Assert the column carries the `min-w-0` class so `truncate` on inner rows
    // actually kicks in.
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    // Locate the left column: the first child of the palette's row div that is
    // NOT the preview pane (which has data-cmdk-preview).
    // Modal portals into document.body, not the render container — search the whole document.
    const row = document.querySelector<HTMLElement>('div.flex[class*="h-[520px]"]');
    expect(row).not.toBeNull();
    const leftColumn = row?.firstElementChild as HTMLElement | null;
    expect(leftColumn).not.toBeNull();
    expect(leftColumn?.className).toContain('flex-1');
    expect(leftColumn?.className).toContain('min-w-0');
    // Sanity: the preview pane exists as a sibling with data-cmdk-preview (or is
    // absent when preview is disabled via media query) — doesn't matter for this
    // regression, only the left column's constraint matters.
  });

  it('row uses explicit h-[520px] / max-h-[80vh] / min-h-0 (not flex-1)', () => {
    // Regression guard: the row previously used `flex min-h-[420px] max-h-[60vh]
    // flex-1`, which grew to content because `flex-1` in a column without a
    // definite parent height doesn't respect max-height. Explicit fixed height
    // with min-h-0 makes both columns definite-sized so Command.List scrolls
    // internally instead of stretching the preview pane.
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    // Modal portals into document.body, not the render container — search the whole document.
    const row = document.querySelector<HTMLElement>('div.flex[class*="h-[520px]"]');
    expect(row).not.toBeNull();
    expect(row?.className).toContain('h-[520px]');
    expect(row?.className).toContain('max-h-[80vh]');
    expect(row?.className).toContain('min-h-0');
    // Explicitly guard against the broken `flex-1` pattern returning.
    expect(row?.className).not.toMatch(/\bflex-1\b/);
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
    (m as unknown as { runNavigationProvider: (q: string) => { status: 'empty' } }).runNavigationProvider = () => ({
      status: 'empty',
    });
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'), { timeout: 2000 });
    await user.keyboard('{End}');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a3'));
    await user.keyboard('{Home}');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'));
  });

  it('scrolls the newly selected item into view, even when it is the first of a group', async () => {
    // bits-ui's built-in scroll-into-view treats "first item of a group" as a special
    // case — it scrolls the group heading instead of the item and returns early. If the
    // heading was already partially visible, the item stays off-screen. We add an override
    // effect in global-search.svelte that re-calls scrollIntoView on the item. This test
    // pins that override by spying on Element.prototype.scrollIntoView and asserting the
    // item's data-value matches the spy's invocation target.
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const m = new GlobalSearchManager();
    installPhotoStub(m, [{ id: 'a1' }, { id: 'a2' }]);
    (m as unknown as { runNavigationProvider: (q: string) => { status: 'empty' } }).runNavigationProvider = () => ({
      status: 'empty',
    });
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'), { timeout: 2000 });
    // Force a selection change so the override effect re-runs.
    await user.keyboard('{End}');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a2'));
    // The override uses requestAnimationFrame — wait one frame.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    // The override must have called scrollIntoView on a [data-command-item] element
    // whose data-value matches the selected id. bits-ui's own scroll may also have
    // fired earlier in the same microtask — filter to our target.
    const matchingCalls = scrollSpy.mock.calls.filter((_, i) => {
      const target = scrollSpy.mock.instances[i];
      return (
        target instanceof HTMLElement &&
        target.dataset.commandItem !== undefined &&
        target.dataset.value === 'photo:a2'
      );
    });
    expect(matchingCalls.length).toBeGreaterThan(0);
    scrollSpy.mockRestore();
  });

  it('arrow keys wrap around at both ends (Command.Root loop=true)', async () => {
    // ARIA APG's listbox pattern explicitly permits wrapping as an optional behavior,
    // and wrap is the dominant convention for command palettes (VS Code, Raycast,
    // Linear, GitHub). bits-ui's `loop` prop enables it. This test pins the behavior
    // so a future refactor can't silently drop the `loop` attribute.
    const m = new GlobalSearchManager();
    installPhotoStub(m, [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
    (m as unknown as { runNavigationProvider: (q: string) => { status: 'empty' } }).runNavigationProvider = () => ({
      status: 'empty',
    });
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'), { timeout: 2000 });
    // Walk to the last item.
    await user.keyboard('{End}');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a3'));
    // ArrowDown from the last item — should wrap to the first.
    await user.keyboard('{ArrowDown}');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'));
    // ArrowUp from the first item — should wrap to the last.
    await user.keyboard('{ArrowUp}');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a3'));
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

  it('progress stripe is hidden for fast-settling queries (batch actually settles before grace)', async () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    // All providers mock-resolve instantly → debounce (150ms) + microtasks → batch settles.
    await user.type(screen.getByRole('combobox'), 'beach');
    // Wait for batchInFlight to actually flip false — proves the batch settled, not that
    // we polled too early. Must happen before the 200ms grace would have armed the stripe.
    await vi.waitFor(() => expect(m.batchInFlight).toBe(false), { timeout: 500 });
    // Now wait past when the stripe COULD have fired (grace window = 200ms). The effect
    // cleanup should have cancelled the timer when batchInFlight flipped false.
    await new Promise((r) => setTimeout(r, 250));
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

  // NF2: the filter uses the LIVE NavigationItem.adminOnly, not the stored entry.adminOnly,
  // so a stale `adminOnly: false` entry pointing at a currently-admin-only item is dropped.
  it('render-time filter uses live NavigationItem.adminOnly, not the stale saved entry field', () => {
    mockUser.current = { isAdmin: false };
    // classification_settings is live adminOnly=true, but the saved entry has stale adminOnly=false.
    addEntry({
      kind: 'navigate',
      id: 'nav:systemSettings:classification',
      route: '/admin/system-settings?isOpen=classification',
      labelKey: 'admin.classification_settings',
      icon: 'x',
      adminOnly: false, // stale
      lastUsed: 1,
    });
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    // Live catalog says adminOnly=true, user is non-admin → entry must not render.
    expect(screen.queryByText('admin.classification_settings')).toBeNull();
  });

  // CG6: feature-flag-disabled navigate recents must also be hidden pre-click.
  it('render-time filter hides navigate recents whose feature flag is now disabled', () => {
    mockUser.current = { isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: false, trash: true };
    addEntry({
      kind: 'navigate',
      id: 'nav:userPages:map',
      route: '/map',
      labelKey: 'map',
      icon: 'x',
      adminOnly: false,
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
    expect(screen.getByText('photos')).toBeInTheDocument();
    expect(screen.queryByText('map')).toBeNull();
  });

  // NF2: the filter also drops ghost entries whose NavigationItem was removed upstream.
  it('render-time filter hides navigate recents for unknown (ghost) NavigationItems', () => {
    mockUser.current = { isAdmin: true };
    addEntry({
      kind: 'navigate',
      id: 'nav:removed:feature',
      route: '/removed',
      labelKey: 'removed_feature_label',
      icon: 'x',
      adminOnly: false,
      lastUsed: 1,
    });
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    expect(screen.queryByText('removed_feature_label')).toBeNull();
  });

  // CG8: cold open (empty query) must not render any navigation sub-section headings.
  it('cold open (empty query) does NOT render navigation sub-sections', () => {
    mockUser.current = { isAdmin: true };
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    expect(screen.queryByText('cmdk_section_system_settings')).toBeNull();
    expect(screen.queryByText('cmdk_section_admin')).toBeNull();
    expect(screen.queryByText('cmdk_section_user_pages')).toBeNull();
    expect(screen.queryByText('cmdk_section_actions')).toBeNull();
  });

  // CG7: closing the palette mid-batch must unmount and clean up the stripe effect.
  // Re-mounting a fresh instance should start with the stripe hidden.
  it('close() during in-flight batch cleans up the stripe effect', async () => {
    const m = new GlobalSearchManager();
    (m as unknown as { providers: Record<keyof Sections, Provider> }).providers.photos.run = () =>
      new Promise(() => {});
    m.open();
    const firstRender = render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    await new Promise((r) => setTimeout(r, 500));
    expect(document.querySelector('[data-cmdk-progress]')).not.toBeNull();
    // Unmount simulates palette close — $effect cleanup should run.
    firstRender.unmount();
    // Re-mount a fresh instance. Stripe must NOT be leaking across mounts.
    const fresh = new GlobalSearchManager();
    fresh.open();
    const secondRender = render(GlobalSearch, { props: { manager: fresh } });
    expect(secondRender.container.querySelector('[data-cmdk-progress]')).toBeNull();
  });

  it('respects prefers-reduced-motion class on palette shell', () => {
    globalThis.matchMedia = vi.fn().mockImplementation((query: string) => ({
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
