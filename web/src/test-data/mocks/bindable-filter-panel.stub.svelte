<script lang="ts">
  import {
    buildFilterContext,
    type FilterPanelConfig,
    type FilterState,
  } from '$lib/components/filter-panel/filter-panel';

  interface Props {
    filters?: FilterState;
    config?: FilterPanelConfig;
    timeBuckets?: Array<{ timeBucket: string; count: number }>;
    personNames?: Map<string, string>;
    tagNames?: Map<string, string>;
    onFiltersChange?: (filters: FilterState) => void;
    collapsed?: boolean;
    [key: string]: unknown;
  }

  let {
    filters = $bindable(),
    config,
    timeBuckets = [],
    personNames,
    tagNames,
    onFiltersChange,
    collapsed = $bindable(false),
    ...rest
  }: Props = $props();
  let suggestions = $state('');
  let requestToken = 0;
  // #910: 'not-loaded' vs the string 'undefined' lets tests tell "never clicked" apart from "the
  // provider resolved undefined" without adding a second attribute.
  let baseline = $state('not-loaded');

  async function loadBaseline() {
    const result = await config?.baselineProvider?.();
    baseline = result === undefined ? 'undefined' : JSON.stringify(result);
  }

  function updateFilters(nextFilters: FilterState) {
    filters = nextFilters;
    onFiltersChange?.(nextFilters);
  }

  function selectFavorites() {
    if (filters) {
      updateFilters({ ...filters, isFavorite: true });
    }
  }

  function selectHasNoAlbum() {
    if (filters) {
      updateFilters({ ...filters, isNotInAlbum: true });
    }
  }

  function selectHasAlbum() {
    if (filters) {
      updateFilters({ ...filters, isInAlbum: true });
    }
  }

  function loadCitySuggestions() {
    if (filters) {
      // Same exclusion list as filter-panel.svelte's locationFilterContext — the whole location group.
      void config?.providers?.cities?.('Germany', buildFilterContext(filters, ['country', 'state', 'city']));
    }
  }

  function loadCameraModelSuggestions() {
    if (filters) {
      void config?.providers?.cameraModels?.('Sony', buildFilterContext(filters, ['make', 'model']));
    }
  }

  $effect(() => {
    if (!config?.suggestionsProvider || !filters) {
      suggestions = '';
      return;
    }

    const token = ++requestToken;
    config
      .suggestionsProvider(filters)
      .then((result) => {
        if (token === requestToken) {
          suggestions = JSON.stringify(result);
        }
      })
      .catch(() => {
        if (token === requestToken) {
          suggestions = 'error';
        }
      });
  });
</script>

<div
  {...rest}
  data-testid="filter-panel-stub"
  data-has-filters={String(filters !== undefined)}
  data-sections={config?.sections.join(',') ?? ''}
  data-country={filters?.country ?? ''}
  data-is-favorite={String(filters?.isFavorite)}
  data-is-not-in-album={String(filters?.isNotInAlbum)}
  data-is-in-album={String(filters?.isInAlbum)}
  data-selected-year={filters?.selectedYear ?? ''}
  data-selected-month={filters?.selectedMonth ?? ''}
  data-date-after={filters?.dateAfter ?? ''}
  data-date-before={filters?.dateBefore ?? ''}
  data-time-buckets={JSON.stringify(timeBuckets)}
  data-suggestions={suggestions}
  data-baseline={baseline}
  data-person-names={JSON.stringify([...(personNames?.entries() ?? [])])}
  data-tag-names={JSON.stringify([...(tagNames?.entries() ?? [])])}
  data-collapsed={String(collapsed)}
>
  <button type="button" data-testid="filter-panel-collapse" onclick={() => (collapsed = true)}>Collapse</button>
  <button type="button" data-testid="select-favorites-filter" onclick={selectFavorites}>Favorites</button>
  <button type="button" data-testid="select-has-no-album-filter" onclick={selectHasNoAlbum}>Has no album</button>
  <button type="button" data-testid="select-has-album-filter" onclick={selectHasAlbum}>Has album</button>
  <button
    type="button"
    data-testid="filter-panel-set-text"
    onclick={() => {
      if (filters) {
        updateFilters({
          ...filters,
          description: 'birthday cake',
          originalFileName: 'IMG_1234.jpg',
          ocr: 'happy birthday',
        });
      }
    }}
  >
    Set text filters
  </button>
  <button type="button" data-testid="load-city-suggestions" onclick={loadCitySuggestions}>Load cities</button>
  <button type="button" data-testid="load-camera-model-suggestions" onclick={loadCameraModelSuggestions}>
    Load camera models
  </button>
  <button type="button" data-testid="load-baseline" onclick={loadBaseline}>Load baseline</button>
  <button
    type="button"
    data-testid="filter-panel-set-country"
    onclick={() => {
      if (filters) {
        updateFilters({ ...filters, country: 'Germany' });
      }
    }}
  >
    Set country
  </button>
  <button
    type="button"
    data-testid="filter-panel-clear-location"
    onclick={() => {
      if (filters) {
        updateFilters({ ...filters, country: undefined, city: undefined });
      }
    }}
  >
    Clear location
  </button>
  <button
    type="button"
    data-testid="filter-panel-set-sort-asc"
    onclick={() => {
      if (filters) {
        updateFilters({ ...filters, sortOrder: 'asc' });
      }
    }}
  >
    Sort ascending
  </button>
  <button
    type="button"
    data-testid="filter-panel-clear-timeline"
    onclick={() => {
      if (filters) {
        updateFilters({
          ...filters,
          dateAfter: undefined,
          dateBefore: undefined,
          selectedYear: undefined,
          selectedMonth: undefined,
        });
      }
    }}
  >
    Clear timeline
  </button>
  <button
    type="button"
    data-testid="filter-panel-set-year"
    onclick={() => {
      if (filters) {
        updateFilters({
          ...filters,
          dateAfter: undefined,
          dateBefore: undefined,
          selectedYear: 2015,
          selectedMonth: undefined,
        });
      }
    }}
  >
    Set year
  </button>
  <button
    type="button"
    data-testid="filter-panel-set-month"
    onclick={() => {
      if (filters) {
        updateFilters({
          ...filters,
          dateAfter: undefined,
          dateBefore: undefined,
          selectedYear: 2015,
          selectedMonth: 8,
        });
      }
    }}
  >
    Set month
  </button>
  <button
    type="button"
    data-testid="filter-panel-set-custom-range"
    onclick={() => {
      if (filters) {
        updateFilters({
          ...filters,
          dateAfter: '2024-01-01',
          dateBefore: '2024-12-31',
          selectedYear: undefined,
          selectedMonth: undefined,
        });
      }
    }}
  >
    Set custom date range
  </button>
</div>
