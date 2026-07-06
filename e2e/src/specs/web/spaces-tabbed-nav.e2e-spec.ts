import { LoginResponseDto, SharedSpaceResponseDto, SharedSpaceRole } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';

// Web E2E coverage for the space tabbed-navigation shell.
//
// Role matrix under test:
//   Owner  → creates the space; sees all tabs except People (face recognition off by default).
//   Editor → space Editor: sees ＋ Add photos button; clicking it navigates to Photos in select mode.
//   Viewer → space Viewer: no ＋ Add photos.
//
// The spec deliberately avoids arbitrary timeouts — every assertion awaits a
// visible element or waitForURL to prevent races.

test.describe('Spaces — tabbed navigation', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let space: SharedSpaceResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [owner, editor, viewer] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('tabs-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('tabs-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('tabs-viewer')),
    ]);

    space = await utils.createSpace(owner.accessToken, { name: 'Tabs Space' });
    // New spaces default to faceRecognitionEnabled: true, so the People-gating
    // tests below need it explicitly disabled to exercise the "off" branch.
    await utils.updateSpace(owner.accessToken, space.id, { faceRecognitionEnabled: false });

    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: editor.userId,
      role: SharedSpaceRole.Editor,
    });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: viewer.userId,
      role: SharedSpaceRole.Viewer,
    });
  });

  test('owner sees Photos, Albums, Map and Members tabs but not People (face recognition off)', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/spaces/${space.id}`);

    await expect(page.getByTestId('space-tabs')).toBeVisible();
    await expect(page.getByTestId('space-tab-photos')).toBeVisible();
    await expect(page.getByTestId('space-tab-albums')).toBeVisible();
    await expect(page.getByTestId('space-tab-map')).toBeVisible();
    await expect(page.getByTestId('space-tab-members')).toBeVisible();
    // People tab is hidden when face recognition is disabled.
    await expect(page.getByTestId('space-tab-people')).toHaveCount(0);
  });

  test('clicking the Members tab navigates to the members route and shows the member list', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/spaces/${space.id}`);

    await page.getByTestId('space-tab-members').click();
    await page.waitForURL(`/spaces/${space.id}/members`);
    await expect(page.getByTestId('member-list')).toBeVisible();
  });

  test('viewer sees the tab bar but no ＋ Add photos button', async ({ context, page }) => {
    await utils.setAuthCookies(context, viewer.accessToken);
    await page.goto(`/spaces/${space.id}`);

    await expect(page.getByTestId('space-tabs')).toBeVisible();
    await expect(page.getByTestId('space-add-photos')).toHaveCount(0);
  });

  test('editor clicking ＋ Add photos from the Members tab navigates to Photos in select mode', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, editor.accessToken);
    await page.goto(`/spaces/${space.id}/members`);

    await page.getByTestId('space-add-photos').click();
    await page.waitForURL(`/spaces/${space.id}`);
    // The select-mode ControlAppBar renders "Add to space" text.
    await expect(page.getByText(/add to space/i)).toBeVisible();
  });

  test('Members is a tab route, not a slide-in panel — no space-panel element exists', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/spaces/${space.id}`);

    await expect(page.getByTestId('space-tabs')).toBeVisible();
    await expect(page.getByTestId('space-panel')).toHaveCount(0);
  });

  test('a direct /people deep-link redirects to Photos when face recognition is off', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/spaces/${space.id}/people`);

    await page.waitForURL(`/spaces/${space.id}`);
    await expect(page.getByTestId('space-tabs')).toBeVisible();
  });
});
