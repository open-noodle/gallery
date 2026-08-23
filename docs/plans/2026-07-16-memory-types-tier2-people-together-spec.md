# Tier 2 Memory Type: `people_together` — Design & Test Spec

> Implements the first 🟡 Tier-2 rule from the
> [memory types roadmap](./2026-07-15-memory-types-roadmap.md) (#5, "You & [person]"),
> reframed to a **pair** memory: two people (or pets) often photographed together in a past
> year's copy of the current month.
> Approach: **test-driven, behavior-driven, full edge-case coverage.**
> Created 2026-07-16. Status: **spec — not yet implemented.**

## 1. Goal & non-goals

**Goal:** add one low-risk `MemoryRule` (`people_together`) that surfaces a pair of named
subjects who co-occur in many photos of the current calendar month in a past year — titled
`"Anna & Ben"`, subtitled `"18 photos together · June 2023"`. It reuses the shipped rule
engine, adds **one** new repository query and **one** pure curation helper, and needs **no
engine/service change** (the `visibleForDays` machinery it uses already shipped in Tier 1).

**Non-goals (this slice):**

- No "You & X" owner identification — the schema has no reliable account-owner→person mapping,
  so we do a **pair** (A & B), which needs no self-identification.
- No group (3+) memories — only the strongest **pair** per year surfaces.
- No ML, embeddings, tags, camera/gear grouping (later tiers).
- No localization of memory _content_ (titles/subtitles stay English, matching every existing
  rule). Settings _labels_ are localized.
- No change to the memory _viewer_ (web/mobile render rule memories generically).
- No change to `memory.service.ts`, `RULE_DAILY_LIMIT`, the per-day multi-day cap, or the
  generation/cleanup scheduling. `people_together` is a pure function of `(ownerId, target,
query rows)` and plugs into the existing machinery.

## 2. Design decisions (please confirm on review)

Each has a recommended default; flag any you want changed and I'll revise before implementation.

| ID  | Decision                     | Chosen default                                                                                                                      | Alternative                                                                |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| D1  | **Who is it about**          | A **pair** of named subjects (`A & B`)                                                                                              | "You & X" (needs a fragile "which person is me" heuristic — rejected)      |
| D2  | **Trigger cadence + window** | Date-anchored to **this calendar month in a past year**; fires on **day 20**, stays **visible 7 days** (`visibleForDays: 7`)        | Daily fire (breaks — see below); or first-together anniversary; or the 1st |
| D3  | **Qualifying threshold**     | **≥ 6 co-occurring photos** in the month-year **and ≥ 2 distinct days**                                                             | 10/3 (stricter, rarer) or 4/2 (looser, weaker "together" story)            |
| D4  | **Pets eligible**            | **Yes** — no `person.type` filter; allows `Anna & Rex` **and** `Rex & Whiskers` (pet–pet)                                           | Exclude pets; or require ≥ 1 human in the pair                             |
| D5  | **Query approach**           | One flat query returns **face rows**; pairing/curation happens in **TS** (`pairCounts`)                                             | SQL self-join returning pre-aggregated pairs                               |
| D6  | **Title name order**         | Ordered by **person id** (`a.id < b.id`) so title/`dedupeKey`/`context` agree and reruns are stable                                 | Alphabetical by name (ambiguous — two people can share a name)             |
| D7  | **Default enabled**          | `defaultEnabled: true`, `adminConfigurable: true`                                                                                   | Ship OFF by default (more conservative)                                    |
| D8  | **Scoring**                  | `100 + count*3 + recencyBonus(year, target.year)` — same family as `on_this_day_place`, so it competes fairly for the 2 daily slots | Any other numbers                                                          |

**Why a trigger day + window, not daily fire (D2 rationale — this is the subtle one):** the
`dedupeKey` is **month-level** (`people_together:a:b:2023-06`) because the memory is about the
whole month, not a single day (contrast `on_this_day_place`, whose key includes the day and
which legitimately regenerates daily). If the rule fired every day with `visibleForDays: 1`,
`hasRuleMemory` would let it insert on the first day it won a slot and then **block it for the
rest of the month** — the memory would flash for one arbitrary day and vanish. The shipped
recaps avoid this by firing on a **specific day with a multi-day window** (`month_recap`
day 1 / 7d, `favorites_throwback` day 15 / 7d). `people_together` joins that stagger on
**day 20 / 7d** — a free day so it never collides with `month_recap`'s single day-1 shot (the
per-day multi-day cap in `memory.service` allows only one multi-day rule to insert per day, so
sharing a trigger day would let the higher-scored rule starve the other, which only fires that
one day). Day 20 is a tunable constant, not load-bearing.

