# Space Albums — FilterPanel in the in-space album page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the album-page filtering experience (FilterPanel sidebar + ActiveFiltersBar chips + filtered-empty state) to BOTH modes of the in-space album page — browse and the "Add to album" picker overlay.

**Architecture:** Port the global album page's filter machinery into `spaces/[spaceId]/albums/[albumId=id]/+page.svelte` (Approach A — the global page is left untouched). Reuse the existing `buildAlbum*FilterConfig` / `buildAlbum*Options` helpers; extract only the suggestionsProvider name-capture into a new pure util. Two independent filter states (`browseFilters` / `pickerFilters`), each driving its own FilterPanel inside a `<div class="flex h-full">` layout. The add overlay keeps `ControlAppBar` after `<main>` (paint-order fix preserved).

**Tech Stack:** SvelteKit, Svelte 5 runes, TypeScript, Vitest + @testing-library/svelte (happy-dom), Tailwind 4, `@immich/sdk`.

**Spec:** `docs/superpowers/specs/2026-06-13-space-albums-filter-panel-design.md`

---

## File Structure

- **Create** `web/src/lib/utils/filter-name-capture.ts` — pure `withNameCapture(config, personNames, tagNames)`.
- **Create** `web/src/lib/utils/filter-name-capture.spec.ts` — unit tests for the above.
- **Create** `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-timeline-state.ts` — configurable timeline-manager stub shared by the Timeline mock and the spec.
- **Create** `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-filter-panel.test-wrapper.svelte` — FilterPanel test double.
- **Create** `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-active-filters-bar.test-wrapper.svelte` — ActiveFiltersBar test double.
- **Modify** `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-timeline.test-wrapper.svelte` — read the shared stub.
- **Modify** `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/+page.svelte` — the feature.
- **Modify** `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts` — new mocks + tests.
- **Modify** `web/src/i18n/en.json` — three new keys.

---

## Task 1: i18n keys

**Files:**

- Modify: `web/src/i18n/en.json`

- [ ] **Step 1: Add the three keys (keep alphabetical order within the `space_album_*` block)**

Add these entries (place them next to the existing `space_album_*` keys, preserving JSON alphabetical ordering and trailing commas):

```json
  "space_album_clear_all_filters": "Clear all filters",
  "space_album_no_photos_match_filters": "No photos match your filters",
  "space_album_no_photos_to_add_match_filters": "No photos available to add match your filters",
```

- [ ] **Step 2: Verify JSON + ordering**

Run: `cd web && npx prettier --check src/i18n/en.json`
Expected: "All matched files use Prettier code style!" (if it fails, run `npx prettier --write src/i18n/en.json` — the i18n file is kept sorted/formatted by prettier).

- [ ] **Step 3: Commit**

```bash
git add web/src/i18n/en.json
git commit -m "i18n: keys for in-space album filter empty states"
```

---

## Task 2: `withNameCapture` util

**Files:**

- Create: `web/src/lib/utils/filter-name-capture.ts`
- Test: `web/src/lib/utils/filter-name-capture.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/utils/filter-name-capture.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type {
  FilterPanelConfig,
  FilterState,
  FilterSuggestionsResponse,
} from '$lib/components/filter-panel/filter-panel';
import { withNameCapture } from './filter-name-capture';

const EMPTY_SUGGESTIONS: FilterSuggestionsResponse = {
  countries: [],
  cameraMakes: [],
  tags: [],
  people: [],
  ratings: [],
  mediaTypes: [],
  hasUnnamedPeople: false,
};

function makeConfig(suggestions: FilterSuggestionsResponse, hasProvider = true): FilterPanelConfig {
  return {
    sections: ['timeline', 'people'],
    providers: { cities: async () => [] },
    ...(hasProvider ? { suggestionsProvider: async () => suggestions } : {}),
  } as FilterPanelConfig;
}

describe('withNameCapture', () => {
  it('returns the same config when there is no suggestionsProvider', () => {
    const config = makeConfig(EMPTY_SUGGESTIONS, false);
    expect(withNameCapture(config, new Map(), new Map())).toBe(config);
  });

  it('returns the original suggestions object (identity) from the wrapped provider', async () => {
    const suggestions: FilterSuggestionsResponse = { ...EMPTY_SUGGESTIONS, people: [{ id: 'p1', name: 'Alice' }] };
    const wrapped = withNameCapture(makeConfig(suggestions), new Map(), new Map());
    expect(await wrapped.suggestionsProvider!({} as FilterState)).toBe(suggestions);
  });

  it('captures person and tag names into the maps', async () => {
    const suggestions: FilterSuggestionsResponse = {
      ...EMPTY_SUGGESTIONS,
      people: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
      ],
      tags: [{ id: 't1', name: 'Beach' }],
    };
    const personNames = new Map<string, string>();
    const tagNames = new Map<string, string>();
    const wrapped = withNameCapture(makeConfig(suggestions), personNames, tagNames);
    await wrapped.suggestionsProvider!({} as FilterState);
    expect(personNames.get('p1')).toBe('Alice');
    expect(personNames.get('p2')).toBe('Bob');
    expect(tagNames.get('t1')).toBe('Beach');
  });

  it('leaves the maps untouched when people/tags are empty', async () => {
    const personNames = new Map<string, string>();
    const tagNames = new Map<string, string>();
    const wrapped = withNameCapture(makeConfig(EMPTY_SUGGESTIONS), personNames, tagNames);
    await wrapped.suggestionsProvider!({} as FilterState);
    expect(personNames.size).toBe(0);
    expect(tagNames.size).toBe(0);
  });

  it('preserves the other config fields (sections, providers)', () => {
    const config = makeConfig(EMPTY_SUGGESTIONS);
    const wrapped = withNameCapture(config, new Map(), new Map());
    expect(wrapped.sections).toEqual(config.sections);
    expect(wrapped.providers).toBe(config.providers);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && pnpm exec vitest run src/lib/utils/filter-name-capture.spec.ts`
