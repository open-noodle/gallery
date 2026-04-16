import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Shared hoisted mocks — used by navigation tests to flip admin/feature-flag state.
// Must appear BEFORE the GlobalSearchManager import because the manager binds these
// modules at module load; vi.doMock inside tests is too late.
const { mockUser } = vi.hoisted(() => ({
  // id is used by the cmdk-recent store to scope localStorage per user — every
  // test in this suite runs under the same synthetic user unless it explicitly
  // flips `mockUser.current` to something else.
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

import { goto } from '$app/navigation';
import { themeManager } from '$lib/managers/theme-manager.svelte';
import { addEntry, getEntries, __resetForTests as resetRecentStore } from '$lib/stores/cmdk-recent';
import { getAllTags, getMlHealth, searchAssets, searchPerson, searchPlaces, searchSmart } from '@immich/sdk';
import { computeCommandScore } from 'bits-ui';
import { installFakeAbortTimeout, restoreAbortTimeout } from './__tests__/fake-abort-timeout';
import {
  GlobalSearchManager,
  type Provider,
  type ProviderStatus,
  type SearchMode,
  type Sections,
} from './global-search-manager.svelte';

// File-level reset so mock state cannot leak between describe blocks. Tests that
// mutate these should still set what they want in their own beforeEach, but this
// guarantees that forgetting to reset cannot poison later tests.
afterEach(() => {
  mockUser.current = { id: 'test-user', isAdmin: true };
  mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
  mockI18nLocale.current = 'en';
});

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
// `setLocale(v)` drives all live subscribers — required by the cache-invalidation test
// which asserts that a locale change clears the navigation memo cache.
const { mockI18nLocale } = vi.hoisted(() => {
  const subscribers = new Set<(v: string | null) => void>();
  const state = {
    current: 'en' as string | null,
    subscribers,
    setLocale(v: string | null) {
      state.current = v;
      for (const sub of subscribers) {
        sub(v);
      }
    },
  };
  return { mockI18nLocale: state };
});
vi.mock('svelte-i18n', async (orig) => {
  const actual = await orig<typeof import('svelte-i18n')>();
  return {
    ...actual,
    locale: {
      subscribe: (run: (v: string | null) => void) => {
        run(mockI18nLocale.current);
        mockI18nLocale.subscribers.add(run);
        return () => {
          mockI18nLocale.subscribers.delete(run);
        };
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
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
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
    await vi.advanceTimersByTimeAsync(5100);
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
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'cmdk.tags.version', newValue: '2' }));
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
    vi.mocked(getAllTags).mockResolvedValueOnce([{ id: 't1', name: 'beach', color: null }] as unknown as Awaited<
      ReturnType<typeof getAllTags>
    >);
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
    providers.photos.run = () => {
      photosCalls++;
      return Promise.resolve({ status: 'ok' as const, items: [], total: 0 });
    };
    providers.people.run = () => {
      peopleCalls++;
      return Promise.resolve({ status: 'ok' as const, items: [], total: 0 });
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
    providers.people.run = () =>
      Promise.resolve({ status: 'ok' as const, items: [{ id: 'p1', name: 'Alice' }], total: 1 });
    providers.photos.run = () =>
      Promise.resolve({ status: 'ok' as const, items: [{ id: 'a1' }, { id: 'a2' }], total: 2 });
    m.setQuery('alice');
    await vi.advanceTimersByTimeAsync(200);
    m.setActiveItem('person:p1');
    expect(m.activeItemId).toBe('person:p1');
    m.sections.photos = { status: 'ok', items: [{ id: 'a3' }], total: 1 };
    m.reconcileCursor();
    expect(m.activeItemId).toBe('person:p1');
  });

  it('falls back to first top-section row when tracked id disappears', async () => {
    const m = new GlobalSearchManager();
    const providers = (m as unknown as { providers: Record<keyof Sections, Provider> }).providers;
    providers.photos.run = () =>
      Promise.resolve({ status: 'ok' as const, items: [{ id: 'a1' }, { id: 'a2' }], total: 2 });
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    m.setActiveItem('photo:a1');
    providers.photos.run = () => Promise.resolve({ status: 'ok' as const, items: [{ id: 'a9' }], total: 1 });
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
    providers.photos.run = () => Promise.resolve({ status: 'ok' as const, items: [{ id: 'a1' }], total: 1 });
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
    await vi.advanceTimersByTimeAsync(5100);
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
    await vi.advanceTimersByTimeAsync(5100);
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

  it('query entry re-runs the search in place without closing', () => {
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

describe('topNavigationMatch', () => {
  // Promotes a nav item to the "Top result" band when the query almost-exactly
  // matches its label. Read-only derived on the manager, sourced from whatever
  // `sections.navigation` currently holds — the nav provider runs synchronously
  // so these tests drive it via the full setQuery/debounce flow.
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUser.current = { id: 'test-user', isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
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

  it('is null before any query is set', () => {
    const m = new GlobalSearchManager();
    m.open();
    expect(m.topNavigationMatch).toBeNull();
  });

  it('promotes People when the user types "people"', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('people');
    // Navigation runs synchronously inside setQuery so sections.navigation is
    // already populated; no timers or awaits needed.
    expect(m.topNavigationMatch?.id).toBe('nav:userPages:people');
  });

  it('promotes Albums when the user types "album" (prefix match)', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('album');
    expect(m.topNavigationMatch?.id).toBe('nav:userPages:albums');
  });

  it('promotes Classification Settings for "auto-classification" (compound query)', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('auto-classification');
    // Admin user in beforeEach — the item is adminOnly.
    expect(m.topNavigationMatch?.id).toBe('nav:systemSettings:classification');
  });

  it('returns null when the query is shorter than the 3-char floor', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('sp');
    // The nav provider runs from 1 char so it fires, but the almost-exact
    // gate still rejects short queries so the promotion slot stays empty.
    expect(m.topNavigationMatch).toBeNull();
  });

  it('returns null when no nav item label almost-matches the query', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('zzzzzz');
    expect(m.topNavigationMatch).toBeNull();
  });
});

describe('removeRecent()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
  });

  it('removes the matching recent entry from the store', () => {
    addEntry({ kind: 'query', id: 'q:beach', text: 'beach', mode: 'smart', lastUsed: 1 });
    addEntry({ kind: 'query', id: 'q:sunset', text: 'sunset', mode: 'smart', lastUsed: 2 });
    const m = new GlobalSearchManager();
    m.removeRecent('q:beach');
    expect(getEntries().map((e) => e.id)).toEqual(['q:sunset']);
  });

  it('bumps recentsRevision so Svelte-derived views can re-read', () => {
    // The component's `recentEntries` derived depends on `manager.recentsRevision`
    // because cmdk-recent is a plain-function store (not a Svelte store). Without
    // a reactive tick, a mid-session mutation would leave the deleted row in the
    // DOM until the palette closed and reopened.
    addEntry({ kind: 'query', id: 'q:beach', text: 'beach', mode: 'smart', lastUsed: 1 });
    const m = new GlobalSearchManager();
    const before = m.recentsRevision;
    m.removeRecent('q:beach');
    expect(m.recentsRevision).toBeGreaterThan(before);
  });

  it('no-op on a missing id — revision unchanged', () => {
    const m = new GlobalSearchManager();
    const before = m.recentsRevision;
    m.removeRecent('does-not-exist');
    expect(m.recentsRevision).toBe(before);
  });

  it('reconciles the cursor after removing the currently-highlighted recent', () => {
    // When the user deletes the active row, the highlight must move to the next
    // available entry so keyboard users do not end up on a dead cursor.
    addEntry({ kind: 'query', id: 'q:beach', text: 'beach', mode: 'smart', lastUsed: 1 });
    addEntry({ kind: 'query', id: 'q:sunset', text: 'sunset', mode: 'smart', lastUsed: 2 });
    const m = new GlobalSearchManager();
    m.open();
    m.setActiveItem('q:sunset');
    m.removeRecent('q:sunset');
    // 'q:sunset' is gone, the remaining entry 'q:beach' must take the highlight.
    expect(m.activeItemId).toBe('q:beach');
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
    // getActiveItem now consults recents when the query is empty, so stale entries
    // from prior describes would mask the section-based edge cases this block tests.
    resetRecentStore();
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
    vi.mocked(getAllTags).mockResolvedValue([{ id: 't1', name: 'beach', color: null }] as unknown as Awaited<
      ReturnType<typeof getAllTags>
    >);
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
    const a = (m as unknown as { getNavigationSearchStrings: () => Map<string, string> }).getNavigationSearchStrings();
    const b = (m as unknown as { getNavigationSearchStrings: () => Map<string, string> }).getNavigationSearchStrings();
    expect(a).toBe(b);
  });

  it('handles a null locale gracefully (svelte-i18n before init)', () => {
    mockI18nLocale.current = null;
    const m = new GlobalSearchManager();
    const cache = (
      m as unknown as { getNavigationSearchStrings: () => Map<string, string> }
    ).getNavigationSearchStrings();
    expect(cache.size).toBe(36);
  });

  it('clears the cached table when the locale subscription fires with a new value', () => {
    const m = new GlobalSearchManager();
    const first = (
      m as unknown as { getNavigationSearchStrings: () => Map<string, string> }
    ).getNavigationSearchStrings();
    // Drive the subscribers: this mirrors svelte-i18n emitting a new locale after
    // the user switches language. The manager's locale subscription should fire
    // and clear `navigationSearchCache`, forcing the next call to rebuild.
    mockI18nLocale.setLocale('de');
    const second = (
      m as unknown as { getNavigationSearchStrings: () => Map<string, string> }
    ).getNavigationSearchStrings();
    expect(second).not.toBe(first);
    expect(second.size).toBe(36);
  });
});

describe('getActiveItem nav branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('returns a nav ActiveItem when activeItemId is a nav id matching navigation.items', () => {
    const m = new GlobalSearchManager();
    m.sections = {
      photos: { status: 'empty' },
      people: { status: 'empty' },
      places: { status: 'empty' },
      tags: { status: 'empty' },
      navigation: {
        status: 'ok',
        items: [
          {
            id: 'nav:theme',
            category: 'actions',
            labelKey: 'theme',
            descriptionKey: 'toggle_theme_description',
            icon: 'x',
            route: '',
            adminOnly: false,
          },
        ] as never[],
        total: 1,
      },
    };
    m.activeItemId = 'nav:theme';
    const active = m.getActiveItem();
    expect(active).not.toBeNull();
    expect(active?.kind).toBe('nav');
    if (active?.kind === 'nav') {
      expect(active.data.id).toBe('nav:theme');
    }
  });

  it('returns null when activeItemId is a nav id not present in the navigation section', () => {
    const m = new GlobalSearchManager();
    m.sections = {
      photos: { status: 'empty' },
      people: { status: 'empty' },
      places: { status: 'empty' },
      tags: { status: 'empty' },
      navigation: {
        status: 'ok',
        items: [{ id: 'nav:theme' } as never],
        total: 1,
      },
    };
    m.activeItemId = 'nav:userPages:map'; // not in the section
    expect(m.getActiveItem()).toBeNull();
  });
});

