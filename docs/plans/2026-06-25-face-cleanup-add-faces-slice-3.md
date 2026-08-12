# Face Cleanup — Add Faces — Slice 3 (service: manual move in applyRepair) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement the `manualMove` behaviour in `FaceRepairService.applyRepair` — guard reorder (409 guards
before the empty-`approvedPersonIds` early-return), self-move rejection, `entireCluster` enumeration, merge of
flagged + manual faces into **one** `executeRepair` call, batched `manual` identity writes (E20), and
auto-delete + console-drop of an emptied source.

**Architecture:** Two changes to `face-repair.service.ts`. (1) Batch the identity writes: add a chunked
`replaceFaceIdentities` to `FaceIdentityRepository` (mirroring the proven `linkPersonFaces` upsert) and switch
`executeRepair`'s per-face loop to it — one statement per route instead of N. (2) Rework `applyRepair` to run
the 409 guards first, build the flagged plan only when needed, resolve the manual face set (explicit ids or a
whole-cluster `streamEligibleFaces` enumeration, `entireCluster` superseding `faceIds`), merge both into a single
`RepairPlan`, run `executeRepair` once, then count the source's remaining eligible faces to drive console-drop
(both named + unnamed) and auto-delete (unnamed only).

**Tech Stack:** NestJS service, Kysely (chunked multi-row insert…onConflict), Vitest unit (`newTestService`,
`vi.spyOn` on `buildRepairPlan`/`executeRepair`, async-generator mock for `streamEligibleFaces`).

**Spec:** [`2026-06-25-face-cleanup-add-faces-design.md`](2026-06-25-face-cleanup-add-faces-design.md) — Slice 3;
Architecture §Server.2; edge cases E4, E5, E6, E8, E9, E10, E11, E12, E18, E19, E20.

## Global Constraints

- `src/` path alias only; Kysely; `no-floating-promises`/`no-misused-promises` enforced (await every DB call).
- Unnamed = blank `person.name` (empty/whitespace string, **never NULL** — `default: ''`). Auto-delete only when
  the emptied source is unnamed; console-drop (snapshot removal) for both named and unnamed.
- Reuse `executeRepair` for the actual move — it owns the still-on-source re-check, destination-exists check,
  `manual` identity link, representative reconcile, and thumbnail queue. Do NOT duplicate that logic.
- `entireCluster` **supersedes** `faceIds`. Self-move (`destinationPersonId === personId`) is a 400.
- Guards (`FacialRecognition` active, scan pending/running → `ConflictException`) run **before** any early-return,
  so an entire-cluster move (empty `approvedPersonIds`) is still guarded. `buildRepairPlan` runs **only** when
  `approvedPersonIds` is non-empty.
- The behaviour's real-DB durability (still-on-source dedup E6/E9, eligibility filtering of stray ids E8,
  destination-deleted skip E7, multi-row identity upsert correctness E20) is proven by Slice 4 medium tests; this
  slice's unit tests use `vi.spyOn(sut,'executeRepair')` to isolate `applyRepair`'s orchestration.
- Formatting/lint: Prettier; full ESLint deferred to Slice 7; per-commit `tsc --noEmit` + prettier clean.

---

## File Structure

- Modify: `server/src/repositories/face-identity.repository.ts` — add `replaceFaceIdentities`.
- Modify: `server/src/services/face-repair.service.ts` — switch `executeRepair` to the batch write; rework
  `applyRepair`; add a private `collectClusterFaceIds` helper.
- Modify: `server/src/services/face-repair.apply.spec.ts` — update the `executeRepair` identity-write assertion;
  add the `applyRepair` `manualMove` unit tests.

---

## Task 1: Batch the `manual` identity writes (E20)

**Files:**

- Modify: `server/src/repositories/face-identity.repository.ts`
- Modify: `server/src/services/face-repair.service.ts` (`executeRepair`)
- Test: `server/src/services/face-repair.apply.spec.ts` (update the existing `executeRepair` test)

**Interfaces:**

- Produces: `FaceIdentityRepository.replaceFaceIdentities(input: { assetFaceIds: string[]; identityId: string;
source: FaceIdentityFaceSource; confidence?: number | null }): Promise<void>` — chunked multi-row upsert.

