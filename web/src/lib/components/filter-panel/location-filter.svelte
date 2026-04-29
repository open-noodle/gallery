<script lang="ts">
  import type { FilterContext } from './filter-panel';

  import { Icon } from '@immich/ui';
  import { mdiMagnify } from '@mdi/js';

  interface Props {
    countries: string[];
    selectedCity?: string;
    selectedCountry?: string;
    context?: FilterContext;
    onCityFetch: (country: string, context?: FilterContext) => Promise<string[]>;
    onSelectionChange: (country?: string, city?: string) => void;
    emptyText?: string;
  }

  let {
    countries,
    selectedCity,
    selectedCountry,
    context,
    onCityFetch,
    onSelectionChange,
    emptyText = 'No locations found',
  }: Props = $props();

  let searchQuery = $state('');
  let showAll = $state(false);
  let expandedCityLists = $state<Record<string, boolean>>({});

  const COUNTRY_SHOW_COUNT = 10;
  const CITY_SHOW_COUNT = 10;

  // Clear search when countries list changes (e.g. temporal filter refetch)
  let previousCountriesLength = 0;
  $effect(() => {
    const currentLength = countries.length;
    if (previousCountriesLength > 0 && currentLength !== previousCountriesLength) {
      searchQuery = '';
      showAll = false;
    }
    previousCountriesLength = currentLength;
  });

  let filteredCountries = $derived(
    searchQuery.trim()
      ? countries.filter((c) => c.toLowerCase().includes(searchQuery.trim().toLowerCase()))
      : countries,
  );

  let visibleCountries = $derived(
    searchQuery.trim() || showAll ? filteredCountries : filteredCountries.slice(0, COUNTRY_SHOW_COUNT),
  );

  let remainingCount = $derived(Math.max(0, filteredCountries.length - COUNTRY_SHOW_COUNT));

  let expandedCountry = $state<string | undefined>(undefined);
  let cities = $state<string[]>([]);
  let loadingCities = $state(false);

  // Orphaned country: selected but not in current results
  let orphanedCountry = $derived(selectedCountry && !countries.includes(selectedCountry) ? selectedCountry : undefined);

  $effect(() => {
    if (selectedCountry && selectedCity && expandedCountry !== selectedCountry) {
      expandedCountry = selectedCountry;
      expandedCityLists = { ...expandedCityLists, [selectedCountry]: false };
    }
  });

  $effect(() => {
    if (expandedCountry) {
      const requestedCountry = expandedCountry;
      const _context = context;
      loadingCities = true;
      void onCityFetch(requestedCountry, _context).then((result) => {
        if (expandedCountry !== requestedCountry) {
          if (!expandedCountry) {
            loadingCities = false;
          }
          return;
        }

        cities = result;
        loadingCities = false;

        // Cascade child auto-clear: if selected city is not in new results, clear it
        if (selectedCity && result.length > 0 && !result.includes(selectedCity)) {
          onSelectionChange(requestedCountry, undefined);
        }
      });
    } else {
      cities = [];
      loadingCities = false;
    }
  });

  function getFilteredCities(country: string): string[] {
    return cities;
  }

  function getVisibleCities(country: string): string[] {
    const filtered = getFilteredCities(country);
    if (expandedCityLists[country]) {
      return filtered;
    }

    const visible = filtered.slice(0, CITY_SHOW_COUNT);
    if (
      selectedCountry === country &&
      selectedCity &&
      filtered.includes(selectedCity) &&
      !visible.includes(selectedCity)
    ) {
      return [...visible, selectedCity];
    }

    return visible;
  }

  function getRemainingCityCount(country: string): number {
    return Math.max(0, getFilteredCities(country).length - getVisibleCities(country).length);
  }

  function showAllCities(country: string) {
    expandedCityLists = { ...expandedCityLists, [country]: true };
  }

  function handleCountryClick(country: string) {
    if (selectedCountry === country && !selectedCity) {
      expandedCountry = undefined;
      onSelectionChange(undefined, undefined);
    } else {
      expandedCountry = country;
      expandedCityLists = { ...expandedCityLists, [country]: false };
      onSelectionChange(country, undefined);
    }
  }

  function handleCityClick(city: string, country: string) {
    if (selectedCity === city) {
      // Deselect city, keep country
      onSelectionChange(country, undefined);
    } else {
      // Select city (auto-fills country)
      onSelectionChange(country, city);
    }
  }
