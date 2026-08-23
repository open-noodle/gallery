# Slice 7 — `themed` memory type (end-to-end)

Spec: `docs/plans/2026-07-19-memory-types-tier3-spec.md` §3.4, §3.4.1, §4.2, §6.4, Slice 7.
Depends on Slice 6 (catalog, port, adapter, `themeMaxDistance`). Registers the **11th** key.

## Part A — the rule (TDD)

### A1. RED — `server/src/services/memory-rules/themed.rule.spec.ts` (new)

Dependency is the **port**, so the fake is trivial:

```ts
const port = {
  resolveEmbedding: vi.fn().mockResolvedValue('embedding-string'),
  searchByEmbedding: vi.fn().mockResolvedValue([...]),
};
```

Cases (spec §6.4 — all of them):

1. **Trigger day** — `[]` on days 1, 8, 15, 21, 23; fires on **22**.
2. **Fires** — pinned `title` `'Sunsets from 2023'`, `subtitle` `'18 photos'`, exact `score`,
   `dedupeKey` `'themed:sunset:2023'`, `visibleForDays: 5`, `ruleId: 'themed'`.
   Pick a `target` month whose `themeForMonth` is `sunset` (month 1 or 7 — verify against the
   catalog) so the title is deterministic.
3. **Disabled path** — `resolveEmbedding` → `null` ⇒ `[]` **and `searchByEmbedding` never called**.
4. **Rejection is swallowed** — `resolveEmbedding` rejects ⇒ `[]`, no throw.
5. **Year filter (§3.4.1)** — _Given_ the port returns assets whose `localDateTime` is in `Y-1`,
   `Y`, and `Y+1`, _Then_ only the `Y` ones are counted, `count`/subtitle reflect the filtered set,
   and `MIN_ASSETS` is applied **after** filtering: a year returning 8 raw assets of which only 7
   are in-year does **NOT** fire.
6. **MIN_ASSETS boundary pair** — 7 in-year ⇒ `[]`; exactly 8 ⇒ fires.
7. Searches exactly `MAX_YEARS_BACK` (3) years, never the current year — assert the
   `searchByEmbedding` call count and the year bounds passed.
8. **Multi-year** — two qualifying years ⇒ **BOTH** candidates returned, sorted by score desc,
   capped at `MAX_CANDIDATES` (3). This is the review-#4 regression guard: a 1-candidate rule would
   make older years permanently unreachable once the newest year's memory exists, because
   `hasRuleMemory` filtering happens in the engine **after** the rule returns.
9. **Non-tautological ordering** — _Given_ the port returns assets in **similarity** (deliberately
   non-chronological) order, _Then_ `assetIds` equals a **pinned** array that is chronological and
   capped at `ASSET_CAP` (16). Proves `sampleAssetsByTime` reordered them.
10. Passes `size: FETCH_SIZE` (40) and **`Date`** (not Luxon `DateTime`) bounds to the port.
11. **Zero assets** — port returns `[]` ⇒ `[]`, no throw (guards `medianTime([])`).

Run: `cd server && pnpm test --run src/services/memory-rules/themed.rule.spec.ts`
**Expected red:** module not found.

### A2. GREEN — `server/src/services/memory-rules/themed.rule.ts` (new)

Follow spec §4.2. **Export the constants**: `TRIGGER_DAY = 22`, `MAX_YEARS_BACK = 3`,
`FETCH_SIZE = 40`, `MIN_ASSETS = 8`, `ASSET_CAP = 16`, `VISIBLE_FOR_DAYS = 5`,
`MAX_CANDIDATES = 3`, `SCORE_BASE = 70`.

```ts
export class ThemedMemoryRule implements MemoryRule {
  readonly id = 'themed';
  constructor(private themeSearchPort: ThemeSearchPort) {}
}
```

Algorithm:

1. `if (target.day !== TRIGGER_DAY) return []`
2. `const theme = themeForMonth(target.month)`
3. `const embedding = await this.themeSearchPort.resolveEmbedding(theme.key, theme.query)`;
   `if (embedding === null) return []`
