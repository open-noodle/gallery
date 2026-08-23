# Slice 3 — `person_throwback` rule

Spec: `docs/plans/2026-07-22-memory-person-throwback-spec.md` §3.5, §4.0, §4.2, §9 Slice 3.
Depends on Slice 1 (`densestChapter`) and Slice 2 (repository method types) — both committed.

## Goal

The rule itself. Pure function of `(ownerId, target)` plus two injected repositories.

## Part A — RED

Create `server/src/services/memory-rules/person-throwback.rule.spec.ts`.

Model on `people-together.rule.spec.ts`: a module-level `target`, small typed fixture builders, and a
`ruleWith(...)` helper returning both the rule and its mocks so call arguments can be asserted.
Vitest globals are configured — do **not** import `describe`/`it`/`expect`/`vi`.

```ts
const target = DateTime.fromISO('2026-08-13', { zone: 'utc' });

const ruleWith = (people: DormantPerson[], counts: MemoryPersonDayCount[], assets: MemoryAsset[]) => {
  const personRepository = { getDormantPeople: vi.fn().mockResolvedValue(people) };
  const assetRepository = {
    getMemoryPersonDailyCounts: vi.fn().mockResolvedValue(counts),
    getMemoryAssetsForPersonWindow: vi.fn().mockResolvedValue(assets),
  };
  return {
    rule: new PersonThrowbackMemoryRule(personRepository as never, assetRepository as never),
    personRepository,
    assetRepository,
  };
};
```

All 20 cases from spec §4.2, one `it()` each, phrased as behaviour. **Write rows 2, 18, 19 and 3
first** — they are the four the spec was revised to cover.

| Row | Test                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `target.day !== 13` (use the 12th and the 14th) → `[]`, and **`getDormantPeople` not called**                                                                                                                                                                                  |
| 2   | empty pool → `[]`, and **`getMemoryPersonDailyCounts` NOT called**. Asserting only `[]` passes without the guard — assert the absent call                                                                                                                                      |
| 3   | "Anna", 23-asset chapter across Aug 2019, target 2026-08-13 → one candidate; pin `title` `'Times with Anna'`, `subtitle` `'23 photos · August 2019'`, `dedupeKey` `'person_throwback:p1'`, `ruleId`, and **`score === 186`** (`110 + min(23,30)*3 + max(0,10-7)` = `110+69+7`) |
| 4   | `lastSeenAt` exactly at the cutoff → excluded. Assert via the **query argument**: `lastSeenBefore` equals `target.startOf('day').minus({months:12})`                                                                                                                           |
| 5   | last seen one day before the cutoff → included                                                                                                                                                                                                                                 |
| 6   | densest chapter has 5 assets → excluded (`MIN_CHAPTER_ASSETS`)                                                                                                                                                                                                                 |
| 7   | any run reaching step 3 → `getDormantPeople` called with `minAssets: 10`, `limit: 10`, and the exact `lastSeenBefore`                                                                                                                                                          |
| 8   | 7 qualifying people → exactly 5 candidates, score descending                                                                                                                                                                                                                   |
| 9   | two identical scores → ordered by `personId` ascending                                                                                                                                                                                                                         |
| 10  | chapter spanning a month boundary (e.g. 2019-07-29 → 2019-08-04, heavier in August) → subtitle month/year come from `medianTime`, not from `chapter.from`                                                                                                                      |
| 11  | single-day chapter of 8 assets → included (no distinct-day minimum)                                                                                                                                                                                                            |
| 12  | chapter dated 4 years back → `recencyBonus` contributes 6                                                                                                                                                                                                                      |
| 13  | equal chapters, one 2 years back and one 8 years back → the 2-years-back one scores higher                                                                                                                                                                                     |
| 14  | window returns 20 assets → `assetIds.length === 8`, evenly spaced by time, chronological                                                                                                                                                                                       |
| 15  | every candidate → `visibleForDays === 7`, and `dedupeKey` contains **no** year                                                                                                                                                                                                 |
| 16  | every pooled candidate fails the chapter bar → `[]`, and `getMemoryAssetsForPersonWindow` never called                                                                                                                                                                         |
| 17  | window returns 20 assets but `chapter.count` is 23 → candidate kept; subtitle still says `23 photos`                                                                                                                                                                           |
| 18  | window returns **4** assets (< `MIN_CHAPTER_ASSETS`) → candidate **dropped**                                                                                                                                                                                                   |
| 19  | window returns **zero** assets → candidate dropped, no zero-asset memory                                                                                                                                                                                                       |
| 20  | one candidate's window query rejects → that candidate dropped, the others still returned                                                                                                                                                                                       |

