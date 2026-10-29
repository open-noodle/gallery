import request from 'supertest';
import { controllers } from 'src/controllers/index.js';
import { SearchController } from 'src/controllers/search.controller.js';
import { GallerySearchController } from 'src/gallery/controllers/gallery-search.controller.js';
import { GallerySearchService } from 'src/gallery/services/gallery-search.service.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(GallerySearchController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(GallerySearchService);

  beforeAll(async () => {
    ctx = await controllerSetup(GallerySearchController, [{ provide: GallerySearchService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
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
      service.getSearchOptions.mockResolvedValue({ total: 0 } as never);

      const { status, body } = await request(ctx.getHttpServer()).post('/search/options').send({});

      expect(status).toBe(200);
      expect(body).toEqual({ total: 0 });
      expect(service.getSearchOptions).toHaveBeenCalledWith(undefined, {});
    });

    it('keeps an explicit null tagIds (untagged) and parses dates', async () => {
      service.getSearchOptions.mockResolvedValue({ total: 0 } as never);

      await request(ctx.getHttpServer())
        .post('/search/options')
        .send({ tagIds: null, takenAfter: '2024-01-01T00:00:00.000Z', withSharedSpaces: true });

      expect(service.getSearchOptions).toHaveBeenCalledWith(undefined, {
        tagIds: null,
        takenAfter: new Date('2024-01-01T00:00:00.000Z'),
        withSharedSpaces: true,
      });
    });

    it('passes the Photos library view on (#1038)', async () => {
      service.getSearchOptions.mockResolvedValue({ total: 0 } as never);

      await request(ctx.getHttpServer())
        .post('/search/options')
        .send({ withSharedSpaces: true, libraryView: 'personal' });

      expect(service.getSearchOptions).toHaveBeenCalledWith(undefined, {
        withSharedSpaces: true,
        libraryView: 'personal',
      });
    });

    it('accepts person:, space-person: and bare person ids', async () => {
      const id = '4a5ab9a5-5f69-4a3e-bf9e-7f7c7ce8f1a2';
      service.getSearchOptions.mockResolvedValue({ total: 0 } as never);

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
      [{ libraryView: 'nope' }, 'libraryView'],
    ])('rejects an invalid %o', async (dto, field) => {
      const { status, body } = await request(ctx.getHttpServer()).post('/search/options').send(dto);

      expect(status).toBe(400);
      expect(body.message).toBe('Validation failed');
      expect(body.errors.map((error: { path: unknown[] }) => error.path[0])).toContain(field);
      expect(service.getSearchOptions).not.toHaveBeenCalled();
    });
  });
});
