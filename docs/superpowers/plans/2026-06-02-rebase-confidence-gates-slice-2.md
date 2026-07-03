# Rebase Confidence Gates Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict ownership freshness and broad-only coverage failures to `rebase-confidence-check`.

**Architecture:** Extend the Slice 1 `rebase-confidence` audit with an optional strict ownership input. The CLI will build the same preflight context it already uses elsewhere, validate persisted batch plans before classification, and pass manifest coverage data into `runRebaseConfidenceAudits`. The strict audit reuses existing ownership helpers from `tools/upstream-preflight/src/coverage.ts`: `findUncoveredFiles`, `validateManifestForkHead`, and `findBroadOptionalOnlyFiles`.

**Tech Stack:** TypeScript, Vitest, existing upstream-preflight coverage helpers, Make.

---

## File Structure

- Modify `tools/upstream-preflight/src/audits/rebase-confidence.ts`
  - Add `StrictOwnershipConfidenceInput`.
  - Add `runStrictOwnershipConfidenceAudit()`.
  - Include strict ownership audit results when `runRebaseConfidenceAudits()` receives ownership data.
- Modify `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`
  - Add unit tests for exact baseline pass, ancestor/narrow warning pass, broad-only failure, missing baseline failure, non-ancestor failure, and uncovered file failure.
- Modify `tools/upstream-preflight/src/index.ts`
  - Pass ownership context into `runRebaseConfidenceAudits()` for both batch and unbatched paths.
  - Keep stale persisted batch-plan validation before risk classification.
- Modify `docs/fork/ownership.yml`
  - Refresh `metadata.last_verified_fork_head` to the current `origin/main` after strict ownership behavior is implemented, so the new confidence gate starts from a reconciled manifest baseline.

## Task 1: Red Tests For Strict Ownership Audit

**Files:**

- Modify: `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`
- Modify after red: `tools/upstream-preflight/src/audits/rebase-confidence.ts`

- [ ] **Step 1: Write failing unit tests**

Patch `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`:

```ts
import type { Manifest } from '../types';
```

Add this fixture near the existing workflow fixture:

```ts
const ownershipManifest: Manifest = {
  version: 1,
  metadata: {
    upstream_remote: 'upstream',
    upstream_branch: 'main',
    fork_remote: 'origin',
    fork_branch: 'main',
    last_verified_fork_head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  features: {
    mobile: {
      title: 'Mobile',
      risk: 'high',
      domains: ['mobile'],
      owned_paths: ['mobile/lib/explicit.dart'],
      optional_paths: ['mobile/**', 'mobile/lib/narrow-*.dart'],
    },
  },
};
```

Add these tests:

```ts
describe('runStrictOwnershipConfidenceAudit', () => {
  it('passes when the manifest baseline is current and fork files are covered', () => {
    const result = runStrictOwnershipConfidenceAudit({
      manifest: ownershipManifest,
      forkFiles: ['mobile/lib/explicit.dart'],
      headValidation: {
        ok: true,
        errors: [],
        warnings: [],
        changedSinceBaseline: [],
      },
      broadOptionalOnly: [],
    });

    expect(result).toEqual({
      ok: true,
      title: 'Strict Ownership Confidence',
      details: ['Ownership manifest is current and all fork files have explicit or narrow coverage'],
    });
  });

  it('passes with baseline drift details when changed files have narrow coverage', () => {
    const result = runStrictOwnershipConfidenceAudit({
      manifest: ownershipManifest,
      forkFiles: ['mobile/lib/narrow-gallery.dart'],
      headValidation: {
        ok: true,
        errors: [],
        warnings: [
          'Ownership manifest last_verified_fork_head aaaaaaaa is behind bbbbbbbb; 1 files changed since manifest verification.',
          'Changed since manifest baseline: mobile/lib/narrow-gallery.dart',
        ],
        changedSinceBaseline: ['mobile/lib/narrow-gallery.dart'],
      },
      broadOptionalOnly: [],
    });

    expect(result.ok).toBe(true);
    expect(result.details).toContain(
      'Ownership manifest last_verified_fork_head aaaaaaaa is behind bbbbbbbb; 1 files changed since manifest verification.',
    );
    expect(result.details).toContain('Changed since manifest baseline: mobile/lib/narrow-gallery.dart');
  });

  it('fails when a post-baseline file is covered only by a broad optional glob', () => {
    const result = runStrictOwnershipConfidenceAudit({
      manifest: ownershipManifest,
      forkFiles: ['mobile/lib/broad-only.dart'],
      headValidation: {
        ok: true,
        errors: [],
        warnings: [],
        changedSinceBaseline: ['mobile/lib/broad-only.dart'],
      },
      broadOptionalOnly: [
        {
          file: 'mobile/lib/broad-only.dart',
          explicitGlobs: [],
          broadOptionalGlobs: ['mobile/**'],
          narrowOptionalGlobs: [],
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.details).toEqual(['mobile/lib/broad-only.dart is covered only by broad optional glob mobile/**']);
  });

  it('fails for uncovered fork files', () => {
    const result = runStrictOwnershipConfidenceAudit({
      manifest: ownershipManifest,
      forkFiles: ['web/src/routes/uncovered.svelte'],
      headValidation: {
        ok: true,
        errors: [],
        warnings: [],
        changedSinceBaseline: [],
      },
      broadOptionalOnly: [],
    });

    expect(result.ok).toBe(false);
    expect(result.details).toEqual(['Ownership manifest does not cover web/src/routes/uncovered.svelte']);
  });

  it('fails for missing or non-ancestor manifest baseline errors', () => {
    const result = runStrictOwnershipConfidenceAudit({
      manifest: ownershipManifest,
      forkFiles: ['mobile/lib/explicit.dart'],
      headValidation: {
        ok: false,
        errors: [
          'Ownership manifest last_verified_fork_head missing is not present in this repository; fetch fork history or reconcile docs/fork/ownership.yml.',
          'Ownership manifest last_verified_fork_head side is not an ancestor of head; reconcile docs/fork/ownership.yml before rebasing.',
        ],
        warnings: [],
        changedSinceBaseline: [],
      },
      broadOptionalOnly: [],
    });

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'Ownership manifest last_verified_fork_head missing is not present in this repository; fetch fork history or reconcile docs/fork/ownership.yml.',
      'Ownership manifest last_verified_fork_head side is not an ancestor of head; reconcile docs/fork/ownership.yml before rebasing.',
    ]);
  });
});
```

