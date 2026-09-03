# Memory overlap reservation

**Status:** design approved, ready for implementation planning
**Date:** 2026-09-02
**Area:** `server/src/services/memory*`, `server/src/repositories/memory.repository.ts`

## 1. Problem

A user reported three memory cards sitting next to each other — "Autumn 2025", "September 2025",
"1 year ago" — built from the same period, holding mostly the same photos, and all showing the
**same cover image**. Counts were 30, 24 and 2. Their workaround was to disable the "this month"
memory type in settings, which only partly helped.

The same trio is reproducible on the maintainer's personal instance.

## 2. Root causes

All three are deterministic, not chance.

### 2.1 Three windows over one period, uncoordinated

`SeasonRecapMemoryRule` fires on the first day of a meteorological season; `MonthRecapMemoryRule`
fires on the first of the month. **1 September is the worst day of the year** — both fire together,
then linger (`VISIBLE_FOR_DAYS` 10 and 7 respectively), while the daily `on_this_day` cards keep
landing inside both windows.

`MemoryService.createRuleMemories` (`server/src/services/memory.service.ts:160`) dedupes only by
`dedupeKey` and by `memoryRepository.hasRuleMemory(ownerId, ruleId, dedupeKey)`. Nothing ever
compares two candidates' asset sets.

### 2.2 The identical cover is guaranteed

- `memory.repository.ts:149` orders a memory's assets `asset.localDateTime ASC`.
- `memory-card.svelte:22` uses `item.memory.assets[0]` as the cover.
- `curation.util.ts` → `sampleAssetsByTime` → `pickEvenlySpaced` **always includes the first
  item** of the sorted pool.

Autumn 2025 and September 2025 both begin at the earliest September photo, so both cards render a
byte-identical cover. This recurs every year, for every user.

### 2.3 `on_this_day` has no minimum

`month_recap` requires a pool of 10 and `season_recap` 15, but `AssetRepository.getByDayOfYear`
returns whatever exists for the date. A single photo on that day produces a one-photo card. That is
the reporter's 2-photo card.

### 2.4 The mechanism half-exists

`MemoryRuleCandidate.supersedesOnThisDayYears` (`memory-rule.interface.ts:27`) already lets a rule
declare that it stands in for a day's plain `on_this_day` card, and `deleteOnThisDay` acts on it.
Only `on_this_day_place` uses it. The idea was never generalised.

## 3. Goals

1. Two memories visible on the same day never contain the same photo.
2. A memory with too few photos of its own is not shown at all.
3. Covers differ as a consequence of (1), with no separate cover-picking mechanism.
4. Memories **already on the history page** heal too, rather than persisting until retention expires
   them — up to a year at the default `retentionDays: 365`. This is what the reporter is looking at,
   so it is a goal and not a nicety.

## 4. Non-goals

- **Cross-owner duplication.** `accessibleSearchBuilder` (`memory.repository.ts:55`) also returns
  partners' and shared-space members' memories, and reservation is per-owner. This is the most
  likely explanation for the reporter's _second_ "September 2025" card — the reporter should be
  asked whether a partner shares a library with them. A separate feature.
- **Title localisation.** Titles are persisted in English at generation time. Tracked as issue
  \#1045.
- **Near-duplicate covers from the same burst.** Disjoint asset sets make this rare rather than
  impossible: if a card's first photo is claimed, its new first photo may be the next frame of the
  same burst. Not addressed here.
- **Reducing the number of cards on large libraries.** Explicitly decided against in §5.1.

## 5. Decisions

### 5.1 Distinct photos, not fewer cards

A memory only _contains_ its sampled assets — `month_recap` stores 24, `season_recap` 30,
`on_this_day` at most 20 per year. So "already used elsewhere" is a small set, not the whole period.
On a large library all three cards survive with disjoint photos and different covers; on a small
library the thin ones fall below their floor and disappear on their own.

This was chosen over two alternatives: suppressing any card whose date range is contained in a live
card's range (deterministic but a second mechanism with its own family table), and staggering the
`season_recap` / `month_recap` triggers (cheap, but blind to every overlap that is not those two).

The behaviour degrades correctly with library size, which is the property that made it preferable.

### 5.2 `on_this_day` claims last and gets a floor

`on_this_day` is not a rule: it has no score, no floor, runs in a **separate loop before** the rule
loop, and writes **three days ahead** (`DAYS = 3`) because the job is nightly and must tolerate a
skipped night and time zones ahead of UTC. Left alone it would claim photos before any rule was
evaluated — the exact inverse of what is wanted.

