<script lang="ts">
  import { Icon } from '@immich/ui';
  import { browser } from '$app/environment';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';
  import { mdiClose, mdiTune } from '@mdi/js';
  import { untrack } from 'svelte';
  import type {
    FilterPanelConfig,
    FilterSection as FilterSectionType,
    FilterState,
    FilterSuggestionsResponse,
    PersonOption,
    TagOption,
  } from './filter-panel';
  import {
    ALL_FILTER_SECTIONS,
    buildFilterContext,
    createFilterState,
    getActiveFilterCount,
    loadFilterCollapsed,
    PRE_LEDGER_FILTER_SECTIONS,
    saveFilterCollapsed,
  } from './filter-panel';
  import { getSectionAvailability, type SectionAvailability } from './filter-availability';
  import FilterSection from './filter-section.svelte';
  import FilterSectionMenu from './filter-section-menu.svelte';
  import TemporalPicker from './temporal-picker.svelte';
  import PeopleFilter from './people-filter.svelte';
  import LocationFilter from './location-filter.svelte';
  import CameraFilter from './camera-filter.svelte';
  import TagsFilter from './tags-filter.svelte';
  import RatingFilter from './rating-filter.svelte';
  import MediaTypeFilter from './media-type-filter.svelte';
  import FavoritesFilter from './favorites-filter.svelte';
  import AlbumsFilter from './albums-filter.svelte';
  import TextFilter from './text-filter.svelte';

  interface Props {
    config: FilterPanelConfig;
    timeBuckets: Array<{ timeBucket: string; count: number }>;
    filters?: FilterState;
    personNames?: Map<string, string>;
    tagNames?: Map<string, string>;
    onFiltersChange?: (filters: FilterState) => void;
    persistCollapsed?: boolean;
    storageKey?: string;
    hidden?: boolean;
    // Two-way collapsed state so a page can drive it from an external header filter button.
    collapsed?: boolean;
    // When true, the collapsed panel renders nothing — the page supplies a header filter button and
    // reclaims the horizontal space (used on timeline pages). When false, the built-in collapsed
    // button is shown (default; used e.g. by the map's filter drawer).
    externalToggle?: boolean;
  }

  let {
    config,
    timeBuckets,
    filters = $bindable(createFilterState()),
    personNames,
    tagNames,
    onFiltersChange,
    storageKey = 'gallery-filter-visible-sections',
    hidden = false,
    persistCollapsed = true,
    collapsed = $bindable(),
    externalToggle = false,
  }: Props = $props();

  // Respect persistCollapsed for the initial value when the parent doesn't control `collapsed`.
  if (collapsed === undefined) {
    collapsed = persistCollapsed ? loadFilterCollapsed() : false;
  }

  const providers = config.providers ?? {};

  // Fetched data for filter sections
  let people = $state<PersonOption[]>([]);
  let hasUnnamedPeople = $state(false);
  let countries = $state<string[]>([]);
  let cameraMakes = $state<string[]>([]);
  let tags = $state<TagOption[]>([]);
  let availableRatings = $state<number[] | undefined>();
  let availableMediaTypes = $state<string[] | undefined>();

  // #910: the facets for the filters in force right now, and for the same scope with none applied.
  // The baseline answers "could this section EVER do anything here", which is what separates hiding a
  // section from merely greying it.
  let currentSuggestions = $state<FilterSuggestionsResponse | undefined>();
  let baseline = $state<FilterSuggestionsResponse | undefined>();
  let baselineRequested = false;

  // The count gate answers "has a *cross-section* filter narrowed the panel?". It drives the
  // empty-section disable in filter-section.svelte, not a request, so the location/camera/media
  // dimensions added for #858 stay out of it — see the #858 design doc §3.3. `state` / `lensModel` /
  // `ownerId` join them for the same reason: they only ever arrive from a contextual filter, typed
  // search or a link, and turning the disable behaviour on for those arrivals is a separate UX call.
  let filterContext = $derived(
    buildFilterContext(filters, ['country', 'state', 'city', 'make', 'model', 'lensModel', 'ownerId', 'mediaType']),
  );
  // country / state / city are ONE filter — `handleLocationChange` replaces all three on any click —
  // so the whole group is self-excluded here and the drill-down parent is passed explicitly instead.
  // A city list narrowed by a state that the very next click clears would be a lie.
  let locationFilterContext = $derived(buildFilterContext(filters, ['country', 'state', 'city']));
  // `lensModel` is NOT excluded: `handleCameraChange` leaves the lens chip alone, so it stays an
  // independent active filter and the model list may honestly narrow by it.
  let cameraFilterContext = $derived(buildFilterContext(filters, ['make', 'model']));

  // Unified suggestions re-fetch: replaces mount effects + temporal re-fetch when suggestionsProvider is set
  let prevFilters: FilterState | undefined = $state();
  let unifiedAbortController: AbortController | undefined = $state();

  $effect(() => {
    if (!config.suggestionsProvider) {
      return;
    }

    // Track all filter fields — reading them registers as dependencies
    const current: FilterState = {
      personIds: filters.personIds,
      city: filters.city,
      country: filters.country,
      // Tracked so clearing a state re-fetches: the suggestion lists describe the filtered set, and
      // dropping a state widens it. Same for the lens and the contributor narrowing — and the
      // provider reads this reconstructed state, so an untracked field is also an unsent one.
      state: filters.state,
      make: filters.make,
      model: filters.model,
      lensModel: filters.lensModel,
      ownerId: filters.ownerId,
      tagIds: filters.tagIds,
      rating: filters.rating,
      mediaType: filters.mediaType,
      isFavorite: filters.isFavorite,
      isNotInAlbum: filters.isNotInAlbum,
      isInAlbum: filters.isInAlbum,
      sortOrder: filters.sortOrder,
      dateAfter: filters.dateAfter,
      dateBefore: filters.dateBefore,
      selectedYear: filters.selectedYear,
      selectedMonth: filters.selectedMonth,
    };

    const prev = untrack(() => prevFilters);

    const isInitialMount = prev === undefined;
    const temporalChanged =
      !isInitialMount &&
      (prev.dateAfter !== current.dateAfter ||
        prev.dateBefore !== current.dateBefore ||
        prev.selectedYear !== current.selectedYear ||
        prev.selectedMonth !== current.selectedMonth);
    const isTemporalClear =
      temporalChanged &&
      current.dateAfter === undefined &&
      current.dateBefore === undefined &&
      current.selectedYear === undefined;

    const delay = isInitialMount || isTemporalClear ? 0 : temporalChanged ? 200 : 50;

    const provider = config.suggestionsProvider;
    const currentFilters = { ...current };

    const timeout = setTimeout(() => {
      unifiedAbortController?.abort();
      const controller = new AbortController();
      unifiedAbortController = controller;
      isRefetching = true;

      void provider(currentFilters)
        .then((result) => {
          if (controller.signal.aborted) {
            return;
          }
          people = result.people;
          countries = result.countries;
          cameraMakes = result.cameraMakes;
          tags = result.tags;
          // Note: availableRatings and availableMediaTypes are intentionally NOT set from
          // suggestionsProvider. Hiding or dimming rating stars and media type buttons based on the
          // current result set breaks their positional meaning (PR #261) and the E2E suites that click
          // them. #910 gates the *sections* instead — the facets reach getSectionAvailability through
          // `currentSuggestions` below, never the controls. See spec §2.4.
          hasUnnamedPeople = result.hasUnnamedPeople;
          currentSuggestions = result;
          if (getActiveFilterCount(currentFilters) === 0) {
            // Mounted clean, so this response is already the no-filters baseline — no second request.
            baseline = result;
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            console.error('Failed to fetch filter suggestions:', error);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            isRefetching = false;
          }
        });
    }, delay);

    prevFilters = current;

    return () => {
      clearTimeout(timeout);
    };
  });

  // Only fires when the panel mounts with filters already applied (a deep link, or restored state) —
  // otherwise the effect above captures the baseline for free. Scope changes remount the panel, so this
  // needs no invalidation: see spec §4.5 for the `{#key}` blocks that guarantee it.
  $effect(() => {
    const provider = config.baselineProvider;
    if (!config.suggestionsProvider || !provider || baselineRequested) {
      return;
    }
    baselineRequested = true;

    if (untrack(() => getActiveFilterCount(filters)) === 0) {
      return;
    }

    void provider()
      // A surface with no cheap baseline resolves `undefined` (every query-mode branch does). Assigning
      // it is a no-op that keeps the "never hidden on missing information" rule intact.
      .then((result) => {
        baseline = result;
      })
      .catch(() => {
        // Leave it undefined. A section is never hidden on missing information.
      });
  });

  let prevTakenAfter: string | undefined = $state();
  let prevTakenBefore: string | undefined = $state();
  let abortController: AbortController | undefined = $state();
  let isRefetching = $state(false);

  // Debounced re-fetch when temporal filter changes.
  // We track temporal fields directly instead of
  // filterContext to avoid re-triggering when non-temporal filters change.
  $effect(() => {
    if (config.suggestionsProvider) {
      return;
    }

    // Track only temporal fields — this is what determines re-fetch
    const dateAfter = filters.dateAfter;
    const dateBefore = filters.dateBefore;
    const year = filters.selectedYear;
    const month = filters.selectedMonth;
    // Build context from tracked values (not from filterContext which would track all of filters)
    const currentContext = buildFilterContext({
      dateAfter,
      dateBefore,
      selectedYear: year,
      selectedMonth: month,
    } as FilterState);
    const currentTakenAfter = currentContext?.takenAfter;
    const currentTakenBefore = currentContext?.takenBefore;

    // Read prev values without tracking to avoid re-trigger loops
    const prevAfter = untrack(() => prevTakenAfter);
    const prevBefore = untrack(() => prevTakenBefore);

    // Skip initial load (both undefined)
    if (
      prevAfter === undefined &&
      prevBefore === undefined &&
      currentTakenAfter === undefined &&
      currentTakenBefore === undefined
    ) {
      return;
    }

    // Skip if context hasn't actually changed
    if (prevAfter === currentTakenAfter && prevBefore === currentTakenBefore) {
      return;
    }

    const isClear = (prevAfter !== undefined || prevBefore !== undefined) && currentContext === undefined;
    const delay = isClear ? 0 : 200;

    const sections = config.sections;

    const timeout = setTimeout(() => {
      // Abort previous in-flight requests
      abortController?.abort();
      const controller = new AbortController();
      abortController = controller;
      isRefetching = true;

      const promises: Promise<void>[] = [];

      if (providers.people && sections.includes('people')) {
        promises.push(
          providers
            .people(currentContext)
            .then((result) => {
              if (!controller.signal.aborted) {
                people = result;
              }
            })
            .catch((error: unknown) => {
              console.error('Failed to re-fetch people:', error);
            }),
        );
      }

      if (providers.locations && sections.includes('location')) {
        promises.push(
          providers
            .locations(currentContext)
            .then((result) => {
              if (!controller.signal.aborted) {
                countries = result.filter((l) => l.type === 'country').map((l) => l.value);
              }
            })
            .catch((error: unknown) => {
              console.error('Failed to re-fetch locations:', error);
            }),
        );
      }

      if (providers.cameras && sections.includes('camera')) {
        promises.push(
          providers
            .cameras(currentContext)
            .then((result) => {
              if (!controller.signal.aborted) {
                cameraMakes = result.filter((c) => c.type === 'make').map((c) => c.value);
              }
            })
            .catch((error: unknown) => {
              console.error('Failed to re-fetch cameras:', error);
            }),
        );
      }

      if (providers.tags && sections.includes('tags')) {
        promises.push(
          providers
            .tags(currentContext)
            .then((result) => {
              if (!controller.signal.aborted) {
                tags = result;
              }
            })
            .catch((error: unknown) => {
              console.error('Failed to re-fetch tags:', error);
            }),
        );
      }

      void Promise.allSettled(promises).then(() => {
        if (!controller.signal.aborted) {
          isRefetching = false;
        }
      });
    }, delay);

    prevTakenAfter = currentTakenAfter;
    prevTakenBefore = currentTakenBefore;

    return () => {
      clearTimeout(timeout);
    };
  });

  // Cleanup on unmount
  $effect(() => {
    return () => {
      abortController?.abort();
      unifiedAbortController?.abort();
    };
  });

  let sectionTitles = $derived<Record<string, string>>({
    timeline: $t('timeline'),
    people: $t('people'),
    location: $t('location'),
    camera: $t('camera'),
    tags: $t('tags'),
    rating: $t('rating'),
    media: $t('media_type'),
    favorites: $t('favorites'),
    albums: $t('albums'),
    text: $t('filter_text'),
  });

  let sectionToggleLabels = $derived<Record<string, string>>({
    ...sectionTitles,
    // Avoid colliding with asset action buttons labeled "Favorite" in browser automation.
    favorites: $t('filter_favorites_section'),
  });

  type StoredSectionSet = string[] | { selected?: string[]; known?: string[] };

  /**
   * The stored record behind a section set. It is scoped to the browser, not to the surface:
   * album detail and the album asset picker share a storage key but offer different section
   * lists, so entries this surface does not render are carried through untouched rather than
   * intersected away — otherwise the shorter surface forgets them and the longer one keeps
   * treating them as brand new (#797).
   */
  interface SectionLedger {
    selected: FilterSectionType[];
    known: FilterSectionType[];
  }

  const PRE_LEDGER_SECTIONS = new Set<FilterSectionType>(PRE_LEDGER_FILTER_SECTIONS);

  function isFilterSection(value: unknown): value is FilterSectionType {
    return typeof value === 'string' && (ALL_FILTER_SECTIONS as readonly string[]).includes(value);
  }

  function getValidSections(values: unknown): FilterSectionType[] {
    if (!Array.isArray(values)) {
      return [];
    }
    return values.filter((value): value is FilterSectionType => isFilterSection(value));
  }

  function readLedger(raw: string | null): SectionLedger | undefined {
    if (raw === null) {
      return undefined;
    }

    let parsed: StoredSectionSet;
    try {
      parsed = JSON.parse(raw) as StoredSectionSet;
    } catch {
      return undefined;
    }

    if (!Array.isArray(parsed)) {
      return { selected: getValidSections(parsed?.selected), known: getValidSections(parsed?.known) };
    }

    const selected = getValidSections(parsed);
    // A stored list none of whose entries survive is unusable — fall back to showing everything.
    if (parsed.length > 0 && selected.length === 0) {
      return undefined;
    }

    // Legacy storage predates the `known` list, so the sections that existed back then are all it
    // can vouch for; everything added since counts as introduced and is revealed on upgrade.
    return { selected, known: [...new Set([...selected, ...PRE_LEDGER_SECTIONS])] };
  }

  function resolveSections(
    configSections: FilterSectionType[],
    ledger: SectionLedger | undefined,
  ): SvelteSet<FilterSectionType> {
    if (!ledger) {
      return new SvelteSet(configSections);
    }

    const known = new Set(ledger.known);
    const introduced = configSections.filter((section) => !known.has(section));
    return new SvelteSet([...ledger.selected, ...introduced]);
  }

  function serializeSectionSet(
    sections: SvelteSet<FilterSectionType>,
    configSections: FilterSectionType[],
    ledger: SectionLedger | undefined,
  ): string {
    return JSON.stringify({
      selected: [...sections],
      known: [...new Set([...(ledger?.known ?? []), ...configSections])],
    });
  }

  const visibleLedger = readLedger(browser ? localStorage.getItem(storageKey) : null);
  let visibleSections = $state(resolveSections(config.sections, visibleLedger));

  let sectionMenuOpen = $state(false);

  const EXPANDED_SECTIONS_KEY = 'gallery-filter-expanded-sections';

  const expandedLedger = readLedger(browser ? localStorage.getItem(EXPANDED_SECTIONS_KEY) : null);
  let expandedSections = $state(resolveSections(config.sections, expandedLedger));

  function toggleSectionExpanded(section: FilterSectionType) {
    const next = new SvelteSet(expandedSections);
    if (next.has(section)) {
      next.delete(section);
    } else {
      next.add(section);
    }
    expandedSections = next;
  }

  function toggleSection(section: FilterSectionType) {
    const next = new SvelteSet(visibleSections);
    if (next.has(section)) {
      next.delete(section);
    } else {
      next.add(section);
    }
    visibleSections = next;
  }

  function showAllSections() {
    // Union rather than replace: sections another surface tracks under the same storage key are
    // not this surface's to clear.
    visibleSections = new SvelteSet([...visibleSections, ...config.sections]);
  }

  $effect(() => {
    if (browser) {
      try {
        localStorage.setItem(storageKey, serializeSectionSet(visibleSections, config.sections, visibleLedger));
      } catch {
        /* localStorage unavailable */
      }
    }
  });

  $effect(() => {
    if (persistCollapsed) {
      // `collapsed` is a bindable with no default (`boolean | undefined`) so the `=== undefined`
      // init above can decide whether to seed from storage; it's always a boolean by here.
      saveFilterCollapsed(collapsed ?? false);
    }
  });

  $effect(() => {
    if (browser) {
      try {
        localStorage.setItem(
          EXPANDED_SECTIONS_KEY,
          serializeSectionSet(expandedSections, config.sections, expandedLedger),
        );
      } catch {
        /* localStorage unavailable */
      }
    }
  });

  // externalToggle keeps this panel mounted at w-0 while collapsed rather than unmounting it, so
  // an open menu would survive the collapse and still be open on reopen - and in the meantime is
  // a popover painting out of a zero-width, inert box.
  $effect(() => {
    if (collapsed) {
      sectionMenuOpen = false;
    }
  });

  // Fetch data on mount via $effect
  $effect(() => {
    if (config.suggestionsProvider) {
      return;
    }
    if (providers.people && config.sections.includes('people')) {
      void providers.people().then((result) => {
        people = result;
        if (result.length === 0 && providers.allPeople) {
          void providers.allPeople().then((all) => {
            hasUnnamedPeople = all.length > 0;
          });
        }
      });
    }
  });

  $effect(() => {
    if (config.suggestionsProvider) {
      return;
    }
    if (providers.locations && config.sections.includes('location')) {
      void providers.locations().then((result) => {
        countries = result.filter((l) => l.type === 'country').map((l) => l.value);
      });
    }
  });

  $effect(() => {
    if (config.suggestionsProvider) {
      return;
    }
    if (providers.cameras && config.sections.includes('camera')) {
      void providers.cameras().then((result) => {
        cameraMakes = result.filter((c) => c.type === 'make').map((c) => c.value);
      });
    }
  });

  $effect(() => {
    if (config.suggestionsProvider) {
      return;
    }
    if (providers.tags && config.sections.includes('tags')) {
      void providers.tags().then((result) => {
        tags = result;
      });
    }
  });

  function updateFilters(nextFilters: FilterState) {
    filters = nextFilters;
    onFiltersChange?.(nextFilters);
  }

  function handlePeopleChange(ids: string[]) {
    updateFilters({ ...filters, personIds: ids });
  }

  // city / state / country are ONE filter and one chip, so a change to any of them REPLACES the
  // group. `state` defaulting to undefined is what makes a country or city click drop a stale state
  // rather than silently AND-ing an invisible predicate onto the new selection.
  function handleLocationChange(country?: string, city?: string, state?: string) {
    updateFilters({ ...filters, country, city, state });
  }

  function handleCameraChange(make?: string, model?: string) {
    updateFilters({ ...filters, make, model });
  }

  function handleTagsChange(ids: string[]) {
    updateFilters({ ...filters, tagIds: ids });
  }

  function handleRatingChange(rating?: number) {
    updateFilters({ ...filters, rating });
  }

  function handleMediaTypeChange(type: 'all' | 'image' | 'video') {
    updateFilters({ ...filters, mediaType: type });
  }

  function handleCustomDateRangeChange(dateAfter: string | undefined, dateBefore: string | undefined) {
    updateFilters({ ...filters, dateAfter, dateBefore, selectedYear: undefined, selectedMonth: undefined });
  }

  function handleYearSelect(year: number | undefined) {
    updateFilters({
      ...filters,
      dateAfter: undefined,
      dateBefore: undefined,
      selectedYear: year,
      selectedMonth: undefined,
    });
  }

  function handleMonthSelect(year: number, month: number | undefined) {
    updateFilters({
      ...filters,
      dateAfter: undefined,
      dateBefore: undefined,
      selectedYear: year,
      selectedMonth: month,
    });
  }

  function hasActiveFilter(section: string): boolean {
    switch (section) {
      case 'people': {
        return filters.personIds.length > 0;
      }
      case 'location': {
        // `state` counts: it is part of the same one-filter group, and without it a state-only
        // filter left the section looking untouched from the outside too (no dot on the collapsed
        // panel, none on the hidden-section toggle).
        return !!filters.city || !!filters.country || !!filters.state;
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
      case 'favorites': {
        return filters.isFavorite !== undefined;
      }
      case 'albums': {
        return filters.isNotInAlbum === true || filters.isInAlbum === true;
      }
      case 'timeline': {
        return (
          filters.dateAfter !== undefined || filters.dateBefore !== undefined || filters.selectedYear !== undefined
        );
      }
      case 'text': {
        return !!filters.description?.trim() || !!filters.originalFileName?.trim() || !!filters.ocr?.trim();
      }
      default: {
        return false;
      }
    }
  }

  // Whether any section has an active filter — surfaced as a single dot on the collapsed filter button.
  let anyActiveFilter = $derived(config.sections.some((section) => hasActiveFilter(section)));

  // Availability is derived, never persisted — the storage effect keeps writing `config.sections`.
  // Conflating the two would record a section as user-hidden the moment it went unavailable, and it
  // would never come back.
  let availability = $derived<Map<FilterSectionType, SectionAvailability>>(
    new Map(
      config.sections.map((section) => [
        section,
        config.suggestionsProvider && currentSuggestions
          ? getSectionAvailability(section, {
              current: currentSuggestions,
              baseline,
              hasActiveFilter: hasActiveFilter(section),
              timeBucketCount: timeBuckets.length,
            })
          : 'available',
      ]),
    ),
  );

  let renderableSections = $derived(config.sections.filter((section) => availability.get(section) !== 'unavailable'));
</script>

{#if hidden}
  <!-- No assets to filter — nothing to render. -->
{:else}
  <!-- The shell stays mounted even when collapsed so the width transition animates open/close. In
       externalToggle mode it collapses to w-0 (space reclaimed, content clipped + inert); otherwise it
       collapses to the w-12 built-in filter button. -->
  <div
    class="flex h-full shrink-0 overflow-hidden transition-[width] duration-420 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none {collapsed
      ? externalToggle
        ? 'w-0'
        : 'w-12'
      : 'w-64 border-r border-gray-200/60 bg-light dark:border-white/5'}"
    data-testid="filter-panel-shell"
  >
    {#if collapsed && !externalToggle}
      <!-- Collapsed (built-in): a single filter button. Clicking it re-opens the panel; a dot marks any
           active filter. Keeps the collapsed-icon-strip / expand-panel-btn testids. -->
      <div class="flex shrink-0 items-start p-1.5" data-testid="collapsed-icon-strip">
        <button
          type="button"
          class="relative flex size-9 items-center justify-center rounded-lg text-gray-500 hover:bg-subtle dark:text-gray-400"
          onclick={() => (collapsed = false)}
          data-testid="expand-panel-btn"
          aria-label={$t('filters')}
          title={$t('filters')}
        >
          <Icon icon={mdiTune} size="20" />
          {#if anyActiveFilter}
            <span
              class="absolute -top-0.5 -right-0.5 size-2 rounded-full border-[1.5px] border-light bg-immich-primary dark:bg-immich-dark-primary"
            ></span>
          {/if}
        </button>
      </div>
    {:else}
      <!-- inert while collapsed: in externalToggle mode this panel stays mounted at w-0 (clipped) so the
           open/close animates, but its inputs must not be focusable/announced while hidden. -->
      <div
        class="flex h-full w-64 immich-scrollbar flex-col overflow-y-auto bg-light"
        data-testid="discovery-panel"
        inert={collapsed}
      >
        <div
          class="sticky top-0 z-5 flex items-center justify-between border-b border-gray-200 bg-light px-4 py-2.5 dark:border-gray-700"
        >
          <div class="flex items-center gap-1">
            <span class="text-sm font-medium">{$t('filters')}</span>
            {#if renderableSections.length > 0}
              <FilterSectionMenu
                bind:open={sectionMenuOpen}
                sections={renderableSections}
                visible={visibleSections}
                titles={sectionTitles}
                toggleLabels={sectionToggleLabels}
                {hasActiveFilter}
                onToggle={toggleSection}
                onShowAll={showAllSections}
              />
            {/if}
          </div>
          <button
            type="button"
            class="flex size-6 items-center justify-center rounded-full text-gray-500 hover:bg-subtle dark:text-gray-400"
            onclick={() => (collapsed = true)}
            data-testid="collapse-panel-btn"
            aria-label={$t('collapse')}
          >
            <Icon icon={mdiClose} size="16" />
          </button>
        </div>

        <div class="pt-4">
          {#each renderableSections as section (section)}
            {#if visibleSections.has(section)}
              <!-- The "(0)" / disable gate answers "has a CROSS-SECTION filter narrowed the panel?",
                   so the #910 availability verdict is gated on filterContext exactly as the legacy
                   formula below is: #858 §3.3 decision 3 keeps `state` / `lensModel` / `ownerId`
                   (and the location/camera/media dimensions) out of it, because those arrive from a
                   contextual filter or a link rather than the panel's own controls. 'timeline' is
                   the one exception — its `empty` means "this page has no assets at all", which no
                   filter is responsible for. Hiding an `unavailable` section is separate and stays
                   ungated (renderableSections, above). -->
              <FilterSection
                title={sectionTitles[section]}
                testId={section}
                refetching={isRefetching && section !== 'timeline'}
                expanded={expandedSections.has(section)}
                onToggleExpanded={() => toggleSectionExpanded(section)}
                count={config.suggestionsProvider
                  ? (section === 'timeline' || filterContext) && availability.get(section) === 'empty'
                    ? 0
                    : undefined
                  : filterContext
                    ? section === 'people'
                      ? people.length
                      : section === 'location'
                        ? countries.length
                        : section === 'camera'
                          ? cameraMakes.length
                          : section === 'tags'
                            ? tags.length
                            : undefined
                    : undefined}
              >
                {#if section === 'timeline'}
                  <TemporalPicker
                    {timeBuckets}
                    dateAfter={filters.dateAfter}
                    dateBefore={filters.dateBefore}
                    selectedYear={filters.selectedYear}
                    selectedMonth={filters.selectedMonth}
                    onCustomRangeChange={handleCustomDateRangeChange}
                    onYearSelect={handleYearSelect}
                    onMonthSelect={handleMonthSelect}
                  />
                {:else if section === 'people'}
                  <PeopleFilter
                    {people}
                    selectedIds={filters.personIds}
                    selectedNames={personNames}
                    onSelectionChange={handlePeopleChange}
                    emptyText={hasUnnamedPeople ? $t('filter_name_people_hint') : undefined}
                  />
                {:else if section === 'location'}
                  <LocationFilter
                    {countries}
                    selectedCity={filters.city}
                    selectedCountry={filters.country}
                    selectedState={filters.state}
                    context={locationFilterContext}
                    onCityFetch={async (country, ctx) => {
                      if (providers.cities) {
                        return providers.cities(country, ctx);
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
                    context={cameraFilterContext}
                    onModelFetch={async (make, ctx) => {
                      if (providers.cameraModels) {
                        return providers.cameraModels(make, ctx);
                      }
                      return [];
                    }}
                    onSelectionChange={handleCameraChange}
                  />
                {:else if section === 'tags'}
                  <TagsFilter
                    {tags}
                    selectedIds={filters.tagIds}
                    selectedNames={tagNames}
                    onSelectionChange={handleTagsChange}
                  />
                {:else if section === 'rating'}
                  <RatingFilter
                    selectedRating={filters.rating}
                    {availableRatings}
                    onRatingChange={handleRatingChange}
                  />
                {:else if section === 'media'}
                  <MediaTypeFilter
                    selected={filters.mediaType}
                    {availableMediaTypes}
                    onTypeChange={handleMediaTypeChange}
                  />
                {:else if section === 'favorites'}
                  <FavoritesFilter
                    selected={filters.isFavorite}
                    onToggle={(value) => {
                      updateFilters({ ...filters, isFavorite: value });
                    }}
                  />
                {:else if section === 'albums'}
                  <AlbumsFilter
                    selected={filters.isInAlbum ? 'has' : filters.isNotInAlbum ? 'none' : 'all'}
                    onChange={(value) => {
                      updateFilters({
                        ...filters,
                        isInAlbum: value === 'has' ? true : undefined,
                        isNotInAlbum: value === 'none' ? true : undefined,
                      });
                    }}
                  />
                {:else if section === 'text'}
                  <TextFilter
                    description={filters.description}
                    originalFileName={filters.originalFileName}
                    ocr={filters.ocr}
                    onChange={(next) => {
                      updateFilters({
                        ...filters,
                        description: next.description,
                        originalFileName: next.originalFileName,
                        ocr: next.ocr,
                      });
                    }}
                  />
                {/if}
              </FilterSection>
            {/if}
          {/each}

          <!-- Emptiness is per surface, not per ledger: the set can still hold a section another
               surface tracks under the same storage key (#797). Gated on renderableSections, not
               config.sections: an unavailable section still counts as "visible" in the persisted
               ledger, so a panel rendering nothing could otherwise have no hint (#910). -->
          {#if renderableSections.every((section) => !visibleSections.has(section))}
            <div class="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <p class="text-xs text-gray-500 dark:text-gray-400">{$t('filter_show_sections_hint')}</p>
              <button
                type="button"
                class="text-xs font-medium text-primary hover:underline"
                onclick={showAllSections}
                data-testid="show-all-sections"
              >
                {$t('filter_show_all_sections')}
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}
