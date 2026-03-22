# Filterable Timeline Design

## Context

The Immich community has been discussing filtering, sorting, and temporal navigation
across dozens of GitHub threads. A community write-up frames the core problem: users of
shared archives navigate through **discovery** (recognition-based browsing), not
**search** (recall-based querying). The current UI lacks the navigation primitives needed
for discovery at scale.

Today, applying filters kicks you out of the timeline into a degraded flat search results
page — no month grouping, no virtual scrolling, no scrubber. The goal is to make the
timeline itself filterable, so filters apply in-place without leaving the timeline
experience.

## Problem

1. **No filtering within views** — the timeline, person, album, and space views produce
   result sets with no way to narrow them down. The only path to filtering is the search
   modal, which navigates away to `/search`.
2. **No sorting** — the server hardcodes `ORDER BY fileCreatedAt`. Users cannot sort by
   upload date, filename, or any other dimension.
3. **No temporal navigation at scale** — the scrubber maps a 20-year archive to ~600px.
   Precise navigation requires sub-pixel accuracy.
4. **Filter and search are conflated** — the `SearchFilterModal` mixes structured
   filters (person, location, camera) with text/CLIP search. These are different
   operations: filtering is exhaustive (every match), search is ranked (best matches).

## Solution

A generic, reusable **FilterPanel** component that can be embedded in any view with a
timeline. V1 is implemented inside the **Spaces** view (fork-only code, zero upstream
conflict risk). The same component can later be added to albums, person views, tags, and
the main timeline.

The FilterPanel sits as a collapsible left sidebar alongside the existing timeline grid.
Filters apply to the timeline endpoint in-place — the `TimelineManager` rebuilds with
the new filter parameters. Virtual scrolling, scrubber, and month grouping all continue
to work.

### Separation of concerns

- **Filtering** (this feature) = exhaustive structured narrowing. "Show me ALL photos
  from Munich taken by Canon with 4+ stars." Uses the timeline endpoint with WHERE
  clauses. Results have month grouping and virtual scrolling.
- **Search** (existing feature) = ranked keyword/semantic retrieval. "Find photos that
  look like a beach sunset." Uses CLIP embeddings via `/search/smart`. Results are
  ranked by relevance. Stays in the global search bar → `/search` page.

These are different operations and belong in different UI locations.

### Layout (Spaces V1)

```
┌──────┬──────────┬───────────────────────────────────────────┐
│      │ Filters  │  ← Summer Trip 2023        [Sort ▾]      │
│      │          ├───────────────────────────────────────────┤
│      │ TIMELINE │  342 results [Sarah ×] [Munich ×] Clear   │
│      │ [2023]   ├───────────────────────────────────────────┤
│ Nav  │ [months] │  August 2023 · 312 photos                 │
│      │          │  ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐          │
│      │ PEOPLE   │  │   ││   ││   ││   ││   ││   │          │
│      │ ◉ Sarah  │  └───┘└───┘└───┘└───┘└───┘└───┘          │
│      │ ○ Max    │                                           │
│      │          │  July 2023 · 535 photos                    │
│      │ LOCATION │  ┌───┐┌───┐┌───┐┌───┐┌───┐               │
│      │ ☑ Munich │  │   ││   ││   ││   ││   │               │
│      │ ☐ Berlin │  └───┘└───┘└───┘└───┘└───┘               │
│      │          │                                           │
│      │ CAMERA   │                                    scrub  │
│      │ RATING   │                                      ·    │
│      │ MEDIA    │                                      ·    │
└──────┴──────────┴───────────────────────────────────────────┘
  160px   240px                  remaining
 (as-is) (new, collapsible to 32px)
```

### Key properties

- **Nav sidebar is untouched** — the existing 160px nav renders exactly as today. Zero
  modifications to upstream layout files.
- **FilterPanel is a new generic component** — it receives configuration (which sections
  to show, data providers for filter options) and emits filter state. It does not know
  about spaces, albums, or any specific view.
- **Collapsible to 32px** — collapses to an icon strip showing filter category icons
  with blue badges on categories that have active filters.
- **Active filter chips** — displayed above the grid in a horizontal bar. Each chip is
  individually removable. "Clear all" button resets everything.
- **Scrubber stays on the right** — the existing timeline scrubber continues to work
  alongside the temporal picker.

## Component Architecture

### FilterPanel — generic, view-agnostic

