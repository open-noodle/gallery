<script lang="ts">
  import { Icon } from '@immich/ui';
  import {
    mdiChevronLeft,
    mdiChevronRight,
    mdiCalendar,
    mdiAccount,
    mdiMapMarker,
    mdiCamera,
    mdiTag,
    mdiStar,
    mdiImage,
  } from '@mdi/js';
  import type { FilterPanelConfig, FilterState, PersonOption, TagOption } from './filter-panel';
  import { createFilterState } from './filter-panel';
  import FilterSection from './filter-section.svelte';
  import TemporalPicker from './temporal-picker.svelte';
  import PeopleFilter from './people-filter.svelte';
  import LocationFilter from './location-filter.svelte';
  import CameraFilter from './camera-filter.svelte';
  import TagsFilter from './tags-filter.svelte';
  import RatingFilter from './rating-filter.svelte';
  import MediaTypeFilter from './media-type-filter.svelte';

  interface Props {
    config: FilterPanelConfig;
    timeBuckets: Array<{ timeBucket: string; count: number }>;
    onFilterChange: (filters: FilterState) => void;
  }

  let { config, timeBuckets, onFilterChange }: Props = $props();
  let collapsed = $state(false);
  let filters = $state(createFilterState());

  // Fetched data for filter sections
  let people = $state<PersonOption[]>([]);
  let countries = $state<string[]>([]);
  let cameraMakes = $state<string[]>([]);
  let tags = $state<TagOption[]>([]);

  const sectionIcons: Record<string, string> = {
    timeline: mdiCalendar,
    people: mdiAccount,
    location: mdiMapMarker,
    camera: mdiCamera,
    tags: mdiTag,
    rating: mdiStar,
    media: mdiImage,
  };

  const sectionTitles: Record<string, string> = {
    timeline: 'Timeline',
    people: 'People',
    location: 'Location',
    camera: 'Camera',
    tags: 'Tags',
    rating: 'Rating',
    media: 'Media Type',
  };

  // Fetch data on mount via $effect
  $effect(() => {
    if (config.providers.people && config.sections.includes('people')) {
      void config.providers.people().then((result) => {
        people = result;
      });
    }
  });

  $effect(() => {
    if (config.providers.locations && config.sections.includes('location')) {
      void config.providers.locations().then((result) => {
        countries = result.filter((l) => l.type === 'country').map((l) => l.value);
      });
    }
  });

  $effect(() => {
    if (config.providers.cameras && config.sections.includes('camera')) {
      void config.providers.cameras().then((result) => {
        cameraMakes = result.filter((c) => c.type === 'make').map((c) => c.value);
      });
    }
  });

  $effect(() => {
    if (config.providers.tags && config.sections.includes('tags')) {
      void config.providers.tags().then((result) => {
        tags = result;
      });
    }
  });

  function notifyFilterChange() {
    onFilterChange(filters);
  }

  function handlePeopleChange(ids: string[]) {
    filters.personIds = ids;
    notifyFilterChange();
  }

  function handleLocationChange(country?: string, city?: string) {
    filters.country = country;
    filters.city = city;
    notifyFilterChange();
  }

  function handleCameraChange(make?: string, model?: string) {
    filters.make = make;
    filters.model = model;
    notifyFilterChange();
  }

  function handleTagsChange(ids: string[]) {
    filters.tagIds = ids;
    notifyFilterChange();
  }

  function handleRatingChange(rating?: number) {
    filters.rating = rating;
    notifyFilterChange();
  }

  function handleMediaTypeChange(type: 'all' | 'image' | 'video') {
    filters.mediaType = type;
    notifyFilterChange();
  }

  function hasActiveFilter(section: string): boolean {
    switch (section) {
      case 'people': {
        return filters.personIds.length > 0;
      }
      case 'location': {
        return !!filters.city || !!filters.country;
      }
      case 'camera': {
        return !!filters.make;
      }
      case 'tags': {
        return filters.tagIds.length > 0;
      }
      case 'rating': {
        return filters.rating !== undefined;
      }
      case 'media': {
        return filters.mediaType !== 'all';
      }
      default: {
        return false;
      }
    }
  }
</script>

{#if collapsed}
  <div
    class="flex w-8 flex-col items-center gap-3 border-r border-[var(--border)] bg-[#131316] py-2"
    data-testid="collapsed-icon-strip"
  >
    <button
      type="button"
      class="flex h-6 w-6 items-center justify-center rounded-md text-[var(--fg-faint)] hover:bg-[var(--primary-soft)]"
      onclick={() => (collapsed = false)}
      data-testid="expand-panel-btn"
    >
      <Icon icon={mdiChevronRight} size="16" />
    </button>
    {#each config.sections as section (section)}
      <button
        type="button"
        class="relative flex h-6 w-6 items-center justify-center rounded-md text-[var(--fg-faint)] hover:bg-[var(--primary-soft)]"
        onclick={() => (collapsed = false)}
      >
        <Icon icon={sectionIcons[section]} size="16" />
        {#if hasActiveFilter(section)}
          <span
            class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-[1.5px] border-[#131316] bg-[var(--primary)]"
          ></span>
        {/if}
      </button>
    {/each}
  </div>
{:else}
  <div
    class="flex w-60 flex-col overflow-y-auto border-r border-[var(--border)] bg-[#131316] scrollbar-thin"
    data-testid="discovery-panel"
  >
    <div
      class="sticky top-0 z-5 flex items-center justify-between border-b border-[var(--border)] bg-[#131316] px-3 py-2.5"
    >
      <span class="text-[13px] font-semibold">Filters</span>
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded-full text-[var(--fg-muted)]"
        onclick={() => (collapsed = true)}
        data-testid="collapse-panel-btn"
      >
        <Icon icon={mdiChevronLeft} size="14" />
      </button>
    </div>

    {#each config.sections as section (section)}
      <FilterSection title={sectionTitles[section]} testId={section}>
        {#if section === 'timeline'}
          <TemporalPicker {timeBuckets} />
        {:else if section === 'people'}
          <PeopleFilter {people} selectedIds={filters.personIds} onSelectionChange={handlePeopleChange} />
        {:else if section === 'location'}
          <LocationFilter
            {countries}
            selectedCity={filters.city}
            selectedCountry={filters.country}
            onCityFetch={async (_) => {
              if (config.providers.locations) {
                const result = await config.providers.locations();
                return result.filter((l) => l.type === 'city').map((l) => l.value);
              }
              return [];
            }}
            onSelectionChange={handleLocationChange}
          />
        {:else if section === 'camera'}
          <CameraFilter
            makes={cameraMakes}
            selectedMake={filters.make}
            selectedModel={filters.model}
            onModelFetch={async (_) => {
              if (config.providers.cameras) {
                const result = await config.providers.cameras();
                return result.filter((c) => c.type === 'model').map((c) => c.value);
              }
              return [];
            }}
            onSelectionChange={handleCameraChange}
          />
        {:else if section === 'tags'}
          <TagsFilter {tags} selectedIds={filters.tagIds} onSelectionChange={handleTagsChange} />
        {:else if section === 'rating'}
          <RatingFilter selectedRating={filters.rating} onRatingChange={handleRatingChange} />
        {:else if section === 'media'}
          <MediaTypeFilter selected={filters.mediaType} onTypeChange={handleMediaTypeChange} />
        {/if}
      </FilterSection>
    {/each}
  </div>
{/if}
