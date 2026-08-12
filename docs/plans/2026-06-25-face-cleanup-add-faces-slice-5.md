# Face Cleanup — Add Faces — Slice 5 (web view-model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the review-screen view-model (`review.svelte.ts`) with manual-selection state
(`manualSelected`, `entireCluster`, `clusterTotal`), the matching mutators, an extended `movingCount`, and a
pure `applyPayload()` builder — all unit-tested in isolation from the Svelte component.

**Architecture:** Additive extension of the existing `createReviewModel(flaggedFaces)` factory — same signature,
new members. `manualSelected` is a `SvelteSet`; `entireCluster`/`clusterTotal` are `$state` so the component
(Slice 6) reacts. `applyPayload({ personId, destinationPersonId })` returns the exact `@immich/sdk`
`FaceRepairApplyRequestDto` for the two cases (entire-cluster vs partial), so the payload can never drift from
what `applyFaceRepair` accepts. No component changes in this slice.

**Tech Stack:** Svelte 5 runes (`$state`) + `SvelteSet` in a `.svelte.ts` module; Vitest unit tests of the
factory in isolation (no component render).

**Spec:** [`2026-06-25-face-cleanup-add-faces-design.md`](2026-06-25-face-cleanup-add-faces-design.md) — Slice 5;
Architecture §Web (View model); edge case E15 (+ the E17 null-destination guard at the payload level).

## Global Constraints

- Keep `createReviewModel(flaggedFaces: FlaggedFace[])`'s signature unchanged (the existing component + the
  existing tests call it with just `flaggedFaces`). Add members only.
- `manualSelected` uses `SvelteSet<string>` (reactive collection, like `excluded`/`declined`).
  `entireCluster`/`clusterTotal` use `$state` so getters reading them re-run in the component.
- `applyPayload()` returns `FaceRepairApplyRequestDto` from `@immich/sdk` (type import) — entire-cluster →
  `{ approvedPersonIds: [], excludeFaceIds: [], manualMove: { personId, destinationPersonId, entireCluster: true } }`;
  partial → `{ approvedPersonIds: [personId], excludeFaceIds: [...excluded, ...declined], manualMove?:
{ personId, destinationPersonId, faceIds } }` (manualMove only when `manualSelected` non-empty AND a
  destination exists). `entireCluster` supersedes `faceIds`/picks (E15).
- `destinationPersonId` may be `null` (no primary owner / pruned snapshot — E17): in that case `applyPayload`
  emits NO `manualMove` (the component disables the manual actions; the payload fallback is the legacy body).
- Web formatting: Prettier; `make check-web` (svelte-check + tsc) clean. Full lint deferred to Slice 7.

---

## File Structure

- Modify: `web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts` — extend `ReviewModel` + factory.
- Modify: `web/src/routes/admin/face-cleanup/[personId]/review.spec.ts` — add the new unit tests.

---

## Task 1: Extend the view-model with manual state + `applyPayload` (TDD)

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts`
- Test: `web/src/routes/admin/face-cleanup/[personId]/review.spec.ts`

**Interfaces:**

- Produces (Slice 6 consumes): on `ReviewModel` — `readonly manualSelected: Set<string>`, `readonly
entireCluster: boolean`, `toggleManual(id)`, `isManualSelected(id)`, `selectAllLoaded(ids)`, `clearManual()`,
  `manualFaceIds()`, `setEntireCluster(on)`, `setClusterTotal(total)`, and `applyPayload({ personId,
destinationPersonId }): FaceRepairApplyRequestDto`. Extended `movingCount`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/routes/admin/face-cleanup/[personId]/review.spec.ts` (inside the existing
`describe('createReviewModel', …)` block, before its closing `});`):

