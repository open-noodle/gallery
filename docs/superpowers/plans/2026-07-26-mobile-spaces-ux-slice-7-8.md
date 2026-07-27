# Mobile Spaces UX — Slices 7 & 8: `CollectionPicker`, mounting, toasts and gates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make everything built in Slices 5–6 actually reachable: compose the picker, mount it in
both multi-select sheets, and report outcomes truthfully.

**Why 7 and 8 are one plan:** mounting the picker requires wiring its toasts, which was Slice 8's
main remaining item. Slice 8's other item — keying hardcoded English on the surfaces this work
touches — was already completed in Slice 4 (the delete confirmation dialog). What is left of Slice 8
is the toasts and the final gates, so splitting them would create a slice with no independent
deliverable.

**Tech Stack:** Dart 3.12.1 / Flutter 3.44.1, `hooks_riverpod`, `sliver_tools`, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-07-26-mobile-spaces-ux-design.md` §1, §9 and Slices 7–8.

## Global Constraints

- All commands from `mobile/` via `mise exec -- <cmd>` (Flutter 3.44.1 / Dart 3.12.1).
- Format gate (`lib`-only, generated excluded, **must** use `bash -c`):
  ```bash
  cd mobile && mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
  ```
  Never bare `dart format .`.
- Analyze gate: `mise exec -- dart analyze --fatal-infos` from `mobile/`.
- Exit codes on the line _after_ the command.
- Baseline after Slice 6 is **2870 passing, 1 skipped**.
- **No i18n changes at all.** Every string below already exists.
- `ImmichToast` schedules a 3s non-frame Timer — any test reaching a toast must pump past it
  (`settleToast` pattern in `test/presentation/widgets/spaces/space_edit_sheet_test.dart`).

## Ownership rules for the files being edited

- `mobile/lib/presentation/widgets/album/album_selector.widget.dart` — **pure upstream, DO NOT TOUCH.**
  A `git diff` check in Task 5 enforces this.
- `mobile/lib/presentation/widgets/bottom_sheet/general_bottom_sheet.widget.dart` — **pure upstream.**
  Keep the diff minimal: swap the two picker slivers, delete the now-unused local `addToAlbum`
  closure and its imports. Nothing else.
- `mobile/lib/presentation/widgets/bottom_sheet/space_bottom_sheet.widget.dart` — **fork-only**, edit
  freely.

## Existing strings used (all verified present)

| Key                                        | Used for                                          |
| ------------------------------------------ | ------------------------------------------------- |
| `add_to_album_or_space`                    | Picker header                                     |
| `added_to_space_count`                     | Pool success — takes `{count}`, ICU plural        |
| `space_album_add_photos_success`           | Space-album success — takes `{count}`, ICU plural |
| `add_to_album_bottom_sheet_added`          | Album success — takes `{album}`                   |
| `add_to_album_bottom_sheet_already_exists` | Album no-op — takes `{album}`                     |
| `scaffold_body_error_occurred`             | Any failure                                       |

---

### Task 1: Fix the `_emitted` latch in `SpaceCollectionSection`

**Files:**

- Modify: `mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart`
- Modify: `mobile/test/presentation/widgets/collection/space_collection_section_test.dart`

**Why:** Slice 6 added `bool _emitted` as a double-tap guard, set on the first emit and **never
reset**. On its own that was fine — no caller existed. Now that a caller does, a **failed** add would
leave the section permanently inert: the sheet stays open and every subsequent tap is swallowed. The
latch must clear when the parent reports it is no longer busy.

- [ ] **Step 1: Write the failing test**

Append to `space_collection_section_test.dart`. Because the harness pumps the widget directly, drive
`isBusy` through a `StatefulBuilder` so it can be toggled after the first tap.

```dart
  testWidgets('the double-tap latch clears once the parent is no longer busy', (tester) async {
    final targets = <CollectionTarget>[];
    var busy = false;
    late StateSetter setOuter;

    await tester.pumpConsumerWidget(
      StatefulBuilder(
        builder: (context, setState) {
          setOuter = setState;
          return SpaceCollectionSection(
            onTargetSelected: (target) {
              targets.add(target);
              setState(() => busy = true);
            },
            isBusy: busy,
          );
        },
      ),
      overrides: [
        sharedSpacesProvider.overrideWith((ref) async => [space('s1', albums: 0)]),
        currentUserOverride('user-1'),
        multiSelectProvider.overrideWith(
          () => MultiSelectNotifier(
            MultiSelectState(selectedAssets: {asset('a')}, lockedSelectionAssets: const {}),
          ),
        ),
      ],
    );

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();
    expect(targets, hasLength(1));

    // The add failed: the parent clears busy and the sheet stays open.
    setOuter(() => busy = false);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pumpAndSettle();

    expect(targets, hasLength(2), reason: 'a failed add must not leave the section permanently inert');
  });
