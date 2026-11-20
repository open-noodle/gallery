import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The browser links every static import before any module body runs, so a static import of the
// service would load the real @immich/sdk before sdk.mock.ts registers its vi.mock. Loading it
// after that registration gives it the mocked module.
const { collectSearchResultAssets } = await import('./search.service');

const page = (ids: string[], nextPage: string | null) =>
  ({
    albums: { items: [], count: 0, facets: [], nextPage: null, total: 0 },
    assets: {
      items: ids.map((id) => ({ id, ownerId: 'me', visibility: 'timeline', isFavorite: false })),
      count: ids.length,
      facets: [],
      nextPage,
      total: ids.length,
    },
  }) as never;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('collectSearchResultAssets', () => {
  it('pages through metadata search until nextPage is null and returns all ids', async () => {
    sdkMock.searchAssets.mockResolvedValueOnce(page(['a', 'b'], '2')).mockResolvedValueOnce(page(['c'], null));

    const ids = await collectSearchResultAssets({ isFavorite: true }, { smartSearchEnabled: false, language: 'en' });

    expect(ids).toEqual([
      { id: 'a', ownerId: 'me', visibility: 'timeline' },
      { id: 'b', ownerId: 'me', visibility: 'timeline' },
      { id: 'c', ownerId: 'me', visibility: 'timeline' },
    ]);
    expect(sdkMock.searchAssets).toHaveBeenCalledTimes(2);
    expect(sdkMock.searchAssets).toHaveBeenNthCalledWith(1, {
      metadataSearchDto: { isFavorite: true, page: 1, size: 1000, withExif: false },
    });
    expect(sdkMock.searchAssets).toHaveBeenNthCalledWith(2, {
      metadataSearchDto: { isFavorite: true, page: 2, size: 1000, withExif: false },
    });
    expect(sdkMock.searchSmart).not.toHaveBeenCalled();
  });

  it('handles a single page', async () => {
    sdkMock.searchAssets.mockResolvedValueOnce(page(['x'], null));
    const ids = await collectSearchResultAssets({}, { smartSearchEnabled: false, language: 'en' });
    expect(ids).toEqual([{ id: 'x', ownerId: 'me', visibility: 'timeline' }]);
    expect(sdkMock.searchAssets).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array for no matches', async () => {
    sdkMock.searchAssets.mockResolvedValueOnce(page([], null));
    const ids = await collectSearchResultAssets({}, { smartSearchEnabled: false, language: 'en' });
    expect(ids).toEqual([]);
  });

  it('uses smart search (with language) when a query is present and smart search is enabled', async () => {
    sdkMock.searchSmart.mockResolvedValueOnce(page(['q1'], null));
    const ids = await collectSearchResultAssets({ query: 'dogs' }, { smartSearchEnabled: true, language: 'de' });
    expect(ids).toEqual([{ id: 'q1', ownerId: 'me', visibility: 'timeline' }]);
    expect(sdkMock.searchSmart).toHaveBeenCalledWith({
      smartSearchDto: { query: 'dogs', page: 1, size: 1000, withExif: false, language: 'de' },
    });
    expect(sdkMock.searchAssets).not.toHaveBeenCalled();
  });

  it('uses metadata search when a query is present but smart search is disabled', async () => {
    sdkMock.searchAssets.mockResolvedValueOnce(page(['m1'], null));
    await collectSearchResultAssets({ query: 'dogs' }, { smartSearchEnabled: false, language: 'en' });
    expect(sdkMock.searchAssets).toHaveBeenCalledTimes(1);
    expect(sdkMock.searchSmart).not.toHaveBeenCalled();
  });

  it('stops if a page returns no items even when a nextPage token is present (no infinite loop)', async () => {
    sdkMock.searchAssets.mockResolvedValueOnce(page([], '2'));
    const ids = await collectSearchResultAssets({}, { smartSearchEnabled: false, language: 'en' });
    expect(ids).toEqual([]);
    expect(sdkMock.searchAssets).toHaveBeenCalledTimes(1);
  });

  it('forces pagination fields to override colliding filter terms', async () => {
    sdkMock.searchAssets.mockResolvedValueOnce(page(['a'], null));
    await collectSearchResultAssets(
      { size: 5, page: 9, withExif: true, isFavorite: true },
      { smartSearchEnabled: false, language: 'en' },
    );
    expect(sdkMock.searchAssets).toHaveBeenCalledWith({
      metadataSearchDto: { isFavorite: true, page: 1, size: 1000, withExif: false },
    });
  });

  it('uses smart search when queryAssetId is present and smart search is enabled', async () => {
    sdkMock.searchSmart.mockResolvedValueOnce(page(['x'], null));
    await collectSearchResultAssets({ queryAssetId: 'abc' }, { smartSearchEnabled: true, language: 'en' });
    expect(sdkMock.searchSmart).toHaveBeenCalledWith({
      smartSearchDto: { queryAssetId: 'abc', page: 1, size: 1000, withExif: false, language: 'en' },
    });
    expect(sdkMock.searchAssets).not.toHaveBeenCalled();
  });

  it('keeps each asset’s owner and visibility, including assets owned by other users, across pages', async () => {
    sdkMock.searchAssets
      .mockResolvedValueOnce({
        assets: {
          items: [{ id: 'mine', ownerId: 'me', visibility: 'timeline' }],
          count: 1,
          facets: [],
          nextPage: '2',
          total: 2,
        },
        albums: { items: [], count: 0, facets: [], nextPage: null, total: 0 },
      } as never)
      .mockResolvedValueOnce({
        assets: {
          items: [{ id: 'theirs', ownerId: 'someone-else', visibility: 'archive' }],
          count: 1,
          facets: [],
          nextPage: null,
          total: 2,
        },
        albums: { items: [], count: 0, facets: [], nextPage: null, total: 0 },
      } as never);

    const assets = await collectSearchResultAssets({}, { smartSearchEnabled: false, language: 'en' });

    expect(assets).toEqual([
      { id: 'mine', ownerId: 'me', visibility: 'timeline' },
      { id: 'theirs', ownerId: 'someone-else', visibility: 'archive' },
    ]);
  });
});
