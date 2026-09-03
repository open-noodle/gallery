import {
  AlbumResponseDto,
  AssetMediaResponseDto,
  AssetVisibility,
  LoginResponseDto,
  SharedLinkType,
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
// #1041 slice 14: three `showInTimeline`-shaped toggles exist and are NOT interchangeable
// (shared-space.dto.ts:108/114/133/169; design doc specs/2026-08-31-space-hide-from-timeline-design.md):
//   - SPACE-level, member-scoped (`shared_space_member.showInTimeline`, "Hide all space photos from
//     my timeline" / "Show all space photos in my timeline" on the space page's own "More" overflow
//     menu) = subtract everything reachable via this space from MY personal /photos timeline. Per
//     viewer; toggling it never touches anyone else's view or the space's own Photos tab.
//   - ALBUM-level, member-scoped (`shared_space_album_hidden`, "Hide this album from my timeline" /
//     "Show this album in my timeline" on every member's card/row menu) = same subtraction, scoped
//     to one linked album instead of the whole space. Also per viewer.
//   - ALBUM-level, editor-gated, SPACE-scoped (`shared_space_album.showInTimeline`, "Hide this album
///    from the space's photos" / "Show this album in the space's photos", editor-only) = whether the
//     album's assets appear in the SPACE's OWN Photos tab for every member alike. Since slice 8/§2,
//     this switch no longer reaches personal timelines at all — hiding it from the space's photos
//     does NOT remove it from anyone's /photos.
// Hiding (never showing) is destructive enough to warrant a confirm dialog (slice 12): the two
// member-scoped switches fetch a "how many of my own photos would this remove" preview and state
// the count; the editor-gated switch has no count (it doesn't touch personal timelines) but offers
// a checked-by-default "also hide from my own timeline" checkbox bridging to the member-scoped one.
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

// Clicks the given card/row's "⋯" menu button. Both space-album-card.svelte and
// space-albums-table.svelte scope the popover under the same `data-testid`-wrapped container as
// the trigger, so a locator scoped to that container disambiguates its items from the space page's
// own "More" overflow menu, which shares several identically-worded items ("Hide from timeline" is
// gone since slice 11's split, but menu items are still generically named enough to collide).
async function openCardMenu(card: Locator) {
  const cardMenu = card.getByTestId('space-album-card-menu');
  await cardMenu.getByRole('button', { name: 'More' }).click();
  return cardMenu;
}

// SPACE-level member-scoped toggle, HIDE direction: fetches the "how many of my own photos would
// this remove" preview, then waits for SpaceHideFromTimelineConfirmModal (slice 12) to render.
// Returns the dialog locator so the caller can assert its count and/or confirm or cancel.
async function hideSpaceFromMyTimeline(page: Page, spaceId: string): Promise<Locator> {
  const previewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith(`/shared-spaces/${spaceId}/timeline-hide-preview`),
  );
  const overflowMenu = page.getByTestId('space-overflow');
  await overflowMenu.getByRole('button', { name: 'More' }).click();
  await overflowMenu.getByRole('menuitem', { name: 'Hide all space photos from my timeline' }).click();
  await previewResponse;
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

// SPACE-level member-scoped toggle, SHOW direction: no confirmation needed (only hiding removes
// photos from the caller's own timeline).
async function showSpaceOnMyTimeline(page: Page, spaceId: string) {
  const patchResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes(`/shared-spaces/${spaceId}/members/me/timeline`),
  );
  const overflowMenu = page.getByTestId('space-overflow');
  await overflowMenu.getByRole('button', { name: 'More' }).click();
  await overflowMenu.getByRole('menuitem', { name: 'Show all space photos in my timeline' }).click();
  await patchResponse;
}

// ALBUM-level member-scoped toggle, HIDE direction: same preview + confirm shape as the space-level
// switch above, scoped to one album via AlbumHideFromMyTimelineConfirmModal.
async function hideAlbumFromMyTimeline(page: Page, spaceId: string, albumId: string, card: Locator): Promise<Locator> {
  const previewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith(`/shared-spaces/${spaceId}/albums/${albumId}/timeline-hide-preview`),
  );
  const cardMenu = await openCardMenu(card);
  await cardMenu.getByRole('menuitem', { name: 'Hide this album from my timeline' }).click();
  await previewResponse;
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

// ALBUM-level member-scoped toggle, SHOW direction: no confirmation needed.
async function showAlbumOnMyTimeline(page: Page, spaceId: string, albumId: string, card: Locator) {
  const patchResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes(`/shared-spaces/${spaceId}/albums/${albumId}/me/timeline`),
  );
  const cardMenu = await openCardMenu(card);
  await cardMenu.getByRole('menuitem', { name: 'Show this album in my timeline' }).click();
  await patchResponse;
}

