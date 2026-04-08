import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// T32 — read-only coverage for /plugins (plugin.controller.ts).
//
// Service shape (plugin.service.ts:61-72):
//   - GET /plugins      → list ALL loaded plugins (no per-user scoping)
//   - GET /plugins/triggers → static list from src/plugins
//   - GET /plugins/:id  → single plugin or BadRequestException 'Plugin not found'
//
// All three endpoints require Permission.PluginRead but no admin gate.
//
// The fork bundles a core plugin manifest at `plugins/manifest.json` named
// `immich-core` with three filters (filterFileName, filterFileType,
// filterPerson) and three actions (actionArchive, actionFavorite,
// actionAddToAlbum). T32 pins that this plugin is loaded and exposed via the
// API. (Note: classification, pet-detection, OCR, etc. are services in
// src/services/, NOT extism plugins — the backlog assumption was wrong.)

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

    it('the immich-core plugin is loaded with the expected filters and actions', async () => {
      // The fork bundles `plugins/manifest.json` (name: 'immich-core'). It has
      // filterFileName/filterFileType/filterPerson and actionArchive/
      // actionFavorite/actionAddToAlbum. Pin them here so a future change to
      // the bundled manifest forces a deliberate test update.
      const { body } = await request(app).get('/plugins').set(asBearerAuth(admin.accessToken));
      const plugins = body as Array<{
        name: string;
        filters: Array<{ methodName: string }>;
        actions: Array<{ methodName: string }>;
      }>;
      const core = plugins.find((p) => p.name === 'immich-core');
      expect(core).toBeDefined();

      const filterNames = core!.filters.map((f) => f.methodName);
      expect(filterNames).toEqual(expect.arrayContaining(['filterFileName', 'filterFileType', 'filterPerson']));

      const actionNames = core!.actions.map((a) => a.methodName);
      expect(actionNames).toEqual(expect.arrayContaining(['actionArchive', 'actionFavorite', 'actionAddToAlbum']));
    });
  });

  describe('GET /plugins/triggers', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/plugins/triggers').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('returns the static trigger list (AssetCreate + PersonRecognized)', async () => {
      const { status, body } = await request(app).get('/plugins/triggers').set(asBearerAuth(user.accessToken));
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      // server/src/plugins.ts exports two trigger types: AssetCreate (wired
      // through plugin.service.handleAssetCreate at line 173) and
      // PersonRecognized (declared but the handler at line 237 is unimplemented
      // and currently returns Skipped). Both must appear in the static list.
      // Pin BOTH so a future removal of either prompts a deliberate update.
      const types = (body as Array<{ type: string }>).map((t) => t.type);
      expect(types).toEqual(expect.arrayContaining(['AssetCreate', 'PersonRecognized']));
    });
  });

  describe('GET /plugins/:id', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .get('/plugins/00000000-0000-4000-a000-000000000099')
        .set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('returns the core plugin by id', async () => {
      // Resolve the core plugin id via the listing endpoint, then fetch it
      // directly. The single-fetch endpoint returns the same shape.
      const list = await request(app).get('/plugins').set(asBearerAuth(user.accessToken));
      const core = (list.body as Array<{ id: string; name: string }>).find((p) => p.name === 'immich-core');
      expect(core).toBeDefined();

      const { status, body } = await request(app).get(`/plugins/${core!.id}`).set(asBearerAuth(user.accessToken));
      expect(status).toBe(200);
      expect((body as { id: string; name: string }).name).toBe('immich-core');
    });

    it('non-existent plugin returns 400', async () => {
      // plugin.service.ts:66-70 throws BadRequestException('Plugin not found').
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
