# Mobile Search: Infinite Scroll, Bigger Debounce, and Sort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile live (`photos_filter`) search load all results via infinite scroll, add web-parity sort (Relevance / Newest / Oldest), lengthen the search debounce, and delete the unused `DriftSearchPage`.

**Architecture:** The live search runs through `photosTimelineQueryProvider`, which overrides the main timeline's `timelineServiceProvider` with `buildPhotosFilterSearchTimeline(filter, 1)` — page 1 only. We replace that with an observable `PhotosFilterSearchNotifier` that pages on demand, expose it via `photosFilterSearchProvider`, drive `loadMore()` from a scroll listener on `MainTimelinePage`, add a sort field to `SearchFilter` mapped to the server `order` param, raise the debounce, and remove `DriftSearchPage` (redirecting "view similar photos" into the live search).

**Tech Stack:** Flutter 3.41.7 (via `mise exec flutter@3.41.7`), Riverpod (`hooks_riverpod`), Drift, `mocktail`, generated `openapi` Dart client (already has the `order` field — no regen).

**Design doc:** `docs/plans/2026-05-31-mobile-search-infinite-scroll-and-sort-design.md`

---

## Conventions for every task

- Run tests with: `mise exec flutter@3.41.7 -- flutter test <path>` (from `mobile/`). The worktree's `mise.toml` pins 3.41.6 — you **must** use `mise exec flutter@3.41.7`.
- The worktree needs generated files once (already present if you ran this session; otherwise):
  `mise exec flutter@3.41.7 -- dart run easy_localization:generate -S ../i18n && mise exec flutter@3.41.7 -- dart run bin/generate_keys.dart`
- After editing Dart, run `mise exec flutter@3.41.7 -- dart format <files>` before committing (line width 120).
- Commit on this branch only (`worktree-mobile-search-infinite-scroll-sort`); never push to main here.
- All paths below are relative to repo root; mobile code lives under `mobile/`.

## File structure

**Create:**

- `mobile/lib/providers/photos_filter/photos_filter_search.provider.dart` — `PhotosFilterSearchState`, `PhotosFilterSearchNotifier`, `photosFilterSearchProvider`.
- `mobile/test/models/search/search_filter_sort_test.dart`
- `mobile/test/providers/photos_filter/photos_filter_search_provider_test.dart`
- `mobile/test/providers/photos_filter/filter_debounce_provider_test.dart` (if absent)
- `mobile/test/presentation/pages/dev/main_timeline_infinite_scroll_test.dart`
- `mobile/test/presentation/widgets/photos_filter/sort_chip_test.dart`

**Modify:**

- `mobile/lib/models/search/search_filter.model.dart` — add `SearchSortOrder` + `sort` field.
- `mobile/lib/infrastructure/repositories/search_api.repository.dart` — send `order`.
- `mobile/lib/providers/photos_filter/filter_debounce.provider.dart` — 500 → 800 ms.
- `mobile/lib/providers/photos_filter/timeline_query.provider.dart` — use the notifier.
- `mobile/lib/providers/photos_filter/photos_filter.provider.dart` — `setSort`, `setSimilarTo`, sort coercion in `setText`.
- `mobile/lib/presentation/widgets/photos_filter/filter_subheader.widget.dart` — sort chip.
- `mobile/lib/presentation/pages/dev/main_timeline.page.dart` — scroll → `loadMore` + bottom indicator.
- `mobile/lib/presentation/widgets/action_buttons/similar_photos_action_button.widget.dart` — redirect to live search.
- `mobile/lib/routing/router.dart`, `mobile/lib/pages/common/tab_shell.page.dart` — drop `DriftSearchRoute`.

**Delete:**

- `mobile/lib/presentation/pages/search/drift_search.page.dart`
- `mobile/lib/presentation/pages/search/paginated_search.provider.dart`
- `mobile/test/presentation/pages/search/paginated_search_provider_test.dart`
- Orphaned-after-removal widgets/providers only used by `DriftSearchPage` (verify by grep before deleting).

---

## Task 1: `SearchSortOrder` + `SearchFilter.sort`

**Files:**

- Modify: `mobile/lib/models/search/search_filter.model.dart`
- Test: `mobile/test/models/search/search_filter_sort_test.dart`

- [ ] **Step 1 — Write the failing test**

Create `mobile/test/models/search/search_filter_sort_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';

void main() {
  test('defaults to relevance', () {
    expect(SearchFilter.empty().sort, SearchSortOrder.relevance);
  });

  test('copyWith sets and preserves sort', () {
    final f = SearchFilter.empty().copyWith(sort: SearchSortOrder.newest);
    expect(f.sort, SearchSortOrder.newest);
    expect(f.copyWith().sort, SearchSortOrder.newest);
  });

  test('sort participates in equality and hashCode', () {
    final a = SearchFilter.empty()..context = 'x';
    final b = SearchFilter.empty()..context = 'x';
    expect(a, b);
    final c = b.copyWith(sort: SearchSortOrder.oldest);
    expect(a == c, isFalse);
    expect(a.hashCode == c.hashCode, isFalse);
  });
}
```

- [ ] **Step 2 — Run it; expect failure**

Run: `mise exec flutter@3.41.7 -- flutter test test/models/search/search_filter_sort_test.dart`
Expected: compile error — `SearchSortOrder` / `sort` undefined.

- [ ] **Step 3 — Implement**

In `mobile/lib/models/search/search_filter.model.dart`, add the enum above `class SearchFilter`:

```dart
enum SearchSortOrder { relevance, newest, oldest }
```

Add the field (non-nullable, defaulted) to `SearchFilter`:

- In the field list (near `mediaType`): `SearchSortOrder sort;`
- In the constructor params: `this.sort = SearchSortOrder.relevance,`
- In `SearchFilter.empty()`: add `sort: SearchSortOrder.relevance,` (or rely on the default).
- In `copyWith(...)`: add param `SearchSortOrder? sort,` and `sort: sort ?? this.sort,`.
- In `toString()`: append `, sort: $sort`.
- In `operator ==`: add `&& other.sort == sort`.
- In `hashCode`: `^ sort.hashCode`.

