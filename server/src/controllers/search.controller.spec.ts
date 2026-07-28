import { SearchController } from 'src/controllers/search.controller';
import { AssetType } from 'src/enum';
import { SearchService } from 'src/services/search.service';
import request from 'supertest';
import { errorDto } from 'test/medium/responses';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

describe(SearchController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(SearchService);

  beforeAll(async () => {
    ctx = await controllerSetup(SearchController, [{ provide: SearchService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /search/metadata', () => {
    it('should reject page as a string', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/search/metadata').send({ page: 'abc' });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['page'], message: 'Invalid input: expected number, received string' }]),
      );
    });

    it('should reject page as a negative number', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/search/metadata').send({ page: -10 });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['page'], message: 'Too small: expected number to be >=1' }]),
      );
    });

    it('should reject page as 0', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/search/metadata').send({ page: 0 });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['page'], message: 'Too small: expected number to be >=1' }]),
      );
    });

    it('should reject size as a string', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/search/metadata').send({ size: 'abc' });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['size'], message: 'Invalid input: expected number, received string' }]),
      );
    });

    it('should reject an invalid size', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/search/metadata').send({ size: -1 });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['size'], message: 'Too small: expected number to be >=1' }]),
      );
    });

    it('should reject an visibility as not an enum', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/search/metadata')
        .send({ visibility: 'immich' });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['visibility'], message: expect.stringContaining('Invalid option: expected one of') },
        ]),
      );
    });

    it('should reject an isFavorite as not a boolean', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/search/metadata')
        .send({ isFavorite: 'immich' });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['isFavorite'], message: 'Invalid input: expected boolean, received string' },
        ]),
      );
    });

    it('should reject an isEncoded as not a boolean', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/search/metadata')
        .send({ isEncoded: 'immich' });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['isEncoded'], message: 'Invalid input: expected boolean, received string' },
        ]),
      );
    });

    it('should reject an isOffline as not a boolean', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/search/metadata')
        .send({ isOffline: 'immich' });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([
          { path: ['isOffline'], message: 'Invalid input: expected boolean, received string' },
        ]),
      );
    });

    it('should reject an isMotion as not a boolean', async () => {
      const { status, body } = await request(ctx.getHttpServer()).post('/search/metadata').send({ isMotion: 'immich' });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['isMotion'], message: 'Invalid input: expected boolean, received string' }]),
      );
    });

    it('should reject a deprecated field combined with a new structure field', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/search/metadata')
        .send({ filter: {}, city: 'Oslo' });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['city'], message: 'Deprecated field city cannot be combined with filter' }]),
      );
    });

    it('should reject an unknown key in the filter', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/search/metadata')
        .send({ filter: { previewPath: { eq: 'preview.webp' } } });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['filter'], message: 'Unrecognized key: "previewPath"' }]),
      );
    });

    it('should reject a nested or', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/search/metadata')
        .send({ filter: { or: [{ or: [{ city: { eq: 'Oslo' } }] }] } });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['filter', 'or', 0], message: 'Unrecognized key: "or"' }]),
      );
    });

    it('should reject an empty or branch', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/search/metadata')
        .send({ filter: { or: [{}] } });
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['filter', 'or', 0], message: 'At least one filter condition is required' }]),
      );
    });

    describe('POST /search/random', () => {
      it('should reject if withStacked is not a boolean', async () => {
        const { status, body } = await request(ctx.getHttpServer())
          .post('/search/random')
          .send({ withStacked: 'immich' });
        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([
            { path: ['withStacked'], message: 'Invalid input: expected boolean, received string' },
          ]),
        );
      });

      it('should reject if withPeople is not a boolean', async () => {
        const { status, body } = await request(ctx.getHttpServer())
          .post('/search/random')
          .send({ withPeople: 'immich' });
        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([
            { path: ['withPeople'], message: 'Invalid input: expected boolean, received string' },
          ]),
        );
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

    describe('POST /search/person', () => {
      it('should require a name', async () => {
        const { status, body } = await request(ctx.getHttpServer()).get('/search/person').send({});
        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([{ path: ['name'], message: 'Invalid input: expected string, received undefined' }]),
        );
      });
    });

    describe('GET /search/places', () => {
      it('should require a name', async () => {
        const { status, body } = await request(ctx.getHttpServer()).get('/search/places').send({});
        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([{ path: ['name'], message: 'Invalid input: expected string, received undefined' }]),
        );
      });
    });

    describe('GET /search/suggestions', () => {
      it('should require a type', async () => {
        const { status, body } = await request(ctx.getHttpServer()).get('/search/suggestions').send({});
        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([
            { path: ['type'], message: expect.stringContaining('Invalid option: expected one of') },
          ]),
        );
      });

      it('accepts a valid albumId query param', async () => {
        const albumId = '11111111-1111-4111-8111-111111111111';
        ctx.authenticate.mockResolvedValue({});
        service.getSearchSuggestions.mockResolvedValue(['Germany']);

        const { status, body } = await request(ctx.getHttpServer())
          .get('/search/suggestions')
          .query({ type: 'country', albumId });

        expect(status).toBe(200);
        expect(body).toEqual(['Germany']);
        expect(service.getSearchSuggestions).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ type: 'country', albumId }),
        );
      });

      it('rejects an invalid albumId query param', async () => {
        const { status, body } = await request(ctx.getHttpServer())
          .get('/search/suggestions')
          .query({ type: 'country', albumId: 'not-a-uuid' });

        expect(status).toBe(400);
        expect(body).toEqual(errorDto.validationError([{ path: ['albumId'], message: 'Invalid UUID' }]));
      });

      it('rejects albumId mixed with withSharedSpaces', async () => {
        const albumId = '11111111-1111-4111-8111-111111111111';

        const { status, body } = await request(ctx.getHttpServer())
          .get('/search/suggestions')
          .query({ type: 'country', albumId, withSharedSpaces: true });

        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([{ path: [], message: 'albumId cannot exist alongside withSharedSpaces' }]),
        );
      });

      it('rejects albumId mixed with spaceId', async () => {
        const albumId = '11111111-1111-4111-8111-111111111111';
        const spaceId = '22222222-2222-4222-8222-222222222222';

        const { status, body } = await request(ctx.getHttpServer())
          .get('/search/suggestions')
          .query({ type: 'country', albumId, spaceId });

        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([{ path: [], message: 'albumId cannot exist alongside spaceId' }]),
        );
      });

      it('accepts personIds for scoped city suggestions', async () => {
        const personId = '33333333-3333-4333-8333-333333333333';
        ctx.authenticate.mockResolvedValue({});
        service.getSearchSuggestions.mockResolvedValue(['Berlin']);

        const { status, body } = await request(ctx.getHttpServer())
          .get('/search/suggestions')
          .query({ type: 'city', country: 'Germany', personIds: personId });

        expect(status).toBe(200);
        expect(body).toEqual(['Berlin']);
        expect(service.getSearchSuggestions).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            type: 'city',
            country: 'Germany',
            personIds: [personId],
          }),
        );
      });

      it('accepts scoped person tokens for shared-space city suggestions', async () => {
        const personId = '33333333-3333-4333-8333-333333333333';
        ctx.authenticate.mockResolvedValue({});
        service.getSearchSuggestions.mockResolvedValue(['Berlin']);

        const { status, body } = await request(ctx.getHttpServer())
          .get('/search/suggestions')
          .query({
            type: 'city',
            withSharedSpaces: true,
            personIds: `person:${personId}`,
          });

        expect(status).toBe(200);
        expect(body).toEqual(['Berlin']);
        expect(service.getSearchSuggestions).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            type: 'city',
            withSharedSpaces: true,
            personIds: [`person:${personId}`],
          }),
        );
      });

      it('rejects malformed scoped person tokens for search suggestions', async () => {
        const { status, body } = await request(ctx.getHttpServer()).get('/search/suggestions').query({
          type: 'city',
          withSharedSpaces: true,
          personIds: 'bad:token',
        });

        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([
            { path: ['personIds', 0], message: expect.stringContaining('must match pattern') },
          ]),
        );
      });

      it('accepts city and mediaType query params (#858)', async () => {
        ctx.authenticate.mockResolvedValue({});
        service.getSearchSuggestions.mockResolvedValue(['Canon EOS R5']);

        const { status } = await request(ctx.getHttpServer()).get('/search/suggestions').query({
          type: 'camera-model',
          make: 'Canon',
          city: 'Berlin',
          mediaType: 'IMAGE',
        });

        expect(status).toBe(200);
        expect(service.getSearchSuggestions).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ city: 'Berlin', mediaType: AssetType.Image }),
        );
      });

      it('rejects an invalid mediaType (#858)', async () => {
        const { status, body } = await request(ctx.getHttpServer()).get('/search/suggestions').query({
          type: 'camera-model',
          mediaType: 'bogus',
        });

        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([
            { path: ['mediaType'], message: expect.stringContaining('Invalid option: expected one of') },
          ]),
        );
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
        });

        const { status, body } = await request(ctx.getHttpServer())
          .get('/search/suggestions/filters')
          .query({ albumId });

        expect(status).toBe(200);
        expect(body).toEqual({
          countries: [],
          cameraMakes: [],
          tags: [],
          people: [],
          ratings: [],
          mediaTypes: [],
          hasUnnamedPeople: false,
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
        expect(body).toEqual(
          errorDto.validationError([{ path: [], message: 'albumId cannot exist alongside spaceId' }]),
        );
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

      it('rejects malformed scoped person tokens for filter suggestions', async () => {
        const { status, body } = await request(ctx.getHttpServer())
          .get('/search/suggestions/filters')
          .query({ withSharedSpaces: true, personIds: 'bad:token' });

        expect(status).toBe(400);
        expect(body).toEqual(
          errorDto.validationError([
            { path: ['personIds', 0], message: expect.stringContaining('must match pattern') },
          ]),
        );
      });
    });
  });
});