- [ ] **Step 1: Update the existing `executeRepair` test to expect the batch call**

In `server/src/services/face-repair.apply.spec.ts`, the test `'direct-assigns each flagged face to its
suspected owner with a manual identity link'` currently asserts two per-face `replaceFaceIdentity` calls
(lines ~97-106). Replace those two `expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith(...)`
assertions with a single batch assertion:

```ts
expect(mocks.faceIdentity.replaceFaceIdentities).toHaveBeenCalledWith({
  assetFaceIds: ['f1', 'f2'],
  identityId: 'identQ',
  source: 'manual',
});
```

(Leave the rest of that test — `reattributeFaces` call, `queueAll` not called, `moved: 2` — unchanged. Leave the
other `executeRepair` tests unchanged.)

- [ ] **Step 2: Run to verify red**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/services/face-repair.apply.spec.ts -t "direct-assigns"`
Expected: FAIL — `executeRepair` still calls `replaceFaceIdentity` (per-face), so `replaceFaceIdentities` was
never called.

- [ ] **Step 3: Add `replaceFaceIdentities` to the repository**

In `server/src/repositories/face-identity.repository.ts`, add this method next to `replaceFaceIdentity`
(after it, ~line 2188). `FaceIdentityFaceSource` is already imported (line 15):

```ts
  async replaceFaceIdentities(input: {
    assetFaceIds: string[];
    identityId: string;
    source: FaceIdentityFaceSource;
    confidence?: number | null;
  }): Promise<void> {
    if (input.assetFaceIds.length === 0) {
      return;
    }
    for (let index = 0; index < input.assetFaceIds.length; index += 1000) {
      const chunk = input.assetFaceIds.slice(index, index + 1000);
      await this.db
        .insertInto('face_identity_face')
        .values(
          chunk.map((assetFaceId) => ({
            assetFaceId,
            identityId: input.identityId,
            source: input.source,
            confidence: input.confidence ?? null,
          })),
        )
        .onConflict((oc) =>
          oc.column('assetFaceId').doUpdateSet({
            identityId: input.identityId,
            source: input.source,
            confidence: input.confidence ?? null,
          }),
        )
        .execute();
    }
  }
```

> This mirrors `linkPersonFaces`'s insert + `onConflict('assetFaceId').doUpdateSet(fixed values)` (a proven
> upsert in this file) and the 1000-row chunking used by `addPendingSharedSpaceFaceMatchBackfillTargets`. All
> faces in one `executeRepair` route share the same destination identity + `manual` source, so fixed
> `doUpdateSet` values are correct (no `excluded.*` ref needed).

- [ ] **Step 4: Switch `executeRepair` to the batch write**

In `server/src/services/face-repair.service.ts`, replace the per-face loop in `executeRepair` (currently
~lines 201-208):

```ts
const identity = await this.faceIdentityRepository.ensurePersonIdentity(to);
for (const assetFaceId of movedIds) {
  await this.faceIdentityRepository.replaceFaceIdentity({
    assetFaceId,
    identityId: identity.id,
    source: 'manual',
  });
}
```

with:

```ts
const identity = await this.faceIdentityRepository.ensurePersonIdentity(to);
await this.faceIdentityRepository.replaceFaceIdentities({
  assetFaceIds: movedIds,
  identityId: identity.id,
  source: 'manual',
});
```

- [ ] **Step 5: Run to verify green**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/services/face-repair.apply.spec.ts`
Expected: PASS (the updated `executeRepair` test + all other cases). Also confirm no other unit test asserts the
old per-face call: `grep -rn "replaceFaceIdentity\b" server/src/services/*.spec.ts` should show no remaining
`executeRepair`-related per-face assertion (the only match should be the one you just changed, now using
`replaceFaceIdentities`).

- [ ] **Step 6: Type-check + format**

Run: `cd server && npx tsc --noEmit` → exit 0.
Run: `cd .. && npx prettier --check server/src/repositories/face-identity.repository.ts server/src/services/face-repair.service.ts server/src/services/face-repair.apply.spec.ts` (write + re-run if needed).

