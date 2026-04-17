# Mobile Filter Sheet — PR 1.2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the Photos-tab entry point (filter icon in app bar), the `FilterSheet` with peek + browse snaps (deep is a stub), and the `photosTimelineQueryProvider` that switches the Photos timeline between the library service (empty filter) and a page-1 search-backed service (non-empty filter). Design: [`2026-04-17-mobile-filter-sheet-design.md`](./2026-04-17-mobile-filter-sheet-design.md) §10.3 PR 1.2.

**Architecture:** Thin reactive composition — UI watches `photosFilterProvider` / `photosFilterSheetProvider` / `photosFilterSuggestionsProvider` / `photosFilterCountProvider` (all shipped in PR 1.1) and calls notifier methods. The sheet is a **single** `DraggableScrollableSheet` conditionally mounted in `MainTimelinePage`'s `Stack` overlay; it owns all three snap states — **peek content lives inside the sheet**, not as a separate rail widget (single source of truth per design §6.2). Snap-state drives visibility + drag constraints through `photosFilterSheetProvider`. `photosTimelineQueryProvider` overrides `timelineServiceProvider` via a `ProviderScope`: empty filter → the existing main library service; non-empty filter → a `TimelineService` built from `TimelineFactory.fromAssets` fed by **page-1-only** `SearchService.search` results (pagination deferred to PR 1.2.1 follow-up).

**Tech stack:** Flutter, `hooks_riverpod`, Material 3 theme tokens via `Theme.of(context)`, `flutter_test` + `mocktail`, existing `TimelineFactory` / `TimelineService` infrastructure, the domain-layer `searchServiceProvider` at `mobile/lib/providers/infrastructure/search.provider.dart:8` (explicitly **not** the legacy `mobile/lib/services/search.service.dart:14` variant — these two providers collide in name; see PR 1.1 Task 1.1.17 note).

**Scope guardrails:**

- **Deep state is a stub.** Browse → Deep drag lands on a placeholder panel saying "Full filters coming in the next update"; no sections, no pickers. Design §5.2 Deep content is PR 1.3.
- **No pickers.** "Search N →" affordances hidden (Phase 1 per §5.3 ships them only in Deep, which is PR 1.3).
- **No Search-tab retirement.** Bottom nav stays 4 tabs (PR 1.4).
- **No orphan reconciliation.** Deferred to Phase 1.5 per PR 1.1 §7 audit.
- **Camera strip omitted.** Phase 1 decision (§4.8).
- **Aesthetic tokens.** Material 3 defaults only — no darkroom palette (§3).
- **Pagination on the search-backed timeline is deferred to PR 1.2.1.** Non-empty-filter Timeline shows at most one page (default `SearchApiRepository.search` page size). Flagged in PR body as a known limitation.
- **PlacesStrip sets `country` only** on tap (no cascade in Browse). The country + city cascade is Deep / PR 1.3.
- **No `SearchBar` paste-override behaviour.** Uses the standard debounce on every change; explicit paste detection deferred.

---

## Landmarks & pre-verified facts

- Worktree: `/home/pierre/dev/gallery/.worktrees/mobile-filter-sheet-ui`. Branch: `feat/mobile-filter-sheet-ui` off `origin/main`.
- Providers shipped in PR 1.1 (on `main`):
  - `mobile/lib/providers/photos_filter/photos_filter.provider.dart` — `photosFilterProvider` (`NotifierProvider<PhotosFilterNotifier, SearchFilter>`) with: `togglePerson(PersonDto)`, `toggleTag(String)`, `setLocation(SearchLocationFilter?)`, `setDateRange({start, end})`, `setRating(int?)`, `setMediaType(AssetType?)`, `setFavouritesOnly/Archived/NotInAlbum(bool)`, `setText(String)`, `clearPeople/Tags()`, `clearDimension(Dimension)`, `removeChip(ChipId)`, `reset()`. Also has `updateShouldNotify` structural-equality override (so equal states do not re-emit).
  - `filter_sheet.provider.dart` — `photosFilterSheetProvider` (`StateProvider<FilterSheetSnap>`, enum `hidden | peek | browse | deep`, default `hidden`).
  - `filter_suggestions.provider.dart` — `photosFilterSuggestionsProvider` (`FutureProvider.autoDispose.family<FilterSuggestionsResponseDto, SearchFilter>`).
  - `filter_count.provider.dart` — `photosFilterCountProvider` (`FutureProvider.autoDispose<int>`, **placeholder** = page-1 result length; not a true total).
  - `chip_id.dart` — `ChipId` sealed type (PersonChipId/TagChipId/LocationChipId/DateChipId/RatingChipId/MediaTypeChipId/FavouriteChipId/ArchiveChipId/NotInAlbumChipId/TextChipId). Each subclass has explicit `==` / `hashCode`.
  - `photos_filter.dart` — barrel export.
