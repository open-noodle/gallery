import { LoginResponseDto, SharedSpaceRole, type SharedSpaceResponseDto } from '@immich/sdk';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';

// Web E2E: closes the #992 audit gap for the single-asset viewer. Every existing layer proving
// #734/#992 (medium tests for the SQL rule, unit tests for each server call site, web component
// tests that hand a `canEdit` prop straight to the component, API-level e2e for server permit/deny)
// stops short of proving a REAL user, in a REAL browser, against a REAL server, actually sees (or
// does not see) the widened affordances. Every one of those layers would still pass even if the
// server stopped returning `canEdit`, the client stopped threading it, or a gate read the wrong
// flag — this suite is the one layer that would catch that.
//
// Fixture: Bob is a space member (Editor role, so he can add his own upload to the space) whose
// photo is viewed, from inside the space, by three OTHER members — the space's Owner (the space's
// creator), an Editor, and a Viewer — plus Bob himself as a positive control.
//
// Rule under test (AssetViewerNavBar.svelte's `isEditable` / `isOwner` derivation, mirroring
// #734's server-side `checkSpaceEditAccess`):
//   - `isEditable` (space Owner/Editor OR the asset's real owner — server-authoritative via
//     `asset.canEdit`) gates: RotateRight (top bar), Rotate left/180, Refresh faces, Refresh
//     metadata (all three in the "More" menu).
//   - `isOwner` (the asset's real owner ONLY — space role grants nothing here) gates: Delete (top
//     bar), Archive, Add upload to stack, View in timeline (all in the "More" menu). The widened
//     edit permission has a hard ceiling at these four — #992 audit item 1.
//
// Menu item text is pinned against the real i18n keys (i18n/en.json), not guessed: `to_archive` →
// "Archive", `add_upload_to_stack` → "Add upload to stack", `refresh_faces` → "Refresh faces",
// `refresh_metadata` → "Refresh metadata".
//
// Rating control: NOT one of the "absent" affordances above, despite reading that way at first
// glance. `DetailPanelStarRating` (the info-panel star widget — the only visible rating control;
// the navbar's own `RatingAction` renders zero DOM, it only wires the 0-5 keyboard shortcuts) is
// gated by `isOwner={canEdit}` → `readOnly={!isOwner}`, and `readOnly` only disables the star
// `<input>`s — the section still renders for a Viewer. So this suite checks interactivity
// (enabled/disabled), not presence/absence, for the rating control specifically.

async function gotoAssetViewerFromSpace(page: Page, spaceId: string, assetId: string) {
  const bucketsResponse = page.waitForResponse((response) => response.url().includes('/timeline/buckets'));
  await page.goto(`/spaces/${spaceId}`);
  await bucketsResponse;
  await page.waitForSelector('[data-testid="discovery-timeline"]');
  const thumb = page.locator(`[data-thumbnail-focus-container][data-asset="${assetId}"]`);
  await expect(thumb).toBeVisible();
  await thumb.click();
  await page.waitForURL(`/spaces/${spaceId}/photos/${assetId}`);
  await page.waitForSelector('#immich-asset-viewer');
}

async function expectRatingInteractivity(page: Page, navbar: Locator, expectEnabled: boolean) {
  await navbar.getByRole('button', { name: 'Info' }).click();
  const ratingSection = page.getByTestId('detail-panel-rating');
  await expect(ratingSection).toBeVisible();
  const firstStar = ratingSection.locator('input[type="radio"]').first();
  if (expectEnabled) {
    await expect(firstStar).toBeEnabled();
  } else {
    await expect(firstStar).toBeDisabled();
  }
}

