import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORK_DELETED_PATHS, isForkDeletedPath } from './fork-deletions';

const REPO_ROOT = path.resolve(process.cwd(), '../..');

describe('paths the fork deliberately deleted stay deleted', () => {
  for (const { path: rel, why } of FORK_DELETED_PATHS) {
    it(`${rel} is absent (${why})`, () => {
      const absolute = path.join(REPO_ROOT, rel);
      const present = fs.existsSync(absolute);
      expect(
        present
          ? `${rel} has come back — a replay resolved a delete/modify conflict toward upstream`
          : null,
      ).toBeNull();
    });
  }
});

// The list is only as good as its coverage: a deletion the list does not name is the unguarded case
// above. Diff the working tree against the upstream tag the fork sits on (branding/config.json
// upstream.version) and require every deleted path to be named, itself or by a parent directory.
// Skipped where the tag ref is absent (CI's shallow clone); create it with the fetch in AGENTS.md.
// Mid-rebase onto a newer upstream, upstream's own deletions show here until upstream.version moves.
const upstreamVersion = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'branding/config.json'), 'utf8'),
).upstream.version as string;
const upstreamTagRef = `refs/upstream/v${upstreamVersion}`;
const hasUpstreamTag =
  spawnSync('git', ['rev-parse', '--verify', '--quiet', upstreamTagRef], {
    cwd: REPO_ROOT,
  }).status === 0;

describe.skipIf(!hasUpstreamTag)(
  `every path the fork deletes against ${upstreamTagRef} is listed`,
  () => {
    it('has no unguarded deletion', () => {
      const deleted = spawnSync(
        'git',
        ['diff', '--diff-filter=D', '--name-only', upstreamTagRef, '--', '.'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      )
        .stdout.split('\n')
        .filter(Boolean);
      expect(deleted.filter((file) => !isForkDeletedPath(file))).toEqual([]);
    }, 60_000); // a whole-tree diff against the tag takes ~11 s
  },
);
