# Space-Editor Face Assignment — Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `GET /shared-spaces/:id/assets/:assetId/faces` — an Owner/Editor can list the face boxes on a member's asset, space-scoped, so the client has something to attach to.

**Architecture:** A repository read returns every live, visible face on the asset, joined to the space person holding it (if any). It applies the same hidden-person exclusion the write already applies, so the list and the write cannot disagree — an editor must never be able to attach a face the list would not show them. Gated Editor-only, because the response exposes faces nobody has named yet.

**Tech Stack:** NestJS 11, Kysely, Zod DTOs (`createZodDto`), Vitest (unit + medium).

**Spec:** `specs/2026-08-23-space-editor-face-assignment-design.md` — §6.1, §9.3

**Baseline (Slices 1–2, committed):**

- `FacePersonVerdictRepository.isFaceAssignableInSpace(spaceId, assetFaceId)` — the write-side predicate, whose hidden-person exclusion this slice mirrors on the read side.
- `SharedSpaceService.attachFaceToSpacePerson(...)`, `linkFaceToSpacePerson(...)`
- `PUT /shared-spaces/:id/people/:personId/faces/:assetFaceId`
- Medium spec `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts`

## Global Constraints

- **No relative imports in `server/`** — use the `src/` path alias.
- **Do NOT touch** `server/src/utils/access.ts`, `person.controller.ts`, `face.controller.ts`.
- **Never put `--` before a vitest filter** — it discards the filter and runs all 161 medium files, producing fake `too many clients already` failures. Correct forms:
  - `cd server && pnpm test --run shared-space.service`
  - `cd server && pnpm test --run shared-space.controller`
  - `cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4`
- **ESLint runs `--max-warnings 0`.** `pnpm lint` is ESLint only — prettier is a separate gate. Run both.
- **Do NOT run `make sql`** or regenerate OpenAPI — deferred to Slice 9.
- **Guard check:** verify against **this slice's own commit range** (`git diff --name-only <base-sha>..HEAD`), never `origin/main...HEAD` — the branch already contains #992, which legitimately touches `utils/access.ts`.
- **No `isEditorDrawn` field yet.** `asset_face.createdBy` does not exist until Slice 6. Do not add the field, and do not invent a substitute — `sourceType === 'manual'` is NOT it (owner-drawn boxes already use `manual`, and treating them as editor-drawn is the permission regression §6.6 exists to avoid). Slice 6 adds the column and the field together.

---

