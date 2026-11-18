import { ForbiddenException } from '@nestjs/common';
import request from 'supertest';
import { JobController } from 'src/controllers/job.controller.js';
import { ManualJobName, Permission } from 'src/enum.js';
import { JobService } from 'src/services/job.service.js';
import { QueueService } from 'src/services/queue.service.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

// Undoing asset versions is started through Immich's own "create a job" route, so who may start it is that route's
// gate: an administrator. This goes through the real route and its guard: the undo's name is accepted, the guard is
// asked for an admin, and a caller the guard turns away starts nothing. (Whether versions are on is the job's own
// check, tested with the job: asset-version.service.spec.ts, "undoing versions".)
describe('POST /jobs: undoing asset versions', () => {
  let ctx: ControllerContext;
  const service = mockBaseService(JobService);
  const queueService = mockBaseService(QueueService);

  beforeAll(async () => {
    ctx = await controllerSetup(JobController, [
      { provide: JobService, useValue: service },
      { provide: QueueService, useValue: queueService },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    queueService.resetAllMocks();
    ctx.reset();
  });

  const undo = () => request(ctx.getHttpServer()).post('/jobs').send({ name: ManualJobName.AssetVersionUndo });

  it('is an administrator’s route, and starts the undo for one', async () => {
    const { status } = await undo();

    expect(status).toBe(204);
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ adminRoute: true, permission: Permission.JobCreate }),
      }),
    );
    expect(service.create).toHaveBeenCalledWith({ name: ManualJobName.AssetVersionUndo });
  });

  it('starts nothing for a caller the guard turns away (anyone who is not an administrator)', async () => {
    ctx.authenticate.mockRejectedValue(new ForbiddenException('Forbidden'));

    const { status } = await undo();

    expect(status).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('refuses a job name it does not know', async () => {
    const { status } = await request(ctx.getHttpServer()).post('/jobs').send({ name: 'asset-version-redo' });

    expect(status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });
});
