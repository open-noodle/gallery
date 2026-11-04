import request from 'supertest';
import { controllers } from 'src/controllers/index.js';
import { SearchController } from 'src/controllers/search.controller.js';
import { AssetType } from 'src/enum.js';
import { GallerySearchController } from 'src/gallery/controllers/gallery-search.controller.js';
import { GallerySearchService } from 'src/gallery/services/gallery-search.service.js';
import { SearchService } from 'src/services/search.service.js';
import { errorDto } from 'test/medium/responses.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(GallerySearchController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(SearchService);
  const galleryService = mockBaseService(GallerySearchService);

  beforeAll(async () => {
    ctx = await controllerSetup(GallerySearchController, [
      { provide: SearchService, useValue: service },
      { provide: GallerySearchService, useValue: galleryService },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    galleryService.resetAllMocks();
    ctx.reset();
  });

  it('is registered with the fork controllers, ahead of SearchController', () => {
    expect(controllers).toContain(GallerySearchController);
    expect(controllers.indexOf(GallerySearchController)).toBeLessThan(controllers.indexOf(SearchController));
  });

  describe('POST /search/options', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/search/options').send({});
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('answers 200 with the service result, for an empty body (browse mode)', async () => {
      galleryService.getSearchOptions.mockResolvedValue({ total: 0 } as never);

      const { status, body } = await request(ctx.getHttpServer()).post('/search/options').send({});

      expect(status).toBe(200);
      expect(body).toEqual({ total: 0 });
      expect(galleryService.getSearchOptions).toHaveBeenCalledWith(undefined, {});
    });

    it('keeps an explicit null tagIds (untagged) and parses dates', async () => {
      galleryService.getSearchOptions.mockResolvedValue({ total: 0 } as never);

      await request(ctx.getHttpServer())
        .post('/search/options')
        .send({ tagIds: null, takenAfter: '2024-01-01T00:00:00.000Z', withSharedSpaces: true });

      expect(galleryService.getSearchOptions).toHaveBeenCalledWith(undefined, {
        tagIds: null,
        takenAfter: new Date('2024-01-01T00:00:00.000Z'),
        withSharedSpaces: true,
      });
    });

    it('accepts person:, space-person: and bare person ids', async () => {
      const id = '4a5ab9a5-5f69-4a3e-bf9e-7f7c7ce8f1a2';
      galleryService.getSearchOptions.mockResolvedValue({ total: 0 } as never);

      const { status } = await request(ctx.getHttpServer())
        .post('/search/options')
        .send({ personIds: [`person:${id}`, `space-person:${id}`, id] });

      expect(status).toBe(200);
    });

    it.each([
      [{ personIds: ['not-a-token'] }, 'personIds'],
      [{ spacePersonIds: ['nope'] }, 'spacePersonIds'],
      [{ rating: 6 }, 'rating'],
      [{ albumIds: ['nope'] }, 'albumIds'],
      [{ visibility: 'nope' }, 'visibility'],
      [{ queryAssetId: 'nope' }, 'queryAssetId'],
    ])('rejects an invalid %o', async (dto, field) => {
      const { status, body } = await request(ctx.getHttpServer()).post('/search/options').send(dto);

      expect(status).toBe(400);
      expect(body.message).toBe('Validation failed');
      expect(body.errors.map((error: { path: unknown[] }) => error.path[0])).toContain(field);
      expect(galleryService.getSearchOptions).not.toHaveBeenCalled();
    });
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