```typescript
interface FilterPanelConfig {
  // Which sections to show (not all views need all filters)
  sections: FilterSection[];

  // Data providers — the panel calls these to populate filter options.
  // Each view provides its own scoped data source.
  providers: {
    people?: () => Promise<PersonOption[]>;
    locations?: () => Promise<LocationOption[]>;
    cameras?: () => Promise<CameraOption[]>;
    tags?: () => Promise<TagOption[]>;
  };

  // Time buckets — passed in from whatever TimelineManager owns the grid
  timeBuckets?: TimeBucket[];
}

interface FilterState {
  personId?: string; // single-select (server accepts one personId)
  city?: string;
  country?: string;
  make?: string;
  model?: string;
  tagId?: string;
  rating?: number; // minimum rating (1-5)
  mediaType?: 'all' | 'image' | 'video';
  sortBy: 'captureDate' | 'uploadDate' | 'filename';
  sortOrder: 'asc' | 'desc';
  selectedYear?: number;
  selectedMonth?: number;
}
```

### Usage in Spaces (V1)

```svelte
<FilterPanel
  config={{
    sections: ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'],
    providers: {
      people: () => getSpacePeople(spaceId),
      locations: () => getSpaceLocations(spaceId),
      cameras: () => getSpaceCameras(spaceId),
      tags: () => getSpaceTags(spaceId),
    },
  }}
  timeBuckets={timelineManager.months}
  onFilterChange={(filters) => rebuildTimeline(filters)}
/>
```

### Future usage in Albums

```svelte
<FilterPanel
  config={{
    sections: ['timeline', 'people', 'location', 'camera', 'rating'],
    providers: {
      people: () => getAlbumPeople(albumId),
      locations: () => getAlbumLocations(albumId),
    },
  }}
  timeBuckets={timelineManager.months}
  onFilterChange={(filters) => rebuildTimeline(filters)}
/>
```

### Future usage in main timeline (/photos or /discover)

```svelte
<FilterPanel
  config={{
    sections: ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'],
    providers: {
      people: () => getAllPeople(),
      locations: () => getAllLocations(),
      cameras: () => getAllCameras(),
      tags: () => getAllTags(),
    },
  }}
  timeBuckets={timelineManager.months}
  onFilterChange={(filters) => rebuildTimeline(filters)}
/>
```

## Server Changes

### Extend `TimeBucketDto` with missing filter parameters

The timeline endpoint already supports personId, albumId, spaceId, tagId, isFavorite,
visibility. It is missing the EXIF-based filters that the search endpoint supports.

Add these optional fields to `TimeBucketDto` and `TimeBucketAssetDto`:

```typescript
// EXIF filters (require joining asset_exif in the CTE)
city?: string;
country?: string;
make?: string;        // camera make
model?: string;       // camera model
rating?: number;      // minimum rating (>=)

// Asset table filters (no extra join needed)
type?: AssetType;     // IMAGE or VIDEO
```

Wire these as WHERE clauses in the `getTimeBuckets` and `getTimeBucket` CTE queries in
`asset.repository.ts`. The `asset_exif` table needs to be joined in the CTE when any
EXIF filter is provided.

### Add `AssetSortBy` enum and `sortBy` parameter

```typescript
export enum AssetSortBy {
  CaptureDate = 'captureDate',
  UploadDate = 'uploadDate',
  Filename = 'filename',
}
```

Add `sortBy?: AssetSortBy` to both `TimeBucketDto` and `MetadataSearchDto`. Replace
hardcoded `.orderBy('asset.fileCreatedAt', ...)` with dynamic field selection based on
`sortBy`.

Sort fields and their columns (all already indexed, no migration needed):

- `captureDate` → `asset.fileCreatedAt`
- `uploadDate` → `asset.createdAt`
- `filename` → `asset.originalFileName`

### No new endpoints

The existing timeline endpoints gain new optional parameters. The API contract is
backward-compatible — omitting the new parameters produces the same behavior as before.

## Web Changes

### New generic components

All new components live in `web/src/lib/components/filter-panel/`:

- `filter-panel.svelte` — outer wrapper, collapsible, header with collapse button
- `filter-section.svelte` — generic collapsible section (title + chevron + body slot)
- `temporal-picker.svelte` — year→month grid with counts and volume bars
- `people-filter.svelte` — searchable single-select list with avatars
- `location-filter.svelte` — hierarchical country→city checkboxes
- `camera-filter.svelte` — flat list of make/model
- `tags-filter.svelte` — flat checkbox list
- `rating-filter.svelte` — interactive star selector
- `media-type-filter.svelte` — All/Photos/Videos toggle
- `sort-dropdown.svelte` — capture date / upload date / filename + direction
- `active-filters-bar.svelte` — removable chips + result count + clear all

### Integration into Spaces page

The space page (`web/src/routes/(user)/spaces/[spaceId]/...`) adds the `FilterPanel`
as a left sidebar alongside the existing timeline. The page provides space-scoped data
providers and passes filter state changes to the `TimelineManager`.

### Collapsed state

When collapsed (32px), the panel shows vertical icon buttons for each filter category.
Icons with active filters show a small blue dot badge. Clicking an icon expands the
panel and scrolls to that section.

## Testing Strategy

### Server (TDD)

