# Face Cleanup — Full Per-Face Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. **This plan is organised as vertical slices** — each slice cuts through DB → server → SDK → web →
> tests and ends in a user-testable, independently shippable increment, so `/impl-loop` can take one slice at
> a time. Slices are linear (each builds on the last).

**Goal:** Give the Face Cleanup review screen the five durable terminal states from Hagen's feedback — move
to owner, move to a chosen person, soft stay, confirm/lock, and detach — under a Model B (select + bulk bar)
UI where every flagged face resolves and the person drains from the queue.

**Architecture:** One new `POST /admin/face-repair/resolve` endpoint whose payload mirrors the UI buckets
replaces the 2-state `apply`. Moves reuse `executeRepair` (destination-agnostic). Soft-stay reuses the
existing `face_repair_decline` table; confirm/lock adds a new fork `face_repair_lock` table honoured through
the existing `applyDeclineFilters` seam; detach nulls `asset_face.personId` and drops the `face_identity_face`
link. The web `[personId]` page is reworked to the committed Model B mockup.

**Tech Stack:** NestJS 11 + Kysely + nestjs-zod (server), fork migrations in `migrations-gallery/`, oazapfts
SDK, SvelteKit + Svelte 5 runes + `@immich/ui` (web), Vitest (unit + medium/testcontainers), Playwright (e2e).

**Spec:** [`2026-07-10-face-cleanup-full-resolution-design.md`](2026-07-10-face-cleanup-full-resolution-design.md)
· **Frontend source of truth:** [`2026-07-10-face-cleanup-resolution-mockup.html`](2026-07-10-face-cleanup-resolution-mockup.html)

## Global Constraints

- **TDD, always.** Every step writes the failing test first, watches it fail for the right reason, then
  implements the minimum. The spec §8 matrix (U1–U3, M1–M22, C1–C3, W1–W3, P1–P5, X1–X2) is the coverage
  contract; **each slice lists the IDs it must turn green, and every matrix ID must appear in exactly one
  slice** (Slice 8 Step 0 asserts this — see the coverage table at the end).
- **Fork migrations** go in `server/src/schema/migrations-gallery/` with a round timestamp; **plain** unique
  indexes only (a partial index needs a `migration_overrides` entry for SQL Schema Checks CI).
- **UUID validation:** entity ids (`asset_face.id`, `person.id`) are **v4** → `z.uuidv4()`; fork
  `*_repair_*` row ids are **v7** → remove/undo DTOs use `z.uuid()` (version-agnostic), never `z.uuidv4()`.
- **No inline `z.enum`** in DTOs that hit the SDK (anonymous-enum renumbering); use `z.string()` and cast in web.
- **Required `@Body()` → required SDK arg:** web must pass `{ faceRepairResolveRequestDto: {...} }`, never
  `undefined` (see `feedback_openapi_body_required_oazapfts`).
- **Prettier:** server `src/` **and** `test/` are checked; `docs/` uses the **docs** package prettier
  (`pnpm -C docs exec prettier --write`). Run before every commit.
- **Faces never cross owners.** The scan is owner-scoped; the picker and server both enforce it.
- **No `Co-Authored-By` / `Generated-with` trailers** on commits.

## Reference facts (verified in the codebase, `feat/face-cleanup-console`)

- **Move:** `FaceRepairRepository.reattributeFaces(from, to, faceIds, trx)` sets `asset_face.personId`, gated
  `sourceType = MachineLearning ∧ isVisible ∧ deletedAt IS NULL ∧ personId = from`, chunked at 1000
  (`repositories/face-repair.repository.ts:155`).
- **Move engine:** `FaceRepairService.executeRepair(plan)` groups `plan.toRepair` by `(currentPersonId →
suspectedOwnerId)`, wraps re-attribution + `ensurePersonIdentity` + `replaceFaceIdentities` in one
  transaction, and queues `PersonGenerateThumbnail` for repointed representatives
  (`services/face-repair.service.ts:189`). `FlaggedFace = { assetFaceId, currentPersonId, suspectedOwnerId }`.
- **Apply today:** `applyRepair` reads the stored snapshot via
  `FaceRepairScanRepository.getScanFlaggedFacesForPersons(latest.id, personIds)` (`:295`), runs
  `applyDeclineFilters`, guards on `jobRepository.isActive(QueueName.FacialRecognition)` → `ConflictException`,
  `failStaleScans`, `getLatestScan` pending/running → `ConflictException`; empties via `countEligibleFaces` /
  `countAllFaces` + `personRepository.delete`; then `removePersonsFromLatestScan` — **only when `moved > 0`**
  (`services/face-repair.service.ts:580-690`).
- **Decline:** `face_repair_decline` (migration `1781000000000`, unique `(assetFaceId, suspectedOwnerId)`, id
  uuid-v7). `FaceRepairDeclineRepository.createDeclines({faces?,persons?,declinedBy})` /
  `getDeclineMaps(scope?)` → `DeclineMaps.declinedFaceOwners: Map<assetFaceId, Set<suspectedOwnerId>>` /
  `listDeclines()` / `removeDeclines({ids?,faces?})`. Filter helper `applyDeclineFilters(byPerson, maps)`
  (`utils/face-repair.ts:115`).
