import { LibraryManifestController } from 'src/controllers/library-manifest.controller';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { LibraryManifestService } from 'src/services/library-manifest.service';
import request from 'supertest';
import { automock, ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

describe(LibraryManifestController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(LibraryManifestService);

  beforeAll(async () => {
    ctx = await controllerSetup(LibraryManifestController, [
      { provide: LoggingRepository, useValue: automock(LoggingRepository, { strict: false }) },
      { provide: LibraryManifestService, useValue: service },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /admin/users/:id/library-manifest', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get(
        `/admin/users/${'a'.repeat(8)}-0000-4000-8000-000000000000/library-manifest`,
      );
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should reject a non-uuid :id with 400', async () => {
      const { status } = await request(ctx.getHttpServer()).get('/admin/users/not-a-uuid/library-manifest');
      expect(status).toBe(400);
    });

    it('rejects an invalid cursor with 400', async () => {
      const { status } = await request(ctx.getHttpServer()).get(
        `/admin/users/aaaaaaaa-0000-4000-8000-000000000000/library-manifest?cursor=not-a-uuid`,
      );
      expect(status).toBe(400);
    });

    it('accepts a valid cursor and forwards it to the service', async () => {
      const id = 'aaaaaaaa-0000-4000-8000-000000000000';
      const cursor = 'bbbbbbbb-0000-4000-8000-000000000000';
      service.getManifest.mockResolvedValue({
        manifestSchemaVersion: 1,
        generatedAt: new Date().toISOString(),
        owner: { id, email: 'admin@immich.cloud' },
        albums: [],
        assets: [],
        nextCursor: null,
      });

      const { status } = await request(ctx.getHttpServer()).get(`/admin/users/${id}/library-manifest?cursor=${cursor}`);

      expect(status).toBe(200);
      const [, calledId, calledCursor] = service.getManifest.mock.calls[0];
      expect(calledId).toBe(id);
      expect(calledCursor).toBe(cursor);
    });
  });
});
