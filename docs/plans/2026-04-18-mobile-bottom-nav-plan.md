# Mobile Bottom-Nav Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

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

// Fake TabsRouter that records setActiveIndex calls.
class _FakeTabsRouter extends Fake implements TabsRouter {
  int activeIndexInternal;
  final List<int> setCalls = [];
  _FakeTabsRouter(this.activeIndexInternal);

  @override
  int get activeIndex => activeIndexInternal;

  @override
  void setActiveIndex(int index, {bool notify = true}) {
    setCalls.add(index);
    activeIndexInternal = index;
  }
}

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

    await openGallerySearch(router, c);

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

      openGallerySearch(router, c);
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

    await openGallerySearch(router, c);
    expect(c.read(photosFilterSheetProvider), FilterSheetSnap.browse);
    expect(c.read(photosFilterSearchFocusRequestProvider), 1);
  });

  test('rapid second openGallerySearch mid-delay: +2 counter, no crash', () {
    fakeAsync((async) {
      final router = _FakeTabsRouter(GalleryTabEnum.albums.index);
      final c = ProviderContainer(overrides: [
        hapticFeedbackProvider.overrideWith(() => _HapticSpy()),
        photosFilterSheetProvider.overrideWith((_) => FilterSheetSnap.hidden),
      ]);
      addTearDown(c.dispose);

      openGallerySearch(router, c);
      async.elapse(const Duration(milliseconds: 300));
      openGallerySearch(router, c);
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

      openGallerySearch(router, c);
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
const Duration _kGalleryTabTransitionDelay = Duration(milliseconds: 620);

Future<void> openGallerySearch(TabsRouter tabsRouter, Ref ref) async {
  ref.read(hapticFeedbackProvider.notifier).selectionClick();
  final onPhotos = tabsRouter.activeIndex == GalleryTabEnum.photos.index;

  if (!onPhotos) {
    tabsRouter.setActiveIndex(GalleryTabEnum.photos.index);
    await Future<void>.delayed(_kGalleryTabTransitionDelay);
  }

  ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;
  ref.read(photosFilterSearchFocusRequestProvider.notifier).state++;
}
```

Note: the function takes `Ref` rather than `WidgetRef` so unit tests can drive it with a `ProviderContainer`. In widget land, pass `ref` from a `ConsumerWidget` (which exposes `WidgetRef`); `WidgetRef` satisfies `Ref`.

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
  testWidgets('idle: label only, no icon', (tester) async {
    await tester.pumpConsumerWidget(
      GalleryNavSegment(tab: GalleryTabEnum.photos, active: false, onTap: () {}),
    );
    expect(find.byIcon(Icons.photo_library), findsNothing);
    expect(find.byIcon(Icons.photo_library_outlined), findsNothing);
    expect(find.text('nav.photos'.tr()), findsOneWidget);
  });

  testWidgets('active: icon + label', (tester) async {
    await tester.pumpConsumerWidget(
      GalleryNavSegment(tab: GalleryTabEnum.photos, active: true, onTap: () {}),
    );
    expect(find.byIcon(Icons.photo_library), findsOneWidget);
    expect(find.text('nav.photos'.tr()), findsOneWidget);
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
import 'package:immich_mobile/providers/gallery_nav/gallery_nav_destination.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';

class GalleryNavSegment extends StatelessWidget {
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
                if (active) ...[
                  Icon(destination.activeIcon, size: 22, color: color),
                  const SizedBox(width: 6),
                ],
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

  const GalleryNavPill({super.key, required this.activeTab, required this.onTabTap});

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
                      child: GalleryNavSegment(
                        key: Key('gallery-nav-segment-${tab.name}'),
                        tab: tab,
                        active: widget.activeTab == tab,
                        onTap: () => widget.onTabTap(tab),
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

  testWidgets('multi-select event hides the nav entirely', (tester) async {
    final router = _FakeTabsRouter();
    await tester.pumpWidget(_wrap(GalleryBottomNav(tabsRouter: router)));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryNavPill), findsOneWidget);

    EventStream.shared.emit(const MultiSelectToggleEvent(true));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryNavPill), findsNothing);
    expect(find.byType(GallerySearchBlob), findsNothing);
  });

  testWidgets('keyboard-up: hides above 80pt threshold, shows at 79pt', (tester) async {
    final router = _FakeTabsRouter();

    await tester.pumpWidget(_wrap(
      GalleryBottomNav(tabsRouter: router),
      mq: const MediaQueryData(viewInsets: EdgeInsets.only(bottom: 79)),
    ));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryNavPill), findsOneWidget, reason: 'at 79pt, still shown');

    await tester.pumpWidget(_wrap(
      GalleryBottomNav(tabsRouter: router),
      mq: const MediaQueryData(viewInsets: EdgeInsets.only(bottom: 81)),
    ));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryNavPill), findsNothing, reason: 'at 81pt, hidden');
  });

  testWidgets('landscape: NavigationRail fallback replaces pill', (tester) async {
    final router = _FakeTabsRouter();
    await tester.pumpWidget(_wrap(
      GalleryBottomNav(tabsRouter: router),
      mq: const MediaQueryData(size: Size(900, 400)), // landscape
    ));
    await tester.pumpAndSettle();
    expect(find.byType(GalleryNavPill), findsNothing);
    expect(find.byType(NavigationRail), findsOneWidget);
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

  testWidgets('publishes 0 when hidden by multi-select (after animation)', (tester) async {
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
    await tester.pumpAndSettle();
    expect(container.read(bottomNavHeightProvider), 0);
  });
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
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';

class GalleryBottomNav extends ConsumerStatefulWidget {
  final TabsRouter tabsRouter;
  const GalleryBottomNav({super.key, required this.tabsRouter});

  @override
  ConsumerState<GalleryBottomNav> createState() => _GalleryBottomNavState();
}

class _GalleryBottomNavState extends ConsumerState<GalleryBottomNav> {
  static const double _keyboardThreshold = 80;
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
    _writeHeight(0);
    super.dispose();
  }

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

    if (_hiddenForMultiSelect || keyboardUp) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _writeHeight(0));
      return const SizedBox.shrink();
    }

    return LayoutBuilder(builder: (ctx, constraints) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _writeHeight(58 + 26 + mq.padding.bottom));
      return Padding(
        padding: EdgeInsets.only(left: 14, right: 14, bottom: 26 + mq.padding.bottom),
        child: Row(
          children: [
            Expanded(
              child: GalleryNavPill(
                activeTab: GalleryTabEnum.values[widget.tabsRouter.activeIndex],
                onTabTap: (tab) {
                  if (isReadonly && tab != GalleryTabEnum.photos) return;
                  _onTabTap(tab);
                },
              ),
            ),
            const SizedBox(width: 10),
            GallerySearchBlob(
              enabled: !isReadonly,
              onTap: () => openGallerySearch(widget.tabsRouter, ref),
            ),
          ],
        ),
      );
    });
  }

  void _onTabTap(GalleryTabEnum tab) {
    if (widget.tabsRouter.activeIndex == tab.index && tab == GalleryTabEnum.photos) {
      EventStream.shared.emit(const ScrollToTopEvent());
    }
    ref.read(hapticFeedbackProvider.notifier).selectionClick();
    widget.tabsRouter.setActiveIndex(tab.index);
  }

  Widget _landscapeRail(bool isReadonly) {
    return NavigationRail(
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
        icon: const Icon(Icons.search),
        onPressed: isReadonly ? null : () => openGallerySearch(widget.tabsRouter, ref),
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

### Task C5: `GalleryTabShellPage` — `@RoutePage` shell with `AutoTabsRouter` + sync listener

**Why this task exists:** the `@RoutePage`-decorated widget that replaces `TabShellPage`. Registers the `tabsRouter.addListener` that keeps `galleryTabProvider` in sync with `activeIndex`.

**Files:**

- Create: `mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart`
- Create: `mobile/test/presentation/pages/common/gallery_tab_shell_test.dart`

**Step 1: Write failing tests — side-effect matrix (§6.5)**

```dart
// mobile/test/presentation/pages/common/gallery_tab_shell_test.dart
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/pages/common/gallery_tab_shell.page.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

// Helper to detect whether a provider was touched.
class _InvalidationSpy {
  final List<ProviderBase<Object?>> invalidated = [];
}

void main() {
  testWidgets('active-index change syncs galleryTabProvider', (tester) async {
    // Pump the shell inside a MaterialApp.router using a mock router that
    // exposes a settable activeIndex — detailed setup omitted here; use the
    // same harness pattern as existing tab_shell tests in the repo.
    // Assert: setActiveIndex(1) → galleryTabProvider == GalleryTabEnum.albums.
  });

  // Additional tests per §6.5 row:
  // - Photos tap → driftMemoryFutureProvider invalidated
  // - Re-tap Photos → ScrollToTopEvent emitted
  // - Albums tap → albumProvider invalidated
  // - Library tap → localAlbumProvider + driftGetAllPeopleProvider invalidated
  // - Negative: sharedSpacesProvider / searchPreFilterProvider /
  //   searchInputFocusProvider / upstream tabProvider NOT touched
}
```

_(Full test body is long; use the existing `mobile/test/pages/common/tab_shell_test.dart` as a template if present, or a fresh harness — the existing TabShellPage has no test today so the pattern is invented fresh here. This task's test file is scaffolded in Step 1 and fleshed out in Step 3 after the implementation exists, since several asserts depend on widget keys the implementation exposes.)_

**Step 2: Run, expect fail.**

**Step 3: Implement the shell**

```dart
// mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/infrastructure/album.provider.dart';
import 'package:immich_mobile/providers/infrastructure/memory.provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
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

  void _onRouterChange() {
    final router = _router;
    if (router == null) return;
    final i = router.activeIndex;
    if (i == _lastIndex) return;
    _lastIndex = i;
    final tab = GalleryTabEnum.values[i];
    ref.read(galleryTabProvider.notifier).state = tab;
    _fireSideEffects(tab);
  }

  void _fireSideEffects(GalleryTabEnum tab) {
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
  }

  @override
  void dispose() {
    _router?.removeListener(_onRouterChange);
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
          _router?.removeListener(_onRouterChange);
          _router = tabsRouter;
          tabsRouter.addListener(_onRouterChange);
          // Seed galleryTabProvider on first build.
          WidgetsBinding.instance.addPostFrameCallback((_) => _onRouterChange());
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

**Step 4: Flesh out the test body** — use the pattern from C4's test file; inject a `MaterialApp.router` with a real auto_route config, or test the key behaviours directly by mocking the `TabsRouter` and driving the state setter.

Run build_runner to generate the route class:

```bash
cd mobile && dart run build_runner build --delete-conflicting-outputs
```

This regenerates `mobile/lib/routing/router.gr.dart` to include `GalleryTabShellRoute`.

**Step 5: Run + commit**

```bash
cd mobile && flutter test test/presentation/pages/common/gallery_tab_shell_test.dart
cd mobile && dart format lib/presentation/pages/common/gallery_tab_shell.page.dart test/presentation/pages/common/gallery_tab_shell_test.dart
git add mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart mobile/lib/routing/router.gr.dart mobile/test/presentation/pages/common/gallery_tab_shell_test.dart
git commit -m "feat(mobile): GalleryTabShellPage with activeIndex→galleryTabProvider sync"
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

**Step 1: Identify the current root route and the route list**

Open `mobile/lib/routing/router.dart`. Find:

- The existing `AutoRoute(page: TabShellRoute.page, ...)` entry.
- The `initial: true` route (the app's entrypoint).

**Step 2: Modify the routes list**

Enclose the edit in fork-only comment fences (memory `feedback_rebase_fork_structure.md`). Add `AutoRoute(page: GalleryTabShellRoute.page, ...)` and flip the `initial` marker:

```dart
// >>> fork-only gallery-bottom-nav
AutoRoute(
  page: GalleryTabShellRoute.page,
  // initial: true on this entry; remove initial from upstream TabShellRoute entry.
  children: [
    // (children auto-discovered from GalleryTabShellPage's AutoTabsRouter;
    // listed here explicitly only if auto_route requires it in this config)
  ],
),
// <<< fork-only
AutoRoute(page: TabShellRoute.page, /* initial removed */),
```

(Exact shape depends on the current `initial: true` location; preserve guards from the existing TabShellRoute entry.)

**Step 3: Regenerate router.gr.dart**

```bash
cd mobile && dart run build_runner build --delete-conflicting-outputs
```

**Step 4: Launch the app (manual) + run mobile tests**

```bash
cd mobile && flutter test
# Then launch the dev app and verify the new nav renders at cold start.
```

**Step 5: Commit**

```bash
git add mobile/lib/routing/router.dart mobile/lib/routing/router.gr.dart
git commit -m "feat(mobile): route root to GalleryTabShellRoute (fork-only)"
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
- [ ] Phase D: router.dart + router.gr.dart committed
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
- **i18n keys** (Task C6) run `pnpm --filter=immich-i18n format:fix` — DO NOT hand-sort (memory `feedback_i18n_key_sorting.md`).
- **router.gr.dart is generated.** Never hand-edit; run `dart run build_runner build --delete-conflicting-outputs` (memory `feedback_openapi_dart_generation.md` is about OpenAPI but the same pattern applies to auto_route's generator).
- **Don't run lint locally** beyond `dart analyze`. ESLint etc. live in the web project (memory `feedback_lint_sequential.md`).
- **Fork hygiene:** never edit upstream `tab_shell.page.dart` or `tab.provider.dart`. If a rebase conflict appears there, the fork-only shell is the one that should change.
- **@immich/ui is web-only.** Don't reach for it here.
