import { describe, expect, it } from 'vitest';
import {
  planBatches,
  renderBatchMarkdown,
  selectBatchAuditScope,
} from './batch';
import type { BatchPlan, ClassifiedCommit, RiskLevel } from './types';

function commit(
  shortSha: string,
  risk: RiskLevel,
  reasons: string[] = [],
  files: string[] = [],
): ClassifiedCommit {
  return {
    sha: `${shortSha}000000000000000000000000000000000000000`,
    shortSha,
    subject: `${risk} commit`,
    files,
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
        commit('000000004', 'medium', [
          'Matches risk pattern openapi-generated',
        ]),
        commit('000000005', 'medium'),
      ],
      10,
    );

    expect(
      plan.batches.map((batch) => batch.commits.map((item) => item.shortSha)),
    ).toEqual([
      ['000000001', '000000002'],
      ['539a39ae4'],
      ['000000004'],
      ['000000005'],
    ]);
    expect(plan.batches[1].requiredChecks).toEqual([
      'mobile-drift-rebase-check',
    ]);
  });

  it('renders operator commands in the batch table', () => {
    const markdown = renderBatchMarkdown(
      planBatches([commit('539a39ae4', 'high')], 10),
    );

    expect(markdown).toContain('| 01 | `539a39ae4` | 1 | HIGH |');
    expect(markdown).toContain('git rebase 539a39ae4');
    expect(markdown).toContain('make mobile-drift-rebase-check BATCH=01');
  });
});

describe('selectBatchAuditScope', () => {
  const batchPlan: BatchPlan = {
    batches: [
      {
        id: '01',
        tipSha: '111111111',
        commits: [
          commit(
            '111111111',
            'medium',
            [],
            [
              'server/src/queries/asset.job.repository.sql',
              'web/src/routes/+page.svelte',
            ],
          ),
        ],
        risk: 'medium',
        why: [],
        requiredChecks: [],
      },
      {
        id: '02',
        tipSha: '222222222',
        commits: [
          commit(
            '222222222',
            'high',
            [],
            [
              'mobile/openapi/lib/api.dart',
              'open-api/immich-openapi-specs.json',
            ],
          ),
        ],
        risk: 'high',
        why: ['Matches risk pattern openapi-generated'],
        requiredChecks: ['mobile-drift-rebase-check'],
      },
    ],
  };

  const allUpstreamFiles = batchPlan.batches.flatMap((batch) =>
    batch.commits.flatMap((item) => item.files),
  );

  it('selects only the requested batch files for audit signals', () => {
    expect(
      selectBatchAuditScope({
        batch: '01',
        batchPlan,
        upstreamTouchedFiles: allUpstreamFiles,
      }),
    ).toEqual({
      batch: '01',
      upstreamTouchedFiles: [
        'server/src/queries/asset.job.repository.sql',
        'web/src/routes/+page.svelte',
      ],
    });
  });

  it('uses the full upstream file list when no batch is requested', () => {
    expect(
      selectBatchAuditScope({
        batchPlan,
        upstreamTouchedFiles: allUpstreamFiles,
      }).upstreamTouchedFiles,
    ).toEqual(allUpstreamFiles);
  });

  it('normalizes numeric batch ids and rejects unknown batches', () => {
    expect(
      selectBatchAuditScope({
        batch: '1',
        batchPlan,
        upstreamTouchedFiles: allUpstreamFiles,
      }).batch,
    ).toBe('01');

    expect(() =>
      selectBatchAuditScope({
        batch: '99',
        batchPlan,
        upstreamTouchedFiles: allUpstreamFiles,
      }),
    ).toThrow('Unknown upstream batch 99. Available batches: 01, 02');
  });
});
