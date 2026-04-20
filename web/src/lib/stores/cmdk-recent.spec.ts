import { beforeEach, describe, expect, it, vi } from 'vitest';

// The cmdk-recent store reads the current user id from the authManager so
// it can scope entries per user. Tests drive this via a hoisted mock — flipping
// `mockUser.current` simulates a logout/login without having to touch a real
// Svelte store. The default `test-user` keeps the broad suite of existing tests
// working unchanged; only the user-isolation tests flip it mid-test.
const { mockUser } = vi.hoisted(() => ({
  mockUser: { current: { id: 'test-user' } as { id: string } | null },
}));
vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get authenticated() {
      return mockUser.current !== null;
    },
    get user() {
      return mockUser.current;
    },
  },
}));

import { __resetForTests, addEntry, clearEntries, getEntries, makePlaceId, removeEntry } from './cmdk-recent';

describe('cmdk-recent', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
    mockUser.current = { id: 'test-user' };
  });

  it('returns [] for unset store', () => {
    expect(getEntries()).toEqual([]);
  });

  it('addEntry persists, returns newest first', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    addEntry({ kind: 'query', id: 'q:b', text: 'b', mode: 'smart', lastUsed: 2 });
    expect(getEntries().map((e) => e.id)).toEqual(['q:b', 'q:a']);
  });

  it('dedupes by id, updating lastUsed', () => {
    addEntry({ kind: 'photo', id: 'photo:abc', assetId: 'abc', label: 'X', lastUsed: 1 });
    addEntry({ kind: 'photo', id: 'photo:abc', assetId: 'abc', label: 'X', lastUsed: 5 });
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].lastUsed).toBe(5);
  });

  it('trims to 20, keeping newest', () => {
    for (let i = 0; i < 25; i++) {
      addEntry({ kind: 'query', id: `q:${i}`, text: `q${i}`, mode: 'smart', lastUsed: i });
    }
    const entries = getEntries();
    expect(entries).toHaveLength(20);
    expect(entries[0].id).toBe('q:24');
    expect(entries[19].id).toBe('q:5');
  });

  it('treats corrupt JSON as empty; next write overwrites', () => {
    localStorage.setItem('cmdk.recent:test-user', 'not-valid-json');
    __resetForTests();
    expect(getEntries()).toEqual([]);
    addEntry({ kind: 'query', id: 'q:x', text: 'x', mode: 'smart', lastUsed: 1 });
    expect(getEntries()).toHaveLength(1);
  });

  it('QuotaExceededError does not throw; the failing write is silently dropped', () => {
    addEntry({ kind: 'query', id: 'q:initial', text: 'initial', mode: 'smart', lastUsed: 1 });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    });
    expect(() => addEntry({ kind: 'query', id: 'q:new', text: 'new', mode: 'smart', lastUsed: 2 })).not.toThrow();
    spy.mockRestore();
    // The successful write from before the spy is still there; the failed write
    // didn't make it through. No in-memory caching means no "last-known good"
    // state to preserve — the palette will simply miss the newest entry.
    const entries = getEntries();
    expect(entries.some((e) => e.id === 'q:initial')).toBe(true);
  });

  it('handles localStorage unavailable (getItem throws)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(getEntries()).toEqual([]);
    expect(() => addEntry({ kind: 'query', id: 'q:x', text: 'x', mode: 'smart', lastUsed: 1 })).not.toThrow();
    spy.mockRestore();
  });

  it('clearEntries empties the store', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    clearEntries();
    expect(getEntries()).toEqual([]);
  });

  it('scopes entries per user: user A entries are invisible to user B', () => {
    // Bug: multi-account on the same device leaked recents between users. User A
    // would add photos/queries to their palette, log out, user B logs in on the
    // same browser, opens the palette, and sees user A's recents — including
    // potentially private filenames and query text.
    mockUser.current = { id: 'user-a' };
    addEntry({ kind: 'query', id: 'q:secret', text: 'secret-query', mode: 'smart', lastUsed: 1 });
    addEntry({ kind: 'photo', id: 'photo:p1', assetId: 'p1', label: 'a-private.jpg', lastUsed: 2 });

    mockUser.current = { id: 'user-b' };
    expect(getEntries()).toEqual([]);

    mockUser.current = { id: 'user-a' };
    expect(getEntries().map((e) => e.id)).toEqual(['photo:p1', 'q:secret']);
  });

  it('scopes writes per user: user B writes never appear for user A', () => {
    // Complementary direction: user B logs in, adds their own entries, user A
    // logs back in — user A's existing entries are intact and user B's entries
    // are nowhere to be seen.
    mockUser.current = { id: 'user-a' };
    addEntry({ kind: 'query', id: 'q:a-first', text: 'from-a', mode: 'smart', lastUsed: 1 });

    mockUser.current = { id: 'user-b' };
    addEntry({ kind: 'query', id: 'q:b-first', text: 'from-b', mode: 'smart', lastUsed: 2 });
    expect(getEntries().map((e) => e.id)).toEqual(['q:b-first']);

    mockUser.current = { id: 'user-a' };
    expect(getEntries().map((e) => e.id)).toEqual(['q:a-first']);
  });

  it('returns [] and silently drops writes when no user is logged in', () => {
    // Opening the palette before auth resolves (or in a logged-out edge case)
    // must not populate an "anonymous" bucket that the next logged-in user could
    // then inherit. Reads return empty, writes are no-ops.
    mockUser.current = null;
    addEntry({ kind: 'query', id: 'q:anon', text: 'anonymous', mode: 'smart', lastUsed: 1 });
    expect(getEntries()).toEqual([]);
    // Sanity: the entry is not persisted under ANY scoped key either — fetch the
    // whole localStorage snapshot and assert nothing matches the cmdk prefix.
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('cmdk.recent'));
    expect(keys).toEqual([]);
  });

  it('cross-tab writes are picked up on the next read (no in-memory cache)', () => {
    // Reads hit localStorage directly so a write from another tab (under the
    // current user's key) is visible on the very next call without any explicit
    // cache-invalidation plumbing. This replaces the previous storage-event
    // listener that existed solely to invalidate a shared in-memory cache.
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    localStorage.setItem(
      'cmdk.recent:test-user',
      JSON.stringify([{ kind: 'query', id: 'q:b', text: 'b', mode: 'smart', lastUsed: 2 }]),
    );
    expect(getEntries().map((e) => e.id)).toEqual(['q:b']);
  });
});

