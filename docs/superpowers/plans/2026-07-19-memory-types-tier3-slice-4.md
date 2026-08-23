# Slice 4 — `trip.util.ts` (pure helpers) + `recent_trip` refactor

Spec: `docs/plans/2026-07-19-memory-types-tier3-spec.md` §3.2, §6.2, Slice 4.
Prepares Slice 5 (`trip_anniversary`). Registers **no** memory type.

## Goal

Extract the trip-detection and curation logic currently private to `recent-trip.rule.ts` into a pure,
unit-tested module that `trip_anniversary` can share, and introduce the **canonical `placeKeyOf`**
that makes the Slice-5 cross-rule dedupe actually collide.

`recent-trip.rule.spec.ts` must pass **completely unchanged** — it is the regression guard proving
the refactor preserved behavior exactly.

## Step 1 — RED: `server/src/services/memory-rules/trip.util.spec.ts` (new)

Write every case from spec §6.2. Build `MemoryLocationCluster` literals
(`{ country, city, assetCount, dayCount, firstDate, lastDate }`) and `MemoryAsset` literals
(`{ id, localDateTime }`).

**`placeKeyOf`** (the §3.3 collision contract):

- `('Italy', 'Rome')` → `'italy:rome'`; `('ITALY', 'ROME')` → `'italy:rome'` (case-insensitive).
- `(null, 'Rome')` → `':rome'`; `('Italy', null)` → `'italy:'` — **both null positions**. This is
  exactly what the two divergent pre-existing implementations got wrong.

**`inferHome`:**

- returns the top cluster when it dominates.
- `null` when the top cluster's `country` is `null`.
- `null` when a **different-country** runner-up has `assetCount >= top.assetCount / 1.25`.
- returns the top cluster when the runner-up is **same-country** (not ambiguous).
- `null` for `[]`.

**`isAwayFromHome`:**

- different country → `true`.
- same country, different non-null city → `true`.
- same country, same city → `false`.
- same country, **home** city `null` → `false`.
- same country, **candidate** city `null` → `false`.

**`findTripStartingOn`:**

- picks a cluster whose `firstDate` is on the anniversary day meeting both thresholds.
- **rejects `firstDate` one day before** the anniversary (mid-stay).
- **rejects `firstDate` one day after**.
- **UTC boundary:** a `firstDate` of `23:30Z` **on** the anniversary day **qualifies** — proves the
  comparison is UTC-calendar-day based, not instant based. Use
  `new Date('2023-06-14T23:30:00Z')` against an anniversary of `2023-06-14`.
- boundary pairs: rejects `assetCount = minAssets - 1`, accepts `= minAssets`; rejects
  `dayCount = 1`, accepts `= 2`.
- rejects a cluster meeting the thresholds that is **not** away from home.
- two qualifying clusters same day → higher `assetCount` wins; equal counts → lower `placeKeyOf`
  (deterministic).
- `null` for `[]`.

**`curateTripAssets(assets, cap)`:**

- collapses assets within the 2-minute burst window to one representative.
- returns all when `<= SMALL_TRIP_MAX` (6) after collapsing.
- covers distinct days before topping up.
- **never exceeds `cap`**, including a `cap` **below** the internal ladder (e.g. `cap: 4` on a large
  multi-day set returns exactly 4) — this is the case that makes Slice 5's `ASSET_CAP` assertion
  non-tautological.
- output is chronologically sorted and has no duplicate ids.

Run: `cd server && pnpm test --run src/services/memory-rules/trip.util.spec.ts`
**Expected red:** module not found. Capture the output.

> ⚠️ `pnpm test --run <path>` — NOT `pnpm test -- --run <path>` (this pnpm passes the literal `--`
> through and drops the path filter).

## Step 2 — GREEN: `server/src/services/memory-rules/trip.util.ts` (new)

Exports exactly as spec §3.2:

```ts
export const BURST_WINDOW_MS = 2 * 60 * 1000;
export const SMALL_TRIP_MAX = 6;
export const HOME_DOMINANCE_RATIO = 1.25;

export interface TripThresholds {
  minAssets: number;
  minDays: number;
}

export const placeKeyOf = (country: string | null, city: string | null): string =>
  `${country ?? ''}:${city ?? ''}`.toLowerCase();

export const inferHome = (clusters: MemoryLocationCluster[]): MemoryLocationCluster | null;
export const isAwayFromHome = (item: MemoryLocationCluster, home: MemoryLocationCluster): boolean;
export const findTripStartingOn = (
  clusters: MemoryLocationCluster[],
  anniversary: DateTime,
  home: MemoryLocationCluster,
  thresholds: TripThresholds,
): MemoryLocationCluster | null;
export const curateTripAssets = (assets: MemoryAsset[], cap: number): string[];
```

**Port the bodies verbatim** from `recent-trip.rule.ts`:

- `inferHome` ← the `const [home, runnerUp] = baseline` + `isAmbiguousHome` logic (lines 39-50).
- `isAwayFromHome` ← the country/city half of `isTripCandidate` (lines 116-120) — **thresholds are
  NOT part of this helper**, `findTripStartingOn` applies them.
- `curateTripAssets` ← `curateTripAssets` + `collapseBurstAssets` + `groupAssetsByDay` +
  `getTripTargetSize` + `pickDayCoverage` (lines 123-193), with the ladder result additionally
  clamped: `Math.min(cap, ladderSize)`. Use `pickEvenlySpaced` from `curation.util` — do **not**
  copy the rule's private duplicate.

`findTripStartingOn` is new logic (no equivalent exists): filter clusters by UTC-day equality on
`firstDate` via `DateTime.fromJSDate(c.firstDate, { zone: 'utc' }).hasSame(anniversary, 'day')`,
then by `isAwayFromHome` and both thresholds, then sort by `assetCount` desc, `placeKeyOf` asc, and
return the first or `null`.

## Step 3 — GREEN: refactor `recent-trip.rule.ts`

- Import `inferHome`, `isAwayFromHome`, `curateTripAssets`, `placeKeyOf`, `HOME_DOMINANCE_RATIO`.
- Replace the inline home/ambiguity block with `inferHome(baseline)`; `null` ⇒ `return []`.
- `isTripCandidate` keeps its **threshold** checks (`assetCount < 7 || dayCount < 2`) but delegates
  the country/city comparison to `isAwayFromHome`.
- Replace the `placeKey` template with `placeKeyOf(candidate.country, candidate.city)`.
  ⚠️ This **changes the key's null handling** (`` `${country}:${city ?? ''}` `` → both-null-safe).
  For `recent_trip` the value is identical whenever `country` is non-null, which the rule already
  guarantees by returning early on `!candidate.country` — so behavior is preserved. Confirm
  `recent-trip.rule.spec.ts` still passes unchanged.
- Replace the private curation with `curateTripAssets(locationAssets, 10)` — `10` preserves today's
  ceiling exactly.
- **Delete** the now-unused private methods: `curateTripAssets`, `collapseBurstAssets`,
  `groupAssetsByDay`, `getTripTargetSize`, `pickDayCoverage`, `pickEvenlySpaced`, and the
  `BURST_WINDOW_MS` / `SMALL_TRIP_MAX` / `HOME_DOMINANCE_RATIO` private statics.

## Verification

```bash
cd server && pnpm test --run src/services/memory-rules/     # ALL green; recent-trip spec UNCHANGED
cd server && pnpm run check
cd server && npx eslint src/services/memory-rules/ --max-warnings 0
cd server && npx prettier --check "src/services/memory-rules/**"
```

`git diff --stat server/src/services/memory-rules/recent-trip.rule.spec.ts` must be **empty**.

## Out of scope

No `trip_anniversary` rule, no registry/metadata entry, no change to `on-this-day-place.rule.ts`
(that is Slice 5).

## Commit

`refactor(memories): extract shared trip detection and curation helpers`
