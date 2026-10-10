import { Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import z from 'zod';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetVisibility, VectorIndex } from 'src/enum.js';
import { probes } from 'src/repositories/database.repository.js';
import { SearchEmbeddingOptions } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { anyUuid } from 'src/utils/database.js';
import { spaceAssetPathBranches, spaceVisibilityGate } from 'src/utils/shared-space-album-scope.js';

// Owner- or Space-scoped face KNN. Upstream's SearchRepository.searchFaces scopes by cluster group, which
// Gallery keeps inert.
export interface ScopedFaceEmbeddingSearch extends Omit<SearchEmbeddingOptions, 'userIds' | 'maxDistance'> {
  userIds?: string[];
  spaceId?: string;
  hasPerson?: boolean;
  numResults: number;
  maxDistance: number;
  minBirthDate?: Date | null;
  /**
   * Restricts candidate faces to assets whose visibility is in this set (Slice 1, F1/F2). Defaults to
   * undefined — no predicate — so the two recognition callers (person.service.ts:1436, :1485) and the
   * space-face-match caller (shared-space.service.ts:2063) emit byte-identical SQL to before this option
   * existed. Only the suggestion scans and the cleanup scan's KNN pass pass this.
   */
  visibility?: AssetVisibility[];
}

@Injectable()
export class FaceSearchRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql(
    {
      name: 'owner',
      params: [
        {
          userIds: [DummyValue.UUID],
          embedding: DummyValue.VECTOR,
          numResults: 10,
          maxDistance: 0.6,
        },
      ],
    },
    {
      name: 'space',
      params: [
        {
          spaceId: DummyValue.UUID,
          embedding: DummyValue.VECTOR,
          numResults: 10,
          maxDistance: 0.6,
          hasPerson: false,
        },
      ],
    },
    {
      name: 'owner-visibility',
      params: [
        {
          userIds: [DummyValue.UUID],
          embedding: DummyValue.VECTOR,
          numResults: 10,
          maxDistance: 0.6,
          visibility: [AssetVisibility.Archive, AssetVisibility.Timeline],
        },
      ],
    },
  )
  async searchFaces({
    userIds,
    spaceId,
    embedding,
    numResults,
    maxDistance,
    hasPerson,
    minBirthDate,
    visibility,
  }: ScopedFaceEmbeddingSearch) {
    if (!z.int().min(1).max(1000).safeParse(numResults).success) {
      throw new Error(`Invalid value for 'numResults': ${numResults}`);
    }

    if (spaceId && userIds?.length) {
      throw new Error('Cannot mix spaceId and userIds');
    }

    if (!spaceId && !userIds?.length) {
      throw new Error('searchFaces requires userIds for owner-scoped scans');
    }

    return await this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Face])}`.execute(trx);
      return await trx
        .with('cte', (qb) =>
          qb
            .selectFrom('asset_face')
            .innerJoin('asset', 'asset.id', 'asset_face.assetId')
            .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
            .select([
              'asset_face.id',
              'asset_face.personGroupId',
              sql<number>`face_search.embedding <=> ${embedding}`.as('distance'),
            ])
            .leftJoin('person', 'person.personGroupId', 'asset_face.personGroupId')
            .$if(!spaceId, (qb) => qb.where('asset.ownerId', '=', anyUuid(userIds!)))
            // Space scope: all THREE access paths (direct / linked library / linked album +
            // cross-owner contributions) via the canonical helper, plus the visibility gate so
            // another member's Hidden/Locked assets never surface as face candidates.
            .$if(!!spaceId, (qb) =>
              qb
                .where((eb) =>
                  eb.or(
                    spaceAssetPathBranches(eb, {
                      correlateAssetId: 'asset.id',
                      correlateLibraryId: 'asset.libraryId',
                      scope: { spaceId: spaceId! },
                      albumTimelineGate: 'none',
                    }),
                  ),
                )
                .where((eb) => spaceVisibilityGate(eb)),
            )
            .where('asset.deletedAt', 'is', null)
            // Slice 1 (F2): opt-in visibility gate for the owner-scoped branch. Defaults to undefined (no
            // predicate) so recognition (person.service.ts:1436, :1485) and space-face-match
            // (shared-space.service.ts:2063) keep emitting byte-identical SQL — only the suggestion scans
            // and the cleanup scan's KNN pass pass this.
            .$if(!!visibility?.length, (qb) => qb.where('asset.visibility', 'in', visibility!))
            // Exclude soft-deleted faces. The Face Cleanup "not a face" action tombstones a face by setting
            // asset_face.deletedAt (personId is also nulled), and every recognition/suggestion candidate must
            // honour that — otherwise the suggestion scan keeps proposing a crop an admin already declared not
            // a face, and recognition can re-home it. Previously only asset.deletedAt was filtered here.
            .where('asset_face.deletedAt', 'is', null)
            .$if(hasPerson === true, (qb) => qb.where('asset_face.personGroupId', 'is not', null))
            .$if(hasPerson === false, (qb) => qb.where('asset_face.personGroupId', 'is', null))
            .$if(!!minBirthDate, (qb) =>
              qb.where((eb) =>
                eb.not(
                  eb.exists(
                    eb
                      .selectFrom('person')
                      .select('person.personGroupId')
                      .whereRef('person.personGroupId', '=', 'asset_face.personGroupId')
                      .where('person.birthDate', '>', minBirthDate!),
                  ),
                ),
              ),
            )
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
