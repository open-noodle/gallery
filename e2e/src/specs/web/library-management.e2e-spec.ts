import { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('Library Management', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  test('should show empty library list', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/admin/library-management');
    await expect(page.getByText('Create an external library to view your photos and videos')).toBeVisible();
  });

  test('should create a library and see it in the list', async ({ context, page }) => {
    const library = await utils.createLibrary(admin.accessToken, { ownerId: admin.userId });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/admin/library-management');

    await expect(page.getByRole('link', { name: library.name })).toBeVisible();
  });

  test('should navigate to library detail page', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/admin/library-management');
    await expect(page).toHaveTitle(/External Libraries/);
  });
});
