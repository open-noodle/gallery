# Mobile Filter Sheet — PR 1.2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the Photos-tab entry point (filter icon in app bar), the Peek rail, the Browse snap of the sheet, and the `photosTimelineQueryProvider` that switches the Photos timeline between the library service (empty filter) and the search service (non-empty filter). Design: [`2026-04-17-mobile-filter-sheet-design.md`](./2026-04-17-mobile-filter-sheet-design.md) §10.3 PR 1.2.

**Architecture:** Thin reactive composition — UI widgets watch `photosFilterProvider` / `photosFilterSheetProvider` / `photosFilterSuggestionsProvider` / `photosFilterCountProvider` (all shipped in PR 1.1) and call notifier methods. The sheet is a single `DraggableScrollableSheet` conditionally mounted in `MainTimelinePage`'s `Stack` overlay; snap-state (peek | browse | deep-stub) is driven through `photosFilterSheetProvider`. `photosTimelineQueryProvider` is a thin branch: empty → existing `timelineServiceProvider`, non-empty → a `TimelineService` built from `TimelineFactory.fromAssetStream` fed by paginated `SearchService.search` calls.

**Tech stack:** Flutter, `hooks_riverpod`, Material 3 theme tokens via `Theme.of(context)`, `flutter_test` + `mocktail`, existing `TimelineFactory` / `TimelineService` infrastructure, `SearchService` for non-empty filter.

**Scope guardrails:**

- **Deep state is a stub.** Browse → Deep drag lands on a placeholder panel saying "Coming in PR 1.3"; no sections, no pickers. Design §5.2 Deep content is PR 1.3.
- **No pickers.** "Search N →" affordances are hidden (Phase 1 per §5.3 ships them only in Deep, which is PR 1.3).
- **No Search-tab retirement.** Bottom nav stays 4 tabs (PR 1.4).
- **No orphan reconciliation.** Deferred to Phase 1.5 per PR 1.1 §7 audit.
- **Camera strip omitted.** Phase 1 decision (§4.8).
- **Aesthetic tokens.** Material 3 defaults only — no darkroom palette (§3).

---

## Landmarks & pre-verified facts

- Worktree: `/home/pierre/dev/gallery/.worktrees/mobile-filter-sheet-ui`. Branch: `feat/mobile-filter-sheet-ui` off `origin/main`.
- Providers shipped in PR 1.1 (available on `main`):
  - `mobile/lib/providers/photos_filter/photos_filter.provider.dart` — `photosFilterProvider` (`NotifierProvider<PhotosFilterNotifier, SearchFilter>`) with the full method surface: `togglePerson(PersonDto)`, `toggleTag(String)`, `setLocation(SearchLocationFilter?)`, `setDateRange({start, end})`, `setRating(int?)`, `setMediaType(AssetType?)`, `setFavouritesOnly/Archived/NotInAlbum(bool)`, `setText(String)`, `clearPeople/Tags()`, `clearDimension(Dimension)`, `removeChip(ChipId)`, `reset()`.
  - `filter_sheet.provider.dart` — `photosFilterSheetProvider` (`StateProvider<FilterSheetSnap>`, enum `hidden | peek | browse | deep`, default `hidden`).
  - `filter_suggestions.provider.dart` — `photosFilterSuggestionsProvider` (`FutureProvider.autoDispose.family<FilterSuggestionsResponseDto, SearchFilter>`).
  - `filter_count.provider.dart` — `photosFilterCountProvider` (`FutureProvider.autoDispose<int>`, placeholder = page-1 result length).
  - `chip_id.dart` — `ChipId` sealed type (PersonChipId/TagChipId/LocationChipId/DateChipId/RatingChipId/MediaTypeChipId/FavouriteChipId/ArchiveChipId/NotInAlbumChipId/TextChipId).
  - `photos_filter.dart` — barrel export.
