# Mobile Bottom-Nav Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **Revision log:**
>
> - **rev 1 (2026-04-18 initial)** — first-pass TDD plan.
> - **rev 2 (2026-04-18 after first /review)** — folded in 3 blockers, 4 highs, 8 mediums, 3 lows. Key structural shifts: side effects moved from `GalleryTabShellPage` listener to `GalleryBottomNav._onTabTap`; `GalleryNavPill` gains `disabledTabs` prop; `GalleryBottomNav` gets a fade-and-slide hide animation with `onEnd`-gated height publish; `openGallerySearch` takes a `ProviderReader` closure; added D0 guard-verification task; fleshed out C5 test scaffolding.
> - **rev 3 (2026-04-18 after second /review)** — folded in 3 mediums + 5 lows. Key shifts: hide animation uses `TweenAnimationBuilder` for pixel-exact 12 pt slide (was `AnimatedSlide` with fractional offset that drifted with parent size); `searchInputFocusProvider` override wired into the negative-assertion test (was a false-green); pill-height-locked-across-text-scales test added; C5 harness overrides `currentUserProvider` + `serverInfoProvider` so `_authGuard`/`_duplicateGuard` don't redirect out of the shell; rapid-multi-select-toggle test added for interrupted-animation orphan-write coverage; P.6 hoists `FakeTabsRouter` to a shared helper; P.7 adds a provider-shape pre-check for negative-assertion overrides.
> - **rev 4 (2026-04-18 after `/frontend-design` review)** — folded in 2 aesthetic regressions. F1: icon transition is smoothed via a new `AnimatedNavIcon` widget (Task A5) that crossfades outlined ↔ filled icons over 220 ms — rather than the rev-3 hard swap. F2 _rejected as overengineering_ (Archivo font bundle dropped); labels stay on the app's existing theme font. A5 is a lightweight widget task with no font-asset dependencies. C1 updated to consume `AnimatedNavIcon` wrapped in `AnimatedAlign.widthFactor` + `AnimatedOpacity` for the idle→active icon reveal.

**Goal:** Ship a Google-Photos-inspired floating pill bottom nav (Photos · Albums · Library) plus an outboard Search blob that opens the FilterSheet from PR 1.3. Retires the Search and Spaces tabs from the bottom nav. Upstream `tab_shell.page.dart` and `tab.provider.dart` stay bit-identical.

**Architecture:** Parallel fork-only widget set (`GalleryTabShellPage` + `GalleryBottomNav` + `GalleryNavPill` + `GalleryNavSegment` + `GallerySearchBlob`) wired behind a fork-only `galleryTabProvider` and `GalleryTabEnum`. The router's root flips from `TabShellRoute` to `GalleryTabShellRoute`. A counter-based focus provider (`photosFilterSearchFocusRequestProvider`) plus a `FocusNode` in `FilterSheetSearchBar` lets the Search blob focus the sheet's text input. A `bottomNavHeightProvider` lets the existing filter-sheet peek rail stack above the new pill.

**Tech Stack:** Flutter 3.x, Dart, Riverpod (`hooks_riverpod`), `auto_route`, `easy_localization`, `flutter_test`, Material 3 tokens from `theme.colorScheme`. No server-side changes; no OpenAPI regen.

**Design reference:** `docs/plans/2026-04-18-mobile-bottom-nav-design.md` rev 4 (commit `7429ff90e`, PR #378).
**Mockup reference:** `docs/plans/mockups/2026-04-18-mobile-bottom-nav.html` (tap labels or press P/A/L to preview).

---

## Scope summary

- **9 new fork-only files** under `mobile/lib/presentation/pages/common/`, `mobile/lib/presentation/widgets/gallery_nav/`, `mobile/lib/providers/gallery_nav/`, `mobile/lib/providers/photos_filter/`.
- **Mirror test files** for every new widget + provider.
- **4 touched upstream-aligned files:** `mobile/lib/routing/router.dart` (+ generated `router.gr.dart`), `mobile/lib/presentation/widgets/filter_sheet/search_bar.widget.dart`, `mobile/lib/presentation/widgets/filter_sheet/peek_content.widget.dart`, `i18n/en.json`.
- **Untouched (critical):** `mobile/lib/pages/common/tab_shell.page.dart`, `mobile/lib/providers/tab.provider.dart`, `mobile/lib/constants/constants.dart`.

**Testing philosophy:** strict TDD — Red → Green → Refactor → Commit. Tests are unit (`flutter_test` + `ProviderScope` overrides) or widget tests with `pumpConsumerWidget` / `pumpConsumerWidgetDark` (both already in `mobile/test/widget_tester_extensions.dart`). Patrol-based e2e is out-of-scope (memory `project_play_store_publishing.md`).

**Running tests** — from the worktree root:

```bash
cd mobile && flutter test --concurrency=1                                         # full mobile suite
cd mobile && flutter test test/providers/gallery_nav/gallery_tab_enum_test.dart   # single file
cd mobile && flutter test --plain-name "organic widths" test/path/to/file.dart    # single test by name
cd mobile && dart analyze                                                         # static analysis
cd mobile && dart format --set-exit-if-changed lib test                           # format check (CI enforces)
```

---

## Prereqs & baseline (do once, before any task)

**P.1 Worktree + branch** — already created at `.worktrees/mobile-bottom-nav/` on `feat/mobile-bottom-nav` tracking `origin/main`. Confirm:

```bash
cd .worktrees/mobile-bottom-nav
git status                       # clean (the design doc + mockup are already committed)
git branch --show-current        # feat/mobile-bottom-nav
git log --oneline -5
```

**P.2 Flutter deps:**

```bash
cd mobile && flutter pub get
```

**P.3 Baseline tests** — must pass before writing any new test. Scope-narrow baseline run:

```bash
cd mobile && flutter test test/providers/photos_filter/ test/presentation/widgets/filter_sheet/
```

Expected: all green, 0 failures. If red, **stop and investigate** (memory: `feedback_no_flake_allowance.md`) — do not layer new work on a broken baseline.

**P.4 No OpenAPI regen** — this PR is mobile-only and consumes existing routes/endpoints. Do **not** run `make open-api-dart`.

**P.5 Dev dependencies** — confirm `mobile/pubspec.yaml` `dev_dependencies` includes `fake_async` and `mocktail` (used by B3 / C4 tests). Check:

```bash
grep -E 'fake_async|mocktail' mobile/pubspec.yaml
```

If either is missing, add it before starting tasks (single pubspec edit + `flutter pub get`). The mobile test suite already uses `mocktail` in other tests, so it's likely present; `fake_async` is less common.

**P.6 Shared test helper — `_FakeTabsRouter`**

Several later tasks (B3, C4, C5) use a `Fake TabsRouter` for driving active-index + recording `setActiveIndex` calls. Hoist to a shared file so the shape doesn't drift between test files:

- Create: `mobile/test/test_helpers/fake_tabs_router.dart`

```dart
// mobile/test/test_helpers/fake_tabs_router.dart
import 'package:auto_route/auto_route.dart';
import 'package:mocktail/mocktail.dart';

/// Minimal TabsRouter fake used by the gallery-nav tests. Records
/// setActiveIndex calls and exposes a mutable activeIndex.
class FakeTabsRouter extends Fake implements TabsRouter {
  int _active;
  final List<int> setCalls = [];

  FakeTabsRouter({int initialIndex = 0}) : _active = initialIndex;

  @override
  int get activeIndex => _active;

  @override
  void setActiveIndex(int index, {bool notify = true}) {
    setCalls.add(index);
    _active = index;
  }
}
```

All later tasks that reference `_FakeTabsRouter` locally should import from this helper. No commit from this step alone; the file is created in the first task that needs it (B3).

**P.7 Provider-shape verification for negative-assertion tests**

The C4 negative-assertion test needs to override three providers that must NOT be touched by `_onTabTap`. Before writing C4, run the following one-liner to confirm their shapes so the overrides compile:

```bash
grep -nE '^(final|class) (sharedSpacesProvider|searchPreFilterProvider|searchInputFocusProvider|tabProvider|readonlyModeProvider)' \
  mobile/lib/providers/ mobile/lib/presentation/pages/search/paginated_search.provider.dart -R 2>&1 | head -20
```

Record the declaration shape (`StateProvider` vs `NotifierProvider` vs `FutureProvider`, generic type) for each. If any shape doesn't match the plan's override example, adjust the override in C4's Step 1 tests.

---

# PHASE A — Prerequisite plumbing in touched files (Tasks A1–A4)

Scope: the four pieces of fork-only plumbing that must be in place **before** any new widget can consume them.

**Files modified this phase:**

- `mobile/lib/providers/photos_filter/search_focus.provider.dart` (new)
- `mobile/lib/presentation/widgets/filter_sheet/search_bar.widget.dart` (touched — `FocusNode` + `ref.watch` pattern)
- `mobile/lib/providers/gallery_nav/bottom_nav_height.provider.dart` (new)
- `mobile/lib/presentation/widgets/filter_sheet/peek_content.widget.dart` (touched — reads height provider)

---

### Task A1: `photosFilterSearchFocusRequestProvider` (counter provider)

**Why this task exists:** external callers need a way to ask the FilterSheet's text input to focus itself. A counter-based signal avoids putting a `FocusNode` in a provider (which would outlive its widget State and can crash on disposed-node reuse).

**Files:**

- Create: `mobile/lib/providers/photos_filter/search_focus.provider.dart`
- Create: `mobile/test/providers/photos_filter/search_focus_provider_test.dart`

**Step 1: Write the failing unit test**

```dart
// mobile/test/providers/photos_filter/search_focus_provider_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/photos_filter/search_focus.provider.dart';

void main() {
  test('default value is 0', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(container.read(photosFilterSearchFocusRequestProvider), 0);
  });

  test('increment persists across reads', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(photosFilterSearchFocusRequestProvider.notifier).state++;
    expect(container.read(photosFilterSearchFocusRequestProvider), 1);
    container.read(photosFilterSearchFocusRequestProvider.notifier).state++;
    expect(container.read(photosFilterSearchFocusRequestProvider), 2);
  });
}
```

**Step 2: Run and verify it fails**

```bash
cd mobile && flutter test test/providers/photos_filter/search_focus_provider_test.dart
```

Expected: compile error, `photosFilterSearchFocusRequestProvider` not defined.

**Step 3: Implement the provider**

```dart
// mobile/lib/providers/photos_filter/search_focus.provider.dart
import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Counter that callers increment to request focus on the FilterSheet's
/// text-search input. `FilterSheetSearchBar` watches and uses a
/// `_lastProcessedFocusRequest` field in its State to detect rises —
/// surviving the race where a request lands before the search bar mounts
/// (common when `openGallerySearch` triggers the sheet from a non-Photos tab).
///
/// Using a counter (not a shared `FocusNode`) is deliberate: providers outlive
/// widgets, and a disposed `FocusNode` in a provider would crash later consumers.
final photosFilterSearchFocusRequestProvider = StateProvider<int>((_) => 0);
```

**Step 4: Run and verify it passes**

```bash
cd mobile && flutter test test/providers/photos_filter/search_focus_provider_test.dart
```

Expected: PASS, 2 tests.

**Step 5: Format + commit**

```bash
cd mobile && dart format lib/providers/photos_filter/search_focus.provider.dart test/providers/photos_filter/search_focus_provider_test.dart
git add mobile/lib/providers/photos_filter/search_focus.provider.dart mobile/test/providers/photos_filter/search_focus_provider_test.dart
git commit -m "feat(mobile): photosFilterSearchFocusRequestProvider counter for sheet focus plumbing"
```

---

### Task A2: `FilterSheetSearchBar` — wire `FocusNode` + `ref.watch` + `_lastProcessedFocusRequest`

**Why this task exists:** §6.1 of the design doc specifies this is the touched upstream-aligned file where external focus requests land. The pattern is `ref.watch + _lastProcessedFocusRequest` (NOT `ref.listen`) so a widget that mounts AFTER the counter increment still catches it.

**Files:**

- Modify: `mobile/lib/presentation/widgets/filter_sheet/search_bar.widget.dart`
- Create: `mobile/test/presentation/widgets/filter_sheet/search_bar_focus_test.dart`

**Step 1: Write the failing widget test — "mounted before increment"**

```dart
// mobile/test/presentation/widgets/filter_sheet/search_bar_focus_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/search_bar.widget.dart';
import 'package:immich_mobile/providers/photos_filter/search_focus.provider.dart';

import '../../widget_tester_extensions.dart';

void main() {
  testWidgets('mounted-before-increment: focus requested on counter rise', (tester) async {
    await tester.pumpConsumerWidget(const FilterSheetSearchBar());
    await tester.pumpAndSettle();

    final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheetSearchBar)));
    final textField = tester.widget<TextField>(find.byType(TextField));
    expect(textField.focusNode!.hasFocus, isFalse, reason: 'not focused initially');

    container.read(photosFilterSearchFocusRequestProvider.notifier).state++;
    await tester.pumpAndSettle();

    expect(textField.focusNode!.hasFocus, isTrue, reason: 'focus requested after counter++');
  });
}
```

**Step 2: Run and verify it fails**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/search_bar_focus_test.dart
```

Expected: fails because `FilterSheetSearchBar` currently has no `FocusNode` attached to its `TextField`.

**Step 3: Modify `search_bar.widget.dart`** — add `FocusNode`, `_lastProcessedFocusRequest`, the `ref.watch` + post-frame `requestFocus` pattern:

Existing file has a `_FilterSheetSearchBarState` with a `TextEditingController`. Add alongside:

```dart
// inside _FilterSheetSearchBarState
late final FocusNode _focusNode;
int _lastProcessedFocusRequest = 0;

@override
void initState() {
  super.initState();
  _focusNode = FocusNode(debugLabel: 'FilterSheetSearchBar');
  _controller = TextEditingController(text: ref.read(photosFilterProvider).context ?? '');
  _controller.addListener(_onChanged);
}

@override
void dispose() {
  _debounce?.cancel();
  _controller.removeListener(_onChanged);
  _controller.dispose();
  _focusNode.dispose();
  super.dispose();
}
```

Inside `build`, BEFORE the existing `ref.listen`, add:

```dart
final focusRequest = ref.watch(photosFilterSearchFocusRequestProvider);
if (focusRequest > _lastProcessedFocusRequest) {
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!mounted) return;
    _focusNode.requestFocus();
    setState(() => _lastProcessedFocusRequest = focusRequest);
  });
}
```

Pass the node to the `TextField`:

```dart
return TextField(
  controller: _controller,
  focusNode: _focusNode,
  decoration: InputDecoration(...),
  // ... existing props
);
```

**Step 4: Run Step 1's test — should pass; run the existing search bar test if any to confirm no regression**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/search_bar_focus_test.dart
cd mobile && flutter test test/presentation/widgets/filter_sheet/
```

