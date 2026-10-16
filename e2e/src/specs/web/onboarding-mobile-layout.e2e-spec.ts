import { expect, test } from '@playwright/test';
import { utils } from 'src/utils.js';

// #1097: on a phone, long German step titles ("Datenschutzeinstellungen Nutzer") pushed the
// onboarding buttons past the screen edge. Walk the whole admin flow at iPhone width and check
// that no step scrolls sideways.
test.describe('Onboarding on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeAll(() => {
    utils.initSdk();
  });

  test.beforeEach(async () => {
    await utils.resetDatabase();
  });

  test('every step fits the screen width in German', async ({ context, page }) => {
    const admin = await utils.adminSetup({ onboarding: false });
    await utils.setAuthCookies(context, admin.accessToken);
    await context.addInitScript(() => localStorage.setItem('lang', 'de'));

    await page.goto('/auth/onboarding');
    const card = page.locator('#onboarding-card');
    const nextButton = card.locator(':scope > div:last-child button').last();
    const steps = ['theme', 'language', 'server_privacy', 'user_privacy', 'storage_template', 'backup', 'mobile_app'];

    for (const step of [undefined, ...steps]) {
      if (step) {
        await nextButton.click();
        await expect(page).toHaveURL(new RegExp(`step=${step}$`));
      }
      await expect(card).toBeVisible();
      const { scrollWidth, innerWidth, buttonRights } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        buttonRights: [...document.querySelectorAll('#onboarding-card button')].map(
          (button) => button.getBoundingClientRect().right,
        ),
      }));
      const name = step ?? 'hello';
      expect(scrollWidth, `step ${name} scrolls sideways`).toBeLessThanOrEqual(innerWidth);
      expect(Math.max(...buttonRights), `step ${name} has a button past the edge`).toBeLessThanOrEqual(innerWidth);
    }

    await nextButton.click();
    await expect(page).toHaveURL(/\/photos/);
  });
});
