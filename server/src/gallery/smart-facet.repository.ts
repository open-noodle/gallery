import { Injectable } from '@nestjs/common';
import { type Kysely, type SqlBool, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetType, VectorIndex } from 'src/enum.js';
import {
  FilterSuggestionPerson,
  FilterSuggestionsResult,
  getFilteredIdentityPeople,
} from 'src/gallery/filter-suggestion.repository.js';
import { probes } from 'src/repositories/database.repository.js';
import { SmartSearchOptions, isActiveDistanceThreshold } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetFilter, withAssetFilter } from 'src/utils/asset-filter.js';
import { asUuid, hasPeople, hasTags, searchAssetBuilderLegacy, truncatedDate } from 'src/utils/database.js';
import { favoriteExistsFor } from 'src/utils/favorite.js';
import { without } from 'src/utils/filter-suggestions.js';
import { hasSpacePeople } from 'src/utils/people-filter.js';

export type SmartSearchFacetsOptions = Omit<SmartSearchOptions, 'orderDirection'>;

type SmartFacetExclude =
  | 'time'
  | 'people'
  | 'location'
  | 'city'
  | 'camera'
  | 'cameraModel'
  | 'tags'
  | 'rating'
  | 'media'
  | 'favorites'
  | 'albums';

const smartFacetFilterExcludes: Partial<Record<SmartFacetExclude, (keyof AssetFilter)[]>> = {
  time: ['takenAfter', 'takenBefore'],
  location: ['country', 'city'],
  city: ['city'],
  camera: ['make', 'model'],
  cameraModel: ['model'],
  rating: ['rating'],
};

export interface SmartSearchFacetsResult {
  total: number;
  timeBuckets: Array<{ timeBucket: string; count: number }>;
  countries: string[];
  cities: string[];
  cameraMakes: string[];
  cameraModels: string[];
  tags: FilterSuggestionsResult['tags'];
  people: FilterSuggestionsResult['people'];
  ratings: number[];
  mediaTypes: AssetType[];
  hasUnnamedPeople: boolean;
  hasFavorites: boolean;
  hasAssetsInAlbum: boolean;
  hasAssetsNotInAlbum: boolean;
}

