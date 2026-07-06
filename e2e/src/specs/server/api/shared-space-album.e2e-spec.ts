import { AlbumResponseDto, AlbumUserRole, AssetMediaResponseDto, LoginResponseDto, SharedSpaceRole } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, utils } from 'src/utils';
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

    it('space editor → 204 (toggle showInTimeline=false)', async () => {
      const { status } = await updateAlbum(editor.accessToken, ownerAlbum.id, false);
      expect(status).toBe(204);
    });

    it('space editor → 204 (toggle showInTimeline=true)', async () => {
      const { status } = await updateAlbum(editor.accessToken, ownerAlbum.id, true);
      expect(status).toBe(204);
    });

    it('space owner → 204', async () => {
      const { status } = await updateAlbum(owner.accessToken, ownerAlbum.id, false);
      expect(status).toBe(204);
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

    it('unlinking an already-unlinked album is idempotent (204)', async () => {
      // Ensure unlinked regardless of test order, then assert the second unlink is also 204.
      await unlinkAlbum(editor.accessToken, ownerAlbum.id);
      const { status } = await unlinkAlbum(editor.accessToken, ownerAlbum.id);
      expect(status).toBe(204);
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
