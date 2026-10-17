import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadManifest } from './manifest';
import { classifyCommit, detectDomain } from './risk';
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
      upstream_extension_paths: ['server/src/services/search.service.ts'],
      required_checks: ['e2e-rebase-smoke'],
    },
  },
  checks: {
    'e2e-rebase-smoke': {
      command: 'make e2e-rebase-smoke',
      phase: 'post-batch',
      required_for_risk: ['high'],
    },
    'storage-migration-tests': {
      command: 'make test-server',
      phase: 'post-batch',
      required_for_domains: ['server'],
    },
  },
  risk_patterns: [
    {
      id: 'breaking-refactor',
      risk: 'high',
      subject_regex: 'refactor!',
      notes: 'Breaking refactor',
    },
    {
      id: 'server-schema',
      risk: 'high',
      path_globs: ['server/src/schema/migrations/**'],
      notes: 'Schema change',
    },
  ],
};

describe('detectDomain', () => {
  it.each([
    ['server/src/services/search.service.ts', 'server'],
    ['web/src/routes/+layout.svelte', 'web'],
    ['mobile/lib/main.dart', 'mobile'],
    ['.github/workflows/test.yml', 'ci'],
    ['docs/docs/install.md', 'docs'],
    ['e2e/src/spec.ts', 'e2e'],
    ['machine-learning/pyproject.toml', 'ml'],
    ['package.json', 'config'],
  ])('maps %s to %s', (file, domain) => {
    expect(detectDomain(file)).toBe(domain);
  });
});

describe('classifyCommit', () => {
  it('raises risk for feature overlap and risk patterns', () => {
    const result = classifyCommit(
      {
        sha: 'abc123',
        shortSha: 'abc123',
        subject: 'refactor!: change search service',
        files: ['server/src/services/search.service.ts'],
      },
      manifest,
      ['server/src/services/search.service.ts'],
    );

    expect(result.risk).toBe('high');
    expect(result.features).toEqual(['shared-spaces']);
    expect(result.requiredChecks).toEqual([
      'e2e-rebase-smoke',
      'storage-migration-tests',
    ]);
    expect(result.reasons).toContain(
      'Touches shared-spaces upstream extension path',
    );
    expect(result.reasons).toContain('Matches risk pattern breaking-refactor');
  });
});

describe('upstream search redesign watch (docs/fork/ownership.yml)', () => {
  const repoManifest = loadManifest(
    path.resolve(process.cwd(), '../../docs/fork/ownership.yml'),
  );
  const classify = (subject: string, files: string[]) =>
    classifyCommit(
      { sha: 'abc123', shortSha: 'abc123', subject, files },
      repoManifest,
      [],
    );

  it.each([
    ['feat(server): search facets endpoint', ['server/src/dtos/search.dto.ts']],
    [
      'fix: keep locked assets out of search',
      ['server/src/repositories/search.repository.ts'],
    ],
    [
      'feat(server): POST /search/facets',
      ['open-api/immich-openapi-specs.json'],
    ],
  ])('flags %s', (subject, files) => {
    const result = classify(subject, files);
    expect(result.risk).toBe('high');
    expect(result.reasons).toContain(
      'Matches risk pattern upstream-search-redesign',
    );
  });

  it('leaves unrelated commits alone', () => {
    expect(
      classify('fix(web): album title overflow', [
        'web/src/lib/components/album-page/album-title.svelte',
      ]).reasons,
    ).not.toContain('Matches risk pattern upstream-search-redesign');
  });
});