test.describe("Spaces — asset viewer affordances on a space member's asset (#992 audit item 1 gap)", () => {
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let bob: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    const admin = await utils.adminSetup();

    [owner, editor, viewer, bob] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('sava-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('sava-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('sava-viewer')),
      utils.userSetup(admin.accessToken, createUserDto.create('sava-bob')),
    ]);

    // Enable the ratings preference for every actor up front — it must be on BEFORE a session's
    // first page load (authManager hydrates preferences at boot), and none of the assertions below
    // care about ratings otherwise, so doing it once here keeps every test's body focused.
    await Promise.all(
      [owner, editor, viewer, bob].map((actor) =>
        utils.updateMyPreferences(actor.accessToken, { ratings: { enabled: true } }),
      ),
    );
  });

  // Fresh space + asset per test — tests never depend on one another's state or run order.
  async function createFixture(namePrefix: string): Promise<{ space: SharedSpaceResponseDto; assetId: string }> {
    const space = await utils.createSpace(owner.accessToken, { name: `${namePrefix} Space` });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId, role: SharedSpaceRole.Viewer });
    // Bob needs Editor (or Owner) to add his own upload to the space (addAssets requireRole).
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: bob.userId, role: SharedSpaceRole.Editor });
    const asset = await utils.createAsset(bob.accessToken);
    await utils.addSpaceAssets(bob.accessToken, space.id, [asset.id]);
    return { space, assetId: asset.id };
  }

  test("space Viewer sees only universal controls on a space member's asset — no edit, no owner-only actions", async ({
    context,
    page,
  }) => {
    const { space, assetId } = await createFixture('SAVA-viewer');
    await utils.setAuthCookies(context, viewer.accessToken);
    await gotoAssetViewerFromSpace(page, space.id, assetId);
    const navbar = page.getByTestId('asset-viewer-navbar-actions');

    // Anchor: on for every authenticated actor, before any absence assertion (trap: a bare
    // `not.toBeVisible()` on a page still loading would pass for the wrong reason).
    await expect(navbar.getByRole('button', { name: 'Info' })).toBeVisible();

    // isEditable-gated (top bar): absent.
    await expect(navbar.getByRole('button', { name: 'Rotate right' })).toHaveCount(0);
    // isOwner-gated (top bar): absent.
    await expect(navbar.getByRole('button', { name: /delete/i })).toHaveCount(0);

    await navbar.getByRole('button', { name: 'More' }).click();
    // Anchor inside the menu.
    await expect(navbar.getByRole('menuitem', { name: 'Download' })).toBeVisible();

    // isEditable-gated (menu): absent.
    await expect(navbar.getByRole('menuitem', { name: 'Rotate left' })).toHaveCount(0);
    await expect(navbar.getByRole('menuitem', { name: 'Rotate 180°' })).toHaveCount(0);
    await expect(navbar.getByRole('menuitem', { name: 'Refresh faces' })).toHaveCount(0);
    await expect(navbar.getByRole('menuitem', { name: 'Refresh metadata' })).toHaveCount(0);

    // isOwner-gated (menu): absent regardless of space role.
    await expect(navbar.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
    await expect(navbar.getByRole('menuitem', { name: 'Add upload to stack' })).toHaveCount(0);
    await expect(navbar.getByRole('menuitem', { name: 'View in timeline' })).toHaveCount(0);

    await page.keyboard.press('Escape'); // close the menu via the dropdown's own onEscape handler
    await expectRatingInteractivity(page, navbar, false);
  });

  test("space Owner can edit but not destructively act on a member's asset", async ({ context, page }) => {
    const { space, assetId } = await createFixture('SAVA-owner');
    await utils.setAuthCookies(context, owner.accessToken);
    await gotoAssetViewerFromSpace(page, space.id, assetId);
    const navbar = page.getByTestId('asset-viewer-navbar-actions');

    await expect(navbar.getByRole('button', { name: 'Info' })).toBeVisible();
    await expect(navbar.getByRole('button', { name: 'Rotate right' })).toBeVisible();
    // isOwner-gated (top bar): absent — this space Owner does not own Bob's photo.
    await expect(navbar.getByRole('button', { name: /delete/i })).toHaveCount(0);

    await navbar.getByRole('button', { name: 'More' }).click();
    await expect(navbar.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Rotate left' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Rotate 180°' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Refresh faces' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Refresh metadata' })).toBeVisible();

    // The ceiling: even the space Owner cannot Archive / Add-to-stack / View-in-timeline a
    // fellow member's asset — those stay isOwner-only (#992 audit item 1).
    await expect(navbar.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
    await expect(navbar.getByRole('menuitem', { name: 'Add upload to stack' })).toHaveCount(0);
    await expect(navbar.getByRole('menuitem', { name: 'View in timeline' })).toHaveCount(0);

    await page.keyboard.press('Escape'); // close the menu via the dropdown's own onEscape handler
    await expectRatingInteractivity(page, navbar, true);
  });

  test("space Editor can edit but not destructively act on a member's asset", async ({ context, page }) => {
    const { space, assetId } = await createFixture('SAVA-editor');
    await utils.setAuthCookies(context, editor.accessToken);
    await gotoAssetViewerFromSpace(page, space.id, assetId);
    const navbar = page.getByTestId('asset-viewer-navbar-actions');

    await expect(navbar.getByRole('button', { name: 'Info' })).toBeVisible();
    await expect(navbar.getByRole('button', { name: 'Rotate right' })).toBeVisible();
    await expect(navbar.getByRole('button', { name: /delete/i })).toHaveCount(0);

    await navbar.getByRole('button', { name: 'More' }).click();
    await expect(navbar.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Rotate left' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Rotate 180°' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Refresh faces' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Refresh metadata' })).toBeVisible();

    await expect(navbar.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
    await expect(navbar.getByRole('menuitem', { name: 'Add upload to stack' })).toHaveCount(0);
    await expect(navbar.getByRole('menuitem', { name: 'View in timeline' })).toHaveCount(0);

    await page.keyboard.press('Escape'); // close the menu via the dropdown's own onEscape handler
    await expectRatingInteractivity(page, navbar, true);
  });

  test("Bob (the photo's real owner) sees the full owner action set — positive control proving the absences above are role-driven, not a blanket lock", async ({
    context,
    page,
  }) => {
    const { space, assetId } = await createFixture('SAVA-bob');
    await utils.setAuthCookies(context, bob.accessToken);
    await gotoAssetViewerFromSpace(page, space.id, assetId);
    const navbar = page.getByTestId('asset-viewer-navbar-actions');

    await expect(navbar.getByRole('button', { name: 'Info' })).toBeVisible();
    await expect(navbar.getByRole('button', { name: 'Rotate right' })).toBeVisible();
    await expect(navbar.getByRole('button', { name: /delete/i })).toBeVisible();

    await navbar.getByRole('button', { name: 'More' }).click();
    await expect(navbar.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Rotate left' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Rotate 180°' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Refresh faces' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Refresh metadata' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'Add upload to stack' })).toBeVisible();
    await expect(navbar.getByRole('menuitem', { name: 'View in timeline' })).toBeVisible();

    await page.keyboard.press('Escape'); // close the menu via the dropdown's own onEscape handler
    await expectRatingInteractivity(page, navbar, true);
  });
});
