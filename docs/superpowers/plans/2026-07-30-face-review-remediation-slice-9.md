# Slice 9 — Suggestion scan fan-out and queue safety

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 9, findings F17–F19)
**Branch:** `feat/face-review-unified`

## Goal

Enabling face suggestions on a large library queues work proportional to the people that actually have
candidates, deduplicates re-entrant sweeps, and never wedges a forced recognition run.

## The three defects

**F17 — the fan-out predicate asks the wrong question.**
`getScannablePeopleWithUnassignedFaces` (`server/src/repositories/person.repository.ts`, the `EXISTS`
around `:970-985`) correlates on `.whereRef('asset.ownerId', '=', 'person.ownerId')`. It therefore asks
"does this person's **owner** have at least one unassigned ML face anywhere in their library", not
"does **this person** have candidates". One unassigned face queues a scan for **every** named, visible,
non-pet person of that owner. Each scan then performs up to `PERSON_SUGGESTION_EMBEDDING_SAMPLE` (20)
ANN searches at `PERSON_SUGGESTION_NUM_RESULTS` (100), on the concurrency-1 `PeopleBackfill` queue.

**F18 — the per-person jobs have no `jobId`.**
`getJobOptions` (`server/src/repositories/job.repository.ts`, around `:511-560`) has cases for the two
`…QueueAll` names but none for `PersonSuggestionScan` / `SpacePersonSuggestionScan`. So nothing
coalesces, and `FaceIdentityBackfill` re-queues both `QueueAll` jobs on every drain — each cycle
stacking a fresh full fan-out on whatever is still draining.

**F19 — a forced recognition run can park indefinitely.**
`handleQueueRecognizeFaces` adds `QueueName.PeopleBackfill` to `waitForQueueCompletion` when `force`.
That helper (`job.repository.ts`, around `:465-495`) is a `while (pending.length > 0)` one-second poll
with **no timeout and no cancellation**, so the forced job stays `active` until the entire suggestion
sweep drains — and F17/F18 can replenish the sweep while it waits.

## Files

| File                                                                    | Change                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `server/src/repositories/person.repository.ts`                          | narrow the `EXISTS` to per-person candidates          |
| `server/src/repositories/shared-space.repository.ts`                    | verify/align the space twin                           |
| `server/src/repositories/job.repository.ts`                             | `getJobOptions` cases; bound `waitForQueueCompletion` |
| `server/src/services/person.service.ts`                                 | pass the timeout at the forced call site              |
| `server/test/medium/specs/repositories/person.repository.spec.ts`       | S9.1–S9.6                                             |
| `server/test/medium/specs/repositories/shared-space.repository.spec.ts` | S9.7                                                  |
| `server/src/repositories/job.repository.spec.ts`                        | S9.8                                                  |
| `server/src/services/person.service.spec.ts`                            | S9.9, S9.10                                           |

Nothing else. Another agent owns `web/`, `server/src/repositories/face-person-verdict.repository.ts`
and `server/src/services/face-repair.service.ts`.

## Implementation

1. **Narrow the `EXISTS`.** The candidate face must be unassigned, ML-sourced, live, visible, on a
   reviewable asset, **and in the same owner's library as the person** — the ownership correlation
   stays, it is the "anywhere in the library" scope that is wrong. Use
   `reviewableAssetVisibility` from `src/utils/face-review.ts` (added in Slice 1) so this predicate
   agrees with what the scan will actually consider.

   Be honest in the comment about what this does and does not achieve: a person whose candidates all
   fall **outside the distance band** still gets a job that returns early, because the band needs a
   KNN the queue-all query cannot afford. The fix removes the pathological case (every named person
   of an owner with one stray face), not every wasted job.

2. **Check the space twin.** `getScannableSpacePeopleWithUnassignedFaces`
   (`shared-space.repository.ts`) was reported in review as already correlating correctly and applying
   `spaceVisibilityGate`. **Verify that against the current source.** If it is already correct, say so
   and add S9.7 as a pin rather than changing it. If it has the same defect, fix it the same way.