- **Detach primitives:** `asset_face.personId` is nullable; the face↔identity link is `face_identity_face`,
  deletable by `deleteFrom('face_identity_face').where('assetFaceId','in',ids)`
  (`repositories/face-identity.repository.ts:2282`).
- **Controller:** `controllers/face-repair-admin.controller.ts`, every route `@Authenticated({ admin: true })`
  - `@Endpoint({ summary, history: new HistoryBuilder().added('v1') })`; user id via `@Auth() auth: AuthDto`
    (`auth.user.id`); `@Param('personId', new ParseUUIDPipe({ version: '4' }))`.
- **Web:** `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` (611 lines) + `review.svelte.ts` (144);
  manage page `.../declined/+page.svelte`. SDK fns in use: `applyFaceRepair`, `declineFaceRepair`,
  `getFaceRepairClusterFaces`, `getFaceRepairPersonFaces`, `getLatestScan`, `removeFaceRepairDeclines`,
  `getPeopleThumbnailPath`.
- **Tests:** server unit via `newTestService(FaceRepairService)`; medium via testcontainers under
  `server/test/medium/specs/**` with hand-registered repos in `test/medium.factory.ts`; web via
  Vitest + `@testing-library/svelte`; e2e `e2e/src/specs/web/face-cleanup.e2e-spec.ts`.

## Verified reference-fact corrections (2026-07-11, read against this branch)

These override any looser wording above; folded in after a code-level verification pass. (Labelled **RF**
= "reference fact" to avoid colliding with the §8 controller-test IDs C1/C2.)

- **RF1 — Mockup has NO `data-testid` attributes.** `2026-07-10-face-cleanup-resolution-mockup.html` is a
  static mockup using element **`id`s** (`grid`, `dock`, `summary`, `chips`, `allset`, `applyBtn`, `applyLbl`,
  `bulk`, `count`, `modalBg`, `pickCount`, `psearch`, `people`) + `data-state`/`data-idx`/`data-name`, not
  test-ids. The implementation must **add** the `data-testid`s the spec §6 / §8 tests reference
  (`flagged-grid`, `face-tile` [+ `data-faceid`, `data-state`], `select-all`, `reset`, `dock`, `tally`,
  `apply-btn`, `bulk-bar`, `clear`, `person-picker`) while reproducing the mockup's **layout, `data-state`
  color model, and copy**. Colors (`:root`): owner `#4f46e5`/tint `#eef0fe`, stay `#16a34a`/`#e7f6ec`, lock
  `#7c3aed`/`#f1eafe`, other `#d97706`/`#fdf0dd`, detach `#475569`/`#eef1f5` (detach also
  `filter: grayscale(1) opacity(0.55)`). Ribbon copy: owner `→ <OwnerName>`, stay `Keeps here`, lock
  `Locked`, other `→ <Name>`, detach `Detached`. Bulk-bar chips: `→ Owner`, `Keep here`, `Confirm / lock`,
  `Move → person…`, `Not a face`, `Clear`. Summary: "every face accounted for" + `Apply · N faces`. Banner:
  "N faces need review — every one leaves the queue once you apply". Picker: title "Move N faces to…",
  subtitle "Any person or cluster in the library — not just this scan's suggestion.", search "Search
  people…", suggestion row subtitle "this scan's suggestion", `Create new person "<query>"`, empty "No
  matches".
- **RF2 — `resolve` route needs `@Auth()` (threads `resolvedBy`).** Today `applyFaceRepair` does **not** inject
  `@Auth()`; only `triggerScan`/`declineFaceRepair` do. Because `stay`→`createDeclines({declinedBy})` (Slice 2)
  and `lock`→`insertLocks(..., createdBy)` (Slice 3) need the admin id, the new route takes
  `@Auth() auth: AuthDto` and the service signature is **`resolveFaces(input: FaceRepairResolveRequest,
resolvedBy: string)`** from Slice 1 (controller passes `auth.user.id`). `resolvedBy` is unused by the
  move-only Slice 1 path but wired through from the start so Slices 2/3/5 don't re-touch the controller.
- **RF3 — Exact primitives.** `FaceRepairRepository.reattributeFaces(fromPersonId, toPersonId, assetFaceIds,
db = this.db)` (chunked 1000). `executeRepair(plan: RepairPlan)` where `RepairPlan = { toRepair:
FlaggedFace[]; reviewOnlyFaces: []; reviewOnlyPersonIds: []; unAttributableFaces: []; perPerson: [] }` and
  `FlaggedFace = { assetFaceId: string; currentPersonId: string; suspectedOwnerId: string }` (exported from
  `services/face-repair.service.ts`). Build `plan.toRepair` from `{ assetFaceId, currentPersonId: personId,
suspectedOwnerId: destinationPersonId }` per moved face. `getScanFlaggedFacesForPersons(scanId, personIds)`
  returns `{ assetFaceId, personId, suspectedOwnerId }[]` — **per-face** suspected owner (confirmed).