It therefore reserves nothing and is resolved last, subject to a floor. Rejected alternatives:
deleting it outright whenever a recap covers its date (loses a genuinely good 18-photo card for ten
straight days on a large library), and restructuring both loops so rules run first (largest
divergence in this fork's hottest rebase file, and drops the look-ahead that keeps a UTC+13 user's
lane populated).

### 5.3 Reconcile persisted state, not in-flight candidates

Subtraction happens in the service, leaving all twelve rule files untouched. It is applied to
**memories already in the table** rather than to candidates before insertion.

The deciding factor is `retentionDays`, which defaults to **365**, combined with what the reported
surface actually shows. The memories index calls `searchMemories({})`
(`web/src/routes/(user)/memories/+page.svelte:43`), and with no `for` parameter `baseSearchBuilder`
applies only `showAt <= now` and **skips the `hideAt` filter entirely** (`memory.repository.ts:44-51`)
— so that page lists up to a year of history, not the current lane. The screenshots in §1 are that
page. Filtering only at creation time would leave every existing duplicate on it for up to a year.

A sweep over persisted state fixes new memories from the next nightly run, and a one-off backfill
(§6.9) fixes the history already on screen. Both are required; the nightly window alone would never
touch the cards the reporter is looking at.

It also collapses what would otherwise be three mechanisms — a creation filter for rules, a creation
filter for `on_this_day`, and a prune pass for the three-day look-ahead — into one.

**Accepted cost:** a candidate destined to be swept still gets created and deleted inside the same
job, and its `RULE_DAILY_LIMIT` slot is not backfilled, so a heavily overlapping day yields fewer
than six cards. Since the goal is fewer redundant cards, this is acceptable.

## 6. Design

### 6.1 Where it runs

```
onMemoriesCreate()                              existing, inside DatabaseLock.MemoryCreation
  1. on_this_day loop     D-3 .. D+3            upstream, untouched
  2. rule loop            lastRuleDate+1 .. D   untouched
  3. one-off backfill     oldest memory .. D    NEW, historical sweep once, then a daily catch-up slice, guarded by state (§6.9)
  4. reconcileMemoryOverlap(owner, D .. D+3)    NEW, same lock, per user
```

Step 4 runs after both generation loops, inside the same lock, once per user, over the window
`[today, today + DAYS]` so the pre-written look-ahead `on_this_day` cards are covered. Step 3 is the
same routine over the retention window: a one-off historical sweep the first time it runs, then a
cheap one-day catch-up slice every night after — see §6.9.

### 6.2 The pure planner

New file `server/src/services/memory-rules/reservation.util.ts`. No I/O.

```ts
export interface ReservableMemory {
  id: string;
  assetIds: string[];
  priority: number; // higher claims first; encodes rank and score (§6.3)
  floor: number;
  /** false for a memory that may claim assets but must never be stripped or deleted (§6.2.1) */
  managed: boolean;
}

export interface ReservationPlan {
  /** assets to remove from a memory that survives */
  strip: { memoryId: string; assetIds: string[] }[];
  /** memories to delete outright */
  remove: string[];
}

export const planReservation = (memories: ReservableMemory[]): ReservationPlan;
```

Algorithm, for one day's set:

1. Sort by `priority` descending, then `id` ascending. `priority` alone carries the rank — there is
   no second sort key (§6.3).
2. `claimed = new Set<string>()`.
3. For each memory in order:
   - `keep = dedupe(assetIds).filter((id) => !claimed.has(id))`
   - **not `managed`** → keep everything, add every one of its `assetIds` to `claimed`, never strip
     or remove.
   - `keep.length < floor` → mark for removal, claim **nothing** (its photos stay available to the
     next memory in line).
   - otherwise → strip `assetIds \ keep`, add `keep` to `claimed`.

The floor is applied **unconditionally**, not only after a strip. A memory that was always too small
— the reporter's 2-photo card, with nothing overlapping it — is removed on that basis alone.

#### 6.2.1 What the sweep is allowed to touch

`MemoryType` has only two values, `OnThisDay` and `Rule` (`server/src/enum.ts`), and `POST /memories`
(`memory.controller.ts:35`) lets any client create a memory under either of them. A hand-made memory
is therefore **indistinguishable by type** from a generated one, and an unconditional floor would
delete it. The sweep must never do that.

A memory is `managed` — eligible to be stripped or deleted — only when **all** of these hold:

- `isSaved === false`, and
- `showAt !== null` and `hideAt !== null` (every generated memory sets both; the create DTO leaves
  them optional), and
- it is `MemoryType.OnThisDay`, **or** `MemoryType.Rule` whose `data.ruleId` resolves to a known
  registry key via `getMemoryTypeMetadata`.

Everything else — saved memories, API-created memories, and rule memories whose `ruleId` no longer
exists in the registry — is unmanaged: it still **claims** its assets (otherwise the duplicate it
causes would survive), but is never modified or removed. Claiming without being touched is exactly
the behaviour saved memories need, so one flag covers both cases.

### 6.3 Claim order

Everything needed is already persisted; no new column and no migration.

| rank | source                                                                        |
| ---- | ----------------------------------------------------------------------------- |
| 1    | unmanaged memories (§6.2.1) — pinned, never stripped, but they **do** reserve |
| 2    | `MemoryType.Rule`, by `data.score` descending                                 |
| 3    | `MemoryType.OnThisDay` — no score, always last                                |

The planner takes a single `priority` number and sorts on nothing else, so the service maps rank and
score into one value with band offsets far larger than any real score (the highest is `birthday` at
~330):

```ts
const RANK_UNMANAGED = 2_000_000;
const RANK_RULE = 1_000_000;
const RANK_ON_THIS_DAY = 0;

priority = !managed ? RANK_UNMANAGED : type === MemoryType.Rule ? RANK_RULE + (data.score ?? 0) : RANK_ON_THIS_DAY;
```

The bands guarantee type outranks score: no `on_this_day` can ever overtake a rule memory, and no
rule memory can overtake an unmanaged one. `RuleMemoryData.score` is optional
(`server/src/types.ts:707`), so a rule memory written before scores existed reads as `score ?? 0` —
after every scored rule memory, still ahead of `on_this_day`. Ties break on `id` ascending for
determinism.

Unmanaged memories deliberately outrank score rather than getting a separate pass: such a memory both
claims first and is exempt from stripping and removal, and one ordering expresses both. This is why
`managed` is the flag the planner takes rather than `isSaved` — a saved memory is just the most
common kind of unmanaged one.

Claim order between rules deliberately reuses `score` rather than introducing a priority table:
`birthday` already scores 300+ against `season_recap`'s ~139 ceiling so it claims first, and a broad
recap samples 30 photos across ~91 days — about one per three days — so it can take at most ~1 photo
from a trip weekend or a `people_together` set.

### 6.4 Floors

`MemoryTypeMetadata` gains `minAssets: number`. The binding constraint is the **smallest sample a
rule can actually emit**, which is not always its pool gate — see the trip note below.

| key                   | smallest emitted sample | `ASSET_CAP` | `minAssets` |
| --------------------- | ----------------------- | ----------- | ----------- |
| `on_this_day`         | **1** (no gate at all)  | 20 / year   | **3**       |
| `birthday`            | 4 (fallback path)       | 12          | 3           |
| `recent_trip`         | **2** (burst-collapsed) | 10          | **2**       |
| `month_recap`         | 10                      | 24          | 8           |
| `favorites_throwback` | 4                       | 12          | 3           |
| `on_this_day_place`   | 4                       | 16          | 3           |
| `season_recap`        | 15                      | 30          | 10          |
| `people_together`     | 6                       | 8           | 4           |
| `video_moments`       | 3                       | 8           | 3           |
| `trip_anniversary`    | **2** (burst-collapsed) | 10          | **2**       |
| `themed`              | 8                       | 16          | 5           |
| `person_throwback`    | 6 per chapter           | 8           | 4           |

`on_this_day`'s floor of 3 is the single value that removes the reporter's 2-photo card. Its
"smallest emitted sample" of 1 is the whole defect from §2.3 — it is the one type whose floor is
deliberately above what it can emit.

**Trips are the exception, and the reason this column is not the pool gate.** `recent_trip` gates on
`assetCount >= 7 && dayCount >= 2` (`recent-trip.rule.ts:104`), but `curateTripAssets`
(`trip.util.ts:125-127`) burst-collapses first and returns the representatives directly when there
are `<= SMALL_TRIP_MAX` (6) of them. Seven photos taken in two bursts collapse to **two**
representatives, so a healthy trip memory can legitimately hold 2 assets. `trip_anniversary` shares
the same helper. Their floors are therefore 2, not 4 — anything higher deletes working memories on
the first sweep.

