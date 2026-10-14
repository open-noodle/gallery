import { Kysely, sql } from 'kysely';
import { FileMigrationProvider, MigrationResult, MigrationResultSet, Migrator } from 'kysely/migration';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { immichVersion, serverVersion } from 'src/constants.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';

// Fork migrations are recorded in their own ledger so `kysely_migrations` only ever holds upstream
// names, which is what a stock Immich server expects to find there.
const GALLERY_MIGRATION_TABLE = 'gallery_migrations';

// Names recorded by earlier builds that have no file any more, mapped to the current name of the same
// migration, or to null when the row is simply dropped.
const renamedMigrations: Record<string, string | null> = {
  // Upstream re-timestamped this migration (immich-28191) after Gallery databases had recorded it.
  // The migration file also keeps a fork no-op guard for an already-integer column, as a fallback.
  '1776735180298-ChangeDurationToInteger': '1777667825574-ChangeDurationToInteger',
  // Fork migrations renumbered off timestamp collisions after RC/staging databases had recorded them.
  '1772810000000-AddThumbnailCropYToSharedSpace': '1772815000000-AddThumbnailCropYToSharedSpace',
  '1782000000000-AddFaceRepairScanFlaggedFace': '1781500000000-AddFaceRepairScanFlaggedFace',
  '1783000000000-AddFaceRepairScanInFlightIndex': '1783050000000-AddFaceRepairScanInFlightIndex',
  '1793000000000-ClearPreOptionMFaceRepairScans': '1793300000000-ClearPreOptionMFaceRepairScans',
  // Empty stub left behind when upstream's 1775165531374-AddPersonNameTrigramIndex replaced it.
  '1773846750001-AddPersonNameTrigramIndex': null,
};

const createGalleryMigrator = (db: Kysely<any>) =>
  new Migrator({
    db,
    migrationLockTableName: 'gallery_migrations_lock',
    // Fork migrations have been renumbered and back-dated, so their execution order is not name order.
    allowUnorderedMigrations: true,
    migrationTableName: GALLERY_MIGRATION_TABLE,
    provider: new FileMigrationProvider({
      fs: { readdir },
      path: { join },
      import: (filePath) => import(filePath),
      migrationFolder: join(import.meta.dirname, 'migrations-gallery'),
    }),
  });

/**
 * Brings a database written by any earlier build to the split layout: fork rows in
 * `gallery_migrations`, upstream rows in `kysely_migrations`, no row without a file. Idempotent.
 */
const bootstrapGalleryLedger = async (db: Kysely<any>, galleryNames: string[], upstreamNames: string[]) => {
  const counts = { renamed: 0, deleted: 0, moved: 0 };
  const { rows } = await sql<{ exists: boolean }>`
    SELECT to_regclass('kysely_migrations') IS NOT NULL AS "exists"
  `.execute(db);
  if (!rows[0].exists) {
    return counts;
  }

  await db.schema
    .createTable(GALLERY_MIGRATION_TABLE)
    .ifNotExists()
    .addColumn('name', 'varchar(255)', (col) => col.notNull().primaryKey())
    .addColumn('timestamp', 'varchar(255)', (col) => col.notNull())
    .execute();

  const recordedRows = await db.selectFrom('kysely_migrations').select('name').execute();
  const recorded = new Set(recordedRows.map(({ name }) => name as string));
  for (const [from, to] of Object.entries(renamedMigrations)) {
    if (!recorded.has(from)) {
      continue;
    }
    if (to && !recorded.has(to)) {
      // A stock migrator requires executed rows sorted by (timestamp, name) to match file order, so the
      // renamed row takes at least the newest timestamp of the upstream rows named before it (fork rows
      // leave this ledger below).
      await db
        .updateTable('kysely_migrations')
        .set({
          name: to,
          timestamp: sql`GREATEST("timestamp", (SELECT max("timestamp") FROM "kysely_migrations"
            WHERE "name" < ${to} AND "name" NOT IN (${sql.join(galleryNames)})))`,
        })
        .where('name', '=', from)
        .execute();
      recorded.add(to);
      counts.renamed++;
    } else {
      await db.deleteFrom('kysely_migrations').where('name', '=', from).execute();
      counts.deleted++;
    }
  }

  const forkRows = db.selectFrom('kysely_migrations').select(['name', 'timestamp']).where('name', 'in', galleryNames);
  await db
    .insertInto(GALLERY_MIGRATION_TABLE)
    .columns(['name', 'timestamp'])
    .expression(forkRows)
    .onConflict((oc) => oc.column('name').doNothing())
    .execute();
  const [moved] = await db.deleteFrom('kysely_migrations').where('name', 'in', galleryNames).execute();
  counts.moved = Number(moved.numDeletedRows);

  // Kysely would refuse these too, but only as "previously executed migration ... is missing".
  const upstreamFiles = new Set(upstreamNames);
  const unknown = recordedRows
    .map(({ name }) => name as string)
    .filter(
      (name) => !upstreamFiles.has(name) && !galleryNames.includes(name) && !Object.hasOwn(renamedMigrations, name),
    );
  if (unknown.length > 0) {
    throw new Error(
      `This database was migrated by a newer Immich release than Gallery ${serverVersion} is based on: ` +
        `migration "${unknown.toSorted()[0]}" is not part of it (or was renamed since). ` +
        `Gallery ${serverVersion} supports Immich databases up to migration "${upstreamNames.at(-1)}" (Immich ${immichVersion}). ` +
        `Restore the database backup taken before the newer Immich started, ` +
        `or wait for a Gallery release based on that Immich version. Nothing was changed.`,
    );
  }

  return counts;
};

