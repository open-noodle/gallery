# Face Cleanup Console — Slice 6 (review page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use
> checkbox (`- [ ]`) syntax. TDD where practical.

**Goal:** A per-person review page at `/admin/face-cleanup/{personId}` showing the actual flagged face crops a
person will lose, a "stays vs moves" decision strip, per-face deselect, and an apply action — so an admin can
visually confirm before re-attributing a contaminated cluster.

**Architecture:** A new read endpoint `GET /admin/face-repair/scan/person/:personId` returns the person's
flagged faces (`assetFaceId` + `suspectedOwnerId`), computed by a scoped `buildRepairPlan`. The web review page
renders each as a face crop (`/people/{personId}/faces/{faceId}/thumbnail`), supports deselect, and applies via
`applyFaceRepair({ approvedPersonIds:[personId], excludeFaceIds:[...deselected] })`.

**Tech Stack:** NestJS, zod DTO, OpenAPI regen, SvelteKit + Svelte 5 runes + `@immich/ui` + `@immich/sdk`,
Vitest + `@testing-library/svelte`.

**Visual contract:** [`face-cleanup-review-page-mockup.html`](../../face-cleanup-review-page-mockup.html) — match
its banner, decision strip, faces-leaving grid (checked crops with a `→ owner` tag; deselected = greyed
"Stays"), and sticky action bar.

**Spec:** [`2026-06-03-face-cleanup-console-design.md`](2026-06-03-face-cleanup-console-design.md) §"Review page" + §Testing/Slice 6.

---

## Task 1: Per-person flagged-faces endpoint (server, TDD)

**Files:** `face-repair.service.ts`, `face-repair.dto.ts`, `face-repair-admin.controller.ts`, OpenAPI; Test:
`server/src/services/face-repair.apply.spec.ts` (extend) or a new `face-repair.person.spec.ts`.

- [ ] **Step 1: Service method** `getPersonFlaggedFaces(personId)`:

```ts
  async getPersonFlaggedFaces(personId: string): Promise<{ personId: string; flaggedFaces: { assetFaceId: string; suspectedOwnerId: string }[] }> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    const recognition = machineLearning.facialRecognition;
    const plan = await this.buildRepairPlan({
      maxDistance: recognition.maxDistance,
      minFaces: recognition.minFaces,
      voteWindow: DEFAULT_VOTE_WINDOW,
      voteMargin: DEFAULT_VOTE_MARGIN,
      maxAttributionDistance: DEFAULT_MAX_ATTRIBUTION_DISTANCE,
      maxFlaggedFraction: DEFAULT_MAX_FLAGGED_FRACTION,
      personIds: [personId],
    });
    const flaggedFaces = [...plan.toRepair, ...plan.reviewOnlyFaces].map((f) => ({
      assetFaceId: f.assetFaceId,
      suspectedOwnerId: f.suspectedOwnerId,
    }));
    return { personId, flaggedFaces };
  }
```

(Scoped to one person, so `toRepair` + `reviewOnlyFaces` together are exactly the person's flagged faces — no
`approvedPersonIds` needed; this is read-only.)

- [ ] **Step 2: DTO** in `face-repair.dto.ts`:

```ts
const FlaggedFaceSchema = z.object({ assetFaceId: z.string(), suspectedOwnerId: z.string() });
export const FaceRepairPersonFacesSchema = z
  .object({ personId: z.string(), flaggedFaces: z.array(FlaggedFaceSchema) })
  .meta({ id: 'FaceRepairPersonFacesDto' });
export class FaceRepairPersonFacesDto extends createZodDto(FaceRepairPersonFacesSchema) {}
```

- [ ] **Step 3: Route** in `face-repair-admin.controller.ts`:

```ts
  @Get('scan/person/:personId')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Get a person’s flagged faces for review', history: new HistoryBuilder().added('v1') })
  getFaceRepairPersonFaces(@Param('personId', new ParseUUIDPipe({ version: '4' })) personId: string): Promise<FaceRepairPersonFacesDto> {
    return this.service.getPersonFlaggedFaces(personId) as Promise<FaceRepairPersonFacesDto>;
  }
```

> Import `Get`, `Param`, `ParseUUIDPipe` as the codebase does (grep a controller using `@Param(... ParseUUIDPipe ...)`).

- [ ] **Step 4: Unit test** (mock `buildRepairPlan`): returns `flaggedFaces` = toRepair+reviewOnly assetFaceIds with their suspectedOwnerId; empty when none flagged.

- [ ] **Step 5: OpenAPI regen + check/lint + commit**

Run: `cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api`. Then `make check-server && make lint-server`.
Run the unit test green.

```bash
git add server/src/services/face-repair.service.ts server/src/dtos/face-repair.dto.ts server/src/controllers/face-repair-admin.controller.ts server/src/services/*.spec.ts open-api mobile/openapi
git commit -m "feat(server): endpoint for a person’s flagged faces (review page)"
```

---

## Task 2: Review page (web, follows the mockup)

