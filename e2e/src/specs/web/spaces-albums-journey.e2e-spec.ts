import {
  AlbumResponseDto,
  AlbumUserRole,
  AssetMediaResponseDto,
  LoginResponseDto,
  SharedSpaceResponseDto,
  SharedSpaceRole,
} from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';

// Web E2E: the space-albums navigation JOURNEY, asserted by CLICKING the real
// nav chain (never page.goto to a deep URL), per role. Rows = Owner/Editor/
// Viewer/Stranger; columns = sidebar Spaces link -> /spaces list -> space ->
// Albums tab -> album card -> photo, plus per-role control gating.
//
// Gating for editor/viewer also lives in spaces-albums.e2e-spec.ts and
// permission-matrix.e2e-spec.ts; it is re-asserted here so this spec is the
// self-contained source of truth for the matrix.
//
// These tests characterize EXISTING behavior — they should PASS against a
// working app. A failure is a discovered wiring/permission defect to triage.

const ALBUM_NAME = 'Journey Linked Album';

// ─── Funnel helpers — each performs ONE hop and asserts the result ─────────

// Hop 1: click the left-nav Spaces link (the established spaces-sidebar
// pattern — page.locator('nav').getByRole('link', { name: 'Spaces' })) and
// land on /spaces. No data-testid: @immich/ui NavbarItem doesn't forward one.
async function gotoSpacesList(page: Page) {
  await page.locator('nav').getByRole('link', { name: 'Spaces' }).click();
  await page.waitForURL('/spaces');
}

// Hops 2–3: the space is listed for this member; click it -> space detail.
// Scoped to <main> (UserPageLayout) so the sidebar recent-spaces link cannot
// match. The href anchor is view-agnostic: both the default card grid and the
// table view render an <a href="/spaces/:id">.
async function openSpaceFromList(page: Page, spaceId: string) {
  const link = page.locator('main').locator(`a[href$="/spaces/${spaceId}"]`).first();
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(`/spaces/${spaceId}`);
}

// Hop 4: click the Albums tab.
async function openAlbumsTab(page: Page, spaceId: string) {
  await page.getByTestId('space-tab-albums').click();
  await page.waitForURL(`/spaces/${spaceId}/albums`);
}

// Hop 6: click the linked album's card -> album detail.
async function openAlbumCard(page: Page, spaceId: string, name: string) {
  await page.getByTestId('space-album-card-link').filter({ hasText: name }).click();
  await page.waitForURL(new RegExp(`/spaces/${spaceId}/albums/[^/]+$`));
}

// Hop 7: the known asset thumbnail renders; click it -> asset viewer.
async function openPhoto(page: Page, assetId: string) {
  const thumb = page.locator(`[data-thumbnail-focus-container][data-asset="${assetId}"]`);
  await expect(thumb).toBeVisible();
  await thumb.click();
  await page.waitForURL(new RegExp(`/photos/${assetId}$`));
  await page.waitForSelector('#immich-asset-viewer');
  await expect(page.locator('#immich-asset-viewer')).toBeVisible();
}

// Stranger: assert a deep URL is blocked (403 ∨ redirect ∨ blocked text).
// SvelteKit serves a 200 shell and renders the error client-side, so a 403
// status may not surface; the disjunction matches permission-matrix Test 7.
async function expectBlockedAt(page: Page, url: string) {
  const response = await page.goto(url);
  await page.waitForLoadState('networkidle');
  const is403 = response?.status() === 403;
  const redirectedAway = !page.url().includes(url);
  let blockedText = false;
  try {
    blockedText = await page
      .locator('text=/access denied|not found|no access|not a member|http 403/i')
      .first()
      .isVisible();
  } catch {
    // locator resolution can race with the client-side error render
  }
  expect(is403 || redirectedAway || blockedText).toBeTruthy();
}

