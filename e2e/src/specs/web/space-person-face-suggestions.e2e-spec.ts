import {
  SharedSpaceRole,
  updateConfig,
  updateSpace,
  type LoginResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { expect, test, type Page } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { asBearerAuth, utils } from 'src/utils';

type FixtureOptions = {
  name: string;
  faceRecognitionEnabled?: boolean;
  candidateShared?: boolean;
  personName?: string;
};

type SpaceSuggestionFixture = {
  space: SharedSpaceResponseDto;
  spacePersonId: string;
};

const suggestionsPath = (fixture: SpaceSuggestionFixture) =>
  `/api/shared-spaces/${fixture.space.id}/people/${fixture.spacePersonId}/face-suggestions`;

async function expectEmptySuggestions(page: Page, fixture: SpaceSuggestionFixture) {
  const response = await page.request.get(suggestionsPath(fixture));
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ total: 0, items: [] });
}

async function gotoSpacePersonAndWaitForSuggestionSummary(page: Page, fixture: SpaceSuggestionFixture) {
  const summaryResponse = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes(suggestionsPath(fixture)),
  );
  await page.goto(`/spaces/${fixture.space.id}/people/${fixture.spacePersonId}`);
  const response = await summaryResponse;
  expect(response.status()).toBe(200);
}

test.describe('Space person face suggestions (web)', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    owner = await utils.userSetup(admin.accessToken, createUserDto.create('space-suggestion-owner'));
    editor = await utils.userSetup(admin.accessToken, createUserDto.create('space-suggestion-editor'));
    viewer = await utils.userSetup(admin.accessToken, createUserDto.create('space-suggestion-viewer'));

    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.maxDistance = 0.5;
    config.machineLearning.facialRecognition.suggestions = { enabled: true, maxDistance: 0.8 };
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });
  });

  test.afterAll(async () => {
    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.suggestions = { enabled: false, maxDistance: 0.7 };
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });
  });

  async function createFixture(options: FixtureOptions): Promise<SpaceSuggestionFixture> {
    const db = await utils.connectDatabase();
    const space = await utils.createSpace(owner.accessToken, { name: options.name });
    await updateSpace(
      {
        id: space.id,
        sharedSpaceUpdateDto: { faceRecognitionEnabled: options.faceRecognitionEnabled ?? true },
      },
      { headers: asBearerAuth(owner.accessToken) },
    );
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: editor.userId,
      role: SharedSpaceRole.Editor,
    });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: viewer.userId,
      role: SharedSpaceRole.Viewer,
    });

    const representativeAsset = await utils.createAsset(owner.accessToken);
    const candidateAsset = await utils.createAsset(owner.accessToken);
    await utils.addSpaceAssets(owner.accessToken, space.id, [representativeAsset.id, candidateAsset.id]);
    await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');

    const { spacePersonId } = await utils.createSpacePerson(
      space.id,
      options.personName ?? 'E2E Space Suggest Target',
      owner.userId,
      representativeAsset.id,
    );

    for (const distance of [0.55, 0.6, 0.65]) {
      const face = await db.query<{ id: string }>(`INSERT INTO asset_face ("assetId") VALUES ($1) RETURNING id`, [
        candidateAsset.id,
      ]);
      await db.query(`INSERT INTO face_person_verdict ("spacePersonId", "assetFaceId", distance) VALUES ($1, $2, $3)`, [
        spacePersonId,
        face.rows[0].id,
        distance,
      ]);
    }

    if (options.candidateShared === false) {
      await db.query(`DELETE FROM shared_space_asset WHERE "spaceId" = $1 AND "assetId" = $2`, [
        space.id,
        candidateAsset.id,
      ]);
    }

    return { space, spacePersonId };
  }

  test('editor sees the banner, opens the review modal, and confirms a suggestion', async ({ context, page }) => {
    const fixture = await createFixture({ name: 'Space Suggestion Golden' });
    await utils.setAuthCookies(context, editor.accessToken);

    await gotoSpacePersonAndWaitForSuggestionSummary(page, fixture);
    await page.evaluate(() => localStorage.clear());
    const reloadSummaryResponse = page.waitForResponse(
      (response) => response.request().method() === 'GET' && response.url().includes(suggestionsPath(fixture)),
    );
    await page.reload();
    const reloadResponse = await reloadSummaryResponse;
    expect(reloadResponse.status()).toBe(200);

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeVisible();

    await page.locator('[data-testid="suggestion-review-btn"]').click();
    await expect(page.locator('[data-testid="suggestion-progress"]')).toBeVisible();

    const confirmResponse = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/face-suggestions/'),
    );
    await page.locator('[data-testid="suggestion-same-btn"]').click();
    const confirmResult = await confirmResponse;
    expect(confirmResult.status()).toBe(200);
    await expect(page.locator('[data-testid="suggestion-progress"]')).toBeVisible();

    const response = await page.request.get(suggestionsPath(fixture));
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(2);
  });

  test('viewer sees no banner and the API returns zero suggestions', async ({ context, page }) => {
    const fixture = await createFixture({ name: 'Space Suggestion Viewer' });
    await utils.setAuthCookies(context, viewer.accessToken);

    await gotoSpacePersonAndWaitForSuggestionSummary(page, fixture);

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();
    await expectEmptySuggestions(page, fixture);
  });

  test('stale unshared candidate rows do not show a banner and the API is empty', async ({ context, page }) => {
    const fixture = await createFixture({ name: 'Space Suggestion Stale', candidateShared: false });
    await utils.setAuthCookies(context, editor.accessToken);

    await gotoSpacePersonAndWaitForSuggestionSummary(page, fixture);

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();
    await expectEmptySuggestions(page, fixture);
  });

  test('whitespace-name space person does not show a banner', async ({ context, page }) => {
    const db = await utils.connectDatabase();
    const fixture = await createFixture({ name: 'Space Suggestion Unnamed', personName: 'Temporary Name' });
    await db.query(`UPDATE shared_space_person SET name = '   ' WHERE id = $1`, [fixture.spacePersonId]);
    await utils.setAuthCookies(context, editor.accessToken);

    await gotoSpacePersonAndWaitForSuggestionSummary(page, fixture);

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();
    await expectEmptySuggestions(page, fixture);
  });

  test('faceRecognitionEnabled=false space does not show a banner', async ({ context, page }) => {
    const fixture = await createFixture({
      name: 'Space Suggestion Disabled',
      faceRecognitionEnabled: false,
    });
    await utils.setAuthCookies(context, editor.accessToken);

    await gotoSpacePersonAndWaitForSuggestionSummary(page, fixture);

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();
    await expectEmptySuggestions(page, fixture);
  });
});
