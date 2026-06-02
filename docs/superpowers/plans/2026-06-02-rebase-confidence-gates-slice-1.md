# Rebase Confidence Gates Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the core risk-based `rebase-confidence-check` audit, CLI command, package script, and Make target.

**Architecture:** Implement a focused `tools/upstream-preflight/src/audits/rebase-confidence.ts` module that classifies touched files into confidence surfaces, verifies existing Gallery release/RC workflow invariants, and renders required local/remote operator commands for risky batches. Wire it into `tools/upstream-preflight/src/index.ts`, `tools/upstream-preflight/package.json`, and `Makefile`; later slices will implement the commands/workflows that slice 1 reports.

**Tech Stack:** TypeScript, Vitest, micromatch, YAML parser already present in `@gallery/upstream-preflight`, Make.

---

## File Structure

- Create `tools/upstream-preflight/src/audits/rebase-confidence.ts`
  - Owns confidence surface classification, required check rendering, workflow text/static assertions, and `runRebaseConfidenceAudits`.
- Create `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`
  - TDD tests for low-risk/high-risk classification, operator commands, workflow assertion positives and negatives.
- Modify `tools/upstream-preflight/src/index.ts`
  - Adds `rebase-confidence-check` command using the same batch-scope pattern as `postrebase-audit` and `mobile-drift-check`.
- Modify `tools/upstream-preflight/package.json`
  - Adds `"rebase-confidence-check": "tsx src/index.ts rebase-confidence-check"`.
- Modify `tools/upstream-preflight/src/cli-wiring.spec.ts`
  - Adds package script and Makefile target assertions.
- Modify `Makefile`
  - Adds `make rebase-confidence-check BATCH=<id>` forwarding.

## Task 1: Red Tests For Core Confidence Audit

**Files:**
- Create: `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts`
- Create after red: `tools/upstream-preflight/src/audits/rebase-confidence.ts`

- [ ] **Step 1: Write the failing tests**

