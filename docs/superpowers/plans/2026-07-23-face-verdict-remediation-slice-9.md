# Face Verdict Remediation — Slice 9: Atomicity and freshness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. SERVER-only.

**Goal:** Close **D14** (personal confirm is four autocommit statements → a crash mid-chain leaves a torn write, same class as the A1 bug `executeRepair` already fixes; both engines' pending drains run outside their transactions) and **D12** (cleanup dashboard person counts go stale when the suggestion engine settles a flagged face after a scan).

**Architecture:** Wrap confirm's claim→reassign→resolveAssignedFace→link chain in one `databaseRepository.transaction` (threading `trx` through five repo methods that currently hardcode `this.db`). Move the pending drains inside the transactions that produce the settled faces — per-bucket in `resolveFaces` (whose `lock` bucket also needs a new transaction — a same-class torn-pair gap). For D12, recompute the dashboard's flagged counts live by applying the shared verdict filters over the scan's flagged-face detail (**R2 measured: option (a); the snapshot-drain fallback (b) is rejected — it's more invasive, touching the JSON counts at every verdict write**).

**Tech Stack:** Kysely `databaseRepository.transaction((trx) => …)` (fork rule: every query inside uses `trx`), `FaceVerdictService.buildVerdictMaps` + `applyVerdictFilters`, Vitest medium (real DB + `mockRejectedValueOnce` fault injection).

## Global Constraints