describe('navigate kind', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  it('persists a navigate entry with all required fields', () => {
    addEntry({
      kind: 'navigate',
      id: 'nav:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'M12...mock',
      adminOnly: true,
      lastUsed: 1,
    });
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'navigate',
      id: 'nav:users',
      route: '/admin/users',
      adminOnly: true,
    });
  });

  it('dedupes navigate entries by id', () => {
    addEntry({
      kind: 'navigate',
      id: 'nav:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'x',
      adminOnly: true,
      lastUsed: 1,
    });
    addEntry({
      kind: 'navigate',
      id: 'nav:users',
      route: '/admin/users',
      labelKey: 'users',
      icon: 'x',
      adminOnly: true,
      lastUsed: 5,
    });
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].lastUsed).toBe(5);
  });
});

describe('removeEntry', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });

  it('removes the matching entry and preserves order', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    addEntry({ kind: 'query', id: 'q:b', text: 'b', mode: 'smart', lastUsed: 2 });
    addEntry({ kind: 'query', id: 'q:c', text: 'c', mode: 'smart', lastUsed: 3 });
    removeEntry('q:b');
    expect(getEntries().map((e) => e.id)).toEqual(['q:c', 'q:a']);
  });

  it('no-op on missing id', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    removeEntry('does-not-exist');
    expect(getEntries().map((e) => e.id)).toEqual(['q:a']);
  });

  it('persists the removal to localStorage', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    removeEntry('q:a');
    const raw = localStorage.getItem('cmdk.recent:test-user');
    expect(JSON.parse(raw ?? '[]')).toEqual([]);
  });
});

describe('album entry', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
    mockUser.current = { id: 'u1' };
  });

  it('round-trips an album entry', () => {
    addEntry({
      kind: 'album',
      id: 'album:abc',
      albumId: 'abc',
      label: 'Hawaii',
      thumbnailAssetId: 'asset-1',
      lastUsed: 1,
    });
    expect(getEntries()).toEqual([
      expect.objectContaining({ kind: 'album', albumId: 'abc', thumbnailAssetId: 'asset-1' }),
    ]);
  });

  it('removeEntry clears an album entry', () => {
    addEntry({
      kind: 'album',
      id: 'album:abc',
      albumId: 'abc',
      label: 'x',
      thumbnailAssetId: null,
      lastUsed: 1,
    });
    removeEntry('album:abc');
    expect(getEntries()).toEqual([]);
  });

  it('removeEntry is a silent no-op for a missing id', () => {
    addEntry({
      kind: 'album',
      id: 'album:abc',
      albumId: 'abc',
      label: 'x',
      thumbnailAssetId: null,
      lastUsed: 1,
    });
    expect(() => removeEntry('album:nonexistent')).not.toThrow();
    expect(getEntries()).toHaveLength(1);
  });
});

describe('space entry', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
    mockUser.current = { id: 'u1' };
  });

  it('round-trips a space entry', () => {
    addEntry({
      kind: 'space',
      id: 'space:s1',
      spaceId: 's1',
      label: 'Family',
      colorHex: '#ff00ff',
      lastUsed: 1,
    });
    expect(getEntries()).toEqual([expect.objectContaining({ kind: 'space', spaceId: 's1', colorHex: '#ff00ff' })]);
  });
});

describe('makePlaceId precision', () => {
  it('rounds to 4 decimals so near-identical coords collapse', () => {
    expect(makePlaceId(48.856_645_67, 2.352_210_01)).toBe('place:48.8566:2.3522');
    expect(makePlaceId(48.856_611_11, 2.352_199_99)).toBe('place:48.8566:2.3522');
    expect(makePlaceId(48.856_645_67, 2.352_210_01)).toBe(makePlaceId(48.856_611_11, 2.352_199_99));
  });

  it('coords far apart produce different keys', () => {
    expect(makePlaceId(48.85, 2.35)).not.toBe(makePlaceId(48.86, 2.35));
  });
});
