import { type LoginResponseDto } from '@immich/sdk';
import { devices, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { testAssetDir, utils } from 'src/utils';

const SCHEME_RX = /^(immich|noodle-gallery):\/\/asset\?id=[0-9a-fA-F-]{36}$/;

test.describe('open-in-app banner', () => {
  let admin: LoginResponseDto;
  let assetId: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    const asset = await utils.createAsset(admin.accessToken, {
      assetData: {
        bytes: readFileSync(`${testAssetDir}/formats/jpg/el_torcal_rocks.jpg`),
        filename: 'el_torcal_rocks.jpg',
      },
    });
    assetId = asset.id;
  });

  test.describe('iPhone 13', () => {
    test.use({ ...devices['iPhone 13'] });

    test('renders on cold-nav to /photos/:id with the right deep link', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);

      const banner = page.getByRole('region', { name: /mobile app suggestion/i });
      await expect(banner).toBeVisible();

      const openLink = banner.getByRole('link', { name: /^open$/i });
      await expect(openLink).toHaveAttribute('href', expect.stringMatching(SCHEME_RX));
    });

    test('hides on internal SPA navigation back to the timeline', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      await expect(page.getByRole('region', { name: /mobile app suggestion/i })).toBeVisible();

      await page.goBack();
      await expect(page.getByRole('region', { name: /mobile app suggestion/i })).not.toBeVisible();
    });

    test('dismiss persists across reload', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      await page.getByRole('button', { name: /dismiss banner/i }).click();
      await expect(page.getByRole('region', { name: /mobile app suggestion/i })).not.toBeVisible();

      await page.reload();
      await expect(page.getByRole('region', { name: /mobile app suggestion/i })).not.toBeVisible();
    });

    test("Don't have the app? routes to App Store on iOS", async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      const link = page.getByRole('link', { name: /don't have the app/i });
      await expect(link).toHaveAttribute('href', /apps\.apple\.com/);
    });
  });

  test.describe('Pixel 5', () => {
    test.use({ ...devices['Pixel 5'] });

    test("Don't have the app? routes to /install on Android", async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      const link = page.getByRole('link', { name: /don't have the app/i });
      await expect(link).toHaveAttribute('href', '/install');
    });
  });

  test.describe('desktop', () => {
    test('does not render banner on desktop', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      await expect(page.getByRole('region', { name: /mobile app suggestion/i })).not.toBeVisible();
    });
  });
});
