import {
  AlbumResponseDto,
  AssetMediaResponseDto,
  AssetVisibility,
  LoginResponseDto,
  SharedSpaceResponseDto,
  SharedSpaceRole,
  updateAssets,
} from '@immich/sdk';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { asBearerAuth, utils } from 'src/utils';

// Web E2E: S4b of SPACE-ALBUMS-RBAC-REMEDIATION-SPEC-2026-07-11.md — behavioral UI round-trips
// for the space-albums timeline surfaces. Complements the exhaustive API matrix in
// shared-space-album-timeline.e2e-spec.ts (S4a) with a focused proof that the browser actually
// reflects the same behavior.
//
// Two `showInTimeline` toggles exist and are NOT interchangeable (shared-space.dto.ts:108/114/133/169):
//   - ALBUM-level (`shared_space_album.showInTimeline`, toggled from the space Albums grid's card
//     menu) = "include this album's assets in the SPACE's Photos tab timeline". Affects every
//     member's view of the space equally — it is not a per-viewer setting.
//   - MEMBER-level (`shared_space_member.showInTimeline`, toggled from the space page's own "More"
//     overflow menu) = "include this space's assets in MY personal/main (/photos) timeline". This
//     one IS per-viewer — toggling it only changes what that member sees on their own /photos.
//
// Each test builds its own space + linked album + asset via the API (reusing the same
// owner/editor/viewer login contexts throughout) so tests never depend on one another's mutated
// state or run order — Playwright is slow/flaky enough without adding ordering fragility.

async function createLinkedAlbumFixture(
  ownerToken: string,
  members: { userId: string; role: SharedSpaceRole }[],
  namePrefix: string,
): Promise<{ space: SharedSpaceResponseDto; album: AlbumResponseDto; asset: AssetMediaResponseDto }> {
  const space = await utils.createSpace(ownerToken, { name: `${namePrefix} Space` });
  for (const member of members) {
    await utils.addSpaceMember(ownerToken, space.id, { userId: member.userId, role: member.role });
  }
  const asset = await utils.createAsset(ownerToken);
  const album = await utils.createAlbum(ownerToken, { albumName: `${namePrefix} Album`, assetIds: [asset.id] });
  await utils.linkSpaceAlbum(ownerToken, space.id, album.id);
  return { space, album, asset };
}

// Navigates and waits for the initial `/timeline/buckets` fetch the destination page's Timeline
// component fires on mount, so a subsequent absence/presence assertion isn't racing the load.
async function gotoAndWaitForTimeline(page: Page, url: string, readyTestId?: string) {
  const bucketsResponse = page.waitForResponse((response) => response.url().includes('/timeline/buckets'));
  await page.goto(url);
  await bucketsResponse;
  if (readyTestId) {
    await page.waitForSelector(`[data-testid="${readyTestId}"]`);
  }
}

// `toHaveCount(0)` resolves immediately if the thumbnail simply hasn't rendered yet, which would
// make an absence assertion pass for the wrong reason — give the timeline a beat to finish
// rendering bucket content beyond the bucket-list fetch before asserting absence.
async function expectThumbnailAbsent(page: Page, assetId: string) {
  await page.waitForTimeout(500);
  await expect(page.locator(`[data-thumbnail-focus-container][data-asset="${assetId}"]`)).toHaveCount(0);
}

async function expectThumbnailVisible(page: Page, assetId: string) {
  await expect(page.locator(`[data-thumbnail-focus-container][data-asset="${assetId}"]`)).toBeVisible();
}

// Opens the given space-album-card's "⋯" menu and clicks the show/hide-in-timeline option,
// awaiting the PATCH to `/shared-spaces/:id/albums/:albumId` it triggers.
async function toggleAlbumShowInTimeline(
  page: Page,
  spaceId: string,
  albumId: string,
  card: Locator,
  menuItemName: RegExp,
) {
  const patchResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().includes(`/shared-spaces/${spaceId}/albums/${albumId}`),
  );
  const cardMenu = card.getByTestId('space-album-card-menu');
  await cardMenu.getByRole('button', { name: 'More' }).click();
  // Scope the click to THIS card's menu: the space page also renders the space-overflow
  // (member-level) menu, whose "Hide from timeline" / "Show in timeline" items share the same
  // accessible name, so a page-wide getByRole matches 2 elements (strict-mode violation).
  await cardMenu.getByRole('menuitem', { name: menuItemName }).click();
  await patchResponse;
}

// Opens the space page's own "More" overflow menu and clicks the show/hide-on-timeline option,
// awaiting the PATCH to `/shared-spaces/:id/members/me/timeline` it triggers (member-level toggle,
// self-service — always operates on the current session's own membership).
async function toggleMemberShowInTimeline(page: Page, spaceId: string, menuItemName: RegExp) {
  const patchResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes(`/shared-spaces/${spaceId}/members/me/timeline`),
  );
  const overflowMenu = page.getByTestId('space-overflow');
  await overflowMenu.getByRole('button', { name: 'More' }).click();
  // Scope to the space-overflow menu (same reason as toggleAlbumShowInTimeline: the album-card
  // menu carries an identically-named "Hide from timeline" / "Show in timeline" item).
  await overflowMenu.getByRole('menuitem', { name: menuItemName }).click();
  await patchResponse;
}

