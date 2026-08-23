import path from 'node:path';
import micromatch from 'micromatch';
import { describe, expect, it } from 'vitest';
import { runGit } from './git';
import { defaultManifestPath, loadManifest, parseManifest } from './manifest';

const validManifest = `
version: 1
metadata:
  upstream_remote: upstream
  upstream_branch: main
  fork_remote: origin
  fork_branch: main
  last_verified_fork_head: 919deb87a6477d5058e0fa7b3960d30de577b495
features:
  shared-spaces:
    title: Shared Spaces
    aliases: [mobile-shared-space-drift-sync]
    risk: high
    domains: [server, web, mobile, database, e2e]
    owned_paths: [server/src/services/shared-space.service.ts]
    upstream_extension_paths: [server/src/services/search.service.ts]
    database:
      migration_globs: [server/src/schema/migrations-gallery/*SharedSpace*.ts]
      expected_migrations:
        - server/src/schema/migrations-gallery/1772230000000-CreateStorageMigrationLogTable.ts
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
    cost: cheap
ci_invariants:
  - id: no-push-o-matic
    title: No PUSH_O_MATIC
    forbidden_patterns: [PUSH_O_MATIC]
    paths: [.github/workflows/**/*.yml]
patches:
  - id: immich-ui-command-patch
    package: '@immich/ui'
    version_source: pnpm-workspace.yaml
    expected_patch: patches/@immich__ui@0.79.0.patch
    required_check: mobile-drift-rebase-check
risk_patterns:
  - id: breaking-refactor
    risk: high
    subject_regex: 'refactor!'
    notes: Breaking upstream refactor
coverage_ignore:
  - specs/**
fork_surface:
  preferred_namespaces:
    server: [server/src/gallery/**]
    web: [web/src/lib/gallery/**]
    mobile: [mobile/lib/gallery/**]
    database: [server/src/schema/migrations-gallery/**]
    ci: [.github/workflows/gallery-*.yml]
`;

describe('parseManifest', () => {
  it('loads all manifest sections', () => {
    const manifest = parseManifest(validManifest);

    expect(manifest.features['shared-spaces'].aliases).toEqual([
      'mobile-shared-space-drift-sync',
    ]);
    expect(
      manifest.features['shared-spaces'].mobile?.drift_versions?.owned,
    ).toEqual([23, 24]);
    expect(
      manifest.features['shared-spaces'].database?.expected_migrations,
    ).toEqual([
      'server/src/schema/migrations-gallery/1772230000000-CreateStorageMigrationLogTable.ts',
    ]);
    expect(manifest.checks?.['mobile-drift-rebase-check'].command).toBe(
      'make mobile-drift-rebase-check',
    );
    expect(manifest.checks?.['mobile-drift-rebase-check'].cost).toBe('cheap');
    expect(manifest.ci_invariants?.[0].id).toBe('no-push-o-matic');
    expect(manifest.patches?.[0].expected_patch).toBe(
      'patches/@immich__ui@0.79.0.patch',
    );
    expect(manifest.risk_patterns?.[0].id).toBe('breaking-refactor');
    expect(manifest.coverage_ignore).toEqual(['specs/**']);
    expect(manifest.fork_surface?.preferred_namespaces?.server).toEqual([
      'server/src/gallery/**',
    ]);
  });

  it('throws a useful error for unsupported versions', () => {
    expect(() => parseManifest('version: 2')).toThrow(
      'Unsupported ownership manifest version: 2',
    );
  });

  it('rejects invalid enum values', () => {
    expect(() =>
      parseManifest(validManifest.replace('risk: high', 'risk: severe')),
    ).toThrow('Invalid risk for feature shared-spaces: severe');
    expect(() =>
      parseManifest(
        validManifest.replace(
          'domains: [server, web, mobile, database, e2e]',
          'domains: [api]',
        ),
      ),
    ).toThrow('Invalid domain for feature shared-spaces: api');
  });

  it('rejects duplicate aliases', () => {
    expect(() =>
      parseManifest(
        validManifest.replace(
          'aliases: [mobile-shared-space-drift-sync]',
          'aliases: [shared-spaces]',
        ),
      ),
    ).toThrow('Duplicate feature alias: shared-spaces');
  });

  it('supports explicit, defaulted, and missing check cost metadata', () => {
    const manifest = parseManifest(`
version: 1
metadata:
  upstream_remote: upstream
  upstream_branch: main
  fork_remote: origin
  fork_branch: main
  last_verified_fork_head: 919deb87a6477d5058e0fa7b3960d30de577b495
features:
  shared-spaces:
    title: Shared Spaces
    risk: high
    domains: [server]
    required_checks: [missing-manifest-check]
checks:
  cheap-check:
    command: make cheap-check
    phase: post-batch
    cost: cheap
  expensive-check:
    command: make expensive-check
    phase: post-batch
    cost: expensive
  default-check:
    command: make default-check
    phase: post-batch
`);

    expect(manifest.checks?.['cheap-check'].cost).toBe('cheap');
    expect(manifest.checks?.['expensive-check'].cost).toBe('expensive');
    expect(manifest.checks?.['default-check'].cost).toBe('expensive');
    expect(manifest.features['shared-spaces'].required_checks).toEqual([
      'missing-manifest-check',
    ]);
  });

  it('rejects invalid check cost metadata', () => {
    expect(() =>
      parseManifest(validManifest.replace('cost: cheap', 'cost: medium')),
    ).toThrow('Invalid cost for check mobile-drift-rebase-check: medium');
  });

  it('allows missing fork surface metadata', () => {
    const manifest = parseManifest(
      validManifest.replace(/fork_surface:\n(?:  .+\n)+/, ''),
    );

    expect(manifest.fork_surface).toBeUndefined();
  });

  it('rejects invalid fork surface namespace entries', () => {
    expect(() =>
      parseManifest(
        validManifest.replace(
          'server: [server/src/gallery/**]',
          'api: [api/**]',
        ),
      ),
    ).toThrow('Invalid fork_surface preferred namespace domain: api');
    expect(() =>
      parseManifest(
        validManifest.replace(
          'server: [server/src/gallery/**]',
          "server: ['']",
        ),
      ),
    ).toThrow('fork_surface preferred namespace server contains a blank glob');
    expect(() =>
      parseManifest(
        validManifest.replace(
          'server: [server/src/gallery/**]',
          'server: [/server/src/gallery/**]',
        ),
      ),
    ).toThrow(
      'fork_surface preferred namespace server contains an unsafe path: /server/src/gallery/**',
    );
    expect(() =>
      parseManifest(
        validManifest.replace(
          'server: [server/src/gallery/**]',
          'server: [../server/src/gallery/**]',
        ),
      ),
    ).toThrow(
      'fork_surface preferred namespace server contains an unsafe path: ../server/src/gallery/**',
    );
    expect(() =>
      parseManifest(
        validManifest.replace(
          'server: [server/src/gallery/**]',
          'server: [server/../gallery/**]',
        ),
      ),
    ).toThrow(
      'fork_surface preferred namespace server contains an unsafe path: server/../gallery/**',
    );
  });

  it('rejects invalid patch and migration entries', () => {
    expect(() =>
      parseManifest(
        validManifest.replace(
          'expected_patch: patches/@immich__ui@0.79.0.patch',
          'expected_patch: 12',
        ),
      ),
    ).toThrow('Patch immich-ui-command-patch must define expected_patch');
    expect(() =>
      parseManifest(
        validManifest.replace(
          '1772230000000-CreateStorageMigrationLogTable.ts',
          '1772230000000-CreateStorageMigrationLogTable.sql',
        ),
      ),
    ).toThrow(
      'Expected migration for feature shared-spaces must be a TypeScript file',
    );
  });
});

