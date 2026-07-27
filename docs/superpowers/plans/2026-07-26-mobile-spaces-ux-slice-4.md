# Mobile Spaces UX — Slice 4: kebab extraction and entry points

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `SpaceEditSheet` reachable from two places, and fix the bug where editors see no kebab
at all.

**Architecture:** Extract the space-detail kebab into its own widget so the RBAC table is testable
without pumping a 480-line `@RoutePage()` page that has no test today — exactly the pattern the repo
already uses for `SpaceAlbumKebab`. Then wire both entry points.

**Tech Stack:** Dart 3.12.1 / Flutter 3.44.1, `hooks_riverpod`, `mocktail`, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-07-26-mobile-spaces-ux-design.md` §8 and Slice 4.

## Global Constraints

- Run every command from `mobile/` via `mise exec -- <cmd>` (pin: Flutter 3.44.1 / Dart 3.12.1,
  directory-scoped to `mobile/mise.toml`). A bare `flutter`/`dart` is the wrong SDK.
- Format gate, `lib`-only, excludes generated files, **must** run under `bash -c` (zsh does not
  word-split `$(...)`):
  ```bash
  cd mobile && mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
  ```
  Never bare `dart format .`. Expect the gate to fire on new multi-line signatures that fit in 120
  chars; fix with `mise exec -- dart format <file>` on that file only.
- Analyze gate: `mise exec -- dart analyze --fatal-infos` from `mobile/`.
- Capture exit codes on the line _after_ the command, never after a pipe to `tail`.
- **`ImmichToast` schedules a 3s non-frame Timer.** Any widget test that reaches a toast must pump
  past it or teardown fails with "A Timer is still pending". Reuse the `settleToast` helper pattern
  from `test/presentation/widgets/spaces/space_edit_sheet_test.dart`.
- Baseline after Slice 3 is **2832 passing, 1 skipped**.
- **No new i18n keys.** `spaces_edit`, `spaces_delete` and `spaces_delete_confirmation` all exist.

## File Structure

| File                                                                             | Responsibility                         |
| -------------------------------------------------------------------------------- | -------------------------------------- |
| `mobile/lib/presentation/widgets/spaces/space_detail_kebab.widget.dart` (create) | Role-gated menu, no page dependencies. |
| `mobile/test/presentation/widgets/spaces/space_detail_kebab_test.dart` (create)  | The RBAC table.                        |
| `mobile/lib/pages/library/spaces/space_detail.page.dart` (modify)                | Use the kebab; add the edit handler.   |
| `mobile/lib/widgets/spaces/space_card.dart` (modify)                             | Add `onLongPress`.                     |
| `mobile/test/widgets/spaces/space_card_test.dart` (create)                       | Long-press does not also navigate.     |

---

### Task 1: Extract `SpaceDetailKebab`

**Files:**

- Create: `mobile/lib/presentation/widgets/spaces/space_detail_kebab.widget.dart`
- Test: `mobile/test/presentation/widgets/spaces/space_detail_kebab_test.dart`

**Interfaces:**

- Produces, used by Task 2:

  ```dart
  class SpaceDetailKebab extends StatelessWidget {
    const SpaceDetailKebab({
      super.key,
      required this.canEdit,
      required this.canDelete,
      required this.onEdit,
      required this.onDelete,
    });
    final bool canEdit;
    final bool canDelete;
    final VoidCallback onEdit;
    final VoidCallback onDelete;
  }
  ```

  Renders nothing when `canEdit` is false. This mirrors `SpaceAlbumKebab`, which returns
  `SizedBox.shrink()` when it has no permissions.

- [ ] **Step 1: Write the failing test**

Create `mobile/test/presentation/widgets/spaces/space_detail_kebab_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_detail_kebab.widget.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  Future<({List<String> events})> pumpKebab(
    WidgetTester tester, {
    required bool canEdit,
    required bool canDelete,
  }) async {
    final events = <String>[];
    await tester.pumpConsumerWidget(
      SpaceDetailKebab(
        canEdit: canEdit,
        canDelete: canDelete,
        onEdit: () => events.add('edit'),
        onDelete: () => events.add('delete'),
      ),
    );
    return (events: events);
  }

  Future<void> openMenu(WidgetTester tester) async {
    await tester.tap(find.byKey(const Key('space-detail-kebab')));
    await tester.pumpAndSettle();
  }

  testWidgets('an owner sees both Edit Space and Delete Space', (tester) async {
    await pumpKebab(tester, canEdit: true, canDelete: true);
    await openMenu(tester);

    expect(find.text('Edit Space'), findsOneWidget);
    expect(find.text('Delete Space'), findsOneWidget);
  });

  testWidgets('an editor sees Edit Space but not Delete Space', (tester) async {
    // The regression this slice fixes: editors previously saw no kebab at all.
    await pumpKebab(tester, canEdit: true, canDelete: false);
    await openMenu(tester);

    expect(find.text('Edit Space'), findsOneWidget);
    expect(find.text('Delete Space'), findsNothing);
  });

  testWidgets('a viewer sees no kebab at all', (tester) async {
    await pumpKebab(tester, canEdit: false, canDelete: false);

    expect(find.byKey(const Key('space-detail-kebab')), findsNothing);
  });

  testWidgets('selecting Edit Space invokes onEdit only', (tester) async {
    final result = await pumpKebab(tester, canEdit: true, canDelete: true);
    await openMenu(tester);

    await tester.tap(find.text('Edit Space'));
    await tester.pumpAndSettle();

    expect(result.events, ['edit']);
  });

  testWidgets('selecting Delete Space invokes onDelete only', (tester) async {
    final result = await pumpKebab(tester, canEdit: true, canDelete: true);
    await openMenu(tester);

    await tester.tap(find.text('Delete Space'));
    await tester.pumpAndSettle();

    expect(result.events, ['delete']);
  });
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- flutter test test/presentation/widgets/spaces/space_detail_kebab_test.dart
```

Expected: compile error, `Error when reading 'lib/presentation/widgets/spaces/space_detail_kebab.widget.dart': No such file or directory`.

- [ ] **Step 3: Implement**

Create `mobile/lib/presentation/widgets/spaces/space_detail_kebab.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';