- [ ] **Step 7: Commit**

```bash
git add server/src/repositories/face-identity.repository.ts server/src/services/face-repair.service.ts server/src/services/face-repair.apply.spec.ts
git commit -m "perf(server): batch manual identity writes in executeRepair (E20)"
```

---

## Task 2: `manualMove` in `applyRepair` — guards, enumeration, merge, auto-delete (TDD)

**Files:**

- Modify: `server/src/services/face-repair.service.ts` (`applyRepair` + a private `collectClusterFaceIds`)
- Test: `server/src/services/face-repair.apply.spec.ts` (add to the `describe('applyRepair')` block)

**Interfaces:**

- Consumes: `executeRepair` (Task 1), `buildRepairPlan`, `resolvePlanParams`, `jobRepository.isActive`,
  `faceRepairScanRepository.{failStaleScans,getLatestScan,removePersonsFromLatestScan}`,
  `faceRepairRepository.{streamEligibleFaces,countEligibleFaces}`, `personRepository.{getById,delete}`.
- Produces: `applyRepair` now accepts `input.manualMove?: { personId; destinationPersonId; faceIds?;
entireCluster? }` and performs the manual move per the spec.

- [ ] **Step 1: Write the failing tests**

Add `BadRequestException` to the `@nestjs/common` import at the top of
`server/src/services/face-repair.apply.spec.ts`:

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
```

Append these tests **inside** the existing `describe('applyRepair', () => { … })` block (after the current
cases, before its closing `});`):

```ts
it('rejects a self-move (destination === source) with BadRequestException (E18)', async () => {
  await expect(
    sut.applyRepair({
      approvedPersonIds: [],
      manualMove: { personId: 'p1', destinationPersonId: 'p1', entireCluster: true },
    }),
  ).rejects.toThrow(BadRequestException);
  expect(mocks.job.isActive).not.toHaveBeenCalled();
});

it('entire-cluster (empty approvedPersonIds): still runs the 409 guard (E10)', async () => {
  mocks.job.isActive.mockResolvedValue(true);
  await expect(
    sut.applyRepair({
      approvedPersonIds: [],
      manualMove: { personId: 'p1', destinationPersonId: 'q', entireCluster: true },
    }),
  ).rejects.toThrow(ConflictException);
});

it('entire-cluster: enumerates eligible faces → routes all to destination; no flagged plan built (E4)', async () => {
  mocks.faceRepair.streamEligibleFaces.mockReturnValue(
    (async function* () {
      yield { assetFaceId: 'a', personId: 'p1', ownerId: 'o', embedding: '' };
      yield { assetFaceId: 'b', personId: 'p1', ownerId: 'o', embedding: '' };
    })(),
  );
  const planSpy = vi.spyOn(sut, 'buildRepairPlan');
  const execSpy = vi.spyOn(sut, 'executeRepair').mockResolvedValue({ moved: 2, skipped: 0 });
  mocks.faceRepair.countEligibleFaces.mockResolvedValue(0);
  mocks.person.getById.mockResolvedValue({ id: 'p1', name: '' } as any);

  const r = await sut.applyRepair({
    approvedPersonIds: [],
    manualMove: { personId: 'p1', destinationPersonId: 'q', entireCluster: true },
  });

  expect(planSpy).not.toHaveBeenCalled();
  expect(execSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      toRepair: [
        { assetFaceId: 'a', currentPersonId: 'p1', suspectedOwnerId: 'q' },
        { assetFaceId: 'b', currentPersonId: 'p1', suspectedOwnerId: 'q' },
      ],
    }),
  );
  expect(r).toEqual({ moved: 2, skipped: 0 });
});

it('entireCluster supersedes faceIds when both are supplied (E19)', async () => {
  mocks.faceRepair.streamEligibleFaces.mockReturnValue(
    (async function* () {
      yield { assetFaceId: 'a', personId: 'p1', ownerId: 'o', embedding: '' };
    })(),
  );
  const execSpy = vi.spyOn(sut, 'executeRepair').mockResolvedValue({ moved: 1, skipped: 0 });
  mocks.faceRepair.countEligibleFaces.mockResolvedValue(0);
  mocks.person.getById.mockResolvedValue({ id: 'p1', name: '' } as any);

  await sut.applyRepair({
    approvedPersonIds: [],
    manualMove: { personId: 'p1', destinationPersonId: 'q', faceIds: ['ignored'], entireCluster: true },
  });

  expect(execSpy.mock.calls[0][0].toRepair).toEqual([
    { assetFaceId: 'a', currentPersonId: 'p1', suspectedOwnerId: 'q' },
  ]);
});

