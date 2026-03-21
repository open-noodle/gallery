# Discovery Page Design

## Context

The Immich community has been discussing filtering, sorting, and temporal navigation
across dozens of GitHub threads. A [community write-up](docs/plans/mockups/) frames the
problem: users of shared archives navigate through **discovery** (recognition-based
browsing), not **search** (recall-based querying). The current UI lacks the navigation
primitives needed for discovery at scale.

Gallery's fork is well-positioned to address this with a dedicated Discovery page that
combines the main timeline with search, faceted filtering, sorting, and hierarchical
temporal navigation — all in one view.

## Problem

1. **No filtering within views** — person, album, space, and tag views produce result
   sets with no way to narrow them down.
2. **No sorting** — the server hardcodes `ORDER BY fileCreatedAt`. Users cannot sort by
   upload date, filename, or any other dimension.
3. **No temporal navigation at scale** — the scrubber maps a 20-year archive to ~600px.
   Precise navigation requires sub-pixel accuracy.
4. **Search requires prior knowledge** — visitors to shared archives cannot formulate
   queries for content they don't know exists.

## Solution

A new `/discover` route that replaces the main timeline (`/photos`). It combines:

- **Search bar** (top) — smart, filename, and OCR search
- **Discovery filter panel** (left, collapsible) — temporal picker, people, location,
  camera, tags, rating, media type
- **Sort control** (top bar) — capture date, upload date, filename
- **Photo timeline grid** (main area) — the existing timeline with month/day grouping
  and scrubber

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [logo] gallery    [🔍 Search photos, people, places...]  [Sort ▾] [⊞] [👤]  │
├──────┬──────────┬───────────────────────────────────────────────┤
│      │ Filters  │  2,847 results  [Sarah Chen ×] [Munich ×]  Clear all       │
│      │          ├───────────────────────────────────────────────┤
│      │ TIMELINE │  August 2020 · 614 photos                                  │
│ Nav  │ [year]   │  ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐             │
│      │ [months] │  │   ││   ││   ││   ││   ││   │             │
│      │          │  └───┘└───┘└───┘└───┘└───┘└───┘             │
│      │ PEOPLE   │                                              │
│      │ ☑ Sarah  │  Aug 24                                      │
│      │ ☐ Max    │  ┌───┐┌───┐┌───┐┌───┐┌───┐                  │
│      │          │  │   ││   ││   ││   ││   │                  │
│      │ LOCATION │  └───┘└───┘└───┘└───┘└───┘                  │
│      │ ☑ Munich │                                              │ scrubber
│      │ ☐ Berlin │  July 2020 · 891 photos                      │   ·
│      │          │  ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐             │   ·
│      │ CAMERA   │  │   ││   ││   ││   ││   ││   │             │   ·
│      │ RATING   │  └───┘└───┘└───┘└───┘└───┘└───┘             │
│      │ MEDIA    │                                              │
└──────┴──────────┴───────────────────────────────────────────────┘
  160px   240px                    remaining
 (as-is) (new, collapsible)
```

### Key Properties

- **Nav sidebar is untouched** — the existing 160px nav renders exactly as today. Zero
  modifications to upstream layout files. No fork conflicts.
- **Discovery panel is a new component** — only rendered on the `/discover` route. It
  sits between the nav and the photo grid as a new grid column.
- **Collapsible to 32px** — collapses to an icon strip showing filter category icons
  with blue badges on categories that have active filters.
- **Active filter chips** — displayed above the grid in a horizontal bar. Each chip is
  individually removable. "Clear all" button resets everything.
- **Scrubber stays on the right** — the existing timeline scrubber continues to work
  alongside the temporal picker. They complement each other: the picker provides
  coarse-grained jumping, the scrubber provides fine-grained scrolling.

## Design Decisions

### Route: `/discover` replaces `/photos`

The sidebar nav item currently labeled "Photos" points to `/discover` instead. This
avoids modifying the upstream `/photos` route (which would cause merge conflicts) while
making Discovery the default entry point for browsing.

### Sorting: Three fields, no migration

Sort options: **capture date** (`fileCreatedAt`), **upload date** (`createdAt`),
**filename** (`originalFileName`). Each with ascending/descending toggle.

All three columns already exist on the `asset` table and are already indexed. No database
migration is needed. The server change is minimal: add a `sortBy` enum parameter to
`MetadataSearchDto` and replace the hardcoded `.orderBy('asset.fileCreatedAt', ...)`
with a dynamic field selection.

Rating and file size sorting are deferred — they require new indexes on the `asset_exif`
table (a migration).

### Temporal Picker: Client-side aggregation

The existing `GET /timeline/buckets` endpoint already returns month-level buckets with
counts and supports all filter parameters (personId, albumId, spaceId, tagId, etc.).

The temporal picker aggregates monthly buckets into year-level counts client-side. For a
20-year archive that is ~240 month buckets — trivial to sum in JS. No server changes
needed.

Year buttons show relative volume bars (tallest year = 100% width, others proportional).
Clicking a year expands the month grid below it with a breadcrumb trail. Clicking a month
scrolls the timeline to that position.

When filters are active, the bucket query automatically passes those filters through,
so counts reflect the filtered result set. Years with zero matches are greyed out.

### Filter Panel: Reuses existing filter infrastructure

The filter sections (people, location, camera, tags, rating, media type) use the same
filter parameters that the existing `SearchFilterModal` and `MetadataSearchDto` already
support. The panel is a new rendering of the same data — collapsible accordion sections
with checkboxes instead of a modal dialog.

Each section is independently collapsible. The People section includes a local search
input. Location uses a hierarchical tree (country → city). All selections immediately
update the timeline.

### Search: Top bar with type toggle

The search input sits in the top bar, prominent and always accessible. A small toggle
allows switching between Smart (CLIP semantic), File (filename), and OCR search modes.
This reuses the existing search endpoints — no new server work.

## Server Changes

### New `AssetSortBy` enum

```typescript
export enum AssetSortBy {
  CaptureDate = 'captureDate',
  UploadDate = 'uploadDate',
  Filename = 'filename',
}
```

### DTO changes

Add `sortBy?: AssetSortBy` to `MetadataSearchDto` (defaults to `CaptureDate`). The
existing `order?: AssetOrder` (asc/desc) works alongside it.

### Repository changes

In `search.repository.ts`, replace:

```typescript
.orderBy('asset.fileCreatedAt', orderDirection)
```

With dynamic field mapping:

```typescript
const sortField = {
  captureDate: 'asset.fileCreatedAt',
  uploadDate: 'asset.createdAt',
  filename: 'asset.originalFileName',
}[options.sortBy ?? 'captureDate'];

