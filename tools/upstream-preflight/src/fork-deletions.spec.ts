import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORK_DELETED_PATHS } from './fork-deletions';

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