- Host page: `mobile/lib/presentation/pages/dev/main_timeline.page.dart` — currently a `ConsumerWidget` returning `Timeline(...)`. Will wrap in a `Stack` with sheet + peek rail overlay.
- Timeline: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart` reads `timelineServiceProvider` via a nested `ProviderScope`-like pattern — driven by `TimelineArgs` override. Replumbing for the non-empty filter path uses `TimelineFactory.fromAssetStream`.
- `SearchService` at `mobile/lib/services/search.service.dart:34` — `Future<SearchResult?> search(SearchFilter, int page)` returning `SearchResult{ assets: List<Asset>, ... }`. The legacy `paginated_search.provider.dart` already consumes this for the Search tab.
- i18n lives in `i18n/en.json` (flat key → string). Existing keys: `filter`, `reset`, `done`.
- App bar component: `mobile/lib/widgets/common/immich_sliver_app_bar.dart`. Actions are passed as `List<Widget>?` — filter icon slots in here.
- **Sheet widget choice:** stock `DraggableScrollableSheet` (PR 1.0 §11.4 spike outcome was never filled; stock is the default per design §8 until proven otherwise). If keyboard-with-`TextField` breaks during implementation, document the regression and fall back to a custom `ModalBottomSheet`-based wrapper — blocker, not silent.

---

## Task 1 — `photosTimelineQueryProvider` + non-empty search timeline adapter

**Files:**

- Create: `mobile/lib/providers/photos_filter/timeline_query.provider.dart`
- Create: `mobile/lib/domain/services/photos_filter_timeline.service.dart` (thin wrapper producing a paginated asset stream from `SearchService`)
- Test: `mobile/test/providers/photos_filter/timeline_query_provider_test.dart`

**Behaviour:**

- Watches `photosFilterProvider`.
- If `state.isEmpty`: returns the existing `timelineServiceProvider` instance (unchanged chronological behaviour).
- If non-empty: builds a `TimelineService` via `TimelineFactory.fromAssetStream` whose asset stream is driven by a paginated `SearchService.search(filter, pageN)` loop (initial page 1 loaded eagerly; subsequent pages triggered by the asset-count stream signalling "more needed").
- Debounce on state transitions (empty ↔ non-empty and filter edits while non-empty): 500 ms. Use a `Timer` wrapper in the provider.
- `ref.onDispose` disposes the adapter's `StreamController`.

**Tests:**

- Empty filter → provider exposes main library `TimelineService` (verify via injected `TimelineFactory` mock).
- Non-empty filter → provider calls `SearchService.search(filter, 1)` and feeds results into the adapter.
- Filter change while non-empty: 500ms debounce coalesces rapid toggles, issues single search call.
- Empty → non-empty transition cancels library subscription, starts search subscription.
- Non-empty → empty transition reverses.

**Commit:** `feat(mobile): photosTimelineQueryProvider with empty/non-empty switcher`

---

## Task 2 — `FilterIconButton` (Photos app-bar entry)

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/filter_icon_button.widget.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/filter_icon_button_test.dart`

**Behaviour:**

- `ConsumerWidget` rendering `IconButton` with `Icons.tune_rounded` (or equivalent per app conventions).
- Active-indicator dot: a small accent-coloured dot in the top-right corner of the icon rendered iff `photosFilterProvider` is non-empty (`!state.isEmpty`). Use `Stack` + `Positioned`.
- `onTap`: sets `photosFilterSheetProvider.state = FilterSheetSnap.browse` (regardless of current snap — §7 "Filter icon tap when Peek rail is already visible").
- Semantics label: "Filter" (empty state) / "Filter, active" (non-empty) — i18n keys `filter_button` + `filter_button_active`.

**Tests:**

- Renders without dot when filter empty.
- Renders with dot when filter has any dimension set (parameterised over: person, tag, location, date, rating, media type, favourites, archive, not-in-album, text).
- Tap sets sheet provider to `browse` from `hidden`, `peek`, and `browse` (idempotent for already-browse).
- Semantics label updates with state.

