# All / People / Pets filter — parity across the space People tab and mobile

**Date:** 2026-09-04
**Status:** Design, approved in chat; revised after an adversarial self-review
**Follows:** #1065 (`feat(web): filter the People page by All / People / Pets`), #843 (individual pet recognition), #980 (`feat(mobile): view a space's own people from inside a space`)

## Problem

#1065 shipped an All / People / Pets filter on the **web global People page** (`/people`) only. Three sibling surfaces show the same kind of list and cannot filter it:

1. The **web space People tab** (`/spaces/[spaceId]/people`)
2. The **mobile global People page** (`DriftPeopleCollectionPage`)
3. The **mobile space People page** (`SpacePeoplePage`, #980)

Pets are real on all three. `shared_space_person.type` exists with default `'person'` (`server/src/schema/tables/shared-space-person.table.ts:59-60`), pet faces are projected into spaces as `type: 'pet'` rows (`server/src/services/shared-space.service.ts:3647-3651`), and `SharedSpacePersonResponseDto.type` is already mapped and on the wire (`server/src/services/shared-space.service.ts:4154`). Only the **query** side cannot filter on it.

## What already exists (verified against the code, not assumed)

| Fact                                                          | Location                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /people` accepts `type: 'person' \| 'pet'`               | `server/src/dtos/person.dto.ts:103-111`                                     |
| Global list arm: type filter + species-bucket exclusion       | `server/src/repositories/person.repository.ts:647-660`                      |
| Global count arm (raw SQL): both predicates + pets waiver     | `server/src/repositories/person.repository.ts:1032-1057`                    |
| Generated Dart client already has `type`                      | `mobile/openapi/lib/api/people_api.dart:386`                                |
| `GET /shared-spaces/{id}/people` query schema — **no `type`** | `server/src/dtos/shared-space-person.dto.ts:5-21`                           |
| Space list query (Kysely builder), with a 4-key ORDER BY      | `server/src/repositories/shared-space.repository.ts:2349-2441`              |
| Space count query (**raw `sql`` ` templates**)                | `server/src/repositories/shared-space.repository.ts:2446-2479`              |
| Existing `$if(!!options.type, …)` precedent in the same repo  | `server/src/repositories/shared-space.repository.ts:4215`                   |
| Space show/hide screen **drops `type`** from its mapping      | `web/src/lib/components/spaces/manage-space-people-visibility.svelte:19-27` |
| i18n `all`, `people`, `pets`, `filter_people_by`              | present in `en` + all nine required locales                                 |

**i18n work required: none.** All four keys already exist in `de fr it nl pl es ru zh_Hans zh_Hant`.

## The two traps this design exists to avoid

### Trap 1 — the `minimumFaces` gate hides exactly the pets you want

`getPersonsBySpaceId` gates on `name != '' OR assetCount >= minimumFaceCount` (`shared-space.repository.ts:2378-2385`). This is the same gate #1065 had to waive globally: the threshold is tuned for noisy _human_ face clusters and defaults to 3, while pet recognition deliberately ships `minFaces: 1` so a pet photographed once still becomes its own individual. On a real 66k-asset library the human threshold hid **187 of 260** pets.

Without the same waiver, a space's Pets view would hide precisely the one-photo pets you opened it to name.

The waiver is **narrow**: it applies **only when `type=pet` is requested**. The unfiltered space People view keeps behaving exactly as it does today. #1065 first exempted pets everywhere, then reverted that — exempting globally adds ~187 one- and two-photo pets to the default view of any library with pet detection on. Do not repeat the first version.

### Trap 2 — species buckets DO reach spaces

The detector produces per-species buckets (bird, cow, horse, elephant, zebra, bear, sheep, giraffe) alongside individuals. These are a category, not an individual, and they are where misdetections collect — a rock filed under "sheep", two people under "horse". #1065 excludes them from the global Pets view.

It is tempting to conclude the space arm is exempt because `shared_space_person` has **no `species` column**. That is wrong. `getPetFacesForAsset` (`shared-space.repository.ts:4664-4671`) selects faces on `person.type = 'pet'` with **no `pet_search` requirement**, so bucket faces are projected into spaces as ordinary `type='pet'` space-person rows.

The exclusion therefore keys off `pet_search` on the **face**, exactly as it does globally. The space join is _shorter_ than the global one, and should not be transliterated from it: `pet_search.faceId` **is** an `asset_face.id`, and `shared_space_person_face.assetFaceId` is already that id, so `pet_search` joins directly onto `shared_space_person_face` with no `asset_face` hop:

```
EXISTS (
  SELECT 1 FROM shared_space_person_face spf
  INNER JOIN pet_search ON pet_search."faceId" = spf."assetFaceId"
  WHERE spf."personId" = shared_space_person.id
)
```

(The global query needs the `asset_face` hop only because it reaches `personId` through it. Neither version filters `deletedAt` / `isVisible` inside the EXISTS — the surrounding query already constrains visible faces.)

A space person with no `pet_search` row on any of its faces is a bucket and is excluded from the Pets view. It remains visible on the unfiltered view (where it appears today) and remains hideable.

## Design

### Arm 1 — Server: `type` on the space people query

**DTO.** Add to `SpacePeopleQuerySchema` (`server/src/dtos/shared-space-person.dto.ts:5`), mirroring `PersonSearchSchema`'s wording:

```ts
type: z
  .enum(['person', 'pet'])
  .optional()
  .describe(
    'Filter the list. `person` returns human people. `pet` returns the individual pets that pet ' +
      'recognition identified — species buckets, which the detector produces without an embedding, are ' +
      'excluded, and the minimumFaces threshold is waived. Omit for the unfiltered list.',
  ),
```

**Service.** Thread `query?.type` through **both** `getSpacePeople` (`shared-space.service.ts:1799`) and `getSpacePeopleStatistics` (`shared-space.service.ts:1831`). Both, or the header count disagrees with the grid it sits above — that was #1065's e2e failure (`GET /people?type=pet` filtered the list but still reported `total: 10`).

**Repository — two implementations, two styles.** This is the highest-risk part of the change: `getPersonsBySpaceId` is a Kysely builder and `countPersonsBySpaceId` is raw `sql`` ` templates. The same three predicates must be written twice and cannot be shared. Raw SQL is invisible to `tsc`, so the count arm has no compiler safety net and is covered by tests instead.

The three predicates, in both arms:

1. **Type:** `type = <requested>` when `type` is given.
2. **Species-bucket exclusion:** when `type = 'pet'`, require the `pet_search` EXISTS above.
3. **minimumFaces waiver:** when `type = 'pet'`, satisfy the existing `name != '' OR assetCount >= minimumFaceCount` gate unconditionally.

**Ordering and paging are load-bearing.** The list query ends in a 4-key ORDER BY — `isHidden`, then name (nulls last), then `assetCount` desc for unnamed people, then `id` — followed by `limit`/`offset` (`:2431-2439`). The filter must be a `WHERE` inside that same query so paging stays stable and ordered; filtering after the fact would both reorder and break offsets.

**Interaction with the existing `petsEnabled` flag.** `petsEnabled: false` already forces `type != 'pet'` (`:2375`, `:2466`). A `type=pet` request against such a space must return **empty**, not everything. The two predicates AND, so this falls out naturally — but it is pinned by a test rather than assumed, because a future refactor that turns the pair into an `OR` or an `if/else` would silently leak every pet in a space that disabled them.

**`detectedFaceCount` does not move with the filter.** `countPersonsBySpaceId` returns `{ total, hidden, detectedFaceCount }`. `total` and `hidden` count _people_ and take the filter, because they sit above the grid and must agree with it. `detectedFaceCount` counts detected _faces_ in the space scope — it answers "how much has recognition found here", not "how many rows are in this grid" — so it stays unfiltered. This asymmetry is deliberate and is pinned by a test so a later reader does not "fix" it.

### Arm 2 — Web space People tab

`web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte` (594 lines) gets the same `Dropdown` control `/people` has, with the same `PeopleFilterBy` enum, icons (`mdiAccountGroupOutline` / `mdiAccountMultipleOutline` / `mdiPaw`) and labels.

Mirroring `/people`'s hard-won details:

- The filter is **server-side**, not a filter over the loaded array. The tab pages at `PAGE_SIZE` and pets are a small fraction of a library; filtering only what has loaded shows a near-empty grid until you scroll to the end.
- **Paging carries the filter** (`:313`, `:343`) or page 2 reintroduces the type you just excluded.
- The **SSR load** (`+page.ts`) is always unfiltered, so a persisted choice is reapplied on mount.
- The **header count** reads the filtered statistics (`:95` `countVisiblePeople`), never the unfiltered total.
- `oazapfts` escapes a query param named `type` — on the global client it emerged as **`$type`**, still serialising to `type` on the wire. Sending the unescaped name silently drops the filter. **Confirm the generated parameter name for `getSpacePeople` after the regen rather than assuming it matches**; `svelte-check` is the gate that catches it either way.

**Persistence scope.** The space tab reuses the existing `peopleViewSettings.filterBy` store rather than introducing a per-space key. One filter preference across People surfaces matches how `sortBy` already behaves and avoids a settings key per space.

**`petsEnabled` and the control.** A space with pets disabled has no pets to show. The Pets option is **still offered** and yields an empty grid with the existing empty state. #935 ("do not offer filter sections that cannot filter anything") governs whole _filter sections_; here the three options are one control whose shape should not shift under the user mid-session. Deliberate and reviewable, not an oversight.

### Arm 2b — Web space show/hide screen: badge pets

`manage-space-people-visibility.svelte:19-27` maps space people onto `VisibilityPerson` but drops `type`, although `SharedSpacePersonResponseDto` already carries it. This is the identical gap #1065 fixed on the global manage page (which now passes `type: person.type, species: person.species`): pet tiles render indistinguishably from humans — a `role="img"` with no accessible name.

**The fix is one line, because #1065 already built for this case.** The badge itself lives in the shared `web/src/lib/components/people/people-visibility-modal.svelte`, which this wrapper feeds; and `getPetBadgeLabel` (`web/src/lib/utils/pet-species.ts`) already names shared spaces in its own doc comment — "`SharedSpacePersonResponseDto` has `type`, no `species` — so fall back to a generic 'Pet'". Passing `type` through the wrapper's mapping is the entire change. Nothing in the badge or the label util needs to move.

Pets belong on this screen: hiding a misdetected bucket is the only way to get rid of it, and buckets are exactly what the unfiltered view keeps showing. Pass `type` through and reuse the existing badge. `species` has no space equivalent and is simply omitted — the badge must degrade to a generic pet badge without it.

Small, cheap, and squarely part of the parity this change is for.

### Arm 3 — Mobile global People page

No server work: #1065 already shipped both the endpoint and the regenerated Dart client.

Mirror the existing **sort** plumbing exactly, one new element at each layer:

| Layer        | Existing (sort)                                     | New (filter)                                   |
| ------------ | --------------------------------------------------- | ---------------------------------------------- |
| Enum         | `PeopleSortBy` (`person.model.dart`)                | `PeopleFilterBy { all, people, pets }`         |
| Settings key | `SettingsKey.peopleSortBy` (`settings_key.dart:42`) | `SettingsKey.peopleFilterBy`                   |
| Config       | `PeopleConfig.sortBy`                               | `PeopleConfig.filterBy`                        |
| Dispatch     | `app_config.dart:237`                               | one added arm                                  |
| Widget       | `PeopleSortButton`                                  | `PeopleFilterButton` (same `MenuAnchor` shape) |

The provider family key becomes a record `({ PeopleSortBy sortBy, PeopleFilterBy filterBy })`, threaded through `DriftPeopleService.getAllPeopleWithSharedSpaces` into `PersonApiRepository.getAllPeopleWithSharedSpaces`, which passes `type:` to `_api.getAllPeople(...)`.

**Blast radius of the family-key change — larger than it looks.** `driftGetAllPeopleWithSharedSpacesProvider`'s key type appears at three kinds of call site:

1. **`ref.invalidate(provider)` with no argument** — `tab_shell.page.dart:157`, `person_picker.page.dart:91`, `gallery_bottom_nav.widget.dart:164`, `person_edit_name_modal.widget.dart:35`, `person_edit_birthday_modal.widget.dart:37`. These invalidate the whole family and need **no change**. Do not churn them.
2. **`people_picker.provider.dart:37`** — the photos-filter picker, which passes `PeopleSortBy.photoCount`. This surface is out of scope _behaviourally_, but the key change forces the call site to be updated to pass `filterBy: PeopleFilterBy.all` explicitly. "Out of scope" here means "behaviour unchanged", not "untouched". A test pins that the picker still returns people of both types.
3. **~10 test `overrideWith((ref, sortBy) => …)` sites** across `drift_people_collection_test.dart`, `person_picker_test.dart`, `people_picker_provider_test.dart`. All need the new key shape. Mechanical, but it is the bulk of the diff and should be expected rather than discovered.

An alternative — reading `filterBy` from `appConfigProvider` inside the provider instead of passing it in the key — would avoid (2) and (3) entirely. It is rejected for consistency: `sortBy` is already in the key, and splitting the two would leave a reader guessing which knob lives where.

**Why server-side here too, given mobile already holds the whole list.** `getAllPeopleWithSharedSpaces` walks every page into memory (`person_api.repository.dart:30-52`), so a client-side All/People split _would_ work. It cannot work for Pets: the `minimumFaces` waiver that surfaces one-photo pets exists only server-side, so a client-side Pets filter over the default list would filter a list those pets were never in. Server-side is the only correct option, and it keeps mobile and web identical.

**Offline fallback.** `getAllPeopleWithSharedSpaces` falls back to the owner-scoped local Drift list when the server is unreachable (`people.service.dart:73-82`). The local `person` table has no `type` column, so the fallback **cannot honour any filter**. Decision: return the unfiltered local list — today's behaviour — rather than an empty grid. A viewer offline under a Pets filter sees their local people, which is degraded but useful; an empty grid reads as data loss. Documented in a doc comment at the fallback and pinned by a test.

**App bar.** `DriftPeopleCollectionPage` uses a plain `AppBar` with a `Text` title, not `ImmichSliverAppBar`, so the ~155px action budget from #1030 (logo silently scales down) does not apply. Three actions is safe here.

### Arm 4 — Mobile space People page

Same `PeopleFilterButton`, threaded into `driftSpacePeopleProvider`'s family key → `SharedSpaceApiRepository.getSpacePeople` → `type:` on the generated call.

**Page-size constraint.** `getSpacePeople` caps `pageSize` at 100 because `SpacePeopleQuerySchema.limit` is `.max(100)` and an over-cap value is a 400, not a clamp (`shared_space_api.repository.dart:95-101`). The filter changes nothing here; the existing cap and the short-page end-of-list signal are preserved.

**No offline fallback exists** for space people by design (`people.provider.dart:69-82` — a failure is a real dead end and shows the error state). The filter does not change that.

## TDD plan

### How to read this plan

The tests below fall into **two kinds**, and conflating them is the most common way a TDD plan lies to itself.

**Kind A — new behaviour. Written first, watched fail, then made pass.** A Kind A test that passes on its first run is a broken test, not a head start: stop and fix the test.

**Kind B — regression guard on behaviour that already works.** These **pass on first run**, and that is correct. A passing Kind B test proves nothing by itself, so each one is made meaningful by **deliberately breaking the production code and watching it go red**, then reverting the break. Untested-by-breakage, a Kind B test is decoration.

Two project-specific honesty rules apply throughout:

- **Mobile widget tests:** prove red by flipping the flag under test. A widget test that renders without asserting the filtered outcome passes either way.
- **Web tests:** `queryBy*` returns `null` rather than throwing, so an assertion built on it passes whether or not the element exists. Assert presence _and_ absence explicitly.

### Server — repository, list arm (`getPersonsBySpaceId`)

| #   | Kind | Test                                                                                                                                       |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | A    | `type: 'person'` returns only human space people                                                                                           |
| S2  | A    | `type: 'pet'` returns only pet space people                                                                                                |
| S3  | B    | `type` omitted returns both, unchanged from today                                                                                          |
| S4  | A    | `type: 'pet'` **excludes** a `type='pet'` person whose faces have no `pet_search` row (species bucket)                                     |
| S5  | B    | The same bucket **is** returned on the unfiltered list — exclusion is scoped to the Pets view                                              |
| S6  | A    | `type: 'pet'` returns an **unnamed, single-face** pet under `minimumFaceCount: 3`                                                          |
| S7  | B    | An unnamed, single-face **human** is still hidden under `minimumFaceCount: 3`, filtered and unfiltered — the waiver did not leak to humans |
| S8  | B    | An unnamed single-face pet is **still hidden** on the _unfiltered_ list — the waiver is Pets-view-only                                     |
| S9  | A    | `petsEnabled: false` + `type: 'pet'` returns **empty**, not everything                                                                     |
| S10 | B    | `petsEnabled: false` + `type: 'person'` behaves exactly as today                                                                           |
| S11 | A    | A pet with **some** faces carrying `pet_search` and some not **is** included (EXISTS, not FOR ALL)                                         |
| S12 | A    | `type` composes with `named`                                                                                                               |
| S13 | A    | `type` composes with `name` (search)                                                                                                       |
| S14 | A    | `type` composes with `withHidden`                                                                                                          |
| S15 | A    | `type` composes with `takenAfter` / `takenBefore`                                                                                          |
| S16 | A    | `type` composes with `limit` / `offset`, and page 2 of a filtered list contains no excluded type                                           |
| S17 | B    | The 4-key ordering (`isHidden`, name nulls-last, `assetCount` desc, `id`) is unchanged under a filter                                      |

### Server — count arm (`countPersonsBySpaceId`)

The raw-SQL twin. **No `tsc` safety net**, so every list-arm predicate gets a count-arm mirror.

| #   | Kind | Test                                                                                    |
| --- | ---- | --------------------------------------------------------------------------------------- |
| S18 | A    | `total` under `type: 'pet'` equals the **length of the filtered list** from S2          |
| S19 | A    | `total` under `type: 'person'` equals the filtered list length from S1                  |
| S20 | A    | `hidden` is scoped to the type filter                                                   |
| S21 | A    | Count arm excludes species buckets under `type: 'pet'` (mirrors S4)                     |
| S22 | A    | Count arm applies the minimumFaces waiver under `type: 'pet'` (mirrors S6)              |
| S23 | B    | Count arm does **not** waive minimumFaces on the unfiltered list (mirrors S8)           |
| S24 | A    | `detectedFaceCount` is **unchanged** by the type filter — pins the deliberate asymmetry |
| S25 | A    | `petsEnabled: false` + `type: 'pet'` counts zero (mirrors S9)                           |

**Counter-agreement property.** S18/S19 assert list length and count against the _same_ fixture rather than hardcoded numbers, so the two arms cannot drift apart without a failure.

**The two arms do not count the same unit.** `countPersonsBySpaceId` collapses rows by identity — `person_rows` selects `COALESCE(identityId, id) AS personKey`, `person_keys` groups by it — so `total` counts **distinct identities**, while `getPersonsBySpaceId` returns **raw rows**. Where two space-person rows share an `identityId`, `total < list.length` **independent of any filter**. The agreement fixture must therefore give every person a distinct or NULL `identityId`, stated as an explicit precondition; otherwise the test fails while telling the truth. S33 separately guards that the collapse still happens under a filter.

| #   | Kind | Test                                                                                |
| --- | ---- | ----------------------------------------------------------------------------------- |
| S33 | A    | Two same-identity pet rows still collapse to one counted person under `type: 'pet'` |

### Server — service and contract

| #   | Kind | Test                                                                                                          |
| --- | ---- | ------------------------------------------------------------------------------------------------------------- |
| S26 | A    | `getSpacePeople` passes `query.type` through to the repository                                                |
| S27 | A    | `getSpacePeopleStatistics` passes `query.type` through to the repository                                      |
| S28 | B    | `faceRecognitionEnabled: false` returns `[]` / zeroes regardless of `type` (existing early return still wins) |
| S29 | B    | Membership is still required with `type` present — the filter is not an auth bypass                           |
| S30 | A    | DTO validation: `type: 'dog'` is rejected 400; `type` absent is valid                                         |
| S31 | A    | e2e: `GET /shared-spaces/{id}/people?type=pet` filters the list **and** the statistics agree                  |
| S32 | A    | `getSpacePeopleFaceStatistics` is **unchanged** by `type` — it shares the DTO but must ignore the filter      |

**A third endpoint inherits `type` for free, and must ignore it.** `SpacePeopleQueryDto` is also the query DTO for `GET /shared-spaces/{id}/people/face-statistics` (`shared-space.controller.ts:387-400`), so adding `type` to the schema silently extends it there. `getPeopleFaceStatisticsBySpaceId` has no `type` option and ignores it — which is correct, and matches #1065's decision not to filter face statistics. S32 makes that a tested decision rather than an accident. The web client must likewise not send it: `getStatisticsQuery` on the space page is shared between the statistics and face-statistics calls, so the filter goes on the `getSpacePeopleStatistics` call sites only.

### Web — space People tab

| #   | Kind | Test                                                                                              |
| --- | ---- | ------------------------------------------------------------------------------------------------- |
| W1  | A    | The dropdown renders all three options with the current one marked selected                       |
| W2  | A    | Selecting Pets calls `getSpacePeople` with the pet type under the **generated** parameter name    |
| W3  | A    | Selecting Pets also calls `getSpacePeopleStatistics` with the filter, so the header count matches |
| W4  | A    | "Load more" carries the filter into the paged request                                             |
| W5  | A    | A persisted non-`All` choice is reapplied on mount, since SSR loads unfiltered                    |
| W6  | A    | Switching filters resets paging rather than appending onto the previous type's list               |
| W7  | A    | Selecting All sends **no** type parameter (asserted absent, not merely `undefined`)               |
| W12 | A    | The filter composes with an active search rather than replacing it                                |
| W13 | A    | The filter is **never** sent to `getSpacePeopleFaceStatistics` (the shared-helper leak)           |

### Web — space show/hide screen (Arm 2b)

| #   | Kind | Test                                                                             |
| --- | ---- | -------------------------------------------------------------------------------- |
| W8  | A    | A `type: 'pet'` space person renders the pet badge                               |
| W9  | A    | A human space person renders no badge                                            |
| W10 | A    | The pet tile has an accessible name (the `role="img"` gap #1065 closed globally) |
| W11 | A    | A pet with no `species` still badges — space people never carry `species`        |

### Mobile — shared

| #   | Kind | Test                                                                                              |
| --- | ---- | ------------------------------------------------------------------------------------------------- |
| M1  | A    | `PeopleFilterBy` ↔ `type` mapping: `all → null`, `people → 'person'`, `pets → 'pet'`              |
| M2  | A    | `SettingsKey.peopleFilterBy` round-trips through the enum codec                                   |
| M3  | A    | `AppConfig` dispatch maps `peopleFilterBy` onto `PeopleConfig.filterBy`                           |
| M4  | A    | `PeopleFilterButton` renders three options, marks the selected one, and writes the setting on tap |

### Mobile — global People page

| #   | Kind | Test                                                                                              |
| --- | ---- | ------------------------------------------------------------------------------------------------- |
| M5  | A    | `getAllPeopleWithSharedSpaces` sends `type` on **every** page of its paging walk, not only page 1 |
| M6  | A    | `all` sends no `type`                                                                             |
| M7  | A    | The provider re-fetches when `filterBy` changes (the family key actually varies)                  |
| M8  | A    | Offline fallback returns the **unfiltered** local list under a Pets filter, and does not throw    |
| M9  | A    | The page renders the filter button and the grid reflects the server's filtered response           |
| M10 | B    | The photos-filter people picker still returns people of both types after the key change           |

### Mobile — space People page

| #   | Kind | Test                                                                                                |
| --- | ---- | --------------------------------------------------------------------------------------------------- |
| M11 | A    | `SharedSpaceApiRepository.getSpacePeople` sends `type` on every page of its paging walk             |
| M12 | A    | `driftSpacePeopleProvider` re-fetches when `filterBy` changes                                       |
| M13 | B    | A filtered fetch that fails still shows the error state (no silent fallback to owner-scoped people) |
| M14 | B    | `pageSize` stays ≤ 100 with the filter applied (the 400-not-clamp trap)                             |

## Edge cases, stated explicitly

| Case                                           | Behaviour                                                                          | Pinned by  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | ---------- |
| Space with `petsEnabled: false`, Pets selected | Empty grid + existing empty state. Not "all people".                               | S9, S25    |
| Space with `faceRecognitionEnabled: false`     | Tab unreachable; direct nav redirects. Unchanged.                                  | S28        |
| Species bucket under Pets                      | Excluded. Still on the unfiltered view, still hideable, still badged on show/hide. | S4, S5, W8 |
| Pet with a _mix_ of embedded and bucket faces  | Included — EXISTS, not FOR ALL.                                                    | S11        |
| Unnamed one-photo pet                          | Visible under Pets, hidden on the unfiltered view.                                 | S6, S8     |
| Unnamed one-photo human                        | Hidden everywhere.                                                                 | S7         |
| Mobile offline + Pets                          | Unfiltered local owner-scoped list.                                                | M8         |
| Mobile space page offline                      | Error state, no fallback.                                                          | M13        |
| Filter + search together                       | AND, on both server and client.                                                    | S13, W12   |
| Two space-person rows sharing an `identityId`  | Counted once; list returns both rows. Pre-existing, preserved under the filter.    | S33        |
| Face statistics under a filter                 | Unchanged — whole-space, never filtered, and the client never sends the param.     | S32, W13   |
| Filter + hidden people                         | `withHidden` composes; `hidden` count is per-type.                                 | S14, S20   |
| Filter + paging                                | Page 2 of a filtered list contains no excluded type; ordering unchanged.           | S16, S17   |
| `type` outside the enum                        | 400 from DTO validation.                                                           | S30        |
| Non-member requesting with `type`              | 403 — the filter is not an auth bypass.                                            | S29        |
| Persisted `pets` in a library with no pets     | Empty grid, existing empty state. No crash, no fallback to All.                    | M9         |

## Out of scope

- The **mobile photos-filter people picker** behaviour. Its call site changes mechanically (Arm 3, blast radius item 2) and is pinned unchanged by M10, but it gains no filter UI.
- **Per-space filter persistence.** One shared preference, matching `sortBy`.
- The **web global People page** — shipped in #1065, untouched here.
- Any change to species-bucket _creation_, pet detection, or the `petsEnabled` flag itself.

## Verification gates

1. **OpenAPI regen is mandatory** — `SpacePeopleQuerySchema` changes the contract. From `server/`: `pnpm build`, `pnpm sync:open-api`, then the SDK + Dart client regen. Use the `mise` tasks bare from `server/`; the `make open-api` / `make sql` targets in `CLAUDE.md` are stale.
2. **SQL snapshot regen** — the trigger is "did anything touch `server/src/repositories/`?", and it is **yes**. Editing a repository _body_ drifts the generated `.sql` snapshots even when no signature changed; this failed CI in #1065.
3. **Server:** unit + medium suites, lint, `tsc`. `tsc` green means little on the raw-SQL count arm — S18–S25 are the real gate there.
4. **Web:** `svelte-check` (it catches the parameter-escaping trap) + component specs.
5. **Mobile:** `flutter test` (baseline on this branch: **3548 passed, 1 skipped**) and `dart analyze --fatal-infos`. `dart analyze` is **not** a substitute for `flutter test` — generated-code compile errors surface only when a test compiles. Never pipe either through `tail`: the pipe's exit code masks the gate's.
6. **No fork-migration work** — this change adds no table and no column.

## Adversarial review — what changed and why

The first draft was reviewed against the code and revised. Findings, all verified before folding in:

1. **The TDD plan contradicted its own rule.** It demanded every test be "watched fail", while including tests of behaviour that already works (unfiltered list, waiver-not-leaking, membership) — those pass on first run. Split into Kind A / Kind B with an explicit break-the-code step for Kind B.
2. **A six-assertion row masquerading as one test.** "`type` composes with named, name, withHidden, dates, limit/offset" became S12–S16, plus a new ordering guard (S17).
3. **Blast radius understated.** Changing the provider family key touches the photos-filter picker call site and ~10 test overrides, while five `ref.invalidate` sites need no change. Enumerated, with the rejected alternative recorded.
4. **A parity gap was missed entirely.** The space show/hide screen drops `type` and cannot badge pets — the same gap #1065 closed globally. Added as Arm 2b with W8–W11.
5. **An unverifiable claim stated as fact.** The `$type` escaping was asserted for `getSpacePeople` from the global client's behaviour; the SDK is not regenerated yet. Softened to "confirm after regen".
6. **A simplification missed.** The space bucket-exclusion joins `pet_search` directly onto `shared_space_person_face` — the global query's `asset_face` hop exists only to reach `personId` and should not be copied.
7. **A missing edge case.** A pet cluster with a mix of embedded and bucket faces — EXISTS includes it (S11).
8. **A precedent mis-cited.** `detectedFaceCount` staying unfiltered was justified by #1065's statistics revert, which was about the _waiver_, not the _type filter_. The reasoning now stands on its own.
9. **Ordering left implicit.** The list query's 4-key ORDER BY with `limit`/`offset` makes "filter inside the query" a correctness requirement, not a style choice. Stated, and guarded by S17.
10. **A missing failure mode.** A persisted `pets` choice in a library with no pets now has defined behaviour.

## Second review pass — implementation-plan review findings

A review of the derived implementation plan against the codebase surfaced three more issues, folded back above:

11. **The two counter arms do not count the same unit.** `total` counts distinct identities (`COALESCE(identityId, id)`); the list returns raw rows. The counter-agreement tests need an explicit fixture precondition or they fail while telling the truth. S33 added.
12. **A third endpoint inherits `type` from the shared DTO.** `GET /shared-spaces/{id}/people/face-statistics` uses `SpacePeopleQueryDto` and must ignore the filter; the web client must not send it, because `getStatisticsQuery` is shared between the two statistics calls. S32 and W13 added.
13. **Arm 2b is smaller than first described.** The badge is in the shared visibility modal and `getPetBadgeLabel` already handles the no-`species` shared-space case by name. Passing `type` through the wrapper mapping is the whole change; W11 is a regression guard, not new behaviour.

One trap belongs to the plan rather than this design, and is recorded there: `petPersonFilter` is interpolated in **two** places in the count query — `person_rows` and `assignedPersonFaceFilter` — and the new predicates belong only in the first, or `detectedFaceCount` gets filtered in contradiction of S24.