- Host page: `mobile/lib/presentation/pages/dev/main_timeline.page.dart` — `ConsumerWidget` returning `Timeline(...)`. Will be wrapped in a `Stack` overlay with the sheet.
- Timeline: `mobile/lib/presentation/widgets/timeline/timeline.widget.dart` builds a nested `ProviderScope` that overrides **only** `timelineArgsProvider` (lines 72-86). It reads `timelineServiceProvider` via `ref.read(timelineServiceProvider)` at line 335 — that read resolves through the parent scope (the inner scope does not override it). **A parent-level `ProviderScope` override on `timelineServiceProvider` therefore propagates into `Timeline` unmodified.** `timelineServiceProvider` declares `dependencies: []` (canonical override pattern — `domain/services/timeline.service.dart:17-28`).
- `TimelineFactory` methods (`domain/services/timeline.service.dart:40-95`): `.main()`, `.fromAssets(List<BaseAsset>, TimelineOrigin)`, `.fromAssetStream(List<BaseAsset> Function(), Stream<int>, TimelineOrigin)`. **`fromAssetStream` expects a `getAssets` closure returning a pre-accumulated buffer synchronously AND a `Stream<int>` emitting asset count.** Not a `Stream<List<BaseAsset>>`.
- `SearchResult` (`models/search/search_result.model.dart`) carries `List<Asset>` (legacy Isar `Asset`). Drift domain uses `BaseAsset`. Adapter needs an Isar→Drift conversion, via `assetRepositoryProvider.getAllByRemoteId(ids)` — mirrors existing `SearchService.search`.
- `SearchService` (`services/search.service.dart:34`) — `Future<SearchResult?> search(SearchFilter, int page)`. `SearchResult.assets` is **already** Drift-converted by `SearchService` via `_assetRepository.getAllByRemoteId(...)`. ✓ No extra conversion step needed in adapter — it's already `List<Asset>`; needs cast/pass-through to `List<BaseAsset>`.
- `currentUserProvider` returns `UserDto?` (nullable); `photosTimelineQueryProvider` must handle pre-login.
- i18n: `i18n/en.json` (flat key → string). Existing: `filter`, `reset`, `done`. Sort via `pnpm --filter=immich-i18n format:fix` per memory `feedback_i18n_key_sorting`.
- App bar component: `mobile/lib/widgets/common/immich_sliver_app_bar.dart:25` — accepts optional `actions`.
- **Sheet widget choice:** stock `DraggableScrollableSheet` (PR 1.0 spike §11.4 never filled). If keyboard-with-`TextField` breaks during Task 4, stop, document in §11.4, and escalate — do **not** silently ship broken UX.

---

## Global decisions (apply to all tasks)

- **Single sheet ownership.** `FilterSheet` owns peek + browse + deep snaps as internal snap-state views. There is **no** standalone `PeekRail` widget mounted outside the sheet. The sheet is mounted iff `photosFilterSheetProvider != hidden`; at snap `peek` the sheet's content is a compact chiprail + count.
- **Hidden → peek auto-transition.** When the user adds the first filter from a `hidden` state, the sheet snap should auto-advance to `peek`. Implementation: a `ref.listen(photosFilterProvider, ...)` in a top-level mount-point (the `MainTimelinePage` widget) that observes `SearchFilter.isEmpty` transitioning from `true → false` and, iff the current sheet state is `hidden`, sets it to `peek`. Conversely, when `isEmpty` transitions `false → true` and sheet is `peek`, set to `hidden`. (Browse/Deep snaps are left alone — user explicitly opened those.)
- **Snap debounce.** `NotificationListener<DraggableScrollableNotification>` observes drag. We write `photosFilterSheetProvider` **only on settle** — i.e., when `(notification.extent - snap).abs() < 0.02` for some `snap ∈ {0.15, 0.62, 0.95}`. No time-based debounce needed; settle is a discrete event.
- **Scrim.** A `Positioned.fill` `ColoredBox(Colors.black54 or Theme.scrimColor)` rendered behind the sheet for snap ∈ {browse, deep}. Tap: browse → peek if `!isEmpty` else hidden; deep → browse.
- **Material 3 theme tokens only.** Every widget reads `Theme.of(context)`; no hardcoded colours (memory `feedback_match_gallery_design`).
- **Test helpers.** Use `TestUtils.createContainer({overrides})` (`mobile/test/test_utils.dart`) for provider-only tests. For widget tests that need a timeline, use `ProviderScope` override on `timelineServiceProvider` with a stub `TimelineService`.

---

## Task 1 — `photosTimelineQueryProvider`

**Files:**

- Create: `mobile/lib/providers/photos_filter/timeline_query.provider.dart`
- Create: `mobile/lib/domain/services/photos_filter_timeline.service.dart` (thin helper building `List<BaseAsset>` from `SearchService.search(filter, 1)`)
- Test: `mobile/test/providers/photos_filter/timeline_query_provider_test.dart`