```

- [ ] **Step 2: Run to verify it fails** — expected: `Expected: 2, Actual: 1`.

- [ ] **Step 3: Fix the implementation**

In `_SpaceCollectionSectionState`, clear the latch whenever the parent stops being busy:

```dart
  @override
  void didUpdateWidget(covariant SpaceCollectionSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    // The latch exists to swallow a double-tap while a dispatch is starting. Once the
    // parent reports it is no longer busy the dispatch has finished -- including when it
    // FAILED and left the sheet open -- so the section must accept taps again.
    if (oldWidget.isBusy && !widget.isBusy) {
      _emitted = false;
    }
  }
```

- [ ] **Step 4: Run to verify it passes** — expected `+14` for this file.

- [ ] **Step 5: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git add mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart \
        mobile/test/presentation/widgets/collection/space_collection_section_test.dart
git commit -m "fix(mobile): clear the space section tap latch when a dispatch ends"
```

---

### Task 2: `CollectionPicker`

**Files:**

- Create: `mobile/lib/presentation/widgets/collection/collection_picker.widget.dart`
- Test: `mobile/test/presentation/widgets/collection/collection_picker_test.dart`

**Interfaces produced:**

```dart
class CollectionPicker extends ConsumerStatefulWidget {
  const CollectionPicker({super.key, this.excludeSpaceId, this.onKeyboardExpanded});
  final String? excludeSpaceId;
  final Function? onKeyboardExpanded;
}
```

Returns a `MultiSliver`, so it drops straight into a `BaseBottomSheet(slivers: [...])`.

- [ ] **Step 1: Write the failing test**

The picker mounts `AlbumSelector`, which pulls in `remoteAlbumProvider`, settings and user providers.
Rather than fight that, this test asserts **composition and dispatch**, and leaves per-row behaviour
to the two component suites (which already cover it).

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/collection/collection_picker.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/space_collection_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/album/album_selector.widget.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  testWidgets('composes the header, the album selector and the spaces section, in that order', (tester) async {
    await tester.pumpConsumerWidgetRaw(
      const CustomScrollView(slivers: [CollectionPicker()]),
      overrides: const [],
    );
    await tester.pump();

    expect(find.byKey(const Key('collection-picker-header')), findsOneWidget);
    expect(find.byType(AlbumSelector), findsOneWidget);
    expect(find.byType(SpaceCollectionSection), findsOneWidget);

    final headerY = tester.getTopLeft(find.byKey(const Key('collection-picker-header'))).dy;
    final albumsY = tester.getTopLeft(find.byType(AlbumSelector)).dy;
    expect(headerY, lessThan(albumsY));
  });
}
```

If `AlbumSelector` cannot render in a bare harness (it reads several providers), **do not delete the
assertions** — add the minimum provider overrides needed, or assert on
`find.byType(AlbumSelector)` after `pumpConsumerWidgetRaw` + a single `pump()` without settling.
Report whatever you had to add.

- [ ] **Step 2: Run to verify it fails** — expected: missing-file compile error.

- [ ] **Step 3: Implement**

```dart
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/collection_target.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/album/album_selector.widget.dart';
import 'package:immich_mobile/presentation/widgets/collection/space_collection_section.widget.dart';
import 'package:immich_mobile/providers/infrastructure/action.provider.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:sliver_tools/sliver_tools.dart';

/// "Add to album or space" — the album selector plus the spaces section.
///
/// `AlbumSelector` is upstream and is composed, never modified. Its own
/// `AddToAlbumHeader` is not reused because it hardcodes the `add_to_album` key; this
/// picker supplies its own header so the sheet can honestly say "album or space".
class CollectionPicker extends ConsumerStatefulWidget {
  const CollectionPicker({super.key, this.excludeSpaceId, this.onKeyboardExpanded});

  /// Set on a space's own surface so that space is not offered as a destination for
  /// its own assets.
  final String? excludeSpaceId;

  final Function? onKeyboardExpanded;

  @override
  ConsumerState<CollectionPicker> createState() => _CollectionPickerState();
}