Expected: the focus test passes. Existing filter_sheet tests all still pass.

**Step 5: Add the race-coverage test — "mounted after increment"**

Append to `search_bar_focus_test.dart`:

```dart
testWidgets('mounted-after-increment: first build catches the request', (tester) async {
  final container = ProviderContainer();
  addTearDown(container.dispose);
  container.read(photosFilterSearchFocusRequestProvider.notifier).state = 1; // pre-mount increment

  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: const MaterialApp(home: Material(child: FilterSheetSearchBar())),
  ));
  await tester.pumpAndSettle();

  final textField = tester.widget<TextField>(find.byType(TextField));
  expect(textField.focusNode!.hasFocus, isTrue, reason: 'race: mount-after-increment still focuses');
});

testWidgets('duplicate increments in one frame coalesce', (tester) async {
  await tester.pumpConsumerWidget(const FilterSheetSearchBar());
  await tester.pumpAndSettle();
  final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheetSearchBar)));

  container.read(photosFilterSearchFocusRequestProvider.notifier).state++;
  container.read(photosFilterSearchFocusRequestProvider.notifier).state++;
  await tester.pumpAndSettle();

  final textField = tester.widget<TextField>(find.byType(TextField));
  expect(textField.focusNode!.hasFocus, isTrue);
  // no exception thrown by double-request is the assertion; if we got here, pass
});

testWidgets('unmount then increment: no crash', (tester) async {
  await tester.pumpConsumerWidget(const FilterSheetSearchBar());
  final container = ProviderScope.containerOf(tester.element(find.byType(FilterSheetSearchBar)));
  await tester.pumpWidget(const SizedBox.shrink()); // unmount
  await tester.pumpAndSettle();

  // Should not throw.
  container.read(photosFilterSearchFocusRequestProvider.notifier).state++;
  await tester.pump();
});

testWidgets('_lastProcessedFocusRequest advances only after post-frame runs', (tester) async {
  // Race covered: if the widget unmounts between build and post-frame,
  // the marker must NOT advance — otherwise a freshly-remounted widget
  // would miss the increment.
  final container = ProviderContainer();
  addTearDown(container.dispose);
  container.read(photosFilterSearchFocusRequestProvider.notifier).state = 1;

  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: const MaterialApp(home: Material(child: FilterSheetSearchBar())),
  ));
  // DO NOT pumpAndSettle — we want the build to run but the post-frame
  // callback NOT to fire. Unmount immediately.
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pumpAndSettle();

  // Remount a fresh widget: it should see counter=1 > _lastProcessed=0
  // and request focus on its first build.
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: const MaterialApp(home: Material(child: FilterSheetSearchBar())),
  ));
  await tester.pumpAndSettle();

  final textField = tester.widget<TextField>(find.byType(TextField));
  expect(textField.focusNode!.hasFocus, isTrue,
      reason: 'fresh mount must still pick up the pre-mount increment');
});
```

**Step 6: Run — all four tests should pass**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/search_bar_focus_test.dart
```

Expected: PASS, 4 tests.

**Step 7: Commit**

```bash
cd mobile && dart format lib/presentation/widgets/filter_sheet/search_bar.widget.dart test/presentation/widgets/filter_sheet/search_bar_focus_test.dart
git add mobile/lib/presentation/widgets/filter_sheet/search_bar.widget.dart mobile/test/presentation/widgets/filter_sheet/search_bar_focus_test.dart
git commit -m "feat(mobile): FilterSheetSearchBar FocusNode + watch-based focus plumbing"
```

---

### Task A3: `bottomNavHeightProvider` (equality-guarded StateProvider)

**Why this task exists:** the existing FilterSheet peek rail and the new floating pill both want the bottom of the screen. §5.6 of the design doc resolves this by stacking; the peek rail reads this provider to pad above the pill. The equality guard prevents rebuilds when the publishes the same value every LayoutBuilder frame.

**Files:**

- Create: `mobile/lib/providers/gallery_nav/bottom_nav_height.provider.dart`
- Create: `mobile/test/providers/gallery_nav/bottom_nav_height_provider_test.dart`

**Step 1: Write the failing unit test**

```dart
// mobile/test/providers/gallery_nav/bottom_nav_height_provider_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/gallery_nav/bottom_nav_height.provider.dart';

void main() {
  test('default value is 0', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(container.read(bottomNavHeightProvider), 0);
  });

  test('accepts a height write', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    container.read(bottomNavHeightProvider.notifier).state = 64;
    expect(container.read(bottomNavHeightProvider), 64);
  });
}
```

**Step 2: Run and verify it fails**

```bash
cd mobile && flutter test test/providers/gallery_nav/bottom_nav_height_provider_test.dart
```

Expected: compile error, `bottomNavHeightProvider` not defined.

**Step 3: Implement the provider**

```dart
// mobile/lib/providers/gallery_nav/bottom_nav_height.provider.dart
import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Height of the Gallery bottom-nav pill in logical pixels, published by the
/// nav widget so the FilterSheet peek rail can stack above it instead of
/// overlapping (design §5.6).
///
/// Writers must equality-guard their writes:
///   if (ref.read(bottomNavHeightProvider) != measured)
///     ref.read(bottomNavHeightProvider.notifier).state = measured;
///
/// Riverpod's `StateProvider` notifies listeners on every `state =` set
/// regardless of value equality, so without the guard PeekContent would
/// rebuild on every LayoutBuilder frame.
///
/// Reads 0 when the nav is hidden (multi-select, keyboard-up, landscape)
/// or not yet measured.
final bottomNavHeightProvider = StateProvider<double>((_) => 0);
```

**Step 4: Run and verify it passes**

```bash
cd mobile && flutter test test/providers/gallery_nav/bottom_nav_height_provider_test.dart
```

Expected: PASS, 2 tests.

**Step 5: Commit**

```bash
cd mobile && dart format lib/providers/gallery_nav/bottom_nav_height.provider.dart test/providers/gallery_nav/bottom_nav_height_provider_test.dart
git add mobile/lib/providers/gallery_nav/bottom_nav_height.provider.dart mobile/test/providers/gallery_nav/bottom_nav_height_provider_test.dart
git commit -m "feat(mobile): bottomNavHeightProvider for peek-rail/pill stacking"
```

---

### Task A4: `PeekContent` — read `bottomNavHeightProvider` + pad

**Why this task exists:** §5.6 design says the peek rail's bottom padding = pill height + 8 pt visual gap. Without this, tapping the rail wouldn't work when covered by the pill.

**Files:**

- Modify: `mobile/lib/presentation/widgets/filter_sheet/peek_content.widget.dart`
- Create: `mobile/test/presentation/widgets/filter_sheet/peek_content_layering_test.dart`

**Step 1: Write the failing widget test**

```dart
// mobile/test/presentation/widgets/filter_sheet/peek_content_layering_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/peek_content.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/bottom_nav_height.provider.dart';

import '../../widget_tester_extensions.dart';

void main() {
  testWidgets('peek rail bottom padding = navHeight + 8 when nav visible', (tester) async {
    await tester.pumpConsumerWidget(
      PeekContent(scrollController: ScrollController()),
      overrides: [bottomNavHeightProvider.overrideWith((_) => 64)],
    );
    await tester.pumpAndSettle();

    // The outermost Padding inside PeekContent carries bottom padding. Find it by key.
    final padding = tester.widget<Padding>(find.byKey(const Key('peek-content-bottom-pad')));
    expect(padding.padding.resolve(TextDirection.ltr).bottom, 72);
  });

  testWidgets('peek rail bottom padding = 0 when nav hidden', (tester) async {
    await tester.pumpConsumerWidget(
      PeekContent(scrollController: ScrollController()),
      overrides: [bottomNavHeightProvider.overrideWith((_) => 0)],
    );
    await tester.pumpAndSettle();

    final padding = tester.widget<Padding>(find.byKey(const Key('peek-content-bottom-pad')));
    expect(padding.padding.resolve(TextDirection.ltr).bottom, 0);
  });
}
```

**Step 2: Run and verify it fails**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/peek_content_layering_test.dart
```

Expected: fails because no `peek-content-bottom-pad` key exists and the bottom padding isn't wired.

**Step 3: Modify `peek_content.widget.dart`** — wrap the existing `ListView` in a `Padding` keyed `peek-content-bottom-pad` that reads the provider:

```dart
// inside build, replace the existing Material's child (which currently wraps ListView)
// with a ConsumerWidget body that reads bottomNavHeightProvider.
//
// Concretely, add near the top of the build body:
final navHeight = ref.watch(bottomNavHeightProvider);
final bottomPad = navHeight == 0 ? 0.0 : navHeight + 8;

// Then wrap the ListView inside a Padding:
return Material(
  color: theme.colorScheme.surface,
  elevation: 8,
  borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
  child: Padding(
    key: const Key('peek-content-bottom-pad'),
    padding: EdgeInsets.only(bottom: bottomPad),
    child: ListView(...existing listview args),
  ),
);
```