Also import the new function:

```ts
import {
  classifyConfidenceSurfaces,
  renderRequiredConfidenceChecks,
  runGalleryWorkflowAssertions,
  runRebaseConfidenceAudits,
  runStrictOwnershipConfidenceAudit,
  validateGalleryWorkflowText,
} from './rebase-confidence';
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: FAIL because `runStrictOwnershipConfidenceAudit` is not exported.

- [ ] **Step 3: Implement strict ownership audit**

Patch `tools/upstream-preflight/src/audits/rebase-confidence.ts`:

```ts
import { findBroadOptionalOnlyFiles, findUncoveredFiles } from '../coverage';
import type { AuditResult, CoverageClassification, Manifest, ManifestHeadValidation } from '../types';
```

Add:

```ts
export type StrictOwnershipConfidenceInput = {
  manifest: Manifest;
  forkFiles: string[];
  headValidation: ManifestHeadValidation;
  broadOptionalOnly: CoverageClassification[];
};
```

Extend `RebaseConfidenceAuditInput`:

```ts
ownership?: StrictOwnershipConfidenceInput;
```

Add:

```ts
export function runStrictOwnershipConfidenceAudit(input: StrictOwnershipConfidenceInput): AuditResult {
  const uncovered = findUncoveredFiles(input.forkFiles, input.manifest);
  const broadOptionalOnly = findBroadOptionalOnlyFiles(
    input.forkFiles,
    input.manifest,
    input.headValidation.changedSinceBaseline,
  );
  const details = [
    ...input.headValidation.errors,
    ...uncovered.map((file) => `Ownership manifest does not cover ${file}`),
    ...broadOptionalOnly.map(
      (classification) =>
        `${classification.file} is covered only by broad optional glob ${classification.broadOptionalGlobs.join(', ')}`,
    ),
  ];

  if (details.length > 0) {
    return {
      ok: false,
      title: 'Strict Ownership Confidence',
      details,
    };
  }

  return {
    ok: true,
    title: 'Strict Ownership Confidence',
    details:
      input.headValidation.warnings.length > 0
        ? input.headValidation.warnings
        : ['Ownership manifest is current and all fork files have explicit or narrow coverage'],
  };
}
```

Extend `runRebaseConfidenceAudits()`:

```ts
const ownershipResults = input.ownership ? [runStrictOwnershipConfidenceAudit(input.ownership)] : [];

return [
  runGalleryWorkflowAssertions(input.cwd, input.workflowTexts),
  ...ownershipResults,
  {
    ok: true,
    title: 'Risk-Based Confidence Requirements',
    details: requirementDetails,
  },
];
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: PASS.

## Task 2: CLI Ownership Context Wiring

**Files:**

- Modify: `tools/upstream-preflight/src/index.ts`
- Test: `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`

- [ ] **Step 1: Write failing integration-style unit test**

Add a test in `runRebaseConfidenceAudits` that proves strict ownership is included when ownership input is provided:

```ts
it('includes strict ownership confidence results when ownership input is provided', () => {
  const results = runRebaseConfidenceAudits({
    upstreamTouchedFiles: ['docs/fork/ownership.yml'],
    batch: '176',
    workflowTexts: {
      '.github/workflows/gallery-rc-build.yml': minimalWorkflow,
      '.github/workflows/gallery-release-server-only.yml': minimalWorkflow,
      '.github/workflows/gallery-release-mobile.yml': minimalWorkflow,
      '.github/workflows/gallery-build-mobile.yml': minimalWorkflow,
    },
    ownership: {
      manifest: ownershipManifest,
      forkFiles: ['mobile/lib/broad-only.dart'],
      headValidation: {
        ok: true,
        errors: [],
        warnings: [],
        changedSinceBaseline: ['mobile/lib/broad-only.dart'],
      },
      broadOptionalOnly: [
        {
          file: 'mobile/lib/broad-only.dart',
          explicitGlobs: [],
          broadOptionalGlobs: ['mobile/**'],
          narrowOptionalGlobs: [],
        },
      ],
    },
  });

  expect(results).toContainEqual({
    ok: false,
    title: 'Strict Ownership Confidence',
    details: ['mobile/lib/broad-only.dart is covered only by broad optional glob mobile/**'],
  });
});
```

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: FAIL until `runRebaseConfidenceAudits()` appends strict ownership results.

- [ ] **Step 2: Wire CLI to pass ownership context**

Patch `tools/upstream-preflight/src/index.ts` so both `rebase-confidence-check` paths create a preflight context and pass ownership data.

For the batch path, keep stale-plan validation first:

```ts
const batch = options.batch ?? process.env.BATCH;
const context = batch ? undefined : buildPreflightContext(options.manifest);
const auditScope = batch
  ? (() => {
      const root = repoRoot();
      const batchPlan = readPersistedBatchPlan(root, options.planDir ? resolveCliPath(options.planDir) : undefined);
      validatePersistedBatchPlan(batchPlan, root);
      const upstreamTouchedFiles = [
        ...new Set(batchPlan.batches.flatMap((planBatch) => planBatch.commits.flatMap((commit) => commit.files))),
      ].sort();
      return selectBatchAuditScope({ batch, batchPlan, upstreamTouchedFiles });
    })()
  : {
      batch: undefined,
      upstreamTouchedFiles: context.upstreamRange.files,
    };
const ownershipContext = context ?? buildPreflightContext(options.manifest);
const results = runRebaseConfidenceAudits({
  upstreamTouchedFiles: auditScope.upstreamTouchedFiles,
  batch: auditScope.batch ?? batch,
  cwd: repoRoot(),
  ownership: {
    manifest: ownershipContext.manifest,
    forkFiles: ownershipContext.forkRange.files,
    headValidation: ownershipContext.headValidation,
    broadOptionalOnly: ownershipContext.broadOptionalOnly,
  },
});
```

This intentionally performs batch-plan validation before `buildPreflightContext()` on the batch path, preserving the stale-plan edge case from Slice 1.

- [ ] **Step 3: Run focused tests**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts src/batch.spec.ts
```

Expected: PASS. `batch.spec.ts` confirms stale plans fail before confidence output.

## Task 3: Reconcile Current Ownership Baseline

**Files:**

- Modify: `docs/fork/ownership.yml`

- [ ] **Step 1: Refresh manifest baseline**

Run:

```bash
git rev-parse origin/main
```

Patch `docs/fork/ownership.yml`:

```yaml
metadata:
  last_verified_fork_head: <full git rev-parse origin/main output>
```

- [ ] **Step 2: Run strict ownership coverage command**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
make fork-ownership-coverage-check
```

Expected: PASS. The output should no longer warn that `last_verified_fork_head` is behind `origin/main`.

## Task 4: Verification And Commit

- [ ] **Step 1: Run full upstream-preflight test suite**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run check
```

Expected: PASS.

- [ ] **Step 3: Run format**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run format
```

Expected: PASS. If formatting fails only due to changed files, run `pnpm --filter @gallery/upstream-preflight run format:fix`, then re-run format.

- [ ] **Step 4: Run the command locally**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
make rebase-confidence-check BATCH=175
```

Expected: PASS with `OK: Gallery Release Workflow Static Assertions`, `OK: Strict Ownership Confidence`, and `OK: Risk-Based Confidence Requirements`.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add tools/upstream-preflight/src/audits/rebase-confidence.ts tools/upstream-preflight/src/audits/rebase-confidence.spec.ts tools/upstream-preflight/src/index.ts docs/fork/ownership.yml docs/superpowers/plans/2026-06-02-rebase-confidence-gates-slice-2.md
git commit -m "feat(rebase): add strict ownership confidence gate"
```

Expected: commit created with red/green evidence in the implementer report.