For rows 17–20 the window mock must vary per candidate — use
`vi.fn().mockResolvedValueOnce(...).mockResolvedValueOnce(...)` or a `mockImplementation` keyed on
`personId`.

Run:

```
cd server && pnpm test --run src/services/memory-rules/person-throwback.rule.spec.ts
```

⚠️ `pnpm test --run <path>`, NOT `pnpm test -- --run <path>`.

**Expected red:** module not found. Capture the output.

## Part B — GREEN

Create `server/src/services/memory-rules/person-throwback.rule.ts` per spec §3.5.

Exported constants (module-level `export const`, not private statics — spec D11):

```ts
export const TRIGGER_DAY = 13;
export const DORMANCY_MONTHS = 12;
export const MIN_TOTAL_ASSETS = 10;
export const MIN_CHAPTER_ASSETS = 6;
export const CANDIDATE_POOL = 10;
export const MAX_CANDIDATES = 5;
export const ASSET_CAP = 8;
export const VISIBLE_FOR_DAYS = 7;
export const SCORE_BASE = 110;
export const MAX_COUNT_BONUS = 30;
```

```ts
export class PersonThrowbackMemoryRule implements MemoryRule {
  readonly id = 'person_throwback';

  constructor(
    private personRepository: Pick<PersonRepository, 'getDormantPeople'>,
    private assetRepository: Pick<
      AssetRepository,
      'getMemoryPersonDailyCounts' | 'getMemoryAssetsForPersonWindow'
    >,
  ) {}

  async evaluate({ ownerId, target }: MemoryRuleContext): Promise<MemoryRuleCandidate[]> { ... }
}
```

Follow the nine numbered flow steps in spec §3.5 exactly. The five that are easy to get wrong:

- **Step 4** — return `[]` when the pool is empty, **before** calling
  `getMemoryPersonDailyCounts`. An empty `personIds` array would emit `IN ()`. Load-bearing.
- **Step 8** — after `getMemoryAssetsForPersonWindow`, re-check
  `assets.length >= MIN_CHAPTER_ASSETS` and drop the candidate if it fails. `chapter.count` came
  from a different, earlier query.
- **Step 9** — `memoryAt` must be
  `DateTime.fromJSDate(medianTime(assets), { zone: 'utc' })`. `medianTime` returns a `Date`;
  `MemoryRuleCandidate.memoryAt` is a Luxon `DateTime`. `sampleAssetsByTime` and `medianTime` both
  run over the **full** window set, not the sampled 8.
- **Subtitle/score** use `chapter.count` (the full chapter total), never `assetIds.length`.
- **Row 20** — a rejecting window query must not sink the whole rule. Wrap the per-candidate fetch
  so one failure drops only that candidate.

Reuse from `curation.util.ts`: `sampleAssetsByTime`, `medianTime`, `recencyBonus`, `monthName`.
Reuse `densestChapter` and `CHAPTER_MAX_SPAN_DAYS` from `chapter.util.ts` (Slice 1).

Candidate shape is pinned in spec §3.5 — copy it exactly, including
`context: { personId, chapterFrom, chapterTo, count: chapter.count }`.

Do **not** register the rule anywhere. No metadata entry, no registry entry, no i18n. Slice 4.

## Part C — VERIFY

```
cd server && pnpm test --run src/services/memory-rules/person-throwback.rule.spec.ts   # 20 passing
cd server && pnpm test --run src/services/memory-rules                                  # whole dir still green
cd server && pnpm check
cd server && npx eslint src/services/memory-rules/person-throwback.rule.ts src/services/memory-rules/person-throwback.rule.spec.ts --max-warnings 0
cd server && npx prettier --check src/services/memory-rules/person-throwback.rule.ts src/services/memory-rules/person-throwback.rule.spec.ts
```

## Commit

```
feat(memories): add person_throwback memory rule
```

Two new files only.
