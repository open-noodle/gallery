# Upstream Rebase Audits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the post-batch and preflight audits that protect fork-owned behavior during upstream rebases.

**Architecture:** Audits are small TypeScript modules that return `AuditResult[]`. The CLI exposes each audit as an operator command and feeds their results into the preflight report.

**Tech Stack:** TypeScript, Node.js `fs/path`, micromatch, Vitest, Makefile.

---

## File Structure

- Create: `tools/upstream-preflight/src/audits/mobile-drift.ts`
  - Detects shipped Gallery mobile Drift version collisions and local schema consistency.
- Create: `tools/upstream-preflight/src/audits/mobile-drift.spec.ts`
  - Covers current v23/v24 collision behavior.
- Create: `tools/upstream-preflight/src/audits/ci-invariants.ts`
  - Checks manifest-defined forbidden workflow patterns.
- Create: `tools/upstream-preflight/src/audits/ci-invariants.spec.ts`
  - Covers exceptions and forbidden patterns.
- Create: `tools/upstream-preflight/src/audits/patches.ts`
  - Checks patched dependency metadata and patch files.
- Create: `tools/upstream-preflight/src/audits/patches.spec.ts`
  - Covers expected patch presence and missing patch failures.
- Create: `tools/upstream-preflight/src/audits/post-rebase.ts`
  - Checks fork-owned file survival and Gallery migration count.
- Create: `tools/upstream-preflight/src/audits/post-rebase.spec.ts`
  - Covers missing fork files and migration counting.
- Modify: `tools/upstream-preflight/src/index.ts`
  - Wires audit commands and includes audit signals in preflight.

### Task 1: Mobile Drift Audit

**Files:**

- Create: `tools/upstream-preflight/src/audits/mobile-drift.ts`
- Create: `tools/upstream-preflight/src/audits/mobile-drift.spec.ts`
- Modify: `tools/upstream-preflight/src/index.ts`

- [ ] **Step 1: Add mobile Drift tests**

Create `tools/upstream-preflight/src/audits/mobile-drift.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { analyzeMobileDriftFiles } from './mobile-drift';

describe('analyzeMobileDriftFiles', () => {
  it('flags shipped Gallery version collisions with incoming upstream versions', () => {
    const result = analyzeMobileDriftFiles({
      galleryOwnedVersions: [23, 24],
      galleryVersionsShipped: true,
      currentDbRepository: `
        int get schemaVersion => 24;
        from22To23: (m, v23) async {}
        from23To24: (m, v24) async {}
      `,
      currentSnapshots: ['drift_schema_v22.json', 'drift_schema_v23.json', 'drift_schema_v24.json'],
      upstreamTouchedFiles: [
        'mobile/lib/infrastructure/repositories/db.repository.dart',
        'mobile/drift_schemas/main/drift_schema_v23.json',
        'mobile/drift_schemas/main/drift_schema_v24.json',
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.details.join('\n')).toContain('Upstream touches shipped Gallery Drift version v23');
    expect(result.details.join('\n')).toContain('renumber incoming upstream migrations to v25/v26');
  });

  it('passes when shipped Gallery versions are untouched and callbacks exist', () => {
    const result = analyzeMobileDriftFiles({
      galleryOwnedVersions: [23, 24],
      galleryVersionsShipped: true,
      currentDbRepository: `
        int get schemaVersion => 24;
        from22To23: (m, v23) async {}
        from23To24: (m, v24) async {}
      `,
      currentSnapshots: ['drift_schema_v22.json', 'drift_schema_v23.json', 'drift_schema_v24.json'],
      upstreamTouchedFiles: [],
    });

    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Implement mobile Drift audit**

Create `tools/upstream-preflight/src/audits/mobile-drift.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { AuditResult, Manifest } from '../types';

export type MobileDriftInput = {
  galleryOwnedVersions: number[];
  galleryVersionsShipped: boolean;
  currentDbRepository: string;
  currentSnapshots: string[];
  upstreamTouchedFiles: string[];
};

