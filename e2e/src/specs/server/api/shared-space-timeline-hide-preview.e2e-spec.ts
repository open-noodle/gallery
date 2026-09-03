/**
 * #1041 slice 12 (§8.1) — the two read-only preview endpoints behind the "hide from my timeline"
 * confirm dialogs:
 *
 *   GET /shared-spaces/:spaceId/timeline-hide-preview
 *   GET /shared-spaces/:spaceId/albums/:albumId/timeline-hide-preview
 *
 * Both return `{ hiddenAssetCount }` — always the CALLER's own count of photos that would leave
 * THEIR OWN personal timeline if they flipped the relevant "hide from my timeline" switch. This
 * file proves three things per endpoint: a non-member is rejected, the number genuinely matches
 * what `/timeline/buckets?withSharedSpaces=true` actually drops once the switch is flipped for
 * real, and the zero case returns 0 rather than erroring.
 */

import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

let seq = 0;
const uniqueName = (prefix: string) => `${prefix}-${++seq}`;

/** A fresh user, a fresh space they own, and a fresh album (owned by them) linked into it. */
const freshOwnerWithLinkedAlbum = async (
  admin: Awaited<ReturnType<typeof utils.adminSetup>>,
  prefix: string,
  assetCount: number,
) => {
  const user = await utils.userSetup(admin.accessToken, createUserDto.create(uniqueName(prefix)));
  const space = await utils.createSpace(user.accessToken, { name: uniqueName(`${prefix}-space`) });
  const assets = await Promise.all(Array.from({ length: assetCount }, () => utils.createAsset(user.accessToken)));
  const album = await utils.createAlbum(user.accessToken, {
    albumName: uniqueName(`${prefix}-album`),
    assetIds: assets.map((a) => a.id),
  });
  await utils.linkSpaceAlbum(user.accessToken, space.id, album.id);
  return { user, spaceId: space.id, albumId: album.id, assets };
};

/** The caller's own merged personal timeline total (own assets + shared-space assets). */
const personalTimelineTotal = async (token: string): Promise<number> => {
  const { status, body } = await request(app)
    .get('/timeline/buckets?visibility=timeline&withSharedSpaces=true')
    .set(asBearerAuth(token));
  expect(status).toBe(200);
  return (body as Array<{ count: number }>).reduce((acc, b) => acc + b.count, 0);
};

const spacePreview = (token: string, spaceId: string) =>
  request(app).get(`/shared-spaces/${spaceId}/timeline-hide-preview`).set(asBearerAuth(token));

const albumPreview = (token: string, spaceId: string, albumId: string) =>
  request(app).get(`/shared-spaces/${spaceId}/albums/${albumId}/timeline-hide-preview`).set(asBearerAuth(token));

