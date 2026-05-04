# Upstream Rebase Manifest Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the repo-owned upstream preflight package and the first full fork ownership manifest.

**Architecture:** This phase adds the TypeScript workspace package, Makefile entry points, shared manifest types, YAML parser, and seeded `docs/fork/ownership.yml`. Later phases consume these contracts without changing their public shape unless tests require it.

**Tech Stack:** TypeScript, commander, yaml, micromatch, Vitest, pnpm workspace, Makefile.

---

## File Structure

- Modify: `pnpm-workspace.yaml`
  - Adds `tools/upstream-preflight` to the workspace.
- Modify: `Makefile`
  - Adds stable operator targets for the CLI.
- Create: `tools/upstream-preflight/package.json`
  - Package metadata, scripts, dependencies.
- Create: `tools/upstream-preflight/tsconfig.json`
  - Strict TypeScript config that includes source, tests, and Vitest config.
- Create: `tools/upstream-preflight/vitest.config.ts`
  - Node test environment.
- Create: `tools/upstream-preflight/src/index.ts`
  - Initial commander CLI with scaffold commands.
- Create: `tools/upstream-preflight/src/types.ts`
  - Shared manifest, git, risk, batch, and audit types.
- Create: `tools/upstream-preflight/src/manifest.ts`
  - Manifest parser and loader.
- Create: `tools/upstream-preflight/src/manifest.spec.ts`
  - Parser coverage for all top-level manifest sections.
- Create: `docs/fork/ownership.yml`
  - Versioned fork ownership source of truth.

### Task 1: Workspace Package Scaffold

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `Makefile`
- Create: `tools/upstream-preflight/package.json`
- Create: `tools/upstream-preflight/tsconfig.json`
- Create: `tools/upstream-preflight/vitest.config.ts`
- Create: `tools/upstream-preflight/src/index.ts`

- [ ] **Step 1: Add workspace package**

Add this entry to `pnpm-workspace.yaml` under `packages`:

```yaml
- tools/upstream-preflight
```

- [ ] **Step 2: Create package metadata**

Create `tools/upstream-preflight/package.json`:

```json
{
  "name": "@gallery/upstream-preflight",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "tsc --noEmit",
    "format": "prettier --cache --check .",
    "format:fix": "prettier --cache --write --list-different .",
    "test": "vitest --run --passWithNoTests",
    "test:watch": "vitest",
    "preflight": "tsx src/index.ts preflight",
    "batch-plan": "tsx src/index.ts batch-plan",
    "postrebase-audit": "tsx src/index.ts postrebase-audit",
    "mobile-drift-check": "tsx src/index.ts mobile-drift-check",
    "ci-invariants-check": "tsx src/index.ts ci-invariants-check",
    "fork-patches-check": "tsx src/index.ts fork-patches-check"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "micromatch": "^4.0.8",
    "yaml": "^2.3.1"
  },
  "devDependencies": {
    "@types/micromatch": "^4.0.9",
    "@types/node": "^24.12.2",
    "prettier": "^3.7.4",
    "tsx": "^4.20.0",
    "typescript": "^6.0.0",
    "vitest": "^4.0.0"
  }
}
```

- [ ] **Step 3: Create TypeScript config**

Create `tools/upstream-preflight/tsconfig.json`:

```json
{
  "compilerOptions": {
    "allowSyntheticDefaultImports": true,
    "declaration": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "resolveJsonModule": true,
    "rootDir": ".",
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "target": "es2023",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Create Vitest config**

Create `tools/upstream-preflight/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
```

- [ ] **Step 5: Create scaffold CLI**

Create `tools/upstream-preflight/src/index.ts`:

```ts
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command()
  .name('gallery-upstream-preflight')
  .description('Gallery upstream rebase preflight and audit tooling');

for (const command of [
  'preflight',
  'batch-plan',
  'postrebase-audit',
  'mobile-drift-check',
  'ci-invariants-check',
  'fork-patches-check',
]) {
  program.command(command).action(() => {
    console.log(`${command} scaffold`);
  });
}

program.parse(process.argv);
```

- [ ] **Step 6: Add Makefile targets**

Append this block near the existing rebase and e2e targets in `Makefile`:

```makefile
UPSTREAM_PREFLIGHT = pnpm --filter @gallery/upstream-preflight

.PHONY: upstream-preflight
upstream-preflight:
	$(UPSTREAM_PREFLIGHT) run preflight

