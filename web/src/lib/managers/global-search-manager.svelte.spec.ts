import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Shared hoisted mocks — used by navigation tests to flip admin/feature-flag state.
// Must appear BEFORE the GlobalSearchManager import because the manager binds these
// modules at module load; vi.doMock inside tests is too late.
const { mockUser } = vi.hoisted(() => ({
  mockUser: { current: { isAdmin: true } as { isAdmin: boolean } | null },
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

import { goto } from '$app/navigation';
import { searchSmart, searchAssets, searchPerson, searchPlaces, getAllTags, getMlHealth } from '@immich/sdk';
import { GlobalSearchManager, type Provider, type ProviderStatus, type SearchMode, type Sections } from './global-search-manager.svelte';
import { installFakeAbortTimeout, restoreAbortTimeout } from './__tests__/fake-abort-timeout';
import { __resetForTests as resetRecentStore, getEntries } from '$lib/stores/cmdk-recent';

vi.mock('@immich/sdk', async () => ({
  ...(await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk')),
  searchSmart: vi.fn(),
  searchAssets: vi.fn(),
  searchPerson: vi.fn(),
  searchPlaces: vi.fn(),
  getAllTags: vi.fn(),
  getMlHealth: vi.fn(),
}));

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
}));

// Mock ONLY svelte-i18n's `locale` store so tests can control it. The `t` store
// keeps its real implementation so translation calls resolve via fallbackLocale='dev'.
const { mockI18nLocale } = vi.hoisted(() => ({
  mockI18nLocale: { current: 'en' as string | null },
}));
vi.mock('svelte-i18n', async (orig) => {
  const actual = await orig<typeof import('svelte-i18n')>();
  return {
    ...actual,
    locale: {
      subscribe: (run: (v: string | null) => void) => {
        run(mockI18nLocale.current);
        return () => {};
      },
    },
  };
});

describe('GlobalSearchManager (skeleton)', () => {
  let manager: GlobalSearchManager;

  beforeEach(() => {
    localStorage.clear();
    manager = new GlobalSearchManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts closed with empty query and smart mode', () => {
    expect(manager.isOpen).toBe(false);
    expect(manager.query).toBe('');
    expect(manager.mode).toBe('smart');
  });

  it('open() sets isOpen=true', () => {
    manager.open();
    expect(manager.isOpen).toBe(true);
  });

  it('close() resets sections to idle and clears active item', () => {
    manager.open();
    manager.sections.photos = { status: 'loading' };
    manager.activeItemId = 'photo:abc';
    manager.close();
    expect(manager.isOpen).toBe(false);
    expect(manager.sections.photos).toEqual({ status: 'idle' });
    expect(manager.sections.people).toEqual({ status: 'idle' });
    expect(manager.activeItemId).toBe(null);
  });

  it('close() resets query so reopening and re-typing the same string runs a new batch', () => {
    manager.open();
    manager.query = 'beach';
    manager.close();
    expect(manager.query).toBe('');
  });

  it('toggle() flips state', () => {
    manager.toggle();
    expect(manager.isOpen).toBe(true);
    manager.toggle();
    expect(manager.isOpen).toBe(false);
  });

  it('providers is an instance-bound record with five keys', () => {
    const providers = (manager as unknown as { providers: Record<string, unknown> }).providers;
    expect(Object.keys(providers).sort()).toEqual(['navigation', 'people', 'photos', 'places', 'tags']);
  });

  describe('searchQueryType sanity check', () => {
    it('falls back to smart when localStorage value is invalid', () => {
      localStorage.setItem('searchQueryType', 'evil_value');
      manager = new GlobalSearchManager();
      expect(manager.mode).toBe('smart');
      expect(localStorage.getItem('searchQueryType')).toBe('smart');
    });

    it('falls back to smart when localStorage value is empty string', () => {
      localStorage.setItem('searchQueryType', '');
      manager = new GlobalSearchManager();
      expect(manager.mode).toBe('smart');
    });

    it('returns smart when key is absent', () => {
      manager = new GlobalSearchManager();
      expect(manager.mode).toBe('smart');
    });

    it('uses persisted value when valid', () => {
      for (const m of ['smart', 'metadata', 'description', 'ocr'] as const) {
        localStorage.setItem('searchQueryType', m);
        manager = new GlobalSearchManager();
        expect(manager.mode).toBe(m);
      }
    });

    it('falls back to smart and does not throw when localStorage access throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(() => new GlobalSearchManager()).not.toThrow();
      expect(new GlobalSearchManager().mode).toBe('smart');
    });
  });
});