Expected: FAIL — cannot resolve `./filter-name-capture`.

- [ ] **Step 3: Implement the util**

Create `web/src/lib/utils/filter-name-capture.ts`:

```ts
import type {
  FilterPanelConfig,
  FilterState,
  FilterSuggestionsResponse,
} from '$lib/components/filter-panel/filter-panel';

/**
 * Wraps a FilterPanelConfig so its suggestionsProvider, besides returning suggestions, records each
 * person/tag id->name into the supplied maps (so ActiveFiltersBar can label chips). Returns the
 * config unchanged when it has no suggestionsProvider. Pure: it does not mutate the input config.
 */
export function withNameCapture(
  config: FilterPanelConfig,
  personNames: Map<string, string>,
  tagNames: Map<string, string>,
): FilterPanelConfig {
  const provider = config.suggestionsProvider;
  if (!provider) {
    return config;
  }
  return {
    ...config,
    suggestionsProvider: async (filters: FilterState): Promise<FilterSuggestionsResponse> => {
      const result = await provider(filters);
      for (const person of result.people) {
        personNames.set(person.id, person.name);
      }
      for (const tag of result.tags) {
        tagNames.set(tag.id, tag.name);
      }
      return result;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm exec vitest run src/lib/utils/filter-name-capture.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/filter-name-capture.ts web/src/lib/utils/filter-name-capture.spec.ts
git commit -m "feat(web): withNameCapture util — capture filter person/tag names for chips"
```

---

## Task 3: Test doubles for FilterPanel / ActiveFiltersBar + configurable timeline stub

This task only adds test infrastructure and must leave the existing spec green (no behaviour change yet).

**Files:**

- Create: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-timeline-state.ts`
- Create: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-filter-panel.test-wrapper.svelte`
- Create: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-active-filters-bar.test-wrapper.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-timeline.test-wrapper.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts`

- [ ] **Step 1: Create the shared, configurable timeline stub**

Create `mock-timeline-state.ts`:

```ts
// Mutable timeline-manager stub shared between the Timeline mock and the spec. Tests set the shape
// (empty vs non-empty) BEFORE rendering; the Timeline mock snapshots it on mount. Default is
// non-empty so the timeline renders and the FilterPanel is visible unless a test opts into empty.
export interface MockTimelineState {
  isInitialized: boolean;
  scrollTop: number;
  grouping: string;
  months: unknown[];
  assetCount: number;
}

export const mockTimelineState: MockTimelineState = {
  isInitialized: true,
  scrollTop: 0,
  grouping: 'day',
  months: [{}],
  assetCount: 12,
};

export function resetMockTimelineState(): void {
  mockTimelineState.isInitialized = true;
  mockTimelineState.scrollTop = 0;
  mockTimelineState.grouping = 'day';
  mockTimelineState.months = [{}];
  mockTimelineState.assetCount = 12;
}

export function setMockTimelineEmpty(): void {
  mockTimelineState.months = [];
  mockTimelineState.assetCount = 0;
}
```

- [ ] **Step 2: Point the Timeline mock at the shared stub**

In `mock-timeline.test-wrapper.svelte`, replace the `$effect` block:

```svelte
  $effect(() => {
    const stub = { isInitialized: true, scrollTop: 0, grouping: 'day', months: [] };
    if (timelineManager) {
      Object.assign(timelineManager, stub);
    } else {
      timelineManager = stub;
    }
  });