export function analyzeMobileDriftFiles(input: MobileDriftInput): AuditResult {
  const details: string[] = [];
  const schemaVersionMatch = input.currentDbRepository.match(/schemaVersion\s*=>\s*(\d+)/);
  const schemaVersion = schemaVersionMatch ? Number(schemaVersionMatch[1]) : undefined;
  const snapshotVersions = input.currentSnapshots
    .map((file) => file.match(/drift_schema_v(\d+)\.json/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)
    .sort((left, right) => left - right);
  const highestSnapshot = snapshotVersions.at(-1);

  if (schemaVersion === undefined) details.push('Could not read mobile schemaVersion');
  if (highestSnapshot !== undefined && schemaVersion !== highestSnapshot) {
    details.push(`schemaVersion ${String(schemaVersion)} does not match highest snapshot v${highestSnapshot}`);
  }

  for (const version of input.galleryOwnedVersions) {
    const upstreamTouchesVersion = input.upstreamTouchedFiles.some((file) =>
      file.includes(`drift_schema_v${version}.json`),
    );
    if (input.galleryVersionsShipped && upstreamTouchesVersion) {
      details.push(
        `Upstream touches shipped Gallery Drift version v${version}; keep Gallery v23/v24 and renumber incoming upstream migrations to v25/v26`,
      );
    }

    const callbackName = `from${version - 1}To${version}`;
    if (!input.currentDbRepository.includes(callbackName)) {
      details.push(`Missing migration callback ${callbackName}`);
    }
  }

  return {
    ok: details.length === 0,
    title: 'Mobile Drift Migration Check',
    details:
      details.length > 0 ? details : ['Mobile Drift schemaVersion, snapshots, and Gallery callbacks are consistent'],
  };
}

export function runMobileDriftAudit(
  manifest: Manifest,
  upstreamTouchedFiles: string[],
  cwd = process.cwd(),
): AuditResult {
  const ownedVersions = Object.values(manifest.features).flatMap(
    (feature) => feature.mobile?.drift_versions?.owned ?? [],
  );
  const shipped = Object.values(manifest.features).some((feature) => feature.mobile?.drift_versions?.shipped);
  const repositoryPath = path.join(cwd, 'mobile/lib/infrastructure/repositories/db.repository.dart');
  const snapshotsPath = path.join(cwd, 'mobile/drift_schemas/main');

  return analyzeMobileDriftFiles({
    galleryOwnedVersions: [...new Set(ownedVersions)],
    galleryVersionsShipped: shipped,
    currentDbRepository: fs.existsSync(repositoryPath) ? fs.readFileSync(repositoryPath, 'utf8') : '',
    currentSnapshots: fs.existsSync(snapshotsPath) ? fs.readdirSync(snapshotsPath) : [],
    upstreamTouchedFiles,
  });
}
```

- [ ] **Step 3: Wire mobile command**

Modify `tools/upstream-preflight/src/index.ts`:

```ts
import { runMobileDriftAudit } from './audits/mobile-drift';
```

Replace the scaffold `mobile-drift-check` command with:

```ts
program
  .command('mobile-drift-check')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .action((options: { manifest: string }) => {
    const context = buildPreflightContext(options.manifest);
    const result = runMobileDriftAudit(context.manifest, context.upstreamRange.files);
    console.log(`${result.ok ? 'OK' : 'ISSUE'}: ${result.title}`);
    for (const detail of result.details) console.log(`- ${detail}`);
    process.exitCode = result.ok ? 0 : 1;
  });
```

Remove `mobile-drift-check` from the scaffold-command loop so the command is not registered twice.

- [ ] **Step 4: Verify and commit mobile audit**

Run:

```bash
pnpm --filter @gallery/upstream-preflight run test -- mobile-drift.spec.ts
pnpm --filter @gallery/upstream-preflight run check
make mobile-drift-rebase-check
git add tools/upstream-preflight/src/audits/mobile-drift.ts tools/upstream-preflight/src/audits/mobile-drift.spec.ts tools/upstream-preflight/src/index.ts
git commit -m "feat: audit mobile drift rebase collisions"
```

Expected: tests and type check pass. On the current upstream backlog, `make mobile-drift-rebase-check` exits non-zero and reports the shipped v23/v24 collision.

### Task 2: CI Invariant And Patch Audits

**Files:**

- Create: `tools/upstream-preflight/src/audits/ci-invariants.ts`
- Create: `tools/upstream-preflight/src/audits/ci-invariants.spec.ts`
- Create: `tools/upstream-preflight/src/audits/patches.ts`
- Create: `tools/upstream-preflight/src/audits/patches.spec.ts`
- Modify: `tools/upstream-preflight/src/index.ts`

- [ ] **Step 1: Add CI invariant tests**

Create `tools/upstream-preflight/src/audits/ci-invariants.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkCiInvariantText } from './ci-invariants';

