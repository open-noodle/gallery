import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('Map FilterPanel', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
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