describe('real ownership manifest owned_paths', () => {
  // Repo-root convention shared with mobile-nav.spec.ts / cli-wiring.spec.ts:
  // vitest runs with cwd = tools/upstream-preflight.
  const repoRoot = path.resolve(process.cwd(), '../..');
  const micromatchOptions = { dot: true };

  function trackedFiles(): string[] {
    return runGit(repoRoot, ['ls-files'])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  // None of the manifest's globs use extglob syntax (no `@(`, `!(`, `+(`, `?(`,
  // `*(` group prefixes), so bare parentheses only ever occur here as literal
  // SvelteKit route-group directory names (e.g. `web/src/routes/(user)/**`).
  // Escape them so micromatch treats them as literal characters instead of an
  // (empty) capture group, which otherwise silently fails to match real files.
  function matchesAnyFile(files: string[], glob: string): boolean {
    const literalParens = glob.replaceAll(/[()]/g, String.raw`\$&`);
    return micromatch(files, literalParens, micromatchOptions).length > 0;
  }

  it('every owned_paths glob matches at least one tracked file', () => {
    const manifest = loadManifest(path.join(repoRoot, defaultManifestPath));
    const files = trackedFiles();

    const offenders: string[] = [];
    for (const [featureId, feature] of Object.entries(manifest.features)) {
      for (const glob of feature.owned_paths ?? []) {
        if (!matchesAnyFile(files, glob)) {
          offenders.push(`${featureId}: ${glob}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the user-groups owned_paths resolve to the real group-management UI', () => {
    const manifest = loadManifest(path.join(repoRoot, defaultManifestPath));
    const files = trackedFiles();

    const ownedPaths =
      manifest.features['release-ci-and-infrastructure']?.owned_paths ?? [];
    const groupSettingsMatches = ownedPaths.some((glob) =>
      micromatch(
        files,
        glob.replaceAll(/[()]/g, String.raw`\$&`),
        micromatchOptions,
      ).includes(
        'web/src/lib/components/user-settings-page/group-settings.svelte',
      ),
    );

    expect(groupSettingsMatches).toBe(true);
  });
});
