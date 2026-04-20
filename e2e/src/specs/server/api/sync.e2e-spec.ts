import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// T38 — coverage for the /sync controller (sync.controller.ts). The mobile app
// is the primary consumer; there's no existing e2e coverage.
//
// Endpoints:
//   POST /sync/stream      (current)
//   GET  /sync/ack
//   POST /sync/ack
//   DELETE /sync/ack
// (POST /sync/full-sync and /sync/delta-sync removed upstream; tests dropped.)
//
// All routes require authentication. The full/delta endpoints are user-scoped
// and respect the partner timeline graph; the stream endpoint emits jsonl.

describe('/sync', () => {
  let admin: LoginResponseDto;
  let userA: LoginResponseDto;
  let userB: LoginResponseDto;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    [userA, userB] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t38-userA')),
      utils.userSetup(admin.accessToken, createUserDto.create('t38-userB')),
    ]);

    // Stream tests need each user to own at least one asset so the response
    // body is non-empty.
    await Promise.all([utils.createAsset(userA.accessToken), utils.createAsset(userB.accessToken)]);
  });

  describe('POST /sync/stream', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .post('/sync/stream')
        .set(authHeaders(anonActor))
        .send({ types: ['UsersV1'] });
      expect(status).toBe(401);
    });

    it('returns content-type application/jsonlines+json with at least one line', async () => {
      // The stream endpoint emits one JSON object per line. supertest tries to
      // auto-parse JSON unless we override the parser, so we install a custom
      // buffered parser that just collects bytes.
      const { status, headers, body } = await request(app)
        .post('/sync/stream')
        .set(asBearerAuth(userA.accessToken))
        .send({ types: ['UsersV1'], reset: true })
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            callback(null, data);
          });
        });
      expect(status).toBe(200);
      expect(headers['content-type']).toContain('application/jsonlines+json');
      const text = body as unknown as string;
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
      // Each line is a valid JSON object — verify by parsing the first one.
      const firstLine = text.split('\n').find((line) => line.trim().length > 0);
      expect(firstLine).toBeDefined();
      expect(() => JSON.parse(firstLine!)).not.toThrow();
    });

    it('rejects an invalid SyncRequestType enum value', async () => {
      const { status } = await request(app)
        .post('/sync/stream')
        .set(asBearerAuth(userA.accessToken))
        .send({ types: ['NotARealType'] });
      // SyncStreamDto.types has @ValidateEnum, so validation fires in the
      // global ValidationPipe BEFORE sync.controller.getSyncStream's body is
      // entered. The controller's try/catch (which is intended for in-stream
      // service errors) is NOT exercised here — the 400 comes cleanly from the
      // global exception filter with the standard JSON content type.
      expect(status).toBe(400);
    });
  });

  describe('GET /sync/ack', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get('/sync/ack').set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it("returns the user's ack list (initially empty)", async () => {
      // Strong assertion: a fresh user has no acks. Asserting `toEqual([])`
      // pins the empty initial state — `Array.isArray` alone would pass even
      // if the endpoint returned a non-empty leak from another user.
      const { status, body } = await request(app).get('/sync/ack').set(asBearerAuth(userA.accessToken));
      expect(status).toBe(200);
      expect(body).toEqual([]);
    });
  });

  describe('POST /sync/ack', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .post('/sync/ack')
        .set(authHeaders(anonActor))
        .send({ acks: ['UserV1|2024-01-01T00:00:00Z'] });
      expect(status).toBe(401);
    });

    it('rejects acks > 1000 (ArrayMaxSize)', async () => {
      const { status } = await request(app)
        .post('/sync/ack')
        .set(asBearerAuth(userA.accessToken))
        .send({ acks: Array.from({ length: 1001 }, (_, i) => `UserV1|${i}`) });
      expect(status).toBe(400);
    });
  });

  describe('DELETE /sync/ack', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).delete('/sync/ack').set(authHeaders(anonActor)).send({});
      expect(status).toBe(401);
    });

    it('owner can delete (no-op when none exist) — 204', async () => {
      // The delete endpoint accepts an optional `types` array. Without it, all
      // acks for the caller are removed. With no acks present, the call still
      // returns 204.
      const { status } = await request(app).delete('/sync/ack').set(asBearerAuth(userA.accessToken)).send({});
      expect(status).toBe(204);
    });
  });
});
