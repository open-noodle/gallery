import type { LoginResponseDto } from '@immich/sdk';
import { updateAsset } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { asBearerAuth, testAssetDir, utils } from 'src/utils';

test.describe('Map FilterPanel — empty library (#910)', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  test('hides every gated section on an empty library, keeping timeline and text', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/map');
    await page.waitForSelector('[data-testid="discovery-panel"], [data-testid="filter-toggle-btn"]');

    await expect(page.getByTestId('filter-section-timeline')).toBeVisible();
    await expect(page.getByTestId('filter-section-text')).toBeVisible();

    for (const section of ['people', 'location', 'camera', 'tags', 'rating', 'media', 'favorites', 'albums']) {
      await expect(page.getByTestId(`filter-section-${section}`)).toHaveCount(0);
    }
  });
});

test.describe('Map FilterPanel', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // #910: favorites and location need real data or their sections hide — this suite seeded
    // nothing before, so both were unreachable. See slice 6's recipe table.
    const favoriteAsset = await utils.createAsset(admin.accessToken);
    await updateAsset(
      { id: favoriteAsset.id, updateAssetDto: { isFavorite: true } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    await utils.createAsset(admin.accessToken, {
      assetData: {
        bytes: readFileSync(`${testAssetDir}/metadata/gps-position/thompson-springs.jpg`),
        filename: 'gps.jpg',
      },
    });
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
  });

  async function gotoMap(context: import('@playwright/test').BrowserContext, page: import('@playwright/test').Page) {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/map');
    await page.waitForSelector('[data-testid="discovery-panel"], [data-testid="filter-toggle-btn"]');
  }

  test('should show filter panel on map page', async ({ context, page }) => {
    await gotoMap(context, page);
    await expect(page.getByTestId('discovery-panel')).toBeVisible();
  });

  test('should collapse and expand filter panel', async ({ context, page }) => {
    await gotoMap(context, page);

    await expect(page.getByTestId('discovery-panel')).toBeVisible();

    // externalToggle mode: collapsing clips the panel to width 0 and surfaces the header filter button
    // (FilterToggleButton) instead of an inline collapsed strip.
    await page.getByTestId('collapse-panel-btn').click();
    await expect(page.getByTestId('filter-toggle-btn')).toBeVisible();

    await page.getByTestId('filter-toggle-btn').click();
    await expect(page.getByTestId('discovery-panel')).toBeVisible();
    await expect(page.getByTestId('filter-toggle-btn')).toHaveCount(0);
  });

  test('should show favorites filter section', async ({ context, page }) => {
    await gotoMap(context, page);
    await expect(page.getByTestId('favorites-filter')).toBeVisible();
  });

  test('should show location filter section on map', async ({ context, page }) => {
    await gotoMap(context, page);
    await expect(page.getByTestId('filter-section-location')).toBeVisible();
  });
});