**Commit:** `feat(mobile): FilterIconButton with active-indicator dot`

---

## Task 3 — `ActiveFilterChip` + `PeekRail`

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/peek_rail.widget.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/active_filter_chip_test.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/peek_rail_test.dart`
- Helper: `mobile/lib/providers/photos_filter/active_chips.dart` — derives `List<({ChipId id, String label, Widget? leading})>` from a `SearchFilter`.

**Behaviour — `active_chips.dart` helper:**

Pure function `activeChipsFromFilter(SearchFilter)` that returns an ordered list of `(ChipId, label, leading)`:

1. People chips — one per person: label = `p.name ?? 'Unnamed'`; leading = circular avatar (thumbnail URL via existing people-thumbnail utility); spillover compression for > 3 into a single "Emma, Lars +48" chip linked to `PersonChipId` of the first person (simple label truncation for MVP — spillover modal is PR 1.3).
2. Tags — one `TagChipId(tagId)` per tag id; label lookup from last suggestions response (fallback "Tag" if not resolved).
3. Location — single `LocationChipId()`; label composed from non-null fields: country / state / city (joined by "·").
4. Date — single `DateChipId()`; label formatted short month-year range or single month.
5. Rating — single `RatingChipId()`; label `"★ ${rating}+"`.
6. MediaType — single `MediaTypeChipId()`; label = `"Photos" | "Videos" | "Audio"`.
7. Favourites — `FavouriteChipId()`; label "Favourites".
8. Archived — `ArchiveChipId()`; label "Archived".
9. Not-in-album — `NotInAlbumChipId()`; label "Not in album".
10. Text — `TextChipId()`; label = `'"$text"'`.

Helper takes optional `FilterSuggestionsResponseDto?` for tag/person name resolution.

**Behaviour — `ActiveFilterChip`:**

- Displays leading widget (optional) + label + trailing `×`.
- `×` tap calls `photosFilterProvider.notifier.removeChip(id)`.
- Semantics: `"$label, remove filter"`.

**Behaviour — `PeekRail`:**

- `ConsumerWidget`; hidden (returns `SizedBox.shrink()`) when `SearchFilter.isEmpty && photosFilterSheetProvider != peek`.
- Mounted at fixed height (60 pt) above the bottom nav, wrapped in a `Material` with elevation.
- Horizontal `ListView` of `ActiveFilterChip`s from `activeChipsFromFilter(filter, suggestions)`.
- Trailing match count label from `photosFilterCountProvider` (shows `—` while loading or on error, `${count}` on success).
- Tap on the rail (outside any chip) sets `photosFilterSheetProvider.state = browse`.
- Swipe down gesture: sets sheet to `hidden`.

**Tests:**

- `activeChipsFromFilter` unit tests: one per dimension, combination test (people + tag + location → three chips in order), empty filter → empty list, people spillover (>3).
- `ActiveFilterChip` widget: renders label + leading + ×; tapping × calls `removeChip` on the notifier (verified via `ProviderScope` override + listener mock).
- `PeekRail` widget: hidden when empty + not peek; shown when non-empty; chips render in correct order; match count updates on `photosFilterCountProvider` change; count shows `—` on `AsyncError`; tap on rail body sets provider to `browse`.

**Commits:**

- `feat(mobile): activeChipsFromFilter helper`
- `feat(mobile): ActiveFilterChip widget`
- `feat(mobile): PeekRail widget`

---

## Task 4 — `FilterSheet` shell + `BrowseState` scaffold

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/filter_sheet.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/browse_state.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/search_bar.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/match_count_footer.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/deep_state_stub.widget.dart`
- Tests: `mobile/test/presentation/widgets/filter_sheet/filter_sheet_test.dart`
- Tests: `mobile/test/presentation/widgets/filter_sheet/browse_state_test.dart`
- Tests: `mobile/test/presentation/widgets/filter_sheet/search_bar_test.dart`

