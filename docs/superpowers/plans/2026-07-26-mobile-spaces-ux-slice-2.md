# Mobile Spaces UX — Slice 2: `SharedSpaceApiRepository.update` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give mobile its first ability to write a space's name, description and colour, with
`Optional` semantics that cannot silently clobber unrelated fields.

**Architecture:** One new method on the existing `SharedSpaceApiRepository`, built on the already
generated `updateSpace` / `SharedSpaceUpdateDto`. No provider, no UI, no server change — Slice 3
consumes it. Tests extend the repository's existing 512-line suite.

**Tech Stack:** Dart 3.12.1 / Flutter 3.44.1, `mocktail`, the generated `openapi` package.

**Spec:** `docs/superpowers/specs/2026-07-26-mobile-spaces-ux-design.md` §7 and Slice 2.

## Global Constraints

- Run every command from `mobile/` via `mise exec -- <cmd>`. The pin is **Flutter 3.44.1 / Dart
  3.12.1** and is directory-scoped to `mobile/mise.toml`; a bare `flutter`/`dart`, or the mise shims
  on PATH, gives 3.41.9 / Dart 3.11.5 and dies with "requires SDK version >=3.12.0".
- **The format gate is `lib`-only and excludes generated files.** Reproduce CI exactly — and note
  **zsh does not word-split `$(...)`, so it must run under `bash -c`**:
  ```bash
  cd mobile && mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
  ```
  Never run bare `dart format .` — it rewrites ~545 files across `openapi/`, `pigeon/` and `test/`.
  `--output=none` makes it a check rather than a rewrite.
- The analyze gate is `mise exec -- dart analyze --fatal-infos` run from `mobile/` (whole package,
  including `test/`).
- **Never** read `Optional.value` on a possibly-absent field — `Absent.value` throws `StateError`.
- `Optional.present(null)` is a **400**, not a field-clear: `name`, `description` and `color` are
  `.optional()` but **not** `.nullable()` server-side. Only absent-vs-present is meaningful.
- Baseline after Slice 1 is **2807 passing, 1 skipped**.
- No new i18n keys in this slice.

## File Structure

| File                                                                        | Responsibility                               |
| --------------------------------------------------------------------------- | -------------------------------------------- |
| `mobile/lib/repositories/shared_space_api.repository.dart` (modify)         | Add `update`, next to the existing `create`. |
| `mobile/test/modules/spaces/shared_space_api_repository_test.dart` (modify) | Add an `update` group.                       |

Do **not** create `mobile/test/repositories/shared_space_api_repository_test.dart` — the suite for
this class already exists at the path above, with `MockSharedSpacesApi`, `MockApiService` and a
`setUpAll` block of `registerFallbackValue` calls.

---

### Task 1: `update` on the repository

**Files:**

- Modify: `mobile/lib/repositories/shared_space_api.repository.dart` (add after `create`, ~line 37)
- Test: `mobile/test/modules/spaces/shared_space_api_repository_test.dart`

**Interfaces:**

- Consumes: `checkNull` from the existing `ApiRepository` base class, already used by every sibling
  method in this file (e.g. `create` at line 35).
- Produces, relied on by Slice 3:

  ```dart
  Future<SharedSpaceResponseDto> update(
    String id, {
    String? name,
    String? description,
    UserAvatarColor? color,
  })
  ```

  **Calling convention, which Slice 3 depends on:** a `null` argument means _absent_ (leave the
  field untouched); a non-null argument means _send this value_. Passing `description: ''` therefore
  clears the description, while passing `description: null` leaves it alone. This is how the caller
  expresses "only send what changed".

- [ ] **Step 1: Register the DTO fallback**

In the existing `setUpAll` block (around line 28-39), add one line alongside the others:

```dart
    registerFallbackValue(api.SharedSpaceUpdateDto());
```

- [ ] **Step 2: Write the failing tests**

