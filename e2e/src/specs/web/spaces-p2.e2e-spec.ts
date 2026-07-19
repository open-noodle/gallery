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
      await card.click();
      await page.waitForURL(`**/spaces/${space.id}`);

      // Go back to list
      await page.goto('/spaces');
      // Badge should be cleared for this space
      const updatedCard = page.locator('[data-testid="space-card"]', { has: page.locator('text=Clear Badge') });
      await expect(updatedCard.locator('[data-testid="activity-dot"]')).not.toBeVisible();
    });
  });

  test.describe('Members Tab', () => {
    // The slide-out Members panel was replaced by a dedicated Members tab route
    // (/spaces/<id>/members). The member-list + contribution behaviour moved there;
    // these tests assert it via the tab rather than the deleted panel.
    test('should reach the member list via the Members tab', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Members Tab' });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await page.getByTestId('space-tab-members').click();
      await page.waitForURL(`/spaces/${space.id}/members`);
      await expect(page.getByTestId('member-list')).toBeVisible();
      // The owner is always a member, so the list contains their entry.
      await expect(page.getByTestId('member-list')).toContainText(admin.name);
    });

    test('should show member contribution data on the Members tab', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Contributions' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}/members`);

      // The member row shows the contribution count ("<n> Photos") for contributors
      // (i18n "photos" => "Photos"; toContainText is case-sensitive).
      await expect(page.getByTestId('member-list')).toContainText(/1 Photos/);
    });
  });

  test.describe('Onboarding Banner', () => {
    test('should show banner with 0/3 steps for owner in empty space', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Banner Empty' });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await expect(page.locator('[data-testid="onboarding-banner"]')).toBeVisible();
      await expect(page.locator('[data-testid="progress-text"]')).toContainText('0');
      await expect(page.locator('[data-testid="progress-text"]')).toContainText('3');
    });

    test('should show 1/3 after adding photos', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Banner Photos' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await expect(page.locator('[data-testid="onboarding-banner"]')).toBeVisible();
      await expect(page.locator('[data-testid="progress-text"]')).toContainText('1');
      await expect(page.locator('[data-testid="step-add-photos-check"]')).toBeVisible();
    });

    test('should show 2/3 after adding photos and members', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Banner Members' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);
      await utils.addSpaceMember(admin.accessToken, space.id, { userId: user2.userId });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await expect(page.locator('[data-testid="onboarding-banner"]')).toBeVisible();
      await expect(page.locator('[data-testid="progress-text"]')).toContainText('2');
      await expect(page.locator('[data-testid="step-add-photos-check"]')).toBeVisible();
      await expect(page.locator('[data-testid="step-invite-members-check"]')).toBeVisible();
    });

    test('should hide banner when all 3 steps complete', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Banner Complete' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);
      await utils.addSpaceMember(admin.accessToken, space.id, { userId: user2.userId });
      await utils.updateSpace(admin.accessToken, space.id, { thumbnailAssetId: asset.id });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await expect(page.locator('[data-testid="onboarding-banner"]')).not.toBeVisible();
    });

    test('should not show banner for non-owner members', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Banner Viewer' });
      await utils.addSpaceMember(admin.accessToken, space.id, { userId: user2.userId });

      await utils.setAuthCookies(context, user2.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await expect(page.locator('[data-testid="onboarding-banner"]')).not.toBeVisible();
    });

    test('should collapse and expand banner', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Banner Collapse' });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await expect(page.locator('[data-testid="onboarding-banner"]')).toBeVisible();
      await page.locator('[data-testid="banner-collapse-toggle"]').click();
      await expect(page.locator('[data-testid="onboarding-banner"]')).toHaveAttribute('data-collapsed', 'true');
      await page.locator('[data-testid="banner-collapse-toggle"]').click();
      await expect(page.locator('[data-testid="onboarding-banner"]')).toHaveAttribute('data-collapsed', 'false');
    });
  });
});
