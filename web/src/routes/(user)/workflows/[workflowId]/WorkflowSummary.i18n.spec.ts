import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// __dirname is not defined in ESM (vitest default). Derive it from import.meta.url.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'WorkflowSummary.svelte'), 'utf8');

describe('WorkflowSummary.svelte close-button i18n', () => {
  it('does not hardcode the English close-button label', () => {
    expect(source).not.toContain('"Close summary"');
  });

  it("drives the close-button title/aria-label from $t('workflow_close_summary')", () => {
    const matches = source.match(/\$t\('workflow_close_summary'\)/g) ?? [];
    // one for title, one for aria-label
    expect(matches.length).toBe(2);
  });
});
