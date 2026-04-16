import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NAVIGATION_ITEMS, isAlmostExactNavMatch } from './navigation-items';

// __dirname is not defined in ESM (vitest default). Derive it from import.meta.url.
const here = dirname(fileURLToPath(import.meta.url));

describe('NAVIGATION_ITEMS schema', () => {
  it('has exactly 36 items', () => {
    expect(NAVIGATION_ITEMS).toHaveLength(36);
  });

  it('every item has non-empty required fields', () => {
    for (const item of NAVIGATION_ITEMS) {
      expect(item.id).toMatch(/^nav:/);
      expect(item.labelKey.length).toBeGreaterThan(0);
      expect(item.descriptionKey.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
      if (item.category === 'actions') {
        expect(item.route).toBe('');
      } else {
        expect(item.route.length).toBeGreaterThan(0);
      }
    }
  });

  it('ids are unique', () => {
    const ids = NAVIGATION_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('system-settings routes match the /admin/system-settings?isOpen=<key> pattern', () => {
    const items = NAVIGATION_ITEMS.filter((i) => i.category === 'systemSettings');
    expect(items).toHaveLength(19);
    for (const item of items) {
      expect(item.route).toMatch(/^\/admin\/system-settings\?isOpen=[a-z-]+$/);
      expect(item.adminOnly).toBe(true);
    }
  });

  it('admin routes start with /admin/', () => {
    const items = NAVIGATION_ITEMS.filter((i) => i.category === 'admin');
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item.route.startsWith('/admin/')).toBe(true);
      expect(item.adminOnly).toBe(true);
    }
  });

  it('user-pages items are not admin-only', () => {
    const items = NAVIGATION_ITEMS.filter((i) => i.category === 'userPages');
    expect(items).toHaveLength(11);
    for (const item of items) {
      expect(item.adminOnly).toBe(false);
    }
  });

  it('actions category has exactly the theme toggle', () => {
    const items = NAVIGATION_ITEMS.filter((i) => i.category === 'actions');
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('nav:theme');
    expect(items[0].route).toBe('');
  });

  it('drift guard: every systemSettings isOpen key exists in the accordion source', () => {
    // From web/src/lib/managers/ up 2 dirs → web/src/, then into routes/admin/...
    const sourcePath = resolve(here, '..', '..', 'routes', 'admin', 'system-settings', '+page.svelte');
    const source = readFileSync(sourcePath, 'utf8');
    const sourceKeys = new Set([...source.matchAll(/key:\s*'([a-z-]+)'/g)].map((m) => m[1]));
    const ourKeys = NAVIGATION_ITEMS.filter((i) => i.category === 'systemSettings').map((i) =>
      i.route.replace('/admin/system-settings?isOpen=', ''),
    );
    for (const key of ourKeys) {
      expect(sourceKeys.has(key)).toBe(true);
    }
  });
});

describe('isAlmostExactNavMatch', () => {
  // Promotes a navigation item to the palette's "Top result" band when the
  // user's query unambiguously points at the item. Word-level prefix match is
  // the sweet spot: strict enough to avoid promoting weak matches, loose
  // enough to handle compound queries ("auto-classification") and prefixes
  // ("album" → "Albums"). Rejects queries shorter than 3 chars and words
  // shorter than 3 chars to avoid promoting on a single keystroke.

  it('returns true on an exact case-insensitive match', () => {
    expect(isAlmostExactNavMatch('people', 'People')).toBe(true);
    expect(isAlmostExactNavMatch('PHOTOS', 'photos')).toBe(true);
  });

  it('returns true when the label starts with the query (prefix match)', () => {
    expect(isAlmostExactNavMatch('album', 'Albums')).toBe(true);
    expect(isAlmostExactNavMatch('classif', 'Classification Settings')).toBe(true);
  });

  it('returns true when a whole word in the label starts with the query', () => {
    expect(isAlmostExactNavMatch('classification', 'Classification Settings')).toBe(true);
    // Compound query: even though the full query "auto-classification" is not
    // a prefix of "Classification Settings", the word "classification" inside
    // the query is a word-prefix of "Classification" inside the label.
    expect(isAlmostExactNavMatch('auto-classification', 'Classification Settings')).toBe(true);
  });

  it('rejects queries shorter than 3 characters (too noisy to promote)', () => {
    expect(isAlmostExactNavMatch('sp', 'Spaces')).toBe(false);
    expect(isAlmostExactNavMatch('', 'Photos')).toBe(false);
  });

  it('rejects when no word-prefix match exists', () => {
    expect(isAlmostExactNavMatch('xyz', 'Spaces')).toBe(false);
    expect(isAlmostExactNavMatch('people', 'Sharing')).toBe(false);
  });

  it('ignores query words shorter than 3 chars when scanning a compound query', () => {
    // "a-classification" — the first word 'a' is too short but the second word
    // 'classification' still carries the match.
    expect(isAlmostExactNavMatch('a-classification', 'Classification Settings')).toBe(true);
    // A query consisting solely of short words fails even if it is otherwise
    // a substring of the label.
    expect(isAlmostExactNavMatch('a b', 'Albums')).toBe(false);
  });
});