Create `tools/upstream-preflight/src/audits/rebase-confidence.spec.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  classifyConfidenceSurfaces,
  renderRequiredConfidenceChecks,
  runGalleryWorkflowAssertions,
  runRebaseConfidenceAudits,
  validateGalleryWorkflowText,
} from './rebase-confidence';

const minimalWorkflow = [
  'on:',
  '  workflow_dispatch:',
  'jobs:',
  '  build:',
  '    steps:',
  '      - uses: ./.github/actions/apply-branding',
  '      - run: echo ghcr.io/open-noodle/gallery-server',
  '      - run: echo ghcr.io/open-noodle/gallery-ml',
  '      - run: echo ghcr.io/open-noodle/gallery-server:${RC_TAG}',
  '      - run: echo ghcr.io/open-noodle/gallery-ml:${RC_TAG}',
].join('\n');

describe('classifyConfidenceSurfaces', () => {
  it('treats ordinary server files as low confidence risk', () => {
    expect(classifyConfidenceSurfaces(['server/src/services/asset.service.ts'])).toEqual([]);
  });

  it('classifies mobile, ml, branding, release, docker, and ownership surfaces', () => {
    expect(
      classifyConfidenceSurfaces([
        'mobile/lib/routing/router.dart',
        'machine-learning/immich_ml/main.py',
        'branding/scripts/apply-branding.sh',
        '.github/workflows/gallery-rc-build.yml',
        'server/Dockerfile',
        'docs/fork/ownership.yml',
      ]),
    ).toEqual([
      { surface: 'branding', files: ['branding/scripts/apply-branding.sh'] },
      { surface: 'docker', files: ['server/Dockerfile'] },
      { surface: 'ml', files: ['machine-learning/immich_ml/main.py'] },
      { surface: 'mobile', files: ['mobile/lib/routing/router.dart'] },
      { surface: 'ownership', files: ['docs/fork/ownership.yml'] },
      { surface: 'release', files: ['.github/workflows/gallery-rc-build.yml'] },
    ]);
  });
});

describe('renderRequiredConfidenceChecks', () => {
  it('renders matched-file reasons and exact remote commands for risky batches', () => {
    const details = renderRequiredConfidenceChecks(
      classifyConfidenceSurfaces([
        'mobile/lib/routing/router.dart',
        'server/Dockerfile',
        'machine-learning/Dockerfile',
      ]),
      '176',
    );

    expect(details).toContain(
      'make gallery-branding-check (required by docker: server/Dockerfile, machine-learning/Dockerfile)',
    );
    expect(details).toContain(
      'make gallery-ml-smoke (required by docker: server/Dockerfile, machine-learning/Dockerfile; ml: machine-learning/Dockerfile)',
    );
    expect(details).toContain(
      'gh workflow run gallery-mobile-smoke.yml --ref rebase/upstream-batch-176 (required by mobile: mobile/lib/routing/router.dart)',
    );
    expect(details).toContain(
      'gh workflow run gallery-ml-smoke.yml --ref rebase/upstream-batch-176 (required by docker: server/Dockerfile, machine-learning/Dockerfile; ml: machine-learning/Dockerfile)',
    );
  });

  it('reports no extra confidence checks for low-risk batches', () => {
    expect(renderRequiredConfidenceChecks([], '176')).toEqual([
      'No extra risk-based confidence checks are required for this batch',
    ]);
  });
});

describe('validateGalleryWorkflowText', () => {
  it('passes for a workflow text containing dispatch, branding, Gallery images, and RC summary links', () => {
    const result = validateGalleryWorkflowText('gallery-rc-build.yml', minimalWorkflow, {
      requireDispatch: true,
      requireBranding: true,
      requireServerImage: true,
      requireMlImage: true,
      requireRcSummaryLinks: true,
    });

    expect(result.ok).toBe(true);
  });

  it('fails when workflow dispatch is missing', () => {
    const result = validateGalleryWorkflowText('gallery-rc-build.yml', 'on:\n  push:\n', {
      requireDispatch: true,
    });

    expect(result.details).toEqual([
      'gallery-rc-build.yml is missing workflow_dispatch',
    ]);
  });

  it('fails when branding is missing before a required release build', () => {
    const result = validateGalleryWorkflowText('gallery-release-server-only.yml', minimalWorkflow.replace('      - uses: ./.github/actions/apply-branding\n', ''), {
      requireBranding: true,
    });

    expect(result.details).toEqual([
      'gallery-release-server-only.yml is missing ./.github/actions/apply-branding',
    ]);
  });

  it('fails on upstream Immich image names in Gallery release workflows', () => {
    const result = validateGalleryWorkflowText('gallery-release-server-only.yml', 'ghcr.io/immich-app/immich-server\n', {
      requireServerImage: true,
    });

    expect(result.details).toEqual([
      'gallery-release-server-only.yml is missing ghcr.io/open-noodle/gallery-server',
      'gallery-release-server-only.yml contains upstream image ghcr.io/immich-app/immich-server',
    ]);
  });

  it('fails when a required release workflow is missing or renamed', () => {
    const result = runGalleryWorkflowAssertions('/tmp/gallery-missing-workflows', {
      '.github/workflows/gallery-rc-build.yml': minimalWorkflow,
      '.github/workflows/gallery-release-mobile.yml': minimalWorkflow,
      '.github/workflows/gallery-build-mobile.yml': minimalWorkflow,
    });

    expect(result.ok).toBe(false);
    expect(result.details).toContain(
      '.github/workflows/gallery-release-server-only.yml is missing workflow_dispatch',
    );
    expect(result.details).toContain(
      '.github/workflows/gallery-release-server-only.yml is missing ./.github/actions/apply-branding',
    );
  });
});

describe('runRebaseConfidenceAudits', () => {
  it('returns passing workflow assertions and low-risk requirement details', () => {
    const results = runRebaseConfidenceAudits({
      upstreamTouchedFiles: ['server/src/services/asset.service.ts'],
      batch: '176',
      workflowTexts: {
        '.github/workflows/gallery-rc-build.yml': minimalWorkflow,
        '.github/workflows/gallery-release-server-only.yml': minimalWorkflow,
        '.github/workflows/gallery-release-mobile.yml': minimalWorkflow,
        '.github/workflows/gallery-build-mobile.yml': minimalWorkflow,
      },
    });

    expect(results).toEqual([
      {
        ok: true,
        title: 'Gallery Release Workflow Static Assertions',
        details: ['All Gallery release workflow assertions passed'],
      },
      {
        ok: true,
        title: 'Risk-Based Confidence Requirements',
        details: ['No extra risk-based confidence checks are required for this batch'],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: FAIL because `./rebase-confidence` does not exist or does not export the tested functions.

- [ ] **Step 3: Implement the minimal audit module**

Create `tools/upstream-preflight/src/audits/rebase-confidence.ts` with:

```ts
import fs from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import type { AuditResult } from '../types';

