import request from 'supertest';
import { SpatialSceneAdminController } from 'src/gallery/controllers/spatial-scene-admin.controller.js';
import { SpatialSceneService } from 'src/gallery/services/spatial-scene.service.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(SpatialSceneAdminController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(SpatialSceneService);

  beforeAll(async () => {
    ctx = await controllerSetup(SpatialSceneAdminController, [{ provide: SpatialSceneService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  const adminRoute = () =>
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ adminRoute: true }) }),
    );

  describe('GET /admin/spatial-scene/choices', () => {
    it('is an admin route', async () => {
      await request(ctx.getHttpServer()).get('/admin/spatial-scene/choices');
      adminRoute();
    });

    it('returns the count', async () => {
      service.getChoices.mockResolvedValue({ count: 3 });
      const { status, body } = await request(ctx.getHttpServer()).get('/admin/spatial-scene/choices');
      expect(status).toBe(200);
      expect(body).toEqual({ count: 3 });
    });
  });

  describe('DELETE /admin/spatial-scene/choices', () => {
    it('is an admin route', async () => {
      await request(ctx.getHttpServer()).delete('/admin/spatial-scene/choices');
      adminRoute();
    });

    it('clears the choices and returns how many', async () => {
      service.clearChoices.mockResolvedValue({ count: 3 });
      const { status, body } = await request(ctx.getHttpServer()).delete('/admin/spatial-scene/choices');
      expect(status).toBe(200);
      expect(body).toEqual({ count: 3 });
      expect(service.clearChoices).toHaveBeenCalledOnce();
    });
  });
});
