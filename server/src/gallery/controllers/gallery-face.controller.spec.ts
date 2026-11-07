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

  describe('GET /faces/:id/sightings', () => {
    it('should be an authenticated route with the face read permission', async () => {
      await request(ctx.getHttpServer()).get('/faces/123e4567-e89b-12d3-a456-426614174000/sightings');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ permission: Permission.FaceRead }) }),
      );
    });

    it('should require a UUID', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/faces/not-a-uuid/sightings')
        .set('Authorization', 'Bearer token');

      expect(status).toBe(400);
      expect(service.getSightings).not.toHaveBeenCalled();
    });
  });

  describe('GET /faces/:id/sightings/thumbnail', () => {
    const url = '/faces/123e4567-e89b-12d3-a456-426614174000/sightings/thumbnail';

    it('should be an authenticated route with the face read permission', async () => {
      await request(ctx.getHttpServer()).get(`${url}?time=1.5`);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ permission: Permission.FaceRead }) }),
      );
    });

    it('should require a UUID', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/faces/not-a-uuid/sightings/thumbnail?time=1.5')
        .set('Authorization', 'Bearer token');

      expect(status).toBe(400);
      expect(service.getSightingThumbnail).not.toHaveBeenCalled();
    });

    it.each(['', '?time=', '?time=-1', '?time=abc'])('should reject a missing or invalid time (%s)', async (query) => {
      const { status } = await request(ctx.getHttpServer()).get(`${url}${query}`).set('Authorization', 'Bearer token');

      expect(status).toBe(400);
      expect(service.getSightingThumbnail).not.toHaveBeenCalled();
    });
  });

  describe.each([
    { method: 'delete', path: '', call: 'removeSighting' },
    { method: 'post', path: '/restore', call: 'restoreSighting' },
    { method: 'post', path: '/split', call: 'splitSighting' },
  ] as const)('$method /faces/:id/sightings$path', ({ method, path, call }) => {
    const url = `/faces/6d3c2a1e-0f4b-4c8d-9e7a-1b2c3d4e5f60/sightings${path}`;

    it('should be an authenticated route with the face delete permission', async () => {
      await request(ctx.getHttpServer())[method](`${url}?time=1.5`);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ permission: Permission.FaceDelete }) }),
      );
    });

    it('should pass the face and the time to the service', async () => {
      service[call].mockResolvedValue({ faceId: '6d3c2a1e-0f4b-4c8d-9e7a-1b2c3d4e5f61', sightings: [] });
      const { status, body } = await request(ctx.getHttpServer())
        [method](`${url}?time=1.5`)
        .set('Authorization', 'Bearer token');

      expect(body).toMatchObject({ sightings: [] });
      expect(status).toBe(200);
      expect(service[call]).toHaveBeenCalledWith(undefined, '6d3c2a1e-0f4b-4c8d-9e7a-1b2c3d4e5f60', 1.5);
    });

    it('should require a UUID', async () => {
      const { status } = await request(ctx.getHttpServer())
        [method](`/faces/not-a-uuid/sightings${path}?time=1.5`)
        .set('Authorization', 'Bearer token');

      expect(status).toBe(400);
      expect(service[call]).not.toHaveBeenCalled();
    });

    it.each(['', '?time=-1', '?time=abc'])('should reject a missing or invalid time (%s)', async (query) => {
      const { status } = await request(ctx.getHttpServer())
        [method](`${url}${query}`)
        .set('Authorization', 'Bearer token');

      expect(status).toBe(400);
      expect(service[call]).not.toHaveBeenCalled();
    });
  });
});
