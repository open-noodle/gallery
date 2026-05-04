import { describe, expect, it } from 'vitest';
import { collectExtensionHotspots, collectFeatureOverlaps } from './signals';
import type { ClassifiedCommit, Manifest } from './types';

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
    search: {
      title: 'Search',
      risk: 'high',
      domains: ['server'],
      owned_paths: ['server/src/services/gallery-search.service.ts'],
      upstream_extension_paths: ['server/src/services/search.service.ts'],
    },
  },
};

function commit(files: string[]): ClassifiedCommit {
  return {
    sha: 'abc123',
    shortSha: 'abc123',
    subject: 'test',
    files,
    domains: [],
    overlapFiles: [],
    features: [],
    risk: 'low',
    reasons: [],
    requiredChecks: [],
  };
}

describe('collectExtensionHotspots', () => {
  it('counts only commits whose files match an extension path', () => {
    expect(
      collectExtensionHotspots(manifest, [
        commit(['server/src/services/search.service.ts']),
        commit(['web/src/routes/+layout.svelte']),
      ]),
    ).toEqual([
      {
        path: 'server/src/services/search.service.ts',
        hits: 1,
        features: ['search'],
      },
    ]);
  });
});

describe('collectFeatureOverlaps', () => {
  it('reports only files that match the feature surface', () => {
    const classifiedCommit = commit([
      'server/src/services/search.service.ts',
      'server/src/services/unrelated.service.ts',
      'web/src/routes/+layout.svelte',
    ]);
    classifiedCommit.shortSha = 'abc123def';

    expect(collectFeatureOverlaps(manifest, [classifiedCommit])).toEqual([
      {
        feature: 'search',
        commits: ['abc123def'],
        files: ['server/src/services/search.service.ts'],
      },
    ]);
  });
});
