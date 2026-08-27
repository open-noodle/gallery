import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Shape I from the fork's zero-conflict catalogue, in its hardest-to-see form.
//
// When the fork's rule is a DELETION — "we do not carry this upstream file" — upstream later
// re-creating or merely touching that path produces a delete/modify conflict that a replay can
// resolve toward upstream with no textual conflict left behind and no gate to notice. It happened
// this cycle: the fork deleted upstream's `packages/scripts` release-version tooling, upstream's
// Renovate bot touched its package.json, and the replay brought the file back ALONE — an orphan
// workspace member with build/check/lint/test scripts and no source, plus six phantom dependencies
// in the lockfile.
//
// The forward risk is worse than the immediate one: with the path present, the NEXT upstream batch
// that adds files under it applies cleanly instead of conflicting, silently re-adopting tooling the
// fork deliberately rejected.
//
// Detector: fork-deleted paths intersected against the working tree. Add an entry whenever the fork
// deletes an upstream path on purpose, with the commit that did it.
const FORK_DELETED_PATHS: { path: string; why: string }[] = [
  {
    path: 'packages/scripts',
    why: "upstream's release-version tooling, dropped in bc06e84a1f4; the fork releases via its own gallery-release-* workflows",
  },
];

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
