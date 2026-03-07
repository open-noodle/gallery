import { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import { utils } from 'src/utils';

test.describe('Tags', () => {
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

  test('tags page loads', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/tags');

    await expect(page).toHaveURL('/tags');
  });

  test('tagged asset is accessible from tags page', async ({ context, page }) => {
    const asset = await utils.createAsset(admin.accessToken);
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });

    const tags = await utils.upsertTags(admin.accessToken, ['test-tag']);
    await utils.tagAssets(admin.accessToken, tags[0].id, [asset.id]);

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/tags');

    await page.getByText('test-tag').waitFor();
    await expect(page.getByText('test-tag')).toBeVisible();
  });
});
