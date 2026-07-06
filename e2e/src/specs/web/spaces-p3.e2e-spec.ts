import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('Spaces P3 — Activity Feed, Members Tab, New-Since-Last-Visit', () => {
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

  // The Activity feed now lives on its own Activity tab route (/spaces/<id>/activity),
  // wrapped in the `space-activity` section (moved off the Members page).
  test.describe('Activity Feed', () => {
    test('should show activity feed with "added N photos" event after adding assets', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Activity Feed Test' });
      const asset1 = await utils.createAsset(admin.accessToken);
      const asset2 = await utils.createAsset(admin.accessToken);
      const asset3 = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset1.id, asset2.id, asset3.id]);

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}/activity`);

      // Verify the "added 3 photos" activity event is visible in the activity section.
      await expect(page.getByTestId('space-activity')).toContainText('added 3 photos');
    });

    test('should show empty state when no activities exist', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Empty Activity' });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}/activity`);

      await expect(page.getByTestId('activity-empty-state')).toBeVisible();
      await expect(page.getByTestId('activity-empty-state')).toContainText('No activity yet');
    });

    test('should show member join activity when a member is added', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Member Join Activity' });
      await utils.addSpaceMember(admin.accessToken, space.id, { userId: user2.userId });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}/activity`);

      await expect(page.getByTestId('space-activity')).toContainText('joined as');
    });
  });

  test.describe('Members Tab', () => {
    test('Members tab shows the member list (no feed); Activity tab shows the feed', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Members Tab Page' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);
      await utils.addSpaceMember(admin.accessToken, space.id, { userId: user2.userId });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      // Members tab via the shell tab bar: shows the member list and no longer the activity feed.
      await page.getByTestId('space-tab-members').click();
      await page.waitForURL(`/spaces/${space.id}/members`);
      await expect(page.getByTestId('member-list')).toBeVisible();
      await expect(page.getByTestId('member-list')).toContainText('User Two');
      await expect(page.getByTestId('members-activity')).not.toBeVisible();

      // Activity tab: the feed now lives here and shows the add event.
      await page.getByTestId('space-tab-activity').click();
      await page.waitForURL(`/spaces/${space.id}/activity`);
      await expect(page.getByTestId('space-activity')).toContainText('added 1 photos');
    });

    test('should show member count in the Members tab badge', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'Member Count Tab' });
      await utils.addSpaceMember(admin.accessToken, space.id, { userId: user2.userId });

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      // The Members tab carries a count badge (2 = admin + user2).
      await expect(page.getByTestId('space-tab-members')).toContainText('2');
    });
  });

  test.describe('New-Since-Last-Visit Divider', () => {
    test('should show new assets divider when assets were added after last visit', async ({ context, page }) => {
      // User A (admin) creates space and adds User B
      const space = await utils.createSpace(admin.accessToken, { name: 'Divider Test' });
      await utils.addSpaceMember(admin.accessToken, space.id, { userId: user2.userId });

      // User B visits the space (marks as viewed via API)
      await utils.markSpaceViewed(user2.accessToken, space.id);

      // User A adds assets after User B's visit
      const asset1 = await utils.createAsset(admin.accessToken);
      const asset2 = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset1.id, asset2.id]);

      // User B revisits the space in browser
      await utils.setAuthCookies(context, user2.accessToken);
      await page.goto(`/spaces/${space.id}`);

      // Verify the "X new" divider appears
      await expect(page.locator('[data-testid="new-assets-divider"]')).toBeVisible();
      await expect(page.locator('[data-testid="new-assets-pill"]')).toContainText('2 new');
    });

    test('should not show divider when no new assets since last visit', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'No Divider Test' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

      // View after adding — so lastViewedAt is after asset addition
      await utils.markSpaceViewed(admin.accessToken, space.id);

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      await expect(page.locator('[data-testid="new-assets-divider"]')).not.toBeVisible();
    });

    test('should not show divider on first visit (no lastViewedAt)', async ({ context, page }) => {
      const space = await utils.createSpace(admin.accessToken, { name: 'First Visit Test' });
      const asset = await utils.createAsset(admin.accessToken);
      await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);
      // Do NOT call markSpaceViewed — simulate first visit

      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(`/spaces/${space.id}`);

      // No divider on first visit because lastViewedAt is null
      await expect(page.locator('[data-testid="new-assets-divider"]')).not.toBeVisible();
    });
  });
});
