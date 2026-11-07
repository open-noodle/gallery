import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import CameraFilter from '../camera-filter.svelte';
import type { PersonOption } from '../filter-panel';
import FilterPanel from '../filter-panel.svelte';
import LocationFilter from '../location-filter.svelte';
import PeopleFilter from '../people-filter.svelte';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

const mockPeople: PersonOption[] = [
  { id: 'p1', name: 'Sarah Chen' },
  { id: 'p2', name: 'Max Chen' },
  { id: 'p3', name: 'Li Wei' },
  { id: 'p4', name: 'Anna Schmidt' },
  { id: 'p5', name: 'Tom Brown' },
  { id: 'p6', name: 'Jane Doe' },
  { id: 'p7', name: 'Alex Kim' },
];

describe('PeopleFilter', () => {
  it('should render people with checkboxes', async () => {
    const { getByTestId } = await render(PeopleFilter, {
      props: {
        people: mockPeople.slice(0, 3),
        selectedIds: [],
        onSelectionChange: () => {},
      },
    });
    expect(getByTestId('people-item-p1').element()).toBeTruthy();
    expect(getByTestId('people-item-p2').element()).toBeTruthy();
    expect(getByTestId('people-item-p3').element()).toBeTruthy();
  });

  it('should support multi-select (selecting B keeps A selected)', async () => {
    let selected: string[] = [];
    const onSelectionChange = (ids: string[]) => {
      selected = ids;
    };

    const { getByTestId, rerender } = await render(PeopleFilter, {
      props: {
        people: mockPeople.slice(0, 3),
        selectedIds: [],
        onSelectionChange,
      },
    });

    // Select first person
    await userEvent.click(getByTestId('people-item-p1'));
    expect(selected).toEqual(['p1']);

    // Rerender with new selectedIds to simulate parent state update
    await rerender({
      people: mockPeople.slice(0, 3),
      selectedIds: ['p1'],
      onSelectionChange,
    });

    // Select second person
    await userEvent.click(getByTestId('people-item-p2'));
    expect(selected).toEqual(['p1', 'p2']);
  });

  it('should deselect and remove from selection array', async () => {
    let selected: string[] = [];
    const onSelectionChange = (ids: string[]) => {
      selected = ids;
    };

    const { getByTestId } = await render(PeopleFilter, {
      props: {
        people: mockPeople.slice(0, 3),
        selectedIds: ['p1', 'p2'],
        onSelectionChange,
      },
    });

    // Deselect p1
    await userEvent.click(getByTestId('people-item-p1'));
    expect(selected).toEqual(['p2']);
  });

  it('should emit correct filter state with selected ids', async () => {
    let selected: string[] = [];
    const onSelectionChange = (ids: string[]) => {
      selected = ids;
    };

    const { getByTestId } = await render(PeopleFilter, {
      props: {
        people: mockPeople.slice(0, 3),
        selectedIds: [],
        onSelectionChange,
      },
    });

    await userEvent.click(getByTestId('people-item-p3'));
    expect(selected).toEqual(['p3']);
  });

  it('should filter list via search input', async () => {
    const { getByTestId } = await render(PeopleFilter, {
      props: {
        people: mockPeople.slice(0, 5),
        selectedIds: [],
        onSelectionChange: () => {},
      },
    });

    const searchInput = getByTestId('people-search-input').element();
    await userEvent.fill(searchInput, 'Chen');

    // Sarah Chen and Max Chen should be visible
    expect(getByTestId('people-item-p1').query()).toBeTruthy();
    expect(getByTestId('people-item-p2').query()).toBeTruthy();
    // Others should be hidden
    expect(getByTestId('people-item-p3').query()).toBeNull();
    expect(getByTestId('people-item-p4').query()).toBeNull();
    expect(getByTestId('people-item-p5').query()).toBeNull();
  });

  it('should show "Show N more" when list exceeds 5 items', async () => {
    const { getByTestId } = await render(PeopleFilter, {
      props: {
        people: mockPeople,
        selectedIds: [],
        onSelectionChange: () => {},
      },
    });

    // First 5 should be visible
    expect(getByTestId('people-item-p1').query()).toBeTruthy();
    expect(getByTestId('people-item-p5').query()).toBeTruthy();
    // 6th and 7th should be hidden
    expect(getByTestId('people-item-p6').query()).toBeNull();
    expect(getByTestId('people-item-p7').query()).toBeNull();

    // "Show 2 more" link should appear
    const showMore = getByTestId('people-show-more').element();
    expect(showMore.textContent).toContain('Show 2 more');
  });

  it('should expand list when "Show N more" is clicked', async () => {
    const { getByTestId } = await render(PeopleFilter, {
      props: {
        people: mockPeople,
        selectedIds: [],
        onSelectionChange: () => {},
      },
    });

    await userEvent.click(getByTestId('people-show-more'));

    // Now all 7 should be visible
    expect(getByTestId('people-item-p6').query()).toBeTruthy();
    expect(getByTestId('people-item-p7').query()).toBeTruthy();
  });

  it('should render thumbnail images when thumbnailUrl is provided', async () => {
    const people: PersonOption[] = [
      { id: '1', name: 'Alice', thumbnailUrl: '/shared-spaces/s1/people/1/thumbnail' },
      { id: '2', name: 'Bob', thumbnailUrl: '/shared-spaces/s1/people/2/thumbnail' },
    ];
    const { container } = await render(PeopleFilter, {
      props: { people, selectedIds: [], onSelectionChange: vi.fn() },
    });
    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute('src')).toBe('/shared-spaces/s1/people/1/thumbnail');
    expect(images[1].getAttribute('src')).toBe('/shared-spaces/s1/people/2/thumbnail');
  });

  it('should render gradient avatar when thumbnailUrl is not provided', async () => {
    const people: PersonOption[] = [{ id: '1', name: 'Alice' }];
    const { container, getByText } = await render(PeopleFilter, {
      props: { people, selectedIds: [], onSelectionChange: vi.fn() },
    });
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('A', { exact: true }).element()).toBeTruthy();
  });

  it('should show all search results without truncation', async () => {
    const { getByTestId } = await render(PeopleFilter, {
      props: {
        people: mockPeople,
        selectedIds: [],
        onSelectionChange: () => {},
      },
    });

    // Search for "Chen" — should match Sarah Chen and Max Chen (2 results)
    // But also test with more results: search for common substring
    const searchInput = getByTestId('people-search-input').element();
    await userEvent.fill(searchInput, 'Chen');

    // Both matches should be visible (not truncated)
    expect(getByTestId('people-item-p1').query()).toBeTruthy();
    expect(getByTestId('people-item-p2').query()).toBeTruthy();
    // Non-matches hidden
    expect(getByTestId('people-item-p3').query()).toBeNull();
  });

  it('should show all search results even when more than INITIAL_SHOW_COUNT match', async () => {
    // Create 8 people with similar names to exceed INITIAL_SHOW_COUNT of 5
    const manyPeople: PersonOption[] = [
      { id: 'p1', name: 'Smith Alice' },
      { id: 'p2', name: 'Smith Bob' },
      { id: 'p3', name: 'Smith Carol' },
      { id: 'p4', name: 'Smith Dave' },
      { id: 'p5', name: 'Smith Eve' },
      { id: 'p6', name: 'Smith Frank' },
      { id: 'p7', name: 'Smith Grace' },
      { id: 'p8', name: 'Jones Hank' },
    ];

    const { getByTestId } = await render(PeopleFilter, {
      props: {
        people: manyPeople,
        selectedIds: [],
        onSelectionChange: () => {},
      },
    });

    const searchInput = getByTestId('people-search-input').element();
    await userEvent.fill(searchInput, 'Smith');

    // All 7 Smith matches should be visible — no truncation at 5
    expect(getByTestId('people-item-p1').query()).toBeTruthy();
    expect(getByTestId('people-item-p2').query()).toBeTruthy();
    expect(getByTestId('people-item-p3').query()).toBeTruthy();
    expect(getByTestId('people-item-p4').query()).toBeTruthy();
    expect(getByTestId('people-item-p5').query()).toBeTruthy();
    expect(getByTestId('people-item-p6').query()).toBeTruthy();
    expect(getByTestId('people-item-p7').query()).toBeTruthy();
    // Non-match hidden
    expect(getByTestId('people-item-p8').query()).toBeNull();
  });

  it('should show empty message when no people', async () => {
    const { getByTestId } = await render(PeopleFilter, {
      props: {
        people: [],
        selectedIds: [],
        onSelectionChange: () => {},
      },
    });

    expect(getByTestId('people-empty').element().textContent).toBe('No people found');
  });

  it('should display orphaned selected person name from typed search cache', async () => {
    const { getByTestId } = await render(PeopleFilter, {
      props: {
        people: [{ id: 'p-other', name: 'Other Person' }],
        selectedIds: ['p-cat'],
        selectedNames: new Map([['p-cat', 'cat']]),
        onSelectionChange: () => {},
      },
    });

    const orphanItem = getByTestId('people-item-p-cat').element();
    expect(orphanItem.textContent).toContain('cat');
    expect(orphanItem.textContent).not.toContain('p-cat');
  });

  it('should show typed selected person even when suggestions are empty', async () => {
    const { getByTestId } = await render(PeopleFilter, {
      props: {
        people: [],
        selectedIds: ['p-cat'],
        selectedNames: new Map([['p-cat', 'cat']]),
        onSelectionChange: () => {},
      },
    });

    expect(getByTestId('people-empty').query()).toBeNull();
    expect(getByTestId('people-item-p-cat').element().textContent).toContain('cat');
  });
});

