import { SharedSpaceRole } from '@immich/sdk';
import { buildSpaceContext, type SpaceContext } from 'src/actors';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// #763 (E21): duplicate-merge must preserve every user's favorites, not just the owner's.
//
// Duplicate *detection* is owner-scoped (`duplicate.repository.ts` filters `asset.ownerId`), so
// every asset in a duplicate group shares one owner, here `ctx.spaceOwner`. Other users can
// favorite those assets through a space. The owner's favorite merges through upstream's
// `assets.some((asset) => asset.isFavorite)` column write, which the reverse trigger mirrors to the
// owner's overlay row; `AssetFavoriteRepository.mergeOnto` carries everyone else's. See
// specs/2026-07-20-per-user-favorites-design.md (E21).

const putFavorites = (token: string, ids: string[], isFavorite: boolean) =>
  request(app).put('/assets/favorites').set(asBearerAuth(token)).send({ ids, isFavorite });

describe('/duplicates/resolve — favorite merge (#763 E21)', () => {
  let ctx: SpaceContext;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
  });

  it('unions favorites from multiple source assets onto the keeper, per user', async () => {
    const ownerToken = ctx.spaceOwner.token!;
    const viewerToken = ctx.spaceViewer.token!;

    const [keeper, source1, source2] = await Promise.all([
      utils.createAsset(ownerToken),
      utils.createAsset(ownerToken),
      utils.createAsset(ownerToken),
    ]);
    await utils.addSpaceAssets(ownerToken, ctx.spaceId, [keeper.id, source1.id, source2.id]);

    // The owner favorites source1; the space VIEWER (never the owner) favorites source2 —
    // two different users, two different sources. A single boolean OR over the owner-only
    // column could never carry the viewer's half of this.
    const ownerFav = await putFavorites(ownerToken, [source1.id], true);
    expect(ownerFav.status).toBe(204);
    const viewerFav = await putFavorites(viewerToken, [source2.id], true);
    expect(viewerFav.status).toBe(204);

    const duplicateId = '00000000-0000-4000-8000-000000000210';
    await Promise.all(
      [keeper, source1, source2].map((asset) => utils.setAssetDuplicateId(ownerToken, asset.id, duplicateId)),
    );

    const { status, body } = await request(app)
      .post('/duplicates/resolve')
      .set(asBearerAuth(ownerToken))
      .send({ groups: [{ duplicateId, keepAssetIds: [keeper.id], trashAssetIds: [source1.id, source2.id] }] });

    expect(status).toBe(200);
    expect(body).toEqual([{ id: duplicateId, success: true }]);

    const keeperForOwner = await utils.getAssetInfo(ownerToken, keeper.id);
    expect(keeperForOwner.isFavorite).toBe(true);
    const keeperForViewer = await utils.getAssetInfo(viewerToken, keeper.id);
    expect(keeperForViewer.isFavorite).toBe(true);
  });

  it('dedups when the same user favorited multiple sources — exactly one keeper row, no 500 (E8)', async () => {
    const ownerToken = ctx.spaceOwner.token!;
    const viewerToken = ctx.spaceViewer.token!;

    const [keeper, source1, source2] = await Promise.all([
      utils.createAsset(ownerToken),
      utils.createAsset(ownerToken),
      utils.createAsset(ownerToken),
    ]);
    await utils.addSpaceAssets(ownerToken, ctx.spaceId, [keeper.id, source1.id, source2.id]);

    // The SAME user favorited BOTH sources — mergeOnto's `onConflict do nothing` must absorb
    // the resulting duplicate insert rather than a PK violation / 500.
    const viewerFav = await putFavorites(viewerToken, [source1.id, source2.id], true);
    expect(viewerFav.status).toBe(204);

    const duplicateId = '00000000-0000-4000-8000-000000000211';
    await Promise.all(
      [keeper, source1, source2].map((asset) => utils.setAssetDuplicateId(ownerToken, asset.id, duplicateId)),
    );

    const { status, body } = await request(app)
      .post('/duplicates/resolve')
      .set(asBearerAuth(ownerToken))
      .send({ groups: [{ duplicateId, keepAssetIds: [keeper.id], trashAssetIds: [source1.id, source2.id] }] });

    expect(status).toBe(200);
    expect(body).toEqual([{ id: duplicateId, success: true }]);
    const keeperForViewer = await utils.getAssetInfo(viewerToken, keeper.id);
    expect(keeperForViewer.isFavorite).toBe(true);
  });

  it('creates no favorite for the keeper when no source was favorited', async () => {
    const ownerToken = ctx.spaceOwner.token!;

    const [keeper, source] = await Promise.all([utils.createAsset(ownerToken), utils.createAsset(ownerToken)]);

    const duplicateId = '00000000-0000-4000-8000-000000000212';
    await Promise.all([keeper, source].map((asset) => utils.setAssetDuplicateId(ownerToken, asset.id, duplicateId)));

    const { status, body } = await request(app)
      .post('/duplicates/resolve')
      .set(asBearerAuth(ownerToken))
      .send({ groups: [{ duplicateId, keepAssetIds: [keeper.id], trashAssetIds: [source.id] }] });

    expect(status).toBe(200);
    expect(body).toEqual([{ id: duplicateId, success: true }]);
    const keeperForOwner = await utils.getAssetInfo(ownerToken, keeper.id);
    expect(keeperForOwner.isFavorite).toBe(false);
  });

  // §5.2: favorite visibility is re-derived on read, never enforced by deleting rows on access
  // loss. A favorite from a user who has since lost access to the source must still transfer onto
  // the keeper during the merge — proven here by revoking access, merging, then re-granting access
  // and reading the row back.
  it('transfers a source favorite from a user who has since lost access', async () => {
    const ownerToken = ctx.spaceOwner.token!;
    const viewerToken = ctx.spaceViewer.token!;

    const [keeper, source] = await Promise.all([utils.createAsset(ownerToken), utils.createAsset(ownerToken)]);
    await utils.addSpaceAssets(ownerToken, ctx.spaceId, [keeper.id, source.id]);

    const viewerFav = await putFavorites(viewerToken, [source.id], true);
    expect(viewerFav.status).toBe(204);

    // Revoke the viewer's space membership entirely before the merge runs.
    const removed = await request(app)
      .delete(`/shared-spaces/${ctx.spaceId}/members/${ctx.spaceViewer.userId}`)
      .set(asBearerAuth(ownerToken));
    expect(removed.status).toBe(204);

    const duplicateId = '00000000-0000-4000-8000-000000000213';
    await Promise.all([keeper, source].map((asset) => utils.setAssetDuplicateId(ownerToken, asset.id, duplicateId)));

    const { status, body } = await request(app)
      .post('/duplicates/resolve')
      .set(asBearerAuth(ownerToken))
      .send({ groups: [{ duplicateId, keepAssetIds: [keeper.id], trashAssetIds: [source.id] }] });

    expect(status).toBe(200);
    expect(body).toEqual([{ id: duplicateId, success: true }]);

    // Re-grant access and read it back — the row must have survived the merge even though the
    // viewer could read nothing at the moment the merge ran.
    await utils.addSpaceMember(ownerToken, ctx.spaceId, {
      userId: ctx.spaceViewer.userId!,
      role: SharedSpaceRole.Viewer,
    });
    const keeperForViewer = await utils.getAssetInfo(viewerToken, keeper.id);
    expect(keeperForViewer.isFavorite).toBe(true);
  });
});