describe('shared-space timeline-hide-preview (#1041 slice 12)', () => {
  let admin: Awaited<ReturnType<typeof utils.adminSetup>>;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  /** A fresh user with a fresh space they own — isolates the personal-timeline count per test. */
  const freshOwnerWithSpace = async (prefix: string) => {
    const user = await utils.userSetup(admin.accessToken, createUserDto.create(uniqueName(prefix)));
    const space = await utils.createSpace(user.accessToken, { name: uniqueName(`${prefix}-space`) });
    return { user, spaceId: space.id };
  };

  describe('GET /shared-spaces/:spaceId/timeline-hide-preview', () => {
    it('a non-member gets 403', async () => {
      const { spaceId } = await freshOwnerWithSpace('sp-403');
      const nonMember = await utils.userSetup(admin.accessToken, createUserDto.create(uniqueName('sp-403-outsider')));

      const res = await spacePreview(nonMember.accessToken, spaceId);
      expect(res.status).toBe(403);
    });

    it('the zero case: a space with nothing added returns 0, not an error', async () => {
      const { user, spaceId } = await freshOwnerWithSpace('sp-zero');

      const res = await spacePreview(user.accessToken, spaceId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hiddenAssetCount: 0, retainedAssetCount: 0 });
    });

    it('the count matches exactly what /timeline/buckets actually drops once the space is hidden', async () => {
      const { user, spaceId } = await freshOwnerWithSpace('sp-match');

      // Three of the owner's own assets, added directly to the space (no album involved) — their
      // ONLY path onto the owner's personal timeline is this space membership.
      const assets = await Promise.all(Array.from({ length: 3 }, () => utils.createAsset(user.accessToken)));
      await utils.addSpaceAssets(
        user.accessToken,
        spaceId,
        assets.map((a) => a.id),
      );

      const before = await personalTimelineTotal(user.accessToken);
      expect(before).toBe(3);

      const preview = await spacePreview(user.accessToken, spaceId);
      expect(preview.status).toBe(200);
      // Nothing is rescued here — this space is the only path — so the dialog has no second
      // sentence to show.
      expect(preview.body).toEqual({ hiddenAssetCount: 3, retainedAssetCount: 0 });

      // Flip the switch for real and confirm the timeline actually drops by exactly the previewed
      // count — the preview must never merely look plausible, it must match reality.
      const toggle = await request(app)
        .patch(`/shared-spaces/${spaceId}/members/me/timeline`)
        .set(asBearerAuth(user.accessToken))
        .send({ showInTimeline: false });
      expect(toggle.status).toBe(200);

      const after = await personalTimelineTotal(user.accessToken);
      expect(before - after).toBe(preview.body.hiddenAssetCount);
      expect(after).toBe(0);
    });

    it('an asset with a second visible path is not counted — the preview matches the real drop of 0', async () => {
      const { user, spaceId } = await freshOwnerWithSpace('sp-second-path');
      const otherSpace = await utils.createSpace(user.accessToken, { name: uniqueName('sp-second-path-other') });

      const asset = await utils.createAsset(user.accessToken);
      // Added to BOTH spaces — hiding just the first must not remove it from the timeline.
      await utils.addSpaceAssets(user.accessToken, spaceId, [asset.id]);
      await utils.addSpaceAssets(user.accessToken, otherSpace.id, [asset.id]);

      const before = await personalTimelineTotal(user.accessToken);
      expect(before).toBe(1);

      const preview = await spacePreview(user.accessToken, spaceId);
      // This is the shape behind the "why only 3 photos?" report, in miniature: hiding removes
      // nothing, and `retainedAssetCount` is the number that explains why — the asset belongs to
      // this space but survives via the other one. Without it the dialog says "removes 0 photos"
      // and leaves the user to guess.
      expect(preview.body).toEqual({ hiddenAssetCount: 0, retainedAssetCount: 1 });

      const toggle = await request(app)
        .patch(`/shared-spaces/${spaceId}/members/me/timeline`)
        .set(asBearerAuth(user.accessToken))
        .send({ showInTimeline: false });
      expect(toggle.status).toBe(200);

      const after = await personalTimelineTotal(user.accessToken);
      expect(after).toBe(before);
    });
  });

  describe('GET /shared-spaces/:spaceId/albums/:albumId/timeline-hide-preview', () => {
    it('a non-member gets 403', async () => {
      const { spaceId, albumId } = await freshOwnerWithLinkedAlbum(admin, 'al-403', 1);
      const nonMember = await utils.userSetup(admin.accessToken, createUserDto.create(uniqueName('al-403-outsider')));

      const res = await albumPreview(nonMember.accessToken, spaceId, albumId);
      expect(res.status).toBe(403);
    });

    it('an album not linked to the space is rejected', async () => {
      const { user, spaceId } = await freshOwnerWithSpace('al-notlinked');
      const otherAlbum = await utils.createAlbum(user.accessToken, { albumName: uniqueName('al-notlinked-album') });

      const res = await albumPreview(user.accessToken, spaceId, otherAlbum.id);
      expect(res.status).toBe(400);
    });

    it('the zero case: an empty linked album returns 0, not an error', async () => {
      const { user, spaceId, albumId } = await freshOwnerWithLinkedAlbum(admin, 'al-zero', 0);

      const res = await albumPreview(user.accessToken, spaceId, albumId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hiddenAssetCount: 0 });
    });

    it('the count matches exactly what /timeline/buckets actually drops once the album is hidden', async () => {
      const { user, spaceId, albumId } = await freshOwnerWithLinkedAlbum(admin, 'al-match', 2);

      const before = await personalTimelineTotal(user.accessToken);
      expect(before).toBe(2);

      const preview = await albumPreview(user.accessToken, spaceId, albumId);
      expect(preview.status).toBe(200);
      expect(preview.body).toEqual({ hiddenAssetCount: 2 });

      const toggle = await request(app)
        .patch(`/shared-spaces/${spaceId}/albums/${albumId}/me/timeline`)
        .set(asBearerAuth(user.accessToken))
        .send({ showInTimeline: false });
      expect(toggle.status).toBe(204);

      const after = await personalTimelineTotal(user.accessToken);
      expect(before - after).toBe(preview.body.hiddenAssetCount);
      expect(after).toBe(0);
    });

    it('an asset also added to the space directly is not counted — the preview matches the real drop of 0', async () => {
      const { user, spaceId, albumId, assets } = await freshOwnerWithLinkedAlbum(admin, 'al-second-path', 1);
      // Same asset also reaches the space directly, independent of the album link.
      await utils.addSpaceAssets(
        user.accessToken,
        spaceId,
        assets.map((a) => a.id),
      );

      const before = await personalTimelineTotal(user.accessToken);
      expect(before).toBe(1);

      const preview = await albumPreview(user.accessToken, spaceId, albumId);
      expect(preview.body).toEqual({ hiddenAssetCount: 0 });

      const toggle = await request(app)
        .patch(`/shared-spaces/${spaceId}/albums/${albumId}/me/timeline`)
        .set(asBearerAuth(user.accessToken))
        .send({ showInTimeline: false });
      expect(toggle.status).toBe(204);

      const after = await personalTimelineTotal(user.accessToken);
      expect(after).toBe(before);
    });

    it('the zero case when the album is already fully hidden via a hidden space', async () => {
      const { user, spaceId, albumId } = await freshOwnerWithLinkedAlbum(admin, 'al-space-already-hidden', 2);

      // Hide the whole space first — the album's assets are already off the timeline via that
      // broader switch, so hiding the album individually would remove nothing further.
      const hideSpace = await request(app)
        .patch(`/shared-spaces/${spaceId}/members/me/timeline`)
        .set(asBearerAuth(user.accessToken))
        .send({ showInTimeline: false });
      expect(hideSpace.status).toBe(200);

      const preview = await albumPreview(user.accessToken, spaceId, albumId);
      expect(preview.status).toBe(200);
      expect(preview.body).toEqual({ hiddenAssetCount: 0 });
    });
  });
});
