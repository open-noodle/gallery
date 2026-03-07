import { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import { utils } from 'src/utils';

test.describe('Favorites', () => {
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

  test('shows empty state when no favorites', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/favorites');

    await expect(page).toHaveURL('/favorites');
  });

  test('favorited asset appears on favorites page', async ({ context, page }) => {
    const asset = await utils.createAsset(admin.accessToken, { isFavorite: true });
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/favorites');

    await page.locator(`[data-asset-id="${asset.id}"]`).waitFor();
    await expect(page.locator(`[data-asset-id="${asset.id}"]`)).toBeVisible();
  });

  test('non-favorited asset does not appear on favorites page', async ({ context, page }) => {
    const asset = await utils.createAsset(admin.accessToken, { isFavorite: false });
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/favorites');

    await expect(page.locator(`[data-asset-id="${asset.id}"]`)).toHaveCount(0);
  });
});
