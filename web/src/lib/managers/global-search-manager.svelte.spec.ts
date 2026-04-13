import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { searchSmart, searchAssets, searchPerson, searchPlaces, getAllTags } from '@immich/sdk';
import { GlobalSearchManager, type Provider, type ProviderStatus, type SearchMode, type Sections } from './global-search-manager.svelte';
import { installFakeAbortTimeout, restoreAbortTimeout } from './__tests__/fake-abort-timeout';

vi.mock('@immich/sdk', async () => ({
  ...(await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk')),
  searchSmart: vi.fn(),
  searchAssets: vi.fn(),
  searchPerson: vi.fn(),
  searchPlaces: vi.fn(),
  getAllTags: vi.fn(),
}));

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

  it('providers is an instance-bound record with four keys', () => {
    const providers = (manager as unknown as { providers: Record<string, unknown> }).providers;
    expect(Object.keys(providers).sort()).toEqual(['people', 'photos', 'places', 'tags']);
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

  it('photos uses searchSmart in smart mode', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchSmart).toHaveBeenCalledOnce();
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
