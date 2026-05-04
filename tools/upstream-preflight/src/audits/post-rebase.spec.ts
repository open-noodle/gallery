import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BatchPlan, ClassifiedCommit, Manifest } from '../types';
import {
  auditExpectedMigrations,
  auditExtensionSymbols,
  auditForkOwnedFiles,
  auditGeneratedArtifactSignals,
  auditMigrationCount,
  auditMigrationGlobs,
  auditMigrationTimestampCollisions,
  renderPostRebaseAuditMarkdown,
  selectPostRebaseAuditScope,
  writePostRebaseAuditReport,
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

function commit(shortSha: string, files: string[]): ClassifiedCommit {
  return {
    sha: `${shortSha}000000000000000000000000000000000000000`,
    shortSha,
    subject: 'upstream commit',
    files,
    domains: [],
    overlapFiles: [],
    features: [],
    risk: 'medium',
    reasons: [],
    requiredChecks: [],
  };
}

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

describe('post-rebase audit reports', () => {
  it('renders batch-scoped audit markdown', () => {
    expect(
      renderPostRebaseAuditMarkdown({
        date: '2026-05-04',
        batch: '02',
        results: [
          {
            ok: false,
            title: 'Generated Artifact Review',
            details: ['Review regenerated artifact open-api/spec.json'],
          },
        ],
        upstreamTouchedFiles: ['open-api/spec.json'],
      }),
    ).toContain('# Upstream Post-Rebase Audit - Batch 02');
  });

  it('writes batch markdown and json reports under the output directory', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-audit-'));
    const paths = writePostRebaseAuditReport(outputDir, {
      date: '2026-05-04',
      batch: '07',
      results: [
        {
          ok: true,
          title: 'Fork-Owned File Survival',
          details: ['All literal fork-owned files are present'],
        },
      ],
      upstreamTouchedFiles: ['server/src/services/search.service.ts'],
    });

    expect(path.basename(paths.markdownPath)).toBe(
      'batch-07-postrebase-audit.md',
    );
    expect(path.basename(paths.jsonPath)).toBe(
      'batch-07-postrebase-audit.json',
    );
    expect(fs.readFileSync(paths.markdownPath, 'utf8')).toContain('Batch 07');
    expect(JSON.parse(fs.readFileSync(paths.jsonPath, 'utf8'))).toMatchObject({
      batch: '07',
      ok: true,
    });
  });
});

describe('selectPostRebaseAuditScope', () => {
  const batchPlan: BatchPlan = {
    batches: [
      {
        id: '01',
        tipSha: '111111111',
        commits: [
          commit('111111111', [
            'server/src/queries/asset.job.repository.sql',
            'web/src/routes/+page.svelte',
          ]),
        ],
        risk: 'medium',
        why: [],
        requiredChecks: [],
      },
      {
        id: '02',
        tipSha: '222222222',
        commits: [
          commit('222222222', [
            'mobile/openapi/lib/api.dart',
            'open-api/immich-openapi-specs.json',
          ]),
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

  it('selects only the requested batch files for post-rebase audit signals', () => {
    const scope = selectPostRebaseAuditScope({
      batch: '01',
      batchPlan,
      upstreamTouchedFiles: allUpstreamFiles,
    });

    expect(scope.batch).toBe('01');
    expect(scope.upstreamTouchedFiles).toEqual([
      'server/src/queries/asset.job.repository.sql',
      'web/src/routes/+page.svelte',
    ]);
    expect(auditGeneratedArtifactSignals(scope.upstreamTouchedFiles)).toEqual({
      ok: false,
      title: 'Generated Artifact Review',
      details: [
        'Review regenerated artifact server/src/queries/asset.job.repository.sql',
      ],
    });
  });

  it('uses the full upstream file list when no batch is requested', () => {
    expect(
      selectPostRebaseAuditScope({
        batchPlan,
        upstreamTouchedFiles: allUpstreamFiles,
      }).upstreamTouchedFiles,
    ).toEqual(allUpstreamFiles);
  });

  it('normalizes numeric batch ids and rejects unknown batches', () => {
    expect(
      selectPostRebaseAuditScope({
        batch: '1',
        batchPlan,
        upstreamTouchedFiles: allUpstreamFiles,
      }).batch,
    ).toBe('01');

    expect(() =>
      selectPostRebaseAuditScope({
        batch: '99',
        batchPlan,
        upstreamTouchedFiles: allUpstreamFiles,
      }),
    ).toThrow('Unknown upstream batch 99. Available batches: 01, 02');
  });
});
