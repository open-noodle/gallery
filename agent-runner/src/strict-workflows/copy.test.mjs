import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderCopy } from './copy.mjs';

const plannedSummary = {
  workflowKind: 'create_recent_trip_album',
  albumName: 'USA Trip',
  label: 'New York, USA',
  dateRange: 'May 3-12, 2026',
  assetCount: 28,
  exclusions: '3 known duplicate variants and 1 stack child',
};

describe('strict workflow copy', () => {
  it('template mode reproduces the current deterministic success string verbatim', async () => {
    const text = await renderCopy({
      outcome: { status: 'planned', planId: 'p1', successSummary: plannedSummary },
      mode: 'template',
    });
    // Byte-for-byte parity with today's strict-workflows.mjs success copy.
    assert.equal(
      text,
      'I found a likely New York, USA trip from May 3-12, 2026 and proposed USA Trip with 28 assets.' +
        ' I skipped 3 known duplicate variants and 1 stack child. Review the plan before applying it.',
    );
  });

  it('llm-polish rephrases the summary but still gates on planId', async () => {
    const polish = async (summary) => `Done! Your ${summary.albumName} album is ready to review.`;
    const text = await renderCopy({
      outcome: { status: 'planned', planId: 'p1', successSummary: plannedSummary },
      mode: 'llm-polish',
      polish,
    });
    assert.match(text, /USA Trip album is ready to review/);
  });

  it('never claims success without a planId, even in polish mode', async () => {
    const polish = async () => 'I created the album!';
    const text = await renderCopy({
      outcome: { status: 'planned', planId: undefined, successSummary: plannedSummary },
      mode: 'llm-polish',
      polish,
    });
    assert.doesNotMatch(text, /created|ready|proposed/i);
  });

  it('falls back to template when polish throws', async () => {
    const polish = async () => {
      throw new Error('provider down');
    };
    const text = await renderCopy({
      outcome: { status: 'planned', planId: 'p1', successSummary: plannedSummary },
      mode: 'llm-polish',
      polish,
    });
    assert.match(text, /Review the plan before applying it/);
  });

  it('uses templates for non-planned outcomes regardless of mode', async () => {
    const text = await renderCopy({
      outcome: { status: 'failed', text: 'No plan.' },
      mode: 'llm-polish',
      polish: async () => 'x',
    });
    assert.equal(text, 'No plan.');
  });
});
