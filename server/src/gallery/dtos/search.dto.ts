import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { HistoryBuilder } from 'src/decorators.js';
import { ScopedPrimaryProfileSchema } from 'src/dtos/person.dto.js';
import { TimeBucketsResponseSchema } from 'src/dtos/time-bucket.dto.js';
import { AssetOrderSchema, AssetTypeSchema, AssetVisibilitySchema, LibraryViewSchema } from 'src/enum.js';
import { IsNotSiblingOf, boundedTextFilter, isoDatetimeToDate, stringToBool } from 'src/validation.js';

// Fork search request fields, merged into upstream's schemas in src/dtos/search.dto.ts with one `.extend(...)` each
// (the src/gallery/dtos/config.dto.ts pattern), plus the fork-only filter-suggestion and facet DTOs. This module must stay
// a leaf: src/dtos/search.dto.ts imports it, so importing back from there would be circular.

// Deliberate copy of the module-private DEPRECATED_FLAT_FIELD in src/dtos/search.dto.ts (see the leaf rule above).
// withShapeExclusivity reads `deprecated` off each field, so an override of a deprecated upstream field keeps it.
const DEPRECATED_FLAT_FIELD = {
  ...new HistoryBuilder().added('v1').stable('v2').deprecated('v3.2.0').getExtensions(),
  deprecated: true,
};

const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const ScopedPersonTokenSchema = z
  .string()
  .regex(new RegExp(`^(?:${UUID_PATTERN}|person:${UUID_PATTERN}|space-person:${UUID_PATTERN})$`))
  .describe('Legacy person ID or scoped identity filter token');

/** BaseSearchSchema: overrides of upstream fields first, then fork-only fields. */
export const GallerySearchFilterExtension = {
  takenBefore: isoDatetimeToDate
    .optional()
    .describe('Filter by taken date: before this local date and time (exclusive)')
    .meta(DEPRECATED_FLAT_FIELD),
  takenAfter: isoDatetimeToDate
    .optional()
    .describe('Filter by taken date: on or after this local date and time (inclusive)')
    .meta(DEPRECATED_FLAT_FIELD),
  personIds: z.array(ScopedPersonTokenSchema).optional().describe('Filter by person IDs').meta(DEPRECATED_FLAT_FIELD),
  ocr: boundedTextFilter().optional().describe('Filter by OCR text content').meta(DEPRECATED_FLAT_FIELD),
  ownerId: z
    .uuidv4()
    .optional()
    .describe('Filter by asset owner (contributor). Narrows within the current scope; never widens it.'),
  isInAlbum: z.boolean().optional().describe('Filter assets in at least one album'),
  // Not marked DEPRECATED_FLAT_FIELD: that meta advertises a structured V3 replacement, and there is none for
  // shared spaces.
  spaceId: z.uuidv4().optional().describe('Shared space ID to filter by'),
  spacePersonIds: z.array(z.uuidv4()).optional().describe('Shared space person IDs to filter by'),
  withSharedSpaces: z.boolean().optional().describe('Include shared spaces the user is a member of'),
  libraryView: LibraryViewSchema.optional(),
};

/** SearchPeopleSchema */
export const GallerySearchPeopleExtension = {
  name: z.string().min(1).describe('Person name to search for'),
  withSharedSpaces: stringToBool.optional().describe('Include shared spaces the user is a member of'),
};

