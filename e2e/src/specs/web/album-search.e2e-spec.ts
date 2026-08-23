import type { AlbumResponseDto, LoginResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { utils } from 'src/utils';

/**
 * #986 — page-aware search on the two album detail routes.
 *
 * Before this, searching from inside an album navigated to `/photos` and ran the query against the
 * caller's whole library. A space page searched its space correctly; a space album did not.
 *
 * SCOPE NOTE, same as photos-search.e2e-spec.ts: the e2e stack runs with
 * `IMMICH_MACHINE_LEARNING_ENABLED=false`, so `/search/smart` always trips the "Smart search is not
 * enabled" gate and returns no real CLIP results. That is fine here — every assertion below is
 * about the DESTINATION and the URL/UI plumbing, which is exactly where the reported bug lived. The
 * server-side album scoping (`albumIds` dropping the owner-scoping `userIds`, so a shared album
 * returns every member's matches) is covered at the API layer instead; it cannot be reached through
 * the UI while ML is off.
 */

async function submitGlobalSearch(page: Page, query: string) {
  const mobileSearchButton = page.locator('#search-button');
  await ((await mobileSearchButton.isVisible()) ? mobileSearchButton.click() : page.keyboard.press('Control+k'));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const combobox = dialog.getByRole('combobox');
  await combobox.fill(query);
  await combobox.press('Enter');
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

/** SmartSearchResults settles into one of these once its (ML-disabled) call resolves. */
async function expectSearchSurfaceSettled(page: Page) {
  await expect(page.getByTestId('result-count').or(page.getByTestId('search-empty'))).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Album page-aware search', () => {
  let admin: LoginResponseDto;
  let album: AlbumResponseDto;
  let space: SharedSpaceResponseDto;
  let spaceAlbum: AlbumResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    const [assetOne, assetTwo] = await Promise.all([
      utils.createAsset(admin.accessToken),
      utils.createAsset(admin.accessToken),
    ]);

    album = await utils.createAlbum(admin.accessToken, {
      albumName: 'Search Target Album',
      assetIds: [assetOne.id, assetTwo.id],
    });

    space = await utils.createSpace(admin.accessToken, { name: 'Search Target Space' });
    spaceAlbum = await utils.createAlbum(admin.accessToken, {
      albumName: 'Search Target Space Album',
      assetIds: [assetOne.id],
    });
    await utils.linkSpaceAlbum(admin.accessToken, space.id, spaceAlbum.id);
  });

  const goto = async (context: BrowserContext, page: Page, path: string) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(path);
    await page.waitForSelector('[data-testid="discovery-panel"], [data-testid="collapsed-icon-strip"]');
  };

  test('searching from an album stays on that album instead of going to /photos', async ({ context, page }) => {
    await goto(context, page, `/albums/${album.id}`);

    await submitGlobalSearch(page, 'beach');

    await expect(page).toHaveURL(new RegExp(String.raw`/albums/${album.id}\?q=beach`), { timeout: 10_000 });
  });

  // The reported bug: this one used to land on /photos and search the whole library.
  test('searching from a space album stays on that space album instead of going to /photos', async ({
    context,
    page,
  }) => {
    await goto(context, page, `/spaces/${space.id}/albums/${spaceAlbum.id}`);

    await submitGlobalSearch(page, 'beach');

    await expect(page).toHaveURL(new RegExp(String.raw`/spaces/${space.id}/albums/${spaceAlbum.id}\?q=beach`), {
      timeout: 10_000,
    });
  });

  test('a query on an album replaces the browse timeline with the search surface', async ({ context, page }) => {
    await goto(context, page, `/albums/${album.id}?q=mountain`);

    await expectSearchSurfaceSettled(page);
    await expect(page.locator('[data-testid="timeline"]')).not.toBeVisible();
    await expect(page.getByTestId('search-chip')).toContainText('mountain');
  });

  test('a query on a space album replaces the browse timeline with the search surface', async ({ context, page }) => {
    await goto(context, page, `/spaces/${space.id}/albums/${spaceAlbum.id}?q=mountain`);

    await expectSearchSurfaceSettled(page);
    await expect(page.getByTestId('search-chip')).toContainText('mountain');
  });

  test('clearing the search chip drops q= and restores the album timeline', async ({ context, page }) => {
    await goto(context, page, `/albums/${album.id}?q=forest`);
    await expectSearchSurfaceSettled(page);

    // The header is absolutely positioned over the content area, so Playwright's auto-scroll lands
    // the chip under it — dispatchEvent bypasses the intercept check. Same reason as photos-search.
    await page.getByTestId('search-chip-close').dispatchEvent('click');

    await expect(page).toHaveURL(new RegExp(String.raw`/albums/${album.id}(?!\?q=)`));
    await expect(page.getByTestId('search-chip')).not.toBeVisible();
  });

  test('clearing the search chip on a space album drops q=', async ({ context, page }) => {
    await goto(context, page, `/spaces/${space.id}/albums/${spaceAlbum.id}?q=forest`);
    await expectSearchSurfaceSettled(page);

    await page.getByTestId('search-chip-close').dispatchEvent('click');

    await expect(page).toHaveURL(new RegExp(String.raw`/spaces/${space.id}/albums/${spaceAlbum.id}(?!\?q=)`));
    await expect(page.getByTestId('search-chip')).not.toBeVisible();
  });

  // Regression guard for the crash class fixed alongside this feature: search mode unmounts
  // <Timeline> and destroys its manager, and the page's Escape handler dereferenced it unguarded.
  // On a directly-loaded ?q= URL the manager never existed, so Escape threw before doing anything.
  test('Escape on a searched album clears the search rather than erroring', async ({ context, page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error);
    });

    await goto(context, page, `/albums/${album.id}?q=sunset`);
    await expectSearchSurfaceSettled(page);

    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(new RegExp(String.raw`/albums/${album.id}(?!\?q=)`), { timeout: 10_000 });
    expect(pageErrors.map((error) => error.message)).toEqual([]);
  });

  // A query and a filter coexist on an album: the page hydrates BOTH from the URL and hands the
  // filter to the search rather than to the (unmounted) browse timeline. Asserted by navigation
  // rather than by clicking a control — which sections of the filter panel are expanded is
  // persisted per user, so driving one would be brittle here. The click-through path is unit-tested
  // on both pages.
  test('hydrates a query and a filter together on an album', async ({ context, page }) => {
    await goto(context, page, `/albums/${album.id}?q=sunset&rating=5`);

    await expectSearchSurfaceSettled(page);
    await expect(page.getByTestId('search-chip')).toContainText('sunset');
    await expect(page.getByTestId('active-filters-bar')).toBeVisible();
  });

  test('an album search survives a reload as a shareable URL', async ({ context, page }) => {
    await goto(context, page, `/albums/${album.id}?q=harbour`);
    await expectSearchSurfaceSettled(page);

    await page.reload();

    await expectSearchSurfaceSettled(page);
    await expect(page.getByTestId('search-chip')).toContainText('harbour');
  });
});