describe('runNavigationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUser.current = { id: 'test-user', isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
    mockI18nLocale.current = 'en';
  });

  function runNav(m: GlobalSearchManager, query: string): ProviderStatus<unknown> {
    return (m as unknown as { runNavigationProvider: (q: string) => ProviderStatus<unknown> }).runNavigationProvider(
      query,
    );
  }

  it('returns empty only for an empty query; fires on a single character', () => {
    const m = new GlobalSearchManager();
    expect(runNav(m, '').status).toBe('empty');
    // Single-letter queries must reach the scorer so system-settings and
    // action items surface immediately as the user starts typing.
    expect(runNav(m, 't').status).toBe('ok');
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
    // Query 'theme' DEFINITELY matches:
    //   - nav:theme                     (adminOnly:false, labelKey='theme')
    //   - nav:systemSettings:theme      (adminOnly:true,  labelKey='admin.theme_settings')
    // Under non-admin this yields status='ok' with exactly nav:theme, so the
    // assertion is forced to run (no vacuous-loop path).
    mockUser.current = { id: 'test-user', isAdmin: false };
    const m = new GlobalSearchManager();
    const result = runNav(m, 'theme');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const ids = result.items.map((i) => (i as { id: string }).id);
      expect(ids).toContain('nav:theme');
      expect(ids).not.toContain('nav:systemSettings:theme');
      expect(result.items.every((i) => (i as { adminOnly: boolean }).adminOnly === false)).toBe(true);
    }
  });

  it('admin users see both admin and non-admin matches (baseline for the admin filter test)', () => {
    mockUser.current = { id: 'test-user', isAdmin: true };
    const m = new GlobalSearchManager();
    const result = runNav(m, 'theme');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const ids = result.items.map((i) => (i as { id: string }).id);
      expect(ids).toContain('nav:theme');
      expect(ids).toContain('nav:systemSettings:theme');
    }
  });

  it('filters items gated on a disabled feature flag', () => {
    // Query 'map' (admin=true) DEFINITELY matches:
    //   - nav:userPages:map            (featureFlag:'map')
    //   - nav:systemSettings:location  (labelKey='admin.map_gps_settings', no flag)
    // With map flag disabled, status='ok' is guaranteed because the system-settings
    // item is still present, so the negative assertion is non-vacuous.
    mockUser.current = { id: 'test-user', isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: false, trash: true };
    const m = new GlobalSearchManager();
    const result = runNav(m, 'map');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const ids = result.items.map((i) => (i as { id: string }).id);
      expect(ids).not.toContain('nav:userPages:map');
      expect(ids).toContain('nav:systemSettings:location');
    }
  });

  it('items gated on a feature flag are hidden when flags have not loaded yet (SSR window)', () => {
    mockUser.current = { id: 'test-user', isAdmin: true };
    mockFlags.valueOrUndefined = undefined;
    const m = new GlobalSearchManager();
    const result = runNav(m, 'map');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const ids = result.items.map((i) => (i as { id: string }).id);
      expect(ids).not.toContain('nav:userPages:map');
      expect(ids).toContain('nav:systemSettings:location');
    }
  });

  it('includes a featureFlag-gated item when the flag is enabled (positive path)', () => {
    mockUser.current = { id: 'test-user', isAdmin: false };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
    const m = new GlobalSearchManager();
    const result = runNav(m, 'map');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const ids = result.items.map((i) => (i as { id: string }).id);
      expect(ids).toContain('nav:userPages:map');
    }
  });

  it('sorts results by descending computeCommandScore', () => {
    mockUser.current = { id: 'test-user', isAdmin: true };
    const m = new GlobalSearchManager();
    // Reproduce the corpus lookups via the same cache the implementation uses, so
    // we can re-score each item and assert the returned order is monotonically
    // non-increasing. This pins the sort direction; if anyone flips the comparator
    // to ascending or removes the sort, this test fails on a query that has
    // multiple matches with distinct scores.
    const cache = (
      m as unknown as { getNavigationSearchStrings: () => Map<string, string> }
    ).getNavigationSearchStrings();
    const result = runNav(m, 'set');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.items.length).toBeGreaterThan(1);
      let prev = Infinity;
      for (const item of result.items) {
        const corpus = cache.get((item as { id: string }).id);
        expect(corpus).toBeDefined();
        const score = computeCommandScore(corpus!, 'set');
        expect(score).toBeLessThanOrEqual(prev);
        expect(score).toBeGreaterThan(0);
        prev = score;
      }
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

describe('setQuery synchronous navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    mockUser.current = { id: 'test-user', isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
    mockI18nLocale.current = 'en';
    vi.mocked(searchSmart).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchPerson).mockResolvedValue([] as never);
    vi.mocked(searchPlaces).mockResolvedValue([] as never);
    vi.mocked(getAllTags).mockResolvedValue([] as never);
  });

  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('navigation section updates synchronously BEFORE the debounce fires', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('classific');
    // No timer advancement. Entity sections are loading, navigation is already ok.
    expect(m.sections.navigation.status).toBe('ok');
    expect(m.sections.photos.status).toBe('loading');
    expect(m.sections.people.status).toBe('loading');
    expect(m.sections.places.status).toBe('loading');
    expect(m.sections.tags.status).toBe('loading');
  });

  it('runBatch does NOT re-invoke runNavigationProvider after the debounce', () => {
    const m = new GlobalSearchManager();
    const spy = vi.spyOn(m as unknown as { runNavigationProvider: (q: string) => unknown }, 'runNavigationProvider');
    m.open();
    m.setQuery('classific');
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('empty query resets navigation back to idle', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('classific');
    expect(m.sections.navigation.status).toBe('ok');
    m.setQuery('');
    expect(m.sections.navigation.status).toBe('idle');
  });
});