/** SearchSuggestionRequestSchema */
export const GallerySearchSuggestionExtension = {
  albumId: z.uuidv4().optional().describe('Scope suggestions to a specific album'),
  city: z.string().optional().describe('Filter by city'),
  personIds: z
    .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(ScopedPersonTokenSchema))
    .optional()
    .describe('Filter by person IDs'),
  tagIds: z
    .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(z.uuidv4()))
    .optional()
    .describe('Filter by tag IDs'),
  rating: z.coerce.number().int().min(1).max(5).optional().describe('Filter by rating (1-5)'),
  isFavorite: stringToBool.optional().describe('Filter by favorites'),
  isNotInAlbum: stringToBool.optional().describe('Filter assets not in any album'),
  isInAlbum: stringToBool.optional().describe('Filter assets in at least one album'),
  // Contributor filter, not an ownership scope: it narrows within whatever scope the request
  // already resolved (see FilterSuggestionFilterOptions.ownerId). Without a field here the
  // ZodValidationPipe would silently strip it and the suggestion lists would not narrow.
  ownerId: z.uuidv4().optional().describe('Filter by asset owner (contributor)'),
  mediaType: AssetTypeSchema.optional().describe('Filter by asset type'),
  takenAfter: isoDatetimeToDate
    .optional()
    .describe('Filter suggestions by taken date: on or after this local date and time (inclusive)'),
  takenBefore: isoDatetimeToDate
    .optional()
    .describe('Filter suggestions by taken date: before this local date and time (exclusive)'),
  spaceId: z.uuidv4().optional().describe('Scope suggestions to a specific shared space'),
  withSharedSpaces: stringToBool.optional().describe('Include suggestions from shared spaces the user is a member of'),
};

const descriptionFilter = boundedTextFilter(z.string().trim())
  .optional()
  .describe('Filter by description text')
  .meta(DEPRECATED_FLAT_FIELD);

/** MetadataSearchSchema */
export const GalleryMetadataSearchExtension = {
  description: descriptionFilter,
  originalFileName: boundedTextFilter(z.string().trim())
    .optional()
    .describe('Filter by original file name')
    .meta(DEPRECATED_FLAT_FIELD),
};

/** StatisticsSearchSchema */
export const GalleryStatisticsSearchExtension = { description: descriptionFilter };

/**
 * SmartSearchSchema. Not marked DEPRECATED_FLAT_FIELD: that meta advertises a structured V3 replacement, and
 * neither field has one (`order` here means relevance-vs-date on smart search).
 */
export const GallerySmartSearchExtension = {
  order: AssetOrderSchema.optional().describe('Sort order (omit for relevance)'),
  // POST body, so a real boolean — stringToBool is for the query-string suggestion DTOs.
  withSharedSpaces: z.boolean().optional().describe('Include shared spaces the user is a member of'),
};

type SuggestionScopeShape = {
  albumId: z.ZodOptional<z.ZodUUID>;
  spaceId: z.ZodOptional<z.ZodUUID>;
  withSharedSpaces: z.ZodType;
};

// IsNotSiblingOf only needs the schema for its key types; the cast keeps the caller's full output type.
const albumIsNotSiblingOf = <T extends z.ZodObject<SuggestionScopeShape>>(
  schema: T,
  sibling: 'spaceId' | 'withSharedSpaces',
) =>
  IsNotSiblingOf(schema as z.ZodObject<SuggestionScopeShape>, 'albumId', [sibling]) as z.ZodCustom<
    z.output<T>,
    z.output<T>
  >;

/** An album scope cannot be combined with a space scope or with shared spaces. */
export const withGallerySuggestionScope = <T extends z.ZodObject<SuggestionScopeShape>>(schema: T) =>
  schema.pipe(albumIsNotSiblingOf(schema, 'spaceId')).pipe(albumIsNotSiblingOf(schema, 'withSharedSpaces'));

const TagSuggestionRequestSchema = z
  .object({
    spaceId: z.uuidv4().optional().describe('Scope suggestions to a specific shared space'),
    withSharedSpaces: stringToBool
      .optional()
      .describe('Include suggestions from shared spaces the user is a member of'),
    takenAfter: isoDatetimeToDate
      .optional()
      .describe('Filter suggestions by taken date: on or after this local date and time (inclusive)'),
    takenBefore: isoDatetimeToDate
      .optional()
      .describe('Filter suggestions by taken date: before this local date and time (exclusive)'),
  })
  .meta({ id: 'TagSuggestionRequestDto' });

const TagSuggestionResponseSchema = z
  .object({
    id: z.string().describe('Tag ID'),
    value: z.string().describe('Tag value/name'),
  })
  .meta({ id: 'TagSuggestionResponseDto' });

const FilterSuggestionsPersonSchema = z
  .object({
    id: z.string().describe('Person ID'),
    name: z.string().describe('Person name'),
    primaryProfile: ScopedPrimaryProfileSchema.optional().describe('Accessible profile used for thumbnails'),
  })
  .meta({ id: 'FilterSuggestionsPersonDto' });

