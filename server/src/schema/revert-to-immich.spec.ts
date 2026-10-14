import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Note: co-located under src/schema/ (not server/test/) so it runs under the server:unit vitest
// config, which only globs `src/**/*.spec.ts` — mirrors sync-gallery-migrations.spec.ts.
// vitest runs with cwd = server/, so resolve paths from there (avoids __dirname / import.meta).
const serverRoot = process.cwd();
const sqlPath = join(serverRoot, '..', 'scripts', 'revert-to-immich.sql');
const migrationsGalleryDir = join(serverRoot, 'src', 'schema', 'migrations-gallery');

const sql = readFileSync(sqlPath, 'utf8');

// Only real migrations (excludes co-located specs like migration-override-parity.spec.ts).
const migrationFiles = readdirSync(migrationsGalleryDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
const migrationNames = migrationFiles.map((f) => f.replace(/\.ts$/, ''));

// Derive the expected fork-table set from what migrations-gallery actually CREATEs — the
// real source of truth — rather than from revert-to-immich.sql's own DROP statements. The
// old approach derived the expected set FROM the DROP lines
// (`[...sql.matchAll(/DROP TABLE IF EXISTS "([^"]+)" CASCADE/g)]`), so a fork table added
// without a matching DROP line silently shrank the expected set instead of failing the test.
const createdTables = new Set<string>();
for (const file of migrationFiles) {
  const content = readFileSync(join(migrationsGalleryDir, file), 'utf8');
  for (const m of content.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? "?([a-z_]+)"?/g)) {
    createdTables.add(m[1]);
  }
  for (const m of content.matchAll(/\.createTable\('([a-z_]+)'\)/g)) {
    createdTables.add(m[1]);
  }
}

// Columns and indexes the fork's up() migrations add to UPSTREAM tables (any table migrations-gallery
// did not create). down() bodies are skipped: they restore upstream schema, e.g. asset."isFavorite".
const upBody = (content: string) => {
  const start = content.indexOf('function up(');
  const end = content.indexOf('function down(');
  return content.slice(start, end > start ? end : undefined);
};
const upstreamColumns = new Set<string>();
const upstreamIndexes = new Set<string>();
for (const file of migrationFiles) {
  const up = upBody(readFileSync(join(migrationsGalleryDir, file), 'utf8'));
  for (const m of up.matchAll(/ALTER TABLE "?(\w+)"?\s+ADD\s+(?:COLUMN\s+)?(?:IF NOT EXISTS\s+)?"?(\w+)"?/g)) {
    if (m[2] !== 'CONSTRAINT') {
      upstreamColumns.add(`${m[1]}.${m[2]}`);
    }
  }
  for (const m of up.matchAll(/alterTable\('(\w+)'\)\s*\.addColumn\('(\w+)'/g)) {
    upstreamColumns.add(`${m[1]}.${m[2]}`);
  }
  for (const m of up.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?\s+ON\s+"?(\w+)"?/g)) {
    upstreamIndexes.add(`${m[2]}.${m[1]}`);
  }
  for (const m of up.matchAll(/createIndex\('(\w+)'\)\s*\.on\('(\w+)'\)/g)) {
    upstreamIndexes.add(`${m[2]}.${m[1]}`);
  }
}
const onUpstreamTable = (entry: string) => !createdTables.has(entry.split('.', 1)[0]);

// Every table migrations-gallery CREATEs is a fork table and needs a revert entry.
// (Was previously narrowed to shared_space* / *_audit, which silently excluded
// fork tables outside those naming conventions — e.g. asset_favorite. #763)
const forkTables = [...createdTables];

// The step-9 guard IN-list is the parenthesised block after `tablename IN (`.
const guardBlock = sql.slice(sql.indexOf('AND tablename IN ('));

