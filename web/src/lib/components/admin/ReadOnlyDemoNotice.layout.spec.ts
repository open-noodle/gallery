import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/lib/components/admin/ReadOnlyDemoNotice.svelte'), 'utf8');

describe('ReadOnlyDemoNotice spacing', () => {
  it('keeps space between the demo notice and following admin controls', () => {
    expect(source).toContain('mb-4');
  });
});