Every other row satisfies `minAssets <= smallest emitted sample`, so apart from `on_this_day` no
rule can generate a memory that is immediately swept. §8.2 asserts this against the real constants
rather than against a copy of this table.

Read through `getMemoryTypeFloor(key: string | undefined): number`, which returns `0` for an
unknown or absent key so such a memory is never removed for size.

Floors are constants, not admin config. If a knob is wanted later, `SystemConfig['memories']` is the
place.

### 6.5 Repository query

One new method on `MemoryRepository`:

```ts
getForOverlapReconcile(
  ownerId: string,
  window: { from: Date; to: Date },
): Promise<{ id: string; type: MemoryType; data: unknown; isSaved: boolean;
             showAt: Date | null; hideAt: Date | null; assetIds: string[] }[]>
```

- `ownerId` match, `deletedAt is null`.
- Window overlap: `(showAt is null or showAt <= window.to)` **and**
  `(hideAt is null or hideAt >= window.from)`.
- Asset ids joined through `memory_asset`, applying **all three of the asset filters `search` uses**
  (`memory.repository.ts:135-147`), not two of them:
  1. `asset.visibility = Timeline`
  2. `asset.deletedAt is null`
  3. `NOT EXISTS` a face on that asset belonging to a person with `isHidden = true`

  The third is easy to miss and matters: a memory can hold ten `memory_asset` rows and render four
  if six of them contain a hidden person. Computing the floor over the raw join would keep a card
  the user sees as nearly empty, and would let it reserve photos it never displays. The floor must
  be measured over exactly what the card renders.

Driven from `memory` (filtered by `ownerId`) into `memory_asset` via that table's composite primary
key `(memoriesId, assetId)`, whose leading column is `memoriesId`. **No new index is required** —
verified: there is no index on `memory_asset.assetId`, and this query does not need one.

Volume is small: `RULE_DAILY_LIMIT` is 6 concurrently visible rule memories, plus `on_this_day`
cards, over a 4-day window — on the order of a few dozen memories and ~2,000 asset ids per user.

### 6.6 Service wiring

```ts
private async reconcileMemoryOverlap(ownerId: string, from: DateTime, to: DateTime) {
  const memories = await this.memoryRepository.getForOverlapReconcile(ownerId, {
    from: from.startOf('day').toJSDate(),
    to: to.endOf('day').toJSDate(),
  });

  const stripByMemory = new Map<string, Set<string>>();
  const toRemove = new Set<string>();

  for (let day = from; day <= to; day = day.plus({ days: 1 })) {
    const visible = memories
      .filter((memory) => !toRemove.has(memory.id) && isVisibleOn(memory, day))
      .map((memory) => toReservable(memory, stripByMemory)); // sets managed + priority, §6.2.1/§6.3

    const plan = planReservation(visible);
    for (const { memoryId, assetIds } of plan.strip) { /* union into stripByMemory */ }
    for (const id of plan.remove) { toRemove.add(id); }
  }

  // apply: removeAssetIds per surviving memory, delete per removal
}
```

Per-day resolution is what makes the result exact: two memories whose windows never overlap are
never forced apart. Strips accumulate as a union across days, and a memory removed on one day is
skipped on subsequent days.

Called from `onMemoriesCreate` after both loops, per user, wrapped in the same `try`/`catch` +
`logger.error` style the existing loops use so one user's failure cannot abort the job.

### 6.7 What does not change

No DTO, no API surface, no OpenAPI regeneration, no web or mobile change, no i18n string, no
database migration — `overlapBackfilledAt` lives in the existing `MemoriesState` JSON blob in
`system_metadata`, alongside `lastOnThisDayDate` and `lastRuleDate`.

Files touched: `reservation.util.ts` (new), `memory-type.metadata.ts`, `memory.service.ts`,
`memory.repository.ts` (two new queries), `types.ts` (one optional field), and the twelve rule files
for the constant-export refactor in slice 0 — which changes no logic. The twelve rules' own spec
files stay untouched.

Card subtitles stay correct: every rule's `count` is a **pool** count (`yearAssets.length`,
`survivors.length`, `top.assets.length`), describing the period rather than the memory, so stripping
photos cannot make a subtitle lie.

### 6.8 Expected outcome

