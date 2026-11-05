import request from 'supertest';
import { AlbumController } from 'src/controllers/album.controller.js';
import { controllers } from 'src/controllers/index.js';
import { GalleryAlbumController } from 'src/gallery/controllers/gallery-album.controller.js';
import { GalleryAlbumService } from 'src/gallery/services/gallery-album.service.js';
import { AlbumService } from 'src/services/album.service.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(GalleryAlbumController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(GalleryAlbumService);

  beforeAll(async () => {
    ctx = await controllerSetup(GalleryAlbumController, [
      { provide: GalleryAlbumService, useValue: service },
      { provide: AlbumService, useValue: mockBaseService(AlbumService) },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  it('is mounted before AlbumController so its literal routes win over /albums/:id', () => {
    expect(controllers.indexOf(GalleryAlbumController)).toBeLessThan(controllers.indexOf(AlbumController));
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

  describe('GET /albums/:id/stacks/:stackId', () => {
    const albumId = '00000000-0000-4000-8000-000000000001';
    const stackId = '00000000-0000-4000-8000-000000000002';

    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get(`/albums/${albumId}/stacks/${stackId}`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should reject an invalid stack id', async () => {
      const { status } = await request(ctx.getHttpServer()).get(`/albums/${albumId}/stacks/invalid`);
      expect(status).toEqual(400);
      expect(service.getStack).not.toHaveBeenCalled();
    });

    it('should pass the album and stack ids', async () => {
      service.getStack.mockResolvedValue({ id: stackId, primaryAssetId: stackId, assets: [] });
      const { status } = await request(ctx.getHttpServer()).get(`/albums/${albumId}/stacks/${stackId}`);
      expect(status).toEqual(200);
      expect(service.getStack).toHaveBeenCalledWith(undefined, albumId, stackId);
    });
  });
});
