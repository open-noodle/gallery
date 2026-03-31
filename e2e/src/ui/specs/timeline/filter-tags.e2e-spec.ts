import { faker } from '@faker-js/faker';
import { BrowserContext, expect, Page, test } from '@playwright/test';
import {
  Changes,
  createDefaultTimelineConfig,
  generateTimelineData,
  TimelineAssetConfig,
  TimelineData,
} from 'src/ui/generators/timeline';
import { setupBaseMockApiRoutes } from 'src/ui/mock-network/base-network';
import { setupTimelineMockApiRoutes, TimelineTestContext } from 'src/ui/mock-network/timeline-network';
import { utils } from 'src/utils';

interface MockTag {
  id: string;
  value: string;
}

function generateTags(count: number): MockTag[] {
  return Array.from({ length: count }, (_, i) => ({
    id: faker.string.uuid(),
    value: `Tag ${i + 1}`,
  }));
}

async function setupTagRoutes(context: BrowserContext, tags: MockTag[]) {
  await context.route('**/api/tags/suggestions*', async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', json: tags });
  });
  await context.route('**/api/people*', async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', json: { total: 0, people: [] } });
  });
  await context.route('**/api/search/suggestions*', async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', json: [] });
  });
}

async function openFilterPanel(page: Page) {
  await page.goto('/photos');
  await page.waitForSelector('#asset-grid');

  // Expand the collapsed filter panel
  const expandBtn = page.getByTestId('expand-panel-btn');
  await expandBtn.click();
}

test.describe.configure({ mode: 'parallel' });
test.describe('Filter Panel - Tags', () => {
  let adminUserId: string;
  let timelineRestData: TimelineData;
  const assets: TimelineAssetConfig[] = [];
  const testContext = new TimelineTestContext();
  const changes: Changes = {
    albumAdditions: [],
    assetDeletions: [],
    assetArchivals: [],
    assetFavorites: [],
  };

  test.beforeAll(async () => {
    test.fail(
      process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS !== '1',
      'This test requires env var: PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1',
    );
    utils.initSdk();
    adminUserId = faker.string.uuid();
    testContext.adminId = adminUserId;
    timelineRestData = generateTimelineData({ ...createDefaultTimelineConfig(), ownerId: adminUserId });
    for (const timeBucket of timelineRestData.buckets.values()) {
      assets.push(...timeBucket);
    }
  });

  test.beforeEach(async ({ context }) => {
    await setupBaseMockApiRoutes(context, adminUserId);
    await setupTimelineMockApiRoutes(context, timelineRestData, changes, testContext);

    // Override user preferences to enable tags (registered after base so it takes priority)
    await context.route('**/users/me/preferences', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          albums: { defaultAssetOrder: 'desc' },
          folders: { enabled: false, sidebarWeb: false },
          memories: { enabled: true, duration: 5 },
          people: { enabled: true, sidebarWeb: false },
          sharedLinks: { enabled: true, sidebarWeb: false },
          ratings: { enabled: false },
          tags: { enabled: true, sidebarWeb: false },
          emailNotifications: { enabled: true, albumInvite: true, albumUpdate: true },
          download: { archiveSize: 4_294_967_296, includeEmbeddedVideos: false },
          purchase: { showSupportBadge: true, hideBuyButtonUntil: '2100-02-12T00:00:00.000Z' },
          cast: { gCastEnabled: false },
        },
      });
    });
  });

  test.afterEach(() => {
    testContext.slowBucket = false;
    changes.albumAdditions = [];
    changes.assetDeletions = [];
    changes.assetArchivals = [];
    changes.assetFavorites = [];
  });

  test('should show search input, truncate to 10, and filter tags', async ({ context, page }) => {
    const tags = generateTags(15);
    await setupTagRoutes(context, tags);
    await openFilterPanel(page);

    // Search input should be visible
    const searchInput = page.getByTestId('tags-search-input');
    await expect(searchInput).toBeVisible();

    // Only first 10 tags should be visible initially
    await expect(page.getByTestId(`tags-item-${tags[9].id}`)).toBeVisible();
    await expect(page.getByTestId(`tags-item-${tags[10].id}`)).not.toBeVisible();

    // "Show 5 more" button
    const showMore = page.getByTestId('tags-show-more');
    await expect(showMore).toContainText('Show 5 more');

    // Type search — all matches visible, no truncation
    await searchInput.fill('Tag 1');
    await expect(page.getByTestId(`tags-item-${tags[0].id}`)).toBeVisible();
    await expect(page.getByTestId(`tags-item-${tags[14].id}`)).toBeVisible();
    await expect(page.getByTestId(`tags-item-${tags[1].id}`)).not.toBeVisible();
    await expect(showMore).not.toBeVisible();
  });

  test('should show "No matching tags" for empty search', async ({ context, page }) => {
    const tags = generateTags(5);
    await setupTagRoutes(context, tags);
    await openFilterPanel(page);

    await page.getByTestId('tags-search-input').fill('nonexistent');
    await expect(page.getByTestId('tags-no-results')).toContainText('No matching tags');
  });

  test('should expand all tags with "Show more"', async ({ context, page }) => {
    const tags = generateTags(12);
    await setupTagRoutes(context, tags);
    await openFilterPanel(page);

    await expect(page.getByTestId(`tags-item-${tags[10].id}`)).not.toBeVisible();
    await page.getByTestId('tags-show-more').click();
    await expect(page.getByTestId(`tags-item-${tags[11].id}`)).toBeVisible();
  });
});
