import type { LoginResponseDto } from '@immich/sdk';
import { SharedSpaceRole, updateConfig } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

// A space member's main People view shows shared_space_person profiles; person edits
// from there must hit the shared-space endpoints (PUT /shared-spaces/:id/people/:personId),
// not person.update, which only knows the person table.
test.describe('Shared space person in the main People view', () => {
  let adminLogin: LoginResponseDto;
  let editorLogin: LoginResponseDto;
  let viewerLogin: LoginResponseDto;
  let spaceId: string;
  let spacePersonId: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    const admin = await utils.adminSetup();
    adminLogin = admin;
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
    const faceId = await utils.createFace({ assetId: asset.id, personGroupId: person.id });
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
    // The modal uses a bits-ui segmented date field (the named input is hidden);
    // type month/day/year — segments auto-advance as each part completes.
    await page.locator('[data-segment="month"]').click();
    await page.keyboard.type('04121953');
    await expect(page.locator('input[name="birthDate"]')).toHaveValue('1953-04-12');
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
    // Merge used to be offered here, unlike every other write action — but a viewer cannot name a space person
    // they may not repair as a merge ref, so the server refused it and the flow could only ever fail. It is now
    // gated on the same edit check as the rest.
    await expect(page.getByText('Merge people')).toHaveCount(0);
    await expect(page.getByText('Set date of birth')).toHaveCount(0);
    await expect(page.getByText('Hide person')).toHaveCount(0);
  });

  // A member who owns no person row for the identity only ever reaches the shared person through
  // this route, so the face-suggestion banner has to work here — not just under /spaces/:id/people.
  test.describe('face suggestions', () => {
    let suggestionPersonId: string;

    const suggestionsPath = () => `/api/shared-spaces/${spaceId}/people/${suggestionPersonId}/face-suggestions`;

    test.beforeAll(async () => {
      const db = await utils.connectDatabase();

      const config = await utils.getSystemConfig(adminLogin.accessToken);
      config.machineLearning.facialRecognition.maxDistance = 0.5;
      config.machineLearning.facialRecognition.suggestions = { enabled: true, maxDistance: 0.8 };
      await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(adminLogin.accessToken) });

      const representativeAsset = await utils.createAsset(adminLogin.accessToken);
      const candidateAsset = await utils.createAsset(adminLogin.accessToken);
      await utils.addSpaceAssets(adminLogin.accessToken, spaceId, [representativeAsset.id, candidateAsset.id]);
      await utils.waitForQueueFinish(adminLogin.accessToken, 'thumbnailGeneration');

      const person = await utils.createPerson(adminLogin.accessToken, { name: 'Suggestion Target' });
      const faceId = await utils.createFace({ assetId: representativeAsset.id, personGroupId: person.id });
      const identityResult = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [person.id]);
      const identityId = identityResult.rows[0].identityId as string;

      // Wrapped like utils.createSpacePerson: the SharedSpacePersonDedup job hard-deletes a
      // shared_space_person that has no shared_space_person_face row yet.
      await db.query('BEGIN');
      const spacePersonResult = await db.query(
        `INSERT INTO "shared_space_person"
           ("spaceId", name, "isHidden", "faceCount", "assetCount", "representativeFaceId", "identityId", "type")
         VALUES ($1, 'Suggestion Target', false, 1, 1, $2, $3, 'person')
         RETURNING id`,
        [spaceId, faceId, identityId],
      );
      suggestionPersonId = spacePersonResult.rows[0].id as string;
      await db.query(`INSERT INTO "shared_space_person_face" ("personId", "assetFaceId") VALUES ($1, $2)`, [
        suggestionPersonId,
        faceId,
      ]);
      await db.query('COMMIT');

      // A near-miss unassigned face on another asset shared with the space: what a scan queues.
      const candidateFace = await db.query<{ id: string }>(
        `INSERT INTO asset_face ("assetId") VALUES ($1) RETURNING id`,
        [candidateAsset.id],
      );
      await db.query(`INSERT INTO face_person_verdict ("spacePersonId", "assetFaceId", distance) VALUES ($1, $2, $3)`, [
        suggestionPersonId,
        candidateFace.rows[0].id,
        0.6,
      ]);
    });

    test.afterAll(async () => {
      const config = await utils.getSystemConfig(adminLogin.accessToken);
      config.machineLearning.facialRecognition.suggestions = { enabled: false, maxDistance: 0.7 };
      await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(adminLogin.accessToken) });
    });

    test('a space editor sees the suggestion banner on the global person profile', async ({ context, page }) => {
      await utils.setAuthCookies(context, editorLogin.accessToken);

      const summaryResponse = page.waitForResponse(
        (response) => response.request().method() === 'GET' && response.url().includes(suggestionsPath()),
      );
      await page.goto(`/people/${suggestionPersonId}`);
      const response = await summaryResponse;
      expect(response.status()).toBe(200);

      await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeVisible();
      await expect(page.locator('[data-testid="suggestion-review-btn"]')).toBeVisible();
    });

    test('a space viewer sees no suggestion banner on the global person profile', async ({ context, page }) => {
      await utils.setAuthCookies(context, viewerLogin.accessToken);

      const summaryResponse = page.waitForResponse(
        (response) => response.request().method() === 'GET' && response.url().includes(suggestionsPath()),
      );
      await page.goto(`/people/${suggestionPersonId}`);
      const response = await summaryResponse;
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ total: 0, items: [] });

      await expect(page.getByText('Suggestion Target')).toBeVisible();
      await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();
    });
  });
});
