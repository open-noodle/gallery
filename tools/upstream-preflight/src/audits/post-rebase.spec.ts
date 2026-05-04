import { describe, expect, it } from 'vitest';
import type { Manifest } from '../types';
import {
  auditExpectedMigrations,
  auditExtensionSymbols,
  auditForkOwnedFiles,
  auditGeneratedArtifactSignals,
  auditMigrationCount,
  auditMigrationGlobs,
  auditMigrationTimestampCollisions,
} from './post-rebase';

const manifest: Manifest = {
  version: 1,
  metadata: {
    upstream_remote: 'upstream',
    upstream_branch: 'main',
    fork_remote: 'origin',
    fork_branch: 'main',
    last_verified_fork_head: '0000000000000000000000000000000000000000',
  },
  features: {
    'shared-spaces': {
      title: 'Shared Spaces',
      risk: 'high',
      domains: ['server'],
      owned_paths: ['server/src/services/shared-space.service.ts'],
      expected_symbols: {
        'server/src/schema/functions.ts': ['library_user'],
      },
      database: {
        migration_globs: [
          'server/src/schema/migrations-gallery/*SharedSpace*.ts',
        ],
        expected_migrations: [
          'server/src/schema/migrations-gallery/1770000000000-SharedSpace.ts',
        ],
      },
    },
  },
};

describe('auditForkOwnedFiles', () => {
  it('fails when a literal owned file is missing', () => {
    const result = auditForkOwnedFiles(manifest, [
      'server/src/services/search.service.ts',
    ]);

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'Missing fork-owned file server/src/services/shared-space.service.ts',
    ]);
  });
});

describe('auditMigrationCount', () => {
  it('reports the gallery migration count', () => {
    const result = auditMigrationCount(
      [
        '1778400000000-AddFaceIdentities.ts',
        '1778500000000-AddSpacePersonRepresentativeFaceSource.ts',
      ],
      [
        'server/src/schema/migrations-gallery/1778400000000-AddFaceIdentities.ts',
        'server/src/schema/migrations-gallery/1778500000000-AddSpacePersonRepresentativeFaceSource.ts',
      ],
    );

    expect(result.ok).toBe(true);
    expect(result.details).toEqual(['Gallery migration count: 2 (expected 2)']);
  });

  it('fails when the count differs from manifest expectations', () => {
    const result = auditMigrationCount(
      ['1778400000000-AddFaceIdentities.ts'],
      [
        'server/src/schema/migrations-gallery/1778400000000-AddFaceIdentities.ts',
        'server/src/schema/migrations-gallery/1778500000000-AddSpacePersonRepresentativeFaceSource.ts',
      ],
    );

    expect(result.ok).toBe(false);
    expect(result.details).toEqual(['Gallery migration count: 1 (expected 2)']);
  });
});

describe('auditExpectedMigrations', () => {
  it('fails when a manifest expected migration is missing', () => {
    const result = auditExpectedMigrations(manifest, [
      'server/src/schema/migrations-gallery/1770000000000-Other.ts',
    ]);

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'Missing expected Gallery migration server/src/schema/migrations-gallery/1770000000000-SharedSpace.ts',
    ]);
  });
});

describe('auditExtensionSymbols', () => {
  it('fails when an expected symbol is missing from an extension path', () => {
    const result = auditExtensionSymbols(manifest, {
      'server/src/schema/functions.ts': 'create trigger unrelated',
    });

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'server/src/schema/functions.ts is missing expected symbol library_user',
    ]);
  });
});

describe('auditMigrationGlobs', () => {
  it('fails when a manifest migration glob has no matching file', () => {
    const result = auditMigrationGlobs(manifest, [
      'server/src/schema/migrations-gallery/1770000000000-Other.ts',
    ]);

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'No Gallery migration matches server/src/schema/migrations-gallery/*SharedSpace*.ts',
    ]);
  });
});

describe('auditMigrationTimestampCollisions', () => {
  it('fails when upstream and Gallery migrations share a timestamp', () => {
    const result = auditMigrationTimestampCollisions(
      ['server/src/schema/migrations-gallery/1770000000000-SharedSpace.ts'],
      ['server/src/schema/migrations/1770000000000-Upstream.ts'],
    );

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'Migration timestamp collision: 1770000000000',
    ]);
  });
});

describe('auditGeneratedArtifactSignals', () => {
  it('reports generated artifacts touched by upstream', () => {
    const result = auditGeneratedArtifactSignals([
      'open-api/typescript-sdk/index.ts',
    ]);

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'Review regenerated artifact open-api/typescript-sdk/index.ts',
    ]);
  });
});
