# Slice 7 — Cleanup resolve: atomicity and duplicate-id safety

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 7, findings F12–F14)
**Branch:** `feat/face-review-unified`
**Depends on:** Slice 3, which also edits `face-person-verdict.repository.ts`. Start only after it is
committed.

## Goal

Every bucket of a resolve is all-or-nothing, and a malformed-but-plausible request is refused with a
400 before any bucket commits rather than 500-ing halfway through.

## The three defects

**F12 — the `stay` bucket is not transactional, and the comment says it is.**
`server/src/services/face-repair.service.ts` around `:988` calls `markRejectedMany` on `this.db` and
around `:1005` calls `drainPendingForFaces(stay)` on `this.db` — two separate autocommit statements.
The load-bearing comment around `:1158-1164` states the drains are _"drained per-bucket, inside each
bucket's own transaction, above — … `stay` alongside its decline write, `lock` and `detach` alongside
their identity-link writes"_. `lock` (around `:1024`) and `detach` (around `:1048`) genuinely are;
`stay` is not. `markRejectedMany` is itself N chunked statements, so a mid-loop failure records a
partial "keep here".

**F13 — duplicate ids in the `lock` bucket 500 after earlier buckets committed.**
`server/src/dtos/face-repair.dto.ts` declares `lock: z.array(z.uuidv4()).max(MAX_RESOLVE_FACES)` with
no uniqueness. `findOverlappingIds` (`server/src/utils/face-repair.ts:132-140`) de-duplicates
_within_ each bucket via `new Set(bucket)`, so `[F, F]` passes validation.
`getEligibleFaceIdsForPerson` returns a `Set`, so the ineligibility check also passes. Then
`replaceFaceIdentities({ assetFaceIds: lock })` builds one chunk containing two rows with the same
`assetFaceId` under `ON CONFLICT ("assetFaceId") DO UPDATE`, which Postgres refuses with `21000 — ON
CONFLICT DO UPDATE command cannot affect row a second time`. By then the `moveToPerson` and `stay`
buckets have already committed. `markRejectedMany` guards exactly this hazard with an explicit
de-duplication (`face-person-verdict.repository.ts` around `:214`); the `lock` path does not.

**F14 — a face routed to two destinations is accepted.**
`face-repair.service.ts` around `:808` flattens every move group into one bucket
(`moveToPerson.flatMap((g) => g.faceIds)`) before calling `findOverlappingIds`, and that helper
collapses duplicates inside a bucket. So `moveToPerson: [{dest: Q, faceIds:[F]}, {dest: R, faceIds:[F]}]`
is accepted despite the comment at that site promising "a face may resolve only one way in a single
request". The outcome is safe but arbitrary: two routes are built, the first moves F, the second's
`WHERE personId = P` no longer matches and F is silently counted as skipped. The promised 400 never
fires.

## Files

| File                                                                                | Change                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `server/src/services/face-repair.service.ts`                                        | wrap the `stay` bucket; fix the false comment; pass one bucket per move group                                             |
| `server/src/repositories/face-person-verdict.repository.ts`                         | `markRejectedMany` gains a `db` parameter                                                                                 |
| `server/src/repositories/face-identity.repository.ts`                               | `replaceFaceIdentities` de-duplicates `assetFaceIds`                                                                      |
| `server/src/utils/face-repair.ts`                                                   | no change expected — verify `findOverlappingIds` already reports cross-bucket duplicates once the caller stops flattening |
| `server/test/medium/specs/services/face-repair.resolve.spec.ts`                     | S7.1–S7.3, S7.5–S7.7, S7.9                                                                                                |
| `server/src/utils/face-repair.spec.ts`                                              | S7.4                                                                                                                      |
| `server/src/repositories/face-identity.repository.spec.ts` or the medium equivalent | S7.8                                                                                                                      |

## Implementation

1. **`markRejectedMany` gains `db: Kysely<DB> | Transaction<DB> = this.db`** as its last parameter,
   and uses it for every chunk. Existing callers that pass nothing keep working.
