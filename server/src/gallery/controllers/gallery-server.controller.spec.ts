import request from 'supertest';
import { GalleryServerController } from 'src/gallery/controllers/gallery-server.controller.js';
import { ServerService } from 'src/services/server.service.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

// GET /server/ml-health: the cmdk palette's ML health indicator.
describe(GalleryServerController.name, () => {
  let ctx: ControllerContext;
  const serverService = mockBaseService(ServerService);

  beforeAll(async () => {
    ctx = await controllerSetup(GalleryServerController, [{ provide: ServerService, useValue: serverService }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    serverService.resetAllMocks();
    ctx.reset();
  });

  describe('GET /server/ml-health', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/server/ml-health');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('returns { smartSearchHealthy: true } when service reports healthy', async () => {
      serverService.getMlHealth.mockResolvedValue({ smartSearchHealthy: true });
      const { status, body } = await request(ctx.getHttpServer()).get('/server/ml-health');
      expect(status).toBe(200);
      expect(body).toEqual({ smartSearchHealthy: true });
    });

    it('returns { smartSearchHealthy: false } when service reports unhealthy', async () => {
      serverService.getMlHealth.mockResolvedValue({ smartSearchHealthy: false });
      const { body } = await request(ctx.getHttpServer()).get('/server/ml-health');
      expect(body).toEqual({ smartSearchHealthy: false });
    });
  });
});