### Task 1: The space-scoped face read

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` — new read method
- Modify: `server/src/services/shared-space.service.ts` — new service method
- Modify: `server/src/dtos/shared-space-person.dto.ts` — response DTO
- Modify: `server/src/controllers/shared-space.controller.ts` — the route
- Test: `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts`, `server/src/controllers/shared-space.controller.spec.ts`

**Interfaces:**

- Produces:
  - `SharedSpaceRepository.getAssetFacesForSpace(spaceId: string, assetId: string): Promise<SpaceAssetFace[]>` where `SpaceAssetFace = { id: string; boundingBoxX1: number; boundingBoxY1: number; boundingBoxX2: number; boundingBoxY2: number; imageWidth: number; imageHeight: number; spacePersonId: string | null; spacePersonName: string | null }`
  - `SharedSpaceService.getSpaceAssetFaces(auth: AuthDto, spaceId: string, assetId: string): Promise<SpaceAssetFaceResponseDto[]>`
  - `GET /shared-spaces/:id/assets/:assetId/faces`

**The three exclusions (§6.1), all load-bearing:**

| Excluded                                                     | Why                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| faces whose owner `person.isHidden = true`                   | preserves the owner's hide; absent, not marked (F-8)              |
| faces held by a `shared_space_person` with `isHidden = true` | mirrors the existing read filter at `asset.service.ts:135` (F-12) |
| `asset_face.deletedAt IS NOT NULL` or `isVisible = false`    | consistent with `isFaceAssignableInSpace`                         |

- [ ] **Step 1: Write the failing medium tests (F-8, F-12)**

Append to `server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts`, reusing its existing `setup()`, `newSpaceWithEditorAndMember` and `reachPathBuilders` helpers.

```ts
describe("getAssetFacesForSpace", () => {
  // F-8: the read-side twin of F-9. Written so "absent" is proved to mean the filter fired,
  // not that the fixture never created the face — un-hide and the same face appears.
  it("omits a face belonging to a person the OWNER marked hidden (F-8)", async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: person } = await ctx.newPerson({ ownerId: bob.id, isHidden: true });
    const { result: faceId } = await ctx.newAssetFace({ assetId, personId: person.id });

    await expect(spaceRepo.getAssetFacesForSpace(space.id, assetId)).resolves.toEqual([]);

    await defaultDatabase.updateTable("person").set({ isHidden: false }).where("id", "=", person.id).execute();
    const shown = await spaceRepo.getAssetFacesForSpace(space.id, assetId);
    expect(shown.map((f) => f.id)).toEqual([faceId]);
  });

  // F-12: a face held by a space person the SPACE hid is likewise absent.
  it("omits a face held by a hidden space person (F-12)", async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const person = await spaceRepo.createPerson({ spaceId: space.id, name: "Hidden one", isHidden: true });
    await spaceRepo.addPersonFaces([{ personId: person.id, assetFaceId: faceId }]);

    await expect(spaceRepo.getAssetFacesForSpace(space.id, assetId)).resolves.toEqual([]);

    await defaultDatabase.updateTable("shared_space_person").set({ isHidden: false }).where("id", "=", person.id).execute();
    const shown = await spaceRepo.getAssetFacesForSpace(space.id, assetId);
    expect(shown.map((f) => f.id)).toEqual([faceId]);
  });

  it("returns an unassigned face with a null space person", async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    const faces = await spaceRepo.getAssetFacesForSpace(space.id, assetId);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatchObject({ id: faceId, spacePersonId: null, spacePersonName: null });
  });

  it("omits soft-deleted and invisible faces", async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    await expect(spaceRepo.getAssetFacesForSpace(space.id, assetId)).resolves.toHaveLength(1);
    await defaultDatabase.updateTable("asset_face").set({ isVisible: false }).where("id", "=", faceId).execute();
    await expect(spaceRepo.getAssetFacesForSpace(space.id, assetId)).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm RED**

`cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4`

Expected: the four new tests fail with `spaceRepo.getAssetFacesForSpace is not a function`. The 13 pre-existing must still pass.

- [ ] **Step 3: Implement the repository read**

Add to `server/src/repositories/shared-space.repository.ts`, near the other space-person face reads. Follow the file's `@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })` idiom.

Shape: select from `asset_face`, inner join `asset` (for the reachability/visibility gates), left join `person` (owner-hidden exclusion), left join `shared_space_person_face` + `shared_space_person` **scoped to this space** (so a face held in a different space still reads as unassigned here).

Exclusions: `asset_face.deletedAt IS NULL`, `asset_face.isVisible = true`, `asset.deletedAt IS NULL`, `asset.isOffline = false`, `reviewableAssetVisibility(eb)`, `(person.id IS NULL OR person.isHidden = false)`, and `(shared_space_person.id IS NULL OR shared_space_person.isHidden = false)`.

Order by `asset_face.id` so the response is stable.

- [ ] **Step 4: Run and confirm GREEN**

`cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4` — 17 tests pass.

- [ ] **Step 5: Add the service method**

```ts
  /**
   * Spec §6.1. Editor-only: the response exposes faces nobody has named yet, which members
   * have no business seeing. The hidden-person exclusion lives in the repository read so it
   * cannot drift from `isFaceAssignableInSpace` — an editor must never be able to attach a
   * face this list would not show them (F-8/F-9).
   */
  async getSpaceAssetFaces(auth: AuthDto, spaceId: string, assetId: string): Promise<SpaceAssetFaceResponseDto[]>
```

Gate: `requireRole(auth, spaceId, SharedSpaceRole.Editor)`, then assert the **asset** is reachable in the space. Reuse the existing asset-level reachability helper if one exists; if not, add one mirroring `isFaceReachableInSpace`'s use of `spaceAssetPathBranches` but correlating on the asset. Throw `BadRequestException('Asset not found')` when unreachable — the same deliberate non-disclosure the attach path uses.

- [ ] **Step 6: Add the response DTO**

In `server/src/dtos/shared-space-person.dto.ts`, a `SpaceAssetFaceResponseSchema` with `meta({ id: 'SpaceAssetFaceResponseDto' })`: `id`, `boundingBoxX1`, `boundingBoxY1`, `boundingBoxX2`, `boundingBoxY2`, `imageWidth`, `imageHeight`, `spacePersonId` (nullable), `spacePersonName` (nullable). Use `z.uuidv4()` for ids — these are v4 and v7 would 400 every request.

- [ ] **Step 7: Add the controller route**

```ts
  @Get(':id/assets/:assetId/faces')
  @Authenticated({ permission: Permission.SharedSpaceRead })
```

`SharedSpaceRead` matches the sibling reads (`GET :id/people/:personId/faces` at `:406`). The decorator is the API-key SCOPE, not the RBAC gate — Editor-only is enforced in the service.

Add a param DTO for `{ id, assetId }` following the file's existing param-DTO idiom, and controller tests mirroring the file's real idiom: assert `ctx.authenticate` was called with the expected permission, plus a non-uuid `assetId` → 400. Do NOT write a bare-401 test — this harness mocks `AuthService.authenticate` to return `undefined`, so unauthenticated requests never 401 here.

- [ ] **Step 8: Full gate**

```bash
cd server && pnpm check
cd server && pnpm test --run shared-space.service
cd server && pnpm test --run shared-space.controller
cd server && pnpm test:medium --run shared-space-face-assign --maxWorkers=4
cd server && pnpm lint && npx prettier --check "src/**/*.ts" "test/**/*.ts"
```

- [ ] **Step 9: Commit**

```bash
git add server/src/repositories/shared-space.repository.ts server/src/services/shared-space.service.ts server/src/dtos/shared-space-person.dto.ts server/src/controllers/shared-space.controller.ts server/src/controllers/shared-space.controller.spec.ts server/test/medium/specs/repositories/shared-space-face-assign.medium.spec.ts
git commit -m "feat(server): list the faces on an asset, space-scoped

GET /shared-spaces/:id/assets/:assetId/faces, Editor-only because it exposes
faces nobody has named. Applies the same owner-hidden-person exclusion the
write applies, so an editor can never attach a face this list would not show
them, plus the space-hidden-person exclusion the asset detail read already uses.

No isEditorDrawn field yet -- asset_face.createdBy arrives in slice 6.

Covers F-8, F-12."
```

---

## Slice 3 Done When

- `GET /shared-spaces/:id/assets/:assetId/faces` returns the asset's faces for an Owner/Editor and refuses a Viewer.
- F-8 and F-12 pass, both proved non-vacuous by un-hiding and re-reading.
- No `isEditorDrawn` field exists yet.
- `git diff --name-only <base>..HEAD` touches no forbidden file.