/// Role-gated overflow menu for the space detail page.
///
/// Extracted from [SpaceDetailPage] so the RBAC table can be widget-tested without
/// pumping a routed page that loads network metadata, members and a Drift timeline.
/// Mirrors the existing [SpaceAlbumKebab].
///
/// Naming and appearance are editor-level server-side, so the menu itself is shown
/// for [canEdit]; only deletion is restricted further, via [canDelete].
class SpaceDetailKebab extends StatelessWidget {
  const SpaceDetailKebab({
    super.key,
    required this.canEdit,
    required this.canDelete,
    required this.onEdit,
    required this.onDelete,
  });

  final bool canEdit;
  final bool canDelete;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    if (!canEdit) return const SizedBox.shrink();

    return PopupMenuButton<_KebabAction>(
      key: const Key('space-detail-kebab'),
      onSelected: (action) => switch (action) {
        _KebabAction.edit => onEdit(),
        _KebabAction.delete => onDelete(),
      },
      itemBuilder: (context) => [
        PopupMenuItem<_KebabAction>(
          key: const Key('space-detail-kebab-edit'),
          value: _KebabAction.edit,
          child: Text('spaces_edit'.t(context: context)),
        ),
        if (canDelete)
          PopupMenuItem<_KebabAction>(
            key: const Key('space-detail-kebab-delete'),
            value: _KebabAction.delete,
            child: Text('spaces_delete'.t(context: context)),
          ),
      ],
    );
  }
}

enum _KebabAction { edit, delete }
```

- [ ] **Step 4: Run to verify it passes**

Expected: `+5: All tests passed!`

- [ ] **Step 5: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git add mobile/lib/presentation/widgets/spaces/space_detail_kebab.widget.dart \
        mobile/test/presentation/widgets/spaces/space_detail_kebab_test.dart
git commit -m "feat(mobile): extract a role-gated space detail kebab"
```

