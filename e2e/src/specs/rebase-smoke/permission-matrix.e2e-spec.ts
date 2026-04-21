import {
  AssetMediaResponseDto,
  LoginResponseDto,
  SharedSpaceResponseDto,
  SharedSpaceRole,
  updateAsset,
} from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { asBearerAuth, testAssetDir, utils } from 'src/utils';

test.describe('Rebase Smoke — UI Permission Matrix', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let stranger: LoginResponseDto;
  let space: SharedSpaceResponseDto;
  let asset: AssetMediaResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    owner = await utils.userSetup(admin.accessToken, { email: 'owner@t.com', password: 'p', name: 'Owner' });
    editor = await utils.userSetup(admin.accessToken, { email: 'editor@t.com', password: 'p', name: 'Editor' });
    viewer = await utils.userSetup(admin.accessToken, { email: 'viewer@t.com', password: 'p', name: 'Viewer' });
    stranger = await utils.userSetup(admin.accessToken, {
      email: 'stranger@t.com',
      password: 'p',
      name: 'Stranger',
    });

    space = await utils.createSpace(owner.accessToken, { name: 'Perms Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: editor.userId,
      role: SharedSpaceRole.Editor,
    });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: viewer.userId,
      role: SharedSpaceRole.Viewer,
    });
    // Default showInTimeline=true — do NOT override; tests 9/10 rely on it.

    // Use prairie_falcon.jpg (full EXIF, no GPS); set lat/lon via updateAsset so
    // reverse-geocoding populates city/country. See Phase B for precedent.
    const imagePath = `${testAssetDir}/albums/nature/prairie_falcon.jpg`;
    asset = await utils.createAsset(owner.accessToken, {
      assetData: { bytes: readFileSync(imagePath), filename: 'rebase-smoke.jpg' },
    });
    await updateAsset(
      { id: asset.id, updateAssetDto: { latitude: 48.853_41, longitude: 2.3488, rating: 5 } },
      { headers: asBearerAuth(owner.accessToken) },
    );
    const tags = await utils.upsertTags(owner.accessToken, ['rebase-smoke']);
    await utils.tagAssets(owner.accessToken, tags[0].id, [asset.id]);
    await utils.addSpaceAssets(owner.accessToken, space.id, [asset.id]);

    // Enable ratings + tags preferences for all three roles (detail-panel gates them).
    // tags.enabled gates <DetailPanelTags>; ratings.enabled gates the rating row.
    for (const role of [owner, editor, viewer]) {
      await utils.updateMyPreferences(role.accessToken, {
        ratings: { enabled: true },
        tags: { enabled: true },
      });
    }

    // Drain queues with ADMIN token (waitForQueueFinish requires admin per
    // feedback_e2e_admin_only_queues).
    await utils.waitForQueueFinish(admin.accessToken, 'sidecar');
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
    await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');
    await utils.waitForQueueFinish(admin.accessToken, 'facialRecognition');

    // Pre-flight: verify geocoding populated city. If not, Tests 9/10 (in later dispatch)
    // will skip.
    const fullAsset = await utils.getAssetInfo(owner.accessToken, asset.id);
    if (!fullAsset.exifInfo?.city) {
      console.warn('[rebase-smoke] Reverse-geocoding produced no city; tests 9/10 will skip.');
    }
  });

  test('Test 1 — owner: role badge Owner, add-photos visible, delete menu option present', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/spaces/${space.id}`);
    await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('Owner');
    await expect(page.getByLabel('Add photos')).toBeVisible();
    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menuitem', { name: /delete/i })).toBeVisible();
  });

  test('Test 2 — editor: role badge Editor, add-photos visible, delete menu option absent', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, editor.accessToken);
    await page.goto(`/spaces/${space.id}`);
    await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('Editor');
    await expect(page.getByLabel('Add photos')).toBeVisible();
    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menuitem', { name: /delete/i })).toHaveCount(0);
  });

  test('Test 3 — viewer: role badge Viewer, add-photos NOT visible', async ({ context, page }) => {
    await utils.setAuthCookies(context, viewer.accessToken);
    await page.goto(`/spaces/${space.id}`);
    await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('Viewer');
    await expect(page.getByLabel('Add photos')).toHaveCount(0);
  });

  test('Test 4 — owner detail panel: edit controls visible, file path visible', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/spaces/${space.id}/photos/${asset.id}`);
    await page.waitForSelector('#immich-asset-viewer');
    await page.keyboard.press('i');
    await expect(page.locator('#detail-panel')).toBeVisible();
    await expect(page.locator('[data-testid="detail-panel-edit-date-button"]')).toBeVisible();
    // Owner-only: the "Show file location" IconButton is visible inside the filename section.
    // aria-label is $t('show_file_location') = "Show file location" per i18n/en.json:2478.
    await expect(page.getByLabel('Show file location')).toBeVisible();
    await page.getByLabel('Show file location').click();
    await expect(page.locator('[data-testid="detail-panel-filename"]')).toContainText('rebase-smoke.jpg');
  });

  test('Test 5 — editor detail panel: edit controls hidden, file path hidden', async ({ context, page }) => {
    await utils.setAuthCookies(context, editor.accessToken);
    await page.goto(`/spaces/${space.id}/photos/${asset.id}`);
    await page.waitForSelector('#immich-asset-viewer');
    await page.keyboard.press('i');
    await expect(page.locator('#detail-panel')).toBeVisible();
    // The edit-date button is always rendered, but for non-owners the click handler is a no-op,
    // the pencil indicator is omitted, and the title attribute is empty. Assert on the title
    // (locale-proof via empty string) as the owner-only gate.
    await expect(page.locator('[data-testid="detail-panel-edit-date-button"]')).toHaveAttribute('title', '');
    await expect(page.getByLabel('Show file location')).toHaveCount(0);
  });

  test('Test 6 — viewer detail panel: edit controls hidden, file path hidden', async ({ context, page }) => {
    await utils.setAuthCookies(context, viewer.accessToken);
    await page.goto(`/spaces/${space.id}/photos/${asset.id}`);
    await page.waitForSelector('#immich-asset-viewer');
    await page.keyboard.press('i');
    await expect(page.locator('#detail-panel')).toBeVisible();
    // Viewer has same UI gating as editor for these owner-only controls.
    await expect(page.locator('[data-testid="detail-panel-edit-date-button"]')).toHaveAttribute('title', '');
    await expect(page.getByLabel('Show file location')).toHaveCount(0);
  });

  test('Test 7 — stranger: blocked on /spaces/:id direct URL', async ({ context, page }) => {
    await utils.setAuthCookies(context, stranger.accessToken);
    const response = await page.goto(`/spaces/${space.id}`);
    await page.waitForLoadState('networkidle');
    const is403 = response?.status() === 403;
    const redirectedAway = !page.url().includes(`/spaces/${space.id}`);
    // SvelteKit returns 200 for the shell and renders the error page client-side when the
    // page load throws. The fork's service returns 403 "Not a member of this space", which
    // surfaces in the error page body as "HTTP 403" plus the message text.
    const blockedText = await page
      .locator('text=/access denied|not found|no access|not a member|http 403/i')
      .first()
      .isVisible()
      .catch(() => false);
    expect(is403 || redirectedAway || blockedText).toBeTruthy();
  });

  test('Test 8 — owner nav bar: top-level actions visible, Archive reachable via More menu', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/photos/${asset.id}`);
    await page.waitForSelector('#immich-asset-viewer');

    // Top-level ActionButton accessible names (verified against i18n/en.json):
    //   Actions.Share    → "Share"
    //   Actions.Favorite → "Favorite"     (initial state; becomes "Unfavorite" once toggled)
    //   Actions.Edit     → "Editor"       (NOT "Edit" — i18n key is $t('editor'))
    //   DeleteAction     → "Delete"
    for (const label of ['Share', 'Favorite', 'Editor', 'Delete']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }

    // Archive nested inside the overflow context menu.
    await page.getByRole('button', { name: /more/i }).click();
    await expect(page.getByRole('menuitem', { name: /archive/i })).toBeVisible();
  });

  test('Test 9 — viewer /photos filter panel includes Location / Camera / Tags from space', async ({
    context,
    page,
  }) => {
    // Pattern: `test.skip(condition, reason)` is Playwright's conditional-skip form. No
    // prior use in this repo — verified valid against Playwright docs. If the geocoded
    // country is missing (stale tile data, etc.), the test is skipped rather than flaked.
    const fullAsset = await utils.getAssetInfo(owner.accessToken, asset.id);
    test.skip(!fullAsset.exifInfo?.country, 'Reverse-geocoding produced no country; skipping');

    await utils.setAuthCookies(context, viewer.accessToken);
    const suggestionsResponse = page.waitForResponse(
      (r) => r.url().includes('/search/suggestions/filters') && r.ok(),
      { timeout: 15_000 },
    );
    await page.goto('/photos');
    await suggestionsResponse;

    // FilterPanel is open by default on /photos. Wait for all 3 sections to mount.
    await page.locator('[data-testid="filter-section-location"]').waitFor({ timeout: 10_000 });
    await page.locator('[data-testid="filter-section-camera"]').waitFor({ timeout: 10_000 });
    await page.locator('[data-testid="filter-section-tags"]').waitFor({ timeout: 10_000 });

    // Tags: the owner's "rebase-smoke" tag must appear.
    await expect(page.locator('[data-testid="filter-section-tags"]').getByText(/rebase-smoke/i)).toBeVisible({
      timeout: 10_000,
    });

    // Location: the geocoded country must appear. The location filter renders country-level
    // chips by default (city-level visible only after expanding the country). Use country
    // for a robust smoke check — presence proves the space asset's EXIF flowed into the
    // viewer's /photos filter panel.
    const country = fullAsset.exifInfo!.country!;
    await expect(page.locator('[data-testid="filter-section-location"]').getByText(country)).toBeVisible({
      timeout: 10_000,
    });

    // Camera: if make is populated, assert it.
    if (fullAsset.exifInfo?.make) {
      await expect(
        page.locator('[data-testid="filter-section-camera"]').getByText(fullAsset.exifInfo.make),
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  // Test 10 added in subsequent commit.
});
