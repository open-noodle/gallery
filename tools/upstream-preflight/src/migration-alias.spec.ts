import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Repo-invariant guard for Slice 18 (findings LOW#16 + LOW#17).
//
// `server/bin/sync-gallery-migrations.mjs` (the npm `postbuild` hook) writes a build-time
// compatibility alias: it copies `dist/schema/migrations/1777667825574-ChangeDurationToInteger.js`
// to `dist/schema/migrations/1776735180298-ChangeDurationToInteger.js` (plus `.js.map`/`.d.ts`
// siblings) when the source file exists. This is LOAD-BEARING: the fork's
// `ChangeDurationToInteger` migration was originally authored under the upstream timestamp
// `1777667825574` and shipped in a released v5-RC; some already-deployed RC/staging DBs
// recorded it in their migration-history table under that OLD name. It was later
// re-timestamped to `1776735180298` in source. Kysely's migrator hard-fails on boot
// (`#ensureNoMissingMigrations`) if a migration name recorded in the DB has no matching file
// on disk, so both filenames must resolve to a migration module in `dist/schema/migrations/`
// for old and new DBs alike to boot cleanly. Silently dropping this alias entry would brick
// those already-deployed databases on their next server upgrade.
//
// This guard fails the *next* rebase if the `ChangeDurationToInteger` compatibility-alias
// entry disappears from `compatibilityAliases`, and fails if `CLAUDE.md` regresses to
// describing the postbuild hook as a plain, alias-free `cp`.

const SYNC_SCRIPT_PATH = path.resolve(
  process.cwd(),
  '../../server/bin/sync-gallery-migrations.mjs',
);
const CLAUDE_MD_PATH = path.resolve(process.cwd(), '../../CLAUDE.md');

const REQUIRED_ALIAS = {
  from: '1777667825574-ChangeDurationToInteger',
  to: '1776735180298-ChangeDurationToInteger',
};

function readCompatibilityAliases(
  source: string,
): Array<{ from: string; to: string }> {
  const arrayMatch = /compatibilityAliases\s*=\s*\[([\s\S]*?)\];/.exec(source);
  if (!arrayMatch) {
    return [];
  }

  const entryPattern = /from:\s*'([^']+)'\s*,\s*to:\s*'([^']+)'/g;
  const aliases: Array<{ from: string; to: string }> = [];
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = entryPattern.exec(arrayMatch[1])) !== null) {
    aliases.push({ from: match[1], to: match[2] });
  }

  return aliases;
}

describe('postbuild migration compatibility alias (sync-gallery-migrations.mjs)', () => {
  it('keeps the ChangeDurationToInteger compatibility alias so already-deployed RC DBs still boot (LOW #16)', () => {
    const source = fs.readFileSync(SYNC_SCRIPT_PATH, 'utf8');
    const aliases = readCompatibilityAliases(source);

    // Inclusion, not exact-equality: future PRs may add further alias entries alongside
    // this one without breaking the guard.
    expect(
      aliases,
      `expected compatibilityAliases in ${SYNC_SCRIPT_PATH} to include ${JSON.stringify(REQUIRED_ALIAS)}, found ${JSON.stringify(aliases)}`,
    ).toContainEqual(REQUIRED_ALIAS);
  });

  it('documents the postbuild hook as copy + stale-cleanup + compatibility alias, not a plain cp (LOW #17)', () => {
    const claudeMd = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');

    expect(
      claudeMd,
      'CLAUDE.md should reference the postbuild script by name',
    ).toContain('sync-gallery-migrations.mjs');
    expect(
      claudeMd,
      'CLAUDE.md should describe the compatibility alias behavior, not just a plain copy',
    ).toMatch(/compatibility alias/i);
    expect(
      claudeMd,
      'CLAUDE.md should name the aliased migration so the load-bearing rationale is discoverable',
    ).toContain('ChangeDurationToInteger');
  });
});
