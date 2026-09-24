# Birthday Memories: Upstream Coexistence — Design

**Date:** 2026-09-24
**Status:** Approved, pending implementation
**Context:** Rolling upstream rebase `rebase/upstream-rolling-v3.3.0`, upstream `immich-30831`
(`d6d09473836`, _feat: birthday memories_), the second of 27 pending upstream commits. The
per-batch product-direction gate quarantined it; nothing past `202015ed95d` has been pulled.

## Problem

Gallery already ships a birthday memory: `BirthdayMemoryRule`
(`server/src/services/memory-rules/birthday.rule.ts`), one of the rule-kind memories from the #418
stack, persisted as `type = 'rule'` with `data.ruleId = 'birthday'`. `immich-30831` adds a second,
first-class one: `MemoryType.Birthday = 'birthday'`, a `createBirthdayMemories` generator dispatched
from `onMemoriesCreate`, three repository queries, a `MemoryDataDto` object schema replacing
`OnThisDayDto`, and a mobile `MemoryTypeEnum.birthday`.

Pulled blind it causes four defects:

1. **Duplicate memories.** Both generators run, so every person with a birthday gets two cards.
2. **Silent mobile corruption.** The mobile `memory_entity.type` column is `intEnum<MemoryTypeEnum>`
   (index-persisted; the source comment says "do not change this order!"). The fork's `rule` is at
   index 1; upstream inserts `birthday` at index 1. Resolving toward upstream's order moves `rule`
   to index 2, so every rule memory already synced to an installed app reads back as a birthday.
3. **Zero-conflict hide.** Upstream narrows the mobile local memory query with
   `..where(type.equalsValue(MemoryTypeEnum.onThisDay))`. That query is the memory lane's offline
   fallback; with the filter every fork rule memory disappears from it.
4. **Installed Gallery apps break on any `birthday` row.** Their generated Dart client knows only
   `on_this_day` / `rule`, and both decoders force-unwrap the type —
   `type: MemoryType.fromJson(json[r'type'])!` in `SyncMemoryV1.fromJson` and
   `MemoryResponseDto.fromJson`. An unknown value decodes to `null` and the `!` throws:
   - in the sync stream, `SyncApiRepository` turns the throw into `Future.error`, aborting the
     **whole remote sync** on every attempt (#1013 only filters for non-fork-aware clients; Gallery
     apps request `SharedSpacesV1`, so they receive every type);
   - in `GET /memories`, the whole `List<MemoryResponseDto>` fails to deserialize and the lane
     drops to the local fallback.

   `birthday` rows will exist even though Gallery never generates them: **every user migrating
   from Immich ≥ 3.3** brings the rows Immich's generator wrote, and any API client may
   `POST /memories` one.

The two features also behave differently:

| | Upstream `MemoryType.Birthday` | Fork `BirthdayMemoryRule` |
|---|---|---|
| Window | `showAt` = birthday − 3 days → `hideAt` = end of birthday | the day only |
| Assets | photos of the person taken **on past birthdays**, ≤5/year, ≤25 | photos of the person **from any date**, 2/year, ≤12; fallback 4 most recent |
| Floor | 1 asset | ≥6 assets over ≥2 years, else fallback, else nothing |
| Budget / toggle | none — always created | competes for `RULE_DAILY_LIMIT`; admin + per-user `birthday` toggle |

**Scope note — Shared Spaces.** Neither side includes Space-shared photos or Space people.
Upstream's queries and the fork's `getBirthdaysForDay` / `getMemoryAssetsForPerson` are all scoped
to `person.ownerId` / `asset.ownerId`. The only Space-aware memory code is on the read side
(`memory.repository.ts` `accessibleSearchBuilder`, `memory.service.ts` hidden scope). Space-aware
birthdays are a new feature under either direction, not a regression of this one.

## Decision

**Keep the fork's birthday memory; pull upstream's as dormant code; keep `birthday` rows off the
read paths so no client ever has to decode one.**

- `BirthdayMemoryRule` stays the only birthday generator, unchanged in behaviour.
- Upstream's generator, queries, enum value and validation are pulled so the branch stays 0-behind
  and future upstream edits to them keep auto-merging, but `createBirthdayMemories` is **never
  dispatched**.
- The server withholds `type = 'birthday'` rows from the memory sync stream and from the
  `GET /memories` list and statistics, and treats them as invisible in overlap reconciliation so
  a row nobody can see never takes photos from one they can. Gallery has exactly one birthday memory — the rule — and a
  migrated Immich birthday row is neither shown nor able to break a client.
- The mobile enum appends `birthday` **after** `rule`.

Same shape as the Search V3 coexistence (`specs/2026-07-23-search-v3-coexistence-design.md`):
present, compiling, unreachable, pinned by an invariant.

