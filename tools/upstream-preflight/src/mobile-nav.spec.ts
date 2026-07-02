import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Repo-invariant guard for Slice 7 (findings H2 + M4).
//
// The fork renamed the mobile navigation shell route from the upstream
// `TabShellRoute` (legacy 4-tab / rollback-only) to `GalleryTabShellRoute`
// (the fork's 3-tab bottom-nav shell). Every in-app navigation must push the
// fork route; two call-sites (Android view-intent + locked-folder resume) kept
// the bare upstream name during the rebase, dropping users onto the wrong shell.
//
// This guard fails the *next* rebase if a call-site to the bare legacy
// `TabShellRoute(...)` constructor reappears in mobile source.

const MOBILE_LIB = path.resolve(process.cwd(), '../../mobile/lib');

// Matches a bare `TabShellRoute(` constructor call, but NOT:
//   - `GalleryTabShellRoute(` (preceded by a letter → lookbehind rejects it)
//   - `TabShellRoute.page`     (followed by `.`, not `(`)
const BARE_TAB_SHELL_ROUTE = /(?<![A-Za-z])TabShellRoute\s*\(/;

function collectDartFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectDartFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.dart') &&
      !entry.name.endsWith('.gr.dart')
    ) {
      out.push(full);
    }
  }
  return out;
}

// Strip a trailing `//` line comment so prose mentions of the legacy route
// (e.g. the rollback note in router.dart, the comment in memory_bottom_info)
// do not count as call-sites. Sufficient for nav code (no `//` inside the
// relevant statements).
function stripLineComment(line: string): string {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

describe('mobile navigation shell route', () => {
  it('never pushes the bare legacy TabShellRoute — only GalleryTabShellRoute', () => {
    const offenders: string[] = [];

    for (const file of collectDartFiles(MOBILE_LIB)) {
      const rel = path.relative(path.resolve(process.cwd(), '../..'), file);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (BARE_TAB_SHELL_ROUTE.test(stripLineComment(line))) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
