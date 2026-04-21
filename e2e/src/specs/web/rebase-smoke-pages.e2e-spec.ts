// Landmark substitutions (deviations from the plan):
// - /photos: the UserPageLayout wrapper has no `title` prop, so `page-header` is never
//   rendered. The plan suggested `discovery-panel`/`collapsed-icon-strip` from FilterPanel,
//   but those are gated on `hidden={isTimelineEmpty}` — with an empty DB the panel renders
//   nothing. Falling back to the `main` element, which UserPageLayout always renders.
import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

type CanaryRoute = {
  path: string;
  landmark: string;
  description: string;
};

const routes: CanaryRoute[] = [
  {
    path: '/photos',
    landmark: 'main',
    description: '/photos renders',
  },
  { path: '/albums', landmark: '[data-testid="page-header"]', description: '/albums renders' },
  { path: '/spaces', landmark: '[data-testid="page-header"]', description: '/spaces renders' },
  { path: '/favorites', landmark: '[data-testid="page-header"]', description: '/favorites renders' },
  { path: '/archive', landmark: '[data-testid="page-header"]', description: '/archive renders' },
  { path: '/trash', landmark: '[data-testid="page-header"]', description: '/trash renders' },
  { path: '/map', landmark: '.maplibregl-map', description: '/map renders' },
  { path: '/people', landmark: '[data-testid="page-header"]', description: '/people renders' },
  { path: '/places', landmark: '[data-testid="page-header"]', description: '/places renders' },
  { path: '/sharing', landmark: '[data-testid="page-header"]', description: '/sharing (Partners) renders' },
  { path: '/shared-links', landmark: '[data-testid="page-header"]', description: '/shared-links renders' },
  { path: '/tags', landmark: '[data-testid="page-header"]', description: '/tags renders' },
  { path: '/explore', landmark: '[data-testid="page-header"]', description: '/explore renders' },
  {
    path: '/admin/user-management',
    landmark: '[data-testid="admin-page-header"]',
    description: '/admin/user-management renders',
  },
  {
    path: '/admin/system-settings',
    landmark: '[data-testid="admin-page-header"]',
    description: '/admin/system-settings renders',
  },
  {
    path: '/admin/jobs-status',
    landmark: '[data-testid="admin-page-header"]',
    description: '/admin/jobs-status renders',
  },
  { path: '/admin/queues', landmark: '[data-testid="admin-page-header"]', description: '/admin/queues renders' },
  { path: '/user-settings', landmark: '[data-testid="page-header"]', description: '/user-settings renders' },
];

test.describe.serial('Rebase Smoke — Page Render', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  for (const route of routes) {
    test(route.description, async ({ context, page }) => {
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto(route.path);
      await expect(page.locator(route.landmark).first()).toBeVisible({ timeout: 5_000 });
    });
  }
});
