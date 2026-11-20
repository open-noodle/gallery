import request from 'supertest';
import { GallerySpacePersonController } from 'src/gallery/controllers/gallery-space-person.controller.js';
import { GalleryPeopleService } from 'src/gallery/services/gallery-people.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(GallerySpacePersonController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(GalleryPeopleService);

  beforeAll(async () => {
    ctx = await controllerSetup(GallerySpacePersonController, [{ provide: GalleryPeopleService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe.each([
    ['PUT', 'put', true],
    ['DELETE', 'delete', false],
  ] as const)('%s /shared-spaces/:id/people/:personId/favorite', (_label, method, isFavorite) => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer())[method](`/shared-spaces/${factory.uuid()}/people/${factory.uuid()}/favorite`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should pass the caller, space, person and direction to the service', async () => {
      const spaceId = factory.uuid();
      const personId = factory.uuid();

      const { status } = await request(ctx.getHttpServer())
        [method](`/shared-spaces/${spaceId}/people/${personId}/favorite`)
        .set('Authorization', 'Bearer token');

      expect(status).toBe(204);
      expect(service.setSpacePersonFavorite).toHaveBeenCalledWith(undefined, spaceId, personId, isFavorite);
    });

    it('should reject a non-UUID id or personId', async () => {
      const personId = factory.uuid();
      const first = await request(ctx.getHttpServer())
        [method](`/shared-spaces/invalid/people/${personId}/favorite`)
        .set('Authorization', 'Bearer token');
      const second = await request(ctx.getHttpServer())
        [method](`/shared-spaces/${factory.uuid()}/people/invalid/favorite`)
        .set('Authorization', 'Bearer token');

      expect(first.status).toBe(400);
      expect(first.body).toMatchObject({ message: 'Validation failed' });
      expect(second.status).toBe(400);
      expect(service.setSpacePersonFavorite).not.toHaveBeenCalled();
    });
  });
});