test.describe('Spaces — Albums UI journey & permission matrix', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let stranger: LoginResponseDto;
  let space: SharedSpaceResponseDto;
  let album: AlbumResponseDto;
  let asset!: AssetMediaResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    [owner, editor, viewer, stranger] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('journey-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('journey-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('journey-viewer')),
      utils.userSetup(admin.accessToken, createUserDto.create('journey-stranger')),
    ]);

    // Space owned by `owner`; editor + viewer are members; stranger is NOT.
    space = await utils.createSpace(owner.accessToken, { name: 'Journey Test Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId, role: SharedSpaceRole.Viewer });

    // One asset owned by `owner` so the album is non-empty.
    asset = await utils.createAsset(owner.accessToken);

    // Album owned by `owner`, with `editor` as album Editor (mirrors the
    // spaces-albums fixture), the asset attached, then linked into the space.
    // NOTE: `viewer` has NO album_user share — so a viewer reaching the album
    // and its photos proves access flows purely through the space grant.
    album = await utils.createAlbum(owner.accessToken, {
      albumName: ALBUM_NAME,
      albumUsers: [{ userId: editor.userId, role: AlbumUserRole.Editor }],
      assetIds: [asset.id],
    });
    await utils.linkSpaceAlbum(owner.accessToken, space.id, album.id);
  });

  // ─── Member journeys (positive funnel + gating) ────────────────────────────

  test('owner walks sidebar → space → album → photo and sees manage controls', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto('/photos');

    await gotoSpacesList(page); // hop 1
    await openSpaceFromList(page, space.id); // hops 2–3
    // hero-role-badge renders the RAW enum ('owner') with CSS `capitalize`,
    // which does NOT change textContent — so match case-insensitively.
    await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('owner', { ignoreCase: true });

    await openAlbumsTab(page, space.id); // hop 4
    // hop 5: linked album card present.
    await expect(page.getByTestId('space-album-card-link').filter({ hasText: ALBUM_NAME })).toBeVisible();
    // hop 8: owner gating @ grid — link button + card ⋮ menu. The menu is
    // rendered only when canManage but is opacity-0 until hover; assert it is
    // ATTACHED (present in the DOM) — the precise intent ("the control exists
    // for this role") and unambiguous vs. the opacity-0 visibility edge.
    await expect(page.getByTestId('link-album-button')).toBeVisible();
    await expect(page.getByTestId('space-album-card-menu')).toBeAttached();

    await openAlbumCard(page, space.id, ALBUM_NAME); // hop 6
    // hop 9: owner gating @ detail — add-photos button present.
    await expect(page.getByTestId('add-photos-button')).toBeVisible();

    await openPhoto(page, asset.id); // hop 7
  });

  test('editor walks the journey and sees manage controls', async ({ context, page }) => {
    await utils.setAuthCookies(context, editor.accessToken);
    await page.goto('/photos');

    await gotoSpacesList(page); // hop 1
    await openSpaceFromList(page, space.id); // hops 2–3
    await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('editor', { ignoreCase: true });

    await openAlbumsTab(page, space.id); // hop 4
    await expect(page.getByTestId('space-album-card-link').filter({ hasText: ALBUM_NAME })).toBeVisible(); // hop 5
    // hop 8: editor gating @ grid (space Editor role → canManage). Card menu is
    // opacity-0 until hover, so assert ATTACHED (present), not visible.
    await expect(page.getByTestId('link-album-button')).toBeVisible();
    await expect(page.getByTestId('space-album-card-menu')).toBeAttached();

    await openAlbumCard(page, space.id, ALBUM_NAME); // hop 6
    await expect(page.getByTestId('add-photos-button')).toBeVisible(); // hop 9

    await openPhoto(page, asset.id); // hop 7
  });

  test('viewer walks the journey, reaches photos via the space grant, sees NO manage controls', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, viewer.accessToken);
    await page.goto('/photos');

    await gotoSpacesList(page); // hop 1
    await openSpaceFromList(page, space.id); // hops 2–3
    await expect(page.locator('[data-testid="hero-role-badge"]')).toContainText('viewer', { ignoreCase: true });

    await openAlbumsTab(page, space.id); // hop 4
    // hop 5: viewer SEES the album (read access via the space grant; viewer has
    // no album_user share).
    await expect(page.getByTestId('space-album-card-link').filter({ hasText: ALBUM_NAME })).toBeVisible();
    // hop 8: viewer gating @ grid — link button + card menu NOT rendered (canManage=false).
    await expect(page.getByTestId('link-album-button')).toHaveCount(0);
    await expect(page.getByTestId('space-album-card-menu')).toHaveCount(0);

    await openAlbumCard(page, space.id, ALBUM_NAME); // hop 6
    // hop 9: viewer gating @ detail — add-photos button NOT rendered.
    await expect(page.getByTestId('add-photos-button')).toHaveCount(0);

    await openPhoto(page, asset.id); // hop 7 — proves photo access via the space grant
  });

  test('stranger does not see the space and is blocked at every space-albums depth', async ({ context, page }) => {
    await utils.setAuthCookies(context, stranger.accessToken);

    // The space must NOT appear in the stranger's /spaces list.
    await page.goto('/spaces');
    await expect(page.locator('main').locator(`a[href$="/spaces/${space.id}"]`)).toHaveCount(0);

    // All four depths are blocked — the [spaceId] layout load returns 403 for
    // non-members before any child route renders.
    await expectBlockedAt(page, `/spaces/${space.id}`);
    await expectBlockedAt(page, `/spaces/${space.id}/albums`);
    await expectBlockedAt(page, `/spaces/${space.id}/albums/${album.id}`);
    await expectBlockedAt(page, `/spaces/${space.id}/albums/${album.id}/photos/${asset.id}`);
  });
});