describe('setQuery', () => {
  let manager: GlobalSearchManager;
  let calls: Array<{ key: string; query: string; mode: SearchMode }>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    manager = new GlobalSearchManager();
    calls = [];
    const makeStub = (key: keyof Sections, minLen: number): Provider => ({
      key,
      topN: 5,
      minQueryLength: minLen,
      run: async (query, mode, signal) => {
        calls.push({ key, query, mode });
        return new Promise<ProviderStatus>((resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
          setTimeout(() => resolve({ status: 'ok', items: [], total: 0 }), 0);
        });
      },
    });
    (manager as unknown as { providers: Record<keyof Sections, Provider> }).providers = {
      photos: makeStub('photos', 1),
      people: makeStub('people', 2),
      places: makeStub('places', 2),
      tags: makeStub('tags', 2),
      navigation: makeStub('navigation', 2),
    };
  });

  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('empty query sets sections to idle', async () => {
    manager.setQuery('');
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toEqual([]);
    expect(manager.sections.photos).toEqual({ status: 'idle' });
  });

  it('query length 1 fires only photos', async () => {
    manager.setQuery('a');
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.map((c) => c.key).sort()).toEqual(['photos']);
  });

  it('query length ≥ 2 fires all four providers', async () => {
    manager.setQuery('ab');
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.map((c) => c.key).sort()).toEqual(['people', 'photos', 'places', 'tags']);
  });

  it('debounces rapid keystrokes — only the last value fires', async () => {
    manager.setQuery('a');
    manager.setQuery('ab');
    manager.setQuery('abc');
    await vi.advanceTimersByTimeAsync(200);
    expect(new Set(calls.map((c) => c.query))).toEqual(new Set(['abc']));
  });

  it('new keystroke aborts previous batch silently', async () => {
    const providers = (manager as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    providers.photos.run = (_q: string, _m: SearchMode, signal: AbortSignal) =>
      new Promise<ProviderStatus>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })));
      });
    manager.setQuery('first');
    await vi.advanceTimersByTimeAsync(200);
    manager.setQuery('second');
    await vi.advanceTimersByTimeAsync(200);
    expect(manager.sections.photos.status).not.toBe('timeout');
  });

  it('5 s timeout marks section as timeout when provider never resolves', async () => {
    const providers = (manager as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    providers.photos.run = (_q: string, _m: SearchMode, signal: AbortSignal) =>
      new Promise<ProviderStatus>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })));
      });
    manager.setQuery('hang');
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(manager.sections.photos.status).toBe('timeout');
  });

  it('close() aborts in-flight batch silently', async () => {
    const providers = (manager as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    providers.photos.run = (_q: string, _m: SearchMode, signal: AbortSignal) =>
      new Promise<ProviderStatus>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })));
      });
    manager.setQuery('inflight');
    await vi.advanceTimersByTimeAsync(200);
    manager.close();
    expect(manager.sections.photos.status).toBe('idle');
  });

  it('synchronous throw from a provider does not crash runBatch', async () => {
    const providers = (manager as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    providers.photos.run = () => {
      throw new Error('sync boom');
    };
    manager.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(manager.sections.photos).toEqual({ status: 'error', message: 'sync boom' });
  });
});