```
BEFORE      Autumn 2025   September 2025   September 2025   1 year ago
            cover A       cover B          cover A          cover A

AFTER — large library (~600 photos Sep-Nov)
            Autumn 2025   September 2025   1 year ago
            30 photos     ~20 photos       ~18 photos
            cover A       cover B          cover C            no shared photos

AFTER — reporter's library (30 / 24 / 2)
            Autumn 2025   September 2025 -> below floor, deleted
            30 photos     1 year ago     -> 0 photos left, deleted
            cover A
```

### 6.9 One-off backfill

The nightly window `[today, today + DAYS]` only reconciles memories that are _currently_ visible.
The memories index shows a year of history (§5.3), so without a backfill the reported trio survives
until retention expires it.

The backfill reuses `reconcileMemoryOverlap` unchanged — it is the same per-day greedy pass, just
run over a much wider range:

```
if (state.overlapBackfilledAt >= today) return          // done; not even one query

oldest = MIN(coalesce(showAt, createdAt)) over all memories    one global query
start  = state.overlapBackfilledAt ? cursor + 1 day : oldest

for each day from start to today:        days OUTER
  for each user:                         users INNER
    reconcileMemoryOverlap(user, day, day)
  state.overlapBackfilledAt = day        cursor advanced per day
```

Two details carry their weight:

**The loop is days-outer, users-inner.** That makes a _single_ cursor enough to resume after a
crash, mirroring how `lastOnThisDayDate` already works. A users-outer loop would need per-user
state to be resumable, which is a lot of bookkeeping for a routine that runs once.

**The start day comes from the data, not from `retentionDays`.** `retentionDays: 0` means retention
is **disabled**, not zero days — `cleanup` returns early and memories are kept forever
(`memory.repository.ts:26-28`) — so a `today - retentionDays` window would either skip the backfill
entirely or run unbounded. One global `MIN(coalesce("showAt", "createdAt"))` is correct for every
retention setting. `coalesce` matters because a memory with a null `showAt` is always visible and
would otherwise be missed. Days holding no memories cost one cheap query and are no-ops.

- Guarded by a new optional `overlapBackfilledAt?: string` on `MemoriesState`
  (`server/src/types.ts:728`). The guard is `overlapBackfilledAt >= today`, so this is **not**
  "runs once and never again": within the same UTC day it is a no-op, but the next night `today`
  advances past the recorded cursor, the guard fails, and the loop above runs again for
  `cursor+1 .. today` — normally just the single day `today`. This is load-bearing, not
  incidental: after any downtime the on-this-day loop only regenerates `D-3 .. D-1`, and the
  nightly window sweep (step 4) only starts at `D`, so without this daily catch-up slice the days
  in between would never be reconciled. In steady state it is a one-off historical sweep (the
  first run walks a year of backlog) followed by a cheap one-day slice every night after. Same
  cursor shape as the existing `lastOnThisDayDate` / `lastRuleDate` cursors, written through the
  same `systemMetadataRepository.set` inside the same lock.
- Runs **before** the nightly window sweep on the run that triggers it, so the two do not fight.
- Days are processed in chunks with the cursor advanced per chunk, so a crash mid-backfill resumes
  rather than restarting. `overlapBackfilledAt` therefore stores the last completed day, and is
  compared against `today` to decide whether the backfill still has historical backlog to walk.
- Cost is bounded: a day with no memories is a no-op, and `getForOverlapReconcile` is one indexed
  query per day per user. The historical backlog is swept once, not repeated nightly — sweeping a
  year per user every night would be pure waste once the history is clean — but the single-day
  catch-up slice described above does run every night indefinitely.
- Needs a second small repository method, `getOldestMemoryDate(): Promise<Date | null>` — global,
  not per-owner, because the loop is days-outer.

Chosen over sweeping the full retention window on every run, which needs no state but repeats a
year of work nightly forever.

## 7. Edge cases

Every row below has a test in §8. "Where" names the spec file that owns it.

### 7.1 Planner (pure)

