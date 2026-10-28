import { Injectable } from '@nestjs/common';
import { type ExpressionBuilder, type Insertable, type Kysely, type Transaction, sql } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import z from 'zod';
import type { PetSearchTable } from 'src/schema/tables/pet-search.table.js';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetFileType, AssetVisibility, VectorIndex } from 'src/enum.js';
import { personIdentityId, personSidecarColumns } from 'src/gallery/utils/person-sidecar.js';
import { probes } from 'src/repositories/database.repository.js';
import { SearchEmbeddingOptions } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table.js';
import { anyUuid, withFilePath } from 'src/utils/database.js';

// Pet equivalent of FaceEmbeddingSearch, scoped to pet_search instead of face_search. Deliberately
// drops `minBirthDate` — a person's birthdate has no pet analogue, so the filter is meaningless here.
export interface PetEmbeddingSearch extends SearchEmbeddingOptions {
  hasPerson?: boolean;
  numResults: number;
  maxDistance: number;
  /**
   * Required here, unlike the optional base: pet recognition has no album- or space-scoped caller,
   * so every `searchPets` scan is owner-scoped and the `asset.ownerId` predicate below is
   * unconditional. (`FaceSearchRepository.searchFaces` can drop it because a space scope replaces it.)
   */
  userIds: string[];
}

export interface PetSearchResult {
  distance: number;
  id: string;
  personId: string | null;
}

const withPetSearch = (eb: ExpressionBuilder<DB, 'asset_face'>) => {
  return jsonObjectFrom(
    eb.selectFrom('pet_search').selectAll('pet_search').whereRef('pet_search.faceId', '=', 'asset_face.id'),
  ).as('petSearch');
};

/**
 * Every embedded pet face: unassigned (recognition-written, not yet clustered) faces are invisible
 * to a person-scoped delete — the `pet_search` join is the only thing that identifies them. Shared
 * by {@link PetFaceRepository.deleteAllPets} (full purge) and
 * {@link PetFaceRepository.purgePetRecognitionArtifacts} (scoped purge) as their first statement:
 * both need this same delete, and it must run before anything that would remove the `pet_search`
 * rows it joins against (F5).
 */
const deleteEmbeddedPetFaces = (trx: Transaction<DB>) =>
  trx
    .deleteFrom('asset_face')
    .where('asset_face.id', 'in', (eb) => eb.selectFrom('pet_search').select('pet_search.faceId'))
    .execute();

