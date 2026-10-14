import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type SyncGalleryMigrations = (options: { serverRoot: string; logger?: { log: (message: string) => void } }) => {
  removed: number;
};

// @ts-expect-error - this executable bin module exports its testable core for regression coverage.
const { syncGalleryMigrations } = (await import('../../bin/sync-gallery-migrations.mjs')) as {
  syncGalleryMigrations: SyncGalleryMigrations;
};

const write = (serverRoot: string, file: string, contents = 'export async function up() {}') => {
  const fullPath = path.join(serverRoot, file);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, contents);
};

const distFiles = (serverRoot: string) => readdirSync(path.join(serverRoot, 'dist/schema/migrations')).toSorted();

describe('syncGalleryMigrations', () => {
  let serverRoot: string;

  beforeEach(() => {
    serverRoot = mkdtempSync(path.join(os.tmpdir(), 'gallery-migration-sync-'));
  });

  afterEach(() => {
    rmSync(serverRoot, { force: true, recursive: true });
  });

  it('removes compiled migrations without a source from both folders, including old Gallery copies and aliases', () => {
    write(serverRoot, 'src/schema/migrations/1777667825574-ChangeDurationToInteger.ts');
    for (const name of [
      '1777667825574-ChangeDurationToInteger',
      '1776735180298-ChangeDurationToInteger',
      '1772240000000-CreateSharedSpaceTables',
    ]) {
      for (const suffix of ['.js', '.js.map', '.d.ts']) {
        write(serverRoot, `dist/schema/migrations/${name}${suffix}`);
      }
    }
    write(serverRoot, 'src/schema/migrations-gallery/1772240000000-CreateSharedSpaceTables.ts');
    write(serverRoot, 'dist/schema/migrations-gallery/1772240000000-CreateSharedSpaceTables.js');
    write(serverRoot, 'dist/schema/migrations-gallery/1773846750001-AddPersonNameTrigramIndex.js');

    const result = syncGalleryMigrations({ logger: { log: vi.fn() }, serverRoot });

    expect(result).toEqual({ removed: 3 });
    expect(distFiles(serverRoot)).toEqual([
      '1777667825574-ChangeDurationToInteger.d.ts',
      '1777667825574-ChangeDurationToInteger.js',
      '1777667825574-ChangeDurationToInteger.js.map',
    ]);
    expect(
      existsSync(path.join(serverRoot, 'dist/schema/migrations-gallery/1772240000000-CreateSharedSpaceTables.js')),
    ).toBe(true);
    expect(
      existsSync(path.join(serverRoot, 'dist/schema/migrations-gallery/1773846750001-AddPersonNameTrigramIndex.js')),
    ).toBe(false);
  });

  it('is a no-op when dist matches the source and when dist does not exist yet', () => {
    expect(syncGalleryMigrations({ logger: { log: vi.fn() }, serverRoot })).toEqual({ removed: 0 });

    write(serverRoot, 'src/schema/migrations/1744910873969-InitialMigration.ts');
    write(serverRoot, 'dist/schema/migrations/1744910873969-InitialMigration.js');
    write(serverRoot, 'dist/schema/migrations/ORDER', '');

    expect(syncGalleryMigrations({ logger: { log: vi.fn() }, serverRoot })).toEqual({ removed: 0 });
    expect(distFiles(serverRoot)).toEqual(['1744910873969-InitialMigration.js', 'ORDER']);
  });
});
