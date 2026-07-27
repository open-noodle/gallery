# Mobile Spaces UX — Slice 3: `SpaceEditSheet` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A role-agnostic bottom sheet that edits a space's name, description and colour, fully
covered by widget tests, not yet reachable from any screen.

**Architecture:** A `ConsumerStatefulWidget` that takes the space and an `onClose(bool?)` callback,
plus a static `show()` that wraps it in `showModalBottomSheet`. The callback — rather than an
internal `Navigator.pop` — is what makes the sheet testable without routing, and mirrors how web's
modals are structured. It calls Slice 2's `SharedSpaceApiRepository.update`.

**Tech Stack:** Dart 3.12.1 / Flutter 3.44.1, `hooks_riverpod`, `mocktail`, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-07-26-mobile-spaces-ux-design.md` §6 and Slice 3.

## Global Constraints

- Run every command from `mobile/` via `mise exec -- <cmd>`. The pin is **Flutter 3.44.1 / Dart
  3.12.1**, directory-scoped to `mobile/mise.toml`. A bare `flutter`/`dart` or the mise shims give
  3.41.9 / Dart 3.11.5 and die with "requires SDK version >=3.12.0".
- **The format gate is `lib`-only, excludes generated files, and must run under `bash -c`** (zsh does
  not word-split `$(...)`):
  ```bash
  cd mobile && mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
  ```
  Never run bare `dart format .` — it rewrites ~545 unrelated files. If the gate names a file, fix
  just that file with `mise exec -- dart format <file>`.
  **Expect this to fire**: `dart format` reflows any signature that fits in 120 chars onto one line,
  so the multi-line signatures pasted below will very likely be collapsed. That is normal.
- Analyze gate: `mise exec -- dart analyze --fatal-infos` from `mobile/` (covers `test/` too).
- Capture exit codes on the line _after_ the command (`echo "EXIT=$?"`), never after a pipe to
  `tail` — in zsh that reports `tail`'s status.
- Baseline after Slice 2 is **2817 passing, 1 skipped**.
- **No new i18n keys.** Every key used here already exists: `spaces_edit`, `spaces_edit_success`,
  `errors.unable_to_update_space`, `name`, `description`, `color`, `cancel`, `save`.
- Existing tests use `find.text('English literal')`; follow that, do not assert on key names.

## File Structure

| File                                                                           | Responsibility                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------ |
| `mobile/lib/presentation/widgets/spaces/space_edit_sheet.widget.dart` (create) | The form, its validation, and the `show` static. |
| `mobile/test/presentation/widgets/spaces/space_edit_sheet_test.dart` (create)  | 14 behaviour tests.                              |

---

### Task 1: The edit sheet

**Files:**

- Create: `mobile/lib/presentation/widgets/spaces/space_edit_sheet.widget.dart`
- Test: `mobile/test/presentation/widgets/spaces/space_edit_sheet_test.dart`

**Interfaces:**

- Consumes: `SharedSpaceApiRepository.update(id, {name, description, color})` and
  `sharedSpaceApiRepositoryProvider`, both from Slice 2. Recall the calling convention: a `null`
  argument means _absent_, `''` means _clear_.
- Produces, relied on by Slice 4:

  ```dart
  class SpaceEditSheet extends ConsumerStatefulWidget {
    const SpaceEditSheet({super.key, required this.space, required this.onClose});
    final SharedSpaceResponseDto space;
    final void Function(bool? saved) onClose;

    static Future<bool?> show(BuildContext context, SharedSpaceResponseDto space);
  }
  ```

  `onClose(true)` = saved, `onClose(null)` = cancelled. `show` returns the same.

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/presentation/widgets/spaces/space_edit_sheet_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_edit_sheet.widget.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

void main() {
  late MockSharedSpaceApiRepository repo;

  SharedSpaceResponseDto space({
    String name = 'Family Photos',
    Optional<String?> description = const Optional.present('Our shared album'),
    Optional<UserAvatarColor?> color = const Optional.present(UserAvatarColor.blue),
  }) => SharedSpaceResponseDto(
    id: 'space-1',
    name: name,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    createdById: 'user-1',
    description: description,
    color: color,
  );

  SharedSpaceResponseDto saved() => SharedSpaceResponseDto(
    id: 'space-1',
    name: 'Saved',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    createdById: 'user-1',
  );

  /// Pumps the sheet and records every onClose call.
  Future<List<bool?>> pumpSheet(WidgetTester tester, {SharedSpaceResponseDto? withSpace}) async {
    final closes = <bool?>[];
    await tester.pumpConsumerWidget(
      SpaceEditSheet(space: withSpace ?? space(), onClose: closes.add),
      overrides: [sharedSpaceApiRepositoryProvider.overrideWithValue(repo)],
    );
    return closes;
  }

  Finder nameField() => find.byKey(const Key('space-edit-name'));
  Finder descriptionField() => find.byKey(const Key('space-edit-description'));
  Finder saveButton() => find.byKey(const Key('space-edit-save'));

  bool saveEnabled(WidgetTester tester) => tester.widget<FilledButton>(saveButton()).onPressed != null;

  setUpAll(() {
    registerFallbackValue(UserAvatarColor.primary);
  });

  setUp(() {
    repo = MockSharedSpaceApiRepository();
    when(
      () => repo.update(any(), name: any(named: 'name'), description: any(named: 'description'), color: any(named: 'color')),
    ).thenAnswer((_) async => saved());
  });

  testWidgets('prefills name, description and colour from the space', (tester) async {
    await pumpSheet(tester);

    expect(tester.widget<TextField>(nameField()).controller!.text, 'Family Photos');
    expect(tester.widget<TextField>(descriptionField()).controller!.text, 'Our shared album');
    expect(find.byKey(const Key('space-edit-color-blue-selected')), findsOneWidget);
  });

  testWidgets('defaults to the primary swatch when the space has no colour', (tester) async {
    await pumpSheet(tester, withSpace: space(color: const Optional.absent()));

    expect(find.byKey(const Key('space-edit-color-primary-selected')), findsOneWidget);
  });

  testWidgets('disables save for an empty name', (tester) async {
    await pumpSheet(tester);

    await tester.enterText(nameField(), '');
    await tester.pump();

    expect(saveEnabled(tester), isFalse);
  });

  testWidgets('disables save for a whitespace-only name', (tester) async {
    await pumpSheet(tester);

    await tester.enterText(nameField(), '   ');
    await tester.pump();

    expect(saveEnabled(tester), isFalse, reason: 'a required flag alone would let "   " through');
  });

  testWidgets('focuses the name with its text selected on open, and does not reselect on a later tap', (tester) async {
    await pumpSheet(tester);

    final controller = tester.widget<TextField>(nameField()).controller!;
    expect(controller.selection.baseOffset, 0);
    expect(controller.selection.extentOffset, 'Family Photos'.length);

    // Simulate the user placing the caret mid-word, then the field regaining focus.
    controller.selection = const TextSelection.collapsed(offset: 3);
    await tester.tap(nameField());
    await tester.pump();

    expect(controller.selection, const TextSelection.collapsed(offset: 3), reason: 'select-once only');
  });

  testWidgets('caps the name at 100 and the description at 500 characters', (tester) async {
    await pumpSheet(tester);

    await tester.enterText(nameField(), 'x' * 150);
    await tester.enterText(descriptionField(), 'y' * 600);
    await tester.pump();

    expect(tester.widget<TextField>(nameField()).controller!.text.length, 100);
    expect(tester.widget<TextField>(descriptionField()).controller!.text.length, 500);
  });

  testWidgets('renders an over-long existing name in full and keeps save enabled', (tester) async {
    // Truncating a name the user already has would be data loss.
    await pumpSheet(tester, withSpace: space(name: 'z' * 120));

    expect(tester.widget<TextField>(nameField()).controller!.text.length, 120);
    expect(saveEnabled(tester), isTrue);
  });

  testWidgets('sends no description when only the name changed', (tester) async {
    await pumpSheet(tester);

    await tester.enterText(nameField(), 'Renamed');
    await tester.pump();
    await tester.tap(saveButton());
    await tester.pumpAndSettle();

    verify(() => repo.update('space-1', name: 'Renamed', description: null, color: UserAvatarColor.blue)).called(1);
  });

  testWidgets('sends an empty description when the user cleared it', (tester) async {
    await pumpSheet(tester);

    await tester.enterText(descriptionField(), '');
    await tester.pump();
    await tester.tap(saveButton());
    await tester.pumpAndSettle();

    verify(
      () => repo.update('space-1', name: 'Family Photos', description: '', color: UserAvatarColor.blue),
    ).called(1);
  });

  testWidgets('saving with nothing edited sends absent name-only fields and still closes', (tester) async {
    final closes = await pumpSheet(tester);

    await tester.tap(saveButton());
    await tester.pumpAndSettle();

    verify(
      () => repo.update('space-1', name: 'Family Photos', description: null, color: UserAvatarColor.blue),
    ).called(1);
    expect(closes, [true], reason: 'a no-op save is not an error');
  });

  testWidgets('sends the chosen colour', (tester) async {
    await pumpSheet(tester);

    await tester.tap(find.byKey(const Key('space-edit-color-amber')));
    await tester.pump();
    await tester.tap(saveButton());
    await tester.pumpAndSettle();

    verify(
      () => repo.update('space-1', name: 'Family Photos', description: null, color: UserAvatarColor.amber),
    ).called(1);
  });

  testWidgets('a double-tap on save issues exactly one request', (tester) async {
    final completer = Completer<SharedSpaceResponseDto>();
    when(
      () => repo.update(any(), name: any(named: 'name'), description: any(named: 'description'), color: any(named: 'color')),
    ).thenAnswer((_) => completer.future);

    await pumpSheet(tester);

    await tester.tap(saveButton());
    await tester.pump();
    await tester.tap(saveButton(), warnIfMissed: false);
    await tester.pump();

    completer.complete(saved());
    await tester.pumpAndSettle();

    verify(
      () => repo.update(any(), name: any(named: 'name'), description: any(named: 'description'), color: any(named: 'color')),
    ).called(1);
  });

  testWidgets('resolves true on success and null on cancel', (tester) async {
    final closes = await pumpSheet(tester);

    await tester.tap(saveButton());
    await tester.pumpAndSettle();
    expect(closes, [true]);

    final cancels = await pumpSheet(tester);
    await tester.tap(find.byKey(const Key('space-edit-cancel')));
    await tester.pumpAndSettle();
    expect(cancels, [null]);
    verifyNever(() => repo.update('space-2', name: any(named: 'name')));
  });

  testWidgets('stays open and does not resolve when the save fails', (tester) async {
    when(
      () => repo.update(any(), name: any(named: 'name'), description: any(named: 'description'), color: any(named: 'color')),
    ).thenThrow(Exception('403'));

    final closes = await pumpSheet(tester);

    await tester.tap(saveButton());
    await tester.pumpAndSettle();

    expect(closes, isEmpty, reason: 'a revoked role must not look like a successful save');
    expect(nameField(), findsOneWidget);
    expect(saveEnabled(tester), isTrue, reason: 'the in-flight guard must be released so the user can retry');
  });

  testWidgets('every colour swatch is labelled and meets the minimum tap target', (tester) async {
    await pumpSheet(tester);

    for (final color in UserAvatarColor.values) {
      final swatch = find.byKey(Key('space-edit-color-${color.value}'));
      expect(swatch, findsOneWidget, reason: '${color.value} swatch');
      expect(
        find.descendant(of: swatch, matching: find.bySemanticsLabel(color.value)),
        findsOneWidget,
        reason: '${color.value} needs a semantics label -- colour alone is invisible to a screen reader',
      );
      expectTapTargetMin(tester, swatch);
    }
  });
}
```

