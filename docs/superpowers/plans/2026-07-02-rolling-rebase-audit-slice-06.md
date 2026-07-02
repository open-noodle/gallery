# Slice 6 — LOW#12: mobile offline shared-space People list honors `minimumFaces`

**Finding:** LOW #12 · `mobile/lib/domain/services/people.service.dart` · **Status target:** FIXED (slice S6)
**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 6 — LOW[12]"

## Problem

`DriftPeopleService.getAllPeopleWithSharedSpaces` (`mobile/lib/domain/services/people.service.dart:69-78`)
has two paths:

- **Online** (line 71): `_personApiRepository.getAllPeopleWithSharedSpaces(sortBy: sortBy)` — hits
  `GET /api/people?withSharedSpaces=true`, which already honors the caller's `people.minimumFaces`
  preference server-side (server-side fix is Slice 5 / M2). Nothing to change here.
- **Offline fallback** (line 76, `catch` block): `_repository.getAllPeople(sortBy: sortBy)` — calls
  the local Drift repository **without** `minFaces`, so it silently uses the repository's own
  default (`3`), ignoring the user's preference regardless of what they set it to.

The sibling **plain** provider already does this correctly —
`mobile/lib/providers/infrastructure/people.provider.dart:46-50`:

```dart
final driftGetAllPeopleProvider = FutureProvider.family<List<DriftPerson>, PeopleSortBy>((ref, sortBy) async {
  final service = ref.watch(driftPeopleServiceProvider);
  final prefs = await ref.watch(userMetadataPreferencesProvider.future);
  return service.getAllPeople(minFaces: prefs?.minimumFaces ?? 3, sortBy: sortBy);
});
```

`DriftPeopleService.getAllPeople` (people.service.dart:39-41) already accepts
`{int minFaces = 3, ...}` and threads it straight into
`DriftPeopleRepository.getAllPeople({int minFaces = 3, ...})`
(`mobile/lib/infrastructure/repositories/people.repository.dart:36`). The shared-space method
just never grew the same parameter.

## Threading shape (confirmed minimal — 2 files)

1. `mobile/lib/domain/services/people.service.dart` — add `int minFaces = 3` to
   `getAllPeopleWithSharedSpaces`'s signature and pass it into the offline
   `_repository.getAllPeople(...)` call. The online call is untouched (server already resolves
   the pref; the API repository method takes no `minFaces` param and must not gain one in this
   slice).
2. `mobile/lib/providers/infrastructure/people.provider.dart` —
   `driftGetAllPeopleWithSharedSpacesProvider` (lines 55-61) reads
   `userMetadataPreferencesProvider` (already imported, used one function up) and passes
   `prefs?.minimumFaces ?? 3` through, mirroring `driftGetAllPeopleProvider` exactly.

No widget/page changes — `drift_people_collection.page.dart:38` calls the provider with only
`sortBy`; the provider itself resolves `minFaces` from preferences, same pattern as the plain
provider. No API-repository or DTO change (server side already fixed in Slice 5; this slice is
mobile-local-only, so no OpenAPI/SDK regen).

## RED tests first — `mobile/test/domain/services/people_service_test.dart`

This file already exists with a `group('getAllPeopleWithSharedSpaces')` (people.service_test.dart:84-116)
covering the online-success and offline-fallback shapes, but its stubs only anticipate the
`sortBy` named argument on `mockRepository.getAllPeople(...)`. Adding `minFaces` to the real call
changes the invocation's named-argument set, so mocktail's argument matcher on the two existing
stubs (`when(() => mockRepository.getAllPeople(sortBy: any(named: 'sortBy')))`) will stop matching
once the implementation passes `minFaces` too — both existing tests must be updated in the same
edit to add `minFaces: any(named: 'minFaces')` to those stubs (collateral, not scope creep: the
signature they exercise is changing).

New tests, appended to the same `group('getAllPeopleWithSharedSpaces')`:

1. **`'threads an explicit minFaces into the offline fallback'`** — stub the API repo to throw;
   stub `mockRepository.getAllPeople(minFaces: any(named: 'minFaces'), sortBy: any(named: 'sortBy'))`
   to return `[person('local-person')]`; call
   `sut.getAllPeopleWithSharedSpaces(minFaces: 5, sortBy: PeopleSortBy.photoCount)`; assert
   `verify(() => mockRepository.getAllPeople(minFaces: 5, sortBy: PeopleSortBy.photoCount)).called(1)`.