.orderBy(sortField, orderDirection)
```

Same pattern applies to `searchSmart()` (for non-relevance sorts).

### Timeline bucket changes

Add `sortBy` to `TimeBucketOptions` so the timeline can sort by the selected field.
Update `getTimeBucket()` in `asset.repository.ts` to use the configurable sort field.

## Web Changes

### New route: `/discover`

New SvelteKit route at `web/src/routes/(user)/discover/`. Contains the page layout with
the discovery panel, search bar, sort control, active filters bar, and timeline grid.

### New component: `DiscoveryPanel`

A collapsible sidebar component with:

- **Header** — "Filters" title + collapse/expand button
- **Timeline section** — year grid (4 columns) + month drill-down (4 columns)
- **People section** — searchable list with avatar + checkbox
- **Location section** — hierarchical tree with checkboxes
- **Camera section** — flat list with checkboxes
- **Tags section** — flat list with checkboxes
- **Rating section** — interactive star selector
- **Media Type section** — toggle buttons (All / Photos / Videos)

State: a `discoveryFilters` Svelte 5 rune store holding all active filter values. Changes
trigger re-fetch of timeline buckets and assets.

### Collapsed state

When collapsed (32px), the panel shows vertical icon buttons for each filter category.
Icons with active filters show a small blue badge dot. Clicking an icon expands the panel
and scrolls to that section.

### Sidebar nav update

The "Photos" nav item in `user-sidebar.svelte` changes its `href` to `/discover`. This
is the only modification to an existing upstream file — a single line change.

### Sort dropdown

A dropdown in the top bar (next to search) showing:

- Capture Date (default)
- Upload Date
- Filename
- Divider
- Ascending / Descending toggle

Selection is stored in the `discoveryFilters` store and passed through to API calls.

## Testing Strategy

### Server (TDD)

- **Unit tests** for `SearchService` — verify `sortBy` parameter is passed through
- **Unit tests** for `SearchRepository` — verify query builds correct `ORDER BY` for
  each `sortBy` value and direction combination
- **Medium tests** (real DB) — insert assets with known dates/filenames, verify returned
  order matches each sort option

### Web (TDD + E2E)

**Unit tests:**

- `DiscoveryPanel` component renders all sections
- Collapsing/expanding the panel
- Year aggregation from monthly buckets
- Month drill-down interaction
- Filter selections update the store
- Sort dropdown selection
- Active filter chips rendering and removal
- Collapsed state badge indicators

**E2E (Playwright):**

- Navigate to `/discover` — verify page loads with timeline
- Open filter panel — select a person filter — verify timeline updates
- Select a location filter — verify result count changes
- Change sort to "Upload Date" — verify order changes
- Open temporal picker — click a year — verify months appear with counts
- Click a month — verify timeline scrolls to that month
- Apply multiple filters — verify active chips appear
- Remove a chip — verify filter is removed and results update
- Collapse panel — verify icon strip with badges
- Expand panel — verify filters are preserved
- Clear all filters — verify full timeline returns

## Mockups

Interactive HTML mockups are in `docs/plans/mockups/`:

- `discovery-independent-panel.html` — the chosen layout (left panel, expanded +
  collapsed states) with the nav sidebar untouched
- `discovery-page.html` — earlier full-page exploration (for reference)
- `discovery-layout-options.html` — comparison of four layout approaches (A–D)
- `discovery-navigation-phase1.html` — filter + sort toolbar concepts
- `discovery-navigation-phase2.html` — clickable metadata concepts (deferred)
- `discovery-navigation-phase3.html` — temporal picker concepts

## Out of Scope

- **Clickable metadata navigation** — making detail panel metadata (person, location,
  camera) link to filtered views. Deferred; the Discovery page covers this use case
  through its filter panel.
- **Faceted filter counts** — showing result counts per filter option before selection.
  Requires heavier server queries. Not in scope.
- **Rating and file size sorting** — requires new database indexes (migration). Deferred.
- **Mobile layout** — the Discovery page is web-only for now. Mobile can be addressed
  in a future phase.
