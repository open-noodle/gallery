/**
 * End-to-end journey for #734: a Shared Space Editor edits a photo owned by a fellow space
 * member, and the member sees the edit land in the space's activity feed. This is the reporter's
 * exact path — Anna (space Editor) opens Bob's photo, rotates it, corrects its date — plus the
 * negative half that proves the widened permission has a ceiling: Anna is refused when she
 * tries to archive or delete the same asset.
 *
 * Fixture: `buildSpaceContext()` gives `spaceOwner` ("Bob") and `spaceEditor` ("Anna") as
 * members of the same space, with Bob as the space's creator/Owner. This suite uploads its own
 * asset for Bob (rather than reusing `ctx.spaceAssetId`) so it can connect a websocket and wait
 * for the upload-processing event before editing: `PUT /assets/:id/edits` (rotate) needs
 * `exifImageWidth`/`exifImageHeight` populated, or it 400s with "Asset dimensions are not
 * available for editing" — see asset-edits.e2e-spec.ts's T25 header comment for the same
 * ordering guarantee (`job.service.ts` emits `on_upload_success` after exifInfo is populated).
 *
 * Rule under test (spec §2 / access.repository.ts `checkSpaceEditAccess`, asset.service.ts
 * "rbac-3"): a space Owner/Editor may edit — but never archive or delete — an asset owned by
 * another member of that same space, once the asset is reachable through the space (here: Bob
 * direct-adds his own new photo to the space he owns).
 */
import { AssetVisibility, createTag, getSpaceActivities } from '@immich/sdk';
import { Socket } from 'socket.io-client';
import { type Actor, authHeaders, buildSpaceContext, forEachActor, type SpaceContext } from 'src/actors';
import { errorDto } from 'src/responses';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const actorsFor = (ctx: SpaceContext): Actor[] => [
  ctx.spaceOwner,
  ctx.spaceEditor,
  ctx.spaceViewer,
  ctx.spaceNonMember,
];