describe('LocationFilter', () => {
  const mockCountries = ['Germany', 'Italy', 'France'];
  const mockCityFetch = (country: string): Promise<string[]> => {
    const cityMap: Record<string, string[]> = {
      Germany: ['Munich', 'Berlin', 'Hamburg'],
      Italy: ['Rome', 'Milan'],
      France: ['Paris', 'Lyon'],
    };
    return Promise.resolve(cityMap[country] ?? []);
  };

  it('should render countries with radio buttons', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: mockCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    expect(getByTestId('location-country-Germany').element()).toBeTruthy();
    expect(getByTestId('location-country-Italy').element()).toBeTruthy();
    expect(getByTestId('location-country-France').element()).toBeTruthy();
  });

  it('should be single-select (selecting B deselects A)', async () => {
    let lastCountry: string | undefined;
    let lastCity: string | undefined;
    const onSelectionChange = (country?: string, city?: string) => {
      lastCountry = country;
      lastCity = city;
    };

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: mockCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange,
      },
    });

    // Select Germany
    await userEvent.click(getByTestId('location-country-Germany'));
    expect(lastCountry).toBe('Germany');
    expect(lastCity).toBeUndefined();

    // Select Italy (should deselect Germany)
    await userEvent.click(getByTestId('location-country-Italy'));
    expect(lastCountry).toBe('Italy');
    expect(lastCity).toBeUndefined();
  });

  it('should show cities when country is expanded', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: mockCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    await userEvent.click(getByTestId('location-country-Germany'));

    // Wait for async city fetch
    await vi.waitFor(() => {
      expect(getByTestId('location-city-Munich').query()).toBeTruthy();
      expect(getByTestId('location-city-Berlin').query()).toBeTruthy();
      expect(getByTestId('location-city-Hamburg').query()).toBeTruthy();
    });
  });

  it('should cap expanded city lists and expand cities with city-level show more', async () => {
    const cities = Array.from({ length: 12 }, (_, index) => `City ${index + 1}`);

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['Germany'],
        onCityFetch: () => Promise.resolve(cities),
        onSelectionChange: () => {},
      },
    });

    await userEvent.click(getByTestId('location-country-Germany'));

    await vi.waitFor(() => {
      expect(getByTestId('location-city-City 1').query()).toBeTruthy();
      expect(getByTestId('location-city-City 10').query()).toBeTruthy();
      expect(getByTestId('location-city-City 11').query()).toBeNull();
      expect(getByTestId('location-city-City 12').query()).toBeNull();
      expect(getByTestId('location-city-show-more-Germany').element().textContent).toContain('Show 2 more');
    });

    await userEvent.click(getByTestId('location-city-show-more-Germany'));

    expect(getByTestId('location-city-City 11').query()).toBeTruthy();
    expect(getByTestId('location-city-City 12').query()).toBeTruthy();
  });

  it('should keep a selected city visible when it is outside the initial city cap', async () => {
    const cities = Array.from({ length: 12 }, (_, index) => `City ${index + 1}`);
    const onSelectionChange = vi.fn();

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['Germany'],
        selectedCountry: 'Germany',
        selectedCity: 'City 11',
        onCityFetch: () => Promise.resolve(cities),
        onSelectionChange,
      },
    });

    await vi.waitFor(() => {
      expect(getByTestId('location-city-City 9').query()).toBeTruthy();
      expect(getByTestId('location-city-City 10').query()).toBeNull();
      expect(getByTestId('location-city-City 11').query()).toBeTruthy();
      expect(getByTestId('location-city-City 12').query()).toBeNull();
      expect(getByTestId('location-city-show-more-Germany').query()).toBeTruthy();
    });
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('should mark a city-only selection as selected under its matching country', async () => {
    const onSelectionChange = vi.fn();

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['United States of America'],
        selectedCity: 'New York City',
        onCityFetch: () => Promise.resolve(['New York City', 'Seattle']),
        onSelectionChange,
      },
    });

    await userEvent.click(getByTestId('location-country-United States of America'));
    onSelectionChange.mockClear();

    await vi.waitFor(() => expect(getByTestId('location-city-New York City').query()).toBeTruthy());
    const selectedCity = getByTestId('location-city-New York City').element();
    expect(selectedCity.className).toContain('font-medium');
    expect(selectedCity.textContent).toContain('New York City');
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('should show a selected city-only filter before a country is expanded', async () => {
    const onSelectionChange = vi.fn();

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['United States of America'],
        selectedCity: 'New York City',
        onCityFetch: () => Promise.resolve(['New York City', 'Seattle']),
        onSelectionChange,
      },
    });

    const selectedCity = getByTestId('location-city-New York City').element();
    expect(selectedCity.className).toContain('font-medium');
    expect(selectedCity.textContent).toContain('New York City');
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('should clear a city-only selection when clicking the selected city', async () => {
    const onSelectionChange = vi.fn();

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['United States of America'],
        selectedCity: 'New York City',
        onCityFetch: () => Promise.resolve(['New York City', 'Seattle']),
        onSelectionChange,
      },
    });

    await userEvent.click(getByTestId('location-country-United States of America'));
    await vi.waitFor(() => expect(getByTestId('location-city-New York City').query()).toBeTruthy());
    onSelectionChange.mockClear();

    await userEvent.click(getByTestId('location-city-New York City'));

    expect(onSelectionChange).toHaveBeenCalledWith(undefined, undefined);
  });

  it('should keep a selected city visible when it does not match the active search', async () => {
    const onSelectionChange = vi.fn();

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['Germany', 'Italy'],
        selectedCountry: 'Germany',
        selectedCity: 'Berlin',
        onCityFetch: () => Promise.resolve(['Berlin', 'Munich']),
        onSelectionChange,
      },
    });

    await vi.waitFor(() => expect(getByTestId('location-city-Berlin').query()).toBeTruthy());

    await userEvent.fill(getByTestId('location-search-input'), 'Italy');

    expect(getByTestId('location-country-Germany').query()).toBeTruthy();
    expect(getByTestId('location-city-Berlin').query()).toBeTruthy();
    expect(getByTestId('location-country-Italy').query()).toBeTruthy();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('should expand hidden cities only for the selected country city list', async () => {
    const cityMap: Record<string, string[]> = {
      Germany: Array.from({ length: 12 }, (_, index) => `German City ${index + 1}`),
      France: Array.from({ length: 12 }, (_, index) => `French City ${index + 1}`),
    };

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['Germany', 'France'],
        onCityFetch: (country: string) => Promise.resolve(cityMap[country] ?? []),
        onSelectionChange: () => {},
      },
    });

    await userEvent.click(getByTestId('location-country-Germany'));
    await vi.waitFor(() => expect(getByTestId('location-city-show-more-Germany').query()).toBeTruthy());

    await userEvent.click(getByTestId('location-city-show-more-Germany'));
    expect(getByTestId('location-city-German City 11').query()).toBeTruthy();

    await userEvent.click(getByTestId('location-country-France'));
    await vi.waitFor(() => {
      expect(getByTestId('location-city-French City 10').query()).toBeTruthy();
      expect(getByTestId('location-city-French City 11').query()).toBeNull();
    });
  });

  it('should ignore stale city fetch responses after expanding another country', async () => {
    let resolveGermany!: (cities: string[]) => void;
    let resolveFrance!: (cities: string[]) => void;
    const germanyPromise = new Promise<string[]>((resolve) => {
      resolveGermany = resolve;
    });
    const francePromise = new Promise<string[]>((resolve) => {
      resolveFrance = resolve;
    });
    const onSelectionChange = vi.fn();
    const onCityFetch = vi.fn((country: string) => (country === 'Germany' ? germanyPromise : francePromise));

    const { getByTestId, rerender } = await render(LocationFilter, {
      props: {
        countries: ['Germany', 'France'],
        onCityFetch,
        onSelectionChange,
      },
    });

    await userEvent.click(getByTestId('location-country-Germany'));
    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledWith('Germany', undefined));
    await userEvent.click(getByTestId('location-country-France'));
    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledWith('France', undefined));
    await vi.waitFor(() => expect(getByTestId('location-city-French City 1').query()).toBeNull());

    resolveFrance(['French City 1']);
    await vi.waitFor(() => expect(getByTestId('location-city-French City 1').query()).toBeTruthy());
    await rerender({
      countries: ['Germany', 'France'],
      selectedCountry: 'France',
      selectedCity: 'French City 1',
      onCityFetch,
      onSelectionChange,
    });
    onSelectionChange.mockClear();

    resolveGermany(['German City 1']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vi.waitFor(() => {
      expect(getByTestId('location-city-French City 1').query()).toBeTruthy();
      expect(getByTestId('location-city-German City 1').query()).toBeNull();
    });
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('should ignore stale same-country city fetch responses after context changes', async () => {
    let resolveFirstGermany!: (cities: string[]) => void;
    let resolveSecondGermany!: (cities: string[]) => void;
    const firstGermanyPromise = new Promise<string[]>((resolve) => {
      resolveFirstGermany = resolve;
    });
    const secondGermanyPromise = new Promise<string[]>((resolve) => {
      resolveSecondGermany = resolve;
    });
    const germanyRequests = [firstGermanyPromise, secondGermanyPromise];
    const onCityFetch = vi.fn(() => germanyRequests.shift() ?? Promise.resolve([]));
    const onSelectionChange = vi.fn();

    const { getByTestId, rerender } = await render(LocationFilter, {
      props: {
        countries: ['Germany'],
        selectedCountry: 'Germany',
        selectedCity: 'Berlin',
        context: { takenAfter: '2026-01-01' },
        onCityFetch,
        onSelectionChange,
      },
    });

    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledTimes(1));
    await rerender({
      countries: ['Germany'],
      selectedCountry: 'Germany',
      selectedCity: 'Berlin',
      context: { takenAfter: '2026-02-01' },
      onCityFetch,
      onSelectionChange,
    });
    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledTimes(2));

    resolveSecondGermany(['Berlin']);
    await vi.waitFor(() => expect(getByTestId('location-city-Berlin').query()).toBeTruthy());
    onSelectionChange.mockClear();

    resolveFirstGermany(['Munich']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vi.waitFor(() => {
      expect(getByTestId('location-city-Berlin').query()).toBeTruthy();
      expect(getByTestId('location-city-Munich').query()).toBeNull();
    });
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('should recover when a city fetch rejects and another country is selected', async () => {
    let rejectGermany!: (error: Error) => void;
    let resolveFrance!: (cities: string[]) => void;
    const germanyPromise = new Promise<string[]>((_, reject) => {
      rejectGermany = reject;
    });
    const francePromise = new Promise<string[]>((resolve) => {
      resolveFrance = resolve;
    });
    const onCityFetch = vi.fn((country: string) => (country === 'Germany' ? germanyPromise : francePromise));
    const onSelectionChange = vi.fn();

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['Germany', 'France'],
        onCityFetch,
        onSelectionChange,
      },
    });

    await userEvent.click(getByTestId('location-country-Germany'));
    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledWith('Germany', undefined));

    rejectGermany(new Error('city fetch failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await userEvent.click(getByTestId('location-country-France'));
    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledWith('France', undefined));

    resolveFrance(['Paris']);
    await vi.waitFor(() => {
      expect(getByTestId('location-city-Paris').query()).toBeTruthy();
      expect(getByTestId('location-city-Munich').query()).toBeNull();
    });
    expect(onSelectionChange).toHaveBeenCalledWith('France', undefined);
  });

  it('should not render prior country cities when the next country fetch rejects', async () => {
    let resolveGermany!: (cities: string[]) => void;
    let rejectFrance!: (error: Error) => void;
    const germanyPromise = new Promise<string[]>((resolve) => {
      resolveGermany = resolve;
    });
    const francePromise = new Promise<string[]>((_, reject) => {
      rejectFrance = reject;
    });
    const onCityFetch = vi.fn((country: string) => (country === 'Germany' ? germanyPromise : francePromise));
    const onSelectionChange = vi.fn();

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['Germany', 'France'],
        onCityFetch,
        onSelectionChange,
      },
    });

    await userEvent.click(getByTestId('location-country-Germany'));
    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledWith('Germany', undefined));

    resolveGermany(['Munich']);
    await vi.waitFor(() => expect(getByTestId('location-city-Munich').query()).toBeTruthy());

    await userEvent.click(getByTestId('location-country-France'));
    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledWith('France', undefined));
    onSelectionChange.mockClear();

    rejectFrance(new Error('city fetch failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await vi.waitFor(() => {
      expect(getByTestId('location-city-Munich').query()).toBeNull();
      expect(getByTestId('location-country-France').element()).toBeTruthy();
    });
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('should not show city-level show more for countries with no cities', async () => {
    const fetchPromise = Promise.resolve([]);
    const onCityFetch = vi.fn(() => fetchPromise);

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['Germany'],
        onCityFetch,
        onSelectionChange: () => {},
      },
    });

    await userEvent.click(getByTestId('location-country-Germany'));
    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledTimes(1));
    await fetchPromise;

    await vi.waitFor(() => {
      expect(getByTestId('location-city-show-more-Germany').query()).toBeNull();
    });
  });

  it('should auto-fill country when city is selected', async () => {
    let lastCountry: string | undefined;
    let lastCity: string | undefined;
    const onSelectionChange = (country?: string, city?: string) => {
      lastCountry = country;
      lastCity = city;
    };

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: mockCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange,
      },
    });

    // First expand Germany
    await userEvent.click(getByTestId('location-country-Germany'));

    await vi.waitFor(() => {
      expect(getByTestId('location-city-Munich').query()).toBeTruthy();
    });

    // Select Munich — should auto-fill Germany
    await userEvent.click(getByTestId('location-city-Munich'));
    expect(lastCountry).toBe('Germany');
    expect(lastCity).toBe('Munich');
  });

  it('should show empty message when no locations', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: [],
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    expect(getByTestId('location-empty').element().textContent).toBe('No locations found');
  });

  // --- Search tests ---
  const manyCountries = [
    'Argentina',
    'Australia',
    'Brazil',
    'Canada',
    'China',
    'France',
    'Germany',
    'India',
    'Italy',
    'Japan',
    'Mexico',
    'Spain',
  ];

  it('should filter countries via search input', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: manyCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    const searchInput = getByTestId('location-search-input').element();
    await userEvent.fill(searchInput, 'Ger');

    expect(getByTestId('location-country-Germany').query()).toBeTruthy();
    expect(getByTestId('location-country-France').query()).toBeNull();
    expect(getByTestId('location-country-Italy').query()).toBeNull();
  });

  it('should not fetch all country cities for one-character searches', async () => {
    const onCityFetch = vi.fn(() => Promise.resolve([]));

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: manyCountries,
        onCityFetch,
        onSelectionChange: () => {},
      },
    });

    await userEvent.fill(getByTestId('location-search-input'), 'a');
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(onCityFetch).not.toHaveBeenCalled();
  });

  it('should not use cached city matches for one-character searches', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['Germany'],
        onCityFetch: () => Promise.resolve(['Berlin']),
        onSelectionChange: () => {},
      },
    });

    await userEvent.click(getByTestId('location-country-Germany'));
    await vi.waitFor(() => expect(getByTestId('location-city-Berlin').query()).toBeTruthy());

    await userEvent.fill(getByTestId('location-search-input'), 'b');

    expect(getByTestId('location-country-Germany').query()).toBeNull();
    expect(getByTestId('location-city-Berlin').query()).toBeNull();
    expect(getByTestId('location-no-results').element().textContent).toBe('No matching locations');
  });

  it('should search matching city names when the query also matches a country name', async () => {
    const cityMap: Record<string, string[]> = {
      Germany: [],
      Switzerland: ['Geneva'],
    };

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['Germany', 'Switzerland'],
        onCityFetch: (country: string) => Promise.resolve(cityMap[country] ?? []),
        onSelectionChange: () => {},
      },
    });

    await userEvent.fill(getByTestId('location-search-input'), 'ge');

    await vi.waitFor(() => {
      expect(getByTestId('location-country-Germany').query()).toBeTruthy();
      expect(getByTestId('location-country-Switzerland').query()).toBeTruthy();
      expect(getByTestId('location-city-Geneva').query()).toBeTruthy();
    });
  });

  it('should search city names and show matching cities under their country', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: mockCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    await userEvent.fill(getByTestId('location-search-input'), 'ber');

    await vi.waitFor(() => {
      expect(getByTestId('location-country-Germany').query()).toBeTruthy();
      expect(getByTestId('location-city-Berlin').query()).toBeTruthy();
      expect(getByTestId('location-country-Italy').query()).toBeNull();
      expect(getByTestId('location-city-Munich').query()).toBeNull();
    });
  });

  it('should not show no-results while city search fetches are pending', async () => {
    let resolveSwitzerland!: (cities: string[]) => void;
    const switzerlandPromise = new Promise<string[]>((resolve) => {
      resolveSwitzerland = resolve;
    });
    const onCityFetch = vi.fn((country: string) =>
      country === 'Switzerland' ? switzerlandPromise : Promise.resolve([]),
    );

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['Germany', 'Switzerland'],
        onCityFetch,
        onSelectionChange: () => {},
      },
    });

    await userEvent.fill(getByTestId('location-search-input'), 'gene');
    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledWith('Switzerland', undefined));

    expect(getByTestId('location-no-results').query()).toBeNull();

    resolveSwitzerland(['Geneva']);

    await vi.waitFor(() => {
      expect(getByTestId('location-country-Switzerland').query()).toBeTruthy();
      expect(getByTestId('location-city-Geneva').query()).toBeTruthy();
      expect(getByTestId('location-no-results').query()).toBeNull();
    });
  });

  it('should not show no-results before debounced city search fetches start', async () => {
    const onCityFetch = vi.fn(() => Promise.resolve([]));

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: ['Germany', 'Switzerland'],
        onCityFetch,
        onSelectionChange: () => {},
      },
    });

    await userEvent.fill(getByTestId('location-search-input'), 'gene');

    expect(onCityFetch).not.toHaveBeenCalled();
    expect(getByTestId('location-no-results').query()).toBeNull();
  });

  it('should refetch city search results when context changes with the same active query', async () => {
    const countries = ['Germany', 'Switzerland'];
    const onCityFetch = vi.fn((country: string, context?: { takenAfter?: string }) => {
      if (country === 'Switzerland' && context?.takenAfter === '2026-02-01') {
        return Promise.resolve(['Geneva']);
      }

      return Promise.resolve([]);
    });

    const { getByTestId, rerender } = await render(LocationFilter, {
      props: {
        countries,
        context: { takenAfter: '2026-01-01' },
        onCityFetch,
        onSelectionChange: () => {},
      },
    });

    await userEvent.fill(getByTestId('location-search-input'), 'gene');
    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledWith('Switzerland', { takenAfter: '2026-01-01' }));
    await vi.waitFor(() => expect(getByTestId('location-no-results').query()).toBeTruthy());

    await rerender({
      countries,
      context: { takenAfter: '2026-02-01' },
      onCityFetch,
      onSelectionChange: () => {},
    });

    await vi.waitFor(() => expect(onCityFetch).toHaveBeenCalledWith('Switzerland', { takenAfter: '2026-02-01' }));
    await vi.waitFor(() => {
      expect(getByTestId('location-country-Switzerland').query()).toBeTruthy();
      expect(getByTestId('location-city-Geneva').query()).toBeTruthy();
    });
  });

  it('should find a city in a country beyond the initial country cap', async () => {
    const cityMap: Record<string, string[]> = {
      Mexico: ['Merida'],
    };

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: manyCountries,
        onCityFetch: (country: string) => Promise.resolve(cityMap[country] ?? []),
        onSelectionChange: () => {},
      },
    });

    expect(getByTestId('location-country-Mexico').query()).toBeNull();

    await userEvent.fill(getByTestId('location-search-input'), 'meri');

    await vi.waitFor(() => {
      expect(getByTestId('location-country-Mexico').query()).toBeTruthy();
      expect(getByTestId('location-city-Merida').query()).toBeTruthy();
    });
  });

  it('should select a city from city search results', async () => {
    const onSelectionChange = vi.fn();

    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: mockCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange,
      },
    });

    await userEvent.fill(getByTestId('location-search-input'), 'ber');

    await vi.waitFor(() => expect(getByTestId('location-city-Berlin').query()).toBeTruthy());
    await userEvent.click(getByTestId('location-city-Berlin'));

    expect(onSelectionChange).toHaveBeenLastCalledWith('Germany', 'Berlin');
  });

  it('should search case-insensitively', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: manyCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    const searchInput = getByTestId('location-search-input').element();
    await userEvent.fill(searchInput, 'germany');

    expect(getByTestId('location-country-Germany').query()).toBeTruthy();
  });

  it('should show all search results without truncation', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: manyCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    const searchInput = getByTestId('location-search-input').element();
    // "an" matches 4 countries — all shown regardless of truncation
    await userEvent.fill(searchInput, 'an');

    expect(getByTestId('location-country-Canada').query()).toBeTruthy();
    expect(getByTestId('location-country-France').query()).toBeTruthy();
    expect(getByTestId('location-country-Germany').query()).toBeTruthy();
    expect(getByTestId('location-country-Japan').query()).toBeTruthy();
    // Non-matches hidden
    expect(getByTestId('location-country-Argentina').query()).toBeNull();
    expect(getByTestId('location-country-Brazil').query()).toBeNull();
    expect(getByTestId('location-country-China').query()).toBeNull();
    expect(getByTestId('location-country-Spain').query()).toBeNull();
  });

  it('should show "Show N more" when list exceeds 10 countries', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: manyCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    // First 10 should be visible
    expect(getByTestId('location-country-Argentina').query()).toBeTruthy();
    expect(getByTestId('location-country-Japan').query()).toBeTruthy();
    // 11th and 12th should be hidden
    expect(getByTestId('location-country-Mexico').query()).toBeNull();
    expect(getByTestId('location-country-Spain').query()).toBeNull();

    const showMore = getByTestId('location-show-more').element();
    expect(showMore.textContent).toContain('Show 2 more');
  });

  it('should expand list when "Show N more" is clicked', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: manyCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    await userEvent.click(getByTestId('location-show-more'));

    expect(getByTestId('location-country-Mexico').query()).toBeTruthy();
    expect(getByTestId('location-country-Spain').query()).toBeTruthy();
  });

  it('should show "No matching locations" for empty search results', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: manyCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    const searchInput = getByTestId('location-search-input').element();
    await userEvent.fill(searchInput, 'zzzzz');

    await vi.waitFor(() =>
      expect(getByTestId('location-no-results').element().textContent).toBe('No matching locations'),
    );
  });

  it('should show "No matching locations" immediately for one-character empty search results', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: manyCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    const searchInput = getByTestId('location-search-input').element();
    await userEvent.fill(searchInput, 'q');

    expect(getByTestId('location-no-results').element().textContent).toBe('No matching locations');
  });

  it('should keep orphaned country visible during search', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: mockCountries, // Germany, Italy, France
        selectedCountry: 'Switzerland', // Not in list = orphaned
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    const searchInput = getByTestId('location-search-input').element();
    await userEvent.fill(searchInput, 'Italy');

    // Orphaned country still visible
    expect(getByTestId('location-country-Switzerland').query()).toBeTruthy();
    // Matched country visible
    expect(getByTestId('location-country-Italy').query()).toBeTruthy();
    // Non-matched countries hidden
    expect(getByTestId('location-country-Germany').query()).toBeNull();
  });

  it('should keep selected country visible during search', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: mockCountries,
        selectedCountry: 'Germany',
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    const searchInput = getByTestId('location-search-input').element();

    await userEvent.fill(searchInput, 'Italy');
    expect(getByTestId('location-country-Germany').query()).toBeTruthy();
    expect(getByTestId('location-country-Italy').query()).toBeTruthy();

    await userEvent.fill(searchInput, '');
    expect(getByTestId('location-country-Germany').query()).toBeTruthy();
  });

  it('should show cities when searching for a country and clicking it', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: mockCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    const searchInput = getByTestId('location-search-input').element();
    await userEvent.fill(searchInput, 'Germany');
    await userEvent.click(getByTestId('location-country-Germany'));

    await vi.waitFor(() => {
      expect(getByTestId('location-city-Munich').query()).toBeTruthy();
      expect(getByTestId('location-city-Berlin').query()).toBeTruthy();
      expect(getByTestId('location-city-Hamburg').query()).toBeTruthy();
    });
  });

  it('should not show search input when no countries exist', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: [],
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    expect(getByTestId('location-search-input').query()).toBeNull();
    expect(getByTestId('location-empty').query()).toBeTruthy();
  });

  it('should restore expanded country with cities after search is cleared', async () => {
    const { getByTestId } = await render(LocationFilter, {
      props: {
        countries: mockCountries,
        onCityFetch: mockCityFetch,
        onSelectionChange: () => {},
      },
    });

    // Select and expand Germany to load cities
    await userEvent.click(getByTestId('location-country-Germany'));
    await vi.waitFor(() => {
      expect(getByTestId('location-city-Munich').query()).toBeTruthy();
    });

    // Search hides Germany (and its cities)
    const searchInput = getByTestId('location-search-input').element();
    await userEvent.fill(searchInput, 'Italy');
    expect(getByTestId('location-country-Germany').query()).toBeNull();
    expect(getByTestId('location-city-Munich').query()).toBeNull();

    // Clear search — Germany and cities reappear
    await userEvent.fill(searchInput, '');
    expect(getByTestId('location-country-Germany').query()).toBeTruthy();
    await vi.waitFor(() => {
      expect(getByTestId('location-city-Munich').query()).toBeTruthy();
    });
  });
});

