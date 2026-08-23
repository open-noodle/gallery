# Slice 6 — medium tests + docs

Spec: `docs/plans/2026-07-22-memory-person-throwback-spec.md` §4.4, §3.1 rows 9, 14–16, §9 Slice 6.
Depends on Slice 4 (registration). Independent of Slice 5.

## Goal

Prove the SQL-side behaviour against a real database, and document the type.

## Part A — medium tests (RED first)

**`server/test/medium/specs/services/memory.service.spec.ts`**

Model on the existing `themed` block (~line 1037) and `video_moments` block (~line 855) — same
factory helpers, same assertion style (`memories.some((m) => (m.data as { ruleId?: string }).ruleId === ...)`).

The rule fires on **day 13**, so build targets as day-13 dates. Dormancy cutoff is 12 months before
the target, so a "dormant" person's assets must be older than that.

All of spec §4.4, one `it()` each:

| #   | Scenario                                               | Expect                                                           |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| 1   | dormant named person, dense chapter, type enabled      | memory created with `ruleId: 'person_throwback'`, correct assets |
| 2   | same but `person.type = 'pet'`                         | **no** memory                                                    |
| 3   | same but `isHidden = true`                             | no memory                                                        |
| 4   | same but `name = ''`                                   | no memory                                                        |
| 5   | recent photos exist but are `Archived`                 | **still** dormant → memory created                               |
| 5b  | chapter assets have no `Preview` asset_file            | excluded from dormancy count and chapter                         |
| 5c  | a face on a chapter asset is soft-deleted or invisible | that asset does not count toward the chapter                     |
| 6   | user has the type toggled off                          | no memory                                                        |
| 7   | rule already fired for that person                     | **no second memory; a different dormant person is used instead** |

**Row 7 is the most important test in this slice.** It is the only coverage of D8 (the rule returns
up to 5 candidates so the engine can skip an already-fired `dedupeKey` and reach a fresh person).
Build it as: two qualifying dormant people, pre-insert a `person_throwback` memory whose
`dedupeKey` is `person_throwback:<personA.id>`, run generation, assert a memory exists for **person
B** and that person A did not gain a second one. If this test is hard to build, that is a reason to
spend more time on it, not to drop it.

Rows 2–5c exist here precisely because they are SQL-side filters that a mocked repository cannot
test (spec §4.0).

Run:

```
cd server && pnpm test:medium --run test/medium/specs/services/memory.service.spec.ts
```

⚠️ `pnpm test:medium --run <path>`, NOT `pnpm test:medium -- --run <path>` — the `--` form silently
drops the path filter and runs every medium test.

Medium tests need Docker; a Postgres matching CI is already running on `localhost:5432` (container
`pt-pg`). The medium harness normally manages its own testcontainer — if it does, let it; do not
repoint it at `pt-pg`.

**Expected red:** the new cases fail (no memory created / wrong assertions) because... actually
Slice 4 already registered the rule, so rows 1 and 5 may pass immediately. That is expected and
fine — they are integration confirmations, not new behaviour. The rows that must genuinely start
red are any that expose a filter bug. If **every** new row passes on the first run, re-read each
one and confirm it is actually exercising the filter it claims (e.g. row 2 must create a real
`type='pet'` person with a qualifying chapter, not a person that fails for some other reason).

## Part B — docs

**`docs/docs/features/memories.md`** (~line 88) — add a table row after `themed`:

```
| `person_throwback`    | Times with someone      | A warm chapter with someone who has not appeared in your photos for a year or more |
```

Do **not** describe it as "people you haven't seen" or mention the gap in user-facing copy — spec
D1. The gap is a selection heuristic, not a claim shown to users.

**`docs/docs/install/config-file.md`** (~line 331) — add to the `memories.types` key list:

```
- `person_throwback` — a warm chapter with someone who has not appeared in your photos for a year or more
```

**`docs/plans/2026-07-15-memory-types-roadmap.md`** — flip #9's row to shipped:

```
| 9 | Someone you haven't seen | ... | 🟠 | High but risky | **Shipped** — `person_throwback` (reframed: gap is a silent selector, never shown) |
```

While there, correct #12's status per spec §8: `themed` (PR #812) already rides smart-search CLIP
embeddings, so "Semantic themes (CLIP)" is no longer an unshipped north star — the remaining work
is vocabulary breadth and `themeMaxDistance` calibration. Add that as a Notes-column clarification;
do not mark #12 shipped outright.

Then:

```
npx prettier --write docs/docs/features/memories.md docs/docs/install/config-file.md docs/plans/2026-07-15-memory-types-roadmap.md
```

CI Docs Build is strict about markdown formatting.

## Part C — VERIFY

```
cd server && pnpm test:medium --run test/medium/specs/services/memory.service.spec.ts
cd server && pnpm test        # full unit suite still green
cd server && pnpm check
cd server && pnpm lint
cd server && pnpm format
npx prettier --check docs/docs/features/memories.md docs/docs/install/config-file.md docs/plans/2026-07-15-memory-types-roadmap.md
```

## Commit

```
test(memories): end-to-end coverage for person_throwback + docs
```
