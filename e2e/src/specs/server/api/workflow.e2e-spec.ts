import { PluginTriggerType, type LoginResponseDto } from '@immich/sdk';
import { authHeaders, type Actor } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Coverage for the fork-only /workflows controller (workflow.controller.ts).
//
// Service shape (workflow.service.ts):
//   - create: validates triggerType + per-plugin filter/action IDs (400 on bad ID)
//   - getAll: scoped to auth.user.id (owner-only)
//   - get/update/delete: requireAccess(WorkflowRead/Update/Delete) → 400 for non-owner
//     (bulk-access pattern)
//   - update with no fields → BadRequestException('No fields to update')
//
// Workflows are per-user — there's no concept of sharing them across spaces
// or with partners. Cross-user access is uniformly rejected at the access layer.

// Helper: create an empty workflow (no filters/actions). The service supports
// empty arrays — `validateAndMap*` for-loops are no-ops with zero items. Pure
// (token + name as args), hoisted to file scope.
const createEmptyWorkflow = async (token: string, name: string) =>
  request(app).post('/workflows').set(asBearerAuth(token)).send({
    triggerType: PluginTriggerType.AssetCreate,
    name,
    filters: [],
    actions: [],
  });

describe('/workflows', () => {
  let admin: LoginResponseDto;
  let userA: LoginResponseDto;
  let userB: LoginResponseDto;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [userA, userB] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t22-userA')),
      utils.userSetup(admin.accessToken, createUserDto.create('t22-userB')),
    ]);
  });

  describe('POST /workflows', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).post('/workflows').set(authHeaders(anonActor)).send({});
      expect(status).toBe(401);
    });

    it('creates a workflow with empty filters and actions', async () => {
      const { status, body } = await createEmptyWorkflow(userA.accessToken, 'first');
      expect(status).toBe(201);
      const wf = body as { id: string; name: string; ownerId: string; triggerType: string; enabled: boolean };
      expect(wf.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(wf.name).toBe('first');
      expect(wf.ownerId).toBe(userA.userId);
      expect(wf.triggerType).toBe('AssetCreate');
      expect(wf.enabled).toBe(true); // service default at line 30
    });

    it('rejects an invalid trigger type with 400', async () => {
      const { status } = await request(app).post('/workflows').set(asBearerAuth(userA.accessToken)).send({
        triggerType: 'NotAValidTrigger',
        name: 'bad-trigger',
        filters: [],
        actions: [],
      });
      expect(status).toBe(400);
    });

    it('rejects an invalid pluginFilterId with 400', async () => {
      const { status, body } = await request(app)
        .post('/workflows')
        .set(asBearerAuth(userA.accessToken))
        .send({
          triggerType: PluginTriggerType.AssetCreate,
          name: 'bad-filter',
          filters: [{ pluginFilterId: '00000000-0000-4000-a000-000000000099' }],
          actions: [],
        });
      expect(status).toBe(400);
      // Service throws `BadRequestException('Invalid filter ID: ...')`
      expect((body as { message: string }).message).toMatch(/filter/i);
    });

    it('rejects an empty name with 400 (DTO @IsNotEmpty)', async () => {
      const { status } = await request(app).post('/workflows').set(asBearerAuth(userA.accessToken)).send({
        triggerType: PluginTriggerType.AssetCreate,
        name: '',
        filters: [],
        actions: [],
      });
      expect(status).toBe(400);
    });
  });

  describe('GET /workflows', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/workflows').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it("returns only the caller's workflows (owner-scoped)", async () => {
      // userA created at least one workflow above; userB has none. Listing as
      // userB returns an empty array even though userA's workflow exists.
      const aRes = await request(app).get('/workflows').set(asBearerAuth(userA.accessToken));
      const bRes = await request(app).get('/workflows').set(asBearerAuth(userB.accessToken));
      expect(aRes.status).toBe(200);
      expect(bRes.status).toBe(200);
      expect((aRes.body as unknown[]).length).toBeGreaterThanOrEqual(1);
      // userB has no workflows
      expect(bRes.body).toEqual([]);
    });
  });

  describe('GET /workflows/:id', () => {
    it('owner can fetch their workflow', async () => {
      const create = await createEmptyWorkflow(userA.accessToken, 'fetch-me');
      const id = (create.body as { id: string }).id;

      const { status, body } = await request(app).get(`/workflows/${id}`).set(asBearerAuth(userA.accessToken));
      expect(status).toBe(200);
      expect((body as { id: string; name: string }).name).toBe('fetch-me');
    });

    it('cross-user GET returns 400 (requireAccess bulk-access)', async () => {
      const create = await createEmptyWorkflow(userA.accessToken, 'private');
      const id = (create.body as { id: string }).id;

      const { status } = await request(app).get(`/workflows/${id}`).set(asBearerAuth(userB.accessToken));
      expect(status).toBe(400);
    });

    it('non-existent workflow ID returns 400 (bulk-access pattern, not 404)', async () => {
      const { status } = await request(app)
        .get('/workflows/00000000-0000-4000-a000-000000000099')
        .set(asBearerAuth(userA.accessToken));
      expect(status).toBe(400);
    });
  });

  describe('PUT /workflows/:id', () => {
    it('owner can rename their workflow', async () => {
      const create = await createEmptyWorkflow(userA.accessToken, 'old-name');
      const id = (create.body as { id: string }).id;

      const { status, body } = await request(app)
        .put(`/workflows/${id}`)
        .set(asBearerAuth(userA.accessToken))
        .send({ name: 'new-name' });
      expect(status).toBe(200);
      expect((body as { name: string }).name).toBe('new-name');
    });

    it('rejects an empty update body with 400 (No fields to update)', async () => {
      const create = await createEmptyWorkflow(userA.accessToken, 'empty-put');
      const id = (create.body as { id: string }).id;

      const { status, body } = await request(app).put(`/workflows/${id}`).set(asBearerAuth(userA.accessToken)).send({});
      expect(status).toBe(400);
      expect((body as { message: string }).message).toMatch(/no fields/i);
    });

    it('cross-user PUT returns 400 and the workflow is unchanged', async () => {
      const create = await createEmptyWorkflow(userA.accessToken, 'cross-update');
      const id = (create.body as { id: string }).id;

      const { status } = await request(app)
        .put(`/workflows/${id}`)
        .set(asBearerAuth(userB.accessToken))
        .send({ name: 'attempted-rename' });
      expect(status).toBe(400);

      // Verify the workflow's name is still 'cross-update' — a leaking fix
      // could return 400 to the caller while still mutating state. The
      // follow-up GET as the owner pins that the rename did NOT happen.
      const followup = await request(app).get(`/workflows/${id}`).set(asBearerAuth(userA.accessToken));
      expect(followup.status).toBe(200);
      expect((followup.body as { name: string }).name).toBe('cross-update');
    });
  });

  describe('DELETE /workflows/:id', () => {
    it('owner can delete their workflow', async () => {
      const create = await createEmptyWorkflow(userA.accessToken, 'to-delete');
      const id = (create.body as { id: string }).id;

      const { status } = await request(app).delete(`/workflows/${id}`).set(asBearerAuth(userA.accessToken));
      expect(status).toBe(204);

      // Verify the workflow is gone — subsequent GET returns 400 (bulk-access)
      const followup = await request(app).get(`/workflows/${id}`).set(asBearerAuth(userA.accessToken));
      expect(followup.status).toBe(400);
    });

    it('cross-user DELETE returns 400 and the workflow still exists', async () => {
      const create = await createEmptyWorkflow(userA.accessToken, 'cross-delete');
      const id = (create.body as { id: string }).id;

      const { status } = await request(app).delete(`/workflows/${id}`).set(asBearerAuth(userB.accessToken));
      expect(status).toBe(400);

      // Verify the workflow still exists for the owner — same defensive check
      // as the cross-user PUT test above. Confirms 400 to caller AND no
      // mutation behind the scenes.
      const followup = await request(app).get(`/workflows/${id}`).set(asBearerAuth(userA.accessToken));
      expect(followup.status).toBe(200);
      expect((followup.body as { name: string }).name).toBe('cross-delete');
    });
  });
});
