import type { LoginResponseDto } from '@immich/sdk';
import { updateAsset } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { asBearerAuth, testAssetDir, utils } from 'src/utils';

test.describe('Photos FilterPanel', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Create assets with varied dates so timeline has content
    const asset1 = await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2023-08-15T10:00:00.000Z',
      fileModifiedAt: '2023-08-15T10:00:00.000Z',
    });
    await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2023-07-10T10:00:00.000Z',
      fileModifiedAt: '2023-07-10T10:00:00.000Z',
    });
    await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2022-12-25T10:00:00.000Z',
      fileModifiedAt: '2022-12-25T10:00:00.000Z',
    });

    // Rate an asset so the rating filter has a visible star
    await updateAsset({ id: asset1.id, updateAssetDto: { rating: 5 } }, { headers: asBearerAuth(admin.accessToken) });

    // #910: each of these keeps one filter section available. Without them the section is correctly
    // hidden and the assertions below have nothing to act on. See slice 6's recipe table.
    const video = await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2023-06-01T10:00:00.000Z',
      fileModifiedAt: '2023-06-01T10:00:00.000Z',
      assetData: { filename: 'example-video.mp4' },
    });
    await utils.createAsset(admin.accessToken, {
      assetData: {
        bytes: readFileSync(`${testAssetDir}/metadata/gps-position/thompson-springs.jpg`),
        filename: 'gps.jpg',
      },
    });
    await utils.createAsset(admin.accessToken, {
      assetData: {
        bytes: readFileSync(`${testAssetDir}/metadata/rating/mongolels.jpg`),
        filename: 'canon.jpg',
      },
    });
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');

    const [tag] = await utils.upsertTags(admin.accessToken, ['e2e-filter-tag']);
    await utils.tagAssets(admin.accessToken, tag.id, [asset1.id]);
    await updateAsset(
      { id: asset1.id, updateAssetDto: { isFavorite: true } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    // Albums needs BOTH sides — some filed, some not.
    await utils.createAlbum(admin.accessToken, { albumName: '#910 album', assetIds: [video.id] });

    // People: createFace inserts asset_face + face_identity + face_identity_face directly, so it
    // needs no ML — getFilteredPeople's global-scope query only requires a named, non-hidden person
    // with a face on an asset in scope. See e2e/src/utils.ts:490.
    const person = await utils.createPerson(admin.accessToken, { name: '#910 Person' });
    // sourceType: 'manual' — this spec uploads real assets, so detection runs and would delete a
    // machine-learning-sourced seed (see utils.createFace).
    await utils.createFace({ assetId: asset1.id, personGroupId: person.id, sourceType: 'manual' });
  });

  async function gotoPhotos(context: import('@playwright/test').BrowserContext, page: import('@playwright/test').Page) {
    await utils.setAuthCookies(context, admin.accessToken);
    // Clear localStorage so each test starts from a clean state
    await page.goto('/photos');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('[data-testid="filter-toggle-btn"], [data-testid="discovery-panel"]');
  }

  test('should render FilterPanel expanded by default on /photos', async ({ context, page }) => {
    await gotoPhotos(context, page);

    await expect(page.locator('[data-testid="discovery-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-toggle-btn"]')).toHaveCount(0);
  });

  test('should collapse FilterPanel and persist state', async ({ context, page }) => {
    await gotoPhotos(context, page);

    // Panel starts expanded — collapse it. externalToggle mode clips the panel to width 0 and the
    // header exposes the filter-toggle button instead of an inline collapsed strip.
    await page.locator('[data-testid="collapse-panel-btn"]').click();
    await expect(page.locator('[data-testid="filter-toggle-btn"]')).toBeVisible();

    // Reload — should still be collapsed (persisted in localStorage)
    await page.reload();
    await page.waitForSelector('[data-testid="filter-toggle-btn"]');
    await expect(page.locator('[data-testid="filter-toggle-btn"]')).toBeVisible();
  });

  test('should show every filter section its library can populate', async ({ context, page }) => {
    await gotoPhotos(context, page);

    // Panel starts expanded — every section the library populates should be visible. `timeline` and
    // `text` are always available (filter-availability.ts); the rest each need the seed data added
    // in beforeAll above.
    await expect(page.locator('[data-testid="discovery-panel"]')).toBeVisible();

    for (const section of [
      'timeline',
      'people',
      'location',
      'camera',
      'tags',
      'rating',
      'media',
      'favorites',
      'albums',
      'text',
    ]) {
      await expect(page.locator(`[data-testid="filter-section-${section}"]`)).toBeVisible();
    }
  });

  test('should filter by media type and show result count', async ({ context, page }) => {
    await gotoPhotos(context, page);

    // Panel starts expanded — apply image filter and wait for timeline to refetch
    const bucketResponse = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await page.locator('[data-testid="media-type-image"]').click();
    await bucketResponse;

    // Active filters bar should show result count
    const resultCount = page.locator('[data-testid="result-count"]');
    await expect(resultCount).toBeVisible();
    const countText = await resultCount.textContent();
    expect(countText).toMatch(/\d+\s*result/);
  });

  test('should show ActiveFiltersBar and clear all filters', async ({ context, page }) => {
    await gotoPhotos(context, page);

    // Panel starts expanded — wait for filter suggestions to load, then set rating filter
    await page.locator('[data-testid="rating-star-5"]').waitFor({ state: 'visible', timeout: 10_000 });
    const bucketResponse = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await page.locator('[data-testid="rating-star-5"]').click();
    await bucketResponse;

    // Collapse panel — ActiveFiltersBar should be visible
    await page.locator('[data-testid="collapse-panel-btn"]').click();
    await expect(page.locator('[data-testid="active-filters-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="active-chip"]').first()).toBeVisible();

    // Clear all and wait for timeline refetch.
    // The /photos page now renders a `buttons` snippet so the UserPageLayout
    // absolute header covers the top of the content area. Playwright's
    // auto-scroll-into-view lands the ActiveFiltersBar button under the header
    // overlay; dispatchEvent fires the click handler directly.
    const clearResponse = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await page.locator('[data-testid="clear-all-btn"]').dispatchEvent('click');
    await clearResponse;

    // ActiveFiltersBar should disappear, full timeline restored
    await expect(page.locator('[data-testid="active-filters-bar"]')).not.toBeVisible();
  });
});

