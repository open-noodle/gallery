import { Injectable } from '@nestjs/common';
import { type Kysely, type SelectQueryBuilder, type SqlBool, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetType, AssetVisibility } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { withAssetFilter } from 'src/utils/asset-filter.js';
import { anyUuid, asUuid, hasPeople } from 'src/utils/database.js';
import { favoriteExistsFor } from 'src/utils/favorite.js';
import { without } from 'src/utils/filter-suggestions.js';
import { hasSpacePeople } from 'src/utils/people-filter.js';
import { spaceAssetPathBranches, spaceVisibilityGate } from 'src/utils/shared-space-album-scope.js';

export interface SuggestionScopeOptions {
  albumId?: string;
  spaceId?: string;
  timelineSpaceIds?: string[];
  /**
   * #763: the space scope the FAVOURITES probe alone runs under — every space the caller belongs
   * to, not just the ones they show in their timeline. A favourite is an explicit per-asset act and
   * stays reachable when its space is hidden (see SharedSpaceRepository.getAllMemberSpaceIds), so
   * the "is the Favourites section worth offering" answer has to span the same set the favourites
   * filter itself will. Deliberately separate from `timelineSpaceIds`, which still scopes every
   * OTHER facet — widening those would leak a hidden space's cities/tags/people back into the panel.
   */
  favoriteSpaceIds?: string[];
  takenAfter?: Date;
  takenBefore?: Date;
  /**
   * Mirrors `AssetSearchBuilderOptions.visibility` (see `searchAssetBuilder` in `src/utils/database.ts`):
   * a concrete value filters to exactly that visibility, `'not-locked'` excludes only Locked, and
   * `undefined` applies no filter. The caller (SearchService) resolves this the same way it resolves
   * search's own visibility — `dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined :
   * 'not-locked')` — so suggestions cover the same asset set search would return (LOW #7).
   */
  visibility?: AssetVisibility | 'not-locked';
}

interface ExifSuggestionScopeOptions extends SuggestionScopeOptions {
  isNotInAlbum?: boolean;
  isInAlbum?: boolean;
}

interface FilterSuggestionFilterOptions {
  personIds?: string[];
  identityIds?: string[];
  forceEmptyResult?: boolean;
  country?: string;
  /**
   * State/province. A first-class facet key (not just an outer `getCities` predicate) so that an
   * active state narrows *every* suggestion list — people, tags, camera makes, ratings, media types
   * — the way `country` / `city` already do. The location group members that a list must NOT be
   * narrowed by are excluded per call site via `without(...)`, never here.
   */
  state?: string;
  city?: string;
  make?: string;
  model?: string;
  /** Lens model. Same reasoning as `state`, for the camera group. */
  lensModel?: string;
  /**
   * Contributor filter: a plain `AND asset.ownerId = X` applied *inside* whatever scope
   * `applySuggestionScope` resolved, so it can only ever shrink the suggestion set. It is NOT an
   * ownership scope — see `SearchUserIdOptions.ownerId` for the same distinction on the search path.
   */
  ownerId?: string;
  tagIds?: string[];
  rating?: number;
  mediaType?: AssetType;
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  isInAlbum?: boolean;
}

export interface GetStatesOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

export interface GetCitiesOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

export interface GetCameraModelsOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

export interface GetCameraMakesOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

export interface GetCameraLensModelsOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

export interface FilterSuggestionsOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {}

export type FilterSuggestionPerson = {
  id: string;
  name: string;
  primaryProfile?: { type: 'user-person' | 'space-person'; id: string; spaceId?: string };
};

type AccessibleTagScopeOptions = Pick<
  SuggestionScopeOptions,
  'spaceId' | 'timelineSpaceIds' | 'takenAfter' | 'takenBefore' | 'visibility'
>;

export interface FilterSuggestionsResult {
  countries: string[];
  cameraMakes: string[];
  tags: Array<{ id: string; value: string }>;
  people: FilterSuggestionPerson[];
  ratings: number[];
  mediaTypes: string[];
  hasUnnamedPeople: boolean;
  hasFavorites: boolean;
  hasAssetsInAlbum: boolean;
  hasAssetsNotInAlbum: boolean;
}

