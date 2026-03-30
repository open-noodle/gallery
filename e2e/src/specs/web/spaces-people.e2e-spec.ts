import type { LoginResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('Spaces People', () => {
  let admin: LoginResponseDto;
  let space: SharedSpaceResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Create a space with an asset
    space = await utils.createSpace(admin.accessToken, { name: 'People Test Space' });
    const asset = await utils.createAsset(admin.accessToken);
    await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

    // Insert a space person with full face chain (required by server query JOINs)
    await utils.createSpacePerson(space.id, 'Alice', admin.userId, asset.id);
  });

  async function gotoSpacePeople(
    context: import('@playwright/test').BrowserContext,
    page: import('@playwright/test').Page,
  ) {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/spaces/${space.id}/people`);
    await page.waitForSelector('[role="group"]');
  }

  test('should hide person from context menu', async ({ context, page }) => {
    await gotoSpacePeople(context, page);

    // Verify person is visible
    const personCard = page.locator('[role="group"]').first();
    await expect(personCard).toBeVisible();

    // Hover to reveal context menu (dispatchEvent ensures mouseenter fires in headless)
    await personCard.hover();
    await personCard.dispatchEvent('mouseenter');

    // Wait for and click three-dot menu
    const menuButton = page.getByTitle('Show person options');
    await expect(menuButton).toBeVisible({ timeout: 5000 });
    await menuButton.click();

    // Click "Hide person"
    await page.getByText('Hide person').click();

    // Verify person disappears and empty state shows
    await expect(page.getByText('No people')).toBeVisible();
  });
});
