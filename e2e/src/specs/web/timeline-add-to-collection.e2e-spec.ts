import {
  getAlbumInfo,
  getSpace,
  type AlbumResponseDto,
  type LoginResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { thumbnailUtils } from 'src/ui/specs/timeline/utils';
import { asBearerAuth, utils } from 'src/utils';

// Task 11 — unified "Add to album or space" timeline picker E2E.
//
// Tests the CollectionPickerModal opened from the timeline multi-select
// action bar ("+" / Add to album or space button). Covers:
//   1. Modal renders both an album badge and a space badge when both exist.
//   2. Single-click on album row adds assets; verified via getAlbumInfo API.
//   3. Multi-select (album + space) via add-collections-button; verified via both APIs.

/**
 * Selects all visible assets on the timeline via their checkbox buttons, then
 * clicks the "Add to album or space" action button to open the picker modal.
 *
 * Returns a locator scoped to the open dialog.
 */
async function openPickerWithAllAssets(page: import('@playwright/test').Page) {
  // Wait for at least one thumbnail to render before interacting.
  await expect(thumbnailUtils.locator(page).first()).toBeVisible();

  // Select all visible assets by clicking each thumbnail's checkbox button.
  // Hover first so the checkbox overlay becomes visible (it is only rendered on hover).
  const thumbs = thumbnailUtils.locator(page);
  for (const thumb of await thumbs.all()) {
    await thumb.hover();
    const checkbox = thumb.locator('button[role="checkbox"]');
    if (await checkbox.isVisible()) {
      await checkbox.click();
    }
  }

  // The "Add to album or space" ActionButton becomes visible on the control
  // bar once selection is active. It renders an aria-label (not a title attribute).
  const addButton = page.getByRole('button', { name: 'Add to album or space' });
  await expect(addButton).toBeVisible();
  await addButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Wait for loading skeleton to disappear (albums + spaces fetched).
  await expect(dialog.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 10_000 });
  return dialog;
}

test.describe('Timeline — Add to album or space (unified picker)', () => {
  let admin: LoginResponseDto;
  let album: AlbumResponseDto;
  let space: SharedSpaceResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Seed two assets with distinct timestamps so they appear together on the
    // timeline. The tests share these assets across cases; only API-side
    // membership assertions differ.
    await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2024-06-01T10:00:00.000Z',
      fileModifiedAt: '2024-06-01T10:00:00.000Z',
    });
    await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2024-06-01T11:00:00.000Z',
      fileModifiedAt: '2024-06-01T11:00:00.000Z',
    });
  });

  test.beforeEach(async () => {
    // Re-create the album and space fresh for each test so membership state
    // is predictable regardless of test order.
    album = await utils.createAlbum(admin.accessToken, { albumName: 'Picker Target Album' });
    space = await utils.createSpace(admin.accessToken, { name: 'Picker Target Space' });
  });

  test('picker shows album badge and space badge for same-name-prefixed collections', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');

    const dialog = await openPickerWithAllAssets(page);

    // Album row carries data-testid="row-album-<id>" and its badge carries
    // data-testid="collection-row-badge".
    const albumRow = dialog.locator(`[data-testid="row-album-${album.id}"]`);
    await expect(albumRow.first()).toBeVisible();
    await expect(albumRow.first().locator('[data-testid="collection-row-badge"]')).toBeVisible();

    // Space row carries data-testid="row-space-<id>" and its badge carries
    // data-testid="space-row-badge".
    const spaceRow = dialog.locator(`[data-testid="row-space-${space.id}"]`);
    await expect(spaceRow.first()).toBeVisible();
    await expect(spaceRow.first().locator('[data-testid="space-row-badge"]')).toBeVisible();
  });

  test('single-click on album row adds selected assets and is verifiable via API', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');

    const dialog = await openPickerWithAllAssets(page);

    // Click the album row — single click (no multi-select active) closes the
    // modal and dispatches the add-to-album request immediately.
    const albumRow = dialog.locator(`[data-testid="row-album-${album.id}"]`);
    await albumRow.first().click();

    // The modal should close after the add completes.
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // API-side assertion: album now has 2 assets.
    await expect
      .poll(
        async () => {
          const info = await getAlbumInfo({ id: album.id }, { headers: asBearerAuth(admin.accessToken) });
          return info.assetCount;
        },
        { message: 'album should contain both selected assets', timeout: 10_000 },
      )
      .toBe(2);
  });

  test('multi-select album + space via add-collections-button adds to both', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');

    const dialog = await openPickerWithAllAssets(page);

    // Trigger multi-select mode: Ctrl+click one row activates the multi-select
    // checkbox overlay. We use the checkbox button exposed inside each row
    // (the onMultiSelect handler).
    //
    // Album multi-select button: the checkbox icon button inside the album row.
    const albumRow = dialog.locator(`[data-testid="row-album-${album.id}"]`).first();
    // Hover to reveal the checkbox overlay, then click the checkbox button.
    await albumRow.hover();
    const albumCheckbox = albumRow.locator('button[role="checkbox"]');
    await expect(albumCheckbox).toBeVisible();
    await albumCheckbox.click();

    // The add-collections-button only appears once at least one item is
    // multi-selected.
    await expect(dialog.locator('[data-testid="add-collections-button"]')).toBeVisible();

    // Now select the space row as well.
    const spaceRow = dialog.locator(`[data-testid="row-space-${space.id}"]`).first();
    await spaceRow.hover();
    const spaceCheckbox = spaceRow.locator('button[role="checkbox"]');
    await expect(spaceCheckbox).toBeVisible();
    await spaceCheckbox.click();

    // Submit both selections.
    await dialog.locator('[data-testid="add-collections-button"]').click();

    // Modal closes after submission.
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // API-side assertions: album and space both received the assets.
    await expect
      .poll(
        async () => {
          const info = await getAlbumInfo({ id: album.id }, { headers: asBearerAuth(admin.accessToken) });
          return info.assetCount;
        },
        { message: 'album should contain both selected assets after multi-submit', timeout: 10_000 },
      )
      .toBe(2);

    await expect
      .poll(
        async () => {
          const info = await getSpace({ id: space.id }, { headers: asBearerAuth(admin.accessToken) });
          return info.assetCount ?? 0;
        },
        { message: 'space should contain both selected assets after multi-submit', timeout: 10_000 },
      )
      .toBe(2);
  });
});