- **RF4 — Response shape** is `{ moved, declined, locked, detached, skipped }` (Slice 1 leaves declined/locked/
  detached = 0). Old `FaceRepairApplyResponse` was `{ moved, skipped }`.
- **RF5 — `applyRepair` guard order** (reuse verbatim, service `:580-688`): `isActive(FacialRecognition)` →
  `ConflictException('Refusing to apply while facial recognition is active')`; `failStaleScans`;
  `getLatestScan` pending/running → `ConflictException('Refusing to apply while a scan is in progress')` — all
  **before** the snapshot read. `resolveFaces` reuses these + the empty-unnamed cleanup
  (`countEligibleFaces`/`countAllFaces` + `personRepository.delete`), but calls `removePersonsFromLatestScan`
  **unconditionally on a committed resolution** (drop-on-any-resolution), unlike `applyRepair`'s `moved > 0`
  gate.
- **RF6 — Medium factory.** `FaceRepair*` repos construct via the generic `new key(db)` bucket in
  `newRealRepository`; add `FaceRepairLockRepository` there and to the `real:[...]` list of the resolve
  medium spec. Setup: `newMediumService(FaceRepairService, { database: db, real: [...], mock: [LoggingRepository, JobRepository] })`.

---

## File Structure

**Server**

- Modify `server/src/dtos/face-repair.dto.ts` — add `FaceRepairResolveRequest/Response`, `FaceRepairResolutionsList`, `FaceRepairResolutionsRemoveRequest`, owner-people DTOs; remove `FaceRepairApplyRequest/Response` in Slice 6.
- Create `server/src/schema/tables/face-repair-lock.table.ts` — `face_repair_lock` table.
- Create `server/src/schema/migrations-gallery/1782000000000-AddFaceRepairLock.ts`.
- Modify `server/src/repositories/face-repair-lock.repository.ts` (create) — insert / list / remove / `getLockedFaceIds`.
- Modify `server/src/repositories/face-repair.repository.ts` — add `detachFaces`.
- Modify `server/src/repositories/face-repair-decline.repository.ts` / `src/utils/face-repair.ts` — `getDeclineMaps` returns `lockedFaceIds`; `applyDeclineFilters` drops locked faces.
- Modify `server/src/services/face-repair.service.ts` — `resolveFaces(...)`, `listResolutions`, `removeResolutions`, owner-people search/create; drop-on-any-resolution.
- Modify `server/src/controllers/face-repair-admin.controller.ts` — `resolve`, `resolutions` (GET/DELETE), owner-people (GET/POST); remove `apply` + `decline` list/delete migration in Slices 6–7.
- Tests alongside each (`*.spec.ts`) + `server/test/medium/specs/services/face-repair.resolve.spec.ts`.

**SDK**: regen `open-api/immich-openapi-specs.json` + `open-api/typescript-sdk/**` per slice that changes the API.

**Web**

- Rewrite `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` + `review.svelte.ts` (Model B).
- Create `web/src/routes/admin/face-cleanup/[personId]/PersonPicker.svelte`.
- Rename `.../declined/+page.svelte` → `.../resolutions/+page.svelte`.
- Modify `i18n/en.json` — `admin.face_cleanup_*` keys.
- Modify `e2e/src/specs/web/face-cleanup.e2e-spec.ts`.

---

## Slice 1 — Resolve endpoint + Model B shell (move-to-owner path)

**Goal (vertical, user-testable):** Replace the 2-state review with the Model B grid driven by a new
`resolve` endpoint, implementing only the **move → owner** path end-to-end. The admin selects flagged faces,
keeps the default → Owner (or toggles back), hits **Apply**, and every face moves to **its own** suspected
owner; the person drains from the console.

**Covers:** spec req 5, 6; state 1. Edge E1, E9, E10, E14 (owner grouping), E16 (empty resolve). Tests **U3,
M1, M3, M8, M9, M10, M15, M19, C1 (resolve half), C2 (resolve half), W1 (owner), W2, W3, P1, P2, P4, P5**.
(Old `apply` stays until Slice 6.) The pure bucket-validation helper (**U3**) covering **overlap (E7)** and
**non-flagged stay/lock/detach ids (E15)** is built here and reused by every later bucket; its integration
counterparts (**M7** disjoint→400, **M14** non-flagged→400) land with the buckets that first make them
reachable (Slices 2 / 3 / 5).

**Files:** DTO, service `resolveFaces`, controller `resolve`, SDK regen, `+page.svelte`, `review.svelte.ts`,
medium `face-repair.resolve.spec.ts`, web `review.spec.ts` / `page.spec.ts`.

**Interfaces produced:**

