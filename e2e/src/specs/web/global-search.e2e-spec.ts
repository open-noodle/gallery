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
    // Wait for SvelteKit CSR hydration to finish before any keyboard.press —
    // page.goto resolves on the `load` event, but hydration (which binds our
    // svelte:document use:shortcut handler for Ctrl+K / Shift+T / …) happens
    // asynchronously after that. The cmdk-trigger button is rendered under
    // `{#if featureFlagsManager.valueOrUndefined?.search}` in the navbar, so
    // seeing it proves the feature-flag manager loaded AND the navbar
    // hydrated — i.e. the whole layout's actions are wired up.
    await page.getByTestId('cmdk-trigger').waitFor({ state: 'visible' });
  });

  // The classic SearchBar (in the navbar) and the cmdk Command.Input both expose
  // role="combobox", so bare `page.getByRole('combobox')` is ambiguous under
  // Playwright strict mode. Scope every palette combobox lookup to the Modal's
  // dialog, which only exists while the palette is open.
  test('Ctrl+K opens the palette dialog', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox')).toBeFocused();
  });

  test('Esc clears input, second Esc closes (APG two-stage)', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const combobox = page.getByRole('dialog').getByRole('combobox');
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
    await page.getByTestId('cmdk-trigger').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('maxlength on input is 256', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const combobox = page.getByRole('dialog').getByRole('combobox');
    await expect(combobox).toHaveAttribute('maxlength', '256');
  });

  test('focus returns to the trigger after the palette closes', async ({ page }) => {
    const trigger = page.getByTestId('cmdk-trigger');
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Escape'); // empty already → closes
    await expect(dialog).toBeHidden();
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
      await page.getByRole('dialog').getByRole('combobox').fill('beach');
      await expect(page.getByText(/smart search is unavailable/i)).toBeVisible();
    });

    test('"Try Filename mode" button hides the banner', async ({ page }) => {
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').getByRole('combobox').fill('beach');
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
      await page.getByRole('dialog').getByRole('combobox').fill('auto');
      await expect(page.getByText(/auto-classification/i)).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/system-settings\?isOpen=classification/);
    });

    test('type "toggle theme" → click Theme action → theme toggles', async ({ page }) => {
      // Click the row directly rather than relying on Enter + auto-select.
      // The palette's navigation section renders categories in a fixed order
      // (systemSettings → admin → userPages → actions), so any query that
      // weakly fuzzy-matches a systemSettings item will auto-select that
      // item ahead of the ACTIONS entry regardless of score. 'toggle' and
      // 'toggle theme' both fuzzy-match 'Storage Template' via
      // computeCommandScore's greedy subsequence matcher, so Enter on this
      // query lands on a settings panel rather than nav:theme. A real UX
      // fix would order sections by best item score; until then, click the
      // exact row.
      const initialDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').getByRole('combobox').fill('toggle theme');
      await page.getByText(/toggle theme/i).click();
      await expect
        .poll(async () => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(!initialDark);
    });

    // SWR behavior (ok preserved, empty/error/timeout flip to loading) is covered
    // exhaustively by global-search-manager.svelte.spec.ts. An e2e equivalent would
    // need populated smart-search results to exercise the ok-preservation path, which
    // is impractical in the CI stack (ML is disabled, so searchSmart always returns
    // empty with the 1 asset test data — the empty-flip behavior is the correct
    // design, not a bug, so the original "does not flash skeleton rows" assertion
    // was misconceived).

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
      await page.getByTestId('cmdk-trigger').waitFor({ state: 'visible' });
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').getByRole('combobox').fill('classific');
      // 'classific' matches only admin system-settings item, which is gated out.
      // Expect no Auto-Classification row visible.
      await expect(page.getByText(/auto-classification/i)).toHaveCount(0);
    });

    test('admin demotion: stale admin recents are purged on next open', async ({ page, context }) => {
      // Step 1: as admin, navigate via palette to seed a recent entry.
      await utils.setAuthCookies(context, admin.accessToken);
      await page.goto('/photos');
      await page.getByTestId('cmdk-trigger').waitFor({ state: 'visible' });
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').getByRole('combobox').fill('auto');
      await expect(page.getByText(/auto-classification/i)).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/classification/);
      // Step 2: swap to non-admin cookies (simulating a demotion).
      await utils.setAuthCookies(context, nonAdmin.accessToken);
      await page.goto('/photos');
      await page.getByTestId('cmdk-trigger').waitFor({ state: 'visible' });
      await page.keyboard.press('Control+k');
      // Empty query → Recent section should NOT contain Auto-Classification.
      await expect(page.getByText(/auto-classification/i)).toHaveCount(0);
    });
  });
});
