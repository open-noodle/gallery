import { DatabaseConnectionParams, createPostgres } from '@immich/sql-tools';
import { Kysely, sql } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { getKyselyConfig } from 'src/utils/database.js';

// eslint-disable-next-line unicorn/prefer-module
const upstreamFolder = join(__dirname, '../../../../src/schema/migrations');
// eslint-disable-next-line unicorn/prefer-module
const galleryFolder = join(__dirname, '../../../../src/schema/migrations-gallery');

// Helper: create a raw database (no migrations applied)
const createRawDatabase = async (name: string): Promise<Kysely<DB>> => {
  const testUrl = process.env.IMMICH_TEST_POSTGRES_URL!;
  const templateDb = testUrl.split('/').pop()!;
  const connection = {
    connectionType: 'url',
    url: testUrl.replace(`/${templateDb}`, '/postgres'),
  } as DatabaseConnectionParams;
  const pgSql = createPostgres({ maxConnections: 1, connection });

  await pgSql.unsafe(`DROP DATABASE IF EXISTS ${name}`);
  await pgSql.unsafe(`CREATE DATABASE ${name} OWNER postgres`);
  await pgSql.end();

  return new Kysely<DB>(
    getKyselyConfig({
      connectionType: 'url',
      url: testUrl.replace(`/${templateDb}`, () => `/${name}`),
    }),
  );
};

const createRepo = (db: Kysely<DB>) => {
  const configRepository = new ConfigRepository();
  const logger = LoggingRepository.create();
  return new DatabaseRepository(db, logger, configRepository);
};

const fileProvider = (folder: string) =>
  new FileMigrationProvider({
    fs: { readdir },
    path: { join },
    // Written here, in project source, so vite-node resolves the `src/` alias inside the migration
    // files. kysely's own fallback `import()` runs in node_modules and cannot see it.
    import: (filePath) => import(filePath),
    migrationFolder: folder,
  });

const fileNames = async (folder: string) => Object.keys(await fileProvider(folder).getMigrations()).toSorted();

// What a stock Immich server runs on boot: upstream's folder, upstream's ledger, ordered (production).
const stockImmichMigrator = (db: Kysely<DB>) =>
  new Migrator({
    db,
    migrationLockTableName: 'kysely_migrations_lock',
    allowUnorderedMigrations: false,
    migrationTableName: 'kysely_migrations',
    provider: fileProvider(upstreamFolder),
  });

// What a Gallery build before the ledger split ran: both folders, one `kysely_migrations` ledger.
const preSplitGalleryMigrator = (db: Kysely<DB>) =>
  new Migrator({
    db,
    migrationLockTableName: 'kysely_migrations_lock',
    allowUnorderedMigrations: true,
    migrationTableName: 'kysely_migrations',
    provider: {
      getMigrations: async () => ({
        ...(await fileProvider(upstreamFolder).getMigrations()),
        ...(await fileProvider(galleryFolder).getMigrations()),
      }),
    },
  });

type LedgerTable = 'kysely_migrations' | 'gallery_migrations';

const ledger = async (db: Kysely<DB>, table: LedgerTable) => {
  const { rows } = await sql<{ name: string; timestamp: string }>`
    SELECT "name", "timestamp" FROM ${sql.table(table)} ORDER BY "name"
  `.execute(db);
  return rows;
};

const ledgerNames = async (db: Kysely<DB>, table: LedgerTable) => {
  const rows = await ledger(db, table);
  return rows.map(({ name }) => name);
};

const insertLedgerRow = (db: Kysely<DB>, name: string) =>
  sql`
    INSERT INTO "kysely_migrations" ("name", "timestamp") VALUES (${name}, ${new Date().toISOString()})
    ON CONFLICT ("name") DO NOTHING
  `.execute(db);

// The end state every starting state must reach: each ledger holds exactly its own folder's names,
// and a stock Immich migrator finds nothing missing, nothing out of order and nothing to run.
const expectSplitLedgers = async (db: Kysely<DB>) => {
  expect(await ledgerNames(db, 'kysely_migrations')).toEqual(await fileNames(upstreamFolder));
  expect(await ledgerNames(db, 'gallery_migrations')).toEqual(await fileNames(galleryFolder));

  const { error, results } = await stockImmichMigrator(db).migrateToLatest();
  expect(error).toBeUndefined();
  expect(results).toEqual([]);
};

// A second boot must change nothing.
const expectIdempotentBoot = async (db: Kysely<DB>) => {
  const before = [await ledger(db, 'kysely_migrations'), await ledger(db, 'gallery_migrations')];
  await expect(createRepo(db).runMigrations()).resolves.toBe(0);
  expect([await ledger(db, 'kysely_migrations'), await ledger(db, 'gallery_migrations')]).toEqual(before);
};

const withDatabase = async (name: string, test: (db: Kysely<DB>) => Promise<void>) => {
  const db = await createRawDatabase(name);
  try {
    await test(db);
  } finally {
    await db.destroy();
  }
};