## 3. Architecture

```
memory.service.ts  (UNCHANGED — already honors visibleForDays and the per-day multi-day cap)
  └─ createRuleMemories → rule.evaluate({ ownerId, target })
        └─ PeopleTogetherMemoryRule            (id "people_together")
             → assetRepository.getMemoryFacesForPeriod(ownerId, { months, takenBefore })   [NEW]
             → curation.util: pairCounts (NEW), sampleAssetsByTime, medianTime, recencyBonus, monthName
```

The rule constructor takes only `Pick<AssetRepository, 'getMemoryFacesForPeriod'>` (like
`on_this_day_place` takes `Pick<…, 'getMemoryAssetsForPeriod'>`), keeping unit tests trivial to
mock. `hasRuleMemory(ownerId, ruleId, dedupeKey)` in the service already guarantees a given
(pair, year-month) memory inserts at most once, so the rule needs no `memoryRepository`.

### 3.1 New/changed files

**Server — source**

| File                                                | Change                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/repositories/asset.repository.ts`              | Add `getMemoryFacesForPeriod` + `MemoryPeriodFace` interface              |
| `src/services/memory-rules/curation.util.ts`        | Add `pairCounts` + `FaceRow`/`PairStat` types (join the existing helpers) |
| `src/services/memory-rules/people-together.rule.ts` | New rule                                                                  |
| `src/services/memory-rules/memory-type.metadata.ts` | Add 1 `MEMORY_TYPE_METADATA` entry (`people_together`)                    |
| `src/services/memory-rules/memory-type.registry.ts` | Import rule; add 1 `RULE_FACTORIES` entry                                 |

**Server — tests**

| File                                                      | Change                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `.../people-together.rule.spec.ts`                        | New (unit, BDD)                                                             |
| `.../curation.util.spec.ts`                               | Extend: `pairCounts` cases (§6.2)                                           |
| `.../memory-type.metadata.spec.ts`                        | Extend: assert `people_together` key, defaults, `getMemoryTypeKeyForMemory` |
| `.../memory-type.registry.spec.ts`                        | Extend: factory builds `PeopleTogetherMemoryRule` for the key               |
| `test/repositories/asset.repository.mock.ts`              | Add `getMemoryFacesForPeriod: vitest.fn()`                                  |
| `test/medium/specs/repositories/asset.repository.spec.ts` | New `describe('getMemoryFacesForPeriod')` medium test (real DB, §6.5)       |
| `test/medium/specs/services/memory.service.spec.ts`\*     | Add one end-to-end generation test for `people_together` (§6.6)             |

\* same medium spec that holds the Tier 1 `month_recap`/`on_this_day_place` generation tests;
match its existing shape.

**Web**

| File                                                       | Change                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| `src/routes/admin/system-settings/MemoriesSettings.svelte` | Add `'people_together'` to the hardcoded `memoryTypeKeys` array |
| `i18n/en.json`                                             | 4 new keys (admin label+desc, user label+desc)                  |

**Verify (no code expected):** mobile memory-type settings enumeration. Tier 1 concluded
mobile reads `availableMemoryTypes` and needs no per-type edit; re-confirm and record N/A, or
add the keys if that changed. Captured in §8.

## 4. New repository query — `getMemoryFacesForPeriod`

```ts
export interface MemoryPeriodFace {
  assetId: string;
  localDateTime: Date; // interpreted at UTC, matching getMemoryAssetsForPeriod
  year: number; // EXTRACT(year FROM localDateTime AT TIME ZONE 'UTC')::int
  personId: string;
  personName: string;
}

