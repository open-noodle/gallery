# Space-Editor Face Assignment — Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An editor can draw a face box on a member's photo, and delete a box **they** drew — while a detected face stays owner-only.

**Architecture:** A new nullable `asset_face.createdBy` column records who drew a box. It is written only by the new space endpoint and is `NULL` for every existing row and everything the detector produces. That column is what separates "editor drew this" from "the owner drew this by hand", which `sourceType` cannot do.

**Tech Stack:** NestJS 11, Kysely, a fork migration, Vitest (unit + medium).

**Spec:** `specs/2026-08-23-space-editor-face-assignment-design.md` — §6.5, §6.6, §9.6

**Baseline (Slices 1–5, committed):** attach, `linkFaceToSpacePerson`, the space face read, create, detach, and the cross-space propagation pins.

## Global Constraints

- **No relative imports in `server/`** — use the `src/` path alias.
- **Do NOT touch** `server/src/utils/access.ts`, `person.controller.ts`, `face.controller.ts`.
- **Do NOT write `asset_face.personId`.** Editor-drawn faces get `personId = NULL` and reach their space person through `shared_space_person_face` only.
- **Never put `--` before a vitest filter** — it discards the filter and runs all 161 medium files, producing fake `too many clients already` failures. Use `pnpm test --run shared-space.service`, `pnpm test:medium --run shared-space-face-assign --maxWorkers=4`.
- **ESLint runs `--max-warnings 0`.** `pnpm lint` is ESLint only; prettier is a separate gate. Run both.
- **Do NOT run `make sql`** — it deletes every query file without a live DB. Deferred to Slice 9 with OpenAPI.
- **Any repository method called from inside a transaction must take and use a trailing `db`/`trx` param.** Slice 2 found a real deadlock from exactly this. Check signatures before calling something new inside a transaction.
- **Guard check:** `git diff --name-only <slice-6-base-sha>..HEAD`, never `origin/main...HEAD`.

## The trap this slice exists to avoid

`SourceType` has exactly three values — `machine-learning`, `exif`, `manual` (`server/src/enum.ts:462`) — and `PersonService.createFace` (`person.service.ts:1567`) already writes `SourceType.Manual` for **owner**-drawn boxes.

So **gating the delete on `sourceType === Manual` would let a space editor delete boxes the owner drew by hand.** That is strictly worse than today's behaviour and is the whole reason `createdBy` exists. Do not use `sourceType` to decide deletability. Do not add a new `SourceType` value either — three live consumers branch on it (`person.service.ts:876`, `:1094`, `:1193`) and a new value risks the recognition jobs mis-treating these faces.

---

### Task 1: The `asset_face.createdBy` migration

**Files:**

- Create: `server/src/schema/migrations-gallery/1791000000000-AddAssetFaceCreatedBy.ts`
- Modify: `server/src/schema/tables/asset-face.table.ts`

Fork migrations live in `migrations-gallery/`, never in `migrations/` (which is replaced wholesale on upstream rebases). Use the next round timestamp: the current highest is `1790000000000-FixFaceRepairScanInFlightIndex.ts`, so use **`1791000000000`**. Follow the `Kysely, sql` idiom of its neighbours.

- [ ] **Step 1: Write the migration**

Nullable uuid, FK to `user`, `ON DELETE SET NULL` — so deleting a user does not cascade away the face rows they drew. No default, no backfill: every existing row stays `NULL`, which means "not editor-drawn".

Provide both `up` and `down`.

- [ ] **Step 2: Add the column to the table definition**

`server/src/schema/tables/asset-face.table.ts`, following the file's existing `@ForeignKeyColumn` idiom for nullable FKs (see `personId` at `:56` for the shape).

- [ ] **Step 3: Verify the schema matches**

```bash
cd server && pnpm test:medium --run schema-drift
```

The drift spec compares the table definitions against the migrated database. If it fails, the migration and the table definition disagree — fix them, do not skip the spec.

- [ ] **Step 4: Commit**

```bash
git add server/src/schema/migrations-gallery/ server/src/schema/tables/asset-face.table.ts
git commit -m "feat(server): record who drew a face box

asset_face.createdBy, nullable, NULL for every existing row and everything the
detector produces. Needed because sourceType cannot distinguish an editor-drawn
box from an owner-drawn one -- createFace already writes 'manual' for the
owner's, so gating a delete on it would let an editor remove the owner's boxes.

Fork migration, migrations-gallery, round timestamp."
```

---

