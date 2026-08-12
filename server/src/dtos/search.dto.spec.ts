import {
  FilterSuggestionsRequestDto,
  MetadataSearchDto,
  SearchSuggestionRequestDto,
  SearchSuggestionType,
  SmartSearchDto,
  SmartSearchFacetsDto,
} from 'src/dtos/search.dto';
import { AssetType } from 'src/enum';

describe('search DTO albumless filters', () => {
  it('should accept isNotInAlbum on smart search requests', () => {
    const result = SmartSearchDto.schema.safeParse({ query: 'beach', isNotInAlbum: true });

    expect(result.success).toBe(true);
    expect(result.data?.isNotInAlbum).toBe(true);
  });

  it('should accept boolean withSharedSpaces on smart search requests', () => {
    const result = SmartSearchDto.schema.safeParse({ query: 'beach', withSharedSpaces: true });

    expect(result.success).toBe(true);
    expect(result.data?.withSharedSpaces).toBe(true);
  });

  it('should accept isNotInAlbum on smart search facet requests', () => {
    const result = SmartSearchFacetsDto.schema.safeParse({ query: 'beach', isNotInAlbum: true });

    expect(result.success).toBe(true);
    expect(result.data?.isNotInAlbum).toBe(true);
  });

  it('should coerce isNotInAlbum on filter suggestion requests', () => {
    const result = FilterSuggestionsRequestDto.schema.safeParse({ isNotInAlbum: 'true' });

    expect(result.success).toBe(true);
    expect(result.data?.isNotInAlbum).toBe(true);
  });

  it('should coerce isNotInAlbum on dependent search suggestion requests', () => {
    const result = SearchSuggestionRequestDto.schema.safeParse({
      type: SearchSuggestionType.CITY,
      country: 'Germany',
      isNotInAlbum: 'true',
    });

    expect(result.success).toBe(true);
    expect(result.data?.isNotInAlbum).toBe(true);
  });

  it('should reject unrelated album values on suggestion requests instead of treating them as albumless', () => {
    const result = FilterSuggestionsRequestDto.schema.safeParse({ album: 'none' });

    expect(result.success).toBe(true);
    expect(result.data?.isNotInAlbum).toBeUndefined();
  });

  it('should accept isInAlbum on smart search requests', () => {
    const result = SmartSearchDto.schema.safeParse({ query: 'beach', isInAlbum: true });

    expect(result.success).toBe(true);
    expect(result.data?.isInAlbum).toBe(true);
  });

  it('should accept isInAlbum on smart search facet requests', () => {
    const result = SmartSearchFacetsDto.schema.safeParse({ query: 'beach', isInAlbum: true });

    expect(result.success).toBe(true);
    expect(result.data?.isInAlbum).toBe(true);
  });

  // ownerId is a narrowing contributor filter, distinct from the owner-scoping userIds resolved by
  // the service. Without a schema field for it, the ZodValidationPipe would silently strip ownerId
  // from incoming requests before the service ever sees it — the metadata-search DTO must declare it.
  it('should accept ownerId on metadata search requests', () => {
    const ownerId = '00000000-0000-4000-8000-000000000001';
    const result = MetadataSearchDto.schema.safeParse({ ownerId });

    expect(result.success).toBe(true);
    expect(result.data?.ownerId).toBe(ownerId);
  });

  it('should reject a non-uuid ownerId (a malformed owner filter must 400, not reach SQL as a bad cast)', () => {
    expect(MetadataSearchDto.schema.safeParse({ ownerId: 'not-a-uuid' }).success).toBe(false);
    expect(
      MetadataSearchDto.schema.safeParse({ ownerId: 'space-person:00000000-0000-4000-8000-000000000001' }).success,
    ).toBe(false);
  });

  // The free-text ILIKE filters are bounded server-side to mirror the web clamp
  // (TEXT_FILTER_MAX_CODE_POINTS = 200), counting code points, so a direct API caller cannot push a
  // multi-kilobyte pattern into POST /search/metadata.
  it('should accept description/originalFileName at exactly 200 code points', () => {
    expect(MetadataSearchDto.schema.safeParse({ description: 'a'.repeat(200) }).success).toBe(true);
    expect(MetadataSearchDto.schema.safeParse({ originalFileName: 'a'.repeat(200) }).success).toBe(true);
  });

  it('should reject description/originalFileName longer than 200 code points', () => {
    expect(MetadataSearchDto.schema.safeParse({ description: 'a'.repeat(201) }).success).toBe(false);
    expect(MetadataSearchDto.schema.safeParse({ originalFileName: 'a'.repeat(201) }).success).toBe(false);
  });

  it('should coerce isInAlbum on filter suggestion requests', () => {
    const result = FilterSuggestionsRequestDto.schema.safeParse({ isInAlbum: 'true' });

    expect(result.success).toBe(true);
    expect(result.data?.isInAlbum).toBe(true);
  });

  it('should coerce isInAlbum on dependent search suggestion requests', () => {
    const result = SearchSuggestionRequestDto.schema.safeParse({
      type: SearchSuggestionType.CITY,
      country: 'Germany',
      isInAlbum: 'true',
    });

    expect(result.success).toBe(true);
    expect(result.data?.isInAlbum).toBe(true);
  });
});

describe('SearchSuggestionRequestDto (#858)', () => {
  it('accepts a city filter', () => {
    const result = SearchSuggestionRequestDto.schema.safeParse({ type: 'camera-model', city: 'Berlin' });
    expect(result.success).toBe(true);
    expect(result.data?.city).toBe('Berlin');
  });

  it('accepts a mediaType filter', () => {
    const result = SearchSuggestionRequestDto.schema.safeParse({ type: 'camera-model', mediaType: 'IMAGE' });
    expect(result.success).toBe(true);
    expect(result.data?.mediaType).toBe(AssetType.Image);
  });

  it('rejects an unknown mediaType', () => {
    const result = SearchSuggestionRequestDto.schema.safeParse({ type: 'camera-model', mediaType: 'NOT_A_TYPE' });
    expect(result.success).toBe(false);
  });

  // The panel spreads its whole FilterContext into this request, so every dimension the context can
  // carry must be declared here — an undeclared key is silently stripped by the ZodValidationPipe
  // and the second-level list quietly stops narrowing (no error to notice).
  it('accepts the contributor filter the filter panel now sends', () => {
    const ownerId = '00000000-0000-4000-8000-000000000001';
    const result = SearchSuggestionRequestDto.schema.safeParse({ type: 'city', ownerId });
    expect(result.success).toBe(true);
    expect(result.data?.ownerId).toBe(ownerId);
  });

  it('rejects a non-uuid contributor filter', () => {
    expect(SearchSuggestionRequestDto.schema.safeParse({ type: 'city', ownerId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('FilterSuggestionsRequestDto narrowing dimensions', () => {
  it('accepts state, lensModel and ownerId so every suggestion list can narrow by them', () => {
    const ownerId = '00000000-0000-4000-8000-000000000001';
    const result = FilterSuggestionsRequestDto.schema.safeParse({
      state: 'Bavaria',
      lensModel: 'RF24-105mm F4 L IS USM',
      ownerId,
    });

    expect(result.success).toBe(true);
    expect(result.data?.state).toBe('Bavaria');
    expect(result.data?.lensModel).toBe('RF24-105mm F4 L IS USM');
    expect(result.data?.ownerId).toBe(ownerId);
  });

  it('rejects a non-uuid contributor filter', () => {
    expect(FilterSuggestionsRequestDto.schema.safeParse({ ownerId: 'not-a-uuid' }).success).toBe(false);
  });
});
