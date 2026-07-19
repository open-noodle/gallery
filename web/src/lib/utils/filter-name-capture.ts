import type {
  FilterPanelConfig,
  FilterState,
  FilterSuggestionsResponse,
} from '$lib/components/filter-panel/filter-panel';

/**
 * Wraps a FilterPanelConfig so its suggestionsProvider, besides returning suggestions, records each
 * person/tag id->name into the supplied maps (so ActiveFiltersBar can label chips). Returns the
 * config unchanged when it has no suggestionsProvider. Pure: it does not mutate the input config.
 */
export function withNameCapture(
  config: FilterPanelConfig,
  personNames: Map<string, string>,
  tagNames: Map<string, string>,
): FilterPanelConfig {
  const provider = config.suggestionsProvider;
  if (!provider) {
    return config;
  }
  return {
    ...config,
    suggestionsProvider: async (filters: FilterState): Promise<FilterSuggestionsResponse> => {
      const result = await provider(filters);
      for (const person of result.people) {
        personNames.set(person.id, person.name);
      }
      for (const tag of result.tags) {
        tagNames.set(tag.id, tag.name);
      }
      return result;
    },
  };
}
