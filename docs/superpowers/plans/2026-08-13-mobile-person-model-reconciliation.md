# Mobile Person-Model Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release the three quarantined upstream person-model commits (`52edcc0c74c`, `303a9f15b1a`, `1c3a5cf5087`) into the rolling rebase branch while preserving the fork's shared-space people behavior, per the approved spec.

**Architecture:** Phase 1 lands fork-only preparation on `main` under full CI (characterization tests, dead-code deletion, `FilterPerson` split, invalidation helper), shrinking the collision surface. Phase 2 releases the quarantine in the rolling worktree with exact per-commit resolutions, then an adaptation commit carrying codegen, test retypes, and the new-behavior TDD tests. Phase 3/4 finish the pending upstream range and the docs/memory updates.

**Tech Stack:** Flutter/Dart (pin in `mobile/mise.toml`, 3.44.9 at writing — read the pin, it moves), Riverpod (hooks_riverpod), freezed, Drift (in-memory `NativeDatabase.memory()` for repository tests), mocktail, git rebase in the rolling worktree.

**Spec:** `docs/superpowers/specs/2026-08-13-mobile-person-model-reconciliation-design.md` — read it first; every resolution below argues from it.

## Global Constraints

- **Where work happens:** Tasks 1–9 in the main checkout `/Users/pierre/dev/gallery` on branch `feat/mobile-person-model-prep` (off `main`, created in Task 2). Tasks 10–17 in the rolling worktree `/Users/pierre/dev/gallery/.worktrees/rebase-upstream-rolling-v3.1.1` on `rebase/upstream-rolling-v3.1.1`.
- **Test command (mobile):** from `mobile/`: `flutter test <path>` (or no path for all). `flutter test` is the gate — `dart analyze` misses generated-code compile breaks. Before first run in a fresh checkout: `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`. In the rolling worktree instead run `mise //mobile:codegen` from the worktree directory (never `//:` targets from the worktree — they hit the main checkout).
- **CI gates besides tests:** `dart analyze --fatal-infos lib test` and `dart format` (lib scope) must both be clean.
- **freezed codegen:** `dart run build_runner build --delete-conflicting-outputs` from `mobile/`; generated `*.freezed.dart` are committed on `main`.
- **Commits:** mechanical, measured messages. Never add Co-Authored-By / Generated-with trailers.
- **No new user-facing strings** anywhere in this plan — the i18n nine-locale rule is not triggered. If you find yourself adding a translation key, stop; you have left the plan.
- **PRs:** set the changelog label immediately after opening (the labeler clobbers it otherwise).
- **Recorded deviations from spec §9.3** (conscious calls, not gaps): (a) §9.3-5 tab-shell/bottom-nav navigation refetch is pinned by the Task 8 helper test + a call-site grep instead of heavyweight shell widget tests; (b) §9.3-6's consumer-side fail-open (`.value ?? true` in `drift_person.page.dart`) is covered at the provider level only — a sliver-app-bar harness is not worth its weight; (c) §9.2-A's hidden-people case is asserted at the source level (SQL filter + `withHidden:false`), not in the picker provider, because Phase 1 removes the picker's redundant client filter.

---

## Phase 0 — gate

### Task 1: Merge PR #980

**Files:** none (GitHub operation).

**Interfaces:**

- Produces: `main` containing `driftSpacePeopleProvider`, `mobile/lib/utils/people_sort.dart` (`comparePeople(DriftPerson, DriftPerson, PeopleSortBy)`), `people_grid.widget.dart`, and a third `ref.invalidate(driftSpacePeopleProvider)` line at 4 of the 5 invalidation sites. Every later task assumes post-#980 code.

- [ ] **Step 1: Verify PR #980 is green and unconflicted**

Run: `gh-axi pr view 980` and check CI status + mergeability. If checks are pending, wait; if red, stop and report — do not merge.

- [ ] **Step 2: Merge**

Merge via the repo's normal squash flow (`gh-axi pr merge 980 --squash`). Do NOT force anything; if GitHub reports conflicts, stop and report.

- [ ] **Step 3: Update local main**

Run: `git -C /Users/pierre/dev/gallery checkout main && git pull`
Expected: fast-forward including #980's squash commit.

---

## Phase 1 — `main`: fork-only preparation

### Task 2: Characterization — edit-modal refresh + failure paths

The single most important test file in this plan: it makes the quarantine trap executable (spec §9.3-1…4). Written BEFORE any production change; must stay green through Tasks 5–8 and (retyped) through Phase 2.

**Files:**

- Create: `mobile/test/presentation/widgets/people/person_edit_modals_refresh_test.dart`
- Branch: `git checkout -b feat/mobile-person-model-prep` (first step)

**Interfaces:**

- Consumes: `showNameEditModal` / `showBirthdayEditModal` (`mobile/lib/utils/people.utils.dart`), `driftPeopleServiceProvider`, `driftGetAllPeopleWithSharedSpacesProvider`, `driftSpacePeopleProvider`, `driftGetAllPeopleProvider` (`mobile/lib/providers/infrastructure/people.provider.dart`), `pumpConsumerWidget` (`mobile/test/widget_tester_extensions.dart`).
- Produces: the pinned refresh contract later tasks must not break.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/pierre/dev/gallery && git checkout -b feat/mobile-person-model-prep
```

- [ ] **Step 2: Write the test file**

```dart
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/utils/people.utils.dart';
import 'package:mocktail/mocktail.dart';

import '../../../widget_tester_extensions.dart';

class MockDriftPeopleService extends Mock implements DriftPeopleService {}

DriftPerson _person({String id = 'p1', String? spaceId}) => DriftPerson(
  id: id,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  ownerId: 'owner',
  name: 'Alice',
  isFavorite: false,
  isHidden: false,
  color: null,
  spaceId: spaceId,
);

