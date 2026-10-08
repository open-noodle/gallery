import request from 'supertest';
import { AlbumController } from 'src/controllers/album.controller.js';
import { AlbumService } from 'src/services/album.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(AlbumController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(AlbumService);

  beforeAll(async () => {
    ctx = await controllerSetup(AlbumController, [{ provide: AlbumService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /albums', () => {
    it('should reject an invalid shared param', async () => {
      const { status, body } = await request(ctx.getHttpServer()).get('/albums?isShared=invalid');
      expect(status).toEqual(400);
      expect(body).toEqual(
        factory.responses.validationError([
          { path: ['isShared'], message: 'Invalid option: expected one of "true"|"false"' },
        ]),
      );
    });

    it('should reject an invalid assetId param', async () => {
      const { status, body } = await request(ctx.getHttpServer()).get('/albums?assetId=invalid');
      expect(status).toEqual(400);
      expect(body).toEqual(factory.responses.validationError([{ path: ['assetId'], message: 'Invalid UUID' }]));
    });
  });

  describe('POST /albums/add-targets', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/albums/add-targets').send({ albumIds: [], assetIds: [] });
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should reject an invalid asset id', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/albums/add-targets')
        .send({ albumIds: [], assetIds: ['invalid'] });
      expect(status).toEqual(400);
    });

    it('should answer 200, not 201', async () => {
      service.getAddTargets.mockResolvedValue({ albums: [], shareableAssetCount: 0 });
      const { status, body } = await request(ctx.getHttpServer())
        .post('/albums/add-targets')
        .send({ albumIds: [], assetIds: [] });
      expect(status).toEqual(200);
      expect(body).toEqual({ albums: [], shareableAssetCount: 0 });
    });
  });
});
