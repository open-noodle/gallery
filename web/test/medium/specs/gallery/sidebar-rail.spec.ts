import { Route } from '#lib/route.ts';
import { expect, test } from '#test/medium/fixtures.ts';
import { restoreViewport } from '#test/medium/gallery/viewport.ts';

// Gallery's sidebar rail (narrow screens): rail layout, hover expansion, explicit rail choice, the hamburger.
const sidebar = '[data-testid="sidebar-parent"]';
const grid = '[data-testid="user-page-grid"]';

test.describe('sidebar rail', () => {
  test.afterEach(restoreViewport);

  test('shows the rail at 1000px and expands on hover without moving the grid', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(Route.photos());

    await expect(page.locator(sidebar)).toHaveAttribute('data-layout', 'rail');
    await expect(page.locator(grid)).toHaveAttribute('data-sidebar-width', 'rail');
    const before = await page.locator(grid).evaluate((node) => getComputedStyle(node).gridTemplateColumns);

    await page.locator(sidebar).hover();
    await expect(page.locator(sidebar)).toHaveAttribute('data-expanded', 'true');
    const after = await page.locator(grid).evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    expect(after).toBe(before);
  });

  test('honours an explicit rail choice at 1400px and survives reload', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(Route.photos());
    await expect(page.locator(sidebar)).toHaveAttribute('data-layout', 'expanded');

    await page.evaluate(() => localStorage.setItem('sidebar-mode', JSON.stringify('rail')));
    await page.reload();

    await expect(page.locator(sidebar)).toHaveAttribute('data-layout', 'rail');
  });

  // The hamburger must both open and close the rail overlay (upstream's toggle never closes).
  test('opens and closes the rail overlay from the hamburger', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(Route.photos());

    const menu = page.locator('#top-menu-button');
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.locator(sidebar)).toHaveAttribute('data-expanded', 'true');
    await menu.click();
    await expect(page.locator(sidebar)).toHaveAttribute('data-expanded', 'false');
  });

  test('navigates when a rail icon is tapped', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(Route.photos());

    await page.locator(`${sidebar} a[href="/albums"]`).click();
    await expect(page).toHaveURL(/\/albums/);
  });
});