- **Unit tests** for `TimelineService` — verify new filter params are passed through
- **Unit tests** for `AssetRepository` — verify CTE WHERE clauses for each new filter
- **Unit tests** for `SearchService` — verify `sortBy` parameter passthrough
- **Unit tests** for `SearchRepository` — verify dynamic ORDER BY
- **Medium tests** (real DB) — insert assets with known EXIF data, verify timeline
  buckets return correct counts when filtered by city, camera, rating

### Web (TDD + E2E)

**Unit tests:**

- `FilterPanel` renders configured sections only
- `FilterPanel` hides sections not in config
- Collapsing/expanding the panel preserves filter state
- `TemporalPicker` aggregates monthly buckets into year counts
- `TemporalPicker` calculates relative volume bars
- `TemporalPicker` month drill-down shows correct counts
- Each filter section emits correct filter state on selection
- `PeopleFilter` is single-select (radio button behavior)
- `PeopleFilter` local search filters the list
- `LocationFilter` hierarchical expand (country → cities)
- `RatingFilter` highlights stars up to selected value
- `MediaTypeFilter` toggles between All/Photos/Videos
- `SortDropdown` shows current sort, changes on selection
- `ActiveFiltersBar` renders chips for active filters only
- `ActiveFiltersBar` removes individual filter on chip close
- `ActiveFiltersBar` clears all on Clear All click
- Collapsed state shows badge dots on icons with active filters
- Collapsed icon click expands panel to that section

**E2E (Playwright) — comprehensive coverage:**

_Page load and basic rendering:_

- Navigate to space page — verify filter panel renders
- Verify all configured sections are visible
- Verify temporal picker shows year/month data

_Temporal picker:_

- Click a year — verify month grid appears with counts
- Click a month — verify timeline scrolls to that month
- Click "All years" breadcrumb — verify returns to year view
- Verify year with zero photos after filtering is greyed out

_People filter:_

- Select a person — verify timeline updates to show only their photos
- Deselect person — verify timeline returns to full set
- Type in people search — verify list filters
- Verify only people in the space are shown

_Location filter:_

- Select a country — verify cities appear below
- Select a city — verify timeline filters to that city
- Deselect city — verify filter removed

_Camera filter:_

- Select a camera — verify timeline filters
- Verify only cameras used in the space are listed

_Tags filter:_

- Select a tag — verify timeline filters

_Rating filter:_

- Click 3 stars — verify only 3+ star photos shown
- Click same star again — verify rating filter clears

_Media type filter:_

- Click Photos — verify only images shown
- Click Videos — verify only videos shown
- Click All — verify both shown

_Sort:_

- Change sort to Upload Date — verify order changes
- Change sort to Filename — verify alphabetical order
- Toggle ascending/descending — verify order reverses

_Active filter chips:_

- Apply person filter — verify chip appears with person name
- Apply location filter — verify chip appears with city name
- Remove person chip — verify only location filter remains active
- Click Clear All — verify all filters removed, timeline shows full set

_Combined filters:_

- Apply person + location + rating simultaneously — verify intersection
- Verify result count updates with each additional filter
- Remove one filter — verify others still active

_Collapsed panel:_

- Collapse panel — verify 32px icon strip
- Verify badge dot on people icon when person filter active
- Verify no badge on camera icon when no camera filter active
- Click people icon — verify panel expands scrolled to people section
- Expand panel — verify all filters preserved

_Edge cases:_

- Apply filters that match nothing — verify empty state
- Space with single photo — verify temporal picker shows one year/month
- All sections collapsed — verify panel still functional
- Rapidly toggle filters — verify no race conditions in timeline reload

## Design Mockups

Interactive HTML mockups are in `docs/plans/mockups/`:

- `discovery-independent-panel.html` — the chosen layout (left panel, expanded +
  collapsed states with badge indicators)
- `discovery-navigation-phase3.html` — detailed temporal picker with volume bars,
  breadcrumb, and filtered counts

Additional reference mockups (earlier explorations):

- `discovery-page.html` — full-page layout exploration
- `discovery-layout-options.html` — comparison of four layout approaches
- `discovery-navigation-phase1.html` — filter + sort toolbar concepts
- `discovery-navigation-phase2.html` — clickable metadata concepts (deferred)

## Out of Scope

- **Clickable metadata navigation** — making detail panel metadata (person, location,
  camera) link to filtered views. Deferred.
- **Faceted filter counts** — showing result counts per filter option before selection.
  Requires heavier server queries.
- **Rating and file size sorting** — requires new database indexes (migration).
- **Mobile layout** — web-only for now.
- **Smart/CLIP search integration** — CLIP search uses vector similarity and produces
  ranked results incompatible with month-grouped timelines. Stays in global search bar.
- **Multi-person filter** — server accepts single `personId`. Multi-select deferred.
