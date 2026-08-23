# Mobile: view a space's own people from inside a space

**Date:** 2026-08-12
**Status:** Approved design, ready for implementation planning
**Scope:** mobile client only — no server, no OpenAPI, no i18n changes

## 1. Problem

On the web, a shared space has its own People tab (`/spaces/[spaceId]/people`) listing the
people detected in that space's photos. On mobile there is no equivalent: the global People
page (`DriftPeopleCollectionPage`) mixes the viewer's own people with people from every space
they belong to, and nothing inside a space scopes that list down.

This design adds a space-scoped People page reachable from the space detail page.

## 2. Goals and non-goals

**Goals**

- From inside a space, open a grid of that space's people.
- Search, sort, and tap through to a person's photos, matching the global mobile People page —
  with one deliberate divergence, the no-match search state (B25).
- Rename and set a birthday, gated on the viewer's space role, exactly as web gates it.

**Non-goals** (web-only today, and absent from every mobile people surface)

- Hide/unhide people and the visibility manager.
- Merging people.
- The face-statistics header.
- Queue-deduplicate.

Pets are not a separate surface: when a space has `petsEnabled`, the server includes pet
people in the same list (`shared-space.repository.ts:1681`), so they appear inline for free.
The client must not filter them.

## 3. What already exists

Every one of these was read and verified against the tree at `578dbeaab15`. This feature adds
no server, SDK, or translation work.

| Layer                                                                                                                                                                                                                  | Location                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /shared-spaces/{id}/people`                                                                                                                                                                                       | `server/src/controllers/shared-space.controller.ts:335`                 |
| Membership gate + `faceRecognitionEnabled` short-circuit                                                                                                                                                               | `server/src/services/shared-space.service.ts:1226`                      |
| Deterministic ordering, optional `limit`/`offset`, server-side `minimumFaceCount`                                                                                                                                      | `server/src/repositories/shared-space.repository.ts:1655`               |
| Dart SDK `SharedSpacesApi.getSpacePeople`                                                                                                                                                                              | `mobile/openapi/lib/api/shared_spaces_api.dart:1079`                    |
| `SharedSpaceApiRepository.updateSpacePerson` / `getSpacePersonAssets` / `isSpaceEditor`                                                                                                                                | `mobile/lib/repositories/shared_space_api.repository.dart`              |
| Space person → `sharedSpacePerson` timeline routing                                                                                                                                                                    | `mobile/lib/providers/infrastructure/person_timeline.provider.dart`     |
| `getPersonThumbnailUrl(id, spaceId:)` → membership-gated thumbnail                                                                                                                                                     | `mobile/lib/utils/image_url_builder.dart:38`                            |
| Space-aware write routing (`updateName` / `updateBrithday`)                                                                                                                                                            | `mobile/lib/domain/services/people.service.dart:90`                     |
| `PeopleSortButton` (persists `SettingsKey.peopleSortBy` app-wide)                                                                                                                                                      | `mobile/lib/presentation/widgets/people/people_sort_button.widget.dart` |
| i18n keys: `people`, `filter_people`, `spaces_no_people`, `spaces_no_people_description`, `spaces_error_loading_people`, `search_no_people_named`, `retry`, `add_a_name`, `edit_name`, `edit_birthday`, `add_birthday` | `i18n/en.json` — all present in every locale                            |

## 4. Architecture

```
SpaceDetailPage app bar
  │  face icon, rendered unless faceRecognitionEnabled is explicitly false
  ▼
SpacePeopleRoute(spaceId, canEdit)          ← canEdit resolved from the already-loaded member list
  │
  ├─▶ driftSpacePeopleProvider((spaceId, sortBy))
  │     └─▶ SharedSpaceApiRepository.getSpacePeople(spaceId, sortBy:)
  │           └─▶ SharedSpacesApi.getSpacePeople(id, withHidden: false, limit: 1000, offset: n)
  │                 └─▶ SharedSpacePersonResponseDto → DriftPerson (spaceId set)
  │
  └─▶ tap ──▶ DriftPersonRoute(person)      ← unchanged; already routes on spaceId
