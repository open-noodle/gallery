/**
 * Slice S4a — API e2e behavioral matrix for the space-albums timeline surfaces.
 *
 * Source: SPACE-ALBUMS-RBAC-REMEDIATION-SPEC-2026-07-11.md, section "S4 — Comprehensive
 * space-albums behavioral e2e safety net" / "S4a — API e2e behavioral matrix". This is the
 * end-to-end regression lock for S1 (H-1 trash gate), S2 (M-2 sync trash gate) and S3 (M-1
 * Locked album strip convergence), on top of proving the day-to-day link/toggle/add/remove
 * behavior actually moves assets in and out of the relevant surfaces.
 *
 * Two DISTINCT `showInTimeline` toggles exist and must be kept straight (verified in
 * server/src/dtos/shared-space.dto.ts):
 *   - ALBUM-level `shared_space_album.showInTimeline` (PATCH /shared-spaces/:id/albums/:albumId)
 *     — "include this album's assets in the SPACE Photos timeline". It gates ONLY the
 *     `spaceId`/`withSharedSpaces` arms of the timeline/search builders (via
 *     `spaceAlbumAssetExists({ requireShowInTimeline: true })`); the `albumId`-scoped timeline
 *     query (the album view) joins `album_asset` directly and never looks at this flag.
 *   - MEMBER-level `shared_space_member.showInTimeline` (PATCH
 *     /shared-spaces/:id/members/me/timeline) — "include this space's assets in MY
 *     personal/main timeline" (`GET /timeline/buckets?withSharedSpaces=true`). It does not gate
 *     the space's own Photos tab (`GET /timeline/buckets?spaceId=...`), which a member can
 *     still browse directly.
 *
 * Fixture: owner O, editor E, viewer V, non-member X; a fresh space S per test group; O owns
 * album A (2 Timeline assets, E as an album-editor participant so E can add/remove assets);
 * A is linked into S. Assertions check DATA PRESENCE (asset ids in the relevant list
 * responses), not just status codes, per the remediation spec's explicit ask.
 */

import {
  AlbumResponseDto,
  AlbumUserRole,
  AssetMediaResponseDto,
  AssetVisibility,
  LoginResponseDto,
  removeAssets,
  restoreAssets,
  SharedSpaceRole,
  updateAssets,
  updateMemberTimeline,
  updateSharedSpaceAlbum,
} from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// ─── module-level read/mutation helpers (no describe-scoped closures) ───────

/**
 * Collects every asset id across all time buckets returned for the given query string
 * (e.g. `spaceId=...`, `albumId=...`, `withSharedSpaces=true`), as the given token.
 * Asserts 200 on both the buckets list and each bucket fetch — only call this for a
 * caller expected to have read access to the scope; use raw `request(app)` calls directly
 * to assert a non-2xx status.
 */
const timelineIds = async (token: string, query: string): Promise<string[]> => {
  const bucketsRes = await request(app)
    .get(`/timeline/buckets?bucketSize=month&${query}`)
    .set('Authorization', `Bearer ${token}`);
  expect(bucketsRes.status).toBe(200);
  const buckets = bucketsRes.body as Array<{ timeBucket: string }>;

  const ids: string[] = [];
  for (const bucket of buckets) {
    const { status, body } = await request(app)
      .get(`/timeline/bucket?bucketSize=month&timeBucket=${bucket.timeBucket}&${query}`)
      .set('Authorization', `Bearer ${token}`);
    expect(status).toBe(200);
    ids.push(...((body.id ?? []) as string[]));
  }
  return ids;
};

/** The SPACE Photos timeline (direct + showInTimeline-linked-album assets). */
const spaceTimelineIds = (token: string, spaceId: string) => timelineIds(token, `spaceId=${spaceId}`);

/** The album-filtered timeline view (album view) — never gated by the album's showInTimeline. */
const albumTimelineIds = (token: string, albumId: string) => timelineIds(token, `albumId=${albumId}`);

/**
 * The caller's personal/main timeline, expanded to include timeline-enabled shared spaces.
 * `withSharedSpaces` requires an explicit `visibility=timeline`: the endpoint 400s on the default
 * (archived) view for a shared-spaces union, mirroring `withPartners` (see
 * timeline.service.ts `timeBucketChecks`), and every caller in timeline.e2e-spec.ts passes it too.
 */