// Step-8's migration-name DELETE block only — a migration name mentioned elsewhere in the
// file (e.g. a comment) must not count as covering it.
const deleteBlockStart = sql.indexOf('DELETE FROM "kysely_migrations"');
const deleteBlockEnd = sql.indexOf(');', deleteBlockStart) + 2;
const deleteBlock = sql.slice(deleteBlockStart, deleteBlockEnd);

describe('revert-to-immich.sql', () => {
  it('drops every fork table with CASCADE', () => {
    const missing = forkTables.filter((t) => !sql.includes(`DROP TABLE IF EXISTS "${t}" CASCADE`));
    expect(missing).toEqual([]);
  });

  it('lists every fork table in the step-9 fork_tables_left guard', () => {
    const missing = forkTables.filter((t) => !guardBlock.includes(`'${t}'`));
    expect(missing).toEqual([]);
  });

  it('lists every migrations-gallery migration in the step-8 kysely_migrations DELETE block', () => {
    const missing = migrationNames.filter((name) => !deleteBlock.includes(`'${name}'`));
    expect(missing).toEqual([]);
  });

  it('drops every column a fork migration adds to an upstream table', () => {
    const columns = [...upstreamColumns].filter((entry) => onUpstreamTable(entry));
    expect(columns.length).toBeGreaterThan(0);
    const missing = columns.filter((entry) => {
      const [table, column] = entry.split('.', 2);
      return !new RegExp(String.raw`ALTER TABLE "${table}"\s+DROP COLUMN IF EXISTS "${column}"`).test(sql);
    });
    expect(missing).toEqual([]);
  });

  it('drops every index a fork migration creates on an upstream table', () => {
    const indexes = [...upstreamIndexes].filter((entry) => onUpstreamTable(entry));
    expect(indexes.length).toBeGreaterThan(0);
    const missing = indexes.filter((entry) => !sql.includes(`DROP INDEX IF EXISTS "${entry.split('.', 2)[1]}"`));
    expect(missing).toEqual([]);
  });

  it('runs every data-hygiene step before section 2 drops the fork tables', () => {
    const section2 = sql.indexOf('DROP TABLE IF EXISTS');
    const steps = [
      'Storage Migration to disk',
      'DELETE FROM "asset_face"',
      'DELETE FROM "person_group"',
      `DELETE FROM "memory" WHERE "type" = 'rule'`,
      'SET "thumbhash" = NULL',
      `'originalDuration'`,
      `DELETE FROM "asset_edit" WHERE "action" = 'trim'`,
      'DELETE FROM "shared_link_asset"',
      'DELETE FROM "shared_link" sl',
      'DELETE FROM "system_metadata"',
      'UPDATE "api_key"',
    ];
    for (const step of steps) {
      const at = sql.indexOf(step);
      expect(at, step).toBeGreaterThan(-1);
      expect(at, step).toBeLessThan(section2);
    }
  });

  it('checks for S3 keys before any destructive statement', () => {
    const guard = sql.indexOf('Storage Migration to disk');
    const firstWrite = sql.search(/^\s*(?:DROP|ALTER|DELETE|UPDATE)\b/m);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstWrite);
  });

  it('restores asset.isFavorite before dropping asset_favorite', () => {
    // "IF NOT EXISTS" is intentionally tolerated: at the time this revert path was added
    // (slice 0, #763), asset."isFavorite" has NOT yet been dropped from the live schema —
    // that happens in a future slice 3 — so a bare ADD COLUMN would fail with "column
    // already exists" against every Gallery DB until that slice ships.
    const addColumn = sql.search(/ADD COLUMN(?: IF NOT EXISTS)? "isFavorite"/);
    const backfill = sql.indexOf('FROM asset_favorite');
    const dropTable = sql.indexOf('DROP TABLE IF EXISTS "asset_favorite"');

    expect(addColumn).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(-1);
    expect(dropTable).toBeGreaterThan(-1);
    // ordering is load-bearing: the backfill reads asset_favorite, so it must
    // run before the table is dropped
    expect(addColumn).toBeLessThan(backfill);
    expect(backfill).toBeLessThan(dropTable);
  });
});
