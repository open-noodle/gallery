import { AssetTypeEnum, getFilterSuggestions, getSearchSuggestions, searchSmartFacets, Type } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { buildRecentlyAddedFilterConfig } from '$lib/utils/recently-added-filter-config';

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getFilterSuggestions: vi.fn().mockResolvedValue({
      countries: ['Germany'],
      cameraMakes: ['Sony'],
      tags: [{ id: 'tag-1', value: 'Vacation' }],
      people: [{ id: 'person-1', name: 'Alice' }],
      ratings: [5],
      mediaTypes: ['IMAGE'],
      hasUnnamedPeople: false,
    }),
    getSearchSuggestions: vi.fn().mockResolvedValue(['Berlin']),
    searchSmartFacets: vi.fn().mockResolvedValue({
      countries: ['Germany'],
      cities: ['Berlin'],
      cameraMakes: ['Sony'],
      cameraModels: ['A7'],
      tags: [{ id: 'tag-1', value: 'Vacation' }],
      people: [{ id: 'person-1', name: 'Alice' }],
      ratings: [5],
      mediaTypes: ['IMAGE'],
      hasUnnamedPeople: false,
      total: 7,
      timeBuckets: [],
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildRecentlyAddedFilterConfig', () => {
  it('exposes all ten filter sections in plan order', () => {
    expect(buildRecentlyAddedFilterConfig().sections).toEqual([
      'timeline',
      'people',
      'location',
      'camera',
      'tags',
      'rating',
      'media',
      'favorites',
      'albums',
      'text',
    ]);
  });

  it('never scopes suggestions to shared spaces, albums, or spaces', async () => {
    const config = buildRecentlyAddedFilterConfig();

    await config.suggestionsProvider!(createFilterState());
    await config.providers!.cities!('Germany');
    await config.providers!.cameraModels!('Sony');

    const filterRequest = vi.mocked(getFilterSuggestions).mock.calls[0][0];
    const cityRequest = vi.mocked(getSearchSuggestions).mock.calls[0][0];
    const cameraRequest = vi.mocked(getSearchSuggestions).mock.calls[1][0];

    for (const request of [filterRequest, cityRequest, cameraRequest]) {
      expect(request).not.toHaveProperty('withSharedSpaces');
      expect(request).not.toHaveProperty('albumId');
      expect(request).not.toHaveProperty('spaceId');
    }
  });

  it('maps tags and people suggestions', async () => {
    vi.mocked(getFilterSuggestions).mockResolvedValueOnce({
      countries: ['Germany'],
      cameraMakes: ['Sony'],
      tags: [{ id: 'tag-1', value: 'Vacation' }],
      people: [{ id: 'person-1', name: 'Alice' }],
      ratings: [5],
      mediaTypes: ['IMAGE'],
      hasUnnamedPeople: true,
    } as never);

    const result = await buildRecentlyAddedFilterConfig().suggestionsProvider!(createFilterState());

    expect(result.tags).toEqual([{ id: 'tag-1', name: 'Vacation' }]);
    expect(result.people).toEqual([
      expect.objectContaining({
        id: 'person-1',
        name: 'Alice',
        thumbnailUrl: expect.stringContaining('/people/person-1/thumbnail'),
      }),
    ]);
    expect(result.hasUnnamedPeople).toBe(true);
    expect(result.countries).toEqual(['Germany']);
    expect(result.cameraMakes).toEqual(['Sony']);
    expect(result.ratings).toEqual([5]);
  });

  it('resolves a space-person suggestion to its shared-space thumbnail', async () => {
    // A shared-space person can still be *suggested* (they may appear on an own asset); only the
    // asset scope is restricted. The thumbnail must route to the space endpoint, because the
    // space-person id has no row in the owner-only person table.
    vi.mocked(getFilterSuggestions).mockResolvedValueOnce({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [
        {
          id: 'space-person:space-person-1',
          name: 'Space Person',
          primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
        },
      ],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    } as never);

    const result = await buildRecentlyAddedFilterConfig().suggestionsProvider!(createFilterState());

    expect(result.people).toEqual([
      expect.objectContaining({
        id: 'space-person:space-person-1',
        thumbnailUrl: '/api/shared-spaces/space-1/people/space-person-1/thumbnail',
      }),
    ]);
  });

  it('maps people suggestions by scoped filter id', async () => {
    vi.mocked(getFilterSuggestions).mockResolvedValueOnce({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [
        {
          id: 'identity-group-1',
          filterId: 'person:person-1',
          name: 'Alice',
          primaryProfile: { type: Type.UserPerson, id: 'person-1' },
        },
      ],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    } as never);

    const result = await buildRecentlyAddedFilterConfig().suggestionsProvider!(createFilterState());

    expect(result.people[0]).toEqual(expect.objectContaining({ id: 'person:person-1', name: 'Alice' }));
  });

  it('forwards the active filters to the suggestion request', async () => {
    await buildRecentlyAddedFilterConfig().suggestionsProvider!({
      ...createFilterState(),
      personIds: ['person:p1'],
      tagIds: ['tag-1'],
      mediaType: 'image',
      isFavorite: true,
      dateAfter: '2024-01-01',
      dateBefore: '2024-12-31',
    });

    expect(getFilterSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        personIds: ['person:p1'],
        tagIds: ['tag-1'],
        mediaType: AssetTypeEnum.Image,
        isFavorite: true,
        takenAfter: '2024-01-01T00:00:00.000Z',
        takenBefore: '2025-01-01T00:00:00.000Z',
      }),
    );
  });

  it('passes the dependent-provider arguments and context through', async () => {
    const config = buildRecentlyAddedFilterConfig();

    await config.providers!.cities!('Germany', { takenAfter: '2024-01-01T00:00:00.000Z' });
    await config.providers!.cameraModels!('Sony', { takenBefore: '2024-12-31T00:00:00.000Z' });

    expect(getSearchSuggestions).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ country: 'Germany', takenAfter: '2024-01-01T00:00:00.000Z' }),
    );
    expect(getSearchSuggestions).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ make: 'Sony', takenBefore: '2024-12-31T00:00:00.000Z' }),
    );
  });
});