describe('real providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({
      assets: { items: [{ id: 'a' }, { id: 'b' }], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchSmart>>);
    vi.mocked(searchAssets).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchAssets>>);
    vi.mocked(searchPerson).mockResolvedValue([{ id: 'p1', name: 'Alice' }] as unknown as Awaited<
      ReturnType<typeof searchPerson>
    >);
    vi.mocked(searchPlaces).mockResolvedValue([
      { name: 'Santa Cruz', latitude: 36.97, longitude: -122.03 },
    ] as unknown as Awaited<ReturnType<typeof searchPlaces>>);
  });

  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('photos uses searchSmart in smart mode with withSharedSpaces=true', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchSmart).toHaveBeenCalledOnce();
    expect(searchSmart).toHaveBeenCalledWith(
      expect.objectContaining({
        smartSearchDto: expect.objectContaining({ query: 'beach', withSharedSpaces: true }),
      }),
      expect.anything(),
    );
    expect(m.sections.photos.status).toBe('ok');
  });

  it('photos uses searchAssets with originalFileName in metadata mode', async () => {
    localStorage.setItem('searchQueryType', 'metadata');
    const m = new GlobalSearchManager();
    m.setQuery('IMG_0042');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataSearchDto: expect.objectContaining({ originalFileName: 'IMG_0042' }),
      }),
      expect.anything(),
    );
  });

  it('photos uses searchAssets with description field in description mode', async () => {
    localStorage.setItem('searchQueryType', 'description');
    const m = new GlobalSearchManager();
    m.setQuery('sunset');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataSearchDto: expect.objectContaining({ description: 'sunset' }),
      }),
      expect.anything(),
    );
  });

  it('photos uses searchAssets with ocr field in ocr mode', async () => {
    localStorage.setItem('searchQueryType', 'ocr');
    const m = new GlobalSearchManager();
    m.setQuery('ACME');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataSearchDto: expect.objectContaining({ ocr: 'ACME' }),
      }),
      expect.anything(),
    );
  });

  it('people provider calls searchPerson with name and withHidden=false', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('alice');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchPerson).toHaveBeenCalledWith(
      { name: 'alice', withHidden: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('places provider calls searchPlaces with name', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('santa');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchPlaces).toHaveBeenCalledWith(
      { name: 'santa' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('photos provider returns { status: error } when SDK throws non-abort error', async () => {
    vi.mocked(searchSmart).mockRejectedValueOnce(new Error('network down'));
    const m = new GlobalSearchManager();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    expect(m.sections.photos).toEqual({ status: 'error', message: 'network down' });
  });

  it('people provider caps results at top 5', async () => {
    vi.mocked(searchPerson).mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })) as unknown as Awaited<
        ReturnType<typeof searchPerson>
      >,
    );
    const m = new GlobalSearchManager();
    m.setQuery('al');
    await vi.advanceTimersByTimeAsync(200);
    const section = m.sections.people;
    expect(section.status).toBe('ok');
    if (section.status === 'ok') {
      expect(section.items.length).toBe(5);
      expect(section.total).toBe(8);
    }
  });

  it('places provider caps results at top 3', async () => {
    vi.mocked(searchPlaces).mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, latitude: i, longitude: i })) as unknown as Awaited<
        ReturnType<typeof searchPlaces>
      >,
    );
    const m = new GlobalSearchManager();
    m.setQuery('sa');
    await vi.advanceTimersByTimeAsync(200);
    const section = m.sections.places;
    expect(section.status).toBe('ok');
    if (section.status === 'ok') {
      expect(section.items.length).toBe(3);
      expect(section.total).toBe(6);
    }
  });
});

describe('tag provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchSmart>>);
    vi.mocked(searchAssets).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchAssets>>);
    vi.mocked(searchPerson).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPerson>>);
    vi.mocked(searchPlaces).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPlaces>>);
    vi.mocked(getAllTags).mockResolvedValue([
      { id: 't1', name: 'beach', color: null },
      { id: 't2', name: 'beer', color: null },
      { id: 't3', name: 'mountain', color: null },
    ] as unknown as Awaited<ReturnType<typeof getAllTags>>);
  });

  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('filters tags by case-insensitive substring on name', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('BE');
    await vi.advanceTimersByTimeAsync(200);
    const section = m.sections.tags;
    expect(section.status).toBe('ok');
    if (section.status === 'ok') {
      expect((section.items as Array<{ name: string }>).map((t) => t.name).sort()).toEqual(['beach', 'beer']);
    }
  });

  it('caches getAllTags across keystrokes', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('be');
    await vi.advanceTimersByTimeAsync(200);
    m.setQuery('mou');
    await vi.advanceTimersByTimeAsync(200);
    expect(getAllTags).toHaveBeenCalledTimes(1);
  });

  it('close() clears cache; reopen refetches', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('be');
    await vi.advanceTimersByTimeAsync(200);
    m.close();
    m.open();
    m.setQuery('be');
    await vi.advanceTimersByTimeAsync(200);
    expect(getAllTags).toHaveBeenCalledTimes(2);
  });

  it('disables tag provider at > 20 000 tags', async () => {
    vi.mocked(getAllTags).mockResolvedValue(
      Array.from({ length: 20_001 }, (_, i) => ({ id: `t${i}`, name: `tag${i}`, color: null })) as unknown as Awaited<
        ReturnType<typeof getAllTags>
      >,
    );
    // Silence the console.warn from the 20k-cap branch
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = new GlobalSearchManager();
    m.setQuery('tag');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.tags).toEqual({ status: 'error', message: 'tag_cache_too_large' });
    warnSpy.mockRestore();
  });

  it('invalidates cache on storage event for cmdk.tags.version', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('be');
    await vi.advanceTimersByTimeAsync(200);
    window.dispatchEvent(new StorageEvent('storage', { key: 'cmdk.tags.version', newValue: '2' }));
    m.setQuery('mou');
    await vi.advanceTimersByTimeAsync(200);
    expect(getAllTags).toHaveBeenCalledTimes(2);
  });

  it('getAllTags failure renders error row, retries on next keystroke', async () => {
    vi.mocked(getAllTags).mockRejectedValueOnce(new Error('boom'));
    const m = new GlobalSearchManager();
    m.setQuery('be');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.tags.status).toBe('error');
    vi.mocked(getAllTags).mockResolvedValueOnce([
      { id: 't1', name: 'beach', color: null },
    ] as unknown as Awaited<ReturnType<typeof getAllTags>>);
    m.setQuery('bea');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.tags.status).toBe('ok');
  });
});

