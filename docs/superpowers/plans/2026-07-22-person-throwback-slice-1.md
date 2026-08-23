# Slice 1 — `chapter.util.ts`

Spec: `docs/plans/2026-07-22-memory-person-throwback-spec.md` §3.4, §4.0, §4.1, §9 Slice 1.
No dependencies. Pure module, zero imports beyond types.

## Goal

A pure helper that finds the densest window of at most `maxSpanDays` consecutive calendar days in a
series of per-day counts.

## Part A — RED

Create `server/src/services/memory-rules/chapter.util.spec.ts`.

Model the file style on `server/src/services/memory-rules/season.util.spec.ts` (plain `describe`/`it`,
no mocks, a small local date helper). Vitest globals are configured — do **not** import `describe`/
`it`/`expect`.

Local helper:

```ts
const day = (iso: string, count: number): DayCount => ({ day: new Date(`${iso}T00:00:00.000Z`), count });
```

All nine cases from spec §4.1, one `it()` each, phrased as behaviour:

1. **empty input** → `densestChapter([], 14)` returns `null`.
2. **one day, 3 assets** → `from`/`to` both that day, `count === 3`.
3. **all days inside the span** → window covers the whole set; `count` is the total.
4. **two clusters, second denser** → returns the second cluster's bounds and count.
5. **two clusters equally dense** → returns the **more recent** one. Build two 3-day clusters of
   identical total count, far apart, and assert `from` equals the later cluster's first day.
6. **days exactly `maxSpanDays - 1` apart** → both included. With `maxSpanDays = 14`, use
   `2020-01-01` and `2020-01-14` (13 days apart) → one window, `count` is the sum.
7. **days exactly `maxSpanDays` apart** → split. `2020-01-01` and `2020-01-15` (14 days apart) →
   the window contains only one of them.
8. **dense window at the very start** → a heavy cluster at index 0 followed by sparse days is still
   found (guards an off-by-one at `left = 0`).
9. **input in descending order** → same result as the ascending equivalent (defensive sort).

Cases 6 and 7 are the pair that pins the boundary: "at most `maxSpanDays` **calendar days**" means a
maximum day-index difference of `maxSpanDays - 1`. Write them first.

Run:

```
cd server && pnpm test --run src/services/memory-rules/chapter.util.spec.ts
```

⚠️ `pnpm test --run <path>`, NOT `pnpm test -- --run <path>` — this pnpm forwards the literal `--`
to vitest, which silently drops the path filter and runs the whole suite.

**Expected red:** `Failed to resolve import "src/services/memory-rules/chapter.util"` — the module
does not exist. Capture the output.

## Part B — GREEN

Create `server/src/services/memory-rules/chapter.util.ts` exactly per spec §3.4:

```ts
export const CHAPTER_MAX_SPAN_DAYS = 14;

export interface DayCount {
  day: Date;
  count: number;
}

export interface Chapter {
  from: Date;
  to: Date;
  count: number;
}

export const densestChapter = (days: DayCount[], maxSpanDays: number): Chapter | null => { ... };
```

Implementation notes:

- Sort a **copy** ascending by `day.getTime()` — defensive, per the spec docstring. Never mutate the
  caller's array.
- Two-pointer sweep with a running sum. For each `right`, advance `left` while the day difference
  exceeds `maxSpanDays - 1`, subtracting as it moves.
- Day difference in whole days: `(a.getTime() - b.getTime()) / 86_400_000`. Inputs are UTC
  midnight (`date_trunc` output), so this is exact — no DST drift.
- Update the best window on `sum >= best` (**`>=`**, not `>`), so the last — most recent — maximal
  window wins. This is the §4.1 case 5 tie rule; `>` silently fails it.
- Return `null` only for empty input.
- Add the file's doc comment from the spec, including why the sort is defensive.

Follow repo style: 120-char lines, single quotes, arrow-function exports, `src/` import paths (no
relative imports).

## Part C — VERIFY

```
cd server && pnpm test --run src/services/memory-rules/chapter.util.spec.ts   # 9 passing
cd server && pnpm check                                                       # tsc --noEmit
cd server && npx eslint src/services/memory-rules/chapter.util.ts src/services/memory-rules/chapter.util.spec.ts --max-warnings 0
cd server && npx prettier --check src/services/memory-rules/chapter.util.ts src/services/memory-rules/chapter.util.spec.ts
```

All four must pass. Report the red output and the green output.

## Commit

```
feat(memories): add densestChapter window helper
```

Only the two new files. Do not touch anything else — registration, the rule, and the repository
queries belong to later slices.
