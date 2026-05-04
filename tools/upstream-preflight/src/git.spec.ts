import { describe, expect, it } from 'vitest';
import { createTempRepo } from '../test/fixtures';
import { collectGitRange, getGitPath, getMergeBase } from './git';

describe('git range collection', () => {
  it('collects commits, files, shortstat, merge base, and git metadata paths', () => {
    const repo = createTempRepo();
    repo.write('README.md', 'base');
    const base = repo.commit('base commit');
    repo.git('checkout', '-b', 'upstream');
    repo.write('server/src/services/search.service.ts', 'upstream');
    const upstreamSha = repo.commit('refactor!: upstream search service');
    repo.git('checkout', 'main');
    repo.write('server/src/services/shared-space.service.ts', 'fork');
    repo.commit('feat: fork shared spaces');

    expect(getMergeBase(repo.path, 'main', 'upstream')).toBe(base);
    expect(
      getGitPath(repo.path, 'upstream-preflight/preflight.json'),
    ).toContain('upstream-preflight/preflight.json');

    const range = collectGitRange(repo.path, `${base}..upstream`);

    expect(range.commits).toEqual([
      {
        sha: upstreamSha,
        shortSha: upstreamSha.slice(0, 9),
        subject: 'refactor!: upstream search service',
        files: ['server/src/services/search.service.ts'],
      },
    ]);
    expect(range.files).toEqual(['server/src/services/search.service.ts']);
    expect(range.shortStat).toContain('1 file changed');
  });
});