| #   | Case                                                          | Behaviour                                                    |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| P1  | Empty input                                                   | Empty plan, no throw                                         |
| P2  | Single memory at or above floor                               | No strip, no removal                                         |
| P3  | Single memory below floor, nothing overlapping                | Removed (floor is unconditional)                             |
| P4  | Two memories, disjoint assets                                 | No strip                                                     |
| P5  | Two memories overlap, loser stays at or above floor           | Loser stripped of shared ids only, keeps the rest            |
| P6  | Two memories overlap, loser falls below floor                 | Loser removed; it claims **nothing**                         |
| P7  | Chain A > B > C where B is removed                            | C may claim the assets B would have held                     |
| P8  | Unmanaged memory below floor                                  | Never removed, never stripped                                |
| P9  | Unmanaged memory overlaps a managed higher-`score` memory     | Unmanaged claims first (rank 1); the managed one is stripped |
| P10 | Two unmanaged memories sharing assets                         | Neither touched — duplicates between them persist by design  |
| P11 | Equal priority                                                | Deterministic tie-break on `id` ascending                    |
| P12 | Rule memory with `score` undefined                            | Treated as 0; still ranks above any `on_this_day`            |
| P13 | `on_this_day` with a higher notional score than a rule memory | Still last — type outranks score                             |
| P14 | Memory already holding zero assets                            | Removed via the floor                                        |
| P15 | Duplicate ids inside one memory's `assetIds`                  | Deduped before the floor is applied                          |
| P16 | `floor` of 0                                                  | Never removed for size                                       |
| P17 | Every memory removed                                          | Plan lists them all; no strips                               |
| P18 | Managed memory stripped to exactly `floor`                    | Kept — the test is `< floor`, not `<=`                       |
| P19 | Unmanaged `on_this_day` (saved, or API-created)               | Claims at `RANK_UNMANAGED`, ahead of every rule memory       |
| P20 | Managed and unmanaged memories with equal `priority`          | `id` ascending still decides; `managed` never re-sorts       |

### 7.2 Service / window

| #   | Case                                                | Behaviour                                                         |
| --- | --------------------------------------------------- | ----------------------------------------------------------------- |
| S1  | Memory visible on D but not D+1                     | Resolved only against D's set                                     |
| S2  | Memory spanning D..D+3                              | Visited each day; strips union; result stable                     |
| S3  | Memory removed on D, still nominally visible D+1    | Skipped on later days, deleted once                               |
| S4  | Look-ahead `on_this_day` at `showAt = D+3`          | Inside the window, reconciled                                     |
| S5  | Owner with no memories                              | One query, zero writes                                            |
| S6  | Owner with `on_this_day` disabled                   | Rules still reconcile among themselves                            |
| S7  | Saved `on_this_day`                                 | Never deleted — matches existing `deleteOnThisDay` semantics      |
| S7b | API-created memory: unsaved, null `showAt`/`hideAt` | Unmanaged — claims, never stripped, never deleted (§6.2.1)        |
| S7c | Rule memory whose `data.ruleId` is unknown          | Unmanaged — a removed rule's memories are not silently deleted    |
| S8  | Trashed memory (`deletedAt` set)                    | Excluded by the query                                             |
| S9  | Memory whose assets are all archived or trashed     | Reads as 0 assets, removed by floor                               |
| S10 | Running the job twice with no new assets            | Second run performs no writes (idempotent)                        |
| S11 | `reconcileMemoryOverlap` throws for one user        | Logged; other users still processed; job completes                |
| S12 | Two owners with a shared asset                      | Strictly per-owner; neither reserves against the other            |
| S13 | `supersedesOnThisDayYears` already deleted the card | Nothing to find; no error                                         |
| S14 | A day where every rule memory is swept              | Fewer than `RULE_DAILY_LIMIT` cards; slots are **not** backfilled |
| S15 | `nightlyTasks.generateMemories` disabled            | Reconcile never runs (it is inside the job)                       |

### 7.3 Repository

| #   | Case                                | Behaviour                                     |
| --- | ----------------------------------- | --------------------------------------------- |
| R1  | `hideAt` null                       | Treated as open-ended, still visible          |
| R2  | `showAt` null                       | Treated as always visible                     |
| R3  | Memory ending exactly at `from`     | Included (inclusive bounds)                   |
| R4  | Memory starting exactly at `to`     | Included (inclusive bounds)                   |
| R5  | Memory entirely before window       | Excluded                                      |
| R6  | Archived / trashed assets           | Not returned in `assetIds`                    |
| R7  | Another owner's memory              | Excluded                                      |
| R8  | Memory with no assets               | Returned with an empty `assetIds`             |
| R9  | Asset carrying a hidden-person face | Excluded — must match `search` exactly (§6.5) |

### 7.4 Backfill