describe('Space editor asset-edit journey (#734)', () => {
  let ctx: SpaceContext;
  let websocket: Socket;
  let bobAssetId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();

    // Connect as Bob (spaceOwner) BEFORE uploading, so the assetUpload event can never fire
    // before anything is listening for it.
    websocket = await utils.connectWebsocket(ctx.spaceOwner.token!);
    const asset = await utils.createAsset(ctx.spaceOwner.token!);
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });
    bobAssetId = asset.id;

    // Bob adds his own new photo to the space he owns — this is what makes it "a space
    // member's photo" that's actually reachable through the space for Anna to edit.
    await utils.addSpaceAssets(ctx.spaceOwner.token!, ctx.spaceId, [bobAssetId]);
  }, 30_000);

  afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });

  it("Anna (editor) rotates Bob's photo and an AssetEdit activity row appears, attributed to her", async () => {
    const before = await getSpaceActivities({ id: ctx.spaceId }, { headers: asBearerAuth(ctx.spaceEditor.token!) });

    const { status, body } = await request(app)
      .put(`/assets/${bobAssetId}/edits`)
      .set(authHeaders(ctx.spaceEditor))
      .send({ edits: [{ action: 'rotate', parameters: { angle: 90 } }] });
    expect(status, `rotate failed: ${JSON.stringify(body)}`).toBe(200);

    const after = await getSpaceActivities({ id: ctx.spaceId }, { headers: asBearerAuth(ctx.spaceEditor.token!) });
    const beforeIds = new Set(before.map((activity) => activity.id));
    const newRows = after.filter((activity) => !beforeIds.has(activity.id));

    expect(newRows).toHaveLength(1);
    expect(newRows[0]).toMatchObject({
      type: 'asset_edit',
      userId: ctx.spaceEditor.userId,
      data: expect.objectContaining({ count: 1, assetIds: [bobAssetId] }),
    });
  });

  it("Anna then corrects the photo's capture date — also succeeds, and adds a second AssetEdit row", async () => {
    const before = await getSpaceActivities({ id: ctx.spaceId }, { headers: asBearerAuth(ctx.spaceEditor.token!) });

    const { status, body } = await request(app)
      .put(`/assets/${bobAssetId}`)
      .set(authHeaders(ctx.spaceEditor))
      .send({ dateTimeOriginal: '2020-06-15T12:00:00.000Z' });
    expect(status, `date correction failed: ${JSON.stringify(body)}`).toBe(200);

    const after = await getSpaceActivities({ id: ctx.spaceId }, { headers: asBearerAuth(ctx.spaceEditor.token!) });
    const beforeIds = new Set(before.map((activity) => activity.id));
    const newRows = after.filter((activity) => !beforeIds.has(activity.id));

    expect(newRows).toHaveLength(1);
    expect(newRows[0]).toMatchObject({
      type: 'asset_edit',
      userId: ctx.spaceEditor.userId,
      data: expect.objectContaining({ count: 1, assetIds: [bobAssetId] }),
    });
  });

  it("Bob (the photo's owner, and the space's owner) sees both of Anna's edits in his own view of the feed", async () => {
    const activities = await getSpaceActivities({ id: ctx.spaceId }, { headers: asBearerAuth(ctx.spaceOwner.token!) });
    const annasEdits = activities.filter(
      (activity) => activity.type === 'asset_edit' && activity.userId === ctx.spaceEditor.userId,
    );
    expect(annasEdits.length).toBeGreaterThanOrEqual(2);
  });

  describe('the line the feature must hold: Anna cannot destructively act on the same asset', () => {
    it('archive (bulk visibility update) is refused — 403, the visibility guard is owner-only regardless of space role (asset.service.ts "rbac-3")', async () => {
      const { status, body } = await request(app)
        .put('/assets')
        .set(authHeaders(ctx.spaceEditor))
        .send({ ids: [bobAssetId], visibility: AssetVisibility.Archive });

      expect(status).toBe(403);
      expect(body.message).toContain('only be changed on assets you own');
    });

    it('delete is refused — 400, Permission.AssetDelete is pure ownership with no space arm', async () => {
      const { status, body } = await request(app)
        .delete('/assets')
        .set(authHeaders(ctx.spaceEditor))
        .send({ ids: [bobAssetId] });

      expect(status).toBe(400);
      expect(body).toEqual(errorDto.noPermission);
    });

    it('positive control: Bob (the owner) can archive his own photo — proves the guard is role-neutral, not a blanket lock on the endpoint', async () => {
      const { status } = await request(app)
        .put('/assets')
        .set(authHeaders(ctx.spaceOwner))
        .send({ ids: [bobAssetId], visibility: AssetVisibility.Archive });

      expect(status).toBe(204);
    });
  });

  // #992 audit item 3: an actor matrix over every route family this feature widened, at HTTP
  // level. Each test targets a fresh asset owned by Bob (spaceOwner) and added to the space, so
  // one route's mutation can never contaminate another route's expectations. `spaceNonMember` is
  // a real non-member of THIS space (built by buildSpaceContext, not a stranger with no space at
  // all) — the weaker "stranger" version would leave the asset unreachable for two independent
  // reasons and prove nothing about the space-membership gate specifically.
  describe('actor matrix over the widened routes (#992 audit item 3)', () => {
    it('PUT /assets/:id/edits (rotate): owner/editor 2xx, viewer/non-member 4xx', async () => {
      const rotateWebsocket = await utils.connectWebsocket(ctx.spaceOwner.token!);
      const asset = await utils.createAsset(ctx.spaceOwner.token!);
      await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });
      utils.disconnectWebsocket(rotateWebsocket);
      await utils.addSpaceAssets(ctx.spaceOwner.token!, ctx.spaceId, [asset.id]);

      await forEachActor(
        actorsFor(ctx),
        (actor) =>
          request(app)
            .put(`/assets/${asset.id}/edits`)
            .set(authHeaders(actor))
            .send({ edits: [{ action: 'rotate', parameters: { angle: 90 } }] }),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 400, spaceNonMember: 400 },
      );
    });

    it('POST /assets/jobs (refresh-metadata): owner/editor 2xx, viewer/non-member 4xx', async () => {
      const asset = await utils.createAsset(ctx.spaceOwner.token!);
      await utils.addSpaceAssets(ctx.spaceOwner.token!, ctx.spaceId, [asset.id]);

      await forEachActor(
        actorsFor(ctx),
        (actor) =>
          request(app)
            .post('/assets/jobs')
            .set(authHeaders(actor))
            .send({ assetIds: [asset.id], name: 'refresh-metadata' }),
        { spaceOwner: 204, spaceEditor: 204, spaceViewer: 400, spaceNonMember: 400 },
      );
    });

    it('PUT /assets/:id/metadata: owner/editor 2xx, viewer/non-member 4xx', async () => {
      const asset = await utils.createAsset(ctx.spaceOwner.token!);
      await utils.addSpaceAssets(ctx.spaceOwner.token!, ctx.spaceId, [asset.id]);

      await forEachActor(
        actorsFor(ctx),
        (actor) =>
          request(app)
            .put(`/assets/${asset.id}/metadata`)
            .set(authHeaders(actor))
            .send({ items: [{ key: 'e2e-matrix.probe', value: { touched: true } }] }),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 400, spaceNonMember: 400 },
      );
    });

    it('PUT /tags/assets: count > 0 for owner/editor, count === 0 for viewer/non-member (non-throwing checkAccess)', async () => {
      // TagService.bulkTagAssets checks access with `checkAccess`, not `requireAccess` — a denied
      // actor gets HTTP 200 with `count: 0`, indistinguishable from success by status alone. The
      // body IS the assertion here; a status-only check would pass even if the access filter were
      // deleted entirely.
      const asset = await utils.createAsset(ctx.spaceOwner.token!);
      await utils.addSpaceAssets(ctx.spaceOwner.token!, ctx.spaceId, [asset.id]);

      for (const actor of actorsFor(ctx)) {
        const tag = await createTag(
          { tagCreateDto: { name: `e2e-matrix-${actor.id}` } },
          { headers: asBearerAuth(actor.token!) },
        );

        const { status, body } = await request(app)
          .put('/tags/assets')
          .set(authHeaders(actor))
          .send({ tagIds: [tag.id], assetIds: [asset.id] });

        expect(status, `actor=${actor.id} unexpected status: ${JSON.stringify(body)}`).toBe(200);
        if (actor.id === 'spaceOwner' || actor.id === 'spaceEditor') {
          expect(body.count, `actor=${actor.id}`).toBeGreaterThan(0);
        } else {
          expect(body.count, `actor=${actor.id}`).toBe(0);
        }
      }
    });
  });
});