describe('buildRecentlyAddedFilterConfig in query mode', () => {
  const searchContext = () => ({ query: 'beach', language: 'en', filters: createFilterState() });

  it('routes suggestions through smart facets, never shared spaces', async () => {
    const config = buildRecentlyAddedFilterConfig(searchContext);

    await config.suggestionsProvider!(createFilterState());

    expect(getFilterSuggestions).not.toHaveBeenCalled();
    expect(searchSmartFacets).toHaveBeenCalledWith(
      expect.objectContaining({ smartSearchFacetsDto: expect.objectContaining({ query: 'beach' }) }),
    );
    // Absence, not `false` — buildSmartSearchParams only sets the key when truthy.
    expect(vi.mocked(searchSmartFacets).mock.calls[0][0].smartSearchFacetsDto).not.toHaveProperty('withSharedSpaces');
  });

  it('maps smart facets to filter suggestions', async () => {
    const result = await buildRecentlyAddedFilterConfig(searchContext).suggestionsProvider!(createFilterState());

    expect(result.tags).toEqual([{ id: 'tag-1', name: 'Vacation' }]);
    expect(result.people[0]).toEqual(expect.objectContaining({ id: 'person-1', name: 'Alice' }));
    expect(result.countries).toEqual(['Germany']);
  });

  it('routes the dependent providers through smart facets without shared spaces', async () => {
    const config = buildRecentlyAddedFilterConfig(searchContext);

    const cities = await config.providers!.cities!('Germany');
    const cameraModels = await config.providers!.cameraModels!('Sony');

    expect(getSearchSuggestions).not.toHaveBeenCalled();
    expect(cities).toEqual(['Berlin']);
    expect(cameraModels).toEqual(['A7']);
    for (const call of vi.mocked(searchSmartFacets).mock.calls) {
      expect(call[0].smartSearchFacetsDto).not.toHaveProperty('withSharedSpaces');
    }
  });

  it('scopes the dependent providers by the live filters, not just the dependent value', async () => {
    // Regression pin: reconstructing a FilterState from the panel's FilterContext type-checks but
    // silently drops city/make/model/mediaType/text filters AND all dates (buildSmartSearchParams
    // derives dates from dateAfter/dateBefore/selectedYear, not takenAfter/takenBefore).
    const config = buildRecentlyAddedFilterConfig(() => ({
      query: 'beach',
      language: 'en',
      filters: { ...createFilterState(), make: 'Sony', rating: 4, selectedYear: 2024 },
    }));

    await config.providers!.cities!('Germany');

    expect(vi.mocked(searchSmartFacets).mock.calls[0][0].smartSearchFacetsDto).toEqual(
      expect.objectContaining({
        country: 'Germany',
        make: 'Sony',
        rating: 4,
        takenAfter: '2024-01-01T00:00:00.000Z',
      }),
    );
  });

  it('reads the query and filters at call time, not at build time', async () => {
    // The panel calls providers during interaction; values captured at build time would go stale
    // the moment the user edits the query or another filter.
    let context = { query: 'beach', language: 'en', filters: createFilterState() };
    const config = buildRecentlyAddedFilterConfig(() => context);

    await config.suggestionsProvider!(createFilterState());
    context = { query: 'sunset', language: 'en', filters: { ...createFilterState(), rating: 5 } };
    await config.suggestionsProvider!(createFilterState());

    expect(vi.mocked(searchSmartFacets).mock.calls[1][0].smartSearchFacetsDto).toEqual(
      expect.objectContaining({ query: 'sunset' }),
    );
  });

  it('falls back to the browse path when the query is blank', async () => {
    const config = buildRecentlyAddedFilterConfig(() => ({
      query: '   ',
      language: 'en',
      filters: createFilterState(),
    }));

    await config.suggestionsProvider!(createFilterState());

    expect(searchSmartFacets).not.toHaveBeenCalled();
    expect(getFilterSuggestions).toHaveBeenCalled();
  });
});