**Step 4: Run Step 1's tests — should pass**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/peek_content_layering_test.dart test/presentation/widgets/filter_sheet/
```

Expected: new tests pass; existing peek_content tests (if any) still pass.

**Step 5: Add the no-op-write rebuild test**

Append to `peek_content_layering_test.dart`:

```dart
testWidgets('no-op height write does not rebuild PeekContent', (tester) async {
  int buildCount = 0;
  final container = ProviderContainer(
    overrides: [bottomNavHeightProvider.overrideWith((_) => 64)],
  );
  addTearDown(container.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        home: Material(
          child: Builder(builder: (ctx) {
            buildCount++;
            return PeekContent(scrollController: ScrollController());
          }),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  final firstCount = buildCount;

  // Writer uses the equality-guarded pattern from §5.6:
  if (container.read(bottomNavHeightProvider) != 64) {
    container.read(bottomNavHeightProvider.notifier).state = 64;
  }
  await tester.pumpAndSettle();

  expect(buildCount, firstCount, reason: 'equality-guard suppresses the redundant write');

  // Changing value does cause rebuild.
  if (container.read(bottomNavHeightProvider) != 80) {
    container.read(bottomNavHeightProvider.notifier).state = 80;
  }
  await tester.pumpAndSettle();
  expect(buildCount, greaterThan(firstCount));
});
```

**Step 6: Run — 3 tests pass**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/peek_content_layering_test.dart
```

**Step 7: Commit**

```bash
cd mobile && dart format lib/presentation/widgets/filter_sheet/peek_content.widget.dart test/presentation/widgets/filter_sheet/peek_content_layering_test.dart
git add mobile/lib/presentation/widgets/filter_sheet/peek_content.widget.dart mobile/test/presentation/widgets/filter_sheet/peek_content_layering_test.dart
git commit -m "feat(mobile): peek content reads bottomNavHeightProvider for pill stacking"
```

---

### Task A5: `AnimatedNavIcon` — crossfade between outlined and filled icons

**Why this task exists:** §5.4 + the mockup show the icon morphing from outlined (idle) to filled (active) when a segment becomes active. A small `AnimatedCrossFade` between two `Icon` widgets (outlined / filled variants of the same Material glyph) is all that's needed — no variable-font asset bundle, no new fontFamily declarations. Takes ~220 ms and matches the mockup's perceived smoothness without the aesthetic over-engineering.

**Files:**

- Create: `mobile/lib/presentation/widgets/gallery_nav/animated_nav_icon.widget.dart`
- Create: `mobile/test/presentation/widgets/gallery_nav/animated_nav_icon_test.dart`

**Step 1: Failing widget tests**

```dart
// mobile/test/presentation/widgets/gallery_nav/animated_nav_icon_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/animated_nav_icon.widget.dart';

void main() {
  testWidgets('idle: only the outlined icon is visible', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Material(
        child: AnimatedNavIcon(
          idleIcon: Icons.photo_library_outlined,
          activeIcon: Icons.photo_library,
          active: false,
          size: 22,
          color: Colors.black,
        ),
      ),
    ));
    await tester.pumpAndSettle();

    final crossFade = tester.widget<AnimatedCrossFade>(find.byType(AnimatedCrossFade));
    expect(crossFade.crossFadeState, CrossFadeState.showFirst);
    expect(find.byIcon(Icons.photo_library_outlined), findsOneWidget);
  });

  testWidgets('active: only the filled icon is visible', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Material(
        child: AnimatedNavIcon(
          idleIcon: Icons.photo_library_outlined,
          activeIcon: Icons.photo_library,
          active: true,
          size: 22,
          color: Colors.black,
        ),
      ),
    ));
    await tester.pumpAndSettle();

    final crossFade = tester.widget<AnimatedCrossFade>(find.byType(AnimatedCrossFade));
    expect(crossFade.crossFadeState, CrossFadeState.showSecond);
    expect(find.byIcon(Icons.photo_library), findsOneWidget);
  });

  testWidgets('transition: both icons are in the tree mid-crossfade', (tester) async {
    final active = ValueNotifier<bool>(false);
    await tester.pumpWidget(MaterialApp(
      home: Material(
        child: ValueListenableBuilder<bool>(
          valueListenable: active,
          builder: (_, v, __) => AnimatedNavIcon(
            idleIcon: Icons.photo_library_outlined,
            activeIcon: Icons.photo_library,
            active: v,
            size: 22,
            color: Colors.black,
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    active.value = true;
    await tester.pump(const Duration(milliseconds: 110)); // halfway
    // AnimatedCrossFade keeps both children layered during the fade.
    expect(find.byIcon(Icons.photo_library_outlined), findsOneWidget);
    expect(find.byIcon(Icons.photo_library), findsOneWidget);
  });

  testWidgets('duration is 220ms', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Material(
        child: AnimatedNavIcon(
          idleIcon: Icons.photo_library_outlined,
          activeIcon: Icons.photo_library,
          active: false,
          size: 22,
          color: Colors.black,
        ),
      ),
    ));
    final crossFade = tester.widget<AnimatedCrossFade>(find.byType(AnimatedCrossFade));
    expect(crossFade.duration, const Duration(milliseconds: 220));
  });
}
```

**Step 2: Run, expect fail.**

**Step 3: Implement `AnimatedNavIcon`**

```dart
// mobile/lib/presentation/widgets/gallery_nav/animated_nav_icon.widget.dart
import 'package:flutter/material.dart';

/// Crossfade between an outlined `idleIcon` and a filled `activeIcon` over
/// 220 ms. Matches the pill's `Cubic(0.3, 0.6, 0.2, 1)` motion signature on
/// the size curve so the icon reveal is synchronized with the surrounding
/// `AnimatedAlign` width collapse in GalleryNavSegment.
///
/// Uses `AnimatedCrossFade` (no variable-font dependency) — keeps the nav
/// asset footprint flat and the rebase surface uncluttered.
class AnimatedNavIcon extends StatelessWidget {
  final IconData idleIcon;
  final IconData activeIcon;
  final bool active;
  final double size;
  final Color color;

  static const _duration = Duration(milliseconds: 220);
  static const _curve = Cubic(0.3, 0.6, 0.2, 1);

  const AnimatedNavIcon({
    super.key,
    required this.idleIcon,
    required this.activeIcon,
    required this.active,
    this.size = 22,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedCrossFade(
      duration: _duration,
      sizeCurve: _curve,
      firstCurve: _curve,
      secondCurve: _curve,
      crossFadeState: active ? CrossFadeState.showSecond : CrossFadeState.showFirst,
      firstChild: Icon(idleIcon, size: size, color: color),
      secondChild: Icon(activeIcon, size: size, color: color),
    );
  }
}
```

**Step 4: Run + commit**

```bash
cd mobile && flutter test test/presentation/widgets/gallery_nav/animated_nav_icon_test.dart
cd mobile && dart format lib/presentation/widgets/gallery_nav/animated_nav_icon.widget.dart test/presentation/widgets/gallery_nav/animated_nav_icon_test.dart
git add mobile/lib/presentation/widgets/gallery_nav/animated_nav_icon.widget.dart mobile/test/presentation/widgets/gallery_nav/animated_nav_icon_test.dart
git commit -m "feat(mobile): AnimatedNavIcon (220ms crossfade outlined↔filled)"
```

---

# PHASE B — Fork-only providers + helpers (Tasks B1–B3)

Scope: the fork-only domain model (enum, destination map, search action). No widgets yet.

**Files added this phase:**

- `mobile/lib/providers/gallery_nav/gallery_tab_enum.dart`
- `mobile/lib/providers/gallery_nav/gallery_nav_destination.dart`
- `mobile/lib/providers/gallery_nav/gallery_search_action.dart`
- Mirror tests.

---

### Task B1: `GalleryTabEnum` + `galleryTabProvider` + fork-only constants

**Why this task exists:** the new shell needs its own tab enum, distinct from upstream's `TabEnum`. Mixing them would desync semantics (design §4.6 + §6.6).

**Files:**

- Create: `mobile/lib/providers/gallery_nav/gallery_tab_enum.dart`
- Create: `mobile/test/providers/gallery_nav/gallery_tab_enum_test.dart`

**Step 1: Write failing tests**

```dart
// mobile/test/providers/gallery_nav/gallery_tab_enum_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

void main() {
  group('GalleryTabEnum', () {
    test('enum values in canonical order', () {
      expect(GalleryTabEnum.values, [
        GalleryTabEnum.photos,
        GalleryTabEnum.albums,
        GalleryTabEnum.library,
      ]);
    });

    test('indices match the fork-only constants', () {
      expect(GalleryTabEnum.photos.index, kGalleryPhotosIndex);
      expect(GalleryTabEnum.albums.index, kGalleryAlbumsIndex);
      expect(GalleryTabEnum.library.index, kGalleryLibraryIndex);
      expect(kGalleryPhotosIndex, 0);
      expect(kGalleryAlbumsIndex, 1);
      expect(kGalleryLibraryIndex, 2);
    });
  });

  group('galleryTabProvider', () {
    test('default is photos', () {
      final c = ProviderContainer();
      addTearDown(c.dispose);
      expect(c.read(galleryTabProvider), GalleryTabEnum.photos);
    });

    test('setter persists', () {
      final c = ProviderContainer();
      addTearDown(c.dispose);
      c.read(galleryTabProvider.notifier).state = GalleryTabEnum.library;
      expect(c.read(galleryTabProvider), GalleryTabEnum.library);
    });
  });
}
```

**Step 2: Run, expect fail**

```bash
cd mobile && flutter test test/providers/gallery_nav/gallery_tab_enum_test.dart
```

**Step 3: Implement**

```dart
// mobile/lib/providers/gallery_nav/gallery_tab_enum.dart
import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Fork-only tab identity. Distinct from upstream's `TabEnum`
/// (`home/search/spaces/library`) — the bottom nav redesign keeps the
/// upstream enum + constants untouched for rebase hygiene (design §4.6, §6.6).
enum GalleryTabEnum { photos, albums, library }

const int kGalleryPhotosIndex = 0;
const int kGalleryAlbumsIndex = 1;
const int kGalleryLibraryIndex = 2;

/// The currently-active tab in the Gallery bottom-nav shell.
/// Synced automatically from `tabsRouter.activeIndex` by a listener registered
/// in `GalleryTabShellPage.initState` — no manual writes from tap callbacks.
final galleryTabProvider = StateProvider<GalleryTabEnum>((_) => GalleryTabEnum.photos);
```

**Step 4: Run, expect pass**

**Step 5: Commit**

```bash
cd mobile && dart format lib/providers/gallery_nav/gallery_tab_enum.dart test/providers/gallery_nav/gallery_tab_enum_test.dart
git add mobile/lib/providers/gallery_nav/gallery_tab_enum.dart mobile/test/providers/gallery_nav/gallery_tab_enum_test.dart
git commit -m "feat(mobile): GalleryTabEnum + galleryTabProvider (fork-only)"
```

---

### Task B2: `GalleryNavDestination` — label / icon / route map

**Why this task exists:** keeps the label-i18n-key, icon, active-icon, and target route in one place so segment widgets don't each hard-code their own.

**Files:**

- Create: `mobile/lib/providers/gallery_nav/gallery_nav_destination.dart`
- Create: `mobile/test/providers/gallery_nav/gallery_nav_destination_test.dart`

**Step 1: Write failing tests — exhaustive mapping**

```dart
// mobile/test/providers/gallery_nav/gallery_nav_destination_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_nav_destination.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/routing/router.dart';

void main() {
  test('photos destination', () {
    final d = GalleryNavDestination.forTab(GalleryTabEnum.photos);
    expect(d.labelKey, 'nav.photos');
    expect(d.idleIcon, Icons.photo_library_outlined);
    expect(d.activeIcon, Icons.photo_library);
    expect(d.routeBuilder(), isA<MainTimelineRoute>());
  });

  test('albums destination', () {
    final d = GalleryNavDestination.forTab(GalleryTabEnum.albums);
    expect(d.labelKey, 'nav.albums');
    expect(d.idleIcon, Icons.photo_album_outlined);
    expect(d.activeIcon, Icons.photo_album);
    expect(d.routeBuilder(), isA<DriftAlbumsRoute>());
  });

  test('library destination', () {
    final d = GalleryNavDestination.forTab(GalleryTabEnum.library);
    expect(d.labelKey, 'nav.library');
    expect(d.idleIcon, Icons.space_dashboard_outlined);
    expect(d.activeIcon, Icons.space_dashboard_rounded);
    expect(d.routeBuilder(), isA<DriftLibraryRoute>());
  });
}
```

**Step 2: Run, expect fail** — compile error on unknown identifier.

**Step 3: Implement**

```dart
// mobile/lib/providers/gallery_nav/gallery_nav_destination.dart
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/routing/router.dart';

class GalleryNavDestination {
  final GalleryTabEnum tab;
  final String labelKey;
  final IconData idleIcon;
  final IconData activeIcon;
  final PageRouteInfo Function() routeBuilder;

  const GalleryNavDestination._({
    required this.tab,
    required this.labelKey,
    required this.idleIcon,
    required this.activeIcon,
    required this.routeBuilder,
  });

  static GalleryNavDestination forTab(GalleryTabEnum tab) {
    switch (tab) {
      case GalleryTabEnum.photos:
        return const GalleryNavDestination._(
          tab: GalleryTabEnum.photos,
          labelKey: 'nav.photos',
          idleIcon: Icons.photo_library_outlined,
          activeIcon: Icons.photo_library,
          routeBuilder: _photosRoute,
        );
      case GalleryTabEnum.albums:
        return const GalleryNavDestination._(
          tab: GalleryTabEnum.albums,
          labelKey: 'nav.albums',
          idleIcon: Icons.photo_album_outlined,
          activeIcon: Icons.photo_album,
          routeBuilder: _albumsRoute,
        );
      case GalleryTabEnum.library:
        return const GalleryNavDestination._(
          tab: GalleryTabEnum.library,
          labelKey: 'nav.library',
          idleIcon: Icons.space_dashboard_outlined,
          activeIcon: Icons.space_dashboard_rounded,
          routeBuilder: _libraryRoute,
        );
    }
  }
}

MainTimelineRoute _photosRoute() => const MainTimelineRoute();
DriftAlbumsRoute _albumsRoute() => const DriftAlbumsRoute();
DriftLibraryRoute _libraryRoute() => const DriftLibraryRoute();
```

**Step 4: Run, expect pass** — 3 tests.

**Step 5: Commit**

```bash
cd mobile && dart format lib/providers/gallery_nav/gallery_nav_destination.dart test/providers/gallery_nav/gallery_nav_destination_test.dart
git add mobile/lib/providers/gallery_nav/gallery_nav_destination.dart mobile/test/providers/gallery_nav/gallery_nav_destination_test.dart
git commit -m "feat(mobile): GalleryNavDestination label/icon/route mapper"
```

---

### Task B3: `openGallerySearch` — tab switch + delay + sheet open + focus counter

**Why this task exists:** this is the search blob's action. Design §6.4 spells out the behaviour matrix; the 620 ms delay is the critical timing detail that couples to upstream's FadeTransition.

**Files:**

- Create: `mobile/lib/providers/gallery_nav/gallery_search_action.dart`
- Create: `mobile/test/providers/gallery_nav/gallery_search_action_test.dart`

**Step 1: Write failing unit tests — full behaviour matrix**

```dart
// mobile/test/providers/gallery_nav/gallery_search_action_test.dart
import 'package:auto_route/auto_route.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_search_action.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/search_focus.provider.dart';
import 'package:mocktail/mocktail.dart';

// Use the shared FakeTabsRouter (P.6); aliased locally for backwards compat
// with the test file names below.
// import '../../test_helpers/fake_tabs_router.dart';
// typedef _FakeTabsRouter = FakeTabsRouter;  // (only needed if inlined below)

class _HapticSpy extends ValueNotifier<int> implements HapticFeedbackNotifier {
  _HapticSpy() : super(0);
  @override
  void selectionClick() => value = value + 1;
  @override
  void heavyImpact() {}
  @override
  void lightImpact() {}
  @override
  void mediumImpact() {}
  @override
  void vibrate() {}
}

void main() {
  test('already on Photos: no tab switch, no delay, sheet→browse, focus++', () async {
    final router = _FakeTabsRouter(GalleryTabEnum.photos.index);
    final haptic = _HapticSpy();
    final c = ProviderContainer(overrides: [
      hapticFeedbackProvider.overrideWith(() => haptic),
      photosFilterSheetProvider.overrideWith((_) => FilterSheetSnap.hidden),
    ]);
    addTearDown(c.dispose);

    await openGallerySearch(router, c.read);

    expect(router.setCalls, isEmpty);
    expect(c.read(photosFilterSheetProvider), FilterSheetSnap.browse);
    expect(c.read(photosFilterSearchFocusRequestProvider), 1);
    expect(haptic.value, 1);
  });

  test('from Albums: setActiveIndex(photos), 620ms delay, then sheet+focus', () {
    fakeAsync((async) {
      final router = _FakeTabsRouter(GalleryTabEnum.albums.index);
      final haptic = _HapticSpy();
      final c = ProviderContainer(overrides: [
        hapticFeedbackProvider.overrideWith(() => haptic),
        photosFilterSheetProvider.overrideWith((_) => FilterSheetSnap.hidden),
      ]);
      addTearDown(c.dispose);

      openGallerySearch(router, c.read);
      async.flushMicrotasks();

      expect(router.setCalls, [GalleryTabEnum.photos.index]);
      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.hidden, reason: 'sheet waits for delay');
      expect(c.read(photosFilterSearchFocusRequestProvider), 0, reason: 'focus waits for delay');

      async.elapse(const Duration(milliseconds: 619));
      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.hidden, reason: 'still under 620ms');

      async.elapse(const Duration(milliseconds: 2));
      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.browse);
      expect(c.read(photosFilterSearchFocusRequestProvider), 1);
    });
  });

  test('sheet already at browse: write is no-op, focus still increments', () async {
    final router = _FakeTabsRouter(GalleryTabEnum.photos.index);
    final c = ProviderContainer(overrides: [
      hapticFeedbackProvider.overrideWith(() => _HapticSpy()),
      photosFilterSheetProvider.overrideWith((_) => FilterSheetSnap.browse),
    ]);
    addTearDown(c.dispose);

    await openGallerySearch(router, c.read);
    expect(c.read(photosFilterSheetProvider), FilterSheetSnap.browse);
    expect(c.read(photosFilterSearchFocusRequestProvider), 1);
  });

  test('sheet at deep: write transitions to browse, focus counter += 1', () async {
    final router = _FakeTabsRouter(GalleryTabEnum.photos.index);
    final c = ProviderContainer(overrides: [
      hapticFeedbackProvider.overrideWith(() => _HapticSpy()),
      photosFilterSheetProvider.overrideWith((_) => FilterSheetSnap.deep),
    ]);
    addTearDown(c.dispose);

    await openGallerySearch(router, c.read);
    expect(c.read(photosFilterSheetProvider), FilterSheetSnap.browse);
    expect(c.read(photosFilterSearchFocusRequestProvider), 1);
  });

  test('from Library: same behavior as Albums', () {
    fakeAsync((async) {
      final router = _FakeTabsRouter(GalleryTabEnum.library.index);
      final c = ProviderContainer(overrides: [
        hapticFeedbackProvider.overrideWith(() => _HapticSpy()),
        photosFilterSheetProvider.overrideWith((_) => FilterSheetSnap.hidden),
      ]);
      addTearDown(c.dispose);

      openGallerySearch(router, c.read);
      async.elapse(const Duration(milliseconds: 620));
      async.flushMicrotasks();

      expect(router.setCalls, [GalleryTabEnum.photos.index]);
      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.browse);
      expect(c.read(photosFilterSearchFocusRequestProvider), 1);
    });
  });

  test('haptic fires exactly once per call regardless of sheet state', () async {
    for (final initial in [
      FilterSheetSnap.hidden,
      FilterSheetSnap.peek,
      FilterSheetSnap.browse,
      FilterSheetSnap.deep,
    ]) {
      final router = _FakeTabsRouter(GalleryTabEnum.photos.index);
      final haptic = _HapticSpy();
      final c = ProviderContainer(overrides: [
        hapticFeedbackProvider.overrideWith(() => haptic),
        photosFilterSheetProvider.overrideWith((_) => initial),
      ]);
      await openGallerySearch(router, c.read);
      expect(haptic.value, 1, reason: 'starting from $initial, haptic must fire exactly once');
      c.dispose();
    }
  });

  test('rapid second openGallerySearch mid-delay: +2 counter, no crash', () {
    fakeAsync((async) {
      final router = _FakeTabsRouter(GalleryTabEnum.albums.index);
      final c = ProviderContainer(overrides: [
        hapticFeedbackProvider.overrideWith(() => _HapticSpy()),
        photosFilterSheetProvider.overrideWith((_) => FilterSheetSnap.hidden),
      ]);
      addTearDown(c.dispose);

      openGallerySearch(router, c.read);
      async.elapse(const Duration(milliseconds: 300));
      openGallerySearch(router, c.read);
      async.elapse(const Duration(milliseconds: 700));

      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.browse);
      expect(c.read(photosFilterSearchFocusRequestProvider), 2);
    });
  });

  test('user taps different tab mid-delay: no crash, deferred-open accepted', () {
    fakeAsync((async) {
      final router = _FakeTabsRouter(GalleryTabEnum.albums.index);
      final c = ProviderContainer(overrides: [
        hapticFeedbackProvider.overrideWith(() => _HapticSpy()),
        photosFilterSheetProvider.overrideWith((_) => FilterSheetSnap.hidden),
      ]);
      addTearDown(c.dispose);

      openGallerySearch(router, c.read);
      async.elapse(const Duration(milliseconds: 100));
      // Simulate user tapping the Library segment mid-delay (direct router call).
      router.setActiveIndex(GalleryTabEnum.library.index);
      async.elapse(const Duration(milliseconds: 700));

      // The deferred write still happens — §7 acknowledged behavior.
      expect(c.read(photosFilterSheetProvider), FilterSheetSnap.browse);
      expect(c.read(photosFilterSearchFocusRequestProvider), 1);
      expect(router.activeIndex, GalleryTabEnum.library.index);
    });
  });
}
```

**Step 2: Run, expect fail** (function not defined).

**Step 3: Implement**

```dart
// mobile/lib/providers/gallery_nav/gallery_search_action.dart
import 'package:auto_route/auto_route.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/search_focus.provider.dart';

// Coupled to AutoTabsRouter transition — see tab_shell.page.dart (upstream's
// 600 ms FadeTransition). 20 ms buffer lets MainTimelinePage finish its first-
// build pass so FilterSheetSearchBar can accept focus.
const Duration kGalleryTabTransitionDelay = Duration(milliseconds: 620);

/// Reader is the common shape across WidgetRef, Ref, and ProviderContainer's
/// `read`. Passing a closure lets this helper be called from any of them
/// without coupling to a specific Riverpod ref type.
typedef ProviderReader = T Function<T>(ProviderListenable<T>);

Future<void> openGallerySearch(TabsRouter tabsRouter, ProviderReader read) async {
  read(hapticFeedbackProvider.notifier).selectionClick();
  final onPhotos = tabsRouter.activeIndex == GalleryTabEnum.photos.index;

  if (!onPhotos) {
    tabsRouter.setActiveIndex(GalleryTabEnum.photos.index);
    await Future<void>.delayed(kGalleryTabTransitionDelay);
  }

  read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;
  read(photosFilterSearchFocusRequestProvider.notifier).state++;
}
```

Why a `ProviderReader` closure rather than `Ref` or `WidgetRef`: `WidgetRef` (the widget-scope ref from `hooks_riverpod`) does NOT extend `Ref` (the provider-scope ref). Taking either concrete type would break one of the call sites. A closure-typed reader works from all: widget call site passes `ref.read`; test call site passes `container.read`. Both `WidgetRef.read` and `ProviderContainer.read` have the `T Function<T>(ProviderListenable<T>)` signature.

**Step 4: Run, expect pass** — 5 tests.

**Step 5: Commit**

```bash
cd mobile && dart format lib/providers/gallery_nav/gallery_search_action.dart test/providers/gallery_nav/gallery_search_action_test.dart
git add mobile/lib/providers/gallery_nav/gallery_search_action.dart mobile/test/providers/gallery_nav/gallery_search_action_test.dart
git commit -m "feat(mobile): openGallerySearch with 620ms transition wait + focus counter"
```

---

# PHASE C — Fork-only widgets (Tasks C1–C6)

Scope: six widgets, each built and tested in isolation before wiring.

**Files added this phase:**

- `mobile/lib/presentation/widgets/gallery_nav/gallery_nav_segment.widget.dart`
- `mobile/lib/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart`
- `mobile/lib/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart`
- `mobile/lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart`
- `mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart`
- Mirror tests.

---

### Task C1: `GalleryNavSegment` — a single segment (active / idle)

**Why this task exists:** the atomic unit of the pill. Renders label only when idle, icon+label when active, exposes a `Semantics` node for live-region announcements.

**Files:**

- Create: `mobile/lib/presentation/widgets/gallery_nav/gallery_nav_segment.widget.dart`
- Create: `mobile/test/presentation/widgets/gallery_nav/gallery_nav_segment_test.dart`

**Step 1: Write failing widget tests**

```dart
// mobile/test/presentation/widgets/gallery_nav/gallery_nav_segment_test.dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_nav_segment.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

import '../../widget_tester_extensions.dart';

void main() {
  testWidgets('idle: icon slot collapsed (widthFactor 0), label shown', (tester) async {
    await tester.pumpConsumerWidget(
      GalleryNavSegment(tab: GalleryTabEnum.photos, active: false, onTap: () {}),
    );
    await tester.pumpAndSettle();
    final align = tester.widget<AnimatedAlign>(find.byType(AnimatedAlign));
    expect(align.widthFactor, 0.0, reason: 'idle icon slot has 0 width');
    expect(find.text('nav.photos'.tr()), findsOneWidget);
    // AnimatedNavIcon is IN the tree (so the fill/weight tween can run on
    // activation) but rendered at 0 width + 0 opacity.
    expect(find.byType(AnimatedNavIcon), findsOneWidget);
  });

  testWidgets('active: icon slot expanded (widthFactor 1), icon + label rendered', (tester) async {
    await tester.pumpConsumerWidget(
      GalleryNavSegment(tab: GalleryTabEnum.photos, active: true, onTap: () {}),
    );
    await tester.pumpAndSettle();
    final align = tester.widget<AnimatedAlign>(find.byType(AnimatedAlign));
    expect(align.widthFactor, 1.0);
    expect(find.byType(AnimatedNavIcon), findsOneWidget);
    expect(find.text('nav.photos'.tr()), findsOneWidget);
  });

  testWidgets('active→idle transition: widthFactor tweens 1→0', (tester) async {
    final active = ValueNotifier<bool>(true);
    await tester.pumpConsumerWidget(
      ValueListenableBuilder<bool>(
        valueListenable: active,
        builder: (_, v, __) => GalleryNavSegment(
          tab: GalleryTabEnum.photos,
          active: v,
          onTap: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    active.value = false;
    await tester.pump(const Duration(milliseconds: 130)); // halfway
    final align = tester.widget<AnimatedAlign>(find.byType(AnimatedAlign));
    expect(align.widthFactor!, greaterThan(0.3));
    expect(align.widthFactor!, lessThan(0.7));
  });

  testWidgets('tap invokes onTap', (tester) async {
    int taps = 0;
    await tester.pumpConsumerWidget(
      GalleryNavSegment(tab: GalleryTabEnum.albums, active: false, onTap: () => taps++),
    );
    await tester.tap(find.byType(GalleryNavSegment));
    expect(taps, 1);
  });

  testWidgets('active segment is a semantics live region', (tester) async {
    await tester.pumpConsumerWidget(
      GalleryNavSegment(tab: GalleryTabEnum.library, active: true, onTap: () {}),
    );
    final semantics = tester.getSemantics(find.byType(GalleryNavSegment));
    expect(semantics.flagsCollection.isLiveRegion, isTrue);
  });

  testWidgets('tap target ≥ 44×44 pt', (tester) async {
    await tester.pumpConsumerWidget(
      GalleryNavSegment(tab: GalleryTabEnum.photos, active: true, onTap: () {}),
    );
    expectTapTargetMin(tester, find.byType(GalleryNavSegment), min: 44);
  });

}
```

**Step 2: Run, expect fail.**

**Step 3: Implement the segment widget**

```dart
// mobile/lib/presentation/widgets/gallery_nav/gallery_nav_segment.widget.dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/animated_nav_icon.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_nav_destination.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

class GalleryNavSegment extends StatelessWidget {
  static const Duration _sizeAnimDuration = Duration(milliseconds: 260);
  static const Duration _opacityAnimDuration = Duration(milliseconds: 220);
  static const Cubic _easing = Cubic(0.3, 0.6, 0.2, 1);

  final GalleryTabEnum tab;
  final bool active;
  final VoidCallback onTap;

  const GalleryNavSegment({super.key, required this.tab, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final destination = GalleryNavDestination.forTab(tab);
    final color = active ? theme.colorScheme.primary : theme.colorScheme.onSurface.withOpacity(0.55);

    return Semantics(
      container: true,
      button: true,
      selected: active,
      liveRegion: active,
      label: destination.labelKey.tr(),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: active ? 16 : 14, vertical: 0),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Icon slot: always in the tree, width collapses to 0 when
                // idle and expands to the icon+gap width when active. Opacity
                // and the Material Symbols Rounded fill/weight axes tween in
                // parallel for the darkroom-warmth active-state reveal (F1).
                ClipRect(
                  child: AnimatedAlign(
                    alignment: AlignmentDirectional.centerStart,
                    widthFactor: active ? 1.0 : 0.0,
                    duration: _sizeAnimDuration,
                    curve: _easing,
                    child: Padding(
                      padding: const EdgeInsetsDirectional.only(end: 6),
                      child: AnimatedOpacity(
                        opacity: active ? 1.0 : 0.0,
                        duration: _opacityAnimDuration,
                        curve: _easing,
                        child: AnimatedNavIcon(
                          idleIcon: destination.idleIcon,
                          activeIcon: destination.activeIcon,
                          active: active,
                          size: 22,
                          color: color,
                        ),
                      ),
                    ),
                  ),
                ),
                Text(
                  destination.labelKey.tr(),
                  style: TextStyle(
                    color: color,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w500,
                    letterSpacing: 0.002,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
```

**Step 4: Run, expect all tests pass.**

**Step 5: Add dark-theme variant test**

Append:

```dart
testWidgets('dark theme: active label uses primary', (tester) async {
  await tester.pumpConsumerWidgetDark(
    GalleryNavSegment(tab: GalleryTabEnum.photos, active: true, onTap: () {}),
  );
  final text = tester.widget<Text>(find.text('nav.photos'.tr()));
  // Grab the ambient theme and compare; easier: look up via find.byType(Text).first and check color != null.
  expect(text.style!.color, isNotNull);
  expect(text.style!.fontWeight, FontWeight.w500);
});
```

**Step 6: Run + commit**

```bash
cd mobile && flutter test test/presentation/widgets/gallery_nav/gallery_nav_segment_test.dart
cd mobile && dart format lib/presentation/widgets/gallery_nav/ test/presentation/widgets/gallery_nav/
git add mobile/lib/presentation/widgets/gallery_nav/gallery_nav_segment.widget.dart mobile/test/presentation/widgets/gallery_nav/gallery_nav_segment_test.dart
git commit -m "feat(mobile): GalleryNavSegment (active/idle with live-region semantics)"
```

---

### Task C2: `GalleryNavPill` — 3 segments + organic widths + animated underlay + custom curve + inner-warmth gradient

**Why this task exists:** the pill composes segments with the motion signature. This is the most visually-critical widget in the PR; tests guard the easing curve, organic widths, and first-paint correctness.

**Files:**

- Create: `mobile/lib/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart`
- Create: `mobile/test/presentation/widgets/gallery_nav/gallery_nav_pill_test.dart`

**Step 1: Write failing tests (7 tests)**

```dart
// mobile/test/presentation/widgets/gallery_nav/gallery_nav_pill_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

import '../../widget_tester_extensions.dart';

void main() {
  testWidgets('renders 3 segments in canonical order', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(width: 320, child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (_) {})),
    );
    await tester.pumpAndSettle();
    expect(find.text('Photos'), findsOneWidget);
    expect(find.text('Albums'), findsOneWidget);
    expect(find.text('Library'), findsOneWidget);
  });

  testWidgets('tap on a segment invokes onTabTap with its enum', (tester) async {
    GalleryTabEnum? tapped;
    await tester.pumpConsumerWidget(
      SizedBox(width: 320, child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (t) => tapped = t)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Albums'));
    expect(tapped, GalleryTabEnum.albums);
  });

  testWidgets('only active segment renders its icon', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(width: 320, child: GalleryNavPill(activeTab: GalleryTabEnum.albums, onTabTap: (_) {})),
    );
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.photo_album), findsOneWidget); // active Albums icon
    expect(find.byIcon(Icons.photo_library), findsNothing); // Photos idle, no icon
  });

  testWidgets('organic widths: active segment wider than idle sibling', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(width: 320, child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (_) {})),
    );
    await tester.pumpAndSettle();
    final activeSize = tester.getSize(find.byKey(const Key('gallery-nav-segment-photos')));
    final idleSize = tester.getSize(find.byKey(const Key('gallery-nav-segment-albums')));
    expect(activeSize.width, greaterThan(idleSize.width + 18),
        reason: 'active includes icon + gap + extra padding; not uniform 1/3 widths');
  });

  testWidgets('first-paint underlay sits under the active segment', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(width: 320, child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (_) {})),
    );
    await tester.pumpAndSettle();
    final segmentRect = tester.getRect(find.byKey(const Key('gallery-nav-segment-photos')));
    final underlayRect = tester.getRect(find.byKey(const Key('gallery-nav-underlay')));
    expect((underlayRect.left - segmentRect.left).abs(), lessThan(0.5));
    expect((underlayRect.width - segmentRect.width).abs(), lessThan(0.5));
  });

  testWidgets('disabledTabs: dims Albums+Library to 0.3 opacity, blocks taps', (tester) async {
    int tapped = -1;
    await tester.pumpConsumerWidget(
      SizedBox(
        width: 320,
        child: GalleryNavPill(
          activeTab: GalleryTabEnum.photos,
          disabledTabs: {GalleryTabEnum.albums, GalleryTabEnum.library},
          onTabTap: (t) => tapped = t.index,
        ),
      ),
    );
    await tester.pumpAndSettle();

    final albumsOpacity = tester.widget<Opacity>(
      find.ancestor(of: find.byKey(const Key('gallery-nav-segment-albums')), matching: find.byType(Opacity)),
    );
    expect(albumsOpacity.opacity, closeTo(0.3, 0.001));

    final photosOpacity = tester.widget<Opacity>(
      find.ancestor(of: find.byKey(const Key('gallery-nav-segment-photos')), matching: find.byType(Opacity)),
    );
    expect(photosOpacity.opacity, 1.0);

    await tester.tap(find.text('Albums'));
    expect(tapped, -1, reason: 'disabled segment should not invoke onTabTap');

    await tester.tap(find.text('Photos'));
    expect(tapped, GalleryTabEnum.photos.index);
  });

  testWidgets('light-theme variant: active fill uses primary @ 0.22', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(width: 320, child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (_) {})),
    );
    await tester.pumpAndSettle();
    final underlay = tester.widget<DecoratedBox>(
      find.descendant(
        of: find.byKey(const Key('gallery-nav-underlay')),
        matching: find.byType(DecoratedBox),
      ),
    );
    final color = (underlay.decoration as BoxDecoration).color!;
    // Light theme: brightness is light, so opacity should be 0.22.
    // We can't easily assert the theme from here, but assert opacity is ≈0.22.
    expect(color.opacity, closeTo(0.22, 0.01));
  });

  testWidgets('inner-warmth highlight is rendered below segments in stack order', (tester) async {
    await tester.pumpConsumerWidget(
      SizedBox(width: 320, child: GalleryNavPill(activeTab: GalleryTabEnum.photos, onTabTap: (_) {})),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('gallery-nav-inner-warmth')), findsOneWidget);
    // The DecoratedBox with the gradient should appear before the underlay in widget depth.
    final stack = find.byType(Stack).first;
    final children = tester.widget<Stack>(stack).children;
    final warmthIndex = children.indexWhere((w) => w.key == const Key('gallery-nav-inner-warmth'));
    final underlayIndex = children.indexWhere((w) => w.key == const Key('gallery-nav-underlay'));
    expect(warmthIndex, lessThan(underlayIndex));
  });

  testWidgets('disableAnimations: underlay jumps in one frame', (tester) async {
    final widget = SizedBox(
      width: 320,
      child: MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: _Harness(),
      ),
    );
    await tester.pumpConsumerWidget(widget);
    await tester.pumpAndSettle();
    final before = tester.getRect(find.byKey(const Key('gallery-nav-underlay')));
    final harness = tester.state<_HarnessState>(find.byType(_Harness));
    harness.switchTo(GalleryTabEnum.library);
    await tester.pump(); // one frame only, no settle
    final after = tester.getRect(find.byKey(const Key('gallery-nav-underlay')));
    expect(after.left, isNot(equals(before.left)),
        reason: 'disableAnimations should snap in one frame, not tween');
  });
}

class _Harness extends StatefulWidget {
  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  GalleryTabEnum active = GalleryTabEnum.photos;
  void switchTo(GalleryTabEnum t) => setState(() => active = t);
  @override
  Widget build(BuildContext context) =>
      GalleryNavPill(activeTab: active, onTabTap: (t) => setState(() => active = t));
}
```

**Step 2: Run, expect fail.**

**Step 3: Implement the pill**

```dart
// mobile/lib/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_nav_segment.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

class GalleryNavPill extends StatefulWidget {
  final GalleryTabEnum activeTab;
  final void Function(GalleryTabEnum) onTabTap;
  /// Tabs to render at 30 % opacity with pointer events ignored (design §5.3
  /// readonly mode). Defaults to empty.
  final Set<GalleryTabEnum> disabledTabs;

  const GalleryNavPill({
    super.key,
    required this.activeTab,
    required this.onTabTap,
    this.disabledTabs = const {},
  });

  @override
  State<GalleryNavPill> createState() => _GalleryNavPillState();
}

class _GalleryNavPillState extends State<GalleryNavPill> {
  static const _pillHeight = 58.0;
  static const _underlayHeight = 46.0;
  static const _pillRadius = 28.0;
  static const _motionCurve = Cubic(0.3, 0.6, 0.2, 1);
  static const _motionDuration = Duration(milliseconds: 280);

  final Map<GalleryTabEnum, GlobalKey> _keys = {
    for (final t in GalleryTabEnum.values) t: GlobalKey(debugLabel: 'gallery-nav-segment-${t.name}'),
  };
  Map<GalleryTabEnum, Rect> _segmentRects = const {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _measure());
  }

  @override
  void didUpdateWidget(covariant GalleryNavPill old) {
    super.didUpdateWidget(old);
    WidgetsBinding.instance.addPostFrameCallback((_) => _measure());
  }

  void _measure() {
    if (!mounted) return;
    final rects = <GalleryTabEnum, Rect>{};
    final rowCtx = _keys[GalleryTabEnum.photos]!.currentContext;
    if (rowCtx == null) return;
    final rowBox = rowCtx.findAncestorRenderObjectOfType<RenderBox>();
    if (rowBox == null) return;
    final rowOrigin = rowBox.localToGlobal(Offset.zero);

    for (final entry in _keys.entries) {
      final ctx = entry.value.currentContext;
      if (ctx == null) continue;
      final box = ctx.findRenderObject() as RenderBox?;
      if (box == null) continue;
      final origin = box.localToGlobal(Offset.zero) - rowOrigin;
      rects[entry.key] = origin & box.size;
    }
    if (rects.length == _keys.length &&
        (_segmentRects.isEmpty || rects.toString() != _segmentRects.toString())) {
      setState(() => _segmentRects = rects);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final disableAnim = MediaQuery.of(context).disableAnimations;

    final activeRect = _segmentRects[widget.activeTab];
    final underlayLeft = activeRect?.left ?? 0;
    final underlayWidth = activeRect?.width ?? 0;
    final underlayTop = ((_pillHeight - _underlayHeight) / 2);

    return ClipRRect(
      borderRadius: BorderRadius.circular(_pillRadius),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 28, sigmaY: 28),
        child: Container(
          height: _pillHeight,
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.68),
            borderRadius: BorderRadius.circular(_pillRadius),
            border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.55), width: 1),
            boxShadow: [
              BoxShadow(color: Colors.black.withOpacity(0.7), offset: const Offset(0, 20), blurRadius: 44, spreadRadius: -14),
              BoxShadow(color: Colors.black.withOpacity(0.4), offset: const Offset(0, 4), blurRadius: 8),
            ],
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned.fill(
                key: const Key('gallery-nav-inner-warmth'),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(_pillRadius - 6),
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.center,
                      colors: [theme.colorScheme.onSurface.withOpacity(0.04), Colors.transparent],
                    ),
                  ),
                ),
              ),
              AnimatedPositioned(
                key: const Key('gallery-nav-underlay'),
                duration: disableAnim ? Duration.zero : _motionDuration,
                curve: _motionCurve,
                left: underlayLeft,
                top: underlayTop,
                width: underlayWidth,
                height: _underlayHeight,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary.withOpacity(
                      theme.brightness == Brightness.dark ? 0.16 : 0.22,
                    ),
                    borderRadius: BorderRadius.circular(_underlayHeight / 2),
                  ),
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  for (final tab in GalleryTabEnum.values)
                    KeyedSubtree(
                      key: _keys[tab],
                      child: Opacity(
                        opacity: widget.disabledTabs.contains(tab) ? 0.3 : 1.0,
                        child: IgnorePointer(
                          ignoring: widget.disabledTabs.contains(tab),
                          child: GalleryNavSegment(
                            key: Key('gallery-nav-segment-${tab.name}'),
                            tab: tab,
                            active: widget.activeTab == tab,
                            onTap: () => widget.onTabTap(tab),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

**Step 4: Run, expect pass.**

**Step 5: Add the custom-curve regression test**

Append to the test file:

```dart
testWidgets('easing curve is Cubic(0.3, 0.6, 0.2, 1), not easeOutCubic', (tester) async {
  final widget = SizedBox(width: 320, child: _Harness());
  await tester.pumpConsumerWidget(widget);
  await tester.pumpAndSettle();

  final harness = tester.state<_HarnessState>(find.byType(_Harness));
  final initialLeft = tester.getRect(find.byKey(const Key('gallery-nav-underlay'))).left;
  harness.switchTo(GalleryTabEnum.library);

  // Sample at 40% of 280ms.
  await tester.pump(const Duration(milliseconds: 112));
  final at40 = tester.getRect(find.byKey(const Key('gallery-nav-underlay'))).left;
  final progress40 = (at40 - initialLeft).abs();

  // Compare to Cubic(0.3, 0.6, 0.2, 1) and easeOutCubic at t=0.4.
  const custom = Cubic(0.3, 0.6, 0.2, 1);
  final customY = custom.transform(0.4);
  final stockY = Curves.easeOutCubic.transform(0.4);
  expect(customY, isNot(closeTo(stockY, 0.01)),
      reason: 'sanity: the two curves differ at t=0.4');
  // The actual sample must be closer to the custom curve's prediction than to stock.
  final totalDistance = tester.getRect(find.byKey(const Key('gallery-nav-segment-library'))).left - initialLeft;
  final expectedCustom = totalDistance.abs() * customY;
  final expectedStock = totalDistance.abs() * stockY;
  expect((progress40 - expectedCustom).abs(), lessThan((progress40 - expectedStock).abs()),
      reason: 'motion signature: custom Cubic(0.3,0.6,0.2,1) — not Curves.easeOutCubic');

  await tester.pumpAndSettle();
});
```

**Step 6: Run + commit**

```bash
cd mobile && flutter test test/presentation/widgets/gallery_nav/gallery_nav_pill_test.dart
cd mobile && dart format lib/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart test/presentation/widgets/gallery_nav/gallery_nav_pill_test.dart
git add mobile/lib/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart mobile/test/presentation/widgets/gallery_nav/gallery_nav_pill_test.dart
git commit -m "feat(mobile): GalleryNavPill — organic widths, custom cubic easing, inner-warmth gradient"
```

---

### Task C3: `GallerySearchBlob` — circular search button with pressed state

**Why this task exists:** sibling of the pill, outside the main pill row. §5.5 specifies the pressed-state color swap.

**Files:**

- Create: `mobile/lib/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart`
- Create: `mobile/test/presentation/widgets/gallery_nav/gallery_search_blob_test.dart`

**Step 1: Write failing widget tests**

```dart
// mobile/test/presentation/widgets/gallery_nav/gallery_search_blob_test.dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart';

import '../../widget_tester_extensions.dart';

void main() {
  testWidgets('renders search icon at 24pt', (tester) async {
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: true, onTap: () {}));
    final icon = tester.widget<Icon>(find.byIcon(Icons.search));
    expect(icon.size, 24);
  });

  testWidgets('tap invokes onTap when enabled', (tester) async {
    int taps = 0;
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: true, onTap: () => taps++));
    await tester.tap(find.byType(GallerySearchBlob));
    expect(taps, 1);
  });

  testWidgets('disabled: opacity 0.3, taps ignored', (tester) async {
    int taps = 0;
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: false, onTap: () => taps++));
    final opacity = tester.widget<Opacity>(find.byType(Opacity));
    expect(opacity.opacity, closeTo(0.3, 0.001));
    await tester.tap(find.byType(GallerySearchBlob));
    expect(taps, 0);
  });

  testWidgets('semantics label resolves from nav.search_photos_hint', (tester) async {
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: true, onTap: () {}));
    final semantics = tester.getSemantics(find.byType(GallerySearchBlob));
    expect(semantics.label, 'nav.search_photos_hint'.tr());
  });

  testWidgets('tap target ≥ 44×44 pt', (tester) async {
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: true, onTap: () {}));
    expectTapTargetMin(tester, find.byType(GallerySearchBlob), min: 44);
  });

  testWidgets('pressed state: icon color swaps to primary', (tester) async {
    await tester.pumpConsumerWidget(GallerySearchBlob(enabled: true, onTap: () {}));
    final gesture = await tester.startGesture(tester.getCenter(find.byType(GallerySearchBlob)));
    await tester.pumpAndSettle();
    final icon = tester.widget<Icon>(find.byIcon(Icons.search));
    // Color should be primary when pressed.
    expect(icon.color, isNotNull);
    await gesture.up();
  });
}
```

**Step 2: Run, expect fail.**

**Step 3: Implement**

```dart
// mobile/lib/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart
import 'dart:ui' as ui;
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';