test.describe('Spaces — Albums timeline UI round-trips (S4b)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [owner, editor, viewer] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('sat-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('sat-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('sat-viewer')),
    ]);
  });

  // 1. Viewer sees linked-album photos in the space Photos tab timeline; opening one lands on the
  // space photo viewer. Positive control extended (vs. the journey spec) to assert presence of the
  // specific asset thumbnail, not just that navigation succeeded.
  test('viewer sees the linked album photo in the space Photos tab and can open it', async ({ context, page }) => {
    const { space, asset } = await createLinkedAlbumFixture(
      owner.accessToken,
      [{ userId: viewer.userId, role: SharedSpaceRole.Viewer }],
      'S4b-1',
    );
    await utils.setAuthCookies(context, viewer.accessToken);

    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`, 'discovery-timeline');
    const thumb = page.locator(`[data-thumbnail-focus-container][data-asset="${asset.id}"]`);
    await expect(thumb).toBeVisible();

    await thumb.click();
    await page.waitForURL(`/spaces/${space.id}/photos/${asset.id}`);
    await page.waitForSelector('#immich-asset-viewer');
    await expect(page.locator('#immich-asset-viewer')).toBeVisible();
  });

  // 2. The album-level showInTimeline toggle (space Albums grid card menu) drops/re-adds the
  // album's photo in the SPACE's Photos tab — this is not per-viewer, so the editor who flips it
  // can observe the effect directly without switching sessions.
  test('editor toggling the linked album\'s "show in timeline" drops and re-adds its photo in the space Photos tab', async ({
    context,
    page,
  }) => {
    const { space, album, asset } = await createLinkedAlbumFixture(
      owner.accessToken,
      [{ userId: editor.userId, role: SharedSpaceRole.Editor }],
      'S4b-2',
    );
    await utils.setAuthCookies(context, editor.accessToken);

    await page.goto(`/spaces/${space.id}/albums`);
    const card = page.getByTestId('space-album-card').filter({ hasText: album.albumName });
    await expect(card).toBeVisible();

    await toggleAlbumShowInTimeline(page, space.id, album.id, card, /hide from timeline/i);
    await expect(card).toContainText('Hidden from timeline');

    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`, 'discovery-timeline');
    await expectThumbnailAbsent(page, asset.id);

    await page.goto(`/spaces/${space.id}/albums`);
    await toggleAlbumShowInTimeline(page, space.id, album.id, card, /show in timeline/i);
    await expect(card).not.toContainText('Hidden from timeline');

    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`, 'discovery-timeline');
    await expectThumbnailVisible(page, asset.id);
  });

  // 3. The member-level showInTimeline toggle (space page's own "More" overflow menu) is per-viewer:
  // it gains/loses the space's photos on THAT member's personal /photos timeline.
  test('viewer toggling "show in my timeline" gains/loses the linked photo on their main /photos timeline', async ({
    context,
    page,
  }) => {
    const { space, asset } = await createLinkedAlbumFixture(
      owner.accessToken,
      [{ userId: viewer.userId, role: SharedSpaceRole.Viewer }],
      'S4b-3',
    );
    await utils.setAuthCookies(context, viewer.accessToken);

    await page.goto(`/spaces/${space.id}`);
    await toggleMemberShowInTimeline(page, space.id, /hide from timeline/i);

    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailAbsent(page, asset.id);

    await page.goto(`/spaces/${space.id}`);
    await toggleMemberShowInTimeline(page, space.id, /show on timeline/i);

    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailVisible(page, asset.id);
  });

  // 4. Owner hides a linked-album photo (AssetVisibility.Hidden has no dedicated UI control — it's
  // set here via the same bulk-update API the server exposes, exactly as an internal visibility
  // transition would arrive) → the viewer's space Photos tab drops it; restoring brings it back.
  test("owner hiding a linked-album photo removes it from the viewer's space Photos tab; restoring brings it back", async ({
    context,
    page,
  }) => {
    const { space, asset } = await createLinkedAlbumFixture(
      owner.accessToken,
      [{ userId: viewer.userId, role: SharedSpaceRole.Viewer }],
      'S4b-4',
    );

    await updateAssets(
      { assetBulkUpdateDto: { ids: [asset.id], visibility: AssetVisibility.Hidden } },
      { headers: asBearerAuth(owner.accessToken) },
    );

    await utils.setAuthCookies(context, viewer.accessToken);
    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`, 'discovery-timeline');
    await expectThumbnailAbsent(page, asset.id);

    await updateAssets(
      { assetBulkUpdateDto: { ids: [asset.id], visibility: AssetVisibility.Timeline } },
      { headers: asBearerAuth(owner.accessToken) },
    );

    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`, 'discovery-timeline');
    await expectThumbnailVisible(page, asset.id);
  });

  // 5. Unlinking the album (performed via the API — spaces-albums.e2e-spec.ts's C4 block asserts
  // the unlink menu's visibility per role but doesn't click through it; that UI affordance +
  // confirmation-dialog round-trip is not exercised anywhere yet) drops it from the viewer's space
  // Albums grid AND from the space Photos tab timeline.
  test("unlinking the album drops it from the viewer's space Albums grid and Photos timeline", async ({
    context,
    page,
  }) => {
    const { space, album, asset } = await createLinkedAlbumFixture(
      owner.accessToken,
      [{ userId: viewer.userId, role: SharedSpaceRole.Viewer }],
      'S4b-5',
    );

    await utils.unlinkSpaceAlbum(owner.accessToken, space.id, album.id);

    await utils.setAuthCookies(context, viewer.accessToken);

    await page.goto(`/spaces/${space.id}/albums`);
    await expect(page.getByTestId('space-album-card-link').filter({ hasText: album.albumName })).toHaveCount(0);

    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`, 'discovery-timeline');
    await expectThumbnailAbsent(page, asset.id);
  });
});
