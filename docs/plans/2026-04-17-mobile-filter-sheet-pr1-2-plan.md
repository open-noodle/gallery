# Mobile Filter Sheet — PR 1.2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the Photos-tab entry point (filter icon in the app bar), the `FilterSheet` with peek + browse snaps (deep is a stub), a 250 ms-debounced `photosFilterDebouncedProvider` feeding suggestions, and the `photosTimelineQueryProvider` that switches the Photos timeline between the library service (empty filter) and a page-1 search-backed service (non-empty filter). Design: [`2026-04-17-mobile-filter-sheet-design.md`](./2026-04-17-mobile-filter-sheet-design.md) §10.3 PR 1.2. Mockup: [`mockups/2026-04-17-mobile-filter-sheet.html`](./mockups/2026-04-17-mobile-filter-sheet.html).

**Architecture.** Thin reactive composition — UI watches `photosFilterProvider` / `photosFilterSheetProvider` / a new `photosFilterDebouncedProvider` / `photosFilterSuggestionsProvider` / `photosFilterCountProvider` and calls notifier methods. The sheet is a **single** `DraggableScrollableSheet` owning all three snap states (peek, browse, deep-stub); peek content lives inside the sheet — there is **no** standalone `PeekRail` widget. Provider changes drive both mount/unmount and programmatic snap transitions via `DraggableScrollableController.animateTo`. `photosTimelineQueryProvider` overrides `timelineServiceProvider` via a `ProviderScope` override; it builds a sync `TimelineService` — empty filter → the main-library service; non-empty + logged-in → a `TimelineService` wrapping `TimelineFactory.fromAssetStream` whose buffer is filled by `SearchService.search(filter, 1)` asynchronously and whose `Stream<int>` emits `assets.length` once the future resolves.

**Tech stack:** Flutter, `hooks_riverpod`, Material 3 theme tokens via `Theme.of(context)`, `easy_localization` for i18n (ICU plurals supported), `intl` `NumberFormat` for locale-aware counts, `flutter_test` + `mocktail`, `fake_async` for timer-based tests, the **domain-layer** `searchServiceProvider` at `mobile/lib/providers/infrastructure/search.provider.dart:8` (explicitly NOT the legacy `mobile/lib/services/search.service.dart:14` — these two providers collide in name). Existing `TimelineFactory` / `TimelineService` at `mobile/lib/domain/services/timeline.service.dart`.

**Scope guardrails:**

- **Deep state is a stub** (centered "Full filters coming in the next update"). Real Deep ships in PR 1.3.
- **No pickers.** "Search N →" affordances hidden.
- **No Search-tab retirement** (PR 1.4).
- **No orphan reconciliation** (Phase 1.5).
- **Camera strip omitted** (§4.8).
- **Pagination on the search-backed timeline deferred to PR 1.2.1.** Non-empty filter renders at most one page via the domain-layer `SearchService` → `TimelineFactory.fromAssetStream`. The domain `SearchResult.assets` is `List<BaseAsset>` (confirmed at `mobile/lib/domain/models/search_result.model.dart:4`), so the wiring is direct.
- **PlacesStrip sets `country` only** on tap (country → city cascade is PR 1.3 Deep).
- **SearchBar uses plain debounce** — no paste-override fast-path.
- **Material 3 defaults only** — no bespoke darkroom palette (§3).
- **Spillover People-chip tap body is a no-op** in PR 1.2 (the modal is PR 1.3). The × still works.
- **Zero-matches Timeline overlay** is deferred to PR 1.2.1 — Phase 1 shows whatever the Timeline does on empty input (existing empty-state). The sheet's count still shows 0.

---

## Pre-flight audits (done — outputs baked below)

- **`SearchFilter`** (`mobile/lib/models/search/search_filter.model.dart:211`): has `empty()` factory, `isEmpty` getter, structural `==` (via PR 1.1), `copyWith` null-coalesces (memory `feedback_searchfilter_copywith_cascade` — use cascade for nullable clears; PR 1.1 notifier already does this).
- **`PersonDto`** (`mobile/lib/domain/models/person.model.dart:4`): full structural `==` across `id`, `birthDate`, `isHidden`, `name`, `thumbnailPath`, `updatedAt`. **Consequence for PeopleStrip:** building a new `PersonDto` from `FilterSuggestionsPersonDto{id, name}` will mismatch any existing entry with a different thumbnailPath/isHidden/etc. PeopleStrip taps **must** resolve against state by id: if `filter.people.any((p) => p.id == fsPerson.id)`, call `togglePerson(existingPersonDto)`; else build a new minimal `PersonDto(id, name, isHidden: false, thumbnailPath: '')` and call `togglePerson(new)`. The remove path uses the existing instance to hit `Set<PersonDto>.remove` by full equality.
- **`FilterSuggestionsResponseDto`**: `{cameraMakes, countries, hasUnnamedPeople, mediaTypes, people, ratings, tags}`. `FilterSuggestionsPersonDto{id, name}`. `FilterSuggestionsTagDto{id, value}`. No thumbnail field on person DTO; PeopleStrip resolves thumbnail via `getFaceThumbnailUrl(person.id)` (`mobile/lib/utils/image_url_builder.dart:64`). Existing pattern: `CircleAvatar(backgroundImage: RemoteImageProvider(url: getFaceThumbnailUrl(person.id)))`.
- **`TimelineOrigin.search`** exists (`mobile/lib/domain/services/timeline.service.dart:34`) — use for non-empty filter.
- **`TimelineFactory.fromAssetStream(List<BaseAsset> Function() getAssets, Stream<int> assetCount, TimelineOrigin type)`** — `getAssets` returns a synchronous buffer; `assetCount` emits on data-available. Plan Task 1 builds exactly this shape.
- **`SearchService.search(SearchFilter, int page)`** — already Drift-converts results; `SearchResult.assets` is `List<Asset>`. `Asset extends BaseAsset`, so `List<Asset>` is assignable to `List<BaseAsset>` via `.cast<BaseAsset>()`.
- **`Timeline` widget** (`mobile/lib/presentation/widgets/timeline/timeline.widget.dart`) builds a nested `ProviderScope` that overrides **only** `timelineArgsProvider` and optionally `readonlyModeProvider`; it does NOT override `timelineServiceProvider`. A parent-scope override on `timelineServiceProvider` therefore propagates into `Timeline` unmodified. `timelineServiceProvider` has `dependencies: []`, the canonical override pattern.
- **`ImmichSliverAppBar`** (`mobile/lib/widgets/common/immich_sliver_app_bar.dart:26`) accepts `actions: List<Widget>?` — filter icon slots in here.
- **No `Shimmer` dependency** in mobile/pubspec. Skeleton loaders use plain `Container(color: theme.colorScheme.surfaceContainerHighest)` rectangles.
- **`photosFilterSuggestionsProvider` has no internal debounce** (PR 1.1 comment: "Debouncing intentionally lives at the consumer"). Plan Task 1.5 adds `photosFilterDebouncedProvider`.
- **`photosFilterCountProvider`** is a placeholder = page-1 length. Count never exceeds page size. Tests assert the widget binds to whatever the provider exposes, not to a "true total".

---

## Global decisions (apply across tasks)

- **Single-sheet ownership.** `FilterSheet` owns peek + browse + deep snaps internally. No standalone `PeekRail`.
- **Sheet mount gate.** Mount iff `photosFilterSheetProvider != hidden`. On `hidden`, widget returns `SizedBox.shrink()`.
- **Programmatic snap transitions.** Inside `FilterSheet`'s `ConsumerStatefulWidget` State, a `DraggableScrollableController` is created in `initState`. A `ref.listen(photosFilterSheetProvider, (prev, next) { … })` in `build` animates the controller to the target extent when the provider changes without user drag:
  ```dart
  ref.listen<FilterSheetSnap>(photosFilterSheetProvider, (prev, next) {
    if (prev == next) return;
    if (next == FilterSheetSnap.hidden) return; // unmount handled by outer build
    final target = _snapExtent(next);
    if ((_controller.size - target).abs() < 0.01) return; // already there (drag-driven)
    _controller.animateTo(target, duration: const Duration(milliseconds: 280), curve: Curves.easeOutCubic);
  });
  ```