// #992 audit item 4: pins the one user-visible §2.3 removal at HTTP level. Before #734, a space
// editor could act on an asset another member direct-added to the space even if the asset's
// owner was NOT a space member themselves, because the direct-add arm accepted
// `Permission.AssetShare` (owner ∪ partner). #734 tightened this — see S-5 in
// access-space-edit.repository.spec.ts for the rule-level pin — so the same setup must now 4xx.
describe('space editor asset edit — the tightened partner-share regression (#992 audit item 4)', () => {
  let ctx: SpaceContext;
  let daveAssetId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext({ withPartner: true });

    // Dave (partner) has shared his library with Bob (spaceOwner). Bob direct-adds Dave's asset
    // to the space HE owns — Dave himself is never a member of the space.
    await utils.addSpaceAssets(ctx.spaceOwner.token!, ctx.spaceId, [ctx.partnerAssetId!]);
    daveAssetId = ctx.partnerAssetId!;
  });

  it("Anna (space Editor) is refused editing Dave's partner-shared, direct-added asset", async () => {
    const { status, body } = await request(app)
      .put(`/assets/${daveAssetId}`)
      .set(authHeaders(ctx.spaceEditor))
      .send({ description: 'should not be allowed' });

    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    expect(body).toEqual(errorDto.noPermission);
  });
});
