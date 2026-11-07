import { ThemePreference, themeManager } from '@immich/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Logo from './Logo.svelte';

describe('Logo Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    themeManager.setPreference(ThemePreference.Light);
  });

  it('should render logo with default props', async () => {
    const { container } = await render(Logo);
    const img = container.querySelector('img');
    expect(img).toBeDefined();
    expect(img?.alt).toBe('Gallery logo');
  });

  it('should render icon variant by default', async () => {
    const { container } = await render(Logo);
    const img = container.querySelector('img');
    expect(img?.className).toContain('aspect-square');
    expect(img?.className).toContain('h-12');
  });

  it('should render inline variant', async () => {
    const { container } = await render(Logo, { props: { variant: 'inline' } });
    const img = container.querySelector('img');
    expect(img?.src).toContain('inline');
  });

  it('should render stacked variant', async () => {
    const { container } = await render(Logo, { props: { variant: 'stacked' } });
    const img = container.querySelector('img');
    expect(img?.src).toContain('stacked');
  });

  it('should apply size classes', async () => {
    const { container } = await render(Logo, { props: { size: 'large' } });
    const img = container.querySelector('img');
    expect(img?.className).toContain('h-16');
  });

  it('should use light theme logo by default', async () => {
    themeManager.setPreference(ThemePreference.Light);
    const { container } = await render(Logo, { props: { variant: 'inline' } });
    const img = container.querySelector('img');
    expect(img?.src).toContain('light');
  });

  it('should use dark theme logo when theme is dark', async () => {
    themeManager.setPreference(ThemePreference.Dark);
    const { container } = await render(Logo, { props: { variant: 'inline' } });
    const img = container.querySelector('img');
    expect(img?.src).toContain('dark');
  });

  it('should support custom classes', async () => {
    const { container } = await render(Logo, { props: { class: 'custom-class' } });
    const img = container.querySelector('img');
    expect(img?.className).toContain('custom-class');
  });
});
