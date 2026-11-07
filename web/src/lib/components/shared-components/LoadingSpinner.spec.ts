import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LoadingSpinner from './LoadingSpinner.svelte';

describe('LoadingSpinner Component', () => {
  it('should render animated spinner', async () => {
    const { container } = await render(LoadingSpinner);
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img).toBeDefined();
    expect(img?.getAttribute('alt')).toBe('loading');
  });

  it('should have role="status" for accessibility', async () => {
    const { container } = await render(LoadingSpinner);
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img?.getAttribute('role')).toBe('status');
  });

  it('should apply size classes', async () => {
    const { container } = await render(LoadingSpinner, { props: { size: 'large' } });
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img?.className).toContain('h-6');
  });

  it('should support custom classes', async () => {
    const { container } = await render(LoadingSpinner, { props: { class: 'custom-spinner' } });
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img?.className).toContain('custom-spinner');
  });

  it('should use default medium size', async () => {
    const { container } = await render(LoadingSpinner);
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img?.className).toContain('h-5');
  });

  it('should animate so it reads as a loading indicator, not a static logo', async () => {
    const { container } = await render(LoadingSpinner);
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img?.className).toContain('animate-spin');
  });

  it('should keep animating when a custom class is supplied', async () => {
    const { container } = await render(LoadingSpinner, { props: { class: 'custom-spinner' } });
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img?.className).toContain('animate-spin');
    expect(img?.className).toContain('custom-spinner');
  });

  it('should load gallery loader SVG', async () => {
    const { container } = await render(LoadingSpinner);
    const img = container.querySelector('[data-testid="loading-spinner"]');
    // LoadingSpinner is theme-aware and swaps between gallery-loader.svg and
    // gallery-loader-dark.svg based on @immich/ui theme. Assert the shared prefix.
    expect(img?.getAttribute('src')).toMatch(/gallery-loader(-dark)?\.svg/);
  });
});
