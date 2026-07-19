import {
  AlbumResponseDto,
  AlbumUserRole,
  AssetMediaResponseDto,
  BulkIdResponseDto,
  LoginResponseDto,
  SharedSpaceResponseDto,
  SharedSpaceRole,
  addAssetsToAlbum,
  getSpacePeople,
  removeAssetFromAlbum,
} from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { thumbnailUtils } from 'src/ui/specs/timeline/utils';
import { asBearerAuth, utils } from 'src/utils';

// Web E2E coverage for the in-space albums UI.
//
// Role matrix under test:
//   Owner  → creates space, album, assets; links album to space.
//   Editor → space Editor + album Editor: can see Link button, open album, open add-photos overlay.
//   Viewer → space Viewer, no album membership: can browse the grid and album but has no write controls.
//
// The spec deliberately avoids arbitrary timeouts — every assertion awaits a
// visible element to prevent races.

test.describe('Spaces — Albums UI (editor flows + viewer-denied gating)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let space: SharedSpaceResponseDto;
  let album: AlbumResponseDto;
  let asset!: AssetMediaResponseDto;
  let asset2!: AssetMediaResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [owner, editor, viewer] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('albums-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('albums-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('albums-viewer')),
    ]);

    // Create the space owned by `owner`.
    space = await utils.createSpace(owner.accessToken, { name: 'Albums Test Space' });

    // Add members.
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: editor.userId,
      role: SharedSpaceRole.Editor,
    });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: viewer.userId,
      role: SharedSpaceRole.Viewer,
    });

    // Create two assets owned by `owner` so the album is non-empty and the viewer has a sibling
    // to navigate to (next/prev test).
    [asset, asset2] = await Promise.all([utils.createAsset(owner.accessToken), utils.createAsset(owner.accessToken)]);

    // Album owned by `owner`, shared with `editor` as album editor (so editor passes the
    // linkAlbum two-step gate: space Editor role + album Editor access).
    album = await utils.createAlbum(owner.accessToken, {
      albumName: 'Linked Album',
      albumUsers: [{ userId: editor.userId, role: AlbumUserRole.Editor }],
      assetIds: [asset.id, asset2.id],
    });

    // Link the album to the space (performed as owner, who satisfies both gates).
    await utils.linkSpaceAlbum(owner.accessToken, space.id, album.id);
  });

  // ─── EDITOR flows ─────────────────────────────────────────────────────────

  test.describe('editor', () => {
    test('sees the Link-album button and the linked album on the albums grid', async ({ context, page }) => {
      await utils.setAuthCookies(context, editor.accessToken);
      await page.goto(`/spaces/${space.id}/albums`);

      // The "Link album" button in the page header is editor-only.
      await expect(page.getByTestId('link-album-button')).toBeVisible();

      // The linked album card must be present — located by the album name text
      // inside the `space-album-card-link` anchor.
      await expect(page.getByTestId('space-album-card-link').filter({ hasText: 'Linked Album' })).toBeVisible();
    });

    test('can open a linked album and sees the Add-photos button', async ({ context, page }) => {
      await utils.setAuthCookies(context, editor.accessToken);
      await page.goto(`/spaces/${space.id}/albums`);

      // Click the album card link to navigate to the album detail page.
      await page.getByTestId('space-album-card-link').filter({ hasText: 'Linked Album' }).click();

      // Verify we landed on the correct URL.
      await page.waitForURL(`/spaces/${space.id}/albums/${album.id}`);

      // The Add-photos icon button is rendered only for editors (canManage && mode === 'browse').
      await expect(page.getByTestId('add-photos-button')).toBeVisible();
    });

    test('can open and close the add-photos picker overlay', async ({ context, page }) => {
      await utils.setAuthCookies(context, editor.accessToken);
      await page.goto(`/spaces/${space.id}/albums/${album.id}`);

      // Open the overlay.
      await page.getByTestId('add-photos-button').click();
      await expect(page.getByTestId('add-photos-overlay')).toBeVisible();

      // Close the overlay via the close button in the overlay's ControlAppBar
      // (ControlAppBar → @immich/ui ControlBar renders an IconButton with aria-label "Close").
      // Note: the browse-mode "back" IconButton stays mounted behind the z-40 overlay, so a
      // /back/i match would resolve to it and the click would be intercepted by the overlay.
      await page.getByRole('button', { name: /close/i }).click();
      await expect(page.getByTestId('add-photos-overlay')).not.toBeVisible();
    });
  });

  // ─── VIEWER flows (read-only / denied) ────────────────────────────────────

  test.describe('viewer', () => {
    test('does NOT see the Link-album button or the card context menu on the albums grid', async ({
      context,
      page,
    }) => {
      await utils.setAuthCookies(context, viewer.accessToken);
      await page.goto(`/spaces/${space.id}/albums`);

      // The viewer should still see the linked album card (read access).
      await expect(page.getByTestId('space-album-card-link').filter({ hasText: 'Linked Album' })).toBeVisible();

      // But the editor-only controls must be absent.
      await expect(page.getByTestId('link-album-button')).not.toBeVisible();

      // The context menu is inside the card and is only rendered when canManage is true.
      // It is hidden via CSS opacity-0 on non-hover; asserting not.toBeVisible() covers
      // both the missing-from-DOM case (viewer, canManage=false) and hidden-via-CSS.
      await expect(page.getByTestId('space-album-card-menu')).not.toBeVisible();
    });

    test('can open a linked album but sees no Add-photos button', async ({ context, page }) => {
      await utils.setAuthCookies(context, viewer.accessToken);
      await page.goto(`/spaces/${space.id}/albums`);

      await page.getByTestId('space-album-card-link').filter({ hasText: 'Linked Album' }).click();
      await page.waitForURL(`/spaces/${space.id}/albums/${album.id}`);

      // The timeline grouping control confirms the browse-mode UI is loaded.
      await expect(page.getByTestId('timeline-desktop-grouping-control')).toBeVisible();

      // The Add-photos button must not be present for a viewer.
      await expect(page.getByTestId('add-photos-button')).not.toBeVisible();
    });
  });

  // ─── Photo viewer ─────────────────────────────────────────────────────────

  test.describe('photo viewer', () => {
    test('owner clicks a photo → viewer opens at photos URL', async ({ context, page }) => {
      await utils.setAuthCookies(context, owner.accessToken);
      await page.goto(`/spaces/${space.id}/albums/${album.id}`);

      // Wait for the album timeline to be rendered and the thumbnail to be present.
      await page.waitForSelector(`[data-thumbnail-focus-container][data-asset="${asset.id}"]`);

      // Click the thumbnail to open the viewer.
      await page.locator(`[data-thumbnail-focus-container][data-asset="${asset.id}"]`).click();

      // The URL should update to include /photos/<assetId>.
      await page.waitForURL(`/spaces/${space.id}/albums/${album.id}/photos/${asset.id}`);

      // The asset viewer must be visible.
      await page.waitForSelector('#immich-asset-viewer');
      await expect(page.locator('#immich-asset-viewer')).toBeVisible();
    });

    test('close returns to the album grid', async ({ context, page }) => {
      await utils.setAuthCookies(context, owner.accessToken);
      await page.goto(`/spaces/${space.id}/albums/${album.id}`);

      await page.waitForSelector(`[data-thumbnail-focus-container][data-asset="${asset.id}"]`);
      await page.locator(`[data-thumbnail-focus-container][data-asset="${asset.id}"]`).click();
      await page.waitForSelector('#immich-asset-viewer');

      // Press Escape to close the viewer.
      await page.keyboard.press('Escape');

      // The URL must return to the album grid. Closing the viewer appends a `?at=<assetId>`
      // scroll-restore query, so match on the pathname only (ignore the query string).
      await page.waitForURL((url) => url.pathname === `/spaces/${space.id}/albums/${album.id}`);
      await expect(page.locator('#immich-asset-viewer')).not.toBeVisible();
    });

    test('deep link to /photos/:assetId → viewer opens immediately', async ({ context, page }) => {
      await utils.setAuthCookies(context, owner.accessToken);

      // Navigate directly to the photos URL (deep link / refresh scenario).
      await page.goto(`/spaces/${space.id}/albums/${album.id}/photos/${asset.id}`);

      // The asset viewer must render without needing a click.
      await page.waitForSelector('#immich-asset-viewer');
      await expect(page.locator('#immich-asset-viewer')).toBeVisible();
    });

    test('non-owner member (viewer role) can open a photo', async ({ context, page }) => {
      await utils.setAuthCookies(context, viewer.accessToken);
      await page.goto(`/spaces/${space.id}/albums/${album.id}`);

      await page.waitForSelector(`[data-thumbnail-focus-container][data-asset="${asset.id}"]`);
      await page.locator(`[data-thumbnail-focus-container][data-asset="${asset.id}"]`).click();

      // Assert the URL updated and the viewer is visible — proves authorization via the
      // Phase 1 album-read predicate for space members.
      await page.waitForURL(`/spaces/${space.id}/albums/${album.id}/photos/${asset.id}`);
      await page.waitForSelector('#immich-asset-viewer');
      await expect(page.locator('#immich-asset-viewer')).toBeVisible();
    });

    test('arrow keys navigate between photos within the album', async ({ context, page }) => {
      await utils.setAuthCookies(context, owner.accessToken);
      await page.goto(`/spaces/${space.id}/albums/${album.id}`);

      // Open the first photo in the album timeline (order is timeline-dependent, so don't assume which).
      const photoUrl = new RegExp(`/spaces/${space.id}/albums/${album.id}/photos/[^/]+$`);
      await page.waitForSelector('[data-thumbnail-focus-container][data-asset]');
      await page.locator('[data-thumbnail-focus-container][data-asset]').first().click();
      await page.waitForURL(photoUrl);
      await page.waitForSelector('#immich-asset-viewer');
      const firstUrl = page.url();

      // ArrowRight moves to the sibling photo within the album — the assetId in the URL changes.
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => page.url()).not.toBe(firstUrl);
      await expect(page.locator('#immich-asset-viewer')).toBeVisible();
      expect(page.url()).toMatch(photoUrl);

      // ArrowLeft returns to the first photo.
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => page.url()).toBe(firstUrl);
      await expect(page.locator('#immich-asset-viewer')).toBeVisible();
    });
  });

  // ─── Navigation helper ────────────────────────────────────────────────────

  test('a space member can navigate from the space page to its Albums view via the Albums button', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, editor.accessToken);
    await page.goto(`/spaces/${space.id}`);

    // The Albums tab anchor in the space tab bar (space-tabs.svelte, data-testid="space-tab-albums").
    await page.getByTestId('space-tab-albums').click();
    await page.waitForURL(`/spaces/${space.id}/albums`);
    await expect(page.getByTestId('space-album-card-link').filter({ hasText: 'Linked Album' })).toBeVisible();
  });

  // ─── C4: role-gating of link/unlink/edit affordances ───────────────────────
  //
  // Consolidates the link/unlink/add-photos/remove-from-album affordance matrix across the
  // space-albums list AND the space-album detail control bar: a Viewer must see NONE of them;
  // an Editor must see all of them. Reuses this describe's owner/editor/viewer + space + album
  // fixture (album is linked to `space` and contains `asset`/`asset2`).
  test.describe('C4: role-gating of link/unlink/edit affordances', () => {
    test('viewer sees no link / unlink / add-photos affordances', async ({ context, page }) => {
      await utils.setAuthCookies(context, viewer.accessToken);
      await page.goto(`/spaces/${space.id}/albums`);

      await expect(page.getByTestId('link-album-button')).not.toBeVisible();
      await expect(page.getByTestId('create-album-button')).not.toBeVisible();
      // The card's ⋯ menu (unlink / show-in-timeline) is canManage-gated.
      await expect(page.getByTestId('space-album-card-menu')).not.toBeVisible();
    });

    test('editor sees link + unlink affordances', async ({ context, page }) => {
      await utils.setAuthCookies(context, editor.accessToken);
      await page.goto(`/spaces/${space.id}/albums`);

      await expect(page.getByTestId('link-album-button')).toBeVisible();
      await expect(page.getByTestId('space-album-card-menu').first()).toBeVisible();
    });

    test('viewer sees no remove-from-album affordance in the space album detail', async ({ context, page }) => {
      await utils.setAuthCookies(context, viewer.accessToken);
      await page.goto(`/spaces/${space.id}/albums/${album.id}`);

      // Enter selection on the first asset, then assert the remove control is absent.
      await thumbnailUtils.withAssetId(page, asset.id).hover();
      await thumbnailUtils.selectButton(page, asset.id).click();

      await expect(page.getByTestId('add-photos-button')).not.toBeVisible();
      await expect(page.getByTestId('album-remove-from-album')).not.toBeVisible();
    });

    test('editor sees the remove-from-album affordance in the space album detail', async ({ context, page }) => {
      await utils.setAuthCookies(context, editor.accessToken);
      await page.goto(`/spaces/${space.id}/albums/${album.id}`);

      await thumbnailUtils.withAssetId(page, asset.id).hover();
      await thumbnailUtils.selectButton(page, asset.id).click();

      await expect(page.getByTestId('album-remove-from-album')).toBeVisible();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Web E2E: Spaces — Albums tab controls journeys
// Covers: search, sort, group+collapse, view toggle, create, link, viewer gating.
// Requires the e2e stack (make e2e). Stack absence causes connection refused — CI only.
// ──────────────────────────────────────────────────────────────────────────────
test.describe('Spaces — Albums tab controls (search / sort / group / view / create / link / viewer gating)', () => {
  let ctrlAdmin: LoginResponseDto;
  let ctrlOwner: LoginResponseDto;
  let ctrlEditor: LoginResponseDto;
  let ctrlViewer: LoginResponseDto;
  let ctrlSpace: SharedSpaceResponseDto;
  let ctrlAlbumA: AlbumResponseDto;
  let ctrlAlbumB: AlbumResponseDto;
  let ctrlAlbumC: AlbumResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    ctrlAdmin = await utils.adminSetup();

    [ctrlOwner, ctrlEditor, ctrlViewer] = await Promise.all([
      utils.userSetup(ctrlAdmin.accessToken, createUserDto.create('ctrl-owner')),
      utils.userSetup(ctrlAdmin.accessToken, createUserDto.create('ctrl-editor')),
      utils.userSetup(ctrlAdmin.accessToken, createUserDto.create('ctrl-viewer')),
    ]);

    ctrlSpace = await utils.createSpace(ctrlOwner.accessToken, { name: 'Controls Test Space' });

    await utils.addSpaceMember(ctrlOwner.accessToken, ctrlSpace.id, {
      userId: ctrlEditor.userId,
      role: SharedSpaceRole.Editor,
    });
    await utils.addSpaceMember(ctrlOwner.accessToken, ctrlSpace.id, {
      userId: ctrlViewer.userId,
      role: SharedSpaceRole.Viewer,
    });

    // Seed three albums with distinct names so search/sort/group can be exercised.
    // Names chosen to be alphabetically distinct: "Alpha Album" < "Beta Album" < "Zeta Album".
    const [assetA, assetB, assetC] = await Promise.all([
      utils.createAsset(ctrlOwner.accessToken),
      utils.createAsset(ctrlOwner.accessToken),
      utils.createAsset(ctrlOwner.accessToken),
    ]);

    [ctrlAlbumA, ctrlAlbumB, ctrlAlbumC] = await Promise.all([
      utils.createAlbum(ctrlOwner.accessToken, { albumName: 'Alpha Album', assetIds: [assetA.id] }),
      utils.createAlbum(ctrlOwner.accessToken, { albumName: 'Beta Album', assetIds: [assetB.id] }),
      utils.createAlbum(ctrlOwner.accessToken, { albumName: 'Zeta Album', assetIds: [assetC.id] }),
    ]);

    await Promise.all([
      utils.linkSpaceAlbum(ctrlOwner.accessToken, ctrlSpace.id, ctrlAlbumA.id),
      utils.linkSpaceAlbum(ctrlOwner.accessToken, ctrlSpace.id, ctrlAlbumB.id),
      utils.linkSpaceAlbum(ctrlOwner.accessToken, ctrlSpace.id, ctrlAlbumC.id),
    ]);
  });

  // 1. Search narrows cards and clearing restores all.
  test('search narrows visible cards to matching albums; clearing restores all', async ({ context, page }) => {
    await utils.setAuthCookies(context, ctrlOwner.accessToken);
    await page.goto(`/spaces/${ctrlSpace.id}/albums`);

    // All three cards should be visible initially.
    await expect(page.getByTestId('space-album-card')).toHaveCount(3);

    // Type a query that matches exactly one album.
    await page.getByTestId('space-albums-search').fill('Alpha');
    await expect(page.getByTestId('space-album-card')).toHaveCount(1);
    await expect(page.getByTestId('space-album-card-link').first()).toContainText('Alpha Album');

    // Clear the search field — all albums return.
    await page.getByTestId('space-albums-search').fill('');
    await expect(page.getByTestId('space-album-card')).toHaveCount(3);
  });

  // 2. Sort by Title reorders the card links.
  test('sort by Title reorders space-album-card-link hrefs alphabetically', async ({ context, page }) => {
    await utils.setAuthCookies(context, ctrlOwner.accessToken);
    await page.goto(`/spaces/${ctrlSpace.id}/albums`);

    // Wait for initial cards.
    await expect(page.getByTestId('space-album-card')).toHaveCount(3);

    // Open the sort menu and pick "Title" (AlbumSortBy.Title = 'Title').
    await page.getByTestId('space-albums-sort-btn').click();
    await expect(page.getByTestId('space-albums-sort-menu')).toBeVisible();
    await page.getByTestId('space-albums-sort-option-Title').click();
    await expect(page.getByTestId('space-albums-sort-menu')).not.toBeVisible();

    // After sorting by Title ascending the first card should be Alpha Album.
    const links = page.getByTestId('space-album-card-link');
    await expect(links).toHaveCount(3);
    // First link should point to Alpha Album (smallest alphabetically).
    await expect(links.first()).toHaveAttribute('href', `/spaces/${ctrlSpace.id}/albums/${ctrlAlbumA.id}`);
    // Last link should point to Zeta Album.
    await expect(links.last()).toHaveAttribute('href', `/spaces/${ctrlSpace.id}/albums/${ctrlAlbumC.id}`);
  });

  // 3. Group by Year renders group headers; clicking a header collapses its cards.
  test('group by Year renders space-album-group-* headers; clicking header collapses cards', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, ctrlOwner.accessToken);
    await page.goto(`/spaces/${ctrlSpace.id}/albums`);

    await expect(page.getByTestId('space-album-card')).toHaveCount(3);

    // Open group menu and pick Year (SpaceAlbumGroupBy.Year = 'Year').
    await page.getByTestId('space-albums-group-btn').click();
    await expect(page.getByTestId('space-albums-group-menu')).toBeVisible();
    await page.getByTestId('space-albums-group-option-Year').click();
    await expect(page.getByTestId('space-albums-group-menu')).not.toBeVisible();

    // At least one group header should be rendered (all albums were just created, so same year).
    const groupHeaders = page.locator('[data-testid^="space-album-group-"]');
    await expect(groupHeaders).toHaveCount(1);

    // Capture the group id from the first header's testid.
    const firstHeaderTestId = await groupHeaders.first().getAttribute('data-testid');
    expect(firstHeaderTestId).toBeTruthy();
    // The group header is collapsed by clicking it; cards inside should disappear.
    await groupHeaders.first().click();
    // After collapse the cards inside the group are no longer visible.
    await expect(page.getByTestId('space-album-card')).toHaveCount(0);

    // Click the header again to expand — cards return.
    await groupHeaders.first().click();
    await expect(page.getByTestId('space-album-card')).toHaveCount(3);

    // Reset grouping to None so subsequent tests are not affected.
    await page.getByTestId('space-albums-group-btn').click();
    await page.getByTestId('space-albums-group-option-None').click();
  });

  // 4. View toggle switches to list rows linking to the space album route.
  test('view toggle switches to list mode; rows link to /spaces/{id}/albums/{albumId}', async ({ context, page }) => {
    await utils.setAuthCookies(context, ctrlOwner.accessToken);
    await page.goto(`/spaces/${ctrlSpace.id}/albums`);

    await expect(page.getByTestId('space-album-card')).toHaveCount(3);

    // The view toggle button (currently showing cover mode) is the "List" button inside
    // the space-albums-view-toggle container.
    const viewToggleContainer = page.getByTestId('space-albums-view-toggle');
    await viewToggleContainer.getByRole('button', { name: /list/i }).click();

    // Card elements should be gone; list rows should appear.
    await expect(page.getByTestId('space-album-card')).toHaveCount(0);

    // Each row's anchor should link to the correct space album route.
    const rowA = page.getByTestId(`space-album-row-${ctrlAlbumA.id}`);
    const rowB = page.getByTestId(`space-album-row-${ctrlAlbumB.id}`);
    const rowC = page.getByTestId(`space-album-row-${ctrlAlbumC.id}`);
    await expect(rowA).toBeVisible();
    await expect(rowA).toHaveAttribute('href', `/spaces/${ctrlSpace.id}/albums/${ctrlAlbumA.id}`);
    await expect(rowB).toBeVisible();
    await expect(rowC).toBeVisible();

    // Switch back to cover mode.
    await viewToggleContainer.getByRole('button', { name: /covers/i }).click();
    await expect(page.getByTestId('space-album-card')).toHaveCount(3);
  });

  // 5. Owner: create-album-button navigates to a new /spaces/{id}/albums/{newId} route.
  test('owner: create-album-button creates an album and navigates to its space route', async ({ context, page }) => {
    await utils.setAuthCookies(context, ctrlOwner.accessToken);
    await page.goto(`/spaces/${ctrlSpace.id}/albums`);

    await expect(page.getByTestId('space-album-card')).toHaveCount(3);
    await expect(page.getByTestId('create-album-button')).toBeVisible();

    await page.getByTestId('create-album-button').click();

    // The page navigates to the new album's detail route inside the space.
    const spaceAlbumRoutePattern = new RegExp(`/spaces/${ctrlSpace.id}/albums/[^/]+$`);
    await page.waitForURL(spaceAlbumRoutePattern);
    expect(page.url()).toMatch(spaceAlbumRoutePattern);
  });

  // 6. Owner: link-album-button opens the link modal (album-picker testid visible).
  test('owner: link-album-button opens the link album modal', async ({ context, page }) => {
    await utils.setAuthCookies(context, ctrlOwner.accessToken);
    await page.goto(`/spaces/${ctrlSpace.id}/albums`);

    await expect(page.getByTestId('link-album-button')).toBeVisible();
    await page.getByTestId('link-album-button').click();

    // SpaceLinkAlbumModal renders a FormModal (role="dialog"). The album-picker only renders
    // once the async album load finishes AND there is a linkable album, so assert the dialog
    // itself opened — that is what this test verifies.
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  // 7. Viewer gating: write controls absent; read controls present.
  test('viewer: write controls absent; search / sort / group / view controls present', async ({ context, page }) => {
    await utils.setAuthCookies(context, ctrlViewer.accessToken);
    await page.goto(`/spaces/${ctrlSpace.id}/albums`);

    // Read-only controls must be visible.
    await expect(page.getByTestId('space-albums-search')).toBeVisible();
    await expect(page.getByTestId('space-albums-sort-btn')).toBeVisible();
    await expect(page.getByTestId('space-albums-group-btn')).toBeVisible();
    // The view-toggle container is always rendered.
    await expect(page.getByTestId('space-albums-view-toggle')).toBeVisible();

    // Write controls must be absent.
    await expect(page.getByTestId('create-album-button')).not.toBeVisible();
    await expect(page.getByTestId('link-album-button')).not.toBeVisible();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// API-level e2e: Spaces — linked-album live people sync
// Requires the e2e stack (make e2e). Skipped automatically when infra unavailable.
// ──────────────────────────────────────────────────────────────────────────────
test.describe('Spaces — linked-album live people sync', () => {
  let syncAdmin: LoginResponseDto;
  let syncOwner: LoginResponseDto;
  let syncSpace: SharedSpaceResponseDto;
  let syncAlbum: AlbumResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    syncAdmin = await utils.adminSetup();
    syncOwner = await utils.userSetup(syncAdmin.accessToken, createUserDto.create('sync-people-owner'));

    // Create the space. Face recognition is on by default for new spaces, which is what the
    // sync handlers gate on (faceRecognitionEnabled is not part of the create DTO).
    syncSpace = await utils.createSpace(syncOwner.accessToken, {
      name: 'Sync People Test Space',
    });
    // syncOwner is already the space owner/member via createSpace — no addSpaceMember needed.

    // Create an album and link it to the space.
    syncAlbum = await utils.createAlbum(syncOwner.accessToken, { albumName: 'Sync People Album' });
    await utils.linkSpaceAlbum(syncOwner.accessToken, syncSpace.id, syncAlbum.id);
  });

  test('adding an asset to a linked album and removing it keeps space people in sync', async () => {
    // Seed a space person that references this asset so we can verify face removal.
    // We use the DB seeder because real ML face detection is non-deterministic in CI.
    const asset = await utils.createAsset(syncOwner.accessToken);
    const { spacePersonId } = await utils.createSpacePerson(syncSpace.id, 'SyncTestPerson', syncOwner.userId, asset.id);

    // Add the asset to the album — this triggers AlbumAssetsAdd → SharedSpaceFaceMatch.
    // (Face match is async; we don't wait for it here — we're testing the sync path.)
    const addResults: BulkIdResponseDto[] = await addAssetsToAlbum(
      { id: syncAlbum.id, bulkIdsDto: { ids: [asset.id] } },
      { headers: asBearerAuth(syncOwner.accessToken) },
    );
    expect(addResults.some(({ success }) => success)).toBe(true);

    // Verify the person still exists before removal.
    const peopleBefore = await getSpacePeople({ id: syncSpace.id }, { headers: asBearerAuth(syncOwner.accessToken) });
    const personBefore = peopleBefore.find((p) => p.id === spacePersonId);
    expect(personBefore).toBeDefined();

    // Remove the asset from the album — this triggers AlbumAssetsRemove → cleanup.
    // Since the asset has no other path (not in another linked album, not directly added),
    // the onAlbumAssetsRemove handler should delete the face association.
    await removeAssetFromAlbum(
      { id: syncAlbum.id, bulkIdsDto: { ids: [asset.id] } },
      { headers: asBearerAuth(syncOwner.accessToken) },
    );

    // removeAssetFromAlbum awaits the AlbumAssetsRemove emit, whose @OnEvent handler runs
    // synchronously in-process: the asset has no other path into the space, so its only face
    // link is dropped and the now-faceless space person is deleted before the response returns.
    const peopleAfter = await getSpacePeople({ id: syncSpace.id }, { headers: asBearerAuth(syncOwner.accessToken) });
    const personAfter = peopleAfter.find((p) => p.id === spacePersonId);
    expect(personAfter).toBeUndefined();
  });
});
