import { init, register, waitLocale } from 'svelte-i18n';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ScopedSearchButton from './scoped-search-button.svelte';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('ScopedSearchButton', () => {
  it('fires onclick so the host can open the search palette', async () => {
    const onclick = vi.fn();
    const screen = await render(ScopedSearchButton, { onclick });

    await screen.getByTestId('scoped-search-button').click();

    expect(onclick).toHaveBeenCalledOnce();
  });

  it('is labelled and tooltipped, so the affordance is discoverable rather than a bare glyph', async () => {
    const screen = await render(ScopedSearchButton, { onclick: vi.fn() });

    const button = screen.getByTestId('scoped-search-button');
    await expect.element(button).toHaveAttribute('aria-label', 'Search here');
    await expect.element(button).toHaveAttribute('title', 'Search here');
  });

  it('is a real button (keyboard reachable, never a submit)', async () => {
    const screen = await render(ScopedSearchButton, { onclick: vi.fn() });

    const button = screen.getByTestId('scoped-search-button');
    expect(button.element().tagName).toBe('BUTTON');
    await expect.element(button).toHaveAttribute('type', 'button');
  });
});
