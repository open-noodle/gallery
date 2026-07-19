# Space Albums — FilterPanel in the in-space album page (design)

Date: 2026-06-13
Branch: `feat/space-albums`
Status: design approved pending spec review

## Goal

Bring the global album page's filtering experience to the **in-space album page**
(`web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/+page.svelte`) in **both**
of its modes:

1. **Browse** — the timeline shown when you open a linked album.
2. **Add** — the full-screen "Add to album" picker overlay.

"Full parity" with the global album page: a `FilterPanel` left sidebar, an
`ActiveFiltersBar` chip row, and a "no photos match your filters" empty state, in each
mode.

## Reference implementations (in-repo)

- **Global album page** — the stated reference:
  `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte`.
  Renders `FilterPanel` for both view and select-assets modes, wraps each config's
  `suggestionsProvider` to capture person/tag display names into `SvelteMap`s, and shows
  `ActiveFiltersBar` + a filtered-empty state per mode.
- **Space timeline page** — proves the sidebar layout co-exists with `UserPageLayout`:
  `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
  uses `<UserPageLayout>` wrapping `<div class="flex h-full">` with a `FilterPanel` left
  sidebar and the timeline in the right column.

## Reusable building blocks (already exist)

- `src/lib/utils/album-filter-config.ts`
  - `buildAlbumDetailFilterConfig(albumId)` — browse config (suggestions scoped to album).
  - `buildAlbumAssetPickerFilterConfig()` — picker config (suggestions over the user's library).
- `src/lib/utils/album-filter-options.ts`
  - `buildAlbumTimelineOptions(albumId, order, filters)` — browse timeline options.
  - `buildAlbumAssetPickerOptions(albumId, filters)` — picker timeline options.
- `src/lib/components/filter-panel/filter-panel.ts` — `createFilterState`, `getActiveFilterCount`,
  `clearFilters`, `FilterState`, `FilterPanelConfig`.
- `src/lib/components/filter-panel/active-filters-bar.svelte`.
- `getTimelineManagerTimeBuckets(timelineManager)` — scrubber facet buckets.

The in-space page **already** calls `buildAlbumTimelineOptions` / `buildAlbumAssetPickerOptions`,
but with an empty `createFilterState()`. The bulk of this work is feeding real filter state in
and rendering the panel.

## Approach

**A — port the album-page filter machinery into the in-space page.** The global album page is
left untouched (it is large and battle-tested; a shared-controller refactor is more risk/scope
than the duplication saves while there are only two consumers). The only shared extraction is a
small pure util for the one genuinely awkward bit (config wrapping).

### New util: `withNameCapture`

`src/lib/utils/filter-name-capture.ts`

```ts
import type { FilterPanelConfig, FilterState } from '$lib/components/filter-panel/filter-panel';

