import { AssetMediaResponseDto, LoginResponseDto, getConfig, updateAsset, updateConfig } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { asBearerAuth, testAssetDir, utils } from 'src/utils';

// Regression test for the stale/unreactive asset viewer on reopen (reported against v5.1.0):
// open a photo with tagged people, go back to the timeline, open a photo without people —
// the detail panel kept showing the previous photo's people, and the map/tags sections and
// full-resolution image never loaded until a manual page refresh. Root cause was a Svelte
// batch-scheduler edge (see patches/svelte@5.56.3.patch) that left the remounted viewer
// subtree permanently unreactive.
test.describe('asset viewer reopen', () => {
  let admin: LoginResponseDto;
  let assetWithPerson: AssetMediaResponseDto;
  let assetWithLocation: AssetMediaResponseDto;

  const waitForThumbnail = async (id: string) => {
    await expect
      .poll(async () => {
        const asset = await utils.getAssetInfo(admin.accessToken, id);
        return asset.thumbhash;
      })
      .not.toBeNull();
  };

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // A freshly booted server runs its version check within seconds of the reset and pops the
    // "new version available" dialog, which swallows clicks on the timeline. Turn it off.
    const config = await getConfig({ headers: asBearerAuth(admin.accessToken) });
    await updateConfig(
      { systemConfigDto: { ...config, newVersionCheck: { ...config.newVersionCheck, enabled: false } } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    assetWithPerson = await utils.createAsset(admin.accessToken, {
      assetData: {
        bytes: readFileSync(`${testAssetDir}/albums/nature/tanners_ridge.jpg`),
        filename: 'tanners_ridge.jpg',
      },
    });
    assetWithLocation = await utils.createAsset(admin.accessToken, {
      assetData: {
        bytes: readFileSync(`${testAssetDir}/albums/nature/prairie_falcon.jpg`),
        filename: 'prairie_falcon.jpg',
      },
    });

    // wait for thumbnails so both assets are rendered in the timeline grid
    await waitForThumbnail(assetWithPerson.id);
    await waitForThumbnail(assetWithLocation.id);

    const person = await utils.createPerson(admin.accessToken, { name: 'Stale Carryover Person' });
    await utils.createFace({ assetId: assetWithPerson.id, personId: person.id });

    await updateAsset(
      { id: assetWithLocation.id, updateAssetDto: { latitude: 48.853_41, longitude: 2.3488 } },
      { headers: asBearerAuth(admin.accessToken) },
    );
    const tags = await utils.upsertTags(admin.accessToken, ['reopen-tag']);
    await utils.tagAssets(admin.accessToken, tags[0].id, [assetWithLocation.id]);
    await utils.updateMyPreferences(admin.accessToken, { tags: { enabled: true } });
  });

  test('reopening the viewer shows the new asset, not the previous one', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    await page.waitForSelector('[data-thumbnail-focus-container]');

    // open the asset with a tagged person and confirm the person renders
    await page.locator(`[data-thumbnail-focus-container][data-asset="${assetWithPerson.id}"]`).click();
    await page.waitForSelector('#immich-asset-viewer');
    await page.keyboard.press('i');
    await expect(page.locator('#detail-panel')).toContainText('Stale Carryover Person');

    // go back to the timeline
    await page.goBack();
    await page.waitForSelector('[data-thumbnail-focus-container]');
    await expect(page.locator('#immich-asset-viewer')).toHaveCount(0);

    // reopen the viewer on the asset without people
    await page.locator(`[data-thumbnail-focus-container][data-asset="${assetWithLocation.id}"]`).click();
    await page.waitForSelector('#immich-asset-viewer');
    await expect(page.locator('#detail-panel')).toBeVisible();

    // people must clear, and the location map + tags of the new asset must render —
    // all three stayed stale/missing until a manual refresh before the fix
    await expect(page.locator('#detail-panel')).not.toContainText('Stale Carryover Person');
    await expect(page.locator('#detail-panel .maplibregl-map')).toBeVisible();
    await expect(page.locator('[data-testid="detail-panel-tags"]')).toContainText('reopen-tag');
  });

  test('arrow navigation between assets updates the detail panel', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    await page.waitForSelector('[data-thumbnail-focus-container]');

    await page.locator(`[data-thumbnail-focus-container][data-asset="${assetWithPerson.id}"]`).click();
    await page.waitForSelector('#immich-asset-viewer');
    await page.keyboard.press('i');
    await expect(page.locator('#detail-panel')).toContainText('Stale Carryover Person');

    // navigate to the older asset inside the viewer
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(new RegExp(assetWithLocation.id));

    await expect(page.locator('#detail-panel')).not.toContainText('Stale Carryover Person');
    await expect(page.locator('#detail-panel .maplibregl-map')).toBeVisible();
  });
});
