import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('Library Management', () => {
  test.beforeAll(() => {
    utils.initSdk();
  });

  test.beforeEach(async () => {
    await utils.resetDatabase();
  });

  test('should show empty library list', async ({ context, page }) => {
    const admin = await utils.adminSetup();
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/admin/library-management');
    await expect(page.getByText('Create an external library to view your photos and videos')).toBeVisible();
  });
});