export async function getFilteredIdentityPeople(
  filteredIds: SelectQueryBuilder<DB, 'asset', { id: string }>,
  userId: string,
  timelineSpaceIds: string[],
  db: Kysely<DB>,
): Promise<{ people: FilterSuggestionPerson[]; hasUnnamedPeople: boolean }> {
  const result = await sql<{
    id: string;
    name: string | null;
    profileType: 'user-person' | 'space-person';
    profileId: string;
    spaceId: string | null;
  }>`
    WITH filtered_assets AS (
      ${filteredIds}
    ),
    identity_faces AS (
      SELECT DISTINCT
        face_identity_face."identityId"
      FROM face_identity_face
      INNER JOIN asset_face ON asset_face.id = face_identity_face."assetFaceId"
      INNER JOIN filtered_assets ON filtered_assets.id = asset_face."assetId"
      WHERE asset_face."deletedAt" IS NULL
        AND asset_face."isVisible" = true
    ),
    profiles AS (
      SELECT
        'user-person'::text AS "profileType",
        person."personGroupId" AS "profileId",
        NULL::uuid AS "spaceId",
        person."identityId",
        person.name,
        person."isHidden",
        person."updatedAt",
        0 AS "profileRank"
      FROM person
      WHERE person."ownerId" = ${userId}
        AND person."identityId" IS NOT NULL
        AND EXISTS (SELECT 1 FROM identity_faces WHERE identity_faces."identityId" = person."identityId")
      UNION ALL
      SELECT
        'space-person'::text AS "profileType",
        shared_space_person.id AS "profileId",
        shared_space_person."spaceId",
        shared_space_person."identityId",
        COALESCE(NULLIF(shared_space_person_alias.alias, ''), shared_space_person.name, '') AS name,
        shared_space_person."isHidden",
        shared_space_person."updatedAt",
        CASE WHEN NULLIF(shared_space_person_alias.alias, '') IS NULL THEN 2 ELSE 1 END AS "profileRank"
      FROM shared_space_person
      LEFT JOIN shared_space_person_alias
        ON shared_space_person_alias."personId" = shared_space_person.id
        AND shared_space_person_alias."userId" = ${userId}
      WHERE shared_space_person."spaceId" = ${anyUuid(timelineSpaceIds)}
        AND shared_space_person."identityId" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM shared_space_person_face
          INNER JOIN asset_face AS profile_face
            ON profile_face.id = shared_space_person_face."assetFaceId"
          WHERE shared_space_person_face."personId" = shared_space_person.id
            AND profile_face."deletedAt" IS NULL
            AND profile_face."isVisible" = true
        )
        AND EXISTS (
          SELECT 1 FROM identity_faces WHERE identity_faces."identityId" = shared_space_person."identityId"
        )
    ),
    ranked_profiles AS (
      SELECT
        profiles.*,
        row_number() OVER (
          PARTITION BY profiles."identityId"
          ORDER BY
            NULLIF(profiles.name, '') IS NULL,
            profiles."profileRank",
            lower(profiles.name),
            profiles."updatedAt" DESC,
            profiles."profileId"
        ) AS display_rn,
        row_number() OVER (
          PARTITION BY profiles."identityId"
          ORDER BY
            CASE
              WHEN profiles."profileType" = 'user-person' THEN 0
              ELSE profiles."profileRank"
            END,
            NULLIF(profiles.name, '') IS NULL,
            lower(profiles.name),
            profiles."updatedAt" DESC,
            profiles."profileId"
        ) AS primary_rn
      FROM profiles
      WHERE profiles."isHidden" = false
    )
    SELECT
      CASE
        WHEN primary_profiles."profileType" = 'space-person' THEN 'space-person:' || primary_profiles."profileId"::text
        ELSE 'person:' || primary_profiles."profileId"::text
      END AS id,
      COALESCE(NULLIF(display_profiles.name, ''), primary_profiles.name, '') AS name,
      primary_profiles."profileType",
      primary_profiles."profileId",
      primary_profiles."spaceId"
    FROM ranked_profiles AS primary_profiles
    INNER JOIN ranked_profiles AS display_profiles
      ON display_profiles."identityId" = primary_profiles."identityId"
      AND display_profiles.display_rn = 1
    WHERE primary_profiles.primary_rn = 1
    ORDER BY
      NULLIF(COALESCE(NULLIF(display_profiles.name, ''), primary_profiles.name, ''), '') IS NULL,
      lower(COALESCE(NULLIF(display_profiles.name, ''), primary_profiles.name, '')),
      primary_profiles."profileId"
  `.execute(db);

  return {
    people: result.rows
      .map((row) => ({
        id: row.id,
        name: row.name ?? '',
        primaryProfile:
          row.profileType === 'space-person'
            ? { type: row.profileType, id: row.profileId, spaceId: row.spaceId ?? undefined }
            : { type: row.profileType, id: row.profileId },
      }))
      .filter((person) => person.name !== ''),
    hasUnnamedPeople: result.rows.some((row) => !row.name),
  };
}

