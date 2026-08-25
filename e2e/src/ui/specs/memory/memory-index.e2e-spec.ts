import { faker } from '@faker-js/faker';
import type { MemoryResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { generateMemory } from 'src/ui/generators/memory';
import {
  Changes,
  createDefaultTimelineConfig,
  generateTimelineData,
  TimelineAssetConfig,
  TimelineData,
} from 'src/ui/generators/timeline';
import { setupBaseMockApiRoutes } from 'src/ui/mock-network/base-network';
import { MemoryChanges, setupMemoryMockApiRoutes } from 'src/ui/mock-network/memory-network';
import { setupTimelineMockApiRoutes, TimelineTestContext } from 'src/ui/mock-network/timeline-network';

test.describe.configure({ mode: 'parallel' });

test.describe('Memory Index', () => {
  let adminUserId: string;
  let timelineRestData: TimelineData;
  let memories: MemoryResponseDto[];
  const assets: TimelineAssetConfig[] = [];
  const testContext = new TimelineTestContext();
  const changes: Changes = {
    albumAdditions: [],
    assetDeletions: [],
    assetArchivals: [],
    assetFavorites: [],
  };
  const memoryChanges: MemoryChanges = {
    memoryDeletions: [],
    assetRemovals: new Map(),
  };

  test.beforeAll(async () => {
    adminUserId = faker.string.uuid();
    testContext.adminId = adminUserId;

    timelineRestData = generateTimelineData({
      ...createDefaultTimelineConfig(),
      ownerId: adminUserId,
    });

    for (const timeBucket of timelineRestData.buckets.values()) {
      assets.push(...timeBucket);
    }

    memories = [
      generateMemory(
        {
          ownerId: adminUserId,
          year: 2024,
          memoryAt: '2024-04-23T00:00:00.000Z',
          showAt: '2026-04-23T00:00:00.000Z',
          title: 'April history',
          subtitle: 'Spring highlights',
          isSaved: true,
        },
        assets.slice(0, 3),
      ),
      generateMemory(
        {
          ownerId: adminUserId,
          year: 2024,
          memoryAt: '2024-03-12T00:00:00.000Z',
          createdAt: '2026-03-12T00:00:00.000Z',
          title: 'March history',
        },
        assets.slice(3, 6),
      ),
    ];
  });

  test.beforeEach(async ({ context }) => {
    await setupBaseMockApiRoutes(context, adminUserId);
    await setupTimelineMockApiRoutes(context, timelineRestData, changes, testContext);
    await setupMemoryMockApiRoutes(context, memories, memoryChanges);
  });

  test.afterEach(() => {
    testContext.slowBucket = false;
    changes.albumAdditions = [];
    changes.assetDeletions = [];
    changes.assetArchivals = [];
    changes.assetFavorites = [];
    memoryChanges.memoryDeletions = [];
    memoryChanges.assetRemovals.clear();
  });

  test('lists memories and opens one in the viewer', async ({ page }) => {
    await page.goto('/memories');

    const memoryLink = page.getByRole('link', { name: /april/i }).first();
    await expect(memoryLink).toBeVisible();

    await memoryLink.click();

    // Upstream's `Route.viewMemory` (web/src/lib/route.ts) scopes the viewer by memory id in the
    // path and carries the initial asset as an `assetId` query param, unlike the fork's old
    // `/memory?id=...&source=history` URL.
    await expect(page).toHaveURL(/\/memories\/[0-9a-f-]{36}\?assetId=/);
    await expect(page.locator('#memory-viewer')).toBeVisible();
  });
});
