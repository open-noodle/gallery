# Tier 3 Memory Types — Design & Test Spec

> Implements roadmap items **#6 Trip anniversary**, **#7 Themed** (reframed onto smart search),
> and **#11 Video moments** from the
> [memory types roadmap](./2026-07-15-memory-types-roadmap.md).
> Stacked on **PR #792** (`feat/memory-types-tier2`) → **PR #789** (`feat/memory-types-tier1`).
> Branch: `feat/memory-types-tier3`.
> Approach: **test-driven, behavior-driven, full edge-case coverage.**
> Created 2026-07-19. Revised 2026-07-19 after adversarial review (24 defects fixed).
> Status: **spec — not yet implemented.**

## 1. Goal & non-goals

**Goal:** add three new `MemoryRule`s to the shipped rule engine:

| Key                | Memory                                                      | Trigger day                              | Window |
| ------------------ | ----------------------------------------------------------- | ---------------------------------------- | ------ |
| `trip_anniversary` | "Your trip to Rome" · "3 years ago · 42 photos over 5 days" | any (anniversary of a past trip's start) | 3–7 d  |
| `themed`           | "Sunsets from 2023" · "18 photos"                           | **22**                                   | 5 d    |
| `video_moments`    | "Video moments from July 2023" · "6 videos"                 | **8**                                    | 5 d    |

Plus one mobile fix: the memory viewer force-autoplays video regardless of the user's global
`viewer.autoPlayVideo` setting.

**Non-goals (this batch):**

- No engine change to `memory.service.ts` scheduling, `RULE_DAILY_LIMIT`, the multi-day slot cap, or
  cleanup. All three rules are pure functions of `(ownerId, target, injected deps)`.
- No open-ended semantic discovery (roadmap #12). `themed` uses a **fixed, curated vocabulary**.
- No localization of memory _content_ (titles/subtitles stay English, matching every existing rule).
- No new ML model. `themed` reuses embeddings CLIP **already computed** for smart search. No
  dependency on the fork's auto-classification / `tag_asset`.
- No mobile memory auto-advance timer (pre-existing gap, affects every memory type — §9).
- No web memory-viewer change: it already plays video with a duration-aware progress timer.
- No `MemoryType` enum or `memory` table schema change.

## 2. Design decisions

| #   | Decision                                                                            | Rationale                                                                                                                      |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Trip anniversary **queries location data fresh**, not stored `recent_trip` memories | Covers imported historical libraries; `recent_trip` only fired for trips taken while already running Gallery                   |
| D2  | `themed` rides **smart-search CLIP embeddings**, not auto-classification            | Embeddings already exist per asset; no classification dependency, no new infra                                                 |
| D3  | `themed` is **period-scoped to a past year**, not all-time                          | Keeps the throwback identity; each `(theme, year)` fires once, so dedupe is natural                                            |
| D4  | Small vocabulary, **one theme per month** (not per day)                             | Bounds cost **and** prevents slot starvation (§3.6) — the critical fix from review                                             |
| D5  | `trip_anniversary` and `on_this_day_place` **share a dedupe namespace**             | They collide by construction; a shared key lets the engine's `seenDedupeKeys` collapse them with **zero engine change** (§3.3) |
| D6  | Mobile: **force autoplay** in the memory card                                       | Videos in memories sit frozen on frame 1 unless global autoplay is on                                                          |
| D7  | `themed` returns **images only**                                                    | Clean separation from `video_moments`                                                                                          |
| D8  | Rules **export their constants**                                                    | Private statics make the §3.3 precedence invariant untestable (review #10)                                                     |

## 3. Architecture

### 3.1 Every site a new memory type touches

Traced from `people_together` (added in PR #792). **All 16 sites**, per key:

| #   | File                                                            | What changes                                                                   |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | `server/src/services/memory-rules/memory-type.metadata.ts`      | `MEMORY_TYPE_METADATA` entry                                                   |
| 2   | `server/src/services/memory-rules/memory-type.metadata.spec.ts` | assert key, kind, defaults                                                     |
| 3   | `server/src/services/memory-rules/memory-type.registry.ts`      | `RULE_FACTORIES` entry (+ `MemoryRuleDeps` for `themed`)                       |
| 4   | `server/src/services/memory-rules/memory-type.registry.spec.ts` | factory builds the right rule + **completeness-guard count**                   |
| 5   | `server/src/services/memory-rules/<rule>.rule.ts`               | the rule                                                                       |
| 6   | `server/src/services/memory-rules/<rule>.rule.spec.ts`          | unit/BDD spec                                                                  |
| 7   | `server/src/utils/preferences.spec.ts`                          | default per-user type map gains the key                                        |
| 8   | `server/src/services/server.service.spec.ts`                    | **TWO** `availableMemoryTypes` assertions (default + admin-disabled case)      |
| 9   | `server/test/medium/specs/services/memory.service.spec.ts`      | end-to-end generation medium test                                              |
| 10  | `e2e/src/specs/server/api/server.e2e-spec.ts`                   | **`availableMemoryTypes` fixture — the server unit suite does NOT catch this** |
| 11  | `web/src/routes/admin/system-settings/MemoriesSettings.svelte`  | hardcoded `memoryTypeKeys` array                                               |
| 12  | `web/src/routes/admin/system-settings/MemoriesSettings.spec.ts` | switch count **and** the full `types` object literal in the save-payload test  |
| 13  | `i18n/en.json`                                                  | 4 keys per type (§3.7)                                                         |
| 14  | `docs/docs/features/memories.md`                                | user-facing type list                                                          |
| 15  | `docs/docs/install/config-file.md`                              | `memories.types` config keys                                                   |
| 16  | `docs/plans/2026-07-15-memory-types-roadmap.md`                 | Status column → **Shipped**                                                    |

**These files serialize the slices.** Rows 1, 4, 7, 8, 10, 11, 12 are shared lists touched by every
key, so Slices 2 → 5 → 7 **must run in order**, each adding exactly one key. Expected
`availableMemoryTypes` (registry order) after each:

```
base (tier2): on_this_day, birthday, recent_trip, month_recap, favorites_throwback,
              on_this_day_place, season_recap, people_together                        [8]
after Slice 2: … people_together, video_moments                                       [9]
after Slice 5: … video_moments, trip_anniversary                                      [10]
after Slice 7: … trip_anniversary, themed                                             [11]
```

The registry completeness guard asserts one rule per `kind: 'rule'` entry, so its expected count is
**8 → 9 → 10** rule-kind entries (`on_this_day` is not rule-kind).

### 3.2 New / changed source files, with exact signatures

| File                                                  | Change                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/repositories/asset.repository.ts`                | `getMemoryAssetsForPeriod`: select `type` + `duration`, add optional `type` filter (§3.5) |
| `src/services/memory-rules/trip.util.ts`              | **New**, pure (signatures below)                                                          |
| `src/services/memory-rules/recent-trip.rule.ts`       | Refactor onto `trip.util.ts`                                                              |
| `src/services/memory-rules/on-this-day-place.rule.ts` | Shared `placeKeyOf` + shared dedupe namespace + capped score; export constants            |
| `src/services/memory-rules/trip-anniversary.rule.ts`  | **New** rule                                                                              |
| `src/services/memory-rules/theme.catalog.ts`          | **New** — vocabulary + `themeForMonth`                                                    |
| `src/services/memory-rules/theme-search.port.ts`      | **New** — `ThemeSearchPort`                                                               |
| `src/services/memory-rules/theme-search.adapter.ts`   | **New** — port impl                                                                       |
| `src/services/memory-rules/themed.rule.ts`            | **New** rule                                                                              |
| `src/services/memory-rules/video-moments.rule.ts`     | **New** rule                                                                              |
| `src/services/memory-rules/memory-type.registry.ts`   | `MemoryRuleDeps` gains `themeSearchPort`; 3 factories                                     |
| `src/services/memory.service.ts`                      | Build + memoize the adapter; pass into `getMemoryRules` deps                              |
| `mobile/.../asset_viewer/video_viewer.widget.dart`    | `NativeVideoViewer` gains `forceAutoPlay` (default `false`)                               |
| `mobile/.../memory/memory_card.widget.dart`           | `DriftMemoryCard` passes `forceAutoPlay: true`                                            |

**`trip.util.ts` — exact exports** (constants exported per D8):

```ts
export const BURST_WINDOW_MS = 2 * 60 * 1000;
export const SMALL_TRIP_MAX = 6;
export const HOME_DOMINANCE_RATIO = 1.25;

export interface TripThresholds {
  minAssets: number;
  minDays: number;
}

/** Canonical place key. BOTH place-based rules must use this (§3.3). */
export const placeKeyOf = (country: string | null, city: string | null): string =>
  `${country ?? ''}:${city ?? ''}`.toLowerCase();

/** Top cluster, or null when it has no country or a different-country runner-up is within the ratio. */
export const inferHome = (clusters: MemoryLocationCluster[]) => MemoryLocationCluster | null;

export const isAwayFromHome = (item: MemoryLocationCluster, home: MemoryLocationCluster) => boolean;

/**
 * The strongest cluster whose UTC calendar day of `firstDate` equals `anniversary`'s UTC day,
 * is away from home, and meets both thresholds. Ties break on higher assetCount, then on
 * placeKeyOf ascending (deterministic). Returns null when none qualify or `clusters` is empty.
 */
export const findTripStartingOn = (
  clusters: MemoryLocationCluster[],
  anniversary: DateTime,
  home: MemoryLocationCluster,
  thresholds: TripThresholds,
) => MemoryLocationCluster | null;

/** Burst-collapse + per-day coverage sampling, capped at `cap`. Chronological, duplicate-free. */
export const curateTripAssets = (assets: MemoryAsset[], cap: number) => string[];
```

`curateTripAssets` ports `recent-trip.rule.ts`'s private logic verbatim **except** that the internal
`getTripTargetSize` ladder (7 / 8 / 10) is now additionally clamped by the `cap` argument, so a
caller can request fewer than 10. `recent_trip` calls it with `cap: 10` to preserve today's behavior
exactly.

### 3.3 Cross-rule dedupe: the shared place-day namespace (D5)

`trip_anniversary` and `on_this_day_place` fire on the same signal, and with `RULE_DAILY_LIMIT = 2`
they would occupy both slots with near-identical content.

The engine already resolves this: `createRuleMemories` (`memory.service.ts:136-155`) builds
`seenDedupeKeys` over the **flattened, score-sorted candidate list from all rules** and skips any
candidate whose key was already taken. Two rules emitting the **same `dedupeKey`** therefore collapse
to the higher-scoring one, with **no engine change**. Both emit:

```
place_day:${year}-${mm}-${dd}:${placeKeyOf(country, city)}
```

⚠️ **The formats must match byte-for-byte or the collapse silently never fires.** Today the rules
diverge — `on_this_day_place` uses `` `${country ?? ''}:${city}` `` (`on-this-day-place.rule.ts:5`),
`recent_trip` uses `` `${country}:${city ?? ''}` `` (`recent-trip.rule.ts:61`). The canonical
`placeKeyOf` (§3.2) replaces both.

**Scoring invariant (makes the precedence total, not probabilistic).** `on_this_day_place` currently
scores `100 + count * 3 + recencyBonus` with **no cap on `count`** (`on-this-day-place.rule.ts:57`) —
a heavily-photographed day scores 250+, beating any fixed trip base precisely when the trip was well
documented. Two coupled changes:

1. **Cap `on_this_day_place`:** `100 + Math.min(count, 30) * 3 + recencyBonus`. Range **[112, 199]**
   — min `count` is 4; `recencyBonus` maxes at **9**, not 10, because
   `recencyBonus = max(0, 10 - (targetYear - year))` (`curation.util.ts:85`) and the rule skips
   `year >= target.year`.
2. **Floor `trip_anniversary` above it:** base `260` ⇒ minimum `260 + 2*4 + 7 + 0 = 275`.

**275 > 199** unconditionally. §6.3 asserts this by invoking **both real rules** with boundary
fixtures (possible only because D8 exports the constants).

`on_this_day_place` ships in the **unmerged** PR #789, so the key and score changes carry no
migration risk; its spec pins exact scores and is updated in the same slice.

> **Accepted edge:** on days 2..N of a multi-day trip's anniversary, `on_this_day_place` may still
> surface "On this day in Rome" while the trip memory lingers. The dedupe only collapses same-day
> collisions. Mild, different photos, not worth an engine change.

### 3.4 `themed` dependency wiring — the `ThemeSearchPort` seam

Two constraints: encoding must **not** happen per user (`createMemoryRules` runs once per user per
day, `memory.service.ts:203`), and the rule must stay unit-testable without ML or a DB. One narrow
port, with a memoizing adapter behind it:

```ts
export interface ThemeSearchAsset {
  id: string;
  localDateTime: Date;
}

export interface ThemeSearchPort {
  /** null when smart search is disabled or the embedding cannot be produced. Never throws. */
  resolveEmbedding(themeKey: string, query: string): Promise<string | null>;
  /** Assets ordered by similarity, best first. `takenAfter`/`takenBefore` are JS Dates. */
  searchByEmbedding(params: {
    ownerId: string;
    embedding: string;
    takenAfter: Date;
    takenBefore: Date;
    size: number;
  }): Promise<ThemeSearchAsset[]>;
}
```

The rule converts Luxon → `Date` via `.toJSDate()` at this boundary. The rule is deliberately
**unaware of `maxDistance`**: the adapter already reads config (for `isSmartSearchEnabled`) and owns
the threshold, so tuning never touches rule code or rule tests.

**Verified facts:** `encodeText(text, { modelName, language? })` returns the **pgvector-serialized
string** (`ClipTextualResponse = { [ModelTask.SEARCH]: string }`) — exactly what
`SmartSearchOptions.embedding` expects. `searchSmart` takes a precomputed embedding, needs **no ML
service**, and supports `userIds`, `takenAfter`/`takenBefore`, `type`, `visibility`. `maxDistance`
applies a cosine ceiling in SQL (`search.repository.ts:428-430`), active only when
`0 < maxDistance < 2`; the product default `clip.maxDistance` is `0` (disabled), so the adapter must
pass its own. `searchSmart` returns **no per-asset distance**, so quality gating rests entirely on
`maxDistance`.

#### 3.4.1 ⚠️ `takenAfter`/`takenBefore` filter `fileCreatedAt`, not `localDateTime`

`searchAssetBuilder` maps both bounds to **`asset.fileCreatedAt`** (`database.ts:725-726`), whereas
every memory rule and `getMemoryAssetsForPeriod` bucket by **`localDateTime`**. Year-bucketing on
`fileCreatedAt` would mis-assign assets near Jan 1 / Dec 31 and could give a "2023" memory a 2024
`memoryAt`.

**Resolution (two-step, both required):**

1. The adapter searches a **2-day-widened** window (`takenAfter - 2d`, `takenBefore + 2d`) so no
   in-year asset is missed by the `fileCreatedAt` skew.
2. The **rule** then filters the returned assets to exactly year `Y` by
   `DateTime.fromJSDate(a.localDateTime, { zone: 'utc' }).year === Y`, and applies `MIN_ASSETS`
   **after** that filter.

This makes `localDateTime` authoritative for the memory's identity while `fileCreatedAt` is only a
coarse prefilter.

### 3.5 Repository change — `getMemoryAssetsForPeriod`

```ts
export interface MemoryPeriodAsset {
  id: string;
  localDateTime: Date;
  year: number;
  country: string | null;
  city: string | null;
  isFavorite: boolean;
  type: AssetType; // NEW — required
  duration: number | null; // NEW — required; milliseconds
}

export interface MemoryPeriodOptions {
  months: number[];
  day?: number;
  favoritesOnly?: boolean;
  type?: AssetType; // NEW
  takenBefore: Date;
}
```

Implementation: add `'asset.type'` and `'asset.duration'` to `.select([...])`; add `type` to the
**destructured params** at `asset.repository.ts:892`; add
`.$if(type !== undefined, (qb) => qb.where('asset.type', '=', type!))`.

> ⚠️ **Not source-compatible.** The two new fields are **required**, so the four existing spec
> fixture factories that build `MemoryPeriodAsset` literals fail `tsc` until updated:
> `month-recap.rule.spec.ts:7-16`, `favorites-throwback.rule.spec.ts:7-16`,
> `on-this-day-place.rule.spec.ts:13-23`, `season-recap.rule.spec.ts:9-19`. Slice 1 updates all four
> (`type: AssetType.Image, duration: null`). Required-not-optional is deliberate: it forces every
> construction site to state the asset kind.

> ⚠️ `make sql` **deletes every query file when no database is running.** Run it only against a live
> dev DB and confirm the `asset.repository.sql` diff contains only the new columns and predicate.

### 3.6 Slot budget — why `themed` must not fire daily

`createRuleMemories` computes `remainingSlots = RULE_DAILY_LIMIT - existingRuleMemories.length` and
**returns early when it is 0** (`memory.service.ts:128-132`) — meaning **no rule evaluates at all**
that day. Every shipped rule fires on exactly one day per month; a `themed` rule firing _daily_ with
a multi-day window would hold both slots for a week at a time and could permanently starve
`trip_anniversary`, which can fall on any day.

Therefore `themed` gets a **trigger day (22)** and a **5-day** window, and `video_moments` uses a
5-day window too. Resulting monthly coverage:

| Rule                  | Trigger | Visible |
| --------------------- | ------- | ------- |
| `month_recap`         | 1       | 1–7     |
| `video_moments`       | **8**   | 8–12    |
| `favorites_throwback` | 15      | 15–21   |
| `people_together`     | 20      | 20–26   |
| `themed`              | **22**  | 22–26   |

Days 13–14 and 27–end are always free, and no day carries more than two lingering multi-day rules —
so `trip_anniversary` can always win a slot outside 20–26. The residual contention on 20–26 is
inherent to `RULE_DAILY_LIMIT = 2` and is recorded as a follow-up (§9), not fixed here.

### 3.7 i18n

4 keys per type in `i18n/en.json` only (the repo's `i18n/` is shared by web and mobile; new keys need
only the EN source):

```
memory_type_<key>                 memory_type_<key>_description
admin.memory_type_<key>_setting   admin.memory_type_<key>_setting_description
```

| key                | user label         | user description                                                      |
| ------------------ | ------------------ | --------------------------------------------------------------------- |
| `trip_anniversary` | Trip anniversaries | Past trips resurfaced on the anniversary of the day they began.       |
| `themed`           | Themes             | Photo themes like sunsets, food, and beach days, found automatically. |
| `video_moments`    | Video moments      | Videos you filmed in this month of a past year.                       |

## 4. Rule behavior

### 4.1 `trip_anniversary`

**Shape:** `class TripAnniversaryMemoryRule implements MemoryRule`, `id = 'trip_anniversary'`,
ctor `(assetRepository: Pick<AssetRepository, 'getMemoryAssetsForPeriod' | 'getMemoryLocationClusters' | 'getMemoryAssetsForLocation'>)`.

**Exported constants** (D8): `MIN_PROBE_ASSETS = 3`, `MIN_PROBE_DOMINANCE = 0.6`,
`MAX_PROBE_YEARS = 4`, `GAP_DAYS = 5`, `TRIP_WINDOW_DAYS = 21`, `MIN_TRIP_ASSETS = 7`,
`MIN_TRIP_DAYS = 2`, `HOME_BASELINE_DAYS = 90`, `ASSET_CAP = 10`, `MAX_CANDIDATES = 2`,
`SCORE_BASE = 260`.

`ASSET_CAP = 10` matches `curateTripAssets`'s own ceiling, so the cap is genuinely reachable and the
§6.3 cap assertion is not tautological (review #8).

**Algorithm:**

1. **Probe (1 cheap query; prunes the common case).**
   `getMemoryAssetsForPeriod(ownerId, { months: [target.month], day: target.day, takenBefore: target.endOf('day').toJSDate() })`.
   Bucket by year; drop `year >= target.year` and assets whose `city` is null/blank. Per year run
   `dominantBy(assets, (a) => placeKeyOf(a.country, a.city))`; keep years where
   `items.length >= MIN_PROBE_ASSETS && ratio >= MIN_PROBE_DOMINANCE`.
   **No qualifying year ⇒ return `[]` immediately** (zero cluster queries).
   Take the most recent `MAX_PROBE_YEARS` qualifying years.

2. **Leap-year guard.** `const anniversary = target.set({ year: Y }).startOf('day')`. Luxon
   **silently clamps** Feb 29 → Feb 28 in a non-leap year (`DateTime.utc(2024,2,29).set({year:2023})`
   → `2023-02-28`, `isValid: true`), which would compare against the wrong day. **Skip the year when
   `anniversary.day !== target.day || anniversary.month !== target.month`.**

3. **Confirm (2 cluster queries per surviving year).**
   - **Home:** `getMemoryLocationClusters(ownerId, { takenAfter: (anniversary - HOME_BASELINE_DAYS).toJSDate(), takenBefore: (anniversary - GAP_DAYS - 1 day).endOf('day').toJSDate() })`
     → `inferHome(clusters)`; `null` ⇒ skip the year.
   - **Trip window:** `getMemoryLocationClusters(ownerId, { takenAfter: (anniversary - GAP_DAYS).toJSDate(), takenBefore: (anniversary + TRIP_WINDOW_DAYS).endOf('day').toJSDate() })`
     → `findTripStartingOn(clusters, anniversary, home, { minAssets: MIN_TRIP_ASSETS, minDays: MIN_TRIP_DAYS })`.

   **Why the pre-window works.** The window starts `GAP_DAYS` **before** the anniversary, so a
   cluster whose `firstDate` lands on the anniversary day provably had **no photos at that place in
   the preceding `GAP_DAYS`** — a genuine arrival, not a mid-stay. Such a cluster has no pre-window
   assets, so its `assetCount`/`dayCount` are purely in-window and usable as the trip's size.

   **Day comparison is UTC-explicit** (review #13): `firstDate` is a raw
   `min(asset."localDateTime")` (`asset.repository.ts:821`), **not** date-truncated. Compare with
   `DateTime.fromJSDate(cluster.firstDate, { zone: 'utc' }).hasSame(anniversary, 'day')`.

4. **Build.** `getMemoryAssetsForLocation(ownerId, { country, city, takenAfter: firstDate, takenBefore: lastDate })`,
   then `curateTripAssets(assets, ASSET_CAP)`.

**Candidate:**

| Field            | Value                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `dedupeKey`      | `place_day:${Y}-${mm}-${dd}:${placeKeyOf(country, city)}` — **shared** (§3.3)                |
| `title`          | `Your trip to ${city}, ${country}`; `Your trip to ${country}` when city is null              |
| `subtitle`       | `${n} year${n === 1 ? '' : 's'} ago · ${assetCount} photos over ${dayCount} days`            |
| `score`          | `SCORE_BASE + dayCount * 4 + Math.min(assetCount, 20) + recencyBonus(Y, target.year)`        |
| `memoryAt`       | `DateTime.fromJSDate(cluster.firstDate, { zone: 'utc' })`                                    |
| `visibleForDays` | `Math.min(Math.max(dayCount, 3), 7)`                                                         |
| `context`        | `{ year: Y, placeKey, placeLabel, country, city, assetCount, dayCount, tripStart, tripEnd }` |

Emit at most `MAX_CANDIDATES`, sorted by score desc.

### 4.2 `themed`

**Shape:** `class ThemedMemoryRule implements MemoryRule`, `id = 'themed'`,
ctor `(themeSearchPort: ThemeSearchPort)`.

**Catalog** (`theme.catalog.ts`) — 6 themes:

| key          | CLIP prompt                   | label       |
| ------------ | ----------------------------- | ----------- |
| `sunset`     | `a beautiful sunset`          | Sunsets     |
| `beach`      | `a beach with sand and ocean` | Beach days  |
| `food`       | `a plate of food at a meal`   | Food        |
| `mountains`  | `mountains and hiking trails` | Mountains   |
| `snow`       | `a snowy winter landscape`    | Snow days   |
| `city_night` | `a city skyline at night`     | City lights |

**Rotation is by month, not day-of-year** (review #22 — day-of-year is not stable across year or leap
boundaries since `365 % 6 !== 0`):

```ts
export const themeForMonth = (month: number): Theme => THEMES[(month - 1) % THEMES.length]!;
```

Deterministic for a given calendar month, forever. Each theme recurs twice a year (6 themes,
12 months).

**Exported constants:** `TRIGGER_DAY = 22`, `MAX_YEARS_BACK = 3`, `FETCH_SIZE = 40`,
`MIN_ASSETS = 8`, `ASSET_CAP = 16`, `VISIBLE_FOR_DAYS = 5`, `MAX_CANDIDATES = 3`, `SCORE_BASE = 70`.

**Algorithm:**

1. `if (target.day !== TRIGGER_DAY) return []` — §3.6.
2. `theme = themeForMonth(target.month)`.
3. `embedding = await port.resolveEmbedding(theme.key, theme.query)`; **`null` ⇒ return `[]`** without
   calling `searchByEmbedding`.
4. For each `Y` in `target.year - 1 .. target.year - MAX_YEARS_BACK`:
   - `takenAfter = DateTime.utc(Y, 1, 1).startOf('day')`, `takenBefore = DateTime.utc(Y, 12, 31).endOf('day')`.
     **No `min(..., target)` clamp** — the year range excludes the current year, so the clamp was
     dead code (review #11).
   - `assets = await port.searchByEmbedding({ ownerId, embedding, takenAfter: takenAfter.toJSDate(), takenBefore: takenBefore.toJSDate(), size: FETCH_SIZE })`
     (the adapter widens by 2 days — §3.4.1).
   - **Filter to exactly year `Y` by `localDateTime`** (§3.4.1), then skip if `< MIN_ASSETS`.
5. Emit a candidate per qualifying year, sorted by score desc, **capped at `MAX_CANDIDATES` (3)**.

> **Why not 1 candidate** (review #4): `hasRuleMemory` filtering happens in the **engine, after** the
> rule returns (`memory.service.ts:160-163`). `recencyBonus` monotonically favours the most recent
> year, so a 1-candidate rule would emit only the newest year forever — once `themed:sunset:2025`
> exists it is blocked, and 2024/2023 become **unreachable**. Emitting all qualifying years lets the
> engine fall through to the next-best.

**Candidate:**

| Field            | Value                                                             |
| ---------------- | ----------------------------------------------------------------- |
| `dedupeKey`      | `themed:${theme.key}:${Y}`                                        |
| `title`          | `${theme.label} from ${Y}`                                        |
| `subtitle`       | `${count} photos`                                                 |
| `score`          | `SCORE_BASE + Math.min(count, 25) + recencyBonus(Y, target.year)` |
| `assetIds`       | `sampleAssetsByTime(filtered, ASSET_CAP)`                         |
| `memoryAt`       | `DateTime.fromJSDate(medianTime(filtered), { zone: 'utc' })`      |
| `visibleForDays` | `VISIBLE_FOR_DAYS`                                                |
| `context`        | `{ year: Y, theme: theme.key, count }`                            |

`count` = the number of assets surviving the year filter (**before** `ASSET_CAP` sampling).

**Adapter (`MemoryThemeSearchAdapter`):**

- `resolveEmbedding`: `getConfig({ withCache: true })`; return `null` when
  `!isSmartSearchEnabled(config.machineLearning)`. Cache key
  **`${modelName}:${language ?? 'default'}:${themeKey}`** — the language is part of the key so a
  non-English CLIP deployment cannot serve a stale English embedding (review #16). This batch always
  passes `language: undefined` (model default); the key still records it. On `encodeText` rejection,
  log and return `null`.
- `searchByEmbedding`: `searchSmart({ page: 1, size }, { embedding, userIds: [ownerId], takenAfter: takenAfter - 2d, takenBefore: takenBefore + 2d, type: AssetType.Image, visibility: AssetVisibility.Timeline, maxDistance })`,
  mapping rows to `{ id, localDateTime }`.

**Threshold.** `memories.themeMaxDistance` in system config, tunable without a deploy and exposed in
**Administration → Settings → Memories**.

> **Corrected after calibration (2026-07-26).** This shipped at `0.30`, which emits **zero** themed
> memories on a real library: calibration against 65,685 embeddings found `0.30` and `0.50` both
> return nothing, while `0.75` returns genuine matches. `0.30` was picked on the scale of the
> _image-to-image_ thresholds used elsewhere (`duplicateDetection` `0.01`, `facialRecognition`
> `0.5`), but this is a **text-to-image** distance — CLIP's modality gap floors it near `~0.6` even
> for a perfect match, so `0.30` is unreachable. The default is now **`0.75`**, matching the value
> the admin UI already recommends for `machineLearning.clip.maxDistance` (the same metric over the
> same embeddings). The Slice 8 calibration grid (`0.22 / 0.26 / 0.30 / 0.34`) was likewise on the
> wrong scale; a corrected sweep should span `0.55`–`0.95`.

> **Accepted edge:** `searchSmart` inner-joins `smart_search`, so only ML-processed assets are
> reachable, and it does not verify a Preview `asset_file` (unlike the other memory queries). In
> practice thumbnailing precedes CLIP encoding, so an asset with an embedding effectively always has
> a preview. Documented, not defended.

### 4.3 `video_moments`

**Shape:** `class VideoMomentsMemoryRule implements MemoryRule`, `id = 'video_moments'`,
ctor `(assetRepository: Pick<AssetRepository, 'getMemoryAssetsForPeriod'>)`.

**Exported constants:** `TRIGGER_DAY = 8`, `MIN_DURATION_MS = 3_000`, `MAX_DURATION_MS = 180_000`,
`MIN_ASSETS = 3`, `MAX_YEARS = 3`, `ASSET_CAP = 8`, `VISIBLE_FOR_DAYS = 5`,
`MAX_FAVORITE_BONUS = 10`, `SCORE_BASE = 60`.

**Algorithm:**

1. `if (target.day !== TRIGGER_DAY) return []`.
2. `getMemoryAssetsForPeriod(ownerId, { months: [target.month], type: AssetType.Video, takenBefore: target.endOf('day').toJSDate() })`.
3. Bucket by year; drop `year >= target.year`.
4. **Memorability band:** keep assets with
   `duration !== null && duration >= MIN_DURATION_MS && duration <= MAX_DURATION_MS`. Drops accidental
   taps and long screen recordings. `duration` is an **integer of milliseconds**
   (`asset.table.ts:96-97`; the `ChangeDurationToInteger` migration converts `HH:MM:SS.mmm` → ms).
5. Skip years with `< MIN_ASSETS` survivors.
6. **Selection** — favourites first, deterministic:
   - `favourites` and `others`, each sorted chronologically.
   - If `favourites.length >= ASSET_CAP`: `selected = pickEvenlySpaced(favourites, ASSET_CAP)`
     (review #15 — defines the previously-undefined negative-remainder case).
   - Else: `selected = [...favourites, ...pickEvenlySpaced(others, ASSET_CAP - favourites.length)]`.
   - Sort `selected` chronologically for the final `assetIds`.

**Definitions (review #14 — both were ambiguous):**

- **`count`** = survivors of the band filter for that year, **before** `ASSET_CAP` selection.
- **`favoriteCount`** = `isFavorite` survivors of the band filter, **before** selection.

**Candidate:**

| Field            | Value                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `dedupeKey`      | `video_moments:${Y}-${MM}`                                                                                              |
| `title`          | `Video moments from ${monthName(month)} ${Y}`                                                                           |
| `subtitle`       | `${count} video${count === 1 ? '' : 's'}`                                                                               |
| `score`          | `SCORE_BASE + Math.min(count, 15) * 2 + Math.min(favoriteCount, MAX_FAVORITE_BONUS) * 3 + recencyBonus(Y, target.year)` |
| `memoryAt`       | `DateTime.fromJSDate(medianTime(selected), { zone: 'utc' })`                                                            |
| `visibleForDays` | `VISIBLE_FOR_DAYS`                                                                                                      |
| `context`        | `{ year: Y, month, count, favoriteCount }`                                                                              |

**Worked score example** (pin this exact value in a test): 9 in-band videos, 3 favourites, `Y = 2023`,
`target.year = 2026` ⇒ `60 + min(9,15)*2 + min(3,10)*3 + max(0, 10-3)` = `60 + 18 + 9 + 7` = **94**.

The favourite bonus is **capped** (review #9): uncapped, 80 favourite videos would score 339 and beat
`trip_anniversary`'s proven 275 floor. Capped maximum is `60 + 30 + 30 + 9 = 129 < 275`, preserving
§3.3's precedence.

### 4.4 Mobile — force autoplay (D6)

`NativeVideoViewer` gates playback on the global setting (`video_viewer.widget.dart:221-222`).
Because `DriftMemoryCard` builds it with `showControls: false`, a user with autoplay off gets a
**frozen first frame and no play button**. Changes:

1. `NativeVideoViewer` gains `final bool forceAutoPlay;` (constructor default `false`) — no existing
   call site changes behavior.
2. Gate becomes `if (widget.forceAutoPlay || autoPlayVideo || widget.asset.isMotionPhoto)`.
3. `DriftMemoryCard` (`memory_card.widget.dart:63-70`) passes `forceAutoPlay: true`.

## 5. TDD discipline

Every slice follows **red → green → refactor**:

1. Write the listed tests first. Run the named command; confirm they fail **for the expected reason**.
   Record the failure summary in the commit body.
2. Implement the minimal code to pass.
3. Re-run; confirm green. Run the slice's type/lint gate.
4. Commit with the slice's message.

**Anti-tautology rules:**

- Every rule spec pins **exact** `title`, `subtitle`, `dedupeKey` and at least one **exact `score`**.
- Every threshold gets a **both-sides boundary pair** (fails at `n-1`, passes at `n`).
- Every negative case must fail for a **different reason** than the positive passes — and where a
  rule short-circuits early, assert the **downstream call was never made**, so the test cannot pass
  because an earlier guard fired (this is the trap in the `trip_anniversary` cases).

## 6. Test plan

### 6.1 Conventions

Unit specs live beside the rule; `vitest`; no DB. Deps are hand-rolled fakes or `vitest.fn()`.
`target` is a Luxon UTC `DateTime` built with explicit `DateTime.utc(...)`. Assert on the returned
`MemoryRuleCandidate[]`. `dedupeKey` **stability**: the same period evaluated on two different
`target` days yields an identical key.

### 6.2 `trip.util.spec.ts` (pure — Slice 4)

**`placeKeyOf`** — the §3.3 collision contract:

- `('Italy','Rome')` → `'italy:rome'`; `('ITALY','ROME')` → same (case-insensitive).
- `(null,'Rome')` → `':rome'`; `('Italy',null)` → `'italy:'` — **both null positions**, exactly what
  the two divergent implementations got wrong.

**`inferHome`:** top cluster when dominant · `null` when top has no `country` · `null` when a
different-country runner-up has `assetCount >= top/1.25` · top when the runner-up is **same-country**
· `null` on `[]`.

**`isAwayFromHome`:** different country → true · same country + different non-null city → true ·
same country + same city → false · home city null → false · candidate city null → false.

**`findTripStartingOn`:**

- picks a cluster whose `firstDate` is on the anniversary day and meets both thresholds.
- **rejects `firstDate` one day before** and **one day after** the anniversary.
- **UTC boundary:** a `firstDate` of `23:30Z` on the anniversary day **qualifies** (proves the
  comparison is UTC-day-based, not instant-based — review #13).
- boundary pairs: rejects `assetCount = minAssets - 1`, accepts `= minAssets`; rejects
  `dayCount = 1`, accepts `= 2`.
- rejects a qualifying cluster that is **not** away from home.
- two qualifying clusters on the same day → returns the higher `assetCount`; equal counts → the
  lower `placeKeyOf` (deterministic).
- `null` on `[]`.

**`curateTripAssets`:** collapses within the 2-minute burst window · returns all when
`<= SMALL_TRIP_MAX` after collapsing · covers distinct days before topping up · **never exceeds the
`cap` argument**, including `cap` below the internal ladder (e.g. `cap: 4`) · output is chronological
and duplicate-free.

### 6.3 `trip-anniversary.rule.spec.ts` (BDD given/when/then)

Every case needs **three** fixtures across **two** repository methods with different date windows, so
these are written given/when/then to keep setup, trigger and assertion distinct.

- **Fires.** _Given_ a probe with one dominant city in `Y`, a home baseline in a different country,
  and a trip cluster whose `firstDate` is the anniversary with 8 assets over 3 days, _When_ evaluated
  on the anniversary, _Then_ exactly one candidate with pinned `title`, `subtitle`, `score`,
  `memoryAt` (= `firstDate`), `visibleForDays`, and a `place_day:` `dedupeKey`.
- **Shared-key contract.** _Given_ the **same** probe fixture fed to both rules, _When_ both evaluate,
  _Then_ `trip_anniversary`'s `dedupeKey` **equals** `on_this_day_place`'s for that year/day/place —
  asserted against the other rule's **real output**, never a hand-written string.
- **Scoring invariant.** _Given_ `trip_anniversary` at its **minimum** (`MIN_TRIP_DAYS`,
  `MIN_TRIP_ASSETS`, oldest year) and `on_this_day_place` at its **maximum** (`count >= 30`, most
  recent past year), _Then_ the trip score is strictly greater. Uses both rules' **real** scoring via
  exported constants, so retuning either cannot silently invert §3.3.
- **Probe short-circuit.** _Given_ no past year with a dominant city, _Then_ `[]` **and
  `getMemoryLocationClusters` was never called**.
- **Ambiguous home.** _Given_ a probe that **does** qualify, a baseline whose different-country
  runner-up is within 1.25×, **and a trip cluster that would otherwise qualify**, _Then_ `[]` **and
  `getMemoryAssetsForLocation` was never called** — proving the ambiguity guard fired, not the probe.
- **Mid-stay rejection.** _Given_ a qualifying probe and home, and a trip cluster whose `firstDate` is
  the day **before** the anniversary, _Then_ `[]` and no asset fetch.
- Boundary pairs: `dayCount` 1 vs 2; `assetCount` 6 vs 7; probe `ratio` just below vs at
  `MIN_PROBE_DOMINANCE`; probe `items.length` 2 vs 3.
- **Leap year.** _Given_ `target = 2024-02-29` and a qualifying 2023 trip, _Then_ the 2023 year is
  **skipped** (Luxon would clamp to Feb 28); _and_ `target = 2024-02-29` with a qualifying **2020**
  (leap) trip still fires.
- Skips the current year and future-dated assets.
- Caps candidates at `MAX_CANDIDATES`; caps assets at `ASSET_CAP` (reachable — §4.1).
- Evaluates at most `MAX_PROBE_YEARS` years (assert cluster-query call count).
- `subtitle` pluralization: `1 year ago` vs `3 years ago`.
- City `null` → title falls back to country only.

### 6.4 `themed.rule.spec.ts` (fake `ThemeSearchPort`)

- **Trigger day:** returns `[]` on days 1, 8, 15, 21, 23; fires on 22.
- **Fires:** pinned `title` (`Sunsets from 2023`), `subtitle`, exact `score`, `dedupeKey`,
  `visibleForDays: 5`.
- **Rotation:** `themeForMonth` pinned for all 12 months; month 1 and month 7 give the same theme;
  the same month in different years gives the same theme (stable across year and leap boundaries).
- **Disabled path:** `resolveEmbedding` → `null` ⇒ `[]` **and `searchByEmbedding` never called**.
- `resolveEmbedding` rejects ⇒ `[]`, no throw.
- **Year filter (§3.4.1):** _Given_ the port returns assets whose `localDateTime` falls in `Y-1` and
  `Y+1` as well as `Y`, _Then_ only the `Y` assets are counted, `count` reflects the filtered set, and
  `MIN_ASSETS` is applied **after** filtering (a year with 8 raw but 7 in-year assets does **not**
  fire).
- Boundary pair: `MIN_ASSETS - 1` in-year ⇒ `[]`; exactly `MIN_ASSETS` ⇒ fires.
- Searches exactly `MAX_YEARS_BACK` years, never the current year.
- **Multi-year:** two qualifying years ⇒ **both** candidates returned (sorted desc), capped at
  `MAX_CANDIDATES` — the review-#4 regression guard.
- **Non-tautological ordering:** _Given_ the port returns assets in **similarity** (non-chronological)
  order, _Then_ `assetIds` equals a **pinned** id array that is chronological and capped at
  `ASSET_CAP` — proving `sampleAssetsByTime` reordered them.
- Passes `size: FETCH_SIZE` and `Date` (not `DateTime`) bounds to the port.

### 6.5 `theme-search.adapter.spec.ts`

- `resolveEmbedding` → `null` when `isSmartSearchEnabled` is false; `encodeText` **not** called.
- `encodeText` called **once** for two identical `(modelName, language, themeKey)` requests.
- called **again** when `clip.modelName` changes; **and again** when `language` changes (cache key
  includes both).
- `encodeText` rejects ⇒ `null`, logged, no throw.
- `searchByEmbedding` forwards `userIds: [ownerId]`, `type: Image`, `visibility: Timeline`, `size`,
  `maxDistance` from config, and **2-day-widened** bounds (assert the exact widened Dates); maps rows
  to `{ id, localDateTime }`.

### 6.6 `video-moments.rule.spec.ts`

- Returns `[]` on days 1, 7, 9, 15, 22; fires on 8.
- Fires: pinned `title`, `subtitle`, `dedupeKey`, `visibleForDays`, and the **worked score 94**
  from §4.3.
- Duration band: `2_999` excluded, `3_000` included, `180_000` included, `180_001` excluded, `null`
  excluded.
- Boundary pair: `MIN_ASSETS - 1` survivors ⇒ `[]`; exactly `MIN_ASSETS` ⇒ fires.
- **Selection (given/when/then).** _Given_ 4 favourites and 10 non-favourites in band, _When_
  evaluated, _Then_ `assetIds` equals a **pinned** array containing all 4 favourites plus 4
  evenly-spaced others, in chronological order.
- **Favourites exceed the cap:** _Given_ 12 favourites, _Then_ exactly `ASSET_CAP` ids, evenly spaced.
- `favoriteCount` is capped in the score: 20 favourites and 10 favourites yield the **same** score.
- `count`/`favoriteCount` are pre-selection (a year with 12 in-band videos reports `12 videos` in the
  subtitle despite 8 `assetIds`).
- Pluralization: exercise the plural branch at `3` and `6` videos. **The singular branch is
  unreachable through the public API** — `MIN_ASSETS = 3` means a year with one survivor never fires,
  and `count` is that same pre-selection survivor set, so a fired candidate can never report
  `count === 1`. Keep the singular-safe ternary in the candidate for consistency with the other
  rules, but do not assert an unreachable `1 video` subtitle.
- Skips current/future years; caps at `MAX_YEARS`.
- Passes `type: AssetType.Video` to the repository (assert the call argument).

### 6.7 Registry, metadata & shared lists

- `memory-type.metadata.spec.ts`: new key exists, `kind: 'rule'`, `defaultEnabled: true`,
  `adminConfigurable: true`; in `buildDefaultMemoryTypeMap()`;
  `getMemoryTypeKeyForMemory(MemoryType.Rule, { ruleId: key })` round-trips.
- `memory-type.registry.spec.ts`: the key builds a rule whose `id` equals it; **update the
  completeness-guard count** per §3.1.
- `preferences.spec.ts`: default `memories.types` gains the key.
- `server.service.spec.ts`: **both** `availableMemoryTypes` assertions (default ~line 196 and the
  admin-disabled case ~line 220) per §3.1's expected arrays.
- `MemoriesSettings.spec.ts`: switch count **and** the full `types` object literal in the save-payload
  test (~lines 92-107).
- `e2e/src/specs/server/api/server.e2e-spec.ts`: the `availableMemoryTypes` fixture.

### 6.8 Medium tests (real DB)

**`asset.repository.spec.ts`** — extend `describe('getMemoryAssetsForPeriod')`:

- rows carry `type` and `duration`.
- `type: AssetType.Video` returns only videos; omitting `type` returns both (proves the filter is
  opt-in and existing callers are unaffected).
- a video with `duration: null` is still returned (the band filter is the rule's job).
- an asset **exactly on** `takenBefore` is included (SQL uses `<=`).

**`memory.service.spec.ts`** — one positive + one negative per rule.
`seedRuleAsset` (`memory.service.spec.ts:41-62`) currently accepts only
`{ ownerId, localDateTime, city, country, isFavorite }`; **extend it with
`type?: AssetType, duration?: number`** (verify `ctx.newAsset` supports both; if not, set them via a
follow-up update in the helper).

- `video_moments`: videos in the target month of a past year, evaluated on **day 8** ⇒ memory row with
  expected `data.ruleId`/`title`/assets. **Negative:** identical data on day 7 ⇒ no memory.
- `trip_anniversary`: away-from-home multi-day cluster plus home baseline ⇒ memory.
  **Negative:** same cluster with `dayCount: 1` ⇒ no memory.
- `themed`: **injection seam** — `MemoryService` exposes the port via a
  `protected createThemeSearchPort(): ThemeSearchPort` factory method (review #2). The medium test
  subclasses `MemoryService` to return a stub, so **no live ML service is required**. Positive: stub
  returns an embedding + assets ⇒ memory. Negative: stub returns `null` embedding ⇒ no memory.
- **Slot budget:** on a day when two multi-day memories are already visible, `createRuleMemories`
  inserts nothing (guards §3.6).

### 6.9 Mobile

- `NativeVideoViewer` defaults `forceAutoPlay` to `false`.
- `DriftMemoryCard` constructs `NativeVideoViewer` with `forceAutoPlay: true` for a video asset.

> **Honest constraint:** `NativeVideoViewer` initialises a platform video controller on mount, so a
> full pump may be flaky in CI. If unstable, downgrade to a **construction-only** assertion (build the
> tree without pumping frames) and record manual verification in the PR. Do **not** paper over a flake
> with a retry — per fork policy, flakes are fixed at the root or the test is scoped down deliberately.

### 6.10 Edge-case catalog

| #   | Edge case                                         | Handling                                             | Test          |
| --- | ------------------------------------------------- | ---------------------------------------------------- | ------------- |
| 1   | No geotagged on-this-day assets                   | probe short-circuits, zero cluster queries           | 6.3           |
| 2   | Ambiguous home                                    | `inferHome` → `null`; asserted via no asset fetch    | 6.2, 6.3      |
| 3   | Mid-stay (arrived before the anniversary)         | `GAP_DAYS` pre-window ⇒ `firstDate` guard            | 6.2, 6.3      |
| 4   | **Leap year — Feb 29 anniversary**                | explicit clamp guard skips invalid `(Y, Feb 29)`     | 6.3           |
| 5   | `firstDate` late in the UTC day (23:30Z)          | UTC-day `hasSame` comparison                         | 6.2           |
| 6   | Trip longer than `TRIP_WINDOW_DAYS`               | span truncates; still fires                          | 6.3           |
| 7   | trip vs `on_this_day_place` same day              | shared key; proven score precedence                  | 6.3           |
| 8   | Smart search disabled / ML down                   | `resolveEmbedding` → `null` ⇒ `[]`, no search        | 6.4, 6.5      |
| 9   | CLIP model **or language** changed                | cache key includes both                              | 6.5           |
| 10  | **`fileCreatedAt` vs `localDateTime` skew**       | widened search + in-rule year filter                 | 6.4, 6.5      |
| 11  | **Themed year-boundary assets (Dec 31/Jan 1)**    | in-rule `localDateTime` year filter                  | 6.4           |
| 12  | **Themed newest year already generated**          | emit up to 3 years so older years stay reachable     | 6.4           |
| 13  | Video `null` duration                             | excluded by band; query still returns it             | 6.6, 6.8      |
| 14  | 1-second clip / 10-minute recording               | duration band boundaries                             | 6.6           |
| 15  | **Favourites exceed `ASSET_CAP`**                 | evenly-spaced truncation                             | 6.6           |
| 16  | **Uncapped favourite bonus inverting precedence** | `MAX_FAVORITE_BONUS` cap                             | 6.6           |
| 17  | **Slot starvation by multi-day rules**            | trigger days + 5-day windows (§3.6)                  | 6.8           |
| 18  | **Two new rules colliding (day 8 / 22)**          | distinct trigger days; trip may still coincide       | 6.8           |
| 19  | **User with zero assets**                         | every rule returns `[]`, no throw                    | 6.3, 6.4, 6.6 |
| 20  | **Empty candidate set → `medianTime([])`**        | guarded by `MIN_ASSETS` before any `medianTime` call | 6.4, 6.6      |
| 21  | **Asset exactly on `takenBefore`**                | SQL `<=` inclusive                                   | 6.8           |
| 22  | Existing rules see new required fields            | 4 fixture factories updated in Slice 1               | 6.8, gates    |
| 23  | Duplicate ids within a candidate                  | `curateTripAssets` / `sampleAssetsByTime` dedupe     | 6.2           |
| 24  | Future-dated assets                               | `takenBefore: target.endOf('day')` on every query    | 6.3, 6.6      |

## 7. Verification gates

```bash
cd server && pnpm test -- --run src/services/memory-rules/
cd server && pnpm test -- --run src/utils/preferences.spec.ts src/services/server.service.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/asset.repository.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/services/memory.service.spec.ts
make check-server
make lint-server
cd server && npx prettier --check "src/services/memory-rules/**" "src/repositories/asset.repository.ts"
cd web && pnpm test -- --run src/routes/admin/system-settings/MemoriesSettings.spec.ts
make check-web
cd mobile && dart analyze --fatal-infos lib test && dart format --set-exit-if-changed .
npx prettier --check "docs/**/*.md" "i18n/en.json"
```

Plus: `make sql` **against a running dev DB only**; feature branches trigger **no** CI on push, so
dispatch explicitly with `gh workflow run test.yml --ref feat/memory-types-tier3` and check
**job-level** status (a run-level "success" can hide a failed job).

## 8. Implementation slices (for `/impl-loop`)

**Slices 2 → 5 → 7 are strictly ordered** (they mutate the same shared lists — §3.1). Slices 1, 3, 4,
6 are free to move within their chains.

### Slice 1 — `getMemoryAssetsForPeriod` returns `type` + `duration`

**Files:** `asset.repository.ts` (interfaces + query); **the 4 fixture factories** in
`month-recap.rule.spec.ts`, `favorites-throwback.rule.spec.ts`, `on-this-day-place.rule.spec.ts`,
`season-recap.rule.spec.ts`; medium spec.
**Red:** `cd server && pnpm test:medium -- --run test/medium/specs/repositories/asset.repository.spec.ts` — §6.8.
**Green:** add columns + destructure `type` + `$if` predicate; update the 4 factories.
**Verify:** medium green; **all tier-1 rule specs green**; `make check-server`; `make sql` on a live DB.
**Commit:** `feat(memories): return asset type and duration from getMemoryAssetsForPeriod`

### Slice 2 — `video_moments` (end-to-end; pattern-setter for the 16 sites)

**Red:** `cd server && pnpm test -- --run src/services/memory-rules/video-moments.rule.spec.ts` — §6.6.
**Green:** the rule + all 16 registration sites; expected arrays per §3.1 (**9** keys).
**Verify:** §7 server + web gates; e2e fixture updated.
**Commit:** `feat(memories): add video_moments memory type`

### Slice 3 — Mobile force-autoplay

**Red:** §6.9. **Green:** `forceAutoPlay` + pass `true`.
**Verify:** `dart analyze --fatal-infos lib test`; `dart format --set-exit-if-changed .`.
**Commit:** `fix(mobile): force autoplay for videos in the memory viewer`

### Slice 4 — `trip.util.ts` + `recent_trip` refactor

**Files:** `trip.util.ts` + spec; refactor `recent-trip.rule.ts` onto it (deleting its private
`curateTripAssets`/`collapseBurstAssets`/`groupAssetsByDay`/`pickDayCoverage`/`pickEvenlySpaced`),
calling `curateTripAssets(assets, 10)`.
**Red:** `cd server && pnpm test -- --run src/services/memory-rules/trip.util.spec.ts` — §6.2.
**Green:** implement, then rewire `recent-trip.rule.ts`.
**Verify:** `recent-trip.rule.spec.ts` passes **unchanged** — the regression guard.
**Commit:** `refactor(memories): extract shared trip detection and curation helpers`

### Slice 5 — `trip_anniversary` + shared place-day dedupe

**Files:** `trip-anniversary.rule.ts` + spec; `on-this-day-place.rule.ts` (**three** changes: shared
`placeKeyOf`, `place_day:` dedupe namespace, `Math.min(count, 30)` score cap; export constants) + its
spec; the 16 sites (**10** keys).
**Red:** §6.3.
**Verify:** the shared-key **and** scoring-invariant tests pass; `on-this-day-place.rule.spec.ts`
updated for the new key format and capped score **only**.
**Commit:** `feat(memories): add trip_anniversary memory type`

### Slice 6 — Theme catalog + port + adapter

**Files:** `theme.catalog.ts` (+ rotation spec), `theme-search.port.ts`, `theme-search.adapter.ts` +
spec; `config.ts` + `system-config.dto.ts` for `memories.themeMaxDistance`; SDK regeneration.
**Red:** §6.5.
**Verify:** `make check-server`; regenerate the SDK (`cd server && pnpm build && pnpm sync:open-api`,
then `make open-api-typescript`) and commit the generated output.
**Commit:** `feat(memories): add theme catalog and smart-search port for themed memories`

### Slice 7 — `themed` (end-to-end)

**Files:** `themed.rule.ts` + spec; `memory.service.ts` (the `protected createThemeSearchPort()`
factory + memoized field, passed into `getMemoryRules` deps); `memory-type.registry.ts`
(`MemoryRuleDeps.themeSearchPort`); the 16 sites (**11** keys).
**Red:** §6.4.
**Verify:** existing `memory.service.spec.ts` spies on `getMemoryRules`/`createRuleMemories` are
arg-agnostic — **confirm they stay green unchanged**; full server suite.
**Commit:** `feat(memories): add themed memory type backed by smart search`

### Slice 8 — Medium tests, calibration, docs

**Files:** medium `memory.service.spec.ts` (§6.8, incl. the `seedRuleAsset` extension and the slot
test), `docs/docs/features/memories.md`, `docs/docs/install/config-file.md`, roadmap Status.
**Calibration (gates merge):** deploy an RC to the personal instance and tune
`memories.themeMaxDistance`:

1. Run each of the 6 themes at `0.22 / 0.26 / 0.30 / 0.34` against a real library.
2. Record per-theme result counts and eyeball precision on the top 16.
3. Pick the highest threshold at which **no theme shows obvious false positives** in its top 16;
   record the choice and counts in the PR.
4. If a theme cannot be made precise at any threshold, **drop it from the catalog** rather than
   loosening the global default.

**Verify:** every gate in §7.
**Commit:** `docs(memories): document tier 3 memory types and calibrate theme threshold`

### Dependency graph

```
Slice 1 ──▶ Slice 2 ──────────────┐
Slice 3 (independent)             │
Slice 4 ──▶ Slice 5 ──────────────┤──▶ Slice 8
Slice 6 ──▶ Slice 7 ──────────────┘

Shared-list ordering constraint:  Slice 2 ──▶ Slice 5 ──▶ Slice 7
```

## 9. Follow-ups (out of scope)

| Item                                                          | Why deferred                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Mobile memory viewer has **no auto-advance timer**            | Pre-existing, affects every memory type. `DriftMemoryCard.onVideoEnded` is plumbed but unused by `drift_memory.page.dart` |
| `RULE_DAILY_LIMIT = 2` contention on days 20–26               | Raising it is an engine change; §3.6 keeps 13–14 and 27+ always free                                                      |
| Web: cap the progress timer for very long videos              | `MemoryViewer.svelte:120-125` uses full `asset.duration`                                                                  |
| Per-theme thresholds instead of one global `themeMaxDistance` | Revisit if calibration shows themes diverging widely                                                                      |
| Widening `themed` beyond `MAX_YEARS_BACK = 3`                 | Cheap to raise later; keeps nightly cost bounded                                                                          |
| Roadmap #8, #9, #12–14                                        | Not this batch; #9 needs a sensitivity frame                                                                              |
| `statistics()` counts memories of disabled types              | Pre-existing documented limitation                                                                                        |
