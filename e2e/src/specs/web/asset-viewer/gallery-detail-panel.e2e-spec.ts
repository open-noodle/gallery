import { LoginResponseDto, updateAsset } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Socket } from 'socket.io-client';
import { asBearerAuth, testAssetDir, utils } from 'src/utils.js';

// Gallery's real-server detail panel check; upstream's detail panel tests moved to web/test/medium (immich-32879).
test.describe('Detail Panel (Gallery)', () => {
  let admin: LoginResponseDto;
  let websocket: Socket;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    websocket = await utils.connectWebsocket(admin.accessToken);
  });

  test.afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });

  test('renders all panel sections simultaneously for a fully-tagged photo', async ({ context, page }) => {
    // prairie_falcon.jpg has full camera EXIF (Canon EOS R5, ISO, exposure, fNumber, focal length)
    // but no GPS — we set coordinates manually so the location section also renders.
    const imagePath = `${testAssetDir}/albums/nature/prairie_falcon.jpg`;
    const fullyTaggedAsset = await utils.createAsset(admin.accessToken, {
      assetData: { bytes: readFileSync(imagePath), filename: 'prairie_falcon.jpg' },
    });

    // Drain so EXIF + thumbnail land before mutations and assertions.
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
    await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');

    // Apply location (reverse-geocodes to country/city), rating, and tag so those sections render.
    await updateAsset(
      {
        id: fullyTaggedAsset.id,
        updateAssetDto: { latitude: 48.85341, longitude: 2.3488, rating: 5 },
      },
      { headers: asBearerAuth(admin.accessToken) },
    );
    const tags = await utils.upsertTags(admin.accessToken, ['rebase-smoke']);
    await utils.tagAssets(admin.accessToken, tags[0].id, [fullyTaggedAsset.id]);

    // updateAsset enqueues sidecar-write jobs which re-run metadata extraction —
    // drain again so EXIF (including the just-set rating) is populated before the viewer renders.
    await utils.waitForQueueFinish(admin.accessToken, 'sidecar');
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');

    // Ratings + tags sections are gated by preferences — enable both for admin.
    await utils.updateMyPreferences(admin.accessToken, {
      ratings: { enabled: true },
      tags: { enabled: true },
    });

    // Open the viewer + detail panel using the existing spec's keyboard pattern.
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/photos/${fullyTaggedAsset.id}`);
    await page.waitForSelector('#immich-asset-viewer');
    await page.keyboard.press('i');
    await expect(page.locator('#detail-panel')).toBeVisible();

    // All 7 section testids must be visible together.
    for (const testid of [
      'detail-panel-edit-date-button',
      'detail-panel-filename',
      'detail-panel-camera',
      'detail-panel-lens',
      'detail-panel-location',
      'detail-panel-rating',
      'detail-panel-tags',
    ]) {
      await expect(page.locator(`[data-testid="${testid}"]`)).toBeVisible({ timeout: 5000 });
    }
  });
});
