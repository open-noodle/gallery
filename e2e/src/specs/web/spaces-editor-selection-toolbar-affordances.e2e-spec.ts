import { LoginResponseDto, SharedSpaceRole, type SharedSpaceResponseDto } from '@immich/sdk';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { thumbnailUtils } from 'src/ui/specs/timeline/utils';
import { utils } from 'src/utils';

// Web E2E: closes the #992 audit gap for the space timeline's multi-select toolbar — the higher
// value of the two surfaces this gap covers, because this path round-trips through a real
// `POST /assets/editable` call behind a 250ms debounce (`SelectionToolbar.svelte`'s resolution
// effect) before `getSelectionCapabilities` (`selection-capabilities.ts`) decides what to render.
// That's the most moving parts of anything #734/#992 touched, and the part least covered by
// anything else: the medium/unit/component-with-a-prop layers all either skip the network hop
// entirely or supply its result as a given.
//
// Fixture: Bob is a space member (Editor role, so he can add his own upload to the space) whose
// photo is selected, from inside the space timeline, by three OTHER members — the space's Owner,
// an Editor, and a Viewer.
//
// Rule under test (`getSelectionCapabilities`): `canEditMetadata` (Rotate, Change date/description/
// location) is true once ANY editable asset resolves into the selection — space Owner/Editor can
// edit a fellow member's asset, a Viewer cannot. `canSetVisibility` (Archive/Set-visibility) stays
// on `isAllUserOwned` regardless of space role — rbac-3 restricts visibility changes to owned
// assets, so it must NOT ride along on the editable subset (the#734/#992 ceiling, mirrored from the
// asset-viewer's isOwner-only Delete/Archive/Stack in spaces-editor-asset-viewer-affordances).
//
// Menu item text pinned against the real i18n keys, not guessed: `rotate_right`/`rotate_left`/
// `rotate_180`, `change_date`, `change_description`, `change_location`, `to_archive` → "Archive".

async function gotoAndWaitForTimeline(page: Page, url: string) {
  const bucketsResponse = page.waitForResponse((response) => response.url().includes('/timeline/buckets'));
  await page.goto(url);
  await bucketsResponse;
  await page.waitForSelector('[data-testid="discovery-timeline"]');
}

// Selects a single asset and waits for the debounced `POST /assets/editable` round trip to land
// (or confirms none was needed), returning both the resolved response body and the control bar
// locator. Waiting on the real network response — not a fixed timeout — is what makes the
// "editable" assertions below actually exercise the async resolution path rather than racing it.
async function selectAssetAndResolveEditable(
  page: Page,
  assetId: string,
): Promise<{ controlBar: Locator; editableAssetIds: string[] | null }> {
  const thumb = thumbnailUtils.withAssetId(page, assetId);
  await expect(thumb).toBeVisible();
  await thumb.hover();
  const checkbox = thumbnailUtils.selectButton(page, assetId);
  await expect(checkbox).toBeVisible();

  const editableResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/assets/editable') && response.request().method() === 'POST',
    { timeout: 5000 },
  );

  await checkbox.click();
  const controlBar = page.locator('#control-bar');
  await expect(controlBar).toBeVisible();

  let editableAssetIds: string[] | null = null;
  try {
    const response = await editableResponsePromise;
    editableAssetIds = ((await response.json()) as { editableAssetIds: string[] }).editableAssetIds;
  } catch {
    // isAllUserOwned selections resolve synchronously with no request — nothing to wait for.
  }
  return { controlBar, editableAssetIds };
}

async function openOverflowMenu(controlBar: Locator) {
  await controlBar.getByRole('button', { name: 'Menu' }).click();
}