describe('SWR loading rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    mockUser.current = { id: 'test-user', isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
    mockI18nLocale.current = 'en';
    vi.mocked(searchSmart).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchPerson).mockResolvedValue([] as never);
    vi.mocked(searchPlaces).mockResolvedValue([] as never);
    vi.mocked(getAllTags).mockResolvedValue([] as never);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('preserves ok photos across a new keystroke (does NOT flip to loading)', async () => {
    vi.mocked(searchSmart).mockResolvedValueOnce({
      assets: { items: [{ id: 'a1' } as never], nextPage: null },
    } as never);
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.photos.status).toBe('ok');
    m.setQuery('sunset');
    // Synchronously — photos should still be ok (old items), not loading.
    expect(m.sections.photos.status).toBe('ok');
  });

  it('flips empty → loading on new keystroke', async () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('xxxx');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.photos.status).toBe('empty');
    m.setQuery('yyyy');
    expect(m.sections.photos.status).toBe('loading');
  });

  it('flips error → loading on new keystroke', async () => {
    vi.mocked(searchSmart).mockRejectedValueOnce(new Error('boom'));
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('xxxx');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.photos.status).toBe('error');
    m.setQuery('yyyy');
    expect(m.sections.photos.status).toBe('loading');
  });

  it('flips idle → loading on FIRST keystroke (cold open)', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('a');
    expect(m.sections.photos.status).toBe('loading');
  });

  it('batchInFlight is true during setQuery and false after all providers settle', async () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    expect(m.batchInFlight).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(m.batchInFlight).toBe(false);
  });

  it('cold-open first keystroke: navigation is ok instantly, entity sections flip to loading', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('classific');
    expect(m.sections.navigation.status).toBe('ok');
    expect(m.sections.photos.status).toBe('loading');
    expect(m.sections.people.status).toBe('loading');
  });

  it('setMode preserves ok photos until re-run completes (SWR)', async () => {
    vi.mocked(searchSmart).mockResolvedValueOnce({
      assets: { items: [{ id: 'a1' } as never], nextPage: null },
    } as never);
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.photos.status).toBe('ok');
    m.setMode('metadata');
    expect(m.sections.photos.status).toBe('ok');
  });

  it('setMode joins the batch counter — mode switch during live batch does NOT drop stripe early', async () => {
    // Slow photos provider so the main batch stays in flight.
    let resolvePhotos!: () => void;
    vi.mocked(searchSmart).mockImplementationOnce(
      () => new Promise((r) => (resolvePhotos = () => r({ assets: { items: [], nextPage: null } } as never))),
    );
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.batchInFlight).toBe(true);
    // Mode switch while photos is still in flight — counter should increment, not reset.
    m.setMode('metadata');
    expect(m.batchInFlight).toBe(true);
    // setMode's re-run (searchAssets) resolves first from the default mockResolvedValue.
    await vi.advanceTimersByTimeAsync(10);
    // Original photos still in flight — batchInFlight MUST remain true.
    expect(m.batchInFlight).toBe(true);
    // Finally, let the original photos resolve.
    resolvePhotos();
    await vi.advanceTimersByTimeAsync(10);
    expect(m.batchInFlight).toBe(false);
  });

  it('stale-batch providers do not deadlock batchInFlight after a new batch supersedes', async () => {
    let resolveStalePhotos!: () => void;
    vi.mocked(searchSmart).mockImplementationOnce(
      () => new Promise((r) => (resolveStalePhotos = () => r({ assets: { items: [], nextPage: null } } as never))),
    );
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('first');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.batchInFlight).toBe(true);
    // Second query — runBatch2 resets counter and uses the default empty mock so it settles fast.
    m.setQuery('second');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.batchInFlight).toBe(false);
    // Release stale photos — check-before-decrement guard must prevent corruption.
    resolveStalePhotos();
    await vi.advanceTimersByTimeAsync(10);
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
    expect(m.batchInFlight).toBe(false);
  });

  it('runBatch entry resets inFlightCounter to zero before incrementing per-provider', async () => {
    const m = new GlobalSearchManager();
    m.open();
    (m as unknown as { inFlightCounter: number }).inFlightCounter = 99;
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
  });

  it('setMode with empty query is a no-op (cold open)', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setMode('metadata');
    expect(m.batchInFlight).toBe(false);
    expect(m.sections.photos.status).toBe('idle');
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
  });

  it('rapid mode switching does not decrement counter below zero', async () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    m.setMode('metadata');
    m.setMode('description');
    m.setMode('ocr');
    m.setMode('smart');
    await vi.advanceTimersByTimeAsync(100);
    expect(m.batchInFlight).toBe(false);
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
  });
});

