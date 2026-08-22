import { Kysely, sql } from 'kysely';

/**
 * Fork migrations run in two different orders relative to upstream's `1787148183729-ClusterGroups`,
 * and several of them care which one they got.
 *
 * On a **fresh install** the composite migration provider interleaves both sets by timestamp, so every
 * fork migration numbered below 1787148183729 runs first and sees the pre-#30739 schema: `person.id`
 * exists and the face column is `asset_face.personId`.
 *
 * On an **Immich-to-Gallery switch** the database already has every upstream migration applied,
 * including ClusterGroups, before a single fork migration runs. `person.id` is gone, the primary key
 * is `(ownerId, personGroupId)`, and the face column is already `asset_face.personGroupId`. The fork
 * migrations then apply in their own timestamp order on top of that — so the ones written against the
 * old shape now run *after* the change they were written to precede.
 *
 * `DatabaseRepository.createMigrator()` sets `allowUnorderedMigrations: true` precisely to support the
 * second path, which is what makes this possible. These helpers let the affected migrations ask which
 * world they are in rather than assuming, and are covered end-to-end by
 * `test/medium/specs/services/database-migration.service.spec.ts`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Kysely<any>;

const columnExists = async (db: AnyDb, table: string, column: string): Promise<boolean> => {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}
    ) AS "exists"
  `.execute(db);
  return result.rows[0]?.exists === true;
};

/**
 * True once upstream's ClusterGroups migration has run: `person.id` is gone, and the thing a fork
 * face-review key must reference is `person_group.id`.
 */
export const clusterGroupsApplied = (db: AnyDb): Promise<boolean> => columnExists(db, 'person', 'personGroupId');

/** The table a fork face-review column should reference, for the schema currently in the database. */
export const personKeyTarget = async (db: AnyDb): Promise<'person_group' | 'person'> =>
  (await clusterGroupsApplied(db)) ? 'person_group' : 'person';

/** The name `asset_face`'s person key currently has. */
export const assetFacePersonColumn = async (db: AnyDb): Promise<'personGroupId' | 'personId'> =>
  (await columnExists(db, 'asset_face', 'personId')) ? 'personId' : 'personGroupId';
