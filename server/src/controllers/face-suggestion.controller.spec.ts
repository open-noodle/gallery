import { FaceSuggestionController } from 'src/controllers/face-suggestion.controller';
import { Permission } from 'src/enum';
import { FaceSuggestionService } from 'src/services/face-suggestion.service';
import request from 'supertest';
import { errorDto } from 'test/medium/responses';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

describe(FaceSuggestionController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(FaceSuggestionService);

  beforeAll(async () => {
    ctx = await controllerSetup(FaceSuggestionController, [{ provide: FaceSuggestionService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /people/:id/face-suggestions', () => {
    const personId = '00000000-0000-4000-8000-000000000001';

    // S10.4/F21: the endpoint published Permission.PersonRead, which admits shared-space members via
    // access.person.checkSharedSpaceAccess — but getFaceSuggestions enforces PersonUpdate (owner-only,
    // D6), so a caller scoped exactly to what the spec documents would pass the guard and then 400 at
    // requireAccess. The published permission must match what's enforced.
    it('should publish PersonUpdate, matching the owner-only D6 enforcement in the service', async () => {
      service.getFaceSuggestions.mockResolvedValue({ total: 0, items: [] });

      const { status, body } = await request(ctx.getHttpServer())
        .get(`/people/${personId}/face-suggestions`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.PersonUpdate }),
        }),
      );
      expect(body).toEqual({ total: 0, items: [] });
    });
  });

  describe('POST /people/:id/face-suggestions/:assetFaceId/confirm', () => {
    const personId = '00000000-0000-4000-8000-000000000001';
    const assetFaceId = '00000000-0000-4000-8000-000000000002';

    // S10.4/F21: published Permission.PersonReassign, but confirmFaceSuggestion enforces PersonUpdate
    // (on the person) AND PersonCreate (on the face) — the guard can only carry one permission, so the
    // person-level PersonUpdate is what's published; PersonCreate stays a service-level check (see the
    // comment on confirmFaceSuggestion in face-suggestion.service.ts).
    // S11.8/F24: the modal must stop inferring "already resolved" from a status code that also means "you're
    // not allowed to do this" (F24) — so the service's acted/no-op boolean is what reports the outcome.
    // S11b/F24: that outcome lives in the BODY, not the status code. @oazapfts/runtime's ok() resolves to the
    // response body and discards the status for EVERY 2xx, so a 200-vs-204 contract is structurally
    // unreadable by any generated client. Both codes are 200; `acted` carries the signal.
    it('should publish PersonUpdate and report acted: true when the service acted', async () => {
      service.confirmFaceSuggestion.mockResolvedValue(true);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/people/${personId}/face-suggestions/${assetFaceId}/confirm`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(body).toEqual({ acted: true });
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.PersonUpdate }),
        }),
      );
      expect(service.confirmFaceSuggestion).toHaveBeenCalledWith(undefined, personId, assetFaceId);
    });

    it('should report acted: false on a no-op, still as 200 with a readable body', async () => {
      service.confirmFaceSuggestion.mockResolvedValue(false);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/people/${personId}/face-suggestions/${assetFaceId}/confirm`)
        .set('Authorization', `Bearer token`);

      // Explicitly NOT 204: a 204 carries no body, and oazapfts would hand the caller `undefined`
      // for both outcomes — the exact reason the previous contract could not ship.
      expect(status).toBe(200);
      expect(status).not.toBe(204);
      expect(body).toEqual({ acted: false });
    });
  });

  describe('face suggestion routes', () => {
    const personId = '00000000-0000-4000-8000-000000000001';
    const assetFaceId = '00000000-0000-4000-8000-000000000002';

    it('POST reject should require person update permission and respond with 200 when acted', async () => {
      service.rejectFaceSuggestion.mockResolvedValue(true);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/people/${personId}/face-suggestions/${assetFaceId}/reject`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.PersonUpdate }),
        }),
      );
      expect(body).toEqual({ acted: true });
      expect(service.rejectFaceSuggestion).toHaveBeenCalledWith(undefined, personId, assetFaceId);
    });

    it('POST reject should report acted: false on a no-op, still as 200', async () => {
      service.rejectFaceSuggestion.mockResolvedValue(false);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/people/${personId}/face-suggestions/${assetFaceId}/reject`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(status).not.toBe(204);
      expect(body).toEqual({ acted: false });
    });

    it('POST ignore should require person update permission and respond with 200 when acted', async () => {
      service.ignoreFaceSuggestion.mockResolvedValue(true);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/people/${personId}/face-suggestions/${assetFaceId}/ignore`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.PersonUpdate }),
        }),
      );
      expect(body).toEqual({ acted: true });
      expect(service.ignoreFaceSuggestion).toHaveBeenCalledWith(undefined, personId, assetFaceId);
    });

    it('POST ignore should report acted: false on a no-op, still as 200', async () => {
      service.ignoreFaceSuggestion.mockResolvedValue(false);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/people/${personId}/face-suggestions/${assetFaceId}/ignore`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(status).not.toBe(204);
      expect(body).toEqual({ acted: false });
    });

    it('POST dismiss should require person update permission and respond with 200 when acted', async () => {
      service.dismissFaceSuggestion.mockResolvedValue(true);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/people/${personId}/face-suggestions/${assetFaceId}/dismiss`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(ctx.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ permission: Permission.PersonUpdate }),
        }),
      );
      expect(body).toEqual({ acted: true });
      expect(service.dismissFaceSuggestion).toHaveBeenCalledWith(undefined, personId, assetFaceId);
    });

    it('POST dismiss should report acted: false on a no-op, still as 200', async () => {
      service.dismissFaceSuggestion.mockResolvedValue(false);

      const { status, body } = await request(ctx.getHttpServer())
        .post(`/people/${personId}/face-suggestions/${assetFaceId}/dismiss`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(200);
      expect(status).not.toBe(204);
      expect(body).toEqual({ acted: false });
    });

    it('POST reject should validate assetFaceId independently', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/people/${personId}/face-suggestions/not-a-uuid/reject`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetFaceId'], message: 'Invalid UUID' }]));
      expect(service.rejectFaceSuggestion).not.toHaveBeenCalled();
    });

    it('POST ignore should validate assetFaceId independently', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/people/${personId}/face-suggestions/not-a-uuid/ignore`)
        .set('Authorization', `Bearer token`);

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetFaceId'], message: 'Invalid UUID' }]));
      expect(service.ignoreFaceSuggestion).not.toHaveBeenCalled();
    });
  });
});