test.describe('Photos FilterPanel — unavailable sections (#910)', () => {
  let admin: LoginResponseDto;
  let assetId: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Images only, nothing rated, nothing favourited, no albums, no tags, no EXIF.
    const asset = await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2023-08-15T10:00:00.000Z',
      fileModifiedAt: '2023-08-15T10:00:00.000Z',
    });
    assetId = asset.id;
  });

  test('hides the sections that cannot filter anything', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('[data-testid="discovery-panel"]');

    // The positive assertion first: the panel rendered, so the negatives below mean something.
    await expect(page.locator('[data-testid="filter-section-timeline"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-section-text"]')).toBeVisible();

    for (const section of ['media', 'rating', 'favorites', 'albums', 'people', 'location', 'camera', 'tags']) {
      await expect(page.locator(`[data-testid="filter-section-${section}"]`)).toHaveCount(0);
      await expect(page.locator(`[data-testid="section-toggle-${section}"]`)).toHaveCount(0);
    }
  });

  test('shows the favorites section once something is favourited', async ({ context, page }) => {
    await updateAsset(
      { id: assetId, updateAssetDto: { isFavorite: true } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.locator('[data-testid="filter-section-favorites"]')).toBeVisible();
  });

  test('shows the media section once a video exists', async ({ context, page }) => {
    await utils.createAsset(admin.accessToken, { assetData: { filename: 'late-video.mp4' } });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.locator('[data-testid="filter-section-media"]')).toBeVisible();
  });
});
