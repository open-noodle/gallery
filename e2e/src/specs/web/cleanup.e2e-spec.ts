import { AssetMediaResponseDto, LoginResponseDto } from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { utils } from 'src/utils.js';

// The smallest selectable "min size" filter on the Space Hogs page (see
// CLEANUP_SPACE_HOG_MIN_SIZES in web/src/lib/utils/cleanup.ts). Real e2e test uploads are a 1x1
// PNG, well under a kilobyte, so `fileSizeInByte` is written directly via the DB (as the task brief
// suggests) rather than uploading 50MB+ fixtures.
const SPACE_HOG_MIN_SIZE = 52_428_800;

const openSpaceHogs = async (page: Page) => {
  await page.goto('/utilities/cleanup/space-hogs');
  // Default filters are type=Videos, min size=100MiB; switch to Photos and the smallest size so the
  // (image-typed, DB-sized) seeded assets show up.
  await page.getByTestId('cleanup-hog-type-image').click();
  await page.getByTestId('cleanup-hog-min-size').selectOption(String(SPACE_HOG_MIN_SIZE));
};

test.describe('Cleanup Utility', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  test.beforeEach(async ({ context }) => {
    await utils.setAuthCookies(context, admin.accessToken);
  });

  test('the hub shows today and every queue row', async ({ page }) => {
    await page.goto('/utilities');
    await page.getByRole('link', { name: 'Cleanup', exact: true }).click();
    await expect(page).toHaveURL('/utilities/cleanup');

    await expect(page.getByTestId('cleanup-hub')).toBeVisible();
    await expect(page.locator('[data-today="true"]')).toBeVisible();

    for (const queue of ['space_hogs', 'bursts', 'screenshots', 'duplicates', 'blurry']) {
      await expect(page.getByTestId(`cleanup-queue-${queue}`)).toBeVisible();
    }
  });

  test('rewind today: marking a tile for trash and moving it to trash lands it in /trash', async ({ page }) => {
    await page.goto('/utilities/cleanup');

    // Discover the exact month/day the app considers "today" from its own rendered cell, rather
    // than recomputing it from Node's clock — the hub computes it from the browser's local time
    // zone, which need not match the test runner's.
    const todayCell = page.locator('[data-today="true"]');
    await expect(todayCell).toBeVisible();
    const testId = await todayCell.getAttribute('data-testid');
    const monthDay = Number(testId?.replace('cleanup-cal-', ''));
    expect(monthDay).toBeGreaterThan(0);
    const month = Math.floor(monthDay / 100);
    const day = monthDay % 100;

    // A year other than this one, same month/day, mid-day UTC — the calendar's month/day index is
    // computed at time zone UTC (server/src/schema/cleanup-sql.ts), so this reproduces exactly the
    // month/day the cell reported.
    const pastYear = new Date().getUTCFullYear() - 3;
    const fileCreatedAt = new Date(Date.UTC(pastYear, month - 1, day, 12, 0, 0)).toISOString();
    const asset: AssetMediaResponseDto = await utils.createAsset(admin.accessToken, { fileCreatedAt });

    await page.reload();
    await page.getByRole('link', { name: 'Rewind today' }).click();
    await expect(page).toHaveURL(`/utilities/cleanup/rewind/${monthDay}`);

    const tile = page.getByTestId(`cleanup-rewind-tile-${asset.id}`);
    await expect(tile).toBeVisible();

    // Focuses the tile, then sends the keydown/keyup — matching the brief's "press Delete with the
    // tile focused".
    await tile.press('Delete');
    await expect(tile).toHaveAttribute('data-mark', 'trash');

    const moveToTrash = page.getByTestId('cleanup-move-to-trash');
    await expect(moveToTrash).toHaveText('Move 1 to trash');
    await moveToTrash.click();

    // The commit is async; wait for it to resolve (the tile is removed from the page once the
    // server confirms the trash) before navigating away, or the navigation races the request.
    await expect(tile).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

    await page.goto('/trash');
    await expect(page.locator(`[data-asset-id="${asset.id}"]`)).toBeVisible();
  });

  test('rewind: Finish day marks the hub cell reviewed', async ({ page }) => {
    const monthDay = 610; // June 10th — arbitrary, fixed, and never "today" in practice.
    const asset: AssetMediaResponseDto = await utils.createAsset(admin.accessToken, {
      fileCreatedAt: new Date(Date.UTC(2015, 5, 10, 12, 0, 0)).toISOString(),
    });

    await page.goto(`/utilities/cleanup/rewind/${monthDay}`);
    await expect(page.getByTestId(`cleanup-rewind-tile-${asset.id}`)).toBeVisible();

    await page.getByTestId('cleanup-finish-day').click();
    await expect(page.getByText('Day complete')).toBeVisible();

    // Finishing the day navigates away (to the next unreviewed day, or the hub) on its own; wait for
    // that to happen before driving our own navigation, so the two don't race.
    await page.waitForURL((url) => !url.pathname.endsWith(`/rewind/${monthDay}`));

    await page.goto('/utilities/cleanup');
    await expect(page.getByTestId(`cleanup-cal-${monthDay}`)).toHaveAttribute('data-state', 'reviewed');
  });

  test.describe('Space hogs queue', () => {
    let keepAsset: AssetMediaResponseDto;
    let trashAsset: AssetMediaResponseDto;

    test.beforeAll(async () => {
      [keepAsset, trashAsset] = await Promise.all([
        utils.createAsset(admin.accessToken),
        utils.createAsset(admin.accessToken),
      ]);
      await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');

      const client = await utils.connectDatabase();
      await client.query('UPDATE asset_exif SET "fileSizeInByte" = $1 WHERE "assetId" = $2', [
        90_000_000,
        keepAsset.id,
      ]);
      await client.query('UPDATE asset_exif SET "fileSizeInByte" = $1 WHERE "assetId" = $2', [
        80_000_000,
        trashAsset.id,
      ]);
    });

    test('Keep on the first row removes it, and it stays gone after reload', async ({ page }) => {
      await openSpaceHogs(page);

      const firstRow = page.locator('[data-testid="cleanup-hog-list"] [data-asset-id]').first();
      const firstId = await firstRow.getAttribute('data-asset-id');
      expect(firstId).toBeTruthy();

      await page.getByTestId(`cleanup-hog-keep-${firstId}`).click();
      await expect(page.getByTestId(`cleanup-hog-row-${firstId}`)).not.toBeVisible();

      await openSpaceHogs(page);
      await expect(page.getByTestId(`cleanup-hog-row-${firstId}`)).not.toBeVisible();
    });

    test('Trash shows an Undo toast, and Undo restores the row after reload', async ({ page }) => {
      await openSpaceHogs(page);
      await expect(page.getByTestId(`cleanup-hog-row-${trashAsset.id}`)).toBeVisible();

      await page.getByTestId(`cleanup-hog-trash-${trashAsset.id}`).click();
      await expect(page.getByTestId(`cleanup-hog-row-${trashAsset.id}`)).not.toBeVisible();

      const undoButton = page.getByRole('button', { name: 'Undo' });
      await expect(undoButton).toBeVisible();
      await undoButton.click();

      await openSpaceHogs(page);
      await expect(page.getByTestId(`cleanup-hog-row-${trashAsset.id}`)).toBeVisible();
    });
  });
});
