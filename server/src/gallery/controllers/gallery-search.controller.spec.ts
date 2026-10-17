import request from 'supertest';
import { AssetType } from 'src/enum.js';
import { GallerySearchController } from 'src/gallery/controllers/gallery-search.controller.js';
import { SearchService } from 'src/services/search.service.js';
import { errorDto } from 'test/medium/responses.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(GallerySearchController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(SearchService);

  beforeAll(async () => {
    ctx = await controllerSetup(GallerySearchController, [{ provide: SearchService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /search/smart/facets', () => {
    const queryAssetId = '11111111-1111-4111-8111-111111111111';

    beforeEach(() => {
      service.searchSmartFacets.mockResolvedValue({
        total: 2,
        timeBuckets: [{ timeBucket: '2024-01-01', count: 2 }],
        countries: ['Germany'],
        cities: ['Berlin'],
        cameraMakes: ['Sony'],
        cameraModels: ['A7'],
        tags: [{ id: '22222222-2222-4222-8222-222222222222', value: 'Travel' }],
        people: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Ada' }],
        ratings: [4, 5],
        mediaTypes: [AssetType.Image],
        hasUnnamedPeople: false,
        hasFavorites: true,
        hasAssetsInAlbum: true,
        hasAssetsNotInAlbum: true,
      });
    });

    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/search/smart/facets');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('forwards the smart facets body to the service', async () => {
      ctx.authenticate.mockResolvedValue({});

      const { status, body } = await request(ctx.getHttpServer())
        .post('/search/smart/facets')
        .send({
          query: 'mountains',
          language: 'de',
          withSharedSpaces: true,
          personIds: ['44444444-4444-4444-8444-444444444444'],
          country: 'Germany',
          rating: 4,
          takenAfter: '2024-01-01T00:00:00.000Z',
          takenBefore: '2025-01-01T00:00:00.000Z',
          type: 'IMAGE',
          isFavorite: true,
        });

      expect(status).toBe(200);
      expect(body.total).toBe(2);
      expect(body.timeBuckets).toEqual([{ timeBucket: '2024-01-01', count: 2 }]);
      expect(service.searchSmartFacets).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          query: 'mountains',
          language: 'de',
          withSharedSpaces: true,
          country: 'Germany',
          rating: 4,
          type: 'IMAGE',
          isFavorite: true,
        }),
      );
    });

    it('accepts queryAssetId requests', async () => {
      ctx.authenticate.mockResolvedValue({});

      const { status } = await request(ctx.getHttpServer()).post('/search/smart/facets').send({ queryAssetId });

      expect(status).toBe(200);
      expect(service.searchSmartFacets).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ queryAssetId }),
      );
    });

    it('accepts rating null for unrated smart facet requests', async () => {
      ctx.authenticate.mockResolvedValue({});

      const { status } = await request(ctx.getHttpServer()).post('/search/smart/facets').send({
        query: 'unrated',
        rating: null,
      });

      expect(status).toBe(200);
      expect(service.searchSmartFacets).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ rating: null }),
      );
    });

    it('rejects invalid queryAssetId values', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/search/smart/facets')
        .send({ queryAssetId: 'not-a-uuid' });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['queryAssetId'], message: 'Invalid UUID' }]));
    });
  });

  describe('GET /search/suggestions/filters', () => {
    it('accepts a valid albumId query param', async () => {
      const albumId = '11111111-1111-4111-8111-111111111111';
      ctx.authenticate.mockResolvedValue({});
      service.getFilterSuggestions.mockResolvedValue({
        countries: [],
        cameraMakes: [],
        tags: [],
        people: [],
        ratings: [],
        mediaTypes: [],
        hasUnnamedPeople: false,
        hasFavorites: false,
        hasAssetsInAlbum: false,
        hasAssetsNotInAlbum: false,
      });

      const { status, body } = await request(ctx.getHttpServer()).get('/search/suggestions/filters').query({ albumId });

      expect(status).toBe(200);
      expect(body).toEqual({
        countries: [],
        cameraMakes: [],
        tags: [],
        people: [],
        ratings: [],
        mediaTypes: [],
        hasUnnamedPeople: false,
        hasFavorites: false,
        hasAssetsInAlbum: false,
        hasAssetsNotInAlbum: false,
      });
      expect(service.getFilterSuggestions).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ albumId }),
      );
    });

    it('rejects albumId mixed with spaceId', async () => {
      const albumId = '11111111-1111-4111-8111-111111111111';
      const spaceId = '22222222-2222-4222-8222-222222222222';

      const { status, body } = await request(ctx.getHttpServer())
        .get('/search/suggestions/filters')
        .query({ albumId, spaceId });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: [], message: 'albumId cannot exist alongside spaceId' }]));
    });

    it('rejects an invalid albumId query param', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get('/search/suggestions/filters')
        .query({ albumId: 'not-a-uuid' });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['albumId'], message: 'Invalid UUID' }]));
    });

    it('rejects albumId mixed with withSharedSpaces', async () => {
      const albumId = '11111111-1111-4111-8111-111111111111';

      const { status, body } = await request(ctx.getHttpServer())
        .get('/search/suggestions/filters')
        .query({ albumId, withSharedSpaces: true });

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: [], message: 'albumId cannot exist alongside withSharedSpaces' }]),
      );
    });

    it('accepts scoped person tokens for shared-space filter suggestions', async () => {
      const personId = '33333333-3333-4333-8333-333333333333';
      ctx.authenticate.mockResolvedValue({});
      service.getFilterSuggestions.mockResolvedValue({
        countries: [],
        cameraMakes: [],
        tags: [],
        people: [],
        ratings: [],
        mediaTypes: [],
        hasUnnamedPeople: false,
        hasFavorites: false,
        hasAssetsInAlbum: false,
        hasAssetsNotInAlbum: false,
      });

      const { status } = await request(ctx.getHttpServer())
        .get('/search/suggestions/filters')
        .query({
          withSharedSpaces: true,
          personIds: `space-person:${personId}`,
        });

      expect(status).toBe(200);
      expect(service.getFilterSuggestions).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ withSharedSpaces: true, personIds: [`space-person:${personId}`] }),
      );
    });

    it('forwards the state, lens and contributor narrowings to the service', async () => {
      const ownerId = '44444444-4444-4444-8444-444444444444';
      ctx.authenticate.mockResolvedValue({});
      service.getFilterSuggestions.mockResolvedValue({
        countries: [],
        cameraMakes: [],
        tags: [],
        people: [],
        ratings: [],
        mediaTypes: [],
        hasUnnamedPeople: false,
        hasFavorites: false,
        hasAssetsInAlbum: false,
        hasAssetsNotInAlbum: false,
      });

      const { status } = await request(ctx.getHttpServer())
        .get('/search/suggestions/filters')
        .query({ state: 'Bavaria', lensModel: 'RF24-105mm F4 L IS USM', ownerId });

      expect(status).toBe(200);
      expect(service.getFilterSuggestions).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ state: 'Bavaria', lensModel: 'RF24-105mm F4 L IS USM', ownerId }),
      );
    });

    it('rejects a non-uuid contributor narrowing', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get('/search/suggestions/filters')
        .query({ ownerId: 'not-a-uuid' });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['ownerId'], message: 'Invalid UUID' }]));
    });

    it('rejects malformed scoped person tokens for filter suggestions', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get('/search/suggestions/filters')
        .query({ withSharedSpaces: true, personIds: 'bad:token' });

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['personIds', 0], message: expect.stringContaining('must match pattern') }]),
      );
    });
  });
});
