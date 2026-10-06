import { AssetMediaResponseDto, LoginResponseDto, SharedSpaceResponseDto, SharedSpaceRole } from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { thumbnailUtils } from 'src/ui/specs/timeline/utils';
import { utils } from 'src/utils';

// Web E2E for the literal #763 scenario: a space VIEWER (non-owner) favorites a photo they don't
// own, through the browser UI. Slice-5 (web Tasks 1-2, commits 6a8163181e/9a3195516e/867301fd23)
// un-gated the heart from ownership everywhere and switched the write path to
// `PUT /assets/favorites` (per-user favorites, server-side since slice 2). Before that change,
// both entry points below were hard-gated to `isOwner` and simply didn't render for a viewer.
//
// Two entry points, matching the two write paths slice 5 un-gated:
//   A) the asset viewer's Favorite/Unfavorite action button (AssetViewerNavBar / asset.service.ts)
//   B) the timeline multi-select bar's Favorite button (FavoriteAction.svelte)
//
// Each test builds its own space + owner-uploaded asset + viewer membership via the API so the
// two tests never depend on one another's mutated favorite state (spaces-albums-timeline.e2e-spec.ts
// convention). Role-text assertions elsewhere in this suite use `{ ignoreCase: true }` because the
// space role badge renders lowercase with CSS capitalize — noted here as this spec doesn't assert
// role text directly but reuses the same fixture idiom.

// Navigates and waits for the initial `/timeline/buckets` fetch the destination page's Timeline
// component fires on mount, so a subsequent interaction isn't racing the load.
async function gotoAndWaitForTimeline(page: Page, url: string, readyTestId?: string) {
  const bucketsResponse = page.waitForResponse((response) => response.url().includes('/timeline/buckets'));
  await page.goto(url);
  await bucketsResponse;
  if (readyTestId) {
    await page.waitForSelector(`[data-testid="${readyTestId}"]`);
  }
}

async function createSpaceWithViewerAsset(
  ownerToken: string,
  viewerId: string,
  namePrefix: string,
): Promise<{ space: SharedSpaceResponseDto; asset: AssetMediaResponseDto }> {
  const space = await utils.createSpace(ownerToken, { name: `${namePrefix} Space` });
  await utils.addSpaceMember(ownerToken, space.id, { userId: viewerId, role: SharedSpaceRole.Viewer });
  const asset = await utils.createAsset(ownerToken);
  await utils.addSpaceAssets(ownerToken, space.id, [asset.id]);
  return { space, asset };
}

