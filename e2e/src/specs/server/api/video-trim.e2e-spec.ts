import { LoginResponseDto, TranscodePolicy, updateConfig } from '@immich/sdk';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Socket } from 'socket.io-client';
import { createUserDto } from 'src/fixtures.js';
import { errorDto } from 'src/responses.js';
import { app, asBearerAuth, utils } from 'src/utils.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The normal.mp4 fixture is 4 seconds long; short.mp4 is 1 second
const videoFixtureDir = resolve(import.meta.dirname, '../../../../../server/test/fixtures/videos');

describe('/assets/:id/trim', () => {
  let admin: LoginResponseDto;
  let user1: LoginResponseDto;
  let websocket: Socket;

  // Each test group gets its own assets to avoid shared state
  let imageAssetId: string;
  let shortVideoAssetId: string;

  // Helper to upload a fresh 4s video
  const uploadVideo = async () => {
    const videoBytes = await readFile(`${videoFixtureDir}/normal.mp4`);
    const asset = await utils.createAsset(admin.accessToken, {
      assetData: { filename: 'normal.mp4', bytes: videoBytes },
    });
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });
    return asset.id;
  };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });

    const config = await utils.getSystemConfig(admin.accessToken);
    config.ffmpeg.transcode = TranscodePolicy.Disabled;
    await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

    [websocket, user1] = await Promise.all([
      utils.connectWebsocket(admin.accessToken),
      utils.userSetup(admin.accessToken, createUserDto.create('trim-user')),
    ]);

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

  afterAll(async () => {
    try {
      await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction', 60_000);
      await utils.waitForQueueFinish(admin.accessToken, 'editor', 60_000);
      await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration', 60_000);
      await utils.waitForQueueFinish(admin.accessToken, 'videoConversion', 60_000);
      await utils.resetAdminConfig(admin.accessToken);
    } finally {
      utils.disconnectWebsocket(websocket);
    }
  }, 120_000);

  // --- Rejection tests (run on untrimmed assets, no shared state issues) ---

  describe('PUT /assets/:id/trim (rejections)', () => {
    it('should reject trim on image asset (400)', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${imageAssetId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ startTime: 0, endTime: 5 });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Trim is only supported for video assets'));
    });

    it('should reject very short video (400)', async () => {
      const { status, body } = await request(app)
        .put(`/assets/${shortVideoAssetId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ startTime: 0, endTime: 0.5 });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Video is too short to trim (minimum 2 seconds)'));
    });

    it('should reject endTime exceeding duration (400)', async () => {
      const videoId = await uploadVideo();
      const { status, body } = await request(app)
        .put(`/assets/${videoId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ startTime: 0, endTime: 999 });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('End time exceeds video duration'));
    });

    it('should reject full-duration trim / no-op (400)', async () => {
      const videoId = await uploadVideo();
      const { status, body } = await request(app)
        .put(`/assets/${videoId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ startTime: 0, endTime: 4 });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.badRequest('Trim must actually remove content'));
    });

    it('should require authentication', async () => {
      const videoId = await uploadVideo();
      const { status, body } = await request(app).put(`/assets/${videoId}/trim`).send({ startTime: 1, endTime: 3 });

      expect(status).toBe(401);
      expect(body).toEqual(errorDto.unauthorized);
    });

    it('should require asset access', async () => {
      const videoId = await uploadVideo();
      const { status, body } = await request(app)
        .put(`/assets/${videoId}/trim`)
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({ startTime: 1, endTime: 3 });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });
  });

  // --- Mutation tests (each gets a fresh asset to avoid shared state) ---

  describe('PUT /assets/:id/trim (mutations)', () => {
    it('should trim a video and store the trim', async () => {
      const videoId = await uploadVideo();
      const { status, body } = await request(app)
        .put(`/assets/${videoId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ startTime: 1, endTime: 3 });

      expect(status).toBe(200);
      expect(body).toEqual({ startTime: 1, endTime: 3, originalDuration: expect.closeTo(4, 0) });

      const stored = await request(app)
        .get(`/assets/${videoId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(stored.status).toBe(200);
      expect(stored.body).toEqual(body);

      // Trims are not asset edits.
      const edits = await request(app)
        .get(`/assets/${videoId}/edits`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(edits.body.edits).toEqual([]);
    });

    it('should re-trim (widen) on a fresh asset', async () => {
      const videoId = await uploadVideo();

      // First trim
      const trim1 = await request(app)
        .put(`/assets/${videoId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ startTime: 2, endTime: 3 });
      expect(trim1.status).toBe(200);

      // Re-trim immediately (before async job modifies duration)
      const { status, body } = await request(app)
        .put(`/assets/${videoId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ startTime: 1, endTime: 3 });

      expect(status).toBe(200);
      expect(body).toEqual(expect.objectContaining({ startTime: 1, endTime: 3 }));
    });

    it('should undo a trim', async () => {
      const videoId = await uploadVideo();

      const trimResult = await request(app)
        .put(`/assets/${videoId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ startTime: 1, endTime: 3 });
      expect(trimResult.status).toBe(200);

      const deleteResult = await request(app)
        .delete(`/assets/${videoId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(deleteResult.status).toBe(204);

      const getResult = await request(app)
        .get(`/assets/${videoId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(getResult.status).toBe(404);
    });
  });

  // --- Trim of a video that already has an encoded variant ---
  //
  // The suite-wide `beforeAll` above disables transcoding, so no non-edited EncodedVideo file exists in the other
  // tests. This block turns transcoding on for one case: the trim still reads the original and must not touch the
  // encoded variant.
  describe('PUT /assets/:id/trim (with an existing encoded video)', () => {
    afterAll(async () => {
      const config = await utils.getSystemConfig(admin.accessToken);
      config.ffmpeg.transcode = TranscodePolicy.Disabled;
      await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });
    });

    it('should trim a video that has an encoded variant', async () => {
      // `All` transcodes unconditionally (unlike `Required`/`Optimal`/`Bitrate`, which can skip
      // if the source already matches the target codec/resolution), guaranteeing the
      // videoConversion job produces a non-edited EncodedVideo file for this asset.
      const config = await utils.getSystemConfig(admin.accessToken);
      config.ffmpeg.transcode = TranscodePolicy.All;
      await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

      const videoId = await uploadVideo();

      // The AssetEncodeVideo job is queued synchronously before the `assetUpload` websocket
      // event fires (server/src/services/job.service.ts), so by the time uploadVideo() resolves
      // it is already enqueued: waiting for the queue to drain here deterministically guarantees
      // the EncodedVideo variant exists before we trim (no race with the trim request below).
      await utils.waitForQueueFinish(admin.accessToken, 'videoConversion', 60_000);

      const { status, body } = await request(app)
        .put(`/assets/${videoId}/trim`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ startTime: 1, endTime: 3 });

      expect(status).toBe(200);
      expect(body).toEqual(expect.objectContaining({ startTime: 1, endTime: 3 }));

      // Wait for the editor job (handleVideoTrim) to finish re-probing/writing the trimmed
      // duration.
      await utils.waitForQueueFinish(admin.accessToken, 'editor', 60_000);

      const info = await utils.getAssetInfo(admin.accessToken, videoId);
      // The asset reports the trimmed file's length. `-c copy` trims to the nearest keyframe
      // (MediaRepository.trim), so allow tolerance around the requested 2s (1s-3s) window.
      expect(info.duration).toBeGreaterThan(500);
      expect(info.duration).toBeLessThan(3500);
    }, 30_000);
  });
});