Append this group to `mobile/test/modules/spaces/shared_space_api_repository_test.dart`, before the
final closing `}` of `main()`. It follows the file's existing style: `any(that: isA<...>().having(...))`
for payload assertions, as used by the `updateSpacePerson` group.

```dart
  group('update', () {
    api.SharedSpaceResponseDto updatedSpace() => api.SharedSpaceResponseDto(
      id: 'space-1',
      name: 'Renamed',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      createdById: 'user-1',
    );

    /// Asserts on the DTO handed to the generated client.
    Matcher dtoThat(bool Function(api.SharedSpaceUpdateDto dto) predicate, String description) =>
        isA<api.SharedSpaceUpdateDto>().having(predicate, description, isTrue);

    test('sends only the name when only the name changed', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', name: 'Renamed');

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              (d) =>
                  d.name.isPresent &&
                  d.name.value == 'Renamed' &&
                  d.description.isEmpty &&
                  d.color.isEmpty,
              'name present, description and color absent',
            ),
          ),
        ),
      ).called(1);
    });

    test('sends an empty description verbatim so it clears server-side', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', name: 'Renamed', description: '');

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              (d) => d.description.isPresent && d.description.value == '',
              'description present and empty',
            ),
          ),
        ),
      ).called(1);
    });

    test('sends a newly added description', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', description: 'Holiday photos');

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              (d) => d.description.isPresent && d.description.value == 'Holiday photos',
              'description present',
            ),
          ),
        ),
      ).called(1);
    });

    test('omits description entirely when it is not passed', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', name: 'Renamed');

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              // Absent, NOT Optional.present(null) -- the latter is a 400, because the
              // server schema is .optional() but not .nullable().
              (d) => d.description.isEmpty,
              'description absent',
            ),
          ),
        ),
      ).called(1);
    });

    test('sends the colour when it changed', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', color: api.UserAvatarColor.amber);

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              (d) => d.color.isPresent && d.color.value == api.UserAvatarColor.amber,
              'color present',
            ),
          ),
        ),
      ).called(1);
    });

    test('never populates the four fields this feature does not own', () async {
      // A stray Optional.present(false) on faceRecognitionEnabled would silently
      // disable face recognition for the whole space on every rename.
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', name: 'Renamed', description: 'x', color: api.UserAvatarColor.red);

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              (d) =>
                  d.faceRecognitionEnabled.isEmpty &&
                  d.petsEnabled.isEmpty &&
                  d.thumbnailAssetId.isEmpty &&
                  d.thumbnailCropY.isEmpty,
              'untouched fields all absent',
            ),
          ),
        ),
      ).called(1);
    });

    test('trims the name but not the description', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      await repository.update('space-1', name: '  Renamed  ', description: '  keep me  ');

      verify(
        () => mockApi.updateSpace(
          'space-1',
          any(
            that: dtoThat(
              (d) => d.name.value == 'Renamed' && d.description.value == '  keep me  ',
              'name trimmed, description verbatim',
            ),
          ),
        ),
      ).called(1);
    });

    test('returns the updated space', () async {
      when(() => mockApi.updateSpace('space-1', any())).thenAnswer((_) async => updatedSpace());

      final result = await repository.update('space-1', name: 'Renamed');

      expect(result.name, 'Renamed');
    });

    test('throws when the API returns null', () async {
      when(() => mockApi.updateSpace(any(), any())).thenAnswer((_) async => null);

      expect(() => repository.update('space-1', name: 'Renamed'), throwsA(isA<Exception>()));
    });

    test('propagates an API failure unchanged', () async {
      when(() => mockApi.updateSpace(any(), any())).thenThrow(Exception('boom'));

      expect(() => repository.update('space-1', name: 'Renamed'), throwsA(isA<Exception>()));
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- flutter test test/modules/spaces/shared_space_api_repository_test.dart
```

Expected: **FAIL at compile time** with
`Error: The method 'update' isn't defined for the class 'SharedSpaceApiRepository'`.
That is the correct red. If it fails for any other reason, stop and investigate.

