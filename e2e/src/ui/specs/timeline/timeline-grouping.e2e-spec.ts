import { faker } from '@faker-js/faker';
import { expect, test } from '@playwright/test';

import {
  createDefaultTimelineConfig,
  generateTimelineData,
  type Changes,
  type TimelineData,
} from 'src/ui/generators/timeline';
import { setupBaseMockApiRoutes } from 'src/ui/mock-network/base-network';
import { setupTimelineMockApiRoutes, TimelineTestContext } from 'src/ui/mock-network/timeline-network';
import { thumbnailUtils, timelineUtils } from 'src/ui/specs/timeline/utils';
import { utils } from 'src/utils';

test.describe('Timeline grouping UI', () => {
  let adminUserId: string;
  let timelineRestData: TimelineData;
  const testContext = new TimelineTestContext();
  const changes: Changes = {
    albumAdditions: [],
    assetDeletions: [],
    assetArchivals: [],
    assetFavorites: [],
  };

  test.beforeAll(() => {
    test.fail(
      process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS !== '1',
      'This test requires env var: PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1',
    );
    utils.initSdk();
    adminUserId = faker.string.uuid();
    testContext.adminId = adminUserId;
    timelineRestData = generateTimelineData({ ...createDefaultTimelineConfig(), ownerId: adminUserId });
  });

  test.beforeEach(async ({ context }) => {
    await setupBaseMockApiRoutes(context, adminUserId);
    await setupTimelineMockApiRoutes(context, timelineRestData, changes, testContext);
  });

  test('zooms from years to months to days without temporal chips on Photos', async ({ page }) => {
    await page.goto('/photos');
    await expect(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('timeline-grouping-year').click();

    const firstYearCard = page.getByTestId('timeline-bucket-card').first();
    await expect(firstYearCard).toBeVisible();
    await firstYearCard.click();

    await expect(page.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('active-filters-bar')).not.toBeVisible();
    expect(page.url()).not.toContain('selectedYear');

    const firstMonthCard = page.getByTestId('timeline-bucket-card').first();
    await expect(firstMonthCard).toBeVisible();
    await firstMonthCard.click();

    await expect(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-thumbnail-focus-container]').first()).toBeVisible();
    await expect(page.getByTestId('active-filters-bar')).not.toBeVisible();
    expect(page.url()).not.toContain('selectedMonth');
  });

  test('zooms an old month into the full timeline at that month instead of staying at the top', async ({ page }) => {
    const targetMonth = '2000-12';
    const targetAsset = [...timelineRestData.buckets.get(`${targetMonth}-01`)!].at(0)!;

    await page.goto('/photos');
    await expect(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('timeline-grouping-year').click();
    await timelineUtils.locator(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    const targetYearCard = page.getByTestId('timeline-bucket-card').filter({ hasText: '2000' });
    await expect(targetYearCard).toBeVisible();
    await targetYearCard.click();

    await expect(page.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    // Zooming the 2000 card anchors Months at Dec 2000 within the full, unscoped
    // archive, so that card is already in view. Resetting to the top would now
    // reveal the most recent months instead (the year zoom no longer scopes the query).
    await page.getByTestId('timeline-bucket-card').filter({ hasText: 'Dec 2000' }).click();

    await expect(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('active-filters-bar')).not.toBeVisible();
    expect(page.url()).not.toContain('selectedYear');
    expect(page.url()).not.toContain('selectedMonth');
    await expect.poll(() => timelineUtils.locator(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await thumbnailUtils.expectInViewport(page, targetAsset.id);
  });

  test('shows the floating grouping control on mobile browse and hides it under the asset viewer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/photos');

    const mobileGroupingControl = page.getByTestId('timeline-mobile-grouping-control-shell');
    await expect(mobileGroupingControl).toBeVisible();
    await expect(mobileGroupingControl.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-thumbnail-focus-container]').first().click();

    await expect(mobileGroupingControl).not.toBeVisible();
  });
});