const FilterSuggestionsTagSchema = z
  .object({
    id: z.string().describe('Tag ID'),
    value: z.string().describe('Tag value/name'),
  })
  .meta({ id: 'FilterSuggestionsTagDto' });

const FilterSuggestionsResponseSchema = z
  .object({
    countries: z.array(z.string()).describe('Available countries'),
    cameraMakes: z.array(z.string()).describe('Available camera makes'),
    tags: z.array(FilterSuggestionsTagSchema).describe('Available tags'),
    people: z.array(FilterSuggestionsPersonSchema).describe('Available people (named, non-hidden, with thumbnails)'),
    ratings: z.array(z.int()).describe('Available ratings'),
    mediaTypes: z.array(z.string()).describe('Available media types'),
    hasUnnamedPeople: z.boolean().describe('Whether unnamed people exist in the filtered set'),
    hasFavorites: z.boolean().describe('Whether any favourite exists in the filtered set, ignoring isFavorite'),
    hasAssetsInAlbum: z.boolean().describe('Whether any filtered asset belongs to an album'),
    hasAssetsNotInAlbum: z.boolean().describe('Whether any filtered asset belongs to no album'),
  })
  .meta({ id: 'FilterSuggestionsResponseDto' });

const SmartSearchFacetsResponseSchema = z
  .object({
    total: z.int().nonnegative().describe('Exact count after applying all active smart-search filters'),
    timeBuckets: z
      .array(TimeBucketsResponseSchema)
      .describe('Available monthly buckets for the smart-search result set'),
    countries: z.array(z.string()).describe('Available countries'),
    cities: z.array(z.string()).describe('Available cities for the current smart-search country scope'),
    cameraMakes: z.array(z.string()).describe('Available camera makes'),
    cameraModels: z.array(z.string()).describe('Available camera models for the current smart-search make scope'),
    tags: z.array(FilterSuggestionsTagSchema).describe('Available tags'),
    people: z.array(FilterSuggestionsPersonSchema).describe('Available people'),
    ratings: z.array(z.int()).describe('Available ratings'),
    mediaTypes: z.array(AssetTypeSchema).describe('Available media types'),
    hasUnnamedPeople: z.boolean().describe('Whether unnamed people exist in the filtered smart-search set'),
    hasFavorites: z.boolean().describe('Whether any favourite exists in the filtered set, ignoring isFavorite'),
    hasAssetsInAlbum: z.boolean().describe('Whether any filtered asset belongs to an album'),
    hasAssetsNotInAlbum: z.boolean().describe('Whether any filtered asset belongs to no album'),
  })
  .meta({ id: 'SmartSearchFacetsResponseDto' });

const FilterSuggestionsRequestBaseSchema = z.object({
  personIds: z
    .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(ScopedPersonTokenSchema))
    .optional()
    .describe('Filter by person IDs'),
  country: z.string().optional().describe('Filter by country'),
  state: z.string().optional().describe('Filter by state/province'),
  city: z.string().optional().describe('Filter by city'),
  make: z.string().optional().describe('Filter by camera make'),
  model: z.string().optional().describe('Filter by camera model'),
  lensModel: z.string().optional().describe('Filter by lens model'),
  // See SearchSuggestionRequestBaseSchema.ownerId — a narrowing contributor filter, never a scope.
  ownerId: z.uuidv4().optional().describe('Filter by asset owner (contributor)'),
  tagIds: z
    .preprocess((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]), z.array(z.uuidv4()))
    .optional()
    .describe('Filter by tag IDs'),
  rating: z.coerce.number().int().min(1).max(5).optional().describe('Filter by rating (1-5)'),
  mediaType: AssetTypeSchema.optional().describe('Filter by asset type'),
  isFavorite: stringToBool.optional().describe('Filter by favorites'),
  isNotInAlbum: stringToBool.optional().describe('Filter assets not in any album'),
  isInAlbum: stringToBool.optional().describe('Filter assets in at least one album'),
  takenAfter: isoDatetimeToDate
    .optional()
    .describe('Filter by taken date: on or after this local date and time (inclusive)'),
  takenBefore: isoDatetimeToDate
    .optional()
    .describe('Filter by taken date: before this local date and time (exclusive)'),
  albumId: z.uuidv4().optional().describe('Scope to a specific album'),
  spaceId: z.uuidv4().optional().describe('Scope to a specific shared space'),
  withSharedSpaces: stringToBool.optional().describe('Include shared spaces the user is a member of'),
});

