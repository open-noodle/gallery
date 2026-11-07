import { AssetTypeEnum } from '@immich/sdk';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import type { FilterContext, FilterPanelConfig, FilterSection, FilterSuggestionsResponse } from '../filter-panel';
import FilterPanel from '../filter-panel.svelte';

function createConfig(overrides: Partial<NonNullable<FilterPanelConfig['providers']>> = {}): FilterPanelConfig {
  return {
    sections: ['timeline', 'people', 'location', 'camera', 'tags'],
    providers: {
      people: vi.fn().mockResolvedValue([
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ]),
      locations: vi.fn().mockResolvedValue([
        { value: 'Germany', type: 'country' as const },
        { value: 'France', type: 'country' as const },
      ]),
      cameras: vi.fn().mockResolvedValue([
        { value: 'Canon', type: 'make' as const },
        { value: 'Sony', type: 'make' as const },
      ]),
      tags: vi.fn().mockResolvedValue([
        { id: 't1', name: 'Vacation' },
        { id: 't2', name: 'Family' },
      ]),
      ...overrides,
    },
  };
}

const timeBuckets = [
  { timeBucket: '2023-06-01', count: 100 },
  { timeBucket: '2023-08-01', count: 200 },
  { timeBucket: '2024-03-01', count: 50 },
];

const defaultSuggestions: FilterSuggestionsResponse = {
  countries: ['Germany', 'France'],
  cameraMakes: ['Canon', 'Sony'],
  tags: [
    { id: 't1', name: 'Vacation' },
    { id: 't2', name: 'Family' },
  ],
  people: [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
  ],
  ratings: [3, 4, 5],
  mediaTypes: ['IMAGE', 'VIDEO'],
  hasUnnamedPeople: false,
  hasFavorites: true,
  hasAssetsInAlbum: true,
  hasAssetsNotInAlbum: true,
};