// ALBUM-level editor-gated, space-scoped toggle, HIDE direction: no preview GET (this switch never
// touches personal timelines, so there's nothing to count), but AlbumHideFromSpacePhotosConfirmModal
// carries a checked-by-default "also hide from my own timeline" checkbox that, left checked, ALSO
// fires the member-scoped PATCH above. Callers that want to prove the two switches are independent
// must uncheck it, or the "also hide" bridge will confound the assertion.
async function hideAlbumFromSpacePhotos(
  page: Page,
  spaceId: string,
  albumId: string,
  card: Locator,
  { alsoHideFromMyTimeline }: { alsoHideFromMyTimeline: boolean },
) {
  const cardMenu = await openCardMenu(card);
  await cardMenu.getByRole('menuitem', { name: "Hide this album from the space's photos" }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const checkbox = dialog.getByRole('checkbox');
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
  if (!alsoHideFromMyTimeline) {
    await checkbox.click();
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');
  }
  const spacePatch = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().endsWith(`/shared-spaces/${spaceId}/albums/${albumId}`),
  );
  const waits = [spacePatch];
  if (alsoHideFromMyTimeline) {
    waits.push(
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().includes(`/shared-spaces/${spaceId}/albums/${albumId}/me/timeline`),
      ),
    );
  }
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await Promise.all(waits);
}

// ALBUM-level editor-gated, space-scoped toggle, SHOW direction: no confirmation needed.
async function showAlbumInSpacePhotos(page: Page, spaceId: string, albumId: string, card: Locator) {
  const patchResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().endsWith(`/shared-spaces/${spaceId}/albums/${albumId}`),
  );
  const cardMenu = await openCardMenu(card);
  await cardMenu.getByRole('menuitem', { name: "Show this album in the space's photos" }).click();
  await patchResponse;
}

