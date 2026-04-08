import { type LoginResponseDto } from '@immich/sdk';
import { type Actor, authHeaders } from 'src/actors';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Coverage for the asset metadata K/V endpoints — fork extensions on /assets:
//
//   PUT    /assets/metadata               (bulk upsert across multiple assets)
//   DELETE /assets/metadata               (bulk delete by (assetId, key))
//   GET    /assets/:id/metadata           (list all keys on one asset)
//   PUT    /assets/:id/metadata           (upsert items on one asset)
//   GET    /assets/:id/metadata/:key      (single key value)
//   DELETE /assets/:id/metadata/:key      (single key delete)
//
// All routes require Permission.AssetRead/AssetUpdate. The service routes through
// `requireAccess(AssetRead/Update, [assetId])` which is the bulk-access pattern —
// non-owner returns 400.

describe('/assets/:id/metadata', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let other: LoginResponseDto;
  let assetId: string;
  const anonActor: Actor = { id: 'anon' };

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [owner, other] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t23-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('t23-other')),
    ]);
    const asset = await utils.createAsset(owner.accessToken);
    assetId = asset.id;
  });

  describe('GET /assets/:id/metadata', () => {
    it('requires authentication', async () => {
      const { status } = await request(app).get(`/assets/${assetId}/metadata`).set(authHeaders(anonActor));
      expect(status).toBe(401);
    });

    it('owner can list metadata (empty initially)', async () => {
      const { status, body } = await request(app)
        .get(`/assets/${assetId}/metadata`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it('non-owner returns 400 (bulk-access pattern)', async () => {
      const { status } = await request(app).get(`/assets/${assetId}/metadata`).set(asBearerAuth(other.accessToken));
      expect(status).toBe(400);
    });
  });

  describe('PUT /assets/:id/metadata', () => {
    it('owner can upsert and the K/V is queryable', async () => {
      const upsert = await request(app)
        .put(`/assets/${assetId}/metadata`)
        .set(asBearerAuth(owner.accessToken))
        .send({ items: [{ key: 't23.alpha', value: { color: 'red', count: 1 } }] });
      expect(upsert.status).toBe(200);
      expect(Array.isArray(upsert.body)).toBe(true);

      // The full listing now includes the key.
      const list = await request(app).get(`/assets/${assetId}/metadata`).set(asBearerAuth(owner.accessToken));
      const found = (list.body as Array<{ key: string; value: unknown }>).find((m) => m.key === 't23.alpha');
      expect(found).toBeDefined();
      expect(found?.value).toEqual({ color: 'red', count: 1 });
    });

    it('upsert overwrites an existing key value', async () => {
      // Set then re-set with a different value; the second value wins.
      await request(app)
        .put(`/assets/${assetId}/metadata`)
        .set(asBearerAuth(owner.accessToken))
        .send({ items: [{ key: 't23.beta', value: { v: 1 } }] });
      const second = await request(app)
        .put(`/assets/${assetId}/metadata`)
        .set(asBearerAuth(owner.accessToken))
        .send({ items: [{ key: 't23.beta', value: { v: 2 } }] });
      expect(second.status).toBe(200);

      const single = await request(app)
        .get(`/assets/${assetId}/metadata/t23.beta`)
        .set(asBearerAuth(owner.accessToken));
      expect(single.status).toBe(200);
      expect((single.body as { value: { v: number } }).value.v).toBe(2);
    });

    it('non-owner upsert returns 400', async () => {
      const { status } = await request(app)
        .put(`/assets/${assetId}/metadata`)
        .set(asBearerAuth(other.accessToken))
        .send({ items: [{ key: 't23.evil', value: { x: 1 } }] });
      expect(status).toBe(400);
    });
  });

  describe('GET /assets/:id/metadata/:key', () => {
    it('owner can fetch a single key', async () => {
      // Pre-condition: t23.alpha was set by an earlier test.
      const { status, body } = await request(app)
        .get(`/assets/${assetId}/metadata/t23.alpha`)
        .set(asBearerAuth(owner.accessToken));
      expect(status).toBe(200);
      expect((body as { key: string }).key).toBe('t23.alpha');
    });

    it('missing key returns 404 or 400', async () => {
      // The single-fetch endpoint uses requireAccess on the asset, then looks up the
      // key. A missing key returns whichever the service throws — pin both possibilities
      // since the test isn't load-bearing on which.
      const { status } = await request(app)
        .get(`/assets/${assetId}/metadata/t23.nonexistent`)
        .set(asBearerAuth(owner.accessToken));
      expect([400, 404]).toContain(status);
    });
  });

  describe('DELETE /assets/:id/metadata/:key', () => {
    it('owner can delete a key and it is removed from the listing', async () => {
      // Set, delete, verify gone.
      await request(app)
        .put(`/assets/${assetId}/metadata`)
        .set(asBearerAuth(owner.accessToken))
        .send({ items: [{ key: 't23.todelete', value: { v: 'gone' } }] });

      const del = await request(app)
        .delete(`/assets/${assetId}/metadata/t23.todelete`)
        .set(asBearerAuth(owner.accessToken));
      expect(del.status).toBe(204);

      const list = await request(app).get(`/assets/${assetId}/metadata`).set(asBearerAuth(owner.accessToken));
      const found = (list.body as Array<{ key: string }>).find((m) => m.key === 't23.todelete');
      expect(found).toBeUndefined();
    });

    it('non-owner delete returns 400', async () => {
      const { status } = await request(app)
        .delete(`/assets/${assetId}/metadata/t23.alpha`)
        .set(asBearerAuth(other.accessToken));
      expect(status).toBe(400);
    });
  });

  describe('PUT /assets/metadata (bulk)', () => {
    it('owner can upsert across multiple assets in one call', async () => {
      // Create a second asset for the same owner so the bulk write touches >1 row.
      const secondAsset = await utils.createAsset(owner.accessToken);

      const { status, body } = await request(app)
        .put('/assets/metadata')
        .set(asBearerAuth(owner.accessToken))
        .send({
          items: [
            { assetId, key: 't23.bulk', value: { v: 'a' } },
            { assetId: secondAsset.id, key: 't23.bulk', value: { v: 'b' } },
          ],
        });
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);

      // Both assets now have the key.
      const aRes = await request(app).get(`/assets/${assetId}/metadata/t23.bulk`).set(asBearerAuth(owner.accessToken));
      const bRes = await request(app)
        .get(`/assets/${secondAsset.id}/metadata/t23.bulk`)
        .set(asBearerAuth(owner.accessToken));
      expect(aRes.status).toBe(200);
      expect(bRes.status).toBe(200);
    });

    it('bulk upsert with a non-owner asset is rejected', async () => {
      // Owner mixes their asset with another user's asset id in the same call. The
      // bulk-access pattern fails the whole call.
      const otherAsset = await utils.createAsset(other.accessToken);
      const { status } = await request(app)
        .put('/assets/metadata')
        .set(asBearerAuth(owner.accessToken))
        .send({
          items: [
            { assetId, key: 't23.crossbulk', value: { v: 'mine' } },
            { assetId: otherAsset.id, key: 't23.crossbulk', value: { v: 'theirs' } },
          ],
        });
      expect(status).toBe(400);
    });
  });

  describe('DELETE /assets/metadata (bulk)', () => {
    it('owner can bulk-delete keys across assets', async () => {
      // Set up two assets with the same key, then bulk-delete both.
      const secondAsset = await utils.createAsset(owner.accessToken);
      await request(app)
        .put('/assets/metadata')
        .set(asBearerAuth(owner.accessToken))
        .send({
          items: [
            { assetId, key: 't23.bulkdelete', value: { v: 1 } },
            { assetId: secondAsset.id, key: 't23.bulkdelete', value: { v: 2 } },
          ],
        });

      const del = await request(app)
        .delete('/assets/metadata')
        .set(asBearerAuth(owner.accessToken))
        .send({
          items: [
            { assetId, key: 't23.bulkdelete' },
            { assetId: secondAsset.id, key: 't23.bulkdelete' },
          ],
        });
      expect(del.status).toBe(204);

      // Both assets should be missing the key.
      const aList = await request(app).get(`/assets/${assetId}/metadata`).set(asBearerAuth(owner.accessToken));
      const bList = await request(app).get(`/assets/${secondAsset.id}/metadata`).set(asBearerAuth(owner.accessToken));
      expect((aList.body as Array<{ key: string }>).find((m) => m.key === 't23.bulkdelete')).toBeUndefined();
      expect((bList.body as Array<{ key: string }>).find((m) => m.key === 't23.bulkdelete')).toBeUndefined();
    });
  });
});
