import { describe, expect, it } from 'vitest';
import source from './ReadOnlyDemoNotice.svelte?raw';

describe('ReadOnlyDemoNotice spacing', () => {
  it('keeps space between the demo notice and following admin controls', () => {
    expect(source).toContain('mb-4');
  });
});