- [ ] **Step 4: Write the minimal implementation**

In `mobile/lib/repositories/shared_space_api.repository.dart`, add directly after the existing
`create` method:

```dart
  /// Update a space's name, description and/or colour (PATCH /shared-spaces/{id}).
  ///
  /// A `null` argument means **absent** — the field is left untouched. A non-null
  /// argument is sent verbatim, so `description: ''` clears the description while
  /// `description: null` leaves the existing text alone. That distinction is how a
  /// pure rename avoids clobbering a description it never showed the user.
  ///
  /// Never sends `Optional.present(null)`: `name`, `description` and `color` are
  /// `.optional()` but not `.nullable()` server-side, so an explicit null is a 400
  /// rather than a field-clear. The four fields this feature does not own
  /// (faceRecognitionEnabled, petsEnabled, thumbnailAssetId, thumbnailCropY) are
  /// left at their `Optional.absent()` defaults.
  ///
  /// Naming and appearance are editor-level server-side; the role is enforced there.
  Future<SharedSpaceResponseDto> update(
    String id, {
    String? name,
    String? description,
    UserAvatarColor? color,
  }) async {
    final dto = SharedSpaceUpdateDto(
      name: name == null ? const Optional.absent() : Optional.present(name.trim()),
      description: description == null ? const Optional.absent() : Optional.present(description),
      color: color == null ? const Optional.absent() : Optional.present(color),
    );
    return await checkNull(_api.updateSpace(id, dto));
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- flutter test test/modules/spaces/shared_space_api_repository_test.dart
```

Expected: **PASS**, `+38` (the existing 28 plus these 10).

- [ ] **Step 6: Run the slice gates**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux/mobile
mise exec -- bash -c 'dart format --output=none --set-exit-if-changed $(find lib -name "*.dart" -not \( -name "*.g.dart" -o -name "*.drift.dart" -o -name "*.gr.dart" \))'
echo "FORMAT_EXIT=$?"
mise exec -- dart analyze --fatal-infos
echo "ANALYZE_EXIT=$?"
mise exec -- flutter test > /tmp/slice2-test.log 2>&1
echo "TEST_EXIT=$?"; tail -2 /tmp/slice2-test.log
```

Expected: `FORMAT_EXIT=0`, `ANALYZE_EXIT=0`, `TEST_EXIT=0`, and `+2817 ~1 All tests passed!`.

If the format gate reports a file, fix it with `mise exec -- dart format <that file>` and re-run —
do not reformat the tree.

- [ ] **Step 7: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/feat+mobile-spaces-ux
git add mobile/lib/repositories/shared_space_api.repository.dart \
        mobile/test/modules/spaces/shared_space_api_repository_test.dart
git commit -m "feat(mobile): add space update to the shared space repository"
```

---

## Self-Review

**1. Spec coverage.** Slice 2 of the spec lists nine behaviours. Mapping: name-only ✓; description
`''` ✓; description null→text ✓; description omitted ⇒ absent ✓; the four untouched fields absent ✓;
name trimmed / description not ✓; null return throws ✓; API error propagates ✓. The ninth — lazy
`_api` resolution — the spec explicitly marks as already covered by the file's existing
`lazy SharedSpacesApi resolution` group, so no new test. The `returns the updated space` test is an
extra beyond the spec, justified because Slice 3 closes its sheet on that return value.

**2. Placeholder scan.** No TBD/TODO. Every step has real code or a real command with a concrete
expected result.

**3. Type consistency.** `update` returns `Future<SharedSpaceResponseDto>` (non-nullable, via
`checkNull`) while the generated `updateSpace` returns `SharedSpaceResponseDto?` — `checkNull` is
what bridges them, exactly as `create` does. `color` is `UserAvatarColor`, matching
`Optional<UserAvatarColor?> color` on the DTO. The test file prefixes openapi types with `api.`
throughout, matching its existing `import 'package:openapi/api.dart' as api;`; the library file does
not, matching its unprefixed import.
