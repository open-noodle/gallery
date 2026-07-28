# Slice 2 — Remaining EXIF suggestion types + retire `getExifField` (#858)

- **Spec:** `docs/superpowers/specs/2026-07-26-second-level-filter-narrowing-858-design.md` § "Slice 2"
- **Branch:** `fix/858-second-level-filter-narrowing`
- **Depends on:** Slice 1 (commit `b24866b7c66`), which already moved `getCameraModels` onto
  `buildFilteredAssetIds` and widened `GetCameraModelsOptions`. Follow that commit as the template.
- **Scope:** `server/src/repositories/search.repository.ts` + its two test files + the generated SQL.

## Outcome

`getCameraMakes`, `getCameraLensModels`, `getCountries` and `getStates` narrow by the full active filter set,
exactly like `getCameraModels` and `getCities`. `getExifField` — the second, divergent scope path that let
#858 survive #436 — is deleted, leaving `buildFilteredAssetIds` as the single scope implementation.

## Out of scope

- `SearchSuggestionRequestDto` (`city` / `mediaType`) → Slice 3.
- Anything under `web/` or `mobile/` → Slice 4 / non-goal.
- `getCities` and `getCameraModels` — already correct. Do not touch them.
- `applySuggestionScope` and the `ExifSuggestionScopeOptions` interface — **keep both**. Only the
  `getExifField` method goes; `applySuggestionScope` is still used by `buildFilteredAssetIds` and its
  parameter type is `ExifSuggestionScopeOptions`.

---

## Step 1 (RED) — Medium repository tests

**File:** `server/test/medium/specs/repositories/search.repository.spec.ts`

Reuse the module-scope `newCanonPair` helper added in Slice 1 where a Canon pair is convenient. Add four new
`describe` blocks after the existing `describe('getCameraModels (#858)')` block, keeping the established
per-test `setup()` + `ctx.newUser()` shape.

### `describe('getCameraMakes (#858)')`

| #   | `it(...)`                                              | Fixture                                                                              | Options                           | Expect               |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------- | -------------------- |
| 2.1 | `narrows makes by an active tag filter`                | Canon asset tagged `nature`; Nikon asset untagged                                    | `{ tagIds: [nature.id] }`         | `['Canon']`          |
| 2.2 | `narrows makes by rating and the favourite filter`     | Canon asset `rating: 5` + `isFavorite: true`; Nikon asset `rating: 2`, not favourite | `{ rating: 4, isFavorite: true }` | `['Canon']`          |
| 2.3 | `does not self-narrow when a make is already selected` | Canon asset + Nikon asset                                                            | `{ make: 'Canon' }`               | `['Canon', 'Nikon']` |
| 2.4 | `still narrows by the sibling model`                   | Canon/`Canon EOS R5`, Nikon/`Nikon Z8`                                               | `{ model: 'Nikon Z8' }`           | `['Nikon']`          |
| 2.5 | `returns nothing when forceEmptyResult is set`         | Canon asset                                                                          | `{ forceEmptyResult: true }`      | `[]`                 |

### `describe('getCountries (#858)')`

| #    | `it(...)`                                                 | Fixture                                                    | Options                   | Expect                  |
| ---- | --------------------------------------------------------- | ---------------------------------------------------------- | ------------------------- | ----------------------- |
| 2.6  | `narrows countries by an active tag filter`               | asset in Germany tagged `nature`; asset in France untagged | `{ tagIds: [nature.id] }` | `['Germany']`           |
| 2.7a | `does not self-narrow when a country is already selected` | Germany + France assets                                    | `{ country: 'Germany' }`  | `['France', 'Germany']` |
| 2.7b | `does not self-narrow when a city is already selected`    | Berlin/Germany + Paris/France assets                       | `{ city: 'Berlin' }`      | `['France', 'Germany']` |

> 2.7b is the reason `getCountries` excludes `city` as well as `country` (spec §3.2): keeping `city` applied
> would collapse the country list to Germany and make the country selector unusable.

