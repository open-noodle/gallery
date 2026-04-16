import { ServerController } from 'src/controllers/server.controller';
import { ServerService } from 'src/services/server.service';
import { SystemMetadataService } from 'src/services/system-metadata.service';
import { VersionService } from 'src/services/version.service';
import request from 'supertest';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

// Upstream #30715 deleted this spec because its only content was per-route
// `should be an authenticated route` assertions, which `index.spec.ts` now covers
// reflectively for every route. It is kept here for the fork-only
// `GET /server/ml-health` endpoint (the cmdk palette's ML health indicator),
// whose behavioural coverage has no upstream equivalent.
describe(ServerController.name, () => {
  let ctx: ControllerContext;
  const serverService = mockBaseService(ServerService);
  const systemMetadataService = mockBaseService(SystemMetadataService);
  const versionService = mockBaseService(VersionService);

  beforeAll(async () => {
    ctx = await controllerSetup(ServerController, [
      { provide: ServerService, useValue: serverService },
      { provide: SystemMetadataService, useValue: systemMetadataService },
      { provide: VersionService, useValue: versionService },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    serverService.resetAllMocks();
    versionService.resetAllMocks();
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
