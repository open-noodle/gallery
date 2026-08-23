import { isInScope } from './reskin-scope.mjs';

describe('isInScope', () => {
  const importLine = "@import './styles/gallery-theme.css';";

  it('passes for the token file + the single app.css import', () => {
    const r = isInScope(['web/src/styles/gallery-theme.css', 'web/src/app.css'], [importLine]);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
  it('fails when a component is recolored', () => {
    const r = isInScope(['web/src/lib/components/foo.svelte'], []);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain('web/src/lib/components/foo.svelte');
  });
  it('fails when app.css gains a non-import line', () => {
    const r = isInScope(['web/src/app.css'], [importLine, '.foo { color: red; }']);
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toContain('web/src/app.css');
  });
  it('allows app.css with no added lines (deletion-only diff)', () => {
    const r = isInScope(['web/src/app.css'], []);
    expect(r.ok).toBe(true);
  });
  it('allows font assets and package manifests', () => {
    const r = isInScope(['web/src/lib/assets/fonts/dm-sans.woff2', 'web/package.json'], []);
    expect(r.ok).toBe(true);
  });
  it('allows the root monorepo lockfile and the design docs', () => {
    const r = isInScope(['pnpm-lock.yaml', 'specs/2026-06-22-web-tonal-reskin-design.md'], []);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
  it('allows the re-skin e2e specs + e2e manifest', () => {
    const r = isInScope(
      [
        'e2e/src/specs/web/reskin-computed.e2e-spec.ts',
        'e2e/src/specs/web/reskin-visual.e2e-spec.ts-snapshots/_photos-light.png',
        'e2e/package.json',
      ],
      [],
    );
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
});