describe('setMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchSmart>>);
    vi.mocked(searchAssets).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchAssets>>);
    vi.mocked(searchPerson).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPerson>>);
    vi.mocked(searchPlaces).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPlaces>>);
    vi.mocked(getAllTags).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getAllTags>>);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('aborts in-flight photos only, re-runs with new mode; people untouched', async () => {
    let photosCalls = 0;
    let peopleCalls = 0;
    const m = new GlobalSearchManager();
    const providers = (m as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    providers.photos.run = async () => {
      photosCalls++;
      return { status: 'ok', items: [], total: 0 };
    };
    providers.people.run = async () => {
      peopleCalls++;
      return { status: 'ok', items: [], total: 0 };
    };
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(photosCalls).toBe(1);
    expect(peopleCalls).toBe(1);
    m.setMode('metadata');
    await vi.advanceTimersByTimeAsync(10);
    expect(photosCalls).toBe(2);
    expect(peopleCalls).toBe(1);
  });

  it('setMode during pending debounce restarts timer with new mode', async () => {
    const m = new GlobalSearchManager();
    const providers = (m as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    const photosRun = vi.fn().mockResolvedValue({ status: 'ok', items: [], total: 0 } as ProviderStatus);
    providers.photos.run = photosRun;
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(50);
    m.setMode('metadata');
    await vi.advanceTimersByTimeAsync(200);
    expect(photosRun).toHaveBeenCalledOnce();
    expect(photosRun).toHaveBeenCalledWith('beach', 'metadata', expect.any(AbortSignal));
  });

  it('persists mode to localStorage', () => {
    const m = new GlobalSearchManager();
    m.setMode('ocr');
    expect(localStorage.getItem('searchQueryType')).toBe('ocr');
  });

  it('setMode with empty query is a no-op for providers', async () => {
    const m = new GlobalSearchManager();
    const providers = (m as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    const photosRun = vi.fn();
    providers.photos.run = photosRun;
    m.setMode('metadata');
    await vi.advanceTimersByTimeAsync(200);
    expect(photosRun).not.toHaveBeenCalled();
  });
});

describe('cursor identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchSmart>>);
    vi.mocked(searchAssets).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchAssets>>);
    vi.mocked(searchPerson).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPerson>>);
    vi.mocked(searchPlaces).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPlaces>>);
    vi.mocked(getAllTags).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getAllTags>>);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('preserves activeItemId when a later section populates above it', async () => {
    const m = new GlobalSearchManager();
    const providers = (m as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    providers.people.run = async () => ({ status: 'ok', items: [{ id: 'p1', name: 'Alice' }], total: 1 });
    providers.photos.run = async () => ({ status: 'ok', items: [{ id: 'a1' }, { id: 'a2' }], total: 2 });
    m.setQuery('alice');
    await vi.advanceTimersByTimeAsync(200);
    m.setActiveItem('person:p1');
    expect(m.activeItemId).toBe('person:p1');
    m.sections.photos = { status: 'ok', items: [{ id: 'a3' }] as unknown[], total: 1 };
    m.reconcileCursor();
    expect(m.activeItemId).toBe('person:p1');
  });

  it('falls back to first top-section row when tracked id disappears', async () => {
    const m = new GlobalSearchManager();
    const providers = (m as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    providers.photos.run = async () => ({ status: 'ok', items: [{ id: 'a1' }, { id: 'a2' }], total: 2 });
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    m.setActiveItem('photo:a1');
    providers.photos.run = async () => ({ status: 'ok', items: [{ id: 'a9' }], total: 1 });
    m.setQuery('sunset');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.activeItemId).toBe('photo:a9');
  });
});

describe('Enter race', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchSmart>>);
    vi.mocked(searchAssets).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchAssets>>);
    vi.mocked(searchPerson).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPerson>>);
    vi.mocked(searchPlaces).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPlaces>>);
    vi.mocked(getAllTags).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getAllTags>>);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('getActiveItem captures the currently-highlighted item by reference', async () => {
    const m = new GlobalSearchManager();
    const providers = (m as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    providers.photos.run = async () => ({ status: 'ok', items: [{ id: 'a1' }], total: 1 });
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    m.setActiveItem('photo:a1');
    const active = m.getActiveItem();
    expect(active?.kind).toBe('photo');
    expect((active?.data as { id: string }).id).toBe('a1');
  });

  it('Enter on stale cursor returns null (no-op at call site)', () => {
    const m = new GlobalSearchManager();
    m.activeItemId = 'photo:nonexistent';
    expect(m.getActiveItem()).toBe(null);
  });
});

