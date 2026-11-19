import { describe, expect, it } from 'vitest';
import appCss from '../../../app.css?raw';
import source from './AdminPageLayout.svelte?raw';

describe('AdminPageLayout demo preview', () => {
  it('wraps the admin shell for the demo preview', () => {
    expect(source).toContain('<div class="demo-admin-shell">');
  });

  it('keeps the admin header at navbar height', () => {
    expect(source).toContain('h-(--navbar-height) max-md:h-(--navbar-height-md)');
    expect(appCss).toContain('.demo-admin-shell > header');
    expect(appCss).toContain('height: var(--navbar-height);');
    expect(appCss).toContain('height: var(--navbar-height-md);');
  });
});
