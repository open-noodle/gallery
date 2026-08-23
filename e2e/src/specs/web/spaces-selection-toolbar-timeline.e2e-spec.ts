import { LoginResponseDto, SharedSpaceResponseDto, SharedSpaceRole } from '@immich/sdk';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { thumbnailUtils } from 'src/ui/specs/timeline/utils';
import { utils } from 'src/utils';

// Web E2E: Slice 4 of specs/2026-07-24-selection-toolbar-consistency-design.md —
// the space timeline page's multi-select control bar was replaced with the reusable
// <SelectionToolbar> component, gated by the pure `getSelectionCapabilities` rule engine
// (web/src/lib/managers/selection-capabilities.ts). These tests exercise the resulting button
// set for a direct-space surface across the role x ownership matrix the rule engine encodes:
//
//   - canSelectAll / canDownload: always true once a selection is active, regardless of role.
//   - canFavorite / canEditMetadata (incl. Delete): gated on the selection being entirely owned
//     by the current viewer (`isAllUserOwned`), NOT on space role.
//   - canShare: gated on owning SOME of the selection — the action sends only the owned subset.
//   - canAddToAlbum: `isAllUserOwned` OR space Editor/Owner. A space manager may contribute
//     non-owned assets into an album linked to the space (#764); the picker then narrows to
//     that space's albums. See 2026-07-25-space-add-to-collection-design.md.
//   - canRemoveFromSpace / canSetCover: gated on the space role being Editor or Owner
//     (`space.canWrite`), NOT on asset ownership.
//
// Each test builds its own space + members + asset via the API so tests never depend on one
// another's mutated state or run order.

async function createDirectSpaceFixture(
  ownerToken: string,
  members: { userId: string; role: SharedSpaceRole }[],
  namePrefix: string,
): Promise<SharedSpaceResponseDto> {
  const space = await utils.createSpace(ownerToken, { name: `${namePrefix} Space` });
  for (const member of members) {
    await utils.addSpaceMember(ownerToken, space.id, { userId: member.userId, role: member.role });
  }
  return space;
}

