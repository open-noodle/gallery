import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Repo-invariant guard for Slice 17 (findings LOW#2 + LOW#15).
//
// CLAUDE.md's "Adding new fork migrations" section requires every NEW fork migration in
// `server/src/schema/migrations-gallery/` to use a timestamp prefix that doesn't collide
// with any other migration (fork or upstream). This guard fails the *next* rebase or
// fork-migration addition if a NEW collision is introduced (within migrations-gallery/,
// or against upstream migrations/).
//
// Existing collisions are GRANDFATHERED — they are benign and cannot be fixed safely.
// Kysely's FileMigrationProvider keys migrations by full filename and Migrator sorts those
// keys with a plain string sort, so two files sharing only a timestamp *prefix* but with
// distinct names both apply in a deterministic order — nothing is clobbered. Renaming an
// existing migration is NOT safe on this continuously-deployed fork: staging (and RC /
// personal-test clones) run the rolling branch, and Kysely hard-fails on boot when a
// migration recorded in a DB has no matching file on disk (the #ensureNoMissingMigrations
// landmine). So the three known pre-existing collisions are kept as-is and guarded:
//   - 1775100000000: AddAssetDuplicateChecksum + DropSpacePersonThumbnailPath
//   - 1777000000000: AddSpacePersonCounts + AdminScopedClassification
//       (both long-documented in docs/upstream-reports/2026-04-09-upstream-sync.md)
//   - 1778800000000: ReconcileFaceIdentityIndexOverrides + TrimSpacePersonNameIndex
//       (the LOW#2/#15 pair — benign; per the remediation decision it is kept + guarded
//        rather than renamed, because renaming risks bricking already-deployed staging/RC DBs)
// The baseline must NOT grow: no future PR may add a new collision or widen this set.
const PRE_EXISTING_TIMESTAMP_COLLISIONS = new Set([
  '1775100000000',
  '1777000000000',
  '1778800000000',
]);

const GALLERY_MIGRATIONS_DIR = path.resolve(
  process.cwd(),
  '../../server/src/schema/migrations-gallery',
);
const UPSTREAM_MIGRATIONS_DIR = path.resolve(
  process.cwd(),
  '../../server/src/schema/migrations',
);

const TIMESTAMP_PREFIX = /^(\d+)-/;

function listMigrationFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'));
}

function parseTimestamp(fileName: string): string {
  const match = TIMESTAMP_PREFIX.exec(fileName);
  if (!match) {
    throw new Error(
      `Migration file "${fileName}" has no leading numeric timestamp`,
    );
  }
  return match[1];
}

function findDuplicateTimestamps(files: string[]): [string, string[]][] {
  const byTimestamp = new Map<string, string[]>();

  for (const file of files) {
    const ts = parseTimestamp(file);
    const bucket = byTimestamp.get(ts) ?? [];
    bucket.push(file);
    byTimestamp.set(ts, bucket);
  }

  return [...byTimestamp.entries()].filter(([, names]) => names.length > 1);
}

describe('fork migration timestamps', () => {
  it('introduces no NEW timestamp collisions within migrations-gallery/ beyond the documented pre-existing baseline (LOW#2/#15)', () => {
    const files = listMigrationFiles(GALLERY_MIGRATIONS_DIR);
    const duplicates = findDuplicateTimestamps(files);

    const newDuplicates = duplicates.filter(
      ([ts]) => !PRE_EXISTING_TIMESTAMP_COLLISIONS.has(ts),
    );

    expect(
      newDuplicates,
      newDuplicates
        .map(
          ([ts, names]) => `timestamp ${ts} is shared by: ${names.join(', ')}`,
        )
        .join('\n'),
    ).toEqual([]);
  });

  it('do not collide with any upstream migrations/ timestamp', () => {
    const galleryTimestamps = new Set(
      listMigrationFiles(GALLERY_MIGRATIONS_DIR).map(parseTimestamp),
    );
    const upstreamFiles = listMigrationFiles(UPSTREAM_MIGRATIONS_DIR);

    const collisions = upstreamFiles.filter((file) =>
      galleryTimestamps.has(parseTimestamp(file)),
    );

    expect(
      collisions,
      collisions
        .map((file) => `upstream migration "${file}" shares a fork timestamp`)
        .join('\n'),
    ).toEqual([]);
  });
});