describe('activate navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
    mockUser.current = { id: 'test-user', isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
  });

  const themeItem = {
    id: 'nav:theme',
    category: 'actions' as const,
    labelKey: 'theme',
    descriptionKey: 'toggle_theme_description',
    icon: 'x',
    route: '',
    adminOnly: false,
  };

  const classificationItem = {
    id: 'nav:systemSettings:classification',
    category: 'systemSettings' as const,
    labelKey: 'admin.classification_settings',
    descriptionKey: 'admin.classification_settings_description',
    icon: 'x',
    route: '/admin/system-settings?isOpen=classification',
    adminOnly: true,
  };

  it('theme toggle: calls toggleTheme and does NOT persist a recent', () => {
    const toggleSpy = vi.spyOn(themeManager, 'toggleTheme').mockImplementation(() => {});
    const m = new GlobalSearchManager();
    m.open();
    m.activate('nav', themeItem);
    expect(toggleSpy).toHaveBeenCalled();
    expect(getEntries().find((e) => e.id === 'nav:theme')).toBeUndefined();
    toggleSpy.mockRestore();
  });

  it('theme toggle closes the palette', () => {
    const toggleSpy = vi.spyOn(themeManager, 'toggleTheme').mockImplementation(() => {});
    const m = new GlobalSearchManager();
    m.open();
    m.activate('nav', themeItem);
    expect(m.isOpen).toBe(false);
    toggleSpy.mockRestore();
  });

  it('system-settings item: goto + persist navigate recent', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activate('nav', classificationItem);
    expect(goto).toHaveBeenCalledWith('/admin/system-settings?isOpen=classification');
    const entries = getEntries();
    expect(entries[0]).toMatchObject({
      kind: 'navigate',
      id: 'nav:systemSettings:classification',
      route: '/admin/system-settings?isOpen=classification',
      adminOnly: true,
    });
  });

  it('user-page item: goto + persist navigate recent with adminOnly:false', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activate('nav', {
      id: 'nav:userPages:photos',
      category: 'userPages' as const,
      labelKey: 'photos',
      descriptionKey: 'cmdk_nav_photos_description',
      icon: 'x',
      route: '/photos',
      adminOnly: false,
    });
    expect(goto).toHaveBeenCalledWith('/photos');
    expect(getEntries()[0]).toMatchObject({ kind: 'navigate', id: 'nav:userPages:photos', adminOnly: false });
  });

  it('closes the palette after navigating', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.activate('nav', classificationItem);
    expect(m.isOpen).toBe(false);
  });
});