const pendingNames = async (migrator: Migrator) => {
  const migrations = await migrator.getMigrations();
  return migrations.filter(({ executedAt }) => !executedAt).map(({ name }) => name);
};

const migrationNames = async (migrator: Migrator) => {
  const migrations = await migrator.getMigrations();
  return migrations.map(({ name }) => name);
};

/**
 * Bootstraps the ledgers, then runs every pending migration of both folders in one name order, each
 * recorded in its own ledger. A single order is load-bearing: an older Gallery database must drop its
 * fork foreign keys (1787100000000) before upstream's ClusterGroups (1787148183729) runs. Everything
 * runs in one transaction, so a failed boot leaves the database as it found it. Inside that transaction
 * the 1 h `lock_timeout` kysely sets for its migration lock also bounds every migration statement.
 */
export const migrateGalleryToLatest = async (
  db: Kysely<any>,
  createUpstreamMigrator: (db: Kysely<any>) => Migrator,
  logger: LoggingRepository,
): Promise<MigrationResultSet> => {
  const results: MigrationResult[] = [];
  let ledger = { renamed: 0, deleted: 0, moved: 0 };
  const collect = async (resultSet: Promise<MigrationResultSet>) => {
    const { error, results: step = [] } = await resultSet;
    results.push(...step);
    if (error) {
      throw error;
    }
  };

  try {
    await db.transaction().execute(async (trx) => {
      const upstream = createUpstreamMigrator(trx);
      const gallery = createGalleryMigrator(trx);
      ledger = await bootstrapGalleryLedger(trx, await migrationNames(gallery), await migrationNames(upstream));

      const owners = new Map<string, Migrator>();
      for (const migrator of [upstream, gallery]) {
        for (const name of await pendingNames(migrator)) {
          owners.set(name, migrator);
        }
      }
      // Each migrateUp runs that migrator's first pending migration, which is this name.
      for (const name of owners.keys().toArray().toSorted()) {
        await collect(owners.get(name)!.migrateUp());
      }
      // Nothing is left to run; these keep kysely's check that every recorded migration still has a file.
      await collect(upstream.migrateToLatest());
      await collect(gallery.migrateToLatest());
    });
  } catch (error) {
    return { error, results };
  }

  const { renamed, deleted, moved } = ledger;
  const message = `Migration ledgers: ${renamed} renamed, ${deleted} deleted, ${moved} moved to gallery_migrations`;
  // Non-zero only on the first boot of a database from before the ledger split.
  if (renamed + deleted + moved > 0) {
    logger.log(message);
  } else {
    logger.debug(message);
  }
  return { results };
};

/** Reverts the newest fork migration, or the newest upstream one once no fork migration is left. */
export const revertLastGalleryMigration = async (
  db: Kysely<any>,
  createUpstreamMigrator: (db: Kysely<any>) => Migrator,
): Promise<MigrationResultSet> => {
  const gallery = createGalleryMigrator(db);
  const galleryNames = await migrationNames(gallery);
  const upstreamNames = await migrationNames(createUpstreamMigrator(db));
  await db.transaction().execute((trx) => bootstrapGalleryLedger(trx, galleryNames, upstreamNames));
  const migrations = await gallery.getMigrations();
  const hasForkMigrations = migrations.some(({ executedAt }) => executedAt);
  return (hasForkMigrations ? gallery : createUpstreamMigrator(db)).migrateDown();
};