- `src/` alias; eslint `--max-warnings 0`.
- Unit run: `cd server && pnpm exec vitest --config test/vitest.config.mjs --run <path>`. Medium: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run <path>`. Never `-- --run`.
- **Kysely transaction rule:** inside `databaseRepository.transaction(async (trx) => …)`, EVERY query uses that `trx` — never `this.db`. The five repo methods must gain `db: Kysely<DB> | Transaction<DB> = this.db` (copy the pattern already on `ensurePersonIdentity`/`replaceFaceIdentities`) and use the passed `db`.
- **R2 resolved to option (a)** (recompute counts via verdict filters) — do NOT implement the snapshot-drain fallback; document the measured rationale in the commit/report.
- Scope: Slice 9 only. No verdict-write-shape changes (Slices 2-4); no read gates (Slice 6).
- One commit. No `Co-Authored-By` trailers.

---

## File Structure

- **Modify** `server/src/repositories/person.repository.ts` — `reassignFace` (~616): add `db` param.
- **Modify** `server/src/repositories/face-person-verdict.repository.ts` — `claimPending` (~104), `resolveAssignedFace` (~52), `drainPendingForFaces` (~65): add `db` param.
- **Modify** `server/src/repositories/face-identity.repository.ts` — `replaceFaceIdentity` singular (~2344): add `db` param.
- **Modify** `server/src/services/person.service.ts` — wrap `confirmFaceSuggestion`'s write chain in `databaseRepository.transaction`, threading `trx` (via a trx-aware private helper or an optional `db` param on the confirm write path). Thread `trx` into `replaceFaceIdentity` (private wrapper ~1470) too.
- **Modify** `server/src/services/face-repair.service.ts` — (a) `executeRepair`: move the `drainPendingForFaces(movedFaceIds)` (~301-305) INSIDE each per-route transaction (~269-279), scoped to that route's `ids`. (b) `resolveFaces`: remove the aggregate drain (~1011-1020); add per-bucket drains inside each bucket's transaction — `detach` bucket (add to the trx at ~908-913), and a NEW transaction around the `lock` bucket (~893-901) wrapping `ensurePersonIdentity`+`replaceFaceIdentities`+`drainPendingForFaces(lock)`. (c) `getLatestScanStatus` (~565-573): recompute counts (D12, below).
- **Modify** `server/test/medium/specs/services/person.service.spec.ts` (medium) — new `confirmFaceSuggestion` atomicity block.
- **Modify** `server/test/medium/specs/services/face-repair.scan.spec.ts` — dashboard-staleness test.
- **Modify** `server/src/services/person.service.spec.ts` (unit) — append the trailing `trx` arg to the pinned confirm assertions (~6542-6567).

---

## Task 1: Red — confirm atomicity + dashboard staleness (medium)

- [ ] **Step 1 (confirm atomicity):** In `test/medium/specs/services/person.service.spec.ts`, add a `describe('confirmFaceSuggestion (atomicity)', ...)` (mirror the fault-injection at `identity-merge-propagation.service.spec.ts:231-254`):

```ts
it('rolls back the reassign when the identity relink fails (no torn write)', async () => {
  // seed a person P, a face F assigned to another person Q, a pending verdict (P, F).
  // spy faceIdentityRepository.replaceFaceIdentity (the LAST write) → mockRejectedValueOnce.
  // await expect(sut.confirmFaceSuggestion(auth, P, F)).rejects.toThrow(...)
  // assert asset_face.personId is STILL Q (reassignFace rolled back) AND the verdict row is still pending
  //   (claim rolled back — claim-then-work contract, strictly safer).
});
```

- [ ] **Step 2 (dashboard staleness):** In `test/medium/specs/services/face-repair.scan.spec.ts`, add:

```ts
it('drops a person’s flagged count once a suggestion-side verdict settles one of its flagged faces (D12)', async () => {
  // run a scan flagging person P with N faces (getLatestScanStatus → flagged N).
  // settle ONE flagged face via a verdict (e.g. reject it toward its suspected owner, or manual-link it).
  // re-poll getLatestScanStatus → P.flagged === N-1 (and flaggedFraction / suspectedOwners[].count updated).
});
```

- [ ] **Step 3: Run RED** — both files:

```
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/person.service.spec.ts test/medium/specs/services/face-repair.scan.spec.ts
```

Expected RED: confirm leaves the face reassigned despite the relink failure (torn write); dashboard count stays N. Confirm both files executed.

---

## Task 2: Green — thread `trx` + wrap confirm

- [ ] **Step 1:** Add `db: Kysely<DB> | Transaction<DB> = this.db` to `reassignFace`, `claimPending`, `resolveAssignedFace`, `drainPendingForFaces`, and `replaceFaceIdentity` (singular); each uses the passed `db` instead of `this.db`. (Copy the exact pattern from `ensurePersonIdentity`.)
- [ ] **Step 2:** In `person.service.ts`, wrap the confirm write chain:

```ts
async confirmFaceSuggestion(auth, personId, assetFaceId) {
  await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
  await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [assetFaceId] });
  const person = await this.findOrFail(personId);
  const face = await this.personRepository.getFaceById(assetFaceId);
  await this.databaseRepository.transaction(async (trx) => {
    const claimed = await this.facePersonVerdictRepository.claimPending(personId, assetFaceId, trx);
    if (claimed === 0) return;                                   // rolls back cleanly, row stays pending
    await this.personRepository.reassignFace(face.id, personId, trx);
    await this.facePersonVerdictRepository.resolveAssignedFace(face.id, trx);
    const identity = await this.faceIdentityRepository.ensurePersonIdentity(personId, trx);
    await this.faceIdentityRepository.replaceFaceIdentity({ assetFaceId: face.id, identityId: identity.id, source: 'manual' }, trx);
  });
  // feature-photo refresh (display-only) stays OUTSIDE the trx
  if (person.faceAssetId === null) await this.createNewFeaturePhoto([person.id]);
  if (face.person?.faceAssetId === face.id) await this.createNewFeaturePhoto([face.person.id]);
}
```

> Keep `reassignFacesById` (the public method) working for its OTHER callers — do NOT break its signature; the confirm path uses its own trx-wrapped chain above (or a shared private trx helper). Preserve the existing idempotent/cascade-deleted behaviour (claim===0 → no-op).

- [ ] **Step 3:** Run the confirm atomicity test GREEN + `pnpm check`.

---

## Task 3: Green — drains inside transactions (face-repair)

- [ ] **Step 1 (executeRepair):** move `drainPendingForFaces` inside each per-route transaction — after `replaceFaceIdentities(..., trx)`, add `await this.facePersonVerdictRepository.drainPendingForFaces(ids, trx);`. Remove the post-loop aggregate drain (~301-305).
- [ ] **Step 2 (resolveFaces):**
  - `lock` bucket (~893-901): wrap in a NEW transaction — `await this.databaseRepository.transaction(async (trx) => { const identity = await ensurePersonIdentity(personId, trx); await replaceFaceIdentities({ assetFaceIds: lock, identityId: identity.id, source: 'manual' }, trx); await drainPendingForFaces(lock, trx); });`
  - `detach` bucket (~908-913): add `await drainPendingForFaces(detachedIds, trx)` inside the existing trx (after `detachFaces`).
  - `move`/`unknown` buckets: drained by `executeRepair` (Step 1) — remove the aggregate `drainPendingForFaces([...settledFaceIds])` (~1011-1020). `stay` faces carry no move/link change → confirm whether they need a drain (a "keep here" negative verdict already drains via its own write path; if `stay` produced a pending row that must clear, add a small `drainPendingForFaces(stay, trx)` in its bucket — check the `stay` handling and preserve its current drain semantics).
- [ ] **Step 3:** Run the full cleanup suite — behaviour preserved, drains now atomic:

```
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/face-repair.resolve.spec.ts test/medium/specs/services/face-repair.service.spec.ts \
  test/medium/specs/services/face-review-cross-flow.spec.ts test/medium/specs/services/face-suggestion-exclusions.spec.ts