### `describe('getStates (#858)')`

| #    | `it(...)`                                              | Fixture                                                                                                            | Options                                  | Expect                  |
| ---- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------- |
| 2.8a | `narrows states by an active tag filter`               | asset `country: 'Germany', state: 'Berlin'` tagged `nature`; asset `country: 'Germany', state: 'Bavaria'` untagged | `{ tagIds: [nature.id] }`                | `['Berlin']`            |
| 2.8b | `still narrows by the parent country`                  | `Germany/Berlin` + `France/Ile-de-France`                                                                          | `{ country: 'Germany' }`                 | `['Berlin']`            |
| 2.8c | `does not self-narrow when a city is already selected` | `Germany/Berlin/Berlin` + `Germany/Bavaria/Munich`                                                                 | `{ country: 'Germany', city: 'Berlin' }` | `['Bavaria', 'Berlin']` |

### `describe('getCameraLensModels (#858)')`

| #    | `it(...)`                                     | Fixture                                                                                        | Options                                    | Expect         |
| ---- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------- |
| 2.9a | `narrows lens models by an active tag filter` | Canon asset `lensModel: 'RF 24-70'` tagged `nature`; Canon asset `lensModel: 'EF 50'` untagged | `{ tagIds: [nature.id] }`                  | `['RF 24-70']` |
| 2.9b | `still narrows by make and model`             | `Canon`/`Canon EOS R5`/`RF 24-70` and `Canon`/`Canon EOS 7D`/`EF 50`                           | `{ make: 'Canon', model: 'Canon EOS 7D' }` | `['EF 50']`    |

### Visibility + shape (2.10 / 2.11)

One `it` per method — four tests total, mirroring the existing `getCameraMakes (LOW #7)` test. For each of
`getCameraMakes`, `getCountries`, `getStates`, `getCameraLensModels`:

`it('keeps the not-locked visibility semantics')` — a Timeline asset, an Archive asset and a Locked asset
each with a distinct value for the field; call with `{ visibility: 'not-locked' }`; assert the returned array
`toEqual` the two non-locked values **in ascending order** (which also covers 2.11's sorted + distinct
requirement) and `not.toContain` the locked-only value.

Pick values whose sort order is unambiguous, e.g. makes `ArchivedMake` / `Sony` / `LockedMake`,
countries `Austria` / `Germany` / `Spain`.

Additionally, one distinctness test:

`it('returns distinct makes when several assets share a make')` — three Canon assets → `['Canon']`.

### Run — expect RED

```bash
cd server
pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/search.repository.spec.ts
```

**Expected red:** every test that narrows by `tagIds`, `rating`, `isFavorite` or `forceEmptyResult`
(2.1, 2.2, 2.5, 2.6, 2.8a, 2.9a) plus the two self-narrow tests that depend on the new exclusion semantics
(2.7b for `city`, 2.8c for `city`). Characteristic failure: the unfiltered list, e.g.

```
AssertionError: expected [ 'Canon', 'Nikon' ] to deeply equal [ 'Canon' ]
```

**Expected already-green** (behaviour the change must preserve, not contrive into failing): 2.3, 2.4, 2.7a,
2.8b, 2.9b, and the four visibility tests. Report the actual split you observe — as in Slice 1, the
prediction here is a guide, not a contract. If a test you expected red is green, verify from the current
source _why_ (usually: `getExifField` already applied that dimension) and say so; do not modify the test to
force a red.

---

## Step 2 (GREEN) — Implementation

**File:** `server/src/repositories/search.repository.ts`

### 2a. Widen the three remaining option interfaces

```ts
export interface GetStatesOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {
  state?: string;
}

export interface GetCameraMakesOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {
  lensModel?: string;
}

export interface GetCameraLensModelsOptions extends SuggestionScopeOptions, FilterSuggestionFilterOptions {
  lensModel?: string;
}
```

`make`, `model`, `country` and `city` now come from `FilterSuggestionFilterOptions` — delete the duplicate
declarations that are currently inline in these interfaces.