Add `import 'dart:async';` at the top for `Completer`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- flutter test test/presentation/widgets/spaces/space_edit_sheet_test.dart
```

Expected: **FAIL at compile time** —
`Error: Error when reading 'lib/presentation/widgets/spaces/space_edit_sheet.widget.dart': No such file or directory`.
If it fails for any other reason, stop and report.

- [ ] **Step 3: Write the implementation**

Create `mobile/lib/presentation/widgets/spaces/space_edit_sheet.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/widgets/common/immich_toast.dart';
import 'package:immich_mobile/widgets/spaces/space_collage.dart';
import 'package:openapi/api.dart';

/// Edit a space's name, description and colour.
///
/// Naming and appearance are editor-level server-side, so this sheet is gated by
/// its callers (Slice 4), not by itself.
///
/// Takes an [onClose] callback rather than calling `Navigator.pop` directly: that
/// keeps the sheet independent of routing so it can be widget-tested by pumping it
/// alone, and mirrors the web `SpaceEditModal` shape. [SpaceEditSheet.show] supplies
/// the popping implementation.
class SpaceEditSheet extends ConsumerStatefulWidget {
  const SpaceEditSheet({super.key, required this.space, required this.onClose});

  final SharedSpaceResponseDto space;

  /// `true` when the space was saved, `null` when the user cancelled.
  final void Function(bool? saved) onClose;