void main() {
  late MockDriftPeopleService service;
  // Counts real fetch executions of the server-backed list — an invalidate on a
  // watched provider re-runs the override, incrementing this. Asserting counts (not
  // list contents) is deliberate: a deleted invalidation cannot pass this test.
  late int serverFetches;

  setUpAll(() {
    registerFallbackValue(_person());
  });

  setUp(() {
    service = MockDriftPeopleService();
    serverFetches = 0;
  });

  List<Override> overrides() => [
    driftPeopleServiceProvider.overrideWithValue(service),
    driftGetAllPeopleWithSharedSpacesProvider.overrideWith((ref, sortBy) async {
      serverFetches++;
      return <DriftPerson>[];
    }),
    driftSpacePeopleProvider.overrideWith((ref, key) async => <DriftPerson>[]),
    driftGetAllPeopleProvider.overrideWith((ref, sortBy) async => <DriftPerson>[]),
  ];

  // Keeps the server-backed provider actively listened so invalidation triggers a
  // refetch, and exposes buttons that launch the real modal entry points.
  Widget harness(DriftPerson person) => Consumer(
    builder: (context, ref, _) {
      ref.watch(driftGetAllPeopleWithSharedSpacesProvider(PeopleSortBy.photoCount));
      return Column(
        children: [
          TextButton(
            key: const Key('open-name-modal'),
            onPressed: () => showNameEditModal(context, person),
            child: const Text('name'),
          ),
          TextButton(
            key: const Key('open-birthday-modal'),
            onPressed: () => showBirthdayEditModal(context, person),
            child: const Text('birthday'),
          ),
        ],
      );
    },
  );

  Future<void> saveName(WidgetTester tester, {String newName = 'Alicia'}) async {
    await tester.tap(find.byKey(const Key('open-name-modal')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField), newName);
    await tester.tap(find.text('save'.tr()));
    await tester.pumpAndSettle();
  }

  group('rename refresh (spec 9.3-1/2)', () {
    testWidgets('a successful personal-person rename refetches the server people list and pops', (tester) async {
      when(() => service.updateName(any(), any())).thenAnswer((_) async => 1);
      await tester.pumpConsumerWidget(harness(_person()), overrides: overrides());
      expect(serverFetches, 1);

      await saveName(tester);

      verify(() => service.updateName(any(that: predicate<DriftPerson>((p) => p.id == 'p1')), 'Alicia')).called(1);
      expect(serverFetches, 2);
      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('a successful space-person rename refetches the server people list and pops', (tester) async {
      // Endpoint routing itself is pinned in people_service_test.dart; this pins that
      // the UI-level refresh happens for the space path too (no local write exists to
      // make any reactive list update).
      when(() => service.updateName(any(), any())).thenAnswer((_) async => 1);
      await tester.pumpConsumerWidget(harness(_person(id: 'sp1', spaceId: 'space-1')), overrides: overrides());

      await saveName(tester);

      verify(() => service.updateName(any(that: predicate<DriftPerson>((p) => p.spaceId == 'space-1')), 'Alicia')).called(1);
      expect(serverFetches, 2);
      expect(find.byType(AlertDialog), findsNothing);
    });
  });

  group('birthday refresh (spec 9.3-3)', () {
    Future<void> saveBirthday(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('open-birthday-modal')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('save'.tr()));
      await tester.pumpAndSettle();
    }

    testWidgets('a successful birthday edit refetches the server people list and pops', (tester) async {
      when(() => service.updateBrithday(any(), any())).thenAnswer((_) async => 1);
      await tester.pumpConsumerWidget(harness(_person()), overrides: overrides());

      await saveBirthday(tester);

      verify(() => service.updateBrithday(any(), any())).called(1);
      expect(serverFetches, 2);
      expect(find.byType(AlertDialog), findsNothing);
    });

    testWidgets('a space-person birthday edit refetches the server people list', (tester) async {
      when(() => service.updateBrithday(any(), any())).thenAnswer((_) async => 1);
      await tester.pumpConsumerWidget(harness(_person(id: 'sp1', spaceId: 'space-1')), overrides: overrides());

      await saveBirthday(tester);

      expect(serverFetches, 2);
    });
  });

  group('failure paths (spec 9.3-4)', () {
    testWidgets('a zero result does not invalidate and does not pop', (tester) async {
      when(() => service.updateName(any(), any())).thenAnswer((_) async => 0);
      await tester.pumpConsumerWidget(harness(_person()), overrides: overrides());

      await saveName(tester);

      expect(serverFetches, 1);
      expect(find.byType(AlertDialog), findsOneWidget);
    });

    testWidgets('a service error does not invalidate and does not pop', (tester) async {
      when(() => service.updateName(any(), any())).thenThrow(Exception('boom'));
      await tester.pumpConsumerWidget(harness(_person()), overrides: overrides());

      await saveName(tester);

      expect(serverFetches, 1);
      expect(find.byType(AlertDialog), findsOneWidget);
    });
  });
}
```

- [ ] **Step 3: Run the tests — they must PASS (characterization of current behavior)**

Run: `cd mobile && flutter test test/presentation/widgets/people/person_edit_modals_refresh_test.dart`
Expected: all 6 PASS. If any fails, the harness is wrong (the production behavior exists today) — fix the test, not the code. Known trip points: the fluttertoast overlay in the error test (assert only dialog presence + count, as written), and `pumpAndSettle` with the `ScrollDatePicker` (it settles; if it times out, use `pumpConsumerWidgetRaw` + manual pumps).

- [ ] **Step 4: Commit**

```bash
git add mobile/test/presentation/widgets/people/person_edit_modals_refresh_test.dart
git commit -m "test(mobile): pin people-list refresh behavior of the person edit modals"
```

### Task 3: Characterization — picker retry refetch

**Files:**

- Modify: `mobile/test/presentation/pages/photos_filter/person_picker_test.dart` (append a group; reuse the file's existing `_d` helper and Store `setUpAll`)

- [ ] **Step 1: Append the test (spec 9.3-5, picker half; 9.3-10 already lives in this file + people_picker_provider_test.dart)**

```dart
group('PersonPickerPage retry (characterization)', () {
  testWidgets('the error-state retry button refetches the server people list', (tester) async {
    var fetches = 0;
    await tester.pumpConsumerWidget(
      const PersonPickerPage(),
      overrides: [
        driftGetAllPeopleWithSharedSpacesProvider.overrideWith((ref, sortBy) async {
          fetches++;
          if (fetches == 1) throw Exception('offline');
          return [_d('a', 'Alice')];
        }),
      ],
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('person-picker-retry')), findsOneWidget);

    await tester.tap(find.byKey(const Key('person-picker-retry')));
    await tester.pumpAndSettle();

    expect(fetches, 2);
    expect(find.text('Alice'), findsOneWidget);
  });
});
```

- [ ] **Step 2: Run**

Run: `flutter test test/presentation/pages/photos_filter/person_picker_test.dart`
Expected: PASS (current behavior).

- [ ] **Step 3: Commit**

```bash
git add mobile/test/presentation/pages/photos_filter/person_picker_test.dart
git commit -m "test(mobile): pin the person picker retry refetch"
```

### Task 4: Characterization — offline fallback args + space-editable provider

**Files:**

- Modify: `mobile/test/domain/services/people_service_test.dart` (extend the `getAllPeopleWithSharedSpaces` coverage)
- Create: `mobile/test/providers/infrastructure/space_editable_provider_test.dart`

**Interfaces:**

- Consumes: `DriftPeopleService.getAllPeopleWithSharedSpaces({minFaces, sortBy})`, `driftSpaceEditableProvider`, `sharedSpaceApiRepositoryProvider`, `currentUserProvider` (a `StateNotifierProvider<CurrentUserProvider, UserDto?>` — override with a stub notifier as below).

- [ ] **Step 1: Add the fallback test to `people_service_test.dart` (spec 9.3-9)**

If an equivalent test already exists in the file, strengthen it to these exact-args verifies instead of duplicating:

```dart
group('getAllPeopleWithSharedSpaces offline fallback', () {
  test('falls back to the local list with the caller\'s minFaces and sortBy; fallback people are personal', () async {
    when(() => mockApiRepository.getAllPeopleWithSharedSpaces(sortBy: any(named: 'sortBy')))
        .thenThrow(Exception('offline'));
    when(() => mockRepository.getAllPeople(minFaces: any(named: 'minFaces'), sortBy: any(named: 'sortBy')))
        .thenAnswer((_) async => [person('p1')]);

    final result = await sut.getAllPeopleWithSharedSpaces(minFaces: 5, sortBy: PeopleSortBy.name);

    expect(result.single.id, 'p1');
    expect(result.single.spaceId, isNull); // owner-scoped local list: personal people only
    verify(() => mockRepository.getAllPeople(minFaces: 5, sortBy: PeopleSortBy.name)).called(1);
  });
});
```

- [ ] **Step 2: Write `space_editable_provider_test.dart` (spec 9.3-6, provider level — see Global Constraints deviation (b))**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

class MockUserService extends Mock implements UserService {}

// CurrentUserProvider's real constructor takes a UserService and immediately calls
// tryGetMyUser() + watchMyUser().listen(...) — so a fixed user is injected by
// stubbing the service, not by subclassing the notifier.
CurrentUserProvider _fixedUser(UserDto? user) {
  final service = MockUserService();
  when(() => service.tryGetMyUser()).thenReturn(user);
  when(() => service.watchMyUser()).thenAnswer((_) => const Stream.empty());
  return CurrentUserProvider(service);
}

UserDto _user(String id) => UserDto(id: id, email: 'u@example.com', name: 'U', profileChangedAt: DateTime(2024, 1, 1));

void main() {
  test('resolves the editor role from the shared-space repository', () async {
    final repo = MockSharedSpaceApiRepository();
    when(() => repo.isSpaceEditor('space-1', 'u1')).thenAnswer((_) async => true);
    final container = ProviderContainer(
      overrides: [
        sharedSpaceApiRepositoryProvider.overrideWithValue(repo),
        currentUserProvider.overrideWith((ref) => _fixedUser(_user('u1'))),
      ],
    );
    addTearDown(container.dispose);

    expect(await container.read(driftSpaceEditableProvider('space-1').future), isTrue);

    when(() => repo.isSpaceEditor('space-1', 'u1')).thenAnswer((_) async => false);
    container.invalidate(driftSpaceEditableProvider);
    expect(await container.read(driftSpaceEditableProvider('space-1').future), isFalse);
  });

  test('defaults to editable when no user is resolved', () async {
    final container = ProviderContainer(
      overrides: [
        sharedSpaceApiRepositoryProvider.overrideWithValue(MockSharedSpaceApiRepository()),
        currentUserProvider.overrideWith((ref) => _fixedUser(null)),
      ],
    );
    addTearDown(container.dispose);

    expect(await container.read(driftSpaceEditableProvider('space-1').future), isTrue);
  });
}
```

