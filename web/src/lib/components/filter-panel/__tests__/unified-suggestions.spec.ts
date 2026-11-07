import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { FilterPanelConfig, FilterSection, FilterSuggestionsResponse } from '../filter-panel';
import FilterPanel from '../filter-panel.svelte';

const defaultResponse: FilterSuggestionsResponse = {
  countries: ['Germany', 'France'],
  cameraMakes: ['Canon', 'Sony'],
  tags: [
    { id: 't1', name: 'Vacation' },
    { id: 't2', name: 'Family' },
  ],
  people: [
    { id: 'p1', name: 'Alice', thumbnailUrl: '/people/p1/thumbnail' },
    { id: 'p2', name: 'Bob', thumbnailUrl: '/people/p2/thumbnail' },
  ],
  ratings: [3, 4, 5],
  mediaTypes: ['IMAGE', 'VIDEO'],
  hasUnnamedPeople: false,
  hasFavorites: true,
  hasAssetsInAlbum: true,
  hasAssetsNotInAlbum: true,
};

const timeBuckets = [
  { timeBucket: '2023-06-01', count: 100 },
  { timeBucket: '2024-03-01', count: 50 },
];

// These tests run under fake timers, so clicks are dispatched synchronously in the page rather than
// through the Playwright user path, whose round trip would wait on the faked clock.
const click = async (element: Element) => {
  (element as HTMLElement).click();
  await tick();
};

function createUnifiedConfig(overrides: Partial<FilterPanelConfig> = {}): FilterPanelConfig {
  return {
    sections: ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'],
    suggestionsProvider: vi.fn().mockResolvedValue(defaultResponse),
    ...overrides,
  };
}

describe('Unified suggestionsProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should fire suggestionsProvider on initial mount with default state', async () => {
    const config = createUnifiedConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(config.suggestionsProvider).toHaveBeenCalledTimes(1);
      expect(config.suggestionsProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          personIds: [],
          tagIds: [],
          mediaType: 'all',
          sortOrder: 'desc',
        }),
      );
    });
  });

  it('should update suggestions in DOM after response', async () => {
    const config = createUnifiedConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(page.getByText('Alice').element()).toBeTruthy();
      expect(page.getByText('Germany').element()).toBeTruthy();
    });
  });

  it('should debounce discrete filter changes at 50ms', async () => {
    const config = createUnifiedConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);
    expect(config.suggestionsProvider).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(page.getByText('Alice').element()).toBeTruthy());
    await click(page.getByText('Alice').element());

    expect(config.suggestionsProvider).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(50);

    await vi.waitFor(() => {
      expect(config.suggestionsProvider).toHaveBeenCalledTimes(2);
    });
  });

  it('should debounce temporal changes at 200ms', async () => {
    const config = createUnifiedConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    await click(page.getByTestId('year-btn-2023').element());

    await vi.advanceTimersByTimeAsync(50);
    expect(config.suggestionsProvider).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(150);

    await vi.waitFor(() => {
      expect(config.suggestionsProvider).toHaveBeenCalledTimes(2);
    });
  });

  it('should always show all 5 rating stars even when availableRatings is limited', async () => {
    const config = createUnifiedConfig({
      suggestionsProvider: vi.fn().mockResolvedValue({
        ...defaultResponse,
        ratings: [4, 5],
      }),
    });
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      for (const star of [1, 2, 3, 4, 5]) {
        expect(page.getByTestId(`rating-star-${star}`).element()).toBeTruthy();
      }
    });
  });

  it('should show all ratings when availableRatings is undefined (backward compat)', async () => {
    const config: FilterPanelConfig = {
      sections: ['rating'],
      providers: {},
    };
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    for (const star of [1, 2, 3, 4, 5]) {
      expect(page.getByTestId(`rating-star-${star}`).element()).toBeTruthy();
    }
  });

  it('should fall back to providers-based behavior when suggestionsProvider is not set', async () => {
    const peopleProvider = vi.fn().mockResolvedValue([{ id: 'p1', name: 'Alice' }]);
    const config: FilterPanelConfig = {
      sections: ['people'],
      providers: {
        people: peopleProvider,
      },
    };
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(peopleProvider).toHaveBeenCalledTimes(1);
      expect(page.getByText('Alice').element()).toBeTruthy();
    });
  });

  it('should work with suggestionsProvider and no providers', async () => {
    const config: FilterPanelConfig = {
      sections: ['people', 'location'],
      suggestionsProvider: vi.fn().mockResolvedValue(defaultResponse),
    };
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(page.getByText('Germany').element()).toBeTruthy();
    });
  });

  it('consumes the facets without dimming the controls (#910, feedback_no_dynamic_rating_media_hiding)', async () => {
    const suggestionsProvider = vi.fn().mockResolvedValue({
      ...defaultResponse,
      ratings: [2],
      mediaTypes: ['IMAGE', 'VIDEO'],
    });
    const config = { sections: ['rating', 'media'] as FilterSection[], suggestionsProvider };

    await render(FilterPanel, { config, timeBuckets: [] });

    // Every other test in this file advances fake timers before waiting for the same reason:
    // vi.waitFor polls on real timers and never advances the faked clock, so the initial-mount
    // debounce (0ms) needs a manual nudge or these hang for real until the test's own timeout.
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => expect(suggestionsProvider).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(page.getByTestId('rating-star-5').element()).toBeTruthy());

    // Re-introducing `availableRatings` would dim stars 1, 3, 4 and 5 here. Re-introducing
    // `availableMediaTypes` would drop a media button. Neither may happen.
    for (const star of [1, 2, 3, 4, 5]) {
      expect(page.getByTestId(`rating-star-${star}`).element().className).not.toContain('opacity-50');
    }
    for (const type of ['all', 'image', 'video']) {
      expect(page.getByTestId(`media-type-${type}`).element()).toBeTruthy();
    }
  });

  it('should pass active filters when fetching dependent cities', async () => {
    const citiesProvider = vi.fn().mockResolvedValue(['Berlin']);
    const config = createUnifiedConfig({
      providers: {
        cities: citiesProvider,
      },
    });
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(page.getByText('Alice').element()).toBeTruthy());

    await click(page.getByTestId('people-item-p1').element());
    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => expect(config.suggestionsProvider).toHaveBeenCalledTimes(2));

    await click(page.getByTestId('location-country-Germany').element());

    await vi.waitFor(() => {
      expect(citiesProvider).toHaveBeenCalledWith(
        'Germany',
        expect.objectContaining({
          personIds: ['p1'],
        }),
      );
    });
  });
});
