/**
 * Slice 2 — M1: `GET /people/:id/faces` (the representative-face picker) must scope a non-owner
 * (space-granted) caller to faces on assets that are space-reachable-by-them AND pass the shareable
 * visibility gate. The owner keeps the full, unscoped list.
 *
 * Before this fix, `getRepresentativeFaces` had no visibility/space predicate at all, so ANY caller
 * who could read the person (granted via `checkSharedSpaceAccess` — which only requires ONE
 * space-reachable, shareable-visibility face) would see EVERY face of that person, including the
 * owner's Hidden/never-shared faces.
 *
 * `person.id` here (owned by `spaceOwner`) grants the viewer PersonRead only because it has one
 * space-reachable Timeline face (`spaceFaceId`) — see `PersonAccess.checkSharedSpaceAccess` — so that
 * face is both the access-grant anchor and the sole face the viewer's scoped picker call must return.
 */

import { AssetVisibility } from '@immich/sdk';
import { type SpaceContext, buildSpaceContext } from 'src/actors';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('GET /people/:id/faces — space-scope (Slice 2 / M1)', () => {
  let ctx: SpaceContext;
  let personId: string;
  let spaceFaceId: string;
  let hiddenFaceId: string;
  let neverSharedFaceId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();

    const person = await utils.createPerson(ctx.spaceOwner.token!, { name: 'M1 Scoped Person' });
    personId = person.id;

    // A1: Timeline, added to the space the viewer belongs to -> space-reachable + shareable.
    // This is the ONLY face that grants the viewer PersonRead at all (checkSharedSpaceAccess).
    spaceFaceId = await utils.createFace({ assetId: ctx.spaceAssetId, personId });

    // A2: also added to the space (space-reachable) but Hidden -> fails spaceVisibilityGate.
    const hiddenAsset = await utils.createAsset(ctx.spaceOwner.token!, { visibility: AssetVisibility.Hidden });
    await utils.addSpaceAssets(ctx.spaceOwner.token!, ctx.spaceId, [hiddenAsset.id]);
    hiddenFaceId = await utils.createFace({ assetId: hiddenAsset.id, personId });

    // A3: owned by spaceOwner, Timeline (shareable visibility), but NEVER added to any space
    // (ctx.ownerAssetId) -> not space-reachable.
    neverSharedFaceId = await utils.createFace({ assetId: ctx.ownerAssetId, personId });
  });

  it('owner sees the full, unscoped list, including the hidden- and never-shared-asset faces (positive control)', async () => {
    const { status, body } = await request(app)
      .get(`/people/${personId}/faces`)
      .set(asBearerAuth(ctx.spaceOwner.token!))
      .query({ size: 50 });

    expect(status).toBe(200);
    const ids = (body.faces as Array<{ id: string }>).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([spaceFaceId, hiddenFaceId, neverSharedFaceId]));
  });

  it('a space viewer (non-owner) sees only the space-reachable, shareable-visibility face', async () => {
    const { status, body } = await request(app)
      .get(`/people/${personId}/faces`)
      .set(asBearerAuth(ctx.spaceViewer.token!))
      .query({ size: 50 });

    expect(status).toBe(200);
    const ids = (body.faces as Array<{ id: string }>).map((f) => f.id);
    expect(ids).toEqual([spaceFaceId]);
    expect(ids).not.toContain(hiddenFaceId);
    expect(ids).not.toContain(neverSharedFaceId);
  });

  it('returns a 200 empty page (not a 500) once the viewer-scoped result set is exhausted', async () => {
    // The viewer's scoped result set is exactly one row (spaceFaceId). Requesting page 2 exercises
    // the "scope predicate filters everything out of this page" path with zero rows to map/return.
    const { status, body } = await request(app)
      .get(`/people/${personId}/faces`)
      .set(asBearerAuth(ctx.spaceViewer.token!))
      .query({ page: 2, size: 1 });

    expect(status).toBe(200);
    expect(body).toEqual({ faces: [], hasNextPage: false });
  });
});
