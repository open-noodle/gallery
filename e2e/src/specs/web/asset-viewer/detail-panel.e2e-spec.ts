import { AssetMediaResponseDto, LoginResponseDto, SharedLinkType, updateAsset } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Socket } from 'socket.io-client';
import { asBearerAuth, testAssetDir, utils } from 'src/utils';

test.describe('Detail Panel', () => {
  let admin: LoginResponseDto;
  let asset: AssetMediaResponseDto;
  let websocket: Socket;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    asset = await utils.createAsset(admin.accessToken);
    websocket = await utils.connectWebsocket(admin.accessToken);
  });

  test.afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });

  test('can be opened for shared links', async ({ page }) => {
    const sharedLink = await utils.createSharedLink(admin.accessToken, {
      type: SharedLinkType.Individual,
      assetIds: [asset.id],
    });
    await page.goto(`/share/${sharedLink.key}/photos/${asset.id}`);
    await page.waitForSelector('#immich-asset-viewer');

    await expect(page.getByRole('button', { name: 'Info' })).toBeVisible();
    await page.keyboard.press('i');
    await expect(page.locator('#detail-panel')).toBeVisible();
    await page.keyboard.press('i');
    await expect(page.locator('#detail-panel')).toHaveCount(0);
  });

  test('cannot be opened for shared links with hidden metadata', async ({ page }) => {
    const sharedLink = await utils.createSharedLink(admin.accessToken, {
      type: SharedLinkType.Individual,
      assetIds: [asset.id],
      showMetadata: false,
    });
    await page.goto(`/share/${sharedLink.key}/photos/${asset.id}`);
    await page.waitForSelector('#immich-asset-viewer');

    await expect(page.getByRole('button', { name: 'Info' })).toHaveCount(0);
    await page.keyboard.press('i');
    await expect(page.locator('#detail-panel')).toHaveCount(0);
    await page.keyboard.press('i');
    await expect(page.locator('#detail-panel')).toHaveCount(0);
  });

  test('description is visible for owner on shared links', async ({ context, page }) => {
    const sharedLink = await utils.createSharedLink(admin.accessToken, {
      type: SharedLinkType.Individual,
      assetIds: [asset.id],
    });
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/share/${sharedLink.key}/photos/${asset.id}`);

    const textarea = page.getByRole('textbox', { name: 'Add a description' });
    await page.getByRole('button', { name: 'Info' }).click();
    await expect(textarea).toBeVisible();
    await expect(textarea).not.toBeDisabled();
  });

  test('description changes are visible after reopening', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/photos/${asset.id}`);
    await page.waitForSelector('#immich-asset-viewer');

    await page.getByRole('button', { name: 'Info' }).click();
    const textarea = page.getByRole('textbox', { name: 'Add a description' });
    await textarea.fill('new description');
    await expect(textarea).toHaveValue('new description');

    await page.getByRole('button', { name: 'Info' }).click();
    await expect(textarea).not.toBeVisible();
    await page.getByRole('button', { name: 'Info' }).click();
    await expect(textarea).toBeVisible();

    await utils.waitForWebsocketEvent({ event: 'assetUpdate', id: asset.id });
    await expect(textarea).toHaveValue('new description');
  });

  test.describe('Date editor', () => {
    test('displays inferred asset timezone', async ({ context, page }) => {
      const test = {
        filepath: 'metadata/dates/datetimeoriginal-gps.jpg',
        expected: {
          dateTime: '2025-12-01T11:30',
          // Test with a timezone which is NOT the first among timezones with the same offset
          // This is to check that the editor does not simply fall back to the first available timezone with that offset
          // America/Denver (-07:00) is not the first among timezones with offset -07:00
          timeZoneWithOffset: 'America/Denver (-07:00)',
        },
      };

      const asset = await utils.createAsset(admin.accessToken, {
        assetData: {
          bytes: await readFile(join(testAssetDir, test.filepath)),
          filename: basename(test.filepath),
        },
      });

      await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });

      // asset viewer -> detail panel -> date editor
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/photos/${asset.id}`);
      await page.waitForSelector('#immich-asset-viewer');

      await page.getByRole('button', { name: 'Info' }).click();
      await page.getByTestId('detail-panel-edit-date-button').click();
      await page.waitForSelector('[role="dialog"]');

      const datetime = page.locator('#datetime');
      await expect(datetime).toHaveValue(test.expected.dateTime);
      const timezone = page.getByRole('combobox', { name: 'Timezone' });
      await expect(timezone).toHaveValue(test.expected.timeZoneWithOffset);
    });
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
        updateAssetDto: { latitude: 48.853_41, longitude: 2.3488, rating: 5 },
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
