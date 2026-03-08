import { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('Library Management', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  test('should show empty library list', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/admin/library-management');
    await expect(page.getByText('Create an external library to view your photos and videos')).toBeVisible();
  });

  test('should create a library and see it in the list', async ({ context, page }) => {
    const library = await utils.createLibrary(admin.accessToken, { ownerId: admin.userId });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/admin/library-management');

    // Verify library name appears as a link in the table
    await expect(page.getByRole('link', { name: library.name })).toBeVisible();
  });

  test('should show library detail page', async ({ context, page }) => {
    const library = await utils.createLibrary(admin.accessToken, { ownerId: admin.userId });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/admin/library-management/${library.id}`);

    // Verify the library detail page shows the library name and sections
    await expect(page.getByText(library.name)).toBeVisible();
    await expect(page.getByText('Folders')).toBeVisible();
    await expect(page.getByText('Exclusion pattern')).toBeVisible();
  });

  test('should create a library via UI', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/admin/library-management');

    // Click "Create Library" button in the page header actions
    await page.getByRole('button', { name: 'Create Library' }).click();

    // Submit the form (owner defaults to admin)
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Should redirect to the library detail page
    await expect(page).toHaveURL(/\/admin\/library-management\/[a-f0-9-]+$/);
    await expect(page.getByText('Folders')).toBeVisible();
  });

  test('should delete a library', async ({ context, page }) => {
    const library = await utils.createLibrary(admin.accessToken, { ownerId: admin.userId });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/admin/library-management/${library.id}`);

    // Click Delete button
    await page.getByRole('button', { name: 'Delete' }).click();

    // Confirm deletion dialog
    await page.getByRole('button', { name: 'Confirm' }).click();

    // Should redirect back to library list
    await expect(page).toHaveURL('/admin/library-management');
  });
});
