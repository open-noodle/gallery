import { AssetVisibility, LoginResponseDto, updateAssets } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import { asBearerAuth, utils } from 'src/utils';

test.describe('Trash', () => {
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

  test('trash page loads', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/trash');

    await expect(page).toHaveURL('/trash');
  });

  test('trashed asset appears on trash page', async ({ context, page }) => {
    const asset = await utils.createAsset(admin.accessToken);
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });

    // Trash the asset via API
    await updateAssets(
      { assetBulkUpdateDto: { ids: [asset.id], visibility: AssetVisibility.Trash } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/trash');

    await page.locator(`[data-asset-id="${asset.id}"]`).waitFor();
    await expect(page.locator(`[data-asset-id="${asset.id}"]`)).toBeVisible();
  });

  test('trashed asset is not visible in timeline', async ({ context, page }) => {
    const asset = await utils.createAsset(admin.accessToken);
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });

    await updateAssets(
      { assetBulkUpdateDto: { ids: [asset.id], visibility: AssetVisibility.Trash } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');

    await expect(page.locator(`[data-asset-id="${asset.id}"]`)).toHaveCount(0);
  });
});