// asset.repository.ts
getMemoryFacesForPeriod(
  ownerId: string,
  options: {
    months: number[]; // 1..12, calendar months to include
    takenBefore: Date; // exclude current-day/future assets
  },
): Promise<MemoryPeriodFace[]>
```

**Query shape** (same spine as `getMemoryAssetsForPeriod`, joined through faces → people;
one row per (asset, named subject)):

- `asset` `INNER JOIN asset_face ON asset_face.assetId = asset.id`
  `INNER JOIN person ON person.id = asset_face.personId`.
- `asset.ownerId = ownerId`, `asset.visibility = Timeline`, `asset.deletedAt is null`.
- `EXISTS` a `Preview` `asset_file` (same guard the other memory queries use).
- `asset.localDateTime <= takenBefore`.
- `EXTRACT(MONTH FROM (localDateTime at time zone 'UTC')) = ANY(months)`.
- `asset_face.deletedAt is null`, `asset_face.isVisible = true`.
- `person.ownerId = ownerId`, `person.name != ''`, `person.isHidden = false`.
- **No `person.type` filter** — pets (`type = 'pet'`) qualify (D4).
- Select `asset.id as assetId`, `asset.localDateTime`, `year` (extracted), `person.id as
personId`, `person.name as personName`.
- Order by `asset.localDateTime` ascending (rules re-sort/sample anyway; keeps medium-test
  assertions readable).
- **No flat total `LIMIT`.** The rule derives per-year, per-pair counts from these rows to test
  thresholds (`>= 6`); a total cap ordered by time could silently drop whole year-groups and
  corrupt those counts. The slice is naturally bounded (one month, one owner) and runs in a
  background job. If a pathological library ever makes row count a problem, add a **per-year**
  lateral cap (like `getByDayOfYear`), never a flat total cap — noted in §8.
- Decorated with `@GenerateSql` (so `make sql` snapshots it) using `DummyValue`s.

The rule passes `takenBefore = target.endOf('day')` and **drops `year >= target.year`** in TS
(prior years only). `takenBefore` is a defensive guard against future-dated assets; the
year-drop is what excludes the current year.

## 5. Rule behavior

Shared conventions: `ruleId === metadata key === 'people_together'`. All constants below are the
values the tests pin; treat them as the spec's contract.

### 5.1 Curation helper — `pairCounts` (`curation.util.ts`)

Pure, dependency-free, unit-tested like the existing helpers.

```ts
// Structural input, decoupled from the repository type so curation.util stays
// dependency-free (MemoryPeriodFace is assignable to it).
export interface FaceRow {
  assetId: string;
  personId: string;
  personName: string;
  localDateTime: Date;
}

export interface PairStat {
  a: { id: string; name: string }; // ordered so a.id < b.id (stable, order-independent)
  b: { id: string; name: string };
  assets: { id: string; localDateTime: Date }[]; // assets containing BOTH, chronological
  distinctDays: number; // count of distinct UTC calendar days among those assets
}

export const pairCounts = (rows: FaceRow[]): PairStat[];
```

**Algorithm:**

1. Group rows by `assetId`; for each asset build the **set** of `{id, name}` subjects (a person
   with two faces on one asset collapses to one entry — no self-pair, no double count).
2. For every **unordered** pair of distinct subjects within an asset's set, key it by the two
   ids sorted ascending; accumulate the asset (`{id, localDateTime}`) under that pair.
3. For each pair, compute `distinctDays` = number of distinct UTC calendar days across its
   assets; sort each pair's `assets` chronologically.
4. Return `PairStat[]` sorted by `assets.length` **desc**, tie-broken by the ordered id pair
   (`` `${a.id}:${b.id}` `` ascending) so the result is deterministic across runs and input
   orderings.

Carrying timed assets (not just ids) lets the rule feed `sampleAssetsByTime`/`medianTime`
directly — no second lookup.

### 5.2 `people_together` rule (`people-together.rule.ts`)

```
id = 'people_together'
TRIGGER_DAY       = 20   // staggered after month_recap(1) & favorites(15)
MIN_ASSETS        = 6    // co-occurring photos in the month-year
MIN_DISTINCT_DAYS = 2    // not a single event
MAX_YEARS         = 2    // at most 2 candidates per run, strongest first
ASSET_CAP         = 8

