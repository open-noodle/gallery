import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { describe, expect, it, vi } from 'vitest';
import ScopedSearchButton from './scoped-search-button.svelte';

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('ScopedSearchButton', () => {
  it('fires onclick so the host can open the search palette', async () => {
    const onclick = vi.fn();
    render(ScopedSearchButton, { onclick });

    await fireEvent.click(screen.getByTestId('scoped-search-button'));

    expect(onclick).toHaveBeenCalledOnce();
  });

  it('is labelled and tooltipped, so the affordance is discoverable rather than a bare glyph', () => {
    render(ScopedSearchButton, { onclick: vi.fn() });

    const button = screen.getByTestId('scoped-search-button');
    expect(button).toHaveAttribute('aria-label', 'Search here');
    expect(button).toHaveAttribute('title', 'Search here');
  });

  it('is a real button (keyboard reachable, never a submit)', () => {
    render(ScopedSearchButton, { onclick: vi.fn() });

    const button = screen.getByTestId('scoped-search-button');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
  });
});