  static Future<bool?> show(BuildContext context, SharedSpaceResponseDto space) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => SpaceEditSheet(
        space: space,
        onClose: (saved) => Navigator.of(sheetContext).pop(saved),
      ),
    );
  }

  @override
  ConsumerState<SpaceEditSheet> createState() => _SpaceEditSheetState();
}

class _SpaceEditSheetState extends ConsumerState<SpaceEditSheet> {
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  late final FocusNode _nameFocusNode;
  late final String _originalDescription;
  late UserAvatarColor _color;

  bool _isSaving = false;

  /// Renaming is the dominant path, so the name arrives pre-selected and typing
  /// replaces it -- but only on the FIRST focus, otherwise tapping to place the
  /// caret mid-word would keep re-selecting the whole value.
  bool _hasSelectedName = false;

  @override
  void initState() {
    super.initState();
    _originalDescription = widget.space.description.orElse(null) ?? '';
    _nameController = TextEditingController(text: widget.space.name)
      ..selection = TextSelection(baseOffset: 0, extentOffset: widget.space.name.length);
    _descriptionController = TextEditingController(text: _originalDescription);
    _color = widget.space.color.orElse(null) ?? UserAvatarColor.primary;
    _hasSelectedName = true;
    _nameFocusNode = FocusNode();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _nameFocusNode.dispose();
    super.dispose();
  }

