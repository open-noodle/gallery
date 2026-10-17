import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaults } from 'src/dtos/config.dto.js';
import * as forkConfig from 'src/gallery/dtos/config.dto.js';

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
const upstreamTriggers = new Set<string>();
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
  for (const m of up.matchAll(/CREATE OR REPLACE TRIGGER "(\w+)"\s+(?:AFTER|BEFORE) [A-Z ]+? ON "(\w+)"/g)) {
    upstreamTriggers.add(`${m[2]}.${m[1]}`);
  }
}
// Upstream columns a fork migration put back after an earlier fork migration dropped them. They are
// upstream schema again, so the revert keeps them: asset.isFavorite carries the owner's favorites.
const restoredUpstreamColumns = new Set(['asset.isFavorite']);
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

// Fork paths inside the system-config row, found from src/gallery/dtos/config.dto.ts: a fork default
// object sits in `defaults` by reference, and the extension keys spread into upstream sections.
const forkDefaultObjects = new Set<unknown>([
  ...Object.values(forkConfig.galleryJobDefaults),
  ...Object.values(forkConfig.galleryTopLevelDefaults),
  ...Object.values(forkConfig.galleryMachineLearningDefaults).filter((value) => typeof value === 'object'),
]);
const forkConfigPaths: string[] = [
  ...Object.keys(forkConfig.galleryServerDefaults).map((key) => `server.${key}`),
  ...Object.keys(forkConfig.GalleryClipExtension).map((key) => `machineLearning.clip.${key}`),
  // Inline in the upstream DTO rather than the fork module.
  'nightlyTasks.clusterNewPets',
  // Pre-rename key that foldLegacyFaceSuggestionConfig folds into facialRecognition.suggestions.
  'machineLearning.facialRecognition.suggestionMaxDistance',
];
let forkObjectsFound = 0;
const collectForkPaths = (node: object, path: string[]) => {
  for (const [key, value] of Object.entries(node)) {
    if (forkDefaultObjects.has(value)) {
      forkConfigPaths.push([...path, key].join('.'));
      forkObjectsFound++;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectForkPaths(value, [...path, key]);
    }
  }
};
collectForkPaths(defaults, []);

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
    const columns = [...upstreamColumns].filter(
      (entry) => onUpstreamTable(entry) && !restoredUpstreamColumns.has(entry),
    );
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
      'FROM "asset_video_trim"',
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

  it('runs the opt-in space conversion (0a) after the S3 guard and before 0b', () => {
    const guard = sql.indexOf('Storage Migration to disk');
    const convert = sql.indexOf(`current_setting('gallery.convert_spaces', true)`);
    const favorites = sql.indexOf(`current_setting('gallery.convert_favorites', true) = 'on'`);
    const hygiene = sql.indexOf('-- 0b. ');
    expect(guard).toBeGreaterThan(-1);
    expect(convert).toBeGreaterThan(guard);
    expect(favorites).toBeGreaterThan(convert);
    expect(hygiene).toBeGreaterThan(favorites);
    // A per-viewer nickname, never a name for the person.
    expect(sql.slice(convert, hygiene)).not.toContain('shared_space_person_alias');
  });

  it('drops the fork migration ledger and its lock table', () => {
    expect(sql).toContain('DROP TABLE IF EXISTS "gallery_migrations";');
    expect(sql).toContain('DROP TABLE IF EXISTS "gallery_migrations_lock";');
  });

  it('keeps every restored upstream column', () => {
    for (const entry of restoredUpstreamColumns) {
      const [table, column] = entry.split('.', 2);
      expect(sql).not.toMatch(new RegExp(String.raw`ALTER TABLE "${table}"\s+DROP COLUMN IF EXISTS "${column}"`));
    }
  });

  it('drops every trigger a fork migration creates on an upstream table, before section 2', () => {
    const triggers = [...upstreamTriggers].filter((entry) => onUpstreamTable(entry));
    expect(triggers).toContain('asset.asset_is_favorite_after_write');
    const section2 = sql.indexOf('DROP TABLE IF EXISTS');
    for (const entry of triggers) {
      const [table, trigger] = entry.split('.', 2);
      const at = sql.indexOf(`DROP TRIGGER IF EXISTS "${trigger}" ON "${table}";`);
      expect(at, entry).toBeGreaterThan(-1);
      expect(at, entry).toBeLessThan(section2);
      expect(guardBlock, entry).toContain(`'${trigger}'`);
    }
  });

  it('restores asset.isFavorite before dropping asset_favorite', () => {
    // IF NOT EXISTS: databases last booted between the column drop and its restore have no column.
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

  it('finds every fork config default in the system config defaults', () => {
    expect(forkObjectsFound).toBe(forkDefaultObjects.size);
  });

  it('strips every fork path out of the system-config row', () => {
    const strip = sql.slice(sql.indexOf('UPDATE "system_metadata"'));
    const missing = forkConfigPaths.filter((path) => !strip.includes(`#- '{${path.replaceAll('.', ',')}}'`));
    expect(missing).toEqual([]);
  });

  it('strips the fork memory type map out of user preferences', () => {
    expect(sql).toMatch(/UPDATE "user_metadata"\s+SET "value" = "value" #- '\{memories,types\}'/);
  });

  it('moves jit=off off the database, and off the role when the database could not hold it', () => {
    expect(sql).toMatch(
      /EXECUTE format\('ALTER DATABASE %I RESET jit', current_database\(\)\);\s+EXCEPTION WHEN insufficient_privilege THEN/,
    );
    expect(sql).toMatch(/'1799400000000-ScopeJitOffToDatabase'\)\s+THEN\s+EXECUTE 'ALTER ROLE CURRENT_USER RESET jit'/);
  });
});
