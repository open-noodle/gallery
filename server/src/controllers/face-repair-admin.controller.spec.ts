import { FaceRepairAdminController } from 'src/controllers/face-repair-admin.controller';
import { FaceRepairService } from 'src/services/face-repair.service';
import request from 'supertest';
import { factory } from 'test/small.factory';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

describe(FaceRepairAdminController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(FaceRepairService);

  beforeAll(async () => {
    ctx = await controllerSetup(FaceRepairAdminController, [{ provide: FaceRepairService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('POST /admin/face-repair', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/admin/face-repair');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should call runRepair with dryRun: true by default', async () => {
      const result = {
        dryRun: true,
        mutated: false,
        report: {
          totals: {
            eligibleFaces: 0,
            flaggedFaces: 0,
            toRepair: 0,
            reviewOnlyFaces: 0,
            reviewOnlyPersons: 0,
            affectedPersons: 0,
            reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
          },
          persons: [],
        },
      };
      service.runRepair.mockResolvedValue(result);

      const { status, body } = await request(ctx.getHttpServer())
        .post('/admin/face-repair')
        .set('Authorization', 'Bearer token')
        .send({});
      expect(status).toBe(201);
      expect(service.runRepair).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
      expect(body).toMatchObject({ dryRun: true, mutated: false });
    });

    it('should reject maxFlaggedFraction > 1 with a 400', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/admin/face-repair')
        .set('Authorization', 'Bearer token')
        .send({ maxFlaggedFraction: 2 });
      expect(status).toBe(400);
      expect(body).toEqual(
        factory.responses.validationError([
          { path: ['maxFlaggedFraction'], message: 'Too big: expected number to be <=1' },
        ]),
      );
      expect(service.runRepair).not.toHaveBeenCalled();
    });

    const invalidCases: Array<[string, Record<string, unknown>]> = [
      ['maxDistance: 0', { maxDistance: 0 }],
      ['maxDistance: 3', { maxDistance: 3 }],
      ['voteMargin: -1', { voteMargin: -1 }],
      ['minFaces: 0', { minFaces: 0 }],
      ['maxAttributionDistance: 0', { maxAttributionDistance: 0 }],
      ['maxAttributionDistance: 3', { maxAttributionDistance: 3 }],
    ];

    for (const [label, body] of invalidCases) {
      it(`should reject invalid param ${label} with a 400`, async () => {
        const { status } = await request(ctx.getHttpServer())
          .post('/admin/face-repair')
          .set('Authorization', 'Bearer token')
          .send(body);
        expect(status).toBe(400);
        expect(service.runRepair).not.toHaveBeenCalled();
      });
    }

    it('should pass through explicit params to service.runRepair', async () => {
      const result = {
        dryRun: false,
        mutated: true,
        executed: { unassigned: 3, requeued: 3 },
        report: {
          totals: {
            eligibleFaces: 50,
            flaggedFaces: 3,
            toRepair: 3,
            reviewOnlyFaces: 0,
            reviewOnlyPersons: 0,
            affectedPersons: 1,
            reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
          },
          persons: [],
        },
      };
      service.runRepair.mockResolvedValue(result);

      const ownerId = '00000000-0000-4000-a000-000000000001';
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair')
        .set('Authorization', 'Bearer token')
        .send({ dryRun: false, ownerId, maxDistance: 0.4, voteMargin: 3 });
      expect(status).toBe(201);
      expect(service.runRepair).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: false, ownerId, maxDistance: 0.4, voteMargin: 3 }),
      );
    });
  });
});
