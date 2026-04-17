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

import { getAllSpaces, type SharedSpaceResponseDto } from '@immich/sdk';
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

describe('runSpaces provider', () => {
  let sut: GlobalSearchManager;

  const seed = (names: { id: string; name: string }[]) => {
    sut.spacesCache = names.map(
      (n): SharedSpaceResponseDto =>
        ({
          id: n.id,
          name: n.name,
          createdAt: '2024-01-01T00:00:00.000Z',
          createdById: 'test-user',
        }) as unknown as SharedSpaceResponseDto,
    );
  };

  const expectOk = (): { items: SharedSpaceResponseDto[]; total: number } => {
    const section = sut.sections.spaces;
    if (section.status !== 'ok') {
      throw new Error(`expected spaces section 'ok', got ${section.status}`);
    }
    return { items: section.items as unknown as SharedSpaceResponseDto[], total: section.total };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // getAllSpaces is mocked globally — give it a default resolution so the
    // ensureSpacesCache() path inside runSpaces has something to fall back to if a
    // test forgets to seed. Tests in this suite seed directly via `seed()`, so the
    // network path is never actually exercised here, but a benign default avoids
    // flaky "undefined is not iterable" failures on an accidental path.
    vi.mocked(getAllSpaces).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getAllSpaces>>);
    sut = new GlobalSearchManager();
    sut.open();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ranks startsWith before substring', async () => {
    seed([
      { id: '1', name: 'Our Hawaii Trip' },
      { id: '2', name: 'Hawaii 2024' },
    ]);
    await sut.runSpaces('hawaii');
    const { items } = expectOk();
    expect(items.map((s) => s.id)).toEqual(['2', '1']);
  });

  it('alphabetic tiebreak for identical scores', async () => {
    seed([
      { id: '1', name: 'Hawaii B' },
      { id: '2', name: 'Hawaii A' },
    ]);
    await sut.runSpaces('hawaii');
    const { items } = expectOk();
    expect(items.map((s) => s.name)).toEqual(['Hawaii A', 'Hawaii B']);
  });

  it('slices to topN=5 and reports pre-slice total', async () => {
    seed(Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: `Hawaii ${i}` })));
    await sut.runSpaces('hawaii');
    const { items, total } = expectOk();
    expect(items).toHaveLength(5);
    expect(total).toBe(8);
  });

  it('total >= items.length invariant', async () => {
    seed(Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: `Hawaii ${i}` })));
    await sut.runSpaces('hawaii');
    const { items, total } = expectOk();
    expect(total).toBeGreaterThanOrEqual(items.length);
  });

  it('trims query and is case-insensitive', async () => {
    seed([{ id: '1', name: 'Hawaii 2024' }]);
    await sut.runSpaces('  HAWAII  ');
    const { items } = expectOk();
    expect(items).toHaveLength(1);
  });

  it('treats regex metacharacters literally', async () => {
    seed([
      { id: '1', name: 'hawaii 2024' },
      { id: '2', name: 'ha.waii backup' },
    ]);
    await sut.runSpaces('ha.waii');
    const { items } = expectOk();
    expect(items.map((s) => s.id)).toEqual(['2']);
  });

  it('preserves internal whitespace (double space does not match single)', async () => {
    seed([{ id: '1', name: 'hawaii 2024' }]);
    await sut.runSpaces('hawaii  2024');
    // Non-match: section should not be `ok`; `runSpaces` emits `empty` in that case
    // (matches the shape every other provider uses for a zero-result run).
    expect(sut.sections.spaces.status).not.toBe('ok');
  });

  it('does NOT fire for queries < 2 chars', async () => {
    seed([{ id: '1', name: 'Anywhere' }]);
    await sut.runSpaces('a');
    expect(sut.sections.spaces).toEqual({ status: 'idle' });
  });

  it('returns empty when no spaces are cached', async () => {
    sut.spacesCache = [];
    await sut.runSpaces('hawaii');
    expect(sut.sections.spaces.status).not.toBe('ok');
  });
});