describe('ML health retroactive promotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchSmart>>);
    vi.mocked(searchAssets).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchAssets>>);
    vi.mocked(searchPerson).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPerson>>);
    vi.mocked(searchPlaces).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPlaces>>);
    vi.mocked(getAllTags).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getAllTags>>);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('sets mlHealthy=false when photos times out in smart mode', async () => {
    const m = new GlobalSearchManager();
    const providers = (m as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    providers.photos.run = (_q: string, _mode: SearchMode, signal: AbortSignal) =>
      new Promise<ProviderStatus>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })));
      });
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(m.mlHealthy).toBe(false);
  });

  it('does NOT promote banner in non-smart mode', async () => {
    localStorage.setItem('searchQueryType', 'metadata');
    const m = new GlobalSearchManager();
    const providers = (m as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    providers.photos.run = (_q: string, _mode: SearchMode, signal: AbortSignal) =>
      new Promise<ProviderStatus>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })));
      });
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(m.mlHealthy).toBe(true);
  });
});

describe('activate()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
  });

  it('activate("photo", item) calls goto with /photos/:id and records recent entry', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activate('photo', { id: 'a1', originalFileName: 'sunset.jpg' });
    expect(goto).toHaveBeenCalledWith('/photos/a1');
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'photo', id: 'photo:a1', assetId: 'a1', label: 'sunset.jpg' });
    expect(m.isOpen).toBe(false);
  });

  it('activate("person", item) navigates to /people/:id and records recent entry', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activate('person', { id: 'p1', name: 'Alice', faceAssetId: 'face1' });
    expect(goto).toHaveBeenCalledWith('/people/p1');
    const entries = getEntries();
    expect(entries[0]).toMatchObject({ kind: 'person', personId: 'p1', label: 'Alice', thumbnailAssetId: 'face1' });
  });

  it('activate("place", item) navigates to /map with hash and records recent entry', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activate('place', { name: 'Paris', latitude: 48.8566, longitude: 2.3522 });
    expect(goto).toHaveBeenCalledWith('/map#12/48.8566/2.3522');
    const entries = getEntries();
    expect(entries[0]).toMatchObject({ kind: 'place', id: 'place:48.8566:2.3522', label: 'Paris' });
  });

  it('activate("tag", item) navigates to /search with tagIds and records recent entry', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activate('tag', { id: 't1', name: 'beach' });
    const firstCall = vi.mocked(goto).mock.calls[0]?.[0] as string;
    expect(firstCall).toContain('/search');
    expect(decodeURIComponent(firstCall)).toContain('"tagIds":["t1"]');
    const entries = getEntries();
    expect(entries[0]).toMatchObject({ kind: 'tag', id: 'tag:t1', tagId: 't1', label: 'beach' });
  });
});

describe('activateRecent()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchSmart>>);
    vi.mocked(searchAssets).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchAssets>>);
    vi.mocked(searchPerson).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPerson>>);
    vi.mocked(searchPlaces).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPlaces>>);
    vi.mocked(getAllTags).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getAllTags>>);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('query entry re-runs the search in place without closing', async () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activateRecent({ kind: 'query', id: 'q:beach', text: 'beach', mode: 'metadata', lastUsed: 1 });
    expect(m.mode).toBe('metadata');
    expect(m.query).toBe('beach');
    expect(m.isOpen).toBe(true);
    expect(goto).not.toHaveBeenCalled();
  });

  it('photo entry navigates and closes', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activateRecent({ kind: 'photo', id: 'photo:a1', assetId: 'a1', label: 'x.jpg', lastUsed: 1 });
    expect(goto).toHaveBeenCalledWith('/photos/a1');
    expect(m.isOpen).toBe(false);
  });

  it('person entry navigates and closes', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activateRecent({ kind: 'person', id: 'person:p1', personId: 'p1', label: 'Alice', lastUsed: 1 });
    expect(goto).toHaveBeenCalledWith('/people/p1');
    expect(m.isOpen).toBe(false);
  });

  it('place entry navigates and closes', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activateRecent({
      kind: 'place',
      id: 'place:48.8566:2.3522',
      latitude: 48.8566,
      longitude: 2.3522,
      label: 'Paris',
      lastUsed: 1,
    });
    expect(goto).toHaveBeenCalledWith('/map#12/48.8566/2.3522');
    expect(m.isOpen).toBe(false);
  });

  it('tag entry navigates and closes', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activateRecent({ kind: 'tag', id: 'tag:t1', tagId: 't1', label: 'beach', lastUsed: 1 });
    const firstCall = vi.mocked(goto).mock.calls[0]?.[0] as string;
    expect(firstCall).toContain('/search');
    expect(m.isOpen).toBe(false);
  });

  it('updates lastUsed on re-activation', () => {
    const m = new GlobalSearchManager();
    m.open();
    const now = Date.now();
    m.activateRecent({ kind: 'photo', id: 'photo:a1', assetId: 'a1', label: 'x.jpg', lastUsed: 1 });
    const entries = getEntries();
    expect(entries[0].lastUsed).toBeGreaterThanOrEqual(now);
  });
});

