# Mobile: search & sort for the Spaces list and a Space's Albums list

**Date:** 2026-07-10
**Status:** Design — approved, pending spec review
**Area:** mobile (Flutter) · shared spaces
**Branch:** `space-albums-onto-main`

## Problem

Two mobile surfaces render a **flat, unordered, unsearchable list**:

1. **A space's albums** — reached via "See all" on a space's album shelf (`SpaceAlbumsPage`). A space like _Aurelia und Pierre_ has 21 linked albums in a plain 2-column grid ordered by name only. There is no way to search or reorder.
2. **The Spaces list** (`SpacesPage`) — a 2-column grid of every space the user belongs to, with no search and no ordering.

Both become hard to navigate as the number of items grows. The web app already offers search + sort on the equivalent surfaces.

## Goals

- Add **search-by-name** and a **reversible sort menu** to both surfaces.
- Mirror the app's existing Albums pattern (`album_selector.widget.dart`: a persistent `SearchField` + a sort-menu button that reverses on re-tap) so the interaction is already familiar.
- Keep everything else on both pages unchanged (cards, the editor Link action, the card ⋮ menu, the create FAB, existing empty states).
- No server, API, sync, or DB-migration changes.

## Non-goals

- Grouping (e.g. by hidden/shown-in-timeline). Not requested.
- Enriching the Spaces **card** subtitle (album count / "N new"). Shown in the mock but explicitly **deferred** — see [Out of scope](#out-of-scope--deferred).
- Any web changes.

## Approved decisions

From brainstorming + the approved design mock (5 phone frames rendered in the app's Material style):

1. **Sort options** — the "curated" set (below), each mode reversible.
2. **Persistence** — the chosen sort mode + direction is remembered between visits, one global preference per surface (via the same key-value `Store` the Albums page uses). The search query is **ephemeral** (resets each visit).
3. **Search matches the name only** (not description).
4. **Filtering + sorting run client-side** on the already-loaded list — both lists are fully in memory, so it is instant and reactive; no new queries.
5. Grid stays 2-column; no list/grid view toggle.

## Design reference

The UI must match the approved mock committed alongside this doc — [`2026-07-10-mobile-spaces-albums-search-sort-mock.html`](./2026-07-10-mobile-spaces-albums-search-sort-mock.html) (open in a browser; theme-aware, rendered in the app's Material style). Its five frames are the acceptance target for the visual + interaction layer:

1. **Space albums · default** — app bar (keeping the editor **Link** action) → a pill `SearchField` ("Search albums") → a row whose left shows the result count ("21 albums") and whose right is a `Sort: Recently linked` pill → the existing 2-column album grid (cover, name, "N photos", "· Hidden" on off-timeline cards).
2. **Space albums · sort menu open** — a scrim + a menu titled "Sort albums by" listing the 4 modes; the selected mode (Recently linked) shows a check **and** a down/up direction arrow.
3. **Space albums · searching "ita"** — the field is filled with a clear ✕; the count reads "2 of 21 · matches 'ita'"; the grid shows only the matches; sort still applies within them.
4. **Spaces · default** — the same search + sort row under the "Spaces" app bar, defaulting to `Recent activity`; the existing `SpaceCard` grid and the create **＋** FAB stay.
5. **Spaces · sort menu open** — a menu titled "Sort spaces by" listing the 5 modes.

Build to this layout: the `Sort: <mode>` pill, the check + reversible arrow, the result-count caption, the clear ✕, and a distinct no-match state. (The mock's richer space-card subtitle is **deferred** — see [Out of scope](#out-of-scope--deferred).)

## Development approach (test-first)

This feature is built with TDD (`superpowers:test-driven-development`): for every behavior below, write a **failing** test first (red), add the minimal code to pass (green), then refactor — never write implementation ahead of a test that pins it. The implementation plan slices the work so each slice is its own red→green→refactor loop:

1. `SpaceAlbum` model + `watchLinkedAlbums` expose `linkedAt`/`updatedAt` (repository/Drift test first).
2. Pure filter/sort helpers + the two sort-mode enums (unit tests: ordering, reverse, ties, null-safety, case-insensitive search).
3. Reusable `CollectionSortButton` (widget test: renders modes, selects, reverses on re-tap).
4. `SpaceAlbumsPage` search + sort + no-match (widget tests).
5. `SpacesPage` search + sort + no-match (widget tests).
6. Persistence round-trip through `Store` for both surfaces.

The filter + sort logic lives in **pure, testable functions** (e.g. `filterAndSortSpaceAlbums(list, query, sort)` / `filterAndSortSpaces(...)`) so the edge-case matrix is covered by fast unit tests, leaving widget tests to verify wiring, rendering, and persistence. `dart analyze --fatal-infos lib test` and the mobile test suite must be green before the feature is done.

## Shared UI

A single row layout added under the app bar on both pages, above the grid:

- **Search field** — reuse the existing `SearchField` (`mobile/lib/widgets/common/search_field.dart`): `hintText`, `onChanged`, a controller, and a clear (✕) affordance when non-empty. Filters the list case-insensitively by `name` as the user types.
- **Sort button + menu** — a small **reusable** `CollectionSortButton` widget (new), generic over a sort-mode enum. Renders a pill showing `Sort: <current mode>`; tapping opens a menu of the modes; the selected mode shows a check + a direction arrow; tapping the **selected** mode again flips the direction. This mirrors `_SortButton` in `album_selector.widget.dart` but is decoupled from `AlbumSortMode` so both new enums can use it.
- **Result count** — a small caption ("21 albums" / "2 of 21 · matches 'ita'").

Each page keeps its **own** filter/sort logic (different models and data sources); only the dumb UI (`SearchField`, `CollectionSortButton`) is shared. This avoids over-abstracting across two dissimilar models.

### Sort-mode enums

Follow the shape of the existing `AlbumSortMode` (enum carrying a store index, an i18n label key, and a `defaultOrder`, with `effectiveOrder(bool isReverse)`).

**`SpaceAlbumSortMode`** (default: `recentlyLinked`)

| Mode              | Field                                | Default order |
| ----------------- | ------------------------------------ | ------------- |
| `name`            | `SpaceAlbum.name`                    | asc (A→Z)     |
| `photoCount`      | `SpaceAlbum.assetCount`              | desc          |
| `recentlyLinked`  | `SpaceAlbum.linkedAt` _(new field)_  | desc          |
| `recentlyUpdated` | `SpaceAlbum.updatedAt` _(new field)_ | desc          |

**`SpaceSortMode`** (default: `recentActivity`)

| Mode             | Field (`SharedSpaceResponseDto`)                                  | Default order |
| ---------------- | ----------------------------------------------------------------- | ------------- |
| `name`           | `name`                                                            | asc           |
| `recentActivity` | `lastActivityAt` (fallback `updatedAt` → `createdAt` when absent) | desc          |
| `dateCreated`    | `createdAt`                                                       | desc          |
| `members`        | `memberCount` (`?? 0`)                                            | desc          |
| `photos`         | `assetCount` (`?? 0`)                                             | desc          |

All `Optional` DTO fields are read null-safely with a stable fallback so a missing value sorts last (or by the fallback field) rather than throwing. Sorting is **stable** (ties keep prior order / break by name) so the grid never reshuffles arbitrarily.

## Surface 1 — a space's albums (`SpaceAlbumsPage`)

**File:** `mobile/lib/pages/library/spaces/space_albums.page.dart`
**Data:** `spaceAlbumsProvider(spaceId)` → `List<SpaceAlbum>` (Drift), via `watchLinkedAlbums` in `mobile/lib/infrastructure/repositories/space_album.repository.dart`.

### Data change (small, no migration)

The mobile `SpaceAlbum` model currently carries `id, name, thumbnailAssetId, showInTimeline, assetCount`. Add two dates it does **not** yet expose but that **already exist in Drift**:

- `linkedAt` ← `shared_space_album_link.createdAt`
- `updatedAt` ← `shared_space_album.updatedAt`

Changes:

- `mobile/lib/domain/models/space_album.model.dart` — add `final DateTime linkedAt;` and `final DateTime updatedAt;`.
- `space_album.repository.dart` `watchLinkedAlbums` — read `link.createdAt` and `meta.updatedAt` into the `SpaceAlbum`. Drop the query-level `orderBy(meta.name)` (ordering now happens in the page) or keep it as a stable default; either way the page applies the real sort.

No Drift schema change, no sync change, no server change — the columns are already synced and populated.

### UI

- Convert `SpaceAlbumsPage` to a `HookConsumerWidget`; hold `searchQuery` (ephemeral) and the `SpaceAlbumSort(mode, isReverse)` (loaded from / written to `Store`) in page state.
- Insert the shared search field + `CollectionSortButton` between the app bar and the grid.
- Filter by name, then sort by the active mode/direction, then render the existing `_AlbumGrid`.
- **Preserve** the editor-gated `Link` app-bar action, the card `⋮` menu (Show/Hide in timeline, Unlink), the "Hidden" badge, and the existing all-empty `_EmptyState`.
- New **no-match** state when the list is non-empty but the query matches nothing: centered icon + "No albums match '<query>'". Distinct from `_EmptyState`.

## Surface 2 — the spaces list (`SpacesPage`)

**File:** `mobile/lib/pages/library/spaces/spaces.page.dart`
**Data:** `sharedSpacesProvider` → `List<SharedSpaceResponseDto>` (server-sourced, already fully loaded).

### UI

- Convert to a `HookConsumerWidget`; hold `searchQuery` (ephemeral) and `SpaceSort(mode, isReverse)` (from `Store`).
- Insert the same shared search field + `CollectionSortButton` between the "Spaces" app bar and the grid.
- Filter by name, sort by the active mode/direction, render the existing `SpaceCard` grid.
- **Preserve** the create `+` FAB / create-space dialog and the existing all-empty state.
- New **no-match** state ("No spaces match '<query>'").
- No data-model change — all sort fields already exist on `SharedSpaceResponseDto`.

## Persistence

Add per-surface keys to the app's `StoreKey` enum, written/read exactly as `album_selector.widget.dart` does for `.albumSortMode` / `.albumIsReverse`:

- `spaceAlbumSortMode` (int, enum store index) + `spaceAlbumSortIsReverse` (bool)
- `spacesSortMode` (int) + `spacesSortIsReverse` (bool)

One global preference per surface (not per-space). Missing/absent → the enum's default mode and its `defaultOrder`.

## i18n

Reuse existing sort keys where they match (`library_page_sort_title` → "Name", `library_page_sort_asset_count` → "Photo count", `library_page_sort_created`, `sort_recent`). Add the gaps:

- Search hints: `space_albums_search_hint` ("Search albums"), `spaces_search_hint` ("Search spaces").
- Sort labels not already present: `sort_recently_linked`, `sort_recently_updated`, `sort_recent_activity`, `sort_date_created`, `sort_members`, `sort_photos`.
- No-match: `space_albums_no_match`, `spaces_no_match` (with a `{query}` arg).
- Result counts: `space_albums_result_count`, `spaces_result_count` (with `{count}` / `{total}` args).

All new strings go through the normal i18n pipeline (`i18n/en.json` source of truth).

## Testing

Written **test-first** (see [Development approach](#development-approach-test-first)). Coverage splits between **pure-function unit tests** (the filter/sort logic — where most edge cases live) and **widget tests** (wiring, rendering, persistence, regressions), mirroring the existing `space_*` page specs and `album_selector` tests. Every bullet below is a test case.

### Filter (search) — unit

- Empty query → the full list, unchanged (and still sorted).
- Whitespace-only query → treated as empty → full list.
- Query is **trimmed** and matched **case-insensitively**, substring anywhere in the name ("ita" → "Italy 2022"; "ITALY" matches; "2022" matches).
- Diacritics are **not** folded — "Sächsische" matches "säch"/"SÄCH" but not "sach". Asserted explicitly so the behavior is intentional, not an accident (fold-or-not can change later with a test to prove it).
- No match on a non-empty list → empty result (drives the no-match state); the source list is untouched.
- Query matching every item → full list.
- Regex-meta / special characters in the query (`.`, `(`, `\`, `*`) are treated as literal text, never as a pattern.

### Sort — unit (both enums)

- Each mode orders by its field in its `defaultOrder`.
- `isReverse` flips every mode.
- **Deterministic ties**: equal sort keys keep a stable order (tie-break by name asc, then id) so repeated re-sorts never reshuffle.
- Space albums: `recentlyLinked` uses `linkedAt`, `recentlyUpdated` uses `updatedAt` (a fixture where those two disagree proves they are not swapped).
- Spaces null-safety: with `lastActivityAt`/`memberCount`/`assetCount` **absent**, `recentActivity` falls back `updatedAt` → `createdAt`; `members`/`photos` treat absent as `0`; absent never throws and sorts to a stable position.
- Search + sort compose: sort applies **within** the filtered subset; clearing the query restores the full sorted list.
- Empty list and single-item list don't throw.

### Persistence — unit / widget

- Chosen mode + `isReverse` are written to `Store` and re-read on the next mount (round-trip across a fresh build).
- Absent/unset keys → the enum's default mode + `defaultOrder`.
- **Defensive**: a stored index out of range (enum reordered/shrunk in a later build) falls back to the default instead of crashing.
- The search query is **not** persisted (a fresh mount starts empty).

### Widget / rendering

- `SpaceAlbumsPage`: search field + `Sort:` pill render; typing filters the grid; opening the menu lists the modes; tapping a mode re-sorts; re-tapping the selected mode reverses (arrow flips); the result-count caption updates.
- Reactive: when `spaceAlbumsProvider` (a Drift stream) emits an updated list, the active filter + sort re-apply automatically.
- **No-match vs empty are distinct**: the no-match state (icon + "No albums match '<query>'") renders when a query filters everything out; the genuinely-empty `_EmptyState` still renders when the space has zero linked albums. Distinct widget keys so tests can tell them apart.
- `SpacesPage`: same, over `SpaceCard`; the `loading` and `error` branches of `sharedSpacesProvider.when` are preserved and show **no** search/sort controls.
- `SpaceAlbumsPage` `loading`/`error` branches preserved likewise.

### Regression (unchanged affordances)

- Albums: the editor-gated **Link** app-bar action and the card `⋮` menu (Show/Hide in timeline, Unlink) remain present and gated by `canEdit`; a viewer (`canEdit == false`) sees neither, before and after filtering/sorting.
- Albums: the "Hidden" (off-timeline) badge + dimmed cover still render and survive filter/sort.
- Spaces: the create **＋** FAB and its create-space dialog still work; the all-empty state is unchanged.

### Data layer

- `watchLinkedAlbums` populates `linkedAt` (from `shared_space_album_link.createdAt`) and `updatedAt` (from `shared_space_album.updatedAt`); a repository/Drift test asserts both are read and correct, including two rows whose `createdAt` and `updatedAt` differ.

## Out of scope / deferred

- **Richer Spaces card subtitle** (album count + "N new" badge), shown in the mock. Separable from search/sort, and the spaces-list DTO does not obviously carry a per-space album count, so it would need extra data plumbing. Track as an optional follow-up; not part of this spec.
- Grouping, view-mode toggle, description search, server-side sort/paging.

## File-by-file summary

| File                                                                 | Change                                                                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `mobile/lib/widgets/common/collection_sort_button.dart` _(new)_      | Reusable sort pill + reversible menu, generic over a sort-mode enum.                                            |
| `mobile/lib/pages/library/spaces/collection_sort.dart` _(new)_       | Pure `filterAndSortSpaceAlbums` / `filterAndSortSpaces` helpers + `SpaceAlbumSortMode` / `SpaceSortMode` enums. |
| `mobile/lib/pages/library/spaces/space_albums.page.dart`             | Add search + sort wiring; no-match state.                                                                       |
| `mobile/lib/pages/library/spaces/spaces.page.dart`                   | Add search + sort wiring; no-match state.                                                                       |
| `mobile/lib/domain/models/space_album.model.dart`                    | Add `linkedAt`, `updatedAt`.                                                                                    |
| `mobile/lib/infrastructure/repositories/space_album.repository.dart` | `watchLinkedAlbums` reads `link.createdAt` + `meta.updatedAt`.                                                  |
| `StoreKey` enum + store usage                                        | 4 new keys for the two surfaces' persisted sort state.                                                          |
| `i18n/en.json` (+ generated l10n)                                    | New search-hint / sort-label / no-match / count strings.                                                        |
| `docs/plans/2026-07-10-…-mock.html`                                  | The approved visual reference (this deliverable).                                                               |
| Test files (**written first**, per [Testing](#testing))              | Pure-function unit tests for filter/sort + widget tests for both pages + a Drift test.                          |
