import { LoginResponseDto, SharedSpaceRole, type SharedSpaceResponseDto } from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';

// Web E2E for Slice 9 (spec 2026-08-23-space-editor-face-assignment-design.md §7): proves in a
// REAL browser, against a REAL server, that the "tag people" affordance in the info panel's
// People row (DetailPanelPeople.svelte, aria-label `tag_people`) is visible for a space
// Owner/Editor on a space surface and opens the SPACE-flavoured face editor
// (`FaceEditorPanel.svelte` -> `SpaceFaceEditor.svelte`, canvas `#space-face-editor`,
// `select_person_to_tag` copy) -- not the owner's `FaceEditor.svelte`.
//
// This exists because Slice 8 shipped exactly this kind of wiring gap once already (see
// 2c39be4622 "fix(web): wire the space-flavoured face panels Slice 8 left unconnected"): the
// affordance was visible but the WRONG panel rendered behind it. Every other layer proving this
// feature (medium tests for the SQL rule, unit tests per server call site, web component tests
// that hand `canEditSpacePeople` straight to a component, API-level e2e for permit/deny) would
// still pass even if `DetailPanel`/`PhotoViewer`/`VideoNativeViewer` disagreed about which panel
// to render, or if `canEditSpacePeople` were computed correctly but never threaded through. Only
// a real click-through, in a real browser, catches that.
//
// Fixture: Bob is a space member (Editor role, so he can add his own upload to the space) whose
// photo is viewed by the space's Owner, an Editor, and a Viewer, plus once more by the SAME
// Editor on a different Bob photo that was never added to any space, to prove the affordance is
// asset-reachability-scoped, not a blanket widening of the editor's permissions.
//
// NOTE: the affordance is NOT route-scoped. A single-asset read with no explicit spaceId
// auto-detects any space containing the asset for the viewer (asset.service.ts:141-154,
// `findSpaceForAssetAndUser`) and still resolves it, so Bob's SAME in-space photo shows the
// affordance on a plain `/photos/:id` visit too — verified against the running server, not
// assumed. The real negative control is an asset outside every space the Editor is in, below.

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

async function openInfoPanel(page: Page) {
  const navbar = page.getByTestId('asset-viewer-navbar-actions');
  await navbar.getByRole('button', { name: 'Info' }).click();
}

