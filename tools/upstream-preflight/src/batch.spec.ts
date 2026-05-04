import { describe, expect, it } from 'vitest';
import { planBatches, renderBatchMarkdown } from './batch';
import type { ClassifiedCommit, RiskLevel } from './types';

function commit(shortSha: string, risk: RiskLevel, reasons: string[] = []): ClassifiedCommit {
  return {
    sha: `${shortSha}000000000000000000000000000000000000000`,
    shortSha,
    subject: `${risk} commit`,
    files: [],
    domains: [],
    overlapFiles: [],
    features: [],
    risk,
    reasons,
    requiredChecks: risk === 'high' ? ['mobile-drift-rebase-check'] : [],
  };
}

describe('planBatches', () => {
  it('groups low risk commits up to the soft cap and isolates high risk commits', () => {
    const plan = planBatches(
      [
        commit('000000001', 'low'),
        commit('000000002', 'low'),
        commit('539a39ae4', 'high', ['Matches risk pattern mobile-drift']),
        commit('000000004', 'medium', ['Matches risk pattern openapi-generated']),
        commit('000000005', 'medium'),
      ],
      10,
    );

    expect(plan.batches.map((batch) => batch.commits.map((item) => item.shortSha))).toEqual([
      ['000000001', '000000002'],
      ['539a39ae4'],
      ['000000004'],
      ['000000005'],
    ]);
    expect(plan.batches[1].requiredChecks).toEqual(['mobile-drift-rebase-check']);
  });

  it('renders operator commands in the batch table', () => {
    const markdown = renderBatchMarkdown(planBatches([commit('539a39ae4', 'high')], 10));

    expect(markdown).toContain('| 01 | `539a39ae4` | 1 | HIGH |');
    expect(markdown).toContain('git rebase 539a39ae4');
    expect(markdown).toContain('make mobile-drift-rebase-check');
  });
});
