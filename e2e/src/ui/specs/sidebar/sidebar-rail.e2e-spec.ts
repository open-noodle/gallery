import { faker } from '@faker-js/faker';
import { expect, test } from '@playwright/test';
import { setupBaseMockApiRoutes } from 'src/ui/mock-network/base-network';
import { utils } from 'src/utils';

// This suite only needs the app shell (auth, preferences, server config, navbar, sidebar) to
// render at a given viewport - no timeline/asset data is asserted on, so `setupTimelineMockApiRoutes`
// is intentionally not wired in here, unlike the timeline specs this file otherwise mirrors.
test.describe('Sidebar rail', () => {
  let adminUserId: string;

  test.beforeAll(() => {
    test.fail(
      process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS !== '1',
      'This test requires env var: PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1',
    );
    utils.initSdk();
    adminUserId = faker.string.uuid();
  });

  test.beforeEach(async ({ context }) => {
    await setupBaseMockApiRoutes(context, adminUserId);
  });

  const sidebar = '[data-testid="sidebar-parent"]';
  const grid = '[data-testid="user-page-grid"]';

  // Spec coverage 33.
  test('shows the rail at 1000px and expands on hover without moving the grid', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/photos');

    await expect(page.locator(sidebar)).toHaveAttribute('data-layout', 'rail');
    await expect(page.locator(grid)).toHaveAttribute('data-sidebar-width', 'rail');

    const before = await page.locator(grid).evaluate((node) => getComputedStyle(node).gridTemplateColumns);

    await page.locator(sidebar).hover();
    await expect(page.locator(sidebar)).toHaveAttribute('data-expanded', 'true');

    const after = await page.locator(grid).evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    expect(after).toBe(before);
  });

  // Spec coverage 34.
  test('honours an explicit rail choice at 1400px and survives reload', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/photos');
    await expect(page.locator(sidebar)).toHaveAttribute('data-layout', 'expanded');

    await page.evaluate(() => localStorage.setItem('sidebar-mode', JSON.stringify('rail')));
    await page.reload();

    await expect(page.locator(sidebar)).toHaveAttribute('data-layout', 'rail');
  });

  // Spec coverage 35: the hamburger must both open AND close - upstream toggle() never closes.
  test('opens and closes the rail overlay from the hamburger', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/photos');

    const menu = page.locator('#top-menu-button');
    await expect(menu).toBeVisible();

    await menu.click();
    await expect(page.locator(sidebar)).toHaveAttribute('data-expanded', 'true');

    await menu.click();
    await expect(page.locator(sidebar)).toHaveAttribute('data-expanded', 'false');
  });

  test('navigates when a rail icon is tapped', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/photos');

    await page.locator(`${sidebar} a[href="/albums"]`).click();

    await expect(page).toHaveURL(/\/albums/);
  });
});
