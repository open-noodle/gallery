import { createFilterState } from '#lib/components/filter-panel/filter-panel.ts';
import GlobalSearch from '#lib/components/global-search/global-search.svelte';
import SearchModeControl from '#lib/components/global-search/search-mode-control.svelte';
import { librarySpaces, libraryView } from '#lib/gallery/library-view/library-view.svelte.ts';
import {
  buildFullPathSearchTerms,
  nextSearchMode,
  parsePaletteDraft,
  parsePaletteScope,
} from '#lib/gallery/search/full-path-search.ts';
import { GlobalSearchManager } from '#lib/managers/global-search-manager.svelte.ts';
import { getFormatter } from '#lib/utils/i18n.ts';
import { factory } from '#test/unit/factories.ts';
import { test as base } from '#test/unit/fixtures.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { setPage } from '#test/unit/mocks/app-state.svelte.ts';
import { AssetVisibility, LibraryView } from '@immich/sdk';
import { expect, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

// Browser test files share an origin. Keep this suite's saved mode/library choice
// inside its iframe so parallel specs cannot change each other's search behavior.
vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
  } satisfies Storage);
});

vi.mock('svelte-persisted-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('svelte-persisted-store')>();
  return {
    ...actual,
    persisted: (...args: Parameters<typeof actual.persisted>) =>
      actual.persisted(args[0], args[1], { ...args[2], syncTabs: false }),
  };
});

class PathPreviewManager extends GlobalSearchManager {
  protected override buildProviders() {
    const providers = super.buildProviders();
    // This regression drives the real photo provider; unrelated entity lookups are inert.
    for (const key of ['people', 'places', 'tags', 'albums', 'spaces'] as const) {
      providers[key] = { ...providers[key], run: () => Promise.resolve({ status: 'empty' as const }) };
    }
    return providers;
  }
}

const test = base.extend<{ manager: PathPreviewManager }>({
  manager: async ({ task: _ }, use) => {
    libraryView.current = 'both';
    librarySpaces.list = undefined;
    localStorage.removeItem('searchQueryType');
    const manager = new PathPreviewManager();
    try {
      await use(manager);
    } finally {
      manager.close();
      manager.destroy();
    }
  },
});

test('offers full path in the palette mode menu', async () => {
  const onSelect = vi.fn();
  await renderWithTooltips(SearchModeControl, { variant: 'chip' as const, mode: 'smart' as const, onSelect });
  await page.getByTestId('search-mode-chip-trigger').click();
  const $t = await getFormatter();
  await page.getByRole('menuitemradio', { name: $t('full_path_or_folder'), exact: true }).click();
  expect(onSelect).toHaveBeenCalledWith('fullPath');
});

test('offers full path on the modal mode rail', async () => {
  const onSelect = vi.fn();
  await renderWithTooltips(SearchModeControl, { variant: 'rail' as const, mode: 'smart' as const, onSelect });
  const radio = page.getByTestId('search-mode-option-fullPath').getByRole('radio');
  await radio.click();
  expect(onSelect).toHaveBeenCalledWith('fullPath');
});

for (const path of [
  '/mnt/external/panorama 1/original pics',
  String.raw`C:\Family Photos\summer`,
  '@home/#folder/person:Alice',
  '/Photos/100%/IMG_001',
  '/photos/quote "and" colon:folder',
]) {
  test(`searches the literal path ${path}`, async ({ manager, api }) => {
    const asset = factory.asset({ originalPath: `${path}/IMG_001.jpg` });
    api.on({
      searchAssets: ({ body }) => ({
        json: {
          albums: { total: 0, count: 0, items: [], facets: [] },
          assets: {
            total: 1,
            count: 1,
            items: body.originalPath === path ? [asset] : [],
            facets: [],
            nextPage: null,
            nextCursor: null,
          },
        },
      }),
    });
    setPage({ url: new URL('http://localhost/photos') });
    manager.setMode('fullPath');
    manager.setQuery(path);
    await expect.poll(() => manager.sections.photos.status).toBe('ok');
    expect(manager.scope).toBe('all');
    expect(manager.typedSearchDisplayTokens).toEqual([]);
    expect(manager.typedSearchIssues).toEqual([]);
    expect(api.searchAssets).toHaveBeenCalledWith({
      body: {
        size: 5,
        visibility: AssetVisibility.Timeline,
        withSharedSpaces: true,
        originalPath: path,
      },
    });
  });
}

test('persists full-path mode across manager instances', ({ manager }) => {
  manager.setMode('fullPath');
  const restored = new PathPreviewManager();
  try {
    expect(restored.mode).toBe('fullPath');
  } finally {
    restored.destroy();
  }
});

test('switching out of path mode restores slash-prefix collection search', async ({ manager }) => {
  manager.setMode('fullPath');
  manager.setQuery('/holiday');
  expect(manager.scope).toBe('all');
  manager.setMode('smart');
  expect(manager.scope).toBe('collections');
  await expect.poll(() => manager.sections.photos.status).toBe('idle');
});