.PHONY: upstream-batch-plan
upstream-batch-plan:
	$(UPSTREAM_PREFLIGHT) run batch-plan

.PHONY: upstream-postrebase-audit
upstream-postrebase-audit:
	$(UPSTREAM_PREFLIGHT) run postrebase-audit

.PHONY: mobile-drift-rebase-check
mobile-drift-rebase-check:
	$(UPSTREAM_PREFLIGHT) run mobile-drift-check

.PHONY: ci-invariants-check
ci-invariants-check:
	$(UPSTREAM_PREFLIGHT) run ci-invariants-check

.PHONY: fork-patches-check
fork-patches-check:
	$(UPSTREAM_PREFLIGHT) run fork-patches-check
```

- [ ] **Step 7: Install and verify scaffold**

Run:

```bash
pnpm install --no-frozen-lockfile
make upstream-preflight
make upstream-batch-plan
pnpm --filter @gallery/upstream-preflight run check
pnpm --filter @gallery/upstream-preflight run test
```

Expected: Make targets print scaffold output, TypeScript check passes, and Vitest exits 0 with no tests.

- [ ] **Step 8: Commit scaffold**

Run:

```bash
git add pnpm-workspace.yaml Makefile tools/upstream-preflight pnpm-lock.yaml
git commit -m "chore: scaffold upstream preflight tooling"
```

### Task 2: Manifest Types And Parser

**Files:**

- Create: `tools/upstream-preflight/src/types.ts`
- Create: `tools/upstream-preflight/src/manifest.ts`
- Create: `tools/upstream-preflight/src/manifest.spec.ts`

- [ ] **Step 1: Add shared types**

Create `tools/upstream-preflight/src/types.ts`:

```ts
export type RiskLevel = 'low' | 'medium' | 'high';
export type Domain = 'server' | 'web' | 'mobile' | 'database' | 'ci' | 'docs' | 'e2e' | 'ml' | 'config';

export type Manifest = {
  version: 1;
  metadata: {
    upstream_remote: string;
    upstream_branch: string;
    fork_remote: string;
    fork_branch: string;
    last_verified_fork_head: string | null;
  };
  features: Record<string, FeatureEntry>;
  checks?: Record<string, CheckEntry>;
  ci_invariants?: CiInvariant[];
  patches?: PackagePatch[];
  risk_patterns?: RiskPattern[];
};

export type FeatureEntry = {
  title: string;
  aliases?: string[];
  risk: RiskLevel;
  domains: Domain[];
  owned_paths?: string[];
  upstream_extension_paths?: string[];
  optional_paths?: string[];
  expected_symbols?: Record<string, string[]>;
  generated_artifacts?: string[];
  database?: {
    tables?: string[];
    migration_globs?: string[];
  };
  mobile?: {
    drift_versions?: {
      owned: number[];
      shipped: boolean;
      owner: 'gallery';
      expected_callbacks?: Record<number, string[]>;
    };
    paths?: string[];
  };
  required_checks?: string[];
};

export type CheckEntry = {
  command: string;
  phase: 'preflight' | 'post-batch' | 'preflight-and-post-batch' | 'final';
  required_for_risk?: RiskLevel[];
  required_for_domains?: Domain[];
};

export type CiInvariant = {
  id: string;
  title: string;
  forbidden_patterns: string[];
  paths: string[];
  exceptions?: string[];
};

export type PackagePatch = {
  id: string;
  package: string;
  version_source: string;
  expected_patch: string;
  required_check: string;
};

export type RiskPattern = {
  id: string;
  risk: RiskLevel;
  subject_regex?: string;
  path_globs?: string[];
  notes: string;
};

export type GitCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  files: string[];
};

export type ClassifiedCommit = GitCommit & {
  domains: Domain[];
  overlapFiles: string[];
  features: string[];
  risk: RiskLevel;
  reasons: string[];
  requiredChecks: string[];
};

export type BatchPlan = { batches: Batch[] };

export type Batch = {
  id: string;
  tipSha: string;
  commits: ClassifiedCommit[];
  risk: RiskLevel;
  why: string[];
  requiredChecks: string[];
};

export type AuditResult = {
  ok: boolean;
  title: string;
  details: string[];
};
```

- [ ] **Step 2: Write parser test**

Create `tools/upstream-preflight/src/manifest.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseManifest } from './manifest';

