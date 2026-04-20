import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// T27 — covers two small fork-relevant /assets surfaces in one spec:
//
//   POST /assets/jobs             (runAssetJobs)
//   POST /assets/bulk-upload-check
//
// (PUT /assets/:id/original was removed upstream and the corresponding tests
// were dropped along with it.)
//
// Service shapes:
//   - runAssetJobs (asset.service.ts:530-560) — requireAccess(AssetUpdate, ids),
//     queues a job per asset, returns 204.
//   - bulkUploadCheck (asset-media.service.ts:294-322) — NO requireAccess. Just
//     scopes by auth.user.id when querying checksums. Response is per-item with
//     ACCEPT or REJECT/DUPLICATE.

describe('asset jobs + bulk-upload-check', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let other: LoginResponseDto;
  let ownerAssetId: string;
  let ownerAssetChecksum: string;
  let otherAssetChecksum: string;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });
    [owner, other] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t27-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('t27-other')),
    ]);

    // One owner-side asset for jobs (read-only across the suite — mutating
    // tests use their own fresh asset).
    const ownerAsset = await utils.createAsset(owner.accessToken);
    ownerAssetId = ownerAsset.id;

    // Capture both users' checksums for the bulk-upload-check tests. The
    // checksum field on AssetResponseDto is base64-encoded SHA-1, which is
    // exactly what /assets/bulk-upload-check accepts.
    const otherAsset = await utils.createAsset(other.accessToken);
    const [ownerInfo, otherInfo] = await Promise.all([
      request(app).get(`/assets/${ownerAssetId}`).set(asBearerAuth(owner.accessToken)),
      request(app).get(`/assets/${otherAsset.id}`).set(asBearerAuth(other.accessToken)),
    ]);
    ownerAssetChecksum = (ownerInfo.body as { checksum: string }).checksum;
    otherAssetChecksum = (otherInfo.body as { checksum: string }).checksum;
  });

  describe('POST /assets/jobs (runAssetJobs)', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .post('/assets/jobs')
        .set(authHeaders(anonActor))
        .send({ assetIds: [ownerAssetId], name: 'regenerate-thumbnail' });
      expect(status).toBe(401);
    });

    it('owner can queue regenerate-thumbnail (204)', async () => {
      // The endpoint just queues a job — it does not wait for completion.
      // We assert the response shape; the queue contents would require admin
      // access to inspect, which is out of scope here.
      const { status } = await request(app)
        .post('/assets/jobs')
        .set(asBearerAuth(owner.accessToken))
        .send({ assetIds: [ownerAssetId], name: 'regenerate-thumbnail' });
      expect(status).toBe(204);
    });

    it('non-owner asset id in the list returns 400 (bulk-access pattern)', async () => {
      // requireAccess fails the WHOLE call if any id isn't accessible to the caller.
      const { status, body } = await request(app)
        .post('/assets/jobs')
        .set(asBearerAuth(other.accessToken))
        .send({ assetIds: [ownerAssetId], name: 'regenerate-thumbnail' });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it('invalid job name returns 400 (DTO enum validation)', async () => {
      const { status } = await request(app)
        .post('/assets/jobs')
        .set(asBearerAuth(owner.accessToken))
        .send({ assetIds: [ownerAssetId], name: 'not-a-real-job' });
      expect(status).toBe(400);
    });

    it('malformed asset id in the list returns 400 (DTO validation)', async () => {
      const { status } = await request(app)
        .post('/assets/jobs')
        .set(asBearerAuth(owner.accessToken))
        .send({ assetIds: ['not-a-uuid'], name: 'regenerate-thumbnail' });
      expect(status).toBe(400);
    });
  });

  describe('POST /assets/bulk-upload-check', () => {
    it('requires authentication', async () => {
      const { status } = await request(app)
        .post('/assets/bulk-upload-check')
        .set(authHeaders(anonActor))
        .send({ assets: [{ id: 'client-1', checksum: 'aGVsbG8=' }] });
      expect(status).toBe(401);
    });

    it('unknown checksum returns ACCEPT', async () => {
      // 'aGVsbG8=' is base64 for 'hello' — not a real SHA-1 of any uploaded
      // asset. The endpoint should treat it as new (ACCEPT).
      const { status, body } = await request(app)
        .post('/assets/bulk-upload-check')
        .set(asBearerAuth(owner.accessToken))
        .send({ assets: [{ id: 'client-unknown', checksum: 'aGVsbG8=' }] });
      expect(status).toBe(200);
      expect(body).toEqual({
        results: [
          expect.objectContaining({
            id: 'client-unknown',
            action: 'accept',
          }),
        ],
      });
    });

    it('existing owner checksum returns REJECT with DUPLICATE reason', async () => {
      // Pin: posting an owner's own asset checksum back to bulk-upload-check
      // returns REJECT/DUPLICATE with the assetId of the existing record.
      // This is the canonical client-side de-dup flow.
      const { status, body } = await request(app)
        .post('/assets/bulk-upload-check')
        .set(asBearerAuth(owner.accessToken))
        .send({ assets: [{ id: 'client-known', checksum: ownerAssetChecksum }] });
      expect(status).toBe(200);
      expect(body).toEqual({
        results: [
          expect.objectContaining({
            id: 'client-known',
            action: 'reject',
            reason: 'duplicate',
            assetId: ownerAssetId,
            isTrashed: false,
          }),
        ],
      });
    });

    it("cross-user isolation: another user's checksum is treated as new", async () => {
      // The repository scopes the lookup by auth.user.id, so a checksum that
      // belongs to a DIFFERENT user's asset is NOT detected as a duplicate
      // when checked by the owner. This protects against checksum-based
      // information leak across users.
      const { status, body } = await request(app)
        .post('/assets/bulk-upload-check')
        .set(asBearerAuth(owner.accessToken))
        .send({ assets: [{ id: 'client-cross', checksum: otherAssetChecksum }] });
      expect(status).toBe(200);
      expect(body).toEqual({
        results: [
          expect.objectContaining({
            id: 'client-cross',
            action: 'accept',
          }),
        ],
      });
    });
  });
});
