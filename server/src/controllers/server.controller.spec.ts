import request from 'supertest';
import { immichVersion } from 'src/constants.js';
import { ServerController } from 'src/controllers/server.controller.js';
import { ServerService } from 'src/services/server.service.js';
import { SystemMetadataService } from 'src/services/system-metadata.service.js';
import { VersionService } from 'src/services/version.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

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
    systemMetadataService.resetAllMocks();
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

  describe('GET /server/version', () => {
    it('passes the client headers to the service and varies the response on them', async () => {
      versionService.getVersion.mockReturnValue({ major: 3, minor: 3, patch: 1, prerelease: null });
      const { status, headers } = await request(ctx.getHttpServer())
        .get('/server/version')
        .set('User-Agent', 'immich-android/3.3.1');
      expect(status).toBe(200);
      expect(headers.vary).toContain('User-Agent, X-Gallery-App');
      expect(versionService.getVersion).toHaveBeenCalledWith(
        expect.objectContaining({ 'user-agent': 'immich-android/3.3.1' }),
      );
    });
  });

  // OD-15: a stock client compares these with the Immich base GET /server/version reports.
  describe('stock clients', () => {
    const stock = { ...factory.auth(), stockClient: true as const };

    it('should report the Immich base on GET /server/about', async () => {
      ctx.authenticate.mockResolvedValue(stock);
      serverService.getAboutInfo.mockResolvedValue({
        version: 'v5.4.0',
        versionUrl: 'https://github.com/open-noodle/gallery/releases/tag/v5.4.0',
        licensed: false,
      });

      const { body } = await request(ctx.getHttpServer()).get('/server/about');

      expect(body).toMatchObject({
        version: `v${immichVersion}`,
        versionUrl: `https://github.com/immich-app/immich/releases/tag/v${immichVersion}`,
      });
    });

    it('should never report a Gallery release on GET /server/version-check', async () => {
      ctx.authenticate.mockResolvedValue(stock);
      systemMetadataService.getVersionCheckState.mockResolvedValue({ checkedAt: 'now', releaseVersion: 'v5.5.0' });

      const { body } = await request(ctx.getHttpServer()).get('/server/version-check');

      expect(body).toEqual({ checkedAt: 'now', releaseVersion: `v${immichVersion}` });
    });

    it('should leave both unchanged for a Gallery client', async () => {
      ctx.authenticate.mockResolvedValue(factory.auth());
      systemMetadataService.getVersionCheckState.mockResolvedValue({ checkedAt: 'now', releaseVersion: 'v5.5.0' });

      const { body } = await request(ctx.getHttpServer()).get('/server/version-check');

      expect(body).toEqual({ checkedAt: 'now', releaseVersion: 'v5.5.0' });
    });
  });
});