```ts
it('toggleManual adds/removes a manual pick and movingCount includes it', () => {
  const vm = createReviewModel([{ assetFaceId: 'a' }]); // 1 flagged moving
  expect(vm.movingCount).toBe(1);
  vm.toggleManual('m1');
  expect(vm.isManualSelected('m1')).toBe(true);
  expect(vm.movingCount).toBe(2); // 1 flagged + 1 manual
  vm.toggleManual('m1');
  expect(vm.isManualSelected('m1')).toBe(false);
  expect(vm.movingCount).toBe(1);
});

it('selectAllLoaded unions the loaded ids; clearManual empties them', () => {
  const vm = createReviewModel([]);
  vm.toggleManual('m1');
  vm.selectAllLoaded(['m1', 'm2', 'm3']);
  expect(vm.manualFaceIds().toSorted()).toEqual(['m1', 'm2', 'm3']);
  vm.clearManual();
  expect(vm.manualFaceIds()).toEqual([]);
});

it('entire-cluster mode makes movingCount the cluster total and supersedes individual picks (E15)', () => {
  const vm = createReviewModel([{ assetFaceId: 'a' }, { assetFaceId: 'b' }]); // 2 flagged
  vm.selectAllLoaded(['m1', 'm2']); // 2 manual picks
  vm.setClusterTotal(50);
  vm.setEntireCluster(true);
  expect(vm.entireCluster).toBe(true);
  expect(vm.movingCount).toBe(50); // cluster total, not 2 + 2
});

it('applyPayload (partial add): approvedPersonIds + excludeFaceIds + manualMove.faceIds', () => {
  const vm = createReviewModel([{ assetFaceId: 'a' }, { assetFaceId: 'b' }]);
  vm.toggle('a'); // exclude a
  vm.markDeclined('b'); // decline b
  vm.selectAllLoaded(['m1', 'm2']);
  const payload = vm.applyPayload({ personId: 'p1', destinationPersonId: 'owner' });
  expect(payload.approvedPersonIds).toEqual(['p1']);
  expect([...(payload.excludeFaceIds ?? [])].toSorted()).toEqual(['a', 'b']);
  expect(payload.manualMove).toEqual({ personId: 'p1', destinationPersonId: 'owner', faceIds: ['m1', 'm2'] });
});

it('applyPayload (entire cluster): empty approvedPersonIds + manualMove.entireCluster, picks ignored', () => {
  const vm = createReviewModel([{ assetFaceId: 'a' }]);
  vm.selectAllLoaded(['m1']); // ignored in entire-cluster mode
  vm.setEntireCluster(true);
  const payload = vm.applyPayload({ personId: 'p1', destinationPersonId: 'owner' });
  expect(payload.approvedPersonIds).toEqual([]);
  expect(payload.manualMove).toEqual({ personId: 'p1', destinationPersonId: 'owner', entireCluster: true });
});

it('applyPayload (legacy flagged-only): no manualMove when nothing manual is selected', () => {
  const vm = createReviewModel([{ assetFaceId: 'a' }]);
  vm.toggle('a');
  const payload = vm.applyPayload({ personId: 'p1', destinationPersonId: 'owner' });
  expect(payload.approvedPersonIds).toEqual(['p1']);
  expect(payload.manualMove).toBeUndefined();
});

it('applyPayload: emits no manualMove when destinationPersonId is null (E17 guard)', () => {
  const vm = createReviewModel([{ assetFaceId: 'a' }]);
  vm.selectAllLoaded(['m1']);
  const payload = vm.applyPayload({ personId: 'p1', destinationPersonId: null });
  expect(payload.manualMove).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify red**

Run: `cd web && npx vitest --run src/routes/admin/face-cleanup/[personId]/review.spec.ts`
Expected: FAIL — `vm.toggleManual` / `vm.applyPayload` / `vm.setEntireCluster` etc. are not functions / not on
`ReviewModel`. (The pre-existing `createReviewModel` tests still pass.)

> If vitest cannot match the bracketed path, run the whole file set: `cd web && npx vitest --run review.spec`.

- [ ] **Step 3: Implement the extension**

Replace the contents of `web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts` with:

```ts
import type { FaceRepairApplyRequestDto } from '@immich/sdk';
import { SvelteSet } from 'svelte/reactivity';

export interface FlaggedFace {
  assetFaceId: string;
  suspectedOwnerId?: string;
}

export interface ReviewModel {
  readonly excluded: Set<string>;
  readonly declined: Set<string>;
  readonly manualSelected: Set<string>;
  readonly movingCount: number;
  readonly excludedCount: number;
  readonly entireCluster: boolean;
  toggle(assetFaceId: string): void;
  isExcluded(assetFaceId: string): boolean;
  excludeFaceIds(): string[];
  markDeclined(assetFaceId: string): void;
  unmarkDeclined(assetFaceId: string): void;
  isDeclined(assetFaceId: string): boolean;
  declinedFaceIds(): string[];
  toggleManual(assetFaceId: string): void;
  isManualSelected(assetFaceId: string): boolean;
  selectAllLoaded(assetFaceIds: string[]): void;
  clearManual(): void;
  manualFaceIds(): string[];
  setEntireCluster(on: boolean): void;
  setClusterTotal(total: number): void;
  applyPayload(input: { personId: string; destinationPersonId: string | null }): FaceRepairApplyRequestDto;
}