### Task 2: Draw a box (§6.5)

**Interfaces:**

- Produces: `SharedSpaceService.createSpaceAssetFace(auth, spaceId, assetId, dto: { x, y, width, height, spacePersonId }): Promise<SpaceAssetFaceResponseDto>`
- Produces: `POST /shared-spaces/:id/assets/:assetId/faces`

**Gates:** `requireRole(auth, spaceId, SharedSpaceRole.Editor)` → assert the asset is reachable (`isAssetInSpace`) → `requireSpacePersonInSpace(spaceId, spacePersonId)`.

**The coordinate transform is not optional.** Reuse the edit-aware conversion in `PersonService.createFace` (`person.service.ts` ~`:1519-1545`): coordinates arrive in the **edited preview** image's space and must be converted to the original image's space using `asset.edits`. #992 lets editors rotate a member's asset, so drawing on a rotated preview is a likely path, not an exotic one (F-16). If dimensions are unavailable when edits exist, throw `BadRequestException` with the same message the owner path uses (F-17).

Extract the transform into a shared helper rather than copying it — two implementations of one geometry conversion will drift, and a drift here silently misplaces boxes.

The created `asset_face` gets `personId = NULL`, `sourceType = SourceType.Manual`, `createdBy = auth.user.id`, then is attached to the space person via `linkFaceToSpacePerson`.

- [ ] **Step 1: Write F-16 and F-17 as failing tests. F-16 first.**

F-16: an asset carrying a rotate edit — the stored bounding box must be in **original-image** coordinates, not preview coordinates. Assert the actual stored numbers, computed independently in the test, not just that a row exists.

F-17: an asset with edits but no `exifImageWidth`/`exifImageHeight` → 400 with the owner path's message.

- [ ] **Step 2: Run, confirm RED, implement, confirm GREEN.**

- [ ] **Step 3: Add the request DTO and route**, `@Authenticated({ permission: Permission.SharedSpaceUpdate })`, returning `SpaceAssetFaceResponseDto`. Controller tests mirror the file's real idiom (assert `ctx.authenticate` called with the expected permission; non-uuid param → 400). No bare-401 test — the harness mocks `AuthService.authenticate` to return `undefined`.

- [ ] **Step 4: Commit.**

---

### Task 3: Delete an editor-drawn box (§6.6)

**Interfaces:**

- Produces: `SharedSpaceService.deleteSpaceAssetFace(auth, spaceId, assetFaceId): Promise<void>`
- Produces: `DELETE /shared-spaces/:id/faces/:assetFaceId`

**Rule:** deletable iff `createdBy IS NOT NULL` **and** the face is reachable in a space where the actor is Owner/Editor. A detected face (`createdBy IS NULL`) is refused — `FaceDelete` stays owner-only for those.

- [ ] **Step 1: Write F-18 and F-19 together, not sequentially.**

They differ **only** by whether `createdBy` is null, so an implementation that forgets the check passes F-18 and fails only F-19. Writing F-18 alone and implementing would produce a confidently wrong green.

F-19 must assert on a **genuinely detected** face — one the fixture created the normal way, with `createdBy` never set — not one with `createdBy` nulled by hand afterwards. A hand-nulled row can differ from a real detection in ways that make the test prove less than it appears to.

- [ ] **Step 2: Run, confirm RED (F-19 especially), implement, confirm GREEN.**

- [ ] **Step 3: Add the route** and controller tests, same idiom as above.

- [ ] **Step 4: Full gate**

```bash
cd server && pnpm check
cd server && pnpm test --run shared-space.service
cd server && pnpm test --run shared-space.controller
cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4
cd server && pnpm test:medium --run schema-drift
cd server && pnpm lint && npx prettier --check "src/**/*.ts" "test/**/*.ts"
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): let an editor delete a box they drew

Gated on createdBy being non-null, never on sourceType -- createFace already
writes 'manual' for owner-drawn boxes, so a sourceType gate would let an editor
delete the owner's. Detected faces stay owner-only.

Covers F-18, F-19."
```

---

## Slice 6 Done When

- `asset_face.createdBy` exists, nullable, NULL everywhere except editor-drawn boxes; `schema-drift` passes.
- An editor can draw a box on a rotated asset and it lands in original-image coordinates (F-16).
- An editor can delete a box they drew (F-18) and cannot delete a detected face (F-19).
- No code anywhere decides deletability from `sourceType`.
- `git diff --name-only <base>..HEAD` touches no forbidden file.