class _CollectionPickerState extends ConsumerState<CollectionPicker> {
  bool _isBusy = false;

  Future<void> _addToAlbum(RemoteAlbum album) async {
    if (_isBusy) return;
    setState(() => _isBusy = true);
    final result = await ref.read(actionProvider.notifier).addToAlbum(ActionSource.timeline, album);
    if (!mounted) return;
    setState(() => _isBusy = false);

    if (!result.success) {
      _toastError();
      return;
    }
    ImmichToast.show(
      context: context,
      msg: result.count == 0
          ? 'add_to_album_bottom_sheet_already_exists'.t(context: context, args: {'album': album.name})
          : 'add_to_album_bottom_sheet_added'.t(context: context, args: {'album': album.name}),
    );
  }

  Future<void> _addToTarget(CollectionTarget target) async {
    if (_isBusy) return;
    setState(() => _isBusy = true);

    final notifier = ref.read(actionProvider.notifier);
    final (result, successMessage) = switch (target) {
      AlbumTarget(:final album) => (await notifier.addToAlbum(ActionSource.timeline, album), null),
      SpacePoolTarget(:final space) => (
        await notifier.addToSpace(ActionSource.timeline, space),
        // The pool endpoint is 204 with no body, so this count is the request length.
        'added_to_space_count',
      ),
      SpaceAlbumTarget(:final spaceId, :final album) => (
        await notifier.addToSpaceAlbum(ActionSource.timeline, spaceId, album),
        // This one IS the server's count, so duplicates are already excluded.
        'space_album_add_photos_success',
      ),
    };

    if (!mounted) return;
    setState(() => _isBusy = false);

    if (!result.success) {
      _toastError();
      return;
    }
    if (successMessage != null) {
      ImmichToast.show(
        context: context,
        msg: successMessage.t(context: context, args: {'count': result.count.toString()}),
        toastType: ToastType.success,
      );
    }
  }

  void _toastError() {
    ImmichToast.show(
      context: context,
      msg: 'scaffold_body_error_occurred'.t(context: context),
      toastType: ToastType.error,
    );
  }