Note: `UserDto`'s required constructor args may differ — mirror whatever `mobile/lib/domain/models/user.model.dart` requires; the assertions are the contract.

- [ ] **Step 3: Run both files; confirm the standing suites still pin routing/thumbnails/timeline (spec 9.3-2/7/8)**

Run: `flutter test test/domain/services/people_service_test.dart test/providers/infrastructure/space_editable_provider_test.dart test/unit/utils/image_url_builder_test.dart test/providers/infrastructure/person_timeline_provider_test.dart`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add mobile/test
git commit -m "test(mobile): pin offline people fallback args and space-editable resolution"
```

### Task 5: Delete dead person plumbing

**Files:**

- Delete: `mobile/lib/services/person.service.dart`
- Modify: `mobile/lib/repositories/person_api.repository.dart` (remove `getAll()`, `_toPerson`, retype `update` to `Future<void>`)
- Modify: `mobile/test/domain/services/people_service_test.dart` (the `update` stubs stop returning a `PersonDto`)

**Interfaces:**

- Produces: `PersonApiRepository.update(String id, {String? name, DateTime? birthday}) → Future<void>` (Task 12's resolution keeps this shape against upstream's `Future<Person>`).

- [ ] **Step 1: Delete the dead service and repository surface**

Delete `mobile/lib/services/person.service.dart` (zero consumers — verified in the spec §2.4). In `person_api.repository.dart`: delete `getAll()` and `_toPerson`, and change `update` to:

```dart
Future<void> update(String id, {String? name, DateTime? birthday}) async {
  final birthdayUtc = birthday == null ? null : DateTime.utc(birthday.year, birthday.month, birthday.day);
  final dto = PersonUpdateDto(
    name: name == null ? const Optional.absent() : Optional.present(name),
    birthDate: birthdayUtc == null ? const Optional.absent() : Optional.present(birthdayUtc),
  );
  await checkNull(_api.updatePerson(id, dto));
}
```

- [ ] **Step 2: Fix the compile fallout in tests**

In `people_service_test.dart`, stubs like `when(() => mockApiRepository.update(...)).thenAnswer((_) async => const PersonDto(...))` become `.thenAnswer((_) async {})`. In `person_api_repository_test.dart`, delete tests of `getAll()` if any exist; keep `update` tests asserting the outgoing `PersonUpdateDto` (drop return-value assertions).

- [ ] **Step 3: Run the gates**

Run: `flutter test && dart analyze --fatal-infos lib test`
Expected: PASS / no issues. `grep -rn "PersonService\|personServiceProvider" lib test` → 0 hits.

- [ ] **Step 4: Commit**

```bash
git add -A mobile
git commit -m "refactor(mobile): drop the unused PersonService and person getAll/update mapping"
```

### Task 6: `FilterPerson` model (TDD)

**Files:**

- Create: `mobile/test/models/photos_filter/filter_person_model_test.dart`
- Create: `mobile/lib/models/photos_filter/filter_person.model.dart` (+ generated `.freezed.dart`)

**Interfaces:**

- Produces: `FilterPerson({required String id, required String name, DateTime? birthDate, DateTime? updatedAt, int? numberOfAssets, String? spaceId})` — freezed value type; `id` is ALWAYS the tokenized filter id. Tasks 7+ depend on this exact shape.

- [ ] **Step 1: Write the failing test**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/models/photos_filter/filter_person.model.dart';

void main() {
  test('value equality dedupes the same token across surfaces (spec 9.2-A set semantics)', () {
    // The picker and the suggestion strips construct FilterPerson independently; the
    // SearchFilter people set must treat the same token as one selection.
    const fromPicker = FilterPerson(id: 'space-person:sp1', name: 'Zoe', spaceId: 'space-1');
    const fromStrip = FilterPerson(id: 'space-person:sp1', name: 'Zoe', spaceId: 'space-1');
    expect({fromPicker, fromStrip}, hasLength(1));
  });

  test('numberOfAssets and updatedAt are optional (offline/local sources leave them null)', () {
    const p = FilterPerson(id: 'person:p1', name: 'Alice');
    expect(p.numberOfAssets, isNull);
    expect(p.updatedAt, isNull);
    expect(p.spaceId, isNull);
  });

  test('numberOfAssets carries through when present (ports person_dto_number_of_assets_test)', () {
    const p = FilterPerson(id: 'person:p1', name: 'Alice', numberOfAssets: 42);
    expect(p.numberOfAssets, 42);
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/models/photos_filter/filter_person_model_test.dart`
Expected: FAIL — `filter_person.model.dart` does not exist.

- [ ] **Step 3: Implement the model**

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'filter_person.model.freezed.dart';

/// Photos-filter view of a person. [id] is the TOKENIZED filter id
/// (`person:<uuid>` / `space-person:<uuid>`) — the server's filterId format —
/// never a raw profile id. Deliberately distinct from the domain person model:
/// the two id value-spaces fail silently when confused (the owner thumbnail
/// endpoint 404s a token; a personIds search matches nothing on a raw
/// space-person id).
///
/// [spaceId] carries the Space scope so avatars route to the membership-gated
/// space thumbnail endpoint (getFilterPersonThumbnailUrl). [numberOfAssets]
/// feeds the picker row's photo count; null (offline/local fallback) hides it.
@freezed
abstract class FilterPerson with _$FilterPerson {
  const factory FilterPerson({
    required String id,
    required String name,
    DateTime? birthDate,
    DateTime? updatedAt,
    int? numberOfAssets,
    String? spaceId,
  }) = _FilterPerson;
}
```

Run: `dart run build_runner build --delete-conflicting-outputs`

- [ ] **Step 4: Run to verify it passes**

Run: `flutter test test/models/photos_filter/filter_person_model_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit (model + generated file)**

```bash
git add mobile/lib/models/photos_filter/ mobile/test/models/photos_filter/
git commit -m "feat(mobile): add the FilterPerson photos-filter view model"
```

### Task 7: Retype the photos-filter surface onto `FilterPerson`

**Files (complete list — every remaining `PersonDto` reference):**

- Modify (lib): `mobile/lib/providers/photos_filter/people_picker.provider.dart`, `mobile/lib/providers/photos_filter/photos_filter.provider.dart`, `mobile/lib/models/search/search_filter.model.dart`, `mobile/lib/presentation/pages/photos_filter/person_picker.page.dart`, `mobile/lib/presentation/pages/photos_filter/widgets/person_picker_list.widget.dart`, `mobile/lib/presentation/pages/photos_filter/widgets/recent_people_strip.widget.dart`, `mobile/lib/presentation/pages/photos_filter/widgets/selected_people_strip.widget.dart`, `mobile/lib/presentation/widgets/filter_sheet/strips/people_strip.widget.dart`, `mobile/lib/presentation/widgets/filter_sheet/deep/people_section.widget.dart`, `mobile/lib/utils/image_url_builder.dart` (doc comments only), `mobile/lib/domain/models/person.model.dart` (delete `PersonDto`)
- Modify (tests): `mobile/test/models/search/search_filter_equality_test.dart`, `mobile/test/presentation/pages/photos_filter/person_picker_test.dart`, the 3 tests under `mobile/test/presentation/pages/photos_filter/widgets/`, the 5 filter-sheet tests (`active_filter_chip_test`, `deep_content_test`, `deep_flow_test`, `deep/people_section_test`, `strips/strips_test`), `mobile/test/providers/photos_filter/{active_chips_test,people_picker_provider_test,photos_filter_provider_test}.dart`, `mobile/test/unit/utils/image_url_builder_test.dart`
- Delete: `mobile/test/domain/models/person_dto_number_of_assets_test.dart` (ported in Task 6 step 1)

