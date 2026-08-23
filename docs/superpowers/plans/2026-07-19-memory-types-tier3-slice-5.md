# Slice 5 — `trip_anniversary` + shared place-day dedupe

Spec: `docs/plans/2026-07-19-memory-types-tier3-spec.md` §3.3, §4.1, §6.3, Slice 5.
Depends on Slice 4 (`trip.util.ts`). Registers the **10th** memory type key.

## Part A — change `on_this_day_place` (do this FIRST, it is the dedupe contract)

File: `server/src/services/memory-rules/on-this-day-place.rule.ts`. **Three** changes:

1. **Use the canonical place key.** Delete the local
   `const placeKeyOf = (asset) => \`${asset.country ?? ''}:${asset.city}\`.toLowerCase()`(line 5) and
use`placeKeyOf(asset.country, asset.city)`from`src/services/memory-rules/trip.util`.
2. **Shared dedupe namespace.** `dedupeKey` becomes
   `` `place_day:${year}-${mm}-${dd}:${dominant.key}` `` (was `on_this_day_place:...`).
3. **Cap the count term.** `score: 100 + Math.min(count, 30) * 3 + recencyBonus(year, target.year)`.
   Without the cap the score is unbounded and a heavily-photographed day beats `trip_anniversary`
   exactly when the trip was well documented — inverting §3.3's precedence.

Also **export the constants** (spec D8) so the invariant test can import them:
`MIN_ASSETS = 4`, `MIN_DOMINANCE = 0.6`, `MAX_YEARS = 3`, `ASSET_CAP = 8`, `SCORE_BASE = 100`,
`MAX_COUNT_BONUS = 30`.

Update `on-this-day-place.rule.spec.ts` for the new key format and capped score **only** — no other
assertion changes. Add one case: a year with `count = 40` scores the same as `count = 30` (proves the cap).

## Part B — the rule (TDD)

### B1. RED — `server/src/services/memory-rules/trip-anniversary.rule.spec.ts` (new)

Deps to mock: `Pick<AssetRepository, 'getMemoryAssetsForPeriod' | 'getMemoryLocationClusters' | 'getMemoryAssetsForLocation'>`.

Every case is **given/when/then** because each needs three fixtures across two repository methods
with different date windows. `getMemoryLocationClusters` is called twice per year with _different_
windows (home baseline, then trip window) — drive it with `mockResolvedValueOnce` chains or a
window-aware `mockImplementation`, and be explicit which call is which.

Cases (spec §6.3):

1. **Fires.** _Given_ a probe with one dominant city in 2023 (≥3 assets, ratio ≥0.6), a home baseline
   whose top cluster is a different country, and a trip cluster with `firstDate` on the anniversary,
   8 assets over 3 days, _When_ evaluated on that anniversary, _Then_ exactly one candidate with
   pinned `title` (`'Your trip to Rome, Italy'`), `subtitle` (`'3 years ago · 8 photos over 3 days'`),
   exact `score`, `memoryAt` equal to the cluster's `firstDate`, `visibleForDays: 3`, and a
   `place_day:` `dedupeKey`.
2. **Shared-key contract.** _Given_ the same probe fixture fed to BOTH rules, _Then_
   `trip_anniversary`'s `dedupeKey` **equals** `on_this_day_place`'s. Assert against the other rule's
   **real output** (instantiate `OnThisDayPlaceMemoryRule` in the test) — never a hand-written string.
3. **Scoring invariant.** _Given_ `trip_anniversary` at its minimum (`MIN_TRIP_DAYS` days,
   `MIN_TRIP_ASSETS` assets, oldest year → `recencyBonus` 0) and `on_this_day_place` at its maximum
   (`count ≥ 30`, most recent past year → `recencyBonus` 9), _Then_ the trip score is strictly
   greater. Compute both from the **exported constants** of both rules, not hardcoded numbers.
4. **Probe short-circuit.** _Given_ no past year with a dominant city, _Then_ `[]` **and
   `getMemoryLocationClusters` was never called**.
5. **Ambiguous home.** _Given_ a probe that DOES qualify, a baseline whose different-country
   runner-up is within 1.25×, **and a trip cluster that would otherwise qualify**, _Then_ `[]` **and
   `getMemoryAssetsForLocation` was never called** — proving the ambiguity guard fired, not the probe.
6. **Mid-stay rejection.** _Given_ a qualifying probe and home, and a trip cluster whose `firstDate`
   is the day BEFORE the anniversary, _Then_ `[]` and no asset fetch.
7. **Boundary pairs:** `dayCount` 1 vs 2; `assetCount` 6 vs 7; probe ratio just below vs at 0.6;
   probe `items.length` 2 vs 3.
8. **Leap year.** _Given_ `target = DateTime.utc(2024, 2, 29)` and a qualifying **2023** trip, _Then_
   2023 is **skipped** (Luxon clamps `.set({year: 2023})` to Feb 28, so the day guard rejects it).
   _And_ given a qualifying **2020** (leap) trip, it still fires.