describe('parseManifest', () => {
  it('loads all manifest sections', () => {
    const manifest = parseManifest(`
version: 1
metadata:
  upstream_remote: upstream
  upstream_branch: main
  fork_remote: origin
  fork_branch: main
  last_verified_fork_head: 22ca79659
features:
  shared-spaces:
    title: Shared Spaces
    aliases: [mobile-shared-space-drift-sync]
    risk: high
    domains: [server, web, mobile, database, e2e]
    owned_paths: [server/src/services/shared-space.service.ts]
    upstream_extension_paths: [server/src/services/search.service.ts]
    mobile:
      drift_versions:
        owned: [23, 24]
        shipped: true
        owner: gallery
    required_checks: [mobile-drift-rebase-check]
checks:
  mobile-drift-rebase-check:
    command: make mobile-drift-rebase-check
    phase: preflight-and-post-batch
ci_invariants:
  - id: no-push-o-matic
    title: No PUSH_O_MATIC
    forbidden_patterns: [PUSH_O_MATIC]
    paths: [.github/workflows/**/*.yml]
patches:
  - id: immich-ui-command-patch
    package: '@immich/ui'
    version_source: pnpm-workspace.yaml
    expected_patch: patches/@immich__ui@0.76.2.patch
    required_check: fork-patches-check
risk_patterns:
  - id: breaking-refactor
    risk: high
    subject_regex: 'refactor!'
    notes: Breaking upstream refactor
`);

    expect(manifest.features['shared-spaces'].aliases).toEqual(['mobile-shared-space-drift-sync']);
    expect(manifest.features['shared-spaces'].mobile?.drift_versions?.owned).toEqual([23, 24]);
    expect(manifest.checks?.['mobile-drift-rebase-check'].command).toBe('make mobile-drift-rebase-check');
    expect(manifest.ci_invariants?.[0].id).toBe('no-push-o-matic');
    expect(manifest.patches?.[0].expected_patch).toBe('patches/@immich__ui@0.76.2.patch');
    expect(manifest.risk_patterns?.[0].id).toBe('breaking-refactor');
  });

  it('throws a useful error for unsupported versions', () => {
    expect(() => parseManifest('version: 2')).toThrow('Unsupported ownership manifest version: 2');
  });
});
```

- [ ] **Step 3: Implement parser**

Create `tools/upstream-preflight/src/manifest.ts`:

```ts
import fs from 'node:fs';
import YAML from 'yaml';
import type { Manifest } from './types';

export const defaultManifestPath = 'docs/fork/ownership.yml';

export function parseManifest(source: string): Manifest {
  const value = YAML.parse(source) as Partial<Manifest> | null;

  if (!value || value.version !== 1) {
    throw new Error(`Unsupported ownership manifest version: ${String(value?.version)}`);
  }

  if (!value.metadata) {
    throw new Error('Ownership manifest is missing metadata');
  }

  if (!value.features || Object.keys(value.features).length === 0) {
    throw new Error('Ownership manifest must define at least one feature');
  }

  return value as Manifest;
}

export function loadManifest(path = defaultManifestPath): Manifest {
  return parseManifest(fs.readFileSync(path, 'utf8'));
}
```

- [ ] **Step 4: Verify parser**

Run:

```bash
pnpm --filter @gallery/upstream-preflight run test -- manifest.spec.ts
pnpm --filter @gallery/upstream-preflight run check
```

Expected: both commands pass.

### Task 3: Seed Ownership Manifest

**Files:**

- Create: `docs/fork/ownership.yml`

- [ ] **Step 1: Create manifest seed**

Create `docs/fork/ownership.yml`:

```yaml
version: 1

metadata:
  upstream_remote: upstream
  upstream_branch: main
  fork_remote: origin
  fork_branch: main
  last_verified_fork_head: 22ca79659