**Files:** `web/src/routes/admin/face-cleanup/[personId]/+page.ts`, `+page.svelte`, a deselect view-model
`review.svelte.ts` + `review.spec.ts`, component test; reuse `getFaceThumbnailUrl`/`getPeopleThumbnailUrl`.

- [ ] **Step 1: Deselect view-model (unit, TDD)** — `review.svelte.ts`

`createReviewModel(flaggedFaces)` exposes: `excluded: Set<string>` (the deselected assetFaceIds, starts empty),
`toggle(assetFaceId)`, `isExcluded(id)`, `movingCount` (`flaggedFaces.length - excluded.size`), `excludedCount`,
`excludeFaceIds()` (`[...excluded]`). Tests:

```ts
it('starts with all faces moving (none excluded)', () => {
  const vm = createReviewModel([{ assetFaceId: 'a' }, { assetFaceId: 'b' }]);
  expect(vm.movingCount).toBe(2);
  expect(vm.excludeFaceIds()).toEqual([]);
});
it('toggling a face excludes it and decrements movingCount; re-toggle restores', () => {
  const vm = createReviewModel([{ assetFaceId: 'a' }, { assetFaceId: 'b' }]);
  vm.toggle('a');
  expect(vm.isExcluded('a')).toBe(true);
  expect(vm.movingCount).toBe(1);
  expect(vm.excludeFaceIds()).toEqual(['a']);
  vm.toggle('a');
  expect(vm.movingCount).toBe(2);
});
```

Run: `cd web && npx vitest run src/routes/admin/face-cleanup/\[personId\]/review.spec.ts` (red → green). Commit.

- [ ] **Step 2: Build the page** (`+page.ts` admin guard + `personId` param; `+page.svelte`):

- On mount: `getFaceRepairPersonFaces({ personId })` (SDK) for the flagged faces; `getLatestScan()` to find this
  person's aggregate row (name, faceCount, suspectedOwners → owner name + the move-count) — or accept that the
  list passed it; recompute the banner text from the row.
- **Back link** to `/admin/face-cleanup`. **Decision strip:** `✓ Stays — {name} ({faceCount − moving})` ──→
  `Moves to {topOwnerName} ({moving})`, each with a ringed reference thumbnail (`getPeopleThumbnailUrl` for the
  person; the suspected owner by its `ownerPersonId`).
- **Faces-leaving grid:** one tile per flagged face = a face crop via `getFaceThumbnailUrl(personId, assetFaceId)`
  (the helper that builds `/people/{personId}/faces/{faceId}/thumbnail`). Tiles checked by default with a
  `→ owner` tag; clicking toggles exclude (greyed "Stays" per mockup) and updates the live counts via the
  view-model. Lazy-load / page the grid (don't render thousands of `<img>` at once — render in chunks / on scroll).
- **Sticky action bar:** "{moving} faces will move to {owner} · keeps {faceCount − moving}"; **Cancel** (back, no
  request) + **Move {moving} faces** (disabled when `moving === 0` or while in-flight) →
  `applyFaceRepair({ faceRepairApplyRequestDto: { approvedPersonIds: [personId], excludeFaceIds: vm.excludeFaceIds() } })`,
  then navigate back to the list. Handle apply **409** non-destructively (keep state).
- i18n keys for the new strings.

- [ ] **Step 3: Component tests** (`@testing-library/svelte`, mock the SDK fns + thumbnail helpers):

- renders the decision strip names/counts + one tile per flagged face.
- clicking a tile excludes it; the action-bar move-count decrements (and restores on re-click).
- deselect-all → "Move 0" disabled.
- **Move** posts `approvedPersonIds:[personId]` + the exact `excludeFaceIds`; **Cancel** navigates without a request.
- apply **409** → non-destructive error, state kept.
- a personId with no flagged faces (stale) → graceful "no longer flagged / re-scan" state.

- [ ] **Step 4: Verify + commit**

Run: `cd web && npx vitest run src/routes/admin/face-cleanup/` → green. `cd web && pnpm lint` clean;
`pnpm run check` (note the svelte no-op; fix any real svelte-check errors). Then commit.

```bash
git add web/src/routes/admin/face-cleanup web/src/lib/i18n
git commit -m "feat(web): face-cleanup per-person review page"
```

---

## Self-Review

- **Spec coverage (Slice 6):** decision strip names/counts (T2) ✓; faces-leaving grid of crops (T2) ✓; per-face
  deselect updates live counts (T1 vm + T2) ✓; deselect-all → Move 0 disabled (T2) ✓; Move posts approvedPersonIds
  - exact excludeFaceIds (T2) ✓; Cancel no-request (T2) ✓; Leaving/Staying toggle — include if cheap, else the
    grid shows leaving (note) ✓; grid lazy-load (T2) ✓; apply 409 (T2) ✓; stale person no-faces state (T2) ✓.
- **New endpoint** fills the data gap (the scan report stores aggregates, not individual flagged faceIds).
- **Carry-forward:** Slice 7 e2e drives list → review → deselect → apply against the running stack.
