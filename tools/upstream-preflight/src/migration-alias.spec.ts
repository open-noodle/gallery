import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Repo-invariant guard for the migration ledger bootstrap.
//
// `server/src/schema/gallery-migration-ledger.ts` renames rows that earlier builds recorded under a
// name that no longer has a file. The ChangeDurationToInteger entry is LOAD-BEARING: upstream
// re-timestamped that migration from `1776735180298` to `1777667825574` after Gallery databases had
// recorded the old name. Kysely hard-fails on boot (`#ensureNoMissingMigrations`) when a recorded
// name has no file, so the row must be renamed before upstream's migrator runs. Dropping the entry
// would brick those databases on their next upgrade. (The migration file keeps a fork guard that makes
// a re-run on an already-integer column a no-op, as defence in depth; it does not replace the rename.)

const LEDGER_PATH = path.resolve(
  process.cwd(),
  '../../server/src/schema/gallery-migration-ledger.ts',
);
const CLAUDE_MD_PATH = path.resolve(process.cwd(), '../../CLAUDE.md');

function readRenamedMigrations(source: string): Record<string, string | null> {
  const blockMatch = /renamedMigrations[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (!blockMatch) {
    return {};
  }

  const renames: Record<string, string | null> = {};
  for (const match of blockMatch[1].matchAll(
    /'([^']+)':\s*(?:'([^']+)'|null)/g,
  )) {
    renames[match[1]] = match[2] ?? null;
  }
  return renames;
}

describe('migration ledger bootstrap renames (gallery-migration-ledger.ts)', () => {
  it('keeps the ChangeDurationToInteger rename so databases that recorded the old name still boot', () => {
    const renames = readRenamedMigrations(fs.readFileSync(LEDGER_PATH, 'utf8'));

    expect(
      renames,
      `expected renamedMigrations in ${LEDGER_PATH} to map the pre-rename ChangeDurationToInteger name`,
    ).toMatchObject({
      '1776735180298-ChangeDurationToInteger':
        '1777667825574-ChangeDurationToInteger',
    });
  });

  it('documents the separate fork ledger and the rename in CLAUDE.md', () => {
    const claudeMd = fs.readFileSync(CLAUDE_MD_PATH, 'utf8');

    expect(claudeMd).toContain('gallery_migrations');
    expect(claudeMd).toContain('gallery-migration-ledger.ts');
    expect(claudeMd).toContain('ChangeDurationToInteger');
  });
});