describe('announcementText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('returns empty string while any provider is still loading', () => {
    const m = new GlobalSearchManager();
    m.sections = {
      photos: { status: 'loading' },
      people: { status: 'ok', items: [{ id: 'p1' }], total: 1 },
      places: { status: 'empty' },
      tags: { status: 'empty' },
      navigation: { status: 'empty' },
    };
    expect(m.announcementText).toBe('');
  });

  it('aggregates non-zero counts once all providers have settled', () => {
    const m = new GlobalSearchManager();
    m.sections = {
      photos: { status: 'ok', items: [{ id: 'a1' }], total: 42 },
      people: { status: 'ok', items: [{ id: 'p1' }], total: 5 },
      places: { status: 'empty' },
      tags: { status: 'ok', items: [{ id: 't1' }], total: 3 },
      navigation: { status: 'empty' },
    };
    expect(m.announcementText).toBe('42 photos, 5 people, 3 tags');
  });

  it('returns "" if all settled sections are empty', () => {
    const m = new GlobalSearchManager();
    m.sections = {
      photos: { status: 'empty' },
      people: { status: 'empty' },
      places: { status: 'empty' },
      tags: { status: 'empty' },
      navigation: { status: 'empty' },
    };
    expect(m.announcementText).toBe('');
  });
});

describe('reconcileCursor fallback + getActiveItem edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('reconcileCursor sets activeItemId to null when all sections are empty', () => {
    const m = new GlobalSearchManager();
    m.activeItemId = 'photo:ghost';
    m.sections = {
      photos: { status: 'empty' },
      people: { status: 'empty' },
      places: { status: 'empty' },
      tags: { status: 'empty' },
      navigation: { status: 'empty' },
    };
    m.reconcileCursor();
    expect(m.activeItemId).toBe(null);
  });

  it('getActiveItem returns null when the target section is still loading', () => {
    const m = new GlobalSearchManager();
    m.activeItemId = 'photo:a1';
    m.sections = {
      photos: { status: 'loading' },
      people: { status: 'idle' },
      places: { status: 'idle' },
      tags: { status: 'idle' },
      navigation: { status: 'idle' },
    };
    expect(m.getActiveItem()).toBe(null);
  });

  it('getActiveItem returns null for an activeItemId with no prefix separator', () => {
    const m = new GlobalSearchManager();
    m.activeItemId = 'malformed';
    expect(m.getActiveItem()).toBe(null);
  });
});

describe('edge-case guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchSmart>>);
    vi.mocked(searchAssets).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchAssets>>);
    vi.mocked(searchPerson).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPerson>>);
    vi.mocked(searchPlaces).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPlaces>>);
    vi.mocked(getAllTags).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getAllTags>>);
    vi.mocked(getMlHealth).mockResolvedValue({ smartSearchHealthy: true } as never);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('setQuery while closed: leaves no visible state after next open/type cycle', async () => {
    const m = new GlobalSearchManager();
    // Never opened. setQuery mutates internal query but no UI is bound so it's harmless.
    m.setQuery('phantom');
    await vi.advanceTimersByTimeAsync(200);
    // Sections get loaded states because we run providers. Ensure close() cleans up.
    m.close();
    expect(m.query).toBe('');
    expect(m.sections.photos).toEqual({ status: 'idle' });
    // Now open and type — the fresh cycle should work normally.
    m.open();
    m.setQuery('real');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchSmart).toHaveBeenCalled();
  });

  it('ML probe resolving after close() does not mutate mlHealthy', async () => {
    let resolveProbe!: (v: { smartSearchHealthy: boolean }) => void;
    vi.mocked(getMlHealth).mockImplementationOnce(() => new Promise((r) => (resolveProbe = r)));
    const m = new GlobalSearchManager();
    m.open();
    expect(m.mlHealthy).toBe(true);
    m.close();
    // Late probe resolution with a false value — should be discarded.
    resolveProbe({ smartSearchHealthy: false });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(m.mlHealthy).toBe(true);
  });

  it('activateRecent with corrupt photo entry (missing assetId) no-ops and closes', () => {
    const m = new GlobalSearchManager();
    m.open();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    m.activateRecent({
      kind: 'photo',
      id: 'photo:ghost',
      assetId: '' as unknown as string,
      label: '',
      lastUsed: 1,
    });
    expect(warnSpy).toHaveBeenCalled();
    expect(m.isOpen).toBe(false);
    warnSpy.mockRestore();
  });

  it('activateRecent with corrupt place entry (non-finite lat) no-ops and closes', () => {
    const m = new GlobalSearchManager();
    m.open();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    m.activateRecent({
      kind: 'place',
      id: 'place:bad',
      latitude: Number.NaN,
      longitude: 0,
      label: 'Broken',
      lastUsed: 1,
    });
    expect(warnSpy).toHaveBeenCalled();
    expect(m.isOpen).toBe(false);
    warnSpy.mockRestore();
  });

  it('activateRecent with corrupt query entry (invalid mode) no-ops and closes', () => {
    const m = new GlobalSearchManager();
    m.open();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    m.activateRecent({
      kind: 'query',
      id: 'q:bad',
      text: 'x',
      mode: 'evil' as unknown as 'smart',
      lastUsed: 1,
    });
    expect(warnSpy).toHaveBeenCalled();
    expect(m.isOpen).toBe(false);
    warnSpy.mockRestore();
  });

  it('unicode / emoji query is passed through to providers untouched', async () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('🍕 café München');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchSmart).toHaveBeenCalledWith(
      expect.objectContaining({
        smartSearchDto: expect.objectContaining({ query: '🍕 café München' }),
      }),
      expect.anything(),
    );
  });
});