```ts
// dtos/face-repair.dto.ts
const MoveGroupSchema = z.object({ destinationPersonId: z.uuidv4(), faceIds: z.array(z.uuidv4()).min(1) });
export const FaceRepairResolveRequestSchema = z
  .object({
    personId: z.uuidv4(),
    moveToPerson: z.array(MoveGroupSchema).default([]),
    stay: z.array(z.uuidv4()).default([]),   // wired in Slice 2
    lock: z.array(z.uuidv4()).default([]),   // wired in Slice 3
    detach: z.array(z.uuidv4()).default([]), // wired in Slice 5
    entireCluster: z.object({ destinationPersonId: z.uuidv4() }).optional(), // Slice 6
  })
  .meta({ id: 'FaceRepairResolveRequestDto' });
export const FaceRepairResolveResponseSchema = z
  .object({ moved: z.number(), declined: z.number(), locked: z.number(), detached: z.number(), skipped: z.number() })
  .meta({ id: 'FaceRepairResolveResponseDto' });
// service (RF2 — threads the admin id from the controller's @Auth(); unused by the move-only Slice 1 path
// but wired from the start so Slices 2/3/5 don't re-touch the controller)
resolveFaces(input: FaceRepairResolveRequest, resolvedBy: string): Promise<FaceRepairResolveResponse>;
```

- [ ] **Step 1 — Failing medium test M1/M3 (per-face owner move).** In
      `server/test/medium/specs/services/face-repair.resolve.spec.ts`: seed a person with faces whose stored
      snapshot points two faces at owner A and one at owner B; call `resolveFaces({ personId, moveToPerson:
[{A,[f1,f2]},{B,[f3]}] })`; assert `asset_face.personId` = A for f1,f2 and B for f3, `moved === 3`, and
      the person is removed from the latest scan. **Also M15 (E10 zero-override):** a resolve whose only
      bucket is the default owner group for _every_ flagged face moves them all and drains the person. Run:
      `pnpm test:medium -- face-repair.resolve` → FAIL (`resolveFaces` undefined).
- [ ] **Step 2 — DTO + schema.** Add the schemas above to `face-repair.dto.ts` + `class
FaceRepairResolveRequestDto extends createZodDto(...)`. Run `pnpm exec vitest run src/dtos/face-repair.dto.spec.ts` after adding a validation test (accepts owner groups; rejects a
      non-uuid faceId) → PASS.
- [ ] **Step 3 — Failing unit U3, then service `resolveFaces(input, resolvedBy)` (move path).** First add
      **U3** to `src/utils/face-repair.spec.ts`: the pure bucket-validation helper flags (a) the same id in
      two buckets (E7) and (b) a `stay`/`lock`/`detach` id absent from the flagged snapshot (E15) — both as
      errors → FAIL. Then implement `resolveFaces(input, resolvedBy)` in `face-repair.service.ts` (signature
      per RF2; `resolvedBy` unused on this move-only path but wired through): guard reuse
      (`isActive(FacialRecognition)`, `failStaleScans`, `getLatestScan` pending/running); **reject an empty
      resolve** — no `moveToPerson`/`stay`/`lock`/`detach` and no `entireCluster` → `BadRequestException`
      (M19/E16); read the snapshot via `getScanFlaggedFacesForPersons`; run the bucket-validation helper
      (**disjoint** + snapshot membership) and `assertResolvable` (`moveToPerson` faces on `personId` +
      eligible); build `plan.toRepair` from the groups; call `executeRepair`; run the empty-unnamed cleanup;
      then `removePersonsFromLatestScan([personId, …drainedDestinations])` **unconditionally on a committed
      resolution** (not gated on `moved > 0`). Run U3 + Step 1 → PASS.
- [ ] **Step 4 — Failing tests M9 (skip) + M10 (guard) + M8 (drain cleanup).** Add: a face moved off
      `personId` since the snapshot → not moved, counted in `skipped` (M9); `resolveFaces` while
      `FacialRecognition` active → throws `ConflictException` (M10); and a move that empties an **unnamed**
      source auto-deletes it while a drained **named** person is kept (M8/E6). Run → FAIL, then confirm they
      PASS against Step 3 (adjust if needed). _(M19 empty-resolve was written in Step 3.)_
- [ ] **Step 5 — Controller route + auth tests C1/C2 (resolve half).** Add to
      `face-repair-admin.controller.ts` (per RF2, inject `@Auth()` and thread the admin id):
      `@Post('resolve') @Authenticated({ admin: true }) @Endpoint({ summary: 'Resolve reviewed faces',
history: new HistoryBuilder().added('v1') }) resolveFaces(@Auth() auth: AuthDto, @Body() dto:
FaceRepairResolveRequestDto) { return this.service.resolveFaces(dto, auth.user.id) as
Promise<FaceRepairResolveResponseDto>; }`. Extend `face-repair-admin.controller.spec.ts` to assert
      delegation **and** the resolve-route halves of **C1** (non-admin → 403) and **C2** (malformed body →
      400). Run → PASS. (Slice 7 adds the `resolutions*` halves of C1/C2.)