2. **Wrap the `stay` block** in `this.databaseRepository.transaction(async (trx) => { … })`, threading
   `trx` into both `markRejectedMany` and `drainPendingForFaces`. The N+1 owner-liveness probe just
   above it (`personRepository.getById(ownerId)` in a loop, around `:973-978`) is a **read** — leave it
   outside the transaction. Do not call any `this.db` method inside the callback (issue #595).
3. **Correct the comment** around `:1158-1164` so it describes what the code does.
4. **Stop flattening the move groups**: pass `moveToPerson.map((g) => g.faceIds)` as separate buckets
   to `findOverlappingIds`, alongside `stay`, `lock`, `detach` and `unknown`. Confirm the resulting 400
   names the offending ids. Check whether any existing test depends on the flattened behaviour before
   changing it.
5. **`replaceFaceIdentities` de-duplicates** `assetFaceIds` before chunking, mirroring
   `markRejectedMany`'s guard. Put the de-duplication in the repository, not the caller — every caller
   benefits and a future one cannot forget.

## Tests

Every absence assertion needs a positive control in the same test body (spec §2).

| #    | Layer  | Test                                                                                                                                                                                                    |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7.1 | medium | Fault injection: make `drainPendingForFaces` throw inside the `stay` block ⇒ **no** negative verdict rows were written (the whole bucket rolled back) and the pending rows are intact                   |
| S7.2 | medium | Fault injection mid-chunk: a `stay` bucket spanning more than one chunk where a later chunk throws ⇒ zero verdict rows, not a partial set                                                               |
| S7.3 | medium | **pin** — the happy path still writes one negative per face against its own stored suspected owner and drains every pending row for those faces                                                         |
| S7.4 | unit   | `findOverlappingIds` reports a face present in two different move groups                                                                                                                                |
| S7.5 | medium | `resolveFaces` with the same face in two `moveToPerson` groups ⇒ 400, and **nothing** committed: no move, no verdict, no drain                                                                          |
| S7.6 | medium | `resolveFaces` with a duplicated id inside one `lock` bucket ⇒ succeeds (a client repeating a face is legitimate and used to be absorbed), writes exactly one `manual` link, and does not raise `21000` |
| S7.7 | medium | A request combining `moveToPerson`, `stay` and a duplicated `lock` id ⇒ all three buckets apply; assert the move and the stay both committed and the lock is single                                     |
| S7.8 | medium | `replaceFaceIdentities` called with `['a','a','b']` writes one row per distinct id                                                                                                                      |
| S7.9 | medium | **pin** — `lock` and `detach` remain transactional: mutate each to throw mid-way and assert full rollback                                                                                               |

For the fault injections, look at how `face-repair.resolve.spec.ts` already does it — the spec has an
existing injection around the unknown-park orphan-cluster case (roughly `:2511`). Reuse that idiom
rather than inventing one.

## Verification

```bash
cd server
pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-repair.resolve.spec.ts
pnpm exec vitest --config test/vitest.config.mjs --run src/utils/face-repair.spec.ts src/dtos/face-repair.dto.spec.ts
npx tsc --noEmit -p tsconfig.json
npx eslint src/services/face-repair.service.ts src/repositories/face-person-verdict.repository.ts src/repositories/face-identity.repository.ts src/utils/face-repair.ts --max-warnings 0
npx prettier --check src/services/face-repair.service.ts src/repositories/face-person-verdict.repository.ts src/repositories/face-identity.repository.ts
```

`face-repair.resolve.spec.ts` is large (~2 700 lines) and is the regression net for the whole resolve
path. Every test in it must stay green.

## Constraints

- `pnpm test -- --run <path>` silently drops the path filter — use the forms above.
- Run **tsc and eslint**, not only vitest. Two earlier slices shipped type and lint errors that
  vitest does not catch and that fail CI.
- Never run a `this.db` query inside a `this.db.transaction()` callback (issue #595).
- Never run `make sql` / `mise //:sql` — report which `.sql` files are stale instead.
- Do not add `Co-Authored-By` or "Generated with" trailers. Do not commit.

## Commit

```
fix(face-cleanup): make the stay bucket atomic and reject cross-group duplicate faces
```
