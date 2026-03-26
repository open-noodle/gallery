import { LoginResponseDto } from '@immich/sdk';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Socket } from 'socket.io-client';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The normal.mp4 fixture is 4 seconds long; short.mp4 is 1 second
const videoFixtureDir = resolve(import.meta.dirname, '../../../../../server/test/fixtures/videos');

describe('/assets/:id/edits (video trim)', () => {
  let admin: LoginResponseDto;
  let user1: LoginResponseDto;
  let websocket: Socket;

  let videoAssetId: string;
  let imageAssetId: string;
  let shortVideoAssetId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });

    [websocket, user1] = await Promise.all([
      utils.connectWebsocket(admin.accessToken),
      utils.userSetup(admin.accessToken, createUserDto.create('trim-user')),
    ]);

    // Upload a real 4-second video for trim tests
    const videoBytes = await readFile(`${videoFixtureDir}/normal.mp4`);
    const videoAsset = await utils.createAsset(admin.accessToken, {
      assetData: { filename: 'normal.mp4', bytes: videoBytes },
    });
    videoAssetId = videoAsset.id;
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: videoAssetId });

    // Upload an image for rejection test
    const imageAsset = await utils.createAsset(admin.accessToken);
    imageAssetId = imageAsset.id;
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: imageAssetId });

    // Upload a very short (1 second) video
    const shortVideoBytes = await readFile(`${videoFixtureDir}/short.mp4`);
    const shortVideoAsset = await utils.createAsset(admin.accessToken, {
      assetData: { filename: 'short.mp4', bytes: shortVideoBytes },
    });
    shortVideoAssetId = shortVideoAsset.id;
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: shortVideoAssetId });
  }, 30_000);

  afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });

  describe('PUT /assets/:id/edits (trim)', () => {
    it('should trim a video and store edit', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${videoAssetId}/edits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          edits: [{ action: 'trim', parameters: { startTime: 1, endTime: 3 } }],
        });

      expect(status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          assetId: videoAssetId,
          edits: expect.arrayContaining([
            expect.objectContaining({
              action: 'trim',
              parameters: expect.objectContaining({
                startTime: 1,
                endTime: 3,
              }),
            }),
          ]),
        }),
      );
    });

    it('should re-trim (widen) and verify updated edit', async () => {
      // Apply a wider trim
      const { status, body } = await request(app)
        .put(`/assets/${videoAssetId}/edits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          edits: [{ action: 'trim', parameters: { startTime: 0, endTime: 3 } }],
        });

      expect(status).toBe(200);
      expect(body.edits).toHaveLength(1);
      expect(body.edits[0]).toEqual(
        expect.objectContaining({
          action: 'trim',
          parameters: expect.objectContaining({
            startTime: 0,
            endTime: 3,
          }),
        }),
      );
    });

    it('should undo trim by deleting edits', async () => {
      // First apply a trim
      const trimResult = await request(app)
        .put(`/assets/${videoAssetId}/edits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          edits: [{ action: 'trim', parameters: { startTime: 1, endTime: 3 } }],
        });
      expect(trimResult.status).toBe(200);

      // Delete all edits (undo)
      const deleteResult = await request(app)
        .delete(`/assets/${videoAssetId}/edits`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(deleteResult.status).toBe(204);

      // Verify edits are empty
      const getResult = await request(app)
        .get(`/assets/${videoAssetId}/edits`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(getResult.status).toBe(200);
      expect(getResult.body.edits).toHaveLength(0);
    });

    it('should reject trim on image asset (400)', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${imageAssetId}/edits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          edits: [{ action: 'trim', parameters: { startTime: 0, endTime: 5 } }],
        });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Trim is only supported for video assets'));
    });

    it('should reject endTime exceeding duration (400)', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${videoAssetId}/edits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          edits: [{ action: 'trim', parameters: { startTime: 0, endTime: 999 } }],
        });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('End time exceeds video duration'));
    });

    it('should reject full-duration trim / no-op (400)', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${videoAssetId}/edits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          edits: [{ action: 'trim', parameters: { startTime: 0, endTime: 4 } }],
        });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Trim must actually remove content'));
    });

    it('should reject very short video (400)', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${shortVideoAssetId}/edits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          edits: [{ action: 'trim', parameters: { startTime: 0, endTime: 0.5 } }],
        });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Video is too short to trim (minimum 2 seconds)'));
    });

    it('should reject mixed spatial + trim edits (400)', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${videoAssetId}/edits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          edits: [
            { action: 'trim', parameters: { startTime: 1, endTime: 3 } },
            { action: 'rotate', parameters: { angle: 90 } },
          ],
        });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Cannot combine trim with spatial edits'));
    });

    it('should require authentication', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${videoAssetId}/edits`)
        .send({
          edits: [{ action: 'trim', parameters: { startTime: 1, endTime: 3 } }],
        });

      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('should require asset access', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${videoAssetId}/edits`)
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({
          edits: [{ action: 'trim', parameters: { startTime: 1, endTime: 3 } }],
        });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });
  });
});
