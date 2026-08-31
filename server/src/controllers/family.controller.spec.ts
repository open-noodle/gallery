import { ForbiddenException } from '@nestjs/common';
import { FamilyController } from 'src/controllers/family.controller';
import { FamilyAccessLevel } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { FamilyService } from 'src/services/family.service';
import request from 'supertest';
import { authStub } from 'test/fixtures/auth.stub';
import { errorDto } from 'test/medium/responses';
import { automock, ControllerContext, controllerSetup, mockBaseService } from 'test/utils';

const UNION_ID = '00000000-0000-4000-a000-000000000401';
const UNION_A = '00000000-0000-4000-a000-000000000001';
const UNION_B = '00000000-0000-4000-a000-000000000002';
const UNION_C = '00000000-0000-4000-a000-000000000003';
const IDENTITY_A = '00000000-0000-4000-a000-000000000101';
const IDENTITY_B = '00000000-0000-4000-a000-000000000102';
const USER_ID = '00000000-0000-4000-a000-000000000901';

// Fixtures for the D4 label tests below.
const ROOT_ID = '00000000-0000-4000-a000-000000000501';
const CHILD_ID = '00000000-0000-4000-a000-000000000502';
const GRANDPARENT_ID = '00000000-0000-4000-a000-000000000503';
const TARGET_ID = '00000000-0000-4000-a000-000000000504';
const TARGET_SPOUSE_ID = '00000000-0000-4000-a000-000000000505';
const UNION_ROOT_CHILD = '00000000-0000-4000-a000-000000000601';
const UNION_ROOT_PARENT = '00000000-0000-4000-a000-000000000602';
const UNION_TARGET_PARENT = '00000000-0000-4000-a000-000000000603';
const UNION_TARGET_SPOUSE = '00000000-0000-4000-a000-000000000604';

const knownParticipant = (identityId: string) => ({ kind: 'known' as const, identityId });
const forbidden = () => Promise.reject(new ForbiddenException());