9. Skips the current year and future-dated assets.
10. Caps candidates at `MAX_CANDIDATES` (2); caps assets at `ASSET_CAP` (10).
11. Evaluates at most `MAX_PROBE_YEARS` (4) years — assert the cluster-query call count.
12. `subtitle` pluralization: `1 year ago` vs `3 years ago`.
13. City `null` → title is `'Your trip to Italy'` (country only).
14. **Zero assets** — empty probe ⇒ `[]`, no throw.

Run: `cd server && pnpm test --run src/services/memory-rules/trip-anniversary.rule.spec.ts`
**Expected red:** module not found.

### B2. GREEN — `server/src/services/memory-rules/trip-anniversary.rule.ts` (new)

Follow spec §4.1 exactly. **Export the constants**: `MIN_PROBE_ASSETS = 3`,
`MIN_PROBE_DOMINANCE = 0.6`, `MAX_PROBE_YEARS = 4`, `GAP_DAYS = 5`, `TRIP_WINDOW_DAYS = 21`,
`MIN_TRIP_ASSETS = 7`, `MIN_TRIP_DAYS = 2`, `HOME_BASELINE_DAYS = 90`, `ASSET_CAP = 10`,
`MAX_CANDIDATES = 2`, `SCORE_BASE = 260`.

Algorithm:

1. **Probe:** `getMemoryAssetsForPeriod({ months: [target.month], day: target.day, takenBefore: target.endOf('day').toJSDate() })`.
   Bucket by year; skip `year >= target.year` and blank cities. Per year
   `dominantBy(assets, (a) => placeKeyOf(a.country, a.city))`; keep when
   `items.length >= MIN_PROBE_ASSETS && ratio >= MIN_PROBE_DOMINANCE`. Empty ⇒ `return []` **before
   any cluster query**. Sort years desc, take `MAX_PROBE_YEARS`.
2. **Leap guard:** `const anniversary = target.set({ year: Y }).startOf('day')`; skip the year when
   `anniversary.day !== target.day || anniversary.month !== target.month`.
3. **Home:** `getMemoryLocationClusters({ takenAfter: anniversary.minus({ days: HOME_BASELINE_DAYS }).toJSDate(), takenBefore: anniversary.minus({ days: GAP_DAYS + 1 }).endOf('day').toJSDate() })`
   → `inferHome(...)`; `null` ⇒ skip year.
4. **Trip window:** `getMemoryLocationClusters({ takenAfter: anniversary.minus({ days: GAP_DAYS }).toJSDate(), takenBefore: anniversary.plus({ days: TRIP_WINDOW_DAYS }).endOf('day').toJSDate() })`
   → `findTripStartingOn(clusters, anniversary, home, { minAssets: MIN_TRIP_ASSETS, minDays: MIN_TRIP_DAYS })`.
5. **Build:** `getMemoryAssetsForLocation({ country, city, takenAfter: cluster.firstDate, takenBefore: cluster.lastDate })`
   → `curateTripAssets(assets, ASSET_CAP)`.

Candidate fields exactly per spec §4.1's table. `yearsAgo = target.year - Y`.

## Part C — register the type at all 16 sites

One new key `trip_anniversary`, appended **last** (after `video_moments`).
Expected `availableMemoryTypes` (**10**):

```
on_this_day, birthday, recent_trip, month_recap, favorites_throwback,
on_this_day_place, season_recap, people_together, video_moments, trip_anniversary
```

Same 16 sites as Slice 2 — see `docs/superpowers/plans/2026-07-19-memory-types-tier3-slice-2.md`
Part B for the exact file/line map. Note `memory-type.metadata.spec.ts` has **5** hardcoded list
assertions and `preferences.spec.ts` has **2**.

i18n (`i18n/en.json`):

```
"memory_type_trip_anniversary": "Trip anniversaries"
"memory_type_trip_anniversary_description": "Past trips resurfaced on the anniversary of the day they began."
"admin.memory_type_trip_anniversary_setting": "Trip anniversaries"
"admin.memory_type_trip_anniversary_setting_description": "Resurface a past trip on the anniversary of its first day."
```

Roadmap row **#6** Status → **Shipped** — `trip_anniversary`.

## Verification

```bash
cd server && pnpm test --run src/services/memory-rules/
cd server && pnpm test --run src/utils/preferences.spec.ts src/services/server.service.spec.ts
cd server && pnpm run check
cd server && npx eslint src/services/memory-rules/ --max-warnings 0
cd server && npx prettier --check "src/services/memory-rules/**"
cd web && pnpm test --run src/routes/admin/system-settings/MemoriesSettings.spec.ts
npx prettier --check "docs/**/*.md" "i18n/en.json"
```

## Out of scope

No medium test (Slice 8). No `themed`.

## Commit

`feat(memories): add trip_anniversary memory type`
