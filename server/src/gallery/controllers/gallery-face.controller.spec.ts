import request from 'supertest';
import { FaceController } from 'src/controllers/face.controller.js';
import { controllers } from 'src/controllers/index.js';
import { Permission } from 'src/enum.js';
import { GalleryFaceController } from 'src/gallery/controllers/gallery-face.controller.js';
import { VideoFaceService } from 'src/gallery/services/video-face.service.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { ControllerContext, automock, controllerSetup, mockBaseService } from 'test/utils.js';

describe(GalleryFaceController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(VideoFaceService);

  beforeAll(async () => {
    ctx = await controllerSetup(GalleryFaceController, [
      { provide: VideoFaceService, useValue: service },
      { provide: LoggingRepository, useValue: automock(LoggingRepository, { strict: false }) },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  it('is mounted before FaceController', () => {
    expect(controllers.indexOf(GalleryFaceController)).toBeLessThan(controllers.indexOf(FaceController));
  });

  describe('GET /faces/:id/thumbnail', () => {
    it('should be an authenticated route with the face read permission', async () => {
      await request(ctx.getHttpServer()).get('/faces/123e4567-e89b-12d3-a456-426614174000/thumbnail');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ permission: Permission.FaceRead }) }),
      );
    });

    it('should require a UUID', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/faces/not-a-uuid/thumbnail')
        .set('Authorization', 'Bearer token');

      expect(status).toBe(400);
      expect(service.getFaceThumbnail).not.toHaveBeenCalled();
    });
  });
});
