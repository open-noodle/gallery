import { type LoginResponseDto } from '@immich/sdk';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Socket } from 'socket.io-client';
import { createUserDto } from 'src/fixtures.js';
import { errorDto } from 'src/responses.js';
import { app, asBearerAuth, utils } from 'src/utils.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Gallery's image colour adjustment (/assets/:id/adjust). It is stored beside asset_edit, never in it: stock Immich
// clients (and older Gallery apps) fail their whole sync on an asset_edit action they cannot decode.
const videoFixture = resolve(import.meta.dirname, '../../../../../server/test/fixtures/videos/normal.mp4');
const neutral = { exposure: 0, contrast: 0, saturation: 0, invert: false };

// The edit job runs after the request returns; wait for its outcome rather than for the queue.
const waitFor = async (check: () => Promise<boolean>, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out');
};

describe('/assets/:id/adjust', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let other: LoginResponseDto;
  let websocket: Socket;

  const uploadImage = async () => {
    const asset = await utils.createAsset(owner.accessToken);
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });
    return asset.id;
  };

  const getAsset = async (id: string) => {
    const { body } = await request(app).get(`/assets/${id}`).set('Authorization', `Bearer ${owner.accessToken}`);
    return body;
  };

  const editedPreview = async (id: string) => {
    const { body } = await request(app)
      .get(`/assets/${id}/thumbnail?size=preview&edited=true`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    return body as Buffer;
  };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    [owner, other] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('adjust-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('adjust-other')),
    ]);
    websocket = await utils.connectWebsocket(owner.accessToken);
  });

  afterAll(async () => {
    try {
      await utils.waitForQueueFinish(admin.accessToken, 'editor', 60_000);
    } finally {
      utils.disconnectWebsocket(websocket);
    }
  }, 120_000);

  it('returns neutral values for an unadjusted image', async () => {
    const id = await uploadImage();

    const { status, body } = await request(app)
      .get(`/assets/${id}/adjust`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(status).toBe(200);
    expect(body).toEqual(neutral);
  });

  it('stores the adjustment beside asset_edit and renders it into the edited preview', async () => {
    const id = await uploadImage();
    const original = await editedPreview(id);

    const { status, body } = await request(app)
      .put(`/assets/${id}/adjust`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ invert: true, exposure: -20 });

    expect(status).toBe(200);
    expect(body).toEqual({ ...neutral, invert: true, exposure: -20 });
    expect(await getAsset(id)).toMatchObject({ isEdited: true });

    const { body: edits } = await request(app)
      .get(`/assets/${id}/edits`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(edits.edits).toEqual([]);

    await waitFor(async () => Buffer.compare(await editedPreview(id), original) !== 0);
  });

  it('removes the adjustment when given neutral values, like DELETE', async () => {
    const id = await uploadImage();
    await request(app)
      .put(`/assets/${id}/adjust`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ saturation: -100 });

    const { status } = await request(app)
      .put(`/assets/${id}/adjust`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(neutral);

    expect(status).toBe(200);
    expect(await getAsset(id)).toMatchObject({ isEdited: false });
    const { body } = await request(app).get(`/assets/${id}/adjust`).set('Authorization', `Bearer ${owner.accessToken}`);
    expect(body).toEqual(neutral);
  });

  it('keeps the adjustment when crop, rotate and mirror are removed, as the mobile editor does', async () => {
    const id = await uploadImage();
    await request(app)
      .put(`/assets/${id}/edits`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ edits: [{ action: 'rotate', parameters: { angle: 90 } }] });
    await request(app)
      .put(`/assets/${id}/adjust`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ invert: true });

    const { status } = await request(app)
      .delete(`/assets/${id}/edits`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('User-Agent', 'immich-android/5.8.0');

    expect(status).toBe(204);
    const { body } = await request(app).get(`/assets/${id}/adjust`).set('Authorization', `Bearer ${owner.accessToken}`);
    expect(body).toEqual({ ...neutral, invert: true });
    // Immich's trigger clears isEdited with the last asset_edit row; the edit job sets it back.
    await waitFor(async () => {
      const asset = await getAsset(id);
      return asset.isEdited === true;
    });
  });

  it('rejects a video', async () => {
    const video = await utils.createAsset(owner.accessToken, {
      assetData: { filename: 'normal.mp4', bytes: await readFile(videoFixture) },
    });
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: video.id });

    const { status, body } = await request(app)
      .put(`/assets/${video.id}/adjust`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ invert: true });

    expect(status).toBe(400);
    expect(body).toEqual(errorDto.badRequest('Only images can be adjusted'));
  });

  it('rejects values outside -100..100', async () => {
    const id = await uploadImage();

    const { status } = await request(app)
      .put(`/assets/${id}/adjust`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ exposure: 101 });

    expect(status).toBe(400);
  });

  it.each(['get', 'put', 'delete'] as const)('refuses %s for a user without access', async (method) => {
    const id = await uploadImage();

    const agent = request(app);
    const { status } = await agent[method](`/assets/${id}/adjust`)
      .set(asBearerAuth(other.accessToken))
      .send({ invert: true });

    expect(status).toBe(400);
  });

  it('requires authentication', async () => {
    const id = await uploadImage();
    const { status } = await request(app).get(`/assets/${id}/adjust`);
    expect(status).toBe(401);
  });
});
