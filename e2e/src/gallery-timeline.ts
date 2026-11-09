import { expect, Page } from '@playwright/test';

// Timeline locators for Gallery's real-server web specs. They came from upstream's mock-network UI suite
// (e2e/src/ui/specs/timeline/utils.ts), which immich-32879 moved into web/test/medium.

export const poll = async <T>(
  page: Page,
  query: () => Promise<T>,
  callback?: (result: Awaited<T> | undefined) => boolean,
) => {
  let result;
  const timeout = Date.now() + 10_000;

  const terminate = callback || ((result: Awaited<T> | undefined) => !!result);
  while (!terminate(result) && Date.now() < timeout) {
    try {
      result = await query();
    } catch {
      // ignore
    }
    if (page.isClosed()) {
      return;
    }
    try {
      await page.waitForTimeout(50);
    } catch {
      return;
    }
  }
  if (!result) {
    // rerun to trigger error if any
    result = await query();
  }
  return result;
};

export const thumbnailUtils = {
  locator(page: Page) {
    return page.locator('[data-thumbnail-focus-container]');
  },
  withAssetId(page: Page, assetId: string) {
    return page.locator(`[data-thumbnail-focus-container][data-asset="${assetId}"]`);
  },
  selectButton(page: Page, assetId: string) {
    return page.locator(`[data-thumbnail-focus-container][data-asset="${assetId}"] button[role="checkbox"]`);
  },
  async expectThumbnailIsFavorite(page: Page, assetId: string) {
    await expect(thumbnailUtils.withAssetId(page, assetId).locator('[data-testid="favorite-icon"]')).toHaveCount(1);
  },
  async expectInViewport(page: Page, assetId: string) {
    const box = await poll(page, () => thumbnailUtils.withAssetId(page, assetId).boundingBox());
    if (page.isClosed()) {
      return;
    }
    expect(box).toBeTruthy();
  },
};

export const timelineUtils = {
  locator(page: Page) {
    return page.locator('#asset-grid');
  },
};