for (const pathname of [
  '/photos',
  '/albums/album-1/photos/asset-1',
  '/spaces/space-1/photos',
  '/spaces/space-1/albums/album-1',
]) {
  test(`opens full path results from ${pathname} with existing filters`, async ({ manager, router }) => {
    const filters = { ...createFilterState(), city: 'Berlin', isFavorite: true };
    const url = new URL(pathname, 'http://localhost');
    setPage({ url });
    manager.registerSearchablePageFilters(() => filters);
    manager.setMode('fullPath');
    await manager.activateSearch('  panorama 1/original pics  ');
    expect(router.url.pathname).toBe('/search');
    const terms = JSON.parse(router.url.searchParams.get('query')!) as Record<string, unknown>;
    expect(terms).toMatchObject({ originalPath: 'panorama 1/original pics', city: 'Berlin', isFavorite: true });
    expect(terms).not.toHaveProperty('query');
    if (pathname.includes('/albums/')) {
      expect(terms).toMatchObject({ albumIds: ['album-1'], withSharedSpaces: false });
      expect(terms).not.toHaveProperty('spaceId');
    } else if (pathname.startsWith('/spaces/')) {
      expect(terms).toMatchObject({ spaceId: 'space-1', withSharedSpaces: false });
    } else {
      expect(terms.withSharedSpaces).toBe(true);
    }
  });
}

test('space previews and full results use the same narrowed request', async ({ manager, api, data, router }) => {
  const url = new URL('http://localhost/spaces/space-1/photos');
  const filters = { ...createFilterState(), personIds: ['space-profile-1'], originalFileName: 'IMG' };
  setPage({ url });
  manager.registerSearchablePageFilters(() => filters);
  api.on({ searchAssets: () => ({ json: data.searchAssets({}) }) });
  manager.setMode('fullPath');
  manager.setQuery('/panorama');
  await expect.poll(() => manager.sections.photos.status).toBe('empty');
  const expected = {
    originalPath: '/panorama',
    originalFileName: 'IMG',
    spaceId: 'space-1',
    spacePersonIds: ['space-profile-1'],
    withSharedSpaces: false,
    visibility: AssetVisibility.Timeline,
  };
  expect(api.searchAssets).toHaveBeenCalledWith({ body: { ...expected, size: 5 } });
  await manager.activateSearch('/panorama');
  expect(JSON.parse(router.url.searchParams.get('query')!)).toEqual(expected);
});

test('path-only grammar leaves other search modes unchanged', () => {
  expect(parsePaletteScope('/Holiday', 'smart')).toEqual({ scope: 'collections', payload: 'Holiday' });
  expect(parsePaletteDraft('person:Alice beach', 'smart').resolutionTokens[0]).toMatchObject({
    key: 'person',
    value: 'Alice',
  });
  expect(parsePaletteDraft('person:Alice beach', 'fullPath').queryText).toBe('person:Alice beach');
});

test('keyboard mode cycling includes full path and wraps to smart', () => {
  expect(nextSearchMode('ocr')).toBe('fullPath');
  expect(nextSearchMode('fullPath')).toBe('smart');
});

test('path search preserves the Photos library selector and Recently Added personal scope', () => {
  librarySpaces.list = undefined;
  libraryView.current = LibraryView.Spaces;
  try {
    expect(buildFullPathSearchTerms('/photos', new URL('http://localhost/photos'))).toMatchObject({
      libraryView: LibraryView.Spaces,
      withSharedSpaces: true,
    });
    const recent = buildFullPathSearchTerms('/photos', new URL('http://localhost/recently-added'));
    expect(recent.withSharedSpaces).toBe(false);
    expect(recent).not.toHaveProperty('libraryView');
  } finally {
    libraryView.current = 'both';
  }
});

test('the album route overrides a stale album filter without changing personal person tokens', () => {
  const terms = buildFullPathSearchTerms('/photos', new URL('http://localhost/spaces/s/albums/a'), {
    ...createFilterState(),
    albumId: 'stale',
    personIds: ['person:profile-1'],
  });
  expect(terms).toMatchObject({ albumIds: ['a'], personIds: ['person:profile-1'], withSharedSpaces: false });
  expect(terms).not.toHaveProperty('spaceId');
});

for (const folder of ['photos', 'theme']) {
  test(`literal folder ${folder} never promotes a page or command`, ({ manager }) => {
    manager.setMode('fullPath');
    manager.setQuery(folder);
    expect(manager.topNavigationMatch).toBeNull();
    expect(manager.topCommandMatch).toBeNull();
    expect(manager.sections.navigation.status).toBe('empty');
    expect(manager.sections.commands.status).toBe('empty');
  });
}

test('Enter in the palette opens path results and Ctrl+/ cycles out of path mode', async ({ manager, router, api }) => {
  api.on({ getMlHealth: () => ({ json: { smartSearchHealthy: true } }), getAlbumNames: () => ({ json: [] }) });
  setPage({ url: new URL('http://localhost/photos') });
  manager.open();
  manager.setMode('ocr');
  await renderWithTooltips(GlobalSearch, { manager });
  const input = page.getByRole('combobox');
  await input.click();
  await userEvent.keyboard('{Control>}/{/Control}');
  expect(manager.mode).toBe('fullPath');
  await userEvent.keyboard('{Control>}/{/Control}');
  expect(manager.mode).toBe('smart');
  manager.setMode('fullPath');
  await userEvent.type(input, '/mnt/external/panorama 1');
  await expect.poll(() => manager.sections.photos.status).toBe('empty');
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => router.url.pathname).toBe('/search');
  expect(JSON.parse(router.url.searchParams.get('query')!)).toMatchObject({ originalPath: '/mnt/external/panorama 1' });
});
