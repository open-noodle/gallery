import { Injectable } from '@nestjs/common';
import { type ExpressionBuilder, type Insertable, type Kysely, type Transaction, type Updateable, sql } from 'kysely';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { AssetFace } from 'src/database.js';
import { Chunked, ChunkedArray, DummyValue, GenerateSql } from 'src/decorators.js';
import { PersonUserRole } from 'src/dtos/person.dto.js';
import { AssetFileType, AssetVisibility, SourceType, UserMetadataKey } from 'src/enum.js';
import {
  PersonSidecarFields,
  personIsPet,
  personSidecarColumns,
  personType,
  writePersonSidecars,
} from 'src/gallery/utils/person-sidecar.js';
import { type YearMonthDay } from 'src/repositories/asset.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table.js';
import { FaceSearchTable } from 'src/schema/tables/face-search.table.js';
import { PersonGroupTable } from 'src/schema/tables/person-group.table.js';
import { PersonTable } from 'src/schema/tables/person.table.js';
import {
  asUuid,
  dummy,
  inSharedAlbum,
  petFacePredicate,
  removeUndefinedKeys,
  withFilePath,
} from 'src/utils/database.js';
import { isLeapDayObserved } from 'src/utils/date.js';
import { type PaginationOptions, paginationHelper } from 'src/utils/pagination.js';
import { spaceAssetPathBranches } from 'src/utils/shared-space-album-scope.js';

export interface PersonSearchOptions {
  withHidden: boolean;
  closestFaceAssetId?: string;
  /** People-page type filter: 'person' or 'pet'. Undefined returns both. */
  type?: string;
  isFavorite?: boolean;
  isHidden?: boolean;
  name?: string;
}

export interface PersonNameSearchOptions {
  withHidden?: boolean;
  /**
   * Fork (#869 follow-up): mirrors `AccessRepository.asset.checkOwnerAccess` — without an elevated
   * session the caller must not see anything that only exists inside their Locked Folder.
   */
  hasElevatedPermission?: boolean;
}

export interface PersonNameResponse {
  personGroupId: string;
  name: string;
}

export interface AssetFaceId {
  assetId: string;
  personGroupId: string;
}

export interface UpdateFacesData {
  oldPersonGroupId?: string;
  faceIds?: string[];
  ownerId?: string;
  newPersonGroupId: string;
}

export interface PersonStatistics {
  assets: number;
  faces: number;
}

export interface PeopleFaceStatisticsOptions {
  minimumFaceCount?: number;
  /** People-page type filter: 'person' or 'pet'. Undefined counts both. */
  type?: string;
}

/**
 * Correlated "does this `person` row have a live, visible face on a locked (or non-locked) asset?"
 * subquery. Only counts faces that are themselves live and visible, so a person left behind by a
 * deleted or hidden face is not treated as backed by that face's asset.
 */
const visibleFaceOnAsset = (eb: ExpressionBuilder<DB, 'person'>, { locked }: { locked: boolean }) =>
  eb
    .selectFrom('asset_face')
    .innerJoin('asset', 'asset.id', 'asset_face.assetId')
    .select('asset_face.id')
    .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
    .where('asset_face.deletedAt', 'is', null)
    .where('asset_face.isVisible', 'is', true)
    .where('asset.visibility', locked ? '=' : '!=', AssetVisibility.Locked);

export interface DeleteFacesOptions {
  sourceType: SourceType;
  /**
   * Human-pipeline callers set this so pet faces survive their resets. Pet faces share
   * `sourceType: 'machine-learning'` with human faces, so a plain sourceType filter reaches them
   * (F1/F3) — {@link petFacePredicate} is the only thing that tells the two apart.
   */
  excludePetFaces?: boolean;
}

export interface GetAllPeopleOptions {
  ownerId?: string;
  thumbnailPath?: string;
  faceAssetId?: string | null;
  isHidden?: boolean;
}

export interface GetAllFacesOptions {
  personGroupId?: string | null;
  assetId?: string;
  sourceType?: SourceType;
  clusterGroupId?: string;
  /**
   * Slice 5 (F9): recognition must never re-claim a face a human has already placed. Space-person
   * confirms never write `asset_face.personId` (space people are a projection over personal people),
   * so the `personId: null` filter alone does not exclude a confirmed-but-still-unassigned face — the
   * durable record is the `face_identity_face` row with `source='manual'` instead. When set, excludes
   * any face carrying one. Default off, so the force-recognition branch (which has already wiped every
   * `face_identity_face` row via `unassignFaces` before this runs) and every other caller are unchanged.
   */
  excludeManuallyPlaced?: boolean;
  /** See {@link DeleteFacesOptions.excludePetFaces} — keeps pet faces out of human fan-outs (F2). */
  excludePetFaces?: boolean;
}

export type UnassignFacesOptions = DeleteFacesOptions & { clusterGroupId?: string };

export type GetFacesOptions = WithPersonOptions & { isVisible?: boolean };

/** a person is identified by its owner and the group it belongs to */
export type PersonId = { ownerId: string; personGroupId: string };

export type ReassignCluster = { userId: string; newClusterId: string };

export type WithPersonOptions = {
  /** whose version of the person to select */
  viewingUserId: string;
};

