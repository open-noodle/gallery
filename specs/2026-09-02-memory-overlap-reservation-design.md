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
4. Existing bad memories heal, rather than persisting until retention expires them.

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

The deciding factor is `retentionDays`, which defaults to **365**. Filtering only at creation time
would leave every existing duplicate in place for up to a year. A sweep over persisted state heals
both reporting instances on the next nightly run.

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
  3. reconcileMemoryOverlap(owner, D .. D+3)    NEW, same lock, per user
```

Step 3 runs after both generation loops, inside the same lock, once per user, over the window
`[today, today + DAYS]` so the pre-written look-ahead `on_this_day` cards are covered.

### 6.2 The pure planner

New file `server/src/services/memory-rules/reservation.util.ts`. No I/O.

```ts
export interface ReservableMemory {
  id: string;
  assetIds: string[];
  priority: number; // higher claims first
  floor: number;
  isSaved: boolean;
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

1. Sort by `isSaved` descending, then `priority` descending, then `id` ascending.
2. `claimed = new Set<string>()`.
3. For each memory in order:
   - `keep = dedupe(assetIds).filter((id) => !claimed.has(id))`
   - **saved** → keep everything, add every one of its `assetIds` to `claimed`, never strip or
     remove.
   - `keep.length < floor` → mark for removal, claim **nothing** (its photos stay available to the
     next memory in line).
   - otherwise → strip `assetIds \ keep`, add `keep` to `claimed`.

The floor is applied **unconditionally**, not only after a strip. A memory that was always too small
— the reporter's 2-photo card, with nothing overlapping it — is removed on that basis alone. This is
safe: no rule can produce a sample below its own floor (§6.4 verifies this against every rule's
`MIN_*` gate), so unconditional floors only ever bite `on_this_day` and post-strip cases.

### 6.3 Claim order

Everything needed is already persisted; no new column and no migration.

| rank | source                                                               |
| ---- | -------------------------------------------------------------------- |
| 1    | `isSaved` memories — pinned, never stripped, but they **do** reserve |
| 2    | `MemoryType.Rule`, by `data.score` descending                        |
| 3    | `MemoryType.OnThisDay` — no score, always last                       |

The planner takes a single `priority` number, so the service maps rank and score into one value with
band offsets far larger than any real score (the highest is `birthday` at ~330):

```ts
const RANK_SAVED = 2_000_000;
const RANK_RULE = 1_000_000;
const RANK_ON_THIS_DAY = 0;

priority = isSaved ? RANK_SAVED : type === MemoryType.Rule ? RANK_RULE + (data.score ?? 0) : RANK_ON_THIS_DAY;
```

The bands guarantee type outranks score: no `on_this_day` can ever overtake a rule memory, and no
rule memory can overtake a saved one. `RuleMemoryData.score` is optional
(`server/src/types.ts:707`), so a rule memory written before scores existed reads as `score ?? 0` —
after every scored rule memory, still ahead of `on_this_day`. Ties break on `id` ascending for
determinism.

`isSaved` deliberately outranks score rather than being a separate pass: a saved memory both claims
first and is exempt from stripping and removal, and one ordering expresses both.

Claim order between rules deliberately reuses `score` rather than introducing a priority table:
`birthday` already scores 300+ against `season_recap`'s ~139 ceiling so it claims first, and a broad
recap samples 30 photos across ~91 days — about one per three days — so it can take at most ~1 photo
from a trip weekend or a `people_together` set.

### 6.4 Floors

`MemoryTypeMetadata` gains `minAssets: number`. Values are roughly a third to a half of each rule's
`ASSET_CAP`, and never above the rule's own pool gate.

| key                   | pool gate      | `ASSET_CAP` | `minAssets` |
| --------------------- | -------------- | ----------- | ----------- |
| `on_this_day`         | **none**       | 20 / year   | **3**       |
| `birthday`            | 6 (4 fallback) | all         | 3           |
| `recent_trip`         | 7 assets, 2 d  | —           | 4           |
| `month_recap`         | 10             | 24          | 8           |
| `favorites_throwback` | 4              | 12          | 3           |
| `on_this_day_place`   | 4              | 16          | 3           |
| `season_recap`        | 15             | 30          | 10          |
| `people_together`     | 6              | 8           | 4           |
| `video_moments`       | 3              | 8           | 3           |
| `trip_anniversary`    | 7 assets, 2 d  | 10          | 4           |
| `themed`              | 8              | 16          | 5           |
| `person_throwback`    | 6 per chapter  | 8           | 4           |

`on_this_day`'s floor of 3 is the single value that removes the reporter's 2-photo card.
`birthday`'s 3 is deliberately forgiving — it claims first anyway, and a missed birthday memory
waits a year.

Every row satisfies `minAssets <= min(pool gate, ASSET_CAP)`, so no rule can generate a memory that
is immediately swept. This is asserted by a test (§8.2).

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
- Asset ids joined through `memory_asset`, applying **the same asset filters `search` uses** —
  `asset.visibility = Timeline` and `asset.deletedAt is null` — so an archived or trashed photo is
  never counted toward a floor. Without this, a memory whose photos were archived would look full
  and render empty.

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
      .map((memory) => toReservable(memory, stripByMemory));

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
database migration.

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

## 7. Edge cases

Every row below has a test in §8. "Where" names the spec file that owns it.

### 7.1 Planner (pure)

| #   | Case                                                          | Behaviour                                                   |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| P1  | Empty input                                                   | Empty plan, no throw                                        |
| P2  | Single memory at or above floor                               | No strip, no removal                                        |
| P3  | Single memory below floor, nothing overlapping                | Removed (floor is unconditional)                            |
| P4  | Two memories, disjoint assets                                 | No strip                                                    |
| P5  | Two memories overlap, loser stays at or above floor           | Loser stripped of shared ids only, keeps the rest           |
| P6  | Two memories overlap, loser falls below floor                 | Loser removed; it claims **nothing**                        |
| P7  | Chain A > B > C where B is removed                            | C may claim the assets B would have held                    |
| P8  | Saved memory below floor                                      | Never removed, never stripped                               |
| P9  | Saved memory overlaps an unsaved higher-`score` memory        | Saved claims first (rank 1); the unsaved one is stripped    |
| P10 | Two saved memories sharing assets                             | Neither touched — duplicates between saved memories persist |
| P11 | Equal priority                                                | Deterministic tie-break on `id` ascending                   |
| P12 | Rule memory with `score` undefined                            | Treated as 0; still ranks above any `on_this_day`           |
| P13 | `on_this_day` with a higher notional score than a rule memory | Still last — type outranks score                            |
| P14 | Memory already holding zero assets                            | Removed via the floor                                       |
| P15 | Duplicate ids inside one memory's `assetIds`                  | Deduped before the floor is applied                         |
| P16 | `floor` of 0                                                  | Never removed for size                                      |
| P17 | Every memory removed                                          | Plan lists them all; no strips                              |

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
| S8  | Trashed memory (`deletedAt` set)                    | Excluded by the query                                             |
| S9  | Memory whose assets are all archived or trashed     | Reads as 0 assets, removed by floor                               |
| S10 | Running the job twice with no new assets            | Second run performs no writes (idempotent)                        |
| S11 | `reconcileMemoryOverlap` throws for one user        | Logged; other users still processed; job completes                |
| S12 | Two owners with a shared asset                      | Strictly per-owner; neither reserves against the other            |
| S13 | `supersedesOnThisDayYears` already deleted the card | Nothing to find; no error                                         |
| S14 | A day where every rule memory is swept              | Fewer than `RULE_DAILY_LIMIT` cards; slots are **not** backfilled |
| S15 | `nightlyTasks.generateMemories` disabled            | Reconcile never runs (it is inside the job)                       |

### 7.3 Repository

| #   | Case                            | Behaviour                            |
| --- | ------------------------------- | ------------------------------------ |
| R1  | `hideAt` null                   | Treated as open-ended, still visible |
| R2  | `showAt` null                   | Treated as always visible            |
| R3  | Memory ending exactly at `from` | Included (inclusive bounds)          |
| R4  | Memory starting exactly at `to` | Included (inclusive bounds)          |
| R5  | Memory entirely before window   | Excluded                             |
| R6  | Archived / trashed assets       | Not returned in `assetIds`           |
| R7  | Another owner's memory          | Excluded                             |
| R8  | Memory with no assets           | Returned with an empty `assetIds`    |

## 8. Test plan

**Implementation is test-driven throughout.** For every slice: write the failing test, run it and
confirm it fails _for the intended reason_, then implement until green. No production line is
written before a test that requires it.

Two known local traps apply. `pnpm test -- --run <path>` silently runs the entire suite — the `--`
must be dropped. And medium tests need a built server and a running database; an unbuilt run exits 0
without executing anything.

### 8.1 `memory-rules/reservation.util.spec.ts` — new

Pure, table-driven, covering P1–P17. Fast, no mocks, no clock.

### 8.2 `memory-rules/memory-type.metadata.spec.ts` — extend

- Every key in `MEMORY_TYPE_METADATA` declares a positive integer `minAssets`.
- For each rule that exports its constants, assert `minAssets <= ASSET_CAP` and
  `minAssets <= MIN_ASSETS` (its pool gate), so no rule can generate a memory that is immediately
  swept.
- `on_this_day` has a floor even though it is not a rule.

### 8.3 `services/memory.service.spec.ts` — extend

Small tests with `newTestService(MemoryService)` and mocked repositories, covering S1–S15. Reuses
the existing `visibleRuleMemories` helper shape and `MemoryFactory`.

### 8.4 `test/medium/specs/repositories/memory.repository.spec.ts` — extend

Real database, covering R1–R8 against `getForOverlapReconcile`.

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

### 8.6 Regression guard

The existing `supersedesOnThisDayYears` tests in `on-this-day-place.rule.spec.ts` and
`memory.service.spec.ts` must stay green unchanged — the two mechanisms are independent.

## 9. Implementation slices

Each slice is red → green → refactor, and each ends with a green targeted test run.

| #   | Slice                                                            | First failing test |
| --- | ---------------------------------------------------------------- | ------------------ |
| 1   | `minAssets` on `MemoryTypeMetadata` + all twelve values + lookup | §8.2               |
| 2   | `planReservation` pure module                                    | §8.1               |
| 3   | `getForOverlapReconcile` repository query                        | §8.4               |
| 4   | `reconcileMemoryOverlap` + wiring into `onMemoriesCreate`        | §8.3               |
| 5   | End-to-end scenarios                                             | §8.5               |
| 6   | `mise sql` regeneration and full verification                    | —                  |

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

| Risk                                                                                     | Mitigation                                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| First nightly run deletes more memories than expected                                    | Floors are conservative (§6.4) and only the 4-day window is swept per night, so healing is gradual      |
| A memory redundant on day D but viable on D+2 is deleted                                 | Accepted. Recorded here so it is a known trade-off, not a surprise                                      |
| Create-then-delete churn for rules that fire daily                                       | Harmless: `lastRuleDate` prevents re-evaluating a past day, and `hasRuleMemory` still blocks duplicates |
| Generation becomes order-dependent, so a `MemoriesState` reset yields different memories | Documented; results remain valid, just not identical                                                    |
| Divergence from upstream in a rebase-hot file                                            | Both upstream loops are untouched; the change is one added call plus new fork-only files                |
