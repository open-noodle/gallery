import { WorkflowTrigger, type LoginResponseDto } from '@immich/sdk';
import { authHeaders, type Actor } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Read-only coverage for /plugins (plugin.controller.ts).
//
// Service shape:
//   - GET /plugins      → list ALL loaded plugins (no per-user scoping)
//   - GET /plugins/methods → list methods, optionally filtered by trigger/type
//   - GET /plugins/:id  → single plugin or BadRequestException 'Plugin not found'
//
// All three endpoints require Permission.PluginRead but no admin gate.

describe('/plugins', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    user = await utils.userSetup(admin.accessToken, createUserDto.create('t32-user'));
  });

  describe('GET /plugins', () => {
    it('requires authentication', async () => {
      const { status, body } = await request(app).get('/plugins').set(authHeaders(anonActor));
      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('regular user can list plugins (no admin gate)', async () => {
      const { status, body } = await request(app).get('/plugins').set(asBearerAuth(user.accessToken));
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it('returns the current plugin response shape', async () => {
      const { status, body } = await request(app).get('/plugins').set(asBearerAuth(admin.accessToken));
      expect(status).toBe(200);

      const plugins = body as Array<{
        name: string;
        methods: Array<{ key: string; name: string; types: string[] }>;
      }>;
      for (const plugin of plugins) {
        expect(plugin.name).toEqual(expect.any(String));
        expect(Array.isArray(plugin.methods)).toBe(true);
      }
    });
  });

  describe('GET /plugins/methods', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/plugins/methods').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('returns plugin methods', async () => {
      const { status, body } = await request(app).get('/plugins/methods').set(asBearerAuth(user.accessToken));
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it('filters plugin methods by workflow trigger', async () => {
      const { status, body } = await request(app)
        .get('/plugins/methods')
        .query({ trigger: WorkflowTrigger.AssetCreate })
        .set(asBearerAuth(user.accessToken));
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe('GET /plugins/:id', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .get('/plugins/00000000-0000-4000-a000-000000000099')
        .set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('non-existent plugin returns 400', async () => {
      const { status } = await request(app)
        .get('/plugins/00000000-0000-4000-a000-000000000099')
        .set(asBearerAuth(user.accessToken));
      expect(status).toBe(400);
    });

    it('malformed plugin id returns 400', async () => {
      const { status } = await request(app).get('/plugins/not-a-uuid').set(asBearerAuth(user.accessToken));
      expect(status).toBe(400);
    });
  });
});