describe('Contextual re-fetch on temporal change', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should re-fetch providers with temporal context when a year is selected', async () => {
    const config = createConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    expect(config.providers!.people).toHaveBeenCalledTimes(1);
    expect(config.providers!.locations).toHaveBeenCalledTimes(1);
    expect(config.providers!.cameras).toHaveBeenCalledTimes(1);

    // Click year to select 2023
    await userEvent.click(page.getByTestId('year-btn-2023'));

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(250);

    const expectedContext: FilterContext = {
      takenAfter: '2023-01-01T00:00:00.000Z',
      takenBefore: '2024-01-01T00:00:00.000Z',
    };

    await vi.waitFor(() => {
      expect(config.providers!.people).toHaveBeenCalledTimes(2);
      expect(config.providers!.people).toHaveBeenLastCalledWith(expectedContext);
      expect(config.providers!.locations).toHaveBeenLastCalledWith(expectedContext);
      expect(config.providers!.cameras).toHaveBeenLastCalledWith(expectedContext);
      expect(config.providers!.tags).toHaveBeenCalledTimes(2);
      expect(config.providers!.tags).toHaveBeenLastCalledWith(expectedContext);
    });
  });

  it('should re-fetch tags with temporal context when a year is selected', async () => {
    const config = createConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    expect(config.providers!.tags).toHaveBeenCalledTimes(1);

    // Click year to select 2023
    await userEvent.click(page.getByTestId('year-btn-2023'));

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(250);

    const expectedContext: FilterContext = {
      takenAfter: '2023-01-01T00:00:00.000Z',
      takenBefore: '2024-01-01T00:00:00.000Z',
    };

    await vi.waitFor(() => {
      expect(config.providers!.tags).toHaveBeenCalledTimes(2);
      expect(config.providers!.tags).toHaveBeenLastCalledWith(expectedContext);
    });
  });

  it('should re-fetch with full-year bounds when only year is selected', async () => {
    const config = createConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    await userEvent.click(page.getByTestId('year-btn-2024'));
    await vi.advanceTimersByTimeAsync(250);

    await vi.waitFor(() => {
      expect(config.providers!.people).toHaveBeenLastCalledWith({
        takenAfter: '2024-01-01T00:00:00.000Z',
        takenBefore: '2025-01-01T00:00:00.000Z',
      });
    });
  });

  it('should debounce rapid temporal changes — year then quickly month yields limited calls', async () => {
    const config = createConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    const initialCalls = (config.providers!.people as ReturnType<typeof vi.fn>).mock.calls.length;

    // Click year — this triggers a 200ms debounce for the year context
    await userEvent.click(page.getByTestId('year-btn-2023'));

    // Wait for the year debounce to fire
    await vi.advanceTimersByTimeAsync(250);

    // Now click month (month grid is visible after year selection)
    await userEvent.click(page.getByTestId('month-btn-6'));

    // Wait for month debounce
    await vi.advanceTimersByTimeAsync(250);

    await vi.waitFor(() => {
      const finalCalls = (config.providers!.people as ReturnType<typeof vi.fn>).mock.calls.length;
      // Year triggers 1 re-fetch, month triggers another → exactly 2 extra
      expect(finalCalls - initialCalls).toBe(2);
    });
  });

  it('should NOT trigger re-fetch when non-temporal filters change', async () => {
    const config = createConfig();
    await render(FilterPanel, {
      config: { ...config, sections: ['people', 'rating', 'media'] },
      timeBuckets: [],
    });

    await vi.advanceTimersByTimeAsync(0);

    const initialCalls = (config.providers!.people as ReturnType<typeof vi.fn>).mock.calls.length;

    // Advance time — no temporal change happens, so no re-fetch
    await vi.advanceTimersByTimeAsync(500);

    expect((config.providers!.people as ReturnType<typeof vi.fn>).mock.calls.length).toBe(initialCalls);
  });

  it('should bypass debounce on clear (immediate re-fetch with no context)', async () => {
    const config = createConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    // Select year first
    await userEvent.click(page.getByTestId('year-btn-2023'));
    await vi.advanceTimersByTimeAsync(250);

    const callsAfterYear = (config.providers!.people as ReturnType<typeof vi.fn>).mock.calls.length;

    // Click "All" breadcrumb to clear temporal filter
    await userEvent.click(page.getByTestId('temporal-breadcrumb-all'));

    // Advance just 1ms — clear should fire immediately (delay=0)
    await vi.advanceTimersByTimeAsync(1);

    await vi.waitFor(() => {
      const finalCalls = (config.providers!.people as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(finalCalls).toBeGreaterThan(callsAfterYear);
      expect(config.providers!.people).toHaveBeenLastCalledWith(undefined);
    });
  });

  it('should keep stale data on fetch error', async () => {
    const peopleFn = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'p1', name: 'Alice' }])
      .mockRejectedValueOnce(new Error('Network error'));

    const config = createConfig({ people: peopleFn });
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(page.getByTestId('people-item-p1').element()).toBeTruthy();
    });

    // Select year to trigger re-fetch (which will fail)
    await userEvent.click(page.getByTestId('year-btn-2023'));
    await vi.advanceTimersByTimeAsync(250);

    // Allow promise rejection to settle
    await vi.advanceTimersByTimeAsync(0);

    // Stale data should still be visible
    expect(page.getByTestId('people-item-p1').element()).toBeTruthy();
  });

  it('should produce correct UTC ISO strings for month temporal ranges', async () => {
    const config = createConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    // Select year first
    await userEvent.click(page.getByTestId('year-btn-2023'));
    await vi.advanceTimersByTimeAsync(250);

    // Now select month (August — month 8)
    await userEvent.click(page.getByTestId('month-btn-8'));
    await vi.advanceTimersByTimeAsync(250);

    await vi.waitFor(() => {
      expect(config.providers!.people).toHaveBeenLastCalledWith({
        takenAfter: '2023-08-01T00:00:00.000Z',
        takenBefore: '2023-09-01T00:00:00.000Z',
      });
    });
  });

  it('should re-fetch unified suggestions when custom from date changes and narrow people and tags', async () => {
    const secondSuggestions: FilterSuggestionsResponse = {
      ...defaultSuggestions,
      people: [{ id: 'p1', name: 'Alice' }],
      tags: [{ id: 't1', name: 'Vacation' }],
    };
    const suggestionsProvider = vi
      .fn()
      .mockResolvedValueOnce(defaultSuggestions)
      .mockResolvedValueOnce(secondSuggestions);
    const config: FilterPanelConfig = {
      sections: ['timeline', 'people', 'tags'],
      suggestionsProvider,
    };

    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => {
      expect(page.getByTestId('people-item-p2').element()).toBeTruthy();
      expect(page.getByTestId('tags-item-t2').element()).toBeTruthy();
    });

    await userEvent.fill(page.getByTestId('custom-date-from-input'), '2024-01-01');
    await vi.advanceTimersByTimeAsync(200);

    await vi.waitFor(() => {
      expect(suggestionsProvider).toHaveBeenCalledTimes(2);
      expect(suggestionsProvider).toHaveBeenLastCalledWith(
        expect.objectContaining({
          dateAfter: '2024-01-01',
          dateBefore: undefined,
          selectedYear: undefined,
          selectedMonth: undefined,
        }),
      );
      expect(page.getByTestId('people-item-p1').element()).toBeTruthy();
      expect(page.getByTestId('people-item-p2').query()).toBeNull();
      expect(page.getByTestId('tags-item-t1').element()).toBeTruthy();
      expect(page.getByTestId('tags-item-t2').query()).toBeNull();
    });
  });

  it('should clear selected year when custom from date changes', async () => {
    const config = createConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);
    await userEvent.click(page.getByTestId('year-btn-2023'));
    await vi.advanceTimersByTimeAsync(250);
    expect(page.getByTestId('month-grid').element()).toBeTruthy();

    await userEvent.fill(page.getByTestId('custom-date-from-input'), '2024-01-01');
    await vi.advanceTimersByTimeAsync(250);

    await vi.waitFor(() => {
      expect(page.getByTestId('month-grid').query()).toBeNull();
      expect(page.getByTestId('year-grid').element()).toBeTruthy();
      expect(config.providers!.people).toHaveBeenLastCalledWith({
        takenAfter: '2024-01-01T00:00:00.000Z',
      });
    });
  });

  it('should clear selected year and month when custom to date changes', async () => {
    const config = createConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);
    await userEvent.click(page.getByTestId('year-btn-2023'));
    await vi.advanceTimersByTimeAsync(250);
    await userEvent.click(page.getByTestId('month-btn-8'));
    await vi.advanceTimersByTimeAsync(250);
    expect(page.getByTestId('month-grid').element()).toBeTruthy();

    await userEvent.fill(page.getByTestId('custom-date-to-input'), '2024-12-31');
    await vi.advanceTimersByTimeAsync(250);

    await vi.waitFor(() => {
      expect(page.getByTestId('month-grid').query()).toBeNull();
      expect(page.getByTestId('year-grid').element()).toBeTruthy();
      expect(config.providers!.people).toHaveBeenLastCalledWith({
        takenBefore: '2025-01-01T00:00:00.000Z',
      });
    });
  });

  it('should clear custom dates when selecting a year', async () => {
    const config = createConfig();
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);
    await userEvent.fill(page.getByTestId('custom-date-from-input'), '2024-01-01');
    await userEvent.fill(page.getByTestId('custom-date-to-input'), '2024-12-31');
    await vi.advanceTimersByTimeAsync(250);

    await userEvent.click(page.getByTestId('year-btn-2023'));
    await vi.advanceTimersByTimeAsync(250);

    await vi.waitFor(() => {
      expect(page.getByTestId('custom-date-from-input').element()).toHaveValue('');
      expect(page.getByTestId('custom-date-to-input').element()).toHaveValue('');
      expect(config.providers!.people).toHaveBeenLastCalledWith({
        takenAfter: '2023-01-01T00:00:00.000Z',
        takenBefore: '2024-01-01T00:00:00.000Z',
      });
    });
  });

  it('should clear custom dates when selecting a month', async () => {
    const config = createConfig();
    await render(FilterPanel, {
      config,
      timeBuckets,
      filters: {
        personIds: [],
        tagIds: [],
        mediaType: 'all',
        sortOrder: 'desc',
        dateAfter: '2024-01-01',
        dateBefore: '2024-12-31',
        selectedYear: 2023,
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await userEvent.click(page.getByTestId('month-btn-8'));
    await vi.advanceTimersByTimeAsync(250);

    await vi.waitFor(() => {
      expect(page.getByTestId('custom-date-from-input').element()).toHaveValue('');
      expect(page.getByTestId('custom-date-to-input').element()).toHaveValue('');
      expect(config.providers!.people).toHaveBeenLastCalledWith({
        takenAfter: '2023-08-01T00:00:00.000Z',
        takenBefore: '2023-09-01T00:00:00.000Z',
      });
    });
  });

  it('should pass the full cross-dimension context to dependent city and camera model providers', async () => {
    const cities = vi.fn().mockResolvedValue(['Berlin']);
    const cameraModels = vi.fn().mockResolvedValue(['EOS R5']);
    const config = createConfig({ cities, cameraModels });
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);
    await userEvent.fill(page.getByTestId('custom-date-from-input'), '2024-01-01');
    await vi.advanceTimersByTimeAsync(250);

    await userEvent.click(page.getByTestId('location-country-Germany'));
    await userEvent.click(page.getByTestId('camera-make-Canon'));

    await vi.waitFor(() => {
      expect(cities).toHaveBeenLastCalledWith('Germany', {
        takenAfter: '2024-01-01T00:00:00.000Z',
        make: 'Canon',
      });
      expect(cameraModels).toHaveBeenLastCalledWith('Canon', {
        takenAfter: '2024-01-01T00:00:00.000Z',
        country: 'Germany',
      });
    });
  });

  it('should pass the media type to dependent city and camera model providers', async () => {
    const cities = vi.fn().mockResolvedValue(['Berlin']);
    const cameraModels = vi.fn().mockResolvedValue(['EOS R5']);
    const config = {
      ...createConfig({ cities, cameraModels }),
      sections: ['location', 'camera', 'media'] as FilterSection[],
    };
    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);

    await userEvent.click(page.getByTestId('location-country-Germany'));
    await userEvent.click(page.getByTestId('camera-make-Canon'));
    await userEvent.click(page.getByTestId('media-type-video'));

    await vi.waitFor(() => {
      expect(cities).toHaveBeenLastCalledWith('Germany', {
        make: 'Canon',
        mediaType: AssetTypeEnum.Video,
      });
      expect(cameraModels).toHaveBeenLastCalledWith('Canon', {
        country: 'Germany',
        mediaType: AssetTypeEnum.Video,
      });
    });
  });

  it('should pass the state, lens and contributor narrowings to the dependent providers', async () => {
    const cities = vi.fn().mockResolvedValue(['Munich']);
    const cameraModels = vi.fn().mockResolvedValue(['Canon EOS R6']);
    const config = createConfig({ cities, cameraModels });

    // A state and a lens can only ARRIVE pinned — from a contextual filter clicked in the asset
    // viewer, typed search or a link — so the scenario is "the panel opens with them already set",
    // not "the user clicks them". (Clicking a country would replace the whole location group and
    // clear the state, which is why the city list must not be narrowed by it.)
    await render(FilterPanel, {
      config,
      timeBuckets,
      filters: {
        personIds: [],
        tagIds: [],
        mediaType: 'all',
        sortOrder: 'desc',
        country: 'Germany',
        state: 'Bavaria',
        make: 'Canon',
        model: 'Canon EOS R6',
        lensModel: 'RF24-105mm F4 L IS USM',
        ownerId: 'owner-1',
      },
    });

    await vi.advanceTimersByTimeAsync(250);

    await vi.waitFor(() => {
      // The location group is self-excluded, so the pinned state is NOT sent to the city list …
      expect(cities).toHaveBeenLastCalledWith('Germany', {
        make: 'Canon',
        model: 'Canon EOS R6',
        lensModel: 'RF24-105mm F4 L IS USM',
        ownerId: 'owner-1',
      });
      // … but it does narrow the camera-model list, alongside the lens and the contributor.
      expect(cameraModels).toHaveBeenLastCalledWith('Canon', {
        country: 'Germany',
        state: 'Bavaria',
        lensModel: 'RF24-105mm F4 L IS USM',
        ownerId: 'owner-1',
      });
    });
  });

  it('should send the state, lens and contributor narrowings to the unified suggestions provider', async () => {
    const narrowed: FilterSuggestionsResponse = {
      ...defaultSuggestions,
      people: [{ id: 'p1', name: 'Alice' }],
      tags: [{ id: 't1', name: 'Vacation' }],
    };
    const suggestionsProvider = vi.fn().mockResolvedValue(narrowed);
    const config: FilterPanelConfig = {
      sections: ['people', 'tags'],
      suggestionsProvider,
    };

    await render(FilterPanel, {
      config,
      timeBuckets,
      filters: {
        personIds: [],
        tagIds: [],
        mediaType: 'all',
        sortOrder: 'desc',
        state: 'Bavaria',
        lensModel: 'RF24-105mm F4 L IS USM',
        ownerId: 'owner-1',
      },
    });

    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      // The provider reads the state this effect reconstructs, so an untracked field is an unsent
      // one — these three have to survive the round trip for the lists to narrow at all.
      expect(suggestionsProvider).toHaveBeenLastCalledWith(
        expect.objectContaining({
          state: 'Bavaria',
          lensModel: 'RF24-105mm F4 L IS USM',
          ownerId: 'owner-1',
        }),
      );
      // …and the narrowed lists it returns are what the panel renders.
      expect(page.getByTestId('people-item-p1').element()).toBeTruthy();
      expect(page.getByTestId('people-item-p2').query()).toBeNull();
      expect(page.getByTestId('tags-item-t1').element()).toBeTruthy();
      expect(page.getByTestId('tags-item-t2').query()).toBeNull();
    });
  });

  it('should keep the empty-section disable gate off for a state, lens or contributor filter only', async () => {
    // #858 §3.3 decision 3: the count/disable gate answers "has a cross-section filter narrowed the
    // panel?" and must keep today's behaviour. A section with an empty list renders "(0)" and is
    // disabled only when that gate is on; these three arrive from a contextual filter or a link, so
    // turning it on for them would be a separate UX change.
    const suggestionsProvider = vi.fn().mockResolvedValue({
      ...defaultSuggestions,
      people: [],
      tags: [],
    });
    const config: FilterPanelConfig = { sections: ['people', 'tags'], suggestionsProvider };

    await render(FilterPanel, {
      config,
      timeBuckets,
      filters: {
        personIds: [],
        tagIds: [],
        mediaType: 'all',
        sortOrder: 'desc',
        state: 'Bavaria',
        lensModel: 'RF24-105mm F4 L IS USM',
        ownerId: 'owner-1',
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(suggestionsProvider).toHaveBeenCalled());

    for (const section of ['people', 'tags']) {
      const button = page.getByTestId(`filter-section-${section}`).element().querySelector('button')!;
      expect(button.textContent).not.toContain('(0)');
      expect(button.hasAttribute('disabled')).toBe(false);
    }
  });

  it('should keep rating and media controls stable after custom date changes', async () => {
    const secondSuggestions: FilterSuggestionsResponse = {
      ...defaultSuggestions,
      ratings: [5],
      mediaTypes: ['IMAGE'],
    };
    const suggestionsProvider = vi
      .fn()
      .mockResolvedValueOnce(defaultSuggestions)
      .mockResolvedValueOnce(secondSuggestions);
    const config: FilterPanelConfig = {
      sections: ['timeline', 'rating', 'media'],
      suggestionsProvider,
    };

    await render(FilterPanel, { config, timeBuckets });

    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => {
      expect(page.getByTestId('rating-star-1').element()).toBeTruthy();
      expect(page.getByTestId('media-type-video').element()).toBeTruthy();
    });

    await userEvent.fill(page.getByTestId('custom-date-from-input'), '2024-01-01');
    await vi.advanceTimersByTimeAsync(200);

    await vi.waitFor(() => {
      expect(suggestionsProvider).toHaveBeenCalledTimes(2);
      for (const star of [1, 2, 3, 4, 5]) {
        expect(page.getByTestId(`rating-star-${star}`).element()).toBeTruthy();
      }
      expect(page.getByTestId('media-type-image').element()).toBeTruthy();
      expect(page.getByTestId('media-type-video').element()).toBeTruthy();
    });
  });
});
