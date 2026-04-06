import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// T36 — coverage for the new admin `/queues/*` controller (queue.controller.ts).
// The existing `jobs.e2e-spec.ts` covers the deprecated `/jobs/*` controller
// only. The new controller landed in v2.4.0 and is admin-only across all routes.
//
// Service shape (queue.service.ts) is admin-gated via @Authenticated, so all
// routes return 401 for anon and 403 for non-admin.

describe('/queues', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    user = await utils.userSetup(admin.accessToken, createUserDto.create('t36-user'));
  });

  describe('GET /queues', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/queues').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('non-admin returns 403', async () => {
      const { status } = await request(app).get('/queues').set(asBearerAuth(user.accessToken));
      expect(status).toBe(403);
    });

    it('admin gets the list of queues', async () => {
      const { status, body } = await request(app).get('/queues').set(asBearerAuth(admin.accessToken));
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      // The classification queue is fork-bundled (PR #190), thumbnailGeneration
      // is upstream. Pin both.
      const names = (body as Array<{ name: string }>).map((q) => q.name);
      expect(names).toContain('thumbnailGeneration');
      expect(names).toContain('classification');
    });
  });

  describe('GET /queues/:name', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/queues/thumbnailGeneration').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('non-admin returns 403', async () => {
      const { status } = await request(app).get('/queues/thumbnailGeneration').set(asBearerAuth(user.accessToken));
      expect(status).toBe(403);
    });

    it('admin can fetch a specific queue', async () => {
      const { status, body } = await request(app)
        .get('/queues/thumbnailGeneration')
        .set(asBearerAuth(admin.accessToken));
      expect(status).toBe(200);
      expect((body as { name: string }).name).toBe('thumbnailGeneration');
    });

    it('invalid queue name returns 400 (DTO enum validation)', async () => {
      const { status } = await request(app).get('/queues/notARealQueue').set(asBearerAuth(admin.accessToken));
      expect(status).toBe(400);
    });
  });

  describe('PUT /queues/:name', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .put('/queues/thumbnailGeneration')
        .set(authHeaders(anonActor))
        .send({ isPaused: false });
      expect(status).toBe(401);
    });

    it('non-admin returns 403', async () => {
      const { status } = await request(app)
        .put('/queues/thumbnailGeneration')
        .set(asBearerAuth(user.accessToken))
        .send({ isPaused: false });
      expect(status).toBe(403);
    });

    it('admin can pause and unpause a queue', async () => {
      // Pause, then unpause. Asserting both round-trips because we want to
      // leave the queue in its starting state for downstream tests.
      try {
        const pause = await request(app)
          .put('/queues/thumbnailGeneration')
          .set(asBearerAuth(admin.accessToken))
          .send({ isPaused: true });
        expect(pause.status).toBe(200);
        expect((pause.body as { isPaused?: boolean }).isPaused).toBe(true);

        const get = await request(app).get('/queues/thumbnailGeneration').set(asBearerAuth(admin.accessToken));
        expect((get.body as { isPaused?: boolean }).isPaused).toBe(true);
      } finally {
        const resume = await request(app)
          .put('/queues/thumbnailGeneration')
          .set(asBearerAuth(admin.accessToken))
          .send({ isPaused: false });
        expect(resume.status).toBe(200);
        expect((resume.body as { isPaused?: boolean }).isPaused).toBe(false);
      }
    });
  });

  describe('GET /queues/:name/jobs', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/queues/thumbnailGeneration/jobs').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('non-admin returns 403', async () => {
      const { status } = await request(app).get('/queues/thumbnailGeneration/jobs').set(asBearerAuth(user.accessToken));
      expect(status).toBe(403);
    });

    it('admin can list jobs (typically empty in a fresh test stack)', async () => {
      const { status, body } = await request(app)
        .get('/queues/thumbnailGeneration/jobs')
        .set(asBearerAuth(admin.accessToken));
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  });

  describe('DELETE /queues/:name/jobs', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .delete('/queues/thumbnailGeneration/jobs')
        .set(authHeaders(anonActor))
        .send({});
      expect(status).toBe(401);
    });

    it('non-admin returns 403', async () => {
      const { status } = await request(app)
        .delete('/queues/thumbnailGeneration/jobs')
        .set(asBearerAuth(user.accessToken))
        .send({});
      expect(status).toBe(403);
    });

    it('admin can empty a queue (204)', async () => {
      const { status } = await request(app)
        .delete('/queues/thumbnailGeneration/jobs')
        .set(asBearerAuth(admin.accessToken))
        .send({});
      expect(status).toBe(204);
    });

    it('admin can empty a queue including failed jobs', async () => {
      const { status } = await request(app)
        .delete('/queues/thumbnailGeneration/jobs')
        .set(asBearerAuth(admin.accessToken))
        .send({ failed: true });
      expect(status).toBe(204);
    });
  });
});