describe('CameraFilter', () => {
  const mockMakes = ['Canon', 'Sony', 'Nikon'];
  const mockModelFetch = (make: string): Promise<string[]> => {
    const modelMap: Record<string, string[]> = {
      Canon: ['EOS R5', 'EOS R6', 'EOS 5D'],
      Sony: ['A7 IV', 'A7R V'],
      Nikon: ['Z9', 'Z6 III'],
    };
    return Promise.resolve(modelMap[make] ?? []);
  };

  it('should render makes with radio buttons', async () => {
    const { getByTestId } = await render(CameraFilter, {
      props: {
        makes: mockMakes,
        onModelFetch: mockModelFetch,
        onSelectionChange: () => {},
      },
    });

    expect(getByTestId('camera-make-Canon').element()).toBeTruthy();
    expect(getByTestId('camera-make-Sony').element()).toBeTruthy();
    expect(getByTestId('camera-make-Nikon').element()).toBeTruthy();
  });

  it('should be single-select (selecting B deselects A)', async () => {
    let lastMake: string | undefined;
    const onSelectionChange = (make?: string) => {
      lastMake = make;
    };

    const { getByTestId } = await render(CameraFilter, {
      props: {
        makes: mockMakes,
        onModelFetch: mockModelFetch,
        onSelectionChange,
      },
    });

    await userEvent.click(getByTestId('camera-make-Canon'));
    expect(lastMake).toBe('Canon');

    await userEvent.click(getByTestId('camera-make-Sony'));
    expect(lastMake).toBe('Sony');
  });

  it('should show models when make is expanded', async () => {
    const { getByTestId } = await render(CameraFilter, {
      props: {
        makes: mockMakes,
        onModelFetch: mockModelFetch,
        onSelectionChange: () => {},
      },
    });

    await userEvent.click(getByTestId('camera-make-Canon'));

    await vi.waitFor(() => {
      expect(getByTestId('camera-model-EOS R5').query()).toBeTruthy();
      expect(getByTestId('camera-model-EOS R6').query()).toBeTruthy();
      expect(getByTestId('camera-model-EOS 5D').query()).toBeTruthy();
    });
  });

  it('should auto-fill make when model is selected', async () => {
    let lastMake: string | undefined;
    let lastModel: string | undefined;
    const onSelectionChange = (make?: string, model?: string) => {
      lastMake = make;
      lastModel = model;
    };

    const { getByTestId } = await render(CameraFilter, {
      props: {
        makes: mockMakes,
        onModelFetch: mockModelFetch,
        onSelectionChange,
      },
    });

    // Expand Canon
    await userEvent.click(getByTestId('camera-make-Canon'));

    await vi.waitFor(() => {
      expect(getByTestId('camera-model-EOS R5').query()).toBeTruthy();
    });

    // Select a model — should auto-fill make
    await userEvent.click(getByTestId('camera-model-EOS R5'));
    expect(lastMake).toBe('Canon');
    expect(lastModel).toBe('EOS R5');
  });

  it('should show empty message when no cameras', async () => {
    const { getByTestId } = await render(CameraFilter, {
      props: {
        makes: [],
        onModelFetch: mockModelFetch,
        onSelectionChange: () => {},
      },
    });

    expect(getByTestId('camera-empty').element().textContent).toBe('No cameras found');
  });
});