- [ ] **Step 1: Update the provider-test expectations first (red)**

In `people_picker_provider_test.dart`: retype the `_p` helper and every `PersonDto(` construction to `FilterPerson(` (import `models/photos_filter/filter_person.model.dart`), dropping `isHidden:` / `thumbnailPath:` args. Delete the test asserting hidden people are filtered by the picker provider, replacing it with this comment at the group head: `// Hidden people never reach this provider: the server list uses withHidden:false and the local fallback filters isHidden in SQL (see people.repository.dart).` Also add the §9.2-A recent-strip edge (Phase 2 makes `updatedAt` genuinely nullable; this pins the handling now):

```dart
test('a stale updatedAt is not "recent"', () async {
  // Pins the Recent-strip cutoff. (DriftPerson.updatedAt is still non-nullable in
  // Phase 1; Task 14 extends this with a true updatedAt:null person once the
  // unified model makes it constructible.)
  final c = _containerWith([
    _d('p1', 'Alice'), // helper's fixed 2024 date — stale
  ]);
  addTearDown(c.dispose);
  expect(await c.read(recentPeopleProvider.future), isEmpty);
});
```

Run the file — Expected: FAIL (provider still returns `PersonDto`).

- [ ] **Step 2: Retype the mapping (worked example — the pattern for every lib file)**

`people_picker.provider.dart` — `_toPersonDto` becomes:

```dart
FilterPerson _toFilterPerson(DriftPerson p) => FilterPerson(
  id: p.spaceId == null ? 'person:${p.id}' : 'space-person:${p.id}',
  name: p.name,
  birthDate: p.birthDate,
  updatedAt: p.updatedAt,
  numberOfAssets: p.numberOfAssets,
  spaceId: p.spaceId,
);
```

and `peoplePickerAllProvider` keeps ONLY the blank-name filter:

```dart
final peoplePickerAllProvider = FutureProvider.autoDispose<List<FilterPerson>>((ref) async {
  final all = await ref.watch(driftGetAllPeopleWithSharedSpacesProvider(PeopleSortBy.photoCount).future);
  // Hidden people never appear here: the server list is withHidden:false and the
  // local fallback filters isHidden in SQL.
  return all.where((p) => p.name.isNotEmpty).map(_toFilterPerson).toList();
});
```

- [ ] **Step 3: Sweep the remaining files**