evaluate({ ownerId, target }):
  # Guard FIRST — before touching the repository (asserted by the "no repo call" test)
  if target.day !== TRIGGER_DAY: return []

  rows = getMemoryFacesForPeriod(ownerId, {
    months: [target.month],
    takenBefore: target.endOf('day').toJSDate(),
  })

  byYear = group rows where row.year < target.year, keyed by row.year
  mm = zero-padded target.month
  candidates = []

  for [year, yearRows] of byYear:
    top = pairCounts(yearRows)[0]                 # strongest pair that year
    if !top: continue
    if top.assets.length < MIN_ASSETS: continue
    if top.distinctDays < MIN_DISTINCT_DAYS: continue

    count = top.assets.length
    candidates.push({
      ruleId: 'people_together',
      dedupeKey: `people_together:${top.a.id}:${top.b.id}:${year}-${mm}`,
      title: `${top.a.name} & ${top.b.name}`,                 # id-ordered (D6)
      subtitle: `${count} photos together · ${monthName(target.month)} ${year}`,
      score: 100 + count * 3 + recencyBonus(year, target.year),
      assetIds: sampleAssetsByTime(top.assets, ASSET_CAP),
      memoryAt: medianTime(top.assets),                        # representative moment
      visibleForDays: 7,
      context: { year, personAId: top.a.id, personBId: top.b.id, count },
    })

  return candidates.toSorted((l, r) => r.score - l.score).slice(0, MAX_YEARS)