export type ConfidenceSurface =
  | 'branding'
  | 'docker'
  | 'ml'
  | 'mobile'
  | 'ownership'
  | 'release';

export type ConfidenceSurfaceMatch = {
  surface: ConfidenceSurface;
  files: string[];
};

export type WorkflowAssertionOptions = {
  requireDispatch?: boolean;
  requireBranding?: boolean;
  requireServerImage?: boolean;
  requireMlImage?: boolean;
  requireRcSummaryLinks?: boolean;
};

export type RebaseConfidenceAuditInput = {
  upstreamTouchedFiles: string[];
  batch?: string;
  cwd?: string;
  workflowTexts?: Record<string, string>;
};

const surfaceGlobs: Record<ConfidenceSurface, string[]> = {
  branding: [
    'branding/**',
    'design/gallery-*',
    'web/static/gallery-*',
    '.github/actions/apply-branding/**',
    'mobile/android/**',
    'mobile/ios/**',
  ],
  docker: ['server/Dockerfile', 'web/Dockerfile', 'machine-learning/Dockerfile', 'docker/**'],
  ml: [
    'machine-learning/**',
    'server/src/dtos/model-config.dto.ts',
    'server/src/dtos/system-config.dto.ts',
    'server/src/config.ts',
  ],
  mobile: ['mobile/**'],
  ownership: ['docs/fork/ownership.yml'],
  release: [
    '.github/workflows/gallery-rc-build.yml',
    '.github/workflows/gallery-release-server-only.yml',
    '.github/workflows/gallery-release-mobile.yml',
    '.github/workflows/gallery-build-mobile.yml',
  ],
};

const workflowAssertions: Record<string, WorkflowAssertionOptions> = {
  '.github/workflows/gallery-rc-build.yml': {
    requireDispatch: true,
    requireBranding: true,
    requireServerImage: true,
    requireMlImage: true,
    requireRcSummaryLinks: true,
  },
  '.github/workflows/gallery-release-server-only.yml': {
    requireDispatch: true,
    requireBranding: true,
    requireServerImage: true,
    requireMlImage: true,
  },
  '.github/workflows/gallery-release-mobile.yml': {
    requireDispatch: true,
  },
  '.github/workflows/gallery-build-mobile.yml': {
    requireDispatch: true,
    requireBranding: true,
  },
};

export function classifyConfidenceSurfaces(
  files: string[],
): ConfidenceSurfaceMatch[] {
  return (Object.keys(surfaceGlobs) as ConfidenceSurface[])
    .map((surface) => ({
      surface,
      files: micromatch(files, surfaceGlobs[surface], { dot: true }).sort(),
    }))
    .filter((match) => match.files.length > 0)
    .sort((left, right) => left.surface.localeCompare(right.surface));
}

export function renderRequiredConfidenceChecks(
  matches: ConfidenceSurfaceMatch[],
  batch = '<id>',
): string[] {
  if (matches.length === 0) {
    return ['No extra risk-based confidence checks are required for this batch'];
  }

  const bySurface = new Map(matches.map((match) => [match.surface, match.files]));
  const details: string[] = [];
  const reasonFor = (...surfaces: ConfidenceSurface[]) =>
    surfaces
      .filter((surface) => bySurface.has(surface))
      .map((surface) => `${surface}: ${bySurface.get(surface)?.join(', ')}`)
      .join('; ');

  if (
    bySurface.has('branding') ||
    bySurface.has('release') ||
    bySurface.has('docker')
  ) {
    details.push(`make gallery-branding-check (required by ${reasonFor('branding', 'release', 'docker')})`);
  }
  if (bySurface.has('ml') || bySurface.has('docker')) {
    details.push(`make gallery-ml-smoke (required by ${reasonFor('docker', 'ml')})`);
  }
  if (bySurface.has('mobile') || bySurface.has('branding')) {
    details.push(
      `gh workflow run gallery-mobile-smoke.yml --ref rebase/upstream-batch-${batch} (required by ${reasonFor('mobile', 'branding')})`,
    );
  }
  if (bySurface.has('ml') || bySurface.has('docker')) {
    details.push(
      `gh workflow run gallery-ml-smoke.yml --ref rebase/upstream-batch-${batch} (required by ${reasonFor('docker', 'ml')})`,
    );
  }
  if (bySurface.has('ownership')) {
    details.push(`strict ownership confidence check (required by ${reasonFor('ownership')})`);
  }

  return details;
}