const FilterSuggestionsRequestSchema = withGallerySuggestionScope(FilterSuggestionsRequestBaseSchema).meta({
  id: 'FilterSuggestionsRequestDto',
});

export class TagSuggestionRequestDto extends createZodDto(TagSuggestionRequestSchema) {}
export class TagSuggestionResponseDto extends createZodDto(TagSuggestionResponseSchema) {}
export class FilterSuggestionsPersonDto extends createZodDto(FilterSuggestionsPersonSchema) {}
export class FilterSuggestionsTagDto extends createZodDto(FilterSuggestionsTagSchema) {}
export class FilterSuggestionsResponseDto extends createZodDto(FilterSuggestionsResponseSchema) {}
export class FilterSuggestionsRequestDto extends createZodDto(FilterSuggestionsRequestSchema) {}
export class SmartSearchFacetsResponseDto extends createZodDto(SmartSearchFacetsResponseSchema) {}

/**
 * `POST /search/options` (specs/2026-10-23-mobile-search-redesign-design.md, Slice 1). One request shape, two modes,
 * each counting exactly what its results call returns:
 * - **Browse** (no `query` / `queryAssetId`): `GET /timeline/buckets` with the same filters (`albumIds[0]` as its
 *   `albumId`). Its rules apply: people ALL, tags ANY, rating a minimum, visibility unset = timeline + archive, the owner
 *   scope is the caller (plus timeline partners with `withPartners`) unless an album or space is given, and the same
 *   combinations are refused.
 * - **Query**: `POST /search/smart` with the same filters (`withPartners` and `withStacked` ignored; partners shown in
 *   the timeline are always searched). People ALL, tags ALL, rating a minimum, visibility unset = everything not locked.
 *
 * A POST body, so `tagIds: null` can mean "untagged" (which `/timeline/buckets` cannot express).
 */
/** What one `POST /search/options` request computes. */
export const searchOptionsDimensions = [
  'availability',
  'total',
  'time',
  'people',
  'tags',
  'places',
  'cameras',
  'ratings',
  'mediaTypes',
] as const;
export type SearchOptionsDimension = (typeof searchOptionsDimensions)[number];
const SearchOptionsDimensionSchema = z.enum(searchOptionsDimensions).meta({ id: 'SearchOptionsDimension' });

