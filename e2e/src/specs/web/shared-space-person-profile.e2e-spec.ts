import type { LoginResponseDto } from '@immich/sdk';
import { SharedSpaceRole } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

// A space member's main People view shows shared_space_person profiles; person edits
// from there must hit the shared-space endpoints (PUT /shared-spaces/:id/people/:personId),
// not person.update, which only knows the person table.
test.describe('Shared space person in the main People view', () => {
  let editorLogin: LoginResponseDto;
  let viewerLogin: LoginResponseDto;
  let spaceId: string;
  let spacePersonId: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    const admin = await utils.adminSetup();
    const db = await utils.connectDatabase();

    editorLogin = await utils.userSetup(admin.accessToken, {
      email: 'space-editor@test.com',
      name: 'Space Editor',
      password: 'password',
    });
    viewerLogin = await utils.userSetup(admin.accessToken, {
      email: 'space-viewer@test.com',
      name: 'Space Viewer',
      password: 'password',
    });

    const space = await utils.createSpace(admin.accessToken, { name: 'Family Space' });
    spaceId = space.id;
    await utils.addSpaceMember(admin.accessToken, space.id, {
      userId: editorLogin.userId,
      role: SharedSpaceRole.Editor,
    });
    await utils.addSpaceMember(admin.accessToken, space.id, {
      userId: viewerLogin.userId,
      role: SharedSpaceRole.Viewer,
    });

    const asset = await utils.createAsset(admin.accessToken);
    await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);

    // createFace wires the face identity (face_identity + face_identity_face + person.identityId);
    // the shared_space_person must join the same identity for members to see it under /people.
    const person = await utils.createPerson(admin.accessToken, { name: 'Grandma' });
    const faceId = await utils.createFace({ assetId: asset.id, personId: person.id });
    const identityResult = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [person.id]);
    const identityId = identityResult.rows[0].identityId as string;

    const spacePersonResult = await db.query(
      `INSERT INTO "shared_space_person"
         ("spaceId", name, "isHidden", "faceCount", "assetCount", "representativeFaceId", "identityId", "type")
       VALUES ($1, 'Grandma', false, 1, 1, $2, $3, 'person')
       RETURNING id`,
      [space.id, faceId, identityId],
    );
    spacePersonId = spacePersonResult.rows[0].id as string;
    await db.query(`INSERT INTO "shared_space_person_face" ("personId", "assetFaceId") VALUES ($1, $2)`, [
      spacePersonId,
      faceId,
    ]);
  });

  test('a space editor sets a birthday from the global person profile', async ({ context, page }) => {
    await utils.setAuthCookies(context, editorLogin.accessToken);
    await page.goto(`/people/${spacePersonId}`);
    await expect(page.getByText('Grandma')).toBeVisible();

    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByText('Set date of birth').click();
    await page.locator('input[name="birthDate"]').fill('1953-04-12');
    await page.getByRole('button', { name: 'Save' }).click();

    // The modal only closes when the save succeeds.
    await expect(page.locator('input[name="birthDate"]')).toHaveCount(0);
    await expect(page.getByText(/Born on/)).toBeVisible();

    // The write landed on the shared space person, not the person table.
    const response = await page.request.get(`/api/shared-spaces/${spaceId}/people/${spacePersonId}`, {
      headers: asBearerAuth(editorLogin.accessToken),
    });
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ id: spacePersonId, birthDate: '1953-04-12' });
  });

  test('a space viewer is not offered person write actions', async ({ context, page }) => {
    await utils.setAuthCookies(context, viewerLogin.accessToken);
    await page.goto(`/people/${spacePersonId}`);
    await expect(page.getByText('Grandma')).toBeVisible();

    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByText('Merge people')).toBeVisible();
    await expect(page.getByText('Set date of birth')).toHaveCount(0);
    await expect(page.getByText('Hide person')).toHaveCount(0);
  });
});