```

### 4.1 Why the space-scoped endpoint, not a filter over the global list

`PersonResponseDto.primaryProfile` is singular. A person who appears in two spaces has exactly
one primary profile, so filtering `getAllPeopleWithSharedSpaces` by `spaceId` would silently
drop them from their non-primary space. The space endpoint has no such blind spot, and it is
what web uses.

### 4.2 Why there is no offline fallback

The `person` and `asset_face` sync streams filter `ownerId = userId`
(`server/src/repositories/sync.repository.ts`), so space people have **no local Drift rows at
all**. Unlike `DriftPeopleService.getAllPeopleWithSharedSpaces`, which degrades to the
owner-scoped local list, this page has nothing correct to degrade to — the local list contains
people who are _not in this space_, so showing it would be wrong, not merely stale.

A load failure therefore surfaces as an error state with Retry. Caching would mean a new Drift
table for non-owned people, which is far beyond this feature.

## 5. Components

### 5.1 `SharedSpaceApiRepository.getSpacePeople`

```dart
Future<List<DriftPerson>> getSpacePeople(
  String spaceId, {
  required PeopleSortBy sortBy,
  int pageSize = 1000, // test seam
  int maxPages = 100,  // test seam
})
```

`pageSize` / `maxPages` are defaulted test seams, not production knobs: without them B5's
runaway guard is only reachable by allocating 100 000 DTOs in a unit test.

**Does:** returns every non-hidden person in the space, mapped to `DriftPerson` and sorted for
the requested mode.
**Depends on:** `ApiService.sharedSpacesApi` (resolved lazily per call — see §8, trap 6).

Paging: the response is a bare `List<SharedSpacePersonResponseDto>` with **no `hasNextPage`
envelope**, so termination is `page.length < limit`. Uses `limit: 1000` with an advancing
`offset` and a `maxPages` guard, mirroring `PersonApiRepository.getAllPeopleWithSharedSpaces`.
Server ordering is deterministic and ends in an `id` tiebreaker
(`shared-space.repository.ts:1737-1745`), so offset paging cannot skip or duplicate rows
_absent concurrent mutation_. The ordering is name-based, so a rename landing between two page
fetches can in principle shift a row across the boundary. That is accepted: the window is
milliseconds, the consequence is one person briefly missing or doubled in a list the user can
pull to refresh, and closing it properly would need a cursor the endpoint does not offer.

On hitting `maxPages` the method **returns the rows gathered so far** rather than throwing,
matching `getAllPeopleWithSharedSpaces`. The guard exists to stop a runaway loop against a
misbehaving server, not to signal a user-facing error.

`limit` is optional server-side (`.$if(!!options.limit, ...)`), so a single unbounded request
would also return the whole list in one shot. We page anyway, for two reasons: it bounds any
single response and JSON parse on the UI isolate for a space with thousands of people, and it
keeps this method the same shape as its sibling so the two cannot drift apart.

Mapping `SharedSpacePersonResponseDto` → `DriftPerson`, following the precedent in
`_personToDriftPerson` (`person_api.repository.dart:91`):

| `DriftPerson`    | Source                                         |
| ---------------- | ---------------------------------------------- |
| `id`             | `dto.id`                                       |
| `name`           | `dto.name`                                     |
| `isHidden`       | `dto.isHidden`                                 |
| `spaceId`        | `dto.spaceId` — always non-null here           |
| `numberOfAssets` | `dto.assetCount.toInt()`                       |
| `birthDate`      | `dto.birthDate.orElse(null)`                   |
| `createdAt`      | `DateTime.parse(dto.createdAt)`                |
| `updatedAt`      | `DateTime.parse(dto.updatedAt)`                |
| `ownerId`        | `''` — a space-person profile has no owner     |
| `isFavorite`     | `false` — no favourite concept on space people |
| `color`          | `null`                                         |
| `faceAssetId`    | `null`                                         |

`withHidden: false` is always sent, matching web.

### 5.2 Shared comparator (targeted refactor)

`_comparePeople` is currently private to `PersonApiRepository` and typed on
`PersonResponseDto`. Extract it to a **new, dependency-free** `mobile/lib/utils/people_sort.dart`:

```dart
int comparePeople(DriftPerson a, DriftPerson b, PeopleSortBy sortBy)
```

**Not `people.utils.dart`.** That file imports `flutter/material.dart` plus
`person_edit_name_modal.widget.dart` and `person_edit_birthday_modal.widget.dart`, whereas
`person_api.repository.dart` today imports no Flutter at all. Homing the comparator there would
make both repositories transitively import the modal widgets. `people_sort.dart` imports only
`person.model.dart`, keeping the repository layer widget-free.

Both repositories then map first and sort the `DriftPerson` list. This is behaviour-preserving:
`map` is 1:1 and order-preserving, and the mapping is total over every field the comparator
reads (`isFavorite`, `name`, `numberOfAssets`, `id`). The existing ordering tests at
`person_api_repository_test.dart:180,194` guard the refactor and must pass unmodified.

### 5.3 `driftSpacePeopleProvider`

```dart
final driftSpacePeopleProvider =
    FutureProvider.family<List<DriftPerson>, ({String spaceId, PeopleSortBy sortBy})>(...)