const SearchOptionsRequestSchema = z
  .object({
    personIds: z.array(ScopedPersonTokenSchema).optional().describe('Filter by people: all of them (AND), both modes'),
    spacePersonIds: z.array(z.uuidv4()).optional().describe('Filter by shared space people: all of them (AND)'),
    tagIds: z
      .array(z.uuidv4())
      .nullish()
      .describe('Filter by tags: any of them in browse mode, all of them in query mode; null for untagged assets'),
    country: z.string().nullable().optional().describe('Filter by country'),
    state: z.string().nullable().optional().describe('Filter by state/province'),
    city: z.string().nullable().optional().describe('Filter by city'),
    make: z.string().nullable().optional().describe('Filter by camera make'),
    model: z.string().nullable().optional().describe('Filter by camera model'),
    lensModel: z.string().nullable().optional().describe('Filter by lens model'),
    rating: z.int().min(1).max(5).nullish().describe('Minimum star rating (>=), both modes; null for unrated'),
    type: AssetTypeSchema.optional().describe('Filter by asset type'),
    isFavorite: z.boolean().optional().describe("Filter by the caller's favorites"),
    isInAlbum: z.boolean().optional().describe('Filter assets in at least one album'),
    isNotInAlbum: z.boolean().optional().describe('Filter assets not in any album'),
    visibility: AssetVisibilitySchema.optional().describe(
      'Filter by visibility. Unset: timeline + archive in browse mode, everything but locked in query mode',
    ),
    ocr: boundedTextFilter().optional().describe('Filter by OCR text content'),
    description: boundedTextFilter(z.string().trim()).optional().describe('Filter by description text'),
    originalFileName: boundedTextFilter(z.string().trim()).optional().describe('Filter by original file name'),
    takenAfter: isoDatetimeToDate
      .optional()
      .describe('Filter by taken date: on or after this local date and time (inclusive)'),
    takenBefore: isoDatetimeToDate
      .optional()
      .describe('Filter by taken date: before this local date and time (exclusive)'),
    ownerId: z
      .uuidv4()
      .optional()
      .describe('Filter by asset owner (contributor). Narrows within the current scope; never widens it.'),
    albumIds: z.array(z.uuidv4()).optional().describe('Scope to these albums (browse mode: at most one)'),
    spaceId: z.uuidv4().optional().describe('Scope to a shared space'),
    withSharedSpaces: z.boolean().optional().describe('Include the shared spaces shown in the timeline'),
    withPartners: z
      .boolean()
      .optional()
      .describe('Browse mode: include the partners shown in the timeline, as on /timeline/buckets'),
    withStacked: z
      .boolean()
      .optional()
      .describe('Browse mode: count only the primary asset of each stack, as on /timeline/buckets'),
    libraryView: LibraryViewSchema.optional(),
    query: z.string().trim().optional().describe('Query mode: count over the smart-search results for this text'),
    queryAssetId: z
      .uuidv4()
      .optional()
      .describe('Query mode: count over the smart-search results similar to this asset'),
    language: z.string().optional().describe('Search language code for `query`'),
    dimensions: z
      .array(SearchOptionsDimensionSchema)
      .optional()
      .describe(
        'What to compute: availability (the default, LIMIT 1 probes for the chip row) and/or option lists with counts. Ask for availability first, then fetch the lists in parallel',
      ),
  })
  .meta({ id: 'SearchOptionsRequestDto' });

const SearchOptionsPersonSchema = z
  .object({
    id: z.string().describe('Person ID, the same value as filterId'),
    filterId: z
      .string()
      .describe(
        'The value to send in personIds (or spacePersonIds in a space scope): a person:/space-person: token when the scope shares people, else a bare id',
      ),
    name: z.string().describe('Person name'),
    primaryProfile: ScopedPrimaryProfileSchema.optional().describe('Accessible profile used for thumbnails'),
    count: z.int().nonnegative().describe('Matching assets that show this person, with every active filter applied'),
    isSelected: z.boolean().describe('Whether this person is one of the active people filters'),
    isPet: z
      .boolean()
      .optional()
      .describe('Whether this is a pet rather than a person (the People / Pets toggle); absent from older servers'),
  })
  .meta({ id: 'SearchOptionsPersonDto' });

const SearchOptionsTagSchema = z
  .object({
    id: z.string().describe('Tag ID'),
    value: z.string().describe('Tag value/name'),
    count: z
      .int()
      .nonnegative()
      .describe('Matching assets with this tag (or a child tag), with the other filters applied (see tags)'),
    isSelected: z.boolean().describe('Whether this tag is one of the active tag filters'),
  })
  .meta({ id: 'SearchOptionsTagDto' });

const SearchOptionsCitySchema = z
  .object({
    city: z.string().describe('City name'),
    count: z.int().nonnegative().describe('Matching assets in this city'),
  })
  .meta({ id: 'SearchOptionsCityDto' });

const SearchOptionsCountrySchema = z
  .object({
    country: z.string().describe('Country name'),
    count: z.int().nonnegative().describe('Matching assets in this country'),
    cities: z.array(SearchOptionsCitySchema).describe('Cities of this country, most assets first'),
  })
  .meta({ id: 'SearchOptionsCountryDto' });

const SearchOptionsModelSchema = z
  .object({
    model: z.string().describe('Camera model'),
    count: z.int().nonnegative().describe('Matching assets taken with this model'),
  })
  .meta({ id: 'SearchOptionsModelDto' });

