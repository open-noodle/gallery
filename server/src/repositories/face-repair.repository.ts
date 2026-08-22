import { Kysely, sql, Transaction } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { SourceType } from 'src/enum';
import { PersonId } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { reviewableAssetVisibility } from 'src/utils/face-review';

export interface EligibleFaceRow {
  assetFaceId: string;
  personId: string;
  ownerId: string;
  embedding: string;
}

export interface OwnerPersonRow {
  id: string;
  name: string;
  faceCount: number;
  thumbnailFaceId: string | null;
}

export interface PersonMetadataRow {
  id: string;
  name: string;
  ownerId: string;
  faceCount: number;
  thumbnailFaceId: string | null;
}

export class FaceRepairRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  // Admin, owner-scoped people search for the move-to-chosen-person picker (Slice 4). Deliberately NOT
  // `PersonRepository.getAllForUser`: that method's HAVING clause excludes unnamed clusters below the
  // per-user `minimumFaces` preference and joins Timeline-visibility assets only — exactly the small/
  // in-progress clusters this admin picker must still surface. Named AND unnamed people alike, any face
  // count, paginated by a simple offset (admin-scale, not a hot path).
  async searchOwnerPeople(
    ownerId: string,
    options: { query?: string; page: number; size: number },
  ): Promise<{ people: OwnerPersonRow[]; total: number; hasMore: boolean }> {
    const trimmed = options.query?.trim();
    const escaped = trimmed
      ?.replaceAll('\\', String.raw`\\`)
      .replaceAll('%', String.raw`\%`)
      .replaceAll('_', String.raw`\_`);
    const namePattern = escaped ? `%${escaped}%` : undefined;

    const base = this.db
      .selectFrom('person')
      .where('person.ownerId', '=', ownerId)
      .$if(!!namePattern, (qb) => qb.where(() => sql`"person"."name" ILIKE ${namePattern} ESCAPE '\\'`));

    const { count } = await base.select((eb) => eb.fn.countAll().as('count')).executeTakeFirstOrThrow();
    const total = Number(count);

    const rows = await base
      .leftJoin('asset_face', (join) =>
        join
          .onRef('asset_face.personGroupId', '=', 'person.personGroupId')
          .on('asset_face.deletedAt', 'is', null)
          .on('asset_face.isVisible', '=', true),
      )
      .select(['person.personGroupId as id', 'person.name as name', 'person.faceAssetId as thumbnailFaceId'])
      .select((eb) => eb.fn.count('asset_face.id').as('faceCount'))
      .groupBy(['person.personGroupId'])
      .orderBy(sql`NULLIF(BTRIM(person.name), '') is null`, 'asc')
      .orderBy('person.name', 'asc')
      .orderBy('person.personGroupId', 'asc')
      .limit(options.size + 1)
      .offset(options.page * options.size)
      .execute();

    const hasMore = rows.length > options.size;
    const people = rows.slice(0, options.size).map((row) => ({
      id: row.id,
      name: row.name,
      faceCount: Number(row.faceCount),
      thumbnailFaceId: row.thumbnailFaceId,
    }));

    return { people, total, hasMore };
  }

  // Slice 3 (manual face review): the manual review page has no scan to read personName/ownerId off, and the
  // user-scoped GET /people/:id does not admin-bypass for a person the admin does not own. Reuses
  // searchOwnerPeople's exact join conditions (deletedAt is null, isVisible = true) so faceCount agrees between
  // the browser grid and this review-page header — a mismatch there would read as a bug. No `@GenerateSql`:
  // this repository has none.
  async getPersonMetadata(personId: string): Promise<PersonMetadataRow | undefined> {
    const row = await this.db
      .selectFrom('person')
      .leftJoin('asset_face', (join) =>
        join
          .onRef('asset_face.personGroupId', '=', 'person.personGroupId')
          .on('asset_face.deletedAt', 'is', null)
          .on('asset_face.isVisible', '=', true),
      )
      .select([
        'person.personGroupId as id',
        'person.name as name',
        'person.ownerId as ownerId',
        'person.faceAssetId as thumbnailFaceId',
      ])
      .select((eb) => eb.fn.count('asset_face.id').as('faceCount'))
      .where('person.personGroupId', '=', personId)
      .groupBy(['person.personGroupId'])
      .executeTakeFirst();

    return row && { ...row, faceCount: Number(row.faceCount) };
  }

  // Non-Timeline faces (e.g. Archive) are intentionally eligible: they may be left unassigned
  // after repair if recognition cannot re-home them, which is the accepted outcome (blank > wrong).
  streamEligibleFaces(options: { ownerId?: string; personId?: string; personIds?: string[] }) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select([
        'asset_face.id as assetFaceId',
        'asset_face.personGroupId as personId',
        'asset.ownerId as ownerId',
        sql<string>`face_search.embedding`.as('embedding'),
      ])
      .where('asset_face.personGroupId', 'is not', null)
      .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where((eb) => reviewableAssetVisibility(eb))
      .$if(!!options.ownerId, (qb) => qb.where('asset.ownerId', '=', options.ownerId!))
      .$if(!!options.personId, (qb) => qb.where('asset_face.personGroupId', '=', options.personId!))
      .$if(!!options.personIds && options.personIds.length > 0, (qb) =>
        qb.where('asset_face.personGroupId', 'in', options.personIds!),
      )
      .$narrowType<{ personId: string }>()
      .stream();
  }

  // Keyset-paginated page of eligible faces (id > afterId, ordered by id). Unlike streamEligibleFaces' cursor
  // this releases the pooled connection between pages, so a long full-library scan does not pin one of the pool's
  // connections — nor hold an open portal's MVCC snapshot on asset_face/asset/face_search — for its entire
  // multi-minute duration (B6: that snapshot blocks autovacuum from reclaiming dead tuples on three of the
  // hottest tables). Mirrors streamEligibleFaces' eligibility filter exactly.
  getEligibleFacePage(options: {
    ownerId?: string;
    personId?: string;
    personIds?: string[];
    afterId?: string;
    limit: number;
  }): Promise<EligibleFaceRow[]> {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select([
        'asset_face.id as assetFaceId',
        'asset_face.personGroupId as personId',
        'asset.ownerId as ownerId',
        sql<string>`face_search.embedding`.as('embedding'),
      ])
      .where('asset_face.personGroupId', 'is not', null)
      .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where((eb) => reviewableAssetVisibility(eb))
      .$if(!!options.ownerId, (qb) => qb.where('asset.ownerId', '=', options.ownerId!))
      .$if(!!options.personId, (qb) => qb.where('asset_face.personGroupId', '=', options.personId!))
      .$if(!!options.personIds && options.personIds.length > 0, (qb) =>
        qb.where('asset_face.personGroupId', 'in', options.personIds!),
      )
      .$if(!!options.afterId, (qb) => qb.where('asset_face.id', '>', options.afterId!))
      .orderBy('asset_face.id')
      .limit(options.limit)
      .$narrowType<{ personId: string }>()
      .execute();
  }

  async countEligibleFaces(options: { ownerId?: string; personId?: string }): Promise<number> {
    const { count } = await this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('asset_face.personGroupId', 'is not', null)
      .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where((eb) => reviewableAssetVisibility(eb))
      .$if(!!options.ownerId, (qb) => qb.where('asset.ownerId', '=', options.ownerId!))
      .$if(!!options.personId, (qb) => qb.where('asset_face.personGroupId', '=', options.personId!))
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  // Count ALL of a person's still-present faces — any source type, visible or hidden — not just the
  // ML+visible "eligible" set. Used as the delete gate for an emptied manual-move source (A2): countEligibleFaces
  // can read 0 while the person still holds hidden or Manual-sourced faces, and deleting it then orphans those
  // survivors (the FK's onDelete: SET NULL nulls their personId). Only a person with zero remaining faces is safe
  // to delete.
  async countAllFaces(personId: string): Promise<number> {
    const { count } = await this.db
      .selectFrom('asset_face')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('personGroupId', '=', personId)
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  // Paginated list of a person's eligible faces minus a caller-supplied exclude list (the already-shown
  // flagged ids). Mirrors streamEligibleFaces' filter exactly — including the face_search join — so `total`
  // and the returned page are precisely the set an entire-cluster move enumerates and moves. Ordered by
  // asset_face.id for a stable offset cursor.
  async getClusterFacePage(
    personId: string,
    options: { excludeFaceIds: string[]; limit: number; offset: number },
  ): Promise<{ faces: { assetFaceId: string }[]; total: number; hasMore: boolean }> {
    const base = this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .where('asset_face.personGroupId', '=', personId)
      .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where((eb) => reviewableAssetVisibility(eb))
      .$if(options.excludeFaceIds.length > 0, (qb) => qb.where('asset_face.id', 'not in', options.excludeFaceIds));

    const { count } = await base.select((eb) => eb.fn.countAll().as('count')).executeTakeFirstOrThrow();
    const total = Number(count);

    const rows = await base
      .select(['asset_face.id as assetFaceId'])
      .orderBy('asset_face.id')
      .limit(options.limit)
      .offset(options.offset)
      .execute();

    return {
      faces: rows.map((row) => ({ assetFaceId: row.assetFaceId })),
      total,
      hasMore: options.offset + rows.length < total,
    };
  }

  // Which of `faceIds` are currently eligible ON `personId`. Mirrors getClusterFacePage's predicate so
  // "lockable" is exactly "listed on the manual review page" — a third, subtly different eligibility
  // predicate would be a bug farm. Advisory only: the write-time guards in reattributeFaces/detachFaces
  // remain authoritative; this exists so a manual lock that cannot apply is an explicit 400 rather than
  // a silent no-op.
  async getEligibleFaceIdsForPerson(personId: string, faceIds: string[]): Promise<Set<string>> {
    if (faceIds.length === 0) {
      return new Set();
    }
    const rows = await this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select(['asset_face.id as assetFaceId'])
      .where('asset_face.id', 'in', faceIds)
      .where('asset_face.personGroupId', '=', personId)
      .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .where((eb) => reviewableAssetVisibility(eb))
      .execute();
    return new Set(rows.map((row) => row.assetFaceId));
  }

  // Re-attribute the given faces from `fromPersonId` to `toPersonId` ONLY if they are still assigned to
  // `fromPersonId` and machine-learning-sourced (eligibility re-check at write — a face moved by a concurrent
  // job since planning is skipped). Returns the ids actually moved (so the caller links identities for exactly
  // those). Writing the destination directly is what makes the move durable: recognition re-clusters an
  // unassigned face to its nearest neighbour, which for a contaminated cluster is the original wrong person.
  async reattributeFaces(
    fromPersonId: string,
    toPersonId: string,
    assetFaceIds: string[],
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<string[]> {
    if (assetFaceIds.length === 0) {
      return [];
    }
    // Chunk the IN-list so an entire-cluster move of a person with more than the Postgres bind-parameter limit
    // (65,535) faces doesn't blow up as one oversized statement (L3). Each chunk re-checks still-on-source.
    const movedIds: string[] = [];
    for (let index = 0; index < assetFaceIds.length; index += 1000) {
      const chunk = assetFaceIds.slice(index, index + 1000);
      const rows = await db
        .updateTable('asset_face')
        .set({ personGroupId: toPersonId })
        .where('id', 'in', chunk)
        .where('personGroupId', '=', fromPersonId)
        .where('sourceType', '=', sql.lit(SourceType.MachineLearning))
        .where('deletedAt', 'is', null)
        .where('isVisible', '=', true)
        .returning('id')
        .execute();
      for (const row of rows) {
        movedIds.push(row.id);
      }
    }
    return movedIds;
  }

  // Detach ("Not a face", Slice 5): retire the given faces from `personId` (same ML/visible/not-deleted
  // eligibility re-check as reattributeFaces, and the same still-on-source guard) AND strip their identity
  // link in the SAME chunk/transaction — never via FaceIdentityRepository.unlinkFaces, whose own `this.db`
  // would run outside a caller-supplied `trx` and break the pair's atomicity (a crash between the two writes
  // would leave a face still carrying `personId`'s identity, which a later FaceIdentityBackfill pass could
  // resolve right back onto it — the exact regression this pairing (E4) guards against). Returns the ids
  // actually detached, so the caller can regenerate the person's representative thumbnail for exactly those
  // (E19/M21).
  //
  // The write is `personId = NULL` AND `deletedAt = now()` — soft-delete, the same primitive the face editor's
  // own "delete face" uses (PersonRepository.softDeleteAssetFaces). Unassigning ALONE is not durable and was the
  // bug: PersonService.queueRecognizeFaces streams every `personId IS NULL` visible ML face back into the
  // FacialRecognition queue, which re-matches it by embedding and re-assigns it to whichever neighbour has a
  // person — for a crop that was mis-clustered INTO this person, that neighbour is very often this person again.
  // So a merely-unassigned "not a face" would silently boomerang back onto the cluster and re-flag on the next
  // scan, contradicting the console's own promise that a detached crop "stops being proposed for anyone".
  // `deletedAt` is what makes that promise true: every recognition-candidate query filters `deletedAt IS NULL`.
  async detachFaces(
    personId: string,
    assetFaceIds: string[],
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<string[]> {
    if (assetFaceIds.length === 0) {
      return [];
    }
    const detachedIds: string[] = [];
    // Chunk the IN-list for the same reason as reattributeFaces (L3): stay comfortably under the Postgres
    // bind-parameter limit for a person with a very large number of faces.
    for (let index = 0; index < assetFaceIds.length; index += 1000) {
      const chunk = assetFaceIds.slice(index, index + 1000);
      const rows = await db
        .updateTable('asset_face')
        .set({ personGroupId: null, deletedAt: new Date() })
        .where('id', 'in', chunk)
        .where('personGroupId', '=', personId)
        .where('sourceType', '=', sql.lit(SourceType.MachineLearning))
        .where('deletedAt', 'is', null)
        .where('isVisible', '=', true)
        .returning('id')
        .execute();
      const chunkDetachedIds = rows.map((row) => row.id);
      if (chunkDetachedIds.length > 0) {
        await db.deleteFrom('face_identity_face').where('assetFaceId', 'in', chunkDetachedIds).execute();
      }
      detachedIds.push(...chunkDetachedIds);
    }
    return detachedIds;
  }

  // Repoint any dangling representative face: if a person's faceAssetId no longer belongs to it (or is null),
  // reset it to any remaining assigned, visible, non-deleted face (or null if none remain). Returns the ids of
  // persons whose representative face actually changed so callers can regenerate their thumbnails — a fully
  // drained person whose faceAssetId was already NULL is excluded (the SET yields NULL again: a no-op that would
  // otherwise queue a wasted thumbnail regen for a faceless person — A3).
  async reconcileRepresentativeFaces(personIds: string[]): Promise<PersonId[]> {
    if (personIds.length === 0) {
      return [];
    }
    const updated = await this.db
      .updateTable('person')
      .set((eb) => ({
        faceAssetId: eb
          .selectFrom('asset_face as remaining')
          .innerJoin('asset', 'asset.id', 'remaining.assetId')
          .select('remaining.id')
          .whereRef('remaining.personGroupId', '=', 'person.personGroupId')
          .where('remaining.deletedAt', 'is', null)
          .where('remaining.isVisible', '=', true)
          .where('asset.deletedAt', 'is', null)
          .limit(1),
      }))
      .where('person.personGroupId', 'in', personIds)
      .where((eb) =>
        eb.or([
          eb('person.faceAssetId', 'is', null),
          eb.not(
            eb.exists(
              eb
                .selectFrom('asset_face as current')
                .select(sql`1`.as('one'))
                .whereRef('current.id', '=', 'person.faceAssetId')
                .whereRef('current.personGroupId', '=', 'person.personGroupId'),
            ),
          ),
        ]),
      )
      // Skip the null→null no-op: an already-null faceAssetId with no remaining face doesn't change, so it
      // must not be returned (no thumbnail to regenerate). Keep it only if it has a stale (non-null) pointer to
      // clear, or a remaining face to repoint to.
      .where((eb) =>
        eb.or([
          eb('person.faceAssetId', 'is not', null),
          eb.exists(
            eb
              .selectFrom('asset_face as candidate')
              .innerJoin('asset', 'asset.id', 'candidate.assetId')
              .select(sql`1`.as('one'))
              .whereRef('candidate.personGroupId', '=', 'person.personGroupId')
              .where('candidate.deletedAt', 'is', null)
              .where('candidate.isVisible', '=', true)
              .where('asset.deletedAt', 'is', null),
          ),
        ]),
      )
      .returning(['person.ownerId', 'person.personGroupId'])
      .execute();
    return updated.map(({ ownerId, personGroupId }) => ({ ownerId, personGroupId }));
  }
}