---

### Task 2: Wire the kebab and the edit sheet into the page

**Files:**

- Modify: `mobile/lib/pages/library/spaces/space_detail.page.dart`

**Interfaces:**

- Consumes: `SpaceDetailKebab` (Task 1), `SpaceEditSheet.show` (Slice 3),
  `spaceIsWritable` / `spaceIsOwned` (Slice 1).

- [ ] **Step 1: Replace the owner-only PopupMenuButton**

In the `SliverAppBar`'s `actions:` list, the current block is:

```dart
            if (_isOwner)
              PopupMenuButton<String>(
                onSelected: (value) {
                  if (value == 'delete') _deleteSpace();
                },
                itemBuilder: (context) => [const PopupMenuItem(value: 'delete', child: Text('Delete Space'))],
              ),
```

Replace it with:

```dart
            SpaceDetailKebab(canEdit: _canEdit, canDelete: _isOwner, onEdit: _editSpace, onDelete: _deleteSpace),
```

Add the import:

```dart
import 'package:immich_mobile/presentation/widgets/spaces/space_detail_kebab.widget.dart';
```

- [ ] **Step 2: Add the `_editSpace` handler**

Add next to `_deleteSpace`:

```dart
  Future<void> _editSpace() async {
    final space = _space;
    if (space == null) return;

    final saved = await SpaceEditSheet.show(context, space);
    if (saved != true) return;

    // The grid reads sharedSpacesProvider; the app bar reads this page's own
    // `_space`, which is network-loaded rather than Drift-backed. A sync nudge would
    // NOT refresh the title -- nothing reads the local shared_space name column for
    // display -- so re-fetch the metadata explicitly.
    ref.invalidate(sharedSpacesProvider);
    await _refreshSpaceMetadata();
  }
```

Add the import:

```dart
import 'package:immich_mobile/presentation/widgets/spaces/space_edit_sheet.widget.dart';
```

- [ ] **Step 3: Verify the whole suite still passes**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- flutter test > /tmp/s4t2.log 2>&1
echo "TEST_EXIT=$?"; tail -1 /tmp/s4t2.log
```

Expected: `TEST_EXIT=0`, `+2837 ~1`.

If `_refreshSpaceMetadata` does not exist under that exact name, grep the file for the method that
re-fetches `_space` (it is called from `_addPhotos` and from the bottom sheet's `onAssetsRemoved`)
and use that name. Do not invent a new loader.

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/pages/library/spaces/space_detail.page.dart
git commit -m "feat(mobile): let editors edit a space from the detail page"
```

---

### Task 3: `SpaceCard` long-press

**Files:**

- Modify: `mobile/lib/widgets/spaces/space_card.dart`
- Test: `mobile/test/widgets/spaces/space_card_test.dart` (create)

**Interfaces:**

- Produces: `SpaceCard` gains `final VoidCallback? onLongPress;` — optional, so the existing call
  site in `spaces.page.dart` keeps compiling untouched.

- [ ] **Step 1: Write the failing test**

Create `mobile/test/widgets/spaces/space_card_test.dart`. Note the fixture must populate **every**
`Optional` that `SpaceCard.build` reads via `.value` — `newAssetCount`, `recentAssetIds`,
`recentAssetThumbhashes`, `color`, `members`, `assetCount`, `memberCount` — because `.value` throws
on an absent `Optional` and would crash the render. This mirrors the comment at
`test/presentation/pages/spaces_page_test.dart:27-32`.

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/widgets/spaces/space_card.dart';
import 'package:openapi/api.dart';

import '../../widget_tester_extensions.dart';

