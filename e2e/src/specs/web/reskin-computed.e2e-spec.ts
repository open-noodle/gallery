import { expect, test } from '@playwright/test';

// Deterministic, auth-free guards that the fork-owned theme layer actually
// applies in the browser (the vitest specs only parse the CSS file; these prove
// the @theme remap + the .dark token flip reach the rendered DOM). Values are
// the final palette in web/src/styles/gallery-theme.css.
const toRgb = (hex: string): string => {
  const h = hex.replace('#', '');
  return `rgb(${Number.parseInt(h.slice(0, 2), 16)}, ${Number.parseInt(h.slice(2, 4), 16)}, ${Number.parseInt(h.slice(4, 6), 16)})`;
};

// In vite dev the stylesheet is injected by JS, so wait until the theme tokens
// resolve before reading computed styles (no-op against a built/static stack).
const waitForTheme = (page: import('@playwright/test').Page) =>
  page.waitForFunction(
    () => getComputedStyle(document.documentElement).getPropertyValue('--immich-ui-primary-500').trim().length > 0,
  );

const readAccent = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.createElement('span');
    el.style.color = 'var(--immich-ui-primary-500)';
    document.body.append(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  });

test.describe('re-skin computed styles', () => {
  test('gray utilities are remapped to the neutral ramp', async ({ page }) => {
    await page.goto('/');
    await waitForTheme(page);
    const bg = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'bg-gray-100';
      document.body.append(el);
      const c = getComputedStyle(el).backgroundColor;
      el.remove();
      return c;
    });
    expect(bg).toBe(toRgb('#f0f4f9'));
  });

  test('primary accent flips between light and dark', async ({ page }) => {
    await page.goto('/');
    await waitForTheme(page);
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    const light = await readAccent(page);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const dark = await readAccent(page);

    expect(light).toBe(toRgb('#0b57d0')); // primary (light)
    expect(dark).toBe(toRgb('#a8c7fa')); // primary (dark)
    expect(light).not.toBe(dark);
  });
});
