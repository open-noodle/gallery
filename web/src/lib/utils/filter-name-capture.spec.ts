import { describe, expect, it } from 'vitest';
import type {
  FilterPanelConfig,
  FilterState,
  FilterSuggestionsResponse,
} from '$lib/components/filter-panel/filter-panel';
import { withNameCapture } from './filter-name-capture';

const EMPTY_SUGGESTIONS: FilterSuggestionsResponse = {
  countries: [],
  cameraMakes: [],
  tags: [],
  people: [],
  ratings: [],
  mediaTypes: [],
  hasUnnamedPeople: false,
};

function makeConfig(suggestions: FilterSuggestionsResponse, hasProvider = true): FilterPanelConfig {
  return {
    sections: ['timeline', 'people'],
    providers: { cities: () => Promise.resolve([]) },
    ...(hasProvider && { suggestionsProvider: () => Promise.resolve(suggestions) }),
  } as FilterPanelConfig;
}

describe('withNameCapture', () => {
  it('returns the same config when there is no suggestionsProvider', () => {
    const config = makeConfig(EMPTY_SUGGESTIONS, false);
    expect(withNameCapture(config, new Map(), new Map())).toBe(config);
  });

  it('returns the original suggestions object (identity) from the wrapped provider', async () => {
    const suggestions: FilterSuggestionsResponse = { ...EMPTY_SUGGESTIONS, people: [{ id: 'p1', name: 'Alice' }] };
    const wrapped = withNameCapture(makeConfig(suggestions), new Map(), new Map());
    expect(await wrapped.suggestionsProvider!({} as FilterState)).toBe(suggestions);
  });

  it('captures person and tag names into the maps', async () => {
    const suggestions: FilterSuggestionsResponse = {
      ...EMPTY_SUGGESTIONS,
      people: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ],
      tags: [{ id: 't1', name: 'Beach' }],
    };
    const personNames = new Map<string, string>();
    const tagNames = new Map<string, string>();
    const wrapped = withNameCapture(makeConfig(suggestions), personNames, tagNames);
    await wrapped.suggestionsProvider!({} as FilterState);
    expect(personNames.get('p1')).toBe('Alice');
    expect(personNames.get('p2')).toBe('Bob');
    expect(tagNames.get('t1')).toBe('Beach');
  });

  it('leaves the maps untouched when people/tags are empty', async () => {
    const personNames = new Map<string, string>();
    const tagNames = new Map<string, string>();
    const wrapped = withNameCapture(makeConfig(EMPTY_SUGGESTIONS), personNames, tagNames);
    await wrapped.suggestionsProvider!({} as FilterState);
    expect(personNames.size).toBe(0);
    expect(tagNames.size).toBe(0);
  });

  it('preserves the other config fields (sections, providers)', () => {
    const config = makeConfig(EMPTY_SUGGESTIONS);
    const wrapped = withNameCapture(config, new Map(), new Map());
    expect(wrapped.sections).toEqual(config.sections);
    expect(wrapped.providers).toBe(config.providers);
  });
});