```

If a leak/drain test changes, confirm the new behaviour is correct (atomic) and update deliberately.

---

## Task 4: Green — live dashboard counts (D12, option a)

- [ ] **Step 1:** In `getLatestScanStatus` (after `withCurrentNames`), recompute flagged counts by applying the shared verdict filters over the scan's flagged-face detail for ALL its persons:
  - fetch `getScanFlaggedFacesForPersons(scan.id, allPersonIds)` (already batch-capable).
  - `this.faceVerdictService.buildVerdictMaps({ personIds, assetFaceIds, suspectedOwnerIds })` then `applyVerdictFilters(byPerson, verdictMaps)` (the exact pattern `getPersonFlaggedFaces` uses at ~586-615, fanned out over the scan).
  - re-derive each person's `flagged`, `flaggedFraction` (over frozen `eligible`), and `suspectedOwners[].count` from the surviving faces; drop persons whose flagged count hits 0. Keep names/thumbnails from `withCurrentNames`.
    > This adds exactly one `getScanFlaggedFacesForPersons` query + one batched `buildVerdictMaps` per dashboard poll — the measured-cheaper option (a). Document in the report that (b) was rejected (it would require decrementing JSON counts at every verdict-write site, with no reusable per-face-decrement primitive).
- [ ] **Step 2:** Run the dashboard staleness test GREEN + the scan suite (`face-repair.scan.spec.ts`) — existing totals/shape assertions must still pass (no verdicts seeded in those → counts unchanged).

---

## Task 5: Fix pinned unit assertions + done gate + commit

- [ ] **Step 1:** In `person.service.spec.ts` (unit) `confirmFaceSuggestion` block (~6542-6567), append the trailing `trx` arg (the `test/utils.ts:318` passthrough makes `trx === mocks.database`) to the four `toHaveBeenCalledWith` assertions: `claimPending(person.id, face.id, mocks.database)`, `reassignFace(face.id, person.id, mocks.database)`, `replaceFaceIdentity({...}, mocks.database)`, `resolveAssignedFace(face.id, mocks.database)`. The deny/idempotent/cascade `.not.toHaveBeenCalled()` tests are unaffected.
- [ ] **Step 2: Done gate (full):**

```
cd server && pnpm check && pnpm lint
cd server && pnpm exec vitest --config test/vitest.config.mjs --run   # FULL unit (the confirm-arg change ripples)
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/person.service.spec.ts test/medium/specs/services/face-repair.scan.spec.ts \
  test/medium/specs/services/face-repair.resolve.spec.ts test/medium/specs/services/face-repair.service.spec.ts \
  test/medium/specs/services/face-review-cross-flow.spec.ts
```

- [ ] **Step 3: Commit:**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/face-unified
git add server/src/repositories/person.repository.ts server/src/repositories/face-person-verdict.repository.ts \
        server/src/repositories/face-identity.repository.ts server/src/services/person.service.ts \
        server/src/services/face-repair.service.ts server/src/services/person.service.spec.ts \
        server/test/medium/specs/services/person.service.spec.ts \
        server/test/medium/specs/services/face-repair.scan.spec.ts \
        docs/superpowers/plans/2026-07-23-face-verdict-remediation-slice-9.md
git commit -m "fix(server): transactional confirm and drains; live dashboard counts"
```

---

## Edge-case coverage map

| Case                                                              | Test                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| Confirm relink fails → reassign + claim roll back (no torn write) | Task 1 Step 1                                          |
| Dashboard count drops when a flagged face settles via a verdict   | Task 1 Step 2                                          |
| Drains atomic (drain rolls back with its move/lock/detach)        | Task 3 cleanup suite (behaviour preserved, now in-trx) |
| R4: rolled-back claim leaves the row pending (strictly safer)     | Task 1 Step 1 second assertion (verdict still pending) |

## Self-review (author)

- **Spec coverage:** D14 (confirm transaction + in-trx drains for executeRepair AND resolveFaces's buckets, incl. the newly-found unwrapped lock bucket) and D12 (live counts via option a) each have a task + red-first test. ✅
- **Placeholder scan:** the trx wrap, the five `db`-param additions, the per-bucket drains, and the count-recompute (reusing the named `getPersonFlaggedFaces` pattern) are concrete. The `stay`-bucket drain is a "confirm current semantics" note (preserve existing) — not a placeholder. ⚠️ flag for plan review.
- **Type consistency:** the `db: Kysely<DB> | Transaction<DB> = this.db` param is identical across the five methods; `trx` threaded consistently. ✅
- **Scope:** no verdict-write-shape or read-gate changes; the lock-bucket transaction is in-scope (it's a D14-class torn-pair the drain-inside-trx work necessarily touches). ✅
- **R2:** resolved to option (a) by the digest's measurement (one batched query/poll vs (b)'s many verdict-write hooks) — documented, no fallback implemented.
