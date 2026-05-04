import type { Batch, BatchPlan, ClassifiedCommit, RiskLevel } from './types';

const riskRank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export type BatchAuditScopeInput = {
  batch?: string;
  batchPlan: BatchPlan;
  upstreamTouchedFiles: string[];
};

export type BatchAuditScope = {
  batch?: string;
  upstreamTouchedFiles: string[];
};

function batchRisk(commits: ClassifiedCommit[]): RiskLevel {
  return commits.reduce<RiskLevel>(
    (risk, commit) =>
      riskRank[commit.risk] > riskRank[risk] ? commit.risk : risk,
    'low',
  );
}

function makeBatch(index: number, commits: ClassifiedCommit[]): Batch {
  const requiredChecks = [
    ...new Set(commits.flatMap((commit) => commit.requiredChecks)),
  ].sort();
  const why = [...new Set(commits.flatMap((commit) => commit.reasons))];
  const tip = commits.at(-1);

  if (!tip) {
    throw new Error('Cannot create an empty batch');
  }

  return {
    id: String(index).padStart(2, '0'),
    tipSha: tip.shortSha,
    commits,
    risk: batchRisk(commits),
    why,
    requiredChecks,
  };
}

function mustStartOwnBatch(commit: ClassifiedCommit): boolean {
  return (
    commit.risk === 'high' ||
    commit.features.length > 1 ||
    commit.reasons.some((reason) => reason.includes('openapi-generated'))
  );
}

export function planBatches(
  commits: ClassifiedCommit[],
  softCap = 10,
): BatchPlan {
  const batches: Batch[] = [];
  let current: ClassifiedCommit[] = [];

  const flush = () => {
    if (current.length > 0) {
      batches.push(makeBatch(batches.length + 1, current));
      current = [];
    }
  };

  for (const commit of commits) {
    if (mustStartOwnBatch(commit)) {
      flush();
      batches.push(makeBatch(batches.length + 1, [commit]));
      continue;
    }

    current.push(commit);
    if (current.length >= softCap) flush();
  }

  flush();
  return { batches };
}

export function selectBatchAuditScope(
  input: BatchAuditScopeInput,
): BatchAuditScope {
  if (!input.batch) {
    return { upstreamTouchedFiles: input.upstreamTouchedFiles };
  }

  const requestedBatch = normalizeBatchId(input.batch);
  const batch = input.batchPlan.batches.find(
    (candidate) => candidate.id === requestedBatch,
  );
  if (!batch) {
    const availableBatches = input.batchPlan.batches
      .map((candidate) => candidate.id)
      .join(', ');
    throw new Error(
      `Unknown upstream batch ${input.batch}. Available batches: ${availableBatches || 'none'}`,
    );
  }

  return {
    batch: batch.id,
    upstreamTouchedFiles: [
      ...new Set(batch.commits.flatMap((commit) => commit.files)),
    ].sort(),
  };
}

export function renderBatchMarkdown(plan: BatchPlan): string {
  const rows = plan.batches
    .map(
      (batch) =>
        `| ${batch.id} | \`${batch.tipSha}\` | ${batch.commits.length} | ${batch.risk.toUpperCase()} | ${batch.why.join('; ') || '-'} | ${batch.requiredChecks.join(', ') || '-'} |`,
    )
    .join('\n');
  const commands = plan.batches
    .map(
      (batch) => `### Batch ${batch.id}

\`\`\`bash
git rebase ${batch.tipSha}
make upstream-postrebase-audit BATCH=${batch.id}
${batch.requiredChecks
  .map((check) => renderRequiredCheckCommand(check, batch.id))
  .join('\n')}
git push origin HEAD:rebase/upstream-batch-${batch.id} --force
\`\`\``,
    )
    .join('\n\n');

  return `| Batch | Tip SHA | Commits | Risk | Why | Required Checks |
| --- | --- | ---: | --- | --- | --- |
${rows || '| - | - | 0 | LOW | No incoming upstream commits | - |'}

## Batch Commands

${commands || 'No upstream batches are required.'}
`;
}

function renderRequiredCheckCommand(check: string, batchId: string): string {
  if (check === 'mobile-drift-rebase-check') {
    return `make ${check} BATCH=${batchId}`;
  }

  return `make ${check}`;
}

function normalizeBatchId(batch: string): string {
  return /^\d+$/.test(batch) ? batch.padStart(2, '0') : batch;
}
