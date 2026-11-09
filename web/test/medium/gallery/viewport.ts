import type { Page, TestInfo } from '@playwright/test';

// The medium page lives for the whole worker, so a spec that resizes it must put it back,
// or every later test in that worker runs at the wrong size.
export const restoreViewport = async ({ page }: { page: Page }, testInfo: TestInfo) => {
  const viewport = testInfo.project.use.viewport;
  if (viewport) {
    await page.setViewportSize(viewport);
  }
};
