# Face re-attribution repair — Slice 4 (Repair action + invariants) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> Strict TDD: failing test first, RUN it (capture red), minimal impl, RUN green. Report red+green output.
> This slice MUTATES face assignments — correctness is paramount. Build on Slices 1–3
> (`buildRepairPlan`, `RepairPlan`, `FlaggedFace`). Do NOT implement Slice 5+ (report DTO, endpoint, chunking).

**Goal:** Execute a `RepairPlan`: unassign the `toRepair` faces (`personId = NULL`) with an eligibility re-check,
clear their corrupt `face_identity_face` links, reconcile any dangling `person.faceAssetId`, and queue
FacialRecognition to re-home them — leaving **no `personId`↔identity mismatch** (the #652 infinite-loop trap).

**Architecture:** Two new `FaceRepairRepository` methods (per-person unassign with eligibility re-check +
RETURNING; rep-face reconcile) + a `FaceRepairService.executeRepair(plan)` that orchestrates them, reuses
`faceIdentityRepository.unlinkFaces` and `jobRepository.queueAll`. The actual re-homing (recognition running on the
unassigned faces) is verified end-to-end in Slice 8; this slice verifies the repair leaves a **clean** state
(`getBackfillWork().hasPersonalIdentityWork === false`) and queues recognition.

**Key facts (verified):** `person` has NO stored counts (`getStatistics` computes on read) — only `faceAssetId`
can dangle. `getBackfillWork` (`face-identity.repository.ts:408`) flags personal work only for **assigned** faces
(`personId NOT NULL`) with a missing/mismatched link, or a person with `identityId IS NULL` — so an
unassigned+unlinked face is NOT work. `faceIdentityRepository.unlinkFaces(assetFaceIds)` deletes links. The
per-person contamination cap (Slice 3) guarantees a repaired person always retains faces, so rep-face reconcile
always finds a remaining face.

**Read first:** `src/services/face-repair.service.ts` (`buildRepairPlan`, `RepairPlan`, `FlaggedFace`),
`src/repositories/face-repair.repository.ts`, `src/repositories/face-identity.repository.ts:2073` (`unlinkFaces`)
and `:408` (`getBackfillWork`), `src/enum.ts` (`JobName.FacialRecognition`, `SourceType`), and how `BaseService`
exposes `jobRepository` / `faceIdentityRepository`.

---

### Task 1: Repository mutators (`unassignFacesFromPerson`, `reconcileRepresentativeFaces`)

**Files:** Modify `server/src/repositories/face-repair.repository.ts`; Modify
`server/test/medium/specs/repositories/face-repair.repository.spec.ts`.

- [ ] **Step 1: Write the failing medium tests.**
  - **unassignFacesFromPerson:** person `P` with 3 ML faces (a,b,c). `unassignFacesFromPerson(P, [a, b])` sets
    `a.personId` and `b.personId` to NULL and **returns `[a, b]`**; `c` is untouched. **Eligibility re-check:** call
    `unassignFacesFromPerson(P, [x])` where `x.personId` is some OTHER person `Q` (not `P`) → returns `[]` and `x`
    is untouched (we only unassign faces still on the planned person). Also a `manual`-sourced face on `P` passed in
    → not unassigned (returns without it).
  - **reconcileRepresentativeFaces:** person `P` with faces a,b; `P.faceAssetId = a`. Unassign `a` (set its
    personId NULL via raw update). `reconcileRepresentativeFaces([P])` sets `P.faceAssetId` to `b` (a remaining
    assigned visible face), NOT `a`. A person whose `faceAssetId` still points to one of its own faces is left
    unchanged.

- [ ] **Step 2: Run, confirm red** — `cd server && pnpm test:medium run test/medium/specs/repositories/face-repair.repository.spec.ts` → FAIL (methods missing).

- [ ] **Step 3: Implement** (add to `FaceRepairRepository`):

```typescript
// Unassign the given faces ONLY if still assigned to `personId` and machine-learning-sourced (eligibility
// re-check at write — a face moved by a concurrent job since planning is skipped). Returns the ids actually
// unassigned (so the caller unlinks/queues exactly those).
async unassignFacesFromPerson(personId: string, assetFaceIds: string[]): Promise<string[]> {
  if (assetFaceIds.length === 0) {
    return [];
  }
  const rows = await this.db
    .updateTable('asset_face')
    .set({ personId: null })
    .where('id', 'in', assetFaceIds)
    .where('personId', '=', personId)
    .where('sourceType', '=', sql.lit(SourceType.MachineLearning))
    .where('deletedAt', 'is', null)
    .where('isVisible', '=', true)
    .returning('id')
    .execute();
  return rows.map((row) => row.id);
}

// Repoint any dangling representative face: if a person's faceAssetId no longer belongs to it (or is null),
// reset it to any remaining assigned, visible, non-deleted face (or null if none remain).
async reconcileRepresentativeFaces(personIds: string[]): Promise<void> {
  if (personIds.length === 0) {
    return;
  }
  await sql`
    UPDATE person SET "faceAssetId" = (
      SELECT remaining.id FROM asset_face AS remaining
      INNER JOIN asset ON asset.id = remaining."assetId"
      WHERE remaining."personId" = person.id
        AND remaining."deletedAt" IS NULL AND remaining."isVisible" = true AND asset."deletedAt" IS NULL
      LIMIT 1
    )
    WHERE person.id IN (${sql.join(personIds)})
      AND (
        person."faceAssetId" IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM asset_face AS current
          WHERE current.id = person."faceAssetId" AND current."personId" = person.id
        )
      )
  `.execute(this.db);
}
```