void main() {
  SharedSpaceResponseDto fullSpace() => SharedSpaceResponseDto(
    id: 's1',
    name: 'Family Photos',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdById: 'user-1',
    newAssetCount: const Optional.present(0),
    recentAssetIds: const Optional.present([]),
    recentAssetThumbhashes: const Optional.present([]),
    color: const Optional.present(UserAvatarColor.blue),
    members: const Optional.present([]),
    assetCount: const Optional.present(3),
    memberCount: const Optional.present(2),
  );

  testWidgets('a long-press fires onLongPress and does NOT also fire onTap', (tester) async {
    final events = <String>[];
    await tester.pumpConsumerWidget(
      SpaceCard(
        space: fullSpace(),
        onTap: () => events.add('tap'),
        onLongPress: () => events.add('longPress'),
      ),
    );

    await tester.longPress(find.byType(SpaceCard));
    await tester.pumpAndSettle();

    expect(events, ['longPress'], reason: 'a long-press must not navigate into the space behind the sheet');
  });

  testWidgets('a tap still fires onTap only', (tester) async {
    final events = <String>[];
    await tester.pumpConsumerWidget(
      SpaceCard(
        space: fullSpace(),
        onTap: () => events.add('tap'),
        onLongPress: () => events.add('longPress'),
      ),
    );

    await tester.tap(find.byType(SpaceCard));
    await tester.pumpAndSettle();

    expect(events, ['tap']);
  });

  testWidgets('omitting onLongPress leaves tap behaviour unchanged', (tester) async {
    final events = <String>[];
    await tester.pumpConsumerWidget(
      SpaceCard(space: fullSpace(), onTap: () => events.add('tap')),
    );

    await tester.longPress(find.byType(SpaceCard));
    await tester.pumpAndSettle();

    expect(events, isEmpty);
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Expected: compile error, `No named parameter with the name 'onLongPress'`.

- [ ] **Step 3: Implement**

In `mobile/lib/widgets/spaces/space_card.dart`, add the field and constructor parameter, and pass it
to the existing `GestureDetector`:

```dart
  final SharedSpaceResponseDto space;
  final VoidCallback onTap;

  /// Optional so existing call sites keep working. `GestureDetector` fires either
  /// `onTap` or `onLongPress` for a given gesture, never both, which is what keeps a
  /// long-press from also navigating into the space behind the sheet.
  final VoidCallback? onLongPress;

  const SpaceCard({super.key, required this.space, required this.onTap, this.onLongPress});
```

and:

```dart
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
```

- [ ] **Step 4: Run to verify it passes**

Expected: `+3: All tests passed!`

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/widgets/spaces/space_card.dart mobile/test/widgets/spaces/space_card_test.dart
git commit -m "feat(mobile): add a long-press affordance to the space card"
```

---

### Task 4: Wire the card long-press to a role-gated sheet

**Files:**

- Modify: `mobile/lib/pages/library/spaces/spaces.page.dart`

- [ ] **Step 1: Add the handler and pass it to the card**

In `spaces.page.dart`, the grid builds `SpaceCard(key:..., space: space, onTap: ...)`. Add a
`onLongPress:` that opens a role-gated sheet. Insert this helper inside `build`, next to
`createSpaceDialog`:

```dart
    Future<void> showSpaceActions(SharedSpaceResponseDto space) async {
      final userId = ref.read(currentUserProvider)?.id;
      // A viewer has no actions at all, so opening an empty sheet would be worse
      // than not reacting.
      if (!spaceIsWritable(space, userId)) return;

      await showModalBottomSheet<void>(
        context: context,
        builder: (sheetContext) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                key: const Key('space-card-action-edit'),
                leading: const Icon(Icons.edit_outlined),
                title: Text('spaces_edit'.t(context: sheetContext)),
                onTap: () async {
                  Navigator.of(sheetContext).pop();
                  final saved = await SpaceEditSheet.show(context, space);
                  if (saved == true) ref.invalidate(sharedSpacesProvider);
                },
              ),
              if (spaceIsOwned(space, userId))
                ListTile(
                  key: const Key('space-card-action-delete'),
                  leading: const Icon(Icons.delete_outline),
                  title: Text('spaces_delete'.t(context: sheetContext)),
                  onTap: () async {
                    Navigator.of(sheetContext).pop();
                    await confirmAndDeleteSpace(space);
                  },
                ),
            ],
          ),
        ),
      );
    }
