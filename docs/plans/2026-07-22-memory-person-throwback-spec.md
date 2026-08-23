# Person Throwback Memory — Design & Test Spec

> Implements roadmap item **#9 "Someone you haven't seen"** from the
> [memory types roadmap](./2026-07-15-memory-types-roadmap.md), reframed (§2 D1).
> Stacked on **PR #812** (`feat/memory-types-tier3`).
> Branch: `feat/memory-person-throwback`.
> Approach: **test-driven, behavior-driven, full edge-case coverage** — see §4.0 for what that
> requires of the implementer.
> Created 2026-07-22.
> Status: **spec — not yet implemented.**

## 1. Goal & non-goals

**Goal:** add one `MemoryRule` that resurfaces a warm chapter with a person who has not
appeared in the user's photos for an admin-configurable dormancy window (default 6 months).

| Key                | Memory                                        | Trigger day | Window |
| ------------------ | --------------------------------------------- | ----------- | ------ |
| `person_throwback` | "Times with Anna" · "23 photos · August 2019" | **13**      | 7 d    |

**Non-goals (this batch):**

- **No per-person "exclude from memories" control.** That is a deliberate follow-up PR (§8) that
  spans every person-based rule, not just this one.
- No engine change to `memory.service.ts` scheduling, `RULE_DAILY_LIMIT`, the multi-day slot cap,
  or cleanup. The rule is a pure function of `(ownerId, target, injected repositories)`.
- No localization of memory _content_ (titles/subtitles stay English, matching every existing rule).
- No `MemoryType` enum or `memory` table schema change.
- No change to the shipped `birthday` rule, including the sampling issue noted in §7.3.

## 2. Design decisions

| #   | Decision                                                                          | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **The dormancy gap is never shown to the user**                                   | The gap is a _selection heuristic only_. Titling it ("You haven't seen Anna in 2 years") makes the app assert something about a relationship — which lands badly when the person has died or the friendship ended. As a silent selector it reads like any other memory.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D2  | Key is **`person_throwback`**, not `someone_missed`                               | The name must not smuggle back the emotional claim D1 removed. Rhymes with the shipped `favorites_throwback`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D3  | Dormancy threshold **admin-configurable, default 6 months, no upper bound**       | Photo-absence ≠ real absence, so a shorter threshold admits many people the user still sees — harmless false positives under D1, but they **dilute** how much the rule concentrates on people who are genuinely gone. Originally fixed at 12 months; lowered to a **configurable 6** (2026-07-26) because 12 made the rule effectively unfireable on real libraries — a 65k-asset library with 12 named people had a most-dormant gap of only 9 months, putting the earliest natural fire ~16 months after install. Admins who want the stricter original behaviour set `memories.personThrowbackDormancyMonths` back to `12`. No upper bound because `month_recap` / `favorites_throwback` already surface arbitrarily old photos. |
| D4  | Show the person's **densest chapter**, not their last or a career-spanning spread | Densest cluster ≈ a real event (trip, wedding, summer) ≈ the best photos of them, and it is visually coherent. "Last chapter" is the heaviest possible cut if the person died; an all-years spread reads as an in-memoriam reel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D5  | **Gap length is not scored**                                                      | Ranking by dormancy would put the most-likely-deceased person first. Rank by chapter richness so the best-documented relationships win.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D6  | `recencyBonus` **is** applied to the chapter year                                 | Conventional (every rule uses it) _and_ it mildly favours recently-dormant people, further diluting the concentration in D3. One lever, two jobs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D7  | **Pets excluded** (`person.type = 'person'`)                                      | A pet dormant for the whole window has overwhelmingly died — it lacks the "maybe I just don't photograph them" ambiguity that makes the human case safe. Roadmap #10 owns pets and can frame them deliberately.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D8  | Rule returns **up to 5 candidates**, not 1                                        | `hasRuleMemory` dedup happens in the engine _after_ the rule returns. A 1-candidate rule whose key already fired contributes nothing — permanently. This is the exact trap Tier 3 hit. Multiple candidates let the engine skip fired keys and reach a fresh person.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D9  | Chapter density computed from **daily counts**, not fetched assets                | Lets the rule find the true densest window without fetching a heavy subject's whole history (an ex-partner may have thousands of photos). Also makes the core algorithm a pure function over small integers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D10 | `defaultEnabled: true`                                                            | Matches every other type and how Apple/Google actually behave. Escape hatches until the §8 follow-up: the per-user type toggle and `person.isHidden`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D11 | Rule **exports its constants**                                                    | Private statics make thresholds untestable — the Tier 3 D8 lesson.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 3. Architecture

### 3.1 Every site a new memory type touches