| #   | Case                                                    | Behaviour                                                      |
| --- | ------------------------------------------------------- | -------------------------------------------------------------- |
| B1  | Fresh instance, `overlapBackfilledAt` unset             | Runs once over the retention window, then records the cursor   |
| B2  | Second nightly run                                      | Guard short-circuits; **zero** extra queries or writes         |
| B3  | Crash part-way through                                  | Cursor holds the last completed day; the next run resumes      |
| B4  | Day in the window with no memories                      | No-op, cursor still advances                                   |
| B5  | Backfill and the nightly window both due on the one run | Backfill first, then the window — they must not fight (§6.9)   |
| B6  | `retentionDays` set to 0 (retention disabled)           | Window falls back to a bounded span rather than unbounded time |

## 8. Test plan

**Implementation is test-driven throughout.** For every slice: write the failing test, run it and
confirm it fails _for the intended reason_, then implement until green. No production line is
written before a test that requires it.

Two known local traps apply. `pnpm test -- --run <path>` silently runs the entire suite — the `--`
must be dropped. And medium tests need a built server and a running database; an unbuilt run exits 0
without executing anything.

### 8.1 `memory-rules/reservation.util.spec.ts` — new

Pure, table-driven, covering P1–P20. Fast, no mocks, no clock.

### 8.2 `memory-rules/memory-type.metadata.spec.ts` — extend

**Prerequisite — the constants must be exported first.** `month_recap`, `season_recap`,
`favorites_throwback` and `people_together` declare `MIN_ASSETS` / `ASSET_CAP` as
`private static readonly`, so a test cannot import them. Written naively, this spec's guard would
assert over only the rules that happen to export ("for each rule that exports its constants") and
silently pass for the other four — an assertion that cannot fail, guarding the exact invariant §6.4
gets wrong for trips. Slice 1 therefore promotes all twelve rules' constants to module-level
`export const`, matching the style `themed` / `video_moments` / `trip_anniversary` /
`person_throwback` / `on_this_day_place` already use.

Then:

- Every key in `MEMORY_TYPE_METADATA` declares a positive integer `minAssets`.
- A table keyed by **registry key**, listing each rule's smallest emitted sample, is asserted
  exhaustive against `MEMORY_TYPE_KEYS` — so adding a rule without a floor **fails the test** rather
  than skipping it. This is the property that makes the guard real.
- For every key except `on_this_day`, `minAssets <= smallestEmittedSample` and
  `minAssets <= ASSET_CAP`.
- `on_this_day` is asserted as the deliberate exception: its floor (3) is **above** what it can emit
  (1), with a comment naming §2.3 as the reason.
- A dedicated case for trips: `curateTripAssets` over seven assets forming two bursts returns 2 ids,
  and `2 >= minAssets('recent_trip')`. This is the regression test for the defect the first draft of
  this spec contained — a floor of 4 would have deleted healthy trip memories.

### 8.3 `services/memory.service.spec.ts` — extend

Small tests with `newTestService(MemoryService)` and mocked repositories, covering S1–S15 including S7b and S7c. Reuses
the existing `visibleRuleMemories` helper shape and `MemoryFactory`.

### 8.4 `test/medium/specs/repositories/memory.repository.spec.ts` — extend

Real database, covering R1–R9 against `getForOverlapReconcile`. R9 — the hidden-person exclusion —
needs a seeded `asset_face` joined to a `person` with `isHidden = true`, and asserts that
`getForOverlapReconcile` and `search` return **the same** asset ids for the same memory. Asserting
the two against each other, rather than against a hand-written list, is what stops the two queries
drifting apart later.

### 8.5 `test/medium/specs/services/memory.service.spec.ts` — extend

The existing 1,581-line harness already seeds real assets through `seedRuleAsset` and runs the real
`onMemoriesCreate`. Two end-to-end scenarios:

1. **Reporter's library.** Seed a modest September 2025 set. Run generation for 1 September 2026.
   Assert: `season_recap` survives; `month_recap` and the `on_this_day` cards are gone; exactly one
   card remains.
2. **Large library.** Seed ~600 assets across September–November 2025. Run the same day. Assert:
   all three cards survive, their asset id sets are **pairwise disjoint**, and their `assets[0]`
   ids — the covers — are all different.

A third asserts idempotency (S10): running `onMemoriesCreate` twice produces the same memories and
no further writes.

A fourth covers the backfill (B1–B6): seed memories dated well outside the nightly window that
duplicate each other, run `onMemoriesCreate` once, and assert the old duplicates are reconciled and
`overlapBackfilledAt` is set; run it a second time and assert **no further writes**, proving the
guard holds.

