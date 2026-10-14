import request from 'supertest';
import { AssetController } from 'src/controllers/asset.controller.js';
import { controllers } from 'src/controllers/index.js';
import { GalleryAssetController } from 'src/gallery/controllers/gallery-asset.controller.js';
import { GalleryAssetService } from 'src/gallery/services/gallery-asset.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(GalleryAssetController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(GalleryAssetService);

  beforeAll(async () => {
    ctx = await controllerSetup(GalleryAssetController, [{ provide: GalleryAssetService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  it('is mounted before AssetController so PUT /assets/favorites wins over PUT /assets/:id', () => {
    expect(controllers.indexOf(GalleryAssetController)).toBeLessThan(controllers.indexOf(AssetController));
  });

  describe('PUT /assets/favorites', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).put('/assets/favorites');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should set favorites for the caller', async () => {
      const ids = [factory.uuid()];
      const { status } = await request(ctx.getHttpServer()).put('/assets/favorites').send({ ids, isFavorite: true });
      expect(status).toBe(204);
      expect(service.updateFavorites).toHaveBeenCalledWith(undefined, { ids, isFavorite: true });
    });
  });

  describe('POST /assets/editable', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/assets/editable');
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });

  describe('PUT /assets/:id/trim', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).put(`/assets/${factory.uuid()}/trim`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should require a valid id', async () => {
      const { status } = await request(ctx.getHttpServer()).put('/assets/123/trim').send({ startTime: 1, endTime: 2 });
      expect(status).toBe(400);
    });

    it('should reject an end time that is not after the start time', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put(`/assets/${factory.uuid()}/trim`)
        .send({ startTime: 2, endTime: 2 });
      expect(status).toBe(400);
      expect(JSON.stringify(body)).toContain('endTime must be greater than startTime');
      expect(service.setTrim).not.toHaveBeenCalled();
    });

    it('should trim the video', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer())
        .put(`/assets/${id}/trim`)
        .send({ startTime: 1.5, endTime: 3 });
      expect(status).toBe(200);
      expect(service.setTrim).toHaveBeenCalledWith(undefined, id, { startTime: 1.5, endTime: 3 });
    });
  });

  describe('GET /assets/:id/trim', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get(`/assets/${factory.uuid()}/trim`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });
  });

  describe('DELETE /assets/:id/trim', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).delete(`/assets/${factory.uuid()}/trim`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should remove the trim', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).delete(`/assets/${id}/trim`);
      expect(status).toBe(204);
      expect(service.removeTrim).toHaveBeenCalledWith(undefined, id);
    });
  });
});