describe('checkCiInvariantText', () => {
  it('flags forbidden patterns outside exceptions', () => {
    const result = checkCiInvariantText(
      {
        id: 'no-push-o-matic',
        title: 'No PUSH_O_MATIC',
        forbidden_patterns: ['PUSH_O_MATIC', 'create-workflow-token'],
        paths: ['.github/workflows/**/*.yml'],
        exceptions: ['.github/workflows/merge-translations.yml'],
      },
      [
        { path: '.github/workflows/test.yml', text: 'uses: create-workflow-token\nsecret: PUSH_O_MATIC_APP_ID' },
        { path: '.github/workflows/merge-translations.yml', text: 'PUSH_O_MATIC_APP_ID' },
      ],
    );

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      '.github/workflows/test.yml contains forbidden pattern PUSH_O_MATIC',
      '.github/workflows/test.yml contains forbidden pattern create-workflow-token',
    ]);
  });
});
```

- [ ] **Step 2: Implement CI invariant audit**

Create `tools/upstream-preflight/src/audits/ci-invariants.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import type { AuditResult, CiInvariant, Manifest } from '../types';

export type TextFile = { path: string; text: string };

export function checkCiInvariantText(invariant: CiInvariant, files: TextFile[]): AuditResult {
  const details: string[] = [];
  const matchedFiles = files.filter((file) => micromatch.isMatch(file.path, invariant.paths));
  const exceptionSet = new Set(invariant.exceptions ?? []);

  for (const file of matchedFiles) {
    if (exceptionSet.has(file.path)) continue;
    for (const pattern of invariant.forbidden_patterns) {
      if (file.text.includes(pattern)) {
        details.push(`${file.path} contains forbidden pattern ${pattern}`);
      }
    }
  }

  return {
    ok: details.length === 0,
    title: invariant.title,
    details: details.length > 0 ? details : [`${invariant.id} passed`],
  };
}

export function runCiInvariantAudits(manifest: Manifest, cwd = process.cwd()): AuditResult[] {
  const workflowRoot = path.join(cwd, '.github/workflows');
  const files = fs.existsSync(workflowRoot)
    ? fs
        .readdirSync(workflowRoot)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .map((file) => ({
          path: `.github/workflows/${file}`,
          text: fs.readFileSync(path.join(workflowRoot, file), 'utf8'),
        }))
    : [];

  return (manifest.ci_invariants ?? []).map((invariant) => checkCiInvariantText(invariant, files));
}
```

- [ ] **Step 3: Add patch audit tests**

Create `tools/upstream-preflight/src/audits/patches.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkPackagePatchText } from './patches';

const patch = {
  id: 'immich-ui-command-patch',
  package: '@immich/ui',
  version_source: 'pnpm-workspace.yaml',
  expected_patch: 'patches/@immich__ui@0.76.2.patch',
  required_check: 'fork-patches-check',
};

describe('checkPackagePatchText', () => {
  it('passes when pnpm-workspace points at the expected patch', () => {
    const result = checkPackagePatchText(
      patch,
      "patchedDependencies:\n  '@immich/ui@0.76.2': patches/@immich__ui@0.76.2.patch\n",
      ['patches/@immich__ui@0.76.2.patch'],
    );

    expect(result.ok).toBe(true);
  });

  it('fails when the expected patch file is missing', () => {
    const result = checkPackagePatchText(
      patch,
      "patchedDependencies:\n  '@immich/ui@0.76.2': patches/@immich__ui@0.76.2.patch\n",
      [],
    );

    expect(result.ok).toBe(false);
    expect(result.details).toEqual(['Missing patch file patches/@immich__ui@0.76.2.patch']);
  });
});
```

- [ ] **Step 4: Implement patch audit**

Create `tools/upstream-preflight/src/audits/patches.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { AuditResult, Manifest, PackagePatch } from '../types';

export function checkPackagePatchText(
  patch: PackagePatch,
  workspaceText: string,
  existingPatchFiles: string[],
): AuditResult {
  const details: string[] = [];

  if (!workspaceText.includes(patch.expected_patch)) {
    details.push(`pnpm-workspace.yaml does not reference ${patch.expected_patch}`);
  }

  if (!existingPatchFiles.includes(patch.expected_patch)) {
    details.push(`Missing patch file ${patch.expected_patch}`);
  }

  return {
    ok: details.length === 0,
    title: `Patch check: ${patch.package}`,
    details: details.length > 0 ? details : [`${patch.package} patch metadata is consistent`],
  };
}

