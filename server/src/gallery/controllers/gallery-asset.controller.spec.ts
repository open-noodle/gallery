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
});