/**
 * Upstream filters this join to `person.ownerId = viewingUserId` — with cluster groups on, every member
 * of a group has their own person row and the viewer wants theirs. Option M keeps groups 1:1, so the
 * only row is the OWNER's, and that filter returns nothing for every non-owner: a shared-album
 * recipient or Space member would see `person: null` on a face they are allowed to see, and a hidden
 * person would stop being filtered out because there is no person row left to read `isHidden` from.
 *
 * So prefer the viewer's own row and fall back to the group's. Under M that always resolves to the
 * owner's single row; if cluster groups are ever turned on it degrades back to upstream's behaviour.
 */
const withPerson = ({ viewingUserId }: WithPersonOptions) => {
  return (eb: ExpressionBuilder<DB, 'asset_face'>) =>
    jsonObjectFrom(
      eb
        .selectFrom('person')
        .selectAll('person')
        .select(personSidecarColumns())
        .whereRef('person.personGroupId', '=', 'asset_face.personGroupId')
        .orderBy(sql`case when "person"."ownerId" = ${viewingUserId} then 0 else 1 end`)
        .limit(1),
    ).as('person');
};

const withFaceSearch = (eb: ExpressionBuilder<DB, 'asset_face'>) => {
  return jsonObjectFrom(
    eb.selectFrom('face_search').selectAll('face_search').whereRef('face_search.faceId', '=', 'asset_face.id'),
  ).as('faceSearch');
};