- **Settle-driven sync back to provider.** `NotificationListener<DraggableScrollableNotification>` writes to the provider only on settle (`(extent - snap).abs() < 0.02` for some snap in `{0.15, 0.62, 0.95}`), and only if the resulting enum differs from the current provider value.
- **Hidden → peek auto-transition** (and peek → hidden on last-chip removal) lives as a `ref.listen(photosFilterProvider.select((f) => f.isEmpty), …)` in `MainTimelinePage`'s State. Fires on `true → false` (set peek iff hidden) and `false → true` (set hidden iff peek). Browse/Deep are left alone.
- **Scrim.** `Positioned.fill(child: AnimatedOpacity(opacity: scrimOpacity, duration: 150ms, child: ColoredBox(color: theme.colorScheme.scrim.withOpacity(.32))))`. Opacity 0 at peek, 0.32 at browse/deep. Tap: `GestureDetector` behind the sheet — browse→peek if non-empty else hidden, deep→browse.
- **Debounce layer (250 ms)** for suggestions — see Task 1.5.
- **Debounce layer (500 ms)** for timeline — see Task 1.
- **Material 3 theme tokens only** — `Theme.of(context).colorScheme.*`. No hardcoded colours. Dark-mode tests pair any widget with theme-dependent rendering (chips, scrim, shimmers, toggles).
- **Locale-aware numbers.** Match-count renders via `NumberFormat.decimalPattern(Intl.getCurrentLocale()).format(count)`.
- **ICU pluralisation.** `filter_sheet_match_count_photos` uses ICU: `"{count, plural, =0{No photos} =1{1 photo} other{{count} photos}}"` (`easy_localization` supports the `.plural(count)` extension — verify during Task 7).
- **A11y.** Match count wrapped in `Semantics(liveRegion: true, label: ...)`; snap-state transitions announced via `SemanticsService.announce(label, TextDirection.ltr)` when `MediaQuery.accessibleNavigation` is true.
- **Haptics.** Strip taps call `HapticFeedback.selectionClick()` on successful toggle.
- **Chip visual taxonomy.** `ActiveChipSpec` carries a `ChipVisual` enum: `person` (1-3 overlapping avatars), `tag` (Material 3 `AssistChip` with a leading coloured dot), `location` (flag glyph — Phase 1 uses `Icons.place_rounded`; a true country-flag component is deferred to PR 2.x), `when` (label only, `ff-monospace` — `TextStyle(fontFeatures: [FontFeature.tabularFigures()], letterSpacing: .4)`), `rating` (leading `★` glyph), `media` (leading icon from type), `toggle` (leading icon: heart/archive/folder), `text` (leading `Icons.search_rounded`). `ActiveFilterChip` switches rendering on `spec.visual`.

---

## Task 1 — `photosTimelineQueryProvider`

**Files:**

- Create: `mobile/lib/providers/photos_filter/timeline_query.provider.dart`
- Create: `mobile/lib/domain/services/photos_filter_search_timeline.dart` (pure helper: given `SearchService`, `SearchFilter`, `TimelineFactory` → returns a wired `TimelineService`).
- Test: `mobile/test/providers/photos_filter/timeline_query_provider_test.dart`
- Test: `mobile/test/domain/services/photos_filter_search_timeline_test.dart`

**Behaviour (synchronous `Provider<TimelineService>`; override-compatible):**

```dart
final photosTimelineQueryProvider = Provider<TimelineService>(
  (ref) {
    final filter = ref.watch(photosFilterProvider);
    final currentUserId = ref.watch(currentUserProvider.select((u) => u?.id));
    final timelineUsers = ref.watch(timelineUsersProvider).valueOrNull ?? const [];
    final factory = ref.watch(timelineFactoryProvider);

    // Pre-login OR empty filter → main library service (keeps baseline behaviour).
    if (currentUserId == null || filter.isEmpty) {
      final svc = factory.main(timelineUsers, currentUserId ?? '');
      ref.onDispose(svc.dispose);
      return svc;
    }

    // Non-empty + logged-in → search-backed sync service with async buffer fill.
    final search = ref.watch(searchServiceProvider);
    final svc = buildPhotosFilterSearchTimeline(factory: factory, search: search, filter: filter);
    ref.onDispose(svc.dispose);
    return svc;
  },
  dependencies: const [],
);
```

**`buildPhotosFilterSearchTimeline` helper:**

```dart
TimelineService buildPhotosFilterSearchTimeline({
  required TimelineFactory factory,
  required SearchService search,
  required SearchFilter filter,
}) {
  final buffer = <BaseAsset>[];
  final countCtrl = StreamController<int>.broadcast();

  // Fire-and-forget; cancellation is handled by the broadcast StreamController
  // which simply has no listeners once the service is disposed.
  () async {
    final result = await search.search(filter, 1);
    buffer
      ..clear()
      ..addAll(result?.assets ?? const <BaseAsset>[]);
    if (!countCtrl.isClosed) countCtrl.add(buffer.length);
  }();

  // Emit an initial 0 so the TimelineService knows the buffer is empty until the future resolves.
  scheduleMicrotask(() {
    if (!countCtrl.isClosed) countCtrl.add(0);
  });

  final svc = factory.fromAssetStream(() => List<BaseAsset>.unmodifiable(buffer), countCtrl.stream, TimelineOrigin.search);
  // Close the controller when the wrapping service disposes.
  // TimelineService exposes dispose(); we chain a close on top.
  return _DisposingTimelineService(inner: svc, onDispose: () async {
    if (!countCtrl.isClosed) await countCtrl.close();
  });
}
```

> **`_DisposingTimelineService`** is a thin wrapper that forwards all methods to `inner` and calls `onDispose` before forwarding `dispose()`. Document its signature inline in the helper file.

**Debounce (500 ms on filter-change → service re-creation).** A Riverpod `Provider` re-runs synchronously on its watched dependency change, so a naive implementation churns services on every keystroke/tap. Debouncing is handled in **Task 1.5** via `photosFilterDebouncedProvider` that the strips + this provider both read instead of the raw `photosFilterProvider`. **Inside `photosTimelineQueryProvider`**, we read the **debounced** filter (not raw), so service re-creation is naturally gated by Task 1.5's debounce:

```dart
// Replace ref.watch(photosFilterProvider) with:
final filter = ref.watch(photosTimelineFilterProvider); // 500ms-debounced variant exposed in Task 1.5
```

**Tests (`timeline_query_provider_test.dart`):**

1. Empty filter → `TimelineFactory.main` invoked with the user's id.
2. Non-empty filter + logged-in → `buildPhotosFilterSearchTimeline` path; `SearchService.search(filter, 1)` called once; `TimelineService` origin is `search`.
3. Pre-login (`currentUserProvider` override = `null`) + non-empty filter → main-library fallback; no search call.
4. Empty → non-empty transition disposes previous service, builds new one.
5. Non-empty → empty transition disposes search service, restores main-library service.
6. Net-zero change (toggle + untoggle same id inside `updateShouldNotify` window): zero re-creations (PR 1.1 `updateShouldNotify` coalesces).
7. `SearchService.search` returns `null` → buffer stays empty; `Stream<int>` emits 0 only; no crash.
8. Disposal: closing the outer ProviderScope disposes the service and closes the inner `StreamController`.
9. Two rapid filter changes at < 50 ms → see Task 1.5 (timeline watches debounced filter → two changes coalesce into one re-creation after the 500 ms window).

**Tests (`photos_filter_search_timeline_test.dart`, pure):**

1. Buffer fills after `SearchService.search` resolves; `Stream<int>` emits new length.
2. `getAssets()` returns an immutable view of the current buffer (mutating the returned list does not affect subsequent calls).
3. `SearchService.search` throws → buffer stays empty; `Stream<int>` emits 0 (error is logged but not rethrown).
4. `onDispose` closes the `StreamController`.

**Commit:** `feat(mobile): photosTimelineQueryProvider (empty/search switcher)`

---