@Injectable()
export class PetFaceRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async deleteAllPets(): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      // Unassigned pet faces (recognition-written, not yet clustered) are invisible to the
      // person-scoped delete below — the pet_search join is the only thing that identifies
      // them. Delete them first, while their pet_search rows still exist: the force purge
      // calls deleteAllPetSearch() afterwards, and truncating first would orphan these rows
      // forever.
      await deleteEmbeddedPetFaces(trx);

      // Delete pet faces before the pet people they belong to: asset_face.personId is
      // ON DELETE SET NULL, so removing the people first would orphan (not delete) the faces.
      await trx
        .deleteFrom('asset_face')
        .where('asset_face.personGroupId', 'in', (eb) => eb.selectFrom('person_pet').select('person_pet.personGroupId'))
        .execute();

      await trx
        .deleteFrom('person')
        .where('person.personGroupId', 'in', (eb) => eb.selectFrom('person_pet').select('person_pet.personGroupId'))
        .execute();
      await trx.deleteFrom('person_pet').execute();
    });
  }

  /**
   * Truncates `pet_search` outright, independent of `deleteAllPets()`'s delete order. Used by
   * {@link PetRecognitionService.handleQueuePetRecognition}'s force purge (enabling recognition or
   * switching model) as the explicit, order-independent guarantee that no stale embedding survives
   * — `deleteAllPets()` already removes most rows via the `asset_face` CASCADE, but a truncate
   * doesn't depend on that cascade to have run first or completely. A no-op (not an error) when the
   * table is already empty.
   */
  async deleteAllPetSearch(): Promise<void> {
    await sql`truncate ${sql.table('pet_search')}`.execute(this.db);
  }

  /**
   * The SCOPED purge used by {@link PetRecognitionService}'s model-switch handler. Unlike
   * {@link deleteAllPets} (the FULL purge behind the admin Reset button, which also wipes species
   * buckets — the requeue rebuilds them, and the confirmation dialog promises exactly that), a
   * model switch invalidates only embeddings and the individuals recognition created from them.
   * Species buckets are pure detector output, are not model-coupled, and must survive every switch.
   */
  async purgePetRecognitionArtifacts(): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      // 1. Every embedded pet face. Bucket faces have no pet_search row, so they are untouched.
      await deleteEmbeddedPetFaces(trx);

      // 2. Pet people left with zero faces are exactly the recognition-created individuals — a
      //    species bucket still holds its (embedding-less) faces after step 1.
      const orphaned = await trx
        .selectFrom('person')
        .innerJoin('person_pet', 'person_pet.personGroupId', 'person.personGroupId')
        .select(['person.personGroupId', personIdentityId().as('identityId')])
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('asset_face')
                .select(sql`1`.as('one'))
                .whereRef('asset_face.personGroupId', '=', 'person.personGroupId'),
            ),
          ),
        )
        .execute();

      if (orphaned.length > 0) {
        const identityIds = orphaned.map((row) => row.identityId).filter((id): id is string => !!id);
        if (identityIds.length > 0) {
          await trx.deleteFrom('shared_space_person').where('identityId', 'in', identityIds).execute();
        }
        await trx
          .deleteFrom('person')
          .where(
            'person.personGroupId',
            'in',
            orphaned.map((row) => row.personGroupId),
          )
          .execute();
      }

      // 3. Belt and braces: step 1 already cascaded these away.
      await sql`truncate ${sql.table('pet_search')}`.execute(trx);
    });
  }

  /**
   * Pet-recognition equivalent of {@link PersonRepository.getAllFaces}'s `{ personGroupId: null }` case, used by
   * {@link PetRecognitionService.handleQueuePetRecognition}'s non-force fan-out: every pet face that
   * has been embedded (has a `pet_search` row) but not yet assigned to a person. The inner join on
   * `pet_search` is the "has an embedding" filter — a face detected before recognition was enabled
   * has no `pet_search` row and is deliberately excluded (it gets one the next time detection runs).
   */
  getUnassignedPetFaces() {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('pet_search', 'pet_search.faceId', 'asset_face.id')
      .select(['asset_face.id'])
      .where('asset_face.personGroupId', 'is', null)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .stream();
  }

  /**
   * Pet-recognition equivalent of {@link PersonRepository.getFaceForFacialRecognitionJob}: face + owning asset +
   * `pet_search` embedding for {@link PetRecognitionService.handlePetRecognition}. Pets have no
   * birthdate/visibility gating (see `PetEmbeddingSearch`), so the asset selection is narrower —
   * just `ownerId`.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  getPetFaceForRecognition(id: string) {
    return this.db
      .selectFrom('asset_face')
      .select(['asset_face.id', 'asset_face.assetId', 'asset_face.personGroupId'])
      .select((eb) =>
        jsonObjectFrom(
          eb.selectFrom('asset').select(['asset.ownerId']).whereRef('asset.id', '=', 'asset_face.assetId'),
        ).as('asset'),
      )
      .select(withPetSearch)
      .where('asset_face.id', '=', id)
      .where('asset_face.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  /**
   * Pet-recognition equivalent of {@link PersonRepository.refreshFaces}, simplified: pets have no "remove stale
   * faces" step here (that lives in the detection pipeline, not recognition).
   *
   * Like `refreshFaces`, the caller pre-generates each face's id (`CryptoRepository.randomUUID`)
   * and pairs embeddings to faces by explicit `faceId`. The previous version let the DB generate
   * ids and paired `embeddingsToAdd[i]` with the i-th `INSERT … RETURNING` row, which is only
   * correct while postgres happens to return insert order (F7) — nothing in the SQL standard or
   * Kysely guarantees it, and a mispairing silently attaches one pet's embedding to another pet's
   * face.
   *
   * Every face must have exactly one embedding: callers route embedding-less pets to the species
   * bucket instead, so a mismatch here is a broken contract and throws rather than writing a
   * partially-embedded batch.
   */
  @GenerateSql({
    params: [
      [{ id: DummyValue.UUID, assetId: DummyValue.UUID }],
      [{ faceId: DummyValue.UUID, embedding: DummyValue.VECTOR, species: 'dog' }],
    ],
  })
  async refreshPetFaces(
    facesToAdd: (Insertable<AssetFaceTable> & { id: string; assetId: string })[],
    embeddingsToAdd: { faceId: string; embedding: string; species: string | null }[],
  ): Promise<void> {
    if (facesToAdd.length !== embeddingsToAdd.length) {
      throw new Error(
        `refreshPetFaces requires one embedding per face, got ${facesToAdd.length} faces and ${embeddingsToAdd.length} embeddings`,
      );
    }

    const faceIds = new Set(facesToAdd.map(({ id }) => id));
    for (const { faceId } of embeddingsToAdd) {
      if (!faceIds.has(faceId)) {
        throw new Error(`refreshPetFaces got an embedding for unknown face ${faceId}`);
      }
    }

    if (facesToAdd.length === 0) {
      return;
    }

    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('asset_face').values(facesToAdd).execute();

      const embeddingRows: Insertable<PetSearchTable>[] = embeddingsToAdd.map(({ faceId, embedding, species }) => ({
        faceId,
        embedding,
        species,
      }));
      await trx.insertInto('pet_search').values(embeddingRows).execute();
    });
  }

  /**
   * Pet-recognition equivalent of {@link PersonRepository.getLatestFaceDate}, used by the nightly
   * `handleQueuePetRecognition` skip check: pets have no `personsAssignedAt`-style column, so
   * `petsDetectedAt` (stamped by `handlePetDetection`) is the closest analogue of "a pet was added
   * since the last nightly run". Unlike the sibling, this returns the `Date` directly rather than
   * pg-text (F11) — `state.lastRun` is an ISO string with a `T` separator, and comparing it against
   * pg's `::text` timestamp format (space-separated) mis-ordered same-day timestamps. The service
   * compares two `Date`s instead.
   */
  async getLatestPetDate(): Promise<Date | undefined> {
    const result = await this.db
      .selectFrom('asset_job_status_gallery')
      .select((eb) => eb.fn.max('asset_job_status_gallery.petsDetectedAt').as('latestDate'))
      .executeTakeFirst();

    return result?.latestDate ?? undefined;
  }

  async setPetsDetectedAt(assetId: string): Promise<void> {
    const petsDetectedAt = new Date();
    await this.db
      .insertInto('asset_job_status_gallery')
      .columns(['assetId', 'petsDetectedAt'])
      // insert-select: an asset deleted mid-job inserts nothing instead of failing the FK
      .expression((eb) =>
        eb
          .selectFrom('asset')
          .select((s) => [s.ref('asset.id').as('assetId'), s.val(petsDetectedAt).as('petsDetectedAt')])
          .where('asset.id', '=', assetId),
      )
      .onConflict((oc) => oc.column('assetId').doUpdateSet({ petsDetectedAt }))
      .execute();
  }

  getByOwnerAndSpecies(ownerId: string, species: string) {
    return this.db
      .selectFrom('person')
      .selectAll('person')
      .select(personSidecarColumns())
      .innerJoin('person_pet', 'person_pet.personGroupId', 'person.personGroupId')
      .where('person.ownerId', '=', ownerId)
      .where('person_pet.species', '=', species)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForPetDetection(id: string) {
    return this.db
      .selectFrom('asset')
      .select((eb) => ['asset.ownerId', 'asset.visibility', withFilePath(eb, AssetFileType.Preview).as('previewFile')])
      .where('asset.id', '=', id)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [], stream: true })
  streamForPetDetectionJob(force?: boolean) {
    return this.db
      .selectFrom('asset')
      .select(['asset.id'])
      .$if(!force, (qb) =>
        qb
          .innerJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
          .leftJoin('asset_job_status_gallery', 'asset_job_status_gallery.assetId', 'asset.id')
          .where('asset_job_status_gallery.petsDetectedAt', 'is', null),
      )
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '!=', AssetVisibility.Hidden)
      .stream();
  }

  // Copy of FaceSearchRepository.searchFaces scoped to pet_search instead of face_search — see the isolation
  // decision in PetEmbeddingSearch's comment. No `person` join / `minBirthDate` filter: pets have
  // no birthdate concept, and hasPerson only needs asset_face.personId, already on the base table.
  @GenerateSql({
    params: [
      {
        userIds: [DummyValue.UUID],
        embedding: DummyValue.VECTOR,
        numResults: 10,
        maxDistance: 0.6,
      },
    ],
  })
  searchPets({ userIds, embedding, numResults, maxDistance, hasPerson }: PetEmbeddingSearch) {
    if (!z.int().min(1).max(1000).safeParse(numResults).success) {
      throw new Error(`Invalid value for 'numResults': ${numResults}`);
    }

    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Pet])}`.execute(trx);
      return await trx
        .with('cte', (qb) =>
          qb
            .selectFrom('asset_face')
            .select([
              'asset_face.id',
              'asset_face.personGroupId',
              sql<number>`pet_search.embedding <=> ${embedding}`.as('distance'),
            ])
            .innerJoin('asset', 'asset.id', 'asset_face.assetId')
            .innerJoin('pet_search', 'pet_search.faceId', 'asset_face.id')
            .where('asset.ownerId', '=', anyUuid(userIds))
            .where('asset.deletedAt', 'is', null)
            .$if(!!hasPerson, (qb) => qb.where('asset_face.personGroupId', 'is not', null))
            .orderBy('distance')
            .limit(numResults),
        )
        .selectFrom('cte')
        .selectAll()
        .where('cte.distance', '<=', maxDistance)
        .execute();
    });
  }
}
