import { mdiPin } from '@mdi/js';
import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import ActiveFiltersBar from '../active-filters-bar.svelte';
import { createFilterState } from '../filter-panel';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('ActiveFiltersBar', () => {
  it('should render chip for person filter with name', async () => {
    const filters = createFilterState();
    filters.personIds = ['p1'];

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        personNames: new Map([['p1', 'Sarah Chen']]),
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Sarah Chen');
  });

  it('should render chip for location as "City, Country"', async () => {
    const filters = createFilterState();
    filters.city = 'Munich';
    filters.country = 'Germany';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Munich, Germany');
  });

  it('should render chip for country only when no city', async () => {
    const filters = createFilterState();
    filters.country = 'Germany';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Germany');
    expect(chips[0].textContent).not.toContain(',');
  });

  it('should render chip for city only when no country', async () => {
    const filters = createFilterState();
    filters.city = 'New York City';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('New York City');
    expect(chips[0].textContent).not.toContain(',');
  });

  it('should render chip for state alone (folds into the location chip)', async () => {
    const filters = createFilterState();
    filters.state = 'Bavaria';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Bavaria');
  });

  it('should render one location chip containing city, state and country together', async () => {
    const filters = createFilterState();
    filters.city = 'Munich';
    filters.state = 'Bavaria';
    filters.country = 'Germany';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Munich');
    expect(chips[0].textContent).toContain('Bavaria');
    expect(chips[0].textContent).toContain('Germany');
  });

  it('should remove city, state and country together on location chip close', async () => {
    let removedType: string | undefined;
    const filters = createFilterState();
    filters.city = 'Munich';
    filters.state = 'Bavaria';
    filters.country = 'Germany';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: (type: string) => {
          removedType = type;
        },
        onClearAll: () => {},
      },
    });

    await screen.getByTestId('chip-close').click();
    expect(removedType).toBe('location');
  });

  it('should render chip for rating as "≥ 3 stars" (star shown as a leading icon)', async () => {
    const filters = createFilterState();
    filters.rating = 3;

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('≥ 3 stars');
    expect(chips[0].textContent).not.toContain('3+');
  });

  it('should render chip for a rating of 1 as "≥ 1 star" (singular)', async () => {
    const filters = createFilterState();
    filters.rating = 1;

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('≥ 1 star');
    expect(chips[0].textContent).not.toContain('1 stars');
  });

  it('should render chip for lens filter, removable as type "lens"', async () => {
    let removedType: string | undefined;
    const filters = createFilterState();
    filters.lensModel = 'RF24-70mm F2.8';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: (type: string) => {
          removedType = type;
        },
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('RF24-70mm F2.8');

    await screen.getByTestId('chip-close').click();
    expect(removedType).toBe('lens');
  });

  it('should render chip for album filter with resolved name, removable as type "album"', async () => {
    let removedType: string | undefined;
    let removedId: string | undefined;
    const filters = createFilterState();
    filters.albumId = 'album-1';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        albumNames: new Map([['album-1', 'Summer Trip']]),
        onRemoveFilter: (type: string, id?: string) => {
          removedType = type;
          removedId = id;
        },
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Summer Trip');

    await screen.getByTestId('chip-close').click();
    expect(removedType).toBe('album');
    expect(removedId).toBe('album-1');
  });

  it('should fall back to the raw id for an album chip with no name resolved', async () => {
    const filters = createFilterState();
    filters.albumId = 'album-2';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('album-2');
  });

  it('should render chip for owner filter with resolved name, removable as type "owner"', async () => {
    let removedType: string | undefined;
    let removedId: string | undefined;
    const filters = createFilterState();
    filters.ownerId = 'user-1';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        ownerNames: new Map([['user-1', 'Jamie Rivera']]),
        onRemoveFilter: (type: string, id?: string) => {
          removedType = type;
          removedId = id;
        },
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Jamie Rivera');

    await screen.getByTestId('chip-close').click();
    expect(removedType).toBe('owner');
    expect(removedId).toBe('user-1');
  });

  it('should fall back to the raw id for an owner chip with no name resolved', async () => {
    const filters = createFilterState();
    filters.ownerId = 'user-2';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('user-2');
  });

  it('should render chip for media type as "Photos only"', async () => {
    const filters = createFilterState();
    filters.mediaType = 'image';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Photos only');
  });

  it('should render "Videos only" for video media type', async () => {
    const filters = createFilterState();
    filters.mediaType = 'video';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Videos only');
  });

  it('should render chip for favorites filter', async () => {
    const filters = { ...createFilterState(), isFavorite: true };

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Favorites');
  });

  it('should remove favorites filter on chip close', async () => {
    let removedType: string | undefined;
    const filters = { ...createFilterState(), isFavorite: true };

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: (type: string) => {
          removedType = type;
        },
        onClearAll: () => {},
      },
    });

    await screen.getByTestId('chip-close').click();
    expect(removedType).toBe('favorites');
  });

  it('should render chip for has-no-album filter', async () => {
    const filters = { ...createFilterState(), isNotInAlbum: true };

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Has no album');
  });

  it('should remove has-no-album filter on chip close', async () => {
    let removedType: string | undefined;
    const filters = { ...createFilterState(), isNotInAlbum: true };

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: (type: string) => {
          removedType = type;
        },
        onClearAll: () => {},
      },
    });

    await screen.getByTestId('chip-close').click();
    expect(removedType).toBe('albums');
  });

  it('should render chip for has-album filter', async () => {
    const filters = { ...createFilterState(), isInAlbum: true };

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Has album');
  });

  it('should remove has-album filter on chip close', async () => {
    let removedType: string | undefined;
    const filters = { ...createFilterState(), isInAlbum: true };

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: (type: string) => {
          removedType = type;
        },
        onClearAll: () => {},
      },
    });

    await screen.getByTestId('chip-close').click();
    expect(removedType).toBe('albums');
  });

  it('should render a chip for isFavorite === false too (counted but previously never chipped)', async () => {
    const filters = { ...createFilterState(), isFavorite: false };

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Not favorite');
  });

  it('should remove the isFavorite === false filter on chip close', async () => {
    let removedType: string | undefined;
    const filters = { ...createFilterState(), isFavorite: false };

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: (type: string) => {
          removedType = type;
        },
        onClearAll: () => {},
      },
    });

    await screen.getByTestId('chip-close').click();
    expect(removedType).toBe('favorites');
  });

  it('should not render a has-no-album chip for false', async () => {
    const filters = { ...createFilterState(), isNotInAlbum: false };

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    expect(screen.getByTestId('active-chip').elements()).toHaveLength(0);
  });

  it('should render no chips when no filters active', async () => {
    const filters = createFilterState();

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(0);
  });

  it('should remove individual filter on chip close', async () => {
    let removedType: string | undefined;
    let removedId: string | undefined;
    const onRemoveFilter = (type: string, id?: string) => {
      removedType = type;
      removedId = id;
    };

    const filters = createFilterState();
    filters.personIds = ['p1'];

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        personNames: new Map([['p1', 'Sarah Chen']]),
        onRemoveFilter,
        onClearAll: () => {},
      },
    });

    await screen.getByTestId('chip-close').click();
    expect(removedType).toBe('person');
    expect(removedId).toBe('p1');
  });

  it('should clear all on Clear All click', async () => {
    let cleared = false;
    const onClearAll = () => {
      cleared = true;
    };

    const filters = createFilterState();
    filters.rating = 4;
    filters.mediaType = 'image';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll,
      },
    });

    await screen.getByTestId('clear-all-btn').click();
    expect(cleared).toBe(true);
  });

  it('should not clear sortOrder on Clear All', async () => {
    // This test verifies that the Clear All button does not affect sortOrder.
    // The bar component delegates to onClearAll, which should use clearFilters().
    // clearFilters() preserves sortOrder by design (tested in filter-state.spec.ts).
    // Here we just verify the bar does not modify sortOrder itself.
    const filters = createFilterState();
    filters.sortOrder = 'asc';
    filters.rating = 4;

    let cleared = false;
    const onClearAll = () => {
      cleared = true;
    };

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll,
      },
    });

    await screen.getByTestId('clear-all-btn').click();
    expect(cleared).toBe(true);
    // sortOrder is unchanged because the component only calls the callback
    expect(filters.sortOrder).toBe('asc');
  });

  it('should show result count', async () => {
    const filters = createFilterState();

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        resultCount: 1234,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const resultCount = screen.getByTestId('result-count').element();
    expect(resultCount.textContent).toContain('1,234 results');
  });

  it('should render camera chip as "Make Model"', async () => {
    const filters = createFilterState();
    filters.make = 'Canon';
    filters.model = 'EOS R5';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Canon EOS R5');
  });

  it('should render a camera chip for a model-only value (no make)', async () => {
    const filters = createFilterState();
    filters.model = 'iPhone 17 Pro Max';

    // make is absent, but ?model= is applied by every surface, so the bar MUST surface a
    // removable chip (label = the model) rather than hiding the filter entirely.
    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('iPhone 17 Pro Max');
  });

  it('should render tag chips with names', async () => {
    const filters = createFilterState();
    filters.tagIds = ['t1', 't2'];

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        tagNames: new Map([
          ['t1', 'Vacation'],
          ['t2', 'Family'],
        ]),
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain('Vacation');
    expect(chips[1].textContent).toContain('Family');
  });

  it('should render chip for year-only timeline filter', async () => {
    const filters = createFilterState();
    filters.selectedYear = 2015;

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('2015');
  });

  it('should render chip for year+month timeline filter as "Mon YYYY"', async () => {
    const filters = createFilterState();
    filters.selectedYear = 2015;
    filters.selectedMonth = 12;

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Dec 2015');
  });

  it('should reserve filter removal copy for explicit timeline filter chips', async () => {
    const filters = createFilterState();
    filters.selectedYear = 2015;
    filters.selectedMonth = 12;

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    await expect.element(screen.getByTestId('active-chip')).toHaveTextContent('Dec 2015');
    await expect.element(screen.getByTestId('chip-close')).toHaveAttribute('aria-label', 'Remove Dec 2015 filter');
  });

  it('should render bounded custom date range as one timeline chip', async () => {
    const filters = createFilterState();
    filters.dateAfter = '2024-01-01';
    filters.dateBefore = '2024-12-31';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Jan 1, 2024 - Dec 31, 2024');
  });

  it('should render from-only custom date range as one timeline chip', async () => {
    const filters = createFilterState();
    filters.dateAfter = '2024-01-01';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('After Jan 1, 2024');
  });

  it('should render to-only custom date range as one timeline chip', async () => {
    const filters = createFilterState();
    filters.dateBefore = '2024-12-31';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Before Dec 31, 2024');
  });

  it('should prefer custom date range chip over selected year and month', async () => {
    const filters = createFilterState();
    filters.dateAfter = '2024-01-01';
    filters.dateBefore = '2024-12-31';
    filters.selectedYear = 2023;
    filters.selectedMonth = 8;

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Jan 1, 2024 - Dec 31, 2024');
    expect(chips[0].textContent).not.toContain('Aug 2023');
  });

  it('should remove timeline filter on chip close', async () => {
    let removedType: string | undefined;
    const onRemoveFilter = (type: string) => {
      removedType = type;
    };

    const filters = createFilterState();
    filters.selectedYear = 2023;

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter,
        onClearAll: () => {},
      },
    });

    await screen.getByTestId('chip-close').click();
    expect(removedType).toBe('timeline');
  });

  it('should remove custom timeline filter on chip close', async () => {
    const onRemoveFilter = vi.fn();
    const filters = createFilterState();
    filters.dateAfter = '2024-01-01';
    filters.dateBefore = '2024-12-31';

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter,
        onClearAll: () => {},
      },
    });

    await screen.getByTestId('chip-close').click();
    expect(onRemoveFilter).toHaveBeenCalledWith('timeline', undefined);
  });

  it('should not show Clear All when no filters active', async () => {
    const filters = createFilterState();

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    expect(screen.getByTestId('clear-all-btn').query()).toBeNull();
  });

  it('should show singular "result" for count of 1', async () => {
    const filters = createFilterState();

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        resultCount: 1,
        onRemoveFilter: () => {},
        onClearAll: () => {},
      },
    });

    const resultCount = screen.getByTestId('result-count').element();
    expect(resultCount.textContent).toContain('1 result');
    expect(resultCount.textContent).not.toContain('results');
  });

  it('should call onClearSearch when Clear All is clicked and searchQuery is set', async () => {
    const onClearAll = vi.fn();
    const onClearSearch = vi.fn();
    const filters = createFilterState();
    filters.rating = 4;

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll,
        searchQuery: 'mountain',
        onClearSearch,
      },
    });

    await screen.getByTestId('clear-all-btn').click();
    expect(onClearAll).toHaveBeenCalled();
    expect(onClearSearch).toHaveBeenCalled();
  });

  it('should not call onClearSearch when Clear All is clicked and no searchQuery', async () => {
    const onClearAll = vi.fn();
    const onClearSearch = vi.fn();
    const filters = createFilterState();
    filters.rating = 4;

    const screen = await render(ActiveFiltersBar, {
      props: {
        filters,
        onRemoveFilter: () => {},
        onClearAll,
        onClearSearch,
      },
    });

    await screen.getByTestId('clear-all-btn').click();
    expect(onClearAll).toHaveBeenCalled();
    expect(onClearSearch).not.toHaveBeenCalled();
  });

  it('should render a description text chip with its value', async () => {
    const filters = { ...createFilterState(), description: 'beach sunset' };

    const screen = await render(ActiveFiltersBar, {
      props: { filters, onRemoveFilter: () => {}, onClearAll: () => {} },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('beach sunset');
  });

  it('should render a filename text chip with its value', async () => {
    const filters = { ...createFilterState(), originalFileName: 'IMG_1234' };

    const screen = await render(ActiveFiltersBar, {
      props: { filters, onRemoveFilter: () => {}, onClearAll: () => {} },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('IMG_1234');
  });

  it('should render an OCR text chip with its value', async () => {
    const filters = { ...createFilterState(), ocr: 'invoice total' };

    const screen = await render(ActiveFiltersBar, {
      props: { filters, onRemoveFilter: () => {}, onClearAll: () => {} },
    });

    const chips = screen.getByTestId('active-chip').elements();
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('invoice total');
  });

  it('should not render text chips for empty / whitespace-only values', async () => {
    const filters = { ...createFilterState(), description: '  ', originalFileName: '', ocr: undefined };

    const screen = await render(ActiveFiltersBar, {
      props: { filters, onRemoveFilter: () => {}, onClearAll: () => {} },
    });

    expect(screen.getByTestId('active-chip').elements()).toHaveLength(0);
  });

  it('should dispatch the matching type when removing each text chip', async () => {
    const cases = [
      { field: 'description', value: 'beach', type: 'description' },
      { field: 'originalFileName', value: 'IMG', type: 'filename' },
      { field: 'ocr', value: 'invoice', type: 'ocr' },
    ] as const;

    for (const { field, value, type } of cases) {
      const onRemoveFilter = vi.fn();
      const filters = { ...createFilterState(), [field]: value };

      const screen = await render(ActiveFiltersBar, {
        props: { filters, onRemoveFilter, onClearAll: () => {} },
      });

      await screen.getByTestId('chip-close').click();
      expect(onRemoveFilter).toHaveBeenCalledWith(type, undefined);
      await screen.unmount();
    }
  });

  describe('pinned chips', () => {
    const pinnedChip = (onRemove = vi.fn()) => ({
      type: 'library-view',
      icon: mdiPin,
      labelKey: 'library_view_chip_personal' as const,
      titleKey: 'library_view_remembered' as const,
      onRemove,
    });

    it('renders a pinned chip first, saying it is remembered, and removes it on its own', async () => {
      const filters = createFilterState();
      filters.country = 'Germany';
      const onRemove = vi.fn();
      const onRemoveFilter = vi.fn();

      const screen = await render(ActiveFiltersBar, {
        props: { filters, pinned: [pinnedChip(onRemove)], onRemoveFilter, onClearAll: () => {} },
      });

      const chips = screen.getByTestId(/^(pinned|active)-chip$/).elements();
      expect(chips.map((chip) => (chip as HTMLElement).dataset.testid)).toEqual(['pinned-chip', 'active-chip']);
      await expect.element(screen.getByTestId('pinned-chip')).toHaveTextContent('Personal photos only');
      await expect.element(screen.getByTestId('pinned-chip')).toHaveAttribute('title', 'Remembered between visits');

      await screen.getByTestId('pinned-chip-close').click();
      expect(onRemove).toHaveBeenCalledOnce();
      expect(onRemoveFilter).not.toHaveBeenCalled();
    });

    it('is not cleared by Clear all, which only shows for the other filters', async () => {
      const onRemove = vi.fn();
      const onClearAll = vi.fn();

      const alone = await render(ActiveFiltersBar, {
        props: { filters: createFilterState(), pinned: [pinnedChip(onRemove)], onRemoveFilter: () => {}, onClearAll },
      });
      expect(alone.getByTestId('clear-all-btn').query()).toBeNull();
      await alone.unmount();

      const filters = createFilterState();
      filters.country = 'Germany';
      const screen = await render(ActiveFiltersBar, {
        props: { filters, pinned: [pinnedChip(onRemove)], onRemoveFilter: () => {}, onClearAll },
      });
      await screen.getByTestId('clear-all-btn').click();
      expect(onClearAll).toHaveBeenCalledOnce();
      expect(onRemove).not.toHaveBeenCalled();
    });
  });

  it('omits its own band and padding in embedded mode', async () => {
    const filters = createFilterState();
    filters.country = 'Germany';

    // embedded: no self-drawn seam/padding (the host toolbar supplies them)
    const embeddedResult = await render(ActiveFiltersBar, {
      props: { filters, onRemoveFilter: () => {}, onClearAll: () => {}, embedded: true },
    });
    expect(embeddedResult.getByTestId('active-filters-bar').element().className).not.toContain('border-b');
    expect(embeddedResult.getByTestId('active-filters-bar').element().className).not.toContain('px-4');
    await embeddedResult.unmount();

    // standalone (default): keeps the seam + padding
    const standaloneResult = await render(ActiveFiltersBar, {
      props: { filters, onRemoveFilter: () => {}, onClearAll: () => {}, embedded: false },
    });
    expect(standaloneResult.getByTestId('active-filters-bar').element().className).toContain('border-b');
    expect(standaloneResult.getByTestId('active-filters-bar').element().className).toContain('px-4');
  });
});
