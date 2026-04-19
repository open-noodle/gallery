import { SharedSpaceRole, type LoginResponseDto } from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';

const openPalette = async (page: Page) => {
  await page.getByTestId('cmdk-trigger').waitFor({ state: 'visible' });
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
};

// Task 30 — cmdk v1.4 context commands + destructive confirm E2E.
//
// Covers the album/space context-aware verbs and the inline two-step Enter
// UX. Fixtures create an owner + member user and reuse them across tests to
// keep the spec fast; per-test state (deletable album/space) is scoped inside
// each test.
test.describe('cmdk context commands (v1.4)', () => {
  let owner: LoginResponseDto;
  let member: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    const admin = await utils.adminSetup();
    owner = await utils.userSetup(admin.accessToken, createUserDto.user1);
    member = await utils.userSetup(admin.accessToken, createUserDto.user2);
  });

  test('Case 1 — album context: owner sees rename/share/download/delete, not leave', async ({ context, page }) => {
    const album = await utils.createAlbum(owner.accessToken, { albumName: 'Case1 Album' });
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/albums/${album.id}`);
    const dialog = await openPalette(page);
    await dialog.getByRole('combobox').fill('>');
    await expect(dialog.locator('[data-cmdk-commands-section]')).toBeVisible();
    await expect(dialog.getByText(/Rename this album/i)).toBeVisible();
    await expect(dialog.getByText(/Share this album/i)).toBeVisible();
    await expect(dialog.getByText(/Download this album/i)).toBeVisible();
    await expect(dialog.getByText(/Delete this album/i)).toBeVisible();
    // Owners don't "leave" their own album.
    await expect(dialog.getByText(/Leave this shared album/i)).toHaveCount(0);
  });

  test('Case 2 — context hidden off-route: no album/space verbs on /photos', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto('/photos');
    const dialog = await openPalette(page);
    await dialog.getByRole('combobox').fill('>');
    await expect(dialog.locator('[data-cmdk-commands-section]')).toBeVisible();
    await expect(dialog.getByText(/this album/i)).toHaveCount(0);
    await expect(dialog.getByText(/this space/i)).toHaveCount(0);
  });

  test('Case 3 — ownership gating: member sees leave, not delete/rename/share', async ({ context, page }) => {
    const album = await utils.cmdkCreateAndShareAlbum(owner.accessToken, member.userId, 'Case3 Album');
    await utils.setAuthCookies(context, member.accessToken);
    await page.goto(`/albums/${album.id}`);
    const dialog = await openPalette(page);
    await dialog.getByRole('combobox').fill('>');
    await expect(dialog.locator('[data-cmdk-commands-section]')).toBeVisible();
    await expect(dialog.getByText(/Leave this shared album/i)).toBeVisible();
    await expect(dialog.getByText(/Delete this album/i)).toHaveCount(0);
    await expect(dialog.getByText(/Rename this album/i)).toHaveCount(0);
    await expect(dialog.getByText(/Share this album/i)).toHaveCount(0);
  });

  test('Case 4 — destructive happy path: first Enter arms, second Enter deletes', async ({ context, page }) => {
    const albumName = 'Case4 Doomed Album';
    const album = await utils.createAlbum(owner.accessToken, { albumName });
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/albums/${album.id}`);
    const dialog = await openPalette(page);
    await dialog.getByRole('combobox').fill('>delete');
    await expect(dialog.locator('[data-cmdk-commands-section]')).toBeVisible();
    await expect(dialog.getByText(/Delete this album/i)).toBeVisible();

    // First Enter arms the confirm. Palette stays open, hint text replaces description.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Press Enter again to confirm/i)).toBeVisible();

    // Second Enter fires the delete + redirect.
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/albums$/);
    // Deleted album is absent from the list. Poll because the albums page
    // re-fetches after the redirect; the SWR render may show stale data briefly.
    await expect
      .poll(async () => page.locator('[data-testid="album-name"]').filter({ hasText: albumName }).count(), {
        timeout: 5000,
      })
      .toBe(0);
  });

  test('Case 5 — destructive Esc cancels: palette stays open, album survives', async ({ context, page }) => {
    const albumName = 'Case5 Survivor Album';
    const album = await utils.createAlbum(owner.accessToken, { albumName });
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/albums/${album.id}`);
    const dialog = await openPalette(page);
    await dialog.getByRole('combobox').fill('>delete');
    await expect(dialog.getByText(/Delete this album/i)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog.getByText(/Press Enter again to confirm/i)).toBeVisible();

    // First Escape cancels pending. Palette still open, hint gone.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Press Enter again to confirm/i)).toHaveCount(0);

    // Second Escape closes palette. Album still exists on /albums.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.goto('/albums');
    await expect(page.getByText(albumName).first()).toBeVisible();
  });

  test('Case 7 — close-on-navigate: palette is gone after a route change', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto('/photos');
    const dialog = await openPalette(page);
    await expect(dialog).toBeVisible();
    // SPA-level navigation via the browser history API (dispatched inside the page
    // context so SvelteKit's client-side router handles it and afterNavigate fires).
    await page.evaluate(() => {
      globalThis.history.pushState({}, '', '/albums');
      globalThis.dispatchEvent(new PopStateEvent('popstate'));
    });
    // Belt-and-braces: confirm the SPA nav actually landed, then assert the
    // dialog is gone. Without the URL check a dialog closing for an unrelated
    // reason would still pass.
    await expect(page).toHaveURL(/\/albums$/);
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5000 });
  });

  test('Case 8 — sub-route context: space verbs show on /spaces/[id]/people', async ({ context, page }) => {
    const space = await utils.createSpace(owner.accessToken, { name: 'Case8 Space' });
    await utils.setAuthCookies(context, owner.accessToken);
    await page.goto(`/spaces/${space.id}/people`);
    const dialog = await openPalette(page);
    await dialog.getByRole('combobox').fill('>');
    await expect(dialog.locator('[data-cmdk-commands-section]')).toBeVisible();
    await expect(dialog.getByText(/Delete this space/i)).toBeVisible();
    await expect(dialog.getByText(/Manage space members/i)).toBeVisible();
  });

  test('Case 9 — space leave: member leaves shared space, redirects to /spaces', async ({ context, page }) => {
    const space = await utils.createSpace(owner.accessToken, { name: 'Case9 Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: member.userId,
      role: SharedSpaceRole.Editor,
    });
    await utils.setAuthCookies(context, member.accessToken);
    await page.goto(`/spaces/${space.id}`);
    const dialog = await openPalette(page);
    await dialog.getByRole('combobox').fill('>leave');
    await expect(dialog.getByText(/Leave this space/i)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog.getByText(/Press Enter again to confirm/i)).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/spaces$/);
  });
});