</script>

<div data-testid="location-filter">
  {#if countries.length === 0 && !orphanedCountry}
    <p class="text-sm text-gray-400 dark:text-gray-500" data-testid="location-empty">{emptyText}</p>
  {:else}
    <!-- Search input -->
    <div class="relative mb-2">
      <div class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
        <Icon icon={mdiMagnify} size="14" />
      </div>
      <input
        type="text"
        class="immich-form-input h-8 w-full rounded-lg pl-7 pr-2 text-sm"
        placeholder="Search locations..."
        bind:value={searchQuery}
        oninput={() => {
          showAll = false;
        }}
        data-testid="location-search-input"
      />
    </div>

    <!-- Orphaned country (selected but no longer in suggestions) -->
    {#if orphanedCountry}
      {@const isCountrySelected = true}
      <button
        type="button"
        class="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium opacity-50 hover:bg-subtle"
        onclick={() => handleCountryClick(orphanedCountry!)}
        aria-pressed="true"
        data-testid="location-country-{orphanedCountry}"
      >
        <div
          class="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 {isCountrySelected &&
          !selectedCity
            ? 'border-immich-primary bg-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary'
            : 'border-gray-300 dark:border-gray-600'}"
        >
          {#if isCountrySelected && !selectedCity}
            <div class="h-1.5 w-1.5 rounded-full bg-white dark:bg-black"></div>
          {/if}
        </div>
        <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{orphanedCountry}</span>
      </button>
    {/if}

    <!-- Empty search results -->
    {#if filteredCountries.length === 0 && searchQuery.trim()}
      <p class="text-sm text-gray-400 dark:text-gray-500" data-testid="location-no-results">No matching locations</p>
    {/if}

    {#each visibleCountries as country (country)}
      {@const isCountrySelected = selectedCountry === country}
      <!-- Country row -->
      <button
        type="button"
        class="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle {isCountrySelected
          ? 'font-medium'
          : 'text-gray-500 dark:text-gray-300'}"
        onclick={() => handleCountryClick(country)}
        data-testid="location-country-{country}"
      >
        <!-- Radio indicator -->
        <div
          class="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 {isCountrySelected &&
          !selectedCity
            ? 'border-immich-primary bg-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary'
            : 'border-gray-300 dark:border-gray-600'}"
        >
          {#if isCountrySelected && !selectedCity}
            <div class="h-1.5 w-1.5 rounded-full bg-white dark:bg-black"></div>
          {/if}
        </div>

        <!-- Label -->
        <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{country}</span>
      </button>

      <!-- Cities (indented when country is expanded) -->
      {#if expandedCountry === country && !loadingCities}
        {#each getVisibleCities(country) as city (city)}
          {@const isCitySelected = selectedCity === city && selectedCountry === country}
          <button
            type="button"
            class="-mx-2 ml-5 flex w-[calc(100%-1.25rem+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle {isCitySelected
              ? 'font-medium'
              : 'text-gray-500 dark:text-gray-300'}"
            onclick={() => handleCityClick(city, country)}
            data-testid="location-city-{city}"
          >
            <!-- Radio indicator -->
            <div
              class="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 {isCitySelected
                ? 'border-immich-primary bg-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary'
                : 'border-gray-300 dark:border-gray-600'}"
            >
              {#if isCitySelected}
                <div class="h-1.5 w-1.5 rounded-full bg-white dark:bg-black"></div>
              {/if}
            </div>

            <!-- Label -->
            <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{city}</span>
          </button>
        {/each}
        {#if !expandedCityLists[country] && getRemainingCityCount(country) > 0}
          <button
            type="button"
            class="ml-5 py-1 text-xs font-medium text-immich-primary dark:text-immich-dark-primary"
            onclick={() => showAllCities(country)}
            data-testid="location-city-show-more-{country}"
          >
            Show {getRemainingCityCount(country)} more
          </button>
        {/if}
      {/if}
    {/each}

    <!-- Show more link -->
    {#if !showAll && remainingCount > 0 && !searchQuery.trim()}
      <button
        type="button"
        class="py-1 text-xs font-medium text-immich-primary dark:text-immich-dark-primary"
        onclick={() => (showAll = true)}
        data-testid="location-show-more"
      >
        Show {remainingCount} more
      </button>
    {/if}
  {/if}
</div>