**Rejected — blend** (upstream's `type='birthday'` contract, fork engine selecting on-birthday
photos with the across-years fallback, under the fork's budget). Gives stock Immich clients a
renderable birthday memory and upstream's lead-up window, but costs non-`Rule` special cases in the
rule pipeline (key derivation, priority, dedup, daily-limit counting) and a client-capability
handshake for item 4. Logged as a follow-up.

**Rejected — upstream's generator with the fork's budget/toggle patched in.** Edits the body of an
upstream method, so every upstream change to it conflicts.

**Rejected — rely on mobile's local fallback instead of filtering `GET /memories`.** It degrades
rather than crashes, but it silently drops Space-shared memories from the lane (the reason #997
moved the lane onto the server) for as long as a birthday row sits in the window, and does nothing
for the sync abort.

## Client/server compatibility

The goal is **no client/server pairing that works today stops working**.

| Client ↓ / Server → | Current Gallery (no `birthday`) | Gallery with this change |
|---|---|---|
| Installed Gallery app (client lacks `birthday`) | works | works — never receives a `birthday` row (sync or list) |
| Gallery app built after this change | works — server never sends `birthday` | works |
| Stock Immich app (not fork-aware) | works — #1013 sends only `on_this_day` | unchanged — still only `on_this_day` |
| Web | bundled with its server | bundled with its server |

Residual, accepted: `memory_asset` rows are not filtered, so a `birthday` memory's links still
reach clients. Gallery apps since #1033 (2026-08-28) park an unresolvable link and drop it at
`SyncCompleteV1` (`_deferredMemoryAssets`); the same unfiltered-link behaviour already applies to
rule memories for stock clients under #1013. Only Gallery apps older than #1033 are exposed, and
they are exposed to that class today.

`GET /memories/{id}`, `PUT`, `DELETE` and the asset add/remove endpoints are unchanged: they
address a memory the caller already holds by id, which no Gallery client can obtain for a
`birthday` row.

## Design

### Server

- **`server/src/enum.ts`** — add `MemoryType.Birthday = 'birthday'` at upstream's position (after
  `OnThisDay`, before the fork's `Rule`). Persistence is by string value; order is irrelevant.
  Regenerated OpenAPI: `MemoryType` becomes `['on_this_day', 'birthday', 'rule']`, which the Dart
  client emits as a real `enum`.
- **`server/src/types.ts`** — add `BirthdayData = { personId: string; personName: string; year: number }`
  and a `[MemoryType.Birthday]: BirthdayData` entry in the fork's `MemoryDataByType`. **Required**,
  not optional: `AnyMemoryData = MemoryDataByType[MemoryType]` does not compile once the enum gains
  a member the interface lacks.
- **`server/src/services/memory.service.ts`** — keep upstream's private `createBirthdayMemories`,
  `getBirthdayAssets` and their three constants verbatim. Resolve `onMemoriesCreate` (it conflicts:
  upstream edits the `users.map(...createOnThisDayMemories...)` line the fork rewrote to
  `onThisDayUsers`) to the fork's version, which does not call them. Neither `tsc` (the server
  `tsconfig` has no `noUnusedLocals`) nor ESLint flags an unused TS `private` method, so no
  suppression is needed. Do **not** delete upstream's code — deletion conflicts on every later
  upstream edit. Take upstream's removal of the `// TODO validate type/data combination` comment.
- **`server/src/services/memory-rules/memory-type.metadata.ts`** — **no change.**
  `getMemoryTypeKeyForMemory(Birthday, …)` stays `undefined`, so a `birthday` row is an
  *unmanaged* memory: never reserved, never deleted, always passed by the type-visibility check.
  Mapping it to the `'birthday'` key would make an unsaved row with `showAt`/`hideAt` *managed*,
  subject to the `birthday` floor of 3 in overlap reservation (`memory.service.ts`
  `toReservable`) — which would delete the 1–2-photo birthday memories upstream legitimately
  creates.
- **Repositories** — keep upstream's `PersonRepository.forBirthdayMemories`,
  `MemoryRepository.getPersonBirthdayYears` / `getPersonAssetsByDate` / private `personAssets`, the
  `asMakeDate` helper and `utils/date.ts` `isLeapDayObserved` verbatim. They are unused, available to
  a future blend, and their `@GenerateSql` blocks regenerate into `server/src/queries/`.
- **`server/src/repositories/memory.repository.ts` `accessibleSearchBuilder`** (fork-owned; serves
  `searchAccessible` and `statisticsAccessible`) — add
  `.where('memory.type', '!=', MemoryType.Birthday)`. Filtering in SQL rather than in the service
  keeps `GET /memories/statistics` consistent with the pages, which mobile's `getAllMemories` uses
  as its end-of-results signal. Regenerate `server/src/queries/memory.repository.sql`.