  bool get _canSave => _nameController.text.trim().isNotEmpty && !_isSaving;

  Future<void> _save() async {
    if (!_canSave) return;
    setState(() => _isSaving = true);

    final description = _descriptionController.text;
    try {
      await ref
          .read(sharedSpaceApiRepositoryProvider)
          .update(
            widget.space.id,
            name: _nameController.text,
            // Only send the description when it actually changed. A space created
            // without one stores null server-side, so always sending '' would clobber
            // it on a pure rename; but when the user DID clear it, '' must go through.
            description: description == _originalDescription ? null : description,
            color: _color,
          );
      if (!mounted) return;
      ImmichToast.show(context: context, msg: 'spaces_edit_success'.t(context: context), toastType: ToastType.success);
      widget.onClose(true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ImmichToast.show(
        context: context,
        msg: 'errors.unable_to_update_space'.t(context: context),
        toastType: ToastType.error,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('spaces_edit'.t(context: context), style: context.textTheme.titleMedium),
              const SizedBox(height: 16),
              TextField(
                key: const Key('space-edit-name'),
                controller: _nameController,
                focusNode: _nameFocusNode,
                autofocus: true,
                maxLength: 100,
                decoration: InputDecoration(labelText: 'name'.t(context: context)),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const Key('space-edit-description'),
                controller: _descriptionController,
                maxLength: 500,
                maxLines: 3,
                minLines: 1,
                decoration: InputDecoration(labelText: 'description'.t(context: context)),
              ),
              const SizedBox(height: 8),
              Text('color'.t(context: context), style: context.textTheme.labelLarge),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [for (final color in UserAvatarColor.values) _swatch(color)],
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    key: const Key('space-edit-cancel'),
                    onPressed: _isSaving ? null : () => widget.onClose(null),
                    child: Text('cancel'.t(context: context)),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    key: const Key('space-edit-save'),
                    onPressed: _canSave ? _save : null,
                    child: Text('save'.t(context: context)),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _swatch(UserAvatarColor color) {
    final selected = color == _color;
    // Colour alone conveys nothing to a screen reader, so each swatch is labelled.
    return Semantics(
      label: color.value,
      selected: selected,
      button: true,
      child: InkWell(
        key: Key('space-edit-color-${color.value}'),
        onTap: () => setState(() => _color = color),
        child: SizedBox(
          width: 48,
          height: 48,
          child: Center(
            child: Container(
              key: selected ? Key('space-edit-color-${color.value}-selected') : null,
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: spaceGradientColors(color).first,
                border: selected ? Border.all(color: context.colorScheme.onSurface, width: 3) : null,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- flutter test test/presentation/widgets/spaces/space_edit_sheet_test.dart
```

Expected: **PASS**, `+14`.

If a test fails, fix the **implementation**, not the test — the tests encode the spec.

These were verified before the plan was written, so do not re-check them and do not "fix" them by
adding i18n keys (this slice must not touch `i18n/`):

- `cancel` (`i18n/en.json:808`) and `save` (`:2402`) both exist.
- `spaceGradientColors(UserAvatarColor?) -> List<Color>` lives in
  `package:immich_mobile/widgets/spaces/space_collage.dart`.
- `UserAvatarColor.values` is a `static const` list and `.value` is the lowercase `String` name, so
  the `space-edit-color-${color.value}` keys resolve to e.g. `space-edit-color-blue`.

The likeliest real failure is the select-once assertion: `autofocus: true` plus a controller
selection set in `initState` can be clobbered when the field first gains focus. If so, keep the test
as written and fix the widget — e.g. re-apply the selection in a post-frame callback guarded by
`_hasSelectedName`.

- [ ] **Step 5: Run the slice gates**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
echo "FORMAT_EXIT=$?"
mise exec -- dart analyze --fatal-infos
echo "ANALYZE_EXIT=$?"
mise exec -- flutter test > /tmp/slice3-test.log 2>&1
echo "TEST_EXIT=$?"; tail -2 /tmp/slice3-test.log
```

Expected: all three `0`, and `+2831 ~1 All tests passed!`.

- [ ] **Step 6: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git add mobile/lib/presentation/widgets/spaces/space_edit_sheet.widget.dart \
        mobile/test/presentation/widgets/spaces/space_edit_sheet_test.dart
git commit -m "feat(mobile): add the space edit sheet"
```

---

## Self-Review

**1. Spec coverage.** Slice 3 of the spec lists 14 behaviours; each has a test: prefill ✓, absent
colour defaults to primary ✓, empty name ✓, whitespace name ✓, select-once ✓, maxLength caps ✓,
over-long prefill ✓, name-only omits description ✓, cleared description sends `''` ✓, no-op save ✓,
colour ✓, double-tap ✓, resolves true/null ✓, failure keeps it open ✓, semantics + tap target ✓.

The spec's "dismissed while a save is in flight ⇒ no pop or toast, nothing throws" is covered by
implementation (`if (!mounted) return` after every await) but has no test — pumping a dismissal
mid-future requires the routed `show()` path rather than the bare widget, which belongs to Slice 4
where the sheet is actually pushed. **Flagged deliberately, not forgotten**; Slice 4's plan must add
it.

**2. Placeholder scan.** No TBD/TODO. Step 4 names the two plausible failure modes with the exact
command to diagnose the first, rather than saying "fix any issues".

**3. Type consistency.** `onClose` is `void Function(bool?)` in the class, the test spy
(`closes.add` over `List<bool?>`) and `show`. `update` is called with named `name` / `description` /
`color` exactly as Slice 2 defined, and the test's `verify` uses the same names. `_color` is a
non-nullable `UserAvatarColor`, so `color:` is never null — matching the tests, which always expect a
concrete colour.
