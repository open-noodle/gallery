import { ExpressionBuilder, SelectQueryBuilder, sql } from 'kysely';
import { setTimeout as sleep } from 'node:timers/promises';
import { PostgresError } from 'postgres';
import { DB } from 'src/schema/index.js';
import { anyUuid } from 'src/utils/database.js';

export const uniqueTruthyIds = (ids: string[] = []) => [...new Set(ids.filter(Boolean))];

const STALE_ASSET_FOREIGN_KEY_CONSTRAINTS = new Set(['asset_file_assetId_fkey', 'asset_job_status_assetId_fkey']);

export const isStaleAssetForeignKeyConstraint = (error: unknown) => {
  const postgresError = error as PostgresError;
  return (
    postgresError?.code === '23503' &&
    postgresError.constraint_name !== undefined &&
    STALE_ASSET_FOREIGN_KEY_CONSTRAINTS.has(postgresError.constraint_name)
  );
};

const DEADLOCK_ERROR_CODE = '40P01';

export const isDeadlockError = (error: unknown) => (error as PostgresError)?.code === DEADLOCK_ERROR_CODE;

/**
 * Retry an operation that Postgres aborted as a deadlock victim (#864).
 *
 * Lock ordering alone cannot prevent every cycle here: deleting an asset makes Postgres lock
 * `shared_space_person` rows itself, to satisfy the `representativeFaceId` ON DELETE SET NULL
 * foreign key, and it takes those locks in face-deletion order. No application-level ordering can
 * join that sequence, so the losing transaction has to be re-driven instead.
 */
export const retryOnDeadlock = async <T>(
  operation: () => Promise<T>,
  options?: { attempts?: number; delayMs?: number },
): Promise<T> => {
  // 5, not 3: measured on the library-unmap repro at ~8.7k concurrent asset deletes, a budget of 3
  // still let one delete exhaust its attempts and lose the deletion.
  const attempts = options?.attempts ?? 5;
  const delayMs = options?.delayMs ?? 50;

  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isDeadlockError(error)) {
        throw error;
      }

      // Jittered backoff — concurrent victims that retry in lockstep just collide again.
      await sleep(delayMs * attempt + Math.random() * delayMs);
    }
  }
};

/**
 * Escape ILIKE wildcards so user-supplied filter text matches literally — e.g. a filename search for
 * "IMG_2024" must not treat "_" as a single-char wildcard, and "%" must not match everything. Pairs
 * with an `ESCAPE '\'` clause on the ILIKE. Backslash is escaped first so it does not double-escape
 * the wildcard escapes added afterwards. Used by both text-filter paths (the time-bucket queries in
 * gallery/utils/time-bucket-filter.ts and searchAssetBuilderLegacy below), which must agree: the map and the timeline
 * read the same filter chips.
 */
export const escapeLikePattern = (value: string): string =>
  value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('%', String.raw`\%`)
    .replaceAll('_', String.raw`\_`);

export function withAnyTagId<O>(qb: SelectQueryBuilder<DB, 'asset', O>, tagIds: string[]) {
  return qb.where((eb) =>
    eb.exists(
      eb
        .selectFrom('tag_closure')
        .innerJoin('tag_asset', 'tag_asset.tagId', 'tag_closure.id_descendant')
        .whereRef('tag_asset.assetId', '=', 'asset.id')
        .where('tag_closure.id_ancestor', '=', anyUuid(tagIds)),
    ),
  );
}

/** A pet face: has a pet embedding, or is assigned to a pet person. Pet faces share
 *  sourceType 'machine-learning' with human faces, so this predicate is the ONLY way
 *  human-pipeline queries can avoid destroying pet data (F1–F4). */
export const petFacePredicate = (eb: ExpressionBuilder<DB, 'asset_face'>) =>
  eb.or([
    eb.exists(
      eb
        .selectFrom('pet_search')
        .select(sql`1`.as('one'))
        .whereRef('pet_search.faceId', '=', 'asset_face.id'),
    ),
    eb.exists(
      eb
        .selectFrom('person')
        .innerJoin('person_pet', 'person_pet.personGroupId', 'person.personGroupId')
        .select(sql`1`.as('one'))
        .whereRef('person.personGroupId', '=', 'asset_face.personGroupId'),
    ),
  ]);
