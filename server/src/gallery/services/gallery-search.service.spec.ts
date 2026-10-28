import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AssetType, AssetVisibility } from 'src/enum.js';
import { SearchOptionsResult } from 'src/gallery/repositories/smart-facet.repository.js';
import {
  GallerySearchService,
  SEARCH_OPTIONS_MAX_STALE_MS,
  SEARCH_OPTIONS_REFRESH_INTERVAL_MS,
} from 'src/gallery/services/gallery-search.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { PartnerFactory } from 'test/factories/partner.factory.js';
import { getForPartner } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const emptyOptions: SearchOptionsResult = {
  availability: {
    hasAssets: false,
    hasPeople: false,
    hasTags: false,
    hasPlaces: false,
    hasCameras: false,
    hasRatings: false,
    hasImages: false,
    hasVideos: false,
    hasFavorites: false,
    hasAssetsInAlbum: false,
    hasAssetsNotInAlbum: false,
  },
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe(GallerySearchService.name, () => {
  let sut: GallerySearchService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();
  const total = () => sut.getSearchOptions(auth, { dimensions: ['total'] });

  const dimensionsOf = (call: number) => mocks.smartFacet.getSearchOptions.mock.calls[call][0].dimensions;

  const browse = () => {
    const [options] = mocks.smartFacet.getSearchOptions.mock.calls.at(-1)!;
    if (options.mode !== 'browse') {
      throw new Error(`expected browse mode, got ${options.mode}`);
    }
    return options;
  };

  const query = () => {
    const [options] = mocks.smartFacet.getSearchOptions.mock.calls.at(-1)!;
    if (options.mode !== 'query') {
      throw new Error(`expected query mode, got ${options.mode}`);
    }
    return options.search;
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(GallerySearchService));
    clearConfigCache();
    mocks.partner.getAll.mockResolvedValue([]);
    mocks.smartFacet.getSearchOptions.mockResolvedValue(emptyOptions);
    mocks.smartFacet.getSearchOptionsWatermark.mockResolvedValue('watermark-1');
    vi.spyOn(sut, 'resolveViewerScope').mockResolvedValue({ visibility: 'not-locked' });
  });

  describe('dimensions and the unfiltered cache', () => {
    it('computes availability when no dimension is asked for', async () => {
      await sut.getSearchOptions(auth, {});

      expect(dimensionsOf(0)).toEqual(['availability']);
    });

    it('serves an unfiltered request per dimension from cache while the watermark holds', async () => {
      mocks.smartFacet.getSearchOptions.mockImplementation((options) =>
        Promise.resolve({ total: 7, tags: [], ...(options.dimensions.includes('availability') && emptyOptions) }),
      );

      await expect(sut.getSearchOptions(auth, { dimensions: ['total'] })).resolves.toEqual({ total: 7 });
      await expect(sut.getSearchOptions(auth, { dimensions: ['total', 'tags'] })).resolves.toEqual({
        total: 7,
        tags: [],
      });
      // only the missing dimension was computed
      expect(dimensionsOf(1)).toEqual(['tags']);
      await sut.getSearchOptions(auth, { dimensions: ['tags', 'total'] });
      expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(2);

      // after a change: the previous result at once, flagged, and a refresh in the background
      mocks.smartFacet.getSearchOptionsWatermark.mockResolvedValue('watermark-2');
      await expect(sut.getSearchOptions(auth, { dimensions: ['total'] })).resolves.toEqual({ total: 7, stale: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(3);
    });

    it('shares one computation between concurrent requests for the same dimension', async () => {
      await Promise.all([
        sut.getSearchOptions(auth, { dimensions: ['people'] }),
        sut.getSearchOptions(auth, { dimensions: ['people'] }),
      ]);

      expect(mocks.smartFacet.getSearchOptionsWatermark).toHaveBeenCalledTimes(2);
      expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(1);
    });

    it('does not keep a failed computation', async () => {
      mocks.smartFacet.getSearchOptions.mockRejectedValueOnce(new Error('boom'));

      await expect(sut.getSearchOptions(auth, { dimensions: ['total'] })).rejects.toThrow('boom');
      await sut.getSearchOptions(auth, { dimensions: ['total'] });
      expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(2);
    });

    it.each([
      [{ city: 'Kyoto' }],
      [{ tagIds: null }],
      [{ personIds: ['person:4a5ab9a5-5f69-4a3e-bf9e-7f7c7ce8f1a2'] }],
      [{ isFavorite: false }],
    ])('never caches a filtered request: %o', async (filter) => {
      await sut.getSearchOptions(auth, { ...filter, dimensions: ['total'] });
      await sut.getSearchOptions(auth, { ...filter, dimensions: ['total'] });

      expect(mocks.smartFacet.getSearchOptionsWatermark).not.toHaveBeenCalled();
      expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(2);
    });

    it('serves a list whose own filter is the only filter from the unfiltered cache, re-marking selected tags', async () => {
      const tagId = newUuid();
      mocks.smartFacet.getSearchOptions.mockResolvedValue({
        timeBuckets: [{ timeBucket: '2024-01-01', count: 3 }],
        tags: [{ id: tagId, value: 'beach', count: 3, isSelected: false }],
      });
      const year = {
        takenAfter: new Date('2024-01-01T00:00:00.000Z'),
        takenBefore: new Date('2025-01-01T00:00:00.000Z'),
      };

      await sut.getSearchOptions(auth, { dimensions: ['time', 'tags'] });
      await expect(sut.getSearchOptions(auth, { ...year, dimensions: ['time'] })).resolves.toEqual({
        timeBuckets: [{ timeBucket: '2024-01-01', count: 3 }],
      });
      await expect(sut.getSearchOptions(auth, { tagIds: [tagId], dimensions: ['tags'] })).resolves.toEqual({
        tags: [{ id: tagId, value: 'beach', count: 3, isSelected: true }],
      });
      expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(1);

      // with another filter beside it, the list is computed
      await sut.getSearchOptions(auth, { ...year, city: 'Kyoto', dimensions: ['time'] });
      expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(2);
    });

    describe('stale while revalidate', () => {
      let computed: number;

      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
        computed = 0;
        mocks.smartFacet.getSearchOptions.mockImplementation(() => Promise.resolve({ total: ++computed }));
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('serves the previous result, flagged stale, while one background computation refreshes it', async () => {
        await expect(total()).resolves.toEqual({ total: 1 });

        mocks.smartFacet.getSearchOptionsWatermark.mockResolvedValue('watermark-2');
        await expect(total()).resolves.toEqual({ total: 1, stale: true });
        await flush();
        expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(2);

        await expect(total()).resolves.toEqual({ total: 2 });
      });

      it('refreshes a key once for concurrent stale requests', async () => {
        await total();
        mocks.smartFacet.getSearchOptionsWatermark.mockResolvedValue('watermark-2');

        await Promise.all([total(), total(), total()]);
        await flush();

        expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(2);
      });

      it('recomputes a key at most once per refresh interval', async () => {
        await total();
        mocks.smartFacet.getSearchOptionsWatermark.mockResolvedValue('watermark-2');
        await total();
        await flush();

        vi.setSystemTime(Date.now() + 5000);
        mocks.smartFacet.getSearchOptionsWatermark.mockResolvedValue('watermark-3');
        await expect(total()).resolves.toEqual({ total: 2, stale: true });
        await flush();
        expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(2);

        vi.setSystemTime(Date.now() + SEARCH_OPTIONS_REFRESH_INTERVAL_MS);
        await total();
        await flush();
        expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(3);
      });

      it('does not start a second refresh while one is still running, even past the interval', async () => {
        await total();
        mocks.smartFacet.getSearchOptionsWatermark.mockResolvedValue('watermark-2');
        mocks.smartFacet.getSearchOptions.mockReturnValueOnce(new Promise(() => {}));
        await total();
        await flush();

        vi.setSystemTime(Date.now() + SEARCH_OPTIONS_REFRESH_INTERVAL_MS + 1);
        await expect(total()).resolves.toEqual({ total: 1, stale: true });
        await flush();
        expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(2);
      });

      it('never serves a result older than the maximum staleness', async () => {
        await total();
        vi.setSystemTime(Date.now() + SEARCH_OPTIONS_MAX_STALE_MS + 1);
        mocks.smartFacet.getSearchOptionsWatermark.mockResolvedValue('watermark-2');

        await expect(total()).resolves.toEqual({ total: 2 });
      });

      it('keeps serving the previous result when a refresh fails', async () => {
        await total();
        mocks.smartFacet.getSearchOptionsWatermark.mockResolvedValue('watermark-2');
        mocks.smartFacet.getSearchOptions.mockRejectedValueOnce(new Error('boom'));

        await expect(total()).resolves.toEqual({ total: 1, stale: true });
        await flush();
        await expect(total()).resolves.toEqual({ total: 1, stale: true });
      });
    });

    it('never stores selection marks: a tags-only request computes the cached list without the tag filter', async () => {
      const tagId = newUuid();
      mocks.smartFacet.getSearchOptions.mockImplementation((options) => {
        const selected = options.mode === 'browse' ? (options.timeline.tagIds ?? []) : [];
        return Promise.resolve({
          tags: [{ id: tagId, value: 'beach', count: 3, isSelected: selected.includes(tagId) }],
        });
      });

      await expect(sut.getSearchOptions(auth, { tagIds: [tagId], dimensions: ['tags'] })).resolves.toEqual({
        tags: [{ id: tagId, value: 'beach', count: 3, isSelected: true }],
      });
      await expect(sut.getSearchOptions(auth, { dimensions: ['tags'] })).resolves.toEqual({
        tags: [{ id: tagId, value: 'beach', count: 3, isSelected: false }],
      });
      expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(1);
    });

    it('keys the cache by user and by scope', async () => {
      const other = AuthFactory.create();
      await sut.getSearchOptions(auth, { dimensions: ['total'] });
      await sut.getSearchOptions(other, { dimensions: ['total'] });
      await sut.getSearchOptions(auth, { dimensions: ['total'], visibility: AssetVisibility.Archive });
      await sut.getSearchOptions(auth, { dimensions: ['total'], tagIds: [] });

      expect(mocks.smartFacet.getSearchOptions).toHaveBeenCalledTimes(3);
    });
  });

  describe('rejected combinations (same messages as the existing search endpoints)', () => {
    it.each([
      [{ albumIds: [newUuid()], withSharedSpaces: true }, 'Cannot use albumId with withSharedSpaces'],
      [{ albumIds: [newUuid()], spaceId: newUuid() }, 'Cannot use albumId with spaceId'],
      [{ spaceId: newUuid(), withSharedSpaces: true }, 'Cannot use both spaceId and withSharedSpaces'],
      [{ spacePersonIds: [newUuid()] }, 'spacePersonIds requires spaceId'],
    ])('rejects %o', async (dto, message) => {
      await expect(sut.getSearchOptions(auth, dto)).rejects.toThrow(new BadRequestException(message));
      expect(mocks.smartFacet.getSearchOptions).not.toHaveBeenCalled();
    });

    it.each([
      [{ withSharedSpaces: true }, 'withSharedSpaces is only supported for non-archived, non-trashed assets'],
      [
        { withSharedSpaces: true, isFavorite: false },
        'withSharedSpaces is only supported for non-archived, non-trashed assets',
      ],
      // { withPartners: true } alone now defaults to timeline visibility, as /timeline/buckets does (immich-32565)
      [
        { withPartners: true, visibility: AssetVisibility.Archive },
        'withPartners is only supported for non-archived, non-trashed, non-locked assets',
      ],
      [
        { withSharedSpaces: true, visibility: AssetVisibility.Archive },
        'withSharedSpaces is only supported for non-archived, non-trashed assets',
      ],
      [
        { withPartners: true, visibility: AssetVisibility.Archive },
        'withPartners is only supported for non-archived, non-trashed, non-locked assets',
      ],
      [
        { spaceId: newUuid(), visibility: AssetVisibility.Hidden },
        'Hidden and locked assets are not available when browsing a shared space or album',
      ],
      [{ albumIds: [newUuid(), newUuid()] }, 'Browse mode takes at most one album'],
    ])('browse mode rejects %o as /timeline/buckets does', async (dto, message) => {
      await expect(sut.getSearchOptions(auth, dto)).rejects.toThrow(new BadRequestException(message));
      expect(mocks.smartFacet.getSearchOptions).not.toHaveBeenCalled();
    });

    it('requires an elevated session for locked visibility', async () => {
      await expect(sut.getSearchOptions(auth, { visibility: AssetVisibility.Locked })).rejects.toThrow();
      expect(mocks.smartFacet.getSearchOptions).not.toHaveBeenCalled();
    });
  });

  describe('access', () => {
    it('refuses a shared link, as the route guard does', async () => {
      const linkAuth = AuthFactory.from().sharedLink({ allowUpload: false }).build();

      await expect(sut.getSearchOptions(linkAuth, { albumIds: [newUuid()] })).rejects.toThrow(ForbiddenException);
      expect(mocks.smartFacet.getSearchOptions).not.toHaveBeenCalled();
    });

    it('refuses a space the caller is not a member of', async () => {
      const spaceId = newUuid();
      mocks.access.sharedSpace.checkMemberAccess.mockResolvedValue(new Set());

      await expect(sut.getSearchOptions(auth, { spaceId })).rejects.toThrow(BadRequestException);
      expect(mocks.smartFacet.getSearchOptions).not.toHaveBeenCalled();
    });

    it('refuses an album the caller cannot read', async () => {
      const albumId = newUuid();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.album.checkSharedAlbumAccess.mockResolvedValue(new Set());

      await expect(sut.getSearchOptions(auth, { albumIds: [albumId] })).rejects.toThrow(BadRequestException);
      expect(mocks.smartFacet.getSearchOptions).not.toHaveBeenCalled();
    });

    it('refuses a queryAssetId the caller cannot read', async () => {
      const queryAssetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.getSearchOptions(auth, { queryAssetId })).rejects.toThrow(`Not found or no asset.read access`);
      expect(mocks.search.getEmbedding).not.toHaveBeenCalled();
      expect(mocks.smartFacet.getSearchOptions).not.toHaveBeenCalled();
    });
  });

  describe('browse mode (resolved as /timeline/buckets resolves it)', () => {
    beforeEach(() => {
      // the timeline surface carries no visibility default
      vi.mocked(sut.resolveViewerScope).mockResolvedValue({});
    });

    it('scopes to the caller, plus timeline partners only with withPartners', async () => {
      const partner = PartnerFactory.create({ sharedWithId: auth.user.id, inTimeline: true });
      mocks.partner.getAll.mockResolvedValue([getForPartner(partner)]);

      await sut.getSearchOptions(auth, { withSharedSpaces: true, visibility: AssetVisibility.Timeline });
      expect(browse().timeline).toMatchObject({ userIds: [auth.user.id], callerId: auth.user.id });

      await sut.getSearchOptions(auth, {
        withSharedSpaces: true,
        withPartners: true,
        visibility: AssetVisibility.Timeline,
      });
      expect(browse().timeline).toMatchObject({
        userIds: [auth.user.id, partner.sharedById],
        withSharedSpaces: true,
        visibility: AssetVisibility.Timeline,
        callerId: auth.user.id,
        authUserId: auth.user.id,
      });
      expect(sut.resolveViewerScope).toHaveBeenCalledWith(
        auth,
        'timeline',
        expect.objectContaining({ userId: auth.user.id, withSharedSpaces: true }),
      );
    });

    it('takes an album as the timeline does: no owner scope, the spaces that link it', async () => {
      const albumId = newUuid();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
      mocks.sharedSpace.getMemberSpaceIdsLinkingAlbum.mockResolvedValue(['space-1']);

      await sut.getSearchOptions(auth, { albumIds: [albumId] });

      expect(browse().timeline).toMatchObject({ albumId, albumSpaceIds: ['space-1'] });
      expect(browse().timeline.userIds).toBeUndefined();
      expect(browse().timeline.callerId).toBeUndefined();
    });

    it('resolves the favourites probe as its own request (#763)', async () => {
      await sut.getSearchOptions(auth, { withSharedSpaces: true, visibility: AssetVisibility.Timeline });

      expect(browse().timeline.isFavorite).toBeUndefined();
      expect(browse().favorites.isFavorite).toBe(true);
      expect(sut.resolveViewerScope).toHaveBeenCalledWith(
        auth,
        'timeline',
        expect.objectContaining({ isFavorite: true, userId: auth.user.id }),
      );
    });

    it('passes every filter through in the timeline vocabulary', async () => {
      await sut.getSearchOptions(auth, {
        tagIds: ['tag-1'],
        city: 'Kyoto',
        make: 'Apple',
        rating: 3,
        type: AssetType.Video,
        isInAlbum: true,
        ocr: 'menu',
        description: 'dinner',
        originalFileName: 'IMG_1',
        ownerId: auth.user.id,
        withStacked: true,
        takenAfter: new Date('2024-01-01T00:00:00.000Z'),
        takenBefore: new Date('2025-01-01T00:00:00.000Z'),
      });

      expect(browse().timeline).toMatchObject({
        tagIds: ['tag-1'],
        city: 'Kyoto',
        make: 'Apple',
        rating: 3,
        assetType: AssetType.Video,
        isInAlbum: true,
        ocr: 'menu',
        description: 'dinner',
        originalFileName: 'IMG_1',
        ownerId: auth.user.id,
        withStacked: true,
        takenAfter: '2024-01-01T00:00:00.000Z',
        takenBefore: '2025-01-01T00:00:00.000Z',
      });
      expect(browse().untagged).toBe(false);
    });

    it('carries Untagged beside the timeline request, which cannot express it', async () => {
      await sut.getSearchOptions(auth, { tagIds: null });

      expect(browse().untagged).toBe(true);
      expect(browse().timeline.tagIds).toBeUndefined();
    });

    it('needs no smart search', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { enabled: false } });

      await expect(sut.getSearchOptions(auth, {})).resolves.toEqual(emptyOptions);
      expect(mocks.machineLearning.encodeText).not.toHaveBeenCalled();
    });
  });

  describe('query mode (resolved as /search/smart resolves it)', () => {
    beforeEach(() => {
      mocks.machineLearning.encodeText.mockResolvedValue('[1,2,3]');
    });

    it('searches the caller and the partners shown in their timeline, whatever withPartners says', async () => {
      const partner = PartnerFactory.create({ sharedWithId: auth.user.id, inTimeline: true });
      mocks.partner.getAll.mockResolvedValue([getForPartner(partner)]);

      await sut.getSearchOptions(auth, { query: 'beach', withSharedSpaces: true, withPartners: false });

      expect(query()).toMatchObject({
        userIds: [auth.user.id, partner.sharedById],
        withSharedSpaces: true,
        visibility: 'not-locked',
        authUserId: auth.user.id,
      });
      expect(query()).not.toHaveProperty('withPartners');
    });

    it('drops the owner scope under an album scope, where album access is the boundary', async () => {
      const albumId = newUuid();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));

      await sut.getSearchOptions(auth, { query: 'beach', albumIds: [albumId] });

      expect(query().userIds).toBeUndefined();
      expect(query().albumIds).toEqual([albumId]);
    });

    it('asks for the favourites scope the results call uses (#763)', async () => {
      await sut.getSearchOptions(auth, { query: 'beach', withSharedSpaces: true, isFavorite: true });

      expect(sut.resolveViewerScope).toHaveBeenCalledWith(
        auth,
        'search',
        expect.objectContaining({ withSharedSpaces: true, favoriteScoped: true, withFavoriteSpaces: true }),
      );
    });

    it('passes the resolved viewer scope and every filter through', async () => {
      vi.mocked(sut.resolveViewerScope).mockResolvedValue({
        visibility: 'not-locked',
        timelineSpaceIds: ['space-1'],
        favoriteSpaceIds: ['space-1', 'space-2'],
        identityIds: ['identity-1'],
      });

      await sut.getSearchOptions(auth, {
        query: 'beach',
        withSharedSpaces: true,
        personIds: ['person:x'],
        tagIds: null,
        city: 'Kyoto',
        rating: 3,
        ocr: 'menu',
      });

      expect(query()).toMatchObject({
        timelineSpaceIds: ['space-1'],
        favoriteSpaceIds: ['space-1', 'space-2'],
        identityIds: ['identity-1'],
        city: 'Kyoto',
        rating: 3,
        ocr: 'menu',
      });
      expect(query().tagIds).toBeNull();
    });

    it('refuses query mode when smart search is off, as /search/smart does', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { enabled: false } });

      await expect(sut.getSearchOptions(auth, { query: 'beach' })).rejects.toThrow('Smart search is not enabled');
    });

    it('encodes a text query with the configured model and threshold', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { clip: { modelName: 'ViT-B-16-SigLIP__webli', maxDistance: 0.75 } },
      });

      await sut.getSearchOptions(auth, { query: 'beach', language: 'de', withSharedSpaces: true });

      expect(mocks.machineLearning.encodeText).toHaveBeenCalledWith('beach', {
        modelName: 'ViT-B-16-SigLIP__webli',
        language: 'de',
      });
      expect(query()).toMatchObject({ embedding: '[1,2,3]', maxDistance: 0.75 });
      expect(query()).not.toHaveProperty('query');
      expect(query()).not.toHaveProperty('language');
    });

    it('uses the reference asset embedding for queryAssetId', async () => {
      const queryAssetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([queryAssetId]));
      mocks.search.getEmbedding.mockResolvedValue('[4,5,6]');

      await sut.getSearchOptions(auth, { queryAssetId });

      expect(mocks.search.getEmbedding).toHaveBeenCalledWith(queryAssetId);
      expect(query().embedding).toBe('[4,5,6]');
    });

    it('refuses a reference asset with no embedding', async () => {
      const queryAssetId = newUuid();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([queryAssetId]));
      mocks.search.getEmbedding.mockResolvedValue(null);

      await expect(sut.getSearchOptions(auth, { queryAssetId })).rejects.toThrow(
        `Asset ${queryAssetId} has no embedding`,
      );
    });
  });
});