```

with:

```svelte
  $effect(() => {
    timelineManager = { ...mockTimelineState };
  });
```

and add this import at the top of the `<script>` block:

```svelte
  import { mockTimelineState } from './mock-timeline-state';
```

- [ ] **Step 3: Create the FilterPanel test double**

Create `mock-filter-panel.test-wrapper.svelte`:

```svelte
<script lang="ts">
  import { createFilterState, type FilterPanelConfig, type FilterState } from '$lib/components/filter-panel/filter-panel';

  interface Props {
    config: FilterPanelConfig;
    filters?: FilterState;
    hidden?: boolean;
    timeBuckets?: unknown;
    storageKey?: string;
    personNames?: Map<string, string>;
    tagNames?: Map<string, string>;
  }

  // `filters` is two-way bound by the page; the buttons below let tests activate filters.
  let { filters = $bindable(createFilterState()), hidden = false, ...rest }: Props = $props();
  void rest;
</script>

<div data-testid="filter-panel" data-hidden={String(hidden)}>
  <button
    type="button"
    data-testid="filter-panel-add-person"
    onclick={() => (filters = { ...filters, personIds: ['person-1'] })}
  >
    add person filter
  </button>
  <button
    type="button"
    data-testid="filter-panel-add-year"
    onclick={() => (filters = { ...filters, selectedYear: 2025 })}
  >
    add year filter
  </button>
</div>
```

- [ ] **Step 4: Create the ActiveFiltersBar test double**

Create `mock-active-filters-bar.test-wrapper.svelte`:

```svelte
<script lang="ts">
  interface Props {
    onRemoveFilter: (type: string, id?: string) => void;
    onClearAll: () => void;
    [key: string]: unknown;
  }

  let { onRemoveFilter, onClearAll, ...rest }: Props = $props();
  void rest;
</script>

<div data-testid="active-filters-bar">
  <button
    type="button"
    data-testid="active-filters-remove-timeline"
    onclick={() => onRemoveFilter('timeline')}
  >
    remove timeline
  </button>
  <button type="button" data-testid="active-filters-clear-all" onclick={() => onClearAll()}>clear all</button>