## Task 1.5 — `photosFilterDebouncedProvider` + `photosTimelineFilterProvider`

**Files:**

- Create: `mobile/lib/providers/photos_filter/filter_debounce.provider.dart`
- Test: `mobile/test/providers/photos_filter/filter_debounce_provider_test.dart`

**Behaviour:**

Two derived providers, both sync `Provider<SearchFilter>`:

```dart
final photosFilterDebouncedProvider = Provider<SearchFilter>((ref) {
  return _debounced(ref, source: photosFilterProvider, ms: 250);
}, dependencies: [photosFilterProvider]);

final photosTimelineFilterProvider = Provider<SearchFilter>((ref) {
  return _debounced(ref, source: photosFilterProvider, ms: 500);
}, dependencies: [photosFilterProvider]);

SearchFilter _debounced(Ref ref, {required NotifierProvider<PhotosFilterNotifier, SearchFilter> source, required int ms}) {
  // Emission pattern: synchronously return current state on first read; schedule a Timer on changes; re-expose the latest value after Timer fires via ref.invalidateSelf().
  // Implementation uses ref.listen(source, (prev, next) { _timer?.cancel(); _timer = Timer(…, () => ref.invalidateSelf()); });
  // and a local state-in-closure latest-value cache.
}
```

**Alternative (simpler):** hand-rolled `StateNotifier<SearchFilter>` that listens to `photosFilterProvider` and writes through after a timer. Pick whichever compiles cleanly — both satisfy the contract.

**Consumers:**

- Strips (Task 5) watch `photosFilterDebouncedProvider` and pass it into `photosFilterSuggestionsProvider(debounced)`.
- `photosTimelineQueryProvider` (Task 1) watches `photosTimelineFilterProvider`.
- `PeekContent` and `MatchCountFooter` (Task 4) watch `photosFilterProvider` **directly** (chips update instantly; count debounces because the count provider itself reads the debounced filter — see below).

**Update `photosFilterCountProvider`** to watch `photosFilterDebouncedProvider` instead of `photosFilterProvider`. This is the only modification to a PR 1.1 file; confirmed minimal and safe (PR 1.1 count provider was already flagged as placeholder). One extra commit.

**Tests:**

1. Initial read synchronously returns current filter state.
2. Source change → debounced provider still returns prior value during the window (FakeAsync).
3. After `ms` elapses → debounced provider returns new value.
4. Two rapid changes within the window coalesce into one new-value emit.
5. `dispose` cancels pending timer.

**Commits:**

- `feat(mobile): photosFilterDebouncedProvider + photosTimelineFilterProvider`
- `refactor(mobile): photosFilterCountProvider reads debounced filter`

---

## Task 2 — `FilterIconButton`

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/filter_icon_button.widget.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/filter_icon_button_test.dart`

**Behaviour:**

- `ConsumerWidget`. Icon: `Icons.tune_rounded`.
- Active indicator: `Stack` with a `Positioned(top: 8, right: 8, child: Container(w: 8, h: 8, decoration: BoxDecoration(color: theme.colorScheme.primary, shape: BoxShape.circle, border: Border.all(color: theme.colorScheme.surface, width: 1.5))))` — the 1.5pt border gives a halo against the app-bar icon at any theme.
- `onPressed` → `ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse` (always browse).
- Semantics: `Semantics(button: true, label: filter.isEmpty ? 'filter'.tr() : 'filter_button_active'.tr(), child: IconButton(...))`.

**Tests (light + dark variants where visual):**

1. Empty filter → no dot (find `Key('filter-active-dot')` returns 0).
2. Parameterised `group` over 10 dimensions (person / tag / location / date / rating / mediaType / fav / archive / notInAlbum / text) → dot rendered.
3. Tap with sheet `hidden` → sheet becomes `browse`.
4. Tap with sheet `peek` → sheet becomes `browse`.
5. Tap with sheet `browse` → stays `browse` (assert no additional writes via a listener counter).
6. Tap with sheet `deep` → sheet becomes `browse` (§7 edge case).
7. Semantics label reflects state (empty ↔ non-empty).
8. Dark mode variant: dot is still visible (foregroundDot vs background contrast ≥ 3:1 — spot check via pixel).

**Commit:** `feat(mobile): FilterIconButton with active-indicator dot`

---

## Task 3 — `ActiveChipSpec` + `activeChipsFromFilter` + `ActiveFilterChip`

**Files:**

- Create: `mobile/lib/providers/photos_filter/active_chips.dart` — pure dart.
- Create: `mobile/lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart`
- Test: `mobile/test/providers/photos_filter/active_chips_test.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/active_filter_chip_test.dart`

**Spec:**

```dart
enum ChipVisual { person, tag, location, when, rating, media, toggle, text }

class ActiveChipSpec {
  final ChipId id;
  final String label;
  final ChipVisual visual;
  /// For person: up to 3 ids for leading overlapping avatars (collapsed chip has 3+).
  final List<String>? avatarPersonIds;
  /// For tag: Material swatch seed colour (derived from tag id hash).
  final int? tagDotSeed;
  /// For media/toggle: leading icon.
  final IconData? icon;
  const ActiveChipSpec({
    required this.id,
    required this.label,
    required this.visual,
    this.avatarPersonIds,
    this.tagDotSeed,
    this.icon,
  });
}