const mainTimelineWithSpacesIds = (token: string) => timelineIds(token, 'visibility=timeline&withSharedSpaces=true');

/** POST /search/metadata as the given token; returns the flat list of returned asset ids. */
const searchIds = async (token: string, body: Record<string, unknown>): Promise<string[]> => {
  const { status, body: resBody } = await request(app)
    .post('/search/metadata')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(status).toBe(200);
  return (resBody.assets.items as Array<{ id: string }>).map((item) => item.id);
};

/** Set visibility on an asset, as the given token (must own the asset). */
const setVisibility = (token: string, assetId: string, visibility: AssetVisibility) =>
  updateAssets({ assetBulkUpdateDto: { ids: [assetId], visibility } }, { headers: asBearerAuth(token) });

/** PATCH the ALBUM-level showInTimeline flag for a space<->album link, as the given token. */
const setAlbumShowInTimeline = (token: string, spaceId: string, albumId: string, showInTimeline: boolean) =>
  updateSharedSpaceAlbum(
    { id: spaceId, albumId, sharedSpaceAlbumLinkUpdateDto: { showInTimeline } },
    { headers: asBearerAuth(token) },
  );

/** PATCH the MEMBER-level showInTimeline flag for the caller's own membership. */
const setMemberShowInTimeline = (token: string, spaceId: string, showInTimeline: boolean) =>
  updateMemberTimeline(
    { id: spaceId, sharedSpaceMemberTimelineDto: { showInTimeline } },
    { headers: asBearerAuth(token) },
  );

const PIN_CODE = '123456';

/**
 * Elevate a session so it can read/modify Locked-folder assets. A Locked asset is invisible to
 * checkOwnerAccess without an elevated (PIN) session (access.repository.ts gates
 * `visibility != Locked` when `!hasElevatedPermission`), so unlocking one via PUT /assets 400s on a
 * plain token. Set up the PIN (tolerant of a repeat call on a vitest retry — a re-setup 4xx is
 * ignored; only the session/unlock is asserted) then unlock the session.
 */
const elevateSession = async (token: string) => {
  await request(app).post('/auth/pin-code').set(asBearerAuth(token)).send({ pinCode: PIN_CODE });
  await request(app).post('/auth/session/unlock').set(asBearerAuth(token)).send({ pinCode: PIN_CODE }).expect(204);
};

