import { type LoginResponseDto } from '@immich/sdk';
import { devices, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { testAssetDir, utils } from 'src/utils';

const SCHEME_RX = /^(immich|noodle-gallery):\/\/asset\?id=[0-9a-fA-F-]{36}$/;
const BANNER = 'open-in-app-banner';

// Strip `defaultBrowserType` from device configs — Playwright forbids switching
// browser types across describe groups within a single project. The web e2e
// project runs Desktop Chrome, and we just need the mobile UA / viewport /
// touch points to drive `detectPlatform`.
const omitBrowserType = (device: (typeof devices)[keyof typeof devices]) => {
  const copy: Record<string, unknown> = { ...device };
  delete copy.defaultBrowserType;
  return copy;
};
const iPhone13 = omitBrowserType(devices['iPhone 13']);
const pixel5 = omitBrowserType(devices['Pixel 5']);

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
    test.use({ ...iPhone13 });

    test('renders on cold-nav to /photos/:id with the right deep link', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);

      const banner = page.getByTestId(BANNER);
      await expect(banner).toBeVisible();

      const openLink = banner.getByRole('link', { name: /^open$/i });
      await expect(openLink).toHaveAttribute('href', expect.stringMatching(SCHEME_RX));
    });

    test('hides after navigating away from the deep-link route', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      // Establish a real history entry so that goBack() does not no-op on a
      // freshly-opened tab. Two full page loads also exercise the cold-mount
      // path on /photos/:id (where the banner SHOULD show).
      await page.goto('/photos');
      await page.goto(`/photos/${assetId}`);
      await expect(page.getByTestId(BANNER)).toBeVisible();

      // Going back lands on /photos (root timeline) — not in the route
      // allowlist, so the banner must not render. (Whether SvelteKit treats
      // the back as a SPA popstate or a full reload, the user-facing
      // behaviour is the same: no banner on a non-deep-link route.)
      await page.goBack();
      await expect(page.getByTestId(BANNER)).not.toBeVisible();
    });

    test('dismiss persists across reload', async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      await page.getByRole('button', { name: /dismiss banner/i }).click();
      await expect(page.getByTestId(BANNER)).not.toBeVisible();

      await page.reload();
      await expect(page.getByTestId(BANNER)).not.toBeVisible();
    });

    test("Don't have the app? routes to App Store on iOS", async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${assetId}`);
      const link = page.getByRole('link', { name: /don't have the app/i });
      await expect(link).toHaveAttribute('href', /apps\.apple\.com/);
    });
  });

  test.describe('Pixel 5', () => {
    test.use({ ...pixel5 });

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
      await expect(page.getByTestId(BANNER)).not.toBeVisible();
    });
  });
});
