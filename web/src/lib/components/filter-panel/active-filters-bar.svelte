<script lang="ts">
  import { Icon } from '@immich/ui';
  import {
    mdiAccount,
    mdiCalendar,
    mdiCalendarRange,
    mdiCamera,
    mdiClose,
    mdiFileOutline,
    mdiHeart,
    mdiImage,
    mdiImageAlbum,
    mdiImageMultipleOutline,
    mdiMagnify,
    mdiMapMarker,
    mdiOcr,
    mdiPlus,
    mdiStar,
    mdiTag,
    mdiTextSearch,
    mdiVideo,
  } from '@mdi/js';
  import { t, type Translations } from 'svelte-i18n';
  import type { FilterState } from './filter-panel';

  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  interface Props {
    filters: FilterState;
    resultCount?: number;
    personNames?: Map<string, string>;
    tagNames?: Map<string, string>;
    onRemoveFilter: (type: string, id?: string) => void;
    onClearAll: () => void;
    searchQuery?: string;
    onClearSearch?: () => void;
    embedded?: boolean;
    /**
     * When provided (and there are results), shows an "Add all N to…" action that hands the current
     * filter result off to a collection picker. Surfaces where adding the visible assets to an
     * album/space doesn't apply (tags, trash, locked, partners) simply pass no handler.
     */
    onAddAllToCollection?: () => void;
  }

  let {
    filters,
    resultCount,
    personNames,
    tagNames,
    onRemoveFilter,
    onClearAll,
    searchQuery = '',
    onClearSearch,
    embedded = false,
    onAddAllToCollection,
  }: Props = $props();

  interface Chip {
    type: string;
    id?: string;
    icon: string;
    label?: string;
    labelKey?: Translations;
    labelValues?: Record<string, string>;
  }

  function formatDateOnly(value: string): string {
    return DATE_FORMATTER.format(new Date(`${value}T00:00:00.000Z`));
  }

  function buildCustomDateLabel(
    dateAfter: string | undefined,
    dateBefore: string | undefined,
  ): Pick<Chip, 'label' | 'labelKey' | 'labelValues'> | undefined {
    if (dateAfter && dateBefore) {
      return { label: `${formatDateOnly(dateAfter)} - ${formatDateOnly(dateBefore)}` };
    }
    if (dateAfter) {
      return { labelKey: 'filter_chip_after', labelValues: { date: formatDateOnly(dateAfter) } };
    }
    if (dateBefore) {
      return { labelKey: 'filter_chip_before', labelValues: { date: formatDateOnly(dateBefore) } };
    }
  }

  let chips = $derived.by(() => {
    const result: Chip[] = [];

    // Person chips (one per selected person)
    for (const personId of filters.personIds) {
      const name = personNames?.get(personId) ?? personId;
      result.push({ type: 'person', id: personId, icon: mdiAccount, label: name });
    }

    // Location chip
    if (filters.city && filters.country) {
      result.push({ type: 'location', icon: mdiMapMarker, label: `${filters.city}, ${filters.country}` });
    } else if (filters.city) {
      result.push({ type: 'location', icon: mdiMapMarker, label: filters.city });
    } else if (filters.country) {
      result.push({ type: 'location', icon: mdiMapMarker, label: filters.country });
    }

    // Camera chip
    if (filters.make && filters.model) {
      result.push({ type: 'camera', icon: mdiCamera, label: `${filters.make} ${filters.model}` });
    } else if (filters.make) {
      result.push({ type: 'camera', icon: mdiCamera, label: filters.make });
    }

    // Tag chips (one per selected tag)
    for (const tagId of filters.tagIds) {
      const name = tagNames?.get(tagId) ?? tagId;
      result.push({ type: 'tag', id: tagId, icon: mdiTag, label: name });
    }

    // Rating chip
    if (filters.rating !== undefined) {
      result.push({ type: 'rating', icon: mdiStar, label: `${filters.rating}+` });
    }

    // Media type chip
    if (filters.mediaType === 'image') {
      result.push({ type: 'mediaType', icon: mdiImage, labelKey: 'photos_only' });
    } else if (filters.mediaType === 'video') {
      result.push({ type: 'mediaType', icon: mdiVideo, labelKey: 'videos_only' });
    }

    // Favorites chip
    if (filters.isFavorite === true) {
      result.push({ type: 'favorites', icon: mdiHeart, labelKey: 'favorites' });
    }

    // Albums chip
    if (filters.isNotInAlbum === true) {
      result.push({ type: 'albums', icon: mdiImageAlbum, labelKey: 'filter_has_no_album' });
    }
    if (filters.isInAlbum === true) {
      result.push({ type: 'albums', icon: mdiImageMultipleOutline, labelKey: 'filter_has_album' });
    }

    // Text filter chips
    if (filters.description?.trim()) {
      result.push({ type: 'description', icon: mdiTextSearch, label: filters.description.trim() });
    }
    if (filters.originalFileName?.trim()) {
      result.push({ type: 'filename', icon: mdiFileOutline, label: filters.originalFileName.trim() });
    }
    if (filters.ocr?.trim()) {
      result.push({ type: 'ocr', icon: mdiOcr, label: filters.ocr.trim() });
    }

    // Timeline chip
    const customDateLabel = buildCustomDateLabel(filters.dateAfter, filters.dateBefore);
    if (customDateLabel) {
      result.push({ type: 'timeline', icon: mdiCalendarRange, ...customDateLabel });
    } else if (filters.selectedYear !== undefined) {
      const label =
        filters.selectedMonth === undefined
          ? String(filters.selectedYear)
          : `${MONTH_LABELS[filters.selectedMonth - 1]} ${filters.selectedYear}`;
      result.push({ type: 'timeline', icon: mdiCalendar, label });
    }

    return result;
  });

  let hasActiveFilters = $derived(chips.length > 0 || searchQuery.trim().length > 0);
  let showAddAll = $derived(!!onAddAllToCollection && hasActiveFilters && resultCount !== undefined && resultCount > 0);
  let showCountSeparator = $derived(resultCount !== undefined && (chips.length > 0 || searchQuery.trim().length > 0));
