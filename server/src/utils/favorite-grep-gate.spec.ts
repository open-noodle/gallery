// Static regression guard (#763, slice 3 pre-drop): no code under src/ may read the legacy raw
// `asset.isFavorite` column anymore. Favorites are a per-user overlay (`asset_favorite`,
// resolved via `favoriteExistsFor` / `favoriteExistsForOwner` in favorite.ts) — this guard exists
// so a future query can't reintroduce the old ownership-masking column read (which could only
// ever be true for the asset's owner) once the column itself is dropped from the schema in a
// later task of this slice.
//
// Matching is deliberately scoped to the ways a raw SQL column reference can appear as TEXT in
// TypeScript source — always as a STRING (Kysely column selectors are plain strings; a raw
// Postgres-quoted identifier only ever shows up embedded in a string/template literal). It does
// NOT match a bare, unquoted `asset.isFavorite` (no adjacent quote/backtick at all), because that
// form is indistinguishable by text alone from ordinary JS property access on a query-result
// object. CAVEAT (slice-3 review finding): being un-matchable does NOT make such reads correct —
// `job.service.ts`'s AssetEditReadyV2/AssetUploadReadyV2 payload mappings read `asset.isFavorite`
// off `getById`/`getByIdsWithAllRelationsButStacks` results fetched WITHOUT `authUserId`, i.e.
// `selectAll('asset')`'s RAW column, which the overlay write path no longer updated — a
// staleness bug FIXED in slice 3 task 2 (owner-overlay projection in those repository methods,
// see job-favorite-payload medium spec). Separately, `person.isFavorite` (a different table) and
// a bare `isFavorite:` object key never match — the patterns all require the literal `asset.`
// prefix.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs with cwd = server/ (matches revert-to-immich.spec.ts / shared-space-album-scope
// guard style) — resolve paths from there, not __dirname / import.meta.
const SERVER_ROOT = process.cwd();
const SRC_DIR = join(SERVER_ROOT, 'src');
// Hardcoded (not __filename) — this test runs under vite-node/swc, where CJS-style file globals
// aren't guaranteed; the path is also already covered by the general `.spec.ts` exclusion below,
// so this is belt-and-suspenders self-exclusion per the brief.
const THIS_FILE = 'src/utils/favorite-grep-gate.spec.ts';

// Raw asset-column-reference forms, as they'd appear as literal source text:
//   'asset.isFavorite'   — a plain TS string, e.g. a Kysely `.select([...])` column entry
//   "asset.isFavorite"   — same, double-quoted
//   asset."isFavorite"   — a raw Postgres double-quoted identifier, embedded in a string/template
// All three require the literal `asset.` prefix and at least one adjacent quote character, so
// unquoted JS property access (`asset.isFavorite` with no quotes at all) never matches.
const RAW_COLUMN_PATTERNS = [/'asset\.isFavorite'/, /"asset\.isFavorite"/, /asset\."isFavorite"/];

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function isExcluded(relPath: string): boolean {
  if (relPath === THIS_FILE) {
    return true;
  }
  if (relPath.endsWith('.spec.ts')) {
    return true;
  }
  // Excludes both src/schema/migrations/ (upstream) and src/schema/migrations-gallery/ (fork) —
  // historical/generated migration bodies are allowed to reference the pre-drop column shape.
  if (/\/schema\/migrations[^/]*\//.test(relPath)) {
    return true;
  }
  return false;
}

// Comment-stripping is intentionally simple and line-based: drop any line whose TRIMMED form
// starts with `//` or `*` (covers `//` line comments and the body/close of `/* ... */` and JSDoc
// blocks). It doesn't handle inline trailing `//` comments or comments embedded mid-expression —
// none of the raw-column forms this guard targets are ever written that way. Keeps the original
// 1-based line number alongside each surviving line so failure output points at the real line.
function nonCommentLines(content: string): Array<{ lineNumber: number; line: string }> {
  return content
    .split('\n')
    .map((line, i) => ({ lineNumber: i + 1, line }))
    .filter(({ line }) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*');
    });
}

describe('favorite grep gate (#763)', () => {
  it('never reads the raw asset.isFavorite column outside comments', () => {
    const offenders: string[] = [];

    for (const absPath of collectTsFiles(SRC_DIR)) {
      const relPath = relative(SERVER_ROOT, absPath).split('\\').join('/');
      if (isExcluded(relPath)) {
        continue;
      }

      for (const { lineNumber, line } of nonCommentLines(readFileSync(absPath, 'utf8'))) {
        if (RAW_COLUMN_PATTERNS.some((pattern) => pattern.test(line))) {
          offenders.push(`${relPath}:${lineNumber}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
