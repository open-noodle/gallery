import type { LoginResponseDto } from '@immich/sdk';
import { updateConfig } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

test.describe('Person face suggestions (web)', () => {
  let admin: LoginResponseDto;
  let personId: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // open the read-gate: suggestionMaxDistance (0.8) > maxDistance (0.5)
    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.suggestionMaxDistance = 0.8;
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

    const person = await utils.createPerson(admin.accessToken, { name: 'E2E Suggest Target' });
    personId = person.id;

    const asset = await utils.createAsset(admin.accessToken);
    await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');

    const db = await utils.connectDatabase();
    const mkFace = async () => {
      const r = await db.query<{ id: string }>(`INSERT INTO asset_face ("assetId") VALUES ($1) RETURNING id`, [
        asset.id,
      ]);
      return r.rows[0].id;
    };
    for (const distance of [0.55, 0.6, 0.65]) {
      const faceId = await mkFace();
      await db.query(`INSERT INTO person_face_suggestion ("personId", "assetFaceId", distance) VALUES ($1, $2, $3)`, [
        personId,
        faceId,
        distance,
      ]);
    }
  });

  test.afterAll(async () => {
    const cfg = await utils.getSystemConfig(admin.accessToken);
    cfg.machineLearning.facialRecognition.suggestionMaxDistance = 0;
    await updateConfig({ systemConfigDto: cfg }, { headers: asBearerAuth(admin.accessToken) });
  });

  test('banner shows the count and opens the review modal; Same person confirms', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/people/${personId}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const banner = page.locator('[data-testid="person-suggestion-banner"]');
    await expect(banner).toBeVisible();

    await page.locator('[data-testid="suggestion-review-btn"]').click();
    await expect(page.locator('[data-testid="suggestion-progress"]')).toBeVisible();

    await page.locator('[data-testid="suggestion-same-btn"]').click(); // confirm face 1
    // queue advances; progress still visible for remaining items
    await expect(page.locator('[data-testid="suggestion-progress"]')).toBeVisible();

    // server-side proof: one fewer pending suggestion — use the API directly
    const res = await page.request.get(`/api/people/${personId}/face-suggestions`);
    const body = await res.json();
    expect(body.total).toBeLessThan(3);
  });

  test('Not now snoozes the banner across reloads', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/people/${personId}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeVisible();
    await page.locator('[data-testid="suggestion-snooze-btn"]').click();
    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();

    await page.reload();
    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();
  });
});
