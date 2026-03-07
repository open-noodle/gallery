import { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import type { Socket } from 'socket.io-client';
import { utils } from 'src/utils';

test.describe('People', () => {
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

  test('people page loads', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/people');

    await expect(page).toHaveURL('/people');
  });

  test('shows empty state when no people detected', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/people');

    await expect(page.getByText(/no people/i)).toBeVisible();
  });

  test('person created via API appears on people page', async ({ context, page }) => {
    await utils.createPerson(admin.accessToken, { name: 'Test Person' });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/people');

    await page.getByText('Test Person').waitFor();
    await expect(page.getByText('Test Person')).toBeVisible();
  });

  test('clicking a person navigates to their detail page', async ({ context, page }) => {
    const person = await utils.createPerson(admin.accessToken, { name: 'Detail Person' });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/people');

    await page.getByText('Detail Person').waitFor();
    await page.getByText('Detail Person').click();

    await expect(page).toHaveURL(new RegExp(`/people/${person.id}`));
  });

  test('show and hide people visibility button exists', async ({ context, page }) => {
    await utils.createPerson(admin.accessToken, { name: 'Visible Person' });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/people');

    await expect(page.getByText(/show & hide people/i)).toBeVisible();
  });
});
