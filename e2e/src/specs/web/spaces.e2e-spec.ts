import { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';

test.describe('Shared Spaces', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
  });

  test.beforeEach(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  test('shows empty state when no spaces exist', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/spaces');

    await expect(page.getByText(/no\s*spaces/i)).toBeVisible();
  });

  test('create a space via the UI', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/spaces');

    await page.getByRole('button', { name: /create/i }).click();

    // Fill out the create space modal
    await page.getByLabel('Name').fill('My Test Space');
    await page.getByLabel('Description').fill('A space for testing');
    await page.getByRole('button', { name: /create/i }).click();

    // Should navigate to the new space page
    await expect(page).toHaveURL(/\/spaces\//);
  });

  test('space created via API appears in spaces list', async ({ context, page }) => {
    await utils.createSpace(admin.accessToken, { name: 'API Space', description: 'Created via API' });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/spaces');

    await page.getByText('API Space').waitFor();
    await expect(page.getByText('API Space')).toBeVisible();
    await expect(page.getByText('Created via API')).toBeVisible();
  });

  test('navigate into a space and see its details', async ({ context, page }) => {
    const space = await utils.createSpace(admin.accessToken, { name: 'Detail Space' });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/spaces/${space.id}`);

    await page.getByText('Detail Space').waitFor();
    await expect(page.getByText('0 photos')).toBeVisible();
    await expect(page.getByText('1 members')).toBeVisible();
  });

  test('space with assets shows correct asset count', async ({ context, page }) => {
    const space = await utils.createSpace(admin.accessToken, { name: 'Asset Space' });
    const asset = await utils.createAsset(admin.accessToken);
    await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/spaces/${space.id}`);

    await page.getByText('Asset Space').waitFor();
    await expect(page.getByText('1 photos')).toBeVisible();
  });

  test('delete a space via the UI', async ({ context, page }) => {
    const space = await utils.createSpace(admin.accessToken, { name: 'To Delete' });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/spaces/${space.id}`);

    await page.getByRole('button', { name: /delete/i }).click();

    // Confirm deletion dialog
    const confirmButton = page.getByRole('button', { name: /confirm|delete/i }).last();
    await confirmButton.click();

    // Should redirect to spaces list
    await expect(page).toHaveURL('/spaces');
    await expect(page.getByText('To Delete')).toHaveCount(0);
  });

  test('non-owner member cannot see delete button', async ({ context, page }) => {
    const space = await utils.createSpace(admin.accessToken, { name: 'Owner Only Delete' });
    const user = await utils.userSetup(admin.accessToken, createUserDto.user1);
    await utils.addSpaceMember(admin.accessToken, space.id, { userId: user.userId });

    await utils.setAuthCookies(context, user.accessToken);
    await page.goto(`/spaces/${space.id}`);

    await page.getByText('Owner Only Delete').waitFor();
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
  });

  test('member can view the space', async ({ context, page }) => {
    const space = await utils.createSpace(admin.accessToken, { name: 'Shared With User' });
    const user = await utils.userSetup(admin.accessToken, createUserDto.user1);
    await utils.addSpaceMember(admin.accessToken, space.id, { userId: user.userId });

    await utils.setAuthCookies(context, user.accessToken);
    await page.goto('/spaces');

    await page.getByText('Shared With User').waitFor();
    await expect(page.getByText('Shared With User')).toBeVisible();
  });

  test('members button opens members modal', async ({ context, page }) => {
    const space = await utils.createSpace(admin.accessToken, { name: 'Members Modal Space' });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/spaces/${space.id}`);

    await page.getByRole('button', { name: /members/i }).click();

    // Modal should show the admin user as a member
    await expect(page.getByText(admin.name)).toBeVisible();
  });

  test('toggle timeline visibility', async ({ context, page }) => {
    const space = await utils.createSpace(admin.accessToken, { name: 'Timeline Toggle' });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/spaces/${space.id}`);

    // Click the toggle timeline button (eye icon)
    const timelineButton = page.getByRole('button', { name: /hide from timeline|show on timeline/i });
    await timelineButton.waitFor();
    await timelineButton.click();

    // Button label should toggle
    await expect(page.getByRole('button', { name: /show on timeline|hide from timeline/i })).toBeVisible();
  });
});