describe('activateRecent stale admin purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
  });

  const navEntry = {
    kind: 'navigate' as const,
    id: 'nav:admin:users',
    route: '/admin/users',
    labelKey: 'users',
    icon: 'x',
    adminOnly: true,
    lastUsed: 1,
  };

  it('admin user: navigates normally and does NOT purge', () => {
    mockUser.current = { id: 'test-user', isAdmin: true };
    const m = new GlobalSearchManager();
    m.open();
    addEntry(navEntry);
    m.activateRecent(navEntry);
    expect(goto).toHaveBeenCalledWith('/admin/users');
    expect(getEntries().some((e) => e.id === 'nav:admin:users')).toBe(true);
  });

  it('non-admin user: warns, purges entry, does NOT navigate', () => {
    mockUser.current = { id: 'test-user', isAdmin: false };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = new GlobalSearchManager();
    m.open();
    addEntry(navEntry);
    m.activateRecent(navEntry);
    expect(warnSpy).toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
    expect(getEntries().some((e) => e.id === 'nav:admin:users')).toBe(false);
    expect(m.isOpen).toBe(false);
    warnSpy.mockRestore();
  });

  it('non-admin user navigating to a NON-admin recent entry works normally', () => {
    mockUser.current = { id: 'test-user', isAdmin: false };
    const m = new GlobalSearchManager();
    m.open();
    const userPageEntry = {
      kind: 'navigate' as const,
      id: 'nav:userPages:photos',
      route: '/photos',
      labelKey: 'photos',
      icon: 'x',
      adminOnly: false,
      lastUsed: 1,
    };
    addEntry(userPageEntry);
    m.activateRecent(userPageEntry);
    expect(goto).toHaveBeenCalledWith('/photos');
    expect(getEntries().some((e) => e.id === 'nav:userPages:photos')).toBe(true);
  });
});

describe('batch lifecycle: close, empty-query, grace window (review fixes)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    mockUser.current = { id: 'test-user', isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
    mockI18nLocale.current = 'en';
    vi.mocked(searchSmart).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchPerson).mockResolvedValue([] as never);
    vi.mocked(searchPlaces).mockResolvedValue([] as never);
    vi.mocked(getAllTags).mockResolvedValue([] as never);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('close() resets batchInFlight and inFlightCounter even when a batch is in flight', async () => {
    let resolveStale!: () => void;
    vi.mocked(searchSmart).mockImplementationOnce(
      () => new Promise((r) => (resolveStale = () => r({ assets: { items: [], nextPage: null } } as never))),
    );
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.batchInFlight).toBe(true);
    m.close();
    expect(m.batchInFlight).toBe(false);
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
    expect(m.batchInFlightStartedAt).toBe(0);
    // Release the stale promise — must NOT re-animate batchInFlight or the counter.
    resolveStale();
    await vi.advanceTimersByTimeAsync(10);
    expect(m.batchInFlight).toBe(false);
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
  });

  it('setQuery(empty) resets batchInFlight, inFlightCounter, and _batchInFlightStartedAt', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    expect(m.batchInFlight).toBe(true);
    m.setQuery('');
    expect(m.batchInFlight).toBe(false);
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
    expect(m.batchInFlightStartedAt).toBe(0);
  });

  it('_batchInFlightStartedAt is +Infinity during the 150ms debounce window (grace hidden)', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    // Sync check — no timer advancement yet, runBatch has not fired.
    expect(m.batchInFlightStartedAt).toBe(Number.POSITIVE_INFINITY);
    // Grace-window contract: `now - startedAt > 200` must be false, so the stripe stays hidden.
    expect(performance.now() - m.batchInFlightStartedAt > 200).toBe(false);
  });

  it('_batchInFlightStartedAt becomes a real performance.now() timestamp after runBatch fires', async () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(Number.isFinite(m.batchInFlightStartedAt)).toBe(true);
    expect(m.batchInFlightStartedAt).toBeGreaterThanOrEqual(0);
  });

  it('setMode decrements counter when photos provider rejects (catch path)', async () => {
    vi.mocked(searchSmart).mockResolvedValueOnce({
      assets: { items: [{ id: 'initial' } as never], nextPage: null },
    } as never);
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.photos.status).toBe('ok');
    vi.mocked(searchAssets).mockRejectedValueOnce(new Error('boom'));
    m.setMode('metadata');
    expect(m.batchInFlight).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(m.batchInFlight).toBe(false);
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
    expect(m.sections.photos.status).toBe('error');
  });

  it('setQuery reconciles cursor synchronously so stale nav highlight is not left behind', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('theme');
    // At this point reconcileCursor has placed activeItemId on the first nav item
    // (because photos/people/places/tags are all loading). Manually poison the cursor.
    m.activeItemId = 'nav:nonexistent-item';
    m.setQuery('themes');
    // After setQuery, reconcileCursor must have replaced the stale id with something
    // that exists in the current navigation section (or null).
    expect(m.activeItemId).not.toBe('nav:nonexistent-item');
  });
});