**Behaviour:**

- A `Provider<TimelineService>` named `photosTimelineQueryProvider` with `dependencies: []` (used as a `ProviderScope` override for `timelineServiceProvider`).
- Reads `photosFilterProvider`:
  - If `state.isEmpty` **or** `currentUserProvider` returns `null`: returns the same `TimelineService` the current main-library wiring produces. Reuse `timelineServiceProvider`'s body via `ref.watch(timelineFactoryProvider).main(timelineUsers, currentUserId)` where `timelineUsers` and `currentUserId` are resolved the same way `timelineServiceProvider` resolves them.
  - If non-empty and logged-in: calls `ref.watch(searchServiceProvider).search(filter, 1)` once, awaits; builds a `TimelineService` via `ref.watch(timelineFactoryProvider).fromAssets(result?.assets ?? [], TimelineOrigin.search)`. Page-1 only; no streaming pagination (deferred).
- **Debounce.** A 500 ms debounce gate around service re-creation. Implementation: wrap the non-empty branch in a `Future.delayed(500ms)` + cancellation-on-filter-change via a local `_currentToken` incremented each rebuild. During the debounce window return the previous `TimelineService` (keep the scrim-behind-sheet stable).
- **Disposal.** `ref.onDispose(previousService.dispose)` on every re-creation; `ref.onDispose` on the provider itself disposes the final service.
- **Empty → non-empty → empty net-zero.** Because `photosFilterProvider` has `updateShouldNotify` structural equality, the provider won't fire. Test this explicitly.
- **Pre-login handling.** If `currentUserProvider` is `null`, always return the library service (defensive; matches existing `timelineServiceProvider` fallback `.id ?? ''`).

**TimelineOrigin.** Pick the closest existing origin or add a new `search` variant if the enum is extensible — audit `domain/models/timeline.model.dart` for the `TimelineOrigin` definition and use an existing value if possible (e.g., `remote` or similar). Document the choice inline.

**Tests (one test per case; all in `timeline_query_provider_test.dart`):**