@Injectable()
export class SmartFacetRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({
    params: [
      {
        embedding: DummyValue.VECTOR,
        userIds: [DummyValue.UUID],
        timelineSpaceIds: [DummyValue.UUID, DummyValue.UUID],
        maxDistance: 0.75,
        country: DummyValue.STRING,
        make: DummyValue.STRING,
        tagIds: [DummyValue.UUID],
        rating: 4,
        type: AssetType.Image,
        takenAfter: DummyValue.DATE,
        takenBefore: DummyValue.DATE,
      },
    ],
  })
  async getSmartSearchFacets(options: SmartSearchFacetsOptions): Promise<SmartSearchFacetsResult> {
    return this.db.transaction().execute(async (trx) => {
      await sql`set local vchordrq.probes = ${sql.lit(probes[VectorIndex.Clip])}`.execute(trx);
      await this.createSmartFacetCandidates(trx, options);

      const total = await this.getSmartFacetTotal(trx, options);
      const timeBuckets = await this.getSmartFacetTimeBuckets(trx, options);
      const countries = await this.getSmartFacetCountries(trx, options);
      const cities = await this.getSmartFacetCities(trx, options);
      const cameraMakes = await this.getSmartFacetCameraMakes(trx, options);
      const cameraModels = await this.getSmartFacetCameraModels(trx, options);
      const tags = await this.getSmartFacetTags(trx, options);
      const peopleResult = await this.getSmartFacetPeople(trx, options);
      const ratings = await this.getSmartFacetRatings(trx, options);
      const mediaTypes = await this.getSmartFacetMediaTypes(trx, options);
      const hasFavorites = await this.getSmartFacetHasFavorites(trx, options);
      const albumMembership = await this.getSmartFacetAlbumMembership(trx, options);

      return {
        total,
        timeBuckets,
        countries,
        cities,
        cameraMakes,
        cameraModels,
        tags,
        people: peopleResult.people,
        ratings,
        mediaTypes,
        hasUnnamedPeople: peopleResult.hasUnnamedPeople,
        hasFavorites,
        ...albumMembership,
      };
    });
  }

  private buildSmartFacetCandidateQuery(kysely: Kysely<DB>, options: SmartSearchFacetsOptions) {
    const hasDistanceThreshold = isActiveDistanceThreshold(options.maxDistance);

    return searchAssetBuilderLegacy(kysely, {
      ...without(
        options,
        'city',
        'country',
        'make',
        'model',
        'rating',
        'type',
        'isFavorite',
        'isInAlbum',
        'isNotInAlbum',
        'takenAfter',
        'takenBefore',
        'personIds',
        'personMatchAny',
        'identityIds',
        'forceEmptyResult',
        'spacePersonIds',
        'tagIds',
        'tagMatchAny',
      ),
      ratingIsMinimum: true,
    })
      .select('asset.id')
      .innerJoin('smart_search', 'asset.id', 'smart_search.assetId')
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`))
      .$if(hasDistanceThreshold, (qb) =>
        qb.where(sql<SqlBool>`(smart_search.embedding <=> ${options.embedding}) <= ${options.maxDistance!}`),
      )
      .where('smart_search.embedding', 'is not', null);
  }

  private async createSmartFacetCandidates(trx: Kysely<DB>, options: SmartSearchFacetsOptions) {
    await sql`drop table if exists smart_search_facet_candidates`.execute(trx);
    await sql`
      create temporary table smart_search_facet_candidates on commit drop as
      ${this.buildSmartFacetCandidateQuery(trx, options)}
    `.execute(trx);
    await sql`create index smart_search_facet_candidates_asset_id_idx on smart_search_facet_candidates ("id")`.execute(
      trx,
    );
  }

  private buildSmartFacetFilteredAssetIds(
    kysely: Kysely<DB>,
    options: SmartSearchFacetsOptions,
    exclude?: SmartFacetExclude,
  ) {
    // #763: same caller resolution as getSmartFacetHasFavorites — `authUserId` and `callerId` are two
    // names for the viewer on this path, and `userIds[0]` is deliberately not consulted (it is not the
    // caller under an album scope). Only read when `isFavorite` is set, and the assertion holds for
    // every production caller: SearchService.resolveSmartSearch is the only one, and it always sets
    // both alongside any client-supplied `isFavorite`.
    const facetCallerId = options.authUserId ?? options.callerId;

    return kysely
      .selectFrom('asset')
      .select('asset.id')
      .where(
        'asset.id',
        'in',
        kysely.selectFrom(sql<{ id: string }>`smart_search_facet_candidates`.as('candidates')).select('candidates.id'),
      )
      .$call((qb) => withAssetFilter(qb, options, exclude && smartFacetFilterExcludes[exclude]))
      .$if(exclude !== 'media' && !!options.type, (qb) => qb.where('asset.type', '=', options.type!))
      .$if(exclude !== 'favorites' && options.isFavorite !== undefined, (qb) =>
        qb.where((eb) =>
          options.isFavorite ? favoriteExistsFor(eb, facetCallerId!) : eb.not(favoriteExistsFor(eb, facetCallerId!)),
        ),
      )
      .$if(exclude !== 'albums' && !!options.isNotInAlbum && !options.albumIds?.length, (qb) =>
        qb.where((eb) =>
          eb.not(eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'))),
        ),
      )
      .$if(exclude !== 'albums' && !!options.isInAlbum && !options.albumIds?.length, (qb) =>
        qb.where((eb) => eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'))),
      )
      .$if(exclude !== 'people' && !!options.personIds?.length, (qb) => hasPeople(qb, options.personIds!))
      .$if(exclude !== 'people' && !!options.identityIds?.length, (qb) =>
        qb.where((eb) =>
          eb.and(
            options.identityIds!.map((identityId) =>
              eb.exists(
                eb
                  .selectFrom('asset_face')
                  .innerJoin('face_identity_face', 'face_identity_face.assetFaceId', 'asset_face.id')
                  .whereRef('asset_face.assetId', '=', 'asset.id')
                  .where('asset_face.deletedAt', 'is', null)
                  .where('asset_face.isVisible', 'is', true)
                  .where('face_identity_face.identityId', '=', asUuid(identityId)),
              ),
            ),
          ),
        ),
      )
      .$if(exclude !== 'people' && !!options.spacePersonIds?.length, (qb) =>
        hasSpacePeople(qb, options.spacePersonIds!),
      )
      .$if(exclude !== 'tags' && !!options.tagIds?.length, (qb) => hasTags(qb, options.tagIds!))
      .$if(exclude !== 'tags' && options.tagIds === null, (qb) =>
        qb.where((eb) => eb.not(eb.exists((eb) => eb.selectFrom('tag_asset').whereRef('assetId', '=', 'asset.id')))),
      )
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`));
  }

  private async getSmartFacetTotal(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<number> {
    const row = await trx
      .selectFrom(this.buildSmartFacetFilteredAssetIds(trx, options).as('filtered'))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  private async getSmartFacetTimeBuckets(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<Array<{ timeBucket: string; count: number }>> {
    return trx
      .with('asset', (qb) =>
        qb
          .selectFrom('asset')
          .select(truncatedDate<Date>().as('timeBucket'))
          .where('asset.id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'time')),
      )
      .selectFrom('asset')
      .select(sql<string>`("timeBucket" AT TIME ZONE 'UTC')::date::text`.as('timeBucket'))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .groupBy('timeBucket')
      .orderBy('timeBucket', 'desc')
      .execute() as Promise<Array<{ timeBucket: string; count: number }>>;
  }

  private async getSmartFacetCountries(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('country')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'location'))
      .where('country', 'is not', null)
      .where('country', '!=', '')
      .orderBy('country')
      .execute();
    return rows.map((row) => row.country!);
  }

  private async getSmartFacetCities(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('city')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'city'))
      .where('city', 'is not', null)
      .where('city', '!=', '')
      .orderBy('city')
      .execute();
    return rows.map((row) => row.city!);
  }

  private async getSmartFacetCameraMakes(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('make')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'camera'))
      .where('make', 'is not', null)
      .where('make', '!=', '')
      .orderBy('make')
      .execute();
    return rows.map((row) => row.make!);
  }

  private async getSmartFacetCameraModels(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<string[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('model')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'cameraModel'))
      .where('model', 'is not', null)
      .where('model', '!=', '')
      .orderBy('model')
      .execute();
    return rows.map((row) => row.model!);
  }

  private async getSmartFacetTags(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<Array<{ id: string; value: string }>> {
    return trx
      .selectFrom('tag')
      .select(['tag.id', 'tag.value'])
      .distinct()
      .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
      .where('tag_asset.assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'tags'))
      .orderBy('tag.value')
      .execute();
  }

  private async getSmartFacetPeople(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<{ people: FilterSuggestionPerson[]; hasUnnamedPeople: boolean }> {
    const filteredIds = this.buildSmartFacetFilteredAssetIds(trx, options, 'people');

    if (options.spaceId) {
      const spacePeople = await trx
        .selectFrom('shared_space_person')
        .select(['shared_space_person.id', 'shared_space_person.name'])
        .where('shared_space_person.spaceId', '=', asUuid(options.spaceId))
        .where('shared_space_person.isHidden', '=', false)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('shared_space_person_face')
              .innerJoin('asset_face as af', 'af.id', 'shared_space_person_face.assetFaceId')
              .whereRef('shared_space_person_face.personId', '=', 'shared_space_person.id')
              .where('af.deletedAt', 'is', null)
              .where('af.isVisible', 'is', true)
              .where('af.assetId', 'in', filteredIds),
          ),
        )
        .orderBy(sql`nullif("shared_space_person"."name", '')`)
        .orderBy('shared_space_person.id')
        .execute();

      const people = spacePeople
        .map((person) => ({
          id: person.id,
          name: person.name || '',
          primaryProfile: { type: 'space-person' as const, id: person.id, spaceId: options.spaceId },
        }))
        .filter((person) => person.name !== '')
        .toSorted((a, b) => a.name.localeCompare(b.name));

      const hasUnnamedPeople = spacePeople.some((person) => !person.name);

      return { people, hasUnnamedPeople };
    }

    if (options.timelineSpaceIds?.length) {
      // `callerId`, not `userIds[0]`: an album-scoped search has no owner scoping at all.
      return getFilteredIdentityPeople(
        filteredIds,
        options.callerId ?? options.userIds?.[0] ?? '',
        options.timelineSpaceIds,
        trx,
      );
    }

    const peopleRows = await trx
      .selectFrom('person')
      .select(['person.personGroupId as id', 'person.name'])
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.assetId', 'in', filteredIds),
        ),
      )
      .orderBy('person.name')
      .execute();
    const people = peopleRows.map((person) => ({
      ...person,
      primaryProfile: { type: 'user-person' as const, id: person.id },
    }));

    const unnamed = await trx
      .selectFrom('person')
      .select(sql`1`.as('exists'))
      .where((eb) => eb.or([eb('person.name', '=', ''), eb('person.name', 'is', null)]))
      .where('person.isHidden', '=', false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.deletedAt', 'is', null)
            .where('asset_face.isVisible', 'is', true)
            .where('asset_face.assetId', 'in', filteredIds),
        ),
      )
      .limit(1)
      .executeTakeFirst();

    return { people, hasUnnamedPeople: !!unnamed };
  }

  private async getSmartFacetRatings(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<number[]> {
    const rows = await trx
      .selectFrom('asset_exif')
      .select('rating')
      .distinct()
      .where('assetId', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'rating'))
      .where('rating', 'is not', null)
      .where('rating', '>', 0)
      .orderBy('rating')
      .execute();
    return rows.map((row) => row.rating!);
  }

  private async getSmartFacetMediaTypes(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<AssetType[]> {
    const rows = await trx
      .selectFrom('asset')
      .select('type')
      .distinct()
      .where('id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'media'))
      .orderBy('type')
      .execute();
    return rows.map((row) => row.type);
  }

  private async getSmartFacetHasFavorites(trx: Kysely<DB>, options: SmartSearchFacetsOptions): Promise<boolean> {
    // #763: "is the Favourites section worth offering" is a per-CALLER question — probe the
    // caller's `asset_favorite` overlay, not the dropped `asset.isFavorite` column.
    //
    // The caller is `authUserId`/`callerId` — two names for the same value (`auth.user.id`, set by
    // SearchService.resolveSmartSearch), one from this path's search-builder options and one from
    // SearchEmbeddingOptions. Deliberately NOT `userIds[0]`: unlike the browse path, where
    // getUserIdsToSearch guarantees `[auth.user.id, ...partnerIds]`, `userIds` here is left unset
    // entirely under an album scope (see SearchEmbeddingOptions.userIds and the `callerId` note in
    // getSmartFacetPeople). Probing `userIds[0]` there would answer for whichever owner happened to
    // head an owner-scoping array — another user's favourite state, surfaced in my UI.
    //
    // With no caller in scope there is no per-user answer, so the section is simply not offered.
    // That is the fail-safe direction — it can only hide a filter, never reveal someone else's
    // favourites — and it is consistent with what the section would do if shown: the `isFavorite`
    // filter behind it needs a caller too. Mirrors the `.$if(!!authUserId, ...)` fail-safe the
    // overlay projections use in asset.repository.ts.
    const callerId = options.authUserId ?? options.callerId;
    if (!callerId) {
      return false;
    }

    const row = await trx
      .selectFrom('asset')
      .select('asset.id')
      // #763: same widening as getFilteredHasFavorites — the favourites facet spans every space the
      // caller belongs to, while every other facet keeps the timeline-visible scope.
      .where(
        'asset.id',
        'in',
        this.buildSmartFacetFilteredAssetIds(
          trx,
          { ...options, timelineSpaceIds: options.favoriteSpaceIds ?? options.timelineSpaceIds },
          'favorites',
        ),
      )
      .where((eb) => favoriteExistsFor(eb, callerId))
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  private async getSmartFacetAlbumMembership(
    trx: Kysely<DB>,
    options: SmartSearchFacetsOptions,
  ): Promise<{ hasAssetsInAlbum: boolean; hasAssetsNotInAlbum: boolean }> {
    const probe = (filed: boolean) =>
      trx
        .selectFrom('asset')
        .select('asset.id')
        .where('asset.id', 'in', this.buildSmartFacetFilteredAssetIds(trx, options, 'albums'))
        .where((eb) => {
          const inAlbum = eb.exists(eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'));
          return filed ? inAlbum : eb.not(inAlbum);
        })
        .limit(1)
        .executeTakeFirst();

    const [filed, unfiled] = await Promise.all([probe(true), probe(false)]);
    return { hasAssetsInAlbum: !!filed, hasAssetsNotInAlbum: !!unfiled };
  }
}
