# Mobile Spaces UX — Slice 1: `space_permissions.dart` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace four hand-rolled space role predicates with one tested helper, fixing a latent
`StateError` crash in the process.

**Architecture:** A new pure-Dart file `mobile/lib/utils/space_permissions.dart` exports three
top-level functions. Three widget/page files delete their private copies and delegate. No UI, no
providers, no async — this is a leaf module, which is why it is Slice 1.

**Tech Stack:** Dart 3.12.1 / Flutter 3.44.1, `flutter_test`, the generated `openapi` package
(`SharedSpaceResponseDto`, `SharedSpaceMemberResponseDto`, `SharedSpaceRole`, `Optional`).

**Spec:** `docs/superpowers/specs/2026-07-26-mobile-spaces-ux-design.md` §4 and Slice 1.

## Global Constraints

- Run every command from `mobile/` with the mise-resolved toolchain: `mise exec -- <cmd>`. A bare
  `flutter`/`dart` resolves to 3.41.9 / Dart 3.11.5, below this project's `sdk: '>=3.12.0'`.
- **Never** read `Optional.value` on a possibly-absent field. `Absent.value` throws
  `StateError('No value present')` (`mobile/openapi/lib/optional.dart:67`), so `x.value ?? fallback`
  never reaches the `??`. Use `.orElse(null) ?? fallback`.
- `SharedSpaceResponseDto.members` is typed `Optional<List<SharedSpaceMemberResponseDto>?>` — the
  inner value is itself nullable, so both the absent case and the present-null case must be handled.
- No new i18n keys in this slice.
- Both CI Dart gates must pass before the commit: `dart analyze --fatal-infos lib test` and
  `dart format --set-exit-if-changed .`.
