import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

// UI-plumbing E2E coverage for smart search on the /photos page.
//
// The e2e stack runs with IMMICH_MACHINE_LEARNING_ENABLED=false, so real
// CLIP semantic results are not available. These tests verify the
// integration wiring between SearchBar, URL state, SmartSearchResults,
// ActiveFiltersBar and Timeline — the full semantic search flow is
// validated at the API level in specs/server/api/search.e2e-spec.ts.
test.describe('Photos Search', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Seed a few assets so the timeline has content to render/hide.
    await Promise.all([
      utils.createAsset(admin.accessToken),
      utils.createAsset(admin.accessToken),
      utils.createAsset(admin.accessToken),
    ]);
  });

  async function gotoPhotos(
    context: import('@playwright/test').BrowserContext,
    page: import('@playwright/test').Page,
    path = '/photos',
  ) {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(path);
    // Wait for the filter panel to mount (either expanded or collapsed)
    await page.waitForSelector('[data-testid="discovery-panel"], [data-testid="collapsed-icon-strip"]');
  }

  test('typing a query and pressing Enter updates the URL to ?q=', async ({ context, page }) => {
    await gotoPhotos(context, page);

    const searchInput = page.locator('input[placeholder="Search"]');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    // Set value directly via DOM and dispatch input event for Svelte bind to sync
    await searchInput.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = 'beach';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(searchInput).toHaveValue('beach');
    await searchInput.focus();
    await searchInput.press('Enter');

    await expect(page).toHaveURL(/\/photos\?q=beach/, { timeout: 10_000 });
  });

  test('navigating directly to /photos?q=... hides the timeline and shows search results area', async ({
    context,
    page,
  }) => {
    await gotoPhotos(context, page, '/photos?q=mountain');

    // Timeline should NOT be rendered when a search query is active
    await expect(page.locator('[data-testid="timeline"]')).not.toBeVisible();

    // SmartSearchResults renders either result-count or empty state once the
    // searchSmart call resolves. With ML disabled the call errors out and
    // the wrapper falls back to an empty result list.
    await expect(page.getByTestId('result-count').or(page.getByTestId('search-empty'))).toBeVisible({
      timeout: 15_000,
    });

    // The search input should reflect the URL query
    const searchInput = page.locator('input[placeholder="Search"]');
    await expect(searchInput).toHaveValue('mountain');
  });

  test('clearing the search via the X button returns to the timeline', async ({ context, page }) => {
    await gotoPhotos(context, page, '/photos?q=forest');

    // Wait for the search results area to settle
    await expect(page.getByTestId('result-count').or(page.getByTestId('search-empty'))).toBeVisible({
      timeout: 15_000,
    });

    // Click the clear (X) button on the SearchBar
    await page.locator('[aria-label="Clear value"]').click();

    // URL should no longer contain ?q=
    await expect(page).toHaveURL(/\/photos(?!\?q=)/);

    // The search-chip/result-count/empty state should all be gone
    await expect(page.getByTestId('search-chip')).not.toBeVisible();
    await expect(page.getByTestId('search-empty')).not.toBeVisible();
  });

  test('search chip is visible in the ActiveFiltersBar and can be removed', async ({ context, page }) => {
    await gotoPhotos(context, page, '/photos?q=sunset');

    // Wait for search results wrapper to finish its call
    await expect(page.getByTestId('result-count').or(page.getByTestId('search-empty'))).toBeVisible({
      timeout: 15_000,
    });

    // Chip should show the query text
    await expect(page.getByTestId('search-chip')).toContainText('sunset');

    // Remove via the chip's close button — should clear the search entirely.
    // UserPageLayout's header is absolutely positioned over the top of the
    // content area and Playwright's auto-scroll-into-view lands the chip under
    // the header overlay. dispatchEvent bypasses both the scroll and intercept
    // checks and fires the click handler directly on the button.
    await page.getByTestId('search-chip-close').dispatchEvent('click');

    await expect(page).toHaveURL(/\/photos(?!\?q=)/);
    await expect(page.getByTestId('search-chip')).not.toBeVisible();
  });

  test('browser back navigation from a search URL restores the timeline', async ({ context, page }) => {
    await gotoPhotos(context, page);

    // Kick off a search from the UI so history has two entries
    const searchInput = page.locator('input[placeholder="Search"]');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill('river');
    await searchInput.press('Enter');

    await expect(page).toHaveURL(/\/photos\?q=river/);
    await expect(page.getByTestId('result-count').or(page.getByTestId('search-empty'))).toBeVisible({
      timeout: 15_000,
    });

    // Go back — we should be on /photos with no query
    await page.goBack();
    await expect(page).toHaveURL(/\/photos(?!\?q=)/);
    await expect(page.locator('input[placeholder="Search"]')).toHaveValue('');
  });

  test('clearing the search restores the timeline with assets', async ({ context, page }) => {
    // Regression: after a search is cleared, the /photos timeline re-mounts.
    // It used to come back empty with no thumbnails even though there were
    // assets. This test verifies the timeline re-populates with at least one
    // asset thumbnail after the search is cleared.
    await gotoPhotos(context, page);

    // Sanity: the timeline grid is visible and has at least one asset thumbnail.
    // The admin user was seeded with 3 assets in test.beforeAll.
    const gridImages = page.locator('#asset-grid img');
    await expect(gridImages.first()).toBeVisible({ timeout: 15_000 });
    const beforeCount = await gridImages.count();
    expect(beforeCount).toBeGreaterThan(0);

    // Trigger search mode via the URL (ML disabled → empty results, but the
    // SmartSearchResults wrapper mounts).
    await page.goto('/photos?q=something');
    await expect(page.getByTestId('result-count').or(page.getByTestId('search-empty'))).toBeVisible({
      timeout: 15_000,
    });
    // Timeline grid should not be visible while search is active.
    await expect(page.locator('[data-testid="timeline"]')).not.toBeVisible();

    // Clear the search via the SearchBar X button.
    await page.locator('[aria-label="Clear value"]').click();

    // URL should return to /photos with no ?q=
    await expect(page).toHaveURL(/\/photos(?!\?q=)/, { timeout: 10_000 });

    // Regression assertion: the timeline grid re-appears AND has at least one
    // asset thumbnail rendered. The previous bug caused the timeline to mount
    // empty.
    await expect(page.locator('#asset-grid')).toBeVisible({ timeout: 10_000 });
    await expect(gridImages.first()).toBeVisible({ timeout: 15_000 });
    const afterCount = await gridImages.count();
    expect(afterCount).toBeGreaterThan(0);
  });

  test('mobile viewport hides the SearchBar', async ({ context, page }) => {
    // Gallery's Tailwind theme defines --breakpoint-sm: 639px, so sm:block
    // still matches at 639. Use a clearly-sub-breakpoint width here.
    await page.setViewportSize({ width: 500, height: 900 });
    await gotoPhotos(context, page);

    // The SearchBar is inside a hidden sm:block container, so it should
    // not be visible below the sm breakpoint.
    await expect(page.locator('input[placeholder="Search"]')).not.toBeVisible();
  });

  test('typing characters does not trigger a search or unmount the timeline until Enter is pressed', async ({
    context,
    page,
  }) => {
    // Regression: /photos previously derived showSearchResults from the live
    // searchQuery value, so typing a single character unmounted the Timeline,
    // mounted SmartSearchResults, and kicked off a debounced fetch. The
    // corrected behavior matches the spaces page: typing just updates the
    // input value; the Timeline stays mounted until the user explicitly
    // submits (Enter) or navigates to a ?q=... URL.
    //
    // We assert two things:
    //   1. Timeline remains visible while typing (SmartSearchResults is NOT mounted).
    //   2. No POST /api/search/smart request fires during typing — only after Enter.
    await gotoPhotos(context, page);

    // Sanity: timeline is initially visible with thumbnails.
    await expect(page.locator('#asset-grid img').first()).toBeVisible({ timeout: 15_000 });

    // Capture any /search/smart requests from this point onward.
    const smartSearchRequests: string[] = [];
    const requestHandler = (request: import('@playwright/test').Request) => {
      const url = request.url();
      if (request.method() === 'POST' && url.includes('/api/search/smart')) {
        smartSearchRequests.push(url);
      }
    };
    page.on('request', requestHandler);

    const searchInput = page.locator('input[placeholder="Search"]');
    await expect(searchInput).toBeVisible();

    // Type characters one by one, giving reactivity time to flush between each.
    // If the bug regresses, even one character would mount SmartSearchResults
    // and schedule a debounced fetch.
    for (const ch of 'beach') {
      await searchInput.evaluate((el, char) => {
        const input = el as HTMLInputElement;
        input.value = input.value + char;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, ch);
      // small delay so Svelte reactivity can run between characters
      await page.waitForTimeout(50);
    }

    // Wait well past the wrapper's SEARCH_FILTER_DEBOUNCE_MS (250ms) to be sure
    // any debounced fetch would have fired by now.
    await page.waitForTimeout(500);

    // Assertion 1: no search request was fired during typing.
    expect(
      smartSearchRequests,
      `expected no POST /api/search/smart during typing, got: ${smartSearchRequests.join(', ')}`,
    ).toEqual([]);

    // Assertion 2: the timeline is still visible with thumbnails.
    await expect(page.locator('#asset-grid')).toBeVisible();
    await expect(page.locator('#asset-grid img').first()).toBeVisible();

    // Assertion 3: URL hasn't changed — still /photos, not /photos?q=beach.
    expect(new URL(page.url()).search).toBe('');

    // Now press Enter. This should commit the query and trigger the search.
    // Set up a wait for the request BEFORE pressing Enter so we catch the
    // debounced fetch even if it fires before our next assertion.
    const smartSearchRequestPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/search/smart'),
      { timeout: 10_000 },
    );
    await searchInput.focus();
    await searchInput.press('Enter');

    // URL updates to include the query.
    await expect(page).toHaveURL(/\/photos\?q=beach/, { timeout: 5000 });

    // Wait for the debounced fetch to fire (250ms debounce + request time).
    await smartSearchRequestPromise;

    // SmartSearchResults area appears (either result-count or empty state).
    await expect(page.getByTestId('result-count').or(page.getByTestId('search-empty'))).toBeVisible({
      timeout: 15_000,
    });

    // At least one /search/smart request was fired after Enter.
    // (ML is disabled in the e2e stack so the backend may reject it, but
    // the request must have been issued.)
    expect(smartSearchRequests.length).toBeGreaterThan(0);

    page.off('request', requestHandler);
  });
});