it('partial add: merges flagged (→ suspects) and manual picks (→ primary) into one executeRepair (E5)', async () => {
  mocks.faceRepairScan.getLatestScan.mockResolvedValue({ status: 'completed' } as any);
  vi.spyOn(sut, 'buildRepairPlan').mockResolvedValue(
    plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'qsuspect' }]),
  );
  const execSpy = vi.spyOn(sut, 'executeRepair').mockResolvedValue({ moved: 2, skipped: 0 });
  mocks.faceRepair.countEligibleFaces.mockResolvedValue(5);

  await sut.applyRepair({
    approvedPersonIds: ['p1'],
    manualMove: { personId: 'p1', destinationPersonId: 'primary', faceIds: ['m1'] },
  });

  expect(execSpy).toHaveBeenCalledTimes(1);
  expect(execSpy.mock.calls[0][0].toRepair).toEqual([
    { assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'qsuspect' },
    { assetFaceId: 'm1', currentPersonId: 'p1', suspectedOwnerId: 'primary' },
  ]);
  expect(mocks.person.delete).not.toHaveBeenCalled(); // source survives (E5)
});

it('auto-deletes an emptied UNNAMED source and drops it from the snapshot (E4)', async () => {
  mocks.faceRepair.streamEligibleFaces.mockReturnValue(
    (async function* () {
      yield { assetFaceId: 'a', personId: 'p1', ownerId: 'o', embedding: '' };
    })(),
  );
  vi.spyOn(sut, 'executeRepair').mockResolvedValue({ moved: 1, skipped: 0 });
  mocks.faceRepair.countEligibleFaces.mockResolvedValue(0);
  mocks.person.getById.mockResolvedValue({ id: 'p1', name: '' } as any);

  await sut.applyRepair({
    approvedPersonIds: [],
    manualMove: { personId: 'p1', destinationPersonId: 'q', entireCluster: true },
  });

  expect(mocks.person.delete).toHaveBeenCalledWith(['p1']);
  expect(mocks.faceRepairScan.removePersonsFromLatestScan).toHaveBeenCalledWith(['p1']);
});

it('keeps an emptied NAMED source (not deleted) but still drops it from the snapshot (E12)', async () => {
  mocks.faceRepair.streamEligibleFaces.mockReturnValue(
    (async function* () {
      yield { assetFaceId: 'a', personId: 'p1', ownerId: 'o', embedding: '' };
    })(),
  );
  vi.spyOn(sut, 'executeRepair').mockResolvedValue({ moved: 1, skipped: 0 });
  mocks.faceRepair.countEligibleFaces.mockResolvedValue(0);
  mocks.person.getById.mockResolvedValue({ id: 'p1', name: 'Pierre' } as any);

  await sut.applyRepair({
    approvedPersonIds: [],
    manualMove: { personId: 'p1', destinationPersonId: 'q', entireCluster: true },
  });

  expect(mocks.person.delete).not.toHaveBeenCalled();
  expect(mocks.faceRepairScan.removePersonsFromLatestScan).toHaveBeenCalledWith(['p1']);
});

it('empty manualMove (no faceIds, entireCluster false) + empty approvedPersonIds → no-op, no guards (E11)', async () => {
  const r = await sut.applyRepair({
    approvedPersonIds: [],
    manualMove: { personId: 'p1', destinationPersonId: 'q' },
  });
  expect(r).toEqual({ moved: 0, skipped: 0 });
  expect(mocks.job.isActive).not.toHaveBeenCalled();
});

