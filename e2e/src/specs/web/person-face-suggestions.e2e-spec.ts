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

    // open the read-gate: suggestions.maxDistance (0.8) > maxDistance (0.5)
    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.suggestions = { enabled: true, maxDistance: 0.8 };
    await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

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
      await db.query(`INSERT INTO face_person_verdict ("personGroupId", "assetFaceId", distance) VALUES ($1, $2, $3)`, [
        personId,
        faceId,
        distance,
      ]);
    }
  });

  test.afterAll(async () => {
    const cfg = await utils.getSystemConfig(admin.accessToken);
    cfg.machineLearning.facialRecognition.suggestions = { enabled: false, maxDistance: 0.7 };
    await updateConfig({ adminConfigDto: cfg }, { headers: asBearerAuth(admin.accessToken) });
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

    // `act('confirm')` fires one POST per click and the click does not await it. Nothing below used to wait for
    // it: `suggestion-progress` was ALREADY visible before the click, so asserting its visibility passes
    // instantly and synchronises nothing, letting the API read below race the write and read a still-pending 3.
    // Arm the response wait before the click (album.e2e-spec.ts's idiom) so the assertion measures a confirm the
    // server has committed — the drain shares the confirm's transaction, so the response is a sufficient gate.
    const confirmed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && /\/face-suggestions\/[^/]+\/confirm$/.test(response.url()),
    );
    await page.locator('[data-testid="suggestion-same-btn"]').click(); // confirm face 1
    await confirmed;

    // queue advances; progress still visible for remaining items
    await expect(page.locator('[data-testid="suggestion-progress"]')).toBeVisible();

    // server-side proof: one fewer pending suggestion — use the API directly
    const res = await page.request.get(`/api/people/${personId}/face-suggestions`);
    const body = (await res.json()) as { total: number };
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

  // Runs last: it consumes a suggestion, and the tests above depend on the pending count.
  //
  // The review modal's footer used to be a single non-wrapping flex row, and @immich/ui's Card wraps the modal in
  // `overflow-hidden` — so on a phone the row overflowed to the end and the primary "Same person" button was
  // CLIPPED, not scrolled, i.e. unreachable. boundingBox() reports the layout box and ignores the clipping
  // ancestor, so a right edge past the viewport is the precise signal for that overflow.
  test('the verdict buttons stay inside the viewport at a phone width', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/people/${personId}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeVisible();
    await page.locator('[data-testid="suggestion-review-btn"]').click();
    await expect(page.locator('[data-testid="suggestion-progress"]')).toBeVisible();

    const viewport = page.viewportSize()!;
    for (const testId of ['suggestion-different-btn', 'suggestion-ignore-btn', 'suggestion-same-btn']) {
      const box = await page.locator(`[data-testid="${testId}"]`).boundingBox();
      expect(box, testId).not.toBeNull();
      expect.soft(box!.x, testId).toBeGreaterThanOrEqual(0);
      expect.soft(box!.x + box!.width, testId).toBeLessThanOrEqual(viewport.width);
    }

    // ...and the primary action is operable, not merely laid out on-screen.
    await page.locator('[data-testid="suggestion-same-btn"]').click();
    await expect(page.locator('[data-testid="suggestion-progress"]')).toBeVisible();
  });
});