/// Pure. Order: people → tags → location → date → rating → media → favourite → archive → notInAlbum → text.
List<ActiveChipSpec> activeChipsFromFilter(
  SearchFilter filter, {
  FilterSuggestionsResponseDto? suggestions, // for tag name resolution only
});
```

**Rules (explicit + exhaustive):**

- **People.** `filter.people` is `Set<PersonDto>`. Order by insertion (use `Set.toList()`). First 2 → individual chips with a single-avatar spec. If size > 2, emit **one combined spillover chip** labeled `"${p0.name}, ${p1.name} +${size-2}"` with `avatarPersonIds = [p0.id, p1.id, p2.id]` (first three) and `ChipId = PersonChipId(p2.id)` (the first collapsed id — tapping × removes only p2). Chip body tap is a no-op in PR 1.2 (modal is 1.3). The "Emma, Lars +1" pattern matches design §5.5. **Edge:** exactly 2 people → 2 individual chips (no spillover). Exactly 3 people → 2 individual chips + 1 spillover labeled "Alice, Bob +1" with 3 avatars.
- **Tags.** Per `filter.tagIds ?? const []`: one `TagChipId(id)` per id; label resolved from `suggestions?.tags.firstWhereOrNull((t) => t.id == id)?.value ?? 'filter_sheet_tag_fallback'.tr()`. `tagDotSeed = id.hashCode`; the widget maps this to a deterministic Material 3 accent via `Color((seed & 0xFFFFFF) | 0xFF000000)` modulated by `colorScheme.primary` lightness.
- **Location.** Single chip iff `country != null || state != null || city != null`. Label = non-null fields joined `" · "` (e.g., `"France · Paris"`). Visual = `location`. **Defensive:** all-null location returns **no chip** (regression test).
- **Date.** Single chip iff `takenAfter != null || takenBefore != null`. Label uses `DateFormat.yMMM(Intl.getCurrentLocale())`:
  - Both set + same month: `"Apr 2024"`.
  - Both set + different months: `"Apr 2024 – Dec 2024"`.
  - Only `takenAfter`: `"After Apr 2024"`.
  - Only `takenBefore`: `"Before Dec 2024"`.
- **Rating.** Single chip iff `rating != null && rating > 0`. Label `"★ $rating+"`.
- **MediaType.** Single chip iff `mediaType != AssetType.other`. Label = i18n keyed by enum.
- **Favourites / Archived / NotInAlbum.** One chip each when the flag is true.
- **Text.** Chip iff `context?.trim().isNotEmpty == true`. Label = `'"${context!.trim()}"'` truncated to 24 chars + `…` if longer.

**Tests (`active_chips_test.dart`, table-driven):**

1. Empty filter → `[]`.
2. Parameterised per-dimension: one chip emitted per dimension set (10 cases).
3. 2 people → 2 individual chips, no spillover.
4. 3 people → 2 individual chips + 1 spillover "Alice, Bob +1" with 3 avatars.
5. 5 people → 2 individual + 1 spillover "Alice, Bob +3" with 3 avatars (first three ids).
6. Location with only `country` set → single chip "France".
7. Location with all fields null → no chip.
8. Text chip with `"   "` (whitespace) → no chip.
9. Text chip with 30-char string → label truncated to 24 chars + `…`.
10. Rating = 0 → no chip. Rating = null → no chip. Rating = 4 → chip.
11. MediaType = `other` → no chip. `image` → chip with `Icons.photo_rounded`, i18n label "Photos".
12. Tag id in suggestions → resolved label. Tag id NOT in suggestions → fallback "Tag" (regression for §7 C2).
13. Person id in state but NOT in suggestions → chip still rendered (spec's label is `person.name` from state, not from suggestions).
14. Date both-set same month → "Apr 2024".
15. Date only-after → "After Apr 2024".
16. Date only-before → "Before Apr 2024".
17. Chip order on full filter: people → tags → location → date → rating → media → fav → archive → notInAlbum → text.

**`ActiveFilterChip` widget:**

- Input: `ActiveChipSpec`.
- Renders a Material 3 `InputChip` (or a custom `Material` + `InkWell` if `InputChip` doesn't support our leading variants cleanly).
- Leading:
  - `person`: `SizedBox(width: 24 * overlapCount, child: Stack(children: avatars))` — overlapping `CircleAvatar(radius: 12, backgroundImage: RemoteImageProvider(url: getFaceThumbnailUrl(id)))` widgets offset by 12pt each.
  - `tag`: `Container(width: 8, height: 8, decoration: BoxDecoration(shape: circle, color: seedColor))`.
  - `location`: `Icon(Icons.place_rounded, size: 16)`.
  - `when`: no leading; label uses tabular-figures text style.
  - `rating`, `media`, `toggle`, `text`: `Icon(spec.icon, size: 16)`.
- Label: `Text(spec.label, maxLines: 1, overflow: TextOverflow.ellipsis)`.
- Trailing: `IconButton(icon: Icon(Icons.close_rounded, size: 18), onPressed: _remove, tooltip: 'remove_filter'.tr())` with a minimum 32×32 pt tap target, wrapped in a row that pads the chip to ≥ 44 pt total (§9.6).
- `_remove`: `HapticFeedback.selectionClick(); ref.read(photosFilterProvider.notifier).removeChip(spec.id);`.
- Semantics: `Semantics(label: '${spec.label}, ${'remove_filter'.tr()}', button: true, child: …)`.

**Widget tests (light + dark):**

1. Renders label + × button.
2. `person` spec with 3 avatarPersonIds → 3 overlapping `CircleAvatar`s (mock image via `TestImage.load` pattern; don't fetch real URL).
3. `tag` spec → coloured dot.
4. `location` spec → `Icons.place_rounded`.
5. `when` spec → label uses `FontFeature.tabularFigures`.
6. `rating`/`media`/`toggle`/`text` → icon from spec.
7. × tap calls `photosFilterProvider.notifier.removeChip(spec.id)` — verified via a stub notifier.
8. Label with ellipsis truncation: long label → truncated with `…`.
9. Haptic feedback is triggered on × tap (verify via `ServicesBinding.instance.defaultBinaryMessenger` spy on `HapticFeedback` channel).
10. Dark mode pair: leading tag-dot colour adjusts for contrast.

**Commits:**

- `feat(mobile): activeChipsFromFilter helper + ActiveChipSpec`
- `feat(mobile): ActiveFilterChip widget with per-visual rendering`

---

## Task 4 — `FilterSheet` + snap contents

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/filter_sheet.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/peek_content.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/browse_content.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/deep_stub_content.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/search_bar.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/match_count_footer.widget.dart`
- Create: `mobile/lib/presentation/widgets/filter_sheet/drag_handle.widget.dart` (shared pill)
- Create: `mobile/lib/presentation/widgets/filter_sheet/match_count_label.widget.dart` (shared; used by peek + footer)
- Tests: one per widget under `mobile/test/presentation/widgets/filter_sheet/`.

**`FilterSheet` (ConsumerStatefulWidget):**

- State fields: `late final DraggableScrollableController _controller = DraggableScrollableController()`.
- In `initState`: nothing else.
- In `dispose`: `_controller.dispose()`.
- `build`:

  ```dart
  final snap = ref.watch(photosFilterSheetProvider);
  if (snap == FilterSheetSnap.hidden) return const SizedBox.shrink();

  ref.listen<FilterSheetSnap>(photosFilterSheetProvider, (prev, next) {
    if (next == FilterSheetSnap.hidden) return;
    final target = _snapExtent(next);
    if ((_controller.size - target).abs() < 0.01) return;
    _controller.animateTo(target, duration: const Duration(milliseconds: 280), curve: Curves.easeOutCubic);
    if (MediaQuery.of(context).accessibleNavigation) {
      SemanticsService.announce(_snapAnnouncement(next), TextDirection.ltr);
    }
  });

  return Stack(children: [
    Positioned.fill(child: _Scrim(visible: snap != FilterSheetSnap.peek)),
    NotificationListener<DraggableScrollableNotification>(
      onNotification: _onSettle,
      child: DraggableScrollableSheet(
        controller: _controller,
        initialChildSize: _snapExtent(snap),
        minChildSize: 0.15,
        maxChildSize: 0.95,
        snap: true,
        snapSizes: const [0.15, 0.62, 0.95],
        builder: (ctx, scrollController) => _snapChild(snap, scrollController),
      ),
    ),
  ]);
  ```