In every file listed above: replace the `PersonDto` type/import with `FilterPerson` / `package:immich_mobile/models/photos_filter/filter_person.model.dart`, and delete `isHidden:` / `thumbnailPath:` arguments at construction sites (e.g. the strips' `PersonDto(id: person.id, name: person.name, isHidden: false, thumbnailPath: '')` becomes `FilterPerson(id: person.id, name: person.name)`). In `search_filter.model.dart`: `Set<PersonDto> people` → `Set<FilterPerson> people` (declaration, constructor, `copyWith`). Finally delete the `PersonDto` class (and its freezed parts) from `person.model.dart` and rerun `dart run build_runner build --delete-conflicting-outputs`. Compile-drive to zero: `dart analyze --fatal-infos lib test` must report no `PersonDto` references.

- [ ] **Step 4: Run the full suite + gates**

Run: `flutter test && dart analyze --fatal-infos lib test && grep -rn "PersonDto" lib test --include='*.dart' | grep -v freezed`
Expected: tests PASS, analyze clean, grep 0 hits.

- [ ] **Step 5: Commit**

```bash
git add -A mobile
git commit -m "refactor(mobile): split the photos-filter person view model into FilterPerson"
```

### Task 8: `invalidateServerPeopleLists` helper (TDD) + collapse the call sites

**Files:**

- Create: `mobile/test/providers/infrastructure/invalidate_server_people_lists_test.dart`
- Modify: `mobile/lib/providers/infrastructure/people.provider.dart` (registry + extension)
- Modify (call sites): `mobile/lib/pages/common/tab_shell.page.dart`, `mobile/lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart`, `mobile/lib/presentation/widgets/people/person_edit_name_modal.widget.dart`, `mobile/lib/presentation/widgets/people/person_edit_birthday_modal.widget.dart`, `mobile/lib/presentation/pages/photos_filter/person_picker.page.dart`

**Interfaces:**

- Produces: `serverPeopleListProviders` (public `List<ProviderOrFamily>`) and `void WidgetRef.invalidateServerPeopleLists()` in `people.provider.dart`. Task 12's resolutions and Phase 4's CLAUDE.md text depend on these exact names.

- [ ] **Step 1: Write the failing test**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

import '../../widget_tester_extensions.dart';

void main() {
  test('the registry names exactly the server-backed people lists (spec 9.2-B contract guard)', () {
    expect(serverPeopleListProviders, [driftGetAllPeopleWithSharedSpacesProvider, driftSpacePeopleProvider]);
  });

  testWidgets('invalidates every server-backed list and leaves the local list alone', (tester) async {
    var withShared = 0, spacePeople = 0, local = 0;
    await tester.pumpConsumerWidget(
      Column(
        children: [
          Consumer(
            builder: (context, ref, _) {
              ref.watch(driftGetAllPeopleWithSharedSpacesProvider(PeopleSortBy.photoCount));
              ref.watch(driftSpacePeopleProvider((spaceId: 's1', sortBy: PeopleSortBy.photoCount)));
              ref.watch(driftGetAllPeopleProvider(PeopleSortBy.photoCount));
              return const SizedBox.shrink();
            },
          ),
          Consumer(
            builder: (context, ref, _) => TextButton(
              key: const Key('invalidate'),
              onPressed: () => ref.invalidateServerPeopleLists(),
              child: const Text('go'),
            ),
          ),
        ],
      ),
      overrides: [
        driftGetAllPeopleWithSharedSpacesProvider.overrideWith((ref, sortBy) async {
          withShared++;
          return <DriftPerson>[];
        }),
        driftSpacePeopleProvider.overrideWith((ref, key) async {
          spacePeople++;
          return <DriftPerson>[];
        }),
        driftGetAllPeopleProvider.overrideWith((ref, sortBy) async {
          local++;
          return <DriftPerson>[];
        }),
      ],
    );
    expect((withShared, spacePeople, local), equals((1, 1, 1)));

    await tester.tap(find.byKey(const Key('invalidate')));
    await tester.pumpAndSettle();

    expect((withShared, spacePeople, local), equals((2, 2, 1)));
  });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `flutter test test/providers/infrastructure/invalidate_server_people_lists_test.dart`
Expected: FAIL — `serverPeopleListProviders` / `invalidateServerPeopleLists` undefined.

- [ ] **Step 3: Implement in `people.provider.dart`**

```dart
/// Every server-backed people list. The local list is (post-reconciliation) a Drift
/// stream and needs no invalidation — but a Drift stream can never observe a
/// server-side edit (space-person edits write nothing locally), so any surface that
/// changes people on the server, and any deliberate refresh gesture, must invalidate
/// these. Register new server-backed people providers HERE, never at call sites —
/// this list existing is what keeps the paired-invalidation trap deleted (see the
/// 2026-08-13 person-model reconciliation spec).
final serverPeopleListProviders = <ProviderOrFamily>[
  driftGetAllPeopleWithSharedSpacesProvider,
  driftSpacePeopleProvider,
];

extension InvalidateServerPeopleLists on WidgetRef {
  void invalidateServerPeopleLists() => serverPeopleListProviders.forEach(invalidate);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `flutter test test/providers/infrastructure/invalidate_server_people_lists_test.dart`
Expected: PASS.

- [ ] **Step 5: Collapse the five call sites**

Each site keeps its `ref.invalidate(driftGetAllPeopleProvider);` line (Phase 2 deletes it — NOT now) and replaces its server-provider invalidations with the helper. Post-#980 shapes:

`tab_shell.page.dart` and `gallery_bottom_nav.widget.dart` (Library branch):

```dart
ref.invalidate(localAlbumProvider);
ref.invalidate(driftGetAllPeopleProvider);
ref.invalidateServerPeopleLists();
```

Both modals (success branch):

```dart
if (result != 0) {
  ref.invalidate(driftGetAllPeopleProvider);
  ref.invalidateServerPeopleLists();
  context.pop<...>(...);
}
```

`person_picker.page.dart` retry button: `onPressed: () => ref.invalidateServerPeopleLists(),`

- [ ] **Step 6: Verify the characterization suite survived the refactor + no stray direct invalidations remain**

Run: `flutter test test/presentation/widgets/people/person_edit_modals_refresh_test.dart test/presentation/pages/photos_filter/person_picker_test.dart && grep -rn "invalidate(driftGetAllPeopleWithSharedSpacesProvider\|invalidate(driftSpacePeopleProvider" lib`
Expected: tests PASS; grep 0 hits (the only invalidations live inside the helper).

- [ ] **Step 7: Commit**

```bash
git add -A mobile
git commit -m "refactor(mobile): route server people-list invalidation through one helper"
```

### Task 9: Phase 1 gates + PR

- [ ] **Step 1: Full gates**

Run from `mobile/`: `flutter test && dart analyze --fatal-infos lib test && dart format --output=none --set-exit-if-changed lib`
Expected: all clean. (No server/web/docs files changed — mobile-only phase.)

- [ ] **Step 2: Commit the spec and this plan (they ride in this PR — no other commit adds them)**

```bash
git add docs/superpowers/specs/2026-08-13-mobile-person-model-reconciliation-design.md docs/superpowers/plans/2026-08-13-mobile-person-model-reconciliation.md
git commit -m "docs: person-model reconciliation spec and implementation plan"
```

- [ ] **Step 3: Push, open the PR, set the changelog label immediately**

```bash
git push -u origin feat/mobile-person-model-prep
gh-axi pr create --title "refactor(mobile): person-model prep for the upstream unification" --body "Phase 1 of docs/superpowers/specs/2026-08-13-mobile-person-model-reconciliation-design.md: characterization tests for the people-refresh contract, dead person plumbing removed, FilterPerson split out of the domain model, server people-list invalidation centralized. Behavior-preserving by construction."
```

Then set the changelog label on the PR right away.

- [ ] **Step 4: Babysit CI to green; merge**

Watch the PR checks; fix reds; merge via the normal squash flow. Task 10 must not start until this is on `main`.

---

## Phase 2 — rolling worktree: release the quarantine

All remaining tasks run in `/Users/pierre/dev/gallery/.worktrees/rebase-upstream-rolling-v3.1.1`. This is the standing rolling-rebase flow (see the `rolling-upstream-rebase` memory and `upstream-preflight/rolling-state.json`); this plan supplies the resolutions, not the flow mechanics. Resolve **per commit** — never from the end state.

### Task 10: Fork-sync `main` into the rolling branch

- [ ] **Step 1: Sync the new `main` commits** (#980 + the Phase 1 PR) onto the rolling branch per the standing fork-sync procedure. Expected conflicts: `mobile/openapi/**` paths if any (keep the rolling branch's deletion — the directory is de-committed there) and none in mobile lib code (Phase 1 touched only fork-shaped lines).
- [ ] **Step 2: Regenerate + test**: from the worktree, `mise //mobile:codegen`, then `flutter test` from `mobile/`. Expected: green, including all Task 2–8 tests.
- [ ] **Step 3: Update `rolling-state.json`'s fork-sync cursor per the standing flow; commit per the flow's convention.**

### Task 11: Take `52edcc0c74c` (unify person model)

- [ ] **Step 1: Begin the rebase advance** onto `52edcc0c74c` per the rolling flow (it is the next upstream commit past the quarantine boundary `943c11c0196`).

- [ ] **Step 2: Resolve `mobile/lib/domain/models/person.model.dart` to exactly:**

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'person.model.freezed.dart';

@freezed
abstract class Person with _$Person {
  const factory Person({
    required String id,
    required String name,
    DateTime? updatedAt,
    DateTime? birthDate,

    /// Non-null when this person is a Space-scoped identity resolved from the server
    /// (the People-page shared-space list, or a space person on a shared asset).
    /// Personal/owned people are always null. Edits to a Space person must route
    /// through the editor-gated shared-space endpoint, never the owner-only person
    /// endpoint, and its thumbnail through the membership-gated space endpoint.
    String? spaceId,

    /// Photo count sourced from the shared-spaces server list
    /// (PersonResponseDto.numberOfAssets). Null when unavailable — the owner-scoped
    /// local Drift query and the offline fallback never populate it.
    int? numberOfAssets,

    /// Favorite flag from the server list; drives the "favorites first" tier of
    /// comparePeople (utils/people_sort.dart). The local Drift query orders
    /// favorites in SQL and maps this through for parity.
    @Default(false) bool isFavorite,
  }) = _Person;
}

enum PeopleSortBy { photoCount, name }
```

- [ ] **Step 3: Resolve the remaining conflicts of this commit:**

- `search_filter.model.dart`: **keep the fork side** (`Set<FilterPerson>` from Phase 1). Upstream's `Set<Person>` retype is superseded, not dropped.
- `people.repository.dart` `toDto()`: take upstream's compact shape plus the favorite flag: `Person toDto() => Person(id: id, updatedAt: updatedAt, name: name, birthDate: birthDate, isFavorite: isFavorite);`
- `person_api.repository.dart`: keep the fork's structure. Rename `_personToDriftPerson` → `_toPerson` and `_toDriftPerson` → `_toAssetPerson`; both now build `Person` (drop `createdAt`/`ownerId`/`isHidden`/`color` args; keep `spaceId`/`numberOfAssets`/`isFavorite`; `updatedAt: dto.updatedAt.orElse(null)` — the epoch-0 sentinel is deleted). The `getAssetPeople` pre-mapping `.where((person) => !person.isHidden)` on the response DTO **stays**.
- Retype-only fork files (`drift_person.page.dart`, `person_sliver_app_bar.dart`, `people_details.widget.dart`, both edit modals, `people.utils.dart`, `people.provider.dart`'s `driftPeopleAssetProvider` and the other fork providers, #980's `people_grid.widget.dart` / `space_people.page.dart` / `shared_space_api.repository.dart` / `utils/people_sort.dart`): apply `DriftPerson` → `Person` onto the fork's versions; fork behavior (editable gating, spaceId routing, `({String id, String ownerId})` record key, `({String spaceId, PeopleSortBy sortBy})` key) is untouched.
- `drift_search.page.dart`, `widgets/search/search_filter/people_picker.dart`, `providers/search/people.provider.dart`, `services/person.service.dart`: absent in the fork — honour the deletions.

- [ ] **Step 4: Continue the rebase; record the resolution in the cycle notes.** (Compile/test comes at Task 14 — the suite cannot be green mid-flip; do run `dart analyze lib` here to catch gross breakage early, expecting only errors that commits 2–3 resolve, e.g. the still-`Future` provider.)

### Task 12: Take `303a9f15b1a` (reactive provider) — THE TRAP LIVES HERE

- [ ] **Step 1: Resolve `people.repository.dart`** — extract the shared query and give it both a stream and a future form, keeping the fork's SQL ordering:

```dart
JoinedSelectStatement _allPeopleQuery({required int minFaces, required PeopleSortBy sortBy}) {
  final people = _db.personEntity;
  final faces = _db.assetFaceEntity;
  final assets = _db.remoteAssetEntity;

  final favoritesFirst = OrderingTerm(expression: people.isFavorite, mode: OrderingMode.desc);
  // BTRIM semantics: whitespace-only names belong to the unnamed tier.
  final namedFirst = OrderingTerm(expression: people.name.trim().equals('').not(), mode: OrderingMode.desc);
  final byFaceCount = OrderingTerm(expression: faces.id.count(), mode: OrderingMode.desc);
  final byName = OrderingTerm(expression: people.name.trim().lower());
  final byId = OrderingTerm(expression: people.id);

  return _db.select(people).join([
      innerJoin(faces, faces.personId.equalsExp(people.id)),
      innerJoin(assets, assets.id.equalsExp(faces.assetId)),
    ])
    ..where(
      people.isHidden.equals(false) &
          assets.deletedAt.isNull() &
          assets.visibility.equalsValue(AssetVisibility.timeline) &
          faces.isVisible.equals(true) &
          faces.deletedAt.isNull(),
    )
    ..groupBy([people.id], having: faces.id.count().isBiggerOrEqualValue(minFaces) | people.name.equals('').not())
    ..orderBy(switch (sortBy) {
      PeopleSortBy.photoCount => [favoritesFirst, namedFirst, byFaceCount, byName, byId],
      PeopleSortBy.name => [favoritesFirst, namedFirst, byName, byFaceCount, byId],
    });
}

Stream<List<Person>> watch({int minFaces = 3, PeopleSortBy sortBy = PeopleSortBy.photoCount}) {
  final people = _db.personEntity;
  return _allPeopleQuery(minFaces: minFaces, sortBy: sortBy)
      .map((row) => row.readTable(people).toDto())
      .watch();
}

/// Kept alongside [watch] as the offline-fallback path of
/// getAllPeopleWithSharedSpaces — a one-shot read has no business being a stream.
Future<List<Person>> getAllPeople({int minFaces = 3, PeopleSortBy sortBy = PeopleSortBy.photoCount}) {
  final people = _db.personEntity;
  return _allPeopleQuery(minFaces: minFaces, sortBy: sortBy)
      .map((row) => row.readTable(people).toDto())
      .get();
}
```

- [ ] **Step 2: Resolve `people.service.dart`** — add `watch`, keep `getAllPeople`, take the spelling fix onto the fork signature:

```dart
Stream<List<Person>> watch({int minFaces = 3, PeopleSortBy sortBy = PeopleSortBy.photoCount}) {
  return _repository.watch(minFaces: minFaces, sortBy: sortBy);
}
```

and rename `updateBrithday` → `updateBirthday` (body unchanged — it still takes the `Person` and routes on `spaceId`).

- [ ] **Step 3: Resolve `people.provider.dart`** — the local provider becomes a stream, keeping the family:

```dart
final driftGetAllPeopleProvider = StreamProvider.family<List<Person>, PeopleSortBy>((ref, sortBy) async* {
  final service = ref.watch(driftPeopleServiceProvider);
  final prefs = await ref.watch(userMetadataPreferencesProvider.future);
  yield* service.watch(minFaces: prefs?.minimumFaces ?? 3, sortBy: sortBy);
});
```

(The rename to `getAllPeopleProvider` happens in Task 13 with upstream's commit, not here.)

- [ ] **Step 4: Resolve the invalidation sites — the trap.** Upstream deletes the whole invalidation block plus restructures the modals. The correct resolution takes upstream's deletion ONLY for the `driftGetAllPeopleProvider` line and upstream's `result != 0 && mounted` shape, and KEEPS the helper call. Final shapes:

Both modals:

```dart
if (result != 0 && mounted) {
  ref.invalidateServerPeopleLists();
  context.pop<String>(newName); // birthday modal: context.pop<DateTime>(_selectedDate);
}
```

`tab_shell.page.dart` Library branch (upstream also deletes the people-provider import — keep it, the helper needs it):

```dart
ref.invalidate(localAlbumProvider);
ref.invalidateServerPeopleLists();
```

`gallery_bottom_nav.widget.dart` (fork-only file, no conflict — edit to match): same two-line shape. `person_picker.page.dart`: unchanged (already helper-only).

A resolution that leaves any of these five sites without `ref.invalidateServerPeopleLists()` breaks the Task 2/3 tests at Task 14 — that is those tests doing their job; fix the site, not the test.

- [ ] **Step 5: Continue the rebase; record the resolution.**

### Task 13: Take `1c3a5cf5087` (remove old provider)

- [ ] **Step 1: Take the rename** `driftGetAllPeopleProvider` → `getAllPeopleProvider` in `people.provider.dart` and its two consumers (`drift_library.page.dart`, `drift_people_collection.page.dart` — both fork-diverged; apply the rename onto the fork versions).
- [ ] **Step 2: Deletions are no-ops** — `providers/search/people.provider.dart`, `services/person.service.dart`, `widgets/search/search_filter/people_picker.dart` are already absent (fork #654 / Phase 1). Verify: `git status` shows no resurrection of these paths.
- [ ] **Step 3: Continue; record. Then advance through the held-safe commits 6–10** (`2a1691868e7`, `ff5da0f84fc`, `db9e7c20d71`, `b82d4805525`, `a939561e70f`) per the normal rolling flow — they were held only by linearity; apply standing detectors as usual.

### Task 14: Adaptation commit — codegen + mechanical retypes, suite back to green

**Files:** `mobile/lib/**` compile fallout, all 27 test files (spec §9.4 list + #980's six), regenerated `person.model.freezed.dart`.

- [ ] **Step 1: Regenerate** — from the worktree: `mise //mobile:codegen` (includes build_runner for freezed).

- [ ] **Step 2: Mechanical test retypes.** In every test file from spec §9.4 plus #980's: `DriftPerson(` → `Person(`, dropping `createdAt:`/`ownerId:`/`isHidden:`/`color:` args (keep `isFavorite:` where a test needs it — it now defaults to false). Worked example, the `people_service_test.dart` helper:

```dart
Person person(String id, {String? spaceId}) => Person(id: id, updatedAt: DateTime(2020), name: 'Alice', spaceId: spaceId);
```

Rename the `updateBrithday routing` group and calls to `updateBirthday` (assertions carry over verbatim). Provider overrides for the now-stream local provider change shape where they exist: `driftGetAllPeopleProvider.overrideWith((ref, sortBy) async => [...])` → `getAllPeopleProvider.overrideWith((ref, sortBy) => Stream.value([...]))` — including the local-list counter in `invalidate_server_people_lists_test.dart` (a `Stream.value` override with a counter in the closure body counts subscriptions the same way). `driftGetAllPeopleWithSharedSpacesProvider` overrides keep their `(ref, sortBy) async =>` shape — element type only. Also extend the Task 7 recent-strip test with a true `updatedAt: null` person (now constructible on the unified model): map it through `_containerWith([Person(id: 'p0', name: 'NoDate')])`-style input and assert it is absent from `recentPeopleProvider` (spec 9.2-A updatedAt-null edge).

- [ ] **Step 3: Compile-drive to zero and run everything**

Run: `dart analyze --fatal-infos lib test` then `flutter test`
Expected: analyze clean; ALL tests pass — including the Task 2/3/4/8 suites, unmodified except retypes. Any refresh-test failure means a Task 12 site resolution is wrong.

- [ ] **Step 4: Commit** (rolling-branch adaptation commit, same pattern as `70d4533fc3a`):

```bash
git add -A mobile
git commit -m "fix(mobile): adapt fork people surfaces and tests to the unified person model"
```

### Task 15: New-behavior tests (TDD, on the adaptation branch state)

**Files:**

- Create: `mobile/test/infrastructure/repositories/people_repository_test.dart`
- Create: `mobile/test/providers/infrastructure/people_provider_stream_test.dart`
- Modify: `mobile/test/repositories/person_api_repository_test.dart` (edge cases)

- [ ] **Step 1: Repository `watch()` tests (spec §9.2-C) — write, run (some will pass immediately post-implementation; the re-emission tests are the genuinely new coverage):**

```dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/people.repository.dart';
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.dart' show AssetVisibility; // adjust import to wherever AssetVisibility lives

void main() {
  late Drift db;
  late DriftPeopleRepository sut;
  var seq = 0;

  setUp(() async {
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    sut = DriftPeopleRepository(db);
    await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: 'owner', name: 'Owner', email: 'o@example.com'));
  });
  tearDown(() => db.close());

  Future<void> seedPerson(String id, {String name = '', bool isFavorite = false, bool isHidden = false}) =>
      db.into(db.personEntity).insert(
        PersonEntityCompanion.insert(id: id, ownerId: 'owner', name: name, isFavorite: isFavorite, isHidden: isHidden, color: const drift.Value(null)),
      );

  // One asset + one visible face per call. Companion required args follow the entity
  // definitions (remote_asset needs name/type from AssetEntityMixin) — mirror them.
  Future<void> seedFace(String personId) async {
    final id = 'seed-${seq++}';
    await db.into(db.remoteAssetEntity).insert(
      RemoteAssetEntityCompanion.insert(
        id: 'asset-$id', checksum: 'c-$id', ownerId: 'owner', name: 'a.jpg',
        type: AssetType.image, visibility: AssetVisibility.timeline,
      ),
    );
    await db.into(db.assetFaceEntity).insert(
      AssetFaceEntityCompanion.insert(
        id: 'face-$id', assetId: 'asset-$id', personId: drift.Value(personId),
        imageWidth: 100, imageHeight: 100,
        boundingBoxX1: 0, boundingBoxY1: 0, boundingBoxX2: 10, boundingBoxY2: 10,
        sourceType: 'machine-learning',
      ),
    );
  }

  Future<void> seedFaces(String personId, int count) async {
    for (var i = 0; i < count; i++) {
      await seedFace(personId);
    }
  }

  test('an unnamed person below minFaces is excluded; at minFaces included', () async {
    await seedPerson('below'); await seedFaces('below', 2);
    await seedPerson('at'); await seedFaces('at', 3);
    final result = await sut.getAllPeople(minFaces: 3);
    expect(result.map((p) => p.id), ['at']);
  });

  test('a named person is included regardless of face count (the having OR-clause)', () async {
    await seedPerson('named', name: 'Alice'); await seedFaces('named', 1);
    final result = await sut.getAllPeople(minFaces: 3);
    expect(result.single.id, 'named');
  });

  test('watch re-emits when a person is renamed', () async {
    await seedPerson('p1', name: 'Alice'); await seedFaces('p1', 1);
    // Deterministic, not timing-based (no-flake rule): drift schedules the initial
    // emission on listen, so drain the event queue and assert the settled state
    // BEFORE mutating — attaching matchers concurrently with the write races the
    // initial query and can coalesce the two emissions.
    final emissions = <List<String>>[];
    final sub = sut
        .watch(minFaces: 3, sortBy: PeopleSortBy.photoCount)
        .listen((people) => emissions.add(people.map((p) => p.name).toList()));
    await pumpEventQueue();
    expect(emissions.last, ['Alice']);

    await sut.updateName('p1', 'Alicia');
    await pumpEventQueue();

    expect(emissions.last, ['Alicia']);
    await sub.cancel();
  });

  test('two sortBy family members order independently (spec 9.2-C family isolation)', () async {
    await seedPerson('b-many', name: 'Bob'); await seedFaces('b-many', 5);
    await seedPerson('a-few', name: 'Ann'); await seedFaces('a-few', 3);
    expect((await sut.watch(minFaces: 3, sortBy: PeopleSortBy.photoCount).first).map((p) => p.id), ['b-many', 'a-few']);
    expect((await sut.watch(minFaces: 3, sortBy: PeopleSortBy.name).first).map((p) => p.id), ['a-few', 'b-many']);
  });

  test('watch re-emits when a face link crosses the minFaces threshold', () async {
    await seedPerson('p1'); await seedFaces('p1', 2); // unnamed, below threshold
    final emissions = <List<String>>[];
    final sub = sut
        .watch(minFaces: 3, sortBy: PeopleSortBy.photoCount)
        .listen((people) => emissions.add(people.map((p) => p.id).toList()));
    await pumpEventQueue();
    expect(emissions.last, isEmpty);

    await seedFace('p1'); // third face — now at threshold
    await pumpEventQueue();

    expect(emissions.last, ['p1']);
    await sub.cancel();
  });

  test('sort orders favorites first, named before unnamed, count desc, id tiebreak', () async {
    await seedPerson('unnamed-many'); await seedFaces('unnamed-many', 5);
    await seedPerson('named-few', name: 'Zoe'); await seedFaces('named-few', 3);
    await seedPerson('fav', name: 'Ann', isFavorite: true); await seedFaces('fav', 3);
    final byCount = await sut.getAllPeople(minFaces: 3, sortBy: PeopleSortBy.photoCount);
    expect(byCount.map((p) => p.id), ['fav', 'named-few', 'unnamed-many']);
  });

  test('getAllPeople equals the first watch emission', () async {
    await seedPerson('p1', name: 'Alice'); await seedFaces('p1', 3);
    expect(await sut.getAllPeople(minFaces: 3), await sut.watch(minFaces: 3).first);
  });

  test('a hidden person is never emitted', () async {
    await seedPerson('h', name: 'Hidden', isHidden: true); await seedFaces('h', 5);
    expect(await sut.getAllPeople(minFaces: 3), isEmpty);
  });
}
```

Fix the `watch re-emits when a person is renamed` test to the structure shown in its NOTE comment (listen-then-mutate); the inline sketch documents the required event order. Adjust companion arguments (`AssetType`, imports) to the actual entity definitions — the assertions are the contract.

- [ ] **Step 2: Provider stream tests (spec §9.2-D) — `people_provider_stream_test.dart`:**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

void main() {
  test('the documented Stream.value override shape works (spec 9.2-D ergonomics)', () async {
    final container = ProviderContainer(
      overrides: [
        getAllPeopleProvider.overrideWith((ref, sortBy) => Stream.value(const [Person(id: 'p1', name: 'Alice')])),
      ],
    );
    addTearDown(container.dispose);
    expect((await container.read(getAllPeopleProvider(PeopleSortBy.photoCount).future)).single.id, 'p1');
  });

  test('emits loading first, then data', () async {
    final container = ProviderContainer(
      overrides: [
        getAllPeopleProvider.overrideWith((ref, sortBy) => Stream.value(const <Person>[])),
      ],
    );
    addTearDown(container.dispose);
    expect(container.read(getAllPeopleProvider(PeopleSortBy.photoCount)), isA<AsyncLoading<List<Person>>>());
    await container.read(getAllPeopleProvider(PeopleSortBy.photoCount).future);
    expect(container.read(getAllPeopleProvider(PeopleSortBy.photoCount)).hasValue, isTrue);
  });

  test('watch is called with the minimumFaces preference (spec 9.2-D prefs)', () async {
    // Mock the service; real prefs value via override. Verifies the provider threads
    // the preference into watch() — the rebuild-on-change follows from ref.watch.
    // Requires setUpAll(() => registerFallbackValue(PeopleSortBy.photoCount)); the
    // prefs type is Preferences from domain/models/user_metadata.model.dart.
    final service = MockDriftPeopleService();
    when(() => service.watch(minFaces: any(named: 'minFaces'), sortBy: any(named: 'sortBy')))
        .thenAnswer((_) => Stream.value(const <Person>[]));
    final container = ProviderContainer(
      overrides: [
        driftPeopleServiceProvider.overrideWithValue(service),
        userMetadataPreferencesProvider.overrideWith((ref) async => const Preferences(minimumFaces: 7)),
      ],
    );
    addTearDown(container.dispose);

    await container.read(getAllPeopleProvider(PeopleSortBy.name).future);

    verify(() => service.watch(minFaces: 7, sortBy: PeopleSortBy.name)).called(1);
  });

  test('library-card live update: a local rename re-emits without any invalidation (spec 9.3-11)', () async {
    // Real repo + real service on an in-memory Drift DB; only the drift instance and
    // the prefs are overridden. A named person with one face is admitted by the
    // named OR-clause; the rename must arrive with no invalidate() anywhere.
    final db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    addTearDown(db.close);
    await db.into(db.userEntity).insert(UserEntityCompanion.insert(id: 'owner', name: 'Owner', email: 'o@example.com'));
    await db.into(db.personEntity).insert(
      PersonEntityCompanion.insert(id: 'p1', ownerId: 'owner', name: 'Alice', isFavorite: false, isHidden: false, color: const drift.Value(null)),
    );
    await db.into(db.remoteAssetEntity).insert(
      RemoteAssetEntityCompanion.insert(id: 'a1', checksum: 'c1', ownerId: 'owner', name: 'a.jpg', type: AssetType.image, visibility: AssetVisibility.timeline),
    );
    await db.into(db.assetFaceEntity).insert(
      AssetFaceEntityCompanion.insert(id: 'f1', assetId: 'a1', personId: const drift.Value('p1'), imageWidth: 100, imageHeight: 100, boundingBoxX1: 0, boundingBoxY1: 0, boundingBoxX2: 10, boundingBoxY2: 10, sourceType: 'machine-learning'),
    );
    final container = ProviderContainer(
      overrides: [
        driftProvider.overrideWithValue(db),
        userMetadataPreferencesProvider.overrideWith((ref) async => null),
      ],
    );
    addTearDown(container.dispose);
    final names = <String>[];
    container.listen(getAllPeopleProvider(PeopleSortBy.photoCount), (_, next) {
      final value = next.valueOrNull;
      if (value != null && value.isNotEmpty) names.add(value.single.name);
    }, fireImmediately: true);
    await container.read(getAllPeopleProvider(PeopleSortBy.photoCount).future);

    await DriftPeopleRepository(db).updateName('p1', 'Alicia');
    await pumpEventQueue(); // deterministic drain, not a sleep (no-flake rule)

    expect(names.last, 'Alicia');
  });
}
```

Imports/shapes to mirror at execution: `MockDriftPeopleService` as in Task 2's file plus `setUpAll(() => registerFallbackValue(PeopleSortBy.photoCount))`; `Preferences` from `domain/models/user_metadata.model.dart`; `driftProvider` from `db.provider.dart`; `pumpEventQueue` is a top-level `flutter_test` helper usable in plain `test()` bodies.

- [ ] **Step 3: Mapper edge tests (spec §9.2-E) — extend `person_api_repository_test.dart` using its existing `MockPeopleApi`/`MockAssetsApi` wiring, `personDto` helper, and its established stubbing shape for `getAllPeople(...)` / `getAssetInfo(...)`:**

```dart
group('unified-person mapping edges', () {
  test('no primaryProfile -> null spaceId', () async {
    stubPeoplePage([personDto('p1', name: 'Alice')]); // follow the file's existing stub helper/shape
    final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.photoCount);
    expect(result.single.spaceId, isNull);
  });

  test('spacePersonId without resolvedSpaceId maps as personal (both-or-neither guard)', () async {
    // Follow the file's existing MockAssetInfo wiring: people carries spacePersonId,
    // but info.resolvedSpaceId is absent.
    stubAssetInfo(people: [personDtoWithSpacePersonId('global-1', spacePersonId: 'sp-1')], resolvedSpaceId: null);
    final result = await repository.getAssetPeople('asset-1');
    expect(result.single.id, 'global-1');
    expect(result.single.spaceId, isNull);
  });

  test('absent updatedAt stays null (epoch-0 sentinel removed)', () async {
    stubPeoplePage([personDto('p1', name: 'Alice')]); // personDto builds absent updatedAt by default
    final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.photoCount);
    expect(result.single.updatedAt, isNull);
  });

  test('absent isFavorite maps to false', () async {
    stubPeoplePage([personDto('p1', name: 'Alice')]);
    final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.photoCount);
    expect(result.single.isFavorite, isFalse);
  });

  test('paging: collects two pages, stops when hasNextPage clears', () async {
    stubPeoplePages({1: (people: [personDto('p1', name: 'A')], hasNext: true), 2: (people: [personDto('p2', name: 'B')], hasNext: false)});
    final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);
    expect(result.map((p) => p.id), containsAll(['p1', 'p2']));
  });

  test('paging: an empty page stops immediately even with hasNextPage set', () async {
    stubPeoplePages({1: (people: <api.PersonResponseDto>[], hasNext: true)});
    final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);
    expect(result, isEmpty);
  });

  test('paging: a server that never clears hasNextPage stops at the page ceiling', () async {
    stubEveryPeoplePage(people: [personDto('p1', name: 'A')], hasNext: true); // any-page stub
    final result = await repository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.name);
    // maxPages = 100 in the repository; the call terminates rather than looping forever.
    expect(result, isNotEmpty);
  });
});
```

`stubPeoplePage` / `stubPeoplePages` / `stubEveryPeoplePage` / `stubAssetInfo` / `personDtoWithSpacePersonId` are thin local helpers to write in the test file over the existing mocks (the file already stubs these APIs inline — extract its exact `when(...)` shapes into these helpers rather than inventing new wiring). The assertions above are the contract.

- [ ] **Step 4: Run everything, then fold into the adaptation commit**

Run: `flutter test && dart analyze --fatal-infos lib test`
Expected: green.

```bash
git add mobile/test
git commit -m "test(mobile): cover the reactive people stream, mapper edges, and live-update"
```

### Task 16: Rolling gates, verification hooks, RC

- [ ] **Step 1: Spec verification greps (spec §8 hooks)**

Run from the worktree's `mobile/`:

```bash
grep -rn "DriftPerson\|PersonDto\|driftGetAllPeopleProvider\|updateBrithday" lib test --include='*.dart' | grep -v freezed
```

Expected: 0 hits.

- [ ] **Step 2: Full local CI set** per the standing cycle table: mobile `flutter test` + `dart analyze --fatal-infos lib test` + `dart format` (lib scope, CI parity); server/web suites only if commits 6–10 touched them (`a939561e70f` touches server/web — run `pnpm check`/`pnpm test` for server and web per the standing gates); `make mobile-drift-rebase-check`; `make fork-ownership-coverage-check`; `make upstream-postrebase-audit`.
- [ ] **Step 3: Remote CI**: push the test branch, dispatch the full CI set per the `ci-full-set-dispatch` memory (staggered).
- [ ] **Step 4: Stage an RC** to staging and validate the People surfaces manually before any force-push of the rolling branch (standing rule): People page rename/birthday for a personal and a space person refresh visibly; space-person thumbnails render; library card updates after a sync.
- [ ] **Step 5: Update `rolling-state.json`** (clear the quarantine per the flow's convention, advance cursors) and write the cycle's upstream report addendum documenting the reconciliation resolutions.

### Task 17: Phase 4 — docs and memory

**Files:**

- Modify: `CLAUDE.md` (mobile section — the file is a symlink to `AGENTS.md`; edit the target) in BOTH the main checkout (via a follow-up `main` PR after the rolling branch lands) and the rolling worktree copy
- Modify: memory files naming the old symbols

- [ ] **Step 1: Update the CLAUDE.md mobile-people contract**: `DriftPerson` → `Person` (noting the three fork fields on the unified model), `driftGetAllPeopleProvider` → `getAllPeopleProvider` (now a reactive `StreamProvider.family` — the local list needs no invalidation), `updateBrithday` → `updateBirthday`, and replace the "Both providers are invalidated together at the people-list invalidation sites" sentence with the `invalidateServerPeopleLists` contract ("server-backed people lists are invalidated only through `invalidateServerPeopleLists`; register new ones in `serverPeopleListProviders`"). Mention `FilterPerson` as the tokenized-id filter model. Keep every behavioral statement (owner-scoped sync, edit routing, thumbnail routing) — only symbols change.
- [ ] **Step 2: Update memory**: `project_rolling_rebase_v311_cycle.md` (quarantine released, resolutions), and any memory naming `driftGetAllPeopleProvider`/`DriftPerson`/`updateBrithday` (grep the memory directory). Add the reconciliation outcome via the save-memory flow at session end.
- [ ] **Step 3: Prettier the touched markdown**: `npx prettier --write docs/superpowers/plans/2026-08-13-mobile-person-model-reconciliation.md docs/superpowers/specs/2026-08-13-mobile-person-model-reconciliation-design.md` plus any report files (CI Docs Build is strict on `docs/`).
