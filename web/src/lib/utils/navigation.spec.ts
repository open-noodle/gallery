import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assetCacheManager } from '$lib/managers/AssetCacheManager.svelte';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import { getAssetInfoFromParam, navigate } from './navigation';

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock('$app/navigation', () => ({
  goto: gotoMock,
}));

// navigation.ts reads the reactive `page` from `$app/state` (not the `$app/stores` mock below,
// which nothing here imports) — see reactive-page.mock.svelte.ts's own docs for why this needs to
// be a real $state object rather than a plain literal.
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

vi.mock('$app/stores', () => ({
  page: {
    subscribe: vi.fn(),
  },
}));

vi.mock('$lib/managers/AssetCacheManager.svelte', () => ({
  assetCacheManager: {
    getAsset: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('getAssetInfoFromParam', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes spaceId through when preloading an asset from a space route', async () => {
    await getAssetInfoFromParam({ assetId: 'asset-1', spaceId: 'space-1' });

    expect(assetCacheManager.getAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'asset-1', spaceId: 'space-1' }),
      false,
    );
  });

  it('does not fetch when assetId is absent', () => {
    const result = getAssetInfoFromParam({ spaceId: 'space-1' });

    expect(result).toBeUndefined();
    expect(assetCacheManager.getAsset).not.toHaveBeenCalled();
  });
});

// Pins the shared bug behind gallery#album.e2e-spec.ts:150 / the album page's picker-close chip
// loss: replaceScrollTarget's no-`at` branch used to return a BARE pathname, discarding the whole
// query string (filters, sort, q, …) instead of just the one-shot `at` scroll target.
describe('navigate - asset grid route with no scroll target', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPage.reset('https://gallery.test/albums/album-1?tags=abc&at=old-asset', {
      routeId: '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]',
      params: { albumId: 'album-1' },
    });
  });

  it('drops a stale ?at= but preserves the rest of the query when no new scroll target is given', async () => {
    await navigate(
      { targetRoute: 'current', assetId: null, assetGridRouteSearchParams: { at: undefined } },
      { forceNavigate: true },
    );

    expect(gotoMock).toHaveBeenCalledWith('/albums/album-1?tags=abc', { forceNavigate: true });
  });

  it('appends ?at= without disturbing the rest of the query when a scroll target IS given', async () => {
    await navigate(
      { targetRoute: 'current', assetId: null, assetGridRouteSearchParams: { at: 'asset-9' } },
      { forceNavigate: true },
    );

    expect(gotoMock).toHaveBeenCalledWith('/albums/album-1?tags=abc&at=asset-9', { forceNavigate: true });
  });

  it('returns a bare pathname (no trailing "?") when there is no query left to preserve', async () => {
    mockPage.reset('https://gallery.test/albums/album-1?at=old-asset', {
      routeId: '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]',
      params: { albumId: 'album-1' },
    });

    await navigate(
      { targetRoute: 'current', assetId: null, assetGridRouteSearchParams: { at: undefined } },
      { forceNavigate: true },
    );

    expect(gotoMock).toHaveBeenCalledWith('/albums/album-1', { forceNavigate: true });
  });
});