describe('activate non-theme action (review fix U1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
    mockUser.current = { id: 'test-user', isAdmin: true };
  });

  it('warns and does NOT navigate when activate("nav") receives a non-theme actions item', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = new GlobalSearchManager();
    m.open();
    m.activate('nav', {
      id: 'nav:futureAction',
      category: 'actions' as const,
      labelKey: 'x',
      descriptionKey: 'x',
      icon: 'x',
      route: '',
      adminOnly: false,
    });
    expect(warnSpy).toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
    expect(getEntries().find((e) => e.id === 'nav:futureAction')).toBeUndefined();
    expect(m.isOpen).toBe(false);
    warnSpy.mockRestore();
  });
});

describe('activateRecent stale-state purge (review fix U2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
    mockUser.current = { id: 'test-user', isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
  });

  it('purges a navigate recent whose feature flag is now disabled', () => {
    mockFlags.valueOrUndefined = { search: true, map: false, trash: true };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = new GlobalSearchManager();
    m.open();
    const mapEntry = {
      kind: 'navigate' as const,
      id: 'nav:userPages:map',
      route: '/map',
      labelKey: 'map',
      icon: 'x',
      adminOnly: false,
      lastUsed: 1,
    };
    addEntry(mapEntry);
    m.activateRecent(mapEntry);
    expect(warnSpy).toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
    expect(getEntries().some((e) => e.id === 'nav:userPages:map')).toBe(false);
    warnSpy.mockRestore();
  });

  it('purges a navigate recent whose NavigationItem no longer exists in the catalog', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = new GlobalSearchManager();
    m.open();
    const ghostEntry = {
      kind: 'navigate' as const,
      id: 'nav:removed:feature',
      route: '/removed',
      labelKey: 'removed',
      icon: 'x',
      adminOnly: false,
      lastUsed: 1,
    };
    addEntry(ghostEntry);
    m.activateRecent(ghostEntry);
    expect(warnSpy).toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
    expect(getEntries().some((e) => e.id === 'nav:removed:feature')).toBe(false);
    warnSpy.mockRestore();
  });

  it('admin status re-check uses the live NavigationItem.adminOnly, not the stored entry', () => {
    // Saved entry has adminOnly=false (stale), but nav:systemSettings:classification is
    // actually adminOnly=true in the live catalog. A non-admin user should still be purged.
    mockUser.current = { id: 'test-user', isAdmin: false };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = new GlobalSearchManager();
    m.open();
    const entry = {
      kind: 'navigate' as const,
      id: 'nav:systemSettings:classification',
      route: '/admin/system-settings?isOpen=classification',
      labelKey: 'admin.classification_settings',
      icon: 'x',
      adminOnly: false, // stale — live catalog says true
      lastUsed: 1,
    };
    addEntry(entry);
    m.activateRecent(entry);
    expect(warnSpy).toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
    expect(getEntries().some((e) => e.id === entry.id)).toBe(false);
    warnSpy.mockRestore();
  });
});

describe('setMode stale photos race (review fix U3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    mockUser.current = { id: 'test-user', isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
    mockI18nLocale.current = 'en';
    vi.mocked(searchPerson).mockResolvedValue([] as never);
    vi.mocked(searchPlaces).mockResolvedValue([] as never);
    vi.mocked(getAllTags).mockResolvedValue([] as never);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('stale first-setMode photos does not overwrite fresh second-setMode photos', async () => {
    // Initial batch: photos = [initial]
    vi.mocked(searchSmart).mockResolvedValueOnce({
      assets: { items: [{ id: 'initial' } as never], nextPage: null },
    } as never);
    // First setMode (metadata): slow — stays pending until resolvePhotos1().
    let resolvePhotos1!: () => void;
    vi.mocked(searchAssets).mockImplementationOnce(
      () =>
        new Promise(
          (r) => (resolvePhotos1 = () => r({ assets: { items: [{ id: 'stale' } as never], nextPage: null } } as never)),
        ),
    );
    // Second setMode (description): fast — resolves to {fresh}.
    vi.mocked(searchAssets).mockResolvedValueOnce({
      assets: { items: [{ id: 'fresh' } as never], nextPage: null },
    } as never);

    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.photos.status).toBe('ok');

    m.setMode('metadata'); // starts photos1 (stuck)
    m.setMode('description'); // aborts photos1's photosController, starts photos2 (fast)
    await vi.advanceTimersByTimeAsync(10); // photos2 resolves → photos should be {fresh}
    if (m.sections.photos.status === 'ok') {
      const ids = m.sections.photos.items.map((p) => (p as { id: string }).id);
      expect(ids).toContain('fresh');
    }

    // Now release photos1 — its .then runs. Without the U3 fix it would overwrite
    // sections.photos with [stale]. With the fix, signal.aborted check prevents the write.
    resolvePhotos1();
    await vi.advanceTimersByTimeAsync(10);
    expect(m.sections.photos.status).toBe('ok');
    if (m.sections.photos.status === 'ok') {
      const ids = m.sections.photos.items.map((p) => (p as { id: string }).id);
      expect(ids).toContain('fresh');
      expect(ids).not.toContain('stale');
    }
    expect(m.batchInFlight).toBe(false);
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
  });
});

