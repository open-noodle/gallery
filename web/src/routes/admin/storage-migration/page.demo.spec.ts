import { describe, expect, it } from 'vitest';
import source from './+page.svelte?raw';

describe('Storage migration demo mode', () => {
  it('does not poll status in read-only demo mode', () => {
    expect(source).toContain('const isReadOnlyDemo = $derived(authManager.isReadOnlyDemo);');
    expect(source).toContain('if (isReadOnlyDemo) {');
    expect(source).toContain('return;');
    expect(source).toContain('void fetchStatus();');
  });

  it('hides the status section in read-only demo mode', () => {
    expect(source).toContain('{#if !isReadOnlyDemo}');
    expect(source).toContain(`<h2 class="mb-4 text-lg font-semibold">{$t('status')}</h2>`);
  });
});