export function validateGalleryWorkflowText(
  workflowPath: string,
  text: string,
  options: WorkflowAssertionOptions,
): AuditResult {
  const details: string[] = [];

  if (options.requireDispatch && !text.includes('workflow_dispatch')) {
    details.push(`${workflowPath} is missing workflow_dispatch`);
  }
  if (options.requireBranding && !text.includes('./.github/actions/apply-branding')) {
    details.push(`${workflowPath} is missing ./.github/actions/apply-branding`);
  }
  if (options.requireServerImage && !text.includes('ghcr.io/open-noodle/gallery-server')) {
    details.push(`${workflowPath} is missing ghcr.io/open-noodle/gallery-server`);
  }
  if (options.requireMlImage && !text.includes('ghcr.io/open-noodle/gallery-ml')) {
    details.push(`${workflowPath} is missing ghcr.io/open-noodle/gallery-ml`);
  }
  if (options.requireRcSummaryLinks) {
    for (const image of [
      'ghcr.io/open-noodle/gallery-server:${RC_TAG}',
      'ghcr.io/open-noodle/gallery-ml:${RC_TAG}',
    ]) {
      if (!text.includes(image)) details.push(`${workflowPath} RC summary is missing ${image}`);
    }
  }
  for (const image of [
    'ghcr.io/immich-app/immich-server',
    'ghcr.io/immich-app/immich-machine-learning',
    'ghcr.io/immich-app/immich-web',
  ]) {
    if (text.includes(image)) {
      details.push(`${workflowPath} contains upstream image ${image}`);
    }
  }

  return {
    ok: details.length === 0,
    title: `${workflowPath} static assertions`,
    details: details.length === 0 ? [`${workflowPath} passed`] : details,
  };
}

export function runGalleryWorkflowAssertions(
  cwd = process.cwd(),
  workflowTexts?: Record<string, string>,
): AuditResult {
  const details = Object.entries(workflowAssertions).flatMap(([workflowPath, options]) => {
    const text = workflowTexts?.[workflowPath] ?? readWorkflowText(cwd, workflowPath);
    return validateGalleryWorkflowText(workflowPath, text, options).details.filter(
      (detail) => !detail.endsWith(' passed'),
    );
  });

  return {
    ok: details.length === 0,
    title: 'Gallery Release Workflow Static Assertions',
    details: details.length === 0 ? ['All Gallery release workflow assertions passed'] : details,
  };
}

export function runRebaseConfidenceAudits(
  input: RebaseConfidenceAuditInput,
): AuditResult[] {
  const matches = classifyConfidenceSurfaces(input.upstreamTouchedFiles);
  const requirementDetails = renderRequiredConfidenceChecks(matches, input.batch);

  return [
    runGalleryWorkflowAssertions(input.cwd, input.workflowTexts),
    {
      ok: true,
      title: 'Risk-Based Confidence Requirements',
      details: requirementDetails,
    },
  ];
}