it('idempotency: person in approvedPersonIds AND entireCluster passes both sets to one executeRepair (E9)', async () => {
  mocks.faceRepairScan.getLatestScan.mockResolvedValue({ status: 'completed' } as any);
  vi.spyOn(sut, 'buildRepairPlan').mockResolvedValue(
    plan([{ assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'qsuspect' }]),
  );
  mocks.faceRepair.streamEligibleFaces.mockReturnValue(
    (async function* () {
      yield { assetFaceId: 'f1', personId: 'p1', ownerId: 'o', embedding: '' };
      yield { assetFaceId: 'f2', personId: 'p1', ownerId: 'o', embedding: '' };
    })(),
  );
  const execSpy = vi.spyOn(sut, 'executeRepair').mockResolvedValue({ moved: 2, skipped: 0 });
  mocks.faceRepair.countEligibleFaces.mockResolvedValue(0);
  mocks.person.getById.mockResolvedValue({ id: 'p1', name: '' } as any);

  await sut.applyRepair({
    approvedPersonIds: ['p1'],
    manualMove: { personId: 'p1', destinationPersonId: 'q', entireCluster: true },
  });

  // applyRepair passes both sets to ONE executeRepair; the still-on-source re-check (real DB, Slice 4)
  // makes the duplicate f1 a no-op so it moves once.
  expect(execSpy).toHaveBeenCalledTimes(1);
  expect(execSpy.mock.calls[0][0].toRepair).toEqual([
    { assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'qsuspect' },
    { assetFaceId: 'f1', currentPersonId: 'p1', suspectedOwnerId: 'q' },
    { assetFaceId: 'f2', currentPersonId: 'p1', suspectedOwnerId: 'q' },
  ]);
});
```

- [ ] **Step 2: Run to verify red**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/services/face-repair.apply.spec.ts -t applyRepair`
Expected: FAIL — `applyRepair` does not yet accept/handle `manualMove` (self-move not rejected; entire-cluster
not enumerated; person.delete / removePersonsFromLatestScan for the manual source not called). The pre-existing
applyRepair cases still pass.

- [ ] **Step 3: Implement the manual move in `applyRepair`**

In `server/src/services/face-repair.service.ts`:

1. Add `BadRequestException` to the `@nestjs/common` import (currently `ConflictException, Injectable`):

```ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
```

2. Replace the entire `applyRepair` method with:

```ts
  async applyRepair(input: {
    approvedPersonIds: string[];
    excludeFaceIds?: string[];
    manualMove?: { personId: string; destinationPersonId: string; faceIds?: string[]; entireCluster?: boolean };
  }): Promise<RepairExecution> {
    const manualMove = input.manualMove;
    if (manualMove && manualMove.destinationPersonId === manualMove.personId) {
      throw new BadRequestException('Cannot move a cluster into itself');
    }

    const hasManualWork =
      !!manualMove && (manualMove.entireCluster === true || (manualMove.faceIds?.length ?? 0) > 0);
    const hasFlagged = input.approvedPersonIds.length > 0;
    if (!hasFlagged && !hasManualWork) {
      return { moved: 0, skipped: 0 };
    }

    if (await this.jobRepository.isActive(QueueName.FacialRecognition)) {
      throw new ConflictException('Refusing to apply while facial recognition is active');
    }
    await this.faceRepairScanRepository.failStaleScans(STALE_SCAN_TIMEOUT_MS);
    const latest = await this.faceRepairScanRepository.getLatestScan();
    if (latest && (latest.status === 'pending' || latest.status === 'running')) {
      throw new ConflictException('Refusing to apply while a scan is in progress');
    }

    const toRepair: FlaggedFace[] = [];
    if (hasFlagged) {
      const plan = await this.buildRepairPlan({
        ...(await this.resolvePlanParams(latest)),
        personIds: input.approvedPersonIds,
        approvedPersonIds: input.approvedPersonIds,
      });
      const exclude = new Set(input.excludeFaceIds);
      for (const face of plan.toRepair) {
        if (!exclude.has(face.assetFaceId)) {
          toRepair.push(face);
        }
      }
    }

    if (hasManualWork && manualMove) {
      const manualFaceIds = manualMove.entireCluster
        ? await this.collectClusterFaceIds(manualMove.personId)
        : (manualMove.faceIds ?? []);
      for (const assetFaceId of manualFaceIds) {
        toRepair.push({
          assetFaceId,
          currentPersonId: manualMove.personId,
          suspectedOwnerId: manualMove.destinationPersonId,
        });
      }
    }

    const result = await this.executeRepair({
      toRepair,
      reviewOnlyFaces: [],
      reviewOnlyPersonIds: [],
      unAttributableFaces: [],
      perPerson: [],
    });

    if (result.moved > 0) {
      const personsToDrop = new Set(input.approvedPersonIds);
      if (hasManualWork && manualMove) {
        const remaining = await this.faceRepairRepository.countEligibleFaces({ personId: manualMove.personId });
        if (remaining === 0) {
          personsToDrop.add(manualMove.personId);
          const source = await this.personRepository.getById(manualMove.personId);
          if (source && (!source.name || source.name.trim().length === 0)) {
            await this.personRepository.delete([manualMove.personId]);
          }
        }
      }
      if (personsToDrop.size > 0) {
        await this.faceRepairScanRepository.removePersonsFromLatestScan([...personsToDrop]);
      }
    }

    return result;
  }

  private async collectClusterFaceIds(personId: string): Promise<string[]> {
    const ids: string[] = [];
    for await (const row of this.faceRepairRepository.streamEligibleFaces({ personId })) {
      ids.push(row.assetFaceId);
    }
    return ids;
  }
```

