import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type SyncGalleryMigrations = (options: { serverRoot: string; logger?: { log: (message: string) => void } }) => {
  aliased: number;
  copied: number;
  removed: number;
};

// @ts-ignore - this executable bin module exports its testable core for regression coverage.
const { syncGalleryMigrations } = (await import('../../bin/sync-gallery-migrations.mjs')) as {
  syncGalleryMigrations: SyncGalleryMigrations;
};

const write = (serverRoot: string, file: string, contents = 'export async function up() {}') => {
  const fullPath = path.join(serverRoot, file);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, contents);
};

const migrationFiles = (serverRoot: string) =>
  readdirSync(path.join(serverRoot, 'dist/schema/migrations'))
    .filter((file) => file.endsWith('.js'))
    .sort();

describe('syncGalleryMigrations', () => {
  let serverRoot: string;

  beforeEach(() => {
    serverRoot = mkdtempSync(path.join(os.tmpdir(), 'gallery-migration-sync-'));
  });

  afterEach(() => {
    rmSync(serverRoot, { force: true, recursive: true });
  });

  it('copies compiled Gallery migrations into the combined dist migration folder', () => {
    write(serverRoot, 'dist/schema/migrations/1744910873969-InitialMigration.js', 'upstream');
    write(serverRoot, 'dist/schema/migrations-gallery/1772240000000-CreateSharedSpaceTables.js', 'gallery');

    const result = syncGalleryMigrations({ logger: { log: vi.fn() }, serverRoot });

    expect(result).toEqual({ aliased: 0, copied: 1, removed: 0 });
    expect(existsSync(path.join(serverRoot, 'dist/schema/migrations/1772240000000-CreateSharedSpaceTables.js'))).toBe(
      true,
    );
  });

  it('removes stale copied Gallery migrations without deleting non-Gallery compatibility migrations', () => {
    write(serverRoot, 'src/schema/migrations/1777667825574-ChangeDurationToInteger.ts');
    write(serverRoot, 'dist/schema/migrations/1776735180298-ChangeDurationToInteger.js', 'compatibility');
    write(serverRoot, 'dist/schema/migrations/1776735180298-ChangeDurationToInteger.js.map', 'compatibility map');
    write(serverRoot, 'dist/schema/migrations/1776735180298-ChangeDurationToInteger.d.ts', 'compatibility types');
    write(serverRoot, 'dist/schema/migrations/1772810000000-AddThumbnailCropYToSharedSpace.js', 'stale gallery');
    write(serverRoot, 'dist/schema/migrations/1772810000000-AddThumbnailCropYToSharedSpace.js.map', 'stale map');
    write(serverRoot, 'dist/schema/migrations/1772810000000-AddThumbnailCropYToSharedSpace.d.ts', 'stale types');
    write(
      serverRoot,
      'dist/schema/migrations-gallery/1772815000000-AddThumbnailCropYToSharedSpace.js',
      'current gallery',
    );

    const result = syncGalleryMigrations({ logger: { log: vi.fn() }, serverRoot });

    expect(result).toEqual({ aliased: 0, copied: 1, removed: 1 });
    expect(migrationFiles(serverRoot)).toEqual([
      '1772815000000-AddThumbnailCropYToSharedSpace.js',
      '1776735180298-ChangeDurationToInteger.js',
    ]);
    expect(
      existsSync(path.join(serverRoot, 'dist/schema/migrations/1772810000000-AddThumbnailCropYToSharedSpace.js.map')),
    ).toBe(false);
    expect(existsSync(path.join(serverRoot, 'dist/schema/migrations/1776735180298-ChangeDurationToInteger.d.ts'))).toBe(
      true,
    );
  });

  it('keeps current copied Gallery migrations when run repeatedly', () => {
    write(serverRoot, 'dist/schema/migrations/1772815000000-AddThumbnailCropYToSharedSpace.js', 'current gallery');
    write(
      serverRoot,
      'dist/schema/migrations-gallery/1772815000000-AddThumbnailCropYToSharedSpace.js',
      'current gallery',
    );

    const result = syncGalleryMigrations({ logger: { log: vi.fn() }, serverRoot });

    expect(result).toEqual({ aliased: 0, copied: 1, removed: 0 });
    expect(migrationFiles(serverRoot)).toEqual(['1772815000000-AddThumbnailCropYToSharedSpace.js']);
  });

  it('creates a compatibility alias for the renamed upstream duration migration', () => {
    write(serverRoot, 'dist/schema/migrations/1777667825574-ChangeDurationToInteger.js', 'current duration');
    write(serverRoot, 'dist/schema/migrations/1777667825574-ChangeDurationToInteger.js.map', 'current duration map');
    write(serverRoot, 'dist/schema/migrations/1777667825574-ChangeDurationToInteger.d.ts', 'current duration types');

    const result = syncGalleryMigrations({ logger: { log: vi.fn() }, serverRoot });

    expect(result).toEqual({ aliased: 1, copied: 0, removed: 0 });
    expect(existsSync(path.join(serverRoot, 'dist/schema/migrations/1776735180298-ChangeDurationToInteger.js'))).toBe(
      true,
    );
    expect(
      existsSync(path.join(serverRoot, 'dist/schema/migrations/1776735180298-ChangeDurationToInteger.js.map')),
    ).toBe(true);
    expect(existsSync(path.join(serverRoot, 'dist/schema/migrations/1776735180298-ChangeDurationToInteger.d.ts'))).toBe(
      true,
    );
  });
});