Traced from `themed` (added in PR #812). **All 16 sites.** Because D10 makes the key
admin-available by default, rows 8, 10 and 7 **do** change (they would not have under an opt-in
default) — so this branch serialises against any other branch adding a memory type.

| #   | File                                                             | What changes                                                           |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | `server/src/services/memory-rules/memory-type.metadata.ts`       | `MEMORY_TYPE_METADATA` entry (appended last)                           |
| 2   | `server/src/services/memory-rules/memory-type.metadata.spec.ts`  | assert key, kind, defaults                                             |
| 3   | `server/src/services/memory-rules/memory-type.registry.ts`       | `RULE_FACTORIES` entry (no `MemoryRuleDeps` change — §3.2)             |
| 4   | `server/src/services/memory-rules/memory-type.registry.spec.ts`  | factory builds the right rule + completeness guard **10 → 11**         |
| 5   | `server/src/services/memory-rules/person-throwback.rule.ts`      | the rule                                                               |
| 6   | `server/src/services/memory-rules/person-throwback.rule.spec.ts` | unit/BDD spec                                                          |
| 7   | `server/src/utils/preferences.spec.ts`                           | default per-user type map gains the key                                |
| 8   | `server/src/services/server.service.spec.ts`                     | **TWO** `availableMemoryTypes` assertions                              |
| 9   | `server/test/medium/specs/services/memory.service.spec.ts`       | end-to-end generation medium test                                      |
| 10  | `e2e/src/specs/server/api/server.e2e-spec.ts`                    | `availableMemoryTypes` fixture — **the server unit suite misses this** |
| 11  | `web/src/routes/admin/system-settings/MemoriesSettings.svelte`   | hardcoded `memoryTypeKeys` array                                       |
| 12  | `web/src/routes/admin/system-settings/MemoriesSettings.spec.ts`  | the full `types` object literal in the save-payload test               |
| 13  | `i18n/en.json`                                                   | 4 keys (§3.6)                                                          |
| 14  | `docs/docs/features/memories.md`                                 | user-facing type list                                                  |
| 15  | `docs/docs/install/config-file.md`                               | `memories.types` config keys                                           |
| 16  | `docs/plans/2026-07-15-memory-types-roadmap.md`                  | #9 Status → **Shipped**; also correct #12's status (§8)                |

Expected `availableMemoryTypes` (registry order) after this branch — **12** entries:

```
on_this_day, birthday, recent_trip, month_recap, favorites_throwback, on_this_day_place,
season_recap, people_together, video_moments, trip_anniversary, themed, person_throwback
```

The registry completeness guard asserts one rule per `kind: 'rule'` entry: **10 → 11**
(`on_this_day` is not rule-kind).

### 3.2 New / changed source files, with exact signatures

| File                                                 | Change                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/repositories/person.repository.ts`              | **New** `getDormantPeople`                                             |
| `src/repositories/asset.repository.ts`               | **New** `getMemoryPersonDailyCounts`, `getMemoryAssetsForPersonWindow` |
| `src/services/memory-rules/chapter.util.ts`          | **New**, pure                                                          |
| `src/services/memory-rules/person-throwback.rule.ts` | **New** rule                                                           |
| `src/services/memory-rules/memory-type.registry.ts`  | one factory entry                                                      |
| `src/services/memory-rules/memory-type.metadata.ts`  | one metadata entry                                                     |

`MemoryRuleDeps` already carries `personRepository` and `assetRepository`, so the registry's deps
interface is **unchanged**:

```ts
person_throwback: (deps) => new PersonThrowbackMemoryRule(deps.personRepository, deps.assetRepository),
```

### 3.3 Repository queries

Three queries, all `@GenerateSql`-decorated (so `make sql` must be re-run — §6.2).

```ts
// person.repository.ts
// `id` and `name` only — the rule consumes nothing else. Ranking happens SQL-side (ORDER BY, which
// needs no SELECT), and scoring uses `chapter.count`, not the person's lifetime total. Returning
// `lastSeenAt` / `assetCount` would be dead weight, and `lastSeenAt` is exactly the dormancy figure
// D1 keeps out of user-facing data.
export interface DormantPerson {
  id: string;
  name: string;
}

getDormantPeople(
  ownerId: string,
  { lastSeenBefore, minAssets, limit }: { lastSeenBefore: Date; minAssets: number; limit: number },
): Promise<DormantPerson[]>;
```

`FROM person JOIN asset_face JOIN asset`, filtered by:

| Side   | Predicates                                                                              |
| ------ | --------------------------------------------------------------------------------------- |
| person | `ownerId = :ownerId`, `type = 'person'` (D7), `name != ''`, `isHidden = false`          |
| face   | `deletedAt IS NULL`, `isVisible = true`                                                 |
| asset  | `ownerId = :ownerId`, `visibility = Timeline`, `deletedAt IS NULL`, preview file EXISTS |

then `GROUP BY person.id` `HAVING max(asset."localDateTime") < :lastSeenBefore AND count(DISTINCT asset.id) >= :minAssets`,
`ORDER BY count(DISTINCT asset.id) DESC, person.id ASC` (deterministic tie-break), `LIMIT :limit`.

The asset-side predicates **must match `getMemoryFacesForPeriod` exactly**, otherwise a person can
look dormant merely because their recent photos are archived or lack a preview.

```ts
// asset.repository.ts
export interface MemoryPersonDayCount {
  personId: string;
  day: Date;   // date-truncated localDateTime, UTC
  count: number;
}

getMemoryPersonDailyCounts(
  ownerId: string,
  personIds: string[],
  { takenBefore }: { takenBefore: Date },
): Promise<MemoryPersonDayCount[]>;   // ORDER BY personId, day ASC

getMemoryAssetsForPersonWindow(
  ownerId: string,
  personId: string,
  { from, to }: { from: Date; to: Date },
): Promise<MemoryAsset[]>;            // ORDER BY localDateTime ASC
```

`getMemoryPersonDailyCounts` returns one row per (person, calendar day) — small even for a heavy
subject — and is the input to the pure density algorithm (D9). `getMemoryAssetsForPersonWindow` is
bounded by a ≤14-day window, so it needs no `LIMIT` guess.

**Why not reuse `getMemoryAssetsForPerson`:** it is
`DISTINCT ON (asset.id) ORDER BY asset.id … LIMIT 60`, which returns the 60 **lowest UUIDs** — an
arbitrary sample, not the 60 most recent. Unusable for density. (See §7.3.)

### 3.4 `chapter.util.ts` — exact exports

```ts
export const CHAPTER_MAX_SPAN_DAYS = 14;

export interface DayCount {
  day: Date;
  count: number;
}

export interface Chapter {
  from: Date; // first day of the winning window
  to: Date; // last day of the winning window
  count: number; // assets inside it, summed from the daily counts
}

/**
 * Widest-count window of at most `maxSpanDays` consecutive calendar days.
 * Sorts `days` ascending defensively — the query already orders them, but the
 * two-pointer sweep silently returns garbage on unsorted input rather than
 * failing, so the contract is enforced here rather than assumed.
 * Ties resolve to the MOST RECENT window. Returns null for empty input.
 */
export const densestChapter = (days: DayCount[], maxSpanDays: number): Chapter | null;
```

Two-pointer sweep: for each right index, advance `left` while
`day[right] - day[left] > maxSpanDays - 1`; track the running sum. Update the best window on
`sum >= best` (`>=`, not `>`, so the last — most recent — maximal window wins, per D4's tie rule).

### 3.5 The rule

```ts
export const TRIGGER_DAY = 13;
/** Fallback for `memories.personThrowbackDormancyMonths` (admin-configurable). */
export const DEFAULT_DORMANCY_MONTHS = 6;
export const MIN_TOTAL_ASSETS = 10;
export const MIN_CHAPTER_ASSETS = 6;
export const CANDIDATE_POOL = 10;
export const MAX_CANDIDATES = 5;
export const ASSET_CAP = 8;
export const VISIBLE_FOR_DAYS = 7;
export const SCORE_BASE = 110;
export const MAX_COUNT_BONUS = 30;
```

**Trigger day 13 — chosen by window occupancy, not by free trigger slots (§5.1).** It is also
`≤ 28`, so it never hits the Luxon month-length clamp that bit Tier 3.

Flow:

1. Return `[]` unless `target.day === TRIGGER_DAY`. No repository call before this check.
2. `lastSeenBefore = target.startOf('day').minus({ months: dormancyMonths })`, where `dormancyMonths`
   comes from `memories.personThrowbackDormancyMonths` (default 6). Dormant means
   `lastSeenAt < lastSeenBefore`, **strictly** — a person last seen exactly at the cutoff is not yet
   dormant. (Subtracting whole months from day 13 always lands on day 13; no clamping.)
3. `getDormantPeople(ownerId, { lastSeenBefore, minAssets: MIN_TOTAL_ASSETS, limit: CANDIDATE_POOL })`.
   Pool of 10 > the 5 returned, so chapter-density ranking has room to reorder the SQL's
   total-count ordering.
4. **If the pool is empty, return `[]` immediately.** Calling step 5 with an empty id list would
   emit `IN ()`, which is not valid SQL. This short-circuit is load-bearing, not an optimisation.
5. `getMemoryPersonDailyCounts(ownerId, ids, { takenBefore: lastSeenBefore })`.
6. Per person: `densestChapter(days, CHAPTER_MAX_SPAN_DAYS)`; drop if `null` or
   `count < MIN_CHAPTER_ASSETS`. No distinct-day minimum — a wedding is one day and is a fine memory.
7. Score, sort desc (tie-break `personId` asc), take `MAX_CANDIDATES`.
8. For each survivor, `getMemoryAssetsForPersonWindow`, then **re-check
   `assets.length >= MIN_CHAPTER_ASSETS` and drop the candidate if it fails.** `chapter.count` came
   from step 5 and the assets arrive in a later, separate query; anything deleted or archived in
   between would otherwise produce a memory with too few assets — or none at all.
9. `assetIds = sampleAssetsByTime(assets, ASSET_CAP)` and
   `memoryAt = DateTime.fromJSDate(medianTime(assets), { zone: 'utc' })` — both over the **full**
   window set, not the sampled 8 (matching `people_together`). Note the `fromJSDate` wrap:
   `medianTime` returns a `Date`, but `MemoryRuleCandidate.memoryAt` is a Luxon `DateTime`.

Steps 7–8 can shrink the result below `MAX_CANDIDATES` when read skew drops a survivor; the rule
does **not** backfill from the pool. Read skew is rare and D8 only needs _some_ depth, not exactly 5.

```
score = SCORE_BASE + min(chapter.count, MAX_COUNT_BONUS) * 3 + recencyBonus(chapterYear, target.year)
```

`chapter.count` here is the **full** chapter total from step 6, not `assetIds.length`.
`chapterYear` is the year of **`chapter.to`** — the window's most recent day. It cannot be `memoryAt`'s
year: scoring happens in step 7, before the assets (and therefore `memoryAt`) exist. Using the
window's last day is also the better recency signal. The two differ only for a chapter that straddles
a year boundary.

Score bands compared by **achievable range**, not base — comparing bases is misleading, because the
count multipliers differ by 3× between rules:

| Rule                | Formula                            | Typical (15 assets, 2 yrs back) | Max       |
| ------------------- | ---------------------------------- | ------------------------------- | --------- |
| `birthday`          | `300 + years*10 + n`               | ~330                            | ~370      |
| `trip_anniversary`  | `260 + days*4 + min(n,20) + bonus` | ~300                            | ~318      |
| `person_throwback`  | `110 + min(n,30)*3 + bonus`        | **163**                         | **210**   |
| `people_together`   | `100 + n*3 + bonus`                | 153                             | unbounded |
| `on_this_day_place` | `100 + min(n,30)*3 + bonus`        | 153                             | 200       |
| `season_recap`      | `90 + min(n,40) + bonus`           | 113                             | 140       |
| `month_recap`       | `80 + min(n,30) + bonus`           | 103                             | 120       |
| `themed`            | `70 + min(n,25) + bonus`           | 93                              | 105       |
| `video_moments`     | `60 + …`                           | ~80                             | ~95       |

Deliberately mirrors `people_together`'s shape — same ×3 multiplier, +10 base for being rarer (once
ever per person), but **capped** at 30 where `people_together` is uncapped. So it edges out the
other person-centric rule in the typical case without ever running away. It stays well below the
date-anchored `birthday` / `trip_anniversary`, which must fire on their day or wait a year.

Candidate shape:

```ts
{
  ruleId: 'person_throwback',
  dedupeKey: `person_throwback:${person.id}`,   // once ever, per D8's pool
  title: `Times with ${person.name}`,
  // `chapter.count` — the full chapter total (e.g. "23 photos"), NOT assetIds.length (≤ 8).
  // The memory shows 8 of them; the subtitle describes the chapter. Matches `people_together`.
  subtitle: `${chapter.count} photos · ${monthName(memoryAt.month)} ${memoryAt.year}`,
  score,
  assetIds,
  memoryAt,
  visibleForDays: VISIBLE_FOR_DAYS,
  context: { personId, chapterFrom, chapterTo, count: chapter.count },
}
```

### 3.6 i18n keys (`i18n/en.json`, EN only)

| Key                                                      | Value                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `admin.memory_type_person_throwback_setting`             | Person throwback                                                                     |
| `admin.memory_type_person_throwback_setting_description` | Resurface a warm chapter with someone who has not appeared in photos for a while.    |
| `memory_type_person_throwback`                           | Times with someone                                                                   |
| `memory_type_person_throwback_description`               | Occasionally resurface photos of a person you have not photographed in a long while. |

Note the shape, verified against `en.json`: the **admin** pair is `memory_type_<key>_setting` /
`_setting_description` nested under the `admin` object (~line 330), while the **user** pair is
`memory_type_<key>` / `_description` at top level (~line 2013). The admin keys are _not_
`admin.memory_type_<key>`. Web and mobile share one `i18n/` directory; only `en.json` needs the new
keys.

## 4. Behaviour spec (tests)

### 4.0 How these tests get written

Every row in §4.1–§4.4 is written **before** the code that satisfies it, and is **observed
failing** before that code exists. A row that has never been seen red has not been shown to test
anything — most of the Tier-3 defects were found exactly this way.

Two rules specific to this spec:

- **Assert the failure mode, not just the return value.** Row 4.2 #2 is the worked example: `[]` is
  the right answer both with and without the step-4 short-circuit, so the row asserts the _absent
  second query_ instead. Several rows here are like that — read the Expect column literally.
- **Never assert a SQL-side filter against a mocked repository.** It only tests the mock. Arguments
  go in §4.2 row 7, behaviour goes in §4.4.

Each row is one `it(...)`, phrased as behaviour ("returns nothing when the person is a pet"), not as
implementation ("calls getDormantPeople with type filter").

### 4.1 `chapter.util.spec.ts` — pure

| #   | Given                                        | Expect                                                                |
| --- | -------------------------------------------- | --------------------------------------------------------------------- |
| 1   | empty input                                  | `null`                                                                |
| 2   | one day, 3 assets                            | window of that day, `count 3`                                         |
| 3   | all days inside the span                     | whole set                                                             |
| 4   | two clusters, second denser                  | the second                                                            |
| 5   | two clusters, **equally dense**              | the **more recent** one (D4 tie rule)                                 |
| 6   | days exactly `maxSpanDays - 1` apart         | both included — the window covers exactly `maxSpanDays` calendar days |
| 7   | days exactly `maxSpanDays` apart             | split into separate windows                                           |
| 8   | dense window at the very start of the series | found (no off-by-one at `left = 0`)                                   |
| 9   | input in **descending** order                | same result as ascending — the defensive sort holds the contract      |

### 4.2 `person-throwback.rule.spec.ts`

| #   | Given                                                                                    | Expect                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `target.day !== 13`                                                                      | `[]`, **no repository call**                                                                                                                                                                                                                                           |
| 2   | no dormant people                                                                        | `[]`, and `getMemoryPersonDailyCounts` is **never called** — the step-4 short-circuit. Asserting only `[]` would pass without the guard and let `IN ()` reach the DB                                                                                                   |
| 3   | dormant "Anna", 23-asset chapter in Aug **2023**, `target` = 2026-08-13                  | one candidate, everything pinned: `title` `'Times with Anna'`, `subtitle` `'23 photos · August 2023'`, `dedupeKey` `'person_throwback:<id>'`, and **`score === 186`** — `110 + min(23,30)*3 + max(0, 10-(2026-2023))` = `110+69+7`. Pin the number, not the formula    |
| 4   | last seen **exactly** at the cutoff                                                      | not dormant → excluded (strict `<`)                                                                                                                                                                                                                                    |
| 5   | last seen one day before the cutoff                                                      | dormant → included                                                                                                                                                                                                                                                     |
| 6   | chapter has 5 assets (`< MIN_CHAPTER_ASSETS`)                                            | excluded                                                                                                                                                                                                                                                               |
| 7   | any run reaching step 3                                                                  | `getDormantPeople` receives `minAssets: 10`, `limit: 10`, and `lastSeenBefore` exactly `personThrowbackDormancyMonths` (default 6) before `target.startOf('day')` — the four SQL-side filters are asserted **at the query argument** here, and their behaviour in §4.4 |
| 8   | 7 qualifying people                                                                      | exactly `MAX_CANDIDATES` (5) returned, score desc                                                                                                                                                                                                                      |
| 9   | two people with identical scores                                                         | ordered by `personId` asc (deterministic)                                                                                                                                                                                                                              |
| 10  | chapter spans a month boundary                                                           | subtitle uses the **median** asset's month/year                                                                                                                                                                                                                        |
| 11  | single-day chapter of 8 assets                                                           | included (no distinct-day minimum)                                                                                                                                                                                                                                     |
| 12  | chapter year is 4 years back                                                             | `recencyBonus` = 6 in the score (D6)                                                                                                                                                                                                                                   |
| 13  | equal chapters, one dated 2 yrs back, one 8 yrs back                                     | the **2-years-back** chapter scores higher (D6). Note the bonus keys off the _chapter year_, not the dormancy gap — a recently-dormant person can still have an ancient chapter                                                                                        |
| 14  | assets exceed `ASSET_CAP`                                                                | 8 ids, evenly spaced by time                                                                                                                                                                                                                                           |
| 15  | every candidate                                                                          | `visibleForDays === 7`, `dedupeKey` has **no** year                                                                                                                                                                                                                    |
| 16  | every pooled candidate fails the chapter bar                                             | `[]` — not a crash, and no window query issued                                                                                                                                                                                                                         |
| 17  | window query returns fewer assets than `chapter.count` but still `>= MIN_CHAPTER_ASSETS` | candidate kept; `subtitle` still reports `chapter.count`                                                                                                                                                                                                               |
| 18  | window query returns **4** assets (read skew, `< MIN_CHAPTER_ASSETS`)                    | candidate **dropped** — step 8's re-check. Without it the memory is created with 4 assets                                                                                                                                                                              |
| 19  | window query returns **zero** assets                                                     | candidate dropped, no zero-asset memory created                                                                                                                                                                                                                        |
| 20  | one candidate's window query rejects                                                     | that candidate is dropped; the others still return (one bad person must not void the whole rule)                                                                                                                                                                       |

Rows 18–19 cover the read skew between the step-5 daily-counts query and the step-8 asset query.
They are the only defence against a memory with too few — or zero — assets, since `chapter.count`
and `assetIds` come from two different reads.

Pet, hidden-person and unnamed-person exclusion (D7) live in SQL. Their **arguments** are asserted
in row 7; their **behaviour** is asserted in the medium test (§4.4). Neither is asserted against a
mocked repository here, which would only be testing the mock.

### 4.3 Registry / metadata / preferences specs

Mechanical, per §3.1 rows 2, 4, 7, 8: key present, `kind: 'rule'`, `defaultEnabled: true`,
`adminConfigurable: true`; factory returns a `PersonThrowbackMemoryRule`; completeness guard
10 → 11; default preference map gains `person_throwback: true`; both `availableMemoryTypes`
assertions gain the key in registry order.

### 4.4 Medium test (real DB)

| #   | Scenario                                                | Expect                                                                |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | dormant named person with a dense chapter, type enabled | memory created, correct assets                                        |
| 2   | same person, but `person.type = 'pet'`                  | **no** memory (D7)                                                    |
| 3   | same person, but `isHidden = true`                      | no memory                                                             |
| 4   | same person, but `name = ''`                            | no memory                                                             |
| 5   | recent photos exist but are `Archived`                  | **still** dormant → memory (predicate parity, §3.3)                   |
| 5b  | chapter assets have no `Preview` asset_file             | excluded from both the dormancy count and the chapter (parity, §3.3)  |
| 5c  | a face on a chapter asset is soft-deleted or invisible  | that asset does not count toward the chapter                          |
| 6   | user has the type toggled off                           | no memory                                                             |
| 7   | rule already fired for that person                      | no second memory; a **different** dormant person is used instead (D8) |

Scenario 7 is the Tier-3 regression guard and is the single most important row in this table.

## 5. Risks

| Risk                                                                                | Mitigation                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Resurfacing a deceased or estranged person                                          | D1 (no gap claim), D3 (dilution), D5/D6 (never rank by dormancy), D7 (no pets); per-user toggle; §8 follow-up |
| Rule goes permanently dry after firing once per person                              | D8 multi-candidate pool; medium test §4.4 #7                                                                  |
| Heavy subject (thousands of photos) makes the density query expensive               | D9 — density runs on daily counts; asset fetch is window-bounded                                              |
| Rule never evaluates because lingering memories hold both slots                     | Trigger day chosen by occupancy analysis — §5.1                                                               |
| `defaultEnabled: true` ships it to every user on upgrade with no per-person opt-out | Accepted (D10). §8 follow-up is the durable answer.                                                           |

### 5.1 Trigger-day occupancy — why 13, not 26

`RULE_DAILY_LIMIT` is 2, and `createRuleMemories` returns **early** when `remainingSlots === 0`
(`memory.service.ts:130`) — before any rule evaluates. The slot count comes from
`memoryRepository.search(ownerId, { type: Rule, for: target })`, which matches
`showAt <= target AND hideAt >= target` (`memory.repository.ts:42-50`) — every memory **still
visible** that day, not just ones created that day.

So a trigger day must be free of _windows_, not merely free of _triggers_. Monthly occupancy of the
multi-day rules (`on_this_day_place`, `recent_trip`, `birthday` are 1-day and don't linger):

```
day:  1    5    10   15   20   25   31
      |----|----|----|----|----|----|
month_recap          [1–7]
season_recap         [1–10]   (Mar/Jun/Sep/Dec only)
video_moments             [8–12]
favorites_throwback                 [15–21]
people_together                          [20–26]
themed                                     [22–26]
person_throwback              [13–19]  ← proposed
```

**Day 26 — the original choice — is the worst day of the month:** it is the exact intersection of
`people_together` (20–26) and `themed` (22–26). Whenever both fired, `remainingSlots === 0` and the
rule would never have evaluated at all. Days free of all scheduled windows are **13, 14, 27–31**.

Day 13 with a 7-day window (13–19) also leaves every later trigger with a free slot — verified per
day: day 15 `favorites_throwback` sees 1 free (ours only), day 20 `people_together` sees 1 free
(ours ended on 19), day 22 `themed` sees 1 free. Day 27 is worse: its window spills to the 1st–2nd
of the next month and competes with `month_recap` and `season_recap` on day 1.

Sporadic date-anchored rules (`trip_anniversary`, 3–7 days, any day) can still occupy one slot on
day 13. With two slots that leaves one, which is the same exposure every other rule carries.

## 6. Verification

### 6.1 Gates

`pnpm test` (server), `pnpm test:medium`, `tsc --noEmit`, `eslint --max-warnings 0`,
`prettier --check .` over the **whole** server package, web `check:typescript` + `check:svelte` +
`pnpm lint`, and `prettier` over `docs/`.

### 6.2 Codegen

The three new repository methods are `@GenerateSql`-decorated, so `make sql` must be re-run —
**with a running DB, and after a build**; running it without one deletes every query file. No DTO
or endpoint changes, so **no** OpenAPI regeneration and **no** Dart client regeneration.

## 7. Notes for the implementer

1. `person.type` is a plain `character varying` defaulting to `'person'`; pets are `'pet'`. There is
   no enum — filter on the string literal, as `person.repository.ts` already does elsewhere.
2. `getMemoryFacesForPeriod` does **not** filter `person.type`, so the shipped `people_together`
   rule can already pair a human with a pet ("Anna & Rex"). That is charming and out of scope here.
3. **Adjacent, not in scope:** `getMemoryAssetsForPerson`'s `DISTINCT ON (asset.id) ORDER BY
asset.id … LIMIT 60` means the shipped `birthday` rule samples an arbitrary 60 assets by UUID for
   anyone with more than 60 photos, skewing its per-year distribution. Worth its own issue.
4. **Known cost:** step 8 runs a window query for all 5 candidates, but the engine's multi-day
   one-slot cap inserts at most one of them — so 4 of the 5 are wasted work. That is the price of
   D8: the engine only skips already-fired keys _after_ the rule returns, so the alternatives are
   returning fewer candidates (and going permanently dry) or teaching the rule to pre-filter with
   its own `hasRuleMemory` calls (5 queries saved, 5 queries added, plus engine coupling). Once a
   month, per user, on bounded windows — accepted deliberately.
5. Total query cost on the trigger day: `1 + 1 + 5 = 7`, all bounded. On every other day of the
   month: **0** — step 1 returns before touching a repository.

## 8. Follow-up PR (not this branch)

Add `person.excludeFromMemories` (migration in `server/src/schema/migrations-gallery/`), honoured by
**every** person-based rule — `person_throwback`, `people_together`, and especially `birthday`,
which currently wishes a deceased person a happy birthday with no opt-out short of `isHidden`.
Needs: migration, DTO, web person UI, mobile person UI.

Also correct the roadmap while there: **#12 Semantic themes (CLIP)** is listed as an unshipped 🔴
north star, but PR #812's `themed` rule already rides smart-search CLIP embeddings — the remaining
work is vocabulary breadth and the `themeMaxDistance` calibration, not new infrastructure.

## 9. Implementation slices (for `/impl-loop`)

Every slice is **red → green → refactor**:

1. Write the slice's tests. Run them. **Capture the failure output** — a test never seen red proves
   nothing (§4.0).
2. Implement the minimum that makes them green.
3. Re-run; confirm green. Run the slice's gate.
4. Commit with the slice's message.

> ⚠️ Use `pnpm test --run <path>` — **not** `pnpm test -- --run <path>`. This pnpm version forwards
> the literal `--` to vitest, which silently drops the path filter and runs the whole suite.

### Dependency graph

```
Slice 1 (pure util) ───┐
                       ├──▶ Slice 3 (rule) ──▶ Slice 4 (server reg.) ──▶ Slice 5 (web + i18n)
Slice 2 (queries) ─────┘                              │
                                                      └──▶ Slice 6 (medium + docs)
```

Slices 1 and 2 are independent and may run in either order. Slices 3 → 4 → 5 are strictly ordered.
Slice 6 needs 4 (registration) but not 5.

---

### Slice 1 — `chapter.util.ts`

**Files:** `server/src/services/memory-rules/chapter.util.ts` + `.spec.ts` (both new).

Pure, zero dependencies. Implements §3.4; tests are §4.1 rows 1–9 verbatim, one `it()` each.

The whole slice is the two-pointer boundary. Write rows 6 and 7 first — they are the pair that
pins "at most `maxSpanDays` **calendar days**", i.e. a maximum day-index difference of
`maxSpanDays - 1`. Row 5 pins the `>=` tie-break toward the most recent window; row 9 pins the
defensive sort.

**Gate:** `cd server && pnpm test --run src/services/memory-rules/chapter.util.spec.ts`
**Commit:** `feat(memories): add densestChapter window helper`

---

### Slice 2 — repository queries

**Files:** `server/src/repositories/person.repository.ts`,
`server/src/repositories/asset.repository.ts`, `server/src/queries/*` (generated).

Three queries per §3.3: `getDormantPeople`, `getMemoryPersonDailyCounts`,
`getMemoryAssetsForPersonWindow`. All `@GenerateSql`-decorated.

Copy the asset-side predicate block from `getMemoryFacesForPeriod` (`asset.repository.ts:1001`)
rather than retyping it — §3.3's parity requirement is the whole point, and a missing
`preview EXISTS` makes people look dormant who aren't.

`getDormantPeople` returns `{ id, name }` only. `ORDER BY count(DISTINCT asset.id) DESC,
person.id ASC` needs no matching `SELECT`.

Then regenerate: `make sql`. **Requires a running DB and a prior build** — without a DB it deletes
every file in `server/src/queries/`. Build first, then migrate, then `make sql`.

**Gate:** `cd server && pnpm check`, then confirm `git diff --stat server/src/queries` shows exactly
two **modified** files — `person.repository.sql` (+1 query) and `asset.repository.sql` (+2). Both
already exist; new files or deletions mean `make sql` ran without a DB.
**Commit:** `feat(memories): add dormant-person and chapter-window queries`

---

### Slice 3 — the rule

**Files:** `server/src/services/memory-rules/person-throwback.rule.ts` + `.spec.ts` (both new).
**Depends on:** Slices 1 and 2 (imports `densestChapter` and the repository method types).

Implements §3.5. Tests are §4.2 rows 1–20, one `it()` each. Model the spec file on
`people-together.rule.spec.ts` — same fixture and mock style, and the same rule shape.

Export every constant per D11 (module-level `export const`, not private statics).

Three rows carry the defects this spec was revised for — write them first:

- **Row 2** — asserts `getMemoryPersonDailyCounts` is _never called_ on an empty pool. Asserting
  `[]` alone passes without the guard.
- **Rows 18–19** — read skew: the window query returning 4 assets, then 0, must drop the candidate.
- **Row 3** — the pinned `score === 186`.

Constructor takes narrowed repository types, matching every existing rule:

```ts
constructor(
  private personRepository: Pick<PersonRepository, 'getDormantPeople'>,
  private assetRepository: Pick<AssetRepository, 'getMemoryPersonDailyCounts' | 'getMemoryAssetsForPersonWindow'>,
) {}
```

**Gate:** `cd server && pnpm test --run src/services/memory-rules/person-throwback.rule.spec.ts`
**Commit:** `feat(memories): add person_throwback memory rule`

---

### Slice 4 — server registration

**Files:** §3.1 rows 1, 2, 3, 4, 7, 8, 10.
**Depends on:** Slice 3.

Append the `MEMORY_TYPE_METADATA` entry **last** (registry order is the `availableMemoryTypes`
order), add the `RULE_FACTORIES` entry, then fix the four shared lists that now fail:

- `memory-type.registry.spec.ts` — completeness guard **10 → 11**
- `preferences.spec.ts` — default map gains `person_throwback: true`
- `server.service.spec.ts` — **both** `availableMemoryTypes` assertions → 12 entries
- `e2e/src/specs/server/api/server.e2e-spec.ts` — the same fixture. **The server unit suite does not
  catch this one**; it is the most-missed site in the whole list.

No `MemoryRuleDeps` change — `personRepository` and `assetRepository` are already there.

**Gate:** `cd server && pnpm test --run src/services src/utils` then the full `pnpm test`
**Commit:** `feat(memories): register person_throwback memory type`

---

### Slice 5 — web admin settings + i18n

**Files:** §3.1 rows 11, 12, 13.
**Depends on:** Slice 4.

Add the key to the hardcoded `memoryTypeKeys` array in `MemoriesSettings.svelte`, then fix
`MemoriesSettings.spec.ts` — the full `types` object literal
in the save-payload assertion. Add the four `i18n/en.json` keys from §3.6 (EN only; web and mobile
share the directory).

**Gate:** `cd web && pnpm test --run src/routes/admin/system-settings/MemoriesSettings.spec.ts`,
then `pnpm check:typescript && pnpm check:svelte && pnpm lint`
**Commit:** `feat(web): expose person_throwback in memory settings`

---

### Slice 6 — medium tests + docs

**Files:** `server/test/medium/specs/services/memory.service.spec.ts`, `docs/docs/features/memories.md`,
`docs/docs/install/config-file.md`, `docs/plans/2026-07-15-memory-types-roadmap.md`.
**Depends on:** Slice 4.

Medium tests are §4.4 rows 1–7 (including 5b and 5c). **Row 7 is the one that must not be cut** —
it proves that when the rule has already fired for a person, a _different_ dormant person is used
instead. That is the Tier-3 regression guard and the only test covering D8.

Rows 2, 3, 4, 5, 5b, 5c are the SQL-side filters; they exist here precisely because a mocked
repository cannot test them (§4.0).

Docs: add the type to the user-facing list and the `memories.types` config keys, and flip roadmap
#9 to **Shipped**. Run `npx prettier --write` over any touched markdown — CI Docs Build is strict.

**Gate:** `cd server && pnpm test:medium --run test/medium/specs/services/memory.service.spec.ts`,
then the full §6.1 gate set
**Commit:** `test(memories): end-to-end coverage for person_throwback + docs`

---

### Not in any slice

- Per-person `excludeFromMemories` — §8, its own PR.
- The `birthday` UUID-sampling issue — §7.3, its own issue.
- Calibration/RC deploy — the dormancy window is admin-tunable
  (`memories.personThrowbackDormancyMonths`, default 6, see D3), so a wrong default is a settings
  change rather than a redeploy. No pre-merge calibration sweep is required.
