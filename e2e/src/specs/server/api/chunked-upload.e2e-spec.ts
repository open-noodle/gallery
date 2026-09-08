import { AssetMediaStatus, LoginResponseDto } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { makeRandomImage } from 'src/generators';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Protocol-level coverage for the chunked/resumable upload session endpoints.
 *
 * Note these tests choose their own chunk sizes rather than reconfiguring the server. The server
 * enforces no chunk size — it accepts any chunk whose `Upload-Offset` matches the committed size
 * and whose total stays within `Upload-Length` — so small fixtures exercise the full protocol.
 */
const iso = () => new Date().toISOString();

const patch = (token: string, id: string, offset: number, chunk: Buffer) =>
  request(app)
    .patch(`/assets/upload-session/${id}`)
    .set({
      Authorization: `Bearer ${token}`,
      'Upload-Offset': String(offset),
      'Content-Type': 'application/offset+octet-stream',
    })
    .send(chunk);

const createSession = (token: string, body: Record<string, unknown>) =>
  request(app).post('/assets/upload-session').set('Authorization', `Bearer ${token}`).send({
    filename: 'chunked.png',
    fileCreatedAt: iso(),
    fileModifiedAt: iso(),
    ...body,
  });

describe('/assets/upload-session', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    user = await utils.userSetup(admin.accessToken, createUserDto.user1);
  });

  describe('happy path', () => {
    it('uploads a file as three unequal chunks and creates a readable asset', async () => {
      const payload = Buffer.concat([Buffer.from('chunked-upload-e2e-'), Buffer.alloc(600, 9)]);
      const { body: session, status } = await createSession(admin.accessToken, { size: payload.length });
      expect(status).toBe(201);
      expect(session.offset).toBe(0);

      const cuts = [0, 100, 450, payload.length];
      let final;
      for (let i = 0; i < cuts.length - 1; i++) {
        const response = await patch(admin.accessToken, session.id, cuts[i], payload.subarray(cuts[i], cuts[i + 1]));
        if (i < cuts.length - 2) {
          expect(response.status).toBe(204);
          expect(Number(response.headers['upload-offset'])).toBe(cuts[i + 1]);
        } else {
          expect([200, 201]).toContain(response.status);
          final = response.body;
        }
      }

      expect(final.status).toBe(AssetMediaStatus.Created);
      expect(final.id).toBeDefined();

      const asset = await utils.getAssetInfo(admin.accessToken, final.id);
      expect(asset.id).toBe(final.id);
    });
  });

  describe('offset negotiation', () => {
    it('rejects an offset ahead of the committed size and reports the real offset', async () => {
      const payload = Buffer.alloc(200, 1);
      const { body: session } = await createSession(admin.accessToken, { size: payload.length });

      await patch(admin.accessToken, session.id, 0, payload.subarray(0, 50));

      const { status, body } = await patch(admin.accessToken, session.id, 120, payload.subarray(120, 160));
      expect(status).toBe(409);
      expect(body.offset ?? body.message).toBeDefined();
    });

    it('rejects a replayed chunk that is behind the committed size', async () => {
      const payload = Buffer.alloc(200, 2);
      const { body: session } = await createSession(admin.accessToken, { size: payload.length });

      await patch(admin.accessToken, session.id, 0, payload.subarray(0, 100));
      const { status } = await patch(admin.accessToken, session.id, 0, payload.subarray(0, 100));
      expect(status).toBe(409);
    });

    it('reports the committed offset over HEAD', async () => {
      const payload = Buffer.alloc(120, 3);
      const { body: session } = await createSession(admin.accessToken, { size: payload.length });
      await patch(admin.accessToken, session.id, 0, payload.subarray(0, 70));

      const { status, headers } = await request(app)
        .head(`/assets/upload-session/${session.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(Number(headers['upload-offset'])).toBe(70);
      expect(Number(headers['upload-length'])).toBe(payload.length);
    });
  });

  describe('lifecycle', () => {
    it('aborts a session so later chunks are rejected', async () => {
      const payload = Buffer.alloc(100, 4);
      const { body: session } = await createSession(admin.accessToken, { size: payload.length });
      await patch(admin.accessToken, session.id, 0, payload.subarray(0, 40));

      const { status: deleteStatus } = await request(app)
        .delete(`/assets/upload-session/${session.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(deleteStatus).toBe(204);

      const { status } = await patch(admin.accessToken, session.id, 40, payload.subarray(40, 80));
      expect(status).toBe(404);
    });

    it('does not expose another user’s session', async () => {
      const payload = Buffer.alloc(50, 5);
      const { body: session } = await createSession(admin.accessToken, { size: payload.length });

      const { status } = await request(app)
        .head(`/assets/upload-session/${session.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(status).toBe(404);
    });
  });

  describe('validation', () => {
    it('rejects a create body using the multipart string forms', async () => {
      const { status } = await createSession(admin.accessToken, { size: 10, isFavorite: 'false' });
      expect(status).toBe(400);
    });

    it('rejects metadata sent as a JSON string', async () => {
      const { status } = await createSession(admin.accessToken, { size: 10, metadata: '[]' });
      expect(status).toBe(400);
    });

    it('rejects a non-positive size', async () => {
      const { status } = await createSession(admin.accessToken, { size: 0 });
      expect(status).toBe(400);
    });

    it('rejects a chunk whose content type is not application/offset+octet-stream', async () => {
      const { body: session } = await createSession(admin.accessToken, { size: 10 });
      const { status } = await request(app)
        .patch(`/assets/upload-session/${session.id}`)
        .set({
          Authorization: `Bearer ${admin.accessToken}`,
          'Upload-Offset': '0',
          'Content-Type': 'application/json',
        })
        .send({ nope: true });
      expect(status).toBe(415);
    });

    it('requires authentication', async () => {
      const { status } = await request(app).post('/assets/upload-session').send({ size: 10 });
      expect(status).toBe(401);
    });
  });

  describe('parity with single-shot upload', () => {
    it('produces the same checksum and filename as the multipart endpoint for identical bytes', async () => {
      // The SAME bytes, uploaded by two different users so the per-owner checksum constraint does
      // not turn the second one into a duplicate. If the chunked path assembled the file wrongly —
      // a bad offset, a dropped or doubled chunk — the checksums would diverge.
      const payload = makeRandomImage();

      const single = await utils.createAsset(admin.accessToken, {
        assetData: { bytes: payload, filename: 'parity.png' },
      });
      const chunked = await utils.createAsset(
        user.accessToken,
        { assetData: { bytes: payload, filename: 'parity.png' } },
        { chunked: true },
      );

      const [a, b] = await Promise.all([
        utils.getAssetInfo(admin.accessToken, single.id),
        utils.getAssetInfo(user.accessToken, chunked.id),
      ]);

      expect(b.checksum).toBe(a.checksum);
      expect(b.originalFileName).toBe(a.originalFileName);
      expect(b.type).toBe(a.type);
    });
  });
});