const SearchOptionsMakeSchema = z
  .object({
    make: z.string().describe('Camera make'),
    count: z.int().nonnegative().describe('Matching assets taken with this make'),
    models: z.array(SearchOptionsModelSchema).describe('Models of this make, most assets first'),
  })
  .meta({ id: 'SearchOptionsMakeDto' });

const SearchOptionsRatingSchema = z
  .object({
    rating: z.int().min(1).max(5).describe('Star rating'),
    count: z.int().nonnegative().describe('Matching assets with exactly this rating'),
  })
  .meta({ id: 'SearchOptionsRatingDto' });

const SearchOptionsMediaTypeSchema = z
  .object({
    type: AssetTypeSchema,
    count: z.int().nonnegative().describe('Matching assets of this type'),
  })
  .meta({ id: 'SearchOptionsMediaTypeDto' });

const SearchOptionsAvailabilitySchema = z
  .object({
    hasAssets: z.boolean().describe('Whether any asset matches every active filter'),
    hasPeople: z.boolean().describe('Whether the people list would have a named person'),
    hasTags: z.boolean().describe('Whether the tag list would have a tag'),
    hasPlaces: z.boolean().describe('Whether the place list would have a country, ignoring the place filter'),
    hasCameras: z.boolean().describe('Whether the camera list would have a make, ignoring the camera filter'),
    hasRatings: z.boolean().describe('Whether any rated asset matches, ignoring the rating filter'),
    hasImages: z.boolean().describe('Whether any image matches, ignoring the type filter'),
    hasVideos: z.boolean().describe('Whether any video matches, ignoring the type filter'),
    hasFavorites: z.boolean().describe("Whether any of the caller's favourites match, ignoring isFavorite"),
    hasAssetsInAlbum: z
      .boolean()
      .describe('Whether any matching asset belongs to an album, ignoring the album filters'),
    hasAssetsNotInAlbum: z
      .boolean()
      .describe('Whether any matching asset belongs to no album, ignoring the album filters'),
  })
  .meta({ id: 'SearchOptionsAvailabilityDto' });

/** Only the requested `dimensions` are present. */
const SearchOptionsResponseSchema = z
  .object({
    stale: z
      .boolean()
      .optional()
      .describe(
        'True when served from the unfiltered cache after the library changed, while a refresh runs (at most 10 minutes old); a client may show it as is',
      ),
    availability: SearchOptionsAvailabilitySchema.optional().describe(
      'The chip row: whether each list has any option (as the list itself, ignoring its own filter) and the #910 flags',
    ),
    total: z.int().nonnegative().optional().describe('Matching assets with every active filter applied'),
    people: z
      .array(SearchOptionsPersonSchema)
      .optional()
      .describe('Named people in the matching assets, active people filters included; most assets first'),
    hasUnnamedPeople: z
      .boolean()
      .optional()
      .describe('With people: whether unnamed people appear in the matching assets'),
    tags: z
      .array(SearchOptionsTagSchema)
      .optional()
      .describe(
        'Tags with the photos each would match. Browse (tags ANY): computed without the tag filter. Query (tags ALL): with it, so they co-occur with the selection. Untagged is ignored; most assets first',
      ),
    countries: z
      .array(SearchOptionsCountrySchema)
      .optional()
      .describe('Countries and their cities, ignoring the place filter; most assets first'),
    cameraMakes: z
      .array(SearchOptionsMakeSchema)
      .optional()
      .describe('Camera makes and their models, ignoring the camera filter; most assets first'),
    ratings: z.array(SearchOptionsRatingSchema).optional().describe('Ratings present, ignoring the rating filter'),
    mediaTypes: z
      .array(SearchOptionsMediaTypeSchema)
      .optional()
      .describe('Media types present, ignoring the type filter'),
    timeBuckets: z
      .array(TimeBucketsResponseSchema)
      .optional()
      .describe('Monthly buckets (local taken time), ignoring the taken-date filter; newest first'),
  })
  .meta({ id: 'SearchOptionsResponseDto' });

export class SearchOptionsRequestDto extends createZodDto(SearchOptionsRequestSchema) {}
export class SearchOptionsResponseDto extends createZodDto(SearchOptionsResponseSchema) {}
