import type { LoginResponseDto } from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { thumbnailUtils } from 'src/ui/specs/timeline/utils';
import { testAssetDir, utils } from 'src/utils';

/**
 * `noGps` / `noPlaceName` are mutually exclusive members of the ONE location filter (alongside
 * city/state/country) — selecting either replaces the whole group and renders a single chip. This
 * suite covers the `noGps` member end to end (design spec 2026-08-14-no-location-filter, Task 12):
 * selecting it narrows the timeline, a reload keeps it applied, and removing its chip restores
 * every asset.
 *
 * Seeding needs one asset WITH gps and one WITHOUT, or "only the un-geotagged asset remains" would
 * pass vacuously. `thompson-springs.jpg` is the real GPS-tagged fixture the rest of the suite
 * already relies on for reverse-geocoding coverage (see `contextual-filters.e2e-spec.ts` and
 * `utils.cmdkSeedAllSectionTypes`); a bare `utils.createAsset` upload (a generated PNG) carries no
 * EXIF at all, so it has no `asset_exif` row — which is exactly what the server's `noGps` predicate
 * (`NOT EXISTS asset_exif WHERE latitude IS NOT NULL`, see `server/src/utils/database.ts`) matches.
 */
const GPS_FIXTURE = 'metadata/gps-position/thompson-springs.jpg';

async function waitForFilterPanel(page: Page) {
  await page.waitForSelector('[data-testid="discovery-panel"], [data-testid="filter-toggle-btn"]');
}

test.describe('No-location filter', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    await utils.createAsset(admin.accessToken, {
      assetData: { bytes: readFileSync(`${testAssetDir}/${GPS_FIXTURE}`), filename: 'thompson-springs.jpg' },
    });
    await utils.createAsset(admin.accessToken);

    // Drain metadata extraction so the GPS fixture's latitude is committed before any test reads
    // the filter suggestions or the timeline — otherwise it would transiently look un-geotagged too
    // and "leaves only the un-geotagged asset" would pass for the wrong reason.
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
  });

  test('selecting "No location" narrows the grid, shows one chip, sets the URL, and survives a reload', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    // Clear localStorage so the filter panel and its sections start expanded, same as
    // photos-filter-panel.e2e-spec.ts, rather than inheriting a collapsed state from another test.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await waitForFilterPanel(page);

    // The presence row only renders once the async filter-suggestions fetch reports
    // hasNoGpsAssets — same wait pattern as `rating-star-5` in photos-filter-panel.e2e-spec.ts.
    const noGpsRow = page.getByTestId('location-presence-noGps');
    await noGpsRow.waitFor({ state: 'visible', timeout: 10_000 });

    const bucketResponse = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await noGpsRow.click();
    await bucketResponse;

    await expect(thumbnailUtils.locator(page)).toHaveCount(1);

    const activeFiltersBar = page.getByTestId('active-filters-bar');
    await expect(activeFiltersBar).toContainText('No location');
    // city/state/country/locationPresence fold into ONE chip — asserting exactly one active-chip
    // (not two) is what actually proves the group collapsed rather than adding a second chip.
    await expect(activeFiltersBar.getByTestId('active-chip')).toHaveCount(1);

    await expect(page).toHaveURL(/locationPresence=noGps/);

    await page.reload();
    await waitForFilterPanel(page);

    await expect(thumbnailUtils.locator(page)).toHaveCount(1);
    await expect(page).toHaveURL(/locationPresence=noGps/);
    await expect(page.getByTestId('active-filters-bar')).toContainText('No location');
  });

  test('removing the location chip restores every asset', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos?locationPresence=noGps');
    await waitForFilterPanel(page);

    await expect(thumbnailUtils.locator(page)).toHaveCount(1);
    const activeFiltersBar = page.getByTestId('active-filters-bar');
    await expect(activeFiltersBar).toContainText('No location');

    const bucketResponse = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await activeFiltersBar
      .getByTestId('active-chip')
      .filter({ hasText: 'No location' })
      .getByTestId('chip-close')
      .click();
    await bucketResponse;

    // No filters left at all: the ActiveFiltersBar itself stops rendering (`hasActiveFilters` false).
    await expect(page.getByTestId('active-filters-bar')).toHaveCount(0);
    await expect(thumbnailUtils.locator(page)).toHaveCount(2);
  });
});