- [ ] **Step 6 — Regen SDK.** `cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api-typescript`. Verify `resolveFaceRepair` (or generated name) + the two DTOs appear in
      `open-api/typescript-sdk/src/fetch-client.ts`. Commit server + SDK.
- [ ] **Step 7 — Failing web unit W1/W2/W3.** In `review.spec.ts`: construct the reworked view-model, set
      face states, and assert `buildResolveRequest()` groups owner faces by each face's `suspectedOwnerId`
      (W1), the tally sums to N across action sequences (W2), and Reset returns all to `owner` (W3). Run
      `pnpm -C web test -- review.spec` → FAIL.
- [ ] **Step 8 — Rework `review.svelte.ts`.** Replace the exclude/decline model with a per-face `state`
      (`'owner'|'other'|'stay'|'lock'|'detach'`) + optional `destinationPersonId`; selection ops
      (`toggle`, `range`, `selectAll`, `clear`, `reset`); a `$derived` tally; and a **pure**
      `buildResolveRequest(personId): FaceRepairResolveRequestDto` that groups `owner`/`other` faces by
      destination (owner destination = each face's `suspectedOwnerId`). Run Step 7 → PASS.
- [ ] **Step 9 — Failing component P1/P2/P4/P5.** In `page.spec.ts`: render the page with a mocked flagged
      set; assert click/shift-range/select-all selection (P1), dock summary↔bulk swap (P2), that Apply calls
      the SDK with `{ faceRepairResolveRequestDto: {...} }` matching on-screen state (P4), and that a
      **stale/empty** flagged set renders the graceful empty state (P5, existing behavior preserved). Run →
      FAIL.
- [ ] **Step 10 — Rework `+page.svelte` to Model B (move path).** Build the grid (`data-testid="face-tile"`,
      `data-faceid`, `data-state`, per-face owner chip), selection (click · shift · Select all · Reset), the
      sticky dock swapping tally↔bulk with only `→ Owner` / `Back to owner` / Clear active, the live tally,
      and one **Apply** posting `buildResolveRequest()`. Match the committed mockup markup/colors. Run Step 9
      → PASS.
- [ ] **Step 11 — Format + commit.** `make format-server format-web`; commit server+SDK+web:
      `feat(face-cleanup): resolve endpoint + Model B move-to-owner`.

## Slice 2 — Soft-stay ("Keep here")

**Goal:** A selected face can be **kept** with the reviewed person; it writes a durable decline against its
suspected owner and drains. A person kept/locked entirely (zero moves) still leaves the console.

**Covers:** spec req 2 (soft strength); state 3. Edge E3, E7 (disjoint — first reachable here), E13, E15
(stay), E20 (re-stay idempotent). Tests **U2, M4, M7, M11, M14 (stay non-flagged reject), M22, W1/W2
(stay)**.

- [ ] **Step 1 — Failing unit U2.** In `src/utils/face-repair.spec.ts`: a `(face, ownerA)` decline is dropped
      only for ownerA; the same face toward ownerB survives `applyDeclineFilters`. Run → PASS if already
      true (regression lock); else fix.
- [ ] **Step 2 — Failing medium M4 + M7 + M11 + M14 + M22.** In `face-repair.resolve.spec.ts`:
      `resolveFaces({ personId, stay:[f1] })` writes a `face_repair_decline(f1, its suspectedOwnerId)`, a
      re-run scan no longer flags `(f1, ownerA)` (M4), a **stay-only** resolve still removes the person from
      the scan (M11, E13), a `stay` id **not in the flagged snapshot** → `BadRequestException` (M14, E15), a
      face present in **both** `moveToPerson` and `stay` → `BadRequestException` (M7, E7 — now reachable with
      two buckets), and re-staying an already-declined `(f1, ownerA)` is idempotent (no error, one row — M22,
      E20). Run → FAIL.
- [ ] **Step 3 — Service stay bucket.** In `resolveFaces`, run the Slice-1 bucket-validation helper so an
      overlap 400s (M7) and validate `stay ⊆ flagged snapshot` (M14); call `createDeclines({ faces:
stay.map(id => ({ assetFaceId: id, suspectedOwnerId: snapshot[id] })), declinedBy: resolvedBy })` with
      `ON CONFLICT (assetFaceId, suspectedOwnerId) DO NOTHING` for idempotency (M22). Ensure
      drop-on-any-resolution already covers stay-only (Slice 1 Step 3). Run → PASS.
- [ ] **Step 4 — Failing web W1/W2 (stay) + component.** `buildResolveRequest` emits `stay` ids; the "Keep
      here" bulk action tags tiles green and updates the tally. Run → FAIL.
- [ ] **Step 5 — Web "Keep here".** Add the bulk action + green `stay` chip ("Keeps here") + tally entry.
      Run → PASS.
- [ ] **Step 6 — Format + commit** `feat(face-cleanup): keep-here soft stay`.

## Slice 3 — Confirm / lock (owner-agnostic)

**Goal:** A selected face can be **locked** to the reviewed person; a re-scan never re-flags it, whatever
owner it would propose (the age-gap childhood-photo case).

**Covers:** spec req 2 (lock strength); state 4. Edge E2, E15 (lock). Tests **U1, M5, M14 (lock non-flagged
reject)**.

- [ ] **Step 1 — Failing table/migration test.** Add `face_repair_lock` to schema
      (`face-repair-lock.table.ts`: `id @PrimaryGeneratedUuidV7Column`, `assetFaceId uuid` FK asset_face
      CASCADE, `personId uuid` FK person CASCADE, `createdBy uuid`, `createdAt timestamptz default now`,
      **plain** `UNIQUE (assetFaceId)`), migration `1782000000000-AddFaceRepairLock.ts`. Run
      `pnpm migrations:run` on a scratch DB + SQL Schema Checks (`make sql` **only with a DB up**) → clean.
- [ ] **Step 2 — Failing unit U1.** In `src/utils/face-repair.spec.ts`: `applyDeclineFilters(byPerson, {
declinedFaceOwners, lockedFaceIds: new Set([f1]) })` drops f1 for **every** owner. Run → FAIL.
- [ ] **Step 3 — Extend the filter seam.** `getDeclineMaps` also selects `face_repair_lock` →
      `lockedFaceIds: Set<string>`; `applyDeclineFilters` drops any face in `lockedFaceIds` before the
      per-owner check. Add `FaceRepairLockRepository` (`insertLocks(faces, personId, createdBy)` with `ON
CONFLICT (assetFaceId) DO NOTHING`, `getLockedFaceIds()`). Register in `medium.factory.ts`. Run Step 2
      → PASS.
- [ ] **Step 4 — Failing medium M5 + M14 (lock).** `resolveFaces({ personId, lock:[f1] })` inserts a lock
      row; a re-run scan drops f1 for any owner; re-locking is idempotent (M5); and a `lock` id **not in the
      flagged snapshot** → `BadRequestException` (M14, E15). Run → FAIL.
- [ ] **Step 5 — Service lock bucket.** Validate `lock ⊆ snapshot`; `insertLocks(lock, personId, resolvedBy)`.
      Run → PASS.
- [ ] **Step 6 — Web "Confirm / lock".** Bulk action + violet `lock` chip (lock icon "Locked") + tally.
      Component test for the action. Run → PASS.
- [ ] **Step 7 — Format + commit** `feat(face-cleanup): confirm/lock (owner-agnostic)`.

## Slice 4 — Move to a chosen person (owner-scoped picker + create)

**Goal:** Route a selection to **any person or unnamed cluster owned by the cluster's owner**, or a
newly-created person under that owner. Faces never cross owners.

**Covers:** spec req 3; state 2. Edge E11, E18 (destination gone). Tests **M2, M12, M17, M18, M20, C3, P3**.

**Note (gap the spec flagged):** Immich's normal person endpoints are self-scoped, so the admin needs
**admin, owner-scoped** helpers rather than reusing `createPerson`/`getAllPeople` directly.

- [ ] **Step 1 — Failing medium M2 + M12 + M20.** `resolveFaces` moving f1 to a person owned by the cluster
      owner succeeds (M2); moving to a person owned by a **different** user → `BadRequestException` (M12,
      E11); moving to a `destinationPersonId` that **no longer exists** (deleted/merged since the scan) →
      `BadRequestException`, nothing committed (M20, E18). Run → FAIL.
- [ ] **Step 2 — Cross-owner + existence guard.** In `resolveFaces`, resolve each destination person's
      `ownerId`; a person that does not exist yields no row → 400 (M20/E18); one owned by a **different** user
      than the moved faces' assets → 400 (M12/E11). Run Step 1 → PASS.
- [ ] **Step 3 — Owner-people endpoints (failing tests M17, M18, C3 first).** Write the failing tests:
      **M17** — `GET /admin/face-repair/owner/:ownerId/people?query=&page=` returns only that owner's people
      (named **and** unnamed clusters), filtered by `query`, paginated, and **never** another owner's;
      **M18** — `POST /admin/face-repair/owner/:ownerId/people` creates a person under `ownerId` whose id is
      immediately usable as a `moveToPerson` destination; **C3** — both routes are admin-only (non-admin →
      403). Then implement both routes (`@Authenticated({ admin: true })`, reusing `personRepository.create`
      for POST). Regen SDK. Commit server+SDK.
- [ ] **Step 4 — Failing component P3.** In `PersonPicker.spec.ts`: the picker lists the owner's people,
      filters on search, and **Create new** calls the create endpoint then routes the selection; if create
      **fails**, nothing is applied and the error shows (E8). Run → FAIL.
- [ ] **Step 5 — PersonPicker + wiring.** Build `PersonPicker.svelte` (search, owner-scoped list rows,
      create-new row) per the mockup; the `Move → person…` bulk action opens it, and selecting sets the
      selection to `other` with `destinationPersonId` + a `→ <Name>` amber chip. `buildResolveRequest` groups
      `other` faces by destination (extend W1). Run Step 4 → PASS.
- [ ] **Step 6 — Format + commit** `feat(face-cleanup): move to a chosen person (owner-scoped picker)`.

## Slice 5 — Detach ("Not a face")

**Goal:** A garbage crop is **detached** — unassigned from any person and stripped of its identity link — so
it leaves every cluster and is never re-flagged; recoverable via the normal unassigned-faces UI.

**Covers:** spec req 4; state 5. Edge E4, E15 (detach), E19 (representative regen). Tests **M6, M14 (detach),
M21**.

- [ ] **Step 1 — Failing medium M6 + M14 + M21.** `resolveFaces({ personId, detach:[f1] })` →
      `asset_face.personId IS NULL` for f1, no `face_identity_face` row for f1, and a subsequent
      `FaceIdentityBackfill` does **not** reattach it (M6). Also `detach` id not in snapshot → 400 (M14). And
      detaching the person's **representative / feature** face queues `PersonGenerateThumbnail` for that
      person (M21, E19). Run → FAIL.
- [ ] **Step 2 — `detachFaces` repo.** Add `FaceRepairRepository.detachFaces(personId, faceIds, trx)`:
      `updateTable('asset_face').set({ personId: null }).where('id','in',chunk).where('personId','=',personId)`
      with the same ML/visible/not-deleted guards; **in the same transaction** `deleteFrom('face_identity_face').where('assetFaceId','in',chunk)`. Return affected ids.
- [ ] **Step 3 — Service detach bucket.** Validate `detach ⊆ snapshot` (M14); wrap in a transaction; count
      into `detached`; and if any detached face was the person's representative / feature face, queue
      `PersonGenerateThumbnail` for that person (M21/E19). Run Step 1 → PASS.
- [ ] **Step 4 — Web "Not a face".** Bulk action + slate `detach` chip ("Detached") + grayscale tile + tally.
      Component test. Run → PASS.
- [ ] **Step 5 — Format + commit** `feat(face-cleanup): detach not-a-face`.

## Slice 6 — Rest-of-cluster + entire-cluster through resolve; retire old apply

**Goal:** Fold the retained rest-of-cluster and entire-cluster moves into `resolve`, then delete the old
`apply` endpoint so nothing depends on it.

**Covers:** spec req 8. Edge E12. Tests **M13**; existing add-faces e2e still green.

- [ ] **Step 1 — Failing medium M13.** `resolveFaces({ personId, entireCluster:{ destinationPersonId } })`
      moves every eligible face (server-enumerated); `entireCluster` **plus** any per-face bucket → 400. Run
      → FAIL.
- [ ] **Step 2 — Service entireCluster.** Reuse `collectClusterFaceIds` / `streamEligibleFaces` → one route;
      reject when combined with per-face buckets. Run → PASS.
- [ ] **Step 3 — Web rest-of-cluster on resolve.** Point the retained "Rest of this cluster" moves at the
      `moveToPerson` bucket (owner default or picked destination); "Move entire cluster" posts
      `entireCluster`. Keep the `cluster-faces` list endpoint. Adjust the add-faces web tests.
- [ ] **Step 4 — Remove old apply.** Delete the `apply` route, `FaceRepairApplyRequest/Response` DTOs, the
      `applyRepair` public method (fold any still-needed internals into `resolveFaces`), and their tests.
      Regen SDK. Verify no web import of `applyFaceRepair` remains.
- [ ] **Step 5 — Format + commit** `refactor(face-cleanup): rest/entire-cluster via resolve; drop old apply`.

## Slice 7 — Unified Resolutions manage page

**Goal:** One page lists soft-declines **and** locks, each undoable; undo re-enables flagging. Replaces the
declines-only page.

**Covers:** spec req 7. Tests **M16, C1, C2, X2**.

- [ ] **Step 1 — Failing medium M16.** `listResolutions()` returns declines **and** locks tagged `kind`;
      `removeResolutions` deletes by uuid-**v7** id **and** by natural key; undoing a lock re-enables flagging
      on the next scan. Run → FAIL.
- [ ] **Step 2 — Service + repo.** Add `listResolutions` (union of decline rows + lock rows, each with
      face/person thumbnail ids + `createdAt` + `kind`) and `removeResolutions({ declineIds?, lockIds?,
faces? })`. Reuse decline list/remove; add lock list/remove (`z.uuid()` for v7 ids). Run → PASS.
- [ ] **Step 3 — Endpoints + auth C1/C2.** `GET /admin/face-repair/resolutions`, `POST
/admin/face-repair/resolutions/remove`; controller spec asserts admin-only (403 for non-admin) and
      `z.uuid()` acceptance of v7 ids. Regen SDK. Commit server+SDK.
- [ ] **Step 4 — Web page.** Rename `declined/` → `resolutions/`; render two grouped, undoable lists
      (Declines green, Locks violet) matching state colors; undo hits `resolutions/remove`. Redirect the old
      `/declined` route. Component test. Run → PASS.
- [ ] **Step 5 — Format + commit** `feat(face-cleanup): unified resolutions manage page`.

## Slice 8 — Capstone e2e + i18n + full gate

**Goal:** Prove the whole durable-drain flow end-to-end and land the copy + green gate.

**Covers:** spec req 1 (end-to-end). Tests **X1, X2** + the matrix-completeness gate.

- [ ] **Step 0 — Matrix completeness gate.** Confirm every §8 ID — U1–U3, M1–M22, C1–C3, W1–W3, P1–P5,
      X1–X2 — appears in exactly one slice's **Tests** line and has a corresponding green test in the suite;
      fail the slice if any ID is unscheduled or red. This is the backstop for the orphaned-test class this
      plan was revised to close (U3/M7/M8/M15/P5 previously unmapped).
- [ ] **Step 1 — Failing e2e X1.** In `e2e/src/specs/web/face-cleanup.e2e-spec.ts`: drive select → route one
      face into each of the five states → Apply; assert the resolve payload and that the person **drains from
      the console**. Add X2 (Resolutions undo → re-scan re-flags). Run `make e2e-web-dev` → FAIL.
- [ ] **Step 2 — i18n.** Add every `admin.face_cleanup_*` key the reworked page/picker/manage page/banner use
      to `i18n/en.json` (bulk actions, chips, tally, "every face accounted for", picker, create-new,
      resolutions). Run → PASS.
- [ ] **Step 3 — Full gate.** `make check-server check-web lint-server lint-web`; `cd server && pnpm test &&
pnpm test:medium`; `cd web && pnpm test`; `pnpm -C docs exec prettier --check docs/plans/2026-07-10-*`.
      Fix any red. Commit `test(face-cleanup): capstone e2e + i18n + gate`.

---

## Self-Review — spec coverage

| Spec requirement / edge                                 | Slice(s)                                              |
| ------------------------------------------------------- | ----------------------------------------------------- |
| Req 1 durable drain (drop on resolve)                   | 1, 2, 8                                               |
| Req 2 two stay-strengths                                | 2, 3                                                  |
| Req 3 chosen-person picker (owner-scope)                | 4                                                     |
| Req 4 detach                                            | 5                                                     |
| Req 5 Model B interaction                               | 1                                                     |
| Req 6 batch Apply                                       | 1                                                     |
| Req 7 unified Resolutions page                          | 7                                                     |
| Req 8 rest/entire-cluster retained                      | 6                                                     |
| E1 skip moved-off · E9 guard · E10 zero-override (M15)  | 1                                                     |
| E2 lock owner-agnostic                                  | 3                                                     |
| E3 soft-stay different owner                            | 2                                                     |
| E4 detach + identity                                    | 5                                                     |
| E5 detach re-cluster (accepted, no test)                | — (documented)                                        |
| E6 empty-unnamed cleanup (M8)                           | 1                                                     |
| E7 disjoint buckets (U3 helper S1 · M7 S2)              | 1, 2                                                  |
| E8 create-new fails → nothing applied                   | 4                                                     |
| E11 cross-owner reject                                  | 4                                                     |
| E12 entire-cluster exclusive                            | 6                                                     |
| E13 drop on keep/lock-only                              | 2                                                     |
| E14 per-face owner grouping                             | 1                                                     |
| E15 keep/lock/detach non-flagged (M14 stay/lock/detach) | 2, 3, 5                                               |
| E16 empty resolve (M19)                                 | 1                                                     |
| E17 incomplete resolve (client W2 · server doc)         | 1                                                     |
| E18 destination gone (M20)                              | 4                                                     |
| E19 detach representative regen (M21)                   | 5                                                     |
| E20 re-soft-stay idempotent (M22)                       | 2                                                     |
| Owner-people endpoints (M17, M18, C3)                   | 4                                                     |
| Tests U1–U3, M1–M22, C1–C3, W1–W3, P1–P5, X1–X2         | every ID mapped to one slice; Slice 8 Step 0 gates it |

**The bucket-validation helper (U3)** — disjoint (E7) + snapshot-membership (E15) — plus `assertResolvable`
land in Slice 1 and are reused by every later bucket; the integration checks land where each bucket first
makes them reachable (**M7** disjoint in Slice 2; **M14** non-flagged in Slices 2 / 3 / 5). **Type
consistency:** `resolveFaces(input, resolvedBy)`, `buildResolveRequest`, `FaceRepairResolveRequestDto`,
`detachFaces`, `insertLocks`/`getLockedFaceIds`, `listResolutions`/`removeResolutions` are used with the same
signatures across the slices that define and consume them.
