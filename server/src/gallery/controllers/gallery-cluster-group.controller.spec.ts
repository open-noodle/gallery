import request from 'supertest';
import { GalleryClusterGroupController } from 'src/gallery/controllers/gallery-cluster-group.controller.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup } from 'test/utils.js';

describe(GalleryClusterGroupController.name, () => {
  let ctx: ControllerContext;

  beforeAll(async () => {
    ctx = await controllerSetup(GalleryClusterGroupController, []);
    return () => ctx.close();
  });

  beforeEach(() => {
    ctx.reset();
  });

  describe('GET /cluster-groups/:id/users', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get(`/cluster-groups/${factory.uuid()}/users`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should answer stock web with no users', async () => {
      const { status, body } = await request(ctx.getHttpServer()).get(`/cluster-groups/${factory.uuid()}/users`);
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it('should leave the other cluster-group routes unmounted', async () => {
      const { status } = await request(ctx.getHttpServer()).get('/cluster-groups/requests');
      expect(status).toBe(404);
    });
  });
});