// Most scenarios migrate a database from scratch more than once.
describe('Database Migration Scenarios', { timeout: 60_000 }, () => {
  // Scenario A: Fresh install
  it('should split a fresh install across both ledgers', () =>
    withDatabase('migration_test_fresh', async (db) => {
      await createRepo(db).runMigrations();
      await expectSplitLedgers(db);
      await expectIdempotentBoot(db);
    }));

  // Scenario B: Immich-to-Gallery switch from a stock Immich database at Gallery's upstream base
  it('should apply fork migrations on top of a stock Immich database and leave its ledger untouched', () =>
    withDatabase('migration_test_immich', async (db) => {
      const { error } = await stockImmichMigrator(db).migrateToLatest();
      expect(error).toBeUndefined();
      const immichLedger = await ledger(db, 'kysely_migrations');
      // schema-check reads the ledgers before any Gallery boot has created gallery_migrations
      await expect(createRepo(db).getMigrations()).resolves.toEqual(immichLedger);

      await createRepo(db).runMigrations();

      expect(await ledger(db, 'kysely_migrations')).toEqual(immichLedger);
      await expectSplitLedgers(db);
      await expectIdempotentBoot(db);
    }));

  // Scenario C: current Gallery database, booted by a pre-split build. Its single ledger holds every
  // fork name, both build-time alias names and the empty AddPersonNameTrigramIndex stub's row.
  it('should move fork rows out of a pre-split Gallery ledger and drop the alias and stub rows', () =>
    withDatabase('migration_test_gallery', async (db) => {
      const { error } = await preSplitGalleryMigrator(db).migrateToLatest();
      expect(error).toBeUndefined();
      for (const name of [
        '1773846750001-AddPersonNameTrigramIndex',
        '1776735180298-ChangeDurationToInteger',
        '1793000000000-ClearPreOptionMFaceRepairScans',
      ]) {
        await insertLedgerRow(db, name);
      }

      await createRepo(db).runMigrations();

      await expectSplitLedgers(db);
      await expectIdempotentBoot(db);
    }));

  // Scenario C2: a Gallery database that recorded ChangeDurationToInteger only under its pre-rename
  // name. Re-running the migration would fail on the already-integer column, so the row is renamed.
  it('should rename a pre-rename ChangeDurationToInteger row instead of re-running the migration', () =>
    withDatabase('migration_test_prerename', async (db) => {
      const { error } = await preSplitGalleryMigrator(db).migrateToLatest();
      expect(error).toBeUndefined();
      await sql`
        UPDATE "kysely_migrations" SET "name" = '1776735180298-ChangeDurationToInteger'
        WHERE "name" = '1777667825574-ChangeDurationToInteger'
      `.execute(db);

      await createRepo(db).runMigrations();

      await expectSplitLedgers(db);
      await expectIdempotentBoot(db);
    }));

  // Scenario C2b: as C2, but the pre-rename row was executed before upstream migrations named between
  // the two names. A stock migrator sorts executed rows by (timestamp, name) and requires that order to
  // match file order, so the renamed row must be re-stamped to sort at its new name.
  it('should re-stamp a renamed row so a stock Immich migrator accepts the ledger order', () =>
    withDatabase('migration_test_prerename_early', async (db) => {
      const { error } = await preSplitGalleryMigrator(db).migrateToLatest();
      expect(error).toBeUndefined();
      await sql`
        UPDATE "kysely_migrations"
        SET "name" = '1776735180298-ChangeDurationToInteger', "timestamp" = '2000-01-01T00:00:00.000Z'
        WHERE "name" = '1777667825574-ChangeDurationToInteger'
      `.execute(db);
      // A fork row named before the target but recorded late must not drag the renamed row along.
      await sql`
        UPDATE "kysely_migrations" SET "timestamp" = '2100-01-01T00:00:00.000Z'
        WHERE "name" = '1777000000000-AddSpacePersonCounts'
      `.execute(db);

      await createRepo(db).runMigrations();

      await expectSplitLedgers(db);
      await expectIdempotentBoot(db);
    }));

  // Scenario C3: RC/staging databases recorded fork migrations under the names they had before being
  // renumbered off timestamp collisions.
  it('should rename RC-era fork names to their current names', () =>
    withDatabase('migration_test_rc_names', async (db) => {
      const { error } = await preSplitGalleryMigrator(db).migrateToLatest();
      expect(error).toBeUndefined();
      for (const [from, to] of [
        ['1782000000000-AddFaceRepairScanFlaggedFace', '1781500000000-AddFaceRepairScanFlaggedFace'],
        ['1783000000000-AddFaceRepairScanInFlightIndex', '1783050000000-AddFaceRepairScanInFlightIndex'],
        ['1793000000000-ClearPreOptionMFaceRepairScans', '1793300000000-ClearPreOptionMFaceRepairScans'],
      ]) {
        await sql`UPDATE "kysely_migrations" SET "name" = ${from} WHERE "name" = ${to}`.execute(db);
      }

      await createRepo(db).runMigrations();

      await expectSplitLedgers(db);
    }));

  // Scenario C4: a Gallery release from before upstream's ClusterGroups. Its fork foreign keys onto
  // person_pkey must be dropped (1787100000000) before ClusterGroups (1787148183729) runs, so pending
  // migrations keep running in one timestamp order across both folders.
  it('should upgrade a pre-ClusterGroups Gallery database in timestamp order', () =>
    withDatabase('migration_test_pre_cluster_groups', async (db) => {
      const { error } = await preSplitGalleryMigrator(db).migrateTo('1787000000000-AddFacePersonVerdict');
      expect(error).toBeUndefined();

      await createRepo(db).runMigrations();

      await expectSplitLedgers(db);
    }));

  // Scenario C5: fork rows recorded in both ledgers at once must converge on the next boot.
  it('should converge when fork rows are already in both ledgers', () =>
    withDatabase('migration_test_partial', async (db) => {
      const { error } = await preSplitGalleryMigrator(db).migrateToLatest();
      expect(error).toBeUndefined();
      await sql`
        CREATE TABLE "gallery_migrations" ("name" varchar(255) NOT NULL PRIMARY KEY, "timestamp" varchar(255) NOT NULL)
      `.execute(db);
      await sql`
        INSERT INTO "gallery_migrations" SELECT "name", "timestamp" FROM "kysely_migrations"
        WHERE "name" IN ('1772230000000-CreateStorageMigrationLogTable', '1797000000000-AddAssetLocalDateTimeIndex')
      `.execute(db);

      await createRepo(db).runMigrations();

      await expectSplitLedgers(db);
    }));

  // Scenario D: Rollback reverts the newest fork migration first and leaves upstream's ledger alone
  it('should revert the last fork migration first', () =>
    withDatabase('migration_test_rollback', async (db) => {
      const repo = createRepo(db);
      await repo.runMigrations();
      const upstreamBefore = await ledger(db, 'kysely_migrations');
      const galleryBefore = await ledgerNames(db, 'gallery_migrations');

      const reverted = await repo.revertLastMigration();

      expect(reverted).toBe(galleryBefore.at(-1));
      expect(await ledgerNames(db, 'gallery_migrations')).toEqual(galleryBefore.slice(0, -1));
      expect(await ledger(db, 'kysely_migrations')).toEqual(upstreamBefore);
    }));

  // Scenario E: getMigrations reports both ledgers, sorted by name and interleaved
  it('should return all migrations sorted by name including both upstream and fork', () =>
    withDatabase('migration_test_sorted', async (db) => {
      const repo = createRepo(db);
      await repo.runMigrations();

      const migrations = await repo.getMigrations();
      const names = migrations.map((m) => m.name);
      expect(names).toEqual([...(await fileNames(upstreamFolder)), ...(await fileNames(galleryFolder))].toSorted());

      const storageIdx = names.findIndex((n) => n.includes('CreateStorageMigrationLogTable'));
      const opusIdx = names.findIndex((n) => n.includes('UpdateOpusCodecName'));
      const initialIdx = names.findIndex((n) => n.includes('InitialMigration'));
      expect(initialIdx).toBeLessThan(storageIdx);
      expect(storageIdx).toBeLessThan(opusIdx);
    }));

  // Scenario G: Retry after revert
  it('should be able to re-run after a previous successful run', () =>
    withDatabase('migration_test_retry', async (db) => {
      const repo = createRepo(db);
      await repo.runMigrations();
      await repo.revertLastMigration();

      await expect(repo.runMigrations()).resolves.toBe(1);
      await expectSplitLedgers(db);
    }));

  // Scenario H: the fork migration disables PostgreSQL JIT for the connecting role.
  // JIT-compiling the high-cost (but fast-executing) cross-space People aggregates
  // adds a ~2s per-backend LLVM penalty; jit=off makes the People page ~4x faster
  // and regresses nothing (see 1783628194057-DisablePostgresJit).
  it('should disable PostgreSQL JIT for the connecting role', async () => {
    const dbName = 'migration_test_jit';
    const setup = await createRawDatabase(dbName);
    await createRepo(setup).runMigrations();
    await setup.destroy();

    // Open a fresh connection, as the app pool would, after the migration ran.
    // ALTER ROLE ... SET applies to new connections, so this reflects runtime behavior.
    const testUrl = process.env.IMMICH_TEST_POSTGRES_URL!;
    const templateDb = testUrl.split('/').pop()!;
    const db = new Kysely<DB>(
      getKyselyConfig({ connectionType: 'url', url: testUrl.replace(`/${templateDb}`, () => `/${dbName}`) }),
    );
    try {
      const { rows } = await sql<{ jit: string; configured: boolean }>`
        SELECT current_setting('jit') AS jit,
               EXISTS (
                 SELECT 1 FROM pg_roles WHERE rolname = current_user AND 'jit=off' = ANY (rolconfig)
               ) AS configured
      `.execute(db);
      expect(rows[0].configured).toBe(true);
      expect(rows[0].jit).toBe('off');
    } finally {
      await db.destroy();
    }
  });
});