// Navigates and waits for the initial `/timeline/buckets` fetch the destination page's Timeline
// component fires on mount, so a subsequent selection/assertion isn't racing the load.
async function gotoAndWaitForTimeline(page: Page, url: string) {
  const bucketsResponse = page.waitForResponse((response) => response.url().includes('/timeline/buckets'));
  await page.goto(url);
  await bucketsResponse;
  await page.waitForSelector('[data-testid="discovery-timeline"]');
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

// Opens the toolbar's "⋯" overflow menu (Download, Delete, Set-cover, and the metadata-edit
// actions all render as menu items inside it, never top-level) and returns the control bar
// locator, now scoped to include the (now-expanded) menu content.
async function openOverflowMenu(controlBar: Locator) {
  await controlBar.getByRole('button', { name: 'Menu' }).click();
}

test.describe('Spaces — SelectionToolbar timeline control bar (Slice 4)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [owner, editor, viewer] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('stt-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('stt-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('stt-viewer')),
    ]);
  });

  // Case 1: a space Viewer selecting the owner's asset. isAllUserOwned is false (the asset
  // belongs to `owner`, not `viewer`) and space.canWrite is false (Viewer role) — every
  // ownership-gated AND every role-gated action is hidden. Only the two always-on actions
  // (Select-all, Download) remain.
  test("viewer selecting the owner's asset sees only Select-all and Download", async ({ context, page }) => {
    const space = await createDirectSpaceFixture(
      owner.accessToken,
      [{ userId: viewer.userId, role: SharedSpaceRole.Viewer }],
      'STT-1',
    );
    const asset = await utils.createAsset(owner.accessToken);
    await utils.addSpaceAssets(owner.accessToken, space.id, [asset.id]);

    await utils.setAuthCookies(context, viewer.accessToken);
    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`);
    const controlBar = await selectAsset(page, asset.id);

    // Always-on, top-level.
    await expect(controlBar.getByRole('button', { name: 'Select all' })).toBeVisible();

    // Ownership-gated, top-level: all hidden (viewer doesn't own the asset).
    await expect(controlBar.getByRole('button', { name: 'Share' })).toHaveCount(0);
    await expect(controlBar.getByRole('button', { name: 'Add to album or space' })).toHaveCount(0);
    await expect(controlBar.getByRole('button', { name: /favorite/i })).toHaveCount(0);

    // Role-gated, top-level: hidden (Viewer has no write access to the space).
    await expect(controlBar.getByRole('button', { name: 'Remove from space' })).toHaveCount(0);

    await openOverflowMenu(controlBar);

    // Always-on, inside the "⋯" menu.
    await expect(controlBar.getByRole('menuitem', { name: 'Download' })).toBeVisible();

    // Ownership-gated (Delete) and role-gated (Set cover), inside the menu: both hidden.
    await expect(controlBar.getByRole('menuitem', { name: /delete/i })).toHaveCount(0);
    await expect(controlBar.getByRole('menuitem', { name: 'Set as space cover' })).toHaveCount(0);
  });

  // Case 2: a space Editor selecting an asset THEY uploaded and added themselves. isAllUserOwned
  // is true AND space.canWrite is true — every gated action is visible: the full set.
  test('editor selecting their own asset sees the full action set', async ({ context, page }) => {
    const space = await createDirectSpaceFixture(
      owner.accessToken,
      [{ userId: editor.userId, role: SharedSpaceRole.Editor }],
      'STT-2',
    );
    const asset = await utils.createAsset(editor.accessToken);
    await utils.addSpaceAssets(editor.accessToken, space.id, [asset.id]);

    await utils.setAuthCookies(context, editor.accessToken);
    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`);
    const controlBar = await selectAsset(page, asset.id);

    await expect(controlBar.getByRole('button', { name: 'Select all' })).toBeVisible();
    await expect(controlBar.getByRole('button', { name: 'Share' })).toBeVisible();
    await expect(controlBar.getByRole('button', { name: 'Add to album or space' })).toBeVisible();
    await expect(controlBar.getByRole('button', { name: /favorite/i })).toBeVisible();
    await expect(controlBar.getByRole('button', { name: 'Remove from space' })).toBeVisible();

    await openOverflowMenu(controlBar);

    await expect(controlBar.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: /delete/i })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Set as space cover' })).toBeVisible();
  });

  // Case 3: a space Editor selecting the owner's (not their own) asset. isAllUserOwned is false
  // (Share/Favorite/Delete hidden) but space.canWrite is still true, so the role-gated actions
  // stay visible: Remove-from-space, Set-cover, and Add-to-album — the last because a space
  // manager may contribute a non-owned asset into an album linked to this space (#764).
  test("editor selecting the owner's asset sees role-gated actions plus add-to-album", async ({ context, page }) => {
    const space = await createDirectSpaceFixture(
      owner.accessToken,
      [{ userId: editor.userId, role: SharedSpaceRole.Editor }],
      'STT-3',
    );
    const asset = await utils.createAsset(owner.accessToken);
    await utils.addSpaceAssets(owner.accessToken, space.id, [asset.id]);

    await utils.setAuthCookies(context, editor.accessToken);
    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`);
    const controlBar = await selectAsset(page, asset.id);

    await expect(controlBar.getByRole('button', { name: 'Select all' })).toBeVisible();
    await expect(controlBar.getByRole('button', { name: 'Remove from space' })).toBeVisible();

    await expect(controlBar.getByRole('button', { name: 'Add to album or space' })).toBeVisible();

    await expect(controlBar.getByRole('button', { name: 'Share' })).toHaveCount(0);
    await expect(controlBar.getByRole('button', { name: /favorite/i })).toHaveCount(0);

    await openOverflowMenu(controlBar);

    await expect(controlBar.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Set as space cover' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: /delete/i })).toHaveCount(0);
  });

  // Case 5: the mixed selection that motivated this change — a space Editor selecting one of
  // their own assets AND one of the owner's. Share reappears (it sends only the owned subset)
  // and Add-to-album opens the picker narrowed to this space's albums, because a personal album
  // or another space could not accept the owner's asset.
  test('editor with a mixed selection sees share and a space-restricted add-to-album', async ({ context, page }) => {
    const space = await createDirectSpaceFixture(
      owner.accessToken,
      [{ userId: editor.userId, role: SharedSpaceRole.Editor }],
      'STT-5',
    );
    const ownerAsset = await utils.createAsset(owner.accessToken);
    const editorAsset = await utils.createAsset(editor.accessToken);
    await utils.addSpaceAssets(owner.accessToken, space.id, [ownerAsset.id]);
    await utils.addSpaceAssets(editor.accessToken, space.id, [editorAsset.id]);

    await utils.setAuthCookies(context, editor.accessToken);
    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`);
    await selectAsset(page, editorAsset.id);
    const controlBar = await selectAsset(page, ownerAsset.id);

    await expect(controlBar.getByRole('button', { name: 'Share' })).toBeVisible();
    const addButton = controlBar.getByRole('button', { name: 'Add to album or space' });
    await expect(addButton).toBeVisible();
    // Mixed ownership still blocks the all-asset mutations.
    await expect(controlBar.getByRole('button', { name: /favorite/i })).toHaveCount(0);

    await addButton.click();
    // Restricted picker: the explanatory notice is shown and neither create row is offered,
    // since a brand-new album would not be linked to the space.
    await expect(page.getByTestId('restricted-to-space-notice')).toBeVisible();
    await expect(page.getByTestId('new-album-row')).toHaveCount(0);
    await expect(page.getByTestId('new-space-row')).toHaveCount(0);
  });

  // Case 4: the space Owner selecting their own asset. Both axes are satisfied (owner owns the
  // asset, and Owner role always has write access) — the full set, same as case 2.
  test('owner selecting their own asset sees the full action set', async ({ context, page }) => {
    const space = await createDirectSpaceFixture(owner.accessToken, [], 'STT-4');
    const asset = await utils.createAsset(owner.accessToken);
    await utils.addSpaceAssets(owner.accessToken, space.id, [asset.id]);

    await utils.setAuthCookies(context, owner.accessToken);
    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`);
    const controlBar = await selectAsset(page, asset.id);

    await expect(controlBar.getByRole('button', { name: 'Select all' })).toBeVisible();
    await expect(controlBar.getByRole('button', { name: 'Share' })).toBeVisible();
    await expect(controlBar.getByRole('button', { name: 'Add to album or space' })).toBeVisible();
    await expect(controlBar.getByRole('button', { name: /favorite/i })).toBeVisible();
    await expect(controlBar.getByRole('button', { name: 'Remove from space' })).toBeVisible();

    await openOverflowMenu(controlBar);

    await expect(controlBar.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: /delete/i })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Set as space cover' })).toBeVisible();
  });
});
