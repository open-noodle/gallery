import { AlbumUserRole, LoginResponseDto, SharedSpaceRole, addAssetsToAlbum, addUsersToAlbum } from '@immich/sdk';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { thumbnailUtils } from 'src/ui/specs/timeline/utils';
import { asBearerAuth, utils } from 'src/utils';

// Web E2E: Slice 6 of specs/2026-07-24-selection-toolbar-consistency-design.md —
// cases 5-7 of the "Web e2e matrix". The space-album detail page's multi-select control bar
// (previously a stripped Download+Remove-only bar, rbac-5/albums-8) was reversed to render the
// same reusable <SelectionToolbar> component wired on the direct-space timeline (Slice 4) and the
// space-person page (Slice 5), this time with BOTH `album` and `space` props set (isSpaceAlbum).
//
// getSelectionCapabilities' isSpaceAlbum branch (web/src/lib/managers/selection-capabilities.ts):
//   - canSelectAll / canDownload: always true once a selection is active.
//   - canShare / canAddToAlbum / canFavorite / canEditMetadata (incl. Delete): gated on the
//     selection being entirely owned by the current viewer (`isAllUserOwned`) — NOT on
//     space/album role.
//   - canRemoveFromAlbum / canSetCover: gated on `canManage` (space.canWrite || album.isEditor) —
//     NOT on asset ownership (decision C: AlbumAssetDelete is role-gated server-side).
//   - canRemoveFromSpace: always false here (this is the album path, not the direct-space path).
//
// Each test builds its own space + album + asset via the API so tests never depend on one
// another's mutated state or run order.

// Navigates and waits for the album timeline's first thumbnail to mount (mirrors the wait
// strategy already established in spaces-albums.e2e-spec.ts for this same route).
async function gotoAlbumAndWaitForAsset(page: Page, url: string, assetId: string) {
  await page.goto(url);
  await page.waitForSelector(`[data-thumbnail-focus-container][data-asset="${assetId}"]`);
}

// Selects a single asset via its thumbnail checkbox (hover first — the checkbox overlay only
// renders on hover) and waits for the resulting <SelectionToolbar> control bar to mount.
async function selectAsset(page: Page, assetId: string): Promise<Locator> {
  const thumb = thumbnailUtils.withAssetId(page, assetId);
  await expect(thumb).toBeVisible();
  await thumb.hover();
  const checkbox = thumbnailUtils.selectButton(page, assetId);
  await expect(checkbox).toBeVisible();
  await checkbox.click();
  await expect(page.locator('#control-bar')).toBeVisible();
  return page.locator('#control-bar');
}

// Opens the toolbar's "⋯" overflow menu (Download, Remove-from-album, Set-cover, Delete, and the
// metadata-edit actions all render as menu items inside it, never top-level) and returns the
// control bar locator, now scoped to include the (now-expanded) menu content. Mirrors
// spaces-selection-toolbar-timeline.e2e-spec.ts's identical helper.
async function openOverflowMenu(controlBar: Locator) {
  await controlBar.getByRole('button', { name: 'Menu' }).click();
}

