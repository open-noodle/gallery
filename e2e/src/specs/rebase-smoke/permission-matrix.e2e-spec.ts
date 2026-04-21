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

  // Tests 4–10 added in subsequent commits.
});