function readWorkflowText(cwd: string, workflowPath: string): string {
  const fullPath = path.join(cwd, workflowPath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts
```

Expected: PASS for the new rebase-confidence tests.

## Task 2: Red Tests For CLI And Make Wiring

**Files:**
- Modify: `tools/upstream-preflight/src/cli-wiring.spec.ts`
- Modify after red: `tools/upstream-preflight/package.json`
- Modify after red: `Makefile`
- Modify after red: `tools/upstream-preflight/src/index.ts`

- [ ] **Step 1: Extend wiring tests first**

Patch `tools/upstream-preflight/src/cli-wiring.spec.ts`:

```ts
// In "exposes rolling commands as package scripts", add:
'rebase-confidence-check': 'tsx src/index.ts rebase-confidence-check',

// In "exposes rolling commands as Make targets", add:
expect(makefile).toContain('.PHONY: rebase-confidence-check');
expect(makefile).toContain('$(UPSTREAM_PREFLIGHT) run rebase-confidence-check');

// In "forwards rolling Make target options without an extra argument separator", add:
expect(makefile).toContain(
  '$(UPSTREAM_PREFLIGHT) run rebase-confidence-check $(if $(BATCH),--batch $(BATCH),)',
);
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/cli-wiring.spec.ts
```

Expected: FAIL because `package.json` and `Makefile` do not expose `rebase-confidence-check`.

- [ ] **Step 3: Add package script**

Patch `tools/upstream-preflight/package.json` scripts:

```json
"rebase-confidence-check": "tsx src/index.ts rebase-confidence-check"
```

- [ ] **Step 4: Add Make target**

Patch `Makefile` after `fork-patches-check`:

```make
.PHONY: rebase-confidence-check
rebase-confidence-check:
	$(UPSTREAM_PREFLIGHT) run rebase-confidence-check $(if $(BATCH),--batch $(BATCH),)
```

- [ ] **Step 5: Wire CLI command**

Patch `tools/upstream-preflight/src/index.ts`:

```ts
import { runRebaseConfidenceAudits } from './audits/rebase-confidence';
```

Add the command near the other audit commands:

```ts
program
  .command('rebase-confidence-check')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .option('--batch <id>', 'upstream batch id')
  .option('--plan-dir <path>', 'persisted batch plan directory')
  .action((options: { manifest: string; batch?: string; planDir?: string }) => {
    const batch = options.batch ?? process.env.BATCH;
    const auditInput = batch
      ? {
          auditScope: readPersistedBatchAuditScope(
            process.cwd(),
            options.planDir ? resolveCliPath(options.planDir) : undefined,
            batch,
          ),
        }
      : (() => {
          const context = buildPreflightContext(options.manifest);
          return {
            auditScope: {
              batch: undefined,
              upstreamTouchedFiles: context.upstreamRange.files,
            },
          };
        })();
    const results = runRebaseConfidenceAudits({
      upstreamTouchedFiles: auditInput.auditScope.upstreamTouchedFiles,
      batch: auditInput.auditScope.batch ?? batch,
      cwd: repoRoot(),
    });
    for (const result of results) {
      console.log(`${result.ok ? 'OK' : 'ISSUE'}: ${result.title}`);
      for (const detail of result.details) console.log(`- ${detail}`);
    }
    process.exitCode = results.every((result) => result.ok) ? 0 : 1;
  });
```

- [ ] **Step 6: Run wiring tests to verify GREEN**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/cli-wiring.spec.ts
```

Expected: PASS.

## Task 3: Full Slice Verification And Commit

**Files:**
- Verify all files changed in Tasks 1-2.

- [ ] **Step 1: Run focused upstream-preflight suite**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run test -- src/audits/rebase-confidence.spec.ts src/cli-wiring.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run upstream-preflight type check**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run check
```

Expected: PASS.

- [ ] **Step 3: Run upstream-preflight format check**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run format
```

Expected: PASS. If this fails only because files need formatting, run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --filter @gallery/upstream-preflight run format:fix
pnpm --filter @gallery/upstream-preflight run format
```

- [ ] **Step 4: Run the new command against the current batch plan if available**

Run:

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
make rebase-confidence-check BATCH=175
```

Expected: PASS with `OK: Gallery Release Workflow Static Assertions` and `OK: Risk-Based Confidence Requirements`. The requirements may list extra checks if batch 175 touched Docker/base-image surfaces.

- [ ] **Step 5: Commit slice 1**

Run:

```bash
git status --short
git add Makefile tools/upstream-preflight/package.json tools/upstream-preflight/src/index.ts tools/upstream-preflight/src/cli-wiring.spec.ts tools/upstream-preflight/src/audits/rebase-confidence.ts tools/upstream-preflight/src/audits/rebase-confidence.spec.ts docs/superpowers/plans/2026-06-02-rebase-confidence-gates-slice-1.md
git commit -m "feat(rebase): add confidence gate core"
```

Expected: commit created. Include a summary of red/green evidence in the implementer final report.
