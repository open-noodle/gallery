import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GlobalSearchManager, type Provider, type ProviderStatus, type SearchMode, type Sections } from './global-search-manager.svelte';
import { installFakeAbortTimeout, restoreAbortTimeout } from './__tests__/fake-abort-timeout';

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
