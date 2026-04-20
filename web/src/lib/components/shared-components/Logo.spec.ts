import { themeManager, ThemePreference } from '@immich/ui';
import { render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Logo from './Logo.svelte';

describe('Logo Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    themeManager.setPreference(ThemePreference.Light);
  });

  it('should render logo with default props', () => {
    const { container } = render(Logo);
    const img = container.querySelector('img');
    expect(img).toBeDefined();
    expect(img?.alt).toBe('Gallery logo');
  });

  it('should render icon variant by default', () => {
    const { container } = render(Logo);
    const img = container.querySelector('img');
    expect(img?.className).toContain('aspect-square');
    expect(img?.className).toContain('h-12');
  });

  it('should render inline variant', () => {
    const { container } = render(Logo, { props: { variant: 'inline' } });
    const img = container.querySelector('img');
    expect(img?.src).toContain('inline');
  });

  it('should render stacked variant', () => {
    const { container } = render(Logo, { props: { variant: 'stacked' } });
    const img = container.querySelector('img');
    expect(img?.src).toContain('stacked');
  });

  it('should apply size classes', () => {
    const { container } = render(Logo, { props: { size: 'large' } });
    const img = container.querySelector('img');
    expect(img?.className).toContain('h-16');
  });

  it('should use light theme logo by default', () => {
    themeManager.setPreference(ThemePreference.Light);
    const { container } = render(Logo, { props: { variant: 'inline' } });
    const img = container.querySelector('img');
    expect(img?.src).toContain('light');
  });

  it('should use dark theme logo when theme is dark', () => {
    themeManager.setPreference(ThemePreference.Dark);
    const { container } = render(Logo, { props: { variant: 'inline' } });
    const img = container.querySelector('img');
    expect(img?.src).toContain('dark');
  });

  it('should support custom classes', () => {
    const { container } = render(Logo, { props: { class: 'custom-class' } });
    const img = container.querySelector('img');
    expect(img?.className).toContain('custom-class');
  });
});