@Injectable()
export class FilterSuggestionRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async getCountries(userIds: string[], options: FilterSuggestionsOptions = {}): Promise<string[]> {
    // #858: mirror getFilterSuggestions' own getFilteredCountries — `city` is excluded alongside
    // `country`, because a selected city implies its country and would collapse this list to one row.
    // `state` is excluded for exactly that reason too (a state implies its country), and because the
    // whole location group is replaced by one click in the panel: country / state / city are ONE
    // filter (`handleLocationChange`), so the top level of it must never be narrowed by its children.
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'country', 'state', 'city'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('country')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('country', 'is not', null)
      .where('country', '!=', '')
      .orderBy('country')
      .execute();

    return res.map((row) => row.country!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING] })
  async getStates(userIds: string[], options: GetStatesOptions): Promise<string[]> {
    // `country` stays applied (it is the drill-down parent); `city` is excluded for the same reason
    // as in getCountries. `state` is now a FilterSuggestionFilterOptions key, so it has to be
    // excluded explicitly or a selected state would collapse this list to that one row.
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'state', 'city'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('state')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('state', 'is not', null)
      .where('state', '!=', '')
      .orderBy('state')
      .execute();

    return res.map((row) => row.state!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
  async getCities(userIds: string[], options: GetCitiesOptions): Promise<string[]> {
    // `state` stays applied (it is the drill-down parent, like `country`) — but now from inside
    // buildFilteredAssetIds, which replaces the old outer $if clause. Same shape, same behaviour.
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'city'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('city')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('city', 'is not', null)
      .where('city', '!=', '')
      .orderBy('city')
      .execute();

    return res.map((row) => row.city!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
  async getCameraMakes(userIds: string[], options: GetCameraMakesOptions): Promise<string[]> {
    // `lensModel` stays applied — moved inside buildFilteredAssetIds, replacing the outer $if.
    // A lens is an independent filter here: unlike the location group, `handleCameraChange` does
    // not clear it when a make or model is clicked, so narrowing by it is honest.
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'make'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('make')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('make', 'is not', null)
      .where('make', '!=', '')
      .orderBy('make')
      .execute();

    return res.map((row) => row.make!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
  async getCameraModels(userIds: string[], options: GetCameraModelsOptions): Promise<string[]> {
    // #858: every other active filter must narrow the model list, exactly like getCities. Only the
    // model itself is excluded — a selected model must not collapse its own list to one row.
    // `lensModel` stays applied, moved inside buildFilteredAssetIds (see getCameraMakes).
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'model'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('model')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('model', 'is not', null)
      .where('model', '!=', '')
      .orderBy('model')
      .execute();

    return res.map((row) => row.model!);
  }

  @GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING] })
  async getCameraLensModels(userIds: string[], options: GetCameraLensModelsOptions): Promise<string[]> {
    // `lensModel` is now a member of `FilterSuggestionFilterOptions`, so it has to be excluded here
    // or a selected lens would collapse its own list to one row. `make` and `model` stay applied,
    // inside buildFilteredAssetIds, replacing the old outer $if clauses.
    const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'lensModel'));
    const res = await this.db
      .selectFrom('asset_exif')
      .select('lensModel')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('lensModel', 'is not', null)
      .where('lensModel', '!=', '')
      .orderBy('lensModel')
      .execute();

    return res.map((row) => row.lensModel!);
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  async getAccessibleTags(
    userIds: string[],
    options?: AccessibleTagScopeOptions,
  ): Promise<Array<{ id: string; value: string }>> {
    const visibility = options?.visibility;
    return this.db
      .selectFrom('tag')
      .select(['tag.id', 'tag.value'])
      .distinct()
      .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
      .innerJoin('asset', 'tag_asset.assetId', 'asset.id')
      .$if(!!visibility, (qb) =>
        visibility === 'not-locked'
          ? qb.where('asset.visibility', '!=', AssetVisibility.Locked)
          : qb.where('asset.visibility', '=', visibility!),
      )
      .where('asset.deletedAt', 'is', null)
      .$if(!options?.spaceId && !options?.timelineSpaceIds, (qb) => qb.where('asset.ownerId', '=', anyUuid(userIds)))
      .$if(!!options?.spaceId && !options?.timelineSpaceIds, (qb) =>
        qb.where((eb) =>
          eb.and([
            eb.or(
              spaceAssetPathBranches(eb, {
                correlateAssetId: 'asset.id',
                correlateLibraryId: 'asset.libraryId',
                scope: { spaceId: options!.spaceId! },
                albumTimelineGate: 'space-tab',
              }),
            ),
            // M3: caller's own assets bypass space-visibility gate; others must be Archive/Timeline.
            eb.or([eb('asset.ownerId', '=', anyUuid(userIds)), spaceVisibilityGate(eb)]),
          ]),
        ),
      )
      .$if(!!options?.timelineSpaceIds, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('asset.ownerId', '=', anyUuid(userIds)),
            eb.and([
              eb('asset.visibility', '=', AssetVisibility.Timeline),
              eb.or(
                spaceAssetPathBranches(eb, {
                  correlateAssetId: 'asset.id',
                  correlateLibraryId: 'asset.libraryId',
                  scope: { spaceIds: options!.timelineSpaceIds! },
                  albumTimelineGate: 'space-tab',
                }),
              ),
            ]),
          ]),
        ),
      )
      .$call((qb) => withAssetFilter(qb, { takenAfter: options?.takenAfter, takenBefore: options?.takenBefore }))
      .orderBy('tag.value')
      .execute();
  }

  @GenerateSql({
    name: 'identity-filter-suggestions',
    params: [
      [DummyValue.UUID],
      {
        timelineSpaceIds: [DummyValue.UUID],
        identityIds: [DummyValue.UUID],
        takenAfter: DummyValue.DATE,
      },
    ],
    sortQueries: [
      'select distinct\n  "country"',
      'select distinct\n  "make"',
      'select distinct\n  "tag"."id"',
      'WITH\n  filtered_assets',
      'select distinct\n  "rating"',
      'select distinct\n  "type"',
      'and "asset"."isFavorite" = $',
      '  and exists (\n    select\n    from\n      "album_asset"',
      '  and not exists (\n    select\n    from\n      "album_asset"',
    ],
  })
  async getFilterSuggestions(userIds: string[], options: FilterSuggestionsOptions): Promise<FilterSuggestionsResult> {
    const [countries, cameraMakes, tags, peopleResult, ratings, mediaTypes, hasFavorites, albumMembership] =
      await Promise.all([
        // `state` joins `country` / `city` in the location group's self-exclusion: it implies its
        // country, so leaving it applied would collapse the country selector to a single row —
        // exactly the reason `city` is excluded here. Every other list keeps `state` applied.
        this.getFilteredCountries(userIds, without(options, 'country', 'state', 'city')),
        // `lensModel` deliberately stays applied, matching the standalone getCameraMakes endpoint:
        // clicking a make does not clear the lens chip, so the make list may honestly narrow by it.
        this.getFilteredCameraMakes(userIds, without(options, 'make', 'model')),
        this.getFilteredTags(userIds, without(options, 'tagIds')),
        this.getFilteredPeople(userIds, without(options, 'personIds', 'identityIds')),
        this.getFilteredRatings(userIds, without(options, 'rating')),
        this.getFilteredMediaTypes(userIds, without(options, 'mediaType')),
        this.getFilteredHasFavorites(userIds, without(options, 'isFavorite')),
        this.getFilteredAlbumMembership(userIds, without(options, 'isInAlbum', 'isNotInAlbum')),
      ]);

    return {
      countries,
      cameraMakes,
      tags,
      people: peopleResult.people,
      ratings,
      mediaTypes,
      hasUnnamedPeople: peopleResult.hasUnnamedPeople,
      hasFavorites,
      ...albumMembership,
    };
  }

  private applySuggestionScope<T extends SelectQueryBuilder<DB, any, any>>(
    qb: T,
    userIds: string[],
    options?: ExifSuggestionScopeOptions,
  ) {
    return (
      qb
        // Album scope. An asset feeds the album's filter facets only when it (a) belongs
        // to the album and (b) is one the user may legitimately see there. (b) holds when
        // the asset was contributed by an album participant (the album owner or a shared
        // user), is owned by the user or their partners, or is reachable through a shared
        // space they currently show in their timeline. Dropping the participant cases would
        // give viewers empty People/Location/Camera/Tag facets for assets owned by the
        // album owner (issue #655); dropping the access check entirely would leak a
        // shared-space asset that merely landed in an album to non-space-members.
        // Note: on this upstream base album ownership lives in `album_user` (the creator is
        // an `album_user` row with role=owner), so the album_user participant check below
        // covers both the album owner and shared users in one branch.
        .$if(!!options?.albumId, (qb) =>
          qb.where((eb) =>
            eb.and([
              eb.exists(
                eb
                  .selectFrom('album_asset')
                  .whereRef('album_asset.assetId', '=', 'asset.id')
                  .where('album_asset.albumId', '=', asUuid(options!.albumId!)),
              ),
              eb.or([
                // I1: unlike the plain-asset search path, getFilterSuggestions calls into
                // applySuggestionScope with no upstream visibility resolution — so "caller's own
                // assets follow the resolved visibility applied upstream" does NOT hold here. Gate
                // the owner's own assets too (Archive + Timeline), matching the album grid's
                // withDefaultVisibility, so the caller's own Hidden/Locked album asset can't feed a
                // facet value either. albumId arm ONLY — the sibling spaceId/timelineSpaceIds arms
                // below keep their deliberate M3 own-asset exception.
                eb.and([spaceVisibilityGate(eb), eb('asset.ownerId', '=', anyUuid(userIds))]),
                // Other album participants' assets: Archive + Timeline only (mirrors the
                // album view's withDefaultVisibility — Hidden/Locked never surface for
                // other members, matching the sibling spaceId/timelineSpaceIds branches).
                eb.and([
                  spaceVisibilityGate(eb),
                  eb.exists(
                    eb
                      .selectFrom('album_user')
                      .whereRef('album_user.userId', '=', 'asset.ownerId')
                      .where('album_user.albumId', '=', asUuid(options!.albumId!)),
                  ),
                ]),
                // Space-linked assets via timeline opt-in: also gate on Archive + Timeline.
                ...(options?.timelineSpaceIds?.length
                  ? [
                      eb.and([
                        spaceVisibilityGate(eb),
                        eb.or(
                          spaceAssetPathBranches(eb, {
                            correlateAssetId: 'asset.id',
                            correlateLibraryId: 'asset.libraryId',
                            scope: { spaceIds: options.timelineSpaceIds },
                            albumTimelineGate: 'none',
                          }),
                        ),
                      ]),
                    ]
                  : []),
              ]),
            ]),
          ),
        )
        .$if(!options?.albumId && !options?.spaceId && !options?.timelineSpaceIds, (qb) =>
          qb.where('asset.ownerId', '=', anyUuid(userIds)),
        )
        .$if(!!options?.spaceId && !options?.timelineSpaceIds && !options?.albumId, (qb) =>
          qb.where((eb) =>
            eb.and([
              eb.or(
                spaceAssetPathBranches(eb, {
                  correlateAssetId: 'asset.id',
                  correlateLibraryId: 'asset.libraryId',
                  scope: { spaceId: options!.spaceId! },
                  albumTimelineGate: 'space-tab',
                }),
              ),
              // M3: the caller's own assets bypass the space-visibility gate (own-M3);
              // every other member's asset must be Archive or Timeline.
              eb.or([eb('asset.ownerId', '=', anyUuid(userIds)), spaceVisibilityGate(eb)]),
            ]),
          ),
        )
        .$if(!!options?.timelineSpaceIds && !options?.albumId, (qb) =>
          qb.where((eb) =>
            eb.or([
              // Caller's own assets follow the resolved visibility applied above.
              eb('asset.ownerId', '=', anyUuid(userIds)),
              // Other members' assets: Timeline only + showInTimeline=true album path.
              eb.and([
                eb('asset.visibility', '=', AssetVisibility.Timeline),
                eb.or(
                  spaceAssetPathBranches(eb, {
                    correlateAssetId: 'asset.id',
                    correlateLibraryId: 'asset.libraryId',
                    scope: { spaceIds: options!.timelineSpaceIds! },
                    albumTimelineGate: 'space-tab',
                  }),
                ),
              ]),
            ]),
          ),
        )
    );
  }

  private buildFilteredAssetIds(userIds: string[], options: FilterSuggestionsOptions) {
    const visibility = options.visibility;

    return this.applySuggestionScope(
      this.db
        .selectFrom('asset')
        .select('asset.id')
        .$if(!!visibility, (qb) =>
          visibility === 'not-locked'
            ? qb.where('asset.visibility', '!=', AssetVisibility.Locked)
            : qb.where('asset.visibility', '=', visibility!),
        )
        .where('asset.deletedAt', 'is', null),
      userIds,
      options,
    )
      .$if(!!options.forceEmptyResult, (qb) => qb.where(sql<SqlBool>`false`))
      .$if(!!options.isNotInAlbum && !options.albumId, (qb) =>
        qb.where((eb) =>
          eb.not(eb.exists((eb) => eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id'))),
        ),
      )
      .$if(!!options.isInAlbum && !options.albumId, (qb) =>
        qb.where((eb) =>
          eb.exists((eb) => eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id')),
        ),
      )
      .$call((qb) => withAssetFilter(qb, options))
      .$if(options.ownerId !== undefined, (qb) => qb.where('asset.ownerId', '=', asUuid(options.ownerId!)))
      .$if(!!options.personIds?.length && !!options.spaceId, (qb) => hasSpacePeople(qb, options.personIds!))
      .$if(!!options.personIds?.length && !options.spaceId, (qb) => hasPeople(qb, options.personIds!))
      .$if(!!options.identityIds?.length, (qb) =>
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
      .$if(!!options.tagIds?.length, (qb) =>
        qb.where((eb) =>
          eb.exists(
            eb
              .selectFrom('tag_asset')
              .whereRef('tag_asset.assetId', '=', 'asset.id')
              .where('tag_asset.tagId', '=', anyUuid(options.tagIds!)),
          ),
        ),
      )
      .$if(!!options.mediaType, (qb) => qb.where('asset.type', '=', options.mediaType!))
      .$if(options.isFavorite !== undefined && options.isFavorite !== null, (qb) =>
        qb.where((eb) =>
          // #763: buildFilteredAssetIds has no dedicated authUserId param — userIds[0] is the
          // caller here (every call path resolves userIds via SearchService.getUserIdsToSearch,
          // which always returns `[auth.user.id, ...partnerIds]`; unlike searchAssetBuilder's
          // options.userIds, this is never left unset or reordered on a space/album path).
          options.isFavorite ? favoriteExistsFor(eb, userIds[0]) : eb.not(favoriteExistsFor(eb, userIds[0])),
        ),
      );
  }

  private async getFilteredCountries(userIds: string[], options: FilterSuggestionsOptions): Promise<string[]> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);
    const res = await this.db
      .selectFrom('asset_exif')
      .select('country')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('country', 'is not', null)
      .where('country', '!=', '')
      .orderBy('country')
      .execute();
    return res.map((row) => row.country!);
  }

  private async getFilteredCameraMakes(userIds: string[], options: FilterSuggestionsOptions): Promise<string[]> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);
    const res = await this.db
      .selectFrom('asset_exif')
      .select('make')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('make', 'is not', null)
      .where('make', '!=', '')
      .orderBy('make')
      .execute();
    return res.map((row) => row.make!);
  }

  private async getFilteredTags(
    userIds: string[],
    options: FilterSuggestionsOptions,
  ): Promise<Array<{ id: string; value: string }>> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);
    return this.db
      .selectFrom('tag')
      .select(['tag.id', 'tag.value'])
      .distinct()
      .innerJoin('tag_asset', 'tag.id', 'tag_asset.tagId')
      .where('tag_asset.assetId', 'in', filteredIds)
      .orderBy('tag.value')
      .execute();
  }

  private async getFilteredPeople(
    userIds: string[],
    options: FilterSuggestionsOptions,
  ): Promise<{ people: FilterSuggestionPerson[]; hasUnnamedPeople: boolean }> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);

    // When spaceId is set, return shared_space_person records (space-specific IDs and names)
    if (options.spaceId) {
      const spacePeople = await this.buildFilteredSpacePeopleQuery(filteredIds, options.spaceId).execute();

      const people = spacePeople
        .map((p) => ({
          id: p.id,
          name: p.name || '',
          primaryProfile: { type: 'space-person' as const, id: p.id, spaceId: options.spaceId },
        }))
        .filter((p) => p.name !== '');

      const hasUnnamedPeople = spacePeople.some((p) => !p.name);

      return { people, hasUnnamedPeople };
    }

    if (options.timelineSpaceIds?.length) {
      return getFilteredIdentityPeople(filteredIds, userIds[0], options.timelineSpaceIds, this.db);
    }

    // Global: return person records
    const peopleRows = await this.buildFilteredGlobalPeopleQuery(filteredIds).execute();
    const people = peopleRows.map((person) => ({
      ...person,
      primaryProfile: { type: 'user-person' as const, id: person.id },
    }));

    const unnamed = await this.db
      .selectFrom('person')
      .select(sql`1`.as('exists'))
      .where((eb) => eb.or([eb('person.name', '=', ''), eb('person.name', 'is', null)]))
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.assetId', 'in', filteredIds),
        ),
      )
      .limit(1)
      .executeTakeFirst();

    return { people, hasUnnamedPeople: !!unnamed };
  }

  private buildFilteredSpacePeopleQuery(filteredIds: SelectQueryBuilder<DB, 'asset', { id: string }>, spaceId: string) {
    return this.db
      .selectFrom('shared_space_person')
      .select(['shared_space_person.id', 'shared_space_person.name'])
      .where('shared_space_person.spaceId', '=', asUuid(spaceId))
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
      .orderBy('shared_space_person.id');
  }

  private buildFilteredGlobalPeopleQuery(filteredIds: SelectQueryBuilder<DB, 'asset', { id: string }>) {
    return this.db
      .selectFrom('person')
      .select(['person.personGroupId as id', 'person.name'])
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('asset_face')
            .whereRef('asset_face.personGroupId', '=', 'person.personGroupId')
            .where('asset_face.assetId', 'in', filteredIds),
        ),
      )
      .orderBy('person.isFavorite', 'desc')
      .orderBy('person.name');
  }

  private async getFilteredRatings(userIds: string[], options: FilterSuggestionsOptions): Promise<number[]> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);
    const res = await this.db
      .selectFrom('asset_exif')
      .select('rating')
      .distinct()
      .where('assetId', 'in', filteredIds)
      .where('rating', 'is not', null)
      .where('rating', '>', 0)
      .orderBy('rating')
      .execute();
    return res.map((row) => row.rating!);
  }

  private async getFilteredMediaTypes(userIds: string[], options: FilterSuggestionsOptions): Promise<string[]> {
    const filteredIds = this.buildFilteredAssetIds(userIds, options);
    const res = await this.db
      .selectFrom('asset')
      .select('type')
      .distinct()
      .where('id', 'in', filteredIds)
      .orderBy('type')
      .execute();
    return res.map((row) => row.type);
  }

  /**
   * #910: presence probes for the Favourites / Albums sections. `limit 1` rather than an aggregate so
   * Postgres stops at the first matching row — the answer is "does one exist", not "how many".
   */
  private async getFilteredHasFavorites(userIds: string[], options: FilterSuggestionsOptions): Promise<boolean> {
    const row = await this.db
      .selectFrom('asset')
      .select('asset.id')
      // #763: `favoriteSpaceIds` when the caller supplied it — a favourite survives hiding its
      // space from the timeline, so the probe must span every membership. Falls back to the shared
      // scope, which is what album/space-scoped panels (no favouriteSpaceIds) keep using.
      .where(
        'asset.id',
        'in',
        this.buildFilteredAssetIds(userIds, {
          ...options,
          timelineSpaceIds: options.favoriteSpaceIds ?? options.timelineSpaceIds,
        }),
      )
      // #763: per-caller overlay, not the dropped `asset.isFavorite` column. `userIds[0]` is the
      // caller on this path — same reasoning as `buildFilteredAssetIds`'s isFavorite branch.
      .where((eb) => favoriteExistsFor(eb, userIds[0]))
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  private async getFilteredAlbumMembership(
    userIds: string[],
    options: FilterSuggestionsOptions,
  ): Promise<{ hasAssetsInAlbum: boolean; hasAssetsNotInAlbum: boolean }> {
    const probe = (filed: boolean) =>
      this.db
        .selectFrom('asset')
        .select('asset.id')
        .where('asset.id', 'in', this.buildFilteredAssetIds(userIds, options))
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
