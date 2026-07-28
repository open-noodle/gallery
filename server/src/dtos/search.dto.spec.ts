import {
  FilterSuggestionsRequestDto,
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
});
