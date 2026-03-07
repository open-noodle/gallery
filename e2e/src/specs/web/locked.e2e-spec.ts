import { AssetVisibility, LoginResponseDto, updateAssets } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import { asBearerAuth, utils } from 'src/utils';

test.describe('Locked Folder', () => {
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

  test('locked folder page loads', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/locked');

    await expect(page).toHaveURL('/locked');
  });

  test('locked asset appears in locked folder', async ({ context, page }) => {
    const asset = await utils.createAsset(admin.accessToken);
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });

    await updateAssets(
      { assetBulkUpdateDto: { ids: [asset.id], visibility: AssetVisibility.Locked } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/locked');

    await page.locator(`[data-asset-id="${asset.id}"]`).waitFor();
    await expect(page.locator(`[data-asset-id="${asset.id}"]`)).toBeVisible();
  });

  test('locked asset is not visible in timeline', async ({ context, page }) => {
    const asset = await utils.createAsset(admin.accessToken);
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });

    await updateAssets(
      { assetBulkUpdateDto: { ids: [asset.id], visibility: AssetVisibility.Locked } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');

    await expect(page.locator(`[data-asset-id="${asset.id}"]`)).toHaveCount(0);
  });

  test('shows empty state when no locked assets', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/locked');

    await expect(page.getByText(/nothing here yet/i)).toBeVisible();
  });
});
