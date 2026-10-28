import { DatabaseConnectionParams, createPostgres } from '@immich/sql-tools';
import { Kysely, sql } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { serverVersion } from 'src/constants.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { PersonService } from 'src/services/person.service.js';
import { clearConfigCache } from 'src/utils/config.js';
import { getKyselyConfig } from 'src/utils/database.js';
import { mediumFactory, newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';

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
  // name. Without a rename the old row has no file and Kysely refuses to boot; the bootstrap renames it
  // so the migration's own already-integer guard is never relied on.
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

  // Scenario C6: an Immich newer than Gallery's base recorded an upstream migration this build does not
  // ship. Boot must still fail and change nothing, but say why and name the supported limit.
  it('should refuse a database migrated by a newer Immich with an actionable error', () =>
    withDatabase('migration_test_newer_immich', async (db) => {
      const { error } = await stockImmichMigrator(db).migrateToLatest();
      expect(error).toBeUndefined();
      await insertLedgerRow(db, '1899999999999-FromANewerImmich');
      const immichLedger = await ledger(db, 'kysely_migrations');
      const upstreamNames = await fileNames(upstreamFolder);

      await expect(createRepo(db).runMigrations()).rejects.toThrow(
        `migration "1899999999999-FromANewerImmich" is not part of it (or was renamed since). ` +
          `Gallery ${serverVersion} supports Immich databases up to migration "${upstreamNames.at(-1)}"`,
      );

      expect(await ledger(db, 'kysely_migrations')).toEqual(immichLedger);
      const { rows } = await sql<{ exists: boolean }>`
        SELECT to_regclass('gallery_migrations') IS NOT NULL AS "exists"
      `.execute(db);
      expect(rows[0].exists).toBe(false);
    }));

  // Scenario C7: a newer Gallery recorded a fork migration this build does not ship (a rollback that skipped the revert).
  it('should refuse a database migrated by a newer Gallery and point at the rollback procedure', () =>
    withDatabase('migration_test_newer_gallery', async (db) => {
      await createRepo(db).runMigrations();
      await sql`INSERT INTO "gallery_migrations" ("name", "timestamp") VALUES ('1899999999999-FromANewerGallery', '0')`.execute(
        db,
      );
      const before = [await ledger(db, 'kysely_migrations'), await ledger(db, 'gallery_migrations')];

      await expect(createRepo(db).runMigrations()).rejects.toThrow(
        `Gallery migration "1899999999999-FromANewerGallery" was recorded by a newer Gallery release than ${serverVersion}. ` +
          `Undo it with that release first: https://docs.opennoodle.de/install/upgrading#rolling-back-to-an-earlier-release.`,
      );
      expect([await ledger(db, 'kysely_migrations'), await ledger(db, 'gallery_migrations')]).toEqual(before);
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

// The switch an Immich 3.3 user makes when their users shared people (cluster groups, person sharing), end to end:
// a stock Immich database seeded the way Immich stores those people, Gallery's boot (the runMigrations call that
// failed with "Cannot enforce one person per person_group"), stock Immich's boot on the result,
// scripts/revert-to-immich.sql, and a second switch. These live here because they build databases from scratch:
// upstream's 1746636476623-DropExtraIndexes runs ALTER DATABASE, which writes a cluster-wide catalog, so two files
// doing this at once fail with "tuple concurrently updated". See specs/2026-10-28-shared-person-groups-split-design.md.
// eslint-disable-next-line unicorn/prefer-module
const repoRoot = join(__dirname, '../../../../..');

const bootStockImmich = async (db: Kysely<any>) => {
  const { error, results = [] } = await stockImmichMigrator(db).migrateToLatest();
  expect(error).toBeUndefined();
  return results;
};

const bootGallery = (db: Kysely<any>) => createRepo(db).runMigrations();

const runRevertScript = async (db: Kysely<any>) => {
  const script = readFileSync(join(repoRoot, 'scripts', 'revert-to-immich.sql'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
  await sql.raw(`SET gallery.revert_token = 'i_accept_data_loss';\n${script}`).execute(db);
};

// Deterministic, so a failure reproduces.
const random = (() => {
  let state = 20_261_028;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
})();
const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, minute));

// What Immich 3.3 leaves behind once three users joined a cluster group:
// - groups recognition pooled across owners, each owner holding their own name, hidden and favourite state;
// - person_user shares, whose trigger added the recipient's row, including a chain and a cleared name;
// - faces whose asset owner has no row in the group, soft-deleted and hidden faces, unassigned faces;
// - a fourth user outside the cluster with a pending request to join it, and single-owner groups.
const seedImmich = async (db: Kysely<any>) => {
  const cluster = await db.insertInto('cluster_group').defaultValues().returning('id').executeTakeFirstOrThrow();
  const outsiderCluster = await db
    .insertInto('cluster_group')
    .defaultValues()
    .returning('id')
    .executeTakeFirstOrThrow();
  const users = [];
  for (let i = 0; i < 3; i++) {
    users.push(
      await db
        .insertInto('user')
        .values(mediumFactory.userInsert({ clusterGroupId: cluster.id }))
        .returning(['id'])
        .executeTakeFirstOrThrow(),
    );
  }
  const outsider = await db
    .insertInto('user')
    .values(mediumFactory.userInsert({ clusterGroupId: outsiderCluster.id }))
    .returning(['id'])
    .executeTakeFirstOrThrow();
  await db.insertInto('cluster_group_request').values({ clusterGroupId: cluster.id, userId: outsider.id }).execute();
  const [alice, bob, carol] = users.map(({ id }) => id);

  const assetsByOwner = new Map<string, string[]>();
  for (const ownerId of [alice, bob, carol, outsider.id]) {
    const assets = [];
    for (let i = 0; i < 12; i++) {
      assets.push(mediumFactory.assetInsert({ ownerId }));
    }
    await db.insertInto('asset').values(assets).execute();
    assetsByOwner.set(
      ownerId,
      assets.map(({ id }) => id),
    );
  }

  let minute = 0;
  const newGroup = async (clusterGroupId = cluster.id) => {
    const group = await db
      .insertInto('person_group')
      .values({ clusterGroupId, createdAt: at(minute) })
      .returning('id')
      .executeTakeFirstOrThrow();
    return group.id as string;
  };
  const newPerson = (ownerId: string, personGroupId: string, overrides: Record<string, unknown> = {}) =>
    db
      .insertInto('person')
      .values({
        ...mediumFactory.personInsert({ ownerId, personGroupId }),
        name: `person ${minute}`,
        createdAt: at(minute++),
        isHidden: random() < 0.2,
        isFavorite: random() < 0.2,
        birthDate: random() < 0.3 ? '1950-06-01' : null,
        color: random() < 0.3 ? '#ff0000' : null,
        thumbnailPath: `/thumbs/${ownerId}/${personGroupId}.jpeg`,
        ...overrides,
      })
      .execute();
  const newFaces = async (ownerId: string, personGroupId: string | null, count: number) => {
    const faces = [];
    for (let i = 0; i < count; i++) {
      faces.push(
        mediumFactory.assetFaceInsert({
          assetId: pick(assetsByOwner.get(ownerId)!),
          personGroupId,
          deletedAt: random() < 0.1 ? new Date() : null,
          isVisible: random() >= 0.1,
        }),
      );
    }
    if (faces.length > 0) {
      await db.insertInto('asset_face').values(faces).execute();
    }
    return faces.map(({ id }) => id);
  };

  // Pooled by recognition: two or three owners per group, in a random creation order.
  const pooled: string[] = [];
  for (let i = 0; i < 120; i++) {
    const group = await newGroup();
    const owners = [alice, bob, carol].toSorted(() => random() - 0.5).slice(0, random() < 0.4 ? 3 : 2);
    for (const ownerId of owners) {
      await newPerson(ownerId, group);
      await newFaces(ownerId, group, Math.floor(random() * 4));
    }
    // A face of a cluster member who has no row in the group.
    const rowless = [alice, bob, carol].find((id) => !owners.includes(id));
    if (rowless && random() < 0.3) {
      await newFaces(rowless, group, 1);
    }
    pooled.push(group);
  }

  // Shared: the sharer's row, then person_user rows, whose trigger adds each recipient's row.
  const shared: string[] = [];
  for (let i = 0; i < 30; i++) {
    const group = await newGroup();
    const [sharer, first, second] = [alice, bob, carol].toSorted(() => random() - 0.5);
    await newPerson(sharer, group, { name: `shared ${i}` });
    await newFaces(sharer, group, 2);
    minute++;
    await db
      .insertInto('person_user')
      .values({ personGroupId: group, sharedById: sharer, sharedWithId: first, role: pick(['read', 'write', 'admin']) })
      .execute();
    if (i % 3 === 0) {
      // Passed on by the recipient: a chain, whose sharer is not the group's first row.
      await db
        .insertInto('person_user')
        .values({ personGroupId: group, sharedById: first, sharedWithId: second, role: 'read' })
        .execute();
    }
    if (i % 5 === 0) {
      // The recipient cleared the name the trigger copied.
      await db
        .updateTable('person')
        .set({ name: '' })
        .where('ownerId', '=', first)
        .where('personGroupId', '=', group)
        .execute();
    }
    await newFaces(first, group, 1);
    shared.push(group);
  }

  // Groups with one owner, inside and outside the cluster, and faces nobody was assigned.
  const solo: string[] = [];
  for (const ownerId of [alice, bob, carol]) {
    const group = await newGroup();
    await newPerson(ownerId, group);
    await newFaces(ownerId, group, 2);
    solo.push(group);
  }
  const outsiderGroup = await newGroup(outsiderCluster.id);
  await newPerson(outsider.id, outsiderGroup);
  await newFaces(outsider.id, outsiderGroup, 2);
  await newFaces(alice, null, 3);

  return {
    alice,
    bob,
    carol,
    outsider: outsider.id,
    cluster: cluster.id,
    pooled,
    shared,
    solo: [...solo, outsiderGroup],
  };
};

// Everything Immich owns that the switch touches. updatedAt/updateId are left out: a move bumps them, which
// is what makes a phone pick it up.
const immichState = async (db: Kysely<any>) => {
  const people = await db.selectFrom('person').selectAll().orderBy(['personGroupId', 'ownerId']).execute();
  return {
    person: people.map(({ updatedAt: _updatedAt, updateId: _updateId, ...person }) => person),
    faces: await db
      .selectFrom('asset_face')
      .select(['id', 'assetId', 'personGroupId', 'deletedAt', 'isVisible'])
      .orderBy('id')
      .execute(),
    shares: await db
      .selectFrom('person_user')
      .selectAll()
      .orderBy(['personGroupId', 'sharedById', 'sharedWithId'])
      .execute(),
    groups: await db.selectFrom('person_group').select(['id', 'clusterGroupId', 'createdAt']).orderBy('id').execute(),
    clusters: await db.selectFrom('cluster_group').select(['id', 'name']).orderBy('id').execute(),
    requests: await db.selectFrom('cluster_group_request').select(['clusterGroupId', 'userId']).execute(),
    users: await db.selectFrom('user').select(['id', 'clusterGroupId']).orderBy('id').execute(),
  };
};

const key = (person: Record<string, any>) => `${person.ownerId}/${person.personGroupId}`;

// Checks the split state against what Immich had, row by row.
// Returns how many rows moved.
const expectSplit = async (db: Kysely<any>, before: Awaited<ReturnType<typeof immichState>>) => {
  const after = await immichState(db);
  const splits = await db.selectFrom('person_group_split').selectAll().execute();
  const originalOf = (groupId: string) =>
    splits.find((split) => split.splitGroupId === groupId)?.originalGroupId ?? groupId;

  // One row per group, so Gallery's index holds.
  await expect(
    sql`SELECT "personGroupId" FROM "person" GROUP BY 1 HAVING count(*) > 1`.execute(db),
  ).resolves.toMatchObject({ rows: [] });

  // Every person survives, with all of its own state, in a group that traces back to its original one.
  expect(after.person).toHaveLength(before.person.length);
  const original = new Map(before.person.map((person) => [key(person), person]));
  for (const person of after.person) {
    const from = original.get(key({ ownerId: person.ownerId, personGroupId: originalOf(person.personGroupId) }));
    expect(from, key(person)).toBeDefined();
    expect({ ...person, personGroupId: from!.personGroupId }).toEqual(from);
  }

  // The oldest row keeps the group; every other row is recorded once.
  const rowsBefore = Map.groupBy(before.person, (person) => person.personGroupId);
  const expectedMoves = rowsBefore
    .values()
    .flatMap((rows) =>
      rows.toSorted((a, b) => a.createdAt - b.createdAt || a.ownerId.localeCompare(b.ownerId)).slice(1),
    )
    .toArray();
  expect(splits.map(({ ownerId, originalGroupId }) => `${ownerId}/${originalGroupId}`).toSorted()).toEqual(
    expectedMoves.map((person) => key(person)).toSorted(),
  );

  // Every face keeps its group lineage, and sits with its asset owner's row when that owner had one.
  const assets = await db.selectFrom('asset').select(['id', 'ownerId']).execute();
  const assetOwner = new Map(assets.map(({ id, ownerId }) => [id, ownerId]));
  const facesBefore = new Map(before.faces.map((face) => [face.id, face]));
  expect(after.faces).toHaveLength(before.faces.length);
  for (const face of after.faces) {
    const from = facesBefore.get(face.id)!;
    expect({ ...face, personGroupId: from.personGroupId }, face.id).toEqual(from);
    if (from.personGroupId === null) {
      expect(face.personGroupId).toBeNull();
      continue;
    }
    expect(originalOf(face.personGroupId)).toBe(from.personGroupId);
    const owner = assetOwner.get(face.assetId)!;
    const ownerHadRow = rowsBefore.get(from.personGroupId)!.some((person) => person.ownerId === owner);
    const holder = after.person.find((person) => person.personGroupId === face.personGroupId);
    if (ownerHadRow) {
      expect(holder?.ownerId, face.id).toBe(owner);
    } else {
      expect(face.personGroupId, face.id).toBe(from.personGroupId);
    }
  }

  // Split groups stay in their cluster; Immich's cluster data is untouched.
  for (const split of splits) {
    const group = after.groups.find(({ id }) => id === split.splitGroupId)!;
    expect(group.clusterGroupId).toBe(before.groups.find(({ id }) => id === split.originalGroupId)!.clusterGroupId);
  }
  expect(after.clusters).toEqual(before.clusters);
  expect(after.requests).toEqual(before.requests);
  expect(after.users).toEqual(before.users);

  // Shares are held aside, verbatim.
  expect(after.shares).toEqual([]);
  await expect(
    db
      .selectFrom('person_group_split_share')
      .selectAll()
      .orderBy(['personGroupId', 'sharedById', 'sharedWithId'])
      .execute(),
  ).resolves.toEqual(before.shares);

  // Phones are told to drop each moved row. The table keeps earlier rows (a revert adds its own), so check
  // that every move has one, and that nothing but moves was audited.
  const auditRows = await db.selectFrom('person_audit').select(['personGroupId', 'ownerId']).execute();
  const audit = new Set(auditRows.map((row) => key(row)));
  const missing = expectedMoves.map((person) => key(person)).filter((entry) => !audit.has(entry));
  expect(missing).toEqual([]);
  const keptRows = after.person.filter((person) =>
    splits.every((split) => split.splitGroupId !== person.personGroupId),
  );
  const auditedKept = keptRows.filter((person) => audit.has(key(person)));
  expect(auditedKept.map((person) => key(person))).toEqual([]);

  return expectedMoves.length;
};

describe('Switching from Immich 3.3 with people shared between users', { timeout: 60_000 }, () => {
  it('switches, survives a stock Immich boot, reverts to exactly what Immich had, and switches again', () =>
    withDatabase('migration_test_shared_people_switch', async (db) => {
      const upstreamNames = await fileNames(upstreamFolder);
      expect(await bootStockImmich(db)).toHaveLength(upstreamNames.length);
      await seedImmich(db);
      const before = await immichState(db);
      expect(before.shares.length).toBeGreaterThan(30);

      // The boot that used to fail. Each ledger then holds its own folder, and stock Immich finds nothing to run.
      await bootGallery(db);
      await expectSplitLedgers(db);
      await expect(
        sql`SELECT to_regclass('"person_personGroupId_key"') IS NOT NULL AS "exists"`.execute(db),
      ).resolves.toMatchObject({ rows: [{ exists: true }] });
      await expect(expectSplit(db, before)).resolves.toBeGreaterThan(100);

      // Gallery's next boot has nothing left to do.
      await expect(bootGallery(db)).resolves.toBe(0);

      // A trial boot of stock Immich on the Gallery database, which the switch-back guide allows: its migrator
      // finds only its own migrations, in order.
      await expect(bootStockImmich(db)).resolves.toEqual([]);

      await runRevertScript(db);
      await expect(immichState(db)).resolves.toEqual(before);
      await expect(
        sql`SELECT to_regclass('person_group_split') AS "split", to_regclass('gallery_migrations') AS "ledger"`.execute(
          db,
        ),
      ).resolves.toMatchObject({ rows: [{ split: null, ledger: null }] });
      await expect(bootStockImmich(db)).resolves.toEqual([]);

      // And back to Gallery once more.
      await bootGallery(db);
      await expect(expectSplit(db, before)).resolves.toBeGreaterThan(100);
    }));

  it('round-trips the fixture the revert validation workflow seeds into stock Immich', () =>
    withDatabase('migration_test_shared_people_fixture', async (db) => {
      await bootStockImmich(db);
      const fixture = readFileSync(join(repoRoot, '.github', 'scripts', 'revert-to-immich-shared-people.sql'), 'utf8');
      await sql.raw(fixture).execute(db);
      const before = await immichState(db);
      expect(before.shares).toHaveLength(6);

      await bootGallery(db);
      // 10 pooled groups with two or three owners, 5 shared groups with one recipient, one with a second.
      await expect(expectSplit(db, before)).resolves.toBe(15 + 6);
      await expect(bootStockImmich(db)).resolves.toEqual([]);
      await runRevertScript(db);
      await expect(immichState(db)).resolves.toEqual(before);
    }));

  it('keeps working on Gallery after the switch, and the revert still restores Immich', () =>
    withDatabase('migration_test_shared_people_use', async (db) => {
      await bootStockImmich(db);
      const { alice, bob, carol, pooled } = await seedImmich(db);
      await bootGallery(db);

      // Gallery's identity backfill, which runs after a switch, links every person, split or not.
      const identities = new FaceIdentityRepository(db as Kysely<DB>);
      let cursor: string | undefined;
      do {
        ({ nextCursor: cursor } = await identities.backfillPersonalIdentities({ cursor, limit: 50 }));
      } while (cursor);
      const people = await db.selectFrom('person').select(['personGroupId']).execute();
      await expect(db.selectFrom('person_identity').select('personGroupId').execute()).resolves.toHaveLength(
        people.length,
      );

      // Each user reads their own people through Gallery's service: every one resolves, belongs to them, and
      // counts the photos of theirs it is on.
      clearConfigCache();
      const { sut: personService, ctx } = newMediumService(PersonService, {
        database: db as Kysely<DB>,
        real: [
          AccessRepository,
          ConfigRepository,
          DatabaseRepository,
          FaceIdentityRepository,
          PersonRepository,
          UserRepository,
        ],
        mock: [JobRepository, LoggingRepository, StorageRepository, SystemMetadataRepository],
      });
      ctx.getMock(SystemMetadataRepository).get.mockResolvedValue(undefined as any);
      for (const ownerId of [alice, bob, carol]) {
        const auth = factory.auth({ user: { id: ownerId } });
        const own = await db.selectFrom('person').select('personGroupId').where('ownerId', '=', ownerId).execute();
        expect(own.length).toBeGreaterThan(50);
        for (const { personGroupId } of own) {
          await expect(personService.getById(auth, personGroupId)).resolves.toMatchObject({ id: personGroupId });
          const { assets } = await personService.getStatistics(auth, personGroupId);
          const expected = await db
            .selectFrom('asset_face')
            .innerJoin('asset', 'asset.id', 'asset_face.assetId')
            .select((eb) => eb.fn.count<number>('asset.id').distinct().as('count'))
            .where('asset_face.personGroupId', '=', personGroupId)
            .where('asset.ownerId', '=', ownerId)
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', '=', true)
            .executeTakeFirstOrThrow();
          expect(assets, personGroupId).toBe(Number(expected.count));
        }
        const { people: listed } = await personService.getAll(auth, { withHidden: true, page: 1, size: 1000 } as any);
        expect(new Set(listed.map(({ id }) => id)).size).toBe(listed.length);
        for (const { id } of listed) {
          expect(
            own.some(({ personGroupId }) => personGroupId === id),
            id,
          ).toBe(true);
        }
      }

      // Bob renames his copy of a person that was pooled with others, and merges another of his people into it.
      const split = await db
        .selectFrom('person_group_split')
        .selectAll()
        .where('ownerId', '=', bob)
        .where('originalGroupId', 'in', pooled)
        .orderBy('originalGroupId')
        .limit(2)
        .execute();
      const [renamed, merged] = split;
      await db
        .updateTable('person')
        .set({ name: 'Grandpa' })
        .where('ownerId', '=', bob)
        .where('personGroupId', '=', renamed.splitGroupId)
        .execute();
      const mergedFaces = await db
        .updateTable('asset_face')
        .set({ personGroupId: renamed.splitGroupId })
        .where('personGroupId', '=', merged.splitGroupId)
        .returning('id')
        .execute();
      await db
        .deleteFrom('person')
        .where('ownerId', '=', bob)
        .where('personGroupId', '=', merged.splitGroupId)
        .execute();
      await db.deleteFrom('person_group').where('id', '=', merged.splitGroupId).execute();

      await runRevertScript(db);
      await bootStockImmich(db);

      // Bob's renamed person is back in the group Immich made, with the faces he merged into it.
      await expect(
        db
          .selectFrom('person')
          .select('name')
          .where('ownerId', '=', bob)
          .where('personGroupId', '=', renamed.originalGroupId)
          .executeTakeFirst(),
      ).resolves.toEqual({ name: 'Grandpa' });
      if (mergedFaces.length > 0) {
        await expect(
          db
            .selectFrom('asset_face')
            .select('personGroupId')
            .where(
              'id',
              'in',
              mergedFaces.map(({ id }) => id),
            )
            .execute(),
        ).resolves.toEqual(mergedFaces.map(() => ({ personGroupId: renamed.originalGroupId })));
      }
      // The person he merged away stays gone; the others in that group are untouched.
      await expect(
        db
          .selectFrom('person')
          .select('ownerId')
          .where('personGroupId', '=', merged.originalGroupId)
          .where('ownerId', '=', bob)
          .execute(),
      ).resolves.toEqual([]);
      // No share points at a row that no longer exists.
      await expect(
        sql`
          SELECT count(*)::int AS "orphans" FROM "person_user" pu
          WHERE NOT EXISTS (SELECT FROM "person" p WHERE p."personGroupId" = pu."personGroupId" AND p."ownerId" = pu."sharedWithId")
        `.execute(db),
      ).resolves.toMatchObject({ rows: [{ orphans: 0 }] });
    }));
});
