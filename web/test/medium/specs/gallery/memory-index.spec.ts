import { expect, test } from '#test/medium/fixtures.ts';
import { factory } from '#test/medium/mock/factories.ts';

// Gallery's memories index page: lists memories by title and opens one in the memory viewer.
test('lists memories and opens one in the viewer', async ({ page, data }) => {
  const assets = data.addTimeline({ years: 1 });
  data.addMemories(
    factory.memory({
      memoryAt: '2024-04-23T00:00:00.000Z',
      showAt: '2026-04-23T00:00:00.000Z',
      title: 'April history',
      subtitle: 'Spring highlights',
      isSaved: true,
      assets: assets.slice(0, 3),
    }),
    factory.memory({
      memoryAt: '2024-03-12T00:00:00.000Z',
      createdAt: '2026-03-12T00:00:00.000Z',
      title: 'March history',
      assets: assets.slice(3, 6),
    }),
  );
  await page.goto('/memories');

  const memoryLink = page.getByRole('link', { name: /april/i }).first();
  await expect(memoryLink).toBeVisible();
  await memoryLink.click();

  // Route.viewMemory scopes the viewer by memory id and carries the first asset as `assetId`.
  await expect(page).toHaveURL(/\/memories\/[0-9a-f-]{36}\?assetId=/);
  await expect(page.locator('#memory-viewer')).toBeVisible();
});