describe('ML health probe on open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(getMlHealth).mockResolvedValue({ smartSearchHealthy: true } as never);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('probes on first open and caches for the session', async () => {
    const m = new GlobalSearchManager();
    m.open();
    await vi.advanceTimersByTimeAsync(0);
    m.close();
    m.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(getMlHealth).toHaveBeenCalledOnce();
  });

  it('sets mlHealthy=false when probe reports unhealthy', async () => {
    vi.mocked(getMlHealth).mockResolvedValue({ smartSearchHealthy: false } as never);
    const m = new GlobalSearchManager();
    m.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.mlHealthy).toBe(false);
  });

  it('trusts current state if probe throws', async () => {
    vi.mocked(getMlHealth).mockRejectedValue(new Error('net'));
    const m = new GlobalSearchManager();
    m.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.mlHealthy).toBe(true);
  });
});

describe('tagsDisabled persists across close/reopen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchSmart>>);
    vi.mocked(searchAssets).mockResolvedValue({
      assets: { items: [], nextPage: null },
    } as unknown as Awaited<ReturnType<typeof searchAssets>>);
    vi.mocked(searchPerson).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPerson>>);
    vi.mocked(searchPlaces).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof searchPlaces>>);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('once disabled for one session, stays disabled after close + reopen', async () => {
    vi.mocked(getAllTags).mockResolvedValue(
      Array.from({ length: 20_001 }, (_, i) => ({ id: `t${i}`, name: `tag${i}`, color: null })) as unknown as Awaited<
        ReturnType<typeof getAllTags>
      >,
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = new GlobalSearchManager();
    m.setQuery('tag');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.tags).toEqual({ status: 'error', message: 'tag_cache_too_large' });
    const callsAfterFirst = vi.mocked(getAllTags).mock.calls.length;
    m.close();
    m.open();
    // Swap mock to a tiny list — if tagsDisabled reset, this would succeed and repopulate.
    vi.mocked(getAllTags).mockResolvedValue([
      { id: 't1', name: 'beach', color: null },
    ] as unknown as Awaited<ReturnType<typeof getAllTags>>);
    m.setQuery('tag');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.tags).toEqual({ status: 'error', message: 'tag_cache_too_large' });
    // getAllTags should NOT have been re-invoked because tagsDisabled short-circuits.
    expect(vi.mocked(getAllTags).mock.calls.length).toBe(callsAfterFirst);
    warnSpy.mockRestore();
  });
});

describe('navigation section scaffolding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('sections.navigation starts as idle', () => {
    const m = new GlobalSearchManager();
    expect(m.sections.navigation).toEqual({ status: 'idle' });
  });

  it('sectionForKind("nav") returns sections.navigation', () => {
    const m = new GlobalSearchManager();
    m.sections.navigation = {
      status: 'ok',
      items: [{ id: 'nav:theme' }] as never[],
      total: 1,
    };
    m.activeItemId = 'nav:theme';
    const active = m.getActiveItem();
    expect(active?.kind).toBe('nav');
  });

  it('announcementText includes navigation count as "N pages" when ok', () => {
    const m = new GlobalSearchManager();
    m.sections = {
      photos: { status: 'empty' },
      people: { status: 'empty' },
      places: { status: 'empty' },
      tags: { status: 'empty' },
      navigation: { status: 'ok', items: [{ id: 'nav:theme' }] as never[], total: 5 },
    };
    expect(m.announcementText).toBe('5 pages');
  });

  it('reconcileCursor falls through to navigation when entity sections are empty', () => {
    const m = new GlobalSearchManager();
    m.sections = {
      photos: { status: 'empty' },
      people: { status: 'empty' },
      places: { status: 'empty' },
      tags: { status: 'empty' },
      navigation: { status: 'ok', items: [{ id: 'nav:theme' }] as never[], total: 1 },
    };
    m.activeItemId = null;
    m.reconcileCursor();
    expect(m.activeItemId).toBe('nav:theme');
  });
});

