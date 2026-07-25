import { LoginResponseDto, SharedSpaceRole } from '@immich/sdk';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { thumbnailUtils } from 'src/ui/specs/timeline/utils';
import { utils } from 'src/utils';

// Web E2E: Slice 5 of docs/superpowers/specs/2026-07-24-selection-toolbar-consistency-design.md —
// case 8 of the "Web e2e matrix". The space-person page's multi-select control bar was replaced
// with the same reusable <SelectionToolbar> component wired on the space timeline page (Slice 4),
// with one deliberate difference: the space-person page passes NO `onSetCover`, so Set-cover must
// never render there — this page has no cover action (see the design doc's "Cover note").
//
// This is a single smoke case (not the full role x ownership matrix already covered by the
// timeline spec): a space Viewer selecting a person's asset they don't own sees only the two
// always-on actions (Select-all, Download); every ownership-gated action (Share, Add-to-album,
// Favorite, edit, Delete) and the role-gated Remove-from-space are hidden, and Set-cover never
// appears at all.

// Navigates and waits for the initial `/timeline/buckets` fetch the destination page's Timeline
// component fires on mount, so a subsequent selection/assertion isn't racing the load.
async function gotoAndWaitForPersonTimeline(page: Page, url: string) {
  const bucketsResponse = page.waitForResponse((response) => response.url().includes('/timeline/buckets'));
  await page.goto(url);
  await bucketsResponse;
  await page.waitForSelector('[data-testid="person-timeline-header"]');
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

test.describe('Spaces — SelectionToolbar space-person control bar (Slice 5)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let viewer: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [owner, viewer] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('sttp-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('sttp-viewer')),
    ]);
  });

  // Case 8: a space Viewer selecting a person's asset that belongs to another member (`owner`).
  // isAllUserOwned is false and space.canWrite is false (Viewer role) — every ownership-gated AND
  // every role-gated action is hidden, and Set-cover never appears (no onSetCover on this page).
  test("viewer selecting a space person's asset (not theirs) sees only Select-all and Download", async ({
    context,
    page,
  }) => {
    const db = await utils.connectDatabase();

    const space = await utils.createSpace(owner.accessToken, { name: 'STTP-8 Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId, role: SharedSpaceRole.Viewer });

    const asset = await utils.createAsset(owner.accessToken);
    await utils.addSpaceAssets(owner.accessToken, space.id, [asset.id]);

    // Wire a shared_space_person for this asset (mirrors shared-space-person-profile.e2e-spec.ts):
    // create a real person + face identity for the asset, then project it into the space as a
    // shared_space_person joined on that identity.
    const person = await utils.createPerson(owner.accessToken, { name: 'STTP-8 Person' });
    const faceId = await utils.createFace({ assetId: asset.id, personId: person.id });
    const identityResult = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [person.id]);
    const identityId = identityResult.rows[0].identityId as string;

    const spacePersonResult = await db.query(
      `INSERT INTO "shared_space_person"
         ("spaceId", name, "isHidden", "faceCount", "assetCount", "representativeFaceId", "identityId", "type")
       VALUES ($1, 'STTP-8 Person', false, 1, 1, $2, $3, 'person')
       RETURNING id`,
      [space.id, faceId, identityId],
    );
    const spacePersonId = spacePersonResult.rows[0].id as string;
    await db.query(`INSERT INTO "shared_space_person_face" ("personId", "assetFaceId") VALUES ($1, $2)`, [
      spacePersonId,
      faceId,
    ]);

    await utils.setAuthCookies(context, viewer.accessToken);
    await gotoAndWaitForPersonTimeline(page, `/spaces/${space.id}/people/${spacePersonId}`);
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

    // Ownership-gated (Delete): hidden. Set-cover: never rendered on this page at all — the
    // page passes no `onSetCover`, so it's absent even though it would otherwise be a menu item.
    await expect(controlBar.getByRole('menuitem', { name: /delete/i })).toHaveCount(0);
    await expect(controlBar.getByRole('menuitem', { name: 'Set as space cover' })).toHaveCount(0);
  });
});
