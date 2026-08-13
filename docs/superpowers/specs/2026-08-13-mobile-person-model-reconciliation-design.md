# Mobile Person-Model Reconciliation — Design

**Date:** 2026-08-13
**Status:** Draft — awaiting review. Design only; nothing here is implemented.
**Scope:** Releasing the three quarantined upstream commits (`52edcc0c74c`, `303a9f15b1a`, `1c3a5cf5087`) into the rolling rebase branch while preserving the fork's shared-space people design, and sequencing open PR #980 against that work.
**Background:** `docs/upstream-reports/2026-08-13-upstream-sync-quarantine-person-model.md` (in the rolling worktree) and the `quarantineHistory` entry in the worktree's `upstream-preflight/rolling-state.json`.

---

## 1. Problem

Upstream reworked the mobile person model in three commits that are present on `upstream/main` but deliberately not rebased into `rebase/upstream-rolling-v3.1.1` (the branch is 8 behind; these 3 are the blockers, and commits 6–10 of the pending range are safe but queued behind them):

| Commit        | PR     | What it does                                                                                                                                                                                                                                                           |
| ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `52edcc0c74c` | #30659 | Collapses `PersonDto` + `DriftPerson` into one `Person { id, name, updatedAt, birthDate }`, dropping `ownerId`, `isHidden`, `thumbnailPath`, `color`, `isFavorite`, `createdAt`, `faceAssetId`. Retypes 16 files. Uses Dart dot-shorthand (`.new(...)`) in the mapper. |
| `303a9f15b1a` | #30660 | `driftGetAllPeopleProvider` becomes a `StreamProvider` over a new Drift `watch()`; renames `updateBrithday` → `updateBirthday`; **deletes the `ref.invalidate` calls** in the two edit modals and `tab_shell.page.dart` because the provider is now reactive.          |
| `1c3a5cf5087` | #30662 | Renames `driftGetAllPeopleProvider` → `getAllPeopleProvider`; deletes `providers/search/people.provider.dart` and `services/person.service.dart`; removes `PersonApiRepository.getAll()`; repoints the old search people-picker at the new provider.                   |

