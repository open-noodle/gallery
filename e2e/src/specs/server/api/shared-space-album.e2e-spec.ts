import {
  AlbumResponseDto,
  AlbumUserRole,
  AssetMediaResponseDto,
  AssetVisibility,
  getAlbumInfo,
  getSpaceActivities,
  LoginResponseDto,
  SharedSpaceResponseDto,
  SharedSpaceRole,
} from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// T18 — space-album endpoints role matrix
//
// PUT    /shared-spaces/:id/albums/:albumId  — link (SharedSpaceAlbumCreate)
// PATCH  /shared-spaces/:id/albums/:albumId  — update showInTimeline (SharedSpaceAlbumUpdate)
// DELETE /shared-spaces/:id/albums/:albumId  — unlink (SharedSpaceAlbumDelete)
// GET    /shared-spaces/:id/albums            — list linked albums (SharedSpaceRead)
//
// The service gate for linkAlbum is a TWO-step check:
//   1. requireRole(Editor) — must be a space editor/owner
//   2. requireAccess(AlbumUpdate) — must own or be an album_user-editor on the album
// Gate 1 is checked BEFORE gate 2, so a space viewer hitting the link endpoint
// fails with 403 from the role gate, not the album-access gate.
//
// Deny codes observed:
//   - Space viewer / non-member calling PUT/PATCH/DELETE → 403 (requireRole gate)
//   - Space editor calling linkAlbum for an album they only have viewer access to → 400
//     (access.repository returns an empty access set → BadRequestException from
//     requireAccess, which throws "No access or bad request" with status 400)
//   - Non-member calling GET → 403 (requireMembership gate)