describe('Batch 4 post-review: route consistency, SWR cursor, debounce-window close (NF1/CG2/UE1/UE2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    mockUser.current = { id: 'test-user', isAdmin: true };
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
    mockI18nLocale.current = 'en';
    vi.mocked(searchSmart).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as never);
    vi.mocked(searchPerson).mockResolvedValue([] as never);
    vi.mocked(searchPlaces).mockResolvedValue([] as never);
    vi.mocked(getAllTags).mockResolvedValue([] as never);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  // NF1 / CG1: the fix uses LIVE NavigationItem.route, not the stored entry.route.
  // An upstream rename (route change) would otherwise leak 404s via recents.
  it('activateRecent navigates to the LIVE NavigationItem.route even when the saved entry.route is stale', () => {
    const m = new GlobalSearchManager();
    m.open();
    // Saved entry has a fake old path; the live catalog has '/memory' for memories.
    const staleEntry = {
      kind: 'navigate' as const,
      id: 'nav:userPages:memories',
      route: '/old-memories-path',
      labelKey: 'memories',
      icon: 'x',
      adminOnly: false,
      lastUsed: 1,
    };
    addEntry(staleEntry);
    m.activateRecent(staleEntry);
    // NAVIGATION_ITEMS defines memories.route as '/memory'. The live value must win.
    expect(goto).toHaveBeenCalledWith('/memory');
    expect(goto).not.toHaveBeenCalledWith('/old-memories-path');
  });

  // CG2: reconcileCursor inside setQuery must NOT jump the highlight off a valid
  // SWR-preserved photo cursor when the user types another keystroke.
  it('setQuery reconcileCursor preserves a valid cursor on an SWR-preserved photo', async () => {
    vi.mocked(searchSmart).mockResolvedValueOnce({
      assets: { items: [{ id: 'a1' } as never, { id: 'a2' } as never], nextPage: null },
    } as never);
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.photos.status).toBe('ok');
    m.activeItemId = 'photo:a2'; // valid, not the first item
    m.setQuery('sunset'); // photos stay SWR-preserved as ok with [a1, a2]
    expect(m.activeItemId).toBe('photo:a2');
  });

  // UE1: close() fired during the 150ms debounce window (before runBatch ever ran).
  // Prior tests close AFTER runBatch has fired; this one verifies the earlier state.
  it('close() during the debounce window clears pending runBatch and resets all state', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('beach');
    expect(m.batchInFlight).toBe(true);
    expect(m.batchInFlightStartedAt).toBe(Number.POSITIVE_INFINITY);
    m.close();
    expect(m.batchInFlight).toBe(false);
    expect(m.batchInFlightStartedAt).toBe(0);
    expect((m as unknown as { inFlightCounter: number }).inFlightCounter).toBe(0);
    // Advancing time should NOT fire the pending runBatch — it was cleared.
    vi.advanceTimersByTime(500);
    expect(m.batchInFlight).toBe(false);
    expect(m.sections.photos.status).toBe('idle');
  });

  // UE2: feature-flag ENABLED positive path — mirrors the disabled-→-purge test.
  it("activateRecent navigates normally when the navigate entry's feature flag is enabled", () => {
    mockFlags.valueOrUndefined = { search: true, map: true, trash: true };
    const m = new GlobalSearchManager();
    m.open();
    const mapEntry = {
      kind: 'navigate' as const,
      id: 'nav:userPages:map',
      route: '/map',
      labelKey: 'map',
      icon: 'x',
      adminOnly: false,
      lastUsed: 1,
    };
    addEntry(mapEntry);
    m.activateRecent(mapEntry);
    expect(goto).toHaveBeenCalledWith('/map');
    expect(getEntries().some((e) => e.id === 'nav:userPages:map')).toBe(true);
  });
});