### 2b. Reroute the four methods

Follow Slice 1's `getCameraModels` exactly: `buildFilteredAssetIds` for the asset-id subquery, then a
`selectFrom('asset_exif').select(field).distinct().where('assetId','in',filteredIds)` with the not-null /
not-empty guards, any non-facet param on the outer select, and `orderBy(field)`.

```ts
async getCountries(userIds: string[], options: FilterSuggestionsOptions = {}): Promise<string[]> {
  // #858: mirror getFilterSuggestions' own getFilteredCountries — `city` is excluded alongside
  // `country`, because a selected city implies its country and would collapse this list to one row.
  const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'country', 'city'));
  const res = await this.db
    .selectFrom('asset_exif')
    .select('country')
    .distinct()
    .where('assetId', 'in', filteredIds)
    .where('country', 'is not', null)
    .where('country', '!=', '')
    .orderBy('country')
    .execute();

  return res.map((row) => row.country!);
}

@GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING] })
async getStates(userIds: string[], options: GetStatesOptions): Promise<string[]> {
  // `country` stays applied (it is the drill-down parent); `city` is excluded for the same reason
  // as in getCountries. `state` is not a FilterSuggestionFilterOptions key, so it never self-narrows.
  const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'city'));
  const res = await this.db
    .selectFrom('asset_exif')
    .select('state')
    .distinct()
    .where('assetId', 'in', filteredIds)
    .where('state', 'is not', null)
    .where('state', '!=', '')
    .orderBy('state')
    .execute();

  return res.map((row) => row.state!);
}

@GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING, DummyValue.STRING] })
async getCameraMakes(userIds: string[], options: GetCameraMakesOptions): Promise<string[]> {
  const filteredIds = this.buildFilteredAssetIds(userIds, without(options, 'make'));
  const res = await this.db
    .selectFrom('asset_exif')
    .select('make')
    .distinct()
    .where('assetId', 'in', filteredIds)
    .where('make', 'is not', null)
    .where('make', '!=', '')
    .$if(!!options.lensModel, (qb) => qb.where('lensModel', '=', options.lensModel!))
    .orderBy('make')
    .execute();

  return res.map((row) => row.make!);
}

@GenerateSql({ params: [[DummyValue.UUID], DummyValue.STRING] })
async getCameraLensModels(userIds: string[], options: GetCameraLensModelsOptions): Promise<string[]> {
  // `lensModel` is not a FilterSuggestionFilterOptions key, so nothing to exclude — `make` and
  // `model` are applied inside buildFilteredAssetIds, replacing the old outer $if clauses.
  const filteredIds = this.buildFilteredAssetIds(userIds, options);
  const res = await this.db
    .selectFrom('asset_exif')
    .select('lensModel')
    .distinct()
    .where('assetId', 'in', filteredIds)
    .where('lensModel', 'is not', null)
    .where('lensModel', '!=', '')
    .orderBy('lensModel')
    .execute();

  return res.map((row) => row.lensModel!);
}
```

Removals to make while doing this:

- `getCameraMakes`: drop the outer `.$if(!!options.model, …)` — `buildFilteredAssetIds` applies `model` now.
- `getCameraLensModels`: drop both outer `.$if(!!options.make, …)` and `.$if(!!options.model, …)`.
- `getStates`: drop the outer `.$if(!!options.country, …)` — applied inside now.
- Keep every `@GenerateSql` decorator exactly as it is today. `getCountries` has none — do not add one.

### 2c. Delete `getExifField`

Remove the whole private method (currently `search.repository.ts:1307-1342`). After Step 2b it has no
callers.

Keep `ExifSuggestionScopeOptions` — `applySuggestionScope(qb, userIds, options?: ExifSuggestionScopeOptions)`
still uses it.

### Run — expect GREEN

```bash
cd server
pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/search.repository.spec.ts
pnpm check
```

---

## Step 3 — Retire the `getExifField` unit tests

**File:** `server/src/repositories/search.repository.spec.ts`

