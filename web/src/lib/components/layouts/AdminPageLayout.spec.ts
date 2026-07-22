import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/lib/components/layouts/AdminPageLayout.svelte'), 'utf8');
const appCss = readFileSync(join(process.cwd(), 'src/app.css'), 'utf8');

describe('AdminPageLayout demo preview', () => {
  it('wraps the admin shell for the demo preview', () => {
    expect(source).toContain('<div class="demo-admin-shell">');
  });

  it('keeps the admin header at navbar height', () => {
    expect(source).toContain('max-md:h-(--navbar-height-md) h-(--navbar-height)');
    expect(appCss).toContain('.demo-admin-shell > header');
    expect(appCss).toContain('height: var(--navbar-height);');
    expect(appCss).toContain('height: var(--navbar-height-md);');
  });
});
