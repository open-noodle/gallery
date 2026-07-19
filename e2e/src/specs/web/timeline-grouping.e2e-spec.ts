import type { AssetMediaResponseDto, LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { thumbnailUtils, timelineUtils } from 'src/ui/specs/timeline/utils';
import { utils } from 'src/utils';

test.describe('Timeline grouping navigation', () => {
  let admin: LoginResponseDto;
  let newestAsset: AssetMediaResponseDto;
  let oldAsset: AssetMediaResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    for (let year = 2024; year >= 2000; year--) {
      const asset = await utils.createAsset(admin.accessToken, {
        fileCreatedAt: `${year}-12-15T10:00:00.000Z`,
        fileModifiedAt: `${year}-12-15T10:00:00.000Z`,
      });

      if (year === 2024) {
        newestAsset = asset;
      }
      if (year === 2000) {
        oldAsset = asset;
      }
    }
  });

  test('zooms an old month into the full Photos timeline instead of leaving All at the top', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
    await expect(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    await thumbnailUtils.expectInViewport(page, newestAsset.id);

    await page.getByTestId('timeline-grouping-year').click();
    await expect(page.getByTestId('timeline-grouping-year')).toHaveAttribute('aria-pressed', 'true');

    // The representative bucket cards are virtualized: a single raw scrollTop=scrollHeight can land
    // on a stale (still-rebuilding) layout height, so the bottom-most (2000) card never enters the
    // visible window. Re-scroll to the bottom until that card actually renders (de-flake).
    const targetYearCard = page.getByTestId('timeline-bucket-card').filter({ hasText: '2000' });
    await expect(async () => {
      await timelineUtils.locator(page).evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      await expect(targetYearCard).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await targetYearCard.click();

    await expect(page.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('timeline-bucket-card').filter({ hasText: 'Dec 2000' }).click();

    await expect(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('active-filters-bar')).not.toBeVisible();
    expect(page.url()).not.toContain('selectedYear');
    expect(page.url()).not.toContain('selectedMonth');
    await expect.poll(() => timelineUtils.locator(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
    await expect(thumbnailUtils.withAssetId(page, newestAsset.id)).not.toBeVisible();
    await thumbnailUtils.expectInViewport(page, oldAsset.id);
  });
});
