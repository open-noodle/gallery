/**
 * Dissolve a metadata-contaminated person, end to end — the one test on this branch that exercises the
 * whole seam in a single run: discovery (Face health tab -> GET /admin/face-repair/people), the modal
 * (POST .../dissolve/preview then .../dissolve), and the database (the asset_face rows are gone AND the
 * recognition watermark that makes this a *repair* rather than just a delete is cleared).
 *
 * Drives the DISCOVERY path a real admin takes — Face health tab -> click the contaminated person -> land on
 * the manual-review page -> Dissolve — rather than the guided page's own launcher. That is the path Task 9's
 * fix (0a78672afd3) made work: the health listing links to `/admin/face-cleanup/people/[personId]`, not the
 * guided `/admin/face-cleanup/[personId]`, and a person made entirely of EXIF faces is exactly the case no
 * scan can ever flag, so this is the only page discovery actually lands on.
 */
import { getPersonStatistics, type LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

test.describe('dissolve a metadata-contaminated person', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  test('removes the imported faces and clears the re-detection watermark', async ({ page, context }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    const db = await utils.connectDatabase();

    const person = await utils.createPerson(admin.accessToken, { name: 'Contaminated' });
    const asset = await utils.createAsset(admin.accessToken);

    // The e2e stack runs with ML disabled, so nothing sets this on its own — seed it directly to stand in
    // for "this asset already went through face recognition", which is the state a real EXIF-contaminated
    // photo is in. The point of this test is that dissolve clears exactly this watermark BEFORE deleting
    // the face, so the ordinary (non-forced) detection pass re-processes this asset afterward.
    await db.query(
      `INSERT INTO "asset_job_status" ("assetId", "facesRecognizedAt") VALUES ($1, now())
       ON CONFLICT ("assetId") DO UPDATE SET "facesRecognizedAt" = excluded."facesRecognizedAt"`,
      [asset.id],
    );

    // sourceType 'exif' with no face_search row is what a bad RegionInfo import produces, and what nothing
    // else in the console can see: no embedding means the cleanup scan's join excludes it, and
    // force-recognition only unassigns machine-learning-sourced faces.
    await utils.createFace({
      assetId: asset.id,
      personId: person.id,
      sourceType: 'exif',
      withEmbedding: false,
    });

    // Discovery: Face health tab -> the contaminated person's row.
    await page.goto('/admin/face-cleanup/people');
    await page.getByTestId('people-tab-health').click();
    await page.getByRole('link', { name: 'Contaminated' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/face-cleanup/people/${person.id}$`));

    await page.getByTestId('manual-review-dissolve').click();

    // The modal now defaults its scope to 'exif' (the contamination this dialog exists for), not 'all' —
    // assert that rather than clicking the chip, so a regression of the default fails this test instead of
    // being masked by a click that would select the same scope either way.
    await expect(page.getByRole('button', { name: /from metadata/i })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('textbox').fill('Contaminated');
    await page.getByRole('button', { name: /delete the detections/i }).click();

    // delete-faces (the default outcome) against a person with exactly one, all-in-scope face empties it
    // entirely. The manual-review page's own post-dissolve contract (people/[personId]/+page.svelte
    // handleDissolve) then navigates back to the health/browse listing — so that navigation, not the
    // dissolve button remaining on screen, is the shipped UI's actual "it worked" signal.
    await page.waitForURL('**/admin/face-cleanup/people');

    const statistics = await getPersonStatistics({ id: person.id }, { headers: asBearerAuth(admin.accessToken) });
    expect(statistics.assets).toBe(0);
    expect(statistics.faces).toBe(0);

    const { rows } = await db.query(`SELECT "facesRecognizedAt" FROM "asset_job_status" WHERE "assetId" = $1`, [
      asset.id,
    ]);
    expect(rows[0].facesRecognizedAt).toBeNull();
  });
});