```

Lives in `mobile/lib/providers/infrastructure/people.provider.dart`. Calls
`SharedSpaceApiRepository` **directly**, not through `DriftPeopleService` — the service layer
exists to host the local-fallback logic, and there is no fallback here (§4.2). Errors
propagate as `AsyncError`.

### 5.4 `PeopleGrid` (extraction)

`DriftPeopleCollectionPage`'s grid and its `_PersonName` widget move to
`mobile/lib/presentation/widgets/people/people_grid.widget.dart`. The only thing that differs
between the two callers is how "is this person editable" is answered.

**That difference must NOT be modelled as an injected `bool Function(DriftPerson)`.** The
global page's answer is _reactive_: `_PersonName` watches
`driftSpaceEditableProvider(spaceId)`, which resolves optimistically to `true` and then rebuilds
to `false` once a viewer's role comes back. A plain predicate evaluated outside a `Consumer`
has no `ref`, would be computed once, and would leave viewers holding rename affordances that
silently fail server-side — a regression in the page being refactored.

Model it as a policy the grid resolves _inside_ its own `ConsumerWidget` build instead:

```dart
sealed class PeopleEditPolicy {}

/// Global People page: per-person, resolved from the person's own space role.
class PerPersonSpaceRole extends PeopleEditPolicy { const PerPersonSpaceRole(); }

/// Space People page: role already resolved by the caller.
class FixedEditability extends PeopleEditPolicy {
  const FixedEditability(this.canEdit);
  final bool canEdit;
}
```

`_PersonName` stays a `ConsumerWidget` and switches on the policy:
`PerPersonSpaceRole` keeps today's `ref.watch(driftSpaceEditableProvider(...))` verbatim;
`FixedEditability` returns `canEdit` without watching anything. The space page passes
`FixedEditability(canEdit)` from the route — `SpaceDetailPage` has already loaded the member
list and resolved `spaceIsWritable`, so re-resolving membership would be a redundant round-trip.

Everything else — tile geometry, `ValueKey(person.id)` on both the tile and the avatar, tablet
breakpoint at 600px, `getPersonThumbnailUrl(person.id, spaceId: person.spaceId)` — moves
verbatim.

**Known behaviour that moves with it:** the empty-name branch tests `person.name.isEmpty`
without trimming, while the comparator trims (`person_api.repository.dart:63`). A person named
`" "` therefore renders a blank tappable label rather than "Add a name". This is pre-existing on
the global page; it is carried over deliberately rather than fixed here, so that the extraction
stays a pure move.

### 5.5 `SpacePeoplePage`

`mobile/lib/pages/library/spaces/space_people.page.dart`, modelled on `SpaceAlbumsPage`:
`@RoutePage()`, fields `spaceId` and `canEdit`, `SearchField` + `PeopleSortButton` in the app
bar, `PeopleGrid` in the body. Registered in `mobile/lib/routing/router.dart` beside
`SpaceMembersRoute` / `SpaceAlbumsRoute` with `guards: [_authGuard, _duplicateGuard]`.

**This is the one codegen step in the feature.** `auto_route` generates the `SpacePeopleRoute`
class into `mobile/lib/routing/router.gr.dart`, which is **committed**. After adding the
`@RoutePage()` annotation, run build_runner and commit the regenerated file — until then
`SpacePeopleRoute` does not exist and nothing referencing it compiles, including its tests:

```bash
dart run build_runner build --delete-conflicting-outputs
dart format lib/routing/router.gr.dart
```

Search filters client-side, diacritic-insensitively, reusing the global page's expression.

### 5.6 Entry point

The gate itself lives in a small extracted widget,
`mobile/lib/presentation/widgets/spaces/space_people_action.widget.dart`:

```dart
class SpacePeopleAction extends StatelessWidget {
  const SpacePeopleAction({super.key, required this.space, required this.onTap});

