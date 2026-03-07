import { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('User Settings', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  test('user settings page loads', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/user-settings');

    await expect(page).toHaveURL('/user-settings');
  });

  test('user settings shows settings sections', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/user-settings');

    // Check that common settings sections are visible
    await expect(page.getByText(/app settings/i)).toBeVisible();
  });
});