describe('getActiveItem recent-entry preview lookup (cold open)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetRecentStore();
  });

  it('synthesizes a photo ActiveItem from a photo recent when the query is empty', () => {
    addEntry({ kind: 'photo', id: 'photo:a1', assetId: 'a1', label: 'sunset.jpg', lastUsed: 1 });
    const m = new GlobalSearchManager();
    m.open();
    m.activeItemId = 'photo:a1';
    const active = m.getActiveItem();
    expect(active).not.toBeNull();
    expect(active?.kind).toBe('photo');
    if (active?.kind === 'photo') {
      const data = active.data as { id: string; originalFileName: string };
      expect(data.id).toBe('a1');
      expect(data.originalFileName).toBe('sunset.jpg');
    }
  });

  it('synthesizes a person ActiveItem from a person recent', () => {
    addEntry({
      kind: 'person',
      id: 'person:p1',
      personId: 'p1',
      label: 'Alice',
      thumbnailAssetId: 'face-1',
      lastUsed: 1,
    });
    const m = new GlobalSearchManager();
    m.open();
    m.activeItemId = 'person:p1';
    const active = m.getActiveItem();
    expect(active?.kind).toBe('person');
    if (active?.kind === 'person') {
      const data = active.data as { id: string; name: string; faceAssetId: string };
      expect(data.id).toBe('p1');
      expect(data.name).toBe('Alice');
      expect(data.faceAssetId).toBe('face-1');
    }
  });

  it('synthesizes a place ActiveItem from a place recent', () => {
    addEntry({
      kind: 'place',
      id: 'place:48.8566:2.3522',
      label: 'Paris',
      latitude: 48.8566,
      longitude: 2.3522,
      lastUsed: 1,
    });
    const m = new GlobalSearchManager();
    m.open();
    m.activeItemId = 'place:48.8566:2.3522';
    const active = m.getActiveItem();
    expect(active?.kind).toBe('place');
    if (active?.kind === 'place') {
      const data = active.data as { name: string; latitude: number; longitude: number };
      expect(data.name).toBe('Paris');
      expect(data.latitude).toBe(48.8566);
      expect(data.longitude).toBe(2.3522);
    }
  });

  it('synthesizes a tag ActiveItem from a tag recent', () => {
    addEntry({ kind: 'tag', id: 'tag:t1', tagId: 't1', label: 'vacation', lastUsed: 1 });
    const m = new GlobalSearchManager();
    m.open();
    m.activeItemId = 'tag:t1';
    const active = m.getActiveItem();
    expect(active?.kind).toBe('tag');
    if (active?.kind === 'tag') {
      const data = active.data as { id: string; name: string };
      expect(data.id).toBe('t1');
      expect(data.name).toBe('vacation');
    }
  });

  it('returns null for a query-kind recent (no meaningful preview)', () => {
    addEntry({ kind: 'query', id: 'q:beach', text: 'beach', mode: 'smart', lastUsed: 1 });
    const m = new GlobalSearchManager();
    m.open();
    m.activeItemId = 'q:beach';
    expect(m.getActiveItem()).toBeNull();
  });

  it('returns null for a navigate-kind recent (no preview pane for nav items)', () => {
    addEntry({
      kind: 'navigate',
      id: 'nav:userPages:photos',
      route: '/photos',
      labelKey: 'photos',
      icon: 'x',
      adminOnly: false,
      lastUsed: 1,
    });
    const m = new GlobalSearchManager();
    m.open();
    m.activeItemId = 'nav:userPages:photos';
    expect(m.getActiveItem()).toBeNull();
  });

  it('activate nav: same-pathname navigation uses a full browser reload, not goto', () => {
    // When the user is already on /admin/system-settings and picks a different
    // system-settings accordion, SvelteKit's client-side `goto` only updates query
    // params without re-running the page component — URL-backed state (e.g.,
    // SettingAccordionState) stays on its stale initial value. The manager must
    // detect this case and do a full browser navigation so every component remounts.
    const originalLocation = globalThis.location;
    const hrefSetter = vi.fn();
    const fakeLocation: Record<string, unknown> = {
      pathname: '/admin/system-settings',
    };
    Object.defineProperty(fakeLocation, 'href', {
      configurable: true,
      get: () => 'http://localhost/admin/system-settings?isOpen=classification',
      set: (v: string) => hrefSetter(v),
    });
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: fakeLocation,
    });
    try {
      const m = new GlobalSearchManager();
      m.open();
      m.activate('nav', {
        id: 'nav:systemSettings:video-transcoding',
        category: 'systemSettings' as const,
        labelKey: 'admin.transcoding_settings',
        descriptionKey: 'admin.transcoding_settings_description',
        icon: 'x',
        route: '/admin/system-settings?isOpen=video-transcoding',
        adminOnly: true,
      });
      // Full browser navigation via location.href = route
      expect(hrefSetter).toHaveBeenCalledWith('/admin/system-settings?isOpen=video-transcoding');
      // Client-side goto must NOT have fired — that would leave the accordion stale.
      expect(goto).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('activate nav: different-pathname navigation uses client-side goto (unchanged)', () => {
    const originalLocation = globalThis.location;
    const fakeLocation: Record<string, unknown> = {
      pathname: '/photos',
      href: 'http://localhost/photos',
    };
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: fakeLocation,
    });
    try {
      const m = new GlobalSearchManager();
      m.open();
      m.activate('nav', {
        id: 'nav:systemSettings:video-transcoding',
        category: 'systemSettings' as const,
        labelKey: 'admin.transcoding_settings',
        descriptionKey: 'admin.transcoding_settings_description',
        icon: 'x',
        route: '/admin/system-settings?isOpen=video-transcoding',
        adminOnly: true,
      });
      expect(goto).toHaveBeenCalledWith('/admin/system-settings?isOpen=video-transcoding');
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('falls through to section lookup when activeItemId does not match any recent', () => {
    // Empty recents store, activeItemId matches a section item. getActiveItem should
    // still resolve via the section path (not dead-end at the recent-lookup branch).
    const m = new GlobalSearchManager();
    m.activeItemId = 'photo:a1';
    m.sections = {
      photos: { status: 'ok', items: [{ id: 'a1', originalFileName: 'x.jpg' } as never], total: 1 },
      people: { status: 'empty' },
      places: { status: 'empty' },
      tags: { status: 'empty' },
      navigation: { status: 'empty' },
    };
    // query is empty but no recent matches — fall-through to section.
    const active = m.getActiveItem();
    expect(active?.kind).toBe('photo');
  });
});
