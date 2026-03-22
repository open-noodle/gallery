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
  import type { FilterPanelConfig, FilterState } from './filter-panel';
  import { createFilterState } from './filter-panel';
  import FilterSection from './filter-section.svelte';
  import TemporalPicker from './temporal-picker.svelte';

  interface Props {
    config: FilterPanelConfig;
    timeBuckets: Array<{ timeBucket: string; count: number }>;
    onFilterChange: (filters: FilterState) => void;
  }

  let { config, timeBuckets, onFilterChange }: Props = $props();
  let collapsed = $state(false);
  let filters = $state(createFilterState());

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
        {#if hasActiveFilter(section) && section !== 'tags' && section !== 'media'}
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
        {:else}
          <p class="text-xs text-[var(--fg-muted)]">{sectionTitles[section]} filter placeholder</p>
        {/if}
      </FilterSection>
    {/each}
  </div>
{/if}