test.describe("Spaces — SelectionToolbar editor-widened affordances on a space member's asset (#992 audit item 2 gap)", () => {
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let bob: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    const admin = await utils.adminSetup();

    [owner, editor, viewer, bob] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('stea-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('stea-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('stea-viewer')),
      utils.userSetup(admin.accessToken, createUserDto.create('stea-bob')),
    ]);
  });

  async function createFixture(namePrefix: string): Promise<{ space: SharedSpaceResponseDto; assetId: string }> {
    const space = await utils.createSpace(owner.accessToken, { name: `${namePrefix} Space` });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId, role: SharedSpaceRole.Viewer });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: bob.userId, role: SharedSpaceRole.Editor });
    const asset = await utils.createAsset(bob.accessToken);
    await utils.addSpaceAssets(bob.accessToken, space.id, [asset.id]);
    return { space, assetId: asset.id };
  }

  test("space Viewer selecting a member's asset: server resolves it as non-editable, and the metadata-edit actions stay hidden", async ({
    context,
    page,
  }) => {
    const { space, assetId } = await createFixture('STEA-viewer');
    await utils.setAuthCookies(context, viewer.accessToken);
    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`);

    const { controlBar, editableAssetIds } = await selectAssetAndResolveEditable(page, assetId);
    // The resolution itself, not just the resulting DOM: proves the server-side gate actually ran
    // and denied, rather than the menu items merely not having rendered yet.
    expect(editableAssetIds).toEqual([]);

    // Anchor: always-on, before any absence assertion.
    await expect(controlBar.getByRole('button', { name: 'Select all' })).toBeVisible();

    await openOverflowMenu(controlBar);
    await expect(controlBar.getByRole('menuitem', { name: 'Download' })).toBeVisible();

    await expect(controlBar.getByRole('menuitem', { name: 'Rotate right' })).toHaveCount(0);
    await expect(controlBar.getByRole('menuitem', { name: 'Rotate left' })).toHaveCount(0);
    await expect(controlBar.getByRole('menuitem', { name: 'Rotate 180°' })).toHaveCount(0);
    await expect(controlBar.getByRole('menuitem', { name: 'Change date' })).toHaveCount(0);
    await expect(controlBar.getByRole('menuitem', { name: 'Change description' })).toHaveCount(0);
    await expect(controlBar.getByRole('menuitem', { name: 'Change location' })).toHaveCount(0);

    // isAllUserOwned-gated (never true here — Bob owns the asset): absent regardless of role.
    await expect(controlBar.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
  });

  test("space Owner selecting a member's asset: server resolves it as editable, metadata-edit actions render, Archive stays hidden", async ({
    context,
    page,
  }) => {
    const { space, assetId } = await createFixture('STEA-owner');
    await utils.setAuthCookies(context, owner.accessToken);
    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`);

    const { controlBar, editableAssetIds } = await selectAssetAndResolveEditable(page, assetId);
    expect(editableAssetIds).toEqual([assetId]);

    await expect(controlBar.getByRole('button', { name: 'Select all' })).toBeVisible();

    await openOverflowMenu(controlBar);
    await expect(controlBar.getByRole('menuitem', { name: 'Download' })).toBeVisible();

    await expect(controlBar.getByRole('menuitem', { name: 'Rotate right' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Rotate left' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Rotate 180°' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Change date' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Change description' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Change location' })).toBeVisible();

    // The ceiling: canSetVisibility stays isAllUserOwned, so even the space Owner cannot Archive
    // a fellow member's asset from this toolbar.
    await expect(controlBar.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
  });

  test("space Editor selecting a member's asset: server resolves it as editable, metadata-edit actions render, Archive stays hidden", async ({
    context,
    page,
  }) => {
    const { space, assetId } = await createFixture('STEA-editor');
    await utils.setAuthCookies(context, editor.accessToken);
    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`);

    const { controlBar, editableAssetIds } = await selectAssetAndResolveEditable(page, assetId);
    expect(editableAssetIds).toEqual([assetId]);

    await expect(controlBar.getByRole('button', { name: 'Select all' })).toBeVisible();

    await openOverflowMenu(controlBar);
    await expect(controlBar.getByRole('menuitem', { name: 'Download' })).toBeVisible();

    await expect(controlBar.getByRole('menuitem', { name: 'Rotate right' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Rotate left' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Rotate 180°' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Change date' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Change description' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Change location' })).toBeVisible();

    await expect(controlBar.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
  });

  // The mixed-selection case that motivated #734's editable-SUBSET shape (not all-or-nothing):
  // an Editor selects one of their own uploads AND Bob's. Both resolve as editable (the Editor
  // owns one and has space-write access to the other), so the metadata-edit actions render for
  // the mixed selection too — the highest-value case, since it's the one an "all-or-nothing"
  // regression would silently break while every single-asset case above kept passing.
  test("space Editor with a mixed selection (own asset + a member's): both resolve editable, metadata-edit actions render", async ({
    context,
    page,
  }) => {
    const { space, assetId: bobAssetId } = await createFixture('STEA-mixed');
    const editorAsset = await utils.createAsset(editor.accessToken);
    await utils.addSpaceAssets(editor.accessToken, space.id, [editorAsset.id]);

    await utils.setAuthCookies(context, editor.accessToken);
    await gotoAndWaitForTimeline(page, `/spaces/${space.id}`);

    // Select the editor's own asset first (resolves synchronously, isAllUserOwned) ...
    const ownThumb = thumbnailUtils.withAssetId(page, editorAsset.id);
    await expect(ownThumb).toBeVisible();
    await ownThumb.hover();
    await thumbnailUtils.selectButton(page, editorAsset.id).click();
    await expect(page.locator('#control-bar')).toBeVisible();

    // ... then add Bob's, which flips isAllUserOwned to false and triggers the debounced resolve.
    const { controlBar, editableAssetIds } = await selectAssetAndResolveEditable(page, bobAssetId);
    expect(editableAssetIds).not.toBeNull();
    expect(new Set(editableAssetIds)).toEqual(new Set([editorAsset.id, bobAssetId]));

    await openOverflowMenu(controlBar);
    await expect(controlBar.getByRole('menuitem', { name: 'Rotate right' })).toBeVisible();
    await expect(controlBar.getByRole('menuitem', { name: 'Change date' })).toBeVisible();
    // Still owner-gated: mixed ownership blocks the all-owned-only actions.
    await expect(controlBar.getByRole('menuitem', { name: 'Archive' })).toHaveCount(0);
  });
});
