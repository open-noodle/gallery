import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  findUncoveredFiles,
  manifestCoverageGlobs,
  runCoverageCli,
  validateManifestForkHead,
} from './coverage';
import type { Manifest } from './types';

const manifest: Manifest = {
  version: 1,
  metadata: {
    upstream_remote: 'upstream',
    upstream_branch: 'main',
    fork_remote: 'origin',
    fork_branch: 'main',
    last_verified_fork_head: '919deb87a6477d5058e0fa7b3960d30de577b495',
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
  last_verified_fork_head: 919deb87a6477d5058e0fa7b3960d30de577b495
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
    runCoverageCli([
      '--',
      'files.txt',
      'ownership.yml',
      '--expected-head',
      '919deb87a6477d5058e0fa7b3960d30de577b495',
    ]);

    expect(process.exitCode).toBeUndefined();
    expect(log).toHaveBeenCalledWith('Ownership manifest covers 1 fork files');

    log.mockRestore();
    process.env.INIT_CWD = previousInitCwd;
    process.exitCode = previousExitCode;
  });

  it('reports a stale manifest fork head', () => {
    expect(
      validateManifestForkHead(
        manifest,
        '0000000000000000000000000000000000000000',
      ),
    ).toEqual([
      'Ownership manifest last_verified_fork_head 919deb87a6477d5058e0fa7b3960d30de577b495 does not match 0000000000000000000000000000000000000000',
    ]);
  });

  it('fails the coverage CLI when the manifest fork head is stale', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-coverage-'));
    const fileListPath = path.join(tempDir, 'files.txt');
    const manifestPath = path.join(tempDir, 'ownership.yml');
    const previousExitCode = process.exitCode;
    const previousInitCwd = process.env.INIT_CWD;
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

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
  last_verified_fork_head: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
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
    runCoverageCli([
      '--',
      'files.txt',
      'ownership.yml',
      '--expected-head',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ]);

    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'Ownership manifest last_verified_fork_head aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa does not match bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );

    error.mockRestore();
    process.env.INIT_CWD = previousInitCwd;
    process.exitCode = previousExitCode;
  });

  it('requires a value for the expected manifest fork head', () => {
    expect(() => runCoverageCli(['files.txt', '--expected-head'])).toThrow(
      '--expected-head requires a commit SHA',
    );
  });
});
