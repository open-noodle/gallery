import { SharedLinkType } from '@immich/sdk';
import { buildSpaceContext, type SpaceContext } from 'src/actors';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// #1018: a share link made from inside a Space covers what the SPACE shows — including photos
// contributed by other members — instead of only the link creator's own. Authorized against the
// space Owner/Editor role, and tethered to the space rather than frozen as a grant: withdrawing the
// photo from the space revokes the public link at the same moment.
const createLink = (token: string | undefined, body: Record<string, unknown>) =>
  request(app)
    .post('/shared-links')
    .set(token ? asBearerAuth(token) : {})
    .send(body);

describe('/shared-links (from a space)', () => {
  let ctx: SpaceContext;

  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
  });

  describe('creating a link', () => {
    it('lets a space editor share an asset owned by another member', async () => {
      // spaceAssetId is owned by spaceOwner; the editor owns none of it.
      const { status, body } = await createLink(ctx.spaceEditor.token, {
        type: SharedLinkType.Individual,
        assetIds: [ctx.spaceAssetId],
        spaceId: ctx.spaceId,
      });

      expect(status).toBe(201);
      // The response deliberately does NOT echo the space back: it is readable by anyone holding
      // the link, and naming the space there tells a visitor something they have no need for. That
      // the link really is space-scoped is proved behaviourally below — an anonymous reader can
      // fetch the contributed asset, which is only possible through the space.
      expect(body).toEqual(expect.objectContaining({ userId: ctx.spaceEditor.userId }));
      expect(body).not.toHaveProperty('spaceId');
    });

    it('still refuses the same asset when no space is named', async () => {
      const { status } = await createLink(ctx.spaceEditor.token, {
        type: SharedLinkType.Individual,
        assetIds: [ctx.spaceAssetId],
      });

      expect(status).toBe(400);
    });

    it('refuses a space viewer', async () => {
      const { status } = await createLink(ctx.spaceViewer.token, {
        type: SharedLinkType.Individual,
        assetIds: [ctx.spaceAssetId],
        spaceId: ctx.spaceId,
      });

      expect(status).toBe(400);
    });

    it('refuses a non-member', async () => {
      const { status } = await createLink(ctx.spaceNonMember.token, {
        type: SharedLinkType.Individual,
        assetIds: [ctx.spaceAssetId],
        spaceId: ctx.spaceId,
      });

      expect(status).toBe(400);
    });

    it('refuses an asset that is not in the space', async () => {
      // editorAssetId is the editor's OWN asset, but it was never added to the space.
      const { status } = await createLink(ctx.spaceEditor.token, {
        type: SharedLinkType.Individual,
        assetIds: [ctx.editorAssetId],
        spaceId: ctx.spaceId,
      });

      expect(status).toBe(400);
    });
  });

  describe('reading through the link', () => {
    it('serves the contributed asset to an anonymous visitor', async () => {
      const { body: link } = await createLink(ctx.spaceEditor.token, {
        type: SharedLinkType.Individual,
        assetIds: [ctx.spaceAssetId],
        spaceId: ctx.spaceId,
      });

      const { status, body } = await request(app).get(`/assets/${ctx.spaceAssetId}?key=${link.key}`);

      expect(status).toBe(200);
      expect(body).toEqual(expect.objectContaining({ id: ctx.spaceAssetId }));
    });

    it('stops serving it once the owner takes it out of the space', async () => {
      const asset = await utils.createAsset(ctx.spaceOwner.token!);
      await utils.addSpaceAssets(ctx.spaceOwner.token!, ctx.spaceId, [asset.id]);

      const { body: link } = await createLink(ctx.spaceEditor.token, {
        type: SharedLinkType.Individual,
        assetIds: [asset.id],
        spaceId: ctx.spaceId,
      });
      // Sanity: the link works before the withdrawal, so the assertion below is about the tether
      // and not about the link having been broken all along.
      const before = await request(app).get(`/assets/${asset.id}?key=${link.key}`);
      expect(before.status).toBe(200);

      await request(app)
        .delete(`/shared-spaces/${ctx.spaceId}/assets`)
        .set(asBearerAuth(ctx.spaceOwner.token!))
        .send({ assetIds: [asset.id] });

      const after = await request(app).get(`/assets/${asset.id}?key=${link.key}`);
      expect(after.status).toBe(400);
    });

    it('keeps serving an asset the link creator owns after it leaves the space', async () => {
      const asset = await utils.createAsset(ctx.spaceEditor.token!);
      await utils.addSpaceAssets(ctx.spaceEditor.token!, ctx.spaceId, [asset.id]);

      const { body: link } = await createLink(ctx.spaceEditor.token, {
        type: SharedLinkType.Individual,
        assetIds: [asset.id],
        spaceId: ctx.spaceId,
      });

      await request(app)
        .delete(`/shared-spaces/${ctx.spaceId}/assets`)
        .set(asBearerAuth(ctx.spaceEditor.token!))
        .send({ assetIds: [asset.id] });

      const { status } = await request(app).get(`/assets/${asset.id}?key=${link.key}`);

      expect(status).toBe(200);
    });
  });
});
