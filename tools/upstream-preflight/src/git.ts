import { execFileSync } from 'node:child_process';
import type { GitCommit } from './types';

export type GitRange = {
  commits: GitCommit[];
  files: string[];
  shortStat: string;
};

export function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function getMergeBase(cwd: string, left: string, right: string): string {
  return runGit(cwd, ['merge-base', left, right]);
}

export function getGitPath(cwd: string, relativePath: string): string {
  return runGit(cwd, ['rev-parse', '--git-path', relativePath]);
}

export function collectGitRange(cwd: string, range: string): GitRange {
  const shas = runGit(cwd, ['rev-list', '--reverse', range])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const commits = shas.map((sha) => {
    const subject = runGit(cwd, ['log', '-1', '--format=%s', sha]);
    const files = runGit(cwd, [
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-M',
      sha,
    ])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();

    return { sha, shortSha: sha.slice(0, 9), subject, files };
  });

  const files = runGit(cwd, ['diff', '--name-only', range])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();

  return {
    commits,
    files,
    shortStat: runGit(cwd, ['diff', '--shortstat', range]),
  };
}
