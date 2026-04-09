import { AssetMediaResponseDto } from '@immich/sdk';
import { buildSpaceContext, type SpaceContext } from 'src/actors';
import { app, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Return the current UTC month as a YYYY-MM-01 bucket string — the same
// format /timeline/bucket?timeBucket=... expects.
function currentMonthBucketString(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}-01`;
}

// Fetch the set of asset IDs currently visible in the space via the timeline
// bucket endpoint. Requires `spaceId` because the direct-listing route isn't
// exposed — the timeline endpoint is the fork-canonical way to "list assets in
// a space".
async function spaceAssetIds(token: string, spaceId: string): Promise<Set<string>> {
  const { status, body } = await request(app)
    .get('/timeline/bucket')
    .query({ spaceId, timeBucket: currentMonthBucketString() })
    .set('Authorization', `Bearer ${token}`);
  if (status !== 200) {
    throw new Error(`spaceAssetIds failed: ${status} ${JSON.stringify(body)}`);
  }
  return new Set((body as { id?: string[] }).id);
}

// Mark two assets as a duplicate group by assigning them the same duplicateId
// via the fork's setAssetDuplicateId helper.
async function markAsDuplicate(token: string, duplicateId: string, assetIds: string[]): Promise<void> {
  await Promise.all(assetIds.map((id) => utils.setAssetDuplicateId(token, id, duplicateId)));
}

describe('/duplicates/resolve — shared space sync (fork)', () => {
  let ctx: SpaceContext;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
  });

  it('adds the owner-kept asset to the space when the trashed duplicate was in the space', async () => {
    const ownerToken = ctx.spaceOwner.token!;
    const inSpace = await utils.createAsset(ownerToken);
    const loose = await utils.createAsset(ownerToken);
    await utils.addSpaceAssets(ownerToken, ctx.spaceId, [inSpace.id]);

    const duplicateId = '00000000-0000-4000-8000-000000000100';
    await markAsDuplicate(ownerToken, duplicateId, [inSpace.id, loose.id]);

    const { status, body } = await request(app)
      .post('/duplicates/resolve')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        groups: [
          {
            duplicateId,
            keepAssetIds: [loose.id],
            trashAssetIds: [inSpace.id],
          },
        ],
      });

    expect(status).toBe(200);
    expect(body).toEqual([{ id: duplicateId, success: true }]);

    const ids = await spaceAssetIds(ownerToken, ctx.spaceId);
    expect(ids.has(loose.id)).toBe(true);
    expect(ids.has(inSpace.id)).toBe(false);
  });

  it('allows an Editor to add their own keeper to a space they edit', async () => {
    // Fresh editor-owned asset pair so we don't mutate ctx.editorAssetId.
    const editorToken = ctx.spaceEditor.token!;
    const inSpace = await utils.createAsset(editorToken);
    const loose = await utils.createAsset(editorToken);
    await utils.addSpaceAssets(editorToken, ctx.spaceId, [inSpace.id]);

    const duplicateId = '00000000-0000-4000-8000-000000000101';
    await markAsDuplicate(editorToken, duplicateId, [inSpace.id, loose.id]);

    const { status, body } = await request(app)
      .post('/duplicates/resolve')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        groups: [
          {
            duplicateId,
            keepAssetIds: [loose.id],
            trashAssetIds: [inSpace.id],
          },
        ],
      });

    expect(status).toBe(200);
    expect(body).toEqual([{ id: duplicateId, success: true }]);

    const ids = await spaceAssetIds(editorToken, ctx.spaceId);
    expect(ids.has(loose.id)).toBe(true);
    expect(ids.has(inSpace.id)).toBe(false);
  });

  it('does not alter space membership when no duplicate is in a space', async () => {
    const ownerToken = ctx.spaceOwner.token!;
    const [loose1, loose2] = await Promise.all([utils.createAsset(ownerToken), utils.createAsset(ownerToken)]);

    const before = await spaceAssetIds(ownerToken, ctx.spaceId);

    const duplicateId = '00000000-0000-4000-8000-000000000102';
    await markAsDuplicate(ownerToken, duplicateId, [loose1.id, loose2.id]);

    const { status, body } = await request(app)
      .post('/duplicates/resolve')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        groups: [
          {
            duplicateId,
            keepAssetIds: [loose1.id],
            trashAssetIds: [loose2.id],
          },
        ],
      });

    expect(status).toBe(200);
    expect(body).toEqual([{ id: duplicateId, success: true }]);

    const after = await spaceAssetIds(ownerToken, ctx.spaceId);
    expect(after).toEqual(before);
    expect(after.has(loose1.id)).toBe(false);
    expect(after.has(loose2.id)).toBe(false);
  });

  it('is idempotent when the keeper is already in the space', async () => {
    const ownerToken = ctx.spaceOwner.token!;
    const loose: AssetMediaResponseDto = await utils.createAsset(ownerToken);
    await utils.addSpaceAssets(ownerToken, ctx.spaceId, [loose.id]);

    const before = await spaceAssetIds(ownerToken, ctx.spaceId);
    expect(before.has(loose.id)).toBe(true);

    const second = await utils.createAsset(ownerToken);
    const duplicateId = '00000000-0000-4000-8000-000000000103';
    await markAsDuplicate(ownerToken, duplicateId, [loose.id, second.id]);

    const { status, body } = await request(app)
      .post('/duplicates/resolve')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        groups: [
          {
            duplicateId,
            keepAssetIds: [loose.id],
            trashAssetIds: [second.id],
          },
        ],
      });

    expect(status).toBe(200);
    expect(body).toEqual([{ id: duplicateId, success: true }]);

    const after = await spaceAssetIds(ownerToken, ctx.spaceId);
    expect(after.has(loose.id)).toBe(true);
    expect(after.has(second.id)).toBe(false);
  });
});
