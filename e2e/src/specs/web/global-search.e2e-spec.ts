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
    await page
      .getByRole('button', { name: /search/i })
      .first()
      .click();
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

  test.describe('navigation provider', () => {
    test('type "auto" → Auto-Classification appears → Enter opens the settings accordion', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox').fill('auto');
      await expect(page.getByText(/auto-classification/i)).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/system-settings\?isOpen=classification/);
    });

    test('type "theme" → Theme action appears → Enter toggles the theme', async ({ page }) => {
      const initialDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox').fill('theme');
      // The navigation-row renders both the label (Theme) and description (Toggle theme).
      // Match on the description text so we don't collide with any accidental "Theme" string
      // in entity section headings.
      await expect(page.getByText(/toggle theme/i)).toBeVisible();
      await page.keyboard.press('Enter');
      await expect
        .poll(async () => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(!initialDark);
    });

    test('SWR: typing into populated results does not flash skeleton rows', async ({ page }) => {
      await page.keyboard.press('Control+k');
      const combobox = page.getByRole('combobox');
      await combobox.fill('beach');
      // Wait for either a result row OR an empty/error state to settle.
      await page.waitForTimeout(400);
      // Assert Skeleton elements are absent while typing additional characters.
      // Skeleton.svelte renders <div data-skeleton="true">; if SWR works, photos stays
      // ok (or empty) and the loading branch never re-renders.
      expect(await page.locator('[data-skeleton="true"]').count()).toBe(0);
      await combobox.press('y');
      await combobox.press('z');
      expect(await page.locator('[data-skeleton="true"]').count()).toBe(0);
    });

    test('Ctrl+K reclaim: our palette opens (not the legacy @immich/ui one)', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog')).toBeVisible();
      // Positive signature of OUR palette: the mode-selector radiogroup. The legacy
      // @immich/ui action palette has no such element.
      await expect(page.getByRole('radio', { name: /smart/i })).toBeVisible();
    });

    test('Shift+T toggles the theme outside the palette', async ({ page }) => {
      // This shortcut was previously provided by @immich/ui's action palette. After
      // disabling that, we re-registered it directly on +layout.svelte.
      const initialDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      await page.keyboard.press('Shift+T');
      await expect
        .poll(async () => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(!initialDark);
    });
  });

  test.describe('navigation provider (non-admin)', () => {
    let nonAdmin: LoginResponseDto;

    test.beforeAll(async () => {
      nonAdmin = await utils.userSetup(admin.accessToken, {
        email: 'nonadmin-nav@cmdk.test',
        password: 'pw',
        name: 'NonAdmin Nav',
      });
    });

    test.beforeEach(async ({ context }) => {
      // Override the admin cookies set by the outer beforeEach with the non-admin user's.
      await utils.setAuthCookies(context, nonAdmin.accessToken);
    });

    test('System Settings and Admin sub-sections are absent', async ({ page }) => {
      await page.goto('/photos');
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox').fill('classific');
      // 'classific' matches only admin system-settings item, which is gated out.
      // Expect no Auto-Classification row visible.
      await expect(page.getByText(/auto-classification/i)).toHaveCount(0);
    });

    test('admin demotion: stale admin recents are purged on next open', async ({ page, context }) => {
      // Step 1: as admin, navigate via palette to seed a recent entry.
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto('/photos');
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox').fill('auto');
      await expect(page.getByText(/auto-classification/i)).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/classification/);
      // Step 2: swap to non-admin cookies (simulating a demotion).
      await utils.setAuthCookies(context, nonAdmin.accessToken);
      await page.goto('/photos');
      await page.keyboard.press('Control+k');
      // Empty query → Recent section should NOT contain Auto-Classification.
      await expect(page.getByText(/auto-classification/i)).toHaveCount(0);
    });
  });
});