describe('/shared-spaces/:id/albums (T18)', () => {
  let admin: LoginResponseDto;
  // space owner (also album owner)
  let owner: LoginResponseDto;
  // space editor who also owns the album to link
  let editor: LoginResponseDto;
  // space viewer — cannot link/unlink/update
  let viewer: LoginResponseDto;
  // not a member of the space at all
  let nonMember: LoginResponseDto;

  let spaceId: string;

  // album owned by `owner`, shared with `editor` as album editor
  let ownerAlbum: AlbumResponseDto;
  // asset inside ownerAlbum so GET /assets/:id can be tested
  let albumAsset: AssetMediaResponseDto;
  // album owned by `owner`, shared with `editor` as album viewer only
  let ownerAlbumViewerOnly: AlbumResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();

    admin = await utils.adminSetup();

    [owner, editor, viewer, nonMember] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('t18-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('t18-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('t18-viewer')),
      utils.userSetup(admin.accessToken, createUserDto.create('t18-nonmember')),
    ]);

    // Create the space with owner as Owner, editor as Editor, viewer as Viewer.
    const spaceRes = await utils.createSpace(owner.accessToken, { name: 't18 space' });
    spaceId = spaceRes.id;

    await utils.addSpaceMember(owner.accessToken, spaceId, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, spaceId, { userId: viewer.userId, role: SharedSpaceRole.Viewer });

    // Create an asset owned by `owner` and upload it into ownerAlbum.
    albumAsset = await utils.createAsset(owner.accessToken);

    // Album owned by `owner`, shared with `editor` as album editor (so editor can link it).
    ownerAlbum = await utils.createAlbum(owner.accessToken, {
      albumName: 't18 owner album',
      albumUsers: [{ userId: editor.userId, role: AlbumUserRole.Editor }],
      assetIds: [albumAsset.id],
    });

    // Album owned by `owner`, shared with `editor` as album viewer only (editor cannot link it).
    ownerAlbumViewerOnly = await utils.createAlbum(owner.accessToken, {
      albumName: 't18 viewer-only album',
      albumUsers: [{ userId: editor.userId, role: AlbumUserRole.Viewer }],
    });
  });

  // ─── helpers ─────────────────────────────────────────────────────────────────

  /** PUT to link. Returns the raw response. */
  const linkAlbum = (token: string, albumId: string) =>
    request(app).put(`/shared-spaces/${spaceId}/albums/${albumId}`).set('Authorization', `Bearer ${token}`);

  /** PATCH to toggle showInTimeline. Returns the raw response. */
  const updateAlbum = (token: string, albumId: string, showInTimeline: boolean) =>
    request(app)
      .patch(`/shared-spaces/${spaceId}/albums/${albumId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ showInTimeline });

  /** DELETE to unlink. Returns the raw response. */
  const unlinkAlbum = (token: string, albumId: string) =>
    request(app).delete(`/shared-spaces/${spaceId}/albums/${albumId}`).set('Authorization', `Bearer ${token}`);

  /** GET to list. Returns the raw response. */
  const listAlbums = (token: string) =>
    request(app).get(`/shared-spaces/${spaceId}/albums`).set('Authorization', `Bearer ${token}`);

  // ─── PUT /shared-spaces/:id/albums/:albumId ───────────────────────────────

  describe('PUT /shared-spaces/:id/albums/:albumId', () => {
    it('unauthenticated → 401', async () => {
      const { status } = await request(app).put(`/shared-spaces/${spaceId}/albums/${ownerAlbum.id}`);
      expect(status).toBe(401);
    });

    it('space viewer → 403 (requireRole gate fires before album access gate)', async () => {
      const { status } = await linkAlbum(viewer.accessToken, ownerAlbum.id);
      expect(status).toBe(403);
    });

    it('non-member → 403', async () => {
      const { status } = await linkAlbum(nonMember.accessToken, ownerAlbum.id);
      expect(status).toBe(403);
    });

    it('space editor with album-viewer-only access → 400 (album access gate fires after role gate)', async () => {
      // editor is a space Editor (passes requireRole) but only an album viewer
      // (fails requireAccess(AlbumUpdate)) → access.repository denies → 400
      const { status } = await linkAlbum(editor.accessToken, ownerAlbumViewerOnly.id);
      expect(status).toBe(400);
    });

    it('space editor who is also album editor → 204', async () => {
      const { status } = await linkAlbum(editor.accessToken, ownerAlbum.id);
      expect(status).toBe(204);
    });

    it('linking the same album twice is idempotent (204 both times)', async () => {
      // The service's addAlbum call returns null on duplicate without error.
      const first = await linkAlbum(editor.accessToken, ownerAlbum.id);
      expect(first.status).toBe(204);

      const second = await linkAlbum(editor.accessToken, ownerAlbum.id);
      expect(second.status).toBe(204);
    });

    it('space owner → 204 (owner can also link albums they own)', async () => {
      // owner is Space Owner and Album Owner — both gates pass.
      // We use a fresh album so the list assertion later is clean.
      const freshAlbum = await utils.createAlbum(owner.accessToken, { albumName: 't18 owner-link' });
      const { status } = await linkAlbum(owner.accessToken, freshAlbum.id);
      expect(status).toBe(204);
      // clean up — unlink before continuing
      await unlinkAlbum(owner.accessToken, freshAlbum.id);
    });
  });

  // ─── PATCH /shared-spaces/:id/albums/:albumId ─────────────────────────────

  describe('PATCH /shared-spaces/:id/albums/:albumId', () => {
    // Pre-condition: ownerAlbum is linked (from the PUT suite above).

    it('unauthenticated → 401', async () => {
      const { status } = await request(app)
        .patch(`/shared-spaces/${spaceId}/albums/${ownerAlbum.id}`)
        .send({ showInTimeline: false });
      expect(status).toBe(401);
    });

    it('space viewer → 403', async () => {
      const { status } = await updateAlbum(viewer.accessToken, ownerAlbum.id, false);
      expect(status).toBe(403);
    });

    it('non-member → 403', async () => {
      const { status } = await updateAlbum(nonMember.accessToken, ownerAlbum.id, false);
      expect(status).toBe(403);
    });

    it('space editor → 204 (toggle showInTimeline=false) and the value persists', async () => {
      const { status } = await updateAlbum(editor.accessToken, ownerAlbum.id, false);
      expect(status).toBe(204);
      const { body } = await listAlbums(editor.accessToken);
      expect(
        (body as Array<{ id: string; showInTimeline: boolean }>).find((a) => a.id === ownerAlbum.id)?.showInTimeline,
      ).toBe(false);
    });

    it('space editor → 204 (toggle showInTimeline=true) and the value persists', async () => {
      const { status } = await updateAlbum(editor.accessToken, ownerAlbum.id, true);
      expect(status).toBe(204);
      const { body } = await listAlbums(editor.accessToken);
      expect(
        (body as Array<{ id: string; showInTimeline: boolean }>).find((a) => a.id === ownerAlbum.id)?.showInTimeline,
      ).toBe(true);
    });

    it('space owner → 204 and the value persists', async () => {
      const { status } = await updateAlbum(owner.accessToken, ownerAlbum.id, false);
      expect(status).toBe(204);
      const { body } = await listAlbums(owner.accessToken);
      expect(
        (body as Array<{ id: string; showInTimeline: boolean }>).find((a) => a.id === ownerAlbum.id)?.showInTimeline,
      ).toBe(false);
    });
  });

  // ─── GET /shared-spaces/:id/albums ────────────────────────────────────────

  describe('GET /shared-spaces/:id/albums', () => {
    // Pre-condition: ownerAlbum is linked (from the PUT suite above).

    it('unauthenticated → 401', async () => {
      const { status } = await request(app).get(`/shared-spaces/${spaceId}/albums`);
      expect(status).toBe(401);
    });

    it('non-member → 403', async () => {
      const { status } = await listAlbums(nonMember.accessToken);
      expect(status).toBe(403);
    });

    it('space viewer can list linked albums (any member allowed)', async () => {
      const { status, body } = await listAlbums(viewer.accessToken);
      expect(status).toBe(200);
      const albumIds = (body as Array<{ id: string }>).map((a) => a.id);
      expect(albumIds).toContain(ownerAlbum.id);
    });

    it('space editor can list linked albums', async () => {
      const { status, body } = await listAlbums(editor.accessToken);
      expect(status).toBe(200);
      const albumIds = (body as Array<{ id: string }>).map((a) => a.id);
      expect(albumIds).toContain(ownerAlbum.id);
    });

    it('space owner can list linked albums', async () => {
      const { status, body } = await listAlbums(owner.accessToken);
      expect(status).toBe(200);
      const albumIds = (body as Array<{ id: string }>).map((a) => a.id);
      expect(albumIds).toContain(ownerAlbum.id);
    });

    it('response shape includes id, albumName, showInTimeline, assetCount, createdAt, linkedAt, addedById, albumThumbnailAssetId', async () => {
      const { body } = await listAlbums(owner.accessToken);
      const linked = (body as Array<Record<string, unknown>>).find((a) => a['id'] === ownerAlbum.id);
      expect(linked).toBeDefined();
      expect(linked).toEqual(
        expect.objectContaining({
          id: ownerAlbum.id,
          albumName: 't18 owner album',
          showInTimeline: expect.any(Boolean),
          assetCount: expect.any(Number),
          createdAt: expect.any(String),
          // linkedAt: the link-creation timestamp (distinct from the album createdAt)
          linkedAt: expect.any(String),
          // addedById: the user who linked the album (editor linked it)
          addedById: expect.any(String),
          // albumThumbnailAssetId: set because ownerAlbum was created with an asset
          albumThumbnailAssetId: expect.any(String),
        }),
      );
    });

    it('response does NOT expose albumUsers or email (PII guard, Slice 7)', async () => {
      // Any space member — including a plain Viewer — must not receive albumUsers arrays
      // or email addresses when listing linked albums. Deep-scan the full response body.
      const { status, body } = await listAlbums(viewer.accessToken);
      expect(status).toBe(200);

      const items = body as Array<Record<string, unknown>>;
      for (const item of items) {
        // albumUsers must not be present on any linked-album entry
        expect(item['albumUsers']).toBeUndefined();

        // No email field anywhere in the serialized entry
        const serialized = JSON.stringify(item);
        expect(serialized).not.toMatch(/"email"\s*:/);
      }
    });

    it('absorbed invariant: linked album is NOT returned by GET /albums for space members', async () => {
      // Space membership must not make the album visible via the regular /albums
      // list for members who don't own or have explicit album-user access.
      // viewer has no direct album-user row on ownerAlbum, so it must not appear.
      const { status, body } = await request(app).get('/albums').set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(status).toBe(200);
      const albumIds = (body as Array<{ id: string }>).map((a) => a.id);
      expect(albumIds).not.toContain(ownerAlbum.id);
    });
  });

  // ─── Read access: space viewer can GET album assets ──────────────────────

  describe('asset visibility via space', () => {
    it('space viewer can GET an album asset via /assets/:id', async () => {
      // albumAsset was added to ownerAlbum which is linked to the space.
      // A space viewer should be able to read the asset through the space grant.
      const { status } = await request(app)
        .get(`/assets/${albumAsset.id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(status).toBe(200);
    });

    it('non-member cannot GET the album asset via /assets/:id', async () => {
      const { status } = await request(app)
        .get(`/assets/${albumAsset.id}`)
        .set('Authorization', `Bearer ${nonMember.accessToken}`);
      // Non-member has no space access; asset is private to owner.
      // Immich returns 400 when access is denied (access.repository returns empty set).
      expect(status).toBe(400);
    });
  });

  // ─── Album asset add/remove via /albums/:id/assets ────────────────────────

  describe('album asset add/remove via /albums/:id/assets (existing endpoint)', () => {
    it('space editor (album editor) can add assets to a linked album', async () => {
      // editor is an album_user-editor on ownerAlbum — the standard album-update
      // permission allows adding assets.
      const editorAsset = await utils.createAsset(editor.accessToken);
      const { status } = await request(app)
        .put(`/albums/${ownerAlbum.id}/assets`)
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send({ ids: [editorAsset.id] });
      // The albums add-assets endpoint returns 200 with a bulk result array.
      expect(status).toBe(200);
    });

    it('space viewer (no album-user row) cannot add assets to a linked album', async () => {
      const viewerAsset = await utils.createAsset(viewer.accessToken);
      const { status } = await request(app)
        .put(`/albums/${ownerAlbum.id}/assets`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ ids: [viewerAsset.id] });
      // viewer has no AlbumUpdate permission on ownerAlbum → access denied.
      // Immich's access gate returns 400 for missing access.
      expect(status).toBe(400);
    });
  });

  // ─── Read grant: AlbumRead + album-filtered timeline (Phase 1.5 T19) ───────
  //
  // checkSpaceLinkedAlbumReadAccess (access.repository.ts) unions into
  // Permission.AlbumRead and Permission.AlbumDownload so that ANY space member
  // — including Viewer — can:
  //   • GET /albums/:id            → 200  (album entity)
  //   • GET /timeline/buckets?albumId=…  → 200  (access-gate path)
  //   • GET /timeline/bucket?albumId=…&timeBucket=… → 200  (content path)
  //
  // Non-members and members requesting a NON-LINKED album still get 400
  // (requireAccess throws BadRequestException with "Not found or no album.read access").

  describe('read grant: space viewer can GET /albums/:id and album-filtered timeline', () => {
    // Pre-condition: ownerAlbum is linked (from PUT suite above). ownerAlbumViewerOnly
    // is NOT linked to the space at any point — used for the "not linked" boundary test.

    it('space viewer can GET /albums/:id for a linked album → 200', async () => {
      // viewer has no album_user row on ownerAlbum, but ownerAlbum is linked to the
      // space and viewer is a space member → checkSpaceLinkedAlbumReadAccess grants access.
      const { status, body } = await request(app)
        .get(`/albums/${ownerAlbum.id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(status).toBe(200);
      expect((body as { id: string }).id).toBe(ownerAlbum.id);
    });

    it('non-member cannot GET /albums/:id for a linked album → 400', async () => {
      // nonMember has no space membership → access.repository returns empty set →
      // requireAccess throws BadRequestException (status 400), same invariant as
      // all other access-gate failures in the Immich codebase.
      const { status } = await request(app)
        .get(`/albums/${ownerAlbum.id}`)
        .set('Authorization', `Bearer ${nonMember.accessToken}`);
      expect(status).toBe(400);
    });

    it('space member cannot GET /albums/:id for an album NOT linked to their space → 400', async () => {
      // ownerAlbumViewerOnly is never linked to the space. viewer has no album_user
      // row on it either. The read grant is scoped to linked albums only.
      const { status } = await request(app)
        .get(`/albums/${ownerAlbumViewerOnly.id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(status).toBe(400);
    });

    it('space viewer can GET /timeline/buckets?albumId for a linked album → 200', async () => {
      // The timeline service calls timeBucketChecks → requireAccess(AlbumRead, [albumId]).
      // checkSpaceLinkedAlbumReadAccess now unions into AlbumRead, so Viewer passes.
      const { status } = await request(app)
        .get(`/timeline/buckets?albumId=${ownerAlbum.id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(status).toBe(200);
    });

    it('space viewer can GET /timeline/bucket?albumId for a linked album → 200', async () => {
      // Step 1: fetch buckets to discover the timeBucket identifier for ownerAlbum.
      // albumAsset was created by owner and sits in ownerAlbum, so at least one bucket exists.
      const bucketsRes = await request(app)
        .get(`/timeline/buckets?albumId=${ownerAlbum.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(bucketsRes.status).toBe(200);
      const buckets = bucketsRes.body as Array<{ timeBucket: string }>;
      expect(buckets.length).toBeGreaterThan(0);

      // Step 2: viewer fetches the singular bucket — proves the content path is also granted.
      const { status, body } = await request(app)
        .get(`/timeline/bucket?albumId=${ownerAlbum.id}&timeBucket=${buckets[0].timeBucket}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(status).toBe(200);
      // Response is a parallel-array TimeBucketAssetResponseDto; pin the shape.
      expect(body).toHaveProperty('id');
      expect(Array.isArray((body as { id: string[] }).id)).toBe(true);
    });

    it('non-member cannot GET /timeline/buckets?albumId for a linked album → 400', async () => {
      // Mirror of the GET /albums/:id non-member case: requireAccess fires before
      // any data is returned, so non-members get 400 regardless of which timeline
      // endpoint they hit (same BadRequestException invariant).
      const { status } = await request(app)
        .get(`/timeline/buckets?albumId=${ownerAlbum.id}`)
        .set('Authorization', `Bearer ${nonMember.accessToken}`);
      expect(status).toBe(400);
    });

    it('space editor can PUT /albums/:id/assets (add) to a linked album → 200', async () => {
      // Re-assert Phase-1 write grant still works after the AlbumRead union was added.
      // editor is an album_user-editor on ownerAlbum, so AlbumAssetCreate is satisfied.
      const editorAsset2 = await utils.createAsset(editor.accessToken);
      const { status } = await request(app)
        .put(`/albums/${ownerAlbum.id}/assets`)
        .set('Authorization', `Bearer ${editor.accessToken}`)
        .send({ ids: [editorAsset2.id] });
      expect(status).toBe(200);
    });

    // L1: contributorCounts exposes contributor userIds + per-user asset counts — PII-adjacent
    // in the same way albumUsers is (security-8). A space-only reader (no album_user row, access
    // granted only via the space link) must not receive it.
    it('space viewer (space-only access, no direct album grant) gets contributorCounts=undefined (L1)', async () => {
      const { status, body } = await request(app)
        .get(`/albums/${ownerAlbum.id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(status).toBe(200);
      expect((body as AlbumResponseDto).contributorCounts).toBeUndefined();
    });

    it('album editor (direct album_user participant) still gets contributorCounts (positive control)', async () => {
      const { status, body } = await request(app)
        .get(`/albums/${ownerAlbum.id}`)
        .set('Authorization', `Bearer ${editor.accessToken}`);
      expect(status).toBe(200);
      expect((body as AlbumResponseDto).contributorCounts).toBeDefined();
      expect(Array.isArray((body as AlbumResponseDto).contributorCounts)).toBe(true);
    });
  });

  // ─── Album delete via /albums/:id ─────────────────────────────────────────

  describe('album delete via /albums/:id', () => {
    it('space editor (not album owner) cannot delete ownerAlbum', async () => {
      // Only the album owner can delete the album. Space editor role does not
      // grant album delete permission.
      const { status } = await request(app)
        .delete(`/albums/${ownerAlbum.id}`)
        .set('Authorization', `Bearer ${editor.accessToken}`);
      // Immich's access layer returns 400 (BadRequestException) when the access
      // set check fails — not 403 — so assert the actual code returned.
      expect(status).toBe(400);
    });

    it('album owner can delete their own album', async () => {
      // Use a throwaway album to avoid side-effects on the linked ownerAlbum.
      const throwaway = await utils.createAlbum(owner.accessToken, { albumName: 't18 throwaway' });
      const { status } = await request(app)
        .delete(`/albums/${throwaway.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      // DELETE /albums/:id returns 204 No Content on success.
      expect(status).toBe(204);
    });
  });

  // ─── RBAC F3: non-UUID albumId param → 400 (not 500) ─────────────────────
  //
  // The controller now uses SharedSpaceAlbumParamDto (z.uuidv4() for both id
  // and albumId) so a non-UUID albumId is rejected by the ZodValidationPipe
  // with a 400 before the service layer is reached.

  describe('invalid albumId param → 400 (RBAC F3)', () => {
    it('PUT with non-UUID albumId → 400 (not 500)', async () => {
      const { status } = await request(app)
        .put(`/shared-spaces/${spaceId}/albums/not-a-uuid`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(status).toBe(400);
    });

    it('PATCH with non-UUID albumId → 400 (not 500)', async () => {
      const { status } = await request(app)
        .patch(`/shared-spaces/${spaceId}/albums/not-a-uuid`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ showInTimeline: true });
      expect(status).toBe(400);
    });

    it('DELETE with non-UUID albumId → 400 (not 500)', async () => {
      const { status } = await request(app)
        .delete(`/shared-spaces/${spaceId}/albums/not-a-uuid`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(status).toBe(400);
    });
  });

  // ─── DELETE /shared-spaces/:id/albums/:albumId ────────────────────────────

  describe('DELETE /shared-spaces/:id/albums/:albumId', () => {
    // Pre-condition: ownerAlbum is still linked.

    it('unauthenticated → 401', async () => {
      const { status } = await request(app).delete(`/shared-spaces/${spaceId}/albums/${ownerAlbum.id}`);
      expect(status).toBe(401);
    });

    it('space viewer → 403', async () => {
      const { status } = await unlinkAlbum(viewer.accessToken, ownerAlbum.id);
      expect(status).toBe(403);
    });

    it('non-member → 403', async () => {
      const { status } = await unlinkAlbum(nonMember.accessToken, ownerAlbum.id);
      expect(status).toBe(403);
    });

    it('space editor → 204', async () => {
      // Re-link first (in case a previous test left it unlinked).
      await linkAlbum(editor.accessToken, ownerAlbum.id);
      const { status } = await unlinkAlbum(editor.accessToken, ownerAlbum.id);
      expect(status).toBe(204);
    });

    it('unlinking an already-unlinked album returns a clean 404 on the repeat call (M11: no activity-feed growth)', async () => {
      // Ensure unlinked regardless of test order, then assert the second unlink 404s
      // instead of silently no-op'ing (that no-op used to fire an unconditional
      // AlbumUnlink activity — see the M11 describe block below).
      await unlinkAlbum(editor.accessToken, ownerAlbum.id);
      const { status } = await unlinkAlbum(editor.accessToken, ownerAlbum.id);
      expect(status).toBe(404);
    });

    it('after unlinking, album no longer appears in GET /shared-spaces/:id/albums', async () => {
      // Ensure unlinked regardless of test order before asserting the list.
      await unlinkAlbum(editor.accessToken, ownerAlbum.id);
      const { body } = await listAlbums(owner.accessToken);
      const albumIds = (body as Array<{ id: string }>).map((a) => a.id);
      expect(albumIds).not.toContain(ownerAlbum.id);
    });

    it('space owner → 204', async () => {
      // Link then unlink as owner.
      await linkAlbum(owner.accessToken, ownerAlbum.id);
      const { status } = await unlinkAlbum(owner.accessToken, ownerAlbum.id);
      expect(status).toBe(204);
    });
  });
});

const addSpaceAssets = (token: string, spaceId: string, assetIds: string[]) =>
  request(app).post(`/shared-spaces/${spaceId}/assets`).set('Authorization', `Bearer ${token}`).send({ assetIds });

const bulkUpdateAssets = (token: string, body: Record<string, unknown>) =>
  request(app).put('/assets').set('Authorization', `Bearer ${token}`).send(body);

const singleUpdateAsset = (token: string, id: string, body: Record<string, unknown>) =>
  request(app).put(`/assets/${id}`).set('Authorization', `Bearer ${token}`).send(body);

// rbac-2 (CI-deferred — Docker down): a space Viewer must not re-share album assets they can only READ.
describe('rbac-2: addAssets requires AssetShare (read→re-share escalation)', () => {
  let admin: LoginResponseDto;
  let victim: LoginResponseDto; // owns album X (asset A) and space S1
  let attacker: LoginResponseDto; // Viewer of S1, Owner of S2

  let assetA: AssetMediaResponseDto;
  let attackerSpaceId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [victim, attacker] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('rbac2-victim')),
      utils.userSetup(admin.accessToken, createUserDto.create('rbac2-attacker')),
    ]);

    // Victim owns asset A (Timeline → shareable via the space-album read arm) inside album X.
    assetA = await utils.createAsset(victim.accessToken);
    const albumX = await utils.createAlbum(victim.accessToken, {
      albumName: 'rbac2 album X',
      assetIds: [assetA.id],
    });

    // Victim's space S1 links album X; attacker joins S1 as Viewer → AssetRead on A via checkSpaceAccess's album arm.
    const s1 = await utils.createSpace(victim.accessToken, { name: 'rbac2 S1' });
    await utils.addSpaceMember(victim.accessToken, s1.id, { userId: attacker.userId, role: SharedSpaceRole.Viewer });
    await utils.linkSpaceAlbum(victim.accessToken, s1.id, albumX.id);

    // Attacker owns space S2 (they are its Owner ≥ Editor, so requireRole(Editor) passes and the asset gate is reached).
    const s2 = await utils.createSpace(attacker.accessToken, { name: 'rbac2 S2' });
    attackerSpaceId = s2.id;
  });

  it('attacker cannot re-add a victim asset they only READ via the linked album → 400', async () => {
    const { status } = await addSpaceAssets(attacker.accessToken, attackerSpaceId, [assetA.id]);
    expect(status).toBe(400); // requireAccess(AssetShare) denial → BadRequestException (was 204 pre-fix)
  });

  it('victim can still add their own asset to their own space → 204', async () => {
    const s = await utils.createSpace(victim.accessToken, { name: 'rbac2 victim space' });
    const { status } = await addSpaceAssets(victim.accessToken, s.id, [assetA.id]);
    expect(status).toBe(204);
  });
});

// rbac-3 (CI-deferred — Docker down): a space Editor must not flip another member's asset visibility.
describe('rbac-3: visibility writes are restricted to owned assets', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto; // space owner
  let editor: LoginResponseDto; // space editor (attacker)
  let victim: LoginResponseDto; // contributes an asset to the space

  let spaceId: string;
  let victimAsset: AssetMediaResponseDto;
  let victimAlbum: AlbumResponseDto;
  let editorAsset: AssetMediaResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    [owner, editor, victim] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('rbac3-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('rbac3-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('rbac3-victim')),
    ]);

    const space = await utils.createSpace(owner.accessToken, { name: 'rbac3 space' });
    spaceId = space.id;
    await utils.addSpaceMember(owner.accessToken, spaceId, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, spaceId, { userId: victim.userId, role: SharedSpaceRole.Editor });

    // Victim owns an asset in a personal album AND direct in the space → editor gains checkSpaceEditAccess over it.
    victimAsset = await utils.createAsset(victim.accessToken);
    victimAlbum = await utils.createAlbum(victim.accessToken, {
      albumName: 'rbac3 victim album',
      assetIds: [victimAsset.id],
    });
    await utils.addSpaceAssets(victim.accessToken, spaceId, [victimAsset.id]);

    // Editor owns their own asset in the space (positive control).
    editorAsset = await utils.createAsset(editor.accessToken);
    await utils.addSpaceAssets(editor.accessToken, spaceId, [editorAsset.id]);
  });

  it('editor cannot bulk-lock the victim asset → 403; asset stays Timeline and stays in the victim album', async () => {
    const { status } = await bulkUpdateAssets(editor.accessToken, {
      ids: [victimAsset.id],
      visibility: AssetVisibility.Locked,
    });
    expect(status).toBe(403);

    // Cascade did NOT fire: visibility unchanged and still an album member.
    const { status: getStatus, body } = await request(app)
      .get(`/assets/${victimAsset.id}`)
      .set('Authorization', `Bearer ${victim.accessToken}`);
    expect(getStatus).toBe(200);
    expect(body.visibility).toBe(AssetVisibility.Timeline);

    // The cascade did NOT fire, so victimAsset is still an album member. Assert on assetCount:
    // a freshly-uploaded asset isn't populated into the `assets` array until async processing
    // completes, but assetCount reflects the album_asset row immediately.
    const { body: album } = await request(app)
      .get(`/albums/${victimAlbum.id}`)
      .set('Authorization', `Bearer ${victim.accessToken}`);
    expect(album.assetCount).toBe(1);
  });

  it('editor cannot single-PUT the victim asset to Hidden → 403', async () => {
    const { status } = await singleUpdateAsset(editor.accessToken, victimAsset.id, {
      visibility: AssetVisibility.Hidden,
    });
    expect(status).toBe(403);
  });

  it('editor CAN change visibility on their OWN asset → 204', async () => {
    const { status } = await bulkUpdateAssets(editor.accessToken, {
      ids: [editorAsset.id],
      visibility: AssetVisibility.Archive,
    });
    expect(status).toBe(204);
  });

  it('editor CAN still set a non-visibility field on the victim asset (existing policy) → 204', async () => {
    const { status } = await bulkUpdateAssets(editor.accessToken, { ids: [victimAsset.id], isFavorite: true });
    expect(status).toBe(204);
  });
});

// rbac-6 (CI-deferred — Docker down): the album owner can see + revoke every shared-space link to
// their album, even without space membership; non-owners never see the list.
describe('rbac-6 — album-link ownership controls', () => {
  let albumOwner: LoginResponseDto; // owns the album; NOT a member of the space
  let spaceEditor: LoginResponseDto; // space owner + album editor → performs the link
  let stranger: LoginResponseDto; // no relationship to album or space
  let spaceA: SharedSpaceResponseDto;
  let spaceB: SharedSpaceResponseDto;
  let album: AlbumResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    const admin = await utils.adminSetup();
    [albumOwner, spaceEditor, stranger] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('rbac6-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('rbac6-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('rbac6-stranger')),
    ]);

    const asset = await utils.createAsset(albumOwner.accessToken);
    album = await utils.createAlbum(albumOwner.accessToken, {
      albumName: 'Owner Album',
      albumUsers: [{ userId: spaceEditor.userId, role: AlbumUserRole.Editor }],
      assetIds: [asset.id],
    });

    // spaceEditor owns both spaces (space owner is an Editor+); albumOwner is NOT a member of either.
    spaceA = await utils.createSpace(spaceEditor.accessToken, { name: 'Space A' });
    spaceB = await utils.createSpace(spaceEditor.accessToken, { name: 'Space B' });
    await utils.linkSpaceAlbum(spaceEditor.accessToken, spaceA.id, album.id);
    await utils.linkSpaceAlbum(spaceEditor.accessToken, spaceB.id, album.id);
  });

  it('shows the album owner every space link (multi-space), with showInTimeline', async () => {
    const info = await getAlbumInfo({ id: album.id }, { headers: asBearerAuth(albumOwner.accessToken) });
    expect(info.sharedSpaceLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ spaceId: spaceA.id, spaceName: 'Space A', showInTimeline: true }),
        expect.objectContaining({ spaceId: spaceB.id, spaceName: 'Space B', showInTimeline: true }),
      ]),
    );
    expect(info.sharedSpaceLinks).toHaveLength(2);
  });

  it('does NOT show sharedSpaceLinks to a space member who is not the album owner', async () => {
    // spaceEditor is a space owner + album editor but NOT the album owner.
    const info = await getAlbumInfo({ id: album.id }, { headers: asBearerAuth(spaceEditor.accessToken) });
    expect(info.sharedSpaceLinks).toBeUndefined();
  });

  it('lets the album owner (not a space member) unlink one space, leaving the other + the album intact', async () => {
    await request(app)
      .delete(`/shared-spaces/${spaceA.id}/albums/${album.id}`)
      .set('Authorization', `Bearer ${albumOwner.accessToken}`)
      .expect(204);

    const info = await getAlbumInfo({ id: album.id }, { headers: asBearerAuth(albumOwner.accessToken) });
    expect(info.sharedSpaceLinks).toEqual([expect.objectContaining({ spaceId: spaceB.id, spaceName: 'Space B' })]);
    // The album itself is untouched.
    expect(info.id).toBe(album.id);
    expect(info.assetCount).toBe(1);
  });

  it('rejects unlink from a non-owner non-member (403)', async () => {
    await request(app)
      .delete(`/shared-spaces/${spaceB.id}/albums/${album.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(403);
  });
});

// M11 — unlinkAlbum owner-arm authorization gap.
//
// Before the fix, the owner arm of unlinkAlbum authorized on album ownership only and never
// checked that the album was actually linked to the target space. logActivity then fired
// unconditionally after a no-op removeAlbum, so (1) the album owner could inject an AlbumUnlink
// activity into any space UUID they own the album against — even one they're not a member of and
// the album was never linked to — and (2) a nonexistent spaceId 500'd on the
// shared_space_activity.spaceId FK instead of 404ing. The fix adds a hasAlbumLink(spaceId, albumId)
// guard before any side effect (logActivity, orphaned-face cleanup, grant reconcile).
describe('M11 — unlinkAlbum requires a real album<->space link before any side effect', () => {
  let albumOwner: LoginResponseDto; // owns unlinkedAlbum; NOT a member of spaceC
  let spaceEditor: LoginResponseDto; // owns spaceC, and is an album editor on unlinkedAlbum
  let spaceC: SharedSpaceResponseDto;
  let unlinkedAlbum: AlbumResponseDto; // deliberately never linked to spaceC in beforeAll

  // A syntactically-valid UUID that is never assigned to any real space in this test.
  const NONEXISTENT_SPACE_ID = '00000000-0000-4000-a000-0000000000f1';

  beforeAll(async () => {
    await utils.resetDatabase();
    const admin = await utils.adminSetup();
    [albumOwner, spaceEditor] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('m11-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('m11-editor')),
    ]);

    unlinkedAlbum = await utils.createAlbum(albumOwner.accessToken, {
      albumName: 'M11 Unlinked Album',
      albumUsers: [{ userId: spaceEditor.userId, role: AlbumUserRole.Editor }],
    });
    spaceC = await utils.createSpace(spaceEditor.accessToken, { name: 'M11 Space C' });
    // Deliberately: unlinkedAlbum is never linked to spaceC here.
  });

  it('album owner unlinking from a space the album was never linked to → 404, and injects no activity', async () => {
    const before = await getSpaceActivities({ id: spaceC.id }, { headers: asBearerAuth(spaceEditor.accessToken) });

    const { status } = await request(app)
      .delete(`/shared-spaces/${spaceC.id}/albums/${unlinkedAlbum.id}`)
      .set('Authorization', `Bearer ${albumOwner.accessToken}`);
    expect(status).toBe(404);

    const after = await getSpaceActivities({ id: spaceC.id }, { headers: asBearerAuth(spaceEditor.accessToken) });
    expect(after).toHaveLength(before.length);
    // 'album_unlink' mirrors the server's SharedSpaceActivityType.AlbumUnlink wire value.
    expect(after.some((activity) => activity.type === 'album_unlink')).toBe(false);
  });

  it('repeated unlink attempts on the never-linked album each 404 cleanly (no feed growth)', async () => {
    await request(app)
      .delete(`/shared-spaces/${spaceC.id}/albums/${unlinkedAlbum.id}`)
      .set('Authorization', `Bearer ${albumOwner.accessToken}`)
      .expect(404);

    const { status } = await request(app)
      .delete(`/shared-spaces/${spaceC.id}/albums/${unlinkedAlbum.id}`)
      .set('Authorization', `Bearer ${albumOwner.accessToken}`);
    expect(status).toBe(404);

    const activities = await getSpaceActivities({ id: spaceC.id }, { headers: asBearerAuth(spaceEditor.accessToken) });
    expect(activities.some((activity) => activity.type === 'album_unlink')).toBe(false);
  });

  it('album owner unlinking from a nonexistent spaceId → 404, not 500', async () => {
    const { status } = await request(app)
      .delete(`/shared-spaces/${NONEXISTENT_SPACE_ID}/albums/${unlinkedAlbum.id}`)
      .set('Authorization', `Bearer ${albumOwner.accessToken}`);
    expect(status).toBe(404);
  });

  it('a non-owner caller still gets 403 for a nonexistent spaceId (no 404-vs-403 link-existence leak)', async () => {
    // getMember(nonexistent spaceId, spaceEditor) resolves null, so this falls into the owner
    // arm's checkAccess(AlbumDelete) check. spaceEditor only has AlbumUser-editor access on
    // unlinkedAlbum (not ownership), so it's expected to 403 at that auth check — before the
    // hasAlbumLink probe is ever reached. A non-owner must never learn "this space doesn't
    // exist / this album isn't linked" (404) vs "you're not authorized" (403).
    const { status } = await request(app)
      .delete(`/shared-spaces/${NONEXISTENT_SPACE_ID}/albums/${unlinkedAlbum.id}`)
      .set('Authorization', `Bearer ${spaceEditor.accessToken}`);
    expect(status).toBe(403);
  });

  it('positive control: album owner unlinking a genuinely linked album succeeds with exactly one AlbumUnlink activity', async () => {
    const before = await getSpaceActivities({ id: spaceC.id }, { headers: asBearerAuth(spaceEditor.accessToken) });
    const beforeUnlinkCount = before.filter((activity) => activity.type === 'album_unlink').length;

    // Link it for real (spaceEditor is space owner of spaceC + album editor on unlinkedAlbum).
    await utils.linkSpaceAlbum(spaceEditor.accessToken, spaceC.id, unlinkedAlbum.id);

    const { status } = await request(app)
      .delete(`/shared-spaces/${spaceC.id}/albums/${unlinkedAlbum.id}`)
      .set('Authorization', `Bearer ${albumOwner.accessToken}`);
    expect(status).toBe(204);

    const after = await getSpaceActivities({ id: spaceC.id }, { headers: asBearerAuth(spaceEditor.accessToken) });
    expect(after.filter((activity) => activity.type === 'album_unlink')).toHaveLength(beforeUnlinkCount + 1);
  });
});