  final SharedSpaceResponseDto space;
  final VoidCallback onTap;
  // build: faceRecognitionEnabled.orElse(null) ?? true
  //   ? IconButton(key: const Key('space-people-action'), icon: Icon(Icons.face_outlined),
  //                onPressed: onTap, tooltip: 'people'.tr())
  //   : const SizedBox.shrink();
}
```

`SpaceDetailPage` then renders `SpacePeopleAction(space: _space!, onTap: _navigateToSpacePeople)`
in its app-bar `actions`, before the Members icon.

**The extraction is what makes B28–B31 testable.** `SpaceDetailPage` cannot be pumped — it loads
network metadata, members and a Drift timeline — and the codebase says so in three places:
`space_detail_top_sliver_test.dart:4` ("We pump [SpaceTopSliver] directly (not the full
SpaceDetailPage…)"), `space_b6_mutations_test.dart:6` ("harder to pump in isolation"), and
`SpaceDetailKebab`'s own doc ("Extracted from [SpaceDetailPage] so the RBAC table can be
widget-tested without pumping a routed page…"). `SpacePeopleAction` follows that established
pattern exactly, and is the direct sibling of `SpaceDetailKebab`.

`canEdit` is not the widget's concern — the page owns it and passes it to the route (B31), which
is asserted through `_navigateToSpacePeople` rather than through this widget.

**Explicit `false` hides the icon**, mirroring `space-tabs.svelte`. **Absent shows it**: absent
only occurs against a server that omits the field, and the server already returns `[]` for a
face-recognition-disabled space (`shared-space.service.ts:1234`), so the worst case is a
correct empty state rather than a silently missing feature.

### 5.7 Invalidation

`driftSpacePeopleProvider` must be added to the existing people-list invalidation sites.
Required for correctness:

- `mobile/lib/presentation/widgets/people/person_edit_name_modal.widget.dart:34-35`
- `mobile/lib/presentation/widgets/people/person_edit_birthday_modal.widget.dart:36-37`

Added for consistency with the sibling providers:

- `mobile/lib/pages/common/tab_shell.page.dart:156-157`
- `mobile/lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart:150-151`

`ref.invalidate(familyProvider)` with no argument invalidates every instance, so no key
plumbing is needed. Because the modals are shared, renaming a space person from the _global_
People page also refreshes the space page, and vice versa.

## 6. Behaviour specification

Written as the acceptance criteria the tests encode. Every scenario below must have a test.

### 6.1 Repository — paging

- **B1** Given a space with fewer people than the page limit, When `getSpacePeople` runs, Then
  exactly one request is issued and every person is returned.
- **B2** Given a space with **exactly** `limit` people, When it runs, Then a second request is
  issued at `offset: limit`, returns empty, and paging stops — no infinite loop, no duplicates.
- **B3** Given a space with more than `limit` people, When it runs, Then `offset` advances by
  `limit` per request and the pages concatenate in server order.
- **B4** Given the server returns a null body on any page, Then `NoResponseDtoError` propagates
  (via `checkNull`) and no partial list is returned.
- **B5** Given a server that never returns a short page, When `maxPages` is reached, Then the
  loop stops and returns the rows gathered so far — it neither spins nor throws.
- **B6** Given any fetch, When each request is issued, Then it carries `withHidden: false`.

### 6.2 Repository — mapping

- **B7** Given a DTO with `birthDate` **absent**, When mapped, Then no exception is thrown and
  `birthDate` is `null`. (`Optional.value` throws on absent — `openapi/lib/optional.dart:67`.)
- **B8** Given a DTO with `birthDate` present, Then it is carried onto the `DriftPerson`.
- **B9** Given any space-person DTO, Then `spaceId == dto.spaceId`, `ownerId == ''`,
  `isFavorite == false`, `color == null`, `numberOfAssets == dto.assetCount`.
- **B10** Given `createdAt` / `updatedAt` ISO strings, Then both parse to `DateTime`.
- **B11** Given `alias`, `type` or `representativeFaceId` are absent, Then mapping does not read
  them via `.value` and does not throw.

### 6.3 Repository — sorting

- **B12** Given `sortBy == name`, Then named people sort case-insensitively ascending, unnamed
  people sort last, ties break by asset count descending then by id.
- **B13** Given `sortBy == photoCount`, Then most photos first, ties break by name then id.
- **B14** Given the extracted `comparePeople`, Then `PersonApiRepository`'s existing ordering
  tests pass unmodified.

### 6.4 Repository — lifecycle

- **B15** Given the repository was constructed before login and `ApiService.setEndpoint()` has
  since run, When `getSpacePeople` is called, Then it routes through the _current_
  `sharedSpacesApi`, not a captured stale instance.

### 6.5 Provider

- **B16** Given a `(spaceId, sortBy)` key, When read, Then the repository is called with that
  sort mode.
- **B17** Given `sortBy` changes, Then a fresh fetch is issued (the family key includes it).
- **B18** Given the repository throws, Then the provider surfaces `AsyncError` — it must **not**
  fall back to the owner-scoped local list.

### 6.6 Page

- **B19** Given people and `canEdit == true`, Then each renders with the space-scoped thumbnail
  URL and a tappable name.
- **B20** Given an unnamed person and `canEdit == true`, Then "Add a name" is offered.
- **B21** Given `canEdit == false`, Then names render as plain non-tappable text, unnamed people
  render no "Add a name" affordance, and no option sheet is reachable.
- **B22** Given zero people, Then `spaces_no_people` + `spaces_no_people_description` render.
- **B23** Given the provider errors, Then `spaces_error_loading_people` and a `retry` action
  render, and tapping Retry re-runs the fetch.
- **B24** Given a search query, Then filtering is client-side and diacritic-insensitive.
- **B25** Given a search query that matches nothing, Then `search_no_people_named` renders with
  the query interpolated — distinct from the empty-space state. **Deliberate divergence:** the
  global People page shows a plain empty grid here. This page borrows `SpaceAlbumsPage`'s
  no-match state instead. Do not "correct" it to match the global page, and do not retrofit it
  onto the global page as part of this work.
- **B26** Given the sort setting changes, Then the grid re-orders.
- **B27** Given a person tile is tapped, Then the grid's `onPersonTap` fires with a `DriftPerson`
  whose `spaceId` is set — the value both pages hand to `DriftPersonRoute`. Asserted on the
  grid callback rather than through a `RootStackRouter` harness, which would have to build the
  whole `DriftPersonPage` and its timeline providers just to observe a push. The one-line push
  in each page is untested wiring, the same accommodation made for B31. Belongs to slice 5.
- **B34** Given a hidden person somehow reaches the grid, Then it is not rendered — the guard is
  not solely the `withHidden: false` request parameter of B6.
- **B35** Given an active search query, When the sort setting changes, Then the filter still
  applies and the surviving people re-order — sorting must not resurrect filtered-out people,
  and filtering must not be applied before the sort.
- **B36** Given a person whose name is whitespace only, Then the tile renders a blank name
  rather than "Add a name" — asserting the pre-existing behaviour §5.4 carries over, so a later
  reader can tell it is intended rather than an oversight.
- **B37** Given the space thumbnail request fails (e.g. the viewer was removed from the space
  mid-session), Then the tile still renders and the page does not throw.

### 6.7 Entry point

All four are pumped against `SpacePeopleAction`, never `SpaceDetailPage` (§5.6).

- **B28** Given `faceRecognitionEnabled` is `Optional.present(true)`, Then the People icon renders.
- **B29** Given it is `Optional.present(false)`, Then the icon does not render.
- **B30** Given it is `Optional.absent()`, Then the icon renders and `.value` is never called
  (an `Absent.value` read throws `StateError`, so a regression here fails loudly).
- **B31** Given the icon is tapped, Then `onTap` fires exactly once.

The page-side half of B31 — that `_navigateToSpacePeople` passes `_canEdit` into
`SpacePeopleRoute` — is a one-line wiring inside the unpumpable `SpaceDetailPage` and is
**deliberately not widget-tested**, the same accommodation `space_albums_link_wiring_test.dart`
makes for `onLink`. It is covered indirectly: `spaceIsWritable` has its own coverage in
`mobile/test/utils/space_permissions_test.dart`, and `SpacePeoplePage`'s honouring of `canEdit`
is B21.

### 6.8 Writes

- **B32** _(existing coverage — re-run, do not rewrite)_ Given a space person is renamed, Then
  `SharedSpaceApiRepository.updateSpacePerson` is called — **not** `PersonApiRepository.update` —
  and no local Drift write occurs. Already asserted at
  `mobile/test/domain/services/people_service_test.dart:206`. Listed here because it is load-
  bearing for this page, not because it needs a new test.
- **B33** Given a rename or birthday edit succeeds **from this page**, Then
  `driftSpacePeopleProvider` is invalidated and the grid reflects the change.
- **B38** Given a space person is renamed **from the global People page**, Then
  `driftSpacePeopleProvider` is also invalidated. This is the whole reason §5.7 touches the
  shared modals — but the only test exercising it (`space_people_page_test.dart`'s
  `invalidation` group) drives `container.invalidate(driftSpacePeopleProvider)` directly rather
  than pumping either edit modal, so neither of the two production call sites
  (`person_edit_name_modal.widget.dart`, `person_edit_birthday_modal.widget.dart`) is actually
  exercised; deleting either `ref.invalidate(driftSpacePeopleProvider)` line would break no
  test. The four-site wiring is correct and was verified by code review, not by this test —
  closing that gap properly would mean pumping an edit modal against a mocked
  `driftPeopleServiceProvider`, and no existing modal-save test exists to extend for it.

## 7. TDD implementation order

Each slice is RED → GREEN → REFACTOR: write the failing test first, run it and confirm it fails
for the stated reason, then implement. No slice starts before the previous one is green.

| Slice | Scenarios              | Test file (new unless noted)                                                                                              |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1     | B12–B14                | `mobile/test/utils/people_sort_test.dart`; existing `person_api_repository_test.dart:180,194` stays green **unmodified**  |
| 2     | B1–B6, B15             | extend `mobile/test/modules/spaces/shared_space_api_repository_test.dart`                                                 |
| 3     | B7–B11                 | same file as slice 2                                                                                                      |
| 4     | B16–B18                | `mobile/test/providers/infrastructure/space_people_provider_test.dart`                                                    |
| 5     | B19–B21, B27, B34, B36 | `mobile/test/presentation/widgets/people/people_grid_test.dart`; existing `drift_people_collection_test.dart` stays green |
| 6     | B22–B26, B35, B37      | `mobile/test/presentation/pages/space_people_page_test.dart`                                                              |
| 7     | B28–B31                | `mobile/test/presentation/widgets/spaces/space_people_action_test.dart`                                                   |
| 8     | B33, B38 (B32 re-run)  | `mobile/test/presentation/pages/space_people_page_test.dart`                                                              |

Slice 1 is deliberately first: it is a pure refactor of existing behaviour, and doing it under
the existing tests means slices 2–3 build on a comparator that is already proven.

Slice 2 **extends the existing repository test file** rather than adding a parallel one, so all
`SharedSpaceApiRepository` coverage stays in one place — including the lazy-`_api` regression
group B15 belongs to, which already exists there.

Slice 5 carries the highest regression risk in the feature: it refactors a page that already
works. `drift_people_collection_test.dart` must pass **unmodified** afterwards. If it needs
editing to go green, the extraction changed behaviour — stop and re-read §5.4 rather than
adjusting the test.

Slice 7 pumps the extracted `SpacePeopleAction`, never `SpaceDetailPage` (§5.6).

## 8. Traps

Each has bitten this codebase before and is guarded by a scenario above.

1. **`Optional.value` throws on absent** (`openapi/lib/optional.dart:67`). Applies to
   `faceRecognitionEnabled`, `birthDate`, `alias`, `type`, `representativeFaceId`, and
   `space.members`. Always `.orElse(null)`. — B7, B11, B30
2. **No `hasNextPage` on this endpoint.** Termination is `page.length < limit`; the
   exactly-`limit` boundary is the failure case. — B2
3. **No local fallback.** Degrading to the owner-scoped local list would show people who are
   not in this space. — B18
4. **`minimumFaceCount` is server-side**, resolved from the global ML config
   (`shared-space.service.ts:1248`), not the viewer's `minimumFaces` preference. Applying a
   client-side minimum would hide people that web shows. — covered by not implementing it
5. **Space person ids have no row in the owner-only `person` table.** Thumbnails must go through
   `getPersonThumbnailUrl(id, spaceId:)`; the owner endpoint 404s. — B19
6. **`_api` must be resolved per call.** `ApiService.setEndpoint()` reassigns the `*Api` fields;
   capturing one at construction pins the repo to a pre-login client. — B15
7. **A face-recognition-disabled space returns `[]`, not an error** — render the empty state. — B22
8. **Do not filter pets client-side**; `petsEnabled` is applied server-side.
9. **Editability on the global page is reactive, not a constant.** `driftSpaceEditableProvider`
   resolves optimistically to `true` and rebuilds to `false` for a viewer. Flattening it into a
   non-reactive predicate during the `PeopleGrid` extraction leaves viewers holding rename
   affordances that fail server-side — a silent regression in a page that already works. — §5.4, B21
10. **`SpaceDetailPage` cannot be pumped in a widget test.** Anything on it that needs testing
    gets extracted first; three existing tests say so in their own comments. — §5.6, B28–B31

## 9. Verification

Read the Flutter pin from `mobile/mise.toml` rather than trusting a remembered value — it is
`3.44.8` on this base and has been bumped before.

**Do not use the `mise //mobile:<task>` form from a worktree.** The `//` prefix resolves to the
main checkout, so those tasks would build and test the wrong tree. Run the equivalent commands
directly from this worktree's `mobile/` directory:

```bash
cd mobile
flutter pub get

# One-time per worktree: lib/generated/*.g.dart is gitignored.
dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart

# Required once the @RoutePage() annotation exists (see §5.5).
dart run build_runner build --delete-conflicting-outputs
dart format lib/routing/router.gr.dart

flutter test
dart analyze --fatal-infos
dart format --set-exit-if-changed $(find lib -name '*.dart' -not \( -name '*.g.dart' -o -name '*.drift.dart' -o -name '*.gr.dart' \))
```

These mirror the three CI gates exactly: `mise //mobile:test` (`flutter test`,
`.github/workflows/test.yml:624`), `mise //mobile:analyze` (`dart analyze --fatal-infos`,
`.github/workflows/static_analysis.yml:95`), and `mise //mobile:format`. Note analyze is
`--fatal-infos` only — an _info_-level lint fails CI. The DCM step is skipped without
`DCM_CI_KEY`.

`dart analyze` is not a substitute for `flutter test`: generated-code compile errors only
surface when a test actually compiles.

Beyond the auto_route regeneration in §5.5, no codegen is required — no `make open-api`, no
server build, no `i18n/*.json` edits. If any of those turn out to be needed, an assumption in
§3 was wrong; stop and re-check rather than widening the change silently.