The fork extends exactly this surface (CLAUDE.md mobile people contract; PRs #727/#735/#737/#738/#739, #473/#758; open PR #980). The collision is head-on: the fork adds fields to both collapsed classes, its providers have different shapes, and upstream's invalidation deletions read like clean resolutions while silently breaking the fork's People page refresh.

## 2. Verified inventory — what the fork actually has

Everything below was verified in the worktree at the current rolling tip, not assumed from the brief. Corrections to the brief are called out.

### 2.1 Fork model fields and who reads them

`DriftPerson` carries fork-added `spaceId` and `numberOfAssets`; `PersonDto` carries fork-added `spaceId` (a **tokenized** `space-person:<uuid>` / `person:<uuid>` filter id lives in `PersonDto.id`, not the same value space as `DriftPerson.id`) and `numberOfAssets`.

Of the seven fields upstream drops, fork surfaces read — on the domain model — only these:

| Dropped field                       | Fork reads on the domain model                                                                                                                                                                                                    | Verdict                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `isFavorite`                        | `comparePeople` ("favorites first") — pre-#980 it sorts `PersonResponseDto` before mapping; #980 moves it onto `DriftPerson` (`mobile/lib/utils/people_sort.dart`). Local Drift sorts favorites in SQL.                           | **Keep on the unified model** (fork extension). Client-side sort of the server-backed list needs it. |
| `isHidden`                          | Only `peoplePickerAllProvider`'s `!p.isHidden` filter. Every source already pre-filters hidden people (server `withHidden: false`; local SQL `isHidden.equals(false)`; `getAssetPeople` filters the response DTO before mapping). | **Drop**; delete the redundant picker filter with a comment.                                         |
| `thumbnailPath`                     | Never read. Written as `''` everywhere except the dead `_toPerson`.                                                                                                                                                               | Drop.                                                                                                |
| `ownerId`                           | Never read on a person (the asset-viewer strip keys on `info.ownerId` from the **asset**, not the person).                                                                                                                        | Drop.                                                                                                |
| `color`, `createdAt`, `faceAssetId` | Never read. (`sync_stream.repository.dart` reads them off the **sync DTO** into the Drift row — untouched by this rework.)                                                                                                        | Drop.                                                                                                |

`updatedAt` (kept by upstream, but made nullable): fork uses it for thumbnail cache-busting and the picker's "Recent" strip; both already handle null. Adopting the nullable field lets `_personToDriftPerson` drop its epoch-0 sentinel hack.

### 2.2 Fork provider/service shapes (all diverge from upstream's targets)

- `driftGetAllPeopleProvider = FutureProvider.family<List<DriftPerson>, PeopleSortBy>` — local Drift, SQL `ORDER BY` per sort mode, consumed by the library people card (pinned `photoCount`).
- `driftGetAllPeopleWithSharedSpacesProvider = FutureProvider.family<List<DriftPerson>, PeopleSortBy>` — **server-backed** (pages `GET /api/people?withSharedSpaces=true`, client re-sort, offline fallback to the local list). Feeds the People page and the photos-filter people picker. Not reactive to anything.
- `driftPeopleAssetProvider = FutureProvider.family<List<DriftPerson>, ({String id, String ownerId})>` — **also fork-diverged** (the brief didn't mention it): upstream's is keyed by plain `String` assetId; the fork keys on a record so non-owned assets route to the server (#727).
- `driftSpaceEditableProvider`, `driftSharedSpacePersonAssetIdsProvider` — fork-only, key on `spaceId` living on the model.
- `DriftPeopleService.updateName/updateBrithday(DriftPerson person, ...)` — take the **model**, not an id: they route on `person.spaceId` (owner-only endpoint + local Drift write vs editor-gated space endpoint, no local write). Upstream's take `(String personId, ...)`.
- `DriftPeopleService.getAllPeopleWithSharedSpaces` falls back to `_repository.getAllPeople(...)` (a `Future`) offline — upstream deletes that repository method in favor of `watch()`.

### 2.3 The invalidation pairing (the buried trap)

Five sites pair `ref.invalidate(driftGetAllPeopleProvider)` with `ref.invalidate(driftGetAllPeopleWithSharedSpacesProvider)`:

1. `tab_shell.page.dart:156` (Library tab selected)
2. `person_edit_name_modal.widget.dart:33`
3. `person_edit_birthday_modal.widget.dart:36`
4. `gallery_bottom_nav.widget.dart:148`
5. `person_picker.page.dart:91` (refresh button — server provider only; no local half)

\#30660 deletes upstream's half at sites 1–3 because their provider became reactive. **The fork's server-backed half must survive at every site** — a Drift stream can never observe a server-side edit (space-person edits perform no local write at all), so deleting the pair wholesale silently stops the People page refreshing after a rename or birthday edit. PR #980 adds a third member (`driftSpacePeopleProvider`) at sites 1–4, making the "remember to invalidate the siblings" invariant three-wide — this design removes the invariant instead (§5).

### 2.4 Dead code the fork can shed for free

`PersonService` (`services/person.service.dart`), `personServiceProvider`, and `PersonApiRepository.getAll()` have **zero consumers in the fork** — their only consumer was the old search page, which fork PR #654 deleted along with `providers/search/people.provider.dart` and `widgets/search/search_filter/` (all three upstream-deleted paths are already absent in the fork). #30662's deletions are a no-op-shaped gift; the fork's old-search divergence means upstream's `people_picker.dart` repointing simply doesn't apply.

### 2.5 Tokenized-id boundary (why the two DTOs are not the same thing)

- `DriftPerson.id` = raw profile id. For a space person that raw id has **no row in the owner-only `person` table**: the owner thumbnail endpoint 404s it, which is why `getPersonThumbnailUrl` routes on `spaceId`.
- `PersonDto.id` (photos-filter) = the server's `filterId` token (`space-person:<uuid>` / `person:<uuid>`). The `withSharedSpaces` search expects exactly this in `personIds` — a raw space-person id silently filters to nothing. `getFilterPersonThumbnailUrl` de-tokenizes before building URLs. Filter strips construct minimal `PersonDto`s straight from tokenized suggestion ids.
- `SearchFilter.people: Set<PersonDto>` participates in filter equality; the people set is **not** serialized (only the location/camera/date/rating sub-filters have `toJson`).

Two id value-spaces, both with silent-failure modes when confused. This is the argument that decides §4-Q4.

### 2.6 Test surface (correcting the brief)

The brief said "9 fork test files override `driftGetAllPeopleWithSharedSpacesProvider`". Verified: **3 files** override it (14 override sites): `people_picker_provider_test.dart`, `person_picker_test.dart`, `drift_people_collection_test.dart`. Nothing overrides `driftGetAllPeopleProvider` in tests. The broader churn surface is **21 test files** referencing `DriftPerson`/`PersonDto`/the providers (list in §9). PR #980 adds 6 more.

## 3. Approaches considered

**A. Adopt the unified `Person` for people surfaces; keep a separate fork-owned filter view-model (recommended).** Take upstream's model, provider kind, renames, and deletions everywhere upstream owns the surface; carry the fork's three needed fields on the unified `Person`; keep the tokenized-id filter model as its own type (`FilterPerson`, renamed from `PersonDto`) in a fork-owned file. Divergence shrinks to: three fields on one upstream file, a family parameter on one provider, and fork-only files.

**B. Full collapse — one `Person` everywhere, including the photos filter.** Maximum upstream alignment, but `Person.id` would mean "raw profile id" on one page and "tokenized filter id" on the next. The compiler currently enforces that boundary; erasing it converts two documented silent-failure modes (owner-endpoint 404, `personIds` silently matching nothing) into permanent foot-guns. Rejected.

**C. Reject the rework; keep `PersonDto` + `DriftPerson` and the `FutureProvider`s.** No immediate churn, but the fork's hottest upstream-shared surface becomes a permanent conflict magnet (16 files retyped upstream this week alone), the quarantine never releases cleanly, and every future upstream people commit needs manual translation. Rejected — this is exactly the divergence the rolling-rebase process exists to avoid.

## 4. Decisions on the open questions

### Q1 — Where do `spaceId` / `numberOfAssets` live?

Directly on the unified `Person` in `mobile/lib/domain/models/person.model.dart`, keeping today's doc comments, plus **`isFavorite`** (§2.1 — the sort needs it; default `false`):

```dart
@freezed
abstract class Person with _$Person {
  const factory Person({
    required String id,
    required String name,
    DateTime? updatedAt,
    DateTime? birthDate,
    // ── fork (Gallery): shared-space people ─────────────────────────────
    String? spaceId,        // non-null ⇒ Space-scoped; routes edits + thumbnails
    int? numberOfAssets,    // server list only; null on local/offline paths
    @Default(false) bool isFavorite, // "favorites first" sort of the server list
  }) = _Person;
}

enum PeopleSortBy { photoCount, name } // fork, unchanged
```

A wrapper/composition type was considered and rejected: freezed doesn't subclass, and a wrapper would ripple through every consumer signature — strictly worse than three annotated fields in one small upstream file.

### Q2 — Does the `PeopleSortBy` family survive the `StreamProvider`?

Yes — adopt the stream, keep the family:

```dart
final getAllPeopleProvider = StreamProvider.family<List<Person>, PeopleSortBy>((ref, sortBy) async* {
  final service = ref.watch(driftPeopleServiceProvider);
  final prefs = await ref.watch(userMetadataPreferencesProvider.future);
  yield* service.watch(minFaces: prefs?.minimumFaces ?? 3, sortBy: sortBy);
});
```

`DriftPeopleRepository.watch()` keeps the fork's per-mode SQL `ORDER BY` and ends in `.watch()` instead of `.get()`. The repository **also keeps a `Future<List<Person>> getAllPeople(...)`** (same query, `.get()`) as a fork extension — it is the offline-fallback path inside `getAllPeopleWithSharedSpaces` and has no business being a stream. Sorting client-side via #980's `comparePeople` instead of a family was considered; rejected because the SQL ordering already exists, works, and keeps the provider contract identical for both sort modes.

The library people card (`drift_library.page.dart`) keeps watching `getAllPeopleProvider(PeopleSortBy.photoCount)` — `AsyncValue` consumption is unchanged, and the card now updates live on sync, which is upstream's intended win.

### Q3 — How does the shared-spaces provider stay refreshed?

Two parts:

**(a) Accept upstream's deletions only for the half they reason about.** The local provider's invalidations at sites 1–4 are correctly obsolete once it streams. The server-backed halves stay.

**(b) Remove the pairing invariant instead of maintaining it.** One fork-owned helper in `people.provider.dart`:

```dart
/// Invalidate every server-backed people list. The local list (getAllPeopleProvider)
/// is a Drift stream and needs no invalidation — but a Drift stream can never see a
/// server-side edit (space-person edits write nothing locally), so any surface that
/// changes people on the server, and any deliberate refresh gesture, calls this.
/// New server-backed people providers must be added HERE, not at the call sites.
void invalidateServerPeopleLists(Ref ref) {
  ref.invalidate(driftGetAllPeopleWithSharedSpacesProvider);
  ref.invalidate(driftSpacePeopleProvider); // once PR #980 lands
}
```

(Widgets call it through their `WidgetRef`; both ref kinds expose `invalidate`, so define it on the small common interface or accept the two-line overload — implementation detail.) All five sites collapse to one call each. This deletes the exact trap class that motivated the quarantine: the next sibling provider changes one function, not five call sites. The alternative (a revision-tick `StateProvider` the server providers watch) adds reactive machinery for the same effect and hides the refresh edge in data flow; rejected as over-engineering.

The modals' restructure in #30660 (`if (result != 0 && mounted)`) is adopted with the helper call inserted before `context.pop(...)`.

### Q4 — Do the fork's two DTOs collapse into one?

**No.** `DriftPerson` → unified `Person` (upstream's collapse, plus §Q1 fields). The photos-filter view-model stays a **separate type**: rename `PersonDto` → **`FilterPerson`** and move it to a fork-owned file (`mobile/lib/models/photos_filter/filter_person.model.dart`), dropping the dead `thumbnailPath` and the pre-filtered `isHidden` (§2.1):

```dart
/// Photos-filter view of a person. [id] is the TOKENIZED filter id
/// (`person:<uuid>` / `space-person:<uuid>`) — the server's filterId format —
/// never a raw profile id. Distinct from [Person] on purpose: the two id
/// value-spaces fail silently when confused (owner thumbnail 404s a token;
/// personIds search matches nothing on a raw space-person id).
@freezed
abstract class FilterPerson with _$FilterPerson { ... id, name, birthDate?, updatedAt?, numberOfAssets?, spaceId? ... }
```

`SearchFilter.people` becomes `Set<FilterPerson>` (fork resolution over upstream's `Set<Person>` retype — the fork's filter genuinely stores tokens; upstream's doesn't exist here since #654). Moving the type out of the upstream-owned model file means future upstream edits to `person.model.dart` stop colliding with the filter model entirely. Consumers (~10 lib files + filter tests) rename mechanically.

### Q5 — Take the `updateBrithday` → `updateBirthday` rename?

Yes. The fork keeps its signature (`updateBirthday(Person person, ...)` — routing needs the model, §2.2) but matches upstream's spelling, eliminating a permanent gratuitous diff. Callers: one modal + `people_service_test.dart`'s group name.

### Additional decisions the brief didn't enumerate

- **Take the provider rename** `driftGetAllPeopleProvider` → `getAllPeopleProvider` (#30662). The name is free — the fork deleted the old search provider of that name with #654 — and future upstream commits will reference the new name. Keep `driftGetAllPeopleWithSharedSpacesProvider` / `driftSpacePeopleProvider` names as-is (fork-owned, referenced across tests/docs/memory; renaming is churn with no conflict-surface payoff — optional later cleanup).
- **Take the deletions** of `services/person.service.dart` + `PersonApiRepository.getAll()` (already dead, §2.4).
- `driftPeopleAssetProvider` keeps its fork record key `({String id, String ownerId})`; element type retypes to `Person`.
- `updatedAt` becomes nullable end-to-end; drop the epoch-0 sentinel in `_personToDriftPerson` / `_toDriftPerson`.
- Dart dot-shorthand in upstream's mapper is fine: `mobile/pubspec.yaml` requires SDK ≥ 3.12 (Flutter pin 3.44.9 — read the pin, it moves).
- `comparePeople` (#980's `utils/people_sort.dart`) retypes to `Person` — with `isFavorite`/`numberOfAssets` on the model it works unchanged.

## 5. Target shape (post-reconciliation)

| Piece                                       | Shape                                                                                                                                                                         | Owner                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `Person`                                    | upstream 4 fields + `spaceId?`, `numberOfAssets?`, `isFavorite` (§Q1)                                                                                                         | upstream file, fork-annotated fields |
| `FilterPerson`                              | fork-owned file; tokenized id; no `thumbnailPath`/`isHidden` (§Q4)                                                                                                            | fork                                 |
| `getAllPeopleProvider`                      | `StreamProvider.family<List<Person>, PeopleSortBy>` (§Q2)                                                                                                                     | upstream name, fork family           |
| `driftGetAllPeopleWithSharedSpacesProvider` | `FutureProvider.family<List<Person>, PeopleSortBy>` — element retype only                                                                                                     | fork                                 |
| `driftPeopleAssetProvider`                  | `FutureProvider.family<List<Person>, ({String id, String ownerId})>` — element retype only                                                                                    | fork key, upstream base              |
| `driftSpacePeopleProvider` (#980)           | `FutureProvider.autoDispose.family<List<Person>, ({String spaceId, PeopleSortBy sortBy})>` — element retype only                                                              | fork                                 |
| `DriftPeopleService`                        | `watch({minFaces, sortBy})` (new, streams) **and** `getAllPeople({minFaces, sortBy})` (kept, fallback); `updateName`/`updateBirthday(Person, …)` route on `spaceId` unchanged | mixed                                |
| `DriftPeopleRepository`                     | `watch(...)` + kept `getAllPeople(...)`; `toDto()` maps `isFavorite`, leaves `spaceId`/`numberOfAssets` null (local = personal people)                                        | mixed                                |
| Invalidation                                | `invalidateServerPeopleLists(ref)` helper; local invalidations deleted (§Q3)                                                                                                  | fork                                 |
| Thumbnails / edit gating / timeline routing | Unchanged — all key on `Person.spaceId` exactly as they keyed on `DriftPerson.spaceId`                                                                                        | fork                                 |

Everything in the CLAUDE.md mobile-people contract survives with the same semantics; only type names change.

## 6. Sequencing PR #980 ("view a space's own people from inside a space")

**Merge #980 to `main` first, before releasing the quarantine.** Rationale:

1. The rolling branch lands on `main` only at an upstream tag. Holding #980 behind the reconciliation blocks a finished, tested PR indefinitely; merging it now means the next fork-sync carries it into the rolling branch and the reconciliation adapts every surface in one pass.
2. #980 actively shrinks the reconciliation: it extracts the shared `people_grid.widget.dart` (reducing `drift_people_collection.page.dart` divergence), and moves `comparePeople` onto the domain model (`utils/people_sort.dart`) — exactly where the unified model wants it. Its `driftSpacePeopleProvider` and fourth invalidation member are absorbed by the §Q3 helper.
3. The reverse order would force #980's author to rewrite it mid-review against a model that exists only on the rolling branch.

Cost: the reconciliation must retype #980's six new lib files and six test files — mechanical `DriftPerson` → `Person` renames.

## 7. Implementation strategy (phased; per-commit resolutions in §8)

**Phase 0 — `main`: merge PR #980** (§6).

**Phase 1 — `main`: fork-only preparation (shippable, behavior-preserving, full CI). TDD throughout (§9.1).**

1. **Pin the survival behaviors first** (§9.3): land the characterization tests for everything the rebase must not break — refresh-after-edit for personal _and_ space people, space edit routing, thumbnail routing, tokenized picker output. Green on `main` today; they are the tripwires for Phase 2.
2. Delete dead `services/person.service.dart` + `PersonApiRepository.getAll()` (§2.4) — deletion only; suite stays green.
3. Introduce `FilterPerson` in its fork-owned file (red-first per §9.2-A); retype the photos-filter surface and `SearchFilter.people`; drop the dead fields and the redundant `!p.isHidden` picker filter (§Q4).
4. Introduce `invalidateServerPeopleLists` (red-first per §9.2-B) and collapse all five (post-#980: five sites × up to three lines) invalidation sites onto it (§Q3b); the step-1 refresh tests must pass unchanged through the refactor.

Phase 1 makes no upstream-shaped change (no model collapse, no stream, no renames) — it only shrinks the collision surface, so every remaining conflict in Phase 2 is genuinely upstream's change meeting fork-owned routing.

**Phase 2 — rolling worktree: release the quarantine.** Fork-sync `main` (picks up Phases 0–1 including all §9 tests), then advance through the three commits resolving per-commit (§8), then a rolling-branch adaptation commit for what can't be expressed as a resolution (freezed regeneration, test retypes, and the §9.2-C/D new-behavior tests — red-first where the behavior is new, e.g. `watch()` re-emission). Mid-rebase the suite cannot be green per commit (the model flips across three commits); the gate is: **every §9 test green at the adaptation commit**, before anything else proceeds.

**Phase 3 — rolling worktree: commits 6–10** proceed under the normal flow (they were held only by linearity). Full local CI per the standing gates (`flutter test` — not just `dart analyze` — plus the usual suite), stage an RC before force-push per standing practice.

**Phase 4 — docs/memory:** update the CLAUDE.md mobile section (`DriftPerson` → `Person`, `driftGetAllPeopleProvider` → `getAllPeopleProvider`, `updateBrithday` → `updateBirthday`, the invalidation-helper contract), and the memory files that name these symbols.

## 8. Per-commit resolution guide (Phase 2)

**`52edcc0c74c` (unify person model):**

- `person.model.dart`: take upstream's collapse; re-add the three fork fields with their doc comments (§Q1). `PersonDto` is already gone (Phase 1) — only `DriftPerson` → `Person` merges here.
- `search_filter.model.dart`: **keep fork side** (`Set<FilterPerson>`, Phase 1). Upstream's `Set<Person>` retype is superseded, not dropped.
- `people.repository.dart` `toDto()`: take upstream's shape; add `isFavorite: isFavorite`.
- `person_api.repository.dart`: fork side wins structurally (upstream's version barely exists after #30662); take nullable-`updatedAt` simplification; keep `_personToDriftPerson`/`_toDriftPerson` (renamed `_toPersonModel`/similar is optional) building `Person` with `spaceId`/`numberOfAssets`/`isFavorite`.
- Retype-only files (`drift_person.page.dart`, `person_sliver_app_bar.dart`, `people_details.widget.dart`, both modals, `people.utils.dart`, `driftPeopleAssetProvider`): apply upstream's `DriftPerson` → `Person` onto the fork's versions; fork behavior (editable gating, `spaceId` thumbnail routing, record keys) is untouched.
- `drift_search.page.dart`, `widgets/search/search_filter/people_picker.dart`, `providers/search/people.provider.dart`: absent in fork (#654) — honour the deletions.
- `services/person.service.dart`: already deleted in Phase 1.

**`303a9f15b1a` (reactive provider):**

- `people.service.dart` / `people.repository.dart`: take `watch()` **adding** the fork's `sortBy` parameter and SQL ordering; **keep** `getAllPeople()` alongside (fallback, §Q2); take the `updateBirthday` spelling onto the fork's `(Person, …)` signature.
- `people.provider.dart`: provider becomes `StreamProvider.family` (§Q2).
- `tab_shell.page.dart`, both modals: take upstream's deletion of the **local** invalidation; the fork side is already the single `invalidateServerPeopleLists(ref)` call (Phase 1), which stays. Site 4 (`gallery_bottom_nav`) is fork-only — delete its local half to match. This is the trap: the resolution that "cleanly" deletes the whole block is wrong; the helper line must survive at all five sites.

**`1c3a5cf5087` (remove old provider):**

- Take the rename to `getAllPeopleProvider` everywhere (library card, People page — fork versions).
- File deletions: already absent (fork #654 / Phase 1) — no-ops.
- `people_picker.dart` repointing + `no_name` fallback: N/A (fork's picker surface).

**Verification hooks for the release:** after Phase 2, (a) grep zero remaining `DriftPerson`/`PersonDto`/`driftGetAllPeopleProvider`/`updateBrithday` outside generated code; (b) every §9 test green at the adaptation commit — in particular the §9.3 characterization suite, which encodes exactly the regressions the trap would cause; (c) the §9.2-C live-update test proves the new upstream win rather than assuming it.

## 9. Testing — TDD process and coverage

### 9.1 Process rules

- **TDD (superpowers:test-driven-development) for every new behavior**: failing test first, minimal green, refactor. Applies to `FilterPerson`, the invalidation helper, `watch()`, and every mapping change. Mechanical retypes of existing tests are not TDD subjects — but no existing assertion may be weakened to get green.
- **Characterization-before-change for every surviving behavior**: behaviors that exist today and must outlive the rebase get pinned by tests in Phase 1 step 1, _before_ any code moves (§9.3). A Phase 2 resolution that breaks one of these tests is wrong by definition — fix the resolution, never the test.
- **Never mock the layer under test** (standing rule): repository stream tests run on an in-memory Drift DB (`NativeDatabase.memory()`), not a mocked repository; service routing tests mock the repositories under the service (mocktail, as `people_service_test.dart` does today); provider tests use `ProviderContainer` with overrides only for layers _below_ the unit.
- **No pass-either-way assertions** (standing rule): refresh tests must assert fetch _counts_ (e.g. the server repository was called exactly twice after an edit), not just "the list eventually contains the new name".
- Full gate is `flutter test` — `dart analyze` is not a substitute (generated-code breaks only surface on compile).

### 9.2 New-behavior test matrix (red-first)

**A. `FilterPerson` + `_toFilterPerson` mapping (Phase 1)** — `filter_person_model_test.dart` + extensions to `people_picker_provider_test.dart`:

| Case                                                  | Expected                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| personal person (`spaceId == null`)                   | id `person:<uuid>`, `spaceId` null                                                                                                                     |
| space person (`spaceId != null`)                      | id `space-person:<uuid>`, `spaceId` carried                                                                                                            |
| `numberOfAssets` null (offline/local fallback source) | passes through null; picker row hides the count                                                                                                        |
| `updatedAt` null                                      | passes through; "Recent" strip treats as not-recent (no crash, epoch-0 not resurrected)                                                                |
| set semantics                                         | same token from picker and suggestion strip → one `Set` entry (freezed equality)                                                                       |
| blank-name people                                     | still filtered out by the picker (`name.isNotEmpty` survives the `isHidden` removal)                                                                   |
| hidden people                                         | absent from picker output with the client filter deleted (sources pre-filter; assert via provider chain with a hidden person in the local fallback DB) |

**B. `invalidateServerPeopleLists` (Phase 1)** — provider test with a counting override:

| Case                 | Expected                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| call once            | `driftGetAllPeopleWithSharedSpacesProvider` refetches for **every** live family member; `driftSpacePeopleProvider` (post-#980) refetches       |
| local list untouched | `getAllPeopleProvider` (post-Phase-2: the stream) is not rebuilt by the helper                                                                 |
| contract guard       | test enumerates the server-backed people providers and fails if one is invalidated outside the helper's list (keeps the "add HERE" doc honest) |

**C. `DriftPeopleRepository.watch()` + kept `getAllPeople()` (Phase 2 adaptation)** — in-memory Drift:

| Case                                       | Expected                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| initial emission                           | current list, ordered per `sortBy`                                                                             |
| rename a person row                        | stream re-emits with the new name (the reactivity that justifies upstream's deletions)                         |
| add/remove a face link crossing `minFaces` | stream re-emits; person appears/disappears                                                                     |
| `minFaces` boundary                        | exactly `minFaces` faces → included; `minFaces − 1` → excluded                                                 |
| sort modes                                 | `photoCount` and `name` orders: favorites first, named before unnamed, id tiebreaker (mirrors `comparePeople`) |
| hidden person                              | never emitted                                                                                                  |
| `getAllPeople()` (kept Future)             | equals the stream's first emission for the same args                                                           |
| family isolation                           | two `sortBy` family members emit independently ordered lists                                                   |

**D. Provider/stream layer (Phase 2 adaptation)**:

| Case                             | Expected                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `getAllPeopleProvider(sortBy)`   | emits loading → data (library card renders both states unchanged)                                                          |
| `minimumFaces` preference change | provider rebuilds with the new threshold                                                                                   |
| override ergonomics              | `overrideWith((ref, sortBy) => Stream.value([...]))` works — proves the documented test pattern before 21 files rely on it |

**E. Mapping edges in `PersonApiRepository` (Phase 2 adaptation; extends `person_api_repository_test.dart`)**:

| Case                                                          | Expected                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `primaryProfile.type == spacePerson`                          | `Person.spaceId` set                                                              |
| `primaryProfile` absent or non-space type                     | `spaceId` null                                                                    |
| asset-info: `spacePersonId` set **and** `resolvedSpaceId` set | id = space-person id, `spaceId` = resolved space                                  |
| asset-info: `spacePersonId` set, `resolvedSpaceId` **null**   | treated as personal (global id, null `spaceId`) — the guard both-or-neither       |
| `updatedAt` absent                                            | `Person.updatedAt` null (sentinel gone); thumbnail URL built without cache-buster |
| `isFavorite` absent                                           | false                                                                             |
| paging: 2 pages / `hasNextPage` never clears / empty page     | all people collected / stops at `maxPages` / stops immediately                    |

### 9.3 Characterization suite (Phase 1 step 1 — pins what the rebase must not break)

Each is a widget/provider test asserting today's behavior with **fetch-count** assertions (§9.1); all must pass unchanged after every later phase:

1. **Refresh after rename — personal person**: modal flow succeeds → server people list refetches (count +1) → People page shows the new name.
2. **Refresh after rename — space person**: edit routes to the space endpoint, **no** local write, **no** owner-endpoint call (`verifyNever`), server list refetches. The single most important test in this design — it is the trap made executable.
3. **Refresh after birthday edit** — both person kinds (same shape as 1–2; covers `updateBirthday` through the rename).
4. **Modal failure paths**: `result == 0` → no invalidate, no pop; repository throws → toast, no invalidate, no pop.
5. **Library-tab navigation** (`tab_shell` + `gallery_bottom_nav`) and the **picker refresh button** each refetch the server list(s).
6. **Edit gating**: viewer-only space person renders read-only; editor/owner editable; `driftSpaceEditableProvider` unresolved → optimistically editable (fails open).
7. **Thumbnail routing**: personal → owner endpoint; space person → membership-gated space endpoint; filter token de-tokenized first (extends the existing `image_url_builder_test.dart`).
8. **Timeline routing**: space person → server-resolved asset ids; personal → owner-scoped local query (pins `buildPersonTimelineRouteService`, extends `person_timeline_provider_test.dart`).
9. **Offline fallback**: server list failure → local owner-scoped list honoring `sortBy` + `minFaces`; every fallback person has `spaceId` null (and is therefore editable-as-owned, which is correct — they _are_ owned).
10. **Picker tokenization**: picker output ids are tokenized, space people included when online (exists in `people_picker_provider_test.dart` — keep passing).

**Post-Phase-2 additions (new behavior, red-first in the adaptation commit):** 11. **Library card live-update** — insert/rename a person in the in-memory Drift DB with the card mounted → card updates with **no** invalidation call (proves upstream's win and that deleting the local invalidations was safe). 12. **People page still refreshes after edits with the local invalidations gone** — re-run of tests 1–3 against the post-rebase wiring (they must pass as-is; listed for emphasis).

### 9.4 Existing-suite churn (mechanical, not TDD subjects)

- **Override-signature churn (3 files, 14 sites):** `driftGetAllPeopleWithSharedSpacesProvider.overrideWith((ref, sortBy) async => …)` — signature survives (still `FutureProvider.family`); only the element type renames.
- **Retype churn:** 21 test files reference `DriftPerson`/`PersonDto`/the providers (constructors lose `createdAt`/`ownerId`/`isHidden`/`color`/`faceAssetId`/`thumbnailPath`, keep `isFavorite`); +6 from #980. The 21: `domain/models/person_dto_number_of_assets_test`, `domain/services/people_service_test`, `models/search/search_filter_equality_test`, `presentation/pages/drift_people_collection_test`, `presentation/pages/timeline_route_adoption_test`, `presentation/pages/photos_filter/person_picker_test` + 3 widget tests under `photos_filter/widgets/`, `presentation/widgets/asset_viewer/people_details_widget_test`, 5 filter-sheet tests (`active_filter_chip`, `deep_content`, `deep_flow`, `deep/people_section`, `strips/strips`), `providers/infrastructure/person_timeline_provider_test`, `providers/photos_filter/{active_chips,people_picker_provider,photos_filter_provider}_test`, `repositories/person_api_repository_test`, `unit/utils/image_url_builder_test`. `people_service_test.dart` renames the `updateBrithday routing` group; its routing assertions carry over verbatim into §9.3-2.
- `person.model.freezed.dart` regenerates via the standard codegen (`mise //mobile:codegen`).

## 10. Risks and mitigations

| Risk                                                                                    | Mitigation                                                                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The invalidation trap re-materializes during conflict resolution (§8's warning)         | Phase 1 lands the helper **before** the rebase, so upstream's deletion can only ever collide with one self-documenting line per site.       |
| A missed `PersonDto` consumer surfaces at compile time mid-rebase                       | Phase 1 does the rename on `main` under full CI; Phase 2 meets only `Person`-shaped conflicts.                                              |
| `flutter test` compile breaks that `dart analyze` misses (generated-code shape changes) | Standing rule: run `flutter test`, never trust analyze alone; freezed + codegen rerun in the Phase 2 adaptation commit.                     |
| Upstream keeps evolving this surface while quarantined                                  | Phase 0/1 are independent of upstream timing; §8 resolutions are per-commit, so newly arriving people commits queue behind the same design. |
| `main` regression window between Phase 1 and the rolling landing                        | Phase 1 is behavior-preserving by construction (dead-code deletion, type rename, helper extraction); existing suites cover all three.       |

## 11. Out of scope

- Renaming `driftGetAllPeopleWithSharedSpacesProvider`/`driftSpacePeopleProvider` to match upstream's prefix-less convention (noted optional cleanup).
- Any server/web change — the rework is mobile-only; the server's people/filter APIs are untouched.
- Commits 6–10 of the pending range (ordinary flow once unblocked) and PR #981's rebase onto #29043 (tracked in the sync report).
