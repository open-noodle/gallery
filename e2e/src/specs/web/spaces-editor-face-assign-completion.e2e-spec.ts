import { LoginResponseDto, SharedSpaceRole, type SharedSpaceResponseDto } from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';

// Web E2E, Slice 9 gap closure #2 (spec 2026-08-23-space-editor-face-assignment-design.md §6.2,
// §6.5): the sibling spec (spaces-editor-face-affordances.e2e-spec.ts) proves the "tag people"
// affordance opens the SPACE-flavoured face editor for an Owner/Editor -- it never drives an
// assignment through to completion. A component that renders the right editor but silently drops
// the write, or renders it only optimistically without it actually reaching Postgres, would still
// pass every one of those four tests. This spec closes that gap: it completes a real
// create-and-attach through the browser and then proves the result survives a page reload --
// i.e. it came from the server, not from client-side state.
//
// What actually gets asserted for "the UI reflects the assignment" needs a footnote.
//
// HISTORICAL NOTE (the gap described here has since been CLOSED): the natural first assertion --
// the newly-created person appearing as a chip in the asset's own People row
// (DetailPanelPeople.svelte) -- used to fail even after a reload. That component's non-owner branch
// reads `AssetResponseDto.people`, which server-side (`findSpacePersonsByLinkedPersonIds`,
// shared-space.repository.ts) only surfaces a space person for a face that ALSO carries an
// owner-side `asset_face.personId`, and space assignment deliberately left that column NULL under
// the original §6.3.1 (space assignment as a separate projection, never written back onto the
// owner's person model).
//
// §6.3.1 was later REVISED: a space-editor face edit now propagates into the owner's layer, writing
// `asset_face.personId` on attach and clearing it on detach. So the People row does reflect the
// assignment now, and its detach twin removes it. The two surfaces below remain the assertions this
// spec uses -- they are independent of that read path and were never the weaker proof -- but they
// are no longer a workaround for a known gap:
//
//   (3) re-opening "Tag People" in the SAME page session (no reload) re-fetches
//       `GET /shared-spaces/:id/people` fresh, so the just-created person shows up as a selectable
//       candidate -- proof the create-and-attach round-tripped through the server, not merely
//       through client state, without yet touching persistence-across-reload.
//   (4) the space's own People page (`/spaces/:id/people`, `GET /shared-spaces/:id/people`) is a
//       completely different read path with no such gap, and is the canonical place a person who
//       tagged a photo would go to confirm the name "took". Reloading THAT page and finding the
//       name still there is the actual persistence proof.
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

test.describe('Spaces — completing a face assignment persists (Slice 9 completion proof)', () => {
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let bob: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    const admin = await utils.adminSetup();

    [owner, editor, bob] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.create('sefc-owner')),
      utils.userSetup(admin.accessToken, createUserDto.create('sefc-editor')),
      utils.userSetup(admin.accessToken, createUserDto.create('sefc-bob')),
    ]);
  });

  async function createFixture(namePrefix: string): Promise<{ space: SharedSpaceResponseDto; assetId: string }> {
    const space = await utils.createSpace(owner.accessToken, { name: `${namePrefix} Space` });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    // Bob needs Editor (or Owner) to add his own upload to the space (addAssets requireRole).
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: bob.userId, role: SharedSpaceRole.Editor });
    const asset = await utils.createAsset(bob.accessToken);
    await utils.addSpaceAssets(bob.accessToken, space.id, [asset.id]);
    return { space, assetId: asset.id };
  }

  test('space Editor completes naming a face on a member photo, and it survives a reload', async ({
    context,
    page,
  }) => {
    const personName = 'Persisted Person';
    const { space, assetId } = await createFixture('SEFC');

    await utils.setAuthCookies(context, editor.accessToken);
    await gotoAssetViewerFromSpace(page, space.id, assetId);
    await openInfoPanel(page);

    const peopleSection = page.getByTestId('detail-panel-people');
    await peopleSection.getByRole('button', { name: 'Tag People' }).click();
    await expect(page.locator('#space-face-editor')).toBeVisible();

    // 1-2: create a new space person and complete naming the drawn face.
    await page.getByRole('button', { name: 'Create person' }).click();
    await page.getByPlaceholder('Name').fill(personName);
    await page.getByRole('button', { name: 'Tag face' }).click();

    // The create-and-attach succeeded and the editor closed back to the asset viewer -- a stuck
    // editor (e.g. a rejected promise never calling onClose) would fail this.
    await expect(page.locator('#space-face-editor')).toHaveCount(0);

    // (3) the UI reflects the assignment: re-opening Tag People, in the SAME page session (no
    // reload), shows the just-created person as a selectable candidate -- a fresh
    // `GET /shared-spaces/:id/people` fetch, not an optimistic client-side echo. See the header
    // comment for why this is the assertion used here instead of a People-row chip.
    await peopleSection.getByRole('button', { name: 'Tag People' }).click();
    await expect(page.locator('#space-face-editor')).toBeVisible();
    await expect(page.getByRole('button', { name: personName })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#space-face-editor')).toHaveCount(0);

    // (4) THE point of this test: it PERSISTED, not merely rendered. The space's own People page
    // is a different read path (GET /shared-spaces/:id/people) than the asset viewer above --
    // navigating there and reloading forces a real round-trip through the server on each load,
    // not a warm client cache carried over from the tagging flow.
    // An Editor's own People page renders each name as an editable `<input>` (canEditNames=true,
    // people-management-grid.svelte), so the name lives in the input's live `.value` PROPERTY, not
    // as a text node or even necessarily the `value` HTML attribute (Svelte's `value={...}` binding
    // sets the DOM property directly) -- `getByText` and a CSS `[value=...]` selector can both miss
    // it. Poll every rendered input's `.value` instead.
    const personNameIsRendered = () =>
      page
        .locator('input')
        .evaluateAll((inputs, name) => inputs.some((input) => (input as HTMLInputElement).value === name), personName);

    await page.goto(`/spaces/${space.id}/people`);
    await expect.poll(personNameIsRendered, { timeout: 15_000 }).toBe(true);
    await page.reload();
    await expect.poll(personNameIsRendered, { timeout: 15_000 }).toBe(true);
  });
});