> Notes: the self-move guard is checked before the nothing-to-do return so it always 400s. The nothing-to-do
> return preserves the legacy "empty `approvedPersonIds` → `{0,0}`, no guards" behaviour (existing test). Guards
> now precede `buildRepairPlan`, which runs only when `approvedPersonIds` is non-empty. `personRepository`,
> `jobRepository`, `faceRepairScanRepository`, `faceRepairRepository` are the existing injected accessors used
> elsewhere in this service.

- [ ] **Step 4: Run to verify green**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/services/face-repair.apply.spec.ts`
Expected: PASS — the new `manualMove` cases **and** every pre-existing `applyRepair`/`executeRepair` case.

- [ ] **Step 5: Type-check + format**

Run: `cd server && npx tsc --noEmit` → exit 0.
Run: `cd .. && npx prettier --check server/src/services/face-repair.service.ts server/src/services/face-repair.apply.spec.ts` (write + re-run if needed).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/face-repair.service.ts server/src/services/face-repair.apply.spec.ts
git commit -m "feat(server): manual move (faces + entire cluster) in face-repair applyRepair"
```

---

## Self-Review

- **Spec coverage (Slice 3):** batched identity writes (Task 1) → E20; self-move reject → E18; guard-before-early
  -return for entire-cluster → E10; entire-cluster enumeration → E4; `entireCluster` supersedes `faceIds` → E19;
  partial-add merge + source survives → E5; auto-delete unnamed + snapshot-drop → E4; named kept + snapshot-drop
  → E12; empty manualMove no-op → E11; idempotency union into one executeRepair → E9. E6/E7/E8 (still-on-source,
  destination-deleted, stray ids) are executeRepair/real-DB concerns proven in Slice 4 medium — noted, not
  duplicated here.
- **Placeholders:** none — full method bodies + full tests + exact commands.
- **Type consistency:** `manualMove` shape matches the Slice 2 DTO exactly. `replaceFaceIdentities` input
  `{ assetFaceIds, identityId, source, confidence? }` is identical in the repo method, the executeRepair call,
  and the updated unit assertion. `collectClusterFaceIds` returns `string[]` consumed as `FlaggedFace.assetFaceId`.
- **Existing behaviour preserved:** all current `applyRepair`/`executeRepair` unit tests remain valid — the only
  changed assertion is the per-face→batch identity write (Task 1, Step 1); the guard-reorder keeps the
  "empty approvedPersonIds → no-op, no guards" path intact.
- **Carry-forward to Slice 4:** medium tests exercise the real `streamEligibleFaces` enumeration,
  `reattributeFaces` still-on-source dedup (E6/E9), destination-deleted skip (E7), stray-id filtering (E8),
  `replaceFaceIdentities` multi-row upsert (E20 correctness), and the real auto-delete/snapshot-drop end state.
