import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { HistoryBuilder } from 'src/decorators.js';
import { TimeBucketsResponseSchema } from 'src/dtos/time-bucket.dto.js';
import { AssetOrderSchema, AssetTypeSchema } from 'src/enum.js';
import { ScopedPrimaryProfileSchema } from 'src/gallery/dtos/person.dto.js';
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
