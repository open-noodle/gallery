import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('global search palette', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    await utils.createAsset(admin.accessToken);
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
  });

  test.beforeEach(async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto('/photos');
  });

  test('Ctrl+K opens the palette dialog', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('combobox')).toBeFocused();
  });

  test('Esc clears input, second Esc closes (APG two-stage)', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const combobox = page.getByRole('combobox');
    await combobox.fill('beach');
    await expect(combobox).toHaveValue('beach');
    await page.keyboard.press('Escape');
    await expect(combobox).toHaveValue('');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('Ctrl+K inside the palette closes it', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('clicking the trigger opens the palette', async ({ page }) => {
    await page.getByRole('button', { name: /search/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('maxlength on input is 256', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const combobox = page.getByRole('combobox');
    await expect(combobox).toHaveAttribute('maxlength', '256');
  });

  test('focus returns to the trigger after the palette closes', async ({ page }) => {
    const trigger = page.getByRole('button', { name: /search/i }).first();
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Escape'); // empty already → closes
    await expect(page.getByRole('dialog')).toBeHidden();
    // @immich/ui Modal / bits-ui Dialog restores focus to the element that had it
    // before the dialog opened. If this regresses, it's a keyboard-a11y issue.
    await expect(trigger).toBeFocused();
  });

  test('Ctrl+/ cycles search mode via footer', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    // Smart is default
    await expect(page.getByRole('radio', { name: /smart/i })).toBeChecked();
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('radio', { name: /filename/i })).toBeChecked();
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('radio', { name: /description/i })).toBeChecked();
  });

  test.describe('ML unhealthy banner', () => {
    // CI runs with ML disabled, so /server/ml-health reports { smartSearchHealthy: false }.
    test('shows the smart-search-unavailable banner in smart mode after typing', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox').fill('beach');
      await expect(page.getByText(/smart search is unavailable/i)).toBeVisible();
    });

    test('"Try Filename mode" button hides the banner', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox').fill('beach');
      await expect(page.getByText(/smart search is unavailable/i)).toBeVisible();
      await page.getByRole('button', { name: /try filename mode/i }).click();
      await expect(page.getByText(/smart search is unavailable/i)).toBeHidden();
      await expect(page.getByRole('radio', { name: /filename/i })).toBeChecked();
    });
  });

  // NOTE: Feature-flag-off coverage (trigger hidden, Ctrl+K no-op) is intentionally
  // not an E2E test because `search` is hardcoded to `true` in
  // `server.service.ts:getFeatures()` — there is no SystemConfig path to flip it.
  // The unit-level trigger + manager tests (in web/src/lib/components/global-search/)
  // cover the flag-off branch via a mocked featureFlagsManager.
});