```

**Worked score example (pinned in the spec test):** `count = 6`, `year = 2023`,
`target = 2026-06-20` → `recencyBonus(2023, 2026) = max(0, 10 - 3) = 7` →
`score = 100 + 18 + 7 = 125`.

**Per-day-cap interaction (already implemented in Tier 1 §3.2):** `people_together` is a
multi-day rule (`visibleForDays > 1`), so at most **one** of its `MAX_YEARS` candidates inserts
on the trigger day; the top-scored year wins, the runner-up is dropped that month (the rule
only fires on day 20). Emitting up to 2 is defensive — it gives the service a ranked fallback if
the top candidate collides with an already-inserted memory during a multi-day catch-up run.

## 6. Test plan (TDD / BDD)

### 6.0 TDD discipline (red → green → refactor per unit)

Build bottom-up in the §9 slice order so each unit is real before its consumer. For **every**
unit: write the spec, run it and watch it **fail for the right reason** (module/method/key
absent), implement the minimum to pass, refactor with the test green. A test that passes on its
first run isn't exercising the new behavior — treat that as a red flag.

### 6.1 Conventions (match the existing rule specs)

Write tests **first**. Mirror `on-this-day-place.rule.spec.ts` / `birthday.rule.spec.ts`:
construct the rule directly with an inline `vi.fn()` mock cast `as never` (no `newTestService`
for the rule unit), drive it with a fixed `DateTime.fromISO('2026-06-20', { zone: 'utc' })`
target — never `DateTime.now()` — and assert the candidate with `toMatchObject`, **including the
exact numeric `score`** (existing specs pin exact scores, e.g. `254`; ours pins `125` etc.).
Registry/metadata specs use their existing direct-import harnesses.

### 6.2 Unit — `pairCounts` (extend `curation.util.spec.ts`)

BDD (`describe` = "given …", `it` = "then …"):

- given an asset with **2** subjects → one pair with that asset.
- given an asset with **3** subjects → **3** pairs (all unordered combinations).
- given an asset with **1** subject → **no** pair (no self-pair).
- given one subject appearing via **two faces on the same asset** → counted once; produces no
  self-pair and does not inflate any pair's count.
- given the same pair across **3 assets on 2 calendar days** → `assets.length === 3`,
  `distinctDays === 2`, assets in chronological order.
- given two pairs with different counts → sorted by `assets.length` desc.
- given two pairs with **equal** counts → deterministic order by the ordered id pair.
- given rows in shuffled input order → identical output (order-independent); `a.id < b.id` always.
- given empty input → `[]`.

### 6.3 Unit — `people-together.rule.spec.ts`

- given `target.day !== 20` → emits `[]` and **does not** call the repo (guard-first).
- given day 20 and a prior-year copy of this month with a pair in **≥ 6 photos across ≥ 2 days**
  → one candidate; `title`/`subtitle`/`memoryAt`/`dedupeKey`/`score(125)`/`visibleForDays: 7`
  /`context` match §5.2.
- given a pair with **exactly 6** photos / **2** days → included (inclusive boundary).
- given a pair with **5** photos → that year skipped (`MIN_ASSETS`).
- given a pair with **6** photos all on **one day** → skipped (`MIN_DISTINCT_DAYS`).
- given two competing pairs in the same year → the **higher-count** pair wins that year.
- given qualifying pairs across **3** prior years → only the top **`MAX_YEARS (2)`**, score-sorted.
- given current/future-year rows (`year >= target.year`) → ignored (prior years only).
- given a **pet–pet** pair (both `type: 'pet'`) and a **person–pet** pair, each ≥ thresholds →
  both qualify (pets included, D4).
- given more than **8** co-occurring photos → `assetIds.length === 8`, chronological, evenly
  sampled.
- given the pair's rows in reversed input order → identical `dedupeKey`/`title` (id-ordering).
- given a newer and older year with equal count → newer outscores older (`recencyBonus`).
- given an empty face list / no pair clears the gate → `[]`.

### 6.4 Registry & metadata specs (extend existing)

- `memory-type.metadata.spec.ts`:
  - `people_together` present with `kind: 'rule'`, `defaultEnabled: true`, `adminConfigurable: true`.
  - `buildDefaultMemoryTypeMap()` includes `people_together → true`.
  - `getMemoryTypeKeyForMemory(MemoryType.Rule, { ruleId: 'people_together' })` → `'people_together'`.
  - `getAdminAvailableMemoryTypeKeys({})` (empty config) includes `people_together`.
  - `isMemoryTypeEnabledForUser(undefined, 'people_together')` → true.
- `memory-type.registry.spec.ts`:
  - `createMemoryRules(['people_together'], deps)` returns one `PeopleTogetherMemoryRule` with
    matching `id`.
  - a config omitting the key does not instantiate it.

### 6.5 Medium test — `getMemoryFacesForPeriod` (real DB)

Using `test/medium` (real Postgres via testcontainers), seed assets + faces + people with known
`localDateTime`, `person.name`, `person.type`, `person.isHidden`, `asset_face.isVisible`, then assert:

- `months` filter returns only in-month rows; multi-month `months` unions correctly.
- one row **per (asset, person)** — an asset with two named people yields two rows.
- `takenBefore` excludes later assets.
- `year` is the correct **UTC** year.
- excludes: unnamed people (`name = ''`), hidden people (`isHidden = true`), invisible faces
  (`asset_face.isVisible = false`), soft-deleted faces (`asset_face.deletedAt`), assets without a
  Preview file, deleted / non-Timeline assets, **another owner's** assets/people.
- **includes pets** (`person.type = 'pet'`) — a named pet's faces come back.
- results ordered by `localDateTime` ascending.

### 6.6 End-to-end generation medium test (real DB)

Mirror the Tier 1 `month_recap`/`on_this_day_place` generation tests in the medium
`memory.service` spec — proves the rule works through the actual generation path, not just in
isolation:

- **positive:** seed a past-year June where two named people co-occur in ≥ 6 photos across ≥ 2
  days; run the generation path with `target` on **2026-06-20**; assert a `people_together`
  memory is created with `showAt = 2026-06-20 00:00`, `hideAt = 2026-06-26 23:59:59` (7-day
  window), the expected asset set, and the `"A & B"` title.
- **negative:** the same library but only 5 co-occurring photos (or all on one day) → **no**
  `people_together` memory generated.

### 6.7 Edge cases consolidated (each must have a test)

| Edge case                                            | Owning test             | Expected                                     |
| ---------------------------------------------------- | ----------------------- | -------------------------------------------- |
| Wrong trigger day (`day !== 20`)                     | rule spec §6.3          | `[]`, **no repo call**                       |
| Empty library / no faces                             | rule spec §6.3          | `[]`                                         |
| Only current/future-year rows                        | rule spec §6.3          | `[]` (prior years only)                      |
| Pair below `MIN_ASSETS` (5)                          | rule spec §6.3          | year skipped                                 |
| Pair at exactly 6 photos / 2 days                    | rule spec §6.3          | included (inclusive boundary)                |
| 6 photos but a single day (`distinctDays < 2`)       | rule spec §6.3          | skipped                                      |
| More qualifying years than `MAX_YEARS`               | rule spec §6.3          | capped at 2, score-sorted                    |
| Co-occurring photos above `ASSET_CAP` (8)            | rule spec §6.3          | `assetIds` capped, chronological             |
| Two competing pairs same year                        | rule spec §6.3          | higher-count pair wins                       |
| Pair-count tie                                       | pairCounts §6.2         | deterministic (ordered id pair)              |
| One person, two faces on one asset                   | pairCounts §6.2         | counted once; no self-pair                   |
| Single subject on an asset                           | pairCounts §6.2         | no pair                                      |
| `dedupeKey`/title order-independence (pair symmetry) | pairCounts + rule       | identical key/title regardless of order      |
| Pets included (pet–pet, person–pet)                  | rule §6.3 + medium §6.5 | pairs qualify; pet faces returned            |
| Unnamed / hidden people, invisible/deleted faces     | medium §6.5             | excluded from rows                           |
| Another owner's people/assets                        | medium §6.5             | excluded                                     |
| Multi-day window (`hideAt` spans 7 days)             | generation §6.6         | `hideAt = showAt + 6d, endOf('day')`         |
| Per-day multi-day cap (only 1 of MAX_YEARS inserts)  | reasoned §5.2           | documented; Tier 1 §3.2 machinery            |
| Two people sharing a name                            | reasoned §2 D6          | title id-ordered; accepted (`"Anna & Anna"`) |

## 7. Verification gates (before PR)

- `cd server && pnpm test -- --run src/services/memory-rules/` → rule + `pairCounts` +
  registry/metadata specs green.
- `pnpm test:medium` for the new repo query **and** the generation test (Docker DB up).
- `make sql` (DB up) → regenerate the `getMemoryFacesForPeriod` SQL snapshot; commit it.
  **Never run `make sql` without a running DB** — it deletes query files.
- `make check-server` (tsc) + `make lint-server` + `prettier --check` on **every** modified
  server file (source included — eslint-green ≠ prettier-green).
- Web: from `web/`, `check:typescript` + `check:svelte` + `pnpm lint`.
- **i18n completeness:** all 4 new `en.json` keys must exist — the settings components read them
  via `$t(...)`, so a missing key renders a **blank label at runtime, not a compile error**.
  Grep each of the 4 keys after editing. Only `en.json` is required; other locales fall back.
- `prettier --write` on this doc under `docs/plans/` (Docs CI is strict).
- **No e2e added** — parity with `birthday`/`recent_trip` and the Tier 1 rules (unit + medium,
  no dedicated e2e). Add one later only if the generation path regresses.
- Manual smoke (optional): `make dev`, enable the type, seed a library where two named people
  co-occur in a past-year copy of the current month, run the `MemoryGenerate` job with the
  clock at day 20, confirm the memory appears and the toggle hides it.

## 8. Open tasks / follow-ups

- [ ] Confirm §2 design decisions (esp. **D2** trigger day 20 + 7-day window, **D4** pet–pet
      pairs allowed, **D3** 6/2 thresholds).
- [ ] Re-verify mobile memory-type settings enumeration; Tier 1 found it reads
      `availableMemoryTypes` (no per-type edit). Record N/A or add keys if that changed.
- [ ] Out of scope unless profiling demands it: the query filters `extract(month …)`, which the
      existing `date_trunc('MONTH', …)` functional index does **not** serve, and adds
      `asset_face`/`person` joins — so it scans the owner's Timeline faces for the month and
      filters in-heap (background job, low cadence — acceptable). If a huge library makes this
      hurt, add a matching functional index and/or a **per-year** lateral `LIMIT` (never a flat
      total cap, §4).
- [ ] Possible future extension: require ≥ 1 human in the pair, or add group (3+) memories —
      both out of scope now (D4 / §1).

## 9. Implementation slices (for `/impl-loop`)

Each slice is independently implementable and leaves the tree **green and shippable**.
Foundations (Slices 1–2) land first because the rule depends on them; Slice 3 wires the rule
end-to-end (rule → registry → metadata → admin toggle → i18n) so enabling it produces a working,
user-visible memory type; Slice 4 proves it through the real generation path and closes parity.

**TDD is mandatory in every slice:** write the spec, run it and confirm it **fails red for the
intended reason**, implement the minimum to pass, confirm **green**, then refactor with tests
green. Assert **exact** `score` values (per the `birthday`/`on_this_day_place` convention).
Detail for each item lives in the referenced §sections; this section defines scope, order,
dependencies, and done-criteria only.

### Slice 1 — `pairCounts` curation helper

- **Deps:** none (pure function).
- **Build:** `pairCounts` + `FaceRow`/`PairStat` types in `curation.util.ts` (§5.1); extend
  `curation.util.spec.ts` with the §6.2 cases.
- **Red→green:** the new `pairCounts` cases fail (no export) → implement → green.
- **Verify:** `cd server && pnpm test -- --run src/services/memory-rules/curation.util.spec.ts`; `make check-server`.
- **Done:** `pairCounts` spec green; exported signatures match §5.1.
- **Commit:** `feat(memories): pairCounts curation helper for people-together`.

### Slice 2 — `getMemoryFacesForPeriod` query

- **Deps:** none. Enables the rule.
- **Build:** `MemoryPeriodFace` + `getMemoryFacesForPeriod` in `asset.repository.ts` (§4); add
  `getMemoryFacesForPeriod: vitest.fn()` to `asset.repository.mock.ts`; new
  `describe('getMemoryFacesForPeriod')` medium test (§6.5).
- **Red→green:** medium test fails (no method) → implement → green.
- **Verify:** `pnpm test:medium` (Docker DB up) for the new describe; `make sql` (DB up) to
  snapshot the query — **never without a running DB**; commit the snapshot; `make check-server`.
- **Done:** medium test green (incl. pet-inclusion + exclusion filters); mock updated; SQL
  snapshot committed.
- **Commit:** `feat(memories): getMemoryFacesForPeriod repository query`.

### Slice 3 — `people_together` rule (end-to-end)

- **Deps:** Slices 1, 2.
- **Build:** `people-together.rule.ts` + `people-together.rule.spec.ts` (§5.2, §6.3, edge cases
  §6.7); register in `memory-type.registry.ts` (`RULE_FACTORIES` + import) and
  `memory-type.metadata.ts` (`MEMORY_TYPE_METADATA`, `defaultEnabled: true`); extend
  `memory-type.registry.spec.ts` + `memory-type.metadata.spec.ts` (§6.4); add `'people_together'`
  to `memoryTypeKeys` in `MemoriesSettings.svelte`; add the 4 `en.json` keys (§7 i18n gate).
- **Red→green:** rule spec fails (no rule) → implement rule green → wire registry/metadata
  (their specs green) → web/i18n.
- **Verify:** rule + registry/metadata specs green; `make check-server`; from `web/`:
  `check:typescript` + `check:svelte` + `pnpm lint`; grep the 4 i18n keys exist.
- **Done:** unit + registry/metadata green; the admin toggle renders a real (non-blank)
  label/description.
- **Commit:** `feat(memories): people-together memory type`.

### Slice 4 — Generation test, mobile parity, full gate & roadmap status

- **Deps:** Slice 3.
- **Build:** the end-to-end generation medium test (§6.6, positive + negative); re-verify the
  §3.1 mobile enumeration (edit if it hardcodes a list, else record "no change needed"); flip
  #5 to **Shipped — `people_together`** in the
  [roadmap](./2026-07-15-memory-types-roadmap.md) and link this spec (mirroring the Tier 1 rows).
- **Verify:** the full §7 gate — `pnpm test:medium` (generation test), `make check-server`,
  `make lint-server`, `prettier --check` on all modified server files, web checks, docs prettier.
- **Done:** whole suite green; generation proven end-to-end; mobile parity resolved (edited or
  explicitly N/A); roadmap updated.
- **Commit:** `chore(memories): people-together generation test + roadmap status`.

### Slice dependency graph

```
1 pairCounts ─┐
              ├─→ 3 rule (end-to-end) ─→ 4 generation test + mobile/docs
2 query ──────┘
```

Slices 1 and 2 have no interdependencies and may be built in any order (or parallel); 3 requires
1 + 2; 4 requires 3.
