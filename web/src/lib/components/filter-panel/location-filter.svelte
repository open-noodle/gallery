<script lang="ts">
  interface Props {
    countries: string[];
    selectedCity?: string;
    selectedCountry?: string;
    onCityFetch: (country: string) => Promise<string[]>;
    onSelectionChange: (country?: string, city?: string) => void;
  }

  let { countries, selectedCity, selectedCountry, onCityFetch, onSelectionChange }: Props = $props();

  let expandedCountry = $state<string | undefined>(undefined);
  let cities = $state<string[]>([]);
  let loadingCities = $state(false);

  $effect(() => {
    if (expandedCountry) {
      loadingCities = true;
      onCityFetch(expandedCountry).then((result) => {
        cities = result;
        loadingCities = false;
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
  {#if countries.length === 0}
    <p class="text-[11px] text-[var(--fg-muted)]" data-testid="location-empty">No locations in this space</p>
  {:else}
    {#each countries as country (country)}
      {@const isCountrySelected = selectedCountry === country}
      <!-- Country row -->
      <button
        type="button"
        class="flex w-full items-center gap-1.5 py-1 text-[11px] {isCountrySelected
          ? 'font-medium text-[var(--fg)]'
          : 'text-[var(--fg-muted)]'}"
        onclick={() => handleCountryClick(country)}
        data-testid="location-country-{country}"
      >
        <!-- Radio indicator -->
        <div
          class="flex h-[13px] w-[13px] flex-shrink-0 items-center justify-center rounded-full border-[1.5px] {isCountrySelected && !selectedCity
            ? 'border-[var(--primary)] bg-[var(--primary)]'
            : 'border-[var(--border)]'}"
        >
          {#if isCountrySelected && !selectedCity}
            <div class="h-[5px] w-[5px] rounded-full bg-white"></div>
          {/if}
        </div>

        <!-- Label -->
        <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{country}</span>
      </button>

      <!-- Cities (indented 20px when country is expanded) -->
      {#if expandedCountry === country && !loadingCities}
        {#each cities as city (city)}
          {@const isCitySelected = selectedCity === city && selectedCountry === country}
          <button
            type="button"
            class="flex w-full items-center gap-1.5 py-1 pl-5 text-[11px] {isCitySelected
              ? 'font-medium text-[var(--fg)]'
              : 'text-[var(--fg-muted)]'}"
            onclick={() => handleCityClick(city, country)}
            data-testid="location-city-{city}"
          >
            <!-- Radio indicator -->
            <div
              class="flex h-[13px] w-[13px] flex-shrink-0 items-center justify-center rounded-full border-[1.5px] {isCitySelected
                ? 'border-[var(--primary)] bg-[var(--primary)]'
                : 'border-[var(--border)]'}"
            >
              {#if isCitySelected}
                <div class="h-[5px] w-[5px] rounded-full bg-white"></div>
              {/if}
            </div>

            <!-- Label -->
            <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">{city}</span>
          </button>
        {/each}
      {/if}
    {/each}
  {/if}
</div>
