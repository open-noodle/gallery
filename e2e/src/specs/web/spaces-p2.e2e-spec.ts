import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('Spaces P2', () => {
  let admin: LoginResponseDto;
  let user2: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    user2 = await utils.userSetup(admin.accessToken, {
      email: 'user2@immich.cloud',
      name: 'User Two',
      password: 'password',
    });
  });

  test.describe('Activity Recency Badge', () => {
    test('should show activity badge when new assets added since last view', async ({ context, page }) => {
      // Create space, view it (sets lastViewedAt), then add asset after viewing
      const space = await utils.createSpace(admin.accessToken, { name: 'Badge Test' });
      await utils.markSpaceViewed(admin.accessToken, space.id);
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto('/spaces');
      await expect(page.locator('[data-testid="activity-dot"]')).toBeVisible();
      await expect(page.locator('[data-testid="activity-line"]')).toBeVisible();
    });

    test('should not show badge when no new activity', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'No Badge Test' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);
      // View after adding — clears badge
      await utils.markSpaceViewed(admin.accessToken, space.id);

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto('/spaces');
      const card = page.locator('[data-testid="space-card"]', { has: page.locator('text=No Badge Test') });
      await expect(card.locator('[data-testid="activity-dot"]')).not.toBeVisible();
    });

    test('should clear badge after visiting space', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Clear Badge' });
      await utils.markSpaceViewed(admin.accessToken, space.id);
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto('/spaces');
      // Verify badge is visible before visiting
      const card = page.locator('[data-testid="space-card"]', { has: page.locator('text=Clear Badge') });
      await expect(card.locator('[data-testid="activity-dot"]')).toBeVisible();

      // Visit the space (triggers markSpaceViewed via $effect)
      await card.locator('a').click();
      await page.waitForURL(`**/spaces/${space.id}`);

      // Go back to list
      await page.goto('/spaces');
      // Badge should be cleared for this space
      const updatedCard = page.locator('[data-testid="space-card"]', { has: page.locator('text=Clear Badge') });
      await expect(updatedCard.locator('[data-testid="activity-dot"]')).not.toBeVisible();
    });
  });

  test.describe('Slide-out Members Panel', () => {
    test('should open panel when members button clicked', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Panel Test' });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await page.locator('[data-testid="space-members-button"]').click();
      await expect(page.locator('[data-testid="members-panel"]')).toBeVisible();
      await expect(page.locator('[data-testid="panel-header"]')).toContainText('Members');
    });

    test('should close panel when close button clicked', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Close Panel' });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await page.locator('[data-testid="space-members-button"]').click();
      await expect(page.locator('[data-testid="members-panel"]')).toBeVisible();

      await page.locator('[data-testid="panel-close"]').click();
      await expect(page.locator('[data-testid="members-panel"]')).toHaveClass(/translate-x-full/);
    });

    test('should show member contribution data', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Contributions' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);
      await page.locator('[data-testid="space-members-button"]').click();

      await expect(page.locator('[data-testid="members-panel"]')).toContainText('1 photos added');
    });
  });

  test.describe('Empty State Onboarding', () => {
    test('should show onboarding steps for owner in empty space', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Empty Owner' });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await expect(page.locator('[data-testid="empty-state-icon"]')).toBeVisible();
      await expect(page.locator('[data-testid="step-add-photos"]')).toBeVisible();
      await expect(page.locator('[data-testid="step-invite-members"]')).toBeVisible();
      await expect(page.locator('[data-testid="step-set-cover"]')).toBeVisible();
    });

    test('should show passive message for viewer in empty space', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Viewer Empty' });
      await utils.addSpaceMember(admin.accessToken, space.id, { userId: user2.userId });

      await utils.setAuthCookies(context, user2.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await expect(page.locator('text=No photos yet')).toBeVisible();
      await expect(page.locator('[data-testid="step-add-photos"]')).not.toBeVisible();
    });
  });
});