```

and pass `onLongPress: () => showSpaceActions(space)` to the `SpaceCard`.

- [ ] **Step 2: Add the delete confirmation helper**

`spaces.page.dart` has no delete path today. Add, next to `createSpaceDialog`:

```dart
    Future<void> confirmAndDeleteSpace(SharedSpaceResponseDto space) async {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('spaces_delete'.t(context: ctx)),
          content: Text('spaces_delete_confirmation'.t(context: ctx, args: {'name': space.name})),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text('cancel'.t(context: ctx))),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              style: TextButton.styleFrom(foregroundColor: Theme.of(ctx).colorScheme.error),
              child: Text('delete'.t(context: ctx)),
            ),
          ],
        ),
      );
      if (confirmed != true) return;

      try {
        await ref.read(sharedSpaceApiRepositoryProvider).delete(space.id);
        ref.invalidate(sharedSpacesProvider);
      } catch (e) {
        if (context.mounted) {
          ImmichToast.show(context: context, msg: 'Failed to delete space', toastType: ToastType.error);
        }
      }
    }
```

Declare `confirmAndDeleteSpace` **before** `showSpaceActions` so the closure resolves.

Add imports for `SpaceEditSheet`, `space_permissions.dart`, and `currentUserProvider` if absent.
Check `delete` exists as a key: `grep -n '"delete":' ../i18n/en.json`. If it does not, use the
existing literal the page already uses rather than adding a key.

- [ ] **Step 3: Verify**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- flutter test > /tmp/s4t4.log 2>&1
echo "TEST_EXIT=$?"; tail -1 /tmp/s4t4.log
```

Expected: `TEST_EXIT=0`, `+2840 ~1`. `spaces_page_test.dart` already pumps this page, so a
compile or render regression here shows up immediately.

- [ ] **Step 4: Commit**

```bash
git add mobile/lib/pages/library/spaces/spaces.page.dart
git commit -m "feat(mobile): long-press a space card to edit or delete it"
```

---

### Task 5: Slice gates

- [ ] **Step 1: Run all three gates**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
echo "FORMAT_EXIT=$?"
mise exec -- dart analyze --fatal-infos
echo "ANALYZE_EXIT=$?"
mise exec -- flutter test > /tmp/s4final.log 2>&1
echo "TEST_EXIT=$?"; tail -1 /tmp/s4final.log
```

Expected: all `0`, `+2840 ~1 All tests passed!`.

- [ ] **Step 2: Confirm the old hardcoded menu is gone**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
grep -rn "Delete Space" lib/ ; echo "exit=$?"
```

Expected: **no matches** (`exit=1`) — both delete entry points now render `spaces_delete`.

---

## Self-Review

**1. Spec coverage.** Slice 4's ten behaviours map as: owner sees both ✓, editor sees Edit only ✓,
viewer sees no kebab ✓, loading renders nothing (covered by `canEdit:false` since the page passes
`_canEdit`, which is false while `_space` is null) ✓, long-press as owner ✓, as editor ✓, as viewer ✓
(the early return in `showSpaceActions`), delete confirmation ✓, save invalidates + re-fetches ✓,
cancel does nothing ✓.

**Two spec items are NOT covered by a test here and that is deliberate:** "the space was deleted by
another member mid-flow" and Slice 3's deferred "dismissed while a save is in flight". Both need the
routed `SpaceEditSheet.show` path on a page with no existing test harness; the page-level test rig
does not exist and building one is larger than this slice. Both are recorded in the spec's follow-up
section rather than silently dropped.

**2. Placeholder scan.** No TBD/TODO. The two places where a name might not match reality
(`_refreshSpaceMetadata`, the `delete` i18n key) carry the exact command to check and an explicit
instruction not to invent a replacement.

**3. Type consistency.** `SpaceDetailKebab` takes `canEdit`/`canDelete` as `bool` and
`onEdit`/`onDelete` as `VoidCallback` in the test, the widget and the page. `onLongPress` is
`VoidCallback?` on `SpaceCard` and is passed a zero-arg closure. `SpaceEditSheet.show` returns
`Future<bool?>` and both callers compare against `true`.