- **`server/src/services/memory.service.ts` `isMemoryTypeVisible`** — return `false` for
  `MemoryType.Birthday` as its **first** check (before the `isSaved` short-circuit). This is the
  predicate `reconcileMemoryOverlap` already reuses to drop memories the user cannot see (the
  fork's "spec F1" invariant). Without it a `birthday` row has no type key, counts as visible,
  ranks as `RANK_UNMANAGED` — the highest claim priority — and claims its assets. An Immich 3.3+
  import's birthday row holds exactly the photos taken on past birthdays, i.e. the same photos as
  that day's `on_this_day` memory, so it would strip them and can delete the `on_this_day` card (or
  the fork's own birthday rule card) under its floor — while the list filter hides the birthday row
  itself, leaving the user with nothing. `search` also passes through this predicate, which makes
  it a second, service-side guard behind the SQL filter.
- **`server/src/services/sync.service.ts` `syncMemoriesV1`** — skip `MemoryType.Birthday` upserts
  for **every** client, alongside the existing #1013 non-fork-aware skip. Deletes are still sent
  (deleting an unknown id is a no-op on mobile).
- **`server/src/dtos/memory.dto.ts`** — keep the fork's free-form
  `data: z.record(z.string(), z.unknown())`. **Do not** adopt upstream's `MemoryDataDto` object
  schema: it would change `MemoryResponseDto.data` in the Dart client from a `Map` to a generated
  class (breaking `Map<String, dynamic>.from(dto.data)` in `memory_api.repository.dart`), and as a
  zod object it strips unknown keys, which would erase every rule memory's
  `ruleId`/`title`/`subtitle`/`context`. Port upstream's create-time rule into the fork's chain as a
  `superRefine` that emits **upstream's exact issues** —
  `{ path: ['data', 'personId' | 'personName'], message: 'Required for birthday memories' }` — so
  upstream's controller spec passes verbatim. The existing `OnThisDay` refine stays.
- **Web** — take upstream's `memoryLaneTitle` birthday branch in `web/src/lib/utils.ts` (dead code
  here: the list never returns a `birthday` row). In
  `e2e/src/ui/generators/memory/model-objects.ts` keep the fork's
  `as MemoryResponseDto['data']` — the fork's OpenAPI has no `OnThisDayDto`, so upstream's hunk
  removes an import the fork never had.

### Mobile

- **`mobile/lib/domain/models/memory.model.dart`** — `enum MemoryTypeEnum { onThisDay, rule, birthday }`,
  with a comment: Gallery appends `birthday` after the fork's `rule` because installed apps persist
  `rule` at index 1; upstream's order would reinterpret them.
