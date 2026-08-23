import {
  createWorkflow,
  getSharedSpaceAlbums,
  getWorkflow,
  WorkflowTrigger,
  type LoginResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

// Regression cover for the `addToSpaceAlbum` step's album-name field.
//
// The field is a combobox that lists the space's linked albums and also accepts a name that does
// not exist yet. Its predecessor was a plain text input, and the first combobox cut committed the
// value only when an option was *selected* — so the interaction users actually perform (type a new
// album name, click Save) silently persisted `albumName: ""`, which the dispatcher then rejected
// as invalid config. Component tests missed it because they clicked the created option.
//
// This drives the real editor and then the real workflow, so it covers both the config round-trip
// and the step that consumes it.

const ALBUM_NAME = 'Ski trip 2026';

test.describe('addToSpaceAlbum step (album name)', () => {
  let admin: LoginResponseDto;
  let space: SharedSpaceResponseDto;
  let workflowId: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    space = await utils.createSpace(admin.accessToken, { name: 'Workflow Space' });

    // Created through the API with an empty name so the test has to supply it through the UI —
    // exactly the state the reported bug left behind.
    const workflow = await createWorkflow(
      {
        workflowCreateDto: {
          trigger: WorkflowTrigger.AssetCreate,
          name: 'Space album workflow',
          steps: [
            {
              method: 'gallery-core#addToSpaceAlbum',
              config: { spaceId: space.id, albumName: '' },
              enabled: true,
            },
          ],
        },
      },
      { headers: asBearerAuth(admin.accessToken) },
    );
    workflowId = workflow.id;
  });

  test('a typed album name is persisted and the workflow then creates and fills that album', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/workflows/${workflowId}`);

    // The trigger card carries an "Edit" button too, so scope to the step card. Only step cards
    // are list items, and the method title distinguishes this one.
    const stepCard = page.getByRole('listitem').filter({ hasText: 'Add to space album' });
    await expect(stepCard).toBeVisible({ timeout: 15_000 });
    await stepCard.getByRole('button', { name: 'Edit' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Type the name and commit by saving — deliberately WITHOUT selecting the created option from
    // the dropdown, because that is the interaction that used to lose the value.
    const albumField = dialog.getByRole('combobox');
    await expect(albumField).toBeEnabled();
    await albumField.fill(ALBUM_NAME);

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).not.toBeVisible();

    // The editor enables Save only once something has changed, so a Save that never becomes
    // enabled already means the typed name did not reach the config. Assert it rather than let
    // the click time out, so the failure names the cause instead of the symptom.
    const saveWorkflow = page.getByRole('button', { name: 'Save' }).first();
    await expect(saveWorkflow).toBeEnabled({ timeout: 10_000 });
    await saveWorkflow.click();

    await expect
      .poll(
        async () => {
          const workflow = await getWorkflow({ id: workflowId }, { headers: asBearerAuth(admin.accessToken) });
          return workflow.steps[0]?.config?.albumName;
        },
        { message: 'the typed album name should reach the saved step config', timeout: 15_000 },
      )
      .toBe(ALBUM_NAME);

    // And the value is actually usable: uploading an asset fires the workflow, which resolves the
    // name to an album in the space, creating and linking it because it does not exist yet.
    await utils.createAsset(admin.accessToken);

    await expect
      .poll(
        async () => {
          const albums = await getSharedSpaceAlbums({ id: space.id }, { headers: asBearerAuth(admin.accessToken) });
          return albums.find((album) => album.albumName === ALBUM_NAME)?.assetCount ?? 0;
        },
        { message: 'the workflow should create the named album in the space and add the asset', timeout: 60_000 },
      )
      .toBe(1);
  });
});