No `toMap`/`fromMap` is needed — `sort` is only used in-memory (the provider detects filter changes via `==`); serialization is YAGNI.

- [ ] **Step 4 — Run it; expect pass**

Run: `mise exec flutter@3.41.7 -- flutter test test/models/search/search_filter_sort_test.dart`
Expected: PASS (3 tests).

- [ ] **Step 5 — Commit**

```bash
mise exec flutter@3.41.7 -- dart format mobile/lib/models/search/search_filter.model.dart mobile/test/models/search/search_filter_sort_test.dart
git add mobile/lib/models/search/search_filter.model.dart mobile/test/models/search/search_filter_sort_test.dart
git commit -m "feat(mobile): add SearchSortOrder to SearchFilter"
```

---

## Task 2: Send `order` to the server

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/search_api.repository.dart`
- Test: `mobile/test/infrastructure/repositories/search_api_repository_test.dart` (exists — extend)

- [ ] **Step 1 — Write the failing tests**

Append inside the existing `group('search', ...)` in `search_api_repository_test.dart`:

```dart
    test('smart search maps newest -> AssetOrder.desc', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(context: 'beach', sort: SearchSortOrder.newest);
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.order, AssetOrder.desc);
    });

    test('smart search relevance omits order', () async {
      when(() => searchApi.searchSmart(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(context: 'beach', sort: SearchSortOrder.relevance);
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchSmart(captureAny())).captured.single as SmartSearchDto;
      expect(dto.order, isNull);
    });

    test('metadata search maps oldest -> AssetOrder.asc', () async {
      when(() => searchApi.searchAssets(any())).thenAnswer((_) async => null);
      final filter = SearchFilter.empty().copyWith(sort: SearchSortOrder.oldest);
      await sut.search(filter, 1);
      final dto = verify(() => searchApi.searchAssets(captureAny())).captured.single as MetadataSearchDto;
      expect(dto.order, AssetOrder.asc);
    });
```

Add the import at the top of the test file if missing: `import 'package:immich_mobile/models/search/search_filter.model.dart';` (already present).

- [ ] **Step 2 — Run; expect failure**

Run: `mise exec flutter@3.41.7 -- flutter test test/infrastructure/repositories/search_api_repository_test.dart`
Expected: FAIL — `dto.order` is null for newest/oldest (not yet wired).

- [ ] **Step 3 — Implement**

In `search_api.repository.dart`, add a mapper near the top of the class:

```dart
  AssetOrder? _order(SearchFilter filter) => switch (filter.sort) {
    SearchSortOrder.relevance => null,
    SearchSortOrder.newest => AssetOrder.desc,
    SearchSortOrder.oldest => AssetOrder.asc,
  };
```

Add `order: _order(filter),` to **both** the `SmartSearchDto(...)` and the `MetadataSearchDto(...)` constructors in `search(...)`.

- [ ] **Step 4 — Run; expect pass**

Run: `mise exec flutter@3.41.7 -- flutter test test/infrastructure/repositories/search_api_repository_test.dart`
Expected: PASS (existing + 3 new).

- [ ] **Step 5 — Commit**

```bash
mise exec flutter@3.41.7 -- dart format mobile/lib/infrastructure/repositories/search_api.repository.dart mobile/test/infrastructure/repositories/search_api_repository_test.dart
git add mobile/lib/infrastructure/repositories/search_api.repository.dart mobile/test/infrastructure/repositories/search_api_repository_test.dart
git commit -m "feat(mobile): send sort order to search API"
```

---

## Task 3: `PhotosFilterSearchNotifier` (pagination)

**Files:**

- Create: `mobile/lib/providers/photos_filter/photos_filter_search.provider.dart`
- Test: `mobile/test/providers/photos_filter/photos_filter_search_provider_test.dart`

This notifier owns the paging state machine, dedup, and dispose guard. It does **not** know about the timeline; it exposes `getAssets()` + a `count` stream for `fromAssetStream`, and `loadMore()` for the scroll listener.

The notifier is **page-size-agnostic** — it just follows the server's `nextPage`. So the same logic and tests cover smart search (`size: 100`), metadata/filter-only search (`size: 1000`), and the "exactly `size` results → next page comes back empty → `nextPage` null" boundary (the empty/error test) without size-specific cases.

- [ ] **Step 1 — Write the failing tests**

Create `mobile/test/providers/photos_filter/photos_filter_search_provider_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/search_result.model.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter_search.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../test_utils.dart';

class _MockSearch extends Mock implements SearchService {}

class _FakeFilter extends Fake implements SearchFilter {}

List<BaseAsset> _assets(int n, String tag) =>
    List<BaseAsset>.generate(n, (i) => TestUtils.createRemoteAsset(id: '$tag-$i'));

void main() {
  setUpAll(() => registerFallbackValue(_FakeFilter()));

  PhotosFilterSearchNotifier make(SearchService s) =>
      PhotosFilterSearchNotifier(search: s, filter: SearchFilter.empty()..context = 'nature');

  test('accumulates pages until nextPage is null', () async {
    final s = _MockSearch();
    when(() => s.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p1'), nextPage: 2));
    when(() => s.search(any(), 2)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p2'), nextPage: 3));
    when(() => s.search(any(), 3)).thenAnswer((_) async => SearchResult(assets: _assets(26, 'p3'), nextPage: null));

    final n = make(s);
    addTearDown(n.dispose);
    await n.firstLoad; // page 1 kicked on construction
    expect(n.debugState.assets.length, 100);
    await n.loadMore();
    expect(n.debugState.assets.length, 200);
    await n.loadMore();
    expect(n.debugState.assets.length, 226);
    expect(n.debugState.nextPage, isNull);
    await n.loadMore(); // no-op past the end
    verify(() => s.search(any(), 1)).called(1);
    verify(() => s.search(any(), 2)).called(1);
    verify(() => s.search(any(), 3)).called(1);
  });

  test('empty/error first page stops paging (no retry loop)', () async {
    final s = _MockSearch();
    when(() => s.search(any(), any())).thenAnswer((_) async => null);
    final n = make(s);
    addTearDown(n.dispose);
    await n.firstLoad;
    expect(n.debugState.assets, isEmpty);
    expect(n.debugState.nextPage, isNull);
    expect(n.debugState.isLoading, isFalse);
    await n.loadMore();
    verify(() => s.search(any(), 1)).called(1); // never re-fetches page 1
  });

  test('dedups repeated ids across pages', () async {
    final s = _MockSearch();
    when(() => s.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p1'), nextPage: 2));
    // page 2 repeats p1-0 and adds 99 new
    when(() => s.search(any(), 2)).thenAnswer((_) async => SearchResult(
          assets: [TestUtils.createRemoteAsset(id: 'p1-0'), ..._assets(99, 'p2')],
          nextPage: null,
        ));
    final n = make(s);
    addTearDown(n.dispose);
    await n.firstLoad;
    await n.loadMore();
    expect(n.debugState.assets.length, 199); // 100 + 99, the duplicate dropped
  });

  test('dispose mid-flight => no append, no throw', () async {
    final s = _MockSearch();
    when(() => s.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p1'), nextPage: 2));
    when(() => s.search(any(), 2)).thenAnswer((_) async {
      await Future<void>.delayed(const Duration(milliseconds: 30));
      return SearchResult(assets: _assets(100, 'p2'), nextPage: 3);
    });
    final n = make(s);
    await n.firstLoad;
    final inflight = n.loadMore();
    n.dispose();
    await expectLater(inflight, completes); // dispose guard => no append, no throw on the closed stream
  });

  test('concurrent loadMore while loading is a no-op', () async {
    final s = _MockSearch();
    var calls = 0;
    when(() => s.search(any(), any())).thenAnswer((_) async {
      calls++;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      return SearchResult(assets: _assets(100, 'c$calls'), nextPage: 2);
    });
    final n = make(s);
    addTearDown(n.dispose);
    await n.firstLoad;
    final a = n.loadMore();
    final b = n.loadMore(); // should be ignored while a is in flight
    await Future.wait([a, b]);
    expect(calls, 2); // page 1 + one page-2, not two page-2s
  });

  test('count stream emits buffer length per page', () async {
    final s = _MockSearch();
    when(() => s.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p1'), nextPage: 2));
    when(() => s.search(any(), 2)).thenAnswer((_) async => SearchResult(assets: _assets(40, 'p2'), nextPage: null));
    final n = make(s);
    addTearDown(n.dispose);
    final seen = <int>[];
    final sub = n.count.listen(seen.add);
    await n.firstLoad;
    await n.loadMore();
    await Future<void>.delayed(Duration.zero);
    await sub.cancel();
    expect(seen, containsAllInOrder([100, 140]));
  });
}
```

- [ ] **Step 2 — Run; expect failure**

Run: `mise exec flutter@3.41.7 -- flutter test test/providers/photos_filter/photos_filter_search_provider_test.dart`
Expected: compile error — provider file doesn't exist.

- [ ] **Step 3 — Implement**

Create `mobile/lib/providers/photos_filter/photos_filter_search.provider.dart`:

```dart
import 'dart:async';

import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';

class PhotosFilterSearchState {
  final List<BaseAsset> assets;
  final int? nextPage;
  final bool isLoading;
  const PhotosFilterSearchState({this.assets = const [], this.nextPage = 1, this.isLoading = false});

  PhotosFilterSearchState copyWith({List<BaseAsset>? assets, int? nextPage, bool? isLoading, bool clearNextPage = false}) =>
      PhotosFilterSearchState(
        assets: assets ?? this.assets,
        nextPage: clearNextPage ? null : (nextPage ?? this.nextPage),
        isLoading: isLoading ?? this.isLoading,
      );
}

class PhotosFilterSearchNotifier extends StateNotifier<PhotosFilterSearchState> {
  final SearchService _search;
  final SearchFilter _filter;
  final _countController = StreamController<int>.broadcast();
  final _ids = <String>{};
  bool _disposed = false;

  /// Resolves when the page-1 load kicked in the constructor settles.
  late final Future<void> firstLoad;

  PhotosFilterSearchNotifier({required SearchService search, required SearchFilter filter})
      : _search = search,
        _filter = filter,
        super(const PhotosFilterSearchState()) {
    firstLoad = loadMore();
  }

  Stream<int> get count => _countController.stream;
  List<BaseAsset> getAssets() => List.unmodifiable(state.assets);

  Future<void> loadMore() async {
    if (state.nextPage == null || state.isLoading || _disposed) return;
    state = state.copyWith(isLoading: true);

    final result = await _search.search(_filter, state.nextPage!);
    if (_disposed) return;

    if (result == null) {
      // Empty results or an error — stop paging (no page-1 retry loop).
      state = state.copyWith(isLoading: false, clearNextPage: true);
      return;
    }

    final fresh = result.assets.where((a) => _ids.add(a.id)).toList(growable: false);
    final assets = [...state.assets, ...fresh];
    state = PhotosFilterSearchState(assets: assets, nextPage: result.nextPage, isLoading: false);
    if (!_countController.isClosed) _countController.add(assets.length);
  }

  @override
  void dispose() {
    _disposed = true;
    _countController.close();
    super.dispose();
  }
}
```

> `BaseAsset` exposes `id` (used by `_ids`). If the analyzer reports `id` missing on `BaseAsset`, use the concrete subtype's id accessor — `RemoteAsset.id` exists; `BaseAsset` is the sealed supertype with `id`.

- [ ] **Step 4 — Run; expect pass**

Run: `mise exec flutter@3.41.7 -- flutter test test/providers/photos_filter/photos_filter_search_provider_test.dart`
Expected: PASS (6 tests).

- [ ] **Step 5 — Commit**

```bash
mise exec flutter@3.41.7 -- dart format mobile/lib/providers/photos_filter/photos_filter_search.provider.dart mobile/test/providers/photos_filter/photos_filter_search_provider_test.dart
git add mobile/lib/providers/photos_filter/photos_filter_search.provider.dart mobile/test/providers/photos_filter/photos_filter_search_provider_test.dart
git commit -m "feat(mobile): paginating search notifier for live search"
```

---

## Task 4: Wire the notifier into the timeline

**Files:**

- Create (provider): add `photosFilterSearchProvider` to `mobile/lib/providers/photos_filter/photos_filter_search.provider.dart`
- Modify: `mobile/lib/providers/photos_filter/timeline_query.provider.dart`
- Delete: `mobile/lib/domain/services/photos_filter_search_timeline.dart` (+ its test) — replaced
- Test: `mobile/test/providers/photos_filter/photos_filter_search_provider_test.dart` (extend)

- [ ] **Step 1 — Write the failing tests**

Two things are testable cheaply: (a) the pure `isSearchActive` gate, and (b) that an
empty-filter notifier never calls the API. Append to `photos_filter_search_provider_test.dart`:

```dart
  group('search activation', () {
    test('isSearchActive gate', () {
      expect(isSearchActive(null, SearchFilter.empty()..context = 'x'), isFalse); // logged out
      expect(isSearchActive('u', SearchFilter.empty()), isFalse); // empty filter
      expect(isSearchActive('u', SearchFilter.empty()..context = 'x'), isTrue);
    });

    test('empty-filter notifier is terminal and never calls the API', () async {
      final s = _MockSearch();
      final n = PhotosFilterSearchNotifier(search: s, filter: SearchFilter.empty());
      addTearDown(n.dispose);
      await n.firstLoad;
      await n.loadMore();
      expect(n.debugState.nextPage, isNull);
      verifyNever(() => s.search(any(), any()));
    });
  });
```

> The full provider wiring (`photosFilterSearchProvider` + `photosTimelineQueryProvider`
> choosing library-vs-search) is exercised end-to-end by the widget test in Task 6, which
> pumps the real `MainTimelinePage` with the real providers + an in-memory Drift DB —
> cheaper and more faithful than overriding `currentUserProvider` here.

- [ ] **Step 2 — Run; expect failure** (`photosFilterSearchProvider` undefined).

- [ ] **Step 3 — Implement**

Add to `photos_filter_search.provider.dart`:

```dart
// at top, add imports:
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

bool isSearchActive(String? userId, SearchFilter filter) => userId != null && !filter.isEmpty;

final photosFilterSearchProvider =
    StateNotifierProvider.autoDispose<PhotosFilterSearchNotifier, PhotosFilterSearchState>((ref) {
  final filter = ref.watch(photosTimelineFilterProvider);
  final userId = ref.watch(currentUserProvider.select((u) => u?.id));
  final search = ref.watch(searchServiceProvider);

  if (!isSearchActive(userId, filter)) {
    // Terminal no-op: nextPage already null after an empty page-1 load is skipped.
    final n = PhotosFilterSearchNotifier(search: search, filter: SearchFilter.empty());
    ref.onDispose(n.dispose);
    return n;
  }
  final n = PhotosFilterSearchNotifier(search: search, filter: filter);
  ref.onDispose(n.dispose);
  return n;
});
```

> For an empty filter the notifier's page-1 `search(SearchFilter.empty(), 1)` would call the API. Avoid that: in `PhotosFilterSearchNotifier`'s constructor, if `filter.isEmpty`, set state to terminal (`nextPage: null`) and **do not** call `loadMore()`. Add at the top of the constructor body (before `firstLoad = loadMore();`):
>
> ```dart
> if (filter.isEmpty) {
>   firstLoad = Future.value();
>   state = const PhotosFilterSearchState(nextPage: null);
>   return;
> }
> ```

Rewrite `timeline_query.provider.dart`'s search branch to read the notifier:

```dart
import 'package:immich_mobile/providers/photos_filter/photos_filter_search.provider.dart';
// ...
final photosTimelineQueryProvider = Provider<TimelineService>((ref) {
  final filter = ref.watch(photosTimelineFilterProvider);
  final userId = ref.watch(currentUserProvider.select((u) => u?.id));
  final timelineUsers = ref.watch(timelineUsersProvider).valueOrNull ?? const <String>[];
  final factory = ref.watch(timelineFactoryProvider);

  if (userId == null || filter.isEmpty) {
    final svc = factory.main(timelineUsers, userId ?? '');
    ref.onDispose(svc.dispose);
    return svc;
  }

  final notifier = ref.watch(photosFilterSearchProvider.notifier);
  final svc = factory.fromAssetStream(notifier.getAssets, notifier.count, TimelineOrigin.search);
  ref.onDispose(svc.dispose);
  return svc;
});
```

Remove the `syncStatusProvider` watch and its import. This makes the spec's "no reset on
remote-content change" (§4.2) **structurally guaranteed** — the provider no longer depends on
`remoteContentChangedCount`, so there is nothing to reset and no separate test is warranted
(the absence of the `ref.watch(syncStatusProvider...)` line is the assertion; the existing
"remote content changes do not rerun the active search" intent is preserved by construction).

Before deleting the old adapter, confirm it has no other callers:

```bash
grep -rn "buildPhotosFilterSearchTimeline\|photos_filter_search_timeline" mobile/lib mobile/test
```

Expected: only `timeline_query.provider.dart` (now rewritten) and the files being deleted.
Then delete `mobile/lib/domain/services/photos_filter_search_timeline.dart` and
`mobile/test/domain/services/photos_filter_search_timeline_test.dart`.

- [ ] **Step 4 — Run; expect pass**

Run: `mise exec flutter@3.41.7 -- flutter test test/providers/photos_filter/photos_filter_search_provider_test.dart`
Then a broad compile check: `mise exec flutter@3.41.7 -- flutter analyze lib/providers/photos_filter lib/domain/services` — expect no errors about the deleted file.

- [ ] **Step 5 — Commit**

```bash
mise exec flutter@3.41.7 -- dart format mobile/lib/providers/photos_filter/photos_filter_search.provider.dart mobile/lib/providers/photos_filter/timeline_query.provider.dart
git rm mobile/lib/domain/services/photos_filter_search_timeline.dart mobile/test/domain/services/photos_filter_search_timeline_test.dart
git add -A mobile/lib/providers/photos_filter
git commit -m "feat(mobile): back live-search timeline with the paginating notifier"
```

---

## Task 5: Raise the search debounce to 800 ms

**Files:**

- Modify: `mobile/lib/providers/photos_filter/filter_debounce.provider.dart`
- Test: `mobile/test/providers/photos_filter/filter_debounce_provider_test.dart`

- [ ] **Step 1 — Write the failing test**

`photosTimelineFilterProvider` returns the _current_ value on every read; the debounce only
delays **re-emission** (via `invalidateSelf`). So you must assert on _when a listener fires_,
not on a manual read — `container.listen(...)` is the right tool.

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/providers/photos_filter/filter_debounce.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

void main() {
  test('timeline filter debounce emits at ~800ms, not at 600ms', () async {
    final c = ProviderContainer();
    addTearDown(c.dispose);
    final emitted = <String?>[];
    // Keep the provider alive and capture every debounced emission.
    c.listen<SearchFilter>(photosTimelineFilterProvider, (_, next) => emitted.add(next.context), fireImmediately: false);

    c.read(photosFilterProvider.notifier).setText('nature');
    await Future<void>.delayed(const Duration(milliseconds: 600));
    expect(emitted, isEmpty, reason: 'must not have settled before 800ms');

    await Future<void>.delayed(const Duration(milliseconds: 350)); // ~950ms total
    expect(emitted.last, 'nature');
  });

  test('suggestions debounce still emits at ~250ms', () async {
    final c = ProviderContainer();
    addTearDown(c.dispose);
    final emitted = <String?>[];
    c.listen<SearchFilter>(photosFilterDebouncedProvider, (_, next) => emitted.add(next.context), fireImmediately: false);
    c.read(photosFilterProvider.notifier).setText('beach');
    await Future<void>.delayed(const Duration(milliseconds: 350));
    expect(emitted.last, 'beach');
  });
}
```

> The essential assertion is the **800 ms boundary** (no emission at 600 ms, an emission by ~950 ms),
> guarding against silent drift. If the real-timer test proves flaky on CI, convert to
> `TestUtils.fakeAsync` and advance the clock by exactly 800 ms.

- [ ] **Step 2 — Run; expect failure**

Run: `mise exec flutter@3.41.7 -- flutter test test/providers/photos_filter/filter_debounce_provider_test.dart`
Expected: FAIL — at today's 500 ms the emission fires before 600 ms, so `emitted` is non-empty and the first assertion fails.

- [ ] **Step 3 — Implement**

In `filter_debounce.provider.dart`, change `photosTimelineFilterProvider`'s delay:

```dart
final photosTimelineFilterProvider = Provider<SearchFilter>(
  (ref) => _debouncedFilter(ref, const Duration(milliseconds: 800)),
  dependencies: const [],
);
```

Update the doc comment (`— 800 ms; feeds ...`). Leave `photosFilterDebouncedProvider` at 250 ms.

- [ ] **Step 4 — Run; expect pass.**

- [ ] **Step 5 — Commit**

```bash
mise exec flutter@3.41.7 -- dart format mobile/lib/providers/photos_filter/filter_debounce.provider.dart mobile/test/providers/photos_filter/filter_debounce_provider_test.dart
git add mobile/lib/providers/photos_filter/filter_debounce.provider.dart mobile/test/providers/photos_filter/filter_debounce_provider_test.dart
git commit -m "perf(mobile): lengthen live-search debounce to 800ms"
```

---

## Task 6: Scroll → load-more on `MainTimelinePage`

**Files:**

- Modify: `mobile/lib/presentation/pages/dev/main_timeline.page.dart`
- Test: `mobile/test/presentation/pages/dev/main_timeline_infinite_scroll_test.dart`

- [ ] **Step 1 — Write the failing widget test**

Create `main_timeline_infinite_scroll_test.dart`. This mirrors the harness proven during root-causing (in-memory Drift, `MockHttpOverrides`, `EasyLocalization` wrapper because the page reads `context.locale`):

```dart
import 'dart:io';

import 'package:drift/drift.dart' show DatabaseConnection;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/search_result.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/search.service.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/pages/dev/main_timeline.page.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/search.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter_search.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../../mock_http_override.dart';
import '../../../test_utils.dart';

class _MockSearch extends Mock implements SearchService {}

class _FakeFilter extends Fake implements SearchFilter {}

List<BaseAsset> _assets(int n, String tag) =>
    List<BaseAsset>.generate(n, (i) => TestUtils.createRemoteAsset(id: '$tag-$i'));

void main() {
  late Drift db;
  setUpAll(() async {
    HttpOverrides.global = MockHttpOverrides();
    registerFallbackValue(_FakeFilter());
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });
  tearDownAll(() => db.close());

  testWidgets('scrolling the search results loads the next page', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final search = _MockSearch();
    when(() => search.search(any(), 1)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p1'), nextPage: 2));
    when(() => search.search(any(), 2)).thenAnswer((_) async => SearchResult(assets: _assets(100, 'p2'), nextPage: 3));
    when(() => search.search(any(), 3)).thenAnswer((_) async => SearchResult(assets: _assets(40, 'p3'), nextPage: null));

    final container = ProviderContainer(
      overrides: [driftProvider.overrideWithValue(db), searchServiceProvider.overrideWithValue(search)],
    );
    addTearDown(container.dispose);

    // No EasyLocalization wrapper: the live-search path uses no context.locale; `.tr()`
    // returns keys harmlessly (verified). This matches the harness proven while root-causing.
    await tester.pumpWidget(
      UncontrolledProviderScope(container: container, child: const MaterialApp(home: MainTimelinePage())),
    );
    await tester.pump();
    container.read(photosFilterProvider.notifier).setText('nature');
    // settle the 800ms debounce + page 1
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }
    expect(container.read(photosFilterSearchProvider).assets.length, 100);

    for (var c = 0; c < 4; c++) {
      await tester.fling(find.byType(CustomScrollView).last, const Offset(0, -3000), 4000);
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
    }
    expect(container.read(photosFilterSearchProvider).assets.length, greaterThan(100));
    verify(() => search.search(any(), 2)).called(greaterThanOrEqualTo(1));
  });

  testWidgets('empty filter (library timeline) fires no search on scroll', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final search = _MockSearch();
    final container = ProviderContainer(
      overrides: [driftProvider.overrideWithValue(db), searchServiceProvider.overrideWithValue(search)],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(container: container, child: const MaterialApp(home: MainTimelinePage())),
    );
    // No setText -> empty filter -> library timeline. Fling and confirm no search request.
    for (var c = 0; c < 3; c++) {
      await tester.fling(find.byType(CustomScrollView).last, const Offset(0, -3000), 4000);
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
    }
    verifyNever(() => search.search(any(), any()));
  });
}
```

> If the full-page pump proves troublesome on CI, fall back to pumping the page's inner
> timeline subtree (the `NotificationListener` + `Timeline`) directly with the same overrides —
> it still exercises the scroll listener. Keep the in-memory Drift + `MockHttpOverrides` setup
> either way.

- [ ] **Step 2 — Run; expect failure** — no scroll listener yet, so `assets.length` stays 100.

- [ ] **Step 3 — Implement**

In `main_timeline.page.dart`, wrap the `Timeline` in a `NotificationListener<ScrollUpdateNotification>` that calls `loadMore()`, and supply a bottom indicator. Replace the `Timeline(...)` with:

```dart
NotificationListener<ScrollUpdateNotification>(
  onNotification: (n) {
    final m = n.metrics;
    if (m.axis != Axis.vertical) return false;
    final isSheet = n.context?.findAncestorWidgetOfExactType<DraggableScrollableSheet>() != null;
    if (!isSheet && m.maxScrollExtent - m.pixels < m.viewportDimension) {
      ref.read(photosFilterSearchProvider.notifier).loadMore();
    }
    return false;
  },
  child: Timeline(
    topSliverWidget: const SliverMainAxisGroup(
      slivers: [PhotosFilterSubheader(), SliverToBoxAdapter(child: DriftMemoryLane())],
    ),
    topSliverWidgetHeight: hasMemories ? 200 : 0,
    showStorageIndicator: true,
    appBar: const ImmichSliverAppBar(floating: true, pinned: false, snap: false, actions: [FilterIconButton()]),
    bottomSliverWidget: const _SearchLoadMoreFooter(),
  ),
)
```

Add the footer widget in the same file:

```dart
class _SearchLoadMoreFooter extends ConsumerWidget {
  const _SearchLoadMoreFooter();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isActive = ref.watch(photosFilterProvider.select((f) => !f.isEmpty));
    if (!isActive) return const SliverToBoxAdapter(child: SizedBox.shrink());
    final isLoading = ref.watch(photosFilterSearchProvider.select((s) => s.isLoading));
    if (isLoading) {
      return const SliverToBoxAdapter(
        child: Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
      );
    }
    final done = ref.watch(photosFilterSearchProvider.select((s) => s.nextPage == null));
    if (!done) return const SliverToBoxAdapter(child: SizedBox.shrink());
    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Center(child: Text('search_no_more_result'.tr())),
      ),
    );
  }
}
```

Add imports: `photos_filter_search.provider.dart`, `photos_filter.provider.dart`, `package:easy_localization/easy_localization.dart`. Confirm `Timeline` accepts `bottomSliverWidget` (it does — `lib/presentation/widgets/timeline/timeline.widget.dart`). Verify the `'search_no_more_result'` i18n key exists (it does — used by the old `DriftSearchPage`).

- [ ] **Step 4 — Run; expect pass.**

- [ ] **Step 5 — Commit**

```bash
mise exec flutter@3.41.7 -- dart format mobile/lib/presentation/pages/dev/main_timeline.page.dart mobile/test/presentation/pages/dev/main_timeline_infinite_scroll_test.dart
git add mobile/lib/presentation/pages/dev/main_timeline.page.dart mobile/test/presentation/pages/dev/main_timeline_infinite_scroll_test.dart
git commit -m "feat(mobile): infinite scroll for the live photos-filter search"
```

---

## Task 7: Sort chip + sort wiring

**Files:**

- Modify: `mobile/lib/providers/photos_filter/photos_filter.provider.dart` (add `setSort`, coerce in `setText`)
- Modify: `mobile/lib/presentation/widgets/photos_filter/filter_subheader.widget.dart` (sort chip)
- Test: `mobile/test/providers/photos_filter/photos_filter_provider_test.dart` (exists — extend), `mobile/test/presentation/widgets/photos_filter/sort_chip_test.dart`

- [ ] **Step 1 — Write the failing provider tests**

Append to `photos_filter_provider_test.dart`:

```dart
  test('setSort updates the filter sort', () {
    final c = ProviderContainer();
    addTearDown(c.dispose);
    c.read(photosFilterProvider.notifier).setSort(SearchSortOrder.oldest);
    expect(c.read(photosFilterProvider).sort, SearchSortOrder.oldest);
  });

  test('clearing text while Relevance coerces sort to Newest', () {
    final c = ProviderContainer();
    addTearDown(c.dispose);
    final n = c.read(photosFilterProvider.notifier);
    n.setText('beach'); // smart
    n.setSort(SearchSortOrder.relevance);
    n.setText(''); // -> metadata
    expect(c.read(photosFilterProvider).sort, SearchSortOrder.newest);
  });
```

- [ ] **Step 2 — Run; expect failure** (`setSort` undefined).

- [ ] **Step 3 — Implement provider methods**

In `photos_filter.provider.dart`:

```dart
  void setSort(SearchSortOrder sort) => state = state.copyWith(sort: sort);

  void setSimilarTo(String assetId) =>
      state = SearchFilter.empty().copyWith(assetId: assetId, mediaType: AssetType.image);
```

(`copyWith` needs an `assetId` param — it already does.) Update `setText` to coerce sort when leaving smart:

```dart
  void setText(String text) {
    final next = state.copyWith()..context = text.isEmpty ? null : text;
    // Relevance is only valid for smart (text) search; coerce to Newest for metadata.
    state = (next.context == null && next.sort == SearchSortOrder.relevance)
        ? (next.copyWith(sort: SearchSortOrder.newest))
        : next;
  }
```

- [ ] **Step 4 — Run provider tests; expect pass.**

- [ ] **Step 5 — Write the failing sort-chip widget test**

Create `sort_chip_test.dart`: pump `PhotosFilterSubheader` inside a `CustomScrollView` (see `filter_subheader_test.dart` for the harness); set a text query; assert a sort chip with key `Key('photos-filter-sort-chip')` renders showing "Relevance"; set `setSort(newest)`; assert it shows "Newest first". Then clear text (metadata) and assert tapping the chip opens a sheet **without** a Relevance option (find by the option keys you add).

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/photos_filter/filter_subheader.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  testWidgets('sort chip reflects and updates sort', (tester) async {
    await tester.pumpConsumerWidget(CustomScrollView(slivers: const [PhotosFilterSubheader()]));
    final c = ProviderScope.containerOf(tester.element(find.byType(CustomScrollView)));
    c.read(photosFilterProvider.notifier).setText('beach');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('photos-filter-sort-chip')), findsOneWidget);

    c.read(photosFilterProvider.notifier).setSort(SearchSortOrder.newest);
    await tester.pumpAndSettle();
    expect(find.text('search_sort_newest'.tr()), findsWidgets);
  });
}
```

(Use whatever i18n keys you add — see Step 6.)

- [ ] **Step 6 — Implement the sort chip**

Add three i18n keys to `i18n/en-US.json` (and run the translation codegen): `search_sort_relevance`, `search_sort_newest`, `search_sort_oldest`, `search_sort_title`. Regenerate: `mise exec flutter@3.41.7 -- dart run easy_localization:generate -S ../i18n && mise exec flutter@3.41.7 -- dart run bin/generate_keys.dart`.

In `filter_subheader.widget.dart`, insert a sort chip in the `Row` (e.g. right after `_ClearAllChip`, before the chip `ListView`). The chip shows the current sort label and on tap opens a bottom sheet of options (omit Relevance when `filter.context == null`). Pattern (Material chip + `showModalBottomSheet`):

```dart
class _SortChip extends ConsumerWidget {
  const _SortChip();
  static String _label(SearchSortOrder s) => switch (s) {
    SearchSortOrder.relevance => 'search_sort_relevance'.tr(),
    SearchSortOrder.newest => 'search_sort_newest'.tr(),
    SearchSortOrder.oldest => 'search_sort_oldest'.tr(),
  };
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final filter = ref.watch(photosFilterProvider);
    final smart = filter.context != null && filter.context!.isNotEmpty;
    final effective = (!smart && filter.sort == SearchSortOrder.relevance) ? SearchSortOrder.newest : filter.sort;
    return Material(
      key: const Key('photos-filter-sort-chip'),
      color: theme.colorScheme.primary.withValues(alpha: theme.brightness == Brightness.dark ? 0.16 : 0.22),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      child: InkWell(
        customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        onTap: () => _open(context, ref, smart, effective),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.swap_vert_rounded, size: 16, color: theme.colorScheme.primary),
            const SizedBox(width: 4),
            Text(_label(effective), style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary)),
          ]),
        ),
      ),
    );
  }

  void _open(BuildContext context, WidgetRef ref, bool smart, SearchSortOrder current) {
    final options = [if (smart) SearchSortOrder.relevance, SearchSortOrder.newest, SearchSortOrder.oldest];
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(padding: const EdgeInsets.all(16), child: Text('search_sort_title'.tr(), style: Theme.of(ctx).textTheme.titleMedium)),
          for (final o in options)
            RadioListTile<SearchSortOrder>(
              key: Key('sort-option-${o.name}'),
              value: o,
              groupValue: current,
              title: Text(_label(o)),
              onChanged: (v) {
                if (v != null) ref.read(photosFilterProvider.notifier).setSort(v);
                Navigator.of(ctx).pop();
              },
            ),
        ]),
      ),
    );
  }
}
```

Insert `const _SortChip(),` + a `SizedBox(width: 8)` into the subheader `Row`.

- [ ] **Step 7 — Run both test files; expect pass.** Run `flutter analyze` on the changed files.

- [ ] **Step 8 — Commit**

```bash
mise exec flutter@3.41.7 -- dart format mobile/lib/providers/photos_filter/photos_filter.provider.dart mobile/lib/presentation/widgets/photos_filter/filter_subheader.widget.dart mobile/test/presentation/widgets/photos_filter/sort_chip_test.dart mobile/test/providers/photos_filter/photos_filter_provider_test.dart
git add -A mobile/lib mobile/test i18n
git commit -m "feat(mobile): sort chip (relevance/newest/oldest) for live search"
```

---

## Task 8: Remove `DriftSearchPage`; redirect "view similar photos"

**Files:**

- Modify: `mobile/lib/presentation/widgets/action_buttons/similar_photos_action_button.widget.dart`
- Modify: `mobile/lib/routing/router.dart`, `mobile/lib/pages/common/tab_shell.page.dart`
- Delete: `mobile/lib/presentation/pages/search/drift_search.page.dart`, `mobile/lib/presentation/pages/search/paginated_search.provider.dart`, `mobile/test/presentation/pages/search/paginated_search_provider_test.dart`
- Test: extend `main_timeline_infinite_scroll_test.dart` or add a small redirect test

- [ ] **Step 0 — Determine the live tab shell (gates the nav edits)**

The router registers both `TabShellRoute` (old, `lib/pages/common/tab_shell.page.dart` — lists
`DriftSearchRoute()` as a bottom-nav tab) and `GalleryTabShellRoute` (new,
`lib/presentation/pages/common/gallery_tab_shell.page.dart` — **no** search tab). Find which one
is actually shown:

```bash
grep -rn "TabShellRoute()\|GalleryTabShellRoute()\|TabShellRoute.page\|GalleryTabShellRoute.page" mobile/lib
```

- If the app shows **`GalleryTabShell`** (no search tab), then `tab_shell.page.dart` +
  `DriftSearchRoute` are already dead — just delete them.
- If the app still shows the **old `TabShell`** (4 tabs incl. search), then removing the search
  tab is a **user-visible nav change** (4 → 3 tabs). Pause and confirm that's intended with the
  maintainer before editing — do **not** silently drop a visible tab.

Record the finding inline in the PR description. Everything below assumes this is resolved.

- [ ] **Step 1 — Redirect similar-photos (write the change + a test)**

Rewrite `_onTap` in `similar_photos_action_button.widget.dart`:

```dart
  void _onTap(BuildContext context, WidgetRef ref) async {
    if (!context.mounted) return;
    ref.invalidate(assetViewerProvider);
    ref.read(photosFilterProvider.notifier).setSimilarTo(assetId);
    unawaited(context.navigateTo(const MainTimelineRoute()));
  }
