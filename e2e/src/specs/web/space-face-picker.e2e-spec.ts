import { LoginResponseDto, SharedSpaceRole, type SharedSpaceResponseDto } from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';

// Web E2E for the SPACE editor's face picker (`asset-viewer/SpacePersonSidePanel.svelte`), the
// other caller of the shared `PersonPickerPanel.svelte`.
//
// Its sibling specs (spaces-editor-face-affordances, spaces-editor-face-assign-completion) both
// drive the on-photo overlay `#space-face-editor`, reached through the "Tag People" affordance.
// Nothing reached the side panel behind "Edit people" — a different component, a different read
// (`GET /shared-spaces/:id/assets/:assetId/faces`) and, since both pickers were folded onto one
// panel, the second proof that the fold did not break either caller.

async function gotoAssetViewerFromSpace(page: Page, spaceId: string, assetId: string) {
  const bucketsResponse = page.waitForResponse((response) => response.url().includes('/timeline/buckets'));
  await page.goto(`/spaces/${spaceId}`);
  await bucketsResponse;
  await page.waitForSelector('[data-testid="discovery-timeline"]');
  const thumb = page.locator(`[data-thumbnail-focus-container][data-asset="${assetId}"]`);
  await expect(thumb).toBeVisible();
  await thumb.click();
  await page.waitForURL(`/spaces/${spaceId}/photos/${assetId}`);
  await page.waitForSelector('#immich-asset-viewer');
}

async function openFacePicker(page: Page, spaceId: string, assetId: string) {
  await gotoAssetViewerFromSpace(page, spaceId, assetId);
  await page.getByTestId('asset-viewer-navbar-actions').getByRole('button', { name: 'Info' }).click();

  await page.getByTestId('detail-panel-people').getByRole('button', { name: 'Edit people' }).click();
  // `exact`: each face card is itself a button whose accessible name CONTAINS "Select new face".
  await page.getByRole('button', { name: 'Select new face', exact: true }).first().click();

  const panel = page.getByTestId('person-picker-panel');
  return { panel, captions: panel.locator('button p') };
}

test.describe("Space editor's face picker — the shared panel in its other caller", () => {
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let bob: LoginResponseDto;
  let space: SharedSpaceResponseDto;
  let targetAssetId: string;
  const candidateName = 'Space Candidate';

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    const admin = await utils.adminSetup();

    [owner, editor, bob] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('sfp-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('sfp-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('sfp-bob')),
    ]);

    space = await utils.createSpace(owner.accessToken, { name: 'SFP Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    // Bob needs Editor (or Owner) to add his own upload to the space.
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: bob.userId, role: SharedSpaceRole.Editor });

    // The candidate the picker must offer: a named space person, anchored on a DIFFERENT photo of
    // Bob's in the space, so it is reachable as a candidate without already being on the target.
    const candidateAsset = await utils.createAsset(bob.accessToken);
    await utils.addSpaceAssets(bob.accessToken, space.id, [candidateAsset.id]);
    await utils.createSpacePerson(space.id, candidateName, bob.userId, candidateAsset.id);

    // The target: Bob's photo carrying a face with no `shared_space_person_face` row, so the
    // space-scoped read reports it unassigned and the panel offers to name it.
    const targetAsset = await utils.createAsset(bob.accessToken);
    await utils.addSpaceAssets(bob.accessToken, space.id, [targetAsset.id]);
    const bobPerson = await utils.createPerson(bob.accessToken, {});
    await utils.createFace({ assetId: targetAsset.id, personId: bobPerson.id });
    targetAssetId = targetAsset.id;
  });

  test('offers the space people through the shared panel, and attaching one names the face', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, editor.accessToken);

    const { panel, captions } = await openFacePicker(page, space.id, targetAssetId);

    // The shared panel, with its search field visible — the same screen the owner's picker renders.
    await expect(panel.getByPlaceholder('Search people')).toBeVisible();
    await expect(captions).toHaveText([candidateName]);

    // The one field does both jobs here: it filters, and it names what "Create person" would make.
    // Filtering is client-side over the loaded candidates, so no request is expected.
    await panel.getByPlaceholder('Search people').fill('nobody-by-that-name');
    await expect(captions).toHaveCount(0);
    await panel.getByPlaceholder('Search people').fill('space cand');
    await expect(captions).toHaveText([candidateName]);

    // Attaching writes through the space endpoint and the face row takes the name.
    const attach = page.waitForResponse(
      (response) => response.url().includes('/shared-spaces/') && response.request().method() === 'PUT',
    );
    await panel.getByRole('button', { name: candidateName }).click();
    const attachResponse = await attach;
    expect(attachResponse.ok()).toBe(true);

    await expect(page.getByTestId('person-picker-panel')).toHaveCount(0);
    // The face row's caption specifically. A bare `getByText` also matches hidden copies of the
    // name elsewhere on the page (the asset viewer keeps offscreen menus mounted), and picking one
    // of those would assert nothing about the row that was just named.
    await expect(page.locator(`p[title="${candidateName}"]`)).toBeVisible();
  });
});