**Behaviour — `FilterSheet`:**

- `ConsumerWidget`. Reads `photosFilterSheetProvider`. If `hidden`, returns `SizedBox.shrink()` (not mounted). Otherwise returns a `DraggableScrollableSheet` with:
  - `initialChildSize`: `0.15` if snap is `peek`, `0.62` if `browse`, `0.95` if `deep`.
  - `minChildSize` 0.15, `maxChildSize` 0.95.
  - `snap: true`, `snapSizes: const [0.15, 0.62, 0.95]`.
  - `builder`: conditionally renders `PeekStateContent | BrowseState | DeepStateStub` based on snap.
- Listens to `DraggableScrollableController` via `NotificationListener<DraggableScrollableNotification>`; on snap-settle, writes the new enum value back to `photosFilterSheetProvider.state`. Debounce 80 ms during drag to avoid flooding the state write.
- Scrim: a `Positioned.fill(child: ColoredBox(color: black12))` behind the sheet when snap is `browse` or `deep`. Tap dismisses to `peek` if filters active, else `hidden`.

**Behaviour — `BrowseState`:**

- `Column` inside a `ListView` (for drag interaction parity with sheet's scroll controller):
  1. Drag handle (centered pill, 32×4 pt).
  2. `SearchBar` (top, padded).
  3. 4 strip slots: `PeopleStrip`, `PlacesStrip`, `TagsStrip`, `WhenStrip` (from Task 5).
  4. `MatchCountFooter` (bottom): live count + "Done" button that sets sheet to `hidden`.
- Scroll controller is the one provided by `DraggableScrollableSheet.builder`.

**Behaviour — `SearchBar`:**

- `TextField` with controller initialised from `photosFilterProvider.context ?? ''`. On change, debounced 250 ms call to `setText`. Clear `×` icon visible when non-empty; tap calls `setText('')`.

**Behaviour — `MatchCountFooter`:**

- Row: `"${count} photos"` left, `TextButton("Done")` right. Tapping Done sets sheet to `hidden`.

**Behaviour — `DeepStateStub`:**

- A simple centered `Text("Full filters coming in PR 1.3")`. Drag handle at top.

**Tests:**

- `FilterSheet` mount-gating: hidden snap → widget not mounted; any other snap → `DraggableScrollableSheet` present.
- Snap → initialChildSize mapping (3 cases).
- Drag-settle updates provider state (mocked by emitting a `DraggableScrollableNotification`).
- Scrim tap: browse → peek when filters active; browse → hidden when empty.
- `BrowseState` renders SearchBar + 4 strips + footer in order.
- `SearchBar` debounce (uses `FakeAsync` or `pump` with `Duration`s): typing "paris" fires one `setText('paris')` call after 250 ms.
- `SearchBar` clear button calls `setText('')`.
- `MatchCountFooter` count updates on provider; Done button hides sheet.

**Commits:**

- `feat(mobile): FilterSheet scaffold with drag-settle state sync`
- `feat(mobile): BrowseState scaffold`
- `feat(mobile): SearchBar + MatchCountFooter + DeepStateStub`

---

## Task 5 — Browse strips (People / Places / Tags / When)

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/strips/people_strip.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/strips/places_strip.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/strips/tags_strip.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/strips/when_strip.widget.dart`
- Tests: one per strip under `mobile/test/presentation/widgets/filter_sheet/strips/`

**Shared behaviour:**

Each strip is a `ConsumerWidget` that:

1. Watches `photosFilterSuggestionsProvider(filter)` where `filter` = `ref.watch(photosFilterProvider)`.
2. Handles `AsyncValue` states: loading → shimmer row (3 placeholder tiles), error → single "Couldn't load — tap to retry" tile, data → rendered list.
3. Is horizontally-scrollable (`ListView.builder(scrollDirection: Axis.horizontal)`, fixed height).
4. Hidden entirely if the data list is empty (§7 "zero items → strip hidden").
5. Strip title above (`Text("People")`, `Text("Places")`, etc.) with "Top" subtitle.

**PeopleStrip:** 20-item horizontal list of circular thumbs (64pt) with name caption. Thumbnail URL from existing people-thumbnail utility (port from `SearchApiRepository.search` pattern). Tap toggles via `togglePerson(PersonDto(...))` — build a minimal `PersonDto` from the `FilterSuggestionsPersonDto`. Selected state: checkmark overlay + border.

**PlacesStrip:** 20-item list of rounded rectangular tiles (100×64 pt) with gradient overlay, country/city text on top. Tap calls `setLocation(SearchLocationFilter(country: ..., city: ...))` — for Phase 1, tapping a country tile sets only `country`; a city tile sets both. Uses `FilterSuggestionsResponseDto.countries` list.

**TagsStrip:** Pill chips with count badges. Tap toggles via `toggleTag(tagId)`. Uses `FilterSuggestionsResponseDto.tags`.

**WhenStrip:** Quick-pick pills: "Today" / "This week" / "This month" / "This year" / "Custom…". Each computes a `(start, end)` and calls `setDateRange`. "Custom…" opens `showDateRangePicker` (Flutter stock). Selected state: filled pill.

**Tests per strip:**

- Renders loading shimmer on `AsyncLoading`.
- Renders error tile on `AsyncError`; retry button calls `ref.invalidate(photosFilterSuggestionsProvider(filter))` (widget test verifies provider is refreshed).
- Renders data items in provided order.
- Tap on item calls correct notifier method with correct args (verified via listener mock or state inspection).
- Hidden when data list empty.
- Selected state rendered when corresponding chip is in `SearchFilter`.

**Commits (one per strip):**

- `feat(mobile): PeopleStrip`
- `feat(mobile): PlacesStrip`
- `feat(mobile): TagsStrip`
- `feat(mobile): WhenStrip`

---

## Task 6 — Host wiring in `MainTimelinePage`

**Files:**

- Modify: `mobile/lib/presentation/pages/dev/main_timeline.page.dart`
- Modify: existing app-bar wrapper (pass filter icon as action to `ImmichSliverAppBar`). Simplest path: pass a custom `appBar` prop to `Timeline` — check `Timeline`'s `appBar` parameter allows action injection. If not, thread a small `actions` override.
- Test: `mobile/test/presentation/pages/dev/main_timeline_page_test.dart`

**Behaviour:**

- `MainTimelinePage` becomes a `Stack`:
  - Background layer: existing `Timeline(topSliverWidget: DriftMemoryLane, ...)` now reading `photosTimelineQueryProvider` via a `ProviderScope` override on `timelineServiceProvider`.
  - Overlay layer: `FilterSheet()` + `PeekRail()` + scrim.
- App-bar actions include `FilterIconButton()`.
- **Wiring `photosTimelineQueryProvider` into `Timeline`:** the simplest wire-through is a `ProviderScope` override on `timelineServiceProvider` at the `MainTimelinePage` level, so the existing `Timeline` widget reads the photo-filter-aware service without modification. Verify existing `Timeline` does read this provider, not a closer-scoped one.

**Test:**

- Renders `Timeline`, `FilterSheet`, `PeekRail`, app-bar filter icon.
- When filter empty: `timelineServiceProvider` (through `photosTimelineQueryProvider`) returns the main library service.
- When filter non-empty: returns the search-backed service (verified via mocked factory).

**Commit:** `feat(mobile): mount FilterSheet + PeekRail + FilterIconButton in MainTimelinePage`

---

## Task 7 — i18n strings (`i18n/en.json`)

**Files:**

- Modify: `i18n/en.json`

**Keys to add (only English; translators handle other locales after merge):**

- `filter_button_active`: `"Filter, active"`
- `filter_sheet_done`: `"Done"` (reuse `done` if casing matches)
- `filter_sheet_reset`: `"Reset"` (reuse `reset` if casing matches)
- `filter_sheet_search_hint`: `"Search photos, faces, text"`
- `filter_sheet_people`: `"People"`
- `filter_sheet_places`: `"Places"`
- `filter_sheet_tags`: `"Tags"`
- `filter_sheet_when`: `"When"`
- `filter_sheet_match_count_photos`: `"{count} photos"`
- `filter_sheet_match_count_loading`: `"—"`
- `filter_sheet_offline`: `"Offline"`
- `filter_sheet_load_error_retry`: `"Couldn't load — tap to retry"`
- `filter_sheet_zero_results`: `"No photos match this filter"`
- `filter_sheet_clear_filters`: `"Clear filters"`
- `filter_sheet_when_today`: `"Today"`
- `filter_sheet_when_week`: `"This week"`
- `filter_sheet_when_month`: `"This month"`
- `filter_sheet_when_year`: `"This year"`
- `filter_sheet_when_custom`: `"Custom…"`
- `filter_sheet_media_photos`: `"Photos"`
- `filter_sheet_media_videos`: `"Videos"`
- `filter_sheet_media_audio`: `"Audio"`
- `filter_sheet_favourites`: `"Favourites"`
- `filter_sheet_archived`: `"Archived"`
- `filter_sheet_not_in_album`: `"Not in album"`
- `filter_sheet_unnamed_person`: `"Unnamed"`
- `filter_sheet_deep_stub`: `"Full filters coming in the next update"`

Run `pnpm --filter=immich-i18n format:fix` (per memory `feedback_i18n_key_sorting`).

**Commit:** `feat(mobile): i18n strings for filter sheet`

---

## Task 8 — Analyzer + full-suite test pass

**Step 1:** `cd mobile && flutter analyze lib test`. Expected: 0 warnings.

**Step 2:** `cd mobile && flutter test`. Expected: all pass.

**Step 3:** `dart format lib/presentation/widgets/filter_sheet lib/providers/photos_filter test/presentation/widgets/filter_sheet test/providers/photos_filter` — then `git diff` to verify no unexpected changes elsewhere.

**Commit (only if format changes exist):** `chore(mobile): dart format filter_sheet`

---

## Task 9 — Open PR as draft

Push branch, open PR titled `feat(mobile): photos filter sheet UI (PR 1.2)`, body references design §10.3 and lists scope guardrails from header. Mark as draft until babysit completes CI green.

**Babysit workflow:** use the `babysit` skill to watch CI. Fix any failures at root cause (memory `feedback_no_flake_allowance`). Do **not** merge.

---

## Risk register (updates §11.1)

- **`Timeline` override path.** If `Timeline` widget reads `timelineServiceProvider` via a nested scope, a top-level override in `MainTimelinePage` may not take effect. Verify before Task 6 by reading `timeline.widget.dart` for how it resolves the service. If the path is closed, inject the service as a `Timeline` prop instead and ship a minimal timeline-prop change.
- **`SearchService` pagination drift.** The existing `PaginatedSearchNotifier` owns pagination; reimplementing it in the adapter risks divergence. Keep the Task 1 adapter minimal (page 1 only for MVP is acceptable if stream plumbing proves painful — flag in PR description as a known limitation to address in a PR 1.2.1 follow-up).
- **Keyboard + `DraggableScrollableSheet`.** PR 1.0 spike outcome was never filled. If the `SearchBar` behaves badly when the keyboard opens, stop, document in §11.4 of the design doc, and fall back to a custom `ModalBottomSheet`.
- **Drag-settle debounce storm.** The 80ms debounce on `NotificationListener` writes may still churn `photosFilterSheetProvider` during rapid drag. If CI shows flaky sheet widget tests, increase debounce or gate writes to settle-only events (`DraggableScrollableNotification.extent == snapSize`).
