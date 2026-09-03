import AxeBuilder from '@axe-core/playwright';
import { DefaultAccess, getConfigDefaults, updateConfig, type LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

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

// Gallery-fork: family relationships (slice 10, D5.2). `/family` is added ONLY to the live a11y
// scan below — never to `SCREENS`, which also drives the (fixme, never-run) visual loop. Adding
// it there would create a new `visual ·` case that can never run: exactly the trap this file's
// own header already warns about, and the one the design spec calls out explicitly as something
// this slice must not fall into.
const A11Y_SCREENS = [...SCREENS, '/family'];

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

    // Gallery-fork: family relationships. `/family` renders no surface at all for a viewer whose
    // effective access is `none` (A12) — the instance default, so the a11y scan below would
    // silently exercise `/photos` instead (the page's own redirect target) without this. Admins
    // get no implicit bypass either (D2), so this has to be the instance default rather than a
    // per-user grant.
    const defaults = await getConfigDefaults({ headers: asBearerAuth(admin.accessToken) });
    await updateConfig(
      { systemConfigDto: { ...defaults, familyTree: { enabled: true, defaultAccess: DefaultAccess.Contribute } } },
      { headers: asBearerAuth(admin.accessToken) },
    );
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const path of A11Y_SCREENS) {
      test(`a11y · ${theme} · ${path}`, async ({ context, page }) => {
        await gotoThemed(context, page, admin.accessToken, path, theme);
        const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze();
        const contrast = results.violations.filter((v) => v.id === 'color-contrast');
        expect(contrast, JSON.stringify(contrast, null, 2)).toEqual([]);
      });
    }

    for (const path of SCREENS) {
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