test.describe('Spaces — SelectionToolbar space-album control bar (Slice 6)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let viewerUser: LoginResponseDto;
  let editorUser: LoginResponseDto;
  let memberUser: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [owner, viewerUser, editorUser, memberUser] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('sta-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('sta-viewer')),
      utils.userSetup(admin.accessToken, createUserDto.create('sta-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('sta-member')),
    ]);
  });

  // Case 5: a space Viewer (no album role at all) selecting a space-album asset that belongs to
  // another member (`owner`). isAllUserOwned is false and canManage is false (Viewer role, no
  // album participant role) — every ownership-gated AND every manager-gated action is hidden;
  // only the two always-on actions (Select-all, Download) remain.
  test('viewer selecting a not-owned space-album asset sees only Select-all and Download', async ({
    context,
    page,
  }) => {
    const space = await utils.createSpace(owner.accessToken, { name: 'STA-5 Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: viewerUser.userId,
      role: SharedSpaceRole.Viewer,
    });

    const album = await utils.createAlbum(owner.accessToken, { albumName: 'STA-5 Album' });
    const asset = await utils.createAsset(owner.accessToken);
    await addAssetsToAlbum(
      { id: album.id, bulkIdsDto: { ids: [asset.id] } },
      { headers: asBearerAuth(owner.accessToken) },
    );
    await utils.linkSpaceAlbum(owner.accessToken, space.id, album.id);

    await utils.setAuthCookies(context, viewerUser.accessToken);
    await gotoAlbumAndWaitForAsset(page, `/spaces/${space.id}/albums/${album.id}`, asset.id);
    const controlBar = await selectAsset(page, asset.id);

    // Always-on, top-level.
    await expect(controlBar.getByRole('button', { name: 'Select all' })).toBeVisible();

    // Ownership-gated, top-level: all hidden (viewer doesn't own the asset).
    await expect(controlBar.getByRole('button', { name: 'Share' })).toHaveCount(0);
    await expect(controlBar.getByRole('button', { name: 'Add to album or space' })).toHaveCount(0);
    await expect(controlBar.getByRole('button', { name: /favorite/i })).toHaveCount(0);

    await openOverflowMenu(controlBar);

    // Always-on, inside the "⋯" menu.
    await expect(controlBar.getByRole('menuitem', { name: 'Download' })).toBeVisible();

    // Manager-gated (Remove-from-album, Set-cover) and ownership-gated (Delete): all hidden.
    await expect(controlBar.getByRole('menuitem', { name: 'Remove from album' })).toHaveCount(0);
    await expect(controlBar.getByRole('menuitem', { name: 'Set as album cover' })).toHaveCount(0);
    await expect(controlBar.getByRole('menuitem', { name: /delete/i })).toHaveCount(0);
  });

  // Case 6: a space Editor (canManage via space role alone — no album participant role at all)
  // selecting an asset they don't own. canManage is true (Remove-from-album / Set-cover visible)
  // but isAllUserOwned is false (Share / Add-to-album / Favorite / Delete / metadata-edit hidden)
  // — manager and ownership gating are independent axes, exactly as selection-capabilities.ts
  // encodes them for the space-album (isSpaceAlbum) branch.
  test('editor (canManage) selecting a not-owned album asset sees Select-all + Download + Remove-from-album + Set-cover', async ({
    context,
    page,
  }) => {
    const space = await utils.createSpace(owner.accessToken, { name: 'STA-6 Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: editorUser.userId,
      role: SharedSpaceRole.Editor,
    });

    const album = await utils.createAlbum(owner.accessToken, { albumName: 'STA-6 Album' });
    const asset = await utils.createAsset(owner.accessToken);
    await addAssetsToAlbum(
      { id: album.id, bulkIdsDto: { ids: [asset.id] } },
      { headers: asBearerAuth(owner.accessToken) },
    );
    await utils.linkSpaceAlbum(owner.accessToken, space.id, album.id);

    await utils.setAuthCookies(context, editorUser.accessToken);
    await gotoAlbumAndWaitForAsset(page, `/spaces/${space.id}/albums/${album.id}`, asset.id);
    const controlBar = await selectAsset(page, asset.id);

    await expect(controlBar.getByRole('button', { name: 'Select all' })).toBeVisible();

    // Ownership-gated, top-level: hidden (editor doesn't own the asset).
    await expect(controlBar.getByRole('button', { name: 'Share' })).toHaveCount(0);
    await expect(controlBar.getByRole('button', { name: /favorite/i })).toHaveCount(0);

    // Role-gated: a space Editor may contribute a non-owned asset into an album linked to this
    // space (#764), so Add-to-album stays — it opens the picker restricted to the space.
    await expect(controlBar.getByRole('button', { name: 'Add to album or space' })).toBeVisible();

    await openOverflowMenu(controlBar);

    await expect(controlBar.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    // Manager-gated: visible even though the selection isn't owned.
    await expect(controlBar.getByRole('menuitem', { name: 'Remove from album' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Set as album cover' })).toBeVisible();
    // Ownership-gated: hidden regardless of manager status.
    await expect(controlBar.getByRole('menuitem', { name: /delete/i })).toHaveCount(0);
  });

  // Case 7: a plain member (non-manager: space Viewer role, downgraded-back-to-Viewer album
  // role) selecting THEIR OWN asset in the space album. isAllUserOwned is true (Share/Add-to-
  // album/Favorite/Delete/metadata-edit all visible) but canManage is false (Remove-from-album
  // and Set-cover hidden) — ownership grants nothing towards the manager-gated actions
  // (decision C: AlbumAssetDelete is role-gated server-side, not ownership-gated).
  //
  // Fixture: `memberUser` can't add their own asset to `owner`'s album through the ordinary path
  // (AlbumAssetCreate requires an album participant role they don't have). Reusing the decision-C
  // trick from spaces-selection-actions.e2e-spec.ts: temporarily elevate them to album Editor,
  // let them add their own asset, then downgrade back to Viewer before linking the album to the
  // space — an end state behaviourally identical to "a non-manager's own asset is in a
  // space-linked album" for the purposes of this assertion.
  test('a non-manager member selecting their own asset in the space album sees owner actions but not Remove-from-album/Set-cover', async ({
    context,
    page,
  }) => {
    const album = await utils.createAlbum(owner.accessToken, { albumName: 'STA-7 Album' });

    // Step 1: temporarily elevate memberUser to album Editor so they can add their own asset.
    await addUsersToAlbum(
      { id: album.id, addUsersDto: { albumUsers: [{ userId: memberUser.userId, role: AlbumUserRole.Editor }] } },
      { headers: asBearerAuth(owner.accessToken) },
    );

    // Step 2: memberUser (currently album-editor) adds their OWN new asset — ordinary, self-owned path.
    const ownAsset = await utils.createAsset(memberUser.accessToken);
    await addAssetsToAlbum(
      { id: album.id, bulkIdsDto: { ids: [ownAsset.id] } },
      { headers: asBearerAuth(memberUser.accessToken) },
    );

    // Step 3: downgrade memberUser back to a plain album Viewer — no longer an album manager.
    await utils.updateAlbumUser(owner.accessToken, {
      id: album.id,
      userId: memberUser.userId,
      updateAlbumUserDto: { role: AlbumUserRole.Viewer },
    });

    // Step 4: create the space, add memberUser as a plain space Viewer, and link the album.
    const space = await utils.createSpace(owner.accessToken, { name: 'STA-7 Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: memberUser.userId,
      role: SharedSpaceRole.Viewer,
    });
    await utils.linkSpaceAlbum(owner.accessToken, space.id, album.id);

    await utils.setAuthCookies(context, memberUser.accessToken);
    await gotoAlbumAndWaitForAsset(page, `/spaces/${space.id}/albums/${album.id}`, ownAsset.id);
    const controlBar = await selectAsset(page, ownAsset.id);

    // Ownership-gated, top-level: all visible (memberUser owns this asset).
    await expect(controlBar.getByRole('button', { name: 'Share' })).toBeVisible();
    await expect(controlBar.getByRole('button', { name: 'Add to album or space' })).toBeVisible();
    await expect(controlBar.getByRole('button', { name: /favorite/i })).toBeVisible();

    await openOverflowMenu(controlBar);

    await expect(controlBar.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    // Ownership-gated metadata-edit + Delete: visible (owner path is never blocked by the album
    // path — server AssetUpdate checks ownership first, access.ts:155-159).
    await expect(controlBar.getByRole('menuitem', { name: 'Change date' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: /delete/i })).toBeVisible();

    // Manager-gated: hidden — memberUser is a plain Viewer on both the space and the album.
    await expect(controlBar.getByRole('menuitem', { name: 'Remove from album' })).toHaveCount(0);
    await expect(controlBar.getByRole('menuitem', { name: 'Set as album cover' })).toHaveCount(0);
  });
});
