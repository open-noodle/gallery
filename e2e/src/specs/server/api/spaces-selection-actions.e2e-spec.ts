/**
 * Slice 1 — Server/API RBAC matrix for the selection-toolbar-consistency spec.
 *
 * Source: docs/superpowers/specs/2026-07-24-selection-toolbar-consistency-design.md,
 * "### Server/API RBAC matrix (Slice 1 — runs first, gates now RESOLVED)". This suite is the
 * regression tripwire for the RBAC gate decisions the web capability rule engine (Slice 2) depends
 * on: Q1/Q2 (Share / Add-to-album are owner∪partner-only via `Permission.AssetShare`), decision C
 * (space-album Remove-from-album is role-gated, ownership grants nothing), and Q5 (an owner's own
 * mutations are never blocked just because the asset is album-path in a space).
 *
 * Fixture: `buildSpaceContext()` (src/actors.ts) gives spaceOwner/spaceEditor/spaceViewer/
 * spaceNonMember, a space owned by spaceOwner, and `spaceAssetId` — an asset OWNED by spaceOwner
 * and added DIRECTLY to the space (`shared_space_asset`). Every action below targets that asset
 * unless the action is destructive, in which case a dedicated throwaway asset is used instead (see
 * inline notes) so earlier assertions in this file never depend on execution order.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * TWO CORRECTIONS vs. the design doc's literal "Server/API RBAC matrix" text (verified against
 * the CURRENT server source, not just the doc's summary — flagged for whoever reviews this slice):
 *
 * 1. Favorite / metadata update of spaceAssetId is NOT "owner-only, others → 4xx". `PUT /assets`
 *    (bulk update) checks `Permission.AssetUpdate`, which is `isOwner ∪ checkSpaceEditAccess`
 *    (server/src/utils/access.ts:155-159). `checkSpaceEditAccess` (access.repository.ts:488-527)
 *    grants any space member with role Editor/Owner write access to every asset directly in that
 *    space's pool (`shared_space_asset`) — REGARDLESS of who owns the specific asset. The only
 *    restriction is a dedicated guard for `visibility`/`livePhotoVideoId` (asset.service.ts:214-224,
 *    "rbac-3"), whose own comment says explicitly: "other metadata (description/rating/…) stays
 *    editor-allowed." `isFavorite` is not part of that guard either (asset.service.ts:298-329).
 *    So for spaceAssetId (owned by spaceOwner, direct-add to the space): spaceOwner AND spaceEditor
 *    both succeed; spaceViewer (role below Editor) and spaceNonMember (no membership) are rejected.
 *    This is corroborated by shared-space.service.ts:668-671's own comment describing exactly this
 *    escalation path ("gaining AssetUpdate over the owner's assets via checkSpaceEditAccess").
 *    Delete is unaffected — `Permission.AssetDelete` is pure `checkOwnerAccess` with no space arm
 *    (access.ts:161-163), so Delete really is owner-only, matching the design doc there.
 *
 * 2. Add-to-album of a non-owned spaceAssetId into the actor's OWN (non-space) album does NOT
 *    return an HTTP 4xx for a non-owner. `PUT /albums/:id/assets` (album.service.ts `addAssets`,
 *    lines 253-262) only throws (400) if the actor lacks `AlbumAssetCreate` on the target ALBUM —
 *    trivially true here since every actor targets an album THEY just created. The per-ASSET
 *    `AssetShare` gate is applied via the non-throwing `checkAccess` (utils/asset.util.ts `addAssets`
 *    helper, lines 33-71) and reported per-item in the response body
 *    (`BulkIdResponseDto[]`: `{id, success, error}`), not as a request-level status code. So every
 *    actor gets HTTP 200; only the body's `success`/`error` fields differ (owner: success=true;
 *    others: success=false, error='no_permission'). Asserted on the body below rather than status.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

import { AlbumUserRole, BulkIdErrorReason, SharedLinkType, addUsersToAlbum } from '@immich/sdk';
import { authHeaders, buildSpaceContext, forEachActor, type SpaceContext } from 'src/actors';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

describe('Server/API RBAC matrix — selection-toolbar consistency (Slice 1)', () => {
  let ctx: SpaceContext;

  // FIXTURE LIFETIME: ctx is built once and treated as read-only by every `it` below except
  // where a describe block explicitly creates its own dedicated (throwaway) assets/albums for a
  // destructive action, so no test here depends on another test's execution order.
  beforeAll(async () => {
    await utils.resetDatabase();
    ctx = await buildSpaceContext();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Download — GET /assets/:id/original (Permission.AssetDownload)
  // ─────────────────────────────────────────────────────────────────────────

  describe('Download — GET /assets/:id/original', () => {
    it('Given spaceAssetId (owned by spaceOwner, direct space member), When each actor downloads it, Then owner/editor/viewer succeed and non-member is rejected', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember],
        (actor) => request(app).get(`/assets/${ctx.spaceAssetId}/original`).set(authHeaders(actor)),
        { spaceOwner: 200, spaceEditor: 200, spaceViewer: 200, spaceNonMember: 400 },
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Create-shared-link — POST /shared-links (type=INDIVIDUAL) (Permission.AssetShare)
  // ─────────────────────────────────────────────────────────────────────────

  describe('Create-shared-link — POST /shared-links (type=INDIVIDUAL, assetIds=[spaceAssetId])', () => {
    it('Given spaceAssetId owned by spaceOwner, When each actor creates an individual shared link referencing it, Then only the owner succeeds (AssetShare = owner ∪ partner only, no album/space arm — access.ts:127-131)', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember],
        (actor) =>
          request(app)
            .post('/shared-links')
            .set(authHeaders(actor))
            .send({ type: SharedLinkType.Individual, assetIds: [ctx.spaceAssetId] }),
        { spaceOwner: 201, spaceEditor: 400, spaceViewer: 400, spaceNonMember: 400 },
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Add-to-album — PUT /albums/:id/assets, into the actor's OWN (non-space) album
  //    See file-level correction #2: status is 200 for everyone; the body differs.
  // ─────────────────────────────────────────────────────────────────────────

  describe("Add-to-album — PUT /albums/:id/assets (each actor's own brand-new, non-space album)", () => {
    it("Given each actor creates their own album, When they try to add spaceAssetId to it, Then the request itself is 200 for everyone (they own the target album) but only the owner's item succeeds — others get success:false/no_permission (AssetShare gate, applied per-asset, non-throwing)", async () => {
      const actors = [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember];

      for (const actor of actors) {
        const album = await utils.createAlbum(actor.token!, { albumName: `slice1-add-to-album-${actor.id}` });

        const res = await request(app)
          .put(`/albums/${album.id}/assets`)
          .set(authHeaders(actor))
          .send({ ids: [ctx.spaceAssetId] });

        expect(res.status, `actor=${actor.id} unexpected HTTP status: ${JSON.stringify(res.body)}`).toBe(200);

        const [result] = res.body as Array<{ id: string; success: boolean; error?: string }>;
        const expectOwnerSuccess = actor.id === 'spaceOwner';
        expect(result.id, `actor=${actor.id} result id mismatch`).toBe(ctx.spaceAssetId);
        expect(result.success, `actor=${actor.id} success mismatch`).toBe(expectOwnerSuccess);
        if (!expectOwnerSuccess) {
          expect(result.error, `actor=${actor.id} error reason mismatch`).toBe(BulkIdErrorReason.NoPermission);
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Favorite — PUT /assets bulk update, isFavorite (Permission.AssetUpdate)
  //    See file-level correction #1: editor succeeds too, not just the owner.
  // ─────────────────────────────────────────────────────────────────────────

  describe('Favorite — PUT /assets (bulk, isFavorite)', () => {
    it('Given spaceAssetId, When each actor bulk-favorites it, Then owner AND editor succeed (AssetUpdate = isOwner ∪ checkSpaceEditAccess; isFavorite is not visibility-restricted) and viewer/non-member are rejected', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember],
        (actor) =>
          request(app)
            .put('/assets')
            .set(authHeaders(actor))
            .send({ ids: [ctx.spaceAssetId], isFavorite: true }),
        { spaceOwner: 204, spaceEditor: 204, spaceViewer: 400, spaceNonMember: 400 },
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Metadata update — PUT /assets bulk update, description (Permission.AssetUpdate)
  //    Same gate as Favorite; a non-visibility field so the rbac-3 owner-only guard never fires.
  // ─────────────────────────────────────────────────────────────────────────

  describe('Metadata update — PUT /assets (bulk, description)', () => {
    it('Given spaceAssetId, When each actor bulk-updates its description, Then owner AND editor succeed (non-visibility metadata stays editor-allowed) and viewer/non-member are rejected', async () => {
      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember],
        (actor) =>
          request(app)
            .put('/assets')
            .set(authHeaders(actor))
            .send({ ids: [ctx.spaceAssetId], description: `edited-by-${actor.id}` }),
        { spaceOwner: 204, spaceEditor: 204, spaceViewer: 400, spaceNonMember: 400 },
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Delete — DELETE /assets bulk delete (Permission.AssetDelete, pure checkOwnerAccess)
  //
  // Destructive: uses a dedicated owner-owned asset PER ACTOR (never the shared spaceAssetId),
  // so this describe block never depends on — or breaks — execution order relative to the
  // others above. Each dedicated asset is also added directly to the space, to mirror
  // spaceAssetId's exact shape (owned by spaceOwner, direct space member) even though
  // AssetDelete's owner-only gate does not actually consult space membership at all.
  // ─────────────────────────────────────────────────────────────────────────

  describe('Delete — DELETE /assets (bulk)', () => {
    it('Given a dedicated owner-owned direct-space asset per actor, When each actor attempts to delete it, Then only spaceOwner succeeds (AssetDelete has no space/album arm)', async () => {
      const deleteTargetByActor: Record<string, string> = {};
      for (const id of ['spaceOwner', 'spaceEditor', 'spaceViewer', 'spaceNonMember']) {
        const asset = await utils.createAsset(ctx.spaceOwner.token!);
        await utils.addSpaceAssets(ctx.spaceOwner.token!, ctx.spaceId, [asset.id]);
        deleteTargetByActor[id] = asset.id;
      }

      await forEachActor(
        [ctx.spaceOwner, ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember],
        (actor) =>
          request(app)
            .delete('/assets')
            .set(authHeaders(actor))
            .send({ ids: [deleteTargetByActor[actor.id]] }),
        { spaceOwner: 204, spaceEditor: 400, spaceViewer: 400, spaceNonMember: 400 },
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Remove-from-space — DELETE /shared-spaces/:id/assets (requireRole(Editor))
  //
  // Destructive: a dedicated owner-owned direct-space asset PER ACTOR, so the editor's and
  // owner's successful (mutating) removals don't collide, and this block is independent of
  // execution order too.
  // ─────────────────────────────────────────────────────────────────────────

  describe('Remove-from-space — DELETE /shared-spaces/:id/assets', () => {
    it('Given a dedicated owner-owned direct-space asset per actor, When each actor attempts to remove it from the space, Then editor and owner succeed and viewer/non-member are rejected (requireRole(Editor) — role hierarchy Viewer < Editor ≤ Owner)', async () => {
      const removeTargetByActor: Record<string, string> = {};
      for (const id of ['spaceOwner', 'spaceEditor', 'spaceViewer', 'spaceNonMember']) {
        const asset = await utils.createAsset(ctx.spaceOwner.token!);
        await utils.addSpaceAssets(ctx.spaceOwner.token!, ctx.spaceId, [asset.id]);
        removeTargetByActor[id] = asset.id;
      }

      await forEachActor(
        [ctx.spaceEditor, ctx.spaceViewer, ctx.spaceNonMember, ctx.spaceOwner],
        (actor) =>
          request(app)
            .delete(`/shared-spaces/${ctx.spaceId}/assets`)
            .set(authHeaders(actor))
            .send({ assetIds: [removeTargetByActor[actor.id]] }),
        { spaceEditor: 200, spaceViewer: 403, spaceNonMember: 403, spaceOwner: 200 },
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Decision C — Remove-from-space-album: role-gated, ownership grants nothing
  //    (Permission.AlbumAssetDelete — access.ts:247-257 / access.repository.ts:103-161)
  //
  // Fixture note: the task's literal framing ("a manager adds a NON-manager's asset to the
  // space album") is not directly constructible via the ordinary add-to-album path, because
  // `AlbumAssetCreate` on the album is easy for a manager to hold, but the per-asset
  // `AssetShare` gate (owner ∪ partner only, see Add-to-album above) means a manager can NEVER
  // add an asset they neither own nor have a partner-share on through the *ordinary* path — only
  // through the #764 cross-owner-contribution mechanism, which additionally requires the asset
  // to already be visible through the space's direct pool (`shared_space_asset`) or a linked
  // library (shared-space.repository.ts `getContributableAssetSpaces`). Getting a NON-manager's
  // asset into `shared_space_asset` at all hits the same wall: the space "add asset" endpoint
  // requires the CALLER to be an Editor/Owner (`requireRole`) *and* to hold `AssetShare` on the
  // asset (owner∪partner) — so neither a manager (doesn't own it) nor the non-manager themselves
  // (lacks Editor+ role) can place it there. A real reproduction would need a library-linked
  // space, which is a much heavier fixture for the same RBAC assertion.
  //
  // Instead, this constructs an END STATE that is behaviourally identical for the purpose of
  // decision C (a non-manager's own asset ends up inside a space-linked album, and that member
  // holds neither album-editor nor space-editor/owner role) via a temporarily-elevated-then-
  // downgraded album participant:
  //   1. spaceOwner (album owner) creates a plain album and adds spaceViewer as an ALBUM EDITOR.
  //   2. spaceViewer adds their OWN new asset to the album (ordinary path: they own it, and they
  //      now hold AlbumAssetCreate via the Editor participant role) — a positive-control sanity
  //      check confirms this succeeds.
  //   3. spaceOwner downgrades spaceViewer's album role back to Viewer (the asset stays in the
  //      album — album_asset rows are untouched by an album_user role change).
  //   4. spaceOwner links the album into the space.
  //   5. spaceViewer is now a genuine non-manager (space role Viewer, album role Viewer) who owns
  //      an asset inside a space-linked album — exactly the decision-C precondition.
  // ─────────────────────────────────────────────────────────────────────────

  describe('Decision C — Remove-from-space-album is role-gated at the album level AND ownership-gated per asset', () => {
    it('Given a space-linked album containing an asset owned by a downgraded (non-manager) member: the non-manager is refused at the album gate (400); a space Editor passes the album gate (200) but the per-asset removal of a not-owned asset is denied in the body (success:false); only the album owner actually removes it (success:true)', async () => {
      const album = await utils.createAlbum(ctx.spaceOwner.token!, { albumName: 'slice1-decision-c-album' });

      // Step 1: temporarily elevate spaceViewer to album Editor so they can add their own asset.
      await addUsersToAlbum(
        {
          id: album.id,
          addUsersDto: { albumUsers: [{ userId: ctx.spaceViewer.userId!, role: AlbumUserRole.Editor }] },
        },
        { headers: asBearerAuth(ctx.spaceOwner.token!) },
      );

      // Step 2: spaceViewer (currently album-editor) adds their OWN new asset — ordinary,
      // self-owned path. Positive control: if this doesn't succeed, the negative assertion below
      // would be vacuous (the asset was never really in the album to begin with).
      const viewerAsset = await utils.createAsset(ctx.spaceViewer.token!);
      const addRes = await request(app)
        .put(`/albums/${album.id}/assets`)
        .set(authHeaders(ctx.spaceViewer))
        .send({ ids: [viewerAsset.id] });
      expect(addRes.status).toBe(200);
      expect((addRes.body as Array<{ id: string; success: boolean }>)[0]).toMatchObject({
        id: viewerAsset.id,
        success: true,
      });

      // Step 3: downgrade spaceViewer back to a plain album Viewer — no longer an album manager.
      await utils.updateAlbumUser(ctx.spaceOwner.token!, {
        id: album.id,
        userId: ctx.spaceViewer.userId!,
        updateAlbumUserDto: { role: AlbumUserRole.Viewer },
      });

      // Step 4: link the album into the space.
      await utils.linkSpaceAlbum(ctx.spaceOwner.token!, ctx.spaceId, album.id);

      // Step 5a: the non-manager (spaceViewer: space role Viewer, album role Viewer) tries to
      // remove THEIR OWN asset from the space album — AlbumAssetDelete is role-gated
      // (isOwner(album) ∪ isShared(album, Editor) ∪ isSpaceLinked(space Owner/Editor)); none of
      // these arms match a plain album/space Viewer, regardless of asset ownership.
      const deniedRes = await request(app)
        .delete(`/albums/${album.id}/assets`)
        .set(authHeaders(ctx.spaceViewer))
        .send({ ids: [viewerAsset.id] });
      expect(deniedRes.status).toBe(400);

      // Step 5b: a space Editor of the linked space with NO album participant role. The album-level
      // `AlbumAssetDelete` gate passes via the isSpaceLinked arm (HTTP 200), but removal is applied
      // per asset: the shared `removeAssets` util only bypasses per-asset ownership for a caller who
      // holds `Permission.AlbumDelete` on the album (i.e. the album OWNER); otherwise each asset is
      // re-checked against `Permission.AssetShare` (owner ∪ partner). The space Editor owns neither
      // the album nor this asset, so the item is denied in the body (success:false / no_permission)
      // even though the request is 200. This is why the web toolbar's `canRemoveFromAlbum = canManage`
      // is a UI-affordance gate, not a promise that every selected asset is removable — the server is
      // still the per-asset authority (same as the pre-existing space-album behaviour).
      const spaceEditorRes = await request(app)
        .delete(`/albums/${album.id}/assets`)
        .set(authHeaders(ctx.spaceEditor))
        .send({ ids: [viewerAsset.id] });
      expect(spaceEditorRes.status).toBe(200);
      expect((spaceEditorRes.body as Array<{ id: string; success: boolean; error?: string }>)[0]).toMatchObject({
        id: viewerAsset.id,
        success: false,
        error: BulkIdErrorReason.NoPermission,
      });

      // Step 5c: the album OWNER (spaceOwner) removes the SAME asset. Owning the album grants
      // `Permission.AlbumDelete`, which bypasses the per-asset `AssetShare` check — so the item is
      // actually removed (success:true). This is the arm that genuinely GRANTS removal.
      const ownerRes = await request(app)
        .delete(`/albums/${album.id}/assets`)
        .set(authHeaders(ctx.spaceOwner))
        .send({ ids: [viewerAsset.id] });
      expect(ownerRes.status).toBe(200);
      expect((ownerRes.body as Array<{ id: string; success: boolean }>)[0]).toMatchObject({
        id: viewerAsset.id,
        success: true,
      });
    });
  });
});