@Injectable()
export class PersonRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [{ oldPersonGroupId: DummyValue.UUID, newPersonGroupId: DummyValue.UUID }] })
  async reassignFaces(
    { oldPersonGroupId, faceIds, ownerId, newPersonGroupId }: UpdateFacesData,
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<number> {
    const result = await db
      .updateTable('asset_face')
      .from('asset')
      .whereRef('asset_face.assetId', '=', 'asset.id')
      .set({ personGroupId: newPersonGroupId })
      .$if(!!oldPersonGroupId, (qb) => qb.where('asset_face.personGroupId', '=', oldPersonGroupId!))
      .$if(!!faceIds, (qb) => qb.where('asset_face.id', 'in', faceIds!))
      .$if(!!ownerId, (qb) => qb.where('asset.ownerId', '=', ownerId!))
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0);
  }

  @GenerateSql({ params: [{ sourceType: SourceType.MachineLearning, clusterGroupId: DummyValue.UUID }] })
  async unassignFaces({ sourceType, clusterGroupId, excludePetFaces }: UnassignFacesOptions): Promise<void> {
    // "Reset all people" bulk-nulls personId across the whole library. It must also clear the human-placement
    // record (face_identity_face.source='manual'); otherwise every previously-confirmed face keeps a stale
    // manual link with no person behind it, and both face engines would treat those unassigned faces as
    // settled forever — permanently excluding them from recognition and suggestions after a reset.
    // `excludePetFaces` scopes it the same way the personId reset below is scoped: a human reset must
    // leave pet faces, and their manual links, alone (F2).
    await this.db
      .deleteFrom('face_identity_face')
      .where('assetFaceId', 'in', (eb) =>
        eb
          .selectFrom('asset_face')
          .select('id')
          .where('asset_face.sourceType', '=', sourceType)
          .$if(!!excludePetFaces, (qb) => qb.where((inner) => inner.not(petFacePredicate(inner)))),
      )
      .execute();
    await this.db
      .updateTable('asset_face')
      .set({ personGroupId: null })
      .from('asset')
      .whereRef('asset_face.assetId', '=', 'asset.id')
      .where('asset_face.sourceType', '=', sourceType)
      .$if(!!clusterGroupId, (qb) =>
        qb.innerJoin('user', 'user.id', 'asset.ownerId').where('user.clusterGroupId', '=', clusterGroupId!),
      )
      .$if(!!excludePetFaces, (qb) => qb.where((eb) => eb.not(petFacePredicate(eb))))
      .execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.UUID] })
  @Chunked()
  async delete(personGroupIds: string[], ownerId?: string) {
    if (personGroupIds.length === 0) {
      return [];
    }

    return this.db
      .deleteFrom('person')
      .$if(!!ownerId, (qb) => qb.where('ownerId', '=', ownerId!))
      .where('person.personGroupId', 'in', personGroupIds)
      .returning(['personGroupId', 'ownerId', 'thumbnailPath'])
      .execute();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  @Chunked()
  async deleteGroups(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.db.deleteFrom('person_group').where('person_group.id', 'in', ids).execute();
  }

  @GenerateSql()
  async deleteEmptyGroups(): Promise<number> {
    const result = await this.db
      .deleteFrom('person_group')
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('person')
              .whereRef('person.personGroupId', '=', 'person_group.id')
              .select('person.personGroupId'),
          ),
        ),
      )
      .executeTakeFirst();

    return Number(result.numDeletedRows);
  }

  @GenerateSql()
  async deleteOrphanedClusterGroups(): Promise<number> {
    const result = await this.db
      .deleteFrom('cluster_group')
      .where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom('user').whereRef('user.clusterGroupId', '=', 'cluster_group.id').select('user.id'))),
      )
      .executeTakeFirst();

    return Number(result.numDeletedRows);
  }

  async deleteFaces({ sourceType, excludePetFaces }: DeleteFacesOptions): Promise<void> {
    await this.db
      .deleteFrom('asset_face')
      .where('asset_face.sourceType', '=', sourceType)
      .$if(!!excludePetFaces, (qb) => qb.where((eb) => eb.not(petFacePredicate(eb))))
      .execute();
  }

  @GenerateSql({
    params: [{ personGroupId: null, sourceType: SourceType.MachineLearning, clusterGroupId: DummyValue.UUID }],
    stream: true,
  })
  getAllFaces(options: GetAllFacesOptions = {}) {
    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .$if(options.personGroupId === null, (qb) => qb.where('asset_face.personGroupId', 'is', null))
      .$if(!!options.personGroupId, (qb) => qb.where('asset_face.personGroupId', '=', options.personGroupId!))
      .$if(!!options.sourceType, (qb) => qb.where('asset_face.sourceType', '=', options.sourceType!))
      .$if(!!options.assetId, (qb) => qb.where('asset_face.assetId', '=', options.assetId!))
      .$if(!!options.clusterGroupId, (qb) =>
        qb
          .innerJoin('asset', 'asset.id', 'asset_face.assetId')
          .innerJoin('user', 'user.id', 'asset.ownerId')
          .where('user.clusterGroupId', '=', options.clusterGroupId!),
      )
      .$if(!!options.excludeManuallyPlaced, (qb) =>
        qb.where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('face_identity_face')
                .select('face_identity_face.assetFaceId')
                .whereRef('face_identity_face.assetFaceId', '=', 'asset_face.id')
                .where('face_identity_face.source', '=', 'manual'),
            ),
          ),
        ),
      )
      .$if(!!options.excludePetFaces, (qb) => qb.where((eb) => eb.not(petFacePredicate(eb))))
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .stream();
  }

  getAll(options: GetAllPeopleOptions = {}) {
    return this.db
      .selectFrom('person')
      .selectAll('person')
      .select(personSidecarColumns())
      .$if(!!options.ownerId, (qb) => qb.where('person.ownerId', '=', options.ownerId!))
      .$if(options.thumbnailPath !== undefined, (qb) => qb.where('person.thumbnailPath', '=', options.thumbnailPath!))
      .$if(options.faceAssetId === null, (qb) => qb.where('person.faceAssetId', 'is', null))
      .$if(!!options.faceAssetId, (qb) => qb.where('person.faceAssetId', '=', options.faceAssetId!))
      .$if(options.isHidden !== undefined, (qb) => qb.where('person.isHidden', '=', options.isHidden!))
      .stream();
  }

  @GenerateSql(
    { params: [DummyValue.UUID, { year: 2025, month: 1, day: 1 }] },
    { name: 'leap day fallback', params: [DummyValue.UUID, { year: 2025, month: 2, day: 28 }] },
  )
  async forBirthdayMemories(ownerId: string, { year, month, day }: YearMonthDay) {
    const isLeapDayBirthday = isLeapDayObserved({ year, month, day });

    const people = await this.db
      .selectFrom('person')
      .select(['person.personGroupId', 'person.name'])
      .select(sql<number>`date_part('year', person."birthDate")::int`.as('birthYear'))
      .select(sql<number>`date_part('month', person."birthDate")::int`.as('birthMonth'))
      .select(sql<number>`date_part('day', person."birthDate")::int`.as('birthDay'))
      .where('person.ownerId', '=', ownerId)
      .where('person.isHidden', '=', false)
      .where('person.name', '!=', '')
      .where('person.birthDate', 'is not', null)
      .where((eb) => {
        const bornOn = (month: number, day: number) =>
          eb.and([
            eb(sql`date_part('month', person."birthDate")::int`, '=', month),
            eb(sql`date_part('day', person."birthDate")::int`, '=', day),
          ]);

        return isLeapDayBirthday ? eb.or([bornOn(month, day), bornOn(2, 29)]) : bornOn(month, day);
      })
      .where(sql`date_part('year', person."birthDate")::int`, '<', year)
      .execute();

    return people.map(({ personGroupId, name, birthYear, birthMonth, birthDay }) => ({
      personGroupId,
      name,
      birthDate: { year: birthYear, month: birthMonth, day: birthDay },
    }));
  }

  @GenerateSql()
  getFileSamples() {
    return this.db
      .selectFrom('person')
      .select(['ownerId', 'personGroupId', 'thumbnailPath'])
      .where('thumbnailPath', '!=', sql.lit(''))
      .limit(sql.lit(3))
      .execute();
  }

  @GenerateSql({ params: [{ take: 1, skip: 0 }, DummyValue.UUID] })
  async getAllForUser(pagination: PaginationOptions, userId: string, options?: PersonSearchOptions) {
    const items = await this.db
      .selectFrom('person')
      .selectAll('person')
      .select(personSidecarColumns())
      .innerJoin('asset_face', 'asset_face.personGroupId', 'person.personGroupId')
      .innerJoin('asset', (join) =>
        join
          .onRef('asset_face.assetId', '=', 'asset.id')
          .onRef('asset.ownerId', '=', 'person.ownerId')
          .on('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
          .on('asset.deletedAt', 'is', null),
      )
      .where('person.ownerId', '=', userId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .orderBy('person.isHidden', 'asc')
      .orderBy('person.isFavorite', 'desc')
      .having((eb) =>
        eb.or([
          eb('person.name', '!=', ''),
          // Under the Pets view only, waive the human minimumFaces threshold. Pet clustering already
          // applied its own `petRecognition.minFaces` (shipped default 1, chosen so a pet
          // photographed once still becomes its own individual), and the Pets view is where you go
          // to name those. The unfiltered view keeps the threshold, so it behaves exactly as before.
          // Grouping is by person.id (the PK), so person.type is functionally dependent here.
          ...(options?.type === 'pet' ? [personIsPet()] : []),
          eb(
            (innerEb) => innerEb.fn.count('asset_face.assetId'),
            '>=',
            sql<number>`COALESCE(
              (SELECT value -> 'people' ->> 'minimumFaces'
              FROM user_metadata
              WHERE "userId" = ${userId}
                AND key = ${sql.lit(UserMetadataKey.Preferences)}),
              '3'
            )::int `,
          ),
        ]),
      )
      .groupBy(['person.ownerId', 'person.personGroupId'])
      .$if(!!options?.closestFaceAssetId, (qb) =>
        qb
          // Named people first, exactly as the branch below does. This is NOT cosmetic here: the
          // ordering runs BEFORE the LIMIT, and this page is 500 rows by default. A library with
          // more people than that (unnamed clusters dominate the count) would otherwise have its
          // named people truncated away by resemblance alone -- and which ones survived changed
          // per face, because resemblance is the only thing that changed. Reported on #992: the
          // same picker, on the same photo, listed ten named people for one face and two for the
          // next. No amount of client-side re-ordering can recover a row the page never contained.
          .orderBy(sql`NULLIF(BTRIM(person.name), '') is null`, 'asc')
          .orderBy((eb) =>
            eb(
              (eb) =>
                eb
                  .selectFrom('face_search')
                  .select('face_search.embedding')
                  .whereRef('face_search.faceId', '=', 'person.faceAssetId'),
              '<=>',
              (eb) =>
                eb
                  .selectFrom('face_search')
                  .select('face_search.embedding')
                  .where('face_search.faceId', '=', options!.closestFaceAssetId!),
            ),
          )
          // Resemblance is NULL for every person whose representative face has no embedding, and
          // NULL for all of them when the edited face has none — leaving the order unspecified
          // and OFFSET paging free to repeat or skip a row. The id makes it total.
          .orderBy('person.personGroupId'),
      )
      .$if(!options?.closestFaceAssetId, (qb) =>
        qb
          .orderBy(sql`NULLIF(BTRIM(person.name), '') is null`, 'asc')
          .orderBy(sql`NULLIF(BTRIM(person.name), '')`, (om) => om.asc().nullsLast())
          .orderBy(sql`CASE WHEN NULLIF(BTRIM(person.name), '') IS NULL THEN COUNT("asset_face"."assetId") END`, (om) =>
            om.desc().nullsLast(),
          )
          .orderBy('person.personGroupId'),
      )
      // an explicit isHidden filter takes precedence over withHidden
      .$if(!options?.withHidden && options?.isHidden === undefined, (qb) => qb.where('person.isHidden', '=', false))
      .$if(!!options?.type, (qb) => qb.where(personType(), '=', options!.type!))
      .$if(options?.isFavorite !== undefined, (qb) => qb.where('person.isFavorite', '=', options!.isFavorite!))
      .$if(options?.isHidden !== undefined, (qb) => qb.where('person.isHidden', '=', options!.isHidden!))
      // Upstream's `f_unaccent(name) %> f_unaccent(:name)` at its 0.5 word-similarity threshold, without the
      // set_config CTE upstream needs to set that threshold for the operator.
      .$if(options?.name !== undefined, (qb) =>
        qb.where(sql<boolean>`word_similarity(f_unaccent(${options!.name!}), f_unaccent("person"."name")) >= 0.5`),
      )
      // A pet is listed only as an individual pet recognition identified, never as the per-species
      // bucket the detector alone produces, on every view: the bucket's species name would otherwise
      // pass the named-person arm above. A bucket has no pet_search row on any of its faces.
      .where((eb) =>
        eb.or([
          eb.not(personIsPet()),
          eb.exists(
            eb
              .selectFrom('asset_face as pet_face')
              .innerJoin('pet_search', 'pet_search.faceId', 'pet_face.id')
              .select(sql`1`.as('one'))
              .whereRef('pet_face.personGroupId', '=', 'person.personGroupId'),
          ),
        ]),
      )
      .offset(pagination.skip ?? 0)
      .limit(pagination.take + 1)
      .execute();

    return paginationHelper(items, pagination.take);
  }

  @GenerateSql()
  getAllWithoutFaces() {
    // The deletedAt / isVisible predicates must live inside the JOIN ON clause,
    // not in WHERE. A WHERE filter on a LEFT JOIN'd table silently converts it
    // to an INNER JOIN, which excludes persons with zero asset_face rows entirely
    // and leaves named zombies uncleaned after a force-recognition reset.
    return this.db
      .selectFrom('person')
      .selectAll('person')
      .select(personSidecarColumns())
      .leftJoin('asset_face', (join) =>
        join
          .onRef('asset_face.personGroupId', '=', 'person.personGroupId')
          .on('asset_face.deletedAt', 'is', null)
          .on((eb) => eb.or([eb('asset_face.isVisible', 'is', null), eb('asset_face.isVisible', '=', true)])),
      )
      .groupBy(['person.ownerId', 'person.personGroupId'])
      .having((eb) => eb.fn.count('asset_face.assetId'), '=', 0)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { viewingUserId: DummyValue.UUID, isVisible: true }] })
  getFaces(assetId: string, options: GetFacesOptions) {
    const { viewingUserId, isVisible } = options;

    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .select(withPerson({ viewingUserId }))
      .where('asset_face.assetId', '=', assetId)
      .where('asset_face.deletedAt', 'is', null)
      .$if(isVisible !== undefined, (qb) => qb.where('asset_face.isVisible', '=', isVisible!))
      .orderBy('asset_face.boundingBoxX1', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { viewingUserId: DummyValue.UUID }] })
  getFaceById(id: string, { viewingUserId }: WithPersonOptions) {
    // TODO return null instead of find or fail
    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .select(withPerson({ viewingUserId }))
      .where('asset_face.id', '=', id)
      .where('asset_face.deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getFaceForFacialRecognitionJob(id: string) {
    return this.db
      .selectFrom('asset_face')
      .select(['asset_face.id', 'asset_face.assetId', 'asset_face.personGroupId', 'asset_face.sourceType'])
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('asset')
            .innerJoin('user', 'user.id', 'asset.ownerId')
            .select(['asset.ownerId', 'asset.visibility', 'asset.fileCreatedAt', 'user.clusterGroupId'])
            .whereRef('asset.id', '=', 'asset_face.assetId'),
        ).as('asset'),
      )
      .select(withFaceSearch)
      .where('asset_face.id', '=', id)
      .where('asset_face.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [{ ownerId: DummyValue.UUID, personGroupId: DummyValue.UUID }] })
  getDataForThumbnailGenerationJob({ ownerId, personGroupId }: PersonId) {
    return this.db
      .selectFrom('person')
      .innerJoin('asset_face', 'asset_face.id', 'person.faceAssetId')
      .innerJoin('asset', 'asset_face.assetId', 'asset.id')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'person.ownerId',
        'asset_face.boundingBoxX1 as x1',
        'asset_face.boundingBoxY1 as y1',
        'asset_face.boundingBoxX2 as x2',
        'asset_face.boundingBoxY2 as y2',
        'asset_face.imageWidth as oldWidth',
        'asset_face.imageHeight as oldHeight',
        'asset.type',
        'asset.originalPath',
        'asset_exif.orientation as exifOrientation',
      ])
      .select((eb) => withFilePath(eb, AssetFileType.Preview).as('previewPath'))
      .where('person.ownerId', '=', ownerId)
      .where('person.personGroupId', '=', personGroupId)
      .where('asset_face.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async reassignFace(
    assetFaceId: string,
    newPersonGroupId: string,
    db: Kysely<DB> | Transaction<DB> = this.db,
  ): Promise<number> {
    const result = await db
      .updateTable('asset_face')
      .set({ personGroupId: newPersonGroupId })
      .where('asset_face.id', '=', assetFaceId)
      .executeTakeFirst();

    return Number(result.numChangedRows ?? 0);
  }

  @GenerateSql({ params: [{ ownerId: DummyValue.UUID, personGroupId: DummyValue.UUID }] })
  getByGroupId({ ownerId, personGroupId }: PersonId) {
    return this.db //
      .selectFrom('person')
      .selectAll('person')
      .select(personSidecarColumns())
      .where('person.personGroupId', '=', personGroupId)
      .where('person.ownerId', '=', ownerId)
      .executeTakeFirst();
  }

  /**
   * Option M: resolve a person by group id ALONE.
   *
   * Upstream deleted `person.id`; the primary key is now composite `(ownerId, personGroupId)`. Most
   * fork call sites only ever carry the person's public id — which `mapPerson` emits as
   * `personGroupId` — and have no owner in hand. This is sound ONLY because Gallery never creates
   * multi-user cluster groups, so `person_group` stays 1:1 with `person`.
   *
   * That invariant is enforced by the unique index `person_personGroupId_key`
   * (`1791000000000-RepointFaceReviewToPersonGroup`). Keeping the assumption in this single accessor
   * is deliberate: it is the one place M's 1:1 bet is load-bearing.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  getByGroupIdOnly(personGroupId: string) {
    return this.db //
      .selectFrom('person')
      .selectAll('person')
      .select(personSidecarColumns())
      .where('person.personGroupId', '=', personGroupId)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING, { withHidden: true }] })
  getByName(userId: string, personName: string, { withHidden, hasElevatedPermission }: PersonNameSearchOptions) {
    return (
      this.db
        .with('similarity_threshold', (db) =>
          db.selectNoFrom(sql`set_config('pg_trgm.word_similarity_threshold', '0.5', true)`.as('thresh')),
        )
        .selectFrom(['similarity_threshold', 'person'])
        .selectAll('person')
        .select(personSidecarColumns())
        .where('person.ownerId', '=', userId)
        .where(
          () =>
            sql`(f_unaccent("person"."name") ILIKE '%' || f_unaccent(${personName}) || '%' OR f_unaccent("person"."name") %> f_unaccent(${personName}))`,
        )
        .orderBy(sql`f_unaccent("person"."name") <->>> f_unaccent(${personName})`)
        .limit(100)
        .$if(!withHidden, (qb) => qb.where('person.isHidden', '=', false))
        // Fork (#869 follow-up): this owner-scoped lookup had no asset-visibility gate at all, so a person
        // whose faces only ever appear inside the Locked Folder was named back to a session that had never
        // entered the PIN — the withSharedSpaces path (searchAccessiblePeople) already gates on visibility.
        // Drop a person only when the Locked Folder is the ONLY thing backing them: a person with a face on
        // any non-locked asset is still legitimately discoverable, and a person with no faces at all (freshly
        // created, or every face unassigned) reveals nothing about locked content.
        .$if(!hasElevatedPermission, (qb) =>
          qb.where((eb) =>
            eb.or([
              eb.not(eb.exists(visibleFaceOnAsset(eb, { locked: true }))),
              eb.exists(visibleFaceOnAsset(eb, { locked: false })),
            ]),
          ),
        )
        .execute()
    );
  }

  @GenerateSql({ params: [DummyValue.UUID, { withHidden: true }] })
  getDistinctNames(userId: string, { withHidden }: PersonNameSearchOptions): Promise<PersonNameResponse[]> {
    return this.db
      .selectFrom('person')
      .select(['person.personGroupId', 'person.name'])
      .distinctOn((eb) => eb.fn('lower', ['person.name']))
      .where((eb) => eb.and([eb('person.ownerId', '=', userId), eb('person.name', '!=', '')]))
      .$if(!withHidden, (qb) => qb.where('person.isHidden', '=', false))
      .execute();
  }

  /**
   * L3: `memberUserId` scopes the count to a space-only reader's reachable assets (own assets are
   * never included here — a legacy person's assets all belong to `person.ownerId` — so this is a
   * pure narrowing of the owner's Timeline assets down to the ones the member can actually reach
   * via a shared space). Omit it for the owner's own unrestricted count.
   */
  @GenerateSql(
    { params: [DummyValue.UUID, DummyValue.UUID] },
    { params: [DummyValue.UUID, DummyValue.UUID, { memberUserId: DummyValue.UUID }] },
  )
  async getStatistics(
    personGroupId: string,
    userId: string,
    options: { memberUserId?: string } = {},
  ): Promise<PersonStatistics> {
    const result = await this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .select((eb) => eb.fn.count(eb.fn('distinct', ['asset.id'])).as('assets'))
      .select((eb) => eb.fn.count(eb.fn('distinct', ['asset_face.id'])).as('faces'))
      .where('asset.visibility', '=', sql.lit(AssetVisibility.Timeline))
      .where('asset.deletedAt', 'is', null)
      .where('asset.isOffline', '=', false)
      // #30739 added the owner-or-shared-album reachability gate. It is one arm of a disjunction, not a
      // filter to AND with the fork's: a Space reader owns none of these assets and need not share an
      // album with the owner, so ANDing the two counts zero for exactly the caller L3 exists to serve.
      .where((eb) =>
        eb.or([
          eb('asset.ownerId', '=', asUuid(userId)),
          inSharedAlbum(eb, userId),
          ...(options.memberUserId
            ? spaceAssetPathBranches(eb, {
                correlateAssetId: 'asset.id',
                correlateLibraryId: 'asset.libraryId',
                scope: { memberUserId: options.memberUserId },
                albumTimelineGate: 'none',
              })
            : []),
        ]),
      )
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .where('asset_face.personGroupId', '=', personGroupId)
      .executeTakeFirst();

    return {
      assets: Number(result?.assets ?? 0),
      faces: Number(result?.faces ?? 0),
    };
  }

  @GenerateSql({ params: [DummyValue.UUID, { minimumFaceCount: 3 }] })
  async getNumberOfPeople(userId: string, options: PeopleFaceStatisticsOptions = {}) {
    const minimumFaceCount = options.minimumFaceCount ?? 1;
    const typeFilter = options.type ?? '';
    const result = await sql<{ total: number; hidden: number }>`
      WITH "eligible_people" AS (
        SELECT
          "person"."personGroupId",
          "person"."isHidden"
        FROM "person"
        INNER JOIN "asset_face" ON "asset_face"."personGroupId" = "person"."personGroupId"
        INNER JOIN "asset" ON "asset"."id" = "asset_face"."assetId"
        WHERE "person"."ownerId" = ${userId}
          AND "asset"."visibility" = ${AssetVisibility.Timeline}
          AND "asset"."deletedAt" IS NULL
          AND "asset_face"."deletedAt" IS NULL
          AND "asset_face"."isVisible" = true
          AND (${typeFilter} = '' OR ${personType()} = ${typeFilter})
          AND (
            NOT ${personIsPet()}
            OR EXISTS (
              SELECT 1 FROM "asset_face" "pet_face"
              INNER JOIN "pet_search" ON "pet_search"."faceId" = "pet_face"."id"
              WHERE "pet_face"."personGroupId" = "person"."personGroupId"
            )
          )
        -- see getPeopleOverviewStatistics: group by the composite PRIMARY KEY, not the unique index
        GROUP BY "person"."ownerId", "person"."personGroupId"
        HAVING NULLIF(BTRIM("person"."name"), '') IS NOT NULL
          OR (${typeFilter} = 'pet' AND ${personIsPet()})
          OR COUNT("asset_face"."assetId") >= ${minimumFaceCount}
      )
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "isHidden" = true)::int AS "hidden"
      FROM "eligible_people"
    `.execute(this.db);

    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      hidden: Number(row?.hidden ?? 0),
    };
  }

  async create({
    identityId = null,
    type = 'person',
    species = null,
    ...person
  }: Insertable<PersonTable> & PersonSidecarFields) {
    // One transaction, as when type lived on person: a pet whose person_pet write failed would surface as a human.
    const created = await this.db.transaction().execute(async (trx) => {
      const row = await trx.insertInto('person').values(person).returningAll().executeTakeFirstOrThrow();
      await writePersonSidecars(trx, row.personGroupId, {
        identityId: identityId ?? undefined,
        type: type === 'pet' ? type : undefined,
        species: type === 'pet' ? species : undefined,
      });
      return row;
    });
    return { ...created, identityId, type, species: type === 'pet' ? species : null };
  }

  /**
   * Option M: create a person together with its own person_group.
   *
   * Under M a person is never shared across users, so every new person gets a fresh 1:1 group. This
   * is the fork's replacement for the old `create({ ownerId, ... })` — which worked when `person.id`
   * was a standalone primary key — and it is the only sanctioned way to mint a person, so the 1:1
   * invariant cannot be broken by accident at a call site.
   */
  async createWithGroup(person: Omit<Insertable<PersonTable>, 'personGroupId'> & PersonSidecarFields) {
    const group = await this.createGroup(person.ownerId);
    return this.create({ ...person, personGroupId: group.id });
  }

  async createAll(people: Insertable<PersonTable>[]) {
    if (people.length === 0) {
      return [];
    }

    return this.db.insertInto('person').values(people).returningAll().execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  createGroup(ownerId: string) {
    return this.db
      .insertInto('person_group')
      .columns(['clusterGroupId'])
      .expression((eb) => eb.selectFrom('user').select('user.clusterGroupId').where('user.id', '=', ownerId))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [{ userId: DummyValue.UUID, newClusterId: DummyValue.UUID }] })
  async reassignCluster({ userId, newClusterId }: ReassignCluster): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      // a group nobody else has people in moves across as it is
      await trx
        .updateTable('person_group')
        .set({ clusterGroupId: newClusterId })
        .where('person_group.id', 'in', (eb) =>
          eb.selectFrom('person').select('person.personGroupId').where('person.ownerId', '=', userId),
        )
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('person')
                .select('person.personGroupId')
                .whereRef('person.personGroupId', '=', 'person_group.id')
                .where('person.ownerId', '!=', userId),
            ),
          ),
        )
        .execute();

      // the rest is shared with someone else, so this user gets a group of their own for each
      const mapping = await trx
        .with('shared', (db) =>
          db
            .selectFrom('person')
            .select('person.personGroupId as oldId')
            .distinct()
            .where('person.ownerId', '=', userId)
            .where(({ exists, selectFrom }) =>
              exists(
                selectFrom('person as other')
                  .select('other.personGroupId')
                  .whereRef('other.personGroupId', '=', 'person.personGroupId')
                  .where('other.ownerId', '!=', userId),
              ),
            ),
        )
        .with(
          (cte) => cte('mapping').materialized(),
          (db) => db.selectFrom('shared').select(['shared.oldId', sql<string>`uuid_generate_v4()`.as('newId')]),
        )
        .with('created', (db) =>
          db
            .insertInto('person_group')
            .columns(['id', 'clusterGroupId'])
            .expression((eb) =>
              eb.selectFrom('mapping').select(['mapping.newId', sql.val(newClusterId).as('clusterGroupId')]),
            ),
        )
        .selectFrom('mapping')
        .select(['mapping.oldId', 'mapping.newId'])
        .execute();

      if (mapping.length === 0) {
        return;
      }

      const oldIds = mapping.map(({ oldId }) => oldId);
      const newIds = mapping.map(({ newId }) => newId);
      const remapped = sql<{
        oldId: string;
        newId: string;
      }>`(select unnest(${`{${oldIds}}`}::uuid[]) as "oldId", unnest(${`{${newIds}}`}::uuid[]) as "newId")`.as(
        'mapping',
      );

      await trx
        .updateTable('person')
        .from(remapped)
        .set((eb) => ({ personGroupId: eb.ref('mapping.newId') }))
        .whereRef('person.personGroupId', '=', 'mapping.oldId')
        .where('person.ownerId', '=', userId)
        .execute();

      await trx
        .updateTable('asset_face')
        .from(remapped)
        .set((eb) => ({ personGroupId: eb.ref('mapping.newId') }))
        .whereRef('asset_face.personGroupId', '=', 'mapping.oldId')
        .where(({ exists, selectFrom }) =>
          exists(
            selectFrom('asset')
              .select('asset.id')
              .whereRef('asset.id', '=', 'asset_face.assetId')
              .where('asset.ownerId', '=', userId),
          ),
        )
        .execute();
    });
  }

  @GenerateSql({ params: [DummyValue.UUID, 2] })
  async createGroups(personGroups: Insertable<PersonGroupTable>[]) {
    if (personGroups.length === 0) {
      return [];
    }

    return this.db.insertInto('person_group').values(personGroups).returningAll().execute();
  }

  @GenerateSql({ params: [[], [], [{ faceId: DummyValue.UUID, embedding: DummyValue.VECTOR }]] })
  async refreshFaces(
    facesToAdd: (Insertable<AssetFaceTable> & { assetId: string })[],
    faceIdsToRemove: string[],
    embeddingsToAdd?: Insertable<FaceSearchTable>[],
  ): Promise<void> {
    let query = this.db;
    if (facesToAdd.length > 0) {
      (query as any) = query.with('added', (db) => db.insertInto('asset_face').values(facesToAdd));
    }

    if (faceIdsToRemove.length > 0) {
      (query as any) = query.with('removed', (db) =>
        db.deleteFrom('asset_face').where('asset_face.id', '=', (eb) => eb.fn.any(eb.val(faceIdsToRemove))),
      );
    }

    if (embeddingsToAdd?.length) {
      (query as any) = query.with('added_embeddings', (db) => db.insertInto('face_search').values(embeddingsToAdd));
    }

    await query.selectFrom(dummy).execute();
  }

  async update(person: Updateable<PersonTable> & PersonId, db: Kysely<DB> | Transaction<DB> = this.db) {
    return db
      .updateTable('person')
      .set(person)
      .where('person.ownerId', '=', person.ownerId)
      .where('person.personGroupId', '=', person.personGroupId)
      .returningAll()
      .returning(personSidecarColumns())
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [{ userId: DummyValue.UUID, personGroupId: DummyValue.UUID }, { name: DummyValue.STRING }] })
  async updateForWritableOwners(
    { userId, personGroupId }: { userId: string; personGroupId: string },
    person: Pick<Updateable<PersonTable>, 'name' | 'birthDate'>,
  ): Promise<void> {
    await this.db
      .updateTable('person')
      .set(person)
      .where('person.personGroupId', '=', personGroupId)
      .where('person.ownerId', 'in', (eb) =>
        eb
          .selectFrom('person_user')
          .select('person_user.sharedById')
          .where('person_user.personGroupId', '=', personGroupId)
          .where('person_user.sharedWithId', '=', userId)
          .where('person_user.role', 'in', [PersonUserRole.Write, PersonUserRole.Admin]),
      )
      .execute();
  }

  async updateAll(people: Insertable<PersonTable>[]): Promise<void> {
    if (people.length === 0) {
      return;
    }

    await this.db
      .insertInto('person')
      .values(people)
      .onConflict((oc) =>
        oc.columns(['ownerId', 'personGroupId']).doUpdateSet((eb) =>
          removeUndefinedKeys(
            {
              name: eb.ref('excluded.name'),
              birthDate: eb.ref('excluded.birthDate'),
              thumbnailPath: eb.ref('excluded.thumbnailPath'),
              faceAssetId: eb.ref('excluded.faceAssetId'),
              isHidden: eb.ref('excluded.isHidden'),
              isFavorite: eb.ref('excluded.isFavorite'),
              color: eb.ref('excluded.color'),
            },
            people[0],
          ),
        ),
      )
      .execute();
  }

  @GenerateSql({
    params: [[{ assetId: DummyValue.UUID, personGroupId: DummyValue.UUID }], { viewingUserId: DummyValue.UUID }],
  })
  @ChunkedArray()
  getFacesByIds(ids: AssetFaceId[], { viewingUserId }: WithPersonOptions) {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    const assetIds: string[] = [];
    const personGroupIds: string[] = [];
    for (const { assetId, personGroupId } of ids) {
      assetIds.push(assetId);
      personGroupIds.push(personGroupId);
    }

    return this.db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .select(withPerson({ viewingUserId }))
      .where('asset_face.assetId', 'in', assetIds)
      .where('asset_face.personGroupId', 'in', personGroupIds)
      .where('asset_face.deletedAt', 'is', null)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getRandomFace(personGroupId: string, db: Kysely<DB> | Transaction<DB> = this.db) {
    return db
      .selectFrom('asset_face')
      .selectAll('asset_face')
      .where('asset_face.personGroupId', '=', personGroupId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .executeTakeFirst();
  }

  @GenerateSql()
  async getLatestFaceDate(): Promise<string | undefined> {
    const result = (await this.db
      .selectFrom('asset_job_status')
      .select((eb) => sql`${eb.fn.max('asset_job_status.facesRecognizedAt')}::text`.as('latestDate'))
      .executeTakeFirst()) as { latestDate: string } | undefined;

    return result?.latestDate;
  }

  async createAssetFace(face: Insertable<AssetFaceTable>, db: Kysely<DB> | Transaction<DB> = this.db): Promise<string> {
    const result = await db.insertInto('asset_face').values(face).returning('id').executeTakeFirstOrThrow();
    return result.id;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async deleteAssetFace(id: string, db: Kysely<DB> | Transaction<DB> = this.db): Promise<void> {
    await db.deleteFrom('asset_face').where('asset_face.id', '=', id).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async softDeleteAssetFaces(id: string): Promise<void> {
    await this.db.updateTable('asset_face').set({ deletedAt: new Date() }).where('asset_face.id', '=', id).execute();
  }

  @GenerateSql({ params: [[], []] })
  async updateVisibility(visible: AssetFace[], hidden: AssetFace[]): Promise<void> {
    if (visible.length === 0 && hidden.length === 0) {
      return;
    }

    await this.db.transaction().execute(async (trx) => {
      if (visible.length > 0) {
        await trx
          .updateTable('asset_face')
          .set({ isVisible: true })
          .where(
            'asset_face.id',
            'in',
            visible.map(({ id }) => id),
          )
          .execute();
      }

      if (hidden.length > 0) {
        await trx
          .updateTable('asset_face')
          .set({ isVisible: false })
          .where(
            'asset_face.id',
            'in',
            hidden.map(({ id }) => id),
          )
          .execute();
      }
    });
  }

  @GenerateSql({ params: [{ personGroupId: DummyValue.UUID, assetId: DummyValue.UUID }] })
  getForFeatureFaceUpdate({ personGroupId, assetId }: { personGroupId: string; assetId: string }) {
    return this.db
      .selectFrom('asset_face')
      .select('asset_face.id')
      .where('asset_face.assetId', '=', assetId)
      .where('asset_face.personGroupId', '=', personGroupId)
      .where('asset_face.deletedAt', 'is', null)
      .innerJoin('asset', (join) => join.onRef('asset.id', '=', 'asset_face.assetId').on('asset.isOffline', '=', false))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  getForMergePerson(personGroupIds: string[]) {
    return this.db
      .selectFrom('person')
      .selectAll('person')
      .select(personSidecarColumns())
      .where('person.personGroupId', 'in', personGroupIds)
      .orderBy('person.ownerId')
      .execute();
  }
}