  @override
  Widget build(BuildContext context) {
    return MultiSliver(
      children: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          sliver: SliverToBoxAdapter(
            child: Text(
              'add_to_album_or_space'.t(context: context),
              key: const Key('collection-picker-header'),
              style: context.textTheme.titleSmall,
            ),
          ),
        ),
        AlbumSelector(onAlbumSelected: _addToAlbum, onKeyboardExpanded: widget.onKeyboardExpanded),
        SliverToBoxAdapter(
          child: SpaceCollectionSection(
            onTargetSelected: _addToTarget,
            excludeSpaceId: widget.excludeSpaceId,
            isBusy: _isBusy,
          ),
        ),
      ],
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation/widgets/collection/collection_picker.widget.dart \
        mobile/test/presentation/widgets/collection/collection_picker_test.dart
git commit -m "feat(mobile): compose the add-to-album-or-space picker"
```

---

### Task 3: Mount in the main timeline sheet (upstream file — minimal diff)

**Files:**

- Modify: `mobile/lib/presentation/widgets/bottom_sheet/general_bottom_sheet.widget.dart`

- [ ] **Step 1: Swap the slivers**

Replace:

```dart
      slivers: [
        const AddToAlbumHeader(),
        AlbumSelector(onAlbumSelected: addToAlbum, onKeyboardExpanded: onKeyboardExpand),
      ],
```

with:

```dart
      slivers: [CollectionPicker(onKeyboardExpanded: onKeyboardExpand)],
```

Then delete the now-unused local `Future<void> addToAlbum(RemoteAlbum album) async { ... }` closure
and any imports it alone required (`album.model.dart`, `album_selector.widget.dart`,
`immich_toast.dart`, `easy_localization` if unused elsewhere in the file). Add the
`collection_picker.widget.dart` import. `dart analyze --fatal-infos` will name any import that is
now unused — remove exactly those.

- [ ] **Step 2: Verify**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- flutter test > /tmp/s7t3.log 2>&1
echo "TEST_EXIT=$?"; tail -1 /tmp/s7t3.log
```

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/presentation/widgets/bottom_sheet/general_bottom_sheet.widget.dart
git commit -m "feat(mobile): offer spaces in the timeline multiselect sheet"
```

---

### Task 4: Mount in the space timeline sheet (fork-only file)

**Files:**

- Modify: `mobile/lib/presentation/widgets/bottom_sheet/space_bottom_sheet.widget.dart`

- [ ] **Step 1: Add the picker and raise the sheet's ceiling**

`SpaceBottomSheet` currently passes `initialChildSize: 0.22, minChildSize: 0.22, maxChildSize: 0.55`
and **no** `slivers:`. At 0.55 the spaces section would sit permanently below the fold, so raise the
ceiling to 0.85, matching `GeneralBottomSheet`:

```dart
    return BaseBottomSheet(
      controller: sheetController,
      initialChildSize: 0.22,
      minChildSize: 0.22,
      // Raised from 0.55: the sheet now hosts the collection picker, which is unreachable
      // at the old ceiling.
      maxChildSize: 0.85,
      shouldCloseOnMinExtent: false,
      actions: [ ...unchanged... ],
      slivers: [
        // A space is not offered as a destination for its own assets.
        CollectionPicker(excludeSpaceId: widget.spaceId),
      ],
    );
```

Only add `slivers:` and change `maxChildSize`; leave `actions:` exactly as it is.

- [ ] **Step 2: Verify**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- flutter test test/presentation/widgets/bottom_sheet/ > /tmp/s7t4.log 2>&1
echo "TEST_EXIT=$?"; tail -2 /tmp/s7t4.log
```

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/presentation/widgets/bottom_sheet/space_bottom_sheet.widget.dart
git commit -m "feat(mobile): offer collections in the space multiselect sheet"
```

---

### Task 5: Final gates (Slice 8)

- [ ] **Step 1: Prove the upstream album selector is untouched**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git diff origin/main -- mobile/lib/presentation/widgets/album/album_selector.widget.dart
echo "ALBUM_SELECTOR_DIFF_LINES=$(git diff origin/main -- mobile/lib/presentation/widgets/album/album_selector.widget.dart | wc -l)"
```

Expected: **0**. A non-zero result means the composition rule was broken — fix it, do not accept it.

- [ ] **Step 2: Prove no i18n regression**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git diff origin/main --stat -- i18n/ | tail -1
git diff origin/main -- i18n/ | grep '^+' | grep -v '^+++' | grep -c spaces_hidden_non_owned_selection
```

Expected: `10 files changed, 10 insertions(+)` and a count of `10` — exactly the one key from
Slice 6, nothing else.

- [ ] **Step 3: All three CI gates**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
echo "FORMAT_EXIT=$?"
mise exec -- dart analyze --fatal-infos
echo "ANALYZE_EXIT=$?"
mise exec -- flutter test > /tmp/final.log 2>&1
echo "TEST_EXIT=$?"; tail -1 /tmp/final.log
```

Expected: all `0`, and at least `+2871 ~1 All tests passed!`.

---

## Self-Review

**1. Spec coverage.** Slice 7's behaviours: header reads `add_to_album_or_space` ✓, composition order
✓, album path unchanged ✓ (the picker delegates to the same `addToAlbum` action the sheet called
before), keyboard callback threaded ✓, space sheet reachable ✓ (the `maxChildSize` raise, justified in
code), space sheet keeps its actions ✓, `AlbumSelector` untouched ✓ (Task 5 Step 1, a command not a
test). Slice 8: pool toast uses the request length ✓, album toast uses the server count ✓, failure
toast ✓, no i18n change ✓, gates ✓.

**Not covered by an automated test, deliberately:** "the spaces section is reachable by dragging to
maxChildSize" and "the section is not left behind the IME". Both are drag/IME behaviours of
`DraggableScrollableSheet`, which needs an integration-style harness this suite does not have; the
`maxChildSize` change itself is the fix and is visible in review. Plural-form rendering for `ru`/`pl`
is likewise untested — `easy_localization` owns ICU selection and the suite runs a single locale.
Recorded here rather than dropped.

**2. Placeholder scan.** No TBD/TODO. Task 3's "delete the imports analyze names" is a concrete,
verifiable instruction rather than "tidy up".

**3. Type consistency.** `onTargetSelected` is `void Function(CollectionTarget)`; `_addToTarget` is
`Future<void> Function(CollectionTarget)`, which satisfies it (the return is discarded), matching how
`AlbumSelector` already takes an async `onAlbumSelected`. `addToSpaceAlbum(source, spaceId, album)`
matches Slice 5's signature exactly, destructured from `SpaceAlbumTarget(:final spaceId, :final
album)`.