test.describe('Space viewer favorites a non-owned photo (#763)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let viewer: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [owner, viewer] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('svf-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('svf-viewer')),
    ]);
  });

  // A) Asset viewer: open the non-owned photo from the space, favorite it via the navbar action,
  // reload to prove server-side persistence (not just optimistic client state), and confirm via
  // API that the owner's own favorite state was never touched (per-user write, not a shared field).
  test('viewer favorites the photo from the asset viewer; state persists and the owner is unaffected', async ({
    context,
    page,
  }) => {
    const { space, asset } = await createSpaceWithViewerAsset(owner.accessToken, viewer.userId, 'SVF-A');
    await utils.setAuthCookies(context, viewer.accessToken);

    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`, 'discovery-timeline');
    await thumbnailUtils.withAssetId(page, asset.id).click();
    await page.waitForURL(`/spaces/${space.id}/photos/${asset.id}`);
    await page.waitForSelector('#immich-asset-viewer');

    const navActions = page.getByTestId('asset-viewer-navbar-actions');
    const favoriteButton = navActions.getByRole('button', { name: 'Favorite', exact: true });
    const unfavoriteButton = navActions.getByRole('button', { name: 'Unfavorite', exact: true });

    // Pre-slice-5 this action was ownership-gated and would not render at all for a non-owner.
    await expect(favoriteButton).toBeVisible();
    await expect(unfavoriteButton).toHaveCount(0);

    const favoriteResponse = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().includes('/assets/favorites'),
    );
    await favoriteButton.click();
    await favoriteResponse;
    await expect(page.getByText('Added to favorites')).toBeVisible();

    // Reload: prove the Unfavorite state came back from the server, not just client-side optimism.
    await page.reload();
    await page.waitForSelector('#immich-asset-viewer');
    await expect(
      page.getByTestId('asset-viewer-navbar-actions').getByRole('button', { name: 'Unfavorite', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId('asset-viewer-navbar-actions').getByRole('button', { name: 'Favorite', exact: true }),
    ).toHaveCount(0);

    // The write is scoped to the viewer: the owner's own favorite state must be untouched.
    const ownerAssetInfo = await utils.getAssetInfo(owner.accessToken, asset.id);
    expect(ownerAssetInfo.isFavorite).toBe(false);
  });

  // B) Timeline multi-select bar: hover-select the non-owned photo on the space Photos tab and
  // favorite it from the selection bar (previously hidden entirely for a non-owned selection).
  test('viewer favorites the photo via the space timeline multi-select bar', async ({ context, page }) => {
    const { space, asset } = await createSpaceWithViewerAsset(owner.accessToken, viewer.userId, 'SVF-B');
    await utils.setAuthCookies(context, viewer.accessToken);

    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`, 'discovery-timeline');

    const thumb = thumbnailUtils.withAssetId(page, asset.id);
    await expect(thumb).toBeVisible();
    await thumb.hover();
    await thumbnailUtils.selectButton(page, asset.id).click();

    // Pre-slice-5 the heart was hidden from the selection bar for a non-owned selection.
    const favoriteButton = page.getByRole('button', { name: 'Favorite', exact: true });
    await expect(favoriteButton).toBeVisible();

    const favoriteResponse = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().includes('/assets/favorites'),
    );
    await favoriteButton.click();
    await favoriteResponse;

    await expect(page.getByText('Added 1 to favorites')).toBeVisible();
    await thumbnailUtils.expectThumbnailIsFavorite(page, asset.id);
  });

  // C) The reported pr-819-rc.1 bug, end to end: favoriting a non-owned photo succeeded (toast +
  // filled heart) but /favorites rendered its empty placeholder, so the feature was unusable for
  // exactly the account it exists for. Tests A and B stop at the write and the heart, which is why
  // they stayed green through it.
  //
  // The break this catches: the /favorites page requesting the timeline without `withSharedSpaces`
  // (or `withPartners`). The server only resolves `timelineSpaceIds` when that flag is present;
  // without it the query hard-filters `asset.ownerId = caller` and every favorite on a non-owned
  // asset vanishes from the page while its `asset_favorite` row survives untouched.
  test("the favorited non-owned photo appears on the viewer's /favorites page", async ({ context, page }) => {
    const { space, asset } = await createSpaceWithViewerAsset(owner.accessToken, viewer.userId, 'SVF-C');
    await utils.setAuthCookies(context, viewer.accessToken);

    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`, 'discovery-timeline');
    const favoriteResponse = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().includes('/assets/favorites'),
    );
    const thumb = thumbnailUtils.withAssetId(page, asset.id);
    await thumb.hover();
    await thumbnailUtils.selectButton(page, asset.id).click();
    await page.getByRole('button', { name: 'Favorite', exact: true }).click();
    await favoriteResponse;
    await expect(page.getByText('Added 1 to favorites')).toBeVisible();

    // The collection view, not the asset — this is the assertion the shipped bug failed.
    await gotoAndWaitForTimeline(page, '/favorites');
    await expect(thumbnailUtils.withAssetId(page, asset.id)).toBeVisible();

    // The owner never favorited it, so their own /favorites page must stay empty — proving the page
    // is per-user and not merely showing every space asset.
    await utils.setAuthCookies(context, owner.accessToken);
    await gotoAndWaitForTimeline(page, '/favorites');
    await expect(thumbnailUtils.withAssetId(page, asset.id)).toHaveCount(0);
  });
});
