import { Route } from '#lib/route.ts';
import { expect, test } from '#test/medium/fixtures.ts';
import { restoreViewport } from '#test/medium/gallery/viewport.ts';
import { DateTime } from 'luxon';

// Gallery's timeline grouping (years, months, days), served by the bucketSize handlers in gallery/time-buckets.ts.
test.describe('timeline grouping', () => {
  test.afterEach(restoreViewport);

  test('zooms from years to months to days without temporal chips on Photos', async ({ page, data }) => {
    data.addTimeline({ years: 2 });
    await page.goto(Route.photos());
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

  test('zooms an old month into the full timeline at that month instead of staying at the top', async ({
    page,
    data,
    app,
  }) => {
    const assets = data.addTimeline({ years: 3 });
    // The newest photo of the oldest year: zooming that year anchors Months at its newest month.
    const year = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).year;
    const oldestYear = year(assets.at(-1)!.fileCreatedAt);
    const target = assets.find((asset) => year(asset.fileCreatedAt) === oldestYear)!;
    const taken = DateTime.fromISO(target.fileCreatedAt, { zone: 'utc' });

    await page.goto(Route.photos());
    await page.getByTestId('timeline-grouping-year').click();
    const grid = page.locator('#asset-grid');
    await grid.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    const yearCard = page.getByTestId('timeline-bucket-card').filter({ hasText: String(taken.year) });
    await expect(yearCard).toBeVisible();
    await yearCard.click();
    await expect(page.getByTestId('timeline-grouping-month')).toHaveAttribute('aria-pressed', 'true');

    // Zooming the year anchors Months at that year within the full, unscoped archive.
    await page
      .getByTestId('timeline-bucket-card')
      .filter({ hasText: taken.setLocale('en-US').toFormat('LLL yyyy') })
      .click();

    await expect(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('active-filters-bar')).not.toBeVisible();
    expect(page.url()).not.toContain('selectedYear');
    expect(page.url()).not.toContain('selectedMonth');
    await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(app.timeline.thumbnail(target)).toBeInViewport();
  });

  test('shows the floating grouping control on mobile browse and hides it under the asset viewer', async ({
    page,
    data,
  }) => {
    data.addTimeline({ years: 1 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(Route.photos());

    const mobileGroupingControl = page.getByTestId('timeline-mobile-grouping-control-shell');
    await expect(mobileGroupingControl).toBeVisible();
    await expect(mobileGroupingControl.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-thumbnail-focus-container]').first().click();
    await expect(mobileGroupingControl).not.toBeVisible();
  });
});