1. Empty filter → provider delegates to main-library service (mocked `TimelineFactory.main` called with correct args).
2. Non-empty filter → `searchServiceProvider.search(filter, 1)` is called; `fromAssets` called with returned asset list.
3. Pre-login (`currentUserProvider` override = `null`) + non-empty filter → delegates to main-library service (fallback); no search call.
4. Filter change while non-empty: within 500 ms, rapid `togglePerson` × 3 on different ids coalesces into **one** search call (fake-time via `FakeAsync`).
5. Empty → non-empty transition cancels library subscription, starts search subscription (assert previous service's `dispose()` called).
6. Non-empty → empty transition reverses (search service `dispose()` called, main service restored).
7. Net-zero change within 500 ms (toggle + untoggle same id): **zero** search calls.
8. Tab-switch simulation: disposing + rebuilding the provider preserves the filter (driven by `photosFilterProvider`, not local state).
9. `SearchService.search` returns `null` → `fromAssets([], …)` path; no crash.

**Commit:** `feat(mobile): photosTimelineQueryProvider with debounced empty/search switcher`

---

## Task 2 — `FilterIconButton`

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/filter_icon_button.widget.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/filter_icon_button_test.dart`

**Behaviour:**

- `ConsumerWidget` rendering `IconButton(icon: Icon(Icons.tune_rounded))`.
- Active dot: `Stack` + `Positioned(top: 8, right: 8)` rendering a 6pt circle in `colorScheme.primary` iff `!ref.watch(photosFilterProvider).isEmpty`.
- `onPressed`: `ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse` — idempotent across current snap value (always `browse` per design §7 "Filter icon tap when Peek rail is already visible").
- Semantics: `Semantics(label: filter.isEmpty ? t('filter') : t('filter_button_active'))`.

**Tests:**

1. Empty filter → no dot rendered (find by `Key('filter-active-dot')` → not found).
2. Non-empty filter (parameterised group — one sub-test per dimension: person / tag / location / date / rating / mediaType / fav / archive / notInAlbum / text) → dot rendered.
3. Tap with sheet `hidden` → sheet becomes `browse`.
4. Tap with sheet `peek` → sheet becomes `browse`.
5. Tap with sheet `browse` → stays `browse` (no state churn assertion via listener mock).
6. Tap with sheet `deep` → sheet becomes `browse` (covers §7 edge case).
7. Semantics label reflects state.

**Commit:** `feat(mobile): FilterIconButton with active-indicator dot`

---

## Task 3 — `activeChipsFromFilter` helper + `ActiveFilterChip`

**Files:**

- Create: `mobile/lib/providers/photos_filter/active_chips.dart` — pure dart, no Riverpod.
- Create: `mobile/lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart`
- Test: `mobile/test/providers/photos_filter/active_chips_test.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/active_filter_chip_test.dart`

**`activeChipsFromFilter` contract:**

```dart
class ActiveChipSpec {
  final ChipId id;
  final String label;
  final List<String>? avatarUrls; // 1-3 for People; null for others
  final IconData? icon;           // for non-person chips
  const ActiveChipSpec({required this.id, required this.label, this.avatarUrls, this.icon});
}

/// Pure. Order is stable: people → tags → location → date → rating → media → favourite → archive → notInAlbum → text.
List<ActiveChipSpec> activeChipsFromFilter(
  SearchFilter filter, {
  FilterSuggestionsResponseDto? suggestions, // for tag-name resolution
});
```

**Rules:**

- People: one chip per person (first 3 get individual chips); for >3, collapse the trailing people into a single `PersonChipId(firstCollapsedId)` chip labeled `"${firstName} +${remaining}"`. (The spillover modal is PR 1.3 — removing this chip removes only that id; the rest persist in state.)
- Tags: one per id; label resolved from `suggestions?.tags` by id; fallback `t('filter_sheet_tag_fallback')` (`"Tag"`).
- Location: single chip iff any of `country/state/city` non-null; label = non-null fields joined `" · "`.
- Date: single chip iff `takenAfter != null || takenBefore != null`; label = formatted using the existing mobile date formatter (short month-year range, single month if same month).
- Rating: single chip iff `rating != null && rating > 0`; label `"★ $rating+"`.
- MediaType: single chip iff `mediaType != null && mediaType != AssetType.other`; label = `Photos | Videos | Audio` via i18n.
- Favourites / Archived / NotInAlbum / Text: as in design §5.5; skip text chip when `context == null || context.trim().isEmpty`.

**Tests (table-driven, all in `active_chips_test.dart`):**

1. Empty filter → `[]`.
2. One chip per dimension (10 parameterised cases).
3. People ≤ 3 → individual chips in insertion order.
4. People = 5 → three person chips + one "Alice +2" chip with `PersonChipId(alice.id)` as its id.
5. Location with only `country` set → single chip with country text.
6. Location with all fields null → no chip (regression test — defensive).
7. Text chip with whitespace-only context → no chip.
8. Rating = 0 → no chip.
9. MediaType = `other` → no chip.
10. Tag id not present in suggestions → fallback label.
11. Tag id present in suggestions → resolved label.
12. Combined filter (people + tag + location + date) → 4 chips in the documented order.
13. Person in filter state but absent from current suggestions (top-N slice) → chip still rendered with fallback "Unnamed" (regression for §7 C2).

**`ActiveFilterChip` widget:**

- Input: `ActiveChipSpec`.
- Renders leading avatars (for People, overlapping circles; use existing `getPeopleThumbnailUrl` per memory `feedback_people_thumbnail_url`) or `icon`, label, trailing `×` (`IconButton` with tap target ≥ 32×32; the containing chip row enforces ≥ 44pt total per §9.6).
- `×` tap calls `ref.read(photosFilterProvider.notifier).removeChip(spec.id)`.
- Semantics label: `"${spec.label}, remove filter"`.

**Widget tests:**

1. Renders label + × button.
2. Person spec → renders avatars (mock image loader via `TestImage`).
3. Icon spec → renders icon.
4. × tap calls `removeChip` with matching `ChipId` (verified via a tiny `Notifier` stub).

**Commits:**

- `feat(mobile): activeChipsFromFilter helper`
- `feat(mobile): ActiveFilterChip widget`

---

## Task 4 — `FilterSheet` scaffold (owns all three snaps)

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/filter_sheet.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/peek_content.widget.dart` (internal peek-snap content; chiprail + count)
- Create: `mobile/lib/presentation/widgets/filter_sheet/browse_content.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/deep_stub_content.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/search_bar.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/match_count_footer.widget.dart`
- Tests: one per widget file, under `mobile/test/presentation/widgets/filter_sheet/`.

**`FilterSheet` behaviour:**

- `ConsumerWidget`. Watches `photosFilterSheetProvider`.
- If snap is `hidden`: returns `SizedBox.shrink()`.
- Otherwise renders:
  - A `Stack`:
    - `Positioned.fill(child: scrim)` — scrim opacity 0.32 when snap ∈ {browse, deep}, 0.0 when peek. Animated via `AnimatedOpacity` (150ms).
    - `DraggableScrollableSheet` with:
      - `controller` = a `DraggableScrollableController` kept in widget state (not via `HookConsumerWidget`; use a `StatefulWidget` or `HookWidget` with `useState` — simpler to use `ConsumerStatefulWidget`).
      - `initialChildSize`: `{peek: 0.15, browse: 0.62, deep: 0.95}[snap]`.
      - `minChildSize: 0.15, maxChildSize: 0.95, snap: true, snapSizes: const [0.15, 0.62, 0.95]`.
      - `builder: (ctx, scrollController)` → content-selection widget wrapping `PeekContent | BrowseContent | DeepStubContent` based on current snap, all receiving `scrollController`.
- A `NotificationListener<DraggableScrollableNotification>` wraps the sheet. On notification, check if `(extent - 0.15).abs() < 0.02 || (extent - 0.62).abs() < 0.02 || (extent - 0.95).abs() < 0.02` — if so, map to `FilterSheetSnap` and write to provider (iff different from current).
- Scrim tap: browse → `peek` (if `!isEmpty`) else `hidden`; deep → `browse`.
- Dispose: controller dispose in `dispose()`.

**`PeekContent`:**

- `Material` with elevation 8, rounded top corners.
- Column: drag handle (centred, 32×4 pt) → horizontal `ListView` of `ActiveFilterChip`s from `activeChipsFromFilter(filter, suggestions)` → trailing `MatchCountLabel` (inline count; shows `—` on error/loading).
- Watches `photosFilterSuggestionsProvider(filter)` and passes its `valueOrNull` into the helper.
- Watches `photosFilterCountProvider`.
- Tap on the handle / row body (outside chips) → snap = `browse`.

**`BrowseContent`:**

- `ListView` (using the sheet's `scrollController`):
  1. Drag handle.
  2. `SearchBar`.
  3. `SizedBox(height: 12)`.
  4. Four strips (Task 5): `PeopleStrip`, `PlacesStrip`, `TagsStrip`, `WhenStrip`.
  5. `MatchCountFooter` (pinned visually at bottom; in Phase 1 it's inline at list bottom — pinning is a PR 1.3 enhancement).
- Reset button in the header row next to the drag handle — tapping calls `photosFilterProvider.notifier.reset()`.

**`DeepStubContent`:** drag handle + centred Text via i18n key `filter_sheet_deep_stub`.

**`SearchBar` behaviour:**

- `ConsumerStatefulWidget` (or hook widget) with a `TextEditingController`.
- Init: `_controller = TextEditingController(text: ref.read(photosFilterProvider).context ?? '')`.
- On `_controller`.onChange: launch a 250ms debounce Timer that calls `setText(_controller.text)`.
- Clear `×` icon visible when `_controller.text.isNotEmpty`; tap sets controller to empty and calls `setText('')` immediately (cancels debounce).
- Hint text from i18n `filter_sheet_search_hint`.

**`MatchCountFooter`:**

- Row: `Text("${count} photos")` (via i18n plural) on the left; `TextButton(onPressed: _done, child: Text(t('filter_sheet_done')))` on the right.
- `_done`: sets sheet to `hidden` if `!isEmpty` ? `peek` : `hidden` (actually: per design §5.2 "Done button closes the sheet" — set to `hidden`; the listener on filter emptiness will not re-open peek because isEmpty is still false; user explicitly closed). **Wait — re-read design:** §7 "If the user explicitly closes the sheet to `hidden` before leaving, it stays `hidden` on return." So Done → `hidden`, and the `hidden→peek` auto-transition in `MainTimelinePage` must only fire on `isEmpty: true → false`, not on `isEmpty: false` with a newly-hidden sheet. Implementation matches (listener watches the isEmpty transition, not the sheet state).
- Count shows `—` on loading/error (watch `photosFilterCountProvider`).

**Tests (sheet scaffolding):**

1. Snap = `hidden` → `FilterSheet` renders empty (`find.byType(DraggableScrollableSheet)` = 0).
2. Snap ∈ {peek, browse, deep} → `DraggableScrollableSheet` present with correct `initialChildSize`.
3. Drag-settle to 0.62 extent → provider becomes `browse` (simulate via `DraggableScrollableController.jumpTo(0.62)` + pump).
4. Drag-settle with `0.62 ± 0.015` tolerance → provider becomes `browse`.
5. Drag-settle with `0.62 ± 0.05` (off-snap intermediate) → provider unchanged.
6. Scrim tap at browse, `!isEmpty` → peek.
7. Scrim tap at browse, `isEmpty` → hidden.
8. Scrim tap at deep → browse.
9. Cold-start: `photosFilterSheetProvider` defaults `hidden` (verify provider initial state); `FilterSheet` widget renders empty before any interaction (regression for §7 "Cold-start policy").

**Tests (`PeekContent`):**

1. Renders chips for a populated filter.
2. Match count label updates on `photosFilterCountProvider` change; shows `—` on `AsyncError`.
3. Tap on handle → snap = `browse`.
4. Empty suggestions → chips still render (person/tag labels use fallbacks); no crash.

**Tests (`BrowseContent`):**

1. Renders drag handle + SearchBar + 4 strips + footer in order.
2. Reset button calls `notifier.reset()`.

**Tests (`SearchBar`):**

1. Initial controller value matches `photosFilterProvider.context`.
2. Typing fires `setText(input)` after 250 ms (FakeAsync).
3. Multiple rapid chars within 250 ms → one `setText` call with final text.
4. Clear × tap calls `setText('')` immediately (no 250ms wait), hides ×.

**Tests (`MatchCountFooter`):**

1. Count = 42 renders "42 photos".
2. Count loading → `—`.
3. Count error → `—`.
4. Done tap → sheet becomes `hidden`.

**Tests (`DeepStubContent`):**

1. Renders the stub message.
2. Drag-down from deep → browse (covered in sheet-scaffold tests; redundant here — skip).

**Commits (one per widget):**

- `feat(mobile): FilterSheet scaffold with settle-driven snap sync`
- `feat(mobile): PeekContent`
- `feat(mobile): BrowseContent`
- `feat(mobile): DeepStubContent`
- `feat(mobile): SearchBar with debounced setText`
- `feat(mobile): MatchCountFooter`

---

## Task 5 — Browse strips (People / Places / Tags / When)

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/strips/people_strip.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/strips/places_strip.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/strips/tags_strip.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/strips/when_strip.widget.dart`
- Tests: one per strip under `mobile/test/presentation/widgets/filter_sheet/strips/`.

**Shared pattern:**

Each strip is a `ConsumerWidget`:

1. `final filter = ref.watch(photosFilterProvider);`
2. `final suggestionsAsync = ref.watch(photosFilterSuggestionsProvider(filter));`
3. Renders:
   - `AsyncLoading` → shimmer row (3 placeholder tiles).
   - `AsyncError` → single tile with `t('filter_sheet_load_error_retry')`; tap calls `ref.refresh(photosFilterSuggestionsProvider(filter).future)`.
   - `AsyncData` with empty list → `SizedBox.shrink()` (strip hidden).
   - `AsyncData` with items → `SizedBox(height: stripHeight, child: ListView.builder(scrollDirection: Axis.horizontal, ...))`.
4. Strip title above (small text, secondary colour).

**PeopleStrip:** 64pt circular thumbs, 20-item cap. Thumb URL via `getPeopleThumbnailUrl(...)` (memory `feedback_people_thumbnail_url`). Tap toggles via `togglePerson(_buildPersonDto(fsPerson))`. Build the `PersonDto` using the full constructor available (id + name + thumbnail path / or whatever the DTO requires). **Audit `PersonDto.==` during Task 5 start**: if equality is id-only, minimal construction is safe; if structural, a round-trip toggle against a differently-constructed `PersonDto` could duplicate entries. Document what's found.

Selected state: border + checkmark overlay rendered when `filter.people.any((p) => p.id == fsPerson.id)` (id compare, not full equality — insulates from `PersonDto.==` differences).

**PlacesStrip:** 100×64 pt rounded tiles with gradient overlay + country text. Uses `response.countries`. Tap sets `setLocation(SearchLocationFilter(country: c))` (country only — PlacesCascade is PR 1.3). Selected when `filter.location.country == c`.

**TagsStrip:** pill chips with count badge `"${name} · ${count}"`. Tap toggles via `toggleTag(tagId)`. Selected when `filter.tagIds?.contains(tagId) == true`.

**WhenStrip:** 5 quick-pick pills: Today / This week / This month / This year / Custom…. Each computes `(start, end)` via `DateTime.now()` and calls `setDateRange(start: start, end: end)`. "Custom…" opens `showDateRangePicker`; returned range passed to `setDateRange`. Selected pill = the one whose `(start, end)` matches `filter.date` exactly (compare by day-level truncation).

**Tests per strip (9 tests × 4 strips):**

1. Loading state renders shimmer.
2. Error state renders retry tile; tap invokes `ref.refresh`.
3. Empty data → widget returns `SizedBox.shrink()`.
4. Data renders items in order.
5. Tap on item calls correct notifier method with correct args.
6. Selected state renders for id in filter.
7. Hidden when data list empty.
8. Empty-library regression: widget doesn't fire a suggestions call when filter is empty AND `suggestions.people/tags/countries == []` (this is the library-empty case — the provider still fires, but the strip renders no UI and doesn't drive secondary calls).
9. Strip with exactly 1 item renders (no padding / hiding applied).

**PlacesStrip extra:** untap restores country to null (via `setLocation(null)` when re-tapping selected country).

**WhenStrip extra:** Custom range picker cancel → no state change.

**Commits (one per strip):**

- `feat(mobile): PeopleStrip`
- `feat(mobile): PlacesStrip`
- `feat(mobile): TagsStrip`
- `feat(mobile): WhenStrip`

---

## Task 6 — Host wiring in `MainTimelinePage`

**Files:**

- Modify: `mobile/lib/presentation/pages/dev/main_timeline.page.dart`
- Test: `mobile/test/presentation/pages/dev/main_timeline_page_test.dart`

**Changes:**

- `MainTimelinePage` becomes a `ConsumerStatefulWidget` (needs `ref.listen` for the auto-peek listener).
- Structure:
  ```dart
  ProviderScope(
    overrides: [
      timelineServiceProvider.overrideWith((ref) => ref.watch(photosTimelineQueryProvider)),
    ],
    child: Stack(
      children: [
        Timeline(
          topSliverWidget: DriftMemoryLane,
          topSliverWidgetHeight: ...,
          showStorageIndicator: true,
          appBar: ImmichSliverAppBar(actions: [FilterIconButton()], ...),
        ),
        FilterSheet(),
      ],
    ),
  );
  ```
- `ref.listen(photosFilterProvider.select((f) => f.isEmpty), (prev, next) { ... })`:
  - `prev == true && next == false` → if sheet state is `hidden`, set to `peek` (auto-peek on first filter).
  - `prev == false && next == true` → if sheet state is `peek`, set to `hidden` (last-chip auto-collapse).
- Dispose listener via `ConsumerStatefulWidget` idiom (no manual cleanup needed for `ref.listen`).
- `Timeline.appBar` parameter accepts a `Widget?`. Confirm by reading `Timeline`'s constructor (landmarks §line 42 default = `ImmichSliverAppBar(...)`). Pass a custom `ImmichSliverAppBar(actions: [FilterIconButton()])`.

**Tests:**

1. Renders `Timeline`, `FilterSheet`, `FilterIconButton` in app-bar actions.
2. `ProviderScope` override propagates into `Timeline`: inside `Timeline`, `ref.read(timelineServiceProvider)` returns the value `photosTimelineQueryProvider` exposes. Verify by setting an override-within-override in the test that stubs `photosTimelineQueryProvider` and asserting a `Timeline` internal read hits the stub.
3. Filter empty → `timelineServiceProvider` returns library service (mocked factory verified).
4. Filter non-empty → `timelineServiceProvider` returns search-backed service.
5. **Auto-peek on first filter:** start with `hidden` + empty filter. Add a filter via notifier. Pump. Assert sheet state = `peek`.
6. **Auto-collapse on last chip:** start with `peek` + one filter. Remove chip. Pump. Assert sheet state = `hidden`.
7. **Explicit close persists:** from `browse`, call Done → `hidden`. Then add a filter. Assert sheet stays `hidden` (listener only fires on `isEmpty` transition; isEmpty was already false). **Caveat:** actually, on Done, isEmpty is still `false` (user is just closing). Later filter additions don't re-trigger the `true → false` transition. ✓ Behaviour correct.
8. **Tab-switch preservation:** simulate tab switch by disposing + remounting `MainTimelinePage`. Assert `photosFilterProvider` + `photosFilterSheetProvider` (top-level, not page-scoped) retain state.

**Commit:** `feat(mobile): mount FilterSheet + FilterIconButton in MainTimelinePage`

---

## Task 7 — i18n strings (`i18n/en.json`)

**Files:**

- Modify: `i18n/en.json`.

**Keys (only English; translators handle other locales after merge; insert alphabetically then run formatter):**

- `filter_button_active`: `"Filter, active"`
- `filter_sheet_archived`: `"Archived"`
- `filter_sheet_clear_filters`: `"Clear filters"`
- `filter_sheet_deep_stub`: `"Full filters coming in the next update"`
- `filter_sheet_done`: `"Done"`
- `filter_sheet_favourites`: `"Favourites"`
- `filter_sheet_load_error_retry`: `"Couldn't load — tap to retry"`
- `filter_sheet_match_count_loading`: `"—"`
- `filter_sheet_match_count_photos`: `"{count} photos"`
- `filter_sheet_media_audio`: `"Audio"`
- `filter_sheet_media_photos`: `"Photos"`
- `filter_sheet_media_videos`: `"Videos"`
- `filter_sheet_not_in_album`: `"Not in album"`
- `filter_sheet_offline`: `"Offline"`
- `filter_sheet_people`: `"People"`
- `filter_sheet_places`: `"Places"`
- `filter_sheet_reset`: `"Reset"`
- `filter_sheet_search_hint`: `"Search photos, faces, text"`
- `filter_sheet_tag_fallback`: `"Tag"`
- `filter_sheet_tags`: `"Tags"`
- `filter_sheet_unnamed_person`: `"Unnamed"`
- `filter_sheet_when`: `"When"`
- `filter_sheet_when_custom`: `"Custom…"`
- `filter_sheet_when_month`: `"This month"`
- `filter_sheet_when_today`: `"Today"`
- `filter_sheet_when_week`: `"This week"`
- `filter_sheet_when_year`: `"This year"`
- `filter_sheet_zero_results`: `"No photos match this filter"`

Run `pnpm --filter=immich-i18n format:fix` (memory `feedback_i18n_key_sorting`). If the CLI isn't wired, fall back to `pnpm prettier --write i18n/en.json` from the `i18n/` dir.

**Commit:** `feat(mobile): i18n strings for filter sheet`

---

## Task 8 — Analyzer + full-suite test pass

1. `cd mobile && flutter analyze lib test` → 0 warnings.
2. `cd mobile && flutter test` → all pass. Per memory `feedback_no_flake_allowance`, any flaky test is a root-cause bug — fix, do not retry.
3. `dart format lib/presentation/widgets/filter_sheet lib/providers/photos_filter lib/domain/services/photos_filter_timeline.service.dart test/presentation/widgets/filter_sheet test/providers/photos_filter test/presentation/pages/dev` — verify no unexpected diffs elsewhere.
4. Check for new untranslated strings: `grep -nE '(Text|text:)\s*["\x27][A-Z]' mobile/lib/presentation/widgets/filter_sheet | grep -v l10n` — zero matches (memory §9.5 "no English-only string literals").

**Commit (only if format diff exists):** `chore(mobile): dart format filter_sheet`

---

## Task 9 — Open draft PR + babysit

1. Push: `git push -u origin feat/mobile-filter-sheet-ui`.
2. `gh pr create --draft --title "feat(mobile): photos filter sheet UI (PR 1.2)"` with body below.
3. Run the `babysit` skill on the PR. Fix any failures at root cause. **Do not merge.**

**PR body template:**

```markdown
Part of the mobile filter sheet feature. Design: [`docs/plans/2026-04-17-mobile-filter-sheet-design.md`](./docs/plans/2026-04-17-mobile-filter-sheet-design.md) §10.3 PR 1.2. Plan: [`docs/plans/2026-04-17-mobile-filter-sheet-pr1-2-plan.md`](./docs/plans/2026-04-17-mobile-filter-sheet-pr1-2-plan.md).

## What

- Filter icon in the Photos app bar with an active-indicator dot.
- `FilterSheet` — single `DraggableScrollableSheet` owning peek / browse / deep-stub snaps.
- Peek snap: chiprail built from `activeChipsFromFilter`, match count, tap-to-expand.
- Browse snap: `SearchBar`, four suggestion strips (People / Places / Tags / When), Reset, Done, match count.
- Deep snap: placeholder stub; real Deep lands in PR 1.3.
- `photosTimelineQueryProvider` + `timelineServiceProvider` override in `MainTimelinePage`: empty filter → existing library service; non-empty → page-1 search-backed `TimelineService`. Debounced 500 ms.
- Auto-peek on first filter, auto-collapse on last-chip removal (listener in `MainTimelinePage`).
- i18n strings added.

## Known limitations

- **Search-backed Timeline is page-1 only.** Pagination deferred to PR 1.2.1 follow-up.
- **PlacesStrip is single-level (country only).** Country → city cascade lands in PR 1.3 Deep.
- **SearchBar uses plain debounce** — no paste-override fast path.
- **PR 1.0 spike (§11.4) was never run.** If the DraggableScrollableSheet + keyboard interaction shows problems in manual QA, flag for a custom `ModalBottomSheet` rewrite.

## Tests

- Unit tests for `photosTimelineQueryProvider` (9 cases) and `activeChipsFromFilter` (13 cases).
- Widget tests for every new widget; see plan §Task 1-6 for per-widget coverage.

## Checklist

- [ ] `flutter analyze lib test` clean.
- [ ] `flutter test` all pass.
- [ ] No new English-only string literals.
- [ ] Manual QA: filter icon visible + dotted; sheet drag smooth; tab-switch preserves state; landscape renders; keyboard interaction acceptable.
```

---

## Risk register (supersedes prior §11.1 for this PR)

- **Timeline override propagation.** Landmarks §note confirms `Timeline`'s inner `ProviderScope` does not override `timelineServiceProvider` — outer override propagates. Test 6.2 covers this but regression risk remains if upstream changes the inner scope. Mitigation: the test explicitly asserts override-visibility through `Timeline`.
- **`TimelineFactory.fromAssets` stream semantics.** `fromAssets` takes a static `List<BaseAsset>`; the `TimelineService` wrapping it won't live-update when search results change — each filter edit rebuilds the service entirely. Acceptable for page-1-only MVP. Pagination requires `fromAssetStream` and is out-of-scope.
- **`PersonDto` equality quirks.** Audited during Task 5 start; if structural equality is used, selected-state comparisons must compare by `id` (documented in PeopleStrip). Round-trip `togglePerson(sameId-differentDto)` could create duplicates in the `Set<PersonDto>` — add a regression unit test to `photos_filter.provider.dart` tests in PR 1.1 follow-up if confirmed.
- **Keyboard + `DraggableScrollableSheet`.** PR 1.0 spike outcome never filled. Stop execution and document in §11.4 if broken during Task 4 manual pump.
- **Drag-settle write storm.** Settle-extent tolerance of 0.02 should fire once per snap settle; verify via widget tests 4.3-4.5.
- **`photosFilterCountProvider` is a placeholder** showing page-1 length (PR 1.1 comment). Tests assert "count renders whatever provider exposes", not "count == true total". Document in PR body.