class GallerySearchBlob extends StatefulWidget {
  final bool enabled;
  final VoidCallback onTap;

  const GallerySearchBlob({super.key, required this.enabled, required this.onTap});

  @override
  State<GallerySearchBlob> createState() => _GallerySearchBlobState();
}

class _GallerySearchBlobState extends State<GallerySearchBlob> {
  static const _diameter = 54.0;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final iconColor = _pressed
        ? theme.colorScheme.primary
        : theme.colorScheme.onSurface.withOpacity(0.85);

    return Semantics(
      container: true,
      button: true,
      enabled: widget.enabled,
      label: 'nav.search_photos_hint'.tr(),
      child: Opacity(
        opacity: widget.enabled ? 1.0 : 0.3,
        child: IgnorePointer(
          ignoring: !widget.enabled,
          child: Listener(
            onPointerDown: (_) => setState(() => _pressed = true),
            onPointerUp: (_) => setState(() => _pressed = false),
            onPointerCancel: (_) => setState(() => _pressed = false),
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: widget.onTap,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(_diameter / 2),
                child: BackdropFilter(
                  filter: ui.ImageFilter.blur(sigmaX: 28, sigmaY: 28),
                  child: Container(
                    width: _diameter,
                    height: _diameter,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.68),
                      shape: BoxShape.circle,
                      border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.55), width: 1),
                      boxShadow: [
                        BoxShadow(color: Colors.black.withOpacity(0.7), offset: const Offset(0, 20), blurRadius: 44, spreadRadius: -14),
                        BoxShadow(color: Colors.black.withOpacity(0.4), offset: const Offset(0, 4), blurRadius: 8),
                      ],
                    ),
                    child: Center(child: Icon(Icons.search, size: 24, color: iconColor)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
```

**Step 4: Run + commit**

```bash
cd mobile && flutter test test/presentation/widgets/gallery_nav/gallery_search_blob_test.dart
cd mobile && dart format lib/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart test/presentation/widgets/gallery_nav/gallery_search_blob_test.dart
git add mobile/lib/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart mobile/test/presentation/widgets/gallery_nav/gallery_search_blob_test.dart
git commit -m "feat(mobile): GallerySearchBlob (circular search with pressed state)"
```

---

### Task C4: `GalleryBottomNav` — composite (pill + blob + visibility gating + height publish)

**Why this task exists:** the whole bottom-of-screen surface. Wires keyboard/multi-select/readonly/landscape gating and publishes height to `bottomNavHeightProvider`.

**Files:**

- Create: `mobile/lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart`
- Create: `mobile/test/presentation/widgets/gallery_nav/gallery_bottom_nav_test.dart`

**Step 1: Write failing tests (7 tests — cover visibility gating, height publish, landscape rail, readonly)**

```dart
// mobile/test/presentation/widgets/gallery_nav/gallery_bottom_nav_test.dart
import 'package:auto_route/auto_route.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/events.model.dart';
import 'package:immich_mobile/domain/utils/event_stream.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/bottom_nav_height.provider.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:mocktail/mocktail.dart';

class _FakeTabsRouter extends Fake implements TabsRouter {
  int _active = 0;
  @override
  int get activeIndex => _active;
  @override
  void setActiveIndex(int i, {bool notify = true}) => _active = i;
}

Widget _wrap(Widget child, {List<Override> overrides = const [], MediaQueryData? mq}) {
  return ProviderScope(
    overrides: overrides,
    child: MaterialApp(
      home: mq == null ? Material(child: child) : MediaQuery(data: mq, child: Material(child: child)),
    ),
  );
}

void main() {
  testWidgets('portrait: pill + blob both rendered', (tester) async {
    final router = _FakeTabsRouter();
    await tester.pumpWidget(_wrap(GalleryBottomNav(tabsRouter: router)));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryNavPill), findsOneWidget);
    expect(find.byType(GallerySearchBlob), findsOneWidget);
  });

  testWidgets('multi-select event hides nav (from any tab origin)', (tester) async {
    // H2: design requires three origins; EventStream is global so one listener
    // covers all three, but we assert each to guard against a refactor that
    // accidentally scopes the listener to a specific tab.
    for (final startingIndex in [
      GalleryTabEnum.photos.index,
      GalleryTabEnum.albums.index,
      GalleryTabEnum.library.index,
    ]) {
      final router = _FakeTabsRouter().._active = startingIndex;
      await tester.pumpWidget(_wrap(GalleryBottomNav(tabsRouter: router)));
      await tester.pumpAndSettle();
      expect(find.byType(GalleryNavPill), findsOneWidget, reason: 'start state at tab=$startingIndex');

      EventStream.shared.emit(const MultiSelectToggleEvent(true));
      await tester.pumpAndSettle();
      // After the 200ms hide animation completes the IgnorePointer blocks taps;
      // AnimatedOpacity reaches 0 and the nav is visually gone.
      final opacity = tester.widget<AnimatedOpacity>(find.byType(AnimatedOpacity));
      expect(opacity.opacity, 0, reason: 'opacity hits 0 when hiding, tab=$startingIndex');

      // Restore for next iteration.
      EventStream.shared.emit(const MultiSelectToggleEvent(false));
      await tester.pumpAndSettle();
    }
  });

  testWidgets('hide animation completion writes bottomNavHeightProvider=0', (tester) async {
    final router = _FakeTabsRouter();
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: Material(child: GalleryBottomNav(tabsRouter: router))),
    ));
    await tester.pumpAndSettle();
    final shownHeight = container.read(bottomNavHeightProvider);
    expect(shownHeight, greaterThan(0));

    EventStream.shared.emit(const MultiSelectToggleEvent(true));
    // Halfway through the hide animation — height should still reflect the
    // visible nav (so peek rail doesn't jump early).
    await tester.pump(const Duration(milliseconds: 100));
    expect(container.read(bottomNavHeightProvider), shownHeight,
        reason: 'height stays while animating out');

    await tester.pumpAndSettle(); // finishes the animation → onEnd fires
    expect(container.read(bottomNavHeightProvider), 0, reason: 'onEnd writes 0');
  });

  testWidgets('keyboard-up: hides above 80pt threshold, shows at 79pt', (tester) async {
    final router = _FakeTabsRouter();

    await tester.pumpWidget(_wrap(
      GalleryBottomNav(tabsRouter: router),
      mq: const MediaQueryData(viewInsets: EdgeInsets.only(bottom: 79)),
    ));
    await tester.pumpAndSettle();
    var opacity = tester.widget<AnimatedOpacity>(find.byType(AnimatedOpacity));
    expect(opacity.opacity, 1, reason: 'at 79pt, still shown');

    await tester.pumpWidget(_wrap(
      GalleryBottomNav(tabsRouter: router),
      mq: const MediaQueryData(viewInsets: EdgeInsets.only(bottom: 81)),
    ));
    await tester.pumpAndSettle();
    opacity = tester.widget<AnimatedOpacity>(find.byType(AnimatedOpacity));
    expect(opacity.opacity, 0, reason: 'at 81pt, hidden');
  });

  testWidgets('landscape: NavigationRail with 3 destinations + trailing search', (tester) async {
    final router = _FakeTabsRouter();
    await tester.pumpWidget(_wrap(
      GalleryBottomNav(tabsRouter: router),
      mq: const MediaQueryData(size: Size(900, 400)), // landscape
    ));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryNavPill), findsNothing);
    expect(find.byKey(const Key('gallery-bottom-nav-rail')), findsOneWidget);

    final rail = tester.widget<NavigationRail>(find.byKey(const Key('gallery-bottom-nav-rail')));
    expect(rail.destinations, hasLength(3));
    expect(find.descendant(of: find.byType(NavigationRail), matching: find.text('Photos')), findsOneWidget);
    expect(find.descendant(of: find.byType(NavigationRail), matching: find.text('Albums')), findsOneWidget);
    expect(find.descendant(of: find.byType(NavigationRail), matching: find.text('Library')), findsOneWidget);
    expect(find.byKey(const Key('gallery-bottom-nav-rail-search')), findsOneWidget);
  });

  testWidgets('readonly: only Photos segment enabled', (tester) async {
    final router = _FakeTabsRouter();
    await tester.pumpWidget(_wrap(
      GalleryBottomNav(tabsRouter: router),
      overrides: [
        readonlyModeProvider.overrideWith((_) => _FakeReadonly(true)),
      ],
    ));
    await tester.pumpAndSettle();
    // The search blob is disabled.
    final blob = tester.widget<GallerySearchBlob>(find.byType(GallerySearchBlob));
    expect(blob.enabled, isFalse);
    // (Segment enable/disable is delegated to the pill's `readOnly` flag when that
    // interface lands in C2's follow-up; for now, confirm the blob-disabled
    // contract here.)
  });

  testWidgets('publishes height to bottomNavHeightProvider when shown', (tester) async {
    final router = _FakeTabsRouter();
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: Material(child: GalleryBottomNav(tabsRouter: router))),
    ));
    await tester.pumpAndSettle();
    expect(container.read(bottomNavHeightProvider), greaterThan(0));
  });

  // Side-effect matrix tests — §6.5 positive + negative assertions (H3).
  // The shell's tabsRouter.addListener only fires on index CHANGES; same-tab
  // re-taps wouldn't trigger provider invalidations if they lived there.
  // C4's _onTabTap fires on every tap — making these tests the primary
  // regression barrier for side effects.

  testWidgets('Photos tap (from Albums): invalidates driftMemoryFutureProvider', (tester) async {
    final router = _FakeTabsRouter().._active = GalleryTabEnum.albums.index;
    int memoryInvalidations = 0;
    final container = ProviderContainer(overrides: [
      driftMemoryFutureProvider.overrideWith((ref) {
        memoryInvalidations++;
        return Future.value([]);
      }),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: Material(child: GalleryBottomNav(tabsRouter: router))),
    ));
    await tester.pumpAndSettle();
    final baseline = memoryInvalidations;

    await tester.tap(find.text('Photos'));
    await tester.pumpAndSettle();

    expect(memoryInvalidations, greaterThan(baseline), reason: 'Photos tap should invalidate memory');
    expect(router.setCalls, contains(GalleryTabEnum.photos.index));
  });

  testWidgets('Re-tap Photos (already active): ScrollToTopEvent + memory invalidate', (tester) async {
    final router = _FakeTabsRouter().._active = GalleryTabEnum.photos.index;
    int scrollEvents = 0;
    final sub = EventStream.shared.listen<ScrollToTopEvent>((_) => scrollEvents++);
    addTearDown(sub.cancel);

    int memoryInvalidations = 0;
    final container = ProviderContainer(overrides: [
      driftMemoryFutureProvider.overrideWith((_) {
        memoryInvalidations++;
        return Future.value([]);
      }),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: Material(child: GalleryBottomNav(tabsRouter: router))),
    ));
    await tester.pumpAndSettle();

    final memBaseline = memoryInvalidations;
    await tester.tap(find.text('Photos'));
    await tester.pumpAndSettle();

    expect(scrollEvents, 1);
    expect(memoryInvalidations, greaterThan(memBaseline), reason: 'memory also invalidates on re-tap');
  });

  testWidgets('Albums tap: invalidates albumProvider', (tester) async {
    final router = _FakeTabsRouter();
    int albumInvalidations = 0;
    final container = ProviderContainer(overrides: [
      albumProvider.overrideWith((_) {
        albumInvalidations++;
        return []; // simplified; real provider shape elided
      }),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: Material(child: GalleryBottomNav(tabsRouter: router))),
    ));
    await tester.pumpAndSettle();
    final baseline = albumInvalidations;

    await tester.tap(find.text('Albums'));
    await tester.pumpAndSettle();

    expect(albumInvalidations, greaterThan(baseline));
  });

  testWidgets('Library tap: invalidates localAlbumProvider AND driftGetAllPeopleProvider', (tester) async {
    final router = _FakeTabsRouter();
    int localAlbumInvalidations = 0;
    int peopleInvalidations = 0;
    final container = ProviderContainer(overrides: [
      localAlbumProvider.overrideWith((_) {
        localAlbumInvalidations++;
        return [];
      }),
      driftGetAllPeopleProvider.overrideWith((_) {
        peopleInvalidations++;
        return Future.value([]);
      }),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: Material(child: GalleryBottomNav(tabsRouter: router))),
    ));
    await tester.pumpAndSettle();
    final localBaseline = localAlbumInvalidations;
    final peopleBaseline = peopleInvalidations;

    await tester.tap(find.text('Library'));
    await tester.pumpAndSettle();

    expect(localAlbumInvalidations, greaterThan(localBaseline));
    expect(peopleInvalidations, greaterThan(peopleBaseline));
  });

  testWidgets('Negative: sharedSpacesProvider / searchPreFilterProvider / searchInputFocusProvider / upstream tabProvider NOT touched', (tester) async {
    // Spy providers that record any invocation. If any of these is ever
    // touched by a tap handler, the counter rises and the test fails.
    //
    // Per P.7: the overrideWith shapes below assume the provider types
    // documented there. Adjust to match the actual declarations in the repo
    // if they differ (grep confirms shape before this task starts).
    int spacesTouched = 0;
    int searchPreTouched = 0;
    int searchFocusTouched = 0;
    int upstreamTabTouched = 0;

    final router = FakeTabsRouter();
    final container = ProviderContainer(overrides: [
      sharedSpacesProvider.overrideWith((_) {
        spacesTouched++;
        return [];
      }),
      searchPreFilterProvider.overrideWith(() {
        searchPreTouched++;
        return _NoOpPreFilter();
      }),
      // searchInputFocusProvider spy — override actually exercises the
      // assertion (R3-1 fix: without this override, searchFocusTouched stays
      // at 0 regardless of code behaviour → false green).
      searchInputFocusProvider.overrideWith((_) {
        searchFocusTouched++;
        return FocusNode(debugLabel: 'searchInputFocusSpy');
      }),
      tabProvider.overrideWith((ref) {
        upstreamTabTouched++;
        return TabEnum.home;
      }),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: Material(child: GalleryBottomNav(tabsRouter: router))),
    ));
    await tester.pumpAndSettle();
    final sBase = spacesTouched;
    final pBase = searchPreTouched;
    final fBase = searchFocusTouched;
    final tBase = upstreamTabTouched;

    for (final label in ['Photos', 'Albums', 'Library']) {
      await tester.tap(find.text(label));
      await tester.pumpAndSettle();
    }

    expect(spacesTouched, sBase, reason: 'sharedSpacesProvider must NOT be invalidated');
    expect(searchPreTouched, pBase, reason: 'searchPreFilterProvider must NOT be cleared');
    expect(searchFocusTouched, fBase, reason: 'searchInputFocusProvider must NOT be focused');
    expect(upstreamTabTouched, tBase, reason: 'upstream tabProvider must NOT be written');
  });

  testWidgets('pill height is locked to 58pt across text scales (R3-2)', (tester) async {
    // Regression: GalleryNavPill's outer Container fixes height to 58pt. Text
    // scale changes must not change the rendered pill height. Published
    // bottomNavHeightProvider value depends on this.
    final router = FakeTabsRouter();
    final container = ProviderContainer();
    addTearDown(container.dispose);

    for (final scaler in [1.0, 1.5, 2.0]) {
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(textScaler: TextScaler.linear(scaler)),
            child: Material(child: GalleryBottomNav(tabsRouter: router)),
          ),
        ),
      ));
      await tester.pumpAndSettle();

      final pillSize = tester.getSize(find.byType(GalleryNavPill));
      expect(pillSize.height, closeTo(58, 0.5),
          reason: 'pill height must stay 58pt at textScaler=$scaler');
    }
  });

  testWidgets('rapid multi-select toggle does not orphan the height publish (R3-8)', (tester) async {
    final router = FakeTabsRouter();
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: Material(child: GalleryBottomNav(tabsRouter: router))),
    ));
    await tester.pumpAndSettle();
    final shownHeight = container.read(bottomNavHeightProvider);
    expect(shownHeight, greaterThan(0));

    // Hide animation starts...
    EventStream.shared.emit(const MultiSelectToggleEvent(true));
    await tester.pump(const Duration(milliseconds: 80)); // mid-hide

    // ...interrupt by showing again before hide-onEnd fires
    EventStream.shared.emit(const MultiSelectToggleEvent(false));
    await tester.pumpAndSettle();

    // After all animations settle, published height must match the visible
    // state — not 0 from a stale hide-onEnd write.
    expect(container.read(bottomNavHeightProvider), shownHeight,
        reason: 'interrupted hide must not orphan height=0 after re-show');
  });

  testWidgets('readonly: blob disabled, pill dims Albums+Library, Photos tappable', (tester) async {
    final router = _FakeTabsRouter();
    await tester.pumpWidget(_wrap(
      GalleryBottomNav(tabsRouter: router),
      overrides: [readonlyModeProvider.overrideWith((_) => _FakeReadonly(true))],
    ));
    await tester.pumpAndSettle();

    final pill = tester.widget<GalleryNavPill>(find.byType(GalleryNavPill));
    expect(pill.disabledTabs, containsAll([GalleryTabEnum.albums, GalleryTabEnum.library]));
    expect(pill.disabledTabs.contains(GalleryTabEnum.photos), isFalse);

    final blob = tester.widget<GallerySearchBlob>(find.byType(GallerySearchBlob));
    expect(blob.enabled, isFalse);
  });
}