- Baseline for this branch is **2796 passing, 1 skipped**. The full suite must still report that
  (plus this slice's new tests) at the end.

## File Structure

| File                                                                                   | Responsibility                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `mobile/lib/utils/space_permissions.dart` (create)                                     | The three predicates. Pure, no Flutter imports.   |
| `mobile/test/utils/space_permissions_test.dart` (create)                               | Full truth table for all three.                   |
| `mobile/lib/presentation/widgets/remote_album/space_link_picker.widget.dart` (modify)  | Delete `_canWrite`, delegate. Fixes the crash.    |
| `mobile/lib/pages/library/spaces/space_detail.page.dart` (modify)                      | Delete `_isOwner` / `_canEdit` bodies, delegate.  |
| `mobile/lib/presentation/widgets/bottom_sheet/space_bottom_sheet.widget.dart` (modify) | Delete `_canEdit`, delegate to the role overload. |

`test/utils/` is the correct home: it already holds `space_link_album_candidates_test.dart`, which
tests the sibling `lib/utils/space_link_album_candidates.dart`. Do **not** use `test/utils_legacy/`.

---

### Task 1: The `space_permissions` helper

**Files:**

- Create: `mobile/lib/utils/space_permissions.dart`
- Test: `mobile/test/utils/space_permissions_test.dart`

**Interfaces:**

- Consumes: nothing from earlier tasks (this is the first).
- Produces, relied on by Tasks 2–4:
  - `bool spaceIsWritable(SharedSpaceResponseDto space, String? currentUserId)`
  - `bool spaceIsOwned(SharedSpaceResponseDto space, String? currentUserId)`
  - `bool roleIsWritable(SharedSpaceRole? role)`

- [ ] **Step 1: Write the failing test**

Create `mobile/test/utils/space_permissions_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/space_permissions.dart';
import 'package:openapi/api.dart';

SharedSpaceMemberResponseDto _member(String userId, SharedSpaceRole role) => SharedSpaceMemberResponseDto(
  userId: userId,
  name: userId,
  email: '$userId@example.com',
  role: role,
  joinedAt: '2024-01-01T00:00:00Z',
  sharePersonMetadata: true,
  showInTimeline: true,
);

/// [members] is passed through verbatim so a test can supply
/// `Optional.absent()`, `Optional.present(null)` or a real list.
SharedSpaceResponseDto _space({
  String createdById = 'creator',
  Optional<List<SharedSpaceMemberResponseDto>?> members = const Optional.absent(),
}) => SharedSpaceResponseDto(
  id: 'space-1',
  name: 'Space 1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  createdById: createdById,
  members: members,
);

void main() {
  group('spaceIsWritable / spaceIsOwned', () {
    test('the creator is writable and owned even when absent from the members list', () {
      final space = _space(createdById: 'me', members: Optional.present([_member('someone', SharedSpaceRole.viewer)]));

      expect(spaceIsWritable(space, 'me'), isTrue);
      expect(spaceIsOwned(space, 'me'), isTrue);
    });

    test('a non-creator member with the owner role is writable AND owned', () {
      final space = _space(createdById: 'creator', members: Optional.present([_member('me', SharedSpaceRole.owner)]));

      expect(spaceIsWritable(space, 'me'), isTrue);
      expect(spaceIsOwned(space, 'me'), isTrue, reason: 'Delete gating depends on this');
    });

    test('an editor is writable but not owned', () {
      final space = _space(members: Optional.present([_member('me', SharedSpaceRole.editor)]));

      expect(spaceIsWritable(space, 'me'), isTrue);
      expect(spaceIsOwned(space, 'me'), isFalse);
    });

    test('a viewer is neither', () {
      final space = _space(members: Optional.present([_member('me', SharedSpaceRole.viewer)]));

      expect(spaceIsWritable(space, 'me'), isFalse);
      expect(spaceIsOwned(space, 'me'), isFalse);
    });

    test('a non-member who did not create the space is neither', () {
      final space = _space(members: Optional.present([_member('other', SharedSpaceRole.owner)]));

      expect(spaceIsWritable(space, 'me'), isFalse);
      expect(spaceIsOwned(space, 'me'), isFalse);
    });

    test('an absent members list falls back to the creator check without throwing', () {
      // Absent.value throws StateError, so `members.value ?? const []` would crash here.
      final space = _space(createdById: 'me');

      expect(() => spaceIsWritable(space, 'me'), returnsNormally);
      expect(spaceIsWritable(space, 'me'), isTrue);
      expect(spaceIsWritable(space, 'someone-else'), isFalse);
    });

    test('a present-but-null members list behaves as an empty list', () {
      final space = _space(createdById: 'creator', members: const Optional.present(null));

      expect(() => spaceIsWritable(space, 'me'), returnsNormally);
      expect(spaceIsWritable(space, 'me'), isFalse);
    });

    test('duplicate membership rows resolve to the first match deterministically', () {
      final space = _space(
        members: Optional.present([_member('me', SharedSpaceRole.editor), _member('me', SharedSpaceRole.viewer)]),
      );

      expect(spaceIsWritable(space, 'me'), isTrue);
    });

    test('a null current user is never writable or owned, even if createdById is also null-ish', () {
      final space = _space(createdById: '', members: Optional.present([_member('me', SharedSpaceRole.owner)]));

      expect(spaceIsWritable(space, null), isFalse);
      expect(spaceIsOwned(space, null), isFalse);
    });

    test('the creator short-circuit wins over a demoted member row', () {
      // Ownership transferred: still the createdById, but demoted to viewer.
      final space = _space(createdById: 'me', members: Optional.present([_member('me', SharedSpaceRole.viewer)]));

      expect(spaceIsWritable(space, 'me'), isTrue, reason: 'precedence is a decision, not an accident');
      expect(spaceIsOwned(space, 'me'), isTrue);
    });
  });

  group('roleIsWritable', () {
    test('owner and editor are writable; viewer and null are not', () {
      expect(roleIsWritable(SharedSpaceRole.owner), isTrue);
      expect(roleIsWritable(SharedSpaceRole.editor), isTrue);
      expect(roleIsWritable(SharedSpaceRole.viewer), isFalse);
      expect(roleIsWritable(null), isFalse);
    });
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && mise exec -- flutter test test/utils/space_permissions_test.dart`

Expected: **FAIL at compile time**, with an error like
`Error: Error when reading 'lib/utils/space_permissions.dart': No such file or directory`.
This is the correct red — the module does not exist yet. If it fails for any other reason, stop and
investigate rather than proceeding.

- [ ] **Step 3: Write the minimal implementation**

Create `mobile/lib/utils/space_permissions.dart`:

```dart
import 'package:openapi/api.dart';

/// Role predicates for shared spaces, shared by every surface that gates on them.
///
/// One implementation so the space detail page, the space bottom sheet and the
/// link picker cannot drift apart. See the 2026-07-26 mobile Spaces UX design, §4.
///
/// `SharedSpaceResponseDto.members` is `Optional<List<...>?>` and `Absent.value`
/// **throws** (`openapi/lib/optional.dart:67`), so every read goes through
/// `orElse(null)` — the previously common `members.value ?? const []` crashes on a
/// response that omits the list.
/// The first matching row wins, which makes the duplicate-membership case
/// deterministic. Written as an explicit loop rather than `.firstOrNull` so the
/// file needs no `package:collection` import — Dart imports are not transitive,
/// and this module deliberately imports only `openapi`.
SharedSpaceRole? _roleOf(SharedSpaceResponseDto space, String currentUserId) {
  final members = space.members.orElse(null) ?? const <SharedSpaceMemberResponseDto>[];
  for (final member in members) {
    if (member.userId == currentUserId) return member.role;
  }
  return null;
}

/// Whether [currentUserId] may add to, and edit the naming of, [space].
///
/// The creator short-circuit is deliberate and takes precedence over their member
/// row: `getAll` does not guarantee the creator appears in `members`, so relying on
/// the list alone would lock a space's own creator out of it.
bool spaceIsWritable(SharedSpaceResponseDto space, String? currentUserId) {
  if (currentUserId == null) return false;
  if (space.createdById == currentUserId) return true;
  return roleIsWritable(_roleOf(space, currentUserId));
}

/// Whether [currentUserId] owns [space] — the gate for destructive actions.
bool spaceIsOwned(SharedSpaceResponseDto space, String? currentUserId) {
  if (currentUserId == null) return false;
  if (space.createdById == currentUserId) return true;
  return _roleOf(space, currentUserId) == SharedSpaceRole.owner;
}

/// The role-only overload, for callers holding a resolved [SharedSpaceRole]
/// rather than a whole DTO (e.g. `SpaceBottomSheet`).
bool roleIsWritable(SharedSpaceRole? role) =>
    role == SharedSpaceRole.owner || role == SharedSpaceRole.editor;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && mise exec -- flutter test test/utils/space_permissions_test.dart`
Expected: **PASS**, `+11` (10 in the first group, 1 in the second).

- [ ] **Step 5: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git add mobile/lib/utils/space_permissions.dart mobile/test/utils/space_permissions_test.dart
git commit -m "feat(mobile): add shared space permission helpers"
```

---

### Task 2: Repoint `SpaceLinkPickerSheet`

**Files:**

- Modify: `mobile/lib/presentation/widgets/remote_album/space_link_picker.widget.dart:34-39`

**Interfaces:**

- Consumes: `spaceIsWritable` from Task 1.
- Produces: nothing new.

This is the crash fix. The current body is:

```dart
  static bool _canWrite(SharedSpaceResponseDto space, String? currentUserId) {
    if (currentUserId == null) return false;
    if (space.createdById == currentUserId) return true;
    final role = (space.members.value ?? const []).where((m) => m.userId == currentUserId).firstOrNull?.role;
    return role == SharedSpaceRole.owner || role == SharedSpaceRole.editor;
  }
```

`space.members.value` throws when the field is absent, so the `?? const []` is dead code.

- [ ] **Step 1: Delete `_canWrite` and call the helper**

Remove the whole `static bool _canWrite(...) { ... }` block. In `build`, change the filter from
`_canWrite(s, currentUserId)` to `spaceIsWritable(s, currentUserId)`.

Add the import, keeping the file's existing alphabetical ordering:

```dart
import 'package:immich_mobile/utils/space_permissions.dart';
```

- [ ] **Step 2: Run the existing tests for this widget**

Run: `cd mobile && mise exec -- flutter test test/presentation/widgets/remote_album/`
Expected: **PASS**, unchanged from baseline. This widget's behaviour is identical except that an
absent members list no longer throws.

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/presentation/widgets/remote_album/space_link_picker.widget.dart
git commit -m "refactor(mobile): use shared space permission helper in link picker"
```

---

### Task 3: Repoint `SpaceBottomSheet`

**Files:**

- Modify: `mobile/lib/presentation/widgets/bottom_sheet/space_bottom_sheet.widget.dart:38-39`

**Interfaces:**

- Consumes: `roleIsWritable` from Task 1. This caller holds a `SharedSpaceRole`, not a DTO, which is
  exactly why Task 1 exports the role-only overload.

The current body is:

```dart
  bool get _canEdit =>
      widget.currentUserRole == SharedSpaceRole.owner || widget.currentUserRole == SharedSpaceRole.editor;
```

- [ ] **Step 1: Delegate to the helper**

```dart
  bool get _canEdit => roleIsWritable(widget.currentUserRole);
```

Add `import 'package:immich_mobile/utils/space_permissions.dart';`.

- [ ] **Step 2: Run the existing tests for this widget**

Run: `cd mobile && mise exec -- flutter test test/presentation/widgets/bottom_sheet/`
Expected: **PASS**, unchanged. This is a pure like-for-like substitution.

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/presentation/widgets/bottom_sheet/space_bottom_sheet.widget.dart
git commit -m "refactor(mobile): use shared space permission helper in space bottom sheet"
```

---

### Task 4: Repoint `SpaceDetailPage` (behaviour change)

**Files:**

- Modify: `mobile/lib/pages/library/spaces/space_detail.page.dart:98-121`

**Interfaces:**

- Consumes: `spaceIsWritable`, `spaceIsOwned` from Task 1.

**This task changes behaviour and that is intended.** The current getters read only the separately
fetched `_members` list, with no creator short-circuit:

```dart
  SharedSpaceMemberResponseDto? get _currentMember {
    final currentUser = ref.read(currentUserProvider);
    if (currentUser == null || _members == null) return null;
    return _members!.where((m) => m.userId == currentUser.id).firstOrNull;
  }

  bool get _isOwner {
    final member = _currentMember;
    if (member == null) return false;
    return member.role == SharedSpaceRole.owner;
  }

  bool get _canEdit {
    final member = _currentMember;
    if (member == null) return false;
    return member.role == SharedSpaceRole.owner || member.role == SharedSpaceRole.editor;
  }
```

After this task a creator who is absent from `_members` is treated as owner, which is the correct
reading and matches every other surface. The fail-closed loading default is **preserved**: while
`_space` is null the helpers are not consulted at all.

- [ ] **Step 1: Rewrite the two getters**

Keep `_currentMember` and `_currentRole` as they are — `_currentRole` still feeds
`SpaceBottomSheet(currentUserRole:)` and is not a permission decision. Replace only these two:

```dart
  bool get _isOwner {
    final space = _space;
    if (space == null) return false;
    return spaceIsOwned(space, ref.read(currentUserProvider)?.id);
  }

  bool get _canEdit {
    final space = _space;
    if (space == null) return false;
    return spaceIsWritable(space, ref.read(currentUserProvider)?.id);
  }
```

Add `import 'package:immich_mobile/utils/space_permissions.dart';`.

Note the source flips from `_members` to `_space`: the DTO returned by `get()` carries both
`createdById` and `members`, so one object answers both questions and the creator short-circuit
becomes reachable. `_members` remains in use by `_currentMember` / `_currentRole`.

- [ ] **Step 2: Verify the whole suite still passes**

Run: `cd mobile && mise exec -- flutter test`
Expected: **PASS**. This page has no test of its own today (Slice 4 gives it one), so this run is
guarding against collateral damage elsewhere. Expect `+2807` — the 2796 baseline plus Task 1's 11.

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/pages/library/spaces/space_detail.page.dart
git commit -m "refactor(mobile): use shared space permission helpers on space detail page"
```

---

### Task 5: Slice gates

**Files:** none — verification only.

- [ ] **Step 1: Confirm no stale copies of the predicate remain**

Run:

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
grep -rn "SharedSpaceRole.owner || " lib/ ; echo "exit=$?"
```

Expected: **no matches** (`exit=1`). Every disjunction of that shape now lives in
`space_permissions.dart`, which spells it `role == SharedSpaceRole.owner || role == SharedSpaceRole.editor`
inside `roleIsWritable` — so if that one line is the sole match, that is correct; any _other_ match is
a call site this slice missed.

- [ ] **Step 2: Run both CI Dart gates**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- dart analyze --fatal-infos lib test
mise exec -- dart format --set-exit-if-changed .
```

Expected: both exit 0. `dart analyze` must be run over `lib test` — `flutter analyze lib` alone
misses test-only lints and is what CI would catch instead.

- [ ] **Step 3: Run the full suite one final time**

Run: `cd mobile && mise exec -- flutter test`
Expected: `All tests passed!`, `+2807 ~1`.

- [ ] **Step 4: Push**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git push -u origin worktree-feat+mobile-spaces-ux
```

---

## Self-Review

**1. Spec coverage.** Slice 1 of the spec lists eleven behaviours; each maps to a test in Task 1:
creator-not-in-members ✓, non-creator owner ✓, editor ✓, viewer ✓, non-member ✓, absent members ✓,
present-null members ✓, duplicate rows ✓, null current user ✓, creator-vs-demoted precedence ✓,
`roleIsWritable` ✓. The spec's Done-when requires all four call sites delegate (Tasks 2–4 cover
three; the fourth is `space_detail.page.dart`'s _second_ getter, both handled in Task 4) and that the
two behaviour changes are asserted as new — covered by the creator-not-in-members and
creator-vs-demoted tests.

**2. Placeholder scan.** No TBD/TODO. Every code step carries real code; every run step carries a
real command and a concrete expected result.

**3. Type consistency.** `spaceIsWritable` / `spaceIsOwned` take
`(SharedSpaceResponseDto, String?)` and `roleIsWritable` takes `SharedSpaceRole?` in the test, the
implementation, and all three call sites. `_membersOf` returns a non-nullable
`List<SharedSpaceMemberResponseDto>`, which is what `.where(...).firstOrNull` needs.
