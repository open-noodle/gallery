import request from 'supertest';
import { CleanupController } from 'src/controllers/cleanup.controller.js';
import { Permission } from 'src/enum.js';
import { CleanupService } from 'src/services/cleanup.service.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(CleanupController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(CleanupService);

  beforeAll(async () => {
    ctx = await controllerSetup(CleanupController, [{ provide: CleanupService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  it.each([
    ['/cleanup/rewind/230'],
    ['/cleanup/rewind/431'],
    ['/cleanup/rewind/0'],
    ['/cleanup/rewind/1301'],
    ['/cleanup/rewind/abc'],
  ])('rejects an invalid monthDay %s', async (url) => {
    const { status } = await request(ctx.getHttpServer()).get(url);
    expect(status).toBe(400);
  });

  it('accepts 229', async () => {
    service.getRewindYears.mockResolvedValue({ years: [] });
    const { status } = await request(ctx.getHttpServer()).get('/cleanup/rewind/229');
    expect(status).toBe(200);
  });

  it('rejects an invalid tz', async () => {
    const { status } = await request(ctx.getHttpServer()).get('/cleanup/calendar?tz=Mars%2FOlympus');
    expect(status).toBe(400);
  });

  it('rejects an unknown queue', async () => {
    const { status } = await request(ctx.getHttpServer()).get('/cleanup/queues/rewind');
    expect(status).toBe(400);
  });

  it('rejects more than 1000 ids in commit', async () => {
    const ids = Array.from({ length: 1001 }, () => crypto.randomUUID());
    const { status } = await request(ctx.getHttpServer())
      .post('/cleanup/commit')
      .send({ queue: 'rewind', trashIds: ids });
    expect(status).toBe(400);
  });

  it('rejects a non-uuid id in commit', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post('/cleanup/commit')
      .send({ queue: 'rewind', trashIds: ['x'] });
    expect(status).toBe(400);
  });

  it('rejects limit above 500', async () => {
    const { status } = await request(ctx.getHttpServer()).get('/cleanup/queues/blurry?limit=501');
    expect(status).toBe(400);
  });

  it('routes count before list', async () => {
    service.getQueueCount.mockResolvedValue({ count: 0, bytes: 0 });
    const { status } = await request(ctx.getHttpServer()).get('/cleanup/queues/duplicates/count');
    expect(status).toBe(200);
    expect(service.getQueueCount).toHaveBeenCalled();
  });

  describe('permissions', () => {
    it('GET /cleanup/queues/:queue/count requires cleanup read permission', async () => {
      await request(ctx.getHttpServer()).get('/cleanup/queues/duplicates/count');

      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.CleanupRead }),
        }),
      );
    });

    it('GET /cleanup/trash requires cleanup read permission', async () => {
      await request(ctx.getHttpServer()).get('/cleanup/trash');

      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.CleanupRead }),
        }),
      );
    });

    it('GET /cleanup/calendar requires cleanup read permission', async () => {
      await request(ctx.getHttpServer()).get('/cleanup/calendar?tz=UTC');

      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.CleanupRead }),
        }),
      );
    });

    it('GET /cleanup/rewind/:monthDay requires cleanup read permission', async () => {
      await request(ctx.getHttpServer()).get('/cleanup/rewind/229');

      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.CleanupRead }),
        }),
      );
    });

    it('GET /cleanup/rewind/:monthDay/:year requires cleanup read permission', async () => {
      await request(ctx.getHttpServer()).get('/cleanup/rewind/229/2020');

      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.CleanupRead }),
        }),
      );
    });

    it('GET /cleanup/queues/:queue requires cleanup read permission', async () => {
      await request(ctx.getHttpServer()).get('/cleanup/queues/blurry');

      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.CleanupRead }),
        }),
      );
    });

    it('POST /cleanup/commit requires cleanup update permission', async () => {
      await request(ctx.getHttpServer()).post('/cleanup/commit').send({ queue: 'rewind' });

      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.CleanupUpdate }),
        }),
      );
    });

    it('DELETE /cleanup/decisions requires cleanup update permission', async () => {
      await request(ctx.getHttpServer())
        .delete('/cleanup/decisions')
        .send({ queue: 'rewind', assetIds: [factory.uuid()] });

      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.CleanupUpdate }),
        }),
      );
    });

    it('POST /cleanup/in-spaces requires cleanup read permission', async () => {
      await request(ctx.getHttpServer())
        .post('/cleanup/in-spaces')
        .send({ assetIds: [factory.uuid()] });

      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.CleanupRead }),
        }),
      );
    });
  });
});