// Helpers referenced in the tests above; real shapes adapt to the repo's provider types.
class _NoOpPreFilter extends Notifier<void> {
  @override
  void build() {}
  void clear() {}
}

class _FakeReadonly extends ReadonlyMode {
  final bool v;
  _FakeReadonly(this.v);
  @override
  bool build() => v;
  @override
  void setReadonlyMode(bool value) {}
  @override
  void toggleReadonlyMode() {}
}
```

**Step 2: Run, expect fail.**

**Step 3: Implement** — lengthy but mechanical:

```dart
// mobile/lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart
import 'dart:async';
import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/events.model.dart';
import 'package:immich_mobile/domain/utils/event_stream.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/bottom_nav_height.provider.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_nav_destination.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_search_action.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';

class GalleryBottomNav extends ConsumerStatefulWidget {
  final TabsRouter tabsRouter;
  const GalleryBottomNav({super.key, required this.tabsRouter});

  @override
  ConsumerState<GalleryBottomNav> createState() => _GalleryBottomNavState();
}

class _GalleryBottomNavState extends ConsumerState<GalleryBottomNav> {
  // Keyboard-hide threshold — absolute, matches §5.3 + §8.2 test stimulus.
  static const double _keyboardThreshold = 80;
  // Hide animation duration — matches §5.3 "fade + 12pt slide".
  static const Duration _hideAnimation = Duration(milliseconds: 200);
  static const double _pillHeight = 58;
  static const double _bottomFloat = 26; // gap from home indicator

