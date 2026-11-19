import { getMyImmichLink, getPagesProvider } from '#lib/commands.ts';
import { resetPage, setPage } from '#test/unit/mocks/app-state.svelte.ts';
import { goto } from '$app/navigation';

const mockUser = vi.hoisted(() => ({
  current: { id: 'demo-user', isAdmin: false } as { id: string; isAdmin: boolean } | null,
  isDemo: true,
}));

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({
  authManager: {
    get authenticated() {
      return mockUser.current !== null;
    },
    get user() {
      return mockUser.current;
    },
    get canPreviewAdmin() {
      return !!mockUser.current && (mockUser.current.isAdmin || mockUser.isDemo);
    },
  },
}));

describe('getMyImmichLink', () => {
  // `page` is a SvelteKit rune-backed object; the command only ever reads page.url.
  beforeEach(() => {
    setPage({ url: new URL('https://abc123.noodlegallery.de/photos?at=2026-08-07#hash') });
  });

  afterEach(() => {
    resetPage();
  });

  it('builds the link on the instance the user is actually on', () => {
    // Upstream hardcodes https://my.immich.app, a proxy that redirects a visitor
    // to whichever instance THEY have configured there. A Noodle Gallery user has
    // configured nothing on that domain, so the copied link lands them on an
    // Immich-branded setup page — and the link they share names immich.
    expect(getMyImmichLink().origin).toBe('https://abc123.noodlegallery.de');
  });

  it('keeps the path and query so the link points at the same page', () => {
    expect(getMyImmichLink().href).toBe('https://abc123.noodlegallery.de/photos?at=2026-08-07');
  });

  it('drops the fragment, which is local to the sharer', () => {
    expect(getMyImmichLink().hash).toBe('');
  });
});

describe('getPagesProvider admin preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = { id: 'demo-user', isAdmin: false };
    mockUser.isDemo = true;
  });

  it('shows admin pages for demo preview users without making them admins', () => {
    const provider = getPagesProvider(String) as unknown as {
      onSearch: (query: string) => Array<{ title: string; $if?: () => boolean }>;
    };
    const systemSettings = provider.onSearch('').find((action) => action.title === 'admin.system_settings');

    expect(mockUser.current?.isAdmin).toBe(false);
    expect(systemSettings?.$if?.()).toBe(true);
  });

  it('still hides admin pages from normal non-admin users', () => {
    mockUser.isDemo = false;
    const provider = getPagesProvider(String) as unknown as {
      onSearch: (query: string) => Array<{ title: string; $if?: () => boolean }>;
    };

    // The command palette also lists user/utility pages (visible to any authenticated user);
    // scope the assertion to the admin-only entries, which must stay hidden without preview.
    const adminTitles = new Set([
      'admin.user_management',
      'admin.system_settings',
      'admin.queues',
      'external_libraries',
      'server_stats',
    ]);
    const adminActions = provider.onSearch('').filter((action) => adminTitles.has(action.title));

    expect(adminActions).toHaveLength(adminTitles.size);
    expect(adminActions.every((action) => action.$if?.() === false)).toBe(true);
  });

  it('navigates admin settings through the existing action', () => {
    const provider = getPagesProvider(String) as unknown as {
      onSearch: (query: string) => Array<{ title: string; onAction: () => void }>;
    };

    provider
      .onSearch('')
      .find((action) => action.title === 'admin.system_settings')
      ?.onAction();

    expect(goto).toHaveBeenCalledWith('/admin/system-settings');
  });
});
