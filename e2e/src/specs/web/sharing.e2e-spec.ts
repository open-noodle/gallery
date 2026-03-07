import { LoginResponseDto, SharedLinkType, createAlbum } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import { createUserDto } from 'src/fixtures';
import { asBearerAuth, utils } from 'src/utils';

test.describe('Sharing', () => {
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

  test('sharing page loads', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/sharing');

    await expect(page).toHaveURL('/sharing');
  });

  test('shows no shared albums message when empty', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/sharing');

    await expect(page.getByText(/no shared albums/i)).toBeVisible();
  });

  test('partner appears on sharing page', async ({ context, page }) => {
    const user = await utils.userSetup(admin.accessToken, createUserDto.user1);
    await utils.createPartner(admin.accessToken, user.userId);

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/sharing');

    await page.getByText(createUserDto.user1.name).waitFor();
    await expect(page.getByText(createUserDto.user1.name)).toBeVisible();
  });

  test('shared links page shows empty state', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/shared-links');

    await expect(page.getByText(/you don.t have any shared links/i)).toBeVisible();
  });

  test('shared link appears in shared links list', async ({ context, page }) => {
    const asset = await utils.createAsset(admin.accessToken);
    await utils.waitForWebsocketEvent({ event: 'assetUpload', id: asset.id });

    const album = await createAlbum(
      { createAlbumDto: { albumName: 'Shared Album', assetIds: [asset.id] } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    await utils.createSharedLink(admin.accessToken, {
      type: SharedLinkType.Album,
      albumId: album.id,
    });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/shared-links');

    await page.getByText('Shared Album').waitFor();
    await expect(page.getByText('Shared Album')).toBeVisible();
  });
});