`getExifField` existed as a **second scope path** that had to be manually kept in sync with
`buildFilteredAssetIds`, so five unit tests assert RBAC properties against it. Each has an exact
`buildFilteredAssetIds` twin asserting the identical property, so deleting them loses zero coverage — that
is precisely the win of collapsing to one path.

Delete these five `it(...)` blocks and the now-unused `compileExifField` helper (line 36):

| Delete (`getExifField`)                                                               | Surviving twin (`buildFilteredAssetIds`)                                                       |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `filters dependent EXIF suggestions to assets without album membership` (L457)        | `filters suggestion asset ids to assets without album membership` (L443)                       |
| `filters dependent EXIF suggestions to assets with album membership` (L480)           | `filters suggestion asset ids to assets with album membership` (L465)                          |
| `getExifField widens album scope to album participants, …` (L533)                     | `buildFilteredAssetIds widens album scope to album participants, …` (L519)                     |
| `getExifField adds timeline-enabled direct and linked-library spaces …` (L560)        | `buildFilteredAssetIds adds timeline-enabled direct and linked-library …` (L546)               |
| `getExifField gates album_user participant arm on Archive+Timeline visibility` (L589) | `buildFilteredAssetIds gates album_user participant arm on Archive+Timeline visibility` (L575) |

**Before deleting, verify each twin exists and passes** — run the file and confirm the twin names appear in
the passing list. If any twin is missing, STOP and report: the coverage is not actually duplicated and the
plan needs revising.

Line numbers are pre-edit references; match on test name, not on line number.

```bash
cd server
pnpm exec vitest run --config test/vitest.config.mjs src/repositories/search.repository.spec.ts
```

Expect the file to pass with 5 fewer tests than before (was 49).

---

## Step 4 — Regenerate the SQL docs

`getStates`, `getCameraMakes` and `getCameraLensModels` all carry `@GenerateSql`, so
`server/src/queries/search.repository.sql` changes. CI's `sql-schema-up-to-date` job fails on a stale file.

**Do NOT run `mise sql` yourself** — it `rm -rf`s `server/src/queries/` first and needs a live DB. Report
that Step 4 is pending and let the orchestrator run it, exactly as in Slice 1.

For reference, the orchestrator runs:

```bash
cd server && pnpm build && node ./dist/bin/sync-sql.js
git diff --stat -- server/src/queries/
```

and verifies only `search.repository.sql` changed, with the three blocks taking the same
`where "assetId" in (select "asset"."id" …)` shape `getCities` / `getCameraModels` already have.

---

## Step 5 — Validate

```bash
cd server && pnpm check && pnpm lint && pnpm format
pnpm exec vitest run --config test/vitest.config.mjs
pnpm exec vitest run --config test/vitest.config.medium.mjs test/medium/specs/repositories/search.repository.spec.ts
grep -rn "getExifField" server/src   # must return nothing
```

The full unit suite matters here: `getCountries` / `getStates` / `getCameraMakes` /
`getCameraLensModels` are reachable from `search.service.spec.ts`, and the signature widening could surface
type errors elsewhere.

---

## Definition of done

- [ ] ~20 new medium tests across four `describe` blocks, all green; red/green split reported honestly
- [ ] Four methods rerouted onto `buildFilteredAssetIds` with the documented exclusions
- [ ] `getExifField` deleted; `grep -rn "getExifField" server/src` returns nothing
- [ ] `ExifSuggestionScopeOptions` and `applySuggestionScope` kept
- [ ] Five `getExifField` unit tests + `compileExifField` helper deleted, twins verified passing first
- [ ] Existing `getCameraMakes (LOW #7)` and `getAccessibleTags (LOW #7)` tests still green, unmodified
- [ ] `pnpm check && pnpm lint && pnpm format` clean; full server unit suite green
- [ ] SQL regen left to the orchestrator (Step 4 reported as pending)
- [ ] Nothing committed — the orchestrator reviews, regenerates SQL and commits
