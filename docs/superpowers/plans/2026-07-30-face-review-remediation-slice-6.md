# Slice 6 — A merge keeps the stronger verdict

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(Slice 6, finding F11)
**Branch:** `feat/face-review-unified`
**Depends on:** Slice 2, which leaves the red test this slice turns green.

## Goal

Merging two people never discards a durable human "not this person" in favour of a machine
suggestion.

## The defect, traced

`server/src/utils/face-verdict-merge.ts:30-50`, `retargetVerdictPersonId`:

```ts
await db
  .deleteFrom('face_person_verdict')
  .where('personId', '=', sourcePersonId)
  .where('assetFaceId', 'in', (eb) =>
    eb
      .selectFrom('face_person_verdict as survivor')
      .select('survivor.assetFaceId')
      .where('survivor.personId', '=', targetPersonId),
  )
  .execute();
```

The collision delete inspects **no status**. Reproduction:

1. User rejects face F for person Bob ⇒ `fpv(personId=Bob, assetFaceId=F, identityId=I_Bob, status='rejected')`.
2. A later suggestion scan proposes F for person Robert ⇒
   `fpv(personId=Robert, assetFaceId=F, status='pending', identityId=NULL)` —
   `upsertPending` never writes an `identityId`.
3. Owner merges Bob into Robert. `mergePersonProfile` (`server/src/repositories/person.repository.ts:189`)
   calls `retargetVerdictPersonId(db, Bob, Robert)`. The delete removes **Bob's rejected row**; the
   subsequent update then finds nothing to move.
4. `rekeyVerdictIdentity` (`face-identity.repository.ts:3289`) runs afterwards with nothing left to
   re-key.
5. `getPendingForPerson(Robert)` — the pending row passes both anti-joins (no negative for Robert,
   no negative for Robert's identity) ⇒ **F is re-proposed for the same human the user rejected it
   for.**

`retargetVerdictSpacePersonId` (`:53-73`) has the identical shape on `spacePersonId`.

## Implementation

Per spec §4, **strength wins, not side**: `rejected`/`ignored` outrank `pending`. Add a promotion
step to `retargetVerdictPersonId`, **before** the existing collision delete:

```ts
// Strength wins, not side. A durable human negative outranks a machine suggestion: when the
// survivor holds only a `pending` row for this face and the source holds a `rejected`/`ignored`
// one, the merge must keep the human's answer. The collision delete below is status-blind, so
// without this a merge of two profiles of the same human re-proposes a face the user already
// rejected (spec §4, finding F11).
await db
  .updateTable('face_person_verdict as survivor')
  .set({
    status: sql`src."status"`,
    source: sql`src."source"`,
    actorId: sql`src."actorId"`,
    identityId: sql`coalesce(survivor."identityId", src."identityId")`,
    distance: null,
    updatedAt: sql`now()`,
  })
  .from('face_person_verdict as src')
  .whereRef('src.assetFaceId', '=', 'survivor.assetFaceId')
  .where('survivor.personId', '=', targetPersonId)
  .where('survivor.status', '=', 'pending')
  .where('src.personId', '=', sourcePersonId)
  .where('src.status', 'in', ['rejected', 'ignored'])
  .execute();
```

Then the existing delete and update run unchanged: the delete now removes a source row whose
information has already been transferred.

Notes for the implementer:

- `distance` is nulled because the row is no longer a queue entry — a negative verdict carries no
  scan distance, and leaving one would contradict the table comment at
  `server/src/schema/tables/face-person-verdict.table.ts:103-104`.
- `identityId` uses `coalesce(survivor, src)`, matching the D10 rule the upserts already follow
  (`face-person-verdict.repository.ts:173`): never null a stronger existing key.
- Verify Kysely's `updateTable(...).from(...)` alias syntax against the version in this repo before
  assuming it compiles; if the aliased form is awkward, a `sql` template for this one statement is
  acceptable — but keep it inside the same `db` handle so it stays in the caller's transaction.
- Apply the identical shape to `retargetVerdictSpacePersonId` on `spacePersonId`.
- Both helpers are called inside the merge transaction and strictly before the source row is
  deleted — do not change that ordering.

## Tests

In `server/test/medium/specs/services/face-verdict.merge-durability.spec.ts`. Slice 2 has already
added the red test for S6.1 (named `a source negative outranks a survivor pending row`) — start by
running it and confirming it is red, then make it green. Add the rest.

| #     | Test                                                                                                                                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6.1  | **BDD** — Given a rejection of F for Bob and a later pending suggestion of F for Robert, When Bob merges into Robert, Then exactly one row exists, `status='rejected'`, `personId=Robert`, and `getPendingForPerson(Robert)` does not offer F (assert a control face IS offered in the same call) |
| S6.2  | The promoted row carries the source's `source` and `actorId`, and its `distance` is NULL                                                                                                                                                                                                          |
| S6.3  | **pin** — source `pending` + survivor `rejected` still keeps the survivor's rejected row                                                                                                                                                                                                          |
| S6.4  | source `ignored` + survivor `pending` promotes to `ignored`, not `rejected`                                                                                                                                                                                                                       |
| S6.5  | source `rejected` + survivor `ignored` keeps the survivor unchanged (negative-vs-negative is not a promotion)                                                                                                                                                                                     |
| S6.6  | **pin** — survivor has no row for F: the plain re-target moves the source row, unchanged path                                                                                                                                                                                                     |
| S6.7  | source `identityId` NULL, survivor `identityId` set ⇒ promoted row keeps the survivor's identity                                                                                                                                                                                                  |
| S6.8  | survivor `identityId` NULL, source set ⇒ promoted row adopts the source's identity                                                                                                                                                                                                                |
| S6.9  | Three-way merge: two sources (one `rejected`, one `ignored`) into a `pending` survivor ⇒ exactly one row, negative, no unique-index violation                                                                                                                                                     |
| S6.10 | Row-count assertions after every case above — both partial unique indexes still satisfied                                                                                                                                                                                                         |
| S6.11 | The space twin: S6.1, S6.3 and S6.9 repeated on `spacePersonId` through `mergeSpacePeople`                                                                                                                                                                                                        |
| S6.12 | **pin** — `rekeyVerdictIdentity` still runs after the re-target and leaves the promoted row keyed to the surviving identity                                                                                                                                                                       |

Every absence assertion needs a positive control in the same test body (spec §2).

## Verification

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/face-verdict.merge-durability.spec.ts \
  test/medium/specs/services/face-repair.merge-consistency.spec.ts
```

`face-repair.merge-consistency.spec.ts` must stay green — its existing test at `:112-136` asserts a
negative verdict survives a merge of its target person, and this change must not alter that.

## Constraints

- `pnpm test -- --run <path>` silently drops the path filter — use the form above.
- Never run a `this.db` query inside a `this.db.transaction()` callback; these helpers already take
  a `db` parameter and must keep using it.
- Never run `make sql` / `mise //:sql` without a running database.
- Do not add `Co-Authored-By` or "Generated with" trailers. Do not commit.

## Commit

```
fix(face-review): keep the stronger verdict when a merge collides two rows
```
