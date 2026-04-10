import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import LoadingSpinner from './LoadingSpinner.svelte';

describe('LoadingSpinner Component', () => {
  it('should render animated spinner', () => {
    const { container } = render(LoadingSpinner);
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img).toBeDefined();
    expect(img?.getAttribute('alt')).toBe('Loading');
  });

  it('should have role="status" for accessibility', () => {
    const { container } = render(LoadingSpinner);
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img?.getAttribute('role')).toBe('status');
  });

  it('should apply size classes', () => {
    const { container } = render(LoadingSpinner, { props: { size: 'large' } });
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img?.className).toContain('h-6');
  });

  it('should support custom classes', () => {
    const { container } = render(LoadingSpinner, { props: { class: 'custom-spinner' } });
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img?.className).toContain('custom-spinner');
  });

  it('should use default medium size', () => {
    const { container } = render(LoadingSpinner);
    const img = container.querySelector('[data-testid="loading-spinner"]');
    expect(img?.className).toContain('h-5');
  });

  it('should load gallery loader SVG', () => {
    const { container } = render(LoadingSpinner);
    const img = container.querySelector('[data-testid="loading-spinner"]');
    // LoadingSpinner is theme-aware and swaps between gallery-loader.svg and
    // gallery-loader-dark.svg based on @immich/ui theme. Assert the shared prefix.
    expect(img?.getAttribute('src')).toMatch(/gallery-loader(-dark)?\.svg/);
  });
});