export function runPatchAudits(manifest: Manifest, cwd = process.cwd()): AuditResult[] {
  const workspacePath = path.join(cwd, 'pnpm-workspace.yaml');
  const workspaceText = fs.existsSync(workspacePath) ? fs.readFileSync(workspacePath, 'utf8') : '';
  const patchRoot = path.join(cwd, 'patches');
  const patchFiles = fs.existsSync(patchRoot) ? fs.readdirSync(patchRoot).map((file) => `patches/${file}`) : [];

  return (manifest.patches ?? []).map((patch) => checkPackagePatchText(patch, workspaceText, patchFiles));
}
```

- [ ] **Step 5: Wire CI and patch commands**

Modify `tools/upstream-preflight/src/index.ts`:

```ts
import { runCiInvariantAudits } from './audits/ci-invariants';
import { runPatchAudits } from './audits/patches';
```

Add these commands:

```ts
program
  .command('ci-invariants-check')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .action((options: { manifest: string }) => {
    const results = runCiInvariantAudits(loadManifest(options.manifest));
    for (const result of results) {
      console.log(`${result.ok ? 'OK' : 'ISSUE'}: ${result.title}`);
      for (const detail of result.details) console.log(`- ${detail}`);
    }
    process.exitCode = results.every((result) => result.ok) ? 0 : 1;
  });

program
  .command('fork-patches-check')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .action((options: { manifest: string }) => {
    const results = runPatchAudits(loadManifest(options.manifest));
    for (const result of results) {
      console.log(`${result.ok ? 'OK' : 'ISSUE'}: ${result.title}`);
      for (const detail of result.details) console.log(`- ${detail}`);
    }
    process.exitCode = results.every((result) => result.ok) ? 0 : 1;
  });
```

Remove these two command names from the scaffold-command loop so they are not registered twice.

- [ ] **Step 6: Verify and commit CI and patch audits**

Run:

```bash
pnpm --filter @gallery/upstream-preflight run test -- ci-invariants.spec.ts patches.spec.ts
pnpm --filter @gallery/upstream-preflight run check
make ci-invariants-check
make fork-patches-check
git add tools/upstream-preflight/src/audits/ci-invariants.ts tools/upstream-preflight/src/audits/ci-invariants.spec.ts tools/upstream-preflight/src/audits/patches.ts tools/upstream-preflight/src/audits/patches.spec.ts tools/upstream-preflight/src/index.ts
git commit -m "feat: audit rebase ci invariants and patches"
```

Expected: tests and type check pass. `make fork-patches-check` passes. If `make ci-invariants-check` exits non-zero, the output names the exact workflow and forbidden string that must be fixed or excepted in the manifest.

### Task 3: Post-Rebase Audit

**Files:**

- Create: `tools/upstream-preflight/src/audits/post-rebase.ts`
- Create: `tools/upstream-preflight/src/audits/post-rebase.spec.ts`
- Modify: `tools/upstream-preflight/src/index.ts`

- [ ] **Step 1: Add post-rebase tests**

Create `tools/upstream-preflight/src/audits/post-rebase.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { auditForkOwnedFiles, auditMigrationCount } from './post-rebase';
import type { Manifest } from '../types';

const manifest: Manifest = {
  version: 1,
  metadata: {
    upstream_remote: 'upstream',
    upstream_branch: 'main',
    fork_remote: 'origin',
    fork_branch: 'main',
    last_verified_fork_head: null,
  },
  features: {
    'shared-spaces': {
      title: 'Shared Spaces',
      risk: 'high',
      domains: ['server'],
      owned_paths: ['server/src/services/shared-space.service.ts'],
    },
  },
};

describe('auditForkOwnedFiles', () => {
  it('fails when a literal owned file is missing', () => {
    const result = auditForkOwnedFiles(manifest, ['server/src/services/search.service.ts']);

    expect(result.ok).toBe(false);
    expect(result.details).toEqual(['Missing fork-owned file server/src/services/shared-space.service.ts']);
  });
});

describe('auditMigrationCount', () => {
  it('reports the gallery migration count', () => {
    const result = auditMigrationCount([
      '1778400000000-AddFaceIdentities.ts',
      '1778500000000-AddSpacePersonRepresentativeFaceSource.ts',
    ]);

    expect(result.ok).toBe(true);
    expect(result.details).toEqual(['Gallery migration count: 2']);
  });
});
```

- [ ] **Step 2: Implement post-rebase audit**

Create `tools/upstream-preflight/src/audits/post-rebase.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import micromatch from 'micromatch';
import type { AuditResult, Manifest } from '../types';

