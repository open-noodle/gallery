import { LoginResponseDto } from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { utils } from 'src/utils';

// Web E2E for the OWNER's face picker (`faces-page/AssignFaceSidePanel.svelte`, reached through
// `PersonSidePanel.svelte`). Nothing covered this surface end to end: the two sibling face specs
// (spaces-editor-face-affordances, spaces-editor-face-assign-completion) both drive the SPACE
// editor's on-photo overlay `#space-face-editor`, and neither ever opens a side-panel picker.
//
// It is also the surface #992's field testing kept landing on. Which picker you get turns on
// whether you OWN the photo (`canEditSpacePeople` is narrowed to `!isOwner`), so on one photo in
// one space the editor got the space picker while the admin -- who had uploaded the photos -- got
// this one, and reported "an unstructured list of unlabeled faces instead of the named people
// list". Both now render through `PersonPickerPanel.svelte`.
//
// Why the ordering assertion needs a favourite. `getAllPeople` orders named people first ONLY on
// its no-`closestFaceAssetId` branch (`getAllForUser`, person.repository.ts): the picker passes
// `closestAssetId`, which swaps that whole block for an embedding distance ordering. These
// fixtures have no `face_search` rows, so every distance is NULL and the preceding
// `isFavorite DESC` is what actually decides the order. Favouriting the UNNAMED cluster is
// therefore the one lever that makes the server hand the picker its candidates unnamed-first --
// without it this test would pass whether or not the client re-orders anything, which is no test
// at all.

async function openInfoPanel(page: Page) {
  const navbar = page.getByTestId('asset-viewer-navbar-actions');
  await navbar.getByRole('button', { name: 'Info' }).click();
}

async function openFacePicker(page: Page, assetId: string) {
  await page.goto(`/photos/${assetId}`);
  await page.waitForSelector('#immich-asset-viewer');
  await openInfoPanel(page);

  await page.getByTestId('detail-panel-people').getByRole('button', { name: 'Edit people' }).click();
  // `exact` matters: each face card in `PersonSidePanel` is ITSELF a button wrapping the pencil, so
  // its accessible name reads "… Select new face Delete face" and a non-exact match resolves the
  // card first — clicking which does nothing and leaves the picker closed.
  await page.getByRole('button', { name: 'Select new face', exact: true }).first().click();

  const panel = page.getByTestId('person-picker-panel');
  // The candidate CAPTIONS, in render order. Asserting on the buttons themselves would be asserting
  // on their alt text too -- these fixtures' person thumbnails 404, so every button reads
  // "Error loading image <name>" -- and the caption is what a human actually reads off the card.
  return { panel, captions: panel.locator('button p') };
}

test.describe("Owner's face picker — named people first, search in plain sight", () => {
  let owner: LoginResponseDto;
  let assetId: string;
  const namedPerson = 'Zelda Namewell';

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    const admin = await utils.adminSetup();
    owner = await utils.userSetup(admin.accessToken, createUserDto.create('ofp-owner'));

    // The face the picker is opened on. Its own person is excluded from the candidate list, and an
    // unnamed person with a single face is below `getAllForUser`'s minimum-faces floor anyway, so
    // this anchor never competes with the two candidates below.
    const anchorAsset = await utils.createAsset(owner.accessToken);
    const anchor = await utils.createPerson(owner.accessToken, {});
    await utils.createFace({ assetId: anchorAsset.id, personId: anchor.id });
    assetId = anchorAsset.id;

    const named = await utils.createPerson(owner.accessToken, { name: namedPerson });
    const namedAsset = await utils.createAsset(owner.accessToken);
    await utils.createFace({ assetId: namedAsset.id, personId: named.id });

    // Unnamed, so it needs three faces to clear the minimum-faces floor, and favourited so the
    // server returns it FIRST — see the header note.
    const cluster = await utils.createPerson(owner.accessToken, { isFavorite: true });
    const clusterAsset = await utils.createAsset(owner.accessToken);
    for (let index = 0; index < 3; index++) {
      await utils.createFace({ assetId: clusterAsset.id, personId: cluster.id });
    }
  });

  // The complaint itself. The server hands this picker the favourited unnamed cluster first; the
  // person with a name has to come out on top regardless.
  test('lists the named person ahead of the unnamed cluster the server returned first', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);

    // Armed before the picker opens, because the request fires as the panel mounts. Asserting on
    // what the SERVER sent is what stops this test being vacuous: if `getAllPeople` ever came back
    // named-first on its own, the rendered order below would prove nothing about the client, and
    // this line fails loudly instead of the test quietly ceasing to test anything.
    const servedPeople = page.waitForResponse(
      (response) => response.url().includes('/api/people') && response.url().includes('closestAssetId'),
    );

    const { captions } = await openFacePicker(page, assetId);

    const { people } = await (await servedPeople).json();
    expect(people.map((person: { name: string }) => person.name)).toEqual(['', namedPerson]);

    // ...and the picker turns that around. The cluster is the empty caption.
    await expect(captions).toHaveText([namedPerson, '']);
  });

  // The search sat behind a magnifier icon, so on a library of any size the first thing this panel
  // showed was the wall of clusters with no visible way past it.
  test('shows the search field without opening a magnifier first', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);

    const { panel } = await openFacePicker(page, assetId);

    await expect(panel.getByPlaceholder('Search people')).toBeVisible();
  });

  // Dropping `PeopleSearch` meant reissuing its request from the panel. This is the part component
  // tests cannot prove: that the rewired query reaches the real `/search/person` endpoint and that
  // the picker renders what came back, rather than filtering the page it had already loaded.
  test('narrows the list through a real people search', async ({ context, page }) => {
    await utils.setAuthCookies(context, owner.accessToken);

    const { panel, captions } = await openFacePicker(page, assetId);
    await expect(captions).toHaveCount(2);

    const search = page.waitForResponse((response) => response.url().includes('/search/person'));
    await panel.getByPlaceholder('Search people').fill('Zelda');
    await search;

    await expect(captions).toHaveText([namedPerson]);
  });
});