export function createReviewModel(flaggedFaces: FlaggedFace[]): ReviewModel {
  const excluded: SvelteSet<string> = new SvelteSet();
  const declined: SvelteSet<string> = new SvelteSet();
  const manualSelected: SvelteSet<string> = new SvelteSet();
  let entireCluster = $state(false);
  let clusterTotal = $state(0);

  const flaggedMovingCount = () =>
    flaggedFaces.filter((f) => !excluded.has(f.assetFaceId) && !declined.has(f.assetFaceId)).length;

  return {
    excluded,
    declined,
    manualSelected,

    get movingCount() {
      return entireCluster ? clusterTotal : flaggedMovingCount() + manualSelected.size;
    },

    get excludedCount() {
      return excluded.size;
    },

    get entireCluster() {
      return entireCluster;
    },

    toggle(assetFaceId: string): void {
      if (excluded.has(assetFaceId)) {
        excluded.delete(assetFaceId);
      } else {
        excluded.add(assetFaceId);
      }
    },

    isExcluded(assetFaceId: string): boolean {
      return excluded.has(assetFaceId);
    },

    excludeFaceIds(): string[] {
      return [...excluded];
    },

    markDeclined(assetFaceId: string): void {
      declined.add(assetFaceId);
    },

    unmarkDeclined(assetFaceId: string): void {
      declined.delete(assetFaceId);
    },

    isDeclined(assetFaceId: string): boolean {
      return declined.has(assetFaceId);
    },

    declinedFaceIds(): string[] {
      return [...declined];
    },

    toggleManual(assetFaceId: string): void {
      if (manualSelected.has(assetFaceId)) {
        manualSelected.delete(assetFaceId);
      } else {
        manualSelected.add(assetFaceId);
      }
    },

    isManualSelected(assetFaceId: string): boolean {
      return manualSelected.has(assetFaceId);
    },

    selectAllLoaded(assetFaceIds: string[]): void {
      for (const id of assetFaceIds) {
        manualSelected.add(id);
      }
    },

    clearManual(): void {
      manualSelected.clear();
    },

    manualFaceIds(): string[] {
      return [...manualSelected];
    },

    setEntireCluster(on: boolean): void {
      entireCluster = on;
    },

    setClusterTotal(total: number): void {
      clusterTotal = total;
    },

    applyPayload({ personId, destinationPersonId }): FaceRepairApplyRequestDto {
      if (entireCluster && destinationPersonId) {
        return {
          approvedPersonIds: [],
          excludeFaceIds: [],
          manualMove: { personId, destinationPersonId, entireCluster: true },
        };
      }
      const payload: FaceRepairApplyRequestDto = {
        approvedPersonIds: [personId],
        excludeFaceIds: [...excluded, ...declined],
      };
      if (manualSelected.size > 0 && destinationPersonId) {
        payload.manualMove = { personId, destinationPersonId, faceIds: [...manualSelected] };
      }
      return payload;
    },
  };
}
```

> Notes: the getter `get entireCluster()` and the `$state` closure variable share the name but live in different
> scopes (object property vs. closure var) — no collision; the getter returns the closure var. Reassigning the
> `$state` var in `setEntireCluster`/`setClusterTotal` is the canonical runes pattern and works in `.svelte.ts`.
> The unit tests read getters synchronously, so they pass regardless of reactivity; `$state` is for the
> component (Slice 6).

- [ ] **Step 4: Run to verify green**

Run: `cd web && npx vitest --run src/routes/admin/face-cleanup/[personId]/review.spec.ts`
Expected: PASS — the new manual/applyPayload cases **and** the pre-existing `createReviewModel` cases.

- [ ] **Step 5: Type-check + format**

Run: `cd .. && make check-web` (svelte-check + tsc; human output "0 errors"). If it reports `0 FILES` for
svelte-check, run `cd web && npx svelte-kit sync` first, then re-run.
Run: `cd .. && npx prettier --check "web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts" "web/src/routes/admin/face-cleanup/[personId]/review.spec.ts"` (quote the bracketed paths; write + re-run if needed).

- [ ] **Step 6: Commit**

```bash
git add "web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts" "web/src/routes/admin/face-cleanup/[personId]/review.spec.ts"
git commit -m "feat(web): manual-selection state + applyPayload in face-cleanup review view-model"
```

---

## Self-Review

- **Spec coverage (Slice 5):** `manualSelected` + `toggleManual`/`isManualSelected`/`selectAllLoaded`/
  `clearManual`/`manualFaceIds` ✓; `entireCluster` + `setEntireCluster`/`setClusterTotal` ✓; extended
  `movingCount` (entireCluster → clusterTotal; else flagged-not-excluded-not-declined + manual) ✓;
  `applyPayload` for partial + entire-cluster + legacy + null-destination ✓. Edge E15 (entireCluster supersedes
  picks) ✓; E17 payload guard (null destination → no manualMove) ✓.
- **Placeholders:** none — full module + full tests + exact commands.
- **Type consistency:** `applyPayload` returns the SDK `FaceRepairApplyRequestDto`, so the body is guaranteed to
  match `applyFaceRepair`. The `manualMove` literal shape `{ personId, destinationPersonId, faceIds?,
entireCluster? }` matches the Slice 2 DTO. `createReviewModel(flaggedFaces)` signature unchanged → existing
  `+page.svelte` + existing tests remain valid.
- **Carry-forward to Slice 6:** the component sets `setClusterTotal(total)` from the cluster-faces response,
  wires Rest tiles to `toggleManual`/`isManualSelected`, **Select all** to `selectAllLoaded(loadedIds)`, **Move
  entire cluster** to `setEntireCluster(true)`, disables manual actions when `primaryOwner` is null, and calls
  `applyFaceRepair({ faceRepairApplyRequestDto: vm.applyPayload({ personId, destinationPersonId }) })`.
