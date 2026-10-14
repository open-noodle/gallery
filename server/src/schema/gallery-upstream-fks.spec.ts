import { schemaFromCode } from '@immich/sql-tools';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { galleryTables } from 'src/schema/gallery.js';
import 'src/schema/index.js';

type UpstreamKey = { table: string; columns: string[]; forkForeignKeys: string[] };

// Every fork foreign key that references an upstream table, grouped by the upstream key it depends on. An upstream
// migration that drops or rebuilds one of these keys fails with 2BP01 unless a fork migration drops the dependent
// FKs before it and recreates them after (1787100000000-DropPersonFksBeforeClusterGroups is the worked example).
// tools/upstream-preflight reads the same file and flags incoming upstream migrations that touch a listed key.
const registryPath = join(process.cwd(), 'src/schema/gallery-upstream-fks.json');

const tableName = (table: { name: string }) =>
  table.name
    .replace(/Table$/, '')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();

describe('gallery-upstream-fks.json', () => {
  it('lists exactly the fork foreign keys onto upstream keys', () => {
    const schema = schemaFromCode({ overrides: true, namingStrategy: 'default' });
    const forkTables = new Set(galleryTables.map((table) => tableName(table)));
    const tables = new Map(schema.tables.map((table) => [table.name, table]));
    expect(
      [...forkTables].filter((name) => !tables.has(name)),
      'fork table name convention',
    ).toEqual([]);

    const derived: Record<string, UpstreamKey> = {};
    for (const table of schema.tables) {
      if (!forkTables.has(table.name)) {
        continue;
      }
      for (const constraint of table.constraints) {
        if (constraint.type !== 'foreign-key' || forkTables.has(constraint.referenceTableName)) {
          continue;
        }
        const referenced = tables.get(constraint.referenceTableName)!;
        const key = referenced.constraints.find(
          (candidate) =>
            (candidate.type === 'primary-key' || candidate.type === 'unique') &&
            candidate.columnNames.join(',') === constraint.referenceColumnNames.join(','),
        );
        expect(key, `${constraint.name} references no key`).toBeDefined();
        const entry = (derived[key!.name] ??= {
          table: referenced.name,
          columns: constraint.referenceColumnNames,
          forkForeignKeys: [],
        });
        entry.forkForeignKeys.push(constraint.name);
      }
    }
    for (const entry of Object.values(derived)) {
      entry.forkForeignKeys.sort();
    }

    const { keys } = JSON.parse(readFileSync(registryPath, 'utf8')) as { keys: Record<string, UpstreamKey> };
    expect(keys, 'update src/schema/gallery-upstream-fks.json to match the fork tables').toEqual(derived);
  });
});
