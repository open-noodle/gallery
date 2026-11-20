import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import ActiveFiltersBar from '../active-filters-bar.svelte';
import { createFilterState } from '../filter-panel';
import LocationFilter from '../location-filter.svelte';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  register('de', () => import('#i18n/de.json'));
  await init({ fallbackLocale: 'en-US', initialLocale: 'de' });
  await waitLocale('de');
});

describe('localized country names', () => {
  const countries = ['Germany', 'Switzerland'];
  const onCityFetch = () => Promise.resolve([]);

  it('shows the country in the UI language and still selects the stored name', async () => {
    const onSelectionChange = vi.fn();
    await render(LocationFilter, { props: { countries, onCityFetch, onSelectionChange } });

    const row = page.getByTestId('location-country-Germany');
    await expect.element(row).toHaveTextContent('Deutschland');

    await userEvent.click(row);
    expect(onSelectionChange).toHaveBeenCalledWith('Germany', undefined);
  });

  it('finds a country by its localized or its English name', async () => {
    await render(LocationFilter, { props: { countries, onCityFetch, onSelectionChange: () => {} } });
    const input = page.getByTestId('location-search-input');

    await userEvent.fill(input, 'schweiz');
    await expect.element(page.getByTestId('location-country-Switzerland')).toBeInTheDocument();
    expect(page.getByTestId('location-country-Germany').query()).toBeNull();

    await userEvent.fill(input, 'germany');
    await expect.element(page.getByTestId('location-country-Germany')).toBeInTheDocument();
    expect(page.getByTestId('location-country-Switzerland').query()).toBeNull();
  });

  it('shows the active location chip in the UI language', async () => {
    const filters = createFilterState();
    filters.city = 'Munich';
    filters.country = 'Germany';

    const screen = await render(ActiveFiltersBar, {
      props: { filters, onRemoveFilter: () => {}, onClearAll: () => {} },
    });

    expect(screen.getByTestId('active-chip').elements()[0].textContent).toContain('Munich, Deutschland');
  });
});