3. **Add `getJobOptions` cases** for `JobName.PersonSuggestionScan` and
   `JobName.SpacePersonSuggestionScan`, returning a `jobId` that includes the person id, plus
   `removeOnComplete: true`. Copy the shape of a neighbouring per-entity case in the same switch —
   do not invent a new id format.

4. **Bound `waitForQueueCompletion`.** Add an optional timeout (milliseconds) and, on expiry, log a
   warning naming the queue and return rather than throwing — a forced recognition run that gives up
   waiting should still proceed, not fail. Pass a timeout at the `PeopleBackfill` call site only;
   leave the other call sites' behaviour unchanged so this slice cannot alter unrelated jobs.

## Tests

Every absence assertion needs a positive control in the same test body (spec §2).

| #     | Layer  | Test                                                                                                                                                                                                                                       |
| ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S9.1  | medium | **BDD** — **Given** an owner with three named people, only one of which has an unassigned ML face in its own library, **When** `getScannablePeopleWithUnassignedFaces` streams, **Then** exactly one person is yielded, and it is that one |
| S9.2  | medium | Red proof for S9.1 (three yielded before the fix). Fold into S9.1 once green rather than keeping both                                                                                                                                      |
| S9.3  | medium | A person whose only candidate is on a Locked asset is not yielded — composes with Slice 1                                                                                                                                                  |
| S9.4  | medium | A person whose only candidate is soft-deleted / invisible / non-ML is not yielded (table-driven), with a live control yielded in the same test                                                                                             |
| S9.5  | medium | **pin** — hidden, unnamed and `type='pet'` people are still excluded                                                                                                                                                                       |
| S9.6  | medium | Two owners: owner A's unassigned face does not make owner B's people scannable                                                                                                                                                             |
| S9.7  | medium | The space twin yields only space people with candidates reachable in that space (**pin** if it is already correct — see Implementation step 2)                                                                                             |
| S9.8  | unit   | `getJobOptions` for both new job names returns a `jobId` containing the person id; two calls with the same id produce the same `jobId`, two different ids do not                                                                           |
| S9.9  | unit   | `handleQueueRecognizeFaces({ force: true })` returns after the bounded wait when `PeopleBackfill` never drains, and logs a warning naming the queue                                                                                        |
| S9.10 | unit   | **pin** — the non-forced path does not wait on `PeopleBackfill` at all                                                                                                                                                                     |

For S9.9, drive the timeout with fake timers or a very short injected timeout — do **not** make the
test actually sleep for a production-length interval.

## Verification

```bash
cd server
pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/repositories/person.repository.spec.ts \
  test/medium/specs/repositories/shared-space.repository.spec.ts
pnpm exec vitest --config test/vitest.config.mjs --run \
  src/repositories/job.repository.spec.ts src/services/person.service.spec.ts
npx tsc --noEmit -p tsconfig.json
npx eslint src/repositories/person.repository.ts src/repositories/shared-space.repository.ts src/repositories/job.repository.ts src/services/person.service.ts --max-warnings 0
npx prettier --check src/repositories/person.repository.ts src/repositories/shared-space.repository.ts src/repositories/job.repository.ts src/services/person.service.ts
```

## Constraints

- `pnpm test -- --run <path>` silently drops the path filter — use the forms above. A vitest **glob**
  over bracketed route directories silently matches zero files; always check the reported test count.
- **`vitest` does not typecheck.** Run tsc, eslint and prettier and show their output.
- If your change breaks a spec outside the file table, **report it with the exact fix** rather than
  editing it.
- Never run `make sql` / `mise //:sql` — report which `.sql` files are stale.
- Do not add `Co-Authored-By` or "Generated with" trailers. Do not commit.

## Commit

```
perf(face-suggestions): queue suggestion scans only for people with candidates
```