describe('storageKey prop', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // The section toggles now live inside the cog's popover, so anything that clicks or queries one
  // has to open it first.
  async function openSectionMenu() {
    await userEvent.click(page.getByTestId('section-menu-btn'));
  }

  it('should use custom storage key for localStorage persistence', async () => {
    const customKey = 'gallery-filter-photos';
    await render(FilterPanel, {
      props: {
        config: { sections: ['rating', 'media', 'tags'], providers: {} },
        timeBuckets: [],
        storageKey: customKey,
      },
    });
    await openSectionMenu();
    const ratingToggle = page.getByTestId('section-toggle-rating');
    await userEvent.click(ratingToggle);
    const stored = localStorage.getItem(customKey);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!) as string[];
    expect(parsed).not.toContain('rating');
    expect(localStorage.getItem('gallery-filter-visible-sections')).toBeNull();
  });

  it('should use default key when storageKey not provided', async () => {
    await render(FilterPanel, {
      props: {
        config: { sections: ['rating', 'media'], providers: {} },
        timeBuckets: [],
      },
    });
    await openSectionMenu();
    const ratingToggle = page.getByTestId('section-toggle-rating');
    await userEvent.click(ratingToggle);
    expect(localStorage.getItem('gallery-filter-visible-sections')).toBeTruthy();
  });
});