(Import `SourceType` from `src/enum` if not already.)

- [ ] **Step 4: Run, confirm green** — same command → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(server): face-repair unassign + representative-face reconcile"`

---

### Task 2: `FaceRepairService.executeRepair`

**Files:** Modify `server/src/services/face-repair.service.ts`; Modify
`server/test/medium/specs/services/face-repair.service.spec.ts`.

- [ ] **Step 1: Write the failing medium tests.** Setup must establish a **consistent identity baseline** so
      `getBackfillWork` is meaningful: for every person give it an identity (`faceIdentityRepository.ensurePersonIdentity`)
      and link every face (`faceIdentityRepository.linkFace({ assetFaceId, identityId, source: 'owner-person' })`).
      Build Karina-main (10 `first`-axis faces) + Alexia (8 `second`-axis genuine + 3 leaked `first`-axis faces). Use
      `buildRepairPlan(params)` then `executeRepair(plan)`. Get the `JobRepository` mock via
      `ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository)`.
      Assertions:
  - the 3 leaked faces now have `personId = NULL`, and `face_identity_face` rows for them are deleted;
  - the genuine Alexia + Karina faces are untouched (still assigned + linked);
  - `jobRepository.queueAll` was called with `JobName.FacialRecognition` items for exactly the 3 unassigned ids;
  - **no-loop invariant:** `faceIdentityRepository.getBackfillWork()` returns `hasPersonalIdentityWork === false`
    after `executeRepair` (the unassigned+unlinked faces are not work; everything else stays consistent). Confirm
    the baseline (before repair) is also `false`, so the test pins that the repair doesn't _introduce_ work;
  - **review-only untouched:** put Alexia over the cap in a second scenario (so she's review-only); assert her
    faces keep their `personId` and links after `executeRepair` (nothing in `toRepair`);
  - **rep-face reconcile:** set `Alexia.faceAssetId` to one of the leaked faces before repair; after
    `executeRepair`, `Alexia.faceAssetId` is a remaining genuine Alexia face, not the unassigned leaked one;
  - **eligibility re-check:** in a scenario, after `buildRepairPlan` but before `executeRepair`, move one leaked
    face to a third person `Z` (`personId = Z`); after `executeRepair` that face is still on `Z` (skipped), and no
    recognition job was queued for it.

- [ ] **Step 2: Run, confirm red** — `cd server && pnpm test:medium run test/medium/specs/services/face-repair.service.spec.ts` → FAIL (`executeRepair` not a function).

- [ ] **Step 3: Implement** (add to `FaceRepairService`):

```typescript
import { JobName } from 'src/enum';

// in the class:
async executeRepair(plan: RepairPlan): Promise<{ unassigned: number; requeued: number }> {
  const byPerson = new Map<string, string[]>();
  for (const face of plan.toRepair) {
    const list = byPerson.get(face.currentPersonId) ?? [];
    list.push(face.assetFaceId);
    byPerson.set(face.currentPersonId, list);
  }

  const unassignedIds: string[] = [];
  for (const [personId, assetFaceIds] of byPerson) {
    const ids = await this.faceRepairRepository.unassignFacesFromPerson(personId, assetFaceIds);
    unassignedIds.push(...ids);
  }

  if (unassignedIds.length === 0) {
    return { unassigned: 0, requeued: 0 };
  }

  await this.faceIdentityRepository.unlinkFaces(unassignedIds);
  await this.faceRepairRepository.reconcileRepresentativeFaces([...byPerson.keys()]);
  await this.jobRepository.queueAll(
    unassignedIds.map((id) => ({ name: JobName.FacialRecognition, data: { id, deferred: false } })),
  );

  return { unassigned: unassignedIds.length, requeued: unassignedIds.length };
}
```

Confirm the `JobName.FacialRecognition` data shape matches `JobOf<JobName.FacialRecognition>` (it needs `id` and
`deferred`; include `skipSharedSpaceMatch` only if the type requires it — check `handleRecognizeFaces`'s `JobOf`).
`unlinkFaces`/`getBackfillWork` live on `faceIdentityRepository`; `queueAll` on `jobRepository` — both on
`BaseService`.

- [ ] **Step 4: Run, confirm green** — same command → PASS.
- [ ] **Step 5: Validate + commit** — `cd server && pnpm exec prettier --write <changed> && pnpm exec eslint <changed> --max-warnings 0 && pnpm exec tsc --noEmit`; `git add -A && git commit -m "feat(server): execute face re-attribution repair (unassign + re-home)"`.

---

## Self-review

- Slice-4 matrix rows: unassign + link cleared ✓ (T2); faceAssetId reconciled incl. rep-was-unassigned ✓ (T1, T2);
  no-loop / no mismatch (getBackfillWork) ✓ (T2); review-only untouched ✓ (T2); eligibility re-check at write ✓
  (T1, T2). Sub-`minFaces`-stays-unassigned, leak-re-homes-to-Karina, no-re-corruption, multi-owner split, and the
  shared-space projection check are **driven through real recognition** → Slice 8 (they need PersonService /
  recognition running, out of scope here). Counts reconcile = N/A (computed on read). No report DTO / endpoint /
  chunking (Slices 5–7). Types consistent (`RepairPlan`, `FlaggedFace`). No placeholders.
- Note in the slice PR description: this slice queues recognition but does not itself run it; the re-home +
  post-re-home no-loop assertion is Slice 8.
