import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contrastRatio } from '$lib/styles/contrast';
import { readThemeTokens } from '$lib/styles/theme-tokens';

describe('gallery-theme.css', () => {
  const t = readThemeTokens();

  it('defines a light and a dark token block', () => {
    expect(Object.keys(t.light).length).toBeGreaterThan(0);
    expect(Object.keys(t.dark).length).toBeGreaterThan(0);
  });
});

describe('L1 accent', () => {
  const t = readThemeTokens();
  const PRIMARY = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((s) => `--immich-ui-primary-${s}`);

  it('defines the full primary ramp in both modes', () => {
    for (const name of PRIMARY) {
      expect(t.light[name], `light ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.dark[name], `dark ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it('defines legacy primary aliases (mode-agnostic, in light block)', () => {
    expect(t.light['--immich-primary']).toBeDefined();
    expect(t.light['--immich-dark-primary']).toBeDefined();
  });
  it('tonal text pair meets AA (on-container navy on container, light)', () => {
    expect(
      contrastRatio(t.light['--immich-ui-primary-950'], t.light['--immich-ui-primary-200']),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it('solid accent reads on light surface (UI >= 3:1)', () => {
    expect(contrastRatio(t.light['--immich-ui-primary-600'], '#ffffff')).toBeGreaterThanOrEqual(3);
  });
  // NOTE: the dark-mode tonal active state uses `bg-primary/10` (opacity over
  // surface), which solid-token contrast math can't model — it is covered by the
  // axe scan in Task 8, intentionally not by a fast unit test here.
});

describe('L2 neutrals', () => {
  const t = readThemeTokens();
  it('defines neutral anchors in both modes', () => {
    for (const name of ['--immich-ui-light', '--immich-ui-dark', '--immich-ui-muted', '--immich-ui-default-border']) {
      expect(t.light[name], `light ${name}`).toBeDefined();
      expect(t.dark[name], `dark ${name}`).toBeDefined();
    }
  });
  it('defines legacy bg tokens (mode-agnostic, in light block)', () => {
    expect(t.light['--immich-bg']).toBeDefined();
    expect(t.light['--immich-dark-bg']).toBeDefined();
  });
  it('body text meets AA on surface (light + dark)', () => {
    expect(contrastRatio(t.light['--immich-ui-dark'], t.light['--immich-ui-light'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.dark['--immich-ui-dark'], t.dark['--immich-ui-light'])).toBeGreaterThanOrEqual(4.5);
  });
  it('muted text meets AA on surface (light + dark)', () => {
    expect(contrastRatio(t.light['--immich-ui-muted'], t.light['--immich-ui-light'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.dark['--immich-ui-muted'], t.dark['--immich-ui-light'])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('L3 typography', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/gallery-theme.css'), 'utf8');

  it('imports the self-hosted variable fonts', () => {
    expect(css).toMatch(/@import\s+['"]@fontsource-variable\/dm-sans['"]/);
    expect(css).toMatch(/@import\s+['"]@fontsource-variable\/bricolage-grotesque['"]/);
  });
  it('sets sans + display font tokens', () => {
    expect(css).toMatch(/--font-sans:\s*['"]DM Sans Variable['"]/);
    expect(css).toMatch(/--font-display:\s*['"]Bricolage Grotesque Variable['"]/);
  });
  it('applies the display font to headings', () => {
    expect(css).toMatch(/h1,\s*h2,\s*h3[\s\S]*font-family:\s*var\(--font-display\)/);
  });
  it('declares the font tokens inside the @theme block', () => {
    const theme = css.match(/@theme\s*\{[\s\S]*?\n\}/);
    expect(theme, '@theme block present').not.toBeNull();
    expect(theme![0]).toMatch(/--font-sans:\s*['"]DM Sans Variable['"]/);
    expect(theme![0]).toMatch(/--font-display:\s*['"]Bricolage Grotesque Variable['"]/);
  });
});
