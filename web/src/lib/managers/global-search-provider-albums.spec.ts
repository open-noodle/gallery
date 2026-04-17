import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared hoisted mocks — same pattern as global-search-manager.svelte.spec.ts so the
// user/feature-flag modules resolve before the manager is imported. The provider
// itself does not read user/flag state, but the manager's constructor binds them at
// module load via i18n subscriptions, so they must be mocked for the import to
// succeed cleanly under vitest.
const { mockUser } = vi.hoisted(() => ({
  mockUser: { current: { id: 'test-user', isAdmin: true } as { id: string; isAdmin: boolean } | null },
}));
vi.mock('$lib/stores/user.store', () => ({
  user: {
    subscribe: (run: (v: { id: string; isAdmin: boolean } | null) => void) => {
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

import { getAlbumNames, type AlbumNameDto } from '@immich/sdk';
import { GlobalSearchManager } from './global-search-manager.svelte';

vi.mock('@immich/sdk', async () => ({
  ...(await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk')),
  getAlbumNames: vi.fn(),
  getAllSpaces: vi.fn(),
  getMlHealth: vi.fn(),
}));

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
}));

// The manager subscribes to svelte-i18n's locale on construction; stub it to a
// deterministic value so the constructor does not attach to the real store.
vi.mock('svelte-i18n', async (orig) => {
  const actual = await orig<typeof import('svelte-i18n')>();
  return {
    ...actual,
    locale: {
      subscribe: (run: (v: string | null) => void) => {
        run('en');
        return () => {};
      },
    },
  };
});

describe('runAlbums provider', () => {
  let sut: GlobalSearchManager;

  const seed = (names: { id: string; albumName: string; shared?: boolean }[]) => {
    sut.albumsCache = names.map(
      (n): AlbumNameDto =>
        ({
          id: n.id,
          albumName: n.albumName,
          shared: n.shared ?? false,
          albumThumbnailAssetId: null,
          assetCount: 0,
        }) as unknown as AlbumNameDto,
    );
  };

  const expectOk = (): { items: AlbumNameDto[]; total: number } => {
    const section = sut.sections.albums;
    if (section.status !== 'ok') {
      throw new Error(`expected albums section 'ok', got ${section.status}`);
    }
    return { items: section.items as unknown as AlbumNameDto[], total: section.total };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // getAlbumNames is mocked globally — give it a default resolution so the
    // ensureAlbumsCache() path inside runAlbums has something to fall back to if a
    // test forgets to seed. Tests in this suite seed directly via `seed()`, so the
    // network path is never actually exercised here, but a benign default avoids
    // flaky "undefined is not iterable" failures on an accidental path.
    vi.mocked(getAlbumNames).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getAlbumNames>>);
    sut = new GlobalSearchManager();
    sut.open();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ranks startsWith before substring', async () => {
    seed([
      { id: '1', albumName: 'Our Hawaii Trip' },
      { id: '2', albumName: 'Hawaii 2024' },
    ]);
    await sut.runAlbums('hawaii');
    const { items } = expectOk();
    expect(items.map((a) => a.id)).toEqual(['2', '1']);
  });

  it('alphabetic tiebreak for identical scores', async () => {
    seed([
      { id: '1', albumName: 'Hawaii B' },
      { id: '2', albumName: 'Hawaii A' },
    ]);
    await sut.runAlbums('hawaii');
    const { items } = expectOk();
    expect(items.map((a) => a.albumName)).toEqual(['Hawaii A', 'Hawaii B']);
  });

  it('slices to topN=5 and reports pre-slice total', async () => {
    seed(Array.from({ length: 8 }, (_, i) => ({ id: String(i), albumName: `Hawaii ${i}` })));
    await sut.runAlbums('hawaii');
    const { items, total } = expectOk();
    expect(items).toHaveLength(5);
    expect(total).toBe(8);
  });

  it('total >= items.length invariant', async () => {
    seed(Array.from({ length: 3 }, (_, i) => ({ id: String(i), albumName: `Hawaii ${i}` })));
    await sut.runAlbums('hawaii');
    const { items, total } = expectOk();
    expect(total).toBeGreaterThanOrEqual(items.length);
  });

  it('trims query and is case-insensitive', async () => {
    seed([{ id: '1', albumName: 'Hawaii 2024' }]);
    await sut.runAlbums('  HAWAII  ');
    const { items } = expectOk();
    expect(items).toHaveLength(1);
  });

  it('treats regex metacharacters literally', async () => {
    seed([
      { id: '1', albumName: 'hawaii 2024' },
      { id: '2', albumName: 'ha.waii backup' },
    ]);
    await sut.runAlbums('ha.waii');
    const { items } = expectOk();
    expect(items.map((a) => a.id)).toEqual(['2']);
  });

  it('preserves internal whitespace (double space does not match single)', async () => {
    seed([{ id: '1', albumName: 'hawaii 2024' }]);
    await sut.runAlbums('hawaii  2024');
    // Non-match: section should not be `ok`; `runAlbums` emits `empty` in that case
    // (matches the shape every other provider uses for a zero-result run).
    expect(sut.sections.albums.status).not.toBe('ok');
  });

  it('does NOT fire for queries < 2 chars', async () => {
    seed([{ id: '1', albumName: 'Anywhere' }]);
    await sut.runAlbums('a');
    expect(sut.sections.albums).toEqual({ status: 'idle' });
  });
});