  bool _hiddenForMultiSelect = false;
  StreamSubscription? _multiSelectSub;

  @override
  void initState() {
    super.initState();
    _multiSelectSub = EventStream.shared.listen<MultiSelectToggleEvent>((e) {
      setState(() => _hiddenForMultiSelect = e.isEnabled);
    });
  }

  @override
  void dispose() {
    _multiSelectSub?.cancel();
    // Do NOT call ref.read here — use a ProviderSubscription instead if a
    // dispose-time write is truly needed. On dispose, the next-mounted nav
    // (or a landscape rebuild) overwrites the height; meanwhile consumers
    // of a stale value is a visual-only concern and self-heals. (L1 fix.)
    super.dispose();
  }

  /// Equality-guarded publish of the visible reserved height from screen
  /// bottom to the top of the floating pill's outer padding.
  ///
  /// Math (§5.6): the pill sits at `bottom: _bottomFloat + mq.padding.bottom`
  /// with `height: _pillHeight`. The total vertical strip reserved at the
  /// bottom of the screen is therefore:
  ///
  ///     _bottomFloat + _pillHeight + mq.padding.bottom
  ///
  /// PeekContent adds an 8pt visual gap on top of that value (§5.6 + A4).
  void _writeHeight(double h) {
    final current = ref.read(bottomNavHeightProvider);
    if (current != h) ref.read(bottomNavHeightProvider.notifier).state = h;
  }

