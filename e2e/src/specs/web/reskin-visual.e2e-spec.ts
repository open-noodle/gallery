import AxeBuilder from '@axe-core/playwright';
import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

// Hardening net for the tonal re-skin, running in CI (which checks out
// test-assets and uses a deterministic renderer):
//  - a11y: WCAG-AA color-contrast scan over the re-skinned pages (active).
//  - visual: screenshot regression, masking photo thumbnails so it tests the
//    chrome (navbar, sidebar, content panel, headers), not photo content.
//
// The visual tests are `test.fixme` until baselines are generated + committed
// from the CI runner (mac-produced snapshots differ on font rendering). To
// enable: run the e2e-tests-web job once with `--update-snapshots`, commit the
// PNGs under reskin-visual.e2e-spec.ts-snapshots/, then drop the `.fixme`.
const SCREENS = ['/photos', '/albums', '/search'];

const gotoThemed = async (
  context: import('@playwright/test').BrowserContext,
  page: import('@playwright/test').Page,
  token: string,
  path: string,
  theme: 'light' | 'dark',
) => {
  await utils.setAuthCookies(context, token);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme);
};

test.describe('re-skin hardening', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    for (let year = 2024; year >= 2022; year--) {
      await utils.createAsset(admin.accessToken, {
        fileCreatedAt: `${year}-06-15T10:00:00.000Z`,
        fileModifiedAt: `${year}-06-15T10:00:00.000Z`,
      });
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of SCREENS) {
      test(`a11y · ${theme} · ${path}`, async ({ context, page }) => {
        await gotoThemed(context, page, admin.accessToken, path, theme);
        const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze();
        const contrast = results.violations.filter((v) => v.id === 'color-contrast');
        expect(contrast, JSON.stringify(contrast, null, 2)).toEqual([]);
      });

      test.fixme(`visual · ${theme} · ${path}`, async ({ context, page }) => {
        await gotoThemed(context, page, admin.accessToken, path, theme);
        await expect(page).toHaveScreenshot(`${path.replaceAll('/', '_')}-${theme}.png`, {
          animations: 'disabled',
          mask: [page.locator('img')],
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  }
});
