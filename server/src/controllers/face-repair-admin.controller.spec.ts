import { ForbiddenException } from '@nestjs/common';
import { FaceRepairAdminController } from 'src/controllers/face-repair-admin.controller';
import { CacheControl } from 'src/enum';
import { FaceRepairService } from 'src/services/face-repair.service';
import { ImmichRedirectResponse } from 'src/utils/file';
import request from 'supertest';
import { errorDto } from 'test/medium/responses';
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
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
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
        executed: { moved: 3, skipped: 0, movedFaceIds: [] },
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

  describe('POST /admin/face-repair/scan', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/admin/face-repair/scan');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('delegates a no-body scan (quick path) with undefined params', async () => {
      ctx.authenticate.mockResolvedValue({ user: { id: '00000000-0000-4000-a000-000000000001' } });
      service.triggerScan.mockResolvedValue({ scanId: 's1' });
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/scan')
        .set('Authorization', 'Bearer token')
        .send({});
      expect(status).toBe(201);
      expect(service.triggerScan).toHaveBeenCalledWith(expect.any(String), undefined);
    });

    it('delegates tuned params to the service', async () => {
      ctx.authenticate.mockResolvedValue({ user: { id: '00000000-0000-4000-a000-000000000001' } });
      service.triggerScan.mockResolvedValue({ scanId: 's2' });
      const params = { maxDistance: 0.4, minFaces: 5, maxFlaggedFraction: 0.3 };
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/scan')
        .set('Authorization', 'Bearer token')
        .send({ params });
      expect(status).toBe(201);
      expect(service.triggerScan).toHaveBeenCalledWith(expect.any(String), params);
    });

    it('rejects out-of-range params with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/scan')
        .set('Authorization', 'Bearer token')
        .send({ params: { maxDistance: 9 } });
      expect(status).toBe(400);
      expect(service.triggerScan).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/face-repair/scan/defaults', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/admin/face-repair/scan/defaults');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('delegates to service.getScanDefaults', async () => {
      service.getScanDefaults.mockResolvedValue({ maxDistance: 0.5, minFaces: 3, maxFlaggedFraction: 0.5 });
      const { status, body } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/scan/defaults')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(200);
      expect(body).toMatchObject({ maxDistance: 0.5, minFaces: 3, maxFlaggedFraction: 0.5 });
    });
  });

  describe('POST /admin/face-repair/decline', () => {
    const uuid1 = '00000000-0000-4000-a000-000000000001';
    const uuid2 = '00000000-0000-4000-a000-000000000002';
    const adminUserId = '00000000-0000-4000-a000-000000000099';

    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/admin/face-repair/decline');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('should delegate to service.createDeclines with auth user id', async () => {
      ctx.authenticate.mockResolvedValue({ user: { id: adminUserId } });
      service.createDeclines.mockResolvedValue({ created: 1 });
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/decline')
        .set('Authorization', 'Bearer token')
        .send({ faces: [{ assetFaceId: uuid1, suspectedOwnerId: uuid2 }] });
      expect(status).toBe(201);
      expect(service.createDeclines).toHaveBeenCalledWith(
        expect.objectContaining({ faces: [{ assetFaceId: uuid1, suspectedOwnerId: uuid2 }], declinedBy: adminUserId }),
      );
    });

    it('should reject a non-uuid assetFaceId with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/decline')
        .set('Authorization', 'Bearer token')
        .send({ faces: [{ assetFaceId: 'not-a-uuid', suspectedOwnerId: uuid2 }] });
      expect(status).toBe(400);
      expect(service.createDeclines).not.toHaveBeenCalled();
    });

    // Temporal-consistency hardening, Slice 2 (C2, E11): dismiss (a persons-payload decline) delegates to
    // service.createDeclines exactly like a faces-payload decline — the drain of the latest scan snapshot is
    // an internal service concern covered at the service layer by the medium M9 test; this controller test
    // only mocks the service, so it can assert delegation, not the drain itself.
    it('should delegate a persons-payload dismiss to service.createDeclines with auth user id', async () => {
      ctx.authenticate.mockResolvedValue({ user: { id: adminUserId } });
      service.createDeclines.mockResolvedValue({ created: 1 });
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/decline')
        .set('Authorization', 'Bearer token')
        .send({ persons: [{ personId: uuid1, suspectedOwnerIds: [uuid2] }] });
      expect(status).toBe(201);
      expect(service.createDeclines).toHaveBeenCalledWith(
        expect.objectContaining({
          persons: [{ personId: uuid1, suspectedOwnerIds: [uuid2] }],
          declinedBy: adminUserId,
        }),
      );
    });
  });

  describe('GET /admin/face-repair/decline', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/admin/face-repair/decline');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('should delegate to service.listDeclines', async () => {
      service.listDeclines.mockResolvedValue({ declines: [] });
      const { status, body } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/decline')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(200);
      expect(service.listDeclines).toHaveBeenCalled();
      expect(body).toMatchObject({ declines: [] });
    });
  });

  describe('POST /admin/face-repair/scan/person/:personId/cluster-faces', () => {
    const personId = '00000000-0000-4000-a000-000000000010';
    const faceId = '00000000-0000-4000-a000-000000000011';

    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post(`/admin/face-repair/scan/person/${personId}/cluster-faces`);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('delegates to service.getClusterFaces and returns the page', async () => {
      // #1061: getClusterFaces now carries photo context alongside each face id — this test is about the
      // HTTP delegation, not the context, so the values here are arbitrary.
      service.getClusterFaces.mockResolvedValue({
        faces: [
          {
            assetFaceId: faceId,
            localDateTime: new Date('2019-07-04T10:30:00.000Z'),
            boundingBoxX1: 10,
            boundingBoxY1: 20,
            boundingBoxX2: 30,
            boundingBoxY2: 40,
            imageWidth: 400,
            imageHeight: 300,
          },
        ],
        total: 1,
        hasMore: false,
      });
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/admin/face-repair/scan/person/${personId}/cluster-faces`)
        .set('Authorization', 'Bearer token')
        .send({ excludeFaceIds: [faceId], page: 0, size: 50 });
      expect(status).toBe(201);
      expect(service.getClusterFaces).toHaveBeenCalledWith(personId, {
        excludeFaceIds: [faceId],
        page: 0,
        size: 50,
      });
      expect(body).toMatchObject({ faces: [{ assetFaceId: faceId }], total: 1, hasMore: false });
    });

    it('rejects size out of range with 400 (E14)', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/admin/face-repair/scan/person/${personId}/cluster-faces`)
        .set('Authorization', 'Bearer token')
        .send({ page: 0, size: 0 });
      expect(status).toBe(400);
      expect(service.getClusterFaces).not.toHaveBeenCalled();
    });

    it('rejects a negative page with 400 (E14)', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/admin/face-repair/scan/person/${personId}/cluster-faces`)
        .set('Authorization', 'Bearer token')
        .send({ page: -1, size: 50 });
      expect(status).toBe(400);
      expect(service.getClusterFaces).not.toHaveBeenCalled();
    });

    it('rejects a non-uuid personId with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/scan/person/not-a-uuid/cluster-faces')
        .set('Authorization', 'Bearer token')
        .send({ page: 0, size: 50 });
      expect(status).toBe(400);
      expect(service.getClusterFaces).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/face-repair/scan/latest', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/admin/face-repair/scan/latest');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('answers 204 when the instance has never scanned', async () => {
      // Not 200-with-an-empty-body: that has no content-type, and the SDK's `jsonOnly` guard
      // (immich-31006) rejects it as malformed, which surfaced as a load error in the console.
      service.getLatestScanStatus.mockResolvedValue(null);
      const { status, text } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/scan/latest')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(204);
      expect(text).toBe('');
      expect(service.getLatestScanStatus).toHaveBeenCalled();
    });

    it('answers 200 with a JSON body once a scan exists', async () => {
      service.getLatestScanStatus.mockResolvedValue({ id: 'scan-1', status: 'completed' } as never);
      const { status, body, headers } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/scan/latest')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(200);
      expect(headers['content-type']).toContain('json');
      expect(body).toMatchObject({ id: 'scan-1', status: 'completed' });
      expect(service.getLatestScanStatus).toHaveBeenCalled();
    });
  });

  describe('GET /admin/face-repair/scan/person/:personId', () => {
    const personId = '00000000-0000-4000-a000-000000000010';

    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get(`/admin/face-repair/scan/person/${personId}`);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('delegates to service.getPersonFlaggedFaces', async () => {
      service.getPersonFlaggedFaces.mockResolvedValue({ personId, flaggedFaces: [] });
      const { status, body } = await request(ctx.getHttpServer())
        .get(`/admin/face-repair/scan/person/${personId}`)
        .set('Authorization', 'Bearer token');
      expect(status).toBe(200);
      expect(service.getPersonFlaggedFaces).toHaveBeenCalledWith(personId);
      expect(body).toMatchObject({ personId, flaggedFaces: [] });
    });

    it('rejects a non-uuid personId with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/scan/person/not-a-uuid')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(400);
      expect(service.getPersonFlaggedFaces).not.toHaveBeenCalled();
    });
  });

  // Slice 3 of manual face review (spec specs/2026-07-23-manual-face-review-mode-design.md): the manual
  // review page has no scan to read personName/ownerId off, so it needs a dedicated admin-gated lookup.
  describe('GET /admin/face-repair/person/:personId', () => {
    const personId = '00000000-0000-4000-a000-000000000050';

    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get(`/admin/face-repair/person/${personId}`);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('is admin-only', async () => {
      ctx.authenticate.mockRejectedValue(new ForbiddenException('Forbidden'));
      const { status } = await request(ctx.getHttpServer())
        .get(`/admin/face-repair/person/${personId}`)
        .set('Authorization', 'Bearer token');
      expect(status).toBe(403);
      expect(service.getPersonMetadata).not.toHaveBeenCalled();
    });

    it('validates the personId is a uuid', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/person/not-a-uuid')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(400);
      expect(service.getPersonMetadata).not.toHaveBeenCalled();
    });

    it('returns the service result', async () => {
      const metadata = {
        id: personId,
        name: 'Alice',
        ownerId: '00000000-0000-4000-a000-000000000051',
        faceCount: 4,
        thumbnailFaceId: '00000000-0000-4000-a000-000000000052',
      };
      service.getPersonMetadata.mockResolvedValue(metadata);
      const { status, body } = await request(ctx.getHttpServer())
        .get(`/admin/face-repair/person/${personId}`)
        .set('Authorization', 'Bearer token');
      expect(status).toBe(200);
      expect(service.getPersonMetadata).toHaveBeenCalledWith(personId);
      expect(body).toEqual(metadata);
    });
  });

  describe('POST /admin/face-repair/resolve', () => {
    const personId = '00000000-0000-4000-a000-000000000030';
    const ownerA = '00000000-0000-4000-a000-000000000031';
    const ownerB = '00000000-0000-4000-a000-000000000032';
    const faceId1 = '00000000-0000-4000-a000-000000000033';
    const faceId2 = '00000000-0000-4000-a000-000000000034';
    const faceId3 = '00000000-0000-4000-a000-000000000035';
    const adminUserId = '00000000-0000-4000-a000-000000000099';

    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/admin/face-repair/resolve');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('is admin-only: a non-admin caller gets 403 (C1)', async () => {
      ctx.authenticate.mockRejectedValue(new ForbiddenException('Forbidden'));
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolve')
        .set('Authorization', 'Bearer token')
        .send({ personId, moveToPerson: [] });
      expect(status).toBe(403);
      expect(service.resolveFaces).not.toHaveBeenCalled();
    });

    it('delegates to service.resolveFaces with the auth user id as resolvedBy (C2)', async () => {
      ctx.authenticate.mockResolvedValue({ user: { id: adminUserId } });
      service.resolveFaces.mockResolvedValue({ moved: 3, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });
      const moveToPerson = [
        { destinationPersonId: ownerA, faceIds: [faceId1, faceId2] },
        { destinationPersonId: ownerB, faceIds: [faceId3] },
      ];
      const { status, body } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolve')
        .set('Authorization', 'Bearer token')
        .send({ personId, moveToPerson });
      expect(status).toBe(201);
      expect(service.resolveFaces).toHaveBeenCalledWith(
        expect.objectContaining({
          personId,
          // Each group's `lock` (temporal-consistency hardening, Slice 3) defaults to false when omitted.
          moveToPerson: moveToPerson.map((group) => ({ ...group, lock: false })),
          stay: [],
          lock: [],
          detach: [],
        }),
        adminUserId,
      );
      expect(body).toEqual({ moved: 3, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });
    });

    it('rejects a non-uuid personId with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolve')
        .set('Authorization', 'Bearer token')
        .send({ personId: 'not-a-uuid' });
      expect(status).toBe(400);
      expect(service.resolveFaces).not.toHaveBeenCalled();
    });

    it('rejects a non-uuid faceId in a moveToPerson group with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolve')
        .set('Authorization', 'Bearer token')
        .send({ personId, moveToPerson: [{ destinationPersonId: ownerA, faceIds: ['not-a-uuid'] }] });
      expect(status).toBe(400);
      expect(service.resolveFaces).not.toHaveBeenCalled();
    });

    // ---- C1 (temporal-consistency hardening, Slice 3, move-and-lock): the resolve route's `lock` flag ----

    it('C1: accepts a moveToPerson group with lock:true and passes it through', async () => {
      ctx.authenticate.mockResolvedValue({ user: { id: adminUserId } });
      service.resolveFaces.mockResolvedValue({ moved: 1, declined: 0, locked: 1, detached: 0, unknown: 0, skipped: 0 });
      const moveToPerson = [{ destinationPersonId: ownerA, faceIds: [faceId1], lock: true }];

      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolve')
        .set('Authorization', 'Bearer token')
        .send({ personId, moveToPerson });

      expect(status).toBe(201);
      expect(service.resolveFaces).toHaveBeenCalledWith(
        expect.objectContaining({
          personId,
          moveToPerson: [{ destinationPersonId: ownerA, faceIds: [faceId1], lock: true }],
        }),
        adminUserId,
      );
    });

    it('C1: accepts a moveToPerson group with lock:false and passes it through', async () => {
      ctx.authenticate.mockResolvedValue({ user: { id: adminUserId } });
      service.resolveFaces.mockResolvedValue({ moved: 1, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });
      const moveToPerson = [{ destinationPersonId: ownerA, faceIds: [faceId1], lock: false }];

      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolve')
        .set('Authorization', 'Bearer token')
        .send({ personId, moveToPerson });

      expect(status).toBe(201);
      expect(service.resolveFaces).toHaveBeenCalledWith(
        expect.objectContaining({
          personId,
          moveToPerson: [{ destinationPersonId: ownerA, faceIds: [faceId1], lock: false }],
        }),
        adminUserId,
      );
    });

    it("C1: defaults a moveToPerson group's lock to false when omitted", async () => {
      ctx.authenticate.mockResolvedValue({ user: { id: adminUserId } });
      service.resolveFaces.mockResolvedValue({ moved: 1, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });
      const moveToPerson = [{ destinationPersonId: ownerA, faceIds: [faceId1] }];

      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolve')
        .set('Authorization', 'Bearer token')
        .send({ personId, moveToPerson });

      expect(status).toBe(201);
      expect(service.resolveFaces).toHaveBeenCalledWith(
        expect.objectContaining({
          personId,
          moveToPerson: [{ destinationPersonId: ownerA, faceIds: [faceId1], lock: false }],
        }),
        adminUserId,
      );
    });

    it('C1: rejects a non-boolean lock on a moveToPerson group with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolve')
        .set('Authorization', 'Bearer token')
        .send({ personId, moveToPerson: [{ destinationPersonId: ownerA, faceIds: [faceId1], lock: 'yes' }] });
      expect(status).toBe(400);
      expect(service.resolveFaces).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /admin/face-repair/decline', () => {
    const uuid1 = '00000000-0000-4000-a000-000000000001';

    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).delete('/admin/face-repair/decline');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('should delegate to service.removeDeclines (by id)', async () => {
      service.removeDeclines.mockResolvedValue({ removed: 1 });
      const { status } = await request(ctx.getHttpServer())
        .delete('/admin/face-repair/decline')
        .set('Authorization', 'Bearer token')
        .send({ ids: [uuid1] });
      expect(status).toBe(200);
      expect(service.removeDeclines).toHaveBeenCalledWith({ ids: [uuid1] });
    });

    it('should accept a v7 row id (face_repair_decline.id is uuid v7)', async () => {
      // Regression: z.uuidv4() rejected v7 ids → the declined-page Undo 400'd. z.uuid() must accept them.
      const uuidV7 = '01890000-0000-7000-8000-000000000001';
      service.removeDeclines.mockResolvedValue({ removed: 1 });
      const { status } = await request(ctx.getHttpServer())
        .delete('/admin/face-repair/decline')
        .set('Authorization', 'Bearer token')
        .send({ ids: [uuidV7] });
      expect(status).toBe(200);
      expect(service.removeDeclines).toHaveBeenCalledWith({ ids: [uuidV7] });
    });

    it('should delegate to service.removeDeclines (by face natural key)', async () => {
      const uuid2 = '00000000-0000-4000-a000-000000000002';
      service.removeDeclines.mockResolvedValue({ removed: 1 });
      const { status } = await request(ctx.getHttpServer())
        .delete('/admin/face-repair/decline')
        .set('Authorization', 'Bearer token')
        .send({ faces: [{ assetFaceId: uuid1, suspectedOwnerId: uuid2 }] });
      expect(status).toBe(200);
      expect(service.removeDeclines).toHaveBeenCalledWith({ faces: [{ assetFaceId: uuid1, suspectedOwnerId: uuid2 }] });
    });

    it('should reject empty ids array with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .delete('/admin/face-repair/decline')
        .set('Authorization', 'Bearer token')
        .send({ ids: [] });
      expect(status).toBe(400);
      expect(service.removeDeclines).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/face-repair/owner/:ownerId/people', () => {
    const ownerId = '00000000-0000-4000-a000-000000000040';

    it('should be an authenticated route (C3)', async () => {
      await request(ctx.getHttpServer()).get(`/admin/face-repair/owner/${ownerId}/people`);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('is admin-only: a non-admin caller gets 403 (C3)', async () => {
      ctx.authenticate.mockRejectedValue(new ForbiddenException('Forbidden'));
      const { status } = await request(ctx.getHttpServer())
        .get(`/admin/face-repair/owner/${ownerId}/people`)
        .set('Authorization', 'Bearer token');
      expect(status).toBe(403);
      expect(service.searchOwnerPeople).not.toHaveBeenCalled();
    });

    it('delegates to service.searchOwnerPeople with query + page', async () => {
      service.searchOwnerPeople.mockResolvedValue({ people: [], total: 0, hasMore: false });
      const { status, body } = await request(ctx.getHttpServer())
        .get(`/admin/face-repair/owner/${ownerId}/people`)
        .query({ query: 'al', page: 1 })
        .set('Authorization', 'Bearer token');
      expect(status).toBe(200);
      expect(service.searchOwnerPeople).toHaveBeenCalledWith(
        ownerId,
        expect.objectContaining({ query: 'al', page: 1 }),
      );
      expect(body).toEqual({ people: [], total: 0, hasMore: false });
    });

    it('defaults page to 0 when omitted', async () => {
      service.searchOwnerPeople.mockResolvedValue({ people: [], total: 0, hasMore: false });
      await request(ctx.getHttpServer())
        .get(`/admin/face-repair/owner/${ownerId}/people`)
        .set('Authorization', 'Bearer token');
      expect(service.searchOwnerPeople).toHaveBeenCalledWith(ownerId, expect.objectContaining({ page: 0 }));
    });

    it('rejects a non-uuid ownerId with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/owner/not-a-uuid/people')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(400);
      expect(service.searchOwnerPeople).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/face-repair/owner/:ownerId/people', () => {
    const ownerId = '00000000-0000-4000-a000-000000000041';

    it('should be an authenticated route (C3)', async () => {
      await request(ctx.getHttpServer()).post(`/admin/face-repair/owner/${ownerId}/people`);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('is admin-only: a non-admin caller gets 403 (C3)', async () => {
      ctx.authenticate.mockRejectedValue(new ForbiddenException('Forbidden'));
      const { status } = await request(ctx.getHttpServer())
        .post(`/admin/face-repair/owner/${ownerId}/people`)
        .set('Authorization', 'Bearer token')
        .send({ name: 'New Person' });
      expect(status).toBe(403);
      expect(service.createOwnerPerson).not.toHaveBeenCalled();
    });

    it('delegates to service.createOwnerPerson with the given name', async () => {
      service.createOwnerPerson.mockResolvedValue({ id: '00000000-0000-4000-a000-000000000042' });
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/admin/face-repair/owner/${ownerId}/people`)
        .set('Authorization', 'Bearer token')
        .send({ name: 'New Person' });
      expect(status).toBe(201);
      expect(service.createOwnerPerson).toHaveBeenCalledWith(ownerId, 'New Person');
      expect(body).toEqual({ id: '00000000-0000-4000-a000-000000000042' });
    });

    it('rejects an empty name with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/admin/face-repair/owner/${ownerId}/people`)
        .set('Authorization', 'Bearer token')
        .send({ name: '' });
      expect(status).toBe(400);
      expect(service.createOwnerPerson).not.toHaveBeenCalled();
    });

    it('rejects a non-uuid ownerId with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/owner/not-a-uuid/people')
        .set('Authorization', 'Bearer token')
        .send({ name: 'New Person' });
      expect(status).toBe(400);
      expect(service.createOwnerPerson).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/face-repair/resolutions', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get('/admin/face-repair/resolutions');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('is admin-only: a non-admin caller gets 403 (C1)', async () => {
      ctx.authenticate.mockRejectedValue(new ForbiddenException('Forbidden'));
      const { status } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/resolutions')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(403);
      expect(service.listResolutions).not.toHaveBeenCalled();
    });

    it('delegates to service.listResolutions', async () => {
      service.listResolutions.mockResolvedValue({ total: 0, resolutions: [] });
      const { status, body } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/resolutions')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(200);
      expect(service.listResolutions).toHaveBeenCalled();
      expect(body).toMatchObject({ total: 0, resolutions: [] });
    });

    // S11 (F23): unscoped by design — paginated so a large instance's resolutions list does not return every
    // outstanding verdict in one response.
    it('S11: parses page/size query params and passes them through to the service', async () => {
      service.listResolutions.mockResolvedValue({ total: 0, resolutions: [] });
      const { status } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/resolutions')
        .query({ page: 2, size: 10 })
        .set('Authorization', 'Bearer token');
      expect(status).toBe(200);
      expect(service.listResolutions).toHaveBeenCalledWith(expect.objectContaining({ page: 2, size: 10 }));
    });

    it('S11: defaults page/size when omitted', async () => {
      service.listResolutions.mockResolvedValue({ total: 0, resolutions: [] });
      const { status } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/resolutions')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(200);
      expect(service.listResolutions).toHaveBeenCalledWith(expect.objectContaining({ page: 1, size: 50 }));
    });

    it('S11: rejects a size above the 200 ceiling', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/resolutions')
        .query({ size: 201 })
        .set('Authorization', 'Bearer token');
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['size'], message: 'Too big: expected number to be <=200' }]),
      );
      expect(service.listResolutions).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/face-repair/resolutions/remove', () => {
    const uuid1 = '00000000-0000-4000-a000-000000000001';
    const uuid2 = '00000000-0000-4000-a000-000000000002';

    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/admin/face-repair/resolutions/remove');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('is admin-only: a non-admin caller gets 403 (C1)', async () => {
      ctx.authenticate.mockRejectedValue(new ForbiddenException('Forbidden'));
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolutions/remove')
        .set('Authorization', 'Bearer token')
        .send({ verdictIds: [uuid1] });
      expect(status).toBe(403);
      expect(service.removeResolutions).not.toHaveBeenCalled();
    });

    it('should delegate to service.removeResolutions (verdictIds)', async () => {
      service.removeResolutions.mockResolvedValue({ removed: 1 });
      const { status, body } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolutions/remove')
        .set('Authorization', 'Bearer token')
        .send({ verdictIds: [uuid1] });
      expect(status).toBe(201);
      expect(service.removeResolutions).toHaveBeenCalledWith({ verdictIds: [uuid1] });
      expect(body).toEqual({ removed: 1 });
    });

    it('should delegate to service.removeResolutions (clusterMuteIds)', async () => {
      service.removeResolutions.mockResolvedValue({ removed: 1 });
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolutions/remove')
        .set('Authorization', 'Bearer token')
        .send({ clusterMuteIds: [uuid1] });
      expect(status).toBe(201);
      expect(service.removeResolutions).toHaveBeenCalledWith({ clusterMuteIds: [uuid1] });
    });

    it('rejects the retired natural-key form with 400', async () => {
      // Verdicts are undone by row id only; the (assetFaceId, suspectedOwnerId) pair is no longer a key
      // clients can address, because a verdict may be keyed by identity instead.
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolutions/remove')
        .set('Authorization', 'Bearer token')
        .send({ faces: [{ assetFaceId: uuid1, suspectedOwnerId: uuid2 }] });
      expect(status).toBe(400);
      expect(service.removeResolutions).not.toHaveBeenCalled();
    });

    it('accepts a v7 verdictId (regression guard: face_person_verdict.id is uuid v7) (C2)', async () => {
      // Regression: z.uuidv4() rejects v7 ids — this exact bug broke decline "Undo" before. z.uuid() must accept them.
      const uuidV7 = '01890000-0000-7000-8000-000000000001';
      service.removeResolutions.mockResolvedValue({ removed: 1 });
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolutions/remove')
        .set('Authorization', 'Bearer token')
        .send({ verdictIds: [uuidV7] });
      expect(status).toBe(201);
      expect(service.removeResolutions).toHaveBeenCalledWith({ verdictIds: [uuidV7] });
    });

    it('accepts a v7 clusterMuteId (regression guard: ids are uuid v7) (C2)', async () => {
      const uuidV7 = '01890000-0000-7000-8000-000000000002';
      service.removeResolutions.mockResolvedValue({ removed: 1 });
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolutions/remove')
        .set('Authorization', 'Bearer token')
        .send({ clusterMuteIds: [uuidV7] });
      expect(status).toBe(201);
      expect(service.removeResolutions).toHaveBeenCalledWith({ clusterMuteIds: [uuidV7] });
    });

    it('rejects a malformed body (non-uuid verdictId) with 400 (C2)', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolutions/remove')
        .set('Authorization', 'Bearer token')
        .send({ verdictIds: ['not-a-uuid'] });
      expect(status).toBe(400);
      expect(service.removeResolutions).not.toHaveBeenCalled();
    });

    it('rejects an empty verdictIds array with 400 (C2)', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/resolutions/remove')
        .set('Authorization', 'Bearer token')
        .send({ verdictIds: [] });
      expect(status).toBe(400);
      expect(service.removeResolutions).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/face-repair/unconfirm', () => {
    const uuid1 = '00000000-0000-4000-a000-000000000001';

    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).post('/admin/face-repair/unconfirm');
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('is admin-only: a non-admin caller gets 403', async () => {
      ctx.authenticate.mockRejectedValue(new ForbiddenException('Forbidden'));
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/unconfirm')
        .set('Authorization', 'Bearer token')
        .send({ assetFaceIds: [uuid1] });
      expect(status).toBe(403);
      expect(service.unconfirmFaces).not.toHaveBeenCalled();
    });

    it('delegates to service.unconfirmFaces', async () => {
      service.unconfirmFaces.mockResolvedValue({ removed: 1 });
      const { status, body } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/unconfirm')
        .set('Authorization', 'Bearer token')
        .send({ assetFaceIds: [uuid1] });
      expect(status).toBe(201);
      expect(service.unconfirmFaces).toHaveBeenCalledWith([uuid1]);
      expect(body).toEqual({ removed: 1 });
    });

    it('rejects an empty assetFaceIds array with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post('/admin/face-repair/unconfirm')
        .set('Authorization', 'Bearer token')
        .send({ assetFaceIds: [] });
      expect(status).toBe(400);
      expect(service.unconfirmFaces).not.toHaveBeenCalled();
    });
  });

  // Slice 7 (D7): face-keyed, join-free, admin-gated thumbnail. Highest-value route on this controller — it
  // is new and returns any user's face crop by id — so it must not be the one route on this controller with
  // no coverage at all (it previously had none).
  describe('GET /admin/face-repair/faces/:assetFaceId/thumbnail', () => {
    const assetFaceId = '00000000-0000-4000-a000-000000000060';

    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get(`/admin/face-repair/faces/${assetFaceId}/thumbnail`);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('delegates to service.getAdminFaceThumbnail with the assetFaceId', async () => {
      // ImmichRedirectResponse exercises sendFile's real dispatch without touching the filesystem, so the
      // assertion below is about delegation + response wiring, not disk I/O.
      service.getAdminFaceThumbnail.mockResolvedValue(
        new ImmichRedirectResponse({ url: 'https://example.com/face.jpg', cacheControl: CacheControl.None }),
      );
      const { status, headers } = await request(ctx.getHttpServer())
        .get(`/admin/face-repair/faces/${assetFaceId}/thumbnail`)
        .set('Authorization', 'Bearer token');
      expect(status).toBe(302);
      expect(headers.location).toBe('https://example.com/face.jpg');
      expect(service.getAdminFaceThumbnail).toHaveBeenCalledWith(assetFaceId);
    });

    it('rejects a non-uuid assetFaceId with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/faces/not-a-uuid/thumbnail')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(400);
      expect(service.getAdminFaceThumbnail).not.toHaveBeenCalled();
    });
  });

  // Same shape as the thumbnail route's coverage above, and for the same reason: this route is new and
  // returns any user's source photo by face id, so it must not be the one route on this controller with no
  // coverage.
  describe('GET /admin/face-repair/faces/:assetFaceId/preview', () => {
    const assetFaceId = '00000000-0000-4000-a000-000000000061';

    it('T3.1: should be an authenticated admin route', async () => {
      await request(ctx.getHttpServer()).get(`/admin/face-repair/faces/${assetFaceId}/preview`);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ adminRoute: true }),
        }),
      );
    });

    it('T3.2: delegates to service.getAdminFacePreview with the assetFaceId', async () => {
      // ImmichRedirectResponse exercises sendFile's real dispatch without touching the filesystem.
      service.getAdminFacePreview.mockResolvedValue(
        new ImmichRedirectResponse({ url: 'https://example.com/photo.jpg', cacheControl: CacheControl.None }),
      );
      const { status, headers } = await request(ctx.getHttpServer())
        .get(`/admin/face-repair/faces/${assetFaceId}/preview`)
        .set('Authorization', 'Bearer token');
      expect(status).toBe(302);
      expect(headers.location).toBe('https://example.com/photo.jpg');
      expect(service.getAdminFacePreview).toHaveBeenCalledWith(assetFaceId);
    });

    it('rejects a non-uuid assetFaceId with 400', async () => {
      const { status } = await request(ctx.getHttpServer())
        .get('/admin/face-repair/faces/not-a-uuid/preview')
        .set('Authorization', 'Bearer token');
      expect(status).toBe(400);
      expect(service.getAdminFacePreview).not.toHaveBeenCalled();
    });
  });
});
