# Mobile search: infinite scroll, bigger debounce, and sort — design

Date: 2026-05-31
Status: Implemented (2026-05-31) — see the plan doc; all 9 tasks landed on `worktree-mobile-search-infinite-scroll-sort`.
Branch / worktree: `worktree-mobile-search-infinite-scroll-sort`

## 1. Problem

On mobile, searching (e.g. "Nature") shows **only the first 100 results**, while the
web UI shows all of them (526 for the same query on Pierre's instance). Users cannot
scroll past 100.

### Root cause (confirmed against the live instance)

The **only** mobile search path in use is the `photos_filter` **live search** on the
main timeline:

```
FilterSheet search_bar (250 ms debounce)
  → photosFilterProvider.setText(...)
    → photosTimelineFilterProvider (500 ms debounce)
      → photosTimelineQueryProvider  (overrides timelineServiceProvider on MainTimelinePage)
        → buildPhotosFilterSearchTimeline(factory, search, filter)
          → SearchService.search(filter, 1)      ← PAGE 1 ONLY
```

`buildPhotosFilterSearchTimeline` (in `lib/domain/services/photos_filter_search_timeline.dart`)
fetches **page 1 only** — its own header says _"Page-1 only — pagination deferred to PR
1.2.1."_ Smart search uses `size: 100`, so the timeline is hard-capped at 100 assets;
metadata search uses `size: 1000`, so it caps at 1000 (rarely noticed).

This was verified end-to-end:

- The server returns the full result set, paginated correctly. Mobile-exact request
  (`size:100`, `visibility:timeline`) for "Nature": page 1 → `nextPage:"2"`, page 2 →
  `nextPage:"3"`, … page 6 → 26 rows / `nextPage:null`; **526 total, zero cross-page
  overlap**.
- Every client layer **except the live-search adapter** is correct: JSON deserialization
  of `nextPage`, `SearchService.search` string→int mapping, `PaginatedSearchNotifier`
  pagination, and the `DriftSearchPage` scroll→load-more→render path all pass tests.
- The reason earlier tests passed while the bug persisted: they exercised
  **`DriftSearchPage`**, which _does_ paginate — but that page is **not used**. The live
  search (`photos_filter`) never had pagination implemented.

A secondary observation from the server logs: the live search fires a full CLIP
embed + DB query on nearly every partial word (`m` → `mount` → `mountains`), i.e. the
debounce is too short.

## 2. Goals

1. **Infinite scroll** for the live (`photos_filter`) search: scrolling the timeline
   loads page 2, 3, … until all matching results are shown.
2. **Bigger search debounce** so the live search doesn't embed+query on every keystroke.
3. **Sort** parity with web: Relevance / Newest first / Oldest first, surfaced as a
   sort chip in the filter UI.
4. **Remove the unused `DriftSearchPage`** so there is a single search path, redirecting
   its remaining callers.

Non-goals: changing the server, retuning `machineLearning.clip.maxDistance` (the
relevance cutoff — a separate concern), or the new/old tab-shell migration beyond what
removal requires.

## 3. Design

### 3.1 Infinite scroll for the live search (Feature 1a)

Replace the page-1-only `buildPhotosFilterSearchTimeline` with an **observable paginating
notifier** so the scroll listener can drive it _and_ the UI can watch its progress (the
loading/“no more” indicator). This reuses the proven `PaginatedSearchNotifier` _pattern_;
`DriftSearchPage` itself is deleted (§3.4). Using an observable notifier (not a plain
controller hidden behind a `TimelineService`) is deliberate: a bare `TimelineService`
exposes no `loadMore`/`isLoading`/`hasMore`, so the scroll listener and bottom indicator
would have nothing to call or watch.

**State** (`PhotosFilterSearchState`): `List<BaseAsset> assets`, `int? nextPage`
(starts `1`), `bool isLoading`.

**Notifier** (`PhotosFilterSearchNotifier`, `lib/providers/photos_filter/`):

- Built for a specific `(SearchService, SearchFilter)`; kicks page 1 (`loadMore()`) on
  creation.
- Exposes `List<BaseAsset> getAssets()` → `List.unmodifiable(state.assets)` and a
  broadcast `Stream<int> count`; these feed `TimelineFactory.fromAssetStream`. The `count`
  stream is **not** closed between pages.
- `Future<void> loadMore()`:
  - `if (state.nextPage == null || state.isLoading || _disposed) return;`
  - set `isLoading = true`; `result = await _search.search(filter, state.nextPage!)`.
  - **after the await, bail if `_disposed`** — the filter may have changed mid-flight; no
    stale append/emit onto a closed stream.
  - `result == null` → **treat as end-of-results**: `nextPage = null`, `isLoading = false`,
    no retry. `SearchService.search` returns `null` for both empty results _and_ errors;
    we choose "stop" so an empty query shows "no results" instead of re-fetching page 1
    forever. A transient error therefore ends paging early — the user re-triggers by
    changing the query (acceptable; the error is already logged by `SearchService`).
  - else **dedup by `asset.id`** against the existing buffer (smart search can repeat
    identical-embedding assets across pages — web parity with `search-dedup.ts`), append
    only new ids, set `nextPage = result.nextPage`, `isLoading = false`, emit the new
    length on `count`.
- `dispose()` sets `_disposed` and closes the `count` controller.

**Exposure providers** (one instance shared by the timeline override and the scroll
listener):

- `photosFilterSearchProvider` — a `StateNotifierProvider.autoDispose` that watches
  `photosTimelineFilterProvider`. Non-empty filter + logged-in → a live notifier;
  empty filter / logged-out → a terminal no-op notifier (`nextPage == null`, empty), so
  the listener can always call `loadMore()` harmlessly. Re-created when the filter (incl.
  sort) changes → pagination resets to page 1.
- `photosTimelineQueryProvider` (unchanged role — overrides `timelineServiceProvider`):
  empty filter / logged-out → `factory.main(...)`; otherwise →
  `factory.fromAssetStream(notifier.getAssets, notifier.count, TimelineOrigin.search)`
  reading the same notifier instance.

**Remote-content changes:** do **not** rebuild the search notifier on
`syncStatusProvider`’s `remoteContentChangedCount` (today’s adapter does, harmlessly,
because it only ever loads page 1). With pagination that would reset to page 1 mid-scroll
and lose loaded pages + scroll position. Search results are a server snapshot for the
query and refresh when the query changes; the plain library timeline keeps its existing
live-sync behavior.

**Scroll → loadMore on `MainTimelinePage`:** wrap the `Timeline` in a
`NotificationListener<ScrollUpdateNotification>` (the mechanism proven in the now-deleted
`SearchResultGrid`): when `metrics.maxScrollExtent - metrics.pixels <
metrics.viewportDimension` and the notification isn’t from a `DraggableScrollableSheet`,
call `ref.read(photosFilterSearchProvider.notifier).loadMore()`. It is a **no-op when no
search is active** (empty filter → the library timeline’s own DB-backed paging). The
Timeline’s `bottomSliverWidget` shows a loading spinner / “no more results” by watching
`photosFilterSearchProvider`’s `isLoading` / `nextPage == null`. `loadMore()`’s
`isLoading` guard makes repeated scroll notifications safe.

**Date-sort interaction (see §3.3):** with Newest/Oldest, the server re-sorts only the
**top-500 relevance candidates** for _smart_ search, so a date-sorted smart query
legitimately ends at ≤500 results (`nextPage` → null around page 5). This is correct
server behavior, not a cap bug. Metadata (filter-only) date sort paginates the full set.

### 3.2 Bigger debounce (Feature 1b)

Raise the **search-triggering** debounce from 500 ms → **800 ms** in
`lib/providers/photos_filter/filter_debounce.provider.dart`
(`photosTimelineFilterProvider`). Leave `photosFilterDebouncedProvider` (250 ms,
suggestions/strips) unchanged so suggestions stay responsive. Net effect: a CLIP
embed+query fires ~1.05 s after the last keystroke instead of ~0.75 s.

### 3.3 Sort (Feature 2)

Mirror the web’s three options. Model a `SearchSortOrder { relevance, newest, oldest }`
on the filter; map to the DTO `order` field (already present on the generated Dart
`SmartSearchDto`/`MetadataSearchDto` — **no OpenAPI regen**):

| Sort         | DTO `order`       | Effect                                                                                         |
| ------------ | ----------------- | ---------------------------------------------------------------------------------------------- |
| Relevance    | omit (`null`)     | Smart: embedding distance. Metadata: server default = newest.                                  |
| Newest first | `AssetOrder.desc` | `fileCreatedAt` desc. Smart: top-500 relevance candidates re-sorted by date (server CTE path). |
| Oldest first | `AssetOrder.asc`  | `fileCreatedAt` asc (same smart caveat).                                                       |

The live search only ever sets `context` (→ smart search) or filter-only fields (people,
location, date, … → metadata search); the filename/description/OCR text types are **not**
exposed here. So the sort-availability matrix reduces to two cases:

- **Smart** (text query present): Relevance + Newest + Oldest, default **Relevance**.
- **Metadata** (filter-only, no text): Newest + Oldest, Relevance hidden, default **Newest**.

Rules (match web):

- **Relevance** is offered only when a text query is present (`filter.context` non-empty).
  When the active sort is Relevance and the user clears the text (smart → metadata), coerce
  the stored sort to **Newest** (and vice-versa is fine: Newest/Oldest stay valid in both).
- Changing sort restarts pagination (search from page 1) — naturally handled because
  `photosFilterSearchProvider` re-creates when the filter (now including sort) changes.
  The new sort field **must** be in `SearchFilter`’s `==`/`hashCode`/`copyWith`. Note
  `SearchFilter.copyWith` null-coalesces, so clearing the sort (if ever needed) uses the
  `state.copyWith()..sort = …` cascade, not a null pass.
- **Default**: Relevance (preserves today’s behavior — omit `order`; for metadata the
  server default is newest, so filter-only is effectively Newest by default).

**UI — sort chip (Option B):** a `SearchFilterChip`-style chip in the
**`PhotosFilterSubheader`** (the active-filter chip row under the search bar), showing the
current sort label (e.g. "Newest first"). Tapping opens a bottom sheet — consistent with
the people/location/camera/date chips, which already open bottom sheets — listing the
available options with the current one selected; the Relevance row is omitted for
metadata/filter-only searches. Styling follows Gallery tokens (Material 3, `GoogleSans`,
primary `#4150AF`).

### 3.4 Remove `DriftSearchPage` (cleanup)

`DriftSearchPage` (submit-based search, working pagination) is unused as a search
surface but is still wired in two places. Remove the page and redirect callers:

- **Delete:** `lib/presentation/pages/search/drift_search.page.dart`,
  `lib/presentation/pages/search/paginated_search.provider.dart`, and the existing
  `test/presentation/pages/search/paginated_search_provider_test.dart`. (The diagnostic
  tests and the temporary `@visibleForTesting`/public `SearchResultGrid` tweak written
  while root-causing this bug were already reverted.) Also remove now-orphaned search
  widgets used only by `DriftSearchPage` (e.g. `SearchResultGrid`, `_SearchSuggestions`,
  the `search_input_focus`/`searchPreFilterProvider` providers) once their references are
  gone — verify with a usage grep, don’t delete blind.
- **Router:** drop the `DriftSearchRoute` registration + import in `router.dart`.
- **Old tab shell** (`lib/pages/common/tab_shell.page.dart`): remove `DriftSearchRoute()`
  from the tab list and the `searchPreFilterProvider` usage. (The newer
  `gallery_tab_shell` already has no search tab.) Confirm the intended live shell during
  implementation; if the old shell still ships with 4 tabs, removing the search tab is a
  visible nav change to validate.
- **"View similar photos"** (`similar_photos_action_button.widget.dart`): currently sets
  `searchPreFilterProvider` (assetId) and navigates to `DriftSearchRoute`. Redirect it to
  the live search: set the `photosFilterProvider` (asset-similarity context = the
  `queryAssetId` path) and navigate to `MainTimelineRoute`, so similar-photos uses the
  same paginating search. `SearchFilter.assetId` already flows to `SmartSearchDto.queryAssetId`.

If the similar-photos redirect proves larger than expected, it may be split to a
follow-up, keeping the core fix (1a/1b/2) landable.

## 4. Testing (TDD)

**Process:** strict TDD per slice (slices are enumerated in the implementation plan) —
write the failing test(s) first, implement to green, refactor. Tests target the
**live-search path**; the previous `DriftSearchPage`
tests covered the wrong path and are deleted (§3.4). Mobile tests run with
`mise exec flutter@3.41.7 -- flutter test` and need the generated `lib/generated`
(`easy_localization:generate` + `generate_keys.dart`) present in the worktree.

### 4.1 `PhotosFilterSearchNotifier` (unit)

- Accumulates pages: `100 → 200 → … → tail`; `nextPage` advances `2 → 3 → … → null`;
  `search(filter, n)` requested once per page.
- Re-entrancy: a second `loadMore()` while `isLoading` is a no-op.
- **Empty/error first page** (`search` returns `null`): `nextPage` becomes `null`,
  `isLoading` false, `assets` empty — and a subsequent `loadMore()` does **not** re-fetch
  (no page-1 loop). The UI shows “no results”.
- **Dispose guard:** dispose the notifier while a page-2 future is in flight, then resolve
  it — no append, no emit, no “add on closed StreamController” throw.
- **Dedup:** a page-2 response repeating a page-1 `id` appends only the genuinely new ids.
- **Count stream:** emits `assets.length` after each page; not closed between pages; closed
  on dispose (no leak across many pages).

### 4.2 Exposure providers (unit)

- `photosTimelineQueryProvider`: empty filter / logged-out → the main-library service;
  non-empty + logged-in → a `fromAssetStream` service over the notifier.
- `photosFilterSearchProvider`: terminal no-op notifier for empty filter; re-creates (new
  instance, pagination reset) when the filter — including the sort field — changes.
- **No reset on remote-content change:** bumping `syncStatusProvider`’s
  `remoteContentChangedCount` does **not** rebuild the search notifier / reset pages.

### 4.3 Scroll → load-more (widget)

- Pump `MainTimelinePage` (in-memory Drift + `MockHttpOverrides`, the harness proven this
  session — wrap with `EasyLocalization` since the page reads `context.locale`) with a
  mock search returning multi-page results; fling to the bottom; assert page 2+ are
  requested **and rendered** (asset count grows past the first page).
- **Exactly-`size` results** (e.g. exactly 100): one extra page returns empty →
  `nextPage` null, no infinite re-fetch, “no more results” shown.
- **Library timeline unaffected:** with an empty filter the listener’s `loadMore()` is a
  no-op and the library (DB-backed) service is used — no search request fires.

### 4.4 Sort (unit + widget)

- `SearchFilter` `==`/`hashCode`/`copyWith` include the sort field.
- `SearchApiRepository.search` sends the mapped `order` (omit for Relevance,
  `desc`/`asc` for Newest/Oldest) on **both** `SmartSearchDto` and `MetadataSearchDto`.
- Relevance hidden for filter-only (metadata) searches; clearing the text query while
  Relevance is selected coerces the sort to Newest.
- Changing sort re-creates `photosFilterSearchProvider` (pagination restarts at page 1).

### 4.5 Debounce (unit)

- `photosTimelineFilterProvider` emits the new filter at **800 ms** (asserts the value, as
  a guard against future drift); rapid successive changes collapse to a single emission;
  `photosFilterDebouncedProvider` (suggestions) still emits at 250 ms.

### 4.6 Removal (compile / route)

- App builds with `DriftSearchPage` / `paginated_search.provider` deleted; “view similar
  photos” navigates into the live search and shows similar-photo results; no dangling
  `searchPreFilterProvider` / `DriftSearchRoute` references (grep gate).

### 4.7 Edge-case checklist

| Edge case                                                              | Covered by           |
| ---------------------------------------------------------------------- | -------------------- |
| First page empty (0 results) → `nextPage` null, “no results”, no retry | 4.1                  |
| First page transient error (same `null`) → stops paging                | 4.1                  |
| Filter changes while page N in flight (dispose guard)                  | 4.1                  |
| Remote-content change mid-scroll → no reset                            | 4.2                  |
| Exactly `size` results → empty extra page → `nextPage` null            | 4.3                  |
| Cross-page duplicate ids (smart) → dedup                               | 4.1                  |
| Metadata (filter-only) pagination at `size: 1000`                      | 4.1/4.3              |
| Date sort on smart with > 500 matches → ends ≤ 500 (by design)         | doc note (§3.1/§3.3) |
| Sort change restarts paging; sort in `==`/`hashCode`                   | 4.4                  |
| Relevance hidden + coerced for filter-only                             | 4.4                  |
| Library timeline unaffected by the listener                            | 4.3                  |
| Count stream not leaked over many pages                                | 4.1                  |

## 5. Risks / open questions

- **Tab-shell migration:** which shell ships (`TabShellRoute` vs `GalleryTabShellRoute`)
  affects whether removing the search tab is user-visible. Verify before merging.
- **Smart-search cross-page duplicates:** the server notes identical-embedding dups can
  recur across pages (web dedups via `search-dedup.ts`). The "Nature" probe showed zero
  overlap, but the notifier dedups by `id` on append (§3.1) for safety / web parity.
- **`maxDistance` relevance cap (0.75):** vague queries legitimately return < 100; that is
  correct behavior and out of scope, but worth a doc note so it isn’t reported as a
  pagination bug again.

## 6. Out of scope

Server changes; relevance-threshold tuning; the broader old→new tab-shell migration;
web-side changes.