features:
  shared-spaces:
    title: Shared Spaces And Space Identity
    aliases:
      - mobile-spaces
      - mobile-shared-space-drift-sync
      - space-library-linking
      - bulk-add-to-spaces
      - space-activity-logging
      - collapsible-space-hero
      - space-person-dedup
      - duplicate-space-membership-sync
      - library-user-denormalization
      - global-face-identities
      - representative-face-source
    risk: high
    domains: [server, web, mobile, database, e2e]
    owned_paths:
      - server/src/services/shared-space.service.ts
      - server/src/controllers/shared-space.controller.ts
      - server/src/repositories/shared-space.repository.ts
      - server/src/dtos/shared-space*.dto.ts
      - server/src/schema/tables/shared-space*.ts
      - server/src/schema/tables/library-user.table.ts
      - server/src/queries/shared.space.repository.sql
      - web/src/routes/(user)/spaces/**
      - web/src/lib/components/spaces/**
      - mobile/lib/pages/library/spaces/**
      - mobile/lib/infrastructure/entities/shared_space*
      - mobile/lib/infrastructure/entities/library*
    upstream_extension_paths:
      - server/src/services/search.service.ts
      - server/src/repositories/search.repository.ts
      - server/src/repositories/sync.repository.ts
      - server/src/schema/functions.ts
      - web/src/routes/(user)/photos/**
      - web/src/routes/(user)/map/**
      - mobile/lib/domain/services/sync_stream.service.dart
      - mobile/lib/infrastructure/entities/merged_asset.drift
    database:
      tables:
        [
          shared_spaces,
          shared_space_members,
          shared_space_assets,
          shared_space_persons,
          shared_space_libraries,
          library_user,
        ]
      migration_globs:
        - server/src/schema/migrations-gallery/*SharedSpace*.ts
        - server/src/schema/migrations-gallery/*Space*.ts
        - server/src/schema/migrations-gallery/*Library*.ts
    mobile:
      drift_versions:
        owned: [23, 24]
        shipped: true
        owner: gallery
        expected_callbacks:
          23: [shared_space_entity, shared_space_asset_entity]
          24: [library_entity, shared_space_library_entity]
      paths:
        - mobile/lib/infrastructure/repositories/db.repository.dart
        - mobile/drift_schemas/main/drift_schema_v23.json
        - mobile/drift_schemas/main/drift_schema_v24.json
    required_checks: [e2e-rebase-smoke, mobile-drift-rebase-check]

  storage-and-media:
    title: Storage Migration, Direct S3 Delivery, Import, And Media Edits
    aliases:
      - storage-migration
      - direct-s3-media-delivery
      - google-photos-import
      - google-takeout-zip-on-demand
      - image-editing
      - checksum-tombstone
      - switch-back-to-immich
    risk: high
    domains: [server, web, database, ci, e2e]
    owned_paths:
      - server/src/services/storage-migration.service.ts
      - server/src/controllers/storage-migration.controller.ts
      - server/src/backends/s3-storage.backend.ts
      - web/src/routes/admin/storage-migration/**
      - web/src/lib/components/import/**
      - web/src/lib/managers/import-manager.svelte.ts
      - web/src/lib/utils/google-takeout-*.ts
      - scripts/revert-to-immich.sql
      - .github/workflows/storage-migration*.yml
      - .github/workflows/gallery-revert-to-immich-validation.yml
    upstream_extension_paths:
      - server/src/services/media.service.ts
      - server/src/services/metadata.service.ts
      - server/src/services/auth.service.ts
      - server/src/services/user.service.ts
      - server/Dockerfile
      - e2e/docker-compose.yml
    database:
      tables: [storage_migration_log, asset_duplicate_checksums]
      migration_globs:
        - server/src/schema/migrations-gallery/*Storage*.ts
        - server/src/schema/migrations-gallery/*DuplicateChecksum*.ts
    required_checks: [storage-migration-tests, storage-migration-e2e]

  search-map-and-ui:
    title: Search, Filters, Maps, Command Palette, Memories, And Support UI
    aliases:
      - support-ui
      - global-search-command-palette
      - gallery-map-shared-photos
      - filter-panel
      - smart-search-main-timeline
      - space-search-sorting
      - dynamic-filter-suggestions
      - typed-search-filters
      - rule-based-memories
      - historic-memories
    risk: high
    domains: [server, web, mobile, e2e]
    owned_paths:
      - web/src/lib/components/filter-panel/**
      - web/src/lib/components/global-search/**
      - web/src/lib/managers/global-search*.ts
      - web/src/lib/managers/command*.ts
      - web/src/lib/utils/typed-search/**
      - web/src/lib/components/shared-components/side-bar/purchase-info.svelte
      - web/src/lib/components/shared-components/purchasing/purchase-content.svelte
      - server/src/controllers/gallery-map.controller.ts
      - server/src/dtos/gallery-map.dto.ts
      - mobile/lib/providers/map/map_marker.provider.dart
      - mobile/lib/services/map.service.dart
    upstream_extension_paths:
      - server/src/controllers/search.controller.ts
      - server/src/services/search.service.ts
      - server/src/repositories/search.repository.ts
      - server/src/dtos/search.dto.ts
      - server/src/queries/search.repository.sql
      - web/src/routes/(user)/photos/**
      - web/src/routes/(user)/map/**
      - web/src/routes/(user)/albums/**
      - web/src/routes/(user)/memories/**
      - patches/@immich__ui@*.patch
    required_checks: [e2e-rebase-smoke, fork-patches-check]

  ml-classification-and-observability:
    title: ML, Classification, Duplicates, Config Caching, And Metrics
    aliases:
      - pet-detection
      - auto-classification
      - video-duplicate-detection
      - clip-relevance-threshold
      - system-config-caching
      - prometheus-metrics
    risk: high
    domains: [server, ml, database]
    owned_paths:
      - machine-learning/immich_ml/models/pet_detection/**
      - server/src/services/pet-detection.service.ts
      - server/src/services/classification.service.ts
      - server/src/services/duplicate.service.ts
      - server/src/repositories/duplicate.repository.ts
    upstream_extension_paths:
      - server/src/config.ts
      - server/src/dtos/system-config.dto.ts
      - server/src/dtos/model-config.dto.ts
      - server/src/repositories/search.repository.ts
      - machine-learning/pyproject.toml
      - machine-learning/immich_ml/main.py
    database:
      tables: [person, shared_spaces, system_config, asset_duplicate_checksums]
      migration_globs:
        - server/src/schema/migrations-gallery/*Pet*.ts
        - server/src/schema/migrations-gallery/*Classification*.ts
        - server/src/schema/migrations-gallery/*Duplicate*.ts
    required_checks: [ci-invariants-check]

  mobile-app-and-branding:
    title: Mobile App, Branding, Deep Links, And Release Signing
    aliases:
      - mobile-photos-filter-sheet
      - mobile-map-markers
      - mobile-bottom-nav-design
      - mobile-deeplink-oauth-branding
      - mobile-ios-purpose-strings
      - mobile-release-signing
      - open-in-app-deeplink
      - branding
    risk: high
    domains: [mobile, web, ci, config]
    owned_paths:
      - mobile/lib/providers/photos_filter/**
      - mobile/lib/presentation/pages/photos_filter/**
      - mobile/lib/presentation/widgets/filter_sheet/**
      - mobile/lib/providers/gallery_nav/**
      - mobile/lib/presentation/widgets/gallery_nav/**
      - mobile/ios/Runner/Info.plist
      - branding/**
      - design/gallery-*
      - web/static/gallery-*
      - .github/actions/apply-branding/**
    upstream_extension_paths:
      - mobile/lib/routing/router.dart
      - mobile/lib/routing/router.gr.dart
      - mobile/lib/services/action.service.dart
      - mobile/lib/providers/websocket.provider.dart
      - web/src/routes/+layout.svelte
    required_checks: [mobile-drift-rebase-check, ci-invariants-check]

  release-ci-and-infrastructure:
    title: Release, CI, Infrastructure Detachment, Schema Functions, And Logging
    aliases:
      - user-groups
      - infrastructure-detachment
      - release-version-publishing
      - rc-build-workflow
      - split-mobile-server-release
      - environment-tagged-user-agent
      - fork-migration-compatibility
      - schema-functions
      - structured-json-logging
    risk: high
    domains: [ci, server, web, mobile, docs, config, database]
    owned_paths:
      - server/src/services/user-group.service.ts
      - server/src/controllers/user-group.controller.ts
      - server/src/schema/tables/user-group*.ts
      - web/src/lib/components/users/**
      - .github/workflows/gallery-*.yml
      - .github/workflows/storage-migration*.yml
      - .github/workflows/docs-build.yml
      - .github/workflows/docs-deploy.yml
      - server/src/schema/migrations-gallery/**
    upstream_extension_paths:
      - .github/workflows/**
      - server/Dockerfile
      - web/Dockerfile
      - machine-learning/Dockerfile
      - docker/**
      - server/src/config.ts
      - server/src/utils/fetch.ts
      - server/src/schema/functions.ts
      - server/helmet.json
      - README.md
    database:
      tables: [user_groups, user_group_members]
      migration_globs:
        - server/src/schema/migrations-gallery/*.ts
    required_checks: [ci-invariants-check, fork-patches-check]

checks:
  e2e-rebase-smoke:
    command: make e2e-rebase-smoke
    phase: post-batch
    required_for_risk: [high]
  mobile-drift-rebase-check:
    command: make mobile-drift-rebase-check
    phase: preflight-and-post-batch
    required_for_domains: [mobile, database]
  ci-invariants-check:
    command: make ci-invariants-check
    phase: preflight-and-post-batch
    required_for_domains: [ci]
  fork-patches-check:
    command: make fork-patches-check
    phase: preflight-and-post-batch
    required_for_domains: [web, ci]
  storage-migration-tests:
    command: make test-server
    phase: post-batch
    required_for_domains: [server, database]
  storage-migration-e2e:
    command: make e2e-rebase-smoke
    phase: post-batch
    required_for_domains: [e2e]

ci_invariants:
  - id: no-push-o-matic
    title: No upstream PUSH_O_MATIC token dependency
    forbidden_patterns: [PUSH_O_MATIC, create-workflow-token]
    paths: [.github/workflows/**/*.yml]
    exceptions: [.github/workflows/merge-translations.yml]
  - id: gallery-release-image-names
    title: Gallery release workflows publish Gallery images
    forbidden_patterns:
      - ghcr.io/immich-app/immich-server
      - ghcr.io/immich-app/immich-web
      - ghcr.io/immich-app/immich-machine-learning
    paths: [.github/workflows/gallery-*.yml]
    exceptions: []
  - id: gallery-docs-deploy-disabled-upstream
    title: Upstream docs deploy stays workflow_dispatch only
    forbidden_patterns: [workflow_run]
    paths: [.github/workflows/docs-deploy.yml]
    exceptions: []

