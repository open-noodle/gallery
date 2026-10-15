import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import {
  createFilterState,
  type FilterPanelConfig,
  type FilterState,
  type FilterSuggestionsResponse,
} from '../filter-panel';
import FilterPanel from '../filter-panel.svelte';

/**
#989: the Explore strip and the Places grid linked to `/photos?city=…` with no `country`, and the
reporter saw the city "displayed at the same (first) level as the rest of the countries" instead
of nested beneath its country.

The link fix (Route.photos carrying `country`) lives in route.spec.ts / explore-page.spec.ts /
places-card-group.spec.ts. This file pins the panel behaviour that fix depends on: the panel
genuinely renders the two cases at DIFFERENT levels, so a change here can't silently make the
country param pointless and re-open the report.

The discriminator is the `ml-5` indent, which only the in-country city row carries — the
country-less fallback row (location-filter.svelte, the `selectedCity && !selectedCountry` block)
sits flush with the country rows by design, because it has no country block to sit inside.
*/

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

const suggestions = (overrides: Partial<FilterSuggestionsResponse> = {}): FilterSuggestionsResponse => ({
  countries: [],
  cameraMakes: [],
  tags: [],
  people: [],
  ratings: [],
  mediaTypes: [],
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: false,
  // Both off, so the absence-of-location rows stay out of the list and the nesting assertions
  // below still see nothing between the search box and the country rows.
  hasNoGpsAssets: false,
  hasNoPlaceNameAssets: false,
  ...overrides,
});

const CITIES: Record<string, string[]> = {
  'South Africa': ['Cape Town', 'Durban'],
  Germany: ['Berlin'],
};

const config: FilterPanelConfig = {
  sections: ['location'],
  suggestionsProvider: () => Promise.resolve(suggestions({ countries: ['South Africa', 'Germany'] })),
  providers: { cities: (country: string) => Promise.resolve(CITIES[country] ?? []) },
};

const renderPanel = (filters: Partial<FilterState>) =>
  render(FilterPanel, { config, timeBuckets: [], filters: { ...createFilterState(), ...filters } });

describe('a city hydrated from the URL', () => {
  beforeEach(() => localStorage.clear());

  it('nests under its country, ticked, when the country came along', async () => {
    await renderPanel({ city: 'Cape Town', country: 'South Africa' });

    // The country block auto-expands to reveal the level the selection lives on.
    await expect.element(page.getByTestId('location-city-Cape Town')).toBeInTheDocument();
    const city = page.getByTestId('location-city-Cape Town').element();
    expect(city.className).toContain('ml-5');
    expect(city.querySelector('.bg-immich-primary')).not.toBeNull();

    // Its sibling city proves the row really is the country's expanded list, not a lone fallback.
    await expect.element(page.getByTestId('location-city-Durban')).toBeInTheDocument();
    await expect.element(page.getByTestId('location-country-South Africa')).toBeInTheDocument();
  });

  it('sits flat beside the countries — the reported #989 symptom — when the country is missing', async () => {
    await renderPanel({ city: 'Cape Town' });

    await expect.element(page.getByTestId('location-city-Cape Town')).toBeInTheDocument();
    const city = page.getByTestId('location-city-Cape Town').element();
    expect(city.className).not.toContain('ml-5');

    // No country expanded, so no sibling city is rendered anywhere.
    expect(page.getByTestId('location-city-Durban').query()).toBeNull();
  });
});
