import { AssetVisibility, getTimeBucket, LoginResponseDto, updateAsset } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils.js';

// Gallery's album filter checks against a real server; upstream's album tests moved to web/test/medium (immich-32879).
test.describe('Album filters (Gallery)', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
  });

  test.beforeEach(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  async function createFilterableAlbum() {
    const albumAsset = await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2024-04-10T10:00:00.000Z',
      fileModifiedAt: '2024-04-10T10:00:00.000Z',
    });
    const secondAlbumAsset = await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2024-03-10T10:00:00.000Z',
      fileModifiedAt: '2024-03-10T10:00:00.000Z',
    });
    const pickerAsset = await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2024-02-10T10:00:00.000Z',
      fileModifiedAt: '2024-02-10T10:00:00.000Z',
    });

    const tags = await utils.upsertTags(admin.accessToken, ['Album Tag', 'Picker Tag']);
    await utils.tagAssets(admin.accessToken, tags[0].id, [albumAsset.id]);
    await utils.tagAssets(admin.accessToken, tags[1].id, [pickerAsset.id]);
    await utils.tagAssets(admin.accessToken, tags[1].id, [albumAsset.id]);
    await updateAsset(
      { id: albumAsset.id, updateAssetDto: { rating: 5 } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    const album = await utils.createAlbum(admin.accessToken, {
      albumName: 'Filterable Album',
      assetIds: [albumAsset.id, secondAlbumAsset.id],
    });

    await expect
      .poll(
        async () => {
          const bucket = await getTimeBucket(
            {
              albumId: album.id,
              tagIds: [tags[1].id],
              timeBucket: '2024-04-01',
              visibility: AssetVisibility.Timeline,
            },
            { headers: asBearerAuth(admin.accessToken) },
          );

          return bucket.id;
        },
        {
          message: 'picker-tagged album asset to be queryable in the album picker timeline',
          timeout: 10_000,
        },
      )
      .toContain(albumAsset.id);

    return { album, tags, albumAsset, secondAlbumAsset, pickerAsset };
  }

  test('filters album detail assets and clears back to the full album', async ({ context, page }) => {
    const { album, tags, albumAsset, secondAlbumAsset, pickerAsset } = await createFilterableAlbum();
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/albums/${album.id}`);
    await page.waitForSelector('[data-testid="discovery-panel"]');

    await expect(page.locator(`[data-asset="${albumAsset.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-asset="${secondAlbumAsset.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-asset="${pickerAsset.id}"]`)).toHaveCount(0);

    const bucketResponse = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await page.locator(`[data-testid="tags-item-${tags[0].id}"]`).click();
    await bucketResponse;

    await expect(page.locator('[data-testid="active-filters-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="active-chip"]')).toContainText('Album Tag');
    await expect(page.locator('[data-testid="result-count"]')).toContainText('1 result');
    await expect(page.locator(`[data-asset="${albumAsset.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-asset="${secondAlbumAsset.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-asset="${pickerAsset.id}"]`)).toHaveCount(0);

    const clearResponse = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await page.locator('[data-testid="clear-all-btn"]').click({ force: true });
    await clearResponse;

    await expect(page.locator('[data-testid="active-filters-bar"]')).not.toBeVisible();
    await expect(page.locator(`[data-asset="${albumAsset.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-asset="${secondAlbumAsset.id}"]`)).toHaveCount(1);
  });

  test('reuses album filters for select cover but keeps a separate picker state for add assets', async ({
    context,
    page,
  }) => {
    const { album, tags, albumAsset, secondAlbumAsset, pickerAsset } = await createFilterableAlbum();
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/albums/${album.id}`);
    await page.waitForSelector('[data-testid="discovery-panel"]');

    const viewFilterResponse = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await page.locator(`[data-testid="tags-item-${tags[0].id}"]`).click();
    await viewFilterResponse;
    await expect(page.locator('[data-testid="active-chip"]')).toContainText('Album Tag');
    await expect(page.locator(`[data-asset="${albumAsset.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-asset="${secondAlbumAsset.id}"]`)).toHaveCount(0);

    await page.getByLabel('Album options').click();
    await page.getByText('Select album cover').click();
    await expect(page.locator('[data-testid="active-chip"]')).toContainText('Album Tag');
    await expect(page.locator(`[data-asset="${albumAsset.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-asset="${secondAlbumAsset.id}"]`)).toHaveCount(0);

    await page.getByLabel('Close').click();
    await page.getByLabel('Add photos').click();
    await expect(page.locator('[data-testid="active-chip"]')).toHaveCount(0);
    await expect(page.locator(`[data-asset="${pickerAsset.id}"]`)).toHaveCount(1);
    const pickerFilterResponse = page.waitForResponse((r) => r.url().includes('/timeline/buckets'));
    await page.locator(`[data-testid="tags-item-${tags[1].id}"]`).click();
    await pickerFilterResponse;
    await expect(page.locator('[data-testid="active-chip"]')).toContainText('Picker Tag');
    await expect(page.locator(`[data-asset="${pickerAsset.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-asset="${albumAsset.id}"]:not([data-disabled="true"])`)).toHaveCount(0);
    await expect(page.locator(`[data-asset="${secondAlbumAsset.id}"]`)).toHaveCount(0);

    await page.getByLabel('Close').click();
    await expect(page.locator('[data-testid="active-chip"]')).toContainText('Album Tag');
    await expect(page.locator(`[data-asset="${albumAsset.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-asset="${secondAlbumAsset.id}"]`)).toHaveCount(0);

    await page.getByLabel('Add photos').click();
    await expect(page.locator('[data-testid="active-chip"]')).toContainText('Picker Tag');
    await expect(page.locator(`[data-asset="${pickerAsset.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-asset="${albumAsset.id}"]:not([data-disabled="true"])`)).toHaveCount(0);
  });
});
