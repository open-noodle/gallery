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

  const INITIAL_SHOW_COUNT = 10;

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
    searchQuery.trim() || showAll ? filteredCountries : filteredCountries.slice(0, INITIAL_SHOW_COUNT),
  );

  let remainingCount = $derived(Math.max(0, filteredCountries.length - INITIAL_SHOW_COUNT));

  let expandedCountry = $state<string | undefined>(undefined);
  let cities = $state<string[]>([]);
  let loadingCities = $state(false);

  // Orphaned country: selected but not in current results
  let orphanedCountry = $derived(selectedCountry && !countries.includes(selectedCountry) ? selectedCountry : undefined);

  $effect(() => {
    if (expandedCountry) {
      const _context = context;
      loadingCities = true;
      void onCityFetch(expandedCountry, _context).then((result) => {
        cities = result;
        loadingCities = false;

        // Cascade child auto-clear: if selected city is not in new results, clear it
        if (selectedCity && result.length > 0 && !result.includes(selectedCity)) {
          onSelectionChange(expandedCountry, undefined);
        }
      });
    } else {
      cities = [];
    }
  });

  function handleCountryClick(country: string) {
    if (selectedCountry === country && !selectedCity) {
      // Deselect country
      expandedCountry = undefined;
      onSelectionChange(undefined, undefined);
    } else {
      // Select country
      expandedCountry = country;
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
        {#each cities as city (city)}
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