describe(FamilyController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(FamilyService);

  beforeAll(async () => {
    ctx = await controllerSetup(FamilyController, [
      { provide: FamilyService, useValue: service },
      { provide: LoggingRepository, useValue: automock(LoggingRepository, { strict: false }) },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  describe('GET /family/unions', () => {
    it('should be an authenticated route', async () => {
      service.getVisibleGraph.mockResolvedValue({ identities: {}, unions: [] });
      service.getMyRoot.mockResolvedValue(null);
      await request(ctx.getHttpServer()).get('/family/unions');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    // D8.5 / E48 — the response is a flat, query-filtered collection, never a nested tree. This
    // is the guard on a design property, not a behaviour: a future `?familyId=` filter must be
    // additive, which only holds if the shape here never grows a container.
    it('returns a flat list of unions rather than a nested tree', async () => {
      service.getVisibleGraph.mockResolvedValue({
        identities: { [IDENTITY_A]: { name: 'Alex', gender: null } },
        unions: [
          {
            id: UNION_ID,
            status: 'partnered',
            partners: [knownParticipant(IDENTITY_A)],
            children: [],
          },
        ],
      });
      service.getMyRoot.mockResolvedValue(null);

      const { status, body } = await request(ctx.getHttpServer())
        .get('/family/unions')
        .set('Authorization', 'Bearer token');

      expect(status).toBe(200);
      expect(Array.isArray(body.unions)).toBe(true);
      expect(body.unions).toHaveLength(1);
      expect(body.unions[0].id).toBe(UNION_ID);
      expect(body.tree).toBeUndefined();
    });

    // A previously shipped bug: `FamilyParticipantDto` used to be a `z.discriminatedUnion`,
    // which the generated Dart client collapsed into one class requiring `identityId` on EVERY
    // participant — crashing on exactly this case (an anonymous seat has no identity at all).
    // The wire shape is now flat with a nullable `identityId`; this asserts the SERVER side of
    // that contract actually serializes an anonymous participant as `{ kind: 'anonymous',
    // identityId: null }` rather than omitting the key (which a required-but-nullable Zod field
    // would reject) or throwing.
    it('serializes an anonymous participant with a null identityId, not an omitted one', async () => {
      service.getVisibleGraph.mockResolvedValue({
        identities: {},
        unions: [
          {
            id: UNION_ID,
            status: 'partnered',
            partners: [{ kind: 'anonymous' }],
            children: [],
          },
        ],
      });
      service.getMyRoot.mockResolvedValue(null);

      const { status, body } = await request(ctx.getHttpServer())
        .get('/family/unions')
        .set('Authorization', 'Bearer token');

      expect(status).toBe(200);
      expect(body.unions[0].partners).toEqual([{ kind: 'anonymous', identityId: null }]);
    });

    // A previously shipped bug: `getAllUnionsWithParticipants`'s SQL never selected
    // `startDate`/`endDate`, so the API silently dropped them — a response missing the fields
    // looked identical to one where they were legitimately null, which is exactly why a
    // structural assertion alone ("the union has an id") never caught it. Assert the VALUES.
    it('returns the actual startDate and endDate values for a union that has them', async () => {
      service.getVisibleGraph.mockResolvedValue({
        identities: { [IDENTITY_A]: { name: 'Alex', gender: null } },
        unions: [
          {
            id: UNION_ID,
            status: 'divorced',
            startDate: '1988-06-01',
            endDate: '2007-03-15',
            partners: [knownParticipant(IDENTITY_A)],
            children: [],
          },
        ],
      });
      service.getMyRoot.mockResolvedValue(null);

      const { status, body } = await request(ctx.getHttpServer())
        .get('/family/unions')
        .set('Authorization', 'Bearer token');

      expect(status).toBe(200);
      expect(body.unions[0].startDate).toBe('1988-06-01');
      expect(body.unions[0].endDate).toBe('2007-03-15');
    });

    it('returns null dates for a union with none, rather than omitting the fields', async () => {
      service.getVisibleGraph.mockResolvedValue({
        identities: { [IDENTITY_A]: { name: 'Alex', gender: null } },
        unions: [
          {
            id: UNION_ID,
            status: 'partnered',
            partners: [knownParticipant(IDENTITY_A)],
            children: [],
          },
        ],
      });
      service.getMyRoot.mockResolvedValue(null);

      const { status, body } = await request(ctx.getHttpServer())
        .get('/family/unions')
        .set('Authorization', 'Bearer token');

      expect(status).toBe(200);
      expect(body.unions[0]).toHaveProperty('startDate', null);
      expect(body.unions[0]).toHaveProperty('endDate', null);
    });

    // E49 — a large graph is paginated with a stable order across pages. The mock deliberately
    // returns unions in a scrambled order (C, A, B) so this test fails if the controller merely
    // passes the service's order through instead of imposing its own stable (by-id) order.
    it('pages a large graph in a stable order', async () => {
      service.getVisibleGraph.mockResolvedValue({
        identities: {
          [IDENTITY_A]: { name: 'Alex', gender: null },
          [IDENTITY_B]: { name: 'Mia', gender: null },
        },
        unions: [
          { id: UNION_C, status: 'partnered', partners: [knownParticipant(IDENTITY_A)], children: [] },
          { id: UNION_A, status: 'partnered', partners: [knownParticipant(IDENTITY_A)], children: [] },
          { id: UNION_B, status: 'partnered', partners: [knownParticipant(IDENTITY_B)], children: [] },
        ],
      });
      service.getMyRoot.mockResolvedValue(null);

      const page1 = await request(ctx.getHttpServer())
        .get('/family/unions')
        .query({ page: 1, size: 2 })
        .set('Authorization', 'Bearer token');
      expect(page1.status).toBe(200);
      expect(page1.body.unions.map((u: { id: string }) => u.id)).toEqual([UNION_A, UNION_B]);
      expect(page1.body.hasNextPage).toBe(true);

      const page2 = await request(ctx.getHttpServer())
        .get('/family/unions')
        .query({ page: 2, size: 2 })
        .set('Authorization', 'Bearer token');
      expect(page2.status).toBe(200);
      expect(page2.body.unions.map((u: { id: string }) => u.id)).toEqual([UNION_C]);
      expect(page2.body.hasNextPage).toBe(false);
    });

    it('scopes identities to only those referenced by the returned page', async () => {
      service.getVisibleGraph.mockResolvedValue({
        identities: {
          [IDENTITY_A]: { name: 'Alex', gender: null },
          [IDENTITY_B]: { name: 'Mia', gender: null },
        },
        unions: [
          { id: UNION_A, status: 'partnered', partners: [knownParticipant(IDENTITY_A)], children: [] },
          { id: UNION_B, status: 'partnered', partners: [knownParticipant(IDENTITY_B)], children: [] },
        ],
      });
      service.getMyRoot.mockResolvedValue(null);

      const { status, body } = await request(ctx.getHttpServer())
        .get('/family/unions')
        .query({ page: 1, size: 1 })
        .set('Authorization', 'Bearer token');

      expect(status).toBe(200);
      expect(Object.keys(body.identities)).toEqual([IDENTITY_A]);
    });

    // D4 — labels are derived server-side from the projected graph and the caller's root.
    describe('relation labels', () => {
      it("labels a reachable person relative to the caller's root", async () => {
        service.getVisibleGraph.mockResolvedValue({
          identities: {
            [ROOT_ID]: { name: 'Root', gender: null },
            [CHILD_ID]: { name: 'Kid', gender: null },
          },
          unions: [
            {
              id: UNION_ROOT_CHILD,
              status: 'partnered',
              partners: [knownParticipant(ROOT_ID)],
              children: [knownParticipant(CHILD_ID)],
            },
          ],
        });
        service.getMyRoot.mockResolvedValue(ROOT_ID);

        const { status, body } = await request(ctx.getHttpServer())
          .get('/family/unions')
          .set('Authorization', 'Bearer token');

        expect(status).toBe(200);
        expect(body.identities[CHILD_ID].label).toBe('your child');
      });

      it('shows no label when no root is set', async () => {
        service.getVisibleGraph.mockResolvedValue({
          identities: {
            [ROOT_ID]: { name: 'Root', gender: null },
            [CHILD_ID]: { name: 'Kid', gender: null },
          },
          unions: [
            {
              id: UNION_ROOT_CHILD,
              status: 'partnered',
              partners: [knownParticipant(ROOT_ID)],
              children: [knownParticipant(CHILD_ID)],
            },
          ],
        });
        service.getMyRoot.mockResolvedValue(null);

        const { status, body } = await request(ctx.getHttpServer())
          .get('/family/unions')
          .set('Authorization', 'Bearer token');

        expect(status).toBe(200);
        expect(body.identities[CHILD_ID].label).toBeNull();
      });

      // The pair that matters: the SAME two people (ROOT_ID, TARGET_ID), each independently
      // visible via their own union, are related only through GRANDPARENT_ID's two parent
      // unions. When the union that makes GRANDPARENT_ID the TARGET's parent is absent from the
      // projected graph (as it would be if slice 5 withheld it from this viewer), the two
      // people's clusters are disconnected and no label is produced — a negative that would pass
      // just as well against an endpoint that never labels anything. The positive control below,
      // with that one union added back, is what proves the negative actually means something.
      it('shows no label when the only path runs through a union the viewer cannot see', async () => {
        service.getVisibleGraph.mockResolvedValue({
          identities: {
            [ROOT_ID]: { name: 'Root', gender: null },
            [GRANDPARENT_ID]: { name: 'Gramps', gender: null },
            [TARGET_ID]: { name: 'Target', gender: null },
            [TARGET_SPOUSE_ID]: { name: 'Spouse', gender: null },
          },
          unions: [
            {
              id: UNION_ROOT_PARENT,
              status: 'partnered',
              partners: [knownParticipant(GRANDPARENT_ID)],
              children: [knownParticipant(ROOT_ID)],
            },
            // UNION_TARGET_PARENT (GRANDPARENT_ID -> TARGET_ID) is deliberately OMITTED here.
            {
              id: UNION_TARGET_SPOUSE,
              status: 'partnered',
              partners: [knownParticipant(TARGET_ID), knownParticipant(TARGET_SPOUSE_ID)],
              children: [],
            },
          ],
        });
        service.getMyRoot.mockResolvedValue(ROOT_ID);

        const { status, body } = await request(ctx.getHttpServer())
          .get('/family/unions')
          .set('Authorization', 'Bearer token');

        expect(status).toBe(200);
        expect(body.identities[TARGET_ID].label).toBeNull();
      });

      it('labels the same person once the connecting union becomes visible', async () => {
        service.getVisibleGraph.mockResolvedValue({
          identities: {
            [ROOT_ID]: { name: 'Root', gender: null },
            [GRANDPARENT_ID]: { name: 'Gramps', gender: null },
            [TARGET_ID]: { name: 'Target', gender: null },
            [TARGET_SPOUSE_ID]: { name: 'Spouse', gender: null },
          },
          unions: [
            {
              id: UNION_ROOT_PARENT,
              status: 'partnered',
              partners: [knownParticipant(GRANDPARENT_ID)],
              children: [knownParticipant(ROOT_ID)],
            },
            {
              id: UNION_TARGET_PARENT,
              status: 'partnered',
              partners: [knownParticipant(GRANDPARENT_ID)],
              children: [knownParticipant(TARGET_ID)],
            },
            {
              id: UNION_TARGET_SPOUSE,
              status: 'partnered',
              partners: [knownParticipant(TARGET_ID), knownParticipant(TARGET_SPOUSE_ID)],
              children: [],
            },
          ],
        });
        service.getMyRoot.mockResolvedValue(ROOT_ID);

        const { status, body } = await request(ctx.getHttpServer())
          .get('/family/unions')
          .set('Authorization', 'Bearer token');

        expect(status).toBe(200);
        expect(body.identities[TARGET_ID].label).toBe('your half-sibling');
      });
    });
  });

  describe('GET /family/me', () => {
    it('should be an authenticated route', async () => {
      service.getMyRoot.mockResolvedValue(null);
      service.resolveFamilyAccess.mockResolvedValue(FamilyAccessLevel.None);
      await request(ctx.getHttpServer()).get('/family/me');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('returns the currently set root and effective access level', async () => {
      service.getMyRoot.mockResolvedValue(IDENTITY_A);
      service.resolveFamilyAccess.mockResolvedValue(FamilyAccessLevel.Contribute);

      const { status, body } = await request(ctx.getHttpServer())
        .get('/family/me')
        .set('Authorization', 'Bearer token');

      expect(status).toBe(200);
      expect(body).toEqual({ rootIdentityId: IDENTITY_A, access: 'contribute' });
    });

    it('returns a null rootIdentityId when no root has ever been set', async () => {
      service.getMyRoot.mockResolvedValue(null);
      service.resolveFamilyAccess.mockResolvedValue(FamilyAccessLevel.View);

      const { status, body } = await request(ctx.getHttpServer())
        .get('/family/me')
        .set('Authorization', 'Bearer token');

      expect(status).toBe(200);
      expect(body).toEqual({ rootIdentityId: null, access: 'view' });
    });
  });

  describe('POST /family/unions', () => {
    it('should be an authenticated route', async () => {
      service.createUnion.mockResolvedValue({ id: UNION_ID });
      await request(ctx.getHttpServer()).post('/family/unions').send({});
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('creates a union', async () => {
      service.createUnion.mockResolvedValue({ id: UNION_ID });
      const { status, body } = await request(ctx.getHttpServer())
        .post('/family/unions')
        .send({ partnerIds: [IDENTITY_A, IDENTITY_B] })
        .set('Authorization', 'Bearer token');

      expect(status).toBe(201);
      expect(body).toEqual({ id: UNION_ID });
      expect(service.createUnion).toHaveBeenCalledWith(undefined, {
        partnerIds: [IDENTITY_A, IDENTITY_B],
      });
    });

    // The paired negative case for the write-authority tests below: a view-only caller's request
    // reaches the service, which is what actually refuses it.
    it('rejects a write from a view-only caller', async () => {
      service.createUnion.mockRejectedValue(new ForbiddenException());

      const { status } = await request(ctx.getHttpServer())
        .post('/family/unions')
        .send({ partnerIds: [IDENTITY_A] })
        .set('Authorization', 'Bearer token');

      expect(status).toBe(403);
    });
  });

  describe('PUT /family/unions/:id', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).put(`/family/unions/${UNION_ID}`).send({});
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('updates a union', async () => {
      const { status } = await request(ctx.getHttpServer())
        .put(`/family/unions/${UNION_ID}`)
        .send({ status: 'divorced' })
        .set('Authorization', 'Bearer token');

      expect(status).toBe(204);
      expect(service.updateUnion).toHaveBeenCalledWith(undefined, UNION_ID, { status: 'divorced' });
    });
  });

  describe('DELETE /family/unions/:id', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).delete(`/family/unions/${UNION_ID}`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('deletes a union', async () => {
      const { status } = await request(ctx.getHttpServer())
        .delete(`/family/unions/${UNION_ID}`)
        .set('Authorization', 'Bearer token');

      expect(status).toBe(204);
      expect(service.deleteUnion).toHaveBeenCalledWith(undefined, UNION_ID);
    });
  });

  describe('PUT /family/unions/:id/participants', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).put(`/family/unions/${UNION_ID}/participants`).send({});
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('adds a participant', async () => {
      const { status } = await request(ctx.getHttpServer())
        .put(`/family/unions/${UNION_ID}/participants`)
        .send({ identityId: IDENTITY_A, role: 'child' })
        .set('Authorization', 'Bearer token');

      expect(status).toBe(204);
      expect(service.addParticipant).toHaveBeenCalledWith(undefined, UNION_ID, {
        identityId: IDENTITY_A,
        role: 'child',
      });
    });
  });

  describe('DELETE /family/unions/:id/participants/:identityId', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).delete(`/family/unions/${UNION_ID}/participants/${IDENTITY_A}`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('removes a participant', async () => {
      const { status } = await request(ctx.getHttpServer())
        .delete(`/family/unions/${UNION_ID}/participants/${IDENTITY_A}`)
        .set('Authorization', 'Bearer token');

      expect(status).toBe(204);
      expect(service.removeParticipant).toHaveBeenCalledWith(undefined, UNION_ID, IDENTITY_A);
    });
  });

  describe('GET /family/clusters', () => {
    it('should be an authenticated route', async () => {
      service.getClusters.mockResolvedValue([]);
      await request(ctx.getHttpServer()).get('/family/clusters');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('returns clusters', async () => {
      service.getClusters.mockResolvedValue([{ label: 'Marais', size: 12, rootCandidateId: IDENTITY_A }]);

      const { status, body } = await request(ctx.getHttpServer())
        .get('/family/clusters')
        .set('Authorization', 'Bearer token');

      expect(status).toBe(200);
      expect(body).toEqual([{ label: 'Marais', size: 12, rootCandidateId: IDENTITY_A }]);
    });
  });

  describe('PUT /family/me', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).put('/family/me').send({ identityId: null });
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('sets the viewer root', async () => {
      const { status } = await request(ctx.getHttpServer())
        .put('/family/me')
        .send({ identityId: IDENTITY_A })
        .set('Authorization', 'Bearer token');

      expect(status).toBe(204);
      expect(service.setMyRoot).toHaveBeenCalledWith(undefined, IDENTITY_A);
    });

    it('accepts a null identityId to clear the root', async () => {
      const { status } = await request(ctx.getHttpServer())
        .put('/family/me')
        .send({ identityId: null })
        .set('Authorization', 'Bearer token');

      expect(status).toBe(204);
      expect(service.setMyRoot).toHaveBeenCalledWith(undefined, null);
    });
  });

  describe('PUT /family/identities/:id/gender', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).put(`/family/identities/${IDENTITY_A}/gender`).send({ gender: null });
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('sets the gender', async () => {
      const { status } = await request(ctx.getHttpServer())
        .put(`/family/identities/${IDENTITY_A}/gender`)
        .send({ gender: 'female' })
        .set('Authorization', 'Bearer token');

      expect(status).toBe(204);
      expect(service.updateGender).toHaveBeenCalledWith(undefined, IDENTITY_A, 'female');
    });
  });

  // E50 — every read/write family endpoint responds 403, not 500, when the feature is disabled.
  // The two admin grant endpoints are deliberately excluded: they administer the feature itself
  // (including re-enabling it), and their authority is `admin: true` alone, never
  // `familyTree.enabled` — see the "admin-independent-of-family-level" tests below.
  describe('feature disabled (E50)', () => {
    it('refuses every non-admin family endpoint with 403 when the feature is disabled', async () => {
      service.getVisibleGraph.mockImplementation(forbidden);
      service.getClusters.mockImplementation(forbidden);
      service.createUnion.mockImplementation(forbidden);
      service.updateUnion.mockImplementation(forbidden);
      service.deleteUnion.mockImplementation(forbidden);
      service.addParticipant.mockImplementation(forbidden);
      service.removeParticipant.mockImplementation(forbidden);
      service.getMyRoot.mockImplementation(forbidden);
      service.resolveFamilyAccess.mockImplementation(forbidden);
      service.setMyRoot.mockImplementation(forbidden);
      service.updateGender.mockImplementation(forbidden);
      service.getPersonRelations.mockImplementation(forbidden);

      const server = ctx.getHttpServer();
      const bearer = 'Bearer token';

      // Sequential, not Promise.all: concurrent supertest requests against this app race for an
      // ephemeral port (issue #1042, noted in the slice plan) — that flake is unrelated to this
      // feature and must not be worked around by parallelizing here.
      const requests = [
        () => request(server).get('/family/unions').set('Authorization', bearer),
        () => request(server).get('/family/clusters').set('Authorization', bearer),
        () => request(server).post('/family/unions').send({}).set('Authorization', bearer),
        () => request(server).put(`/family/unions/${UNION_ID}`).send({}).set('Authorization', bearer),
        () => request(server).delete(`/family/unions/${UNION_ID}`).set('Authorization', bearer),
        () =>
          request(server)
            .put(`/family/unions/${UNION_ID}/participants`)
            .send({ identityId: IDENTITY_A, role: 'child' })
            .set('Authorization', bearer),
        () =>
          request(server).delete(`/family/unions/${UNION_ID}/participants/${IDENTITY_A}`).set('Authorization', bearer),
        () => request(server).get('/family/me').set('Authorization', bearer),
        () => request(server).put('/family/me').send({ identityId: null }).set('Authorization', bearer),
        () =>
          request(server)
            .put(`/family/identities/${IDENTITY_A}/gender`)
            .send({ gender: null })
            .set('Authorization', bearer),
        () => request(server).get(`/family/people/${IDENTITY_A}/relations`).set('Authorization', bearer),
      ];

      for (const makeRequest of requests) {
        const response = await makeRequest();
        expect(response.status).toBe(403);
      }
    });
  });

  describe('GET /family/access', () => {
    it('should be an authenticated route', async () => {
      service.getAllAccessGrants.mockResolvedValue([]);
      await request(ctx.getHttpServer()).get('/family/access');
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('returns every access grant', async () => {
      service.getAllAccessGrants.mockResolvedValue([
        {
          userId: USER_ID,
          level: FamilyAccessLevel.Contribute,
          grantedById: authStub.admin.user.id,
          grantedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const { status, body } = await request(ctx.getHttpServer())
        .get('/family/access')
        .set('Authorization', 'Bearer token');

      expect(status).toBe(200);
      expect(body).toEqual([
        {
          userId: USER_ID,
          level: 'contribute',
          grantedById: authStub.admin.user.id,
          grantedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
    });

    it('rejects a non-admin caller, even one with contribute', async () => {
      ctx.authenticate.mockRejectedValue(new ForbiddenException());

      const { status } = await request(ctx.getHttpServer()).get('/family/access').set('Authorization', 'Bearer token');

      expect(status).toBe(403);
      expect(service.getAllAccessGrants).not.toHaveBeenCalled();
    });
  });

  describe('PUT /family/access/:userId', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).put(`/family/access/${USER_ID}`).send({ level: 'view' });
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    // The refusal above (a non-admin with contribute gets 403) is only meaningful next to this
    // positive control: an admin who has never touched the family feature — no access mock
    // configured for them at all — must still be able to administer someone else's grant. This
    // is what proves the gate is `admin: true` and not "admin AND has family access".
    it('rejects a grant change from a non-admin, even one with contribute', async () => {
      ctx.authenticate.mockRejectedValue(new ForbiddenException());

      const { status } = await request(ctx.getHttpServer())
        .put(`/family/access/${USER_ID}`)
        .send({ level: 'contribute' })
        .set('Authorization', 'Bearer token');

      expect(status).toBe(403);
      expect(service.setAccessGrant).not.toHaveBeenCalled();
    });

    it('accepts a grant change from an admin who has no family access of their own', async () => {
      ctx.authenticate.mockResolvedValue(authStub.admin);
      service.setAccessGrant.mockResolvedValue({
        userId: USER_ID,
        level: FamilyAccessLevel.Contribute,
        grantedById: authStub.admin.user.id,
        grantedAt: '2026-01-01T00:00:00.000Z',
      });

      const { status, body } = await request(ctx.getHttpServer())
        .put(`/family/access/${USER_ID}`)
        .send({ level: 'contribute' })
        .set('Authorization', 'Bearer token');

      expect(status).toBe(200);
      expect(body).toEqual({
        userId: USER_ID,
        level: 'contribute',
        grantedById: authStub.admin.user.id,
        grantedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(service.setAccessGrant).toHaveBeenCalledWith(authStub.admin, USER_ID, 'contribute');
      // Nothing about this admin's OWN family access was ever consulted.
      expect(service.resolveFamilyAccess).not.toHaveBeenCalled();
      expect(service.requireFamilyRead).not.toHaveBeenCalled();
      expect(service.requireFamilyWrite).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /family/access/:userId', () => {
    it('should be an authenticated route', async () => {
      await request(ctx.getHttpServer()).delete(`/family/access/${USER_ID}`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('rejects a non-admin caller, even one with contribute', async () => {
      ctx.authenticate.mockRejectedValue(new ForbiddenException());

      const { status } = await request(ctx.getHttpServer())
        .delete(`/family/access/${USER_ID}`)
        .set('Authorization', 'Bearer token');

      expect(status).toBe(403);
      expect(service.deleteAccessGrant).not.toHaveBeenCalled();
    });

    // Paired positive control, same shape as the other two grant endpoints: an admin with no
    // family access mock configured at all still succeeds.
    it('accepts a deletion from an admin who has no family access of their own', async () => {
      ctx.authenticate.mockResolvedValue(authStub.admin);

      const { status } = await request(ctx.getHttpServer())
        .delete(`/family/access/${USER_ID}`)
        .set('Authorization', 'Bearer token');

      expect(status).toBe(204);
      expect(service.deleteAccessGrant).toHaveBeenCalledWith(USER_ID);
      expect(service.resolveFamilyAccess).not.toHaveBeenCalled();
      expect(service.requireFamilyRead).not.toHaveBeenCalled();
      expect(service.requireFamilyWrite).not.toHaveBeenCalled();
    });
  });

  describe('GET /family/people/:personId/relations', () => {
    it('should be an authenticated route', async () => {
      service.getPersonRelations.mockResolvedValue([]);
      await request(ctx.getHttpServer()).get(`/family/people/${IDENTITY_A}/relations`);
      expect(ctx.authenticate).toHaveBeenCalled();
    });

    it('wraps the relations in a { relations } envelope', async () => {
      service.getPersonRelations.mockResolvedValue([{ person: null, anonymousSlot: 2, relation: 'parent' }] as any);

      const { status, body } = await request(ctx.getHttpServer())
        .get(`/family/people/${IDENTITY_A}/relations`)
        .set('Authorization', 'Bearer token');

      expect(status).toBe(200);
      expect(body).toEqual({ relations: [{ person: null, anonymousSlot: 2, relation: 'parent' }] });
      expect(service.getPersonRelations).toHaveBeenCalledWith(undefined, IDENTITY_A);
    });
  });

  describe('validation', () => {
    it('rejects a non-uuid union id', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .put('/family/unions/not-a-uuid')
        .send({})
        .set('Authorization', 'Bearer token');

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });

    it('rejects more than two partnerIds', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post('/family/unions')
        .send({ partnerIds: [IDENTITY_A, IDENTITY_B, IDENTITY_A] })
        .set('Authorization', 'Bearer token');

      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: ['partnerIds'], message: 'Too big: expected array to have <=2 items' }]),
      );
    });
  });
});