describe('navigation memo cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockI18nLocale.current = 'en';
  });

  it('builds cache on first access for the current locale', () => {
    const m = new GlobalSearchManager();
    const cache = (
      m as unknown as { getNavigationSearchStrings: () => Map<string, string> }
    ).getNavigationSearchStrings();
    expect(cache.size).toBe(36);
    for (const [id, str] of cache) {
      expect(id.startsWith('nav:')).toBe(true);
      expect(str.length).toBeGreaterThan(0);
    }
  });

  it('reuses the cached table on subsequent calls', () => {
    const m = new GlobalSearchManager();
    const a = (
      m as unknown as { getNavigationSearchStrings: () => Map<string, string> }
    ).getNavigationSearchStrings();
    const b = (
      m as unknown as { getNavigationSearchStrings: () => Map<string, string> }
    ).getNavigationSearchStrings();
    expect(a).toBe(b);
  });

  it('handles a null locale gracefully (svelte-i18n before init)', () => {
    mockI18nLocale.current = null;
    const m = new GlobalSearchManager();
    const cache = (
      m as unknown as { getNavigationSearchStrings: () => Map<string, string> }
    ).getNavigationSearchStrings();
    expect(cache.size).toBe(36);
    mockI18nLocale.current = 'en';
  });
});

describe('runNavigationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUser.current = { isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
    mockI18nLocale.current = 'en';
  });

  function runNav(m: GlobalSearchManager, query: string): ProviderStatus<unknown> {
    return (
      m as unknown as { runNavigationProvider: (q: string) => ProviderStatus<unknown> }
    ).runNavigationProvider(query);
  }

  it('returns empty for short queries (below minQueryLength 2)', () => {
    const m = new GlobalSearchManager();
    expect(runNav(m, '').status).toBe('empty');
    expect(runNav(m, 'a').status).toBe('empty');
  });

  it('returns ok with classification_settings in the result set for query "classific"', () => {
    const m = new GlobalSearchManager();
    const result = runNav(m, 'classific');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const labels = result.items.map((i) => (i as { labelKey: string }).labelKey);
      expect(labels).toContain('admin.classification_settings');
    }
  });

  it('filters admin-only items for non-admin users', () => {
    mockUser.current = { isAdmin: false };
    const m = new GlobalSearchManager();
    const result = runNav(m, 'classific');
    if (result.status === 'ok') {
      for (const item of result.items) {
        expect((item as { adminOnly: boolean }).adminOnly).toBe(false);
      }
    }
  });

  it('filters items gated on a disabled feature flag', () => {
    mockFlags.valueOrUndefined = { search: true, map: false, trash: true };
    const m = new GlobalSearchManager();
    const result = runNav(m, 'map');
    if (result.status === 'ok') {
      const ids = result.items.map((i) => (i as { id: string }).id);
      expect(ids).not.toContain('nav:userPages:map');
    }
  });

  it('items gated on a feature flag are hidden when flags have not loaded yet (SSR window)', () => {
    mockFlags.valueOrUndefined = undefined;
    const m = new GlobalSearchManager();
    const result = runNav(m, 'map');
    if (result.status === 'ok') {
      const ids = result.items.map((i) => (i as { id: string }).id);
      expect(ids).not.toContain('nav:userPages:map');
    }
  });

  it('hyphenated query is tolerated by computeCommandScore (key fallback locale)', () => {
    // Test setup uses svelte-i18n with `fallbackLocale: 'dev'`, which renders the literal
    // i18n key for missing translations. The searchable corpus for the classification item
    // is therefore "admin.classification_settings admin.classification_settings_description".
    // 'class-set' matches because chars c-l-a-s-s-_-s-e-t all appear in order and the
    // hyphen is tolerated by bits-ui's tokenizer.
    const m = new GlobalSearchManager();
    const result = runNav(m, 'class-set');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const labels = result.items.map((i) => (i as { labelKey: string }).labelKey);
      expect(labels).toContain('admin.classification_settings');
    }
  });
});