// Confirms an open dialog and waits for the PATCH it fires (URL substring match, since both
// member-scoped endpoints share a `/shared-spaces/:id/...` prefix).
async function confirmAndWaitForPatch(page: Page, dialog: Locator, urlIncludes: string) {
  const patchResponse = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.url().includes(urlIncludes),
  );
  await dialog.getByRole('button', { name: 'Confirm' }).click();
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

  // 2. [AT-RISK, §9.7] The editor-gated album-level switch (space Albums grid card menu) drops/
  // re-adds the album's photo in the SPACE's Photos tab — this is not per-viewer, so the editor who
  // flips it can observe the effect directly without switching sessions. Slice 11 renamed the menu
  // items and slice 12 added the confirm dialog; the "also hide from my own timeline" checkbox is
  // unchecked here so this test stays scoped to the space's own tab (its personal counterpart is
  // scenario 3 below).
  test('editor toggling the linked album\'s "show in the space\'s photos" drops and re-adds its photo in the space Photos tab', async ({
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

    await hideAlbumFromSpacePhotos(page, space.id, album.id, card, { alsoHideFromMyTimeline: false });
    await expect(card).toContainText("Hidden from the space's photos");

    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`, 'discovery-timeline');
    await expectThumbnailAbsent(page, asset.id);

    await page.goto(`/spaces/${space.id}/albums`);
    await showAlbumInSpacePhotos(page, space.id, album.id, card);
    await expect(card).not.toContainText("Hidden from the space's photos");

    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`, 'discovery-timeline');
    await expectThumbnailVisible(page, asset.id);
  });

  // 3. [AT-RISK, §9.7] The SPACE-level member-scoped switch (space page's own "More" overflow menu)
  // is per-viewer: it gains/loses the space's photos on THAT member's personal /photos timeline.
  // Slice 11 renamed the menu items and slice 12 added the preview + confirm dialog on hide.
  test('viewer toggling "hide all space photos from my timeline" gains/loses the linked photo on their main /photos timeline', async ({
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
    const dialog = await hideSpaceFromMyTimeline(page, space.id);
    await confirmAndWaitForPatch(page, dialog, `/shared-spaces/${space.id}/members/me/timeline`);

    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailAbsent(page, asset.id);

    await page.goto(`/spaces/${space.id}`);
    await showSpaceOnMyTimeline(page, space.id);

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

  // #1041 slice 14 — the six §9.8 scenarios proving the redefined surface end-to-end.

  // 6. #1041's headline case: the SPACE switch hides the owner's OWN photos, not just a member's
  // view of someone else's. Nothing else substitutes for this — it is exactly what the issue reports.
  test('#1041 headline: owner hiding the space from their timeline drops and restores their own photos on /photos', async ({
    context,
    page,
  }) => {
    const { space, asset } = await createLinkedAlbumFixture(owner.accessToken, [], 'S4b-6-headline');
    await utils.setAuthCookies(context, owner.accessToken);

    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailVisible(page, asset.id);

    await page.goto(`/spaces/${space.id}`);
    const dialog = await hideSpaceFromMyTimeline(page, space.id);
    await expect(dialog).toContainText('1 photo');
    await confirmAndWaitForPatch(page, dialog, `/shared-spaces/${space.id}/members/me/timeline`);

    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailAbsent(page, asset.id);

    await page.goto(`/spaces/${space.id}`);
    await showSpaceOnMyTimeline(page, space.id);

    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailVisible(page, asset.id);
  });

  // 7. Same shape, at ALBUM granularity, via the member-facing item — the owner hides just the one
  // linked album from their own timeline (not the whole space) and it still leaves /photos.
  test('#1041 at album granularity: owner hiding a linked album from their own timeline drops and restores its photo on /photos', async ({
    context,
    page,
  }) => {
    const { space, album, asset } = await createLinkedAlbumFixture(owner.accessToken, [], 'S4b-7-album');
    await utils.setAuthCookies(context, owner.accessToken);

    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailVisible(page, asset.id);

    await page.goto(`/spaces/${space.id}/albums`);
    const card = page.getByTestId('space-album-card').filter({ hasText: album.albumName });
    await expect(card).toBeVisible();

    const dialog = await hideAlbumFromMyTimeline(page, space.id, album.id, card);
    await expect(dialog).toContainText('1 photo');
    await confirmAndWaitForPatch(page, dialog, `/shared-spaces/${space.id}/albums/${album.id}/me/timeline`);
    await expect(card).toContainText('Hidden from your timeline');

    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailAbsent(page, asset.id);

    await page.goto(`/spaces/${space.id}/albums`);
    await showAlbumOnMyTimeline(page, space.id, album.id, card);
    await expect(card).not.toContainText('Hidden from your timeline');

    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailVisible(page, asset.id);
  });

  // 8. The two album-level switches are independent (§2's headline consequence — must be
  // demonstrably intentional rather than discovered later via a bug report):
  //   a) an editor hiding the album from the SPACE's photos does NOT change another member's own
  //      /photos (the shared flag no longer reaches personal timelines — design doc S12);
  //   b) a member hiding the album from THEIR OWN timeline does NOT change the space's own Photos
  //      tab, which every other member (here: the owner) still sees unchanged (S13).
  test('the space-photos switch and the my-timeline switch are independent (§2)', async ({ context, page }) => {
    // (a) editor → space's photos; check viewer's personal /photos is unaffected.
    const fixtureA = await createLinkedAlbumFixture(
      owner.accessToken,
      [
        { userId: editor.userId, role: SharedSpaceRole.Editor },
        { userId: viewer.userId, role: SharedSpaceRole.Viewer },
      ],
      'S4b-8a-independence',
    );

    await utils.setAuthCookies(context, editor.accessToken);
    await page.goto(`/spaces/${fixtureA.space.id}/albums`);
    const cardA = page.getByTestId('space-album-card').filter({ hasText: fixtureA.album.albumName });
    await expect(cardA).toBeVisible();
    await hideAlbumFromSpacePhotos(page, fixtureA.space.id, fixtureA.album.id, cardA, {
      alsoHideFromMyTimeline: false,
    });
    await expect(cardA).toContainText("Hidden from the space's photos");

    // The space's own Photos tab drops it for everyone — unchanged legacy behaviour (S13).
    await gotoAndWaitForTimeline(page, `/spaces/${fixtureA.space.id}`, 'discovery-timeline');
    await expectThumbnailAbsent(page, fixtureA.asset.id);

    // But the viewer's own /photos still shows it — the shared flag no longer reaches personal
    // timelines (§2, S12).
    await utils.setAuthCookies(context, viewer.accessToken);
    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailVisible(page, fixtureA.asset.id);

    // (b) member → own timeline; check the space's own Photos tab (as the owner) is unaffected.
    const fixtureB = await createLinkedAlbumFixture(
      owner.accessToken,
      [{ userId: viewer.userId, role: SharedSpaceRole.Viewer }],
      'S4b-8b-independence',
    );

    await utils.setAuthCookies(context, viewer.accessToken);
    await page.goto(`/spaces/${fixtureB.space.id}/albums`);
    const cardB = page.getByTestId('space-album-card').filter({ hasText: fixtureB.album.albumName });
    await expect(cardB).toBeVisible();
    const dialogB = await hideAlbumFromMyTimeline(page, fixtureB.space.id, fixtureB.album.id, cardB);
    await confirmAndWaitForPatch(
      page,
      dialogB,
      `/shared-spaces/${fixtureB.space.id}/albums/${fixtureB.album.id}/me/timeline`,
    );
    await expect(cardB).toContainText('Hidden from your timeline');

    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailAbsent(page, fixtureB.asset.id);

    await utils.setAuthCookies(context, owner.accessToken);
    await gotoAndWaitForTimeline(page, `/spaces/${fixtureB.space.id}`, 'discovery-timeline');
    await expectThumbnailVisible(page, fixtureB.asset.id);
  });

  // 9. Cancellation is visible to the user: a photo in a hidden album that is ALSO added to the
  // space directly stays on /photos. This is the "any visible path wins" rule (§3/§6) and the
  // single most likely source of a follow-up bug report — slice 0 proved it is exactly what #1041's
  // reporter is actually seeing.
  test("a hidden album's photo stays on /photos when it is also added to the space directly (any visible path wins)", async ({
    context,
    page,
  }) => {
    const { space, album, asset } = await createLinkedAlbumFixture(owner.accessToken, [], 'S4b-9-cancellation');
    await utils.addSpaceAssets(owner.accessToken, space.id, [asset.id]);

    await utils.setAuthCookies(context, owner.accessToken);
    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailVisible(page, asset.id);

    await page.goto(`/spaces/${space.id}/albums`);
    const card = page.getByTestId('space-album-card').filter({ hasText: album.albumName });
    await expect(card).toBeVisible();

    const dialog = await hideAlbumFromMyTimeline(page, space.id, album.id, card);
    // The album path is the only thing being cut; the asset is also a direct shared_space_asset of
    // the space, so hiding the album removes ZERO of the caller's own photos — the dialog states it.
    await expect(dialog).toContainText('0 photos');
    await confirmAndWaitForPatch(page, dialog, `/shared-spaces/${space.id}/albums/${album.id}/me/timeline`);
    await expect(card).toContainText('Hidden from your timeline');

    // #1041's actual reporter shape: the photo stays, because the direct space-asset path is still
    // visible even though the album path is now hidden.
    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailVisible(page, asset.id);
  });

  // 10. The confirm dialog states a count, and cancelling changes nothing: no PATCH fires, the menu
  // item still reads "Hide...", and the photo is still on /photos afterwards.
  test('the hide-from-timeline confirm dialog states a count, and cancelling changes nothing', async ({
    context,
    page,
  }) => {
    const { space, asset } = await createLinkedAlbumFixture(owner.accessToken, [], 'S4b-10-cancel');
    await utils.setAuthCookies(context, owner.accessToken);

    await page.goto(`/spaces/${space.id}`);
    const dialog = await hideSpaceFromMyTimeline(page, space.id);
    await expect(dialog).toContainText('1 photo');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    // Nothing was written: the menu item still reads "Hide...", not "Show...".
    const overflowMenu = page.getByTestId('space-overflow');
    await overflowMenu.getByRole('button', { name: 'More' }).click();
    await expect(overflowMenu.getByRole('menuitem', { name: 'Hide all space photos from my timeline' })).toBeVisible();
    await page.keyboard.press('Escape');

    await gotoAndWaitForTimeline(page, '/photos');
    await expectThumbnailVisible(page, asset.id);
  });

  // 11. A shared link is unaffected: hiding is a personal tidiness preference, not a privacy
  // control (§3) — a link to an album its owner has hidden from their own timeline still serves
  // the photos to an unauthenticated visitor.
  test('a shared link to an album hidden by its owner still serves the photos (hiding is tidiness, not privacy)', async ({
    context,
    page,
  }) => {
    const { space, album, asset } = await createLinkedAlbumFixture(owner.accessToken, [], 'S4b-11-sharedlink');
    await utils.setAuthCookies(context, owner.accessToken);

    await page.goto(`/spaces/${space.id}/albums`);
    const card = page.getByTestId('space-album-card').filter({ hasText: album.albumName });
    await expect(card).toBeVisible();
    const dialog = await hideAlbumFromMyTimeline(page, space.id, album.id, card);
    await confirmAndWaitForPatch(page, dialog, `/shared-spaces/${space.id}/albums/${album.id}/me/timeline`);
    await expect(card).toContainText('Hidden from your timeline');

    const sharedLink = await utils.createSharedLink(owner.accessToken, {
      type: SharedLinkType.Album,
      albumId: album.id,
    });

    await page.context().clearCookies();
    await page.goto(`/share/${sharedLink.key}`);
    await page.getByRole('heading', { name: album.albumName }).waitFor();
    await expect(page.locator(`[data-asset-id="${asset.id}"]`)).toBeVisible();
  });
});
