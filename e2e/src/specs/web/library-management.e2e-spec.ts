import { LoginResponseDto, getAllLibraries } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, testAssetDir, testAssetDirInternal, utils } from 'src/utils';

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

  test('should create a new library via UI', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/admin/library-management');

    // Click "Create Library" button in the page header actions
    await page.getByRole('button', { name: 'Create Library' }).click();
    await expect(page).toHaveURL(/\/admin\/library-management\/new/);

    // Submit the form (owner defaults to admin)
    await page.getByRole('button', { name: 'Create' }).click();

    // Should redirect to the library detail page
    await expect(page).toHaveURL(/\/admin\/library-management\/[a-f0-9-]+$/);

    // Verify the library detail page shows folder and exclusion pattern sections
    await expect(page.getByText('Folders')).toBeVisible();
    await expect(page.getByText('Exclusion pattern')).toBeVisible();
  });

  test('should add an import path to a library', async ({ context, page }) => {
    const library = await utils.createLibrary(admin.accessToken, { ownerId: admin.userId });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/admin/library-management/${library.id}`);

    await expect(page.getByText('Folders')).toBeVisible();

    // Click the "Add" button in the Folders card header (first Add button on the page)
    await page.getByRole('button', { name: 'Add' }).first().click();

    // Fill in the import path in the modal
    await page.getByLabel('Path').fill(`${testAssetDirInternal}/temp`);

    // Click the "Add" submit button in the modal dialog
    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'Add' }).click();

    // Verify the folder appears in the list
    await expect(page.getByText(`${testAssetDirInternal}/temp`)).toBeVisible();
  });

  test('should rename a library', async ({ context, page }) => {
    const library = await utils.createLibrary(admin.accessToken, { ownerId: admin.userId });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/admin/library-management/${library.id}`);

    // Click "Edit" button in the page header actions
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page).toHaveURL(/\/edit$/);

    // Change the name
    const nameInput = page.getByLabel('Name');
    await nameInput.clear();
    await nameInput.fill('Renamed Library');
    await page.getByRole('button', { name: 'Save' }).click();

    // Should redirect back to library detail
    await expect(page).toHaveURL(/\/admin\/library-management\/[a-f0-9-]+$/);
    await expect(page.getByText('Renamed Library')).toBeVisible();
  });

  test('should scan a library and import assets', async ({ context, page }) => {
    // Create a library with an import path pointing to test assets
    const library = await utils.createLibrary(admin.accessToken, { ownerId: admin.userId });
    await utils.updateLibrary(admin.accessToken, library.id, {
      importPaths: [`${testAssetDirInternal}/temp`],
    });

    // Create test image files on the host (mapped to /test-assets in container)
    utils.createImageFile(`${testAssetDir}/temp/scan-test/photo1.png`);

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/admin/library-management/${library.id}`);

    // Click Scan button (i18n key "scan_library" renders as "Scan")
    await page.getByRole('button', { name: 'Scan' }).click();

    // Wait for scan to complete via API
    await utils.waitForQueueFinish(admin.accessToken, 'library');
    await utils.waitForQueueFinish(admin.accessToken, 'sidecar');
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');

    // Verify asset was imported by checking the API
    const libraries = await getAllLibraries({ headers: asBearerAuth(admin.accessToken) });
    const updatedLibrary = libraries.find((l) => l.id === library.id);
    expect(updatedLibrary?.assetCount).toBeGreaterThan(0);
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

  test('should show library in the list after creation', async ({ context, page }) => {
    // Reset to ensure clean state
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    const library = await utils.createLibrary(admin.accessToken, { ownerId: admin.userId });

    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/admin/library-management');

    // Verify library name appears in the table
    await expect(page.getByRole('link', { name: library.name })).toBeVisible();

    // Verify owner name appears
    await expect(page.getByRole('link', { name: admin.name })).toBeVisible();
  });
});