export function auditForkOwnedFiles(manifest: Manifest, currentFiles: string[]): AuditResult {
  const missing: string[] = [];

  for (const feature of Object.values(manifest.features)) {
    for (const file of feature.owned_paths ?? []) {
      if (file.includes('*')) continue;
      if (!currentFiles.includes(file)) {
        missing.push(`Missing fork-owned file ${file}`);
      }
    }
  }

  return {
    ok: missing.length === 0,
    title: 'Fork-Owned File Survival',
    details: missing.length > 0 ? missing : ['All literal fork-owned files are present'],
  };
}

export function auditMigrationCount(migrations: string[]): AuditResult {
  return {
    ok: true,
    title: 'Gallery Migration Count',
    details: [`Gallery migration count: ${migrations.length}`],
  };
}

export function runPostRebaseAudits(manifest: Manifest, cwd = process.cwd()): AuditResult[] {
  const currentFiles = listFiles(cwd);
  const migrationRoot = path.join(cwd, 'server/src/schema/migrations-gallery');
  const migrations = fs.existsSync(migrationRoot)
    ? fs.readdirSync(migrationRoot).filter((file) => file.endsWith('.ts'))
    : [];

  return [auditForkOwnedFiles(manifest, currentFiles), auditMigrationCount(migrations)];
}

function listFiles(cwd: string): string[] {
  const files: string[] = [];
  const ignored = new Set(['.git', 'node_modules', '.svelte-kit', 'dist', 'build']);
  const ignoredGlobs = ['.claude/**', '.worktrees/**', 'docker/library/**'];

  const walk = (directory: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(cwd, fullPath).replaceAll(path.sep, '/');
      if (micromatch.isMatch(relativePath, ignoredGlobs)) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        files.push(relativePath);
      }
    }
  };

  walk(cwd);
  return files;
}
```

- [ ] **Step 3: Wire post-rebase command**

Modify `tools/upstream-preflight/src/index.ts`:

```ts
import { runPostRebaseAudits } from './audits/post-rebase';
```

Add this command:

```ts
program
  .command('postrebase-audit')
  .option('--manifest <path>', 'ownership manifest path', defaultManifestPath)
  .action((options: { manifest: string }) => {
    const results = runPostRebaseAudits(loadManifest(options.manifest));
    for (const result of results) {
      console.log(`${result.ok ? 'OK' : 'ISSUE'}: ${result.title}`);
      for (const detail of result.details) console.log(`- ${detail}`);
    }
    process.exitCode = results.every((result) => result.ok) ? 0 : 1;
  });
```

Remove `postrebase-audit` from the scaffold-command loop.

- [ ] **Step 4: Verify and commit post-rebase audit**

Run:

```bash
pnpm --filter @gallery/upstream-preflight run test -- post-rebase.spec.ts
pnpm --filter @gallery/upstream-preflight run check
make upstream-postrebase-audit
git add tools/upstream-preflight/src/audits/post-rebase.ts tools/upstream-preflight/src/audits/post-rebase.spec.ts tools/upstream-preflight/src/index.ts
git commit -m "feat: audit fork survival after upstream rebase"
```

Expected: tests and type check pass. The real audit prints fork-owned file survival and Gallery migration count.

### Task 4: Include Audits In Preflight

**Files:**

- Modify: `tools/upstream-preflight/src/index.ts`
- Modify: `tools/upstream-preflight/src/report.spec.ts`

- [ ] **Step 1: Expand report test**

Modify `tools/upstream-preflight/src/report.spec.ts` so the existing render test passes this audit result:

```ts
auditResults: [
  {
    ok: false,
    title: 'Mobile Drift Migration Check',
    details: ['Upstream touches shipped Gallery Drift version v23'],
  },
],
```

Add this assertion:

```ts
expect(markdown).toContain('Mobile Drift Migration Check');
```

- [ ] **Step 2: Feed audit signals into preflight**

In the `preflight` action inside `tools/upstream-preflight/src/index.ts`, replace `auditResults: []` with:

```ts
auditResults: [
  runMobileDriftAudit(context.manifest, context.upstreamRange.files),
  ...runCiInvariantAudits(context.manifest),
  ...runPatchAudits(context.manifest),
],
```

- [ ] **Step 3: Verify and commit integrated audits**

Run:

```bash
pnpm --filter @gallery/upstream-preflight run test
pnpm --filter @gallery/upstream-preflight run check
make upstream-preflight
git add tools/upstream-preflight/src/index.ts tools/upstream-preflight/src/report.spec.ts
git commit -m "feat: include audits in upstream preflight"
```

Expected: tests and type check pass. `make upstream-preflight` prints audit signals, high-risk commits, batch plan, and fork surface reduction signals.