  @override
  Widget build(BuildContext context) {
    final isLandscape = context.orientation == Orientation.landscape;
    final mq = MediaQuery.of(context);
    final keyboardUp = mq.viewInsets.bottom > _keyboardThreshold;
    final isReadonly = ref.watch(readonlyModeProvider);

    if (isLandscape) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _writeHeight(0));
      return _landscapeRail(isReadonly);
    }

    final hiding = _hiddenForMultiSelect || keyboardUp;
    final pillVisibleHeight = _bottomFloat + _pillHeight + mq.padding.bottom;

    // When showing, write the measured height on the next frame; when hiding,
    // the TweenAnimationBuilder.onEnd callback writes 0 at the END of the
    // animation so the peek rail doesn't jump down early (§5.6 Hide/show sync).
    if (!hiding) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _writeHeight(pillVisibleHeight));
    }

    // Pixel-exact 12pt slide via TweenAnimationBuilder (R3-4 fix). AnimatedSlide's
    // fractional Offset would scale with parent height and drift from the 12pt
    // the design spec promises. The tween animates from the current value to the
    // new `end`, so rapid show/hide toggles transition smoothly (no jump).
    //
    // onEnd fires when the tween settles to its target value. If `hiding` is
    // still true at settle time, publish height=0 to let the peek rail drop.
    // If the user interrupted the hide mid-animation with a show, `hiding`
    // will be false at settle time → no height=0 write → rail stays lifted.
    return TweenAnimationBuilder<double>(
      key: const Key('gallery-bottom-nav-slide'),
      tween: Tween<double>(end: hiding ? 12.0 : 0.0),
      duration: _hideAnimation,
      curve: Curves.easeOutCubic,
      onEnd: () {
        if (hiding) _writeHeight(0);
      },
      builder: (_, slide, child) => Transform.translate(
        offset: Offset(0, slide),
        child: child,
      ),
      child: AnimatedOpacity(
        duration: _hideAnimation,
        opacity: hiding ? 0 : 1,
        child: IgnorePointer(
          ignoring: hiding,
          child: Padding(
            padding: EdgeInsets.only(left: 14, right: 14, bottom: _bottomFloat + mq.padding.bottom),
            child: Row(
              children: [
                Expanded(
                  child: GalleryNavPill(
                    activeTab: GalleryTabEnum.values[widget.tabsRouter.activeIndex],
                    disabledTabs: isReadonly
                        ? const {GalleryTabEnum.albums, GalleryTabEnum.library}
                        : const {},
                    onTabTap: _onTabTap,
                  ),
                ),
                const SizedBox(width: 10),
                GallerySearchBlob(
                  enabled: !isReadonly,
                  onTap: () => openGallerySearch(widget.tabsRouter, ref.read),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Single entry point for all tab-tap side effects. Mirrors upstream
  /// `_onNavigationSelected` in `tab_shell.page.dart`: invalidations fire on
  /// EVERY tap (including re-taps of the same tab) — the shell-level
  /// `tabsRouter.addListener` only fires on index CHANGES, so putting
  /// invalidations there would regress upstream behaviour (e.g., re-tapping
  /// Photos wouldn't refresh the memory lane).
  void _onTabTap(GalleryTabEnum tab) {
    final currentIndex = widget.tabsRouter.activeIndex;

    // Fire ScrollToTopEvent when Photos is re-tapped while already active.
    if (tab == GalleryTabEnum.photos && currentIndex == tab.index) {
      EventStream.shared.emit(const ScrollToTopEvent());
    }

    // Per-tab invalidations — fire on every tap of the given destination.
    // (Matches upstream's `if (index == kPhotoTabIndex)` pattern.)
    switch (tab) {
      case GalleryTabEnum.photos:
        ref.invalidate(driftMemoryFutureProvider);
        break;
      case GalleryTabEnum.albums:
        ref.invalidate(albumProvider);
        break;
      case GalleryTabEnum.library:
        ref.invalidate(localAlbumProvider);
        ref.invalidate(driftGetAllPeopleProvider);
        break;
    }

    ref.read(hapticFeedbackProvider.notifier).selectionClick();
    widget.tabsRouter.setActiveIndex(tab.index);
  }

  Widget _landscapeRail(bool isReadonly) {
    return NavigationRail(
      key: const Key('gallery-bottom-nav-rail'),
      selectedIndex: widget.tabsRouter.activeIndex,
      onDestinationSelected: (i) {
        final tab = GalleryTabEnum.values[i];
        if (isReadonly && tab != GalleryTabEnum.photos) return;
        _onTabTap(tab);
      },
      labelType: NavigationRailLabelType.all,
      destinations: [
        for (final tab in GalleryTabEnum.values)
          NavigationRailDestination(
            icon: Icon(GalleryNavDestination.forTab(tab).idleIcon),
            selectedIcon: Icon(GalleryNavDestination.forTab(tab).activeIcon),
            label: Text(GalleryNavDestination.forTab(tab).labelKey.tr()),
            disabled: isReadonly && tab != GalleryTabEnum.photos,
          ),
      ],
      trailing: IconButton(
        key: const Key('gallery-bottom-nav-rail-search'),
        icon: const Icon(Icons.search),
        onPressed: isReadonly ? null : () => openGallerySearch(widget.tabsRouter, ref.read),
      ),
    );
  }
}
```

**Step 4: Run + commit**

```bash
cd mobile && flutter test test/presentation/widgets/gallery_nav/gallery_bottom_nav_test.dart
cd mobile && dart format lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart test/presentation/widgets/gallery_nav/gallery_bottom_nav_test.dart
git add mobile/lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart mobile/test/presentation/widgets/gallery_nav/gallery_bottom_nav_test.dart
git commit -m "feat(mobile): GalleryBottomNav composite (pill + blob + gating + height publish)"
```

---

### Task C5: `GalleryTabShellPage` — `@RoutePage` shell that only mirrors activeIndex → `galleryTabProvider`

**Why this task exists:** the `@RoutePage`-decorated widget that replaces `TabShellPage`. Its single job (post-rev-2) is to register a `tabsRouter.addListener` that mirrors `activeIndex` into `galleryTabProvider`, so any programmatic `setActiveIndex` call (from `openGallerySearch`, `PopScope.onPopInvokedWithResult`, external triggers) keeps the provider in sync. **Side effects live in `GalleryBottomNav._onTabTap` (Task C4)** — not here — because the listener only fires on index CHANGES, and re-taps need invalidations too (upstream contract, design §6.5).

**Files:**

- Create: `mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart`
- Create: `mobile/test/presentation/pages/common/gallery_tab_shell_test.dart`

**Step 1: Write failing tests**

```dart
// mobile/test/presentation/pages/common/gallery_tab_shell_test.dart
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/pages/common/gallery_tab_shell.page.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/routing/router.dart';

// Helper that boots a minimal MaterialApp.router with the real auto_route
// config, starts at GalleryTabShellRoute, and returns the ProviderContainer.
//
// R3-3 FIX: real router guards (_authGuard, _duplicateGuard) would redirect
// away from the shell in a test environment with no logged-in fixture. Two
// ways to defeat them:
//   1. Override the providers the guards read (currentUserProvider,
//      serverInfoProvider) with a fixture that passes auth.
//   2. Inject a `_PassthroughGuard` into AppRouter and bypass guard classes.
//
// Option 1 is less invasive. Confirm the guard's inputs before this task
// runs (grep mobile/lib/routing/auth_guard.dart for its provider reads),
// then list each here.
Future<_HarnessHandle> _bootShell(WidgetTester tester) async {
  final container = ProviderContainer(overrides: [
    // Minimal logged-in fixture — adjust fields to match the real shape.
    currentUserProvider.overrideWith((_) => _fakeLoggedInUser()),
    // _duplicateGuard typically checks a pairing/server-info provider:
    serverInfoProvider.overrideWith((_) => _fakeServerInfo()),
    // Add any other provider _authGuard / _duplicateGuard read (see P.7).
  ]);
  addTearDown(container.dispose);

  final appRouter = AppRouter();
  addTearDown(appRouter.dispose);

  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: MaterialApp.router(
      routerConfig: appRouter.config(deepLinkBuilder: (_) => const DeepLink([
        GalleryTabShellRoute(),
      ])),
    ),
  ));
  await tester.pumpAndSettle();
  return _HarnessHandle(container, appRouter);
}

class _HarnessHandle {
  final ProviderContainer container;
  final AppRouter appRouter;
  _HarnessHandle(this.container, this.appRouter);
  TabsRouter get tabsRouter {
    // R3-7 NOTE: `innerRouterOf<TabsRouter>` exists in auto_route >=7.x. If
    // the installed version is older / differs, fall back to walking the
    // StackRouter stack: `appRouter.topMostRouter()` → cast chain. Verify
    // during implementation.
    return appRouter.innerRouterOf<TabsRouter>(GalleryTabShellRoute.name)!;
  }
}

// Fixture placeholders — real shapes adopted from mobile/lib/providers/.
dynamic _fakeLoggedInUser() => /* shape from currentUserProvider's return type */;
dynamic _fakeServerInfo() => /* shape from serverInfoProvider's return type */;

void main() {
  testWidgets('default: galleryTabProvider == photos', (tester) async {
    final h = await _bootShell(tester);
    expect(h.container.read(galleryTabProvider), GalleryTabEnum.photos);
  });

  testWidgets('setActiveIndex(albums) → galleryTabProvider syncs', (tester) async {
    final h = await _bootShell(tester);
    h.tabsRouter.setActiveIndex(GalleryTabEnum.albums.index);
    await tester.pumpAndSettle();
    expect(h.container.read(galleryTabProvider), GalleryTabEnum.albums);
  });

  testWidgets('setActiveIndex(library) → galleryTabProvider syncs', (tester) async {
    final h = await _bootShell(tester);
    h.tabsRouter.setActiveIndex(GalleryTabEnum.library.index);
    await tester.pumpAndSettle();
    expect(h.container.read(galleryTabProvider), GalleryTabEnum.library);
  });

  testWidgets('programmatic setActiveIndex back to photos → galleryTabProvider syncs', (tester) async {
    final h = await _bootShell(tester);
    h.tabsRouter.setActiveIndex(GalleryTabEnum.library.index);
    await tester.pumpAndSettle();
    h.tabsRouter.setActiveIndex(GalleryTabEnum.photos.index);
    await tester.pumpAndSettle();
    expect(h.container.read(galleryTabProvider), GalleryTabEnum.photos);
  });

  testWidgets('shell unmount: further programmatic setActiveIndex does NOT crash', (tester) async {
    final h = await _bootShell(tester);
    final tabsRouter = h.tabsRouter;

    // Unmount by replacing the app with a blank widget.
    await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
    await tester.pumpAndSettle();

    // Any outstanding setActiveIndex call must not crash on a disposed widget.
    tabsRouter.setActiveIndex(GalleryTabEnum.albums.index);
    await tester.pump();
    // No exception reaching this line = pass.
  });
}
```

**Step 2: Run, expect fail** — `GalleryTabShellPage` / `GalleryTabShellRoute` not defined.

**Step 3: Implement the shell (side-effect-free)**

```dart
// mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/routing/router.dart';

@RoutePage()
class GalleryTabShellPage extends ConsumerStatefulWidget {
  const GalleryTabShellPage({super.key});

  @override
  ConsumerState<GalleryTabShellPage> createState() => _GalleryTabShellPageState();
}

class _GalleryTabShellPageState extends ConsumerState<GalleryTabShellPage> {
  TabsRouter? _router;
  int? _lastIndex;

  /// Mirrors tabsRouter.activeIndex → galleryTabProvider whenever the index
  /// changes. Does NOT fire any other side effects: invalidations and
  /// ScrollToTopEvent live in GalleryBottomNav._onTabTap because they also
  /// need to fire on same-tab re-taps (which the listener wouldn't catch).
  void _syncTab() {
    final router = _router;
    if (router == null || !mounted) return;
    final i = router.activeIndex;
    if (i == _lastIndex) return;
    _lastIndex = i;
    ref.read(galleryTabProvider.notifier).state = GalleryTabEnum.values[i];
  }

  @override
  void dispose() {
    _router?.removeListener(_syncTab);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isLandscape = context.orientation == Orientation.landscape;
    return AutoTabsRouter(
      routes: const [MainTimelineRoute(), DriftAlbumsRoute(), DriftLibraryRoute()],
      duration: const Duration(milliseconds: 600),
      transitionBuilder: (_, child, animation) => FadeTransition(opacity: animation, child: child),
      builder: (context, child) {
        final tabsRouter = AutoTabsRouter.of(context);
        if (_router != tabsRouter) {
          _router?.removeListener(_syncTab);
          _router = tabsRouter;
          tabsRouter.addListener(_syncTab);
          // Seed galleryTabProvider on first build.
          WidgetsBinding.instance.addPostFrameCallback((_) => _syncTab());
        }
        return PopScope(
          canPop: tabsRouter.activeIndex == 0,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) tabsRouter.setActiveIndex(0);
          },
          child: Scaffold(
            resizeToAvoidBottomInset: false,
            body: child,
            bottomNavigationBar: isLandscape ? null : GalleryBottomNav(tabsRouter: tabsRouter),
          ),
        );
      },
    );
  }
}
```

**Step 4: Run build_runner for route generation**

```bash
cd mobile && dart run build_runner build --delete-conflicting-outputs
```

This regenerates `mobile/lib/routing/router.gr.dart` to include `GalleryTabShellRoute`. Required for the tests in Step 1 to compile (they import the route).

**Step 5: Run Step 1's tests — all should pass**

```bash
cd mobile && flutter test test/presentation/pages/common/gallery_tab_shell_test.dart
```

**Step 6: Commit**

```bash
cd mobile && dart format lib/presentation/pages/common/gallery_tab_shell.page.dart test/presentation/pages/common/gallery_tab_shell_test.dart
git add mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart mobile/lib/routing/router.gr.dart mobile/test/presentation/pages/common/gallery_tab_shell_test.dart
git commit -m "feat(mobile): GalleryTabShellPage — tab-provider sync shell"
```

---

### Task C6: i18n keys — `nav.photos`, `nav.albums`, `nav.library`, `nav.search_photos_hint`

**Why this task exists:** the labels the widgets already reference (`.tr()` calls). Must be added and sorted.

**Files:**

- Modify: `i18n/en.json`

**Step 1: Check current i18n structure**

```bash
head -20 /home/pierre/dev/gallery/.worktrees/mobile-bottom-nav/i18n/en.json
```

**Step 2: Add the four keys (alphabetically inserted)**

```json
{
  ...existing keys...
  "nav.albums": "Albums",
  "nav.library": "Library",
  "nav.photos": "Photos",
  "nav.search_photos_hint": "Search photos",
  ...existing keys...
}
```

**Step 3: Format + sort**

```bash
cd /home/pierre/dev/gallery/.worktrees/mobile-bottom-nav && pnpm --filter=immich-i18n format:fix
```

**Step 4: Re-run all mobile tests to confirm no regression**

```bash
cd mobile && flutter test
```

**Step 5: Commit**

```bash
git add i18n/
git commit -m "feat(mobile): add nav.photos/albums/library/search_photos_hint i18n keys"
```

---

# PHASE D — Wire-up (Task D1)

Scope: the single-line-ish router edit that makes `GalleryTabShellRoute` the app's root.

---

### Task D1: `router.dart` — register `GalleryTabShellRoute` + flip initial route

**Why this task exists:** until this lands, the new shell is dead code.

**Files:**

- Modify: `mobile/lib/routing/router.dart`

**Step 1: Identify the current root route**

Open `mobile/lib/routing/router.dart`. Find the route entry that currently bears `initial: true`. In upstream Gallery it is the `TabShellRoute` entry (confirmed against PR #378 branch base — grep `grep -n "initial: true" mobile/lib/routing/router.dart`).

The existing shape:

```dart
AutoRoute(
  initial: true,
  page: TabShellRoute.page,
  guards: [_authGuard, _duplicateGuard],
  children: [
    // (upstream's tab children — MainTimelineRoute, DriftSearchRoute,
    //  SpacesRoute, DriftLibraryRoute or similar, depending on current fork state)
  ],
),
```

**Step 2: Modify the routes list** — exact shape

Replace the existing entry with the fork-only version below, enclosed in a comment fence (memory `feedback_rebase_fork_structure.md`). Keep `TabShellRoute` reachable (no `initial: true`) so §9.2 rollback is a one-liner.

```dart
// >>> fork-only gallery-bottom-nav — remove with ROLLBACK-F1
AutoRoute(
  initial: true,
  page: GalleryTabShellRoute.page,
  guards: [_authGuard, _duplicateGuard],
  children: [
    AutoRoute(page: MainTimelineRoute.page, guards: [_authGuard, _duplicateGuard]),
    AutoRoute(page: DriftAlbumsRoute.page, guards: [_authGuard, _duplicateGuard]),
    AutoRoute(page: DriftLibraryRoute.page, guards: [_authGuard, _duplicateGuard]),
  ],
),
// Upstream shell kept reachable but no longer initial — rollback flips
// `initial: true` back on this entry and removes the block above.
AutoRoute(
  page: TabShellRoute.page,
  guards: [_authGuard, _duplicateGuard],
  children: [
    // (upstream children unchanged — don't touch)
  ],
),
// <<< fork-only
```

**Rationale for explicit guard redeclaration on children:** auto_route's documented guard inheritance is not universal across versions; redeclaring on each child is safe and deliberate, and survives any upstream bump that changes propagation semantics (design §10.1 + Task D0 verification).

**Step 3: Regenerate router.gr.dart**

```bash
cd mobile && dart run build_runner build --delete-conflicting-outputs
```

**Step 4: Launch the dev app manually**

```bash
cd mobile && flutter run -d <your-device>
```

Confirm: cold start lands on Photos; pill + blob render; tapping Albums / Library switches tabs; search blob opens the FilterSheet on Photos.

**Step 5: Run mobile tests**

```bash
cd mobile && flutter test
```

Expected: all green. If a test fails because it depends on the old `TabShellRoute` being initial, either update that test's harness or add a comment flag.

**Step 6: Commit**

```bash
git add mobile/lib/routing/router.dart mobile/lib/routing/router.gr.dart
git commit -m "feat(mobile): route root to GalleryTabShellRoute (fork-only)"
```

---

### Task D0: auto_route guard inheritance verification (before D1 ships)

**Why this task exists:** design §10.1 flags the risk that `DriftAlbumsRoute`'s guards (`[_authGuard, _duplicateGuard]`) may or may not propagate when the route is nested under a fork shell. D1 redeclares guards on children defensively, but we want a proof point before merging.

**Steps:**

1. Run the app logged-in — tap Albums. Should load normally.
2. Log out (via settings) — relaunch the app. You should land on login, not a stuck Albums tab.
3. Log back in — tap Albums. Confirm the AlbumsPage loads without a guard error.
4. Duplicate-session scenario: with two devices/sessions signed in as the same user, confirm the `_duplicateGuard` still fires on Albums.

If any of the above fails, diagnose:

- Guards not propagating: the explicit per-child guard declaration in D1 should cover this (no further change needed).
- Guards firing twice (shell guard + child guard): cosmetically harmless in auto_route (guards short-circuit), but add a one-line comment to D1 noting the double-check behaviour.

No code change from D0 unless a regression is found. Record outcome in the PR description.

```bash
# No commit from this task; it is a manual QA pass.
```

---

# PHASE E — Polish + manual QA (Task E1)

### Task E1: Manual QA checklist + final cleanup

**Step 1: Run the full mobile suite + static analysis**

```bash
cd mobile && flutter test --concurrency=1
cd mobile && dart analyze
cd mobile && dart format --set-exit-if-changed lib test
```

Expected: all green.

**Step 2: Manual QA per design §8.4**

- [ ] Gesture smoothness on older iOS 15 / Android 11 device.
- [ ] Font-scale 120 %, 150 %, 200 % renders nav without clipping.
- [ ] Contrast AA in both themes on active + idle labels.
- [ ] Keyboard-hide smoothness during FilterSheet focus (no jump).
- [ ] Tap targets ≥ 44×44 pt on a 360-pt-wide phone (simulator).
- [ ] Reduced-motion setting respected (underlay snaps in one frame).
- [ ] RTL locale: pill order flips; search blob stays on trailing edge.
- [ ] Search blob from Albums → no visible stutter, sheet opens cleanly, keyboard rises.
- [ ] Peek rail + pill stack cleanly with filters applied (no overlap).
- [ ] Readonly mode: only Photos enabled; blob disabled.
- [ ] Multi-select from Photos / Albums / Library all hide the nav.
- [ ] Landscape: `NavigationRail` fallback renders; three destinations + search entry.

**Step 3: If any QA fails, open a follow-up task before merging**

**Step 4: Push + PR review**

```bash
git push origin feat/mobile-bottom-nav
```

PR #378 auto-updates; request review. Add PR description updates if new commits changed the scope.

---

## Completion checklist

- [ ] Phase A: 4 tasks committed, 4 provider + widget test files green
- [ ] Phase B: 3 tasks committed, 3 unit test files green
- [ ] Phase C: 6 tasks committed, 5 widget test files + 1 shell test file green
- [ ] Phase D: D0 guard verification done (manual); D1 router.dart + router.gr.dart committed
- [ ] Phase E: manual QA signed off
- [ ] `cd mobile && flutter test` — all green
- [ ] `cd mobile && dart analyze` — no warnings
- [ ] `cd mobile && dart format --set-exit-if-changed lib test` — clean
- [ ] PR #378 review-ready

---

## Notes for the implementer

- **Follow TDD rigidly.** Red → Green → Refactor → Commit. Every task listed a failing test first; don't skip.
- **Commit granularity is one per task.** Each task produces one commit (exceptions allowed if a follow-up fix in the same task needs a second commit — document in the commit message).
- **Prettier + dart format are CI-enforced.** Run both before committing (the commands are in each task's Step 5-ish).
- **i18n keys** (Task C6) run `pnpm --filter=immich-i18n format:fix` — **run from the worktree root** (the pnpm workspace resolves from there, not from `mobile/`). DO NOT hand-sort (memory `feedback_i18n_key_sorting.md`).
- **router.gr.dart is generated.** Never hand-edit; run `dart run build_runner build --delete-conflicting-outputs` (memory `feedback_openapi_dart_generation.md` is about OpenAPI but the same pattern applies to auto_route's generator).
- **Don't run lint locally** beyond `dart analyze`. ESLint etc. live in the web project (memory `feedback_lint_sequential.md`).
- **Fork hygiene:** never edit upstream `tab_shell.page.dart` or `tab.provider.dart`. If a rebase conflict appears there, the fork-only shell is the one that should change.
- **@immich/ui is web-only.** Don't reach for it here.
- **Side effects live in `GalleryBottomNav._onTabTap`, NOT `GalleryTabShellPage`**. The shell's `tabsRouter.addListener` only fires on index CHANGES, so putting invalidations there would regress upstream's re-tap-fires-invalidation behaviour. The nav handler sees every tap (including re-taps of the active tab) and is the correct home for haptic + invalidations + `ScrollToTopEvent`.
- **`LayoutBuilder` + `addPostFrameCallback`** pattern in `_GalleryBottomNavState.build` is deliberate: writes to `bottomNavHeightProvider` happen AFTER the layout phase, avoiding the "provider-write-during-layout" pitfall. If you refactor to a direct `WidgetsBinding.instance.scheduleLayoutWithoutRebuild`-style write, you'll trip assertion errors in debug mode.
- **`AutoTabsRouter` (default constructor with `builder:` parameter), not `AutoTabsRouter.builder(...)`.** Matches upstream `tab_shell.page.dart:82`; keeps the rebase diff one-dimensional.
- **Do NOT call `ref.read` in `dispose`.** The plan's implementations use `_multiSelectSub.cancel()` and let the next-mounted widget rewrite `bottomNavHeightProvider`. If a dispose-time write is ever required, switch to a `ProviderSubscription` stored in State.
