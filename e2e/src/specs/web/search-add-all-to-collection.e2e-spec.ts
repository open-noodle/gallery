import {
  getAlbumInfo,
  getSpace,
  type AlbumResponseDto,
  type LoginResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

// E2E for the "add all filter results to album/space" feature on the search page.
//
// A header button ("Add all N to…") on the search-results page collects every
// asset matching the current filter (by paging the search API) and adds them to
// the chosen album/space via the existing CollectionPickerModal — without the
// user hand-selecting anything.
//
// Machine learning is disabled in the e2e stack, so smart/CLIP search returns
// nothing. We therefore drive a *metadata* filter (`isFavorite`) which returns
// the seeded assets deterministically. A non-favorite asset is also seeded to
// prove the feature adds only the filter matches, not the whole library.

const MATCHING_COUNT = 3;
const SEARCH_QUERY = encodeURIComponent(JSON.stringify({ isFavorite: true }));

/** Clicks the "Add all …" header button and returns the opened picker dialog. */
async function openAddAllPicker(page: Page) {
  const addAll = page.getByTestId('add-all-to-collection');
  await expect(addAll).toBeVisible({ timeout: 15_000 });
  await addAll.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Wait for the album/space loading skeleton to disappear.
  await expect(dialog.locator('.animate-pulse').first()).not.toBeVisible({ timeout: 10_000 });
  return dialog;
}

test.describe('Search — add all filter results to album/space', () => {
  let admin: LoginResponseDto;
  let album: AlbumResponseDto;
  let space: SharedSpaceResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Seed favorited assets that the `{ isFavorite: true }` filter matches.
    for (let i = 0; i < MATCHING_COUNT; i++) {
      await utils.createAsset(admin.accessToken, {
        isFavorite: true,
        fileCreatedAt: `2024-06-0${i + 1}T10:00:00.000Z`,
        fileModifiedAt: `2024-06-0${i + 1}T10:00:00.000Z`,
      });
    }
    // A non-matching asset that must NOT be added by "add all".
    await utils.createAsset(admin.accessToken, {
      fileCreatedAt: '2024-07-01T10:00:00.000Z',
      fileModifiedAt: '2024-07-01T10:00:00.000Z',
    });

    album = await utils.createAlbum(admin.accessToken, { albumName: 'All Favorites' });
    space = await utils.createSpace(admin.accessToken, { name: 'Favorite Space' });
  });

  test('adds every matching result to an album (and excludes non-matches)', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/search?query=${SEARCH_QUERY}`);

    const dialog = await openAddAllPicker(page);

    // Single-click the album row → collect all filter results → add → close.
    await dialog.locator(`[data-testid="row-album-${album.id}"]`).first().click();

    await expect
      .poll(
        async () => {
          const info = await getAlbumInfo({ id: album.id }, { headers: asBearerAuth(admin.accessToken) });
          return info.assetCount;
        },
        { message: 'album should contain exactly the favorite filter results', timeout: 15_000 },
      )
      .toBe(MATCHING_COUNT);
  });

  test('adds every matching result to a space', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/search?query=${SEARCH_QUERY}`);

    const dialog = await openAddAllPicker(page);

    await dialog.locator(`[data-testid="row-space-${space.id}"]`).first().click();

    await expect
      .poll(
        async () => {
          const info = await getSpace({ id: space.id }, { headers: asBearerAuth(admin.accessToken) });
          return info.assetCount ?? 0;
        },
        { message: 'space should contain exactly the favorite filter results', timeout: 15_000 },
      )
      .toBe(MATCHING_COUNT);
  });
});
