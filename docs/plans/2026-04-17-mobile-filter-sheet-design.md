# Mobile Filter Sheet — Design

**Status:** Draft · 2026-04-17
**Mockup:** [`docs/plans/mockups/2026-04-17-mobile-filter-sheet.html`](./mockups/2026-04-17-mobile-filter-sheet.html)
**Scope:** Flutter mobile app (`mobile/`). Phase 1 targets the Photos tab and main library only.

## 1. Summary

Replace the dedicated Search tab with a three-snap bottom sheet summoned from the Photos tab. The sheet supports every filter dimension the web FilterPanel supports _except Camera_ — people, places, tags, temporal, rating, media type, favourites, archived, not-in-album, text search — with live context-aware counts. Long-tail discovery (10,000+ people, 26+ years, thousands of places) is handled by dedicated full-screen overflow pickers pushed over the sheet. Camera re-joins in Phase 2.

The design ships in two phases:

- **Phase 1 (MVP):** sheet shell; overflow pickers for People and When only; dynamic suggestions enabled; Search tab retired. Camera filter not included — see §4.8.
- **Phase 2:** overflow pickers for Tags and Places; Camera filter re-added as a Deep-only section.

## 2. Goals

- Feature parity with the web FilterPanel on Photos _by the end of Phase 2_. Phase 1 is parity-minus-Camera (§4.8).
- Scale gracefully to libraries with 10,000+ people and 25+ years of photos.
- Keep the Photos timeline as the primary visual — the filter sheet layers over it, not replaces it.
- Minimise upstream-rebase conflict exposure (Gallery's mobile search is already fork-divergent; replacing it outright keeps the rebase story clean).

## 3. Non-goals

- Spaces tab filtering (Phase 3).
- Sort controls inside the sheet (stays in the existing app-bar overflow for now).
- Filter state persistence across app restarts.
- Custom aesthetic tokens (Phase 1 uses existing Material 3 theme; the mockup's "darkroom warmth" palette is aspirational and should not block shipping).
- Spaces-scoped filtering on Photos tab (main library only).
- **Phase 1 long-tail discovery for Tags and Places.** Tags and Places overflow pickers are a Phase 2 deliverable. In Phase 1, libraries with more than the per-section cap (~200 items — §8) of tags or places can only reach the long tail via smart-text search (e.g., typing the tag name or city name into the search bar). The "Search N →" affordances in Deep for Tags and Places are hidden until Phase 2. Acceptable limitation; re-evaluated at Phase 2 scoping.

## 4. Design decisions (locked)

Decisions confirmed during brainstorming:

1. **Option B wins on placement** — the sheet lives on the Photos tab. The Search tab is retired. Bottom nav reduces from 4 to 3 (Photos · Spaces · Library).
2. **Three snap states** — Peek (~15% of screen), Browse (~62%), Deep (full screen under status bar). Users drag between snaps.
3. **Top-in-sheet, long-tail-in-picker** — the sheet shows the top-N items per dimension. Everything past that lives in a dedicated full-screen picker reached via "Search →" affordances.
4. **Text search is a filter** — pinned at the top of the sheet in Browse/Deep; combines smart (CLIP) and lexical (filename/OCR/description) search as today.
5. **Dynamic (context-aware) counts are in Phase 1** — mobile calls the unified filter-suggestions endpoint already shipped for web (PRs #250/#251). No new server endpoints needed.
6. **Phase 1 overflow pickers: People and When only** — Tags and Places ship in Phase 2 and reuse the same picker component.
7. **Filter semantics are live, not staged.** Every selection immediately updates suggestions, counts, and the timeline behind the scrim (debounced — see §6.5). There is no "Apply" button; the sheet close is dismissal, not commit. The mockup's bottom-of-Deep CTA is a **Done** button that closes the sheet.
8. **Camera filter deferred to Phase 2** _(accepted 2026-04-17)._ Current mobile search supports Camera (make/model cascade) but the mockup doesn't show it. Phase 1 ships without Camera to match the mockup and keep MVP lean; Phase 2 re-introduces it as a Deep-only section matching the Places cascade shape. This is a time-boxed, acknowledged regression from today's Search tab behaviour.
9. **Phase 1 text-search is single-mode** — no user-visible toggle between smart-context / filename / OCR / description modes. Phase 1 routes the query through the existing smart (CLIP) endpoint only; lexical-mode fallbacks are a follow-up. The existing `SearchFilter.context`-style field is used; other text-mode fields on the model remain untouched. If QA finds smart-only coverage insufficient (e.g., users searching by filename like "IMG_2847"), a mode toggle is added in Phase 1.5.

## 5. UX

See the [HTML mockup](./mockups/2026-04-17-mobile-filter-sheet.html) for visual reference. Summary below.

### 5.1 Entry points

Two entry points work together:

- **A dedicated filter icon is added to the Photos app bar** — always visible, distinct from the existing sort/overflow icon. Tap opens the sheet at Browse. A dot indicator on the icon signals that filters are active. The mockup shows a single icon in the app bar; the real implementation adds a second (filter) icon alongside it.
- **Peek rail** — automatically shown above the bottom nav when at least one filter is active. Displays active-filter chips and the live match count. Tap or drag up to expand to Browse.

When no filters are active, the Peek rail is hidden and the app-bar filter icon is the only entry.

### 5.2 Snap states

- **Peek** — `~15%` screen. Chiprail (active filters, horizontally scrollable) + match count. Dismissable by swipe-down; re-summonable by app-bar icon.
- **Browse** — `~62%` screen. Text-search pill, then four horizontal strips in deliberate order: **People** (circular thumbs) → **Places** (tile with country/count overlay) → **Tags** (pill chips with counts) → **When** (quick-pick pills: Today / This week / year / Custom…). The order mirrors the signal-density of filters in a personal library: People is the most-used and most-reliably-indexed dimension (face recognition returns high-confidence matches); Places is second because photo memories are place-anchored; Tags is third (smaller per-photo cardinality); When is last because the chronological Timeline already answers most temporal questions without a filter. Scrim dims the timeline behind.
- **Deep** — full screen under status bar. All sections expanded and searchable. Layout top-to-bottom: text search, People grid, Places cascade (country → city), Tags pill wrap, When year accordion, Rating stars, Media segmented control, toggles (Favourites / Archived / Not-in-album). Pinned at the bottom: a **Done bar** showing the live count; tapping it dismisses the sheet. Filters apply live as selections change (§6.5) — this CTA is a close affordance, not a commit.

### 5.3 Overflow pickers (Phase 1)

Reached via "Search 10,247 →" (People) and "26 years →" (When) affordances on their Deep section headers. Pushed as routes over the sheet (not replacing it). Dismissing returns to the exact Deep scroll position with chips updated and timeline behind already reflowing.

- **People picker** — sticky search bar with live match count, selected chips pinned below search, Recent strip (last 7 days), alpha-grouped virtualized list, A–Z scrubber on right edge. Row content: thumb + name + photo count + recency metadata.
- **When picker** — sticky search accepting year / month / decade tokens; quick-ranges row (Today / Week / Month / Year / Custom…); decade anchor chips (2000s / 2010s / 2020s — only populated decades); full year accordion below with inline month grids; pinned footer showing current selection + small Apply button.

### 5.4 Overflow pickers (Phase 2)

Same component shape as Phase 1 pickers, swapping row templates:

- **Tags picker** — auto-classified category chips at top, coloured-swatch alpha list below, A–Z scrubber, source badge per row (USER / AUTO / YEARLY / PET).
- **Places picker** — segmented control (Countries / Cities / All), "Most photographed" strip at top, flag rows with city + country + count, A–Z scrubber. The country→city cascade in the Phase 1 Deep section (§5.2) remains in place; the overflow picker is the long-tail fallback for libraries with thousands of places.

### 5.5 Active filter chips

Shown in the Peek rail at all times when filters are set. Each chip carries:

- A leading icon or thumbnail group (up to 3 overlapping avatars for People, a coloured dot for Tags, a flag for Places, mono text for When).
- A label ("Emma, Lars +1", "Paris", "★ 4 & up", "NOV 2024").
- A trailing × to remove.

Removing the last chip auto-collapses the Peek rail (no filter, nothing to show).

## 6. Architecture

### 6.1 Navigation

- Current routes in `mobile/lib/routing/router.dart`:
  - `MainRoute` (tab shell) → `MainTimelineRoute`, `DriftSearchRoute`, `SpacesRoute`, `DriftLibraryRoute`
- **Changes:**
  - Remove `DriftSearchRoute` from the tab shell.
  - Delete the `Search` tab item from `mobile/lib/pages/common/tab_shell.page.dart` (tab count 4 → 3).
  - Add new routes: `PersonPickerRoute`, `WhenPickerRoute` (pushed as full-screen modal routes). Phase 2 adds `TagPickerRoute`, `PlacePickerRoute`, `CameraPickerRoute` if needed.
  - No `DriftSearchRoute` redirect shim is added — the route is fork-only with no external deep-links (YAGNI). If a user hot-reloads an app with the old route in its backstack, auto_route's `defaultRoute` fallback sends them to `MainTimelineRoute` (verified in PR 1.4 manual QA).

### 6.2 Widget hierarchy

**Peek, Browse, and Deep are snap states of a single `FilterSheet`**, not three independent widgets. The sheet's visibility is gated on `photosFilterSheetProvider`: when the state is `hidden`, the sheet is not mounted. When the state is `peek | browse | deep`, the sheet is mounted and animates between snaps. `peek` is auto-set by the notifier whenever a user adds the first filter from a `hidden` state — users never have to summon Peek explicitly.

```
MainTimelinePage (existing, gains FilterSheet overlay)
├── Timeline (existing, now reactive to photosTimelineQueryProvider)
├── PhotosAppBar (existing, gains FilterIconButton with active-indicator dot)
└── FilterSheet (DraggableScrollableSheet or custom ModalBottomSheet)
    ├── PeekState (rendered at ~15% snap)
    │   ├── ActiveFilterChipsRail
    │   └── MatchCountBar
    ├── BrowseState (rendered at ~62% snap)
    │   ├── SearchBar
    │   ├── PeopleStrip
    │   ├── PlacesStrip
    │   ├── TagsStrip
    │   ├── WhenStrip
    │   └── MatchCountFooter
    └── DeepState (rendered at full-screen snap)
        ├── DeepHeader (Close · Title · Reset)
        ├── SearchBar
        ├── PeopleSectionDeep (with "Search →" → PersonPickerRoute)
        ├── PlacesCascade (country + city)
        ├── TagsSectionDeep
        ├── WhenAccordion (with "→" → WhenPickerRoute)
        ├── RatingStarsSection
        ├── MediaTypeSegmented
        ├── TogglesList (Favourites · Archived · Not in album)
        └── DoneBar (pinned, shows live count; taps dismiss the sheet)

Routes (pushed full-screen over the sheet):
├── PersonPickerPage
│   ├── PickerHeader (Back · Title · Done)
│   ├── StickySearchBar
│   ├── SelectedChipsRow
│   ├── RecentPeopleStrip
│   ├── AlphaGroupedPeopleList
│   └── AlphaScrubber
└── WhenPickerPage
    ├── PickerHeader
    ├── StickySearchBar
    ├── QuickRangesRow
    ├── DecadeAnchorStrip
    ├── YearAccordionScrollable
    └── SelectionFooter
```

**Snap-state transition rules:**

- `hidden` → `peek`: automatic when the user adds the first filter (via app-bar icon tap sets `browse`, not `peek` — `peek` is reserved for "filters active + user dismissed sheet").
- `hidden` → `browse`: tap on the app-bar filter icon.
- `peek` → `browse`: drag up, or tap the peek rail.
- `browse` → `deep`: drag up.
- `deep` → `browse`: drag down, or tap Close in DeepHeader.
- `browse` → `peek`: drag down (when filters are active).
- `browse` → `hidden`: drag down (when filters are empty), or explicit "×" tap.
- `deep`/`browse` → `hidden`: tap DoneBar; tap Close; Android system back.
- `peek` → `hidden`: swipe down on the rail.

### 6.3 State management (Riverpod)

The **existing `SearchFilter` model** (`mobile/lib/models/search/search_filter.model.dart`) is kept as the state model. No `PhotosFilter` rename and no adapter layer — the UI reads and writes `SearchFilter` directly, and the existing paginated search provider already consumes it. Camera fields on the model stay put (unused by Phase 1 UI; re-surfaced in Phase 2).

New providers under `mobile/lib/providers/photos_filter/`:

- **`photosFilterProvider`** — `NotifierProvider<PhotosFilterNotifier, SearchFilter>`. Owns the in-memory filter state.
  - Naming conventions: `toggle*` for set-membership dimensions (people, tags) — idempotent add/remove; `set*` for single-slot dimensions (location, date range, rating, media type, text) — passing `null` or an empty value clears; explicit boolean setters for flags (favourites, archived, not-in-album); `clearDimension(Dimension)` to wipe one dimension without resetting the whole filter; `removeChip(ChipId)` as the generic chiprail adapter; `reset()` for a full clear.
  - Full surface:
    - `togglePerson(String personId)` · `toggleTag(String tagId)`
    - `clearPeople()` · `clearTags()`
    - `setLocation(SearchLocationFilter? location)` — `null` clears
    - `setDateRange({DateTime? start, DateTime? end})` — both null clears
    - `setRating(int? stars)` — `null` clears
    - `setMediaType(AssetType? type)` — `null` means "all media"
    - `setFavouritesOnly(bool)` · `setArchivedIncluded(bool)` · `setNotInAlbum(bool)`
    - `setText(String text)` — empty string clears
    - `clearDimension(Dimension d)` · `removeChip(ChipId id)` · `reset()`
- **`photosFilterSuggestionsProvider`** — `FutureProvider.autoDispose.family<FilterSuggestions, SearchFilter>`. Calls the unified suggestions endpoint with the current filter. Debounced 250ms via a wrapper (see §6.5).
- **`photosFilterCountProvider`** — `FutureProvider.autoDispose<int>`. Derived from `photosFilterProvider`; returns the total match count, used by the Peek rail, the sheet-handle count, and the Done bar.
- **`photosFilterSheetProvider`** — `StateProvider<FilterSheetSnap>` (enum: `hidden | peek | browse | deep`). Top-level provider read by the app-bar filter icon, the peek rail, the sheet body, and the picker routes; written by the sheet's drag-end callback, the app-bar icon tap, and explicit Close / Done handlers.

Existing providers addressed:

- `mobile/lib/providers/search/paginated_search.provider.dart` — legacy `StateNotifier` variant, unused by the new Photos-tab wiring. Deleted as part of the Phase 1 Search-tab retirement PR.
- `mobile/lib/presentation/pages/search/paginated_search.provider.dart` — newer `searchPreFilterProvider` scoped to the Search page. Deleted with the Search page itself.
- `mobile/lib/providers/search/search_filter.provider.dart` — an older `SearchFilterProvider`. Audit during Phase 1.1 (state infra PR) to confirm no non-search callers; delete if none.
- `mobile/lib/providers/search/search_page_state.provider.dart`, `search_input_focus.provider.dart` — retire with the Search page.
- `mobile/lib/providers/search/people.provider.dart`, `all_motion_photos.provider.dart`, `recently_taken_asset.provider.dart` — keep; used outside the Search page.

### 6.4 Backend integration

No new server endpoints. No SQL regeneration (we consume an existing endpoint; no decorated repositories change). Work is:

1. **Dart OpenAPI regen** to expose the unified filter-suggestions endpoint (already shipped server-side in PR #250). Procedure per `CLAUDE.md`:
   - `cd server && pnpm build`
   - `pnpm sync:open-api`
   - `make open-api-dart` (Java required — see `feedback_openapi_dart_generation`)
   - Verify `mobile/openapi/lib/api/search_api.dart` now contains the filter-suggestions operation.
   - Never hand-format `.g.dart` files — they are Isar-generated binary artefacts.
2. Timeline data continues to flow through existing server endpoints. No server changes for Phase 1, with one caveat resolved in PR 1.1 (§7 orphan-id reconciliation — `stillExists`-style selected-id echo from the suggestions endpoint, or a new lightweight validation endpoint if the existing response doesn't carry it).

### 6.4.1 Timeline query path — empty vs non-empty filter

The Photos-tab Timeline has two distinct query paths, switched by whether the current `SearchFilter` is empty:

- **Empty filter** (`SearchFilter.isEmpty == true`): the Timeline uses the existing **chronological library service** (`mobile/lib/services/timeline.service.dart` + its paginated provider). Default behaviour, unchanged. No search endpoint is called. Users who never interact with the sheet see exactly today's Photos tab.
- **Non-empty filter** (one or more dimensions set or a text query): the Timeline switches to the **metadata-search endpoint** via `mobile/lib/services/search.service.dart`. This is the same endpoint the current Search tab uses today. The filter is passed verbatim.

**Who owns the switch.** A new `photosTimelineQueryProvider` (under `mobile/lib/providers/photos_filter/`) watches `photosFilterProvider` and exposes a single paginated asset stream. Internally it branches on `isEmpty`; consumers (the Timeline widget) see one unified provider.

**Transition semantics.** When the filter changes from empty → non-empty, the chronological subscription is cancelled and the search subscription starts (debounced 500 ms per §6.5). When it changes from non-empty → empty (e.g., last chip removed), the reverse happens and the Timeline returns to chronological. The 500 ms debounce applies to both directions to avoid flicker when the user quickly adds and removes a filter.

**Page invalidation.** Whichever subscription is active, page invalidation is triggered by a cheap `ref.invalidateSelf()` on the timeline query provider when the `SearchFilter` changes (after debounce). Existing pagination state is dropped on transition — a filter swap is semantically a new query.

### 6.5 Data flow

Filters apply live. There is no commit step — the Done button on the Deep state is a sheet-dismissal affordance only.

```
User taps a filter chip / thumb / cascade row
  → PhotosFilterNotifier.toggleX()
  → SearchFilter state emits new value
  ├─→ photosFilterSuggestionsProvider refetches (debounced 250ms)
  │     → new suggestions shape strip contents + overflow picker counts
  ├─→ photosFilterCountProvider refetches (debounced 250ms, same trigger)
  │     → live count updates on sheet handle, Done bar, Peek match bar
  └─→ Timeline paginated search invalidates (debounced 500ms)
        → grid behind reflows

User taps "Search 10,247 →" in People section
  → PersonPickerRoute.push() (filter state read from provider, not arg)
  → user types in search → debounced filtered list (250ms)
  → user taps a row → photosFilterProvider.togglePerson → live refetch as above
  → user taps Done → Navigator.pop() → sheet resumes
```

**Scroll-position retention** on picker pop back to the Deep sheet uses a `PageStorageKey` on the Deep state's scroll view. auto_route does not preserve this automatically for full-screen pushed routes; the storage key is the idiomatic Flutter fix.

**Debounce rationale:**

- 250 ms for suggestions + count — keeps the sheet's strips/pickers/counts feeling instant during deliberate tapping while coalescing rapid edits.
- 500 ms for the timeline refetch — the timeline is behind the scrim and expensive; users don't need it updating on every tap.

## 7. Error handling & edge cases

- **Suggestions fetch failure (network / server):** strips and overflow lists show a subtle "Couldn't load suggestions — tap to retry" state, keyed to the affected section. The rest of the sheet remains usable. If cached suggestions exist from a prior call with the same filter, show those with an "Offline" badge.
- **Count fetch failure:** count label hidden for that cycle; no user-facing error — the filter still applies correctly.
- **Timeline reflow failure:** existing Timeline error widgets remain. The filter sheet does not block on timeline errors.
- **Thumbnail failures (people, places):** fall back to initials circle for people, generic photo glyph for places.
- **Empty filter result (zero matches):** timeline shows a centered "No photos match this filter" with a prominent "Clear filters" CTA. The sheet Peek rail still shows active chips.
- **Picker search with zero matches:** "No results for 'xyz'" with a "Clear search" CTA inside the picker.
- **Large selections (e.g., 50 people selected):** active chip collapses to "Emma, Lars +48". Tap expands a spillover modal listing all.
- **Empty library / brand-new account:** the filter icon in the app bar is visible but has no active state; tapping shows the sheet with all sections empty and a gentle caption ("Filters appear as you upload photos"). No dynamic-suggestions call is made.
- **Filter references something deleted.** A person merged into another, a tag deleted by the user, a location whose last photo was removed, or a legacy person id the server no longer recognises. Reconciliation **cannot** rely on "id is absent from the suggestions response" as a deletion signal — the suggestions endpoint returns a bounded top-N slice (§8), so a legitimately selected person outside the top-N would be absent for pagination reasons, not deletion, and dropping their id would spuriously remove a valid filter.
  - **Strategy:** the unified filter-suggestions endpoint echoes back the status of every currently-selected id (web FilterPanel's reconciliation behaviour — verify during PR 1.1 OpenAPI audit). If the field is already present, mobile consumes it. If it is not, add a small `/search/validate-selection` server endpoint (accepts ids by dimension, returns the subset that still exists) — this is a pre-Phase-1 design-blocker called out in §11.1.
  - **Timing:** reconciliation happens inline with each suggestions fetch (no separate call). The notifier filters dropped ids out of `SearchFilter`, counts them, and surfaces one SnackBar per reconcile event ("2 filters no longer match — removed") via `mobile/lib/providers/snackbar.provider.dart` (verify the exact provider name in PR 1.1). No error state; the filter continues with the remaining valid ids.
  - **Phase 1 deferral (post-audit, 2026-04-17).** The PR 1.1 OpenAPI audit confirmed `FilterSuggestionsResponseDto` has no `stillExists` / selected-id echo field, and `FilterSuggestionsPersonDto` / `FilterSuggestionsTagDto` carry only `id` + `name`/`value`. Phase 1 therefore **defers proactive orphan reconciliation to Phase 1.5** — it ships without auto-removal of deleted-id chips; a timeline returning zero matches is the user's cue to clear. Revisit Phase 1.5 pending a server `stillExists` echo on the suggestions endpoint or a new `/search/validate-selection` endpoint.
- **Offline / airplane mode.** Suggestions and count providers fail fast; the sheet shows the "Offline" badge described above. The **Done bar** remains tappable because it is a dismissal, not a network call. The timeline behind continues to display cached results (existing behaviour). Filter chips still add/remove locally — no server round-trip is required to manipulate state — but the impact on the timeline is deferred until connectivity returns. Orphan reconciliation is skipped while offline; runs on the next successful suggestions fetch.
- **Shared-space-only photos.** Phase 1 scopes the sheet to the Photos tab, which already excludes shared-space-only content via the existing timeline query. No additional scoping logic is needed. The design is explicitly main-library-only; Spaces filtering is Phase 3.
- **Very small library (e.g., 1 named person, 3 tags, 12 photos).** Strips render whatever they have; a strip with 1 thumb is not padded or hidden. Section headers show real small numbers (e.g., "Search 3 →"). The overflow-picker affordance is **always shown** regardless of cardinality — even for 3 people a user may want to type-search rather than scroll, and the picker handles tiny lists gracefully (§5.3, §5.4). If a dimension has zero items (e.g., 0 tags), the Browse strip is hidden entirely for that dimension; the Deep section shows a one-line empty state ("No tags yet — tap a photo to add one").
- **Diacritics & non-Latin names in the A–Z scrubber.** The pre-computed index buckets names by ASCII-folded first letter, so "Ångström" and "Østergaard" bucket under A and O. Names with no Latin first letter (e.g., 中村) bucket under a trailing "#" group at the end of the scrubber. Tested against the current mobile locale set.
- **Timeline still loading on first sheet open.** If a user opens the sheet during initial Timeline load (e.g., cold start + immediate tap on the filter icon), the grid behind is a skeleton. The scrim dims the skeleton; the Peek rail shows `—` in the match-count slot (not `0`) until the first count response lands. After first response the rail shows the live count as normal.
- **Tab switch preserves sheet state.** Leaving the Photos tab (e.g., user taps Spaces) keeps `photosFilterProvider` alive (it's top-level). Returning to Photos restores the same filter state and the same last-seen sheet snap (via `photosFilterSheetProvider`). This is intentional, not incidental — and is tested. If the user explicitly closes the sheet to `hidden` before leaving, it stays `hidden` on return.
- **Cold-start policy.** On a fresh app launch `photosFilterProvider` initialises to the empty `SearchFilter` and `photosFilterSheetProvider` to `hidden`. Phase 1 has no restart persistence (§3); Phase 3 may add it.
- **Rapid double-tap on the same chip / thumb.** Toggling on then off within <250 ms coalesces into a single "no-op" via the debounce on the suggestions call — no network round-trip is made. The notifier itself applies the toggles synchronously; if the net change is zero, the derived providers see no state change and do not refetch. Tested in §9.
- **Search input focus lost during sheet drag.** When the user drags the sheet to a smaller snap while the text field holds focus, the keyboard dismisses and the text field blurs. The search query is preserved in state; re-focusing resumes. Specific case: dragging Deep → Browse does not re-layout the search bar (it remains a child of the sheet). Dragging Browse → Peek fully hides the search bar along with the rest of the sheet content; the query is retained.
- **Landscape orientation.** Phase 1 supports landscape as an existing app requirement, but the overflow pickers in landscape put the A–Z scrubber under a finger-close-to-edge constraint. The scrubber auto-hides in landscape (width < 480 pt) and the picker falls back to the sticky search bar + inertial scroll. Explicitly tested.
- **Rapid picker-to-picker navigation.** User opens People picker, dismisses, opens When picker within a few seconds. Each picker is a separate route push; route stack stays flat (never stacks picker-over-picker). The sheet remains at the Deep snap behind both pickers. Back from When picker lands on the sheet at Deep, not on the People picker.
- **Filter icon tap when Peek rail is already visible.** Tapping the filter icon always opens the sheet at **Browse**, regardless of whether Peek is currently showing. Dragging up from Peek lands at Browse too. There is only one way to reach Deep: drag up from Browse, or tap a section's "Search →" affordance which pushes a picker (not the Deep snap).
- **Browse strip horizontal scroll position** is not preserved across sheet dismissals in Phase 1. A user who scrolled the People strip to the far right, dismissed the sheet, and re-summoned it will see the strip start at position 0 again. This keeps the Browse state idempotent and avoids scroll-position bookkeeping for four independent strips. Phase 2 reconsiders if users request it. (Suggestions content is re-fetched between sessions anyway, so a "restore last scroll" behaviour could surface stale offsets.)
- **Emoji / long / mixed-script names.** Strip thumb captions and list rows truncate with an ellipsis after a dimension-specific max width (name strip: 58 pt; list row: 200 pt). Emoji in tag names bucket into the trailing "#" scrubber group with other non-Latin entries. Very-long names (20+ chars) render truncated; the full name is exposed to screen readers and surfaces on long-press.
- **Small-phone app-bar density.** On ≤360 pt viewports the filter icon may overlap other app-bar actions. Mitigation: the existing overflow (`⋯`) menu absorbs lower-priority actions first; the filter icon stays in the fixed slot. Verified in manual QA at 360 pt width.
- **App lifecycle — background / foreground.** Putting the app in the background while the sheet is at Deep preserves `photosFilterProvider`, `photosFilterSheetProvider`, and the Deep `PageStorageKey`. On foreground the sheet re-renders at the same snap with the same scroll offset; suggestions re-fetch if the last response is older than 60 seconds (cache invalidation is time-based on the `autoDispose.family` provider). No explicit app-lifecycle observer is added.
- **Split-screen / multi-window (Android).** The sheet's `DraggableScrollableSheet` sizes from the available viewport — in half-screen mode snap heights are computed from the reduced height. No special-case logic; verified in manual QA. Overflow pickers in narrow split-screen behave as in landscape: A–Z scrubber auto-hides (width < 480 pt).

## 8. Performance

- **Debounce filter-change → suggestions call** at 250 ms; debounce filter-change → timeline refetch at 500 ms. Keeps the sheet responsive without stampeding the server.
- **Virtualised lists everywhere** (`ListView.builder`). The overflow People picker is expected to handle 10,000+ rows.
- **Suggestions endpoint returns a bounded set per section** — roughly 20 items for Browse strips and up to ~200 items for Deep grids (exact caps to be confirmed in PR 1.1 OpenAPI audit). Counts-per-item are always included. Anything past the per-section cap lives exclusively in the overflow picker.
- **Pagination handoff between sheet and picker.** The overflow pickers do **not** receive the ~200-item suggestion slice as a prop. They call their own paginated picker endpoint (parametrised by dimension + search-text + current `SearchFilter` for context-awareness) and fetch pages as the user scrolls. This keeps the sheet payload small and lets the picker reach beyond the sheet's cap.
- **Thumbnails** reuse the existing mobile thumbnail cache (exact layer to be confirmed in PR 1.1 — likely `mobile/lib/providers/infrastructure/image_loader.provider.dart` or an adjacent module; CLAUDE.md names Isar as the local DB but the thumbnail caching layer is separate). No new caching layer is introduced.
- **Alpha scrubber:** pre-compute the letter → first-index map once per suggestion batch; scrubber drags issue a single `jumpTo` into the virtualised list. The scrubber renders a floating "letter preview" bubble on drag (48×48 overlay showing the current letter) — without this, the 11-px-per-letter active bands on short-screen devices produce the "mostly thumbs on wrong letter" UX. Handling for diacritics and non-Latin names is covered in §7.
- **Sheet animations** use Flutter's native `DraggableScrollableController`; no custom physics in Phase 1. The spike PR 1.0 outcome decides whether this holds up with an embedded focused `TextField`.

## 9. Testing

Patrol-based e2e is out-of-scope (memory `project_play_store_publishing.md` — patrol was removed from the project). Coverage rests on unit + widget tests (`flutter_test` + `ProviderScope` overrides) plus a manual QA checklist per sub-PR.

### 9.1 Unit tests

**`PhotosFilterNotifier`** — one test per public method and per chip-type round-trip:

- `togglePerson` / `toggleTag` — idempotent add/remove semantics.
- `clearPeople` / `clearTags` — wipe single dimension without touching others.
- `setLocation(null)` / `setDateRange(null, null)` / `setRating(null)` / `setMediaType(null)` / `setText('')` — clearing semantics.
- `setFavouritesOnly(true/false)`, `setArchivedIncluded(true/false)`, `setNotInAlbum(true/false)` — each flag toggles independently.
- `clearDimension(d)` for every `Dimension` enum value.
- `removeChip(ChipId)` round-trip — for each chip type (person, tag, location composite, date range, rating, media type, text, toggles), adding then removing via `removeChip` returns to the initial empty state.
- `reset()` from an arbitrary non-empty `SearchFilter` returns the canonical empty value.
- `copyWith` behaviour inherited from `SearchFilter` — one test confirming `SearchFilter.isEmpty` detection matches expectations.

**Suggestions layer:**

- Debounce coalesces: 10 rapid `togglePerson` calls on 10 _different_ ids in <250 ms result in exactly one suggestions fetch with all 10 ids applied.
- Cancellation: a new filter change cancels the in-flight suggestions request (Riverpod `autoDispose` + request-id guard).
- Rapid double-tap on the **same id**: `togglePerson(id)` then `togglePerson(id)` within <250 ms ends in net-zero state change and issues **zero** suggestions calls (the notifier's state-equality check suppresses the emit).

**Orphan-id reconciliation:**

- Response includes `stillExists: false` for a selected person id → notifier drops the id from `SearchFilter` and emits one SnackBar message.
- Response includes `stillExists: false` for two ids (person + tag) → single SnackBar with "2 filters no longer match — removed".
- Response is bounded top-N and a selected id is simply absent (not flagged deleted) → notifier does **not** drop the id (regression test for C2).
- Offline error → no reconciliation is attempted; existing `SearchFilter` preserved.

**Timeline query path (§6.4.1):**

- Empty `SearchFilter` → `photosTimelineQueryProvider` returns a stream bound to the library service.
- Non-empty `SearchFilter` → same provider switches to the search service.
- Empty → non-empty transition cancels library subscription, starts search subscription.
- Non-empty → empty transition does the reverse.
- Both transitions are debounced 500 ms; rapid toggles back to the same side coalesce into no-op.

**Alpha scrubber index:**

- ASCII name: buckets under correct letter.
- Diacritic: "Ångström" → A. "Østergaard" → O. "Čapek" → C.
- Non-Latin: "中村" → "#" bucket.
- Empty list: index map is empty; scrubber renders all letters as muted.
- All-in-one-letter: every name starts with E → scrubber shows E active and A-D, F-Z muted.

**Pagination handoff:**

- Overflow People picker requests page 1 on open → returns first N items.
- Scrolling past page 1 boundary requests page 2 with the same `SearchFilter` context.
- Changing filter inside the picker resets pagination to page 1.

### 9.2 Widget tests

**`FilterPill` / filter app-bar icon:**

- Renders with no dot indicator when `SearchFilter.isEmpty`.
- Renders with a dot indicator when any dimension is set.
- Tapping with `photosFilterSheetProvider == hidden` transitions the sheet to `browse`.
- Tapping with `photosFilterSheetProvider == peek` transitions the sheet to `browse` (per §7 "Filter icon tap when Peek rail is already visible").

**`PeekRail`:**

- Hidden when `SearchFilter.isEmpty` and sheet is `hidden`.
- Shown when `SearchFilter` has any dimension set.
- Chip × removes the corresponding chip from the filter; last-chip removal collapses the rail.
- Horizontal scroll is exercised (30+ chips render correctly with fading edges).
- "+1" spillover chip renders for >3-person People chip; tapping opens the spillover modal listing all.

**`FilterSheet` snap-state transitions:**

- Drag-up from Peek lands at Browse.
- Drag-up from Browse lands at Deep.
- Drag-down from Deep lands at Browse; drag-down from Browse dismisses to Peek (if filters active) or fully hides (if empty).
- `photosFilterSheetProvider` value updates synchronously with each transition.
- Snap-state persists when switching tabs (Photos → Spaces → Photos restores the last snap) per §7.

**`BrowseState`:**

- Strip rendering — one test per dimension (People, Places, Tags, When), verifying suggestions are rendered as expected.
- Tapping a strip thumb toggles the corresponding chip in `SearchFilter`.
- Sheet-handle count updates live when a chip changes.
- "See all →" affordance is always shown regardless of item count (regression test for M2).

**`DeepState`:**

- Section order matches §5.2 (People → Places cascade → Tags → When accordion → Rating → Media → toggles → Done bar).
- **`DeepHeader` Reset** — tapping "Reset" calls `reset()` on the notifier; all chips disappear, Peek auto-hides, sheet stays at Deep (not auto-dismissed), Done bar count updates to the library total.
- **`DeepHeader` Close** — tapping Close dismisses the sheet (`photosFilterSheetProvider` → `hidden` or `peek` if filters active).
- `PlacesCascade` — selecting a country filters the city column; selecting a city applies both.
- `WhenAccordion` — tapping a year expands its months inline; tapping another year collapses the first.
- `RatingStars` — taps set rating (1–5); tapping the current rating clears it.
- `MediaTypeSegmented` — each segment applies the corresponding filter.
- `TogglesList` — each toggle flips its boolean independently.
- `DoneBar` — renders live count; tapping dismisses the sheet (verifies `photosFilterSheetProvider` → `hidden`).
- `PageStorageKey` retention — scrolling Deep to a non-default position, pushing a picker, popping back, asserts scroll offset is retained.

**`SearchBar` (shared between Browse and Deep):**

- Typing a character triggers a debounced `setText` call; sheet-handle count updates after 250 ms.
- Clear × button appears when text is non-empty; tapping × calls `setText('')` and hides the button.
- Return-key press is a no-op beyond keyboard dismissal (filters apply live; there is no submit action).
- Paste clears any in-flight debounce and applies immediately after the 250 ms window.

**`PersonPickerPage`:**

- Sticky search bar: typing filters the list; match count updates.
- Selected chips row: selected people appear as chips below search; tapping × removes them.
- Recent strip: shows last-7-days people.
- A–Z scrubber: tapping a letter jumps the list to that bucket; "letter preview" bubble appears on drag.
- Diacritic name appears in the correct bucket (end-to-end from fixture through widget).
- Done pops the route; `SearchFilter` reflects the final selections.
- Empty-result state: searching for a non-matching query shows "No results for 'xyz'" + "Clear search" CTA.

**`WhenPickerPage`:**

- Typed year "2024" highlights and expands the 2024 row in the accordion.
- Quick-range pills set the filter (Today, This week, This month, This year, Custom range).
- Decade anchor strip shows only populated decades; tapping jumps the accordion.
- Inline month selection applies a month-year filter; deselecting clears.
- Done pops and the match count on Peek updates.

**Empty, loading, error states:**

- Empty library: sheet opens, all sections show empty captions, no suggestions call is made (stubbed provider verifies).
- Slow network: while suggestions are pending, strips render shimmer placeholders; match count shows `—`.
- Suggestions failure: sections render the "Couldn't load suggestions — tap to retry" state; rest of the sheet remains usable; tapping retry re-fetches.
- Offline: "Offline" badge visible on all strips; chips can still be manipulated locally; timeline shows cached results.
- Zero matches: timeline renders "No photos match this filter" + "Clear filters" CTA; tapping clears resets the sheet.
- Timeline loading on first open: sheet opens over the skeleton; Peek match count shows `—` until first response lands.

**Orphan reconciliation (after C2 fix):**

- Suggestions response with `stillExists: false` for one selected person → chip disappears, SnackBar shown.
- Same but two ids → single SnackBar with "2 filters no longer match — removed".
- Bounded-top-N absence without `stillExists: false` → chip remains (regression test).

### 9.3 Integration / golden tests (Phase 1.5, optional)

- Snap-state golden regression (one golden per snap, light + dark).
- Overflow picker golden regression (one golden per picker, light + dark).
- These are opt-in — the team skips them if they add more maintenance cost than value.

### 9.4 Manual QA per sub-PR

Each PR has its own checklist in its description. The Phase 1 aggregate checklist:

- Filter icon visible in the Photos app bar in light and dark themes, with and without active filters.
- Sheet drag gestures smooth on both a newer (≥iOS 17 / Android 14) and an older (iOS 15 / Android 11) device.
- Keyboard interaction with text search does not collapse the sheet or hide the field (PR 1.0 spike should have de-risked this; verify in QA anyway).
- Overflow pickers dismissable with iOS swipe-to-back edge gesture and Android system back.
- Landscape orientation: sheet renders correctly at all three snap states; A–Z scrubber auto-hides as designed (§7).
- Empty-library, slow-network (3G throttling), airplane-mode states behave per §7.
- All user-visible strings appear localised in an installed non-default locale (e.g., `de`, `ja`). No literal `English-only` strings leak through. See §9.5.
- Haptic feedback on chip toggle and scrubber letter crossing.
- No flicker or double-reflow on rapid chip add/remove (regression for debounce).
- Legacy `DriftSearchRoute` in backstack after upgrade redirects to `MainTimelineRoute` without error.
- After PR 1.4: no reference to "Search" tab anywhere in the UI; tab count is 3.

### 9.5 Internationalisation

- Every new user-visible string is added to `mobile/lib/l10n/*.arb` (the existing mobile i18n) before its PR merges. Phase 1 strings (non-exhaustive): "Filter", "Filters", "Search people", "Search places", "Search tags", "Search photos", "Choose people", "Choose tags", "Choose places", "When", "Done", "Reset", "No photos match this filter", "Clear filters", "Filters appear as you upload photos", "No tags yet — tap a photo to add one", "Couldn't load suggestions — tap to retry", "Offline", "Today", "This week", "This month", "This year", "Custom range…", "photos", "photos matched", "%d filters no longer match — removed", counts and numerals via the existing number-format helpers, overflow-affordance strings like "Search %d →".
- Pluralisation uses ICU message format. "1 photo matches" / "%d photos match". "1 filter no longer matches" / "%d filters no longer match".
- RTL layouts: strips flip direction; scrubber auto-hides (short edge on RTL layouts puts the scrubber on the left where a left-handed thumb reaches — tested).
- Numeric grouping follows locale: "1,247" in en / "1 247" in fr / "1.247" in de. Use the existing number formatting.
- Checklist item per PR: no new English-only string literals in changed files (enforced by a light lint if `dart_code_metrics` has the rule, otherwise manual check).

### 9.6 Accessibility

- **Screen reader (TalkBack / VoiceOver)** announces:
  - Filter icon with state ("Filter button, 3 filters active" / "Filter button, no filters").
  - Each active chip with its label and a "Remove filter" hint.
  - Match-count updates ("1,247 photos matched") as live regions, debounced to avoid chatter.
  - Snap-state changes ("Filter panel expanded to full screen").
  - Selection state in pickers ("Emma, selected, 1,184 photos").
- **Large text (Dynamic Type / font scale) 120–200%:** all sheet layouts reflow without clipping; strips use horizontal scroll; the Done bar grows vertically to accommodate larger count text.
- **Reduced motion:** sheet animations respect the reduced-motion setting; drag-snap remains but the continuous spring is replaced with an immediate snap.
- **Contrast:** active-filter chips, the match count, the Done bar CTA, and selection checks all meet WCAG AA against both light and dark themes. Verified with a contrast checker in PR 1.2 and PR 1.3.
- **Tap targets:** minimum 44×44 pt for every interactive element in the sheet. The A–Z scrubber deliberately uses a wider hit area than the visible letters with the "letter preview" bubble (§8).
- **Play Store / App Store accessibility review:** Gallery has a Play Store submission in flight (memory `project_play_store_publishing.md`); all of the above are check-listed ahead of that review rather than after it.

### 9.7 Dark mode & theming

- All new widgets must use the existing Material 3 theme tokens via `Theme.of(context)`; no hardcoded colours in sheet / picker code.
- Every widget test above is paired with a dark-mode variant where rendering differs (toggles, chips, accordions, pickers).
- The mockup's "darkroom warmth" palette is **not** used in Phase 1 code (§3). An aesthetic follow-up may migrate tokens later.

### 9.8 Per-sub-PR acceptance gates

- **PR 1.0 (spike):** keyboard interaction observations documented; a spike outcome appended to §11.4 below. Not merged.
- **PR 1.1 (infra):** unit tests from §9.1 pass; OpenAPI diff reviewed; no UI regressions (no UI changed).
- **PR 1.2 (entry + Browse):** §9.2 `FilterPill`, `PeekRail`, `FilterSheet` (snap states), `BrowseState` widget tests pass; manual QA for icon visibility, gesture smoothness, i18n first pass.
- **PR 1.3 (Deep + pickers):** §9.2 `DeepState`, `PersonPickerPage`, `WhenPickerPage`, `WhenAccordion`, `RatingStars` pass; orphan reconciliation tests pass; manual QA for landscape, large text, screen reader.
- **PR 1.4 (retirement):** regression: no old Search tab; no references to removed providers; backstack migration QA'd.

## 10. Migration plan

### 10.1 File-level impact

No `PhotosFilter` model file is added — we reuse `mobile/lib/models/search/search_filter.model.dart` directly (see §6.3).

**Added:**

- `mobile/lib/presentation/pages/photos/filter_sheet/filter_sheet.dart`
- `mobile/lib/presentation/pages/photos/filter_sheet/peek_rail.dart`
- `mobile/lib/presentation/pages/photos/filter_sheet/browse_state.dart`
- `mobile/lib/presentation/pages/photos/filter_sheet/deep_state.dart`
- `mobile/lib/presentation/pages/photos/filter_sheet/sections/*.dart` (people, places, tags, when, rating, media, toggles — no camera in Phase 1)
- `mobile/lib/presentation/pages/photos/filter_sheet/widgets/*.dart` (strips, chips, search_bar, match_count, done_bar)
- `mobile/lib/presentation/pages/photos/person_picker.page.dart`
- `mobile/lib/presentation/pages/photos/when_picker.page.dart`
- `mobile/lib/providers/photos_filter/photos_filter.provider.dart` — `photosFilterProvider` (the `SearchFilter` notifier)
- `mobile/lib/providers/photos_filter/filter_suggestions.provider.dart` — `photosFilterSuggestionsProvider`
- `mobile/lib/providers/photos_filter/filter_count.provider.dart` — `photosFilterCountProvider`
- `mobile/lib/providers/photos_filter/filter_sheet.provider.dart` — `photosFilterSheetProvider` (snap-state enum)
- `mobile/lib/providers/photos_filter/timeline_query.provider.dart` — `photosTimelineQueryProvider` (empty/non-empty switcher, §6.4.1)

**Modified:**

- `mobile/lib/pages/common/tab_shell.page.dart` — drop Search tab (nav 4 → 3); wire a filter icon button into the Photos app bar.
- `mobile/lib/presentation/pages/dev/main_timeline.page.dart` — host the filter sheet and peek rail; timeline query listens to `photosFilterProvider`.
- `mobile/lib/routing/router.dart` — remove `DriftSearchRoute` from the tab shell; add `PersonPickerRoute` and `WhenPickerRoute`. No deep-link redirect shim (YAGNI — the route is fork-only with no external links).
- `mobile/openapi/**` — regenerated to include the filter-suggestions operation.

**Removed at Phase 1 end (Search-tab retirement PR):**

- `mobile/lib/presentation/pages/search/drift_search.page.dart`
- `mobile/lib/presentation/pages/search/paginated_search.provider.dart` (newer `searchPreFilterProvider`)
- `mobile/lib/providers/search/paginated_search.provider.dart` (legacy `StateNotifier` variant)
- `mobile/lib/providers/search/search_page_state.provider.dart`
- `mobile/lib/providers/search/search_input_focus.provider.dart`
- `mobile/lib/providers/search/search_filter.provider.dart` — delete if audit confirms no non-search callers; otherwise keep.
- Filter bottom-sheet helpers in `mobile/lib/widgets/search/search_filter/` — these are only consumed by `DriftSearchPage` and go with it.

**Retained:**

- `mobile/lib/providers/search/people.provider.dart`, `all_motion_photos.provider.dart`, `recently_taken_asset.provider.dart` — used outside the Search page.
- `mobile/lib/models/search/search_filter.model.dart` — the shared state model.
- `mobile/lib/services/search.service.dart` — timeline paginated search service.

### 10.2 Upstream rebase exposure

The removed `DriftSearchPage` is fork-only. Its associated providers — especially `mobile/lib/providers/search/paginated_search.provider.dart` (legacy `StateNotifier` variant) — may or may not be upstream; PR 1.4 runs `git log upstream/main -- mobile/lib/providers/search/` as a final check before deletion. If any file proves upstream-aligned, it stays (marked as dead code, documented) and is removed in a later upstream-rebase cycle rather than forcing a cross-fork merge. The new Photos-tab host file (`main_timeline.page.dart`) is upstream-aligned — all additions there wrap the existing widget, so rebase conflicts should be small and mechanical.

### 10.3 Release sequencing

A single "Phase 1 PR" was the initial plan but the review flagged ~15 new files + OpenAPI regen + navigation changes as too large for one reviewable unit. Phase 1 is therefore split into **four PRs that land in quick succession**, each independently reviewable and each leaving `main` in a working state.

- **PR 1.0 — Prep / spike (non-shipping).** Prototype the `DraggableScrollableSheet` + focused `TextField` keyboard interaction behind a dev-only route. Goal: confirm the stock Flutter sheet can host the search bar with an acceptable keyboard-open experience, or decide to use a custom `ModalBottomSheet` wrapper. **Lives on branch `spike/mobile-filter-keyboard`, never merged.** A short outcome note is appended to this design as §11.4 before PR 1.2 is opened; PR 1.2's description links to §11.4.
- **PR 1.1 — Infrastructure.** Dart OpenAPI regen (filter-suggestions operation; audit for the selected-id echo / `stillExists` field described in §7 — if absent, add a server validation endpoint in this PR). `photosFilterProvider`, `photosFilterSuggestionsProvider`, `photosFilterCountProvider`, `photosFilterSheetProvider`, `photosTimelineQueryProvider` (§6.4.1 switcher). Unit tests per §9.1. No UI wiring. Generated `.g.dart` + `openapi/**` diff is expected to touch many files — reviewer guidance: skim the non-search-related regenerated files for structural breakage, don't line-by-line review.
- **PR 1.2 — Photos-tab entry + Peek rail + Browse sheet.** Filter icon in the app bar, Peek rail, Browse state with all four strips. No Deep state yet (tapping "Browse more →" cues a "Deep arrives next" empty state or simply routes to the legacy Search tab if it's still present — decide at PR time). Timeline query starts listening to `photosTimelineQueryProvider`. Widget tests per §9.2. Filter icon behaves correctly with an empty filter state (no peek shown). Lands Phase 1 visibly to users.
- **PR 1.3 — Deep state + People picker + When picker.** The largest PR in the series. Deep state with all sections (People grid, Places cascade, Tags pill wrap, When accordion, Rating, Media, toggles, Done bar), the two overflow pickers, route declarations, `PageStorageKey` for Deep scroll retention. Widget tests per §9.2. Search-tab functionality is effectively duplicated after this PR; retirement follows in 1.4.
  - **If PR 1.3 exceeds ~1500 LOC net (excluding generated `.g.dart`),** split into 1.3a (Deep state only), 1.3b (People picker), 1.3c (When picker). Decide at PR-draft time when the diff size is clear.
- **PR 1.4 — Search-tab retirement.** Remove `DriftSearchRoute` from the tab shell, delete `DriftSearchPage` and its dedicated providers (§10.1 removed-list), delete legacy bottom-sheet helpers under `mobile/lib/widgets/search/search_filter/`. Nav collapses from 4 to 3 tabs. Small, mechanical, final.
  - **Mid-upgrade migration.** If a user's app has the Search tab in its backstack (e.g., they were on the Search tab when the update installs, or hot-reloads mid-session), tapping the missing tab must not crash. Mitigation: auto_route's unknown-route fallback points to `MainTimelineRoute`. Verified in PR 1.4 manual QA with a simulated mid-session update.

Phase 1 is considered shipped when PR 1.4 is merged.

- **PR 2.x — Phase 2:** Tags + Places overflow pickers in one or two PRs.
- **PR 3+ — Phase 3:** persistence / sort-in-sheet / spaces integration / Camera re-introduction as separate changes.

## 11. Risks & open questions

### 11.1 Risks

- **Sheet + keyboard interaction is the single biggest unknown.** Flutter's `DraggableScrollableSheet` with a focused `TextField` inside it is a known-bad interaction: the sheet can collapse when the keyboard opens, or the text field can be hidden behind the keyboard. `resizeToAvoidBottomInset` at the Scaffold level fights the sheet's own bottom inset handling. **Mitigation: PR 1.0 (the spike) prototypes this against a realistic Timeline before any sheet widgets land in `main`.** Fallback is a custom `ModalBottomSheet`-based sheet — which is a real rewrite, not a small change. The spike outcome determines which we build; both paths are acceptable, but we must know which before locking PR 1.2 scope.
- **A–Z scrubber gesture** — custom `GestureDetector` with `onPanUpdate` mapping Y-position → letter, emitting haptic feedback and calling `jumpTo` on a virtualised `ListView.builder`. Short-screen devices make the active area cramped (e.g., 26 letters in < 300 px). Handling diacritics and non-Latin names is covered in §7.
- **Dynamic-suggestions response size** — with 10K people and 26 years, the top-N payload must stay reasonable. The server endpoint already enforces a cap for the web; confirm the same cap applies to mobile requests and paginate overflow fetches keyed per section.
- **Dart OpenAPI regen latency** — Java dependency + custom patches per `feedback_openapi_dart_generation`. Plan for this to take iterations; runs contained to PR 1.1.
- **Timeline reflow cost under rapid filter edits** — the 500 ms debounce is the primary defence. If the reflow itself (virtualised grid with thumbnails) janks on lower-end Android devices, add a longer debounce and/or a "sticky" state where the timeline only repaints when the sheet is dismissed. Measured during PR 1.2 QA.

### 11.2 Open questions

- **When picker's typed search syntax** — MVP supports exact year ("2024") and decade ("20s" / "2020s"). Month-year parsing ("nov 2024", "11/2024") is Phase 1.5 if year-only proves insufficient in QA.
- **Filter icon vs persistent pill** — Phase 1 uses the app-bar icon. If usability testing shows users don't discover it, Phase 2 could add a persistent floating pill.
- **Aesthetic tokens** — the mockup's "darkroom warmth" palette isn't a Phase 1 blocker. Phase 1 uses the existing Material 3 theme. A separate design-tokens follow-up considers aesthetic migration.
- **Cameras in Browse strip** — not included even after Phase 2 re-adds the Deep section. If usage data shows cameras are a common filter, add a strip in Phase 3.

### 11.3 Resolved

Decisions previously open that are now baked into §4 Decisions are listed there rather than here.

### 11.4 Spike outcome (filled after PR 1.0)

> _Placeholder. After PR 1.0 completes, append a short decision note:_
>
> - Which implementation was chosen (stock `DraggableScrollableSheet` vs custom `ModalBottomSheet` wrapper).
> - The key quirks observed and how they're handled.
> - Device / OS matrix exercised.
> - Any follow-up work the spike uncovered that affects PR 1.2 scope.

## 12. Appendix

### 12.1 Related web PRs (for reference)

- PR #175 — FilterPanel on /photos page (web) with unit and E2E tests
- PR #250 — Dynamic filter suggestions (unified endpoint, server)
- PR #251 — Interdependent filtering rolled out to Map+Spaces (server + web)
- PR #260 — Cross-filtering space person IDs fix (server)
- PR #274 — Location filter on map view (web)

### 12.2 Existing mobile code to reuse

- `mobile/lib/models/search/search_filter.model.dart` — the `SearchFilter` value class used as Phase 1 state (§6.3).
- `mobile/lib/services/search.service.dart` — paginated metadata-search service. The timeline query path (§6.4.1) calls this when the filter is non-empty.
- `mobile/lib/services/timeline.service.dart` — the chronological library service. The timeline query path calls this when the filter is empty.
- Thumbnail widgets and asset-grid building blocks are reused unchanged.
- `mobile/lib/providers/snackbar.provider.dart` — for orphan-reconciliation SnackBars (§7). Verify exact name in PR 1.1.

### 12.3 Tasks not in this doc

Implementation task breakdown for each sub-PR (1.0 spike · 1.1 infra · 1.2 entry+Browse · 1.3 Deep+pickers · 1.4 retirement) is deferred to the `writing-plans` skill output. The PR split in §10.3 is the unit of work; tasks inside each PR are for the plan.
