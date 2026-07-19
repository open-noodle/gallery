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

// Targeted regression guard (not exhaustive, matching the original scope): the
// shared_space_* / *_audit fork tables the album + library sync slices added — where the
// drift this spec guards against actually happened.
const forkTables = [...createdTables].filter((name) => name.startsWith('shared_space') || name.endsWith('_audit'));

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
});