test.describe('Spaces — the tag-people affordance opens the SPACE face editor (Slice 9 wiring proof)', () => {
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;
  let bob: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    const admin = await utils.adminSetup();

    [owner, editor, viewer, bob] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('sefa-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('sefa-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('sefa-viewer')),
      utils.userSetup(admin.accessToken, createUserDto.create('sefa-bob')),
    ]);
  });

  // Fresh space + asset per test — tests never depend on one another's state or run order.
  async function createFixture(namePrefix: string): Promise<{ space: SharedSpaceResponseDto; assetId: string }> {
    const space = await utils.createSpace(owner.accessToken, { name: `${namePrefix} Space` });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId, role: SharedSpaceRole.Viewer });
    // Bob needs Editor (or Owner) to add his own upload to the space (addAssets requireRole).
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: bob.userId, role: SharedSpaceRole.Editor });
    const asset = await utils.createAsset(bob.accessToken);
    await utils.addSpaceAssets(bob.accessToken, space.id, [asset.id]);
    return { space, assetId: asset.id };
  }

  test("space Editor sees the tag-people affordance on Bob's photo, and it opens the SPACE face editor", async ({
    context,
    page,
  }) => {
    const { space, assetId } = await createFixture('SEFA-editor');
    await utils.setAuthCookies(context, editor.accessToken);
    await gotoAssetViewerFromSpace(page, space.id, assetId);
    await openInfoPanel(page);

    const peopleSection = page.getByTestId('detail-panel-people');
    await expect(peopleSection).toBeVisible();
    const tagPeopleButton = peopleSection.getByRole('button', { name: 'Tag People' });
    await expect(tagPeopleButton).toBeVisible();

    // Anchor: the owner's editor is NOT on the page before the click (a bare "did the space
    // canvas render" check on a page that has not clicked anything yet would pass for the wrong
    // reason).
    await expect(page.locator('#space-face-editor')).toHaveCount(0);

    await tagPeopleButton.click();

    // The SPACE-flavoured editor rendered -- not the owner's FaceEditor, which never renders a
    // canvas with this id, and never shows this copy.
    await expect(page.locator('#space-face-editor')).toBeVisible();
    await expect(page.getByText('Select a person to tag')).toBeVisible();
  });

  test("space Owner sees the same affordance on a member's photo, and it also opens the SPACE face editor", async ({
    context,
    page,
  }) => {
    const { space, assetId } = await createFixture('SEFA-owner');
    await utils.setAuthCookies(context, owner.accessToken);
    await gotoAssetViewerFromSpace(page, space.id, assetId);
    await openInfoPanel(page);

    const tagPeopleButton = page.getByTestId('detail-panel-people').getByRole('button', { name: 'Tag People' });
    await expect(tagPeopleButton).toBeVisible();
    await tagPeopleButton.click();

    await expect(page.locator('#space-face-editor')).toBeVisible();
  });

  test('space Viewer sees no tag-people affordance on the same photo', async ({ context, page }) => {
    const { space, assetId } = await createFixture('SEFA-viewer');
    await utils.setAuthCookies(context, viewer.accessToken);
    await gotoAssetViewerFromSpace(page, space.id, assetId);
    await openInfoPanel(page);

    // A Viewer is neither the owner nor space-edit-capable, and the photo has no detected
    // people yet, so the entire People section (not just the button) is absent -- the stronger
    // of the two possible absences, and the one the component's own gate actually produces.
    await expect(page.getByTestId('detail-panel-people')).toHaveCount(0);
    await expect(page.locator('#space-face-editor')).toHaveCount(0);
  });

  test('the same Editor sees no tag-people affordance on a Bob photo that is NOT in any of her spaces', async ({
    context,
    page,
  }) => {
    // Deviation from the plan's literal "main timeline, same photo" framing -- verified against
    // the running server (asset.service.ts:141-154, `findSpaceForAssetAndUser`) that a
    // single-asset read with NO explicit spaceId auto-detects ANY space containing the asset
    // where the viewer is a member and still resolves `resolvedSpaceId` from it. So Bob's SAME
    // in-space photo legitimately shows the affordance on `/photos/:id` too -- confirmed by
    // running exactly that scenario first, which failed with the button present, not absent. That
    // is correct, intentional product behaviour (the space-editing capability follows the ASSET's
    // space reachability, not the route), not a bug this suite should pin as broken.
    //
    // The real negative-boundary case is therefore an asset Bob owns but never added to ANY
    // space: for that asset `findSpaceForAssetAndUser` returns nothing, `resolvedSpaceId` stays
    // unset, and — since #734's widened edit permission is asset-reachability-scoped, not a
    // blanket grant to everything the space's editors touch — `asset.canEdit` (server-resolved
    // via the same `Permission.AssetUpdate` check the write itself makes) is false too, so the
    // whole People section (which also gates on `isOwner`) is absent for this SAME Editor.
    //
    // Bob also partner-shares his library with Anna so she has plain READ access to view the
    // asset at all (partner sharing alone grants `AssetRead`/`AssetShare`, never `AssetUpdate`) --
    // without this she could not even open `/photos/:id` for an asset outside every space she is
    // in, and the test would prove nothing about the affordance specifically.
    await createFixture('SEFA-out-of-space'); // seeds the space itself; asset below is deliberately NOT added to it
    const outOfSpaceAsset = await utils.createAsset(bob.accessToken);
    await utils.createPartner(bob.accessToken, editor.userId);
    await utils.setAuthCookies(context, editor.accessToken);

    await page.goto(`/photos/${outOfSpaceAsset.id}`);
    await page.waitForSelector('#immich-asset-viewer');
    await openInfoPanel(page);

    await expect(page.getByTestId('detail-panel-people')).toHaveCount(0);
  });
});
