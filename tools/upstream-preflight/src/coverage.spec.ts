import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  findUncoveredFiles,
  manifestCoverageGlobs,
  runCoverageCli,
} from './coverage';
import type { Manifest } from './types';

const manifest: Manifest = {
  version: 1,
  metadata: {
    upstream_remote: 'upstream',
    upstream_branch: 'main',
    fork_remote: 'origin',
    fork_branch: 'main',
    last_verified_fork_head: '521721c46a07bd9fec46cb9cd5f77704f41121a1',
  },
  features: {
    'shared-spaces': {
      title: 'Shared Spaces',
      risk: 'high',
      domains: ['server', 'database'],
      owned_paths: ['server/src/services/shared-space.service.ts'],
      database: {
        migration_globs: [
          'server/src/schema/migrations-gallery/*SharedSpace*.ts',
        ],
        expected_migrations: [
          'server/src/schema/migrations-gallery/1772230000000-CreateStorageMigrationLogTable.ts',
        ],
      },
    },
  },
  coverage_ignore: ['docs/superpowers/**'],
};

const dotfileManifest: Manifest = {
  ...manifest,
  features: {
    mobile: {
      title: 'Mobile',
      risk: 'high',
      domains: ['mobile'],
      optional_paths: ['mobile/**'],
    },
  },
};

describe('fork ownership coverage', () => {
  it('reports files not covered by ownership globs', () => {
    expect(
      findUncoveredFiles(
        [
          'server/src/services/shared-space.service.ts',
          'server/src/schema/migrations-gallery/1772250000000-AddShowInTimelineToSharedSpaceMember.ts',
          'docs/superpowers/plans/scratch.md',
          'web/src/routes/(user)/photos/+page.svelte',
        ],
        manifest,
      ),
    ).toEqual(['web/src/routes/(user)/photos/+page.svelte']);
  });

  it('includes explicit expected migrations in coverage globs', () => {
    expect(manifestCoverageGlobs(manifest)).toContain(
      'server/src/schema/migrations-gallery/1772230000000-CreateStorageMigrationLogTable.ts',
    );
  });

  it('matches dotfiles under owned directories', () => {
    expect(
      findUncoveredFiles(
        ['mobile/.gitignore', 'mobile/android/gallery-release/.gitignore'],
        dotfileManifest,
      ),
    ).toEqual([]);
  });

  it('accepts pnpm run argument separator before file arguments', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-coverage-'));
    const fileListPath = path.join(tempDir, 'files.txt');
    const manifestPath = path.join(tempDir, 'ownership.yml');
    const previousExitCode = process.exitCode;
    const previousInitCwd = process.env.INIT_CWD;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    fs.writeFileSync(
      fileListPath,
      'server/src/services/shared-space.service.ts\n',
    );
    fs.writeFileSync(
      manifestPath,
      `
version: 1
metadata:
  upstream_remote: upstream
  upstream_branch: main
  fork_remote: origin
  fork_branch: main
  last_verified_fork_head: 521721c46a07bd9fec46cb9cd5f77704f41121a1
features:
  shared-spaces:
    title: Shared Spaces
    risk: high
    domains: [server]
    owned_paths: [server/src/services/shared-space.service.ts]
`,
    );

    process.exitCode = undefined;
    process.env.INIT_CWD = tempDir;
    runCoverageCli(['--', 'files.txt', 'ownership.yml']);

    expect(process.exitCode).toBeUndefined();
    expect(log).toHaveBeenCalledWith('Ownership manifest covers 1 fork files');

    log.mockRestore();
    process.env.INIT_CWD = previousInitCwd;
    process.exitCode = previousExitCode;
  });
});