2. **`'defaults the offline fallback to minFaces 3 when the caller passes none'`** — same throw
   stub; call `sut.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.photoCount)` (no `minFaces`
   argument); assert
   `verify(() => mockRepository.getAllPeople(minFaces: 3, sortBy: PeopleSortBy.photoCount)).called(1)`.
3. **Regression on the existing online-success test** (line ~89-100): after the stub fix, add an
   assertion that the online path is unaffected by `minFaces` —
   `verify(() => mockApiRepository.getAllPeopleWithSharedSpaces(sortBy: PeopleSortBy.photoCount)).called(1)`
   already exists; additionally assert `mockRepository.getAllPeople` is **never** called
   (`verifyNever`) — proves minFaces threading did not leak into the online path.

Edge cases from the spec, all covered above:

- `prefs.minimumFaces = 5` → offline fallback calls repo with `minFaces: 5` (test 1, via explicit
  service-level argument — the provider-level `prefs?.minimumFaces ?? 3` mapping has no separate
  service test since `DriftPeopleService` has no preferences dependency; the provider is the seam
  that reads prefs, service just threads an int).
- `prefs` null / caller passes nothing → default `3` (test 2).
- Explicit `1` — same code path as test 1 with a different literal; not a separate test since the
  RED/GREEN behavior is identical (parametrize is unnecessary for a single pass-through int).
- Online path unchanged / no regression (test 3).

**Expected RED:** tests 1 and 2 fail — the current offline call is
`_repository.getAllPeople(sortBy: sortBy)` with no `minFaces` argument, so
`verify(() => mockRepository.getAllPeople(minFaces: 5, sortBy: ...))` (and `minFaces: 3`) never
matches any recorded call → `Mocktail` reports 0 invocations against the expected `1`. The two
existing tests (89-100, 104-116) also fail to compile/run correctly against the new stub shape
until the impl adds the argument — but since we edit their stubs to `any(named: 'minFaces')`
*before* the impl, they should still pass RED-safely at the old call (`any` matches an absent-arg
call too? — no: mocktail requires the named-arg key to be present in the invocation to match
`any(named: ...)`). To keep the two existing tests green through the RED step (they test
different behavior, not this slice's target), verify by running the suite before touching
`people.service.dart` — if the stub edit alone regresses them RED, that is a signal our
`any(named:)` addition is premature; the correct sequencing is: edit stubs AND add new tests
first, run once (expect only the 2 new tests to fail — old ones can transiently fail too since the
prod code doesn't pass `minFaces` yet; capture whatever the true RED is), then implement, rerun,
confirm all green.

**Command:** `cd mobile && mise exec -- flutter test test/domain/services/people_service_test.dart`

## Minimal implementation

`mobile/lib/domain/services/people.service.dart`:

```dart
Future<List<DriftPerson>> getAllPeopleWithSharedSpaces({
  int minFaces = 3,
  PeopleSortBy sortBy = PeopleSortBy.photoCount,
}) async {
  try {
    return await _personApiRepository.getAllPeopleWithSharedSpaces(sortBy: sortBy);
  } catch (error, stackTrace) {
    _log.warning("Failed to fetch people from the server; using the local sync DB", error, stackTrace);
    return _repository.getAllPeople(minFaces: minFaces, sortBy: sortBy);
  }
}
```

`mobile/lib/providers/infrastructure/people.provider.dart`:

```dart
final driftGetAllPeopleWithSharedSpacesProvider = FutureProvider.family<List<DriftPerson>, PeopleSortBy>((
  ref,
  sortBy,
) async {
  final service = ref.watch(driftPeopleServiceProvider);
  final prefs = await ref.watch(userMetadataPreferencesProvider.future);
  return service.getAllPeopleWithSharedSpaces(minFaces: prefs?.minimumFaces ?? 3, sortBy: sortBy);
});
```

## GREEN / verify

- `cd mobile && mise exec -- flutter test test/domain/services/people_service_test.dart` — all
  tests in the file green (existing + 2 new + 1 augmented assertion).
- `cd mobile && mise exec -- dart analyze lib/domain/services/people.service.dart lib/providers/infrastructure/people.provider.dart test/domain/services/people_service_test.dart` — no new errors.
- No l10n/codegen regen needed (no translation keys touched).
- No OpenAPI/SDK regen (no API repository / DTO change).

## Commit

`fix(mobile): offline shared-space People honors minimumFaces (LOW #12)`

Stage: `mobile/lib/domain/services/people.service.dart`,
`mobile/lib/providers/infrastructure/people.provider.dart`,
`mobile/test/domain/services/people_service_test.dart`, the findings-doc Status line, this plan.