describe('shared-space album <-> timeline behavioral matrix (S4a)', () => {
  let admin: LoginResponseDto;
  // space owner (also album owner)
  let owner: LoginResponseDto;
  // space editor, also an album-editor participant on every fixture album
  let editor: LoginResponseDto;
  // space viewer — the primary observer for every assertion below
  let viewer: LoginResponseDto;
  // not a member of the space at all
  let nonMember: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [owner, editor, viewer, nonMember] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('s4a-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('s4a-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('s4a-viewer')),
      utils.userSetup(admin.accessToken, createUserDto.create('s4a-nonmember')),
    ]);
  });

  // ─── fixture helpers ───────────────────────────────────────────────────────

  /** Fresh space: O = Owner (creator), E = Editor, V = Viewer. Returns the space id. */
  const freshSpace = async (name: string): Promise<string> => {
    const space = await utils.createSpace(owner.accessToken, { name });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId, role: SharedSpaceRole.Viewer });
    return space.id;
  };

  /** Fresh album A owned by O, E as an album-editor participant, with `n` Timeline assets. */
  const freshAlbum = async (
    name: string,
    n = 2,
  ): Promise<{ album: AlbumResponseDto; assets: AssetMediaResponseDto[] }> => {
    const assets = await Promise.all(Array.from({ length: n }, () => utils.createAsset(owner.accessToken)));
    const album = await utils.createAlbum(owner.accessToken, {
      albumName: name,
      albumUsers: [{ userId: editor.userId, role: AlbumUserRole.Editor }],
      assetIds: assets.map((a) => a.id),
    });
    return { album, assets };
  };

  /** Fresh space + fresh album (n assets), linked together. The base S4a fixture. */
  const freshLinkedFixture = async (
    name: string,
    n = 2,
  ): Promise<{ spaceId: string; album: AlbumResponseDto; assets: AssetMediaResponseDto[] }> => {
    const spaceId = await freshSpace(name);
    const { album, assets } = await freshAlbum(name, n);
    await utils.linkSpaceAlbum(owner.accessToken, spaceId, album.id);
    return { spaceId, album, assets };
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Link -> space Photos timeline contains the linked album's assets.
  // ─────────────────────────────────────────────────────────────────────────

  describe('1. link -> space Photos timeline contains the album assets', () => {
    it("after linking A into S, V's space timeline contains both of A's assets", async () => {
      const { spaceId, assets } = await freshLinkedFixture('s4a-1-link');

      const ids = await spaceTimelineIds(viewer.accessToken, spaceId);
      for (const asset of assets) {
        expect(ids).toContain(asset.id);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Album showInTimeline=false removes assets from the SPACE timeline only,
  //    not the album view; toggling back to true brings them back.
  // ─────────────────────────────────────────────────────────────────────────

  describe('2. album showInTimeline gates the SPACE timeline only, not the album view', () => {
    it('showInTimeline=false hides A from the space timeline but the album view still returns it; true brings it back', async () => {
      const { spaceId, album, assets } = await freshLinkedFixture('s4a-2-album-toggle');

      // sanity: present before toggling
      const before = await spaceTimelineIds(viewer.accessToken, spaceId);
      for (const asset of assets) {
        expect(before).toContain(asset.id);
      }

      await setAlbumShowInTimeline(owner.accessToken, spaceId, album.id, false);

      const afterHideSpace = await spaceTimelineIds(viewer.accessToken, spaceId);
      for (const asset of assets) {
        expect(afterHideSpace).not.toContain(asset.id);
      }

      // The album view (`albumId`-scoped timeline) joins album_asset directly and is
      // NEVER gated by shared_space_album.showInTimeline.
      const albumView = await albumTimelineIds(viewer.accessToken, album.id);
      for (const asset of assets) {
        expect(albumView).toContain(asset.id);
      }

      await setAlbumShowInTimeline(owner.accessToken, spaceId, album.id, true);

      const afterShowSpace = await spaceTimelineIds(viewer.accessToken, spaceId);
      for (const asset of assets) {
        expect(afterShowSpace).toContain(asset.id);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Member showInTimeline gates the PERSONAL/main timeline only.
  // ─────────────────────────────────────────────────────────────────────────

  describe('3. member showInTimeline gates the PERSONAL/main timeline', () => {
    it("withSharedSpaces=true includes A's assets for V until V hides S, then they reappear once shown again", async () => {
      const { spaceId, assets } = await freshLinkedFixture('s4a-3-member-toggle');

      const before = await mainTimelineWithSpacesIds(viewer.accessToken);
      for (const asset of assets) {
        expect(before).toContain(asset.id);
      }

      await setMemberShowInTimeline(viewer.accessToken, spaceId, false);

      const afterHide = await mainTimelineWithSpacesIds(viewer.accessToken);
      for (const asset of assets) {
        expect(afterHide).not.toContain(asset.id);
      }

      await setMemberShowInTimeline(viewer.accessToken, spaceId, true);

      const afterShow = await mainTimelineWithSpacesIds(viewer.accessToken);
      for (const asset of assets) {
        expect(afterShow).toContain(asset.id);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Unlink -> assets leave the space timeline; V loses album access; O keeps A.
  // ─────────────────────────────────────────────────────────────────────────

  describe('4. unlink removes A from the space timeline; V loses album access; O still owns A', () => {
    it('DELETE /shared-spaces/:id/albums/:albumId removes the assets from the space timeline and 400s V on GET /albums/:id, while O keeps the album', async () => {
      const { spaceId, album, assets } = await freshLinkedFixture('s4a-4-unlink');

      await utils.unlinkSpaceAlbum(owner.accessToken, spaceId, album.id);

      const spaceIds = await spaceTimelineIds(viewer.accessToken, spaceId);
      for (const asset of assets) {
        expect(spaceIds).not.toContain(asset.id);
      }

      const viewerGet = await request(app)
        .get(`/albums/${album.id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(viewerGet.status).toBe(400);

      const ownerGet = await request(app)
        .get(`/albums/${album.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(ownerGet.status).toBe(200);
      expect(ownerGet.body.id).toBe(album.id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Editor add/remove of an album asset reflects immediately for the viewer.
  // ─────────────────────────────────────────────────────────────────────────

  describe('5. editor add/remove on A reflects immediately for V in the space timeline', () => {
    it('E adds asset N to A -> N appears for V; E removes N -> N disappears for V', async () => {
      const { spaceId, album } = await freshLinkedFixture('s4a-5-editor-add-remove', 1);
      const newAsset = await utils.createAsset(editor.accessToken);

      await request(app)
        .put(`/albums/${album.id}/assets`)
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send({ ids: [newAsset.id] })
        .expect(200);

      const afterAdd = await spaceTimelineIds(viewer.accessToken, spaceId);
      expect(afterAdd).toContain(newAsset.id);

      await request(app)
        .delete(`/albums/${album.id}/assets`)
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send({ ids: [newAsset.id] })
        .expect(200);

      const afterRemove = await spaceTimelineIds(viewer.accessToken, spaceId);
      expect(afterRemove).not.toContain(newAsset.id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Hide / Lock / restore round-trip — regression lock for S1-S3.
  // ─────────────────────────────────────────────────────────────────────────

  describe('6. hide / lock / restore round-trip (regression lock for S1-S3)', () => {
    it('Hidden: an A-asset disappears from every viewer surface, then reappears once restored to Timeline', async () => {
      const { spaceId, album, assets } = await freshLinkedFixture('s4a-6-hidden', 2);
      const [target, sibling] = assets;

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(target.id);
      expect(await albumTimelineIds(viewer.accessToken, album.id)).toContain(target.id);
      expect(await mainTimelineWithSpacesIds(viewer.accessToken)).toContain(target.id);
      expect(await searchIds(viewer.accessToken, { spaceId })).toContain(target.id);

      await setVisibility(owner.accessToken, target.id, AssetVisibility.Hidden);

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).not.toContain(target.id);
      expect(await albumTimelineIds(viewer.accessToken, album.id)).not.toContain(target.id);
      expect(await mainTimelineWithSpacesIds(viewer.accessToken)).not.toContain(target.id);
      expect(await searchIds(viewer.accessToken, { spaceId })).not.toContain(target.id);
      // the sibling asset is unaffected
      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(sibling.id);

      await setVisibility(owner.accessToken, target.id, AssetVisibility.Timeline);

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(target.id);
      expect(await albumTimelineIds(viewer.accessToken, album.id)).toContain(target.id);
      expect(await mainTimelineWithSpacesIds(viewer.accessToken)).toContain(target.id);
      expect(await searchIds(viewer.accessToken, { spaceId })).toContain(target.id);
    });

    it('Locked: an A-asset disappears from every viewer surface AND is permanently stripped from A (unlocking does not silently re-share it — S3/M-1)', async () => {
      const { spaceId, album, assets } = await freshLinkedFixture('s4a-6-locked', 2);
      const [target, sibling] = assets;

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(target.id);

      await setVisibility(owner.accessToken, target.id, AssetVisibility.Locked);

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).not.toContain(target.id);
      expect(await albumTimelineIds(viewer.accessToken, album.id)).not.toContain(target.id);
      expect(await mainTimelineWithSpacesIds(viewer.accessToken)).not.toContain(target.id);
      expect(await searchIds(viewer.accessToken, { spaceId })).not.toContain(target.id);
      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(sibling.id);

      // M-1 (asset.service.ts applyVisibilityTransitionSideEffects): Locked unconditionally strips
      // the asset from every album via removeAssetsFromAll, unlike Hidden which retains the
      // album_asset row. Setting the asset back to Timeline lifts the visibility gate but does
      // NOT restore album membership — emitAlbumAssetVisibilityRestore finds no surviving row to
      // bump (shared-space.repository.ts: "after Locked, album_asset rows were deleted ... the
      // asset does not return to the album"). This is the fixed, intended "no silent re-share"
      // behavior (S3's own edge case), not a leak: assert it stays absent from A's scope.
      // (Re-lock-after-crash convergence is proven at the medium-test level —
      // sync-shared-space-album-visibility-purge.spec.ts — not duplicated here.)
      //
      // A Locked asset is only reachable/mutable by an elevated (PIN) session, so the owner must
      // elevate before unlocking it — mirrors the real client's locked-folder flow.
      await elevateSession(owner.accessToken);
      await setVisibility(owner.accessToken, target.id, AssetVisibility.Timeline);

      expect(await albumTimelineIds(viewer.accessToken, album.id)).not.toContain(target.id);
      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).not.toContain(target.id);

      // The asset itself is a normal, directly-readable Timeline asset again for its owner — just
      // no longer shared via A/S.
      const { status, body } = await request(app)
        .get(`/assets/${target.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(status).toBe(200);
      expect(body.visibility).toBe(AssetVisibility.Timeline);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Trash round-trip — regression lock for H-1 / M-2.
  // ─────────────────────────────────────────────────────────────────────────

  describe('7. trash round-trip (regression lock for H-1/M-2)', () => {
    it('trashing an A-asset removes it from every viewer surface (incl. the S1 400 guards); restoring brings it back', async () => {
      const { spaceId, album, assets } = await freshLinkedFixture('s4a-7-trash', 2);
      const [target, sibling] = assets;

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(target.id);

      await utils.deleteAssets(owner.accessToken, [target.id]);

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).not.toContain(target.id);
      expect(await albumTimelineIds(viewer.accessToken, album.id)).not.toContain(target.id);
      expect(await searchIds(viewer.accessToken, { spaceId })).not.toContain(target.id);
      expect(await searchIds(viewer.accessToken, { withSharedSpaces: true })).not.toContain(target.id);
      // the sibling asset stays live everywhere
      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(sibling.id);

      // S1 (H-1): a space scope must reject every trash/offline param outright, rather than
      // silently omitting the trashed asset — mirrors shared-space-visibility-negatives.e2e-spec.ts.
      for (const body of [
        { spaceId, withDeleted: true },
        { spaceId, trashedAfter: '1970-01-01T00:00:00.000Z' },
        { spaceId, isOffline: true },
        { withSharedSpaces: true, withDeleted: true },
      ]) {
        const { status } = await request(app)
          .post('/search/metadata')
          .set('Authorization', `Bearer ${viewer.accessToken}`)
          .send(body);
        expect(status).toBe(400);
      }

      await restoreAssets({ bulkIdsDto: { ids: [target.id] } }, { headers: asBearerAuth(owner.accessToken) });

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(target.id);
      expect(await albumTimelineIds(viewer.accessToken, album.id)).toContain(target.id);
      expect(await searchIds(viewer.accessToken, { spaceId })).toContain(target.id);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Positive controls / non-member exclusion.
  // ─────────────────────────────────────────────────────────────────────────

  describe('8. positive control (V sees the live assets) and non-member exclusion', () => {
    it('V sees the live A-assets across the space timeline, the album view, and search', async () => {
      const { spaceId, album, assets } = await freshLinkedFixture('s4a-8-positive');

      const spaceIds = await spaceTimelineIds(viewer.accessToken, spaceId);
      const albumIds = await albumTimelineIds(viewer.accessToken, album.id);
      const searchedIds = await searchIds(viewer.accessToken, { spaceId });
      for (const asset of assets) {
        expect(spaceIds).toContain(asset.id);
        expect(albumIds).toContain(asset.id);
        expect(searchedIds).toContain(asset.id);
      }
    });

    it('X (non-member) sees none of the space timeline, album view, or search surfaces', async () => {
      const { spaceId, album } = await freshLinkedFixture('s4a-8-nonmember', 1);

      const spaceTimeline = await request(app)
        .get(`/timeline/buckets?bucketSize=month&spaceId=${spaceId}`)
        .set('Authorization', `Bearer ${nonMember.accessToken}`);
      expect(spaceTimeline.status).toBe(400);

      const albumGet = await request(app)
        .get(`/albums/${album.id}`)
        .set('Authorization', `Bearer ${nonMember.accessToken}`);
      expect(albumGet.status).toBe(400);

      const albumTimeline = await request(app)
        .get(`/timeline/buckets?bucketSize=month&albumId=${album.id}`)
        .set('Authorization', `Bearer ${nonMember.accessToken}`);
      expect(albumTimeline.status).toBe(400);

      const search = await request(app)
        .post('/search/metadata')
        .set('Authorization', `Bearer ${nonMember.accessToken}`)
        .send({ spaceId });
      expect(search.status).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge cases (S4 list)
  // ─────────────────────────────────────────────────────────────────────────

  describe('edge: album linked to two spaces — toggling showInTimeline in one does not affect the other', () => {
    it('hiding A in S1 leaves A visible in S2', async () => {
      const spaceId1 = await freshSpace('s4a-edge-two-spaces-1');
      const spaceId2 = await freshSpace('s4a-edge-two-spaces-2');
      const { album, assets } = await freshAlbum('s4a-edge-two-spaces-album', 1);
      await utils.linkSpaceAlbum(owner.accessToken, spaceId1, album.id);
      await utils.linkSpaceAlbum(owner.accessToken, spaceId2, album.id);

      expect(await spaceTimelineIds(viewer.accessToken, spaceId1)).toContain(assets[0].id);
      expect(await spaceTimelineIds(viewer.accessToken, spaceId2)).toContain(assets[0].id);

      await setAlbumShowInTimeline(owner.accessToken, spaceId1, album.id, false);

      expect(await spaceTimelineIds(viewer.accessToken, spaceId1)).not.toContain(assets[0].id);
      expect(await spaceTimelineIds(viewer.accessToken, spaceId2)).toContain(assets[0].id);
    });
  });

  describe('edge: an asset present via both a linked album and a direct add', () => {
    it('removing only ONE of the two paths leaves it visible; removing both drops it from the space timeline', async () => {
      const spaceId = await freshSpace('s4a-edge-both-paths');
      const { album, assets } = await freshAlbum('s4a-edge-both-paths-album', 1);
      const asset = assets[0];
      await utils.linkSpaceAlbum(owner.accessToken, spaceId, album.id);
      await utils.addSpaceAssets(owner.accessToken, spaceId, [asset.id]);

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(asset.id);

      // Remove the ALBUM path (unlink) — the direct-add path still carries it.
      await utils.unlinkSpaceAlbum(owner.accessToken, spaceId, album.id);
      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(asset.id);

      // Now remove the DIRECT path too — only then does it leave the space timeline.
      await removeAssets(
        { id: spaceId, sharedSpaceAssetRemoveDto: { assetIds: [asset.id] } },
        { headers: asBearerAuth(owner.accessToken) },
      );
      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).not.toContain(asset.id);
    });
  });

  describe('edge: empty album linked then first asset added', () => {
    it('linking an empty album does not affect the space timeline; adding the first asset makes it appear', async () => {
      const spaceId = await freshSpace('s4a-edge-empty-album');
      const emptyAlbum = await utils.createAlbum(owner.accessToken, {
        albumName: 's4a-edge-empty-album-A',
        albumUsers: [{ userId: editor.userId, role: AlbumUserRole.Editor }],
      });
      await utils.linkSpaceAlbum(owner.accessToken, spaceId, emptyAlbum.id);

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toEqual([]);

      const firstAsset = await utils.createAsset(owner.accessToken);
      await request(app)
        .put(`/albums/${emptyAlbum.id}/assets`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ ids: [firstAsset.id] })
        .expect(200);

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(firstAsset.id);
    });
  });

  describe('edge: video asset in a linked album is included in the space timeline', () => {
    // The space-card collage (recentAssetIds) deliberately excludes video for thumbnail purposes
    // (shared-space.service.ts) — that is a display-only narrowing, not a timeline visibility
    // rule. Confirm the actual space Photos timeline includes video consistently with a normal
    // album/timeline browse.
    it('a video asset appears in the space Photos timeline', async () => {
      const spaceId = await freshSpace('s4a-edge-video');
      const videoAsset = await utils.createAsset(owner.accessToken, { assetData: { filename: 'example.mp4' } });
      const album = await utils.createAlbum(owner.accessToken, {
        albumName: 's4a-edge-video-album',
        assetIds: [videoAsset.id],
      });
      await utils.linkSpaceAlbum(owner.accessToken, spaceId, album.id);

      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(videoAsset.id);
    });
  });

  describe('edge: member showInTimeline=false hides the space from the MAIN timeline only, not the space Photos tab', () => {
    it("V with member showInTimeline=false still sees A's assets via the space's own Photos tab", async () => {
      const { spaceId, assets } = await freshLinkedFixture('s4a-edge-hidden-main-timeline', 1);

      await setMemberShowInTimeline(viewer.accessToken, spaceId, false);

      expect(await mainTimelineWithSpacesIds(viewer.accessToken)).not.toContain(assets[0].id);
      expect(await spaceTimelineIds(viewer.accessToken, spaceId)).toContain(assets[0].id);
    });
  });
});