A fifth covers §6.2.1: create a memory through `MemoryService.create` (the `POST /memories` path)
with two assets, no `showAt`/`hideAt`, and `isSaved: false`, alongside a rule memory that contains
the same two assets. Assert the manual memory is **still present and unmodified** afterwards, and
that the rule memory was stripped of nothing (the manual one claims first at `RANK_UNMANAGED`).
Without this test the sweep silently deletes user data.

### 8.6 Regression guard

The existing `supersedesOnThisDayYears` tests in `on-this-day-place.rule.spec.ts` and
`memory.service.spec.ts` must stay green unchanged — the two mechanisms are independent.

## 9. Implementation slices

Each slice is red → green → refactor, and each ends with a green targeted test run.

| #   | Slice                                                                        | First failing test |
| --- | ---------------------------------------------------------------------------- | ------------------ |
| 0   | Promote all twelve rules' `MIN_*` / `ASSET_CAP` to `export const` (no logic) | §8.2 prerequisite  |
| 1   | `minAssets` on `MemoryTypeMetadata` + all twelve values + exhaustive guard   | §8.2               |
| 2   | `planReservation` pure module, including `managed` (§6.2.1)                  | §8.1               |
| 3   | `getForOverlapReconcile` (all three asset filters) + `getOldestMemoryDate`   | §8.4               |
| 4   | `reconcileMemoryOverlap` + wiring into `onMemoriesCreate`                    | §8.3               |
| 5   | One-off backfill + `overlapBackfilledAt` on `MemoriesState`                  | §8.5 (B1–B6)       |
| 6   | End-to-end scenarios, including the API-created-memory guard                 | §8.5               |
| 7   | `mise sql` regeneration and full verification                                | —                  |

Slice 0 is a pure refactor with no behaviour change, but it must land **first**: without it slice
1's guard cannot see four of the twelve rules and would pass while covering nothing (§8.2).

## 10. Verification

Run from the worktree, not the main checkout.

```bash
cd server
pnpm test --run src/services/memory-rules/reservation.util.spec.ts
pnpm test --run src/services/memory-rules/memory-type.metadata.spec.ts
pnpm test --run src/services/memory.service.spec.ts
pnpm test --run src/repositories/memory.repository.spec.ts
pnpm test:medium --run test/medium/specs/repositories/memory.repository.spec.ts
pnpm test:medium --run test/medium/specs/services/memory.service.spec.ts
```

`server/src/repositories/` is touched, so the SQL documentation must be regenerated:

```bash
mise sql   # NOT `make sql` — that target was removed; and not `mise //:sql`, which targets the main checkout
```

Then the standard gates:

```bash
make lint-server && make format-server && make check-server
```

## 11. Risks

| Risk                                                                                     | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The backfill deletes a year of memories in one run                                       | The largest single behaviour change here. Floors are set from each rule's smallest _emitted_ sample (§6.4), and B1–B6 pin the behaviour before it ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A memory redundant on day D but viable on D+2 is deleted                                 | Accepted. Recorded here so it is a known trade-off, not a surprise                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Create-then-delete churn                                                                 | Eleven of twelve rules fire on exactly **one** trigger day per month (`TRIGGER_DAY` 8/13/15/20/22, day 1, or a season start), so a swept memory is not re-evaluated the next night. `recent_trip` is the exception: it has no `TRIGGER_DAY` and evaluates every night (`recent-trip.rule.ts:54-67`), and its `dedupeKey` embeds the date, so `hasRuleMemory` never suppresses it across days — only `isCoolingDown` does, by searching for a **persisted** rule memory with the same `placeKey`, which is exactly the row the sweep can delete. A swept `recent_trip` memory is therefore recreated the next night and swept again, for as long as the trip stays in the 30-day recent window. Narrow in practice: recaps target past years, so they rarely compete with a `recent_trip` card on live assets, and `curateTripAssets` returns >= 2 representatives whenever `dayCount >= 2`, so the floor of 2 normally holds — it bites when a representative carries a hidden person's face, or an unmanaged memory claims one of the two |
| The sweep deletes an API-created memory                                                  | Prevented by the `managed` predicate (§6.2.1) and pinned by S7b and the §8.5 guard test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `getForOverlapReconcile` and `search` drift apart, so floors stop matching what renders  | R9 asserts the two queries return identical ids for the same memory, rather than checking a fixed list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Generation becomes order-dependent, so a `MemoriesState` reset yields different memories | Documented; results remain valid, just not identical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Divergence from upstream in a rebase-hot file                                            | Both upstream loops are untouched; the change is one added call plus new fork-only files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