</script>

<div
  class="flex flex-wrap items-center gap-2 {embedded
    ? ''
    : 'border-b border-gray-200/60 px-4 py-2.5 dark:border-white/10'}"
  data-testid="active-filters-bar"
>
  {#if resultCount !== undefined}
    <span class="text-xs font-medium text-gray-500 dark:text-gray-400" data-testid="result-count">
      {$t('filter_result_count', { values: { count: resultCount } })}
    </span>
  {/if}

  {#if showCountSeparator}
    <span class="size-1 rounded-full bg-gray-400/60 dark:bg-gray-500/60" aria-hidden="true"></span>
  {/if}

  {#if searchQuery.trim()}
    <span
      class="inline-flex items-center gap-1.5 rounded-full border border-immich-primary/30 bg-immich-primary/10 py-1 pr-1 pl-2.5 text-xs font-medium text-immich-primary dark:border-immich-dark-primary/30 dark:bg-immich-dark-primary/10 dark:text-immich-dark-primary"
      data-testid="search-chip"
    >
      <Icon icon={mdiMagnify} size="14" />
      <span>{searchQuery}</span>
      <button
        type="button"
        class="flex size-[18px] items-center justify-center rounded-full text-immich-primary/60 transition-colors hover:bg-immich-primary/15 hover:text-immich-primary dark:text-immich-dark-primary/60 dark:hover:bg-immich-dark-primary/20 dark:hover:text-immich-dark-primary"
        onclick={() => onClearSearch?.()}
        aria-label={$t('filter_sheet_picker_clear_search')}
        data-testid="search-chip-close"
      >
        <Icon icon={mdiClose} size="12" />
      </button>
    </span>
  {/if}

  {#each chips as chip (`${chip.type}-${chip.id ?? chip.labelKey ?? chip.label}`)}
    {@const chipLabel = chip.labelKey ? $t(chip.labelKey, { values: chip.labelValues }) : (chip.label ?? '')}
    <span
      class="inline-flex items-center gap-1.5 rounded-full border border-gray-200/70 bg-gray-100 py-1 pr-1 pl-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:border-white/10 dark:bg-white/6 dark:text-gray-200 dark:hover:bg-white/10"
      data-testid="active-chip"
    >
      <Icon icon={chip.icon} size="14" class="text-gray-500 dark:text-gray-400" />
      <span>{chipLabel}</span>
      <button
        type="button"
        class="flex size-[18px] items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-300/70 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-white/10 dark:hover:text-gray-200"
        onclick={() => onRemoveFilter(chip.type, chip.id)}
        aria-label={$t('filter_remove_chip', { values: { label: chipLabel } })}
        data-testid="chip-close"
      >
        <Icon icon={mdiClose} size="12" />
      </button>
    </span>
  {/each}

  {#if showAddAll}
    <button
      type="button"
      class="ml-auto inline-flex items-center gap-1.5 rounded-full bg-immich-primary/10 py-1 ps-2.5 pe-3.5 text-xs font-semibold text-immich-primary transition-colors hover:bg-immich-primary/16 dark:bg-immich-dark-primary/10 dark:text-immich-dark-primary dark:hover:bg-immich-dark-primary/20"
      onclick={() => onAddAllToCollection?.()}
      data-testid="add-all-to-collection"
    >
      <Icon icon={mdiPlus} size="15" />
      <span>{$t('add_all_search_results', { values: { count: resultCount ?? 0 } })}</span>
    </button>
  {/if}

  {#if hasActiveFilters}
    <button
      type="button"
      class="rounded-full px-2.5 py-1 text-xs font-semibold text-immich-primary transition-colors hover:bg-immich-primary/10 dark:text-immich-dark-primary dark:hover:bg-immich-dark-primary/10"
      class:ml-auto={!showAddAll}
      onclick={() => {
        onClearAll();
        if (searchQuery) {
          onClearSearch?.();
        }
      }}
      data-testid="clear-all-btn"
    >
      {$t('clear_all')}
    </button>
  {/if}
</div>