```

Swap imports: remove `paginated_search.provider.dart`; add `photos_filter.provider.dart`. (`MainTimelineRoute` comes from `routing/router.dart`, already imported.) Add a widget/unit test asserting that tapping calls `setSimilarTo(assetId)` (assert `photosFilterProvider` has `assetId == assetId` after tap) — pump the button in a `ProviderScope` with a stub router or assert provider state directly via a `ProviderContainer` and calling `_onTap` is not directly accessible, so assert through `setSimilarTo`:

```dart
test('setSimilarTo builds an assetId-only image filter', () {
  final c = ProviderContainer();
  addTearDown(c.dispose);
  c.read(photosFilterProvider.notifier).setSimilarTo('abc');
  final f = c.read(photosFilterProvider);
  expect(f.assetId, 'abc');
  expect(f.isEmpty, isFalse);
});
```

- [ ] **Step 2 — Delete the page + provider + route**

```bash
git rm mobile/lib/presentation/pages/search/drift_search.page.dart \
       mobile/lib/presentation/pages/search/paginated_search.provider.dart \
       mobile/test/presentation/pages/search/paginated_search_provider_test.dart
```

In `router.dart`: remove the `import '.../drift_search.page.dart';` and the `AutoRoute(page: DriftSearchRoute.page, ...)` entry. In `tab_shell.page.dart`: remove `DriftSearchRoute()` from the `routes:` list and the `searchPreFilterProvider` import + usage (the `clear()` call). Regenerate the auto_route file:
`mise exec flutter@3.41.7 -- dart run build_runner build --delete-conflicting-outputs` then `mise exec flutter@3.41.7 -- dart format lib/routing/router.gr.dart`.

- [ ] **Step 3 — Grep for orphans and remove if unused**

```bash
grep -rn "DriftSearchRoute\|paginatedSearchProvider\|searchPreFilterProvider\|SearchResultGrid\|searchInputFocusProvider" mobile/lib mobile/test
```

Each remaining reference must be removed or repointed. Delete now-orphaned files only if the grep shows zero references (e.g. `lib/providers/search/search_input_focus.provider.dart`, `_SearchSuggestions`). Do not delete blind.

- [ ] **Step 4 — Compile + full search-related tests**

Run: `mise exec flutter@3.41.7 -- flutter analyze lib` — expect zero errors.
Run the new/affected tests:
`mise exec flutter@3.41.7 -- flutter test test/providers/photos_filter test/presentation/pages/dev test/models/search test/infrastructure/repositories/search_api_repository_test.dart`
Expected: all PASS.

- [ ] **Step 5 — Commit**

```bash
mise exec flutter@3.41.7 -- dart format mobile/lib/presentation/widgets/action_buttons/similar_photos_action_button.widget.dart mobile/lib/routing/router.dart mobile/lib/pages/common/tab_shell.page.dart
git add -A mobile/lib mobile/test
git commit -m "refactor(mobile): remove unused DriftSearchPage; route similar-photos to live search"
```

---

## Task 9: Final verification

- [ ] **Step 1 — Run the full mobile suite**

Run: `mise exec flutter@3.41.7 -- flutter test`
Expected: green (note: unrelated pre-existing failures, if any, are out of scope — record them).

- [ ] **Step 2 — Analyze + format gate**

Run: `mise exec flutter@3.41.7 -- flutter analyze lib` and `mise exec flutter@3.41.7 -- dart format --set-exit-if-changed $(git diff --name-only main -- '*.dart' | sed 's#^mobile/##')` from `mobile/`.

- [ ] **Step 3 — Manual smoke (device/emulator)** — open the app, type a multi-page query (e.g. "Nature"), confirm scrolling loads past 100 to the end ("no more results"), confirm the sort chip changes order, confirm "view similar photos" opens the main timeline with similar results, confirm typing fires fewer searches (≈800 ms).

- [ ] **Step 4 — Update docs** — flip the design doc Status to "Implemented"; add a one-line note in `docs/` about `clip.maxDistance = 0.75` meaning vague queries legitimately return few results (so it isn't re-filed as a pagination bug). Run `cd docs && pnpm exec prettier --write` on any changed markdown.

---

## Self-review notes (spec coverage)

- Infinite scroll (design §3.1) → Tasks 3, 4, 6. Debounce (§3.2) → Task 5. Sort (§3.3) → Tasks 1, 2, 7. Removal (§3.4) → Task 8.
- Edge cases (design §4.7): empty/error page, dedup, dispose-guard, re-entrancy, count stream, and exactly-`size`/metadata-`1000` (size-agnostic) → Task 3; no-reset-on-sync → Task 4 (structural — watch removed); library-timeline-unaffected → Task 6 (empty-filter `verifyNever`); sort availability/coercion → Task 7; date-sort ≤500 is documented server behavior (design §3.1 + Task 9 Step 4 doc note).
- Known follow-up: the "similar photos" UX in the live search is minimal (no descriptive header). Acceptable for this PR; revisit if it confuses users.