// Returns a copy of `config` whose suggestionsProvider, in addition to returning suggestions,
// records each person/tag id->name into the supplied maps so ActiveFiltersBar can label chips.
export function withNameCapture(
  config: FilterPanelConfig,
  personNames: Map<string, string>,
  tagNames: Map<string, string>,
): FilterPanelConfig;
```

Behaviour: when `config.suggestionsProvider` is undefined, return `config` unchanged. Otherwise
wrap it: call the original, then `personNames.set(p.id, p.name)` / `tagNames.set(t.id, t.name)`
for each returned person/tag, then return the original suggestions object unchanged. Pure and
unit-testable.

### Component changes (`spaces/[spaceId]/albums/[albumId=id]/+page.svelte`)

State:

- `let browseFilters = $state(createFilterState())`
- `let pickerFilters = $state(createFilterState())`
- `const browsePersonNames = new SvelteMap<string, string>()` (+ `browseTagNames`,
  `pickerPersonNames`, `pickerTagNames`)
- `let pickerTimelineManager = $state<TimelineManager>() as TimelineManager` (browse already has
  `timelineManager`)

Derived configs and options:

- `const browseFilterConfig = $derived(withNameCapture(buildAlbumDetailFilterConfig(album.id), browsePersonNames, browseTagNames))`
- `const pickerFilterConfig = $derived(withNameCapture(buildAlbumAssetPickerFilterConfig(), pickerPersonNames, pickerTagNames))`
- `browseOptions`: pass `browseFilters` (instead of `createFilterState()`).
- `pickerOptions`: pass `pickerFilters` (instead of `createFilterState()`).
- `timeBuckets`: `getTimelineManagerTimeBuckets(timelineManager)` for browse,
  `getTimelineManagerTimeBuckets(pickerTimelineManager)` for picker.

Resets:

- Entering add mode (the `add-photos` button onclick + the empty-state add button) and leaving it
  (`handleExitAddMode`, `handleAddAssetsSuccess`): `pickerFilters = createFilterState()` and clear
  the picker name maps, alongside the existing `timelineGrouping='day'` / anchor resets.
- No cross-album reset is needed: `album` is local `$state` seeded once from `data.album` (only
  `refreshAlbum` reassigns it, keeping the same id), so `album.id` is stable for the component's
  life — album navigation goes through the grid, not in-place. The per-album `{#key}` wrappers are
  kept as cheap, defensive parity with the reference (they no-op while the id is stable).

Derived flags (per mode — browse reads `timelineManager`, picker reads `pickerTimelineManager`),
matching the reference (`+page.svelte:324-331`). Each is guarded on `?.isInitialized`:

```ts
// browse
const browseTotal = $derived(timelineManager?.assetCount ?? 0);
const browseHasMonths = $derived((timelineManager?.months?.length ?? 0) > 0);
const browseActive = $derived(getActiveFilterCount(browseFilters));
const isBrowseEmpty = $derived(
  timelineManager?.isInitialized && !browseHasMonths && browseTotal === 0 && browseActive === 0,
);
const showBrowseFilteredEmpty = $derived(
  timelineManager?.isInitialized && !browseHasMonths && browseTotal === 0 && browseActive > 0,
);
const browseTimeBuckets = $derived(getTimelineManagerTimeBuckets(timelineManager));
// picker: identical shape against pickerTimelineManager / pickerFilters → isPickerEmpty,
//         showPickerFilteredEmpty, pickerTimeBuckets.
```

Note `hidden` uses `isBrowse/PickerEmpty` (which require `active === 0`), so the FilterPanel
**stays visible when filtered-to-empty** — the user can still clear filters from it.
`getTimelineManagerTimeBuckets` must tolerate the `undefined` manager before mount (it already
does — the space page calls it with the same uninitialised cast).

Layout — **browse** (inside `UserPageLayout`):

```svelte
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
    <!-- grouping control (existing, transparent bar) -->
    <!-- ActiveFiltersBar when browseActive > 0 (see handlers below) -->
    {#if showBrowseFilteredEmpty}
      <!-- filtered-empty block (REPLACES the Timeline): message + clear-all -->
    {:else}
      <!-- <Timeline ...browseOptions bind:timelineManager> with its existing `empty` snippet
           handling the unfiltered-empty case -->
    {/if}
  </div>
</div>
```

The FilterPanel sidebar is hidden whenever a selection/control bar is active (matches the space
timeline page). `personNames`/`tagNames` are NOT passed to FilterPanel (the reference passes them
only to `ActiveFiltersBar`).

Layout — **add overlay** (inside the existing `fixed inset-0 z-40` section):

`<main>` keeps `pt-(--navbar-height)` and the sidebar lives INSIDE it (mirrors the global album
page's select-assets nesting); `ControlAppBar` stays after `<main>` so its absolute bar paints on top:

```svelte
<section ... data-testid="add-photos-overlay">
  <main class="relative h-dvh overflow-hidden pt-(--navbar-height)" data-testid="add-photos-timeline-main">
    <div class="flex h-full">
      {#key `space-album-picker-${album.id}`}
        <FilterPanel config={pickerFilterConfig} bind:filters={pickerFilters}
          timeBuckets={pickerTimeBuckets}
          storageKey="gallery-filter-visible-sections-space-album-picker"
          hidden={isPickerEmpty} />
      {/key}
      <div class="flex flex-1 flex-col overflow-hidden px-2 md:px-6">
        <!-- ActiveFiltersBar when pickerActive > 0 -->
        {#if showPickerFilteredEmpty}
          <!-- filtered-empty block (REPLACES the picker Timeline): message + clear-all -->
        {:else}
          <Timeline ...pickerOptions bind:timelineManager={pickerTimelineManager} />
        {/if}
      </div>
    </div>
  </main>
  <ControlAppBar .../>   <!-- stays AFTER <main> so it paints on top (paint-order fix) -->
</section>
```

### ActiveFiltersBar + filtered-empty handlers

`ActiveFiltersBar` props: `filters`, `resultCount={<mode>Total}`, `personNames`, `tagNames`,
`onRemoveFilter`, `onClearAll`. `handlePhotosRemoveFilter` from `$lib/utils/photos-filter-options`,
`clearFilters` from `filter-panel`, `clearTimelineTemporalFilter` from
`$lib/utils/timeline-temporal-filters` (new import).

- **Browse** `onRemoveFilter(type, id)`: if `type === 'timeline'` →
  `browseFilters = clearTimelineTemporalFilter(browseFilters); temporalAnchor = undefined;`
  else `browseFilters = handlePhotosRemoveFilter(browseFilters, type, id)`.
  `onClearAll`: `browseFilters = clearFilters(browseFilters); temporalAnchor = undefined;`
- **Picker** `onRemoveFilter(type, id)`: `pickerFilters = handlePhotosRemoveFilter(pickerFilters, type, id)`.
  `onClearAll`: `pickerFilters = clearFilters(pickerFilters)`.

### Empty states (full parity)

Two distinct, non-overlapping cases (mirrors the reference — the filtered-empty block **replaces**
the Timeline; it is NOT the Timeline's `empty` snippet):

- **Filtered-empty** (`showBrowse/PickerFilteredEmpty`): a sibling block shown in place of the
  Timeline — message + a "clear all filters" button (`<mode>Filters = clearFilters(...)`, plus
  `temporalAnchor = undefined` for browse).
- **Unfiltered-empty**: the existing `<Timeline>` `empty` snippet (browse: album-empty/add-photos
  prompt; picker: picker-empty).

All four strings are **i18n keys** (see below), not hardcoded English.

### i18n

The reference hardcodes English ("No photos match your filters" / "No photos available to add
match your filters" / "Clear all filters"). The fork mandates i18n. Add new keys to
`i18n/en.json` (no existing key fits — `filter_sheet_clear_filters` = "Clear filters" differs):

- `space_album_no_photos_match_filters` — "No photos match your filters"
- `space_album_no_photos_to_add_match_filters` — "No photos available to add match your filters"
- `space_album_clear_all_filters` — "Clear all filters"

Use `$t(...)` at the call sites. Run `make sql`-style i18n formatting / prettier on `en.json`.

## Testing (TDD — mandatory)

TDD is required for every slice: write the failing test FIRST, watch it go RED, then implement
the smallest change to GREEN. No implementation code lands before its test. Each behaviour below
is its own RED→GREEN step.

Unit (`src/lib/utils/filter-name-capture.spec.ts`):

- Returns the config unchanged (same reference) when `suggestionsProvider` is undefined.
- Wrapped provider returns the original suggestions object (identity), not a copy.
- Wrapped provider populates `personNames` and `tagNames` from returned people/tags.
- Empty `people`/`tags` arrays → maps left untouched.
- Preserves the other config fields (`sections`, `providers`).

Component (`space-album-detail-page.spec.ts`; new co-located `mock-filter-panel.test-wrapper.svelte`
and `mock-active-filters-bar.test-wrapper.svelte`; `FilterPanel`/`ActiveFiltersBar` mocked, the
mocks surface `config`/`filters`/`hidden` and the active-filter handlers via testids):

- Browse renders the FilterPanel; **hidden** (not rendered) when `selectionActive`.
- Add mode renders the FilterPanel (picker config).
- `browseOptions` carries filter fields when `browseFilters` is set (assert via the existing
  `timeline-options` testid JSON); same for `pickerOptions` with `pickerFilters`.
- `ActiveFiltersBar` renders when that mode's filters are active; **absent** when none (both modes).
- Filter independence: entering add mode resets `pickerFilters` while `browseFilters` persists;
  exiting/`handleAddAssetsSuccess` resets `pickerFilters` (active count back to 0).
- (No cross-album reset test — `album.id` is stable for this component; see Resets.)
- **Filtered-empty**: when `showBrowse/PickerFilteredEmpty`, the filtered-empty block renders and
  the Timeline does **not**; its clear-all button resets that mode's filters (and `temporalAnchor`
  for browse). Unfiltered-empty still shows the Timeline's own `empty` snippet.
- Removing a temporal (`type === 'timeline'`) chip in browse resets `temporalAnchor`; `onClearAll`
  in browse resets `temporalAnchor`.
- FilterPanel `hidden` is true only when the album is genuinely empty (no assets, no active
  filters); it is **false** when filtered-to-empty (so clearing remains possible).
- i18n: the empty-state messages and clear-all label resolve through `$t` (the mocked/real keys
  exist) — no hardcoded English.
- Control-bar-after-main DOM order in the overlay still holds (existing regression test must keep
  passing).

i18n key presence is also covered by the repo's existing i18n/disclosure tests; add the three new
keys to `en.json` so those stay green.

## Gates

`pnpm test` (touched specs), `pnpm run check:typescript`, `pnpm run check:svelte`,
`pnpm build` (the real gate for web), eslint 0 on touched files, prettier --write. Commit
`feat(web): ...`, push `feat/space-albums`.

## Out of scope

- No changes to the global album page.
- No changes to server endpoints or filter config/options helpers.
- No shared filter-controller refactor (revisit if a third consumer appears).