patches:
  - id: immich-ui-command-patch
    package: '@immich/ui'
    version_source: pnpm-workspace.yaml
    expected_patch: patches/@immich__ui@0.76.2.patch
    required_check: fork-patches-check

risk_patterns:
  - id: breaking-refactor
    risk: high
    subject_regex: '(!:|refactor!)'
    notes: Breaking upstream refactor
  - id: mobile-drift
    risk: high
    path_globs:
      - mobile/lib/infrastructure/repositories/db.repository.dart
      - mobile/drift_schemas/main/**
    notes: Mobile Drift schema change
  - id: server-migration
    risk: high
    path_globs:
      - server/src/schema/migrations/**
      - server/src/schema/tables/**
    notes: Server schema change
  - id: openapi-generated
    risk: medium
    path_globs:
      - open-api/**
      - mobile/openapi/**
    notes: OpenAPI shape or generated client change
```

- [ ] **Step 2: Verify required fork inventory strings are covered**

Run:

```bash
for id in shared-spaces storage-migration direct-s3-media-delivery pet-detection user-groups google-photos-import google-takeout-zip-on-demand image-editing auto-classification video-duplicate-detection clip-relevance-threshold support-ui global-search-command-palette gallery-map-shared-photos filter-panel smart-search-main-timeline space-library-linking bulk-add-to-spaces space-activity-logging collapsible-space-hero space-search-sorting dynamic-filter-suggestions space-person-dedup checksum-tombstone duplicate-space-membership-sync library-user-denormalization infrastructure-detachment release-version-publishing rc-build-workflow split-mobile-server-release switch-back-to-immich open-in-app-deeplink environment-tagged-user-agent system-config-caching global-face-identities representative-face-source typed-search-filters rule-based-memories historic-memories prometheus-metrics mobile-spaces mobile-shared-space-drift-sync mobile-photos-filter-sheet mobile-map-markers mobile-bottom-nav-design mobile-deeplink-oauth-branding mobile-ios-purpose-strings mobile-release-signing branding fork-migration-compatibility schema-functions structured-json-logging; do
  rg -q "$id" docs/fork/ownership.yml || { echo "missing manifest feature or alias: $id"; exit 1; }
done
```

Expected: no output and exit 0.

- [ ] **Step 3: Compare against local skill inventory**

Run:

```bash
rg -n "Fork-Specific Features Checklist|Core Features|Secondary Features|### Mobile|### Infrastructure" /home/pierre/.codex/skills/rebase-upstream-report/SKILL.md
git log --oneline --no-merges ddc8c44cd..HEAD
```

Expected: all feature families in the old skill inventory are represented as feature IDs or aliases in `docs/fork/ownership.yml`.

- [ ] **Step 4: Verify manifest and commit**

Run:

```bash
pnpm --filter @gallery/upstream-preflight run test -- manifest.spec.ts
pnpm --filter @gallery/upstream-preflight run check
git add docs/fork/ownership.yml tools/upstream-preflight/src/types.ts tools/upstream-preflight/src/manifest.ts tools/upstream-preflight/src/manifest.spec.ts
git commit -m "feat: add fork ownership manifest"
```

Expected: tests pass, type check passes, and commit succeeds.