4. For `Y` from `target.year - 1` down to `target.year - MAX_YEARS_BACK`:
   - `takenAfter = DateTime.utc(Y, 1, 1).startOf('day')`,
     `takenBefore = DateTime.utc(Y, 12, 31).endOf('day')` — **no `min(..., target)` clamp**, the
     year range already excludes the current year (dead code, spec review #11).
   - `const assets = await port.searchByEmbedding({ ownerId, embedding, takenAfter: takenAfter.toJSDate(), takenBefore: takenBefore.toJSDate(), size: FETCH_SIZE })`
   - **filter by `localDateTime` year**:
     `assets.filter((a) => DateTime.fromJSDate(a.localDateTime, { zone: 'utc' }).year === Y)`
   - `if (filtered.length < MIN_ASSETS) continue`
5. Candidate per spec §4.2's table; `count = filtered.length` (pre-`ASSET_CAP`).
   Sort by score desc, `.slice(0, MAX_CANDIDATES)`.

The rule never sees `maxDistance` — the adapter owns it.

## Part B — wire the port through `MemoryService`

`server/src/services/memory-rules/memory-type.registry.ts`:

- `MemoryRuleDeps` gains `themeSearchPort: ThemeSearchPort`.
- `themed: (deps) => new ThemedMemoryRule(deps.themeSearchPort)`.
- ⚠️ `memory-type.registry.spec.ts` builds a `deps` object — it must now include a
  `themeSearchPort` stub, or every registry test fails to compile.

`server/src/services/memory.service.ts`:

- Add a memoized field + an **overridable factory** so the Slice-8 medium test can inject a stub
  without a live ML service (spec §6.8):

```ts
private themeSearchPort?: ThemeSearchPort;

/** Overridable seam: the medium test subclasses MemoryService to inject a stub. */
protected createThemeSearchPort(): ThemeSearchPort {
  return new MemoryThemeSearchAdapter(
    this.machineLearningRepository,
    this.searchRepository,
    () => this.getConfig({ withCache: true }),
    this.logger,
  );
}

private getThemeSearchPort(): ThemeSearchPort {
  this.themeSearchPort ??= this.createThemeSearchPort();
  return this.themeSearchPort;
}
```

- In `getMemoryRules` (line ~115), add `themeSearchPort: this.getThemeSearchPort()` to the deps
  object passed to `createMemoryRules`.

**Memoization matters:** the field is per-service-instance and the adapter holds the embedding
cache, so a theme is encoded once per process rather than once per user per night.

`this.machineLearningRepository` (`base.service.ts:187`) and `this.searchRepository` (`:200`) are
already injected on `BaseService`; no constructor plumbing needed.

⚠️ **Regression guard:** existing `memory.service.spec.ts` tests `vi.spyOn` the private
`getMemoryRules` / `createRuleMemories` with **arg-agnostic** mocks — they must stay green
**unchanged**. Confirm with `git diff --stat` on that file being empty.

## Part C — register the type at all 16 sites

One new key `themed`, appended **last**. Expected `availableMemoryTypes` (**11**):

```
on_this_day, birthday, recent_trip, month_recap, favorites_throwback, on_this_day_place,
season_recap, people_together, video_moments, trip_anniversary, themed
```

Same 16 sites as Slice 2 (see that plan's Part B map). `memory-type.metadata.spec.ts` has **5**
hardcoded list assertions; `preferences.spec.ts` has **2**; `server.service.spec.ts` has **2**.

i18n (`i18n/en.json`):

```
"memory_type_themed": "Themes"
"memory_type_themed_description": "Photo themes like sunsets, food, and beach days, found automatically."
"admin.memory_type_themed_setting": "Themes"
"admin.memory_type_themed_setting_description": "Group photos by visual theme using smart search. Requires smart search to be enabled."
```

Roadmap row **#7** Status → **Shipped** — `themed`.

## Verification

```bash
cd server && pnpm test --run src/services/memory-rules/ src/services/memory.service.spec.ts
cd server && pnpm test --run src/utils/preferences.spec.ts src/services/server.service.spec.ts
cd server && pnpm run check
cd server && npx eslint src/services/ --max-warnings 0
cd server && npx prettier --check "src/services/memory-rules/**" src/services/memory.service.ts
cd web && pnpm test --run src/routes/admin/system-settings/MemoriesSettings.spec.ts
npx prettier --check "docs/**/*.md" "i18n/en.json"
```

Then the **full** server suite: `cd server && pnpm test --run`.

## Out of scope

No medium test (Slice 8). No calibration (Slice 8).

## Commit

`feat(memories): add themed memory type backed by smart search`