- `_onSettle(notification)`: if `(notification.extent - snap).abs() < 0.02` for some snap in `{0.15, 0.62, 0.95}`, map to `FilterSheetSnap` and `ref.read(photosFilterSheetProvider.notifier).state = value;` iff differs. Return `false` (don't consume — other listeners may care).
- `_Scrim` is a tap-absorbing overlay rendered opacity 0.32 when snap ∈ {browse, deep}, 0 when peek. Taps route: browse→peek if `!isEmpty` else hidden; deep→browse.
- `_snapChild`:
  - `FilterSheetSnap.peek` → `PeekContent(scrollController)`.
  - `FilterSheetSnap.browse` → `BrowseContent(scrollController)`.
  - `FilterSheetSnap.deep` → `DeepStubContent(scrollController)`.

**`PeekContent`:**

- `Material(elevation: 8, color: theme.colorScheme.surface, borderRadius: vertical(top: 16))`.
- `Column(children: [DragHandle(onTap: _toBrowse), Padding(child: Row(children: [Expanded(horizontal chip ListView), MatchCountLabel()]))])`.
- Horizontal `ListView.separated(scrollDirection: Axis.horizontal)` of `ActiveFilterChip`s built from `activeChipsFromFilter(filter, suggestions)` where `filter = ref.watch(photosFilterProvider)` and `suggestions = ref.watch(photosFilterSuggestionsProvider(ref.watch(photosFilterDebouncedProvider))).valueOrNull`.
- Fading edges: overlay `ShaderMask` with a horizontal gradient to fade both ends (taper chip rail into the scroll direction).
- Tap on drag handle → sheet = browse.
- **Cannot show when isEmpty + hidden** per sheet mount gate (the sheet is already unmounted when snap == hidden).

**`BrowseContent`:**

- The sheet's builder gives us a `scrollController`; we use it on a `CustomScrollView` with slivers:
  1. `SliverPersistentHeader(pinned: true)` — header with drag handle + title ("filter_sheet_title") + Reset (`TextButton(onPressed: _reset, child: Text('filter_sheet_reset'.tr()))` iff `!isEmpty`).
  2. `SliverToBoxAdapter(child: Padding(child: SearchBar()))`.
  3. `SliverToBoxAdapter(child: PeopleStrip())`.
  4. `SliverToBoxAdapter(child: PlacesStrip())`.
  5. `SliverToBoxAdapter(child: TagsStrip())`.
  6. `SliverToBoxAdapter(child: WhenStrip())`.
  7. `SliverPadding` with bottom inset for the footer.
- A `Positioned(bottom: 0, left: 0, right: 0, child: MatchCountFooter())` — NOT inside the scroll view, so it stays pinned. The footer's height is reserved by the sliver padding above.
- Reset button tap → `HapticFeedback.mediumImpact(); ref.read(photosFilterProvider.notifier).reset();`.

**`DeepStubContent`:**

- `Material` + rounded top corners, drag handle, centred `Text('filter_sheet_deep_stub'.tr(), textAlign: center)`.

**`SearchBar` (ConsumerStatefulWidget):**

- `TextEditingController _controller`. `FocusNode _focus`. `Timer? _debounce`.
- `initState`: `_controller = TextEditingController(text: ref.read(photosFilterProvider).context ?? '')`.
- `build`:
  ```dart
  ref.listen<String?>(photosFilterProvider.select((f) => f.context), (prev, next) {
    final v = next ?? '';
    if (_controller.text == v) return;
    _controller.text = v;
    _controller.selection = TextSelection.collapsed(offset: v.length);
  });
  ```
- `onChanged`: cancel debounce, schedule `Timer(250 ms, () => notifier.setText(_controller.text))`.
- Trailing × visible when `_controller.text.isNotEmpty`. Tap: cancel debounce, `_controller.clear()`, `notifier.setText('')`.
- `onSubmitted`: no-op beyond `_focus.unfocus()` (Return-key dismisses keyboard; filter is live).
- Hint: `'filter_sheet_search_hint'.tr()`.
- `dispose`: debounce cancel, controller dispose, focus dispose.

**`MatchCountLabel` (shared, a11y live region):**

```dart
final count = ref.watch(photosFilterCountProvider);
final label = count.when(
  data: (c) => 'filter_sheet_match_count_photos'.plural(c),
  loading: () => 'filter_sheet_match_count_loading'.tr(),
  error: (_, __) => 'filter_sheet_match_count_loading'.tr(),
);
return Semantics(liveRegion: true, label: label, child: Text(label));
```

**`MatchCountFooter`:**

- `Material(elevation: 3, color: theme.colorScheme.surface)` pinned bottom.
- `Row(children: [MatchCountLabel(), Spacer(), TextButton.filled(onPressed: _done, child: Text('filter_sheet_done'.tr()))])`.
- `_done`: `ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.hidden;`.

**`DragHandle`:** shared widget; 32×4 pt pill, `theme.colorScheme.onSurfaceVariant`, centred, `GestureDetector.onTap` → caller-provided callback.

**Tests — `FilterSheet`:**

1. Snap = hidden → `find.byType(DraggableScrollableSheet)` evaluates to 0.
2. Snap = peek / browse / deep → present with correct `initialChildSize` (introspection via widget tree traversal or use Keys).
3. Drag-up from peek → browse: `await tester.drag(find.byType(DraggableScrollableSheet), Offset(0, -screenH * .5)); await tester.pumpAndSettle();` → provider becomes `browse`.
4. Drag-up from browse → deep (same idiom, larger delta).
5. Drag-down from deep → browse.
6. Drag-down from browse → peek (when `!isEmpty`).
7. Drag-down from browse → hidden (when `isEmpty` — sheet fully dismisses).
8. Drag-down from peek (swipe) → hidden.
9. Programmatic transition via provider write (e.g., set state = browse from peek) → `_controller.animateTo(0.62)` invoked (verify via fake controller spy or observe final extent after settle).
10. Settle tolerance: extent = 0.615 → provider updated to `browse`. Extent = 0.60 → unchanged (0.02 floor).
11. Scrim tap at browse, `!isEmpty` → peek.
12. Scrim tap at browse, `isEmpty` → hidden.
13. Scrim tap at deep → browse.
14. Cold-start: provider defaults `hidden`; widget renders empty; no DraggableScrollableSheet mounted (§7 cold-start policy).
15. a11y announcement: with `MediaQuery(accessibleNavigation: true)`, provider change to `deep` calls `SemanticsService.announce` — verify via `SemanticsHandler` spy (or assert the call happens via a test hook).

**Tests — `PeekContent`:**

1. Renders chips (one per active-filter dimension).
2. Horizontal scroll: inject 30 chips (5 people + 25 tags via state), verify the listview is scrollable (`tester.drag(find.byType(ListView), Offset(-500, 0))`, verify first chip is off-screen).
3. Fading edge ShaderMask is present (find by Key).
4. Match count label updates on provider change.
5. Tap on drag handle → sheet = browse.

**Tests — `BrowseContent`:**

1. Renders header + SearchBar + 4 strips + footer in order.
2. Reset button visible only when `!isEmpty`.
3. Reset tap calls `notifier.reset()`.

**Tests — `SearchBar`:**

1. Initial controller text matches `filter.context`.
2. Typing "p" + "a" + "r" + "i" + "s" inside 250 ms → exactly one `setText('paris')` call after the timer fires (FakeAsync).
3. After initial `setText('paris')`, Reset externally clears filter.context → `_controller.text` is ''; cursor at 0.
4. Clear × tap calls `setText('')` immediately; no debounce wait.
5. Return-key: `onSubmitted` triggers `_focus.unfocus()` and does NOT call `setText` again.
6. **Integration with footer count**: sheet-handle count updates 250 ms after typing (driven by the upstream debounced filter → count provider).
7. Paste via long-press → onChanged fires with pasted text; 250 ms debounce applies (no special fast-path).
8. Focus-lost during sheet drag: verify text is preserved in state after the drag settles (just a pump-through test).

**Tests — `MatchCountLabel`:**

1. Count = 0 renders "No photos" (ICU zero).
2. Count = 1 renders "1 photo".
3. Count = 42 renders "42 photos".
4. Count = 1247 with en_US locale renders "1,247 photos".
5. Loading renders `—`.
6. Error renders `—`.
7. `Semantics.liveRegion` is true (verified by `find.bySemanticsLabel` + `tester.getSemantics`).

**Tests — `MatchCountFooter`:**

1. Renders label + Done.
2. Done tap → sheet hidden.

**Tests — `DeepStubContent`:**

1. Renders stub message.

**Commits (one per widget):**

- `feat(mobile): FilterSheet scaffold with settle-driven + programmatic snap sync`
- `feat(mobile): PeekContent with chip rail and fading edges`
- `feat(mobile): BrowseContent with sliver layout + Reset`
- `feat(mobile): DeepStubContent`
- `feat(mobile): SearchBar with external-clear sync and a11y`
- `feat(mobile): MatchCountLabel (shared) + MatchCountFooter`

---

## Task 5 — Browse strips

**Files:**

- Create: `mobile/lib/presentation/widgets/filter_sheet/strips/strip_scaffold.widget.dart` (shared shell with title, loading/error/empty handling).
- Create: `people_strip.widget.dart`, `places_strip.widget.dart`, `tags_strip.widget.dart`, `when_strip.widget.dart`.
- Tests: one per strip.

**`StripScaffold`:**

```dart
class StripScaffold<T> extends ConsumerWidget {
  final String titleKey;
  final AsyncValue<List<T>> items;
  final double height;
  final Widget Function(BuildContext, WidgetRef, List<T>) childrenBuilder;
  final VoidCallback onRetry;
  final bool? isOffline;
  // …
}
```

- Header row: `Text(titleKey.tr(), style: titleSmall)` + optional `isOffline` badge (`Chip(label: Text('filter_sheet_offline'.tr()), avatar: Icon(Icons.wifi_off_rounded))`).
- Content:
  - `AsyncLoading` → skeleton row: 3 placeholder rectangles sized per strip (52pt circle for People, 104×72 with 14pt radius for Places, 999pt pill for Tags, 14pt-radius rect for When) — see Mockup alignment → Dimensional spec.
  - `AsyncError(e)` → single tap-to-retry tile with `'filter_sheet_load_error_retry'.tr()`; tap calls `onRetry`.
  - `AsyncData([])` → `SizedBox.shrink()` (entire strip collapses).
  - `AsyncData([...])` → horizontal `ListView.builder` calling `childrenBuilder`.

**All four strips pass `photosFilterDebouncedProvider` into the suggestions lookup:**

```dart
final filter = ref.watch(photosFilterDebouncedProvider);
final suggestionsAsync = ref.watch(photosFilterSuggestionsProvider(filter));
final itemsAsync = suggestionsAsync.whenData((s) => s.people); // or tags, countries, etc.
```

**`PeopleStrip`:** (dimensions per Mockup alignment)

- Item: 58pt cell, 52pt `CircleAvatar` thumb, 10.5pt caption, single-line ellipsis.
- Selected visual: thumb scales 1.04, 2pt `primary` ring + 4pt `primary.withOpacity(.14)` halo + soft glow `BoxShadow` (Mockup alignment → Active-state).
- On tap:
  ```dart
  HapticFeedback.selectionClick();
  final existing = ref.read(photosFilterProvider).people.firstWhereOrNull((p) => p.id == fsPerson.id);
  if (existing != null) {
    ref.read(photosFilterProvider.notifier).togglePerson(existing); // remove via full equality
  } else {
    final minimal = PersonDto(id: fsPerson.id, name: fsPerson.name, isHidden: false, thumbnailPath: '');
    ref.read(photosFilterProvider.notifier).togglePerson(minimal); // add
  }
  ```

**`PlacesStrip`:** (dimensions per Mockup alignment)

- Item: 104×72pt container, 14pt border radius, with a linear gradient overlay (alpha 0 → 0.75) at the bottom. Country `labelLarge` in paper colour, mono uppercase subtitle.
- Selected: 2pt `primary` ring + primary glow `BoxShadow`.
- On tap: if selected, `setLocation(null)`; else `setLocation(SearchLocationFilter(country: country))`.

**`TagsStrip`:**

- Item: Material 3 `FilterChip(label: Text("${tag.value} · ${tag.count ?? ''}"), selected: filter.tagIds?.contains(tag.id) == true, onSelected: (_) => { haptic(); toggleTag(tag.id); })`.
- The `FilterSuggestionsTagDto` has no `count` field in the generated DTO — check at audit; if absent, drop the count badge in the label.

**`WhenStrip`:** (dimensions per Mockup alignment — 14pt radius distinct from tag pill's 999pt)

- Static list of 5 rounded rectangles (14pt radius, 9×14pt padding): Today / This week / This month / This year / Custom…
- Implement as `Material(borderRadius: 14) + InkWell`; NOT `ActionChip` (which would force a 999pt pill shape).
- `_apply(preset)`: compute `(start, end)` from `DateTime.now()`, call `setDateRange(start: start, end: end)`.
- Selected pill: the one whose `(start, end)` matches `filter.date.takenAfter` and `filter.date.takenBefore` at day granularity.
- Custom…: `final range = await showDateRangePicker(context: context, firstDate: DateTime(1970), lastDate: DateTime.now()); if (range != null) setDateRange(start: range.start, end: range.end);`. Cancel → no state change.

**Tests per strip (9 tests × 4 strips, all in light + dark where visual):**

1. `AsyncLoading` → 3 skeleton placeholders.
2. `AsyncError` → retry tile with i18n key; tap calls `ref.refresh(photosFilterSuggestionsProvider(filter).future)`.
3. `AsyncData([])` → entire strip returns `SizedBox.shrink()`.
4. `AsyncData([item])` → renders 1 item (exactly-one regression).
5. `AsyncData([multiple])` → items in order.
6. Tap on unselected item → correct notifier call with correct args.
7. Tap on selected item → correct un-select call (PlacesStrip: `setLocation(null)`; others: toggle).
8. Selected visual: asserts find-by-Key for `selected` border.
9. Haptic feedback fires on tap (spy on platform channel).

**PeopleStrip extras:**

- Toggling a person already in `filter.people` with a different `birthDate` does not duplicate entries (regression for `PersonDto` structural equality).

**PlacesStrip extras:**

- Untap → sets filter.location to empty (all fields null).

**WhenStrip extras:**

- Custom range picker cancel → no state change (verified by a fake picker that returns null).
- Custom range picker with a valid range → `setDateRange` called with those values.
- Preset selection matching computed "This month" is the selected pill (boundary test at month-start).

**Commits (one per strip + scaffold):**

- `feat(mobile): StripScaffold (loading/error/empty + offline badge)`
- `feat(mobile): PeopleStrip`
- `feat(mobile): PlacesStrip`
- `feat(mobile): TagsStrip`
- `feat(mobile): WhenStrip`

---

## Task 6 — Host wiring in `MainTimelinePage`

**Files:**

- Modify: `mobile/lib/presentation/pages/dev/main_timeline.page.dart` → `ConsumerStatefulWidget`.
- Test: `mobile/test/presentation/pages/dev/main_timeline_page_test.dart`.

**Changes:**

- `ProviderScope(overrides: [timelineServiceProvider.overrideWith((ref) => ref.watch(photosTimelineQueryProvider))], child: _Body(...))`.
  - Riverpod 2 syntax: `overrideWith` on a `Provider<T>` accepts a new create fn returning `T`. Since `photosTimelineQueryProvider` is `Provider<TimelineService>` with `dependencies: []`, reading it via `ref.watch` inside the override create fn is correct and propagates disposals.
- Inside `_Body` state: `ref.listen<bool>(photosFilterProvider.select((f) => f.isEmpty), (prev, next) { … })` with the auto-peek logic.
- Stack:
  - Layer 0: `Timeline(appBar: ImmichSliverAppBar(actions: [FilterIconButton()]), topSliverWidget: DriftMemoryLane, topSliverWidgetHeight: hasMemories ? 200 : 0, showStorageIndicator: true)`.
  - Layer 1: `FilterSheet()`.

**Tests:**

1. Renders `Timeline`, `FilterSheet`, `FilterIconButton`.
2. **Override propagation:** inside a `testWidgets` that mounts `MainTimelinePage`, read `timelineServiceProvider` via `ProviderScope.containerOf(context)` and assert it equals the value `photosTimelineQueryProvider` exposes.
3. Filter empty → `timelineServiceProvider` resolves to main-library service (verified via stub `TimelineFactory.main`).
4. Filter non-empty → `timelineServiceProvider` resolves to search-backed service (with `origin: TimelineOrigin.search`).
5. Auto-peek: start `hidden` + empty filter → add filter → sheet state becomes `peek`.
6. Auto-collapse: start `peek` + 1 filter → remove last chip → sheet state becomes `hidden`.
7. Explicit-close persistence: from `browse`, Done → `hidden`. Subsequent filter add while still non-empty: no state change (isEmpty transition never fires).
8. Tab-switch preservation: dispose + remount `MainTimelinePage` → `photosFilterProvider` and `photosFilterSheetProvider` values are preserved (top-level providers outlive the page).
9. Pre-login: `currentUserProvider = null` + non-empty filter → timeline falls back to main-library service (no search call — verified via `SearchService` stub call counter = 0).

**Commit:** `feat(mobile): mount FilterSheet + FilterIconButton in MainTimelinePage`

---

## Task 7 — i18n strings (`i18n/en.json`)

**Keys to add (English only; ICU where needed):**

- `filter_button_active`: `"Filter, active"`
- `filter_sheet_archived`: `"Archived"`
- `filter_sheet_clear_filters`: `"Clear filters"`
- `filter_sheet_deep_stub`: `"Full filters coming in the next update"`
- `filter_sheet_done`: `"Done"`
- `filter_sheet_favourites`: `"Favourites"`
- `filter_sheet_load_error_retry`: `"Couldn't load — tap to retry"`
- `filter_sheet_match_count_loading`: `"—"`
- `filter_sheet_match_count_photos`: ICU plural — `"{count, plural, =0{No photos} =1{1 photo} other{{count} photos}}"`. **Note:** `easy_localization` uses `.plural(count)` with a map — alternative representation: split into `filter_sheet_match_count_photos_zero` / `_one` / `_other` keys; confirm at Task 7 which form the existing i18n pipeline supports. Fallback: render plain `"$count photos"` formatted via `NumberFormat.decimalPattern`.
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
- `filter_sheet_title`: `"Filters"`
- `filter_sheet_unnamed_person`: `"Unnamed"`
- `filter_sheet_when`: `"When"`
- `filter_sheet_when_custom`: `"Custom…"`
- `filter_sheet_when_month`: `"This month"`
- `filter_sheet_when_today`: `"Today"`
- `filter_sheet_when_week`: `"This week"`
- `filter_sheet_when_year`: `"This year"`
- `filter_sheet_zero_results`: `"No photos match this filter"`
- `remove_filter`: `"Remove filter"` (semantics hint, reused across chips).

Run `pnpm --filter=immich-i18n format:fix`; fall back to `npx prettier --write i18n/en.json` inside `i18n/`.

**Commit:** `feat(mobile): i18n strings for filter sheet`

---

## Task 8 — Analyzer + full-suite test pass

1. `cd mobile && flutter analyze lib test` → 0 warnings.
2. `cd mobile && flutter test` → all pass. Per memory `feedback_no_flake_allowance`: any flake is a root-cause bug. Fix, do not retry.
3. `dart format` target directories:
   - `lib/presentation/widgets/filter_sheet`
   - `lib/providers/photos_filter`
   - `lib/domain/services/photos_filter_search_timeline.dart`
   - `test/presentation/widgets/filter_sheet`
   - `test/providers/photos_filter`
   - `test/presentation/pages/dev`
   - `test/domain/services`
4. Scan for untranslated strings in new widgets:
   ```bash
   grep -nE '(Text|text:)\s*["\x27][A-Z]' mobile/lib/presentation/widgets/filter_sheet | grep -v '\.tr()' | grep -v '//'
   ```
   Zero matches required (memory §9.5).

**Commit (only if format diff exists):** `chore(mobile): dart format filter_sheet`

---

## Task 9 — Open draft PR + babysit

1. `git push -u origin feat/mobile-filter-sheet-ui`.
2. `gh pr create --draft --title "feat(mobile): photos filter sheet UI (PR 1.2)" --body "$(cat <<'EOF' … EOF)"` — body below.
3. Invoke `babysit` skill; fix every failure at root cause. **Do not merge.**

**PR body:**

```markdown
Part of the mobile filter sheet feature. Design: [§10.3 PR 1.2](./docs/plans/2026-04-17-mobile-filter-sheet-design.md). Plan: [PR 1.2 plan](./docs/plans/2026-04-17-mobile-filter-sheet-pr1-2-plan.md).

## What

- Filter icon in the Photos app bar with an active-indicator dot.
- `FilterSheet` — a single `DraggableScrollableSheet` owning peek / browse / deep-stub snaps. Programmatic snap transitions (via the sheet's `DraggableScrollableController.animateTo`) + settle-driven sync back to `photosFilterSheetProvider`.
- Peek: active-filter chiprail + live match count.
- Browse: SearchBar + four suggestion strips (People / Places / Tags / When) + Reset + Done + match count.
- Deep: placeholder stub (real Deep is PR 1.3).
- `photosFilterDebouncedProvider` (250 ms) feeding the suggestions provider.
- `photosTimelineFilterProvider` (500 ms) feeding the new `photosTimelineQueryProvider` that overrides `timelineServiceProvider` in `MainTimelinePage`: empty filter → main-library service; non-empty + logged-in → page-1 search-backed `TimelineService` via `TimelineFactory.fromAssetStream`.
- Auto-peek on first filter, auto-collapse on last-chip removal.
- i18n strings; ICU pluralisation on match count; locale-aware number grouping.
- A11y: live region on match count; snap-state announcement under `accessibleNavigation`.
- Haptics on chip removal, strip tap, and reset.

## Known limitations (flagged for follow-up)

- **Search-backed Timeline is page-1 only** — pagination → PR 1.2.1.
- **PlacesStrip is country-only**; cascade → PR 1.3 Deep.
- **Spillover people-chip body tap is a no-op**; modal → PR 1.3.
- **Zero-matches Timeline empty-state** — whatever the library timeline renders; custom overlay → PR 1.2.1.
- **SearchBar paste fast-path** deferred; 250 ms debounce applies.
- **PR 1.0 keyboard-sheet spike was never run**; if manual QA exposes keyboard regressions, escalate to custom sheet wrapper.

## Tests

- Unit: `photosTimelineQueryProvider` (9), `photos_filter_search_timeline` helper (4), `photosFilterDebouncedProvider` (5), `activeChipsFromFilter` (17).
- Widget: `FilterIconButton` (8), `ActiveFilterChip` (10 incl. dark), `FilterSheet` (15), `PeekContent` (5), `BrowseContent` (3), `SearchBar` (8), `MatchCountLabel` (7), `MatchCountFooter` (2), `DeepStubContent` (1), 4 strips × 9 tests + extras.
- Integration: `MainTimelinePage` override propagation + auto-peek + tab preservation + pre-login.

## Checklist

- [ ] `flutter analyze lib test` clean.
- [ ] `flutter test` all pass.
- [ ] No new English-only Text literals.
- [ ] Manual QA — iOS + Android, light + dark, landscape, keyboard interaction, tab switch, cold start.
```

---

## Mockup alignment (Material 3 translation of the darkroom mockup)

The mockup's "darkroom warmth" palette + Fraunces / JetBrains Mono / Plus Jakarta Sans are **aspirational** (design §3 / §9.7). Phase 1 uses Material 3 defaults. This section pins **spatial + typographic + atmospheric** decisions that carry over regardless of palette, so the visuals retain the mockup's character inside the app's design system.

### Palette translation

| Mockup token        | Phase 1 substitute                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `--ember` accent    | `theme.colorScheme.primary`                                                                                                      |
| `--ember-soft`      | `theme.colorScheme.primary` (onPrimaryContainer or lighter tone-70)                                                              |
| `--ember-wash`      | `theme.colorScheme.primary.withOpacity(.14)`                                                                                     |
| `--ember-glow`      | `BoxShadow(color: theme.colorScheme.primary.withOpacity(.32), blurRadius: 14, spreadRadius: 0)` on active-selected elements only |
| `--paper`           | `theme.colorScheme.onSurface`                                                                                                    |
| `--paper-dim`       | `theme.colorScheme.onSurfaceVariant`                                                                                             |
| `--paper-fade`      | `theme.colorScheme.outline`                                                                                                      |
| `--ink-raise`       | `theme.colorScheme.surfaceContainer`                                                                                             |
| `--ink-raise-2`     | `theme.colorScheme.surfaceContainerHigh`                                                                                         |
| `--ink-frost`       | `theme.colorScheme.surfaceContainerLow`                                                                                          |
| `--ink-line`        | `theme.colorScheme.outlineVariant`                                                                                               |
| `--ink-line-strong` | `theme.colorScheme.outline.withOpacity(.5)`                                                                                      |
| sheet scrim         | `theme.colorScheme.scrim.withOpacity(.32)` (browse / deep)                                                                       |

Film grain + ember radial gradients are **not** ported (§3 aspiration). No hardcoded hex values anywhere.

### Typography translation

Three type roles, one Material 3 target each:

| Mockup role                                  | Phase 1                                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fraunces** (display numerals / titles)     | `textTheme.displaySmall` (or `headlineLarge` depending on size) with no font override — use the app's default.                                                                                                 |
| **JetBrains Mono** (labels, counts, kickers) | `textTheme.labelSmall.copyWith(fontFamily: 'monospace', letterSpacing: 2.0, fontFeatures: const [FontFeature.tabularFigures()])` — Flutter resolves `monospace` to the platform mono font (Menlo/Roboto Mono). |
| **Plus Jakarta Sans** (body / chip labels)   | `textTheme.bodyMedium` / `labelLarge` — default font.                                                                                                                                                          |

**Tabular figures** (`FontFeature.tabularFigures()`) applied to every visible number: peek match count, footer match count, tag-pill count badges, When pill calendar glyph, places-overlay count, chip × badge. This keeps numerals monospaced visually even without a bespoke mono font.

**Uppercase mono labels** (`"PEOPLE"`, `"PHOTOS MATCHED"`) use `.toUpperCase()` + letterSpacing 2.0 on `labelSmall` with `colorScheme.outline`.

### Atmosphere

- **Sheet material.** `Material(type: MaterialType.canvas, elevation: 3, color: theme.colorScheme.surface.withOpacity(.92))` wrapped in a `BackdropFilter(filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18))` for the mockup's blurred sheet feel. Modern iOS + Android render this cheap. **Added to Task 4 FilterSheet spec.**
- **Scrim.** `ColoredBox(color: theme.colorScheme.scrim.withOpacity(.32))`. Mockup's dark gradient scrim is a stylistic lift — M3 scrim does the same work.
- **Top-only rounded corners.** `RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28)))` on the sheet — mockup 28pt. Matches M3 ModalBottomSheet default.
- **Edge-faded horizontal rails.** `ShaderMask` with a horizontal `LinearGradient` that fades the first ~5% and last ~5% to transparent. Applied to peek chip rail, all four browse strips.
- **Glow on active-selected people/places/year cells.** `BoxShadow(color: primary.withOpacity(.32), blurRadius: 14)` — scaled-down equivalent of the mockup's ember glow. **Only on the `on` visual state**; resting elements have no extra shadow. Keep this tasteful; disable under `AccessibleNavigation` / `MediaQuery.disableAnimations`.

### Dimensional spec (carry from mockup)

| Element                        | Dimension (pt)                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Sheet top radius               | 28                                                                                                  |
| Sheet drag handle              | 44 × 4, 2pt radius, 10pt top padding                                                                |
| Peek content height            | ~15% of screen (driven by `snapSizes`)                                                              |
| Peek chip rail padding         | 14pt top, 18pt bottom, 20pt sides                                                                   |
| Peek chip                      | padding 7 × 12, radius 999, 12.5pt label                                                            |
| Peek chip × badge              | 16pt circle, 9.5pt mono glyph                                                                       |
| Peek chip avatar               | 18pt circle, overlap offset −4, 1.5pt surface ring                                                  |
| Browse sheet height            | 62% of screen                                                                                       |
| Browse SearchBar               | 42pt tall, 14pt radius, 20pt horizontal margin                                                      |
| Strip vertical padding         | 18pt top, 0 bottom (between strips)                                                                 |
| Strip header label             | mono labelSmall + strip title                                                                       |
| **PeopleStrip** cell           | 58pt wide × 80pt tall, 52pt thumb + 10.5pt caption                                                  |
| **PeopleStrip** thumb selected | scale 1.04, 2pt primary ring + 4pt primary.14 halo                                                  |
| **PlacesStrip** tile           | 104 × 72, 14pt radius                                                                               |
| **PlacesStrip** overlay        | bottom-anchored linear gradient (alpha 0 → 0.75)                                                    |
| **PlacesStrip** tile selected  | 2pt primary ring + primary glow shadow                                                              |
| **TagsStrip** pill             | 7 × 13 padding, radius 999, 12.5pt label + mono count badge (if DTO provides count)                 |
| **WhenStrip** pill             | 9 × 14 padding, **radius 14pt** (distinct from tag pill), 12.5pt label + mono calendar glyph prefix |
| Footer (browse)                | serif displaySmall count + `labelSmall` uppercase "photos matched" + Done text button right-aligned |
| Strip horizontal scroll        | ShaderMask gradient, 4% left + 4% right fade                                                        |

### Chip visual leading glyphs (refines Task 3)

| Visual   | Leading                                                                                    |
| -------- | ------------------------------------------------------------------------------------------ |
| person   | 1–3 overlapping 18pt `CircleAvatar`s with 1.5pt surface ring; offset −4 each               |
| tag      | 8pt circle in a seeded accent colour derived from `id.hashCode` modulated toward `primary` |
| location | `Icons.place_rounded` 16pt                                                                 |
| when     | none; label uses tabular figures + slight letter-spacing                                   |
| rating   | `Icons.star_rounded` 16pt                                                                  |
| media    | `Icons.photo_rounded` / `Icons.play_circle_rounded` / `Icons.audiotrack_rounded`           |
| toggle   | `Icons.favorite_rounded` / `Icons.archive_rounded` / `Icons.folder_off_rounded`            |
| text     | `Icons.search_rounded` 16pt                                                                |

### Active-state treatment (refines strip taps)

All strip items, when selected:

- Background: `primary.withOpacity(.14)` (the ember-wash equivalent).
- Border: `primary.withOpacity(.42)` 1pt.
- Label: `primary` (or the high-contrast tone for text on primary-container backgrounds — pick during Task 5 based on how `primary.withOpacity(.14)` renders on surface).
- Optional accent glow shadow: only for People thumbs + Places tiles (NOT for pill chips — pills use the border + background shift and no shadow, to keep the row scrollable without shadow-clip artefacts).

### What's intentionally NOT ported

- Bespoke Fraunces/Plus Jakarta Sans/JetBrains Mono font declarations (design §3 defers).
- Film grain overlay.
- Ember radial background gradients on the scaffold.
- "Darkroom warmth" ember palette — mapped to `primary`.
- Scroll-triggered or entrance animations — mockup is static; Phase 1 matches M3 motion defaults for sheet snap (280ms easeOutCubic, which aligns with M3's `motion-easing-standard`).

### Deep stub styling

For Phase 1 the Deep state is a single centered `Text`. Style:

- Container: same sheet material as Browse (BackdropFilter blur + surface.92 + 28pt top corners).
- Drag handle at top, 44×4pt.
- Text: `headlineSmall` italic if the theme's serif is set; otherwise plain `headlineSmall`.
- No icon, no illustration — deliberately quiet so the PR 1.3 replacement reads as a promotion, not a regression.

### Accessibility overlays on the visual spec

- **High-contrast mode:** if `MediaQuery.of(context).highContrast` is true, drop the `primary.withOpacity(.14)` active backgrounds in favour of `primary` borders at 2pt and `primary` text.
- **Disable animations:** if `MediaQuery.disableAnimations` is true, set sheet `animateTo` duration to 0 and drop the `BoxShadow` glow on selected cells.
- **Reduce-motion respects M3 defaults** — no custom motion to patch.

---

## Risk register

- **Sync Provider<TimelineService> adapter + fire-and-forget search** — if `SearchService.search` takes > 2 s, the timeline shows a blank grid for the duration. Acceptable; existing Search tab has the same behaviour. Mitigation: surface loading via existing Timeline loading indicator.
- **`_DisposingTimelineService` wrapper** — if `TimelineService` grows abstract methods, the wrapper drifts. Mitigation: extend concrete `TimelineService` via composition and only override `dispose`; Dart's `noSuchMethod` is NOT used.
- **Debounce provider lifecycle** — two debounced providers sharing a timer implementation must not cross-contaminate state. Each is a separate `Provider`; no shared mutable state.
- **`DraggableScrollableController.animateTo` during drag** — if the user drags while we animate, the animation is cancelled by the user gesture. Flutter handles this natively; no extra code needed, but verify test 4.9.
- **ICU pluralisation via `easy_localization`** — the ICU `{count, plural, …}` form needs `easy_localization` support with `"locale_keys": ["match_count.zero", ".one", ".other"]` or a flat plural key. Audit during Task 7.
- **Haptic feedback spy in tests** — requires `ServicesBinding.instance.defaultBinaryMessenger` setMockMethodCallHandler. Standard pattern.
- **`jumpTo` vs `tester.drag`** — all snap-transition widget tests use `tester.drag` + `pumpAndSettle` (not `jumpTo`); `jumpTo` bypasses the notification stream we rely on for settle sync.
- **`photosFilterCountProvider` is a placeholder** (page-1 length). UI truthfully reflects whatever the provider returns; a future total-count endpoint is out-of-scope.
- **PR 1.0 keyboard-sheet spike outcome never filled** — stop execution and document in §11.4 if Task 4 manual pump shows broken keyboard UX.
- **`FilterSuggestionsTagDto.count` not in the generated DTO** — label drops the count; verify during Task 5 audit. If present, add back.