</div>
```

- [ ] **Step 5: Register the new mocks + reset hook in the spec**

In `space-album-detail-page.spec.ts`, add two `vi.mock` blocks after the existing ControlAppBar mock (around line 48):

```ts
vi.mock('$lib/components/filter-panel/filter-panel.svelte', async () => {
  const { default: MockComponent } = await import('./mock-filter-panel.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/filter-panel/active-filters-bar.svelte', async () => {
  const { default: MockComponent } = await import('./mock-active-filters-bar.test-wrapper.svelte');
  return { default: MockComponent };
});
```

Add the import near the other imports (top of file):

```ts
import { resetMockTimelineState } from './mock-timeline-state';
```

In the existing `beforeEach`, add `resetMockTimelineState();` right after `vi.resetAllMocks();`.

> Note: `setMockTimelineEmpty` is imported later (Task 4 Step 1, with its first use) to avoid an unused import here.

- [ ] **Step 6: Run the full existing spec — must stay green**

Run: `cd web && pnpm exec vitest run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts"`
Expected: PASS (all existing tests; default non-empty stub keeps the timeline rendering).

- [ ] **Step 7: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-timeline-state.ts" \
        "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-filter-panel.test-wrapper.svelte" \
        "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-active-filters-bar.test-wrapper.svelte" \
        "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-timeline.test-wrapper.svelte" \
        "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts"
git commit -m "test(web): test doubles for FilterPanel/ActiveFiltersBar + configurable timeline stub"
```

---

## Task 4: Browse-mode filtering

Implements the FilterPanel sidebar, ActiveFiltersBar, filtered-empty state, temporal handlers, and album-change reset for browse mode.

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/+page.svelte`
- Test: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts`

- [ ] **Step 1: Write the failing browse tests**

First add the empty-state helper to the imports (next to `resetMockTimelineState`):

```ts
import { resetMockTimelineState, setMockTimelineEmpty } from './mock-timeline-state';
```

Then append inside the `describe('Space album detail page', ...)` block:

```ts
it('browse mode renders the FilterPanel', () => {
  renderPage();
  expect(screen.getByTestId('filter-panel')).toBeInTheDocument();
});

it('does not render the FilterPanel while a browse selection is active', () => {
  mockAssetMultiSelectManager.selectionActive = true;
  renderPage();
  expect(screen.queryByTestId('filter-panel')).not.toBeInTheDocument();
});

it('browseOptions carry filter fields once a browse filter is set', async () => {
  renderPage({ album: makeAlbum({ id: 'album-1' }) });
  await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
  await waitFor(() => {
    const options = JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}');
    expect(options.personIds).toEqual(['person-1']);
  });
});

it('shows ActiveFiltersBar only when a browse filter is active', async () => {
  renderPage();
  expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
  await waitFor(() => expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument());
});

it('browse: when filtered to empty, the filtered-empty block replaces the timeline; clear restores it', async () => {
  setMockTimelineEmpty();
  renderPage();
  await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
  await waitFor(() => {
    expect(screen.getByTestId('browse-filtered-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('space-album-timeline')).not.toBeInTheDocument();
  });
  await fireEvent.click(screen.getByTestId('browse-clear-filters'));
  await waitFor(() => {
    expect(screen.queryByTestId('browse-filtered-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('space-album-timeline')).toBeInTheDocument();
  });
});

it('browse: the FilterPanel is hidden when the album is genuinely empty (no assets, no filters)', async () => {
  setMockTimelineEmpty();
  renderPage();
  await waitFor(() => expect(screen.getByTestId('filter-panel').dataset.hidden).toBe('true'));
});

it('browse: the FilterPanel stays visible when filtered to empty (so it can be cleared)', async () => {
  setMockTimelineEmpty();
  renderPage();
  await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
  await waitFor(() => expect(screen.getByTestId('filter-panel').dataset.hidden).toBe('false'));
});

it('browse: removing the temporal chip clears the temporal filter (ActiveFiltersBar disappears)', async () => {
  renderPage();
  await fireEvent.click(screen.getByTestId('filter-panel-add-year'));
  await waitFor(() => expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId('active-filters-remove-timeline'));
  await waitFor(() => expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument());
});

it('browse: clear-all in ActiveFiltersBar removes all filters', async () => {
  renderPage();
  await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
  await waitFor(() => expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId('active-filters-clear-all'));
  await waitFor(() => expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument());
});
```

- [ ] **Step 2: Run the browse tests to verify they fail**

Run: `cd web && pnpm exec vitest run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts" -t "browse"`
Expected: FAIL (no `filter-panel` etc. yet; several browse tests red).

- [ ] **Step 3: Update the `<script>` (imports + state + derived + handlers)**

In `+page.svelte`:

(a) Replace the filter-panel import (line 4):

```svelte
  import { createFilterState } from '$lib/components/filter-panel/filter-panel';
```

with:

```svelte
  import {
    clearFilters,
    createFilterState,
    getActiveFilterCount,
  } from '$lib/components/filter-panel/filter-panel';
  import FilterPanel from '$lib/components/filter-panel/filter-panel.svelte';
  import ActiveFiltersBar from '$lib/components/filter-panel/active-filters-bar.svelte';
```

(b) Add `getTimelineManagerTimeBuckets` to the existing `timeline-zoom-navigation` import (line 18):

```svelte
  import {
    type ActivatableTimelineBucket,
    getTimelineBucketZoomTarget,
    getTimelineManagerTimeBuckets,
  } from '$lib/utils/timeline-zoom-navigation';
```

(c) Add these imports alongside the others:

```svelte
  import { buildAlbumAssetPickerFilterConfig, buildAlbumDetailFilterConfig } from '$lib/utils/album-filter-config';
  import { handlePhotosRemoveFilter } from '$lib/utils/photos-filter-options';
  import { clearTimelineTemporalFilter } from '$lib/utils/timeline-temporal-filters';
  import { withNameCapture } from '$lib/utils/filter-name-capture';
  import { SvelteMap } from 'svelte/reactivity';
```

(d) After the `pickerMultiSelectManager` line (line 52), add filter state:

```svelte
  // Independent filter state per mode (mirrors the global album page).
  let browseFilters = $state(createFilterState());
  let pickerFilters = $state(createFilterState());
  const browsePersonNames = new SvelteMap<string, string>();
  const browseTagNames = new SvelteMap<string, string>();
  const pickerPersonNames = new SvelteMap<string, string>();
  const pickerTagNames = new SvelteMap<string, string>();
  let pickerTimelineManager = $state<TimelineManager>() as TimelineManager;
```

> Note: `album` is local `$state` seeded once from `data.album` (it is reassigned only by
> `refreshAlbum`, keeping the same id). Its id does not change during the component's life — album
> navigation goes through the grid — so no cross-album filter-reset effect is needed. The
> `{#key \`space-album-${album.id}\`}` wrappers are kept as cheap, defensive parity with the
> reference (they no-op while the id is stable).

(e) After `canManage` (line 64), add derived configs + flags:

```svelte
  const browseFilterConfig = $derived(
    withNameCapture(buildAlbumDetailFilterConfig(album.id), browsePersonNames, browseTagNames),
  );
  const pickerFilterConfig = $derived(
    withNameCapture(buildAlbumAssetPickerFilterConfig(), pickerPersonNames, pickerTagNames),
  );

  const browseTotal = $derived(timelineManager?.assetCount ?? 0);
  const browseHasMonths = $derived((timelineManager?.months?.length ?? 0) > 0);
  const browseActive = $derived(getActiveFilterCount(browseFilters));
  const isBrowseEmpty = $derived(
    Boolean(timelineManager?.isInitialized) && !browseHasMonths && browseTotal === 0 && browseActive === 0,
  );
  const showBrowseFilteredEmpty = $derived(
    Boolean(timelineManager?.isInitialized) && !browseHasMonths && browseTotal === 0 && browseActive > 0,
  );
  const browseTimeBuckets = $derived(getTimelineManagerTimeBuckets(timelineManager));

  const pickerTotal = $derived(pickerTimelineManager?.assetCount ?? 0);
  const pickerHasMonths = $derived((pickerTimelineManager?.months?.length ?? 0) > 0);
  const pickerActive = $derived(getActiveFilterCount(pickerFilters));
  const isPickerEmpty = $derived(
    Boolean(pickerTimelineManager?.isInitialized) && !pickerHasMonths && pickerTotal === 0 && pickerActive === 0,
  );
  const showPickerFilteredEmpty = $derived(
    Boolean(pickerTimelineManager?.isInitialized) && !pickerHasMonths && pickerTotal === 0 && pickerActive > 0,
  );
  const pickerTimeBuckets = $derived(getTimelineManagerTimeBuckets(pickerTimelineManager));
```

(f) Replace `browseOptions` (lines 66-75) — swap the empty filter state for `browseFilters`:

```svelte
  const browseOptions = $derived({
    ...buildAlbumTimelineOptions(
      album.id,
      album.order ?? authManager.preferences.albums.defaultAssetOrder,
      browseFilters,
    ),
    // The grouping MUST live in the options object — that is what the TimelineManager reads to
    // build buckets. The top-level <Timeline grouping={...}> prop alone does not re-group.
    grouping: timelineGrouping,
  });
```

(g) Replace `pickerOptions` (line 77):

```svelte
  const pickerOptions = $derived(buildAlbumAssetPickerOptions(album.id, pickerFilters));
```

(h) Add a `resetPicker` helper and an `enterAddMode` helper after `handleAddAssetsSuccess` (around line 102), and update `handleExitAddMode` / `handleAddAssetsSuccess` to reset the picker filters:

Replace the existing `handleExitAddMode` and `handleAddAssetsSuccess` (lines 89-102) with:

```svelte
  function resetPicker() {
    pickerFilters = createFilterState();
    pickerPersonNames.clear();
    pickerTagNames.clear();
    pickerMultiSelectManager.clear();
    timelineGrouping = 'day';
    temporalAnchor = undefined;
  }

  function enterAddMode() {
    resetPicker();
    mode = 'add';
  }

  const handleExitAddMode = () => {
    resetPicker();
    mode = 'browse';
  };

  const handleAddAssetsSuccess = async () => {
    resetPicker();
    mode = 'browse';
    await refreshAlbum();
  };
```

- [ ] **Step 4: Update the browse template**

Replace the browse markup — the block from `<!-- Browse selection control bar ... -->` through the end of the `{#if mode === 'browse'}` `</Timeline>...{/if}` (lines 158-214) — with:

```svelte
  <!-- Browse selection control bar (shows when assets are selected in browse mode) -->
  {#if mode === 'browse' && assetMultiSelectManager.selectionActive}
    <AssetSelectControlBar>
      <DownloadAction filename="{album.albumName}.zip" />
      {#if canManage}
        <RemoveFromAlbum bind:album onRemove={handleRemoveAssets} />
      {/if}
    </AssetSelectControlBar>
  {/if}

  {#if mode === 'browse'}
    <div class="flex h-full">
      {#if !assetMultiSelectManager.selectionActive}
        {#key `space-album-${album.id}`}
          <FilterPanel
            config={browseFilterConfig}
            bind:filters={browseFilters}
            timeBuckets={browseTimeBuckets}
            storageKey="gallery-filter-visible-sections-space-album"
            hidden={isBrowseEmpty}
          />
        {/key}
      {/if}

      <div class="flex flex-1 flex-col overflow-hidden pl-4">
        {#if !assetMultiSelectManager.selectionActive}
          <div
            class="mb-2 hidden shrink-0 items-center gap-2 bg-transparent px-4 py-2 md:flex dark:bg-transparent"
            data-testid="timeline-desktop-grouping-control"
          >
            <TimelineGroupingControl grouping={timelineGrouping} onGroupingChange={handleTimelineGroupingChange} />
          </div>
        {/if}

        {#if browseActive > 0}
          <div class="mb-4 shrink-0">
            <ActiveFiltersBar
              filters={browseFilters}
              resultCount={browseTotal}
              personNames={browsePersonNames}
              tagNames={browseTagNames}
              onRemoveFilter={(type, id) => {
                if (type === 'timeline') {
                  browseFilters = clearTimelineTemporalFilter(browseFilters);
                  temporalAnchor = undefined;
                } else {
                  browseFilters = handlePhotosRemoveFilter(browseFilters, type, id);
                }
              }}
              onClearAll={() => {
                browseFilters = clearFilters(browseFilters);
                temporalAnchor = undefined;
              }}
            />
          </div>
        {/if}

        {#if showBrowseFilteredEmpty}
          <div class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="browse-filtered-empty">
            <p class="text-sm text-gray-500 dark:text-gray-400">{$t('space_album_no_photos_match_filters')}</p>
            <button
              type="button"
              data-testid="browse-clear-filters"
              class="text-sm text-(--primary)"
              onclick={() => {
                browseFilters = clearFilters(browseFilters);
                temporalAnchor = undefined;
              }}
            >
              {$t('space_album_clear_all_filters')}
            </button>
          </div>
        {:else}
          <Timeline
            enableRouting={false}
            options={browseOptions}
            bind:timelineManager
            assetInteraction={assetMultiSelectManager}
            isSelectionMode={false}
            singleSelect={false}
            grouping={timelineGrouping}
            onGroupingChange={handleTimelineGroupingChange}
            onTimelineBucketActivate={handleTimelineBucketActivate}
            {temporalAnchor}
            onTemporalAnchorResolved={() => (temporalAnchor = undefined)}
          >
            {#snippet empty()}
              <section class="mt-50 flex place-content-center place-items-center">
                <div class="flex flex-col items-center gap-4 text-center">
                  <Icon icon={mdiImageOutline} size="3.5em" class="text-gray-400" />
                  <p class="text-lg text-gray-500 dark:text-gray-400">{$t('no_assets_to_show')}</p>
                  {#if canManage}
                    <button
                      type="button"
                      data-testid="empty-add-photos-button"
                      class="text-sm text-(--primary)"
                      onclick={enterAddMode}
                    >
                      {$t('add_photos')}
                    </button>
                  {/if}
                </div>
              </section>
            {/snippet}
          </Timeline>
        {/if}
      </div>
    </div>
  {/if}
```

Also update the `buttons()` snippet's add-photos onclick (lines 148-152) to use the new helper:

```svelte
        onclick={enterAddMode}
```

(remove the inline `timelineGrouping = 'day'; temporalAnchor = undefined; mode = 'add';` body — `enterAddMode` does it).

- [ ] **Step 5: Run the browse tests to verify they pass**

Run: `cd web && pnpm exec vitest run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts" -t "browse"`
Expected: PASS (all browse tests).

- [ ] **Step 6: Run the FULL spec to catch regressions**

Run: `cd web && pnpm exec vitest run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts"`
Expected: PASS (existing + new). If the existing "grouping control renders" / "options carry grouping" tests fail, confirm the grouping control + Timeline still live in the right column (they do in the markup above).

- [ ] **Step 7: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/+page.svelte" \
        "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts"
git commit -m "feat(web): FilterPanel + active filters + filtered-empty in in-space album browse"
```

---

## Task 5: Add-overlay (picker) filtering

Implements the FilterPanel sidebar, ActiveFiltersBar, filtered-empty state, and picker reset for the add overlay, and preserves the control-bar paint-order.

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/+page.svelte`
- Test: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts`

> Layout note: `<main>` keeps `pt-(--navbar-height)` and the FilterPanel sidebar lives INSIDE
> `<main>` (exactly how the global album page nests it: `main.pt-navbar > div.flex.h-full >
[FilterPanel, content]`). This preserves the existing `main.className` pt assertion and the
> paint-order (ControlAppBar stays after `<main>`), so no existing test needs editing.

- [ ] **Step 1: Write the failing picker tests**

Append inside the `describe(...)` block:

```ts
it('add mode renders the picker FilterPanel', async () => {
  renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
  await fireEvent.click(screen.getByTestId('add-photos-button'));
  await waitFor(() => expect(screen.getByTestId('filter-panel')).toBeInTheDocument());
});

it('pickerOptions carry filter fields once a picker filter is set, and show ActiveFiltersBar', async () => {
  renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
  await fireEvent.click(screen.getByTestId('add-photos-button'));
  await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
  await waitFor(() => {
    const options = JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}');
    expect(options.personIds).toEqual(['person-1']);
    expect(options.timelineAlbumId).toBe('album-1');
  });
  expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument();
});

it('add mode: filtered-empty replaces the picker timeline; clear restores it', async () => {
  setMockTimelineEmpty();
  renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
  await fireEvent.click(screen.getByTestId('add-photos-button'));
  await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
  await waitFor(() => {
    expect(screen.getByTestId('picker-filtered-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('space-album-timeline')).not.toBeInTheDocument();
  });
  await fireEvent.click(screen.getByTestId('picker-clear-filters'));
  await waitFor(() => {
    expect(screen.queryByTestId('picker-filtered-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('space-album-timeline')).toBeInTheDocument();
  });
});

it('entering add mode starts with no active picker filters even if browse was filtered', async () => {
  renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
  // Filter browse first.
  await fireEvent.click(screen.getByTestId('filter-panel-add-person'));
  await waitFor(() => expect(screen.getByTestId('active-filters-bar')).toBeInTheDocument());
  // Enter add mode → picker is fresh.
  await fireEvent.click(screen.getByTestId('add-photos-button'));
  await waitFor(() => expect(screen.getByTestId('add-photos-overlay')).toBeInTheDocument());
  expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
});

it('add mode: control bar still comes AFTER the timeline-main in DOM (paint order)', async () => {
  renderPage({ members: [makeMember(SharedSpaceRole.Editor)], album: makeAlbum({ id: 'album-1' }) });
  await fireEvent.click(screen.getByTestId('add-photos-button'));
  await waitFor(() => expect(screen.getByTestId('add-photos-overlay')).toBeInTheDocument());
  const overlay = screen.getByTestId('add-photos-overlay');
  const main = screen.getByTestId('add-photos-timeline-main');
  const ordered = [
    ...overlay.querySelectorAll('[data-testid="add-photos-timeline-main"], [data-testid="control-app-bar"]'),
  ];
  expect(ordered[0]).toBe(main);
  expect(ordered[1]).toBe(screen.getByTestId('control-app-bar'));
});
```

- [ ] **Step 2: Run the picker tests to verify they fail**

Run: `cd web && pnpm exec vitest run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts" -t "add mode|picker"`
Expected: FAIL (no picker FilterPanel / filtered-empty yet).

- [ ] **Step 3: Replace the add-overlay template**

Replace the whole `{#if mode === 'add'} ... {/if}` block (lines 217-259) with the following. Note `<main>`
keeps `pt-(--navbar-height)` and the FilterPanel sidebar lives inside it (mirrors the global album
page); `ControlAppBar` stays after `<main>` so its absolute bar paints on top:

```svelte
{#if mode === 'add'}
  <section class="fixed inset-0 z-40 bg-immich-bg dark:bg-immich-dark-bg" data-testid="add-photos-overlay">
    <!--
      The sidebar + picker Timeline live inside <main>; the ControlAppBar is rendered AFTER it. The
      bar is `position: absolute` with auto z-index, so it would be painted under the full-height
      <main> (swallowing clicks on the trailing Upload/Add buttons) if it came first. Keeping it last
      — as the global album page does — lets it paint on top while staying pinned to the top.
    -->
    <main
      class="relative h-dvh overflow-hidden pt-(--navbar-height)"
      data-testid="add-photos-timeline-main"
    >
      <div class="flex h-full">
        {#key `space-album-picker-${album.id}`}
          <FilterPanel
            config={pickerFilterConfig}
            bind:filters={pickerFilters}
            timeBuckets={pickerTimeBuckets}
            storageKey="gallery-filter-visible-sections-space-album-picker"
            hidden={isPickerEmpty}
          />
        {/key}
        <div class="flex flex-1 flex-col overflow-hidden px-2 md:px-6">
          {#if pickerActive > 0}
            <div class="mb-4 shrink-0">
              <ActiveFiltersBar
                filters={pickerFilters}
                resultCount={pickerTotal}
                personNames={pickerPersonNames}
                tagNames={pickerTagNames}
                onRemoveFilter={(type, id) => (pickerFilters = handlePhotosRemoveFilter(pickerFilters, type, id))}
                onClearAll={() => (pickerFilters = clearFilters(pickerFilters))}
              />
            </div>
          {/if}

          {#if showPickerFilteredEmpty}
            <div class="flex flex-1 flex-col items-center justify-center gap-2" data-testid="picker-filtered-empty">
              <p class="text-sm text-gray-500 dark:text-gray-400">{$t('space_album_no_photos_to_add_match_filters')}</p>
              <button
                type="button"
                data-testid="picker-clear-filters"
                class="text-sm text-(--primary)"
                onclick={() => (pickerFilters = clearFilters(pickerFilters))}
              >
                {$t('space_album_clear_all_filters')}
              </button>
            </div>
          {:else}
            <Timeline
              enableRouting={false}
              options={pickerOptions}
              bind:timelineManager={pickerTimelineManager}
              assetInteraction={pickerMultiSelectManager}
              isSelectionMode={true}
              singleSelect={false}
            />
          {/if}
        </div>
      </div>
    </main>
    <ControlAppBar onClose={handleExitAddMode}>
      {#snippet leading()}
        <p class="text-lg dark:text-immich-dark-fg">
          {#if !pickerMultiSelectManager.selectionActive}
            {$t('add_to_album')}
          {:else}
            {$t('selected_count', { values: { count: pickerMultiSelectManager.assets.length } })}
          {/if}
        </p>
      {/snippet}

      {#snippet trailing()}
        <HeaderActionButton action={Upload} />
        <HeaderActionButton
          action={{
            ...AddAssets,
            onAction: () => void AddAssets.onAction().then(handleAddAssetsSuccess),
          }}
        />
      {/snippet}
    </ControlAppBar>
  </section>
{/if}
```

- [ ] **Step 4: Run the picker tests to verify they pass**

Run: `cd web && pnpm exec vitest run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts" -t "add mode|picker"`
Expected: PASS.

- [ ] **Step 5: Run the FULL spec**

Run: `cd web && pnpm exec vitest run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts"`
Expected: PASS (all tests — existing add-mode tests, including the unchanged `main.className` pt assertion, plus the new picker tests).

- [ ] **Step 6: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/+page.svelte" \
        "web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts"
git commit -m "feat(web): FilterPanel + active filters + filtered-empty in in-space album picker"
```

---

## Task 6: Gates + push

**Files:** none (verification only).

- [ ] **Step 1: Prettier the touched files**

Run:

```bash
cd web && pnpm exec prettier --write \
  "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/+page.svelte" \
  "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/space-album-detail-page.spec.ts" \
  "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-filter-panel.test-wrapper.svelte" \
  "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-active-filters-bar.test-wrapper.svelte" \
  "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-timeline.test-wrapper.svelte" \
  "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/mock-timeline-state.ts" \
  src/lib/utils/filter-name-capture.ts src/lib/utils/filter-name-capture.spec.ts
```

- [ ] **Step 2: ESLint the touched files (zero warnings)**

Run: `cd web && pnpm exec eslint "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/" src/lib/utils/filter-name-capture.ts src/lib/utils/filter-name-capture.spec.ts`
Expected: exit 0, no output.

- [ ] **Step 3: Type checks**

Run: `cd web && pnpm run check:typescript`
Expected: exit 0.

Run: `cd web && pnpm run check:svelte`
Expected: `0 ERRORS 0 WARNINGS`.

- [ ] **Step 4: Build (the real gate for web-touching changes)**

Run: `cd web && pnpm build`
Expected: `✓ built` / `✔ done`.

- [ ] **Step 5: Full web unit suite (catch cross-file regressions)**

Run: `cd web && pnpm test -- --run`
Expected: all passing (no new failures vs the pre-change baseline).

- [ ] **Step 6: Commit any prettier-only changes and push**

```bash
git add -A
git commit -m "chore(web): prettier for in-space album filter changes" || echo "nothing to commit"
git push origin feat/space-albums
```

---

## Notes for the implementer

- Do NOT modify the global album page or the shared `album-filter-config.ts` / `album-filter-options.ts` helpers.
- Do NOT commit the `e2e/test-assets` submodule.
- `getTimelineManagerTimeBuckets` tolerates an uninitialised manager (the page passes `pickerTimelineManager` before the picker mounts) — no extra guard needed.
- The filtered-empty block intentionally REPLACES the `<Timeline>`; the Timeline's own `empty` snippet only covers the unfiltered-empty case.
- `hidden` (FilterPanel) is true only when the album is genuinely empty (no assets AND no active filters) so a filtered-to-empty result keeps the panel available for clearing.
