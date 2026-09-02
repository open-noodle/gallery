import { SharedSpaceController } from 'src/controllers/shared-space.controller';
import { Permission } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceService } from 'src/services/shared-space.service';
import request from 'supertest';
import { errorDto } from 'test/medium/responses';
import { factory } from 'test/small.factory';
import { automock, ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

describe(SharedSpaceController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(SharedSpaceService);

  beforeAll(async () => {
    ctx = await controllerSetup(SharedSpaceController, [
      { provide: SharedSpaceService, useValue: service },
      { provide: LoggingRepository, useValue: automock(LoggingRepository, { strict: false }) },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('PUT /shared-spaces/:id/people/:personId', () => {
    it('should map an empty birthDate to null', async () => {
      const spaceId = factory.uuid();
      const personId = factory.uuid();

      await request(ctx.getHttpServer()).put(`/shared-spaces/${spaceId}/people/${personId}`).send({ birthDate: '' });

      expect(service.updateSpacePerson).toHaveBeenCalledWith(undefined, spaceId, personId, { birthDate: null });
    });
  });

  // Slice 4, Task 2 (spec §6.2): POST /shared-spaces/:id/people.
  describe('POST /shared-spaces/:id/people', () => {
    const spaceId = '00000000-0000-4000-8000-000000000001';
    const personId = '00000000-0000-4000-8000-000000000002';

    it('should require shared-space update permission and create a person', async () => {
      service.createSpacePerson.mockResolvedValue({
        id: personId,
        spaceId,
        name: 'Aurelia',
        thumbnailPath: '',
        isHidden: false,
        representativeFaceSource: 'auto',
        faceCount: 0,
        assetCount: 0,
        alias: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people`)
        .set('Authorization', `Bearer token`)
        .send({ name: 'Aurelia' });

      expect(status).toBe(201);
      expect(body).toMatchObject({ id: personId, name: 'Aurelia' });
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
        }),
      );
      expect(service.createSpacePerson).toHaveBeenCalledWith(undefined, spaceId, { name: 'Aurelia' });
    });

    it('should pass an assetFaceId seed through to the service', async () => {
      const assetFaceId = '00000000-0000-4000-8000-000000000003';
      service.createSpacePerson.mockResolvedValue({
        id: personId,
        spaceId,
        name: 'Aurelia',
        thumbnailPath: '',
        isHidden: false,
        representativeFaceSource: 'auto',
        faceCount: 1,
        assetCount: 1,
        alias: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const { status } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people`)
        .set('Authorization', `Bearer token`)
        .send({ name: 'Aurelia', assetFaceId });

      expect(status).toBe(201);
      expect(service.createSpacePerson).toHaveBeenCalledWith(undefined, spaceId, { name: 'Aurelia', assetFaceId });
    });

    it('should validate the space id as a uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/not-a-uuid/people`)
        .set('Authorization', `Bearer token`)
        .send({ name: 'Aurelia' });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
      expect(service.createSpacePerson).not.toHaveBeenCalled();
    });

    it('should validate assetFaceId as a uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people`)
        .set('Authorization', `Bearer token`)
        .send({ name: 'Aurelia', assetFaceId: 'not-a-uuid' });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetFaceId'], message: 'Invalid UUID' }]));
      expect(service.createSpacePerson).not.toHaveBeenCalled();
    });
  });

  describe('representative face routes', () => {
    it('should allow clearing a space representative face override', async () => {
      const spaceId = '00000000-0000-4000-8000-000000000001';
      const personId = '00000000-0000-4000-8000-000000000002';
      service.updateSpacePersonRepresentativeFace.mockResolvedValue({
        id: personId,
        spaceId,
        name: '',
        thumbnailPath: '',
        isHidden: false,
        birthDate: null,
        representativeFaceId: null,
        representativeFaceSource: 'auto',
        faceCount: 0,
        assetCount: 0,
        alias: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        type: 'person',
      });

      const { status } = await request(ctx.getHttpServer())
        .put(`/shared-spaces/${spaceId}/people/${personId}/representative-face`)
        .send({ assetFaceId: null })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(service.updateSpacePersonRepresentativeFace).toHaveBeenCalledWith(undefined, spaceId, personId, {
        assetFaceId: null,
      });
    });

    it('should require space representative assetFaceId to be null or uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put(
          '/shared-spaces/00000000-0000-4000-8000-000000000001/people/00000000-0000-4000-8000-000000000002/representative-face',
        )
        .send({ assetFaceId: 'invalid' })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetFaceId'], message: 'Invalid UUID' }]));
    });
  });

  describe('GET /shared-spaces/:id/people/statistics', () => {
    it('should serialize detected face count', async () => {
      const spaceId = factory.uuid();
      service.getSpacePeopleStatistics.mockResolvedValue({
        total: 5,
        hidden: 1,
        detectedFaceCount: 19,
      } as any);

      const { status, body } = await request(ctx.getHttpServer())
        .get(`/shared-spaces/${spaceId}/people/statistics`)
        .query({ name: 'Ali' })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(service.getSpacePeopleStatistics).toHaveBeenCalledWith(
        undefined,
        spaceId,
        expect.objectContaining({ name: 'Ali' }),
      );
      expect(body).toEqual({
        total: 5,
        hidden: 1,
        detectedFaceCount: 19,
      });
    });
  });

  describe('GET /shared-spaces/:id/people/face-statistics', () => {
    it('should serialize lazy shared-space face statistics', async () => {
      const spaceId = factory.uuid();
      service.getSpacePeopleFaceStatistics.mockResolvedValue({
        detectedFaceCount: 19,
        assignedVisibleFaceCount: 15,
        namedVisiblePersonCount: 7,
        assignedHiddenFaceCount: 1,
        unassignedFaceCount: 3,
      });

      const { status, body } = await request(ctx.getHttpServer())
        .get(`/shared-spaces/${spaceId}/people/face-statistics`)
        .query({ name: 'Ali' })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(service.getSpacePeopleFaceStatistics).toHaveBeenCalledWith(
        undefined,
        spaceId,
        expect.objectContaining({ name: 'Ali' }),
      );
      expect(body).toEqual({
        detectedFaceCount: 19,
        assignedVisibleFaceCount: 15,
        namedVisiblePersonCount: 7,
        assignedHiddenFaceCount: 1,
        unassignedFaceCount: 3,
      });
    });
  });

  describe('GET /shared-spaces/:id/people/:personId/statistics', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).get(`/shared-spaces/${factory.uuid()}/people/${factory.uuid()}/statistics`);

      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('should serialize space person asset and face statistics', async () => {
      const spaceId = factory.uuid();
      const personId = factory.uuid();
      service.getSpacePersonStatistics.mockResolvedValue({ assets: 5, faces: 8 });

      const { status, body } = await request(ctx.getHttpServer())
        .get(`/shared-spaces/${spaceId}/people/${personId}/statistics`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(service.getSpacePersonStatistics).toHaveBeenCalledWith(undefined, spaceId, personId);
      expect(body).toEqual({ assets: 5, faces: 8 });
    });
  });

  describe('face suggestion routes', () => {
    const spaceId = '00000000-0000-4000-8000-000000000001';
    const personId = '00000000-0000-4000-8000-000000000002';
    const assetFaceId = '00000000-0000-4000-8000-000000000003';

    it('GET /shared-spaces/:id/people/:personId/face-suggestions should require shared-space read permission', async () => {
      await request(ctx.getHttpServer()).get(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions`);

      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.SharedSpaceRead }),
        }),
      );
    });

    it('GET /shared-spaces/:id/people/:personId/face-suggestions should coerce query and return suggestions', async () => {
      service.getSpacePersonFaceSuggestions.mockResolvedValue({
        total: 1,
        items: [
          {
            assetFaceId,
            assetId: '00000000-0000-4000-8000-000000000004',
            distance: 0.42,
            imageHeight: 3000,
            imageWidth: 4000,
            boundingBoxX1: 10,
            boundingBoxX2: 110,
            boundingBoxY1: 20,
            boundingBoxY2: 120,
            fileCreatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

      const { status, body } = await request(ctx.getHttpServer())
        .get(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions`)
        .query({ page: '2', size: '25' })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(service.getSpacePersonFaceSuggestions).toHaveBeenCalledWith(undefined, spaceId, personId, {
        page: 2,
        size: 25,
      });
      expect(body.total).toBe(1);
      expect(body.items[0].assetFaceId).toBe(assetFaceId);
    });

    it('GET /shared-spaces/:id/people/:personId/face-suggestions should validate query', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions`)
        .query({ size: 101 })
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['size'], message: 'Too big: expected number to be <=100' }]),
      );
      expect(service.getSpacePersonFaceSuggestions).not.toHaveBeenCalled();
    });

    it('GET /shared-spaces/:id/people/:personId/face-suggestions should validate UUID params', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get(`/shared-spaces/not-a-uuid/people/${personId}/face-suggestions`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
      expect(service.getSpacePersonFaceSuggestions).not.toHaveBeenCalled();
    });

    it('GET /shared-spaces/:id/people/:personId/face-suggestions should validate personId', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get(`/shared-spaces/${spaceId}/people/not-a-uuid/face-suggestions`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['personId'], message: 'Invalid UUID' }]));
      expect(service.getSpacePersonFaceSuggestions).not.toHaveBeenCalled();
    });

    // S11.8/F24: the service's acted/no-op return value reports the outcome.
    // S11b/F24: it reports it in the BODY, not the status code — @oazapfts/runtime's ok() resolves to the
    // body and discards the status for every 2xx, so 200-vs-204 is unreadable by a generated client.
    // See the parallel PersonController comment.
    it('POST confirm should require shared-space update permission and respond with 200 when acted', async () => {
      service.confirmSpacePersonFaceSuggestion.mockResolvedValue(true);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/confirm`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(body).toEqual({ acted: true });
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
        }),
      );
      expect(service.confirmSpacePersonFaceSuggestion).toHaveBeenCalledWith(undefined, spaceId, personId, assetFaceId);
    });

    it('POST confirm should report acted: false on a no-op, still as 200 with a readable body', async () => {
      service.confirmSpacePersonFaceSuggestion.mockResolvedValue(false);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/confirm`)
        .set('Authorization', `Bearer token`);

      // Explicitly NOT 204: a 204 carries no body, so oazapfts hands the caller `undefined` for both
      // outcomes — the reason the previous contract could not ship.
      expect(status).toBe(200);
      expect(status).not.toBe(204);
      expect(body).toEqual({ acted: false });
    });

    it('POST dismiss should require shared-space update permission and respond with 200 when acted', async () => {
      service.dismissSpacePersonFaceSuggestion.mockResolvedValue(true);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/dismiss`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(body).toEqual({ acted: true });
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
        }),
      );
      expect(service.dismissSpacePersonFaceSuggestion).toHaveBeenCalledWith(undefined, spaceId, personId, assetFaceId);
    });

    it('POST dismiss should report acted: false on a no-op, still as 200', async () => {
      service.dismissSpacePersonFaceSuggestion.mockResolvedValue(false);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/dismiss`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(status).not.toBe(204);
      expect(body).toEqual({ acted: false });
    });

    it('POST reject should require shared-space update permission and respond with 200 when acted', async () => {
      service.rejectSpacePersonFaceSuggestion.mockResolvedValue(true);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/reject`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(body).toEqual({ acted: true });
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
        }),
      );
      expect(service.rejectSpacePersonFaceSuggestion).toHaveBeenCalledWith(undefined, spaceId, personId, assetFaceId);
    });

    it('POST reject should report acted: false on a no-op, still as 200', async () => {
      service.rejectSpacePersonFaceSuggestion.mockResolvedValue(false);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/reject`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(status).not.toBe(204);
      expect(body).toEqual({ acted: false });
    });

    it('POST ignore should require shared-space update permission and respond with 200 when acted', async () => {
      service.ignoreSpacePersonFaceSuggestion.mockResolvedValue(true);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/ignore`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(body).toEqual({ acted: true });
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
        }),
      );
      expect(service.ignoreSpacePersonFaceSuggestion).toHaveBeenCalledWith(undefined, spaceId, personId, assetFaceId);
    });

    it('POST ignore should report acted: false on a no-op, still as 200', async () => {
      service.ignoreSpacePersonFaceSuggestion.mockResolvedValue(false);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/${assetFaceId}/ignore`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(status).not.toBe(204);
      expect(body).toEqual({ acted: false });
    });

    it('POST confirm should validate assetFaceId independently', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/not-a-uuid/confirm`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetFaceId'], message: 'Invalid UUID' }]));
      expect(service.confirmSpacePersonFaceSuggestion).not.toHaveBeenCalled();
    });

    it('POST reject should validate assetFaceId independently', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/not-a-uuid/reject`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetFaceId'], message: 'Invalid UUID' }]));
      expect(service.rejectSpacePersonFaceSuggestion).not.toHaveBeenCalled();
    });

    it('POST ignore should validate assetFaceId independently', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/people/${personId}/face-suggestions/not-a-uuid/ignore`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetFaceId'], message: 'Invalid UUID' }]));
      expect(service.ignoreSpacePersonFaceSuggestion).not.toHaveBeenCalled();
    });
  });

  describe('PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId', () => {
    const spaceId = '00000000-0000-4000-8000-000000000001';
    const personId = '00000000-0000-4000-8000-000000000002';
    const assetFaceId = '00000000-0000-4000-8000-000000000003';

    it('should require shared-space update permission and respond with 200 when acted', async () => {
      service.attachFaceToSpacePerson.mockResolvedValue(true);

      const { status, body } = await request(ctx.getHttpServer())
        .put(`/shared-spaces/${spaceId}/people/${personId}/faces/${assetFaceId}`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(body).toEqual({ acted: true });
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
        }),
      );
      expect(service.attachFaceToSpacePerson).toHaveBeenCalledWith(undefined, spaceId, personId, assetFaceId);
    });

    it('should report acted: false on a no-op, still as 200', async () => {
      service.attachFaceToSpacePerson.mockResolvedValue(false);

      const { status, body } = await request(ctx.getHttpServer())
        .put(`/shared-spaces/${spaceId}/people/${personId}/faces/${assetFaceId}`)
        .set('Authorization', `Bearer token`);

      // Explicitly NOT 204: a 204 carries no body, so oazapfts hands the caller `undefined` for both
      // outcomes — the reason the previous contract could not ship.
      expect(status).toBe(200);
      expect(status).not.toBe(204);
      expect(body).toEqual({ acted: false });
    });

    it('should validate assetFaceId independently', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put(`/shared-spaces/${spaceId}/people/${personId}/faces/not-a-uuid`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetFaceId'], message: 'Invalid UUID' }]));
      expect(service.attachFaceToSpacePerson).not.toHaveBeenCalled();
    });
  });

  // Slice 4, Task 1 (spec §6.4): DELETE /shared-spaces/:id/people/:personId/faces/:assetFaceId.
  describe('DELETE /shared-spaces/:id/people/:personId/faces/:assetFaceId', () => {
    const spaceId = '00000000-0000-4000-8000-000000000001';
    const personId = '00000000-0000-4000-8000-000000000002';
    const assetFaceId = '00000000-0000-4000-8000-000000000003';

    it('should require shared-space update permission and respond with 200 when acted', async () => {
      service.detachFaceFromSpacePerson.mockResolvedValue(true);

      const { status, body } = await request(ctx.getHttpServer())
        .delete(`/shared-spaces/${spaceId}/people/${personId}/faces/${assetFaceId}`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(body).toEqual({ acted: true });
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
        }),
      );
      expect(service.detachFaceFromSpacePerson).toHaveBeenCalledWith(undefined, spaceId, personId, assetFaceId);
    });

    it('should report acted: false on a no-op, still as 200', async () => {
      service.detachFaceFromSpacePerson.mockResolvedValue(false);

      const { status, body } = await request(ctx.getHttpServer())
        .delete(`/shared-spaces/${spaceId}/people/${personId}/faces/${assetFaceId}`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(status).not.toBe(204);
      expect(body).toEqual({ acted: false });
    });

    it('should validate assetFaceId independently', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .delete(`/shared-spaces/${spaceId}/people/${personId}/faces/not-a-uuid`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetFaceId'], message: 'Invalid UUID' }]));
      expect(service.detachFaceFromSpacePerson).not.toHaveBeenCalled();
    });
  });

  // Slice 3 (spec §6.1): GET /shared-spaces/:id/assets/:assetId/faces. The decorator carries the
  // SharedSpaceRead API-key SCOPE (matching the sibling read at :id/people/:personId/faces) — the
  // real Editor-only RBAC is enforced in the service via requireRole, not visible at this layer.
  describe('GET /shared-spaces/:id/assets/:assetId/faces', () => {
    const spaceId = '00000000-0000-4000-8000-000000000001';
    const assetId = '00000000-0000-4000-8000-000000000002';
    const faceId = '00000000-0000-4000-8000-000000000003';
    const personId = '00000000-0000-4000-8000-000000000004';

    it('should require shared-space read permission and return the space-scoped faces', async () => {
      service.getSpaceAssetFaces.mockResolvedValue([
        {
          id: faceId,
          boundingBoxX1: 10,
          boundingBoxY1: 20,
          boundingBoxX2: 110,
          boundingBoxY2: 120,
          imageWidth: 4000,
          imageHeight: 3000,
          spacePersonId: personId,
          spacePersonName: 'Uncle Tom',
          isEditorDrawn: true,
        },
      ]);

      const { status, body } = await request(ctx.getHttpServer())
        .get(`/shared-spaces/${spaceId}/assets/${assetId}/faces`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.SharedSpaceRead }),
        }),
      );
      expect(service.getSpaceAssetFaces).toHaveBeenCalledWith(undefined, spaceId, assetId);
      expect(body).toEqual([
        {
          id: faceId,
          boundingBoxX1: 10,
          boundingBoxY1: 20,
          boundingBoxX2: 110,
          boundingBoxY2: 120,
          imageWidth: 4000,
          imageHeight: 3000,
          spacePersonId: personId,
          spacePersonName: 'Uncle Tom',
          isEditorDrawn: true,
        },
      ]);
    });

    it('should validate assetId as a uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get(`/shared-spaces/${spaceId}/assets/not-a-uuid/faces`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetId'], message: 'Invalid UUID' }]));
      expect(service.getSpaceAssetFaces).not.toHaveBeenCalled();
    });

    it('should validate the space id as a uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .get(`/shared-spaces/not-a-uuid/assets/${assetId}/faces`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
      expect(service.getSpaceAssetFaces).not.toHaveBeenCalled();
    });
  });

  // Slice 6, Task 2 (spec §6.5): POST /shared-spaces/:id/assets/:assetId/faces -- draw a box. The
  // decorator carries the SharedSpaceUpdate API-key SCOPE, matching the sibling writes -- the real
  // Editor-only RBAC + asset/person reachability is enforced in the service, not visible here.
  describe('POST /shared-spaces/:id/assets/:assetId/faces', () => {
    const spaceId = '00000000-0000-4000-8000-000000000001';
    const assetId = '00000000-0000-4000-8000-000000000002';
    const faceId = '00000000-0000-4000-8000-000000000003';
    const personId = '00000000-0000-4000-8000-000000000004';

    const body = {
      spacePersonId: personId,
      x: 10,
      y: 20,
      width: 100,
      height: 110,
      imageWidth: 4000,
      imageHeight: 3000,
    };

    it('should require shared-space update permission and create the face', async () => {
      service.createSpaceAssetFace.mockResolvedValue({
        id: faceId,
        boundingBoxX1: 10,
        boundingBoxY1: 20,
        boundingBoxX2: 110,
        boundingBoxY2: 130,
        imageWidth: 4000,
        imageHeight: 3000,
        spacePersonId: personId,
        spacePersonName: 'Aurelia',
        isEditorDrawn: true,
      });

      const { status, body: response } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/assets/${assetId}/faces`)
        .set('Authorization', `Bearer token`)
        .send(body);

      expect(status).toBe(201);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
        }),
      );
      expect(service.createSpaceAssetFace).toHaveBeenCalledWith(undefined, spaceId, assetId, body);
      expect(response).toEqual({
        id: faceId,
        boundingBoxX1: 10,
        boundingBoxY1: 20,
        boundingBoxX2: 110,
        boundingBoxY2: 130,
        imageWidth: 4000,
        imageHeight: 3000,
        spacePersonId: personId,
        spacePersonName: 'Aurelia',
        isEditorDrawn: true,
      });
    });

    it('should validate assetId as a uuid', async () => {
      const { status, body: response } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/assets/not-a-uuid/faces`)
        .set('Authorization', `Bearer token`)
        .send(body);

      expect(status).toBe(400);
      expect(response).toEqual(errorDto.validationError([{ path: ['assetId'], message: 'Invalid UUID' }]));
      expect(service.createSpaceAssetFace).not.toHaveBeenCalled();
    });

    it('should validate the space id as a uuid', async () => {
      const { status, body: response } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/not-a-uuid/assets/${assetId}/faces`)
        .set('Authorization', `Bearer token`)
        .send(body);

      expect(status).toBe(400);
      expect(response).toEqual(errorDto.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
      expect(service.createSpaceAssetFace).not.toHaveBeenCalled();
    });

    it('should validate spacePersonId as a uuid', async () => {
      const { status, body: response } = await request(ctx.getHttpServer())
        .post(`/shared-spaces/${spaceId}/assets/${assetId}/faces`)
        .set('Authorization', `Bearer token`)
        .send({ ...body, spacePersonId: 'not-a-uuid' });

      expect(status).toBe(400);
      expect(response).toEqual(errorDto.validationError([{ path: ['spacePersonId'], message: 'Invalid UUID' }]));
      expect(service.createSpaceAssetFace).not.toHaveBeenCalled();
    });
  });

  // Slice 6, Task 3 (spec §6.6): DELETE /shared-spaces/:id/faces/:assetFaceId. The decorator
  // carries the SharedSpaceUpdate API-key SCOPE, matching the sibling writes -- the real
  // authority (Editor role + reachability + createdBy IS NOT NULL) is enforced in the service.
  describe('DELETE /shared-spaces/:id/faces/:assetFaceId', () => {
    const spaceId = '00000000-0000-4000-8000-000000000001';
    const faceId = '00000000-0000-4000-8000-000000000003';

    it('should require shared-space update permission and delete the face', async () => {
      service.deleteSpaceAssetFace.mockResolvedValue(undefined);

      const { status, body } = await request(ctx.getHttpServer())
        .delete(`/shared-spaces/${spaceId}/faces/${faceId}`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(204);
      expect(body).toEqual({});
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.SharedSpaceUpdate }),
        }),
      );
      expect(service.deleteSpaceAssetFace).toHaveBeenCalledWith(undefined, spaceId, faceId);
    });

    it('should validate assetFaceId as a uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .delete(`/shared-spaces/${spaceId}/faces/not-a-uuid`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetFaceId'], message: 'Invalid UUID' }]));
      expect(service.deleteSpaceAssetFace).not.toHaveBeenCalled();
    });

    it('should validate the space id as a uuid', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .delete(`/shared-spaces/not-a-uuid/faces/${faceId}`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
      expect(service.deleteSpaceAssetFace).not.toHaveBeenCalled();
    });
  });
});