- **Both switches over the generated `MemoryType`** — `sync_stream.repository.dart` (upstream's
  commit adds this case) and the fork-only `repositories/memory_api.repository.dart`
  `_toMemoryType` (upstream's commit cannot see it). The generated type is a real Dart `enum`, so a
  missing case is a compile error, not a runtime hole; both map
  `MemoryType.birthday => MemoryTypeEnum.birthday`. After this change the server never sends one,
  so these cases exist for exhaustiveness and forward compatibility.
- **`infrastructure/repositories/memory.repository.dart` `getAll`** — replace upstream's
  `equalsValue(MemoryTypeEnum.onThisDay)` with
  `isInValues([MemoryTypeEnum.onThisDay, MemoryTypeEnum.rule])` (drift 2.34,
  `GeneratedColumnWithTypeConverter.isInValues`). Identical to today's behaviour for every row the
  server can sync, and keeps a stray `birthday` row off the lane (`memory_card_text.dart` titles only
  `onThisDay` and rules).
- **No Drift migration or snapshot change.** The column stays `INTEGER`; the
  `mobile/drift_schemas/main/*.json` snapshots do not record enum members (verified: none contains
  `onThisDay`).

## Guards

`ci_invariants` in `docs/fork/ownership.yml` (substring match over the file; run by
`make ci-invariants-check`):

- `birthday-memory-generator-not-dispatched` — forbids `this.createBirthdayMemories(` in
  `server/src/services/memory.service.ts`.
- `mobile-memory-type-enum-order` — forbids upstream's ordering `"onThisDay,\n  birthday,"` in
  `mobile/lib/domain/models/memory.model.dart`.

The enum-order invariant only recognises upstream's exact text; the index test below catches any
other reordering.

## Test coverage

Every new behaviour gets a test proven red before the fix: revert the fix, watch the test fail,
restore it.

**Server — unit**

| Spec | Case | Red against |
|---|---|---|
| `controllers/memory.controller.spec.ts` | upstream's two birthday cases, **verbatim** (missing `personId`/`personName` → exact 400 issues; complete payload → 201) | no `superRefine` |
| `services/memory.service.spec.ts` `reconcileMemoryOverlap` (next to `F1`) | a `birthday` row sharing assets with an `on_this_day` card neither claims nor sinks it: no strip, no delete | no `Birthday` check in `isMemoryTypeVisible` (the `on_this_day` card is deleted) |
| `services/sync.service.spec.ts` (next to the #999 cases) | a `birthday` upsert is omitted for a fork-aware client (`MemoriesV1` + `SharedSpacesV1`) **and** for a non-fork-aware client; `on_this_day` and `rule` still sent to the fork-aware one | no `Birthday` skip |
| `utils/date.spec.ts` | upstream's `isLeapDayObserved` cases, verbatim | — |
| `services/memory.service.spec.ts` | upstream's `type: MemoryType.OnThisDay` edits, verbatim | — |

**Server — medium (real DB)**

| Spec | Case | Red against |
|---|---|---|
| `services/memory.service.spec.ts` | upstream's `describe('onMemoryCreate (birthday)')` — **12 cases, `describe.skip`** with a comment naming this spec: they assert upstream's generator, which is deliberately not dispatched. Re-enable in the change that adopts it. | — |
| `services/memory.service.spec.ts` | upstream's `should create a new birthday memory` (create path) — **kept running** | — |
| `services/memory.service.spec.ts` `onMemoryCreate` | with upstream's fixture shape (named person, `birthDate` = target day, assets on past birthdays): `onMemoriesCreate` writes **no** `type='birthday'` row, and the fork's birthday rule memory for that person is still written | the upstream dispatch line restored |
| `services/memory.service.spec.ts` `search` | a `birthday` memory owned by the user is absent from `search` and not counted by `statistics`; the same user's `on_this_day` and `rule` memories are present and counted; `get(id)` still returns the `birthday` row | no `accessibleSearchBuilder` filter |
| `sync/sync-memory.spec.ts` | a `birthday` memory produces no `MemoryV1` upsert through the real stream for a fork-aware client | no sync skip |
| `repositories/memory.repository.spec.ts`, `person.repository.spec.ts` | upstream's `getPersonBirthdayYears` / `getPersonAssetsByDate` / `forBirthdayMemories` cases, **kept running** — they keep the dormant queries honest against the fork schema for a future blend | — |

**Mobile**

| Test | Case | Red against |
|---|---|---|
| `test/domain/models/memory_model_test.dart` | `MemoryTypeEnum.onThisDay.index == 0`, `rule.index == 1`, `birthday.index == 2` | upstream's order |
| `test/medium/repositories/memory_repository_test.dart` | `getAll` returns `onThisDay` and `rule` memories and excludes a `birthday` one | upstream's `equalsValue(onThisDay)` (drops `rule`) |
| `test/domain/repositories/sync_stream_repository_test.dart` | a `SyncMemoryV1` with `MemoryType.birthday` upserts as `MemoryTypeEnum.birthday` | — (compile-enforced; pins the mapping) |
| `test/repositories/memory_api_repository_test.dart` | a `MemoryResponseDto` with `MemoryType.birthday` maps without throwing | — (compile-enforced; pins the mapping) |

Gates as for any mobile change: `mise //mobile:analyze` (`--fatal-infos`), `mise //mobile:format`,
`mise //mobile:test`.

## Adopting upstream's birthday later

Adopting (or blending) is a deliberate project, done in one change: delete
`birthday-memory-generator-not-dispatched`; un-skip upstream's `onMemoryCreate (birthday)` cases;
decide what happens to existing `type='rule', ruleId='birthday'` rows; and replace the
all-clients sync / list filter with a capability gate so only clients that decode `birthday`
receive it. The mobile enum order and its invariant stay for as long as any installed app holds
`rule` at index 1.

## Out of scope

- `scripts/revert-to-immich.sql` does not touch memory rows by type — pre-existing for `rule`
  memories as well; a `birthday` row is valid in Immich ≥ 3.3.
- Gallery apps older than #1033 and unfiltered `memory_asset` links (see Compatibility).

## Follow-ups

1. Blend: upstream's lead-up window + on-birthday photo selection with the fork's across-years
   fallback, under the fork's budget and toggles.
2. Space-aware birthdays: Space-shared photos (timeline-enabled Spaces) and Space people's
   birthdates — needs a decision between the two birthdate sources (see #808).
3. Mobile title for `MemoryTypeEnum.birthday` (only relevant once a client can receive one).
