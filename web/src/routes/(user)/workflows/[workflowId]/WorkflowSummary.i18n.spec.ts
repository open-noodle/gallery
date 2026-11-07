import { describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';

const source = await commands.readFile('src/routes/(user)/workflows/[workflowId]/WorkflowSummary.svelte');

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
